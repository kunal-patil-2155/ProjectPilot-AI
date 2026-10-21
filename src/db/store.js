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
      tasks: []
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
        this._initialized = true;
        return;
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw new Error(`Failed to read data store at ${this.filePath}: ${err.message}`);
      }
    }

    // File did not exist: seed with clean sample dataset
    this.data = getSampleData();
    await this._saveAtomic();
    this._initialized = true;
  }

  /**
   * Atomically persists current state to disk.
   */
  async _saveAtomic() {
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const tempPath = `${this.filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    const serialized = JSON.stringify(this.data, null, 2);

    await fs.promises.writeFile(tempPath, serialized, 'utf8');
    await fs.promises.rename(tempPath, this.filePath);
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
      createdAt: now,
      updatedAt: now
    };

    this.data.projects.push(newProject);
    await this._saveAtomic();
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
    const updated = { ...task, status: targetStatus, updatedAt: now };

    if (targetStatus === 'blocked') {
      updated.blocker = blockerReason ? String(blockerReason).trim() : (task.blocker || 'Unspecified blocker');
      updated.completedAt = null;
    } else if (targetStatus === 'done') {
      updated.completedAt = now;
      updated.blocker = null; // Clearing blocker upon completion
    } else {
      // todo or in_progress
      if (blockerReason === null && targetStatus !== 'blocked') {
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
   * Helper to reset to sample data (useful for test isolation).
   */
  async resetToSample() {
    this.data = getSampleData();
    await this._saveAtomic();
  }
}
