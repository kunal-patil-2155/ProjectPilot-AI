/**
 * ProjectPilot AI - Upstash Redis Serverless REST Persistence Adapter
 * Provides durable, concurrency-safe, multi-instance storage for serverless environments (Vercel).
 * Communicates strictly over standard HTTPS fetch to the Upstash REST endpoint.
 * Implements optimistic locking with version-checked atomic CAS mutations.
 */

import crypto from 'node:crypto';
import { getSampleData } from './sampleData.js';
import {
  VALID_PROJECT_STATUSES,
  VALID_PRIORITIES,
  VALID_TASK_STATUSES
} from './store.js';

// Lua script for Compare-And-Swap (CAS) optimistic locking
const CAS_LUA_SCRIPT = `
local key = KEYS[1]
local expectedVersion = tonumber(ARGV[1])
local newPayload = ARGV[2]

local current = redis.call('GET', key)
if not current then
  return redis.error_reply('KEY_NOT_FOUND')
end

local parsed = cjson.decode(current)
local curVer = 0
if parsed and parsed.meta and parsed.meta.version then
  curVer = tonumber(parsed.meta.version)
end

if expectedVersion > 0 and curVer ~= expectedVersion then
  return redis.error_reply('VERSION_CONFLICT: Expected ' .. tostring(expectedVersion) .. ' but found ' .. tostring(curVer))
end

redis.call('SET', key, newPayload)
return 'OK'
`;

