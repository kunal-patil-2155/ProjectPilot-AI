/**
 * ProjectPilot AI - Local JSON Data Store
 * Safe file handling, atomic writes, validation, and full CRUD for projects and tasks.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getSampleData } from './sampleData.js';

export const VALID_PROJECT_STATUSES = ['planning', 'active', 'paused', 'completed'];
export const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
export const VALID_TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done'];

export class ProjectStore {
  /**
   * @param {string} filePath - Path to the persistent JSON file
   */
  constructor(filePath) {
    this.filePath = filePath || path.resolve(process.cwd(), 'data', 'store.json');
    this.data = {
      meta: { version: '1.0.0', initializedAt: new Date().toISOString() },
      projects: [],
      tasks: [],
      auditLog: []
    };
    this._initialized = false;
  }

  /**
   * Initializes the store: creates dir, reads file if present, or seeds sample data.
   * Never overwrites existing user data on server restart.
   */
  async init() {
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    try {
      const content = await fs.promises.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed.projects) && Array.isArray(parsed.tasks)) {
        this.data = parsed;
        if (!Array.isArray(this.data.auditLog)) {
          this.data.auditLog = [];
        }
        this._initialized = true;
        return;
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw new Error(`Failed to read data store: ${err.message}`);
      }
    }

    // File did not exist: seed with clean sample dataset
    this.data = getSampleData();
    if (!Array.isArray(this.data.auditLog)) {
      this.data.auditLog = [];
    }
    await this._saveAtomic();
    this._initialized = true;
  }

  /**
   * Atomically persists current state to disk.
   * If newData is provided, updates memory ONLY after disk write succeeds.
   * @param {Object} [newData]
   */
  async _saveAtomic(newData = null) {
    const payload = newData || this.data;
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const tempPath = `${this.filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    const serialized = JSON.stringify(payload, null, 2);

    await fs.promises.writeFile(tempPath, serialized, 'utf8');
    await fs.promises.rename(tempPath, this.filePath);
    if (newData) {
      this.data = newData;
    }
  }

  // ==========================================
  // PROJECT OPERATIONS
  // ==========================================

  /**
   * List all projects, with optional status and category filters.
   */
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

  /**
   * Get a single project by ID with associated tasks.
   */
  getProject(id) {
    if (!id || typeof id !== 'string') {
      throw new Error('Project ID is required and must be a string.');
    }
    const project = this.data.projects.find(p => p.id === id);
    if (!project) return null;

    const tasks = this.data.tasks.filter(t => t.projectId === id);
    return { ...project, tasks };
  }

  /**
   * Create a new project with validation.
   */
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
    if (this.data.projects.some(p => p.id === id)) {
      throw new Error(`Project with ID "${id}" already exists.`);
    }

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

    const nextData = {
      ...this.data,
      projects: [...this.data.projects, newProject]
    };
    await this._saveAtomic(nextData);
    return newProject;
  }

  /**
   * Update an existing project.
   */
  async updateProject(id, updates) {
    if (!id) throw new Error('Project ID is required.');
    const index = this.data.projects.findIndex(p => p.id === id);
    if (index === -1) {
      throw new Error(`Project not found with ID "${id}".`);
    }

    const existing = this.data.projects[index];
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
    this.data.projects[index] = updated;
    await this._saveAtomic();
    return updated;
  }

  /**
   * Delete a project and its associated tasks.
   */
  async deleteProject(id) {
    if (!id) throw new Error('Project ID is required.');
    const index = this.data.projects.findIndex(p => p.id === id);
    if (index === -1) {
      throw new Error(`Project not found with ID "${id}".`);
    }

    const removedProject = this.data.projects.splice(index, 1)[0];
    // Remove associated tasks
    const initialTaskCount = this.data.tasks.length;
    this.data.tasks = this.data.tasks.filter(t => t.projectId !== id);
    const deletedTaskCount = initialTaskCount - this.data.tasks.length;

    await this._saveAtomic();
    return {
      success: true,
      deletedProject: removedProject,
      deletedTaskCount
    };
  }

  // ==========================================
  // TASK OPERATIONS
  // ==========================================

  /**
   * List tasks with optional filtering.
   */
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

  /**
   * Get single task by ID.
   */
  getTask(id) {
    if (!id) return null;
    return this.data.tasks.find(t => t.id === id) || null;
  }

  /**
   * Create a new task with validation and project reference verification.
   */
  async createTask(input) {
    if (!input || typeof input !== 'object') {
      throw new Error('Task input must be an object.');
    }

    const projectId = input.projectId;
    if (!projectId) {
      throw new Error('Project ID is required for task creation.');
    }

    const projectExists = this.data.projects.some(p => p.id === projectId);
    if (!projectExists) {
      throw new Error(`Cannot create task: Project with ID "${projectId}" does not exist.`);
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
    if (this.data.tasks.some(t => t.id === id)) {
      throw new Error(`Task with ID "${id}" already exists.`);
    }

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

    this.data.tasks.push(newTask);
    await this._saveAtomic();
    return newTask;
  }

  /**
   * Update task status, handle blocker info, and validate transitions.
   */
  async updateTaskStatus(id, newStatus, blockerReason = null) {
    if (!id) throw new Error('Task ID is required.');
    const index = this.data.tasks.findIndex(t => t.id === id);
    if (index === -1) {
      throw new Error(`Task not found with ID "${id}".`);
    }

    const task = this.data.tasks[index];
    const targetStatus = String(newStatus).toLowerCase();

    if (!VALID_TASK_STATUSES.includes(targetStatus)) {
      throw new Error(`Invalid task status "${newStatus}". Allowed: ${VALID_TASK_STATUSES.join(', ')}`);
    }

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
      updated.blocker = null; // Clearing blocker upon completion
    } else {
      // todo or in_progress: clear blocker unless a blockerReason is explicitly provided
      if (!blockerReason || blockerReason === null) {
        updated.blocker = null;
      }
      updated.completedAt = null;
    }

    this.data.tasks[index] = updated;
    await this._saveAtomic();
    return updated;
  }

  /**
   * Update arbitrary task fields.
   */
  async updateTask(id, updates) {
    if (!id) throw new Error('Task ID is required.');
    const index = this.data.tasks.findIndex(t => t.id === id);
    if (index === -1) {
      throw new Error(`Task not found with ID "${id}".`);
    }

    const task = this.data.tasks[index];
    const updated = { ...task };

    if (updates.projectId !== undefined) {
      if (!this.data.projects.some(p => p.id === updates.projectId)) {
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
    this.data.tasks[index] = updated;
    await this._saveAtomic();
    return updated;
  }

  /**
   * Delete a task.
   */
  async deleteTask(id) {
    if (!id) throw new Error('Task ID is required.');
    const index = this.data.tasks.findIndex(t => t.id === id);
    if (index === -1) {
      throw new Error(`Task not found with ID "${id}".`);
    }

    const removed = this.data.tasks.splice(index, 1)[0];
    await this._saveAtomic();
    return { success: true, deletedTask: removed };
  }

  /**
   * List all current blockers across all projects or for a specific project.
   */
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

  /**
   * Reopen a completed or blocked task back to todo/in_progress.
   */
  async reopenTask(id, targetStatus = 'todo') {
    if (!id) throw new Error('Task ID is required.');
    const index = this.data.tasks.findIndex(t => t.id === id);
    if (index === -1) {
      throw new Error(`Task not found with ID "${id}".`);
    }

    const task = this.data.tasks[index];
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

    this.data.tasks[index] = updated;
    await this._saveAtomic();
    return updated;
  }

  /**
   * Add or update an explicit blocker on a task.
   */
  async addBlocker(taskId, blockerReason, priority = null) {
    if (!taskId) throw new Error('Task ID is required.');
    if (!blockerReason || !String(blockerReason).trim()) {
      throw new Error('Blocker reason is required.');
    }

    const index = this.data.tasks.findIndex(t => t.id === taskId);
    if (index === -1) {
      throw new Error(`Task not found with ID "${taskId}".`);
    }

    const task = this.data.tasks[index];
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

    this.data.tasks[index] = updated;
    await this._saveAtomic();
    return updated;
  }

  /**
   * Resolve a blocker and return task to in_progress or done.
   */
  async resolveBlocker(taskId, newStatus = 'in_progress') {
    if (!taskId) throw new Error('Task ID is required.');
    const index = this.data.tasks.findIndex(t => t.id === taskId);
    if (index === -1) {
      throw new Error(`Task not found with ID "${taskId}".`);
    }

    const task = this.data.tasks[index];
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

    this.data.tasks[index] = updated;
    await this._saveAtomic();
    return updated;
  }

  // ==========================================
  // AUDIT LOGGING & COMPLIANCE OPERATIONS
  // ==========================================

  /**
   * Record a structured audit trail event.
   */
  async recordAudit(entry) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Audit entry must be an object.');
    }

    if (!Array.isArray(this.data.auditLog)) {
      this.data.auditLog = [];
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

    this.data.auditLog.push(auditRecord);

    // Bounded log size (max 1000 items)
    if (this.data.auditLog.length > 1000) {
      this.data.auditLog = this.data.auditLog.slice(-1000);
    }

    await this._saveAtomic();
    return auditRecord;
  }

  /**
   * Query structured audit trail with optional filters.
   */
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

    // Sort descending by timestamp
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const limit = filters.limit ? Math.min(Math.max(1, parseInt(filters.limit, 10)), 100) : 50;
    return logs.slice(0, limit);
  }

  /**
   * Helper to reset to sample data (useful for test isolation).
   */
  async resetToSample() {
    this.data = getSampleData();
    await this._saveAtomic();
  }
}

/**
 * Universal Store Factory
 * Automatically instantiates UpstashRedisStore when remote persistence is configured,
 * or ProjectStore for local JSON file storage.
 * @param {Object} options
 */
export async function createStore(options = {}) {
  const isProduction = options.isProduction !== undefined
    ? options.isProduction
    : (process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL));

  const rawUrl = options.url || options.upstashUrl || process.env.UPSTASH_REDIS_REST_URL;
  const rawToken = options.token || options.upstashToken || process.env.UPSTASH_REDIS_REST_TOKEN;
  const useRedis = options.backend === 'redis' || process.env.STORAGE_BACKEND === 'redis' || Boolean(rawUrl);

  if (useRedis) {
    if (!rawUrl || !rawToken) {
      throw new Error('Durable persistence configuration error: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required for remote storage.');
    }
    const { UpstashRedisStore } = await import('./upstashStore.js');
    const store = new UpstashRedisStore({
      url: rawUrl,
      token: rawToken,
      storeKey: options.storeKey || process.env.UPSTASH_REDIS_STORE_KEY,
      timeoutMs: options.timeoutMs,
      fetchFn: options.fetchFn
    });
    await store.init();
    return store;
  }

  if (isProduction && process.env.REQUIRE_DURABLE_STORAGE === 'true') {
    throw new Error('Durable persistence configuration error: Durable storage is required in production, but UPSTASH_REDIS_REST_URL is not configured.');
  }

  const store = new ProjectStore(options.storePath || options.filePath);
  await store.init();
  return store;
}