export class UpstashRedisStore {
  /**
   * @param {Object} options
   * @param {string} options.url - Upstash REST URL (e.g. https://...upstash.io)
   * @param {string} options.token - Upstash REST Token
   * @param {string} [options.storeKey] - Redis key name (default: 'projectpilot:store')
   * @param {number} [options.timeoutMs] - Request timeout in milliseconds (default: 5000)
   * @param {number} [options.maxRetries] - Max retry attempts on version conflict (default: 3)
   * @param {Function} [options.fetchFn] - Custom fetch function (default: globalThis.fetch)
   */
  constructor(options = {}) {
    const rawUrl = options.url || process.env.UPSTASH_REDIS_REST_URL;
    const rawToken = options.token || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new Error('Upstash persistence configuration error: UPSTASH_REDIS_REST_URL is required and must be a valid URL string.');
    }
    if (!rawToken || typeof rawToken !== 'string') {
      throw new Error('Upstash persistence configuration error: UPSTASH_REDIS_REST_TOKEN is required.');
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl.trim());
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        throw new Error('Protocol must be https (or http for local mock testing).');
      }
    } catch (err) {
      throw new Error(`Upstash persistence configuration error: Invalid URL format (${err.message}).`);
    }

    this.url = rawUrl.trim().replace(/\/+$/, '');
    this.token = rawToken.trim();
    this.storeKey = options.storeKey || process.env.UPSTASH_REDIS_STORE_KEY || 'projectpilot:store';
    this.timeoutMs = options.timeoutMs || 5000;
    this.maxRetries = options.maxRetries || 3;
    this.fetchFn = options.fetchFn || globalThis.fetch;

    this.data = {
      meta: { version: 1, initializedAt: new Date().toISOString() },
      projects: [],
      tasks: [],
      auditLog: []
    };
    this._initialized = false;
  }

  /**
   * Safe command execution over Upstash REST API.
   * Never leaks tokens or raw credentials in errors or logs.
   * @param {Array<string|number>} command
   */
  async _command(command) {
    if (!this.fetchFn) {
      throw new Error('Remote persistence error: fetch is not available in runtime.');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(this.url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(command),
        signal: controller.signal
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Remote persistence error: Authentication failed against Upstash Redis REST API.');
        }
        throw new Error(`Remote persistence error: Upstash Redis returned HTTP ${res.status}.`);
      }

      const body = await res.json();
      if (body && body.error) {
        throw new Error(`Remote persistence error: ${body.error}`);
      }

      return body ? body.result : null;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Remote persistence error: Request timed out after ${this.timeoutMs}ms.`);
      }
      if (err.message && err.message.startsWith('Remote persistence error:')) {
        throw err;
      }
      throw new Error(`Remote persistence error: Network operation failed (${err.message}).`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Initializes store: fetches remote state, or seeds with sample data if key does not exist.
   * Never overwrites existing user data on cold start or restart.
   */
  async init() {
    // Check if storeKey already exists in Redis
    const existing = await this._command(['GET', this.storeKey]);

    if (existing !== null && existing !== undefined) {
      try {
        const parsed = typeof existing === 'string' ? JSON.parse(existing) : existing;
        if (Array.isArray(parsed.projects) && Array.isArray(parsed.tasks)) {
          this.data = parsed;
          if (!Array.isArray(this.data.auditLog)) {
            this.data.auditLog = [];
          }
          if (!this.data.meta || typeof this.data.meta.version !== 'number') {
            this.data.meta = { ...this.data.meta, version: 1 };
          }
          this._initialized = true;
          return;
        }
      } catch (err) {
        throw new Error(`Remote persistence error: Corrupted state retrieved from Upstash Redis (${err.message}).`);
      }
    }

    // Key not found: seed cleanly with SETNX to prevent race condition overwrite
    const seed = getSampleData();
    seed.meta = {
      version: 1,
      initializedAt: new Date().toISOString()
    };
    if (!Array.isArray(seed.auditLog)) {
      seed.auditLog = [];
    }

    const serialized = JSON.stringify(seed);
    const setResult = await this._command(['SETNX', this.storeKey, serialized]);

    if (setResult === 1) {
      // Successfully seeded
      this.data = seed;
    } else {
      // Another instance seeded first; read the winning seed
      const winner = await this._command(['GET', this.storeKey]);
      this.data = typeof winner === 'string' ? JSON.parse(winner) : winner;
    }

    this._initialized = true;
  }

  /**
   * Synchronizes latest state from Upstash Redis into local memory.
   * Essential for serverless functions handling independent requests.
   */
  async sync() {
    const remote = await this._command(['GET', this.storeKey]);
    if (remote) {
      const parsed = typeof remote === 'string' ? JSON.parse(remote) : remote;
      if (Array.isArray(parsed.projects) && Array.isArray(parsed.tasks)) {
        this.data = parsed;
        if (!Array.isArray(this.data.auditLog)) {
          this.data.auditLog = [];
        }
      }
    }
    return this.data;
  }

  /**
   * Executes a state mutation using optimistic locking with Lua CAS and automatic retry on conflict.
   * @param {Function} mutatorFn - (draft: Object) => Promise<any> | any
   */
  async _executeAtomicMutation(mutatorFn) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      // 1. Fetch freshest state
      await this.sync();

      // 2. Deep clone state to apply mutation cleanly
      const draft = JSON.parse(JSON.stringify(this.data));
      const expectedVersion = draft.meta?.version || 1;

      // 3. Apply mutation callback
      const result = await mutatorFn(draft);

      // 4. Update metadata and version
      draft.meta = draft.meta || {};
      draft.meta.version = expectedVersion + 1;
      draft.meta.updatedAt = new Date().toISOString();

      const newPayload = JSON.stringify(draft);

      // 5. Atomic CAS write via Lua script
      try {
        await this._command(['EVAL', CAS_LUA_SCRIPT, 1, this.storeKey, expectedVersion, newPayload]);
        // Update local memory on successful commit
        this.data = draft;
        return result;
      } catch (err) {
        if (err.message && err.message.includes('VERSION_CONFLICT')) {
          lastError = err;
          // Exponential jitter wait before retrying
          await new Promise(r => setTimeout(r, 25 * attempt));
          continue;
        }
        throw err;
      }
    }

    throw new Error(`Remote persistence error: Concurrent update conflict after ${this.maxRetries} attempts.`);
  }

  // ==========================================
  // PROJECT OPERATIONS
  // ==========================================

  listProjects(filters = {}) {
    let result = [...this.data.projects];
    if (filters.status) {
      result = result.filter(p => p.status.toLowerCase() === filters.status.toLowerCase());
    }
    if (filters.category) {
      result = result.filter(p => p.category.toLowerCase() === filters.category.toLowerCase());
    }
    if (filters.priority) {
      result = result.filter(p => p.priority.toLowerCase() === filters.priority.toLowerCase());
    }
    return result;
  }

  getProject(id) {
    if (!id || typeof id !== 'string') {
      throw new Error('Project ID is required and must be a string.');
    }
    const project = this.data.projects.find(p => p.id === id);
    if (!project) return null;
    const tasks = this.data.tasks.filter(t => t.projectId === id);
    return { ...project, tasks };
  }

  async createProject(input) {
    if (!input || typeof input !== 'object') {
      throw new Error('Project data must be an object.');
    }

    const name = (input.name || '').trim();
    if (!name) {
      throw new Error('Project name is required and cannot be empty.');
    }

    const status = (input.status || 'active').toLowerCase();
    if (!VALID_PROJECT_STATUSES.includes(status)) {
      throw new Error(`Invalid project status "${input.status}". Allowed: ${VALID_PROJECT_STATUSES.join(', ')}`);
    }

    const priority = (input.priority || 'medium').toLowerCase();
    if (!VALID_PRIORITIES.includes(priority)) {
      throw new Error(`Invalid priority "${input.priority}". Allowed: ${VALID_PRIORITIES.join(', ')}`);
    }

    if (input.id !== undefined && input.id !== null) {
      const idStr = String(input.id).trim();
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(idStr) || idStr === '__proto__' || idStr === 'constructor' || idStr === 'prototype') {
        throw new Error('Invalid project ID format: must be 1-64 alphanumeric characters, underscores, or hyphens.');
      }
    }

    const id = input.id ? String(input.id).trim() : `proj-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
    const techStack = Array.isArray(input.techStack)
      ? input.techStack.map(s => String(s).trim()).filter(Boolean)
      : typeof input.techStack === 'string'
        ? input.techStack.split(',').map(s => s.trim()).filter(Boolean)
        : [];

    const now = new Date().toISOString();
    const newProject = {
      id,
      name,
      description: (input.description || '').trim(),
      category: (input.category || 'General').trim(),
      techStack,
      repoUrl: (input.repoUrl || '').trim(),
      status,
      priority,
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    return await this._executeAtomicMutation((draft) => {
      if (draft.projects.some(p => p.id === id)) {
        throw new Error(`Project with ID "${id}" already exists.`);
      }
      draft.projects.push(newProject);
      return newProject;
    });
  }

  async updateProject(id, updates) {
    if (!id) throw new Error('Project ID is required.');

    return await this._executeAtomicMutation((draft) => {
      const index = draft.projects.findIndex(p => p.id === id);
      if (index === -1) {
        throw new Error(`Project not found with ID "${id}".`);
      }

      const existing = draft.projects[index];
      const updated = { ...existing };

      if (updates.name !== undefined) {
        const name = String(updates.name).trim();
        if (!name) throw new Error('Project name cannot be empty.');
        updated.name = name;
      }
      if (updates.description !== undefined) {
        updated.description = String(updates.description).trim();
      }
      if (updates.category !== undefined) {
        updated.category = String(updates.category).trim();
      }
      if (updates.repoUrl !== undefined) {
        updated.repoUrl = String(updates.repoUrl).trim();
      }
      if (updates.techStack !== undefined) {
        updated.techStack = Array.isArray(updates.techStack)
          ? updates.techStack.map(s => String(s).trim()).filter(Boolean)
          : typeof updates.techStack === 'string'
            ? updates.techStack.split(',').map(s => s.trim()).filter(Boolean)
            : [];
      }
      if (updates.status !== undefined) {
        const status = String(updates.status).toLowerCase();
        if (!VALID_PROJECT_STATUSES.includes(status)) {
          throw new Error(`Invalid status "${updates.status}". Allowed: ${VALID_PROJECT_STATUSES.join(', ')}`);
        }
        updated.status = status;
      }
      if (updates.priority !== undefined) {
        const priority = String(updates.priority).toLowerCase();
        if (!VALID_PRIORITIES.includes(priority)) {
          throw new Error(`Invalid priority "${updates.priority}". Allowed: ${VALID_PRIORITIES.join(', ')}`);
        }
        updated.priority = priority;
      }

      updated.version = (existing.version || 1) + 1;
      updated.updatedAt = new Date().toISOString();
      draft.projects[index] = updated;
      return updated;
    });
  }

  async deleteProject(id) {
    if (!id) throw new Error('Project ID is required.');

    return await this._executeAtomicMutation((draft) => {
      const index = draft.projects.findIndex(p => p.id === id);
      if (index === -1) {
        throw new Error(`Project not found with ID "${id}".`);
      }

      const removedProject = draft.projects.splice(index, 1)[0];
      const initialTaskCount = draft.tasks.length;
      draft.tasks = draft.tasks.filter(t => t.projectId !== id);
      const deletedTaskCount = initialTaskCount - draft.tasks.length;

      return {
        success: true,
        deletedProject: removedProject,
        deletedTaskCount
      };
    });
  }

  // ==========================================
  // TASK OPERATIONS
  // ==========================================

  listTasks(filters = {}) {
    let result = [...this.data.tasks];
    if (filters.projectId) {
      result = result.filter(t => t.projectId === filters.projectId);
    }
    if (filters.status) {
      result = result.filter(t => t.status.toLowerCase() === filters.status.toLowerCase());
    }
    if (filters.priority) {
      result = result.filter(t => t.priority.toLowerCase() === filters.priority.toLowerCase());
    }
    if (filters.isMaintenance !== undefined) {
      const boolVal = filters.isMaintenance === true || filters.isMaintenance === 'true';
      result = result.filter(t => Boolean(t.isMaintenance) === boolVal);
    }
    if (filters.isBug !== undefined) {
      const boolVal = filters.isBug === true || filters.isBug === 'true';
      result = result.filter(t => Boolean(t.isBug) === boolVal);
    }
    if (filters.blockedOnly) {
      result = result.filter(t => t.status === 'blocked' || Boolean(t.blocker));
    }
    return result;
  }

  getTask(id) {
    if (!id) return null;
    return this.data.tasks.find(t => t.id === id) || null;
  }

  async createTask(input) {
    if (!input || typeof input !== 'object') {
      throw new Error('Task input must be an object.');
    }
    const projectId = input.projectId;
    if (!projectId) {
      throw new Error('Project ID is required for task creation.');
    }

    const title = (input.title || '').trim();
    if (!title) {
      throw new Error('Task title is required.');
    }
    const status = (input.status || 'todo').toLowerCase();
    if (!VALID_TASK_STATUSES.includes(status)) {
      throw new Error(`Invalid task status "${input.status}". Allowed: ${VALID_TASK_STATUSES.join(', ')}`);
    }
    const priority = (input.priority || 'medium').toLowerCase();
    if (!VALID_PRIORITIES.includes(priority)) {
      throw new Error(`Invalid task priority "${input.priority}". Allowed: ${VALID_PRIORITIES.join(', ')}`);
    }

    if (input.id !== undefined && input.id !== null) {
      const idStr = String(input.id).trim();
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(idStr) || idStr === '__proto__' || idStr === 'constructor' || idStr === 'prototype') {
        throw new Error('Invalid task ID format: must be 1-64 alphanumeric characters, underscores, or hyphens.');
      }
    }

    const id = input.id ? String(input.id).trim() : `task-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
    const now = new Date().toISOString();
    const isDone = status === 'done';

    let dueDate = null;
    if (input.dueDate) {
      const parsed = new Date(input.dueDate);
      if (isNaN(parsed.getTime())) {
        throw new Error(`Invalid dueDate "${input.dueDate}". Expected valid date string.`);
      }
      dueDate = parsed.toISOString();
    }

    const blocker = status === 'blocked'
      ? (input.blocker ? String(input.blocker).trim() : 'Blocked by unresolved dependency')
      : (input.blocker ? String(input.blocker).trim() : null);

    const newTask = {
      id,
      projectId,
      title,
      description: (input.description || '').trim(),
      status,
      priority,
      dueDate,
      blocker,
      isMaintenance: Boolean(input.isMaintenance),
      isBug: Boolean(input.isBug),
      version: 1,
      createdAt: now,
      updatedAt: now,
      completedAt: isDone ? now : null
    };

    return await this._executeAtomicMutation((draft) => {
      const projectExists = draft.projects.some(p => p.id === projectId);
      if (!projectExists) {
        throw new Error(`Cannot create task: Project with ID "${projectId}" does not exist.`);
      }
      if (draft.tasks.some(t => t.id === id)) {
        throw new Error(`Task with ID "${id}" already exists.`);
      }
      draft.tasks.push(newTask);
      return newTask;
    });
  }

  async updateTaskStatus(id, newStatus, blockerReason = null) {
    if (!id) throw new Error('Task ID is required.');
    const targetStatus = String(newStatus).toLowerCase();
    if (!VALID_TASK_STATUSES.includes(targetStatus)) {
      throw new Error(`Invalid task status "${newStatus}". Allowed: ${VALID_TASK_STATUSES.join(', ')}`);
    }

    return await this._executeAtomicMutation((draft) => {
      const index = draft.tasks.findIndex(t => t.id === id);
      if (index === -1) {
        throw new Error(`Task not found with ID "${id}".`);
      }

      const task = draft.tasks[index];
      const now = new Date().toISOString();
      const updated = {
        ...task,
        status: targetStatus,
        updatedAt: now,
        version: (task.version || 1) + 1
      };

      if (targetStatus === 'blocked') {
        updated.blocker = blockerReason ? String(blockerReason).trim() : (task.blocker || 'Unspecified blocker');
        updated.completedAt = null;
      } else if (targetStatus === 'done') {
        updated.completedAt = now;
        updated.blocker = null;
      } else {
        if (!blockerReason) {
          updated.blocker = null;
        }
        updated.completedAt = null;
      }

      draft.tasks[index] = updated;
      return updated;
    });
  }

  async updateTask(id, updates) {
    if (!id) throw new Error('Task ID is required.');

    return await this._executeAtomicMutation((draft) => {
      const index = draft.tasks.findIndex(t => t.id === id);
      if (index === -1) {
        throw new Error(`Task not found with ID "${id}".`);
      }

      const task = draft.tasks[index];
      const updated = { ...task };

      if (updates.projectId !== undefined) {
        if (!draft.projects.some(p => p.id === updates.projectId)) {
          throw new Error(`Cannot assign task to non-existent project "${updates.projectId}".`);
        }
        updated.projectId = updates.projectId;
      }
      if (updates.title !== undefined) {
        const title = String(updates.title).trim();
        if (!title) throw new Error('Task title cannot be empty.');
        updated.title = title;
      }
      if (updates.description !== undefined) {
        updated.description = String(updates.description).trim();
      }
      if (updates.priority !== undefined) {
        const priority = String(updates.priority).toLowerCase();
        if (!VALID_PRIORITIES.includes(priority)) {
          throw new Error(`Invalid priority "${updates.priority}". Allowed: ${VALID_PRIORITIES.join(', ')}`);
        }
        updated.priority = priority;
      }
      if (updates.dueDate !== undefined) {
        if (updates.dueDate === null || updates.dueDate === '') {
          updated.dueDate = null;
        } else {
          const parsed = new Date(updates.dueDate);
          if (isNaN(parsed.getTime())) {
            throw new Error(`Invalid dueDate "${updates.dueDate}".`);
          }
          updated.dueDate = parsed.toISOString();
        }
      }
      if (updates.isMaintenance !== undefined) {
        updated.isMaintenance = Boolean(updates.isMaintenance);
      }
      if (updates.isBug !== undefined) {
        updated.isBug = Boolean(updates.isBug);
      }
      if (updates.blocker !== undefined) {
        updated.blocker = updates.blocker ? String(updates.blocker).trim() : null;
      }
      if (updates.status !== undefined) {
        const status = String(updates.status).toLowerCase();
        if (!VALID_TASK_STATUSES.includes(status)) {
          throw new Error(`Invalid status "${updates.status}". Allowed: ${VALID_TASK_STATUSES.join(', ')}`);
        }
        updated.status = status;
        if (status === 'done') {
          updated.completedAt = updated.completedAt || new Date().toISOString();
          updated.blocker = null;
        } else {
          updated.completedAt = null;
        }
      }

      updated.version = (task.version || 1) + 1;
      updated.updatedAt = new Date().toISOString();
      draft.tasks[index] = updated;
      return updated;
    });
  }

  async deleteTask(id) {
    if (!id) throw new Error('Task ID is required.');

    return await this._executeAtomicMutation((draft) => {
      const index = draft.tasks.findIndex(t => t.id === id);
      if (index === -1) {
        throw new Error(`Task not found with ID "${id}".`);
      }

      const removed = draft.tasks.splice(index, 1)[0];
      return { success: true, deletedTask: removed };
    });
  }

  listBlockers(projectId = null) {
    let tasks = this.data.tasks.filter(t => t.status === 'blocked' || Boolean(t.blocker));
    if (projectId) {
      tasks = tasks.filter(t => t.projectId === projectId);
    }
    return tasks.map(t => {
      const project = this.data.projects.find(p => p.id === t.projectId);
      return {
        taskId: t.id,
        taskTitle: t.title,
        projectId: t.projectId,
        projectName: project ? project.name : 'Unknown Project',
        priority: t.priority,
        blockerReason: t.blocker || 'Status set to blocked without explicit detail',
        updatedAt: t.updatedAt
      };
    });
  }

  async reopenTask(id, targetStatus = 'todo') {
    if (!id) throw new Error('Task ID is required.');

    return await this._executeAtomicMutation((draft) => {
      const index = draft.tasks.findIndex(t => t.id === id);
      if (index === -1) {
        throw new Error(`Task not found with ID "${id}".`);
      }

      const task = draft.tasks[index];
      const status = (targetStatus === 'in_progress') ? 'in_progress' : 'todo';
      const now = new Date().toISOString();
      const updated = {
        ...task,
        status,
        completedAt: null,
        blocker: null,
        updatedAt: now,
        version: (task.version || 1) + 1
      };
      draft.tasks[index] = updated;
      return updated;
    });
  }

  async addBlocker(taskId, blockerReason, priority = null) {
    if (!taskId) throw new Error('Task ID is required.');
    if (!blockerReason || !String(blockerReason).trim()) {
      throw new Error('Blocker reason is required.');
    }

    return await this._executeAtomicMutation((draft) => {
      const index = draft.tasks.findIndex(t => t.id === taskId);
      if (index === -1) {
        throw new Error(`Task not found with ID "${taskId}".`);
      }

      const task = draft.tasks[index];
      const now = new Date().toISOString();
      const updated = {
        ...task,
        status: 'blocked',
        blocker: String(blockerReason).trim(),
        completedAt: null,
        updatedAt: now,
        version: (task.version || 1) + 1
      };

      if (priority && VALID_PRIORITIES.includes(String(priority).toLowerCase())) {
        updated.priority = String(priority).toLowerCase();
      }

      draft.tasks[index] = updated;
      return updated;
    });
  }

  async resolveBlocker(taskId, newStatus = 'in_progress') {
    if (!taskId) throw new Error('Task ID is required.');

    return await this._executeAtomicMutation((draft) => {
      const index = draft.tasks.findIndex(t => t.id === taskId);
      if (index === -1) {
        throw new Error(`Task not found with ID "${taskId}".`);
      }

      const task = draft.tasks[index];
      const targetStatus = VALID_TASK_STATUSES.includes(String(newStatus).toLowerCase())
        ? String(newStatus).toLowerCase()
        : 'in_progress';

      const now = new Date().toISOString();
      const updated = {
        ...task,
        status: targetStatus,
        blocker: null,
        updatedAt: now,
        completedAt: targetStatus === 'done' ? now : null,
        version: (task.version || 1) + 1
      };

      draft.tasks[index] = updated;
      return updated;
    });
  }

  // ==========================================
  // AUDIT LOGGING & COMPLIANCE OPERATIONS
  // ==========================================

  async recordAudit(entry) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Audit entry must be an object.');
    }

    const now = new Date().toISOString();
    const auditRecord = {
      id: `audit-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      timestamp: now,
      action: entry.action || 'system_event',
      actor: entry.actor || 'assistant',
      mode: entry.mode || 'APPROVE',
      targetType: entry.targetType || 'unknown',
      targetId: entry.targetId || null,
      details: entry.details || {},
      status: entry.status || 'success'
    };

    return await this._executeAtomicMutation((draft) => {
      if (!Array.isArray(draft.auditLog)) {
        draft.auditLog = [];
      }
      draft.auditLog.push(auditRecord);
      if (draft.auditLog.length > 1000) {
        draft.auditLog = draft.auditLog.slice(-1000);
      }
      return auditRecord;
    });
  }

  listAuditLogs(filters = {}) {
    let logs = Array.isArray(this.data.auditLog) ? [...this.data.auditLog] : [];

    if (filters.action) {
      logs = logs.filter(l => l.action.toLowerCase() === filters.action.toLowerCase());
    }
    if (filters.targetType) {
      logs = logs.filter(l => l.targetType.toLowerCase() === filters.targetType.toLowerCase());
    }
    if (filters.targetId) {
      logs = logs.filter(l => l.targetId === filters.targetId);
    }
    if (filters.actor) {
      logs = logs.filter(l => l.actor.toLowerCase() === filters.actor.toLowerCase());
    }
    if (filters.mode) {
      logs = logs.filter(l => l.mode.toUpperCase() === filters.mode.toUpperCase());
    }

    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const limit = filters.limit ? Math.min(Math.max(1, parseInt(filters.limit, 10)), 100) : 50;
    return logs.slice(0, limit);
  }

  async resetToSample() {
    const seed = getSampleData();
    seed.meta = { version: 1, initializedAt: new Date().toISOString() };
    seed.auditLog = [];
    const serialized = JSON.stringify(seed);
    await this._command(['SET', this.storeKey, serialized]);
    this.data = seed;
  }
}
