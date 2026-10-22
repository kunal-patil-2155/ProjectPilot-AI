/**
 * ProjectPilot AI - Unified Central Tool Registry
 * Exposes all supported backend capabilities to the AI orchestration layer
 * with explicit typed schemas, permission tiers, error handling, and verification.
 * 
 * Groups:
 * A. Projects (create, get, list, update, delete)
 * B. Tasks (create, list, update_status, reopen, delete)
 * C. Blockers (list, manage)
 * D. Project Health (get_health, calculate)
 * E. Maintenance (list, overdue, schedules)
 * F. GitHub Intelligence (inspect_github_repo)
 * G. Verification & Planning (generate_rescue_plan, get_priority_recommendations, get_audit_log)
 */

import { z } from 'zod';
import { HealthService } from '../services/healthService.js';
import { PriorityService } from '../services/priorityService.js';
import { MaintenanceService } from '../services/maintenanceService.js';
import { generateRescuePlan } from '../services/rescueService.js';
import { GitHubService } from '../services/githubService.js';

export const RISK_TIERS = {
  READ: 'read',
  WRITE: 'write',
  DESTRUCTIVE: 'destructive'
};

export const CAPABILITY_GROUPS = {
  PROJECTS: 'Projects',
  TASKS: 'Tasks',
  BLOCKERS: 'Blockers',
  HEALTH: 'Project Health',
  MAINTENANCE: 'Maintenance',
  GITHUB: 'GitHub Intelligence',
  VERIFICATION: 'Verification & Planning'
};

/**
 * Definitions for all tools supported by the platform.
 */
export const TOOL_DEFINITIONS = [
  // ==========================================
  // GROUP A: PROJECTS
  // ==========================================
  {
    name: 'list_projects',
    group: CAPABILITY_GROUPS.PROJECTS,
    riskTier: RISK_TIERS.READ,
    description: 'List all software projects with optional filtering by status, category, or priority.',
    schema: z.object({
      status: z.enum(['planning', 'active', 'paused', 'completed']).optional().describe('Filter by status'),
      category: z.string().optional().describe('Filter by category'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Filter by priority')
    }),
    handler: async (store, args, { healthService }) => {
      const projects = store.listProjects(args);
      const enriched = projects.map(p => {
        const tasks = store.listTasks({ projectId: p.id });
        const completed = tasks.filter(t => t.status === 'done').length;
        const blocked = tasks.filter(t => t.status === 'blocked' || t.blocker).length;
        return {
          ...p,
          metrics: {
            totalTasks: tasks.length,
            completedTasks: completed,
            blockedTasks: blocked,
            progressPercent: tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0
          }
        };
      });
      return { count: enriched.length, projects: enriched };
    }
  },

  {
    name: 'get_project_details',
    group: CAPABILITY_GROUPS.PROJECTS,
    riskTier: RISK_TIERS.READ,
    description: 'Retrieve comprehensive project details including all associated tasks, active blockers, and derived health metrics.',
    schema: z.object({
      projectId: z.string().min(1).describe('Unique identifier of the project to retrieve')
    }),
    handler: async (store, args, { healthService }) => {
      const project = store.getProject(args.projectId);
      if (!project) {
        throw new Error(`Project with ID "${args.projectId}" was not found.`);
      }
      const health = healthService.getHealth(args.projectId);
      const blockers = store.listBlockers(args.projectId);
      return { project, health, blockers };
    }
  },

  {
    name: 'create_project',
    group: CAPABILITY_GROUPS.PROJECTS,
    riskTier: RISK_TIERS.WRITE,
    description: 'Create and persist a new software project with metadata and tech stack.',
    schema: z.object({
      name: z.string().min(1).describe('Project name'),
      description: z.string().optional().describe('Project mission and purpose'),
      category: z.string().optional().describe('Category (e.g. Fullstack, Backend, Mobile, DevOps, AI/ML)'),
      techStack: z.array(z.string()).optional().describe('List of technologies and frameworks'),
      repoUrl: z.string().optional().describe('Version control repository URL'),
      status: z.enum(['planning', 'active', 'paused', 'completed']).optional().describe('Initial status (default: active)'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Priority tier (default: medium)')
    }),
    handler: async (store, args) => {
      const created = await store.createProject(args);
      await store.recordAudit({
        action: 'create_project',
        actor: 'assistant',
        mode: 'AUTOPILOT',
        targetType: 'project',
        targetId: created.id,
        details: { name: created.name, priority: created.priority }
      });
      return { message: `Project "${created.name}" created successfully.`, project: created };
    }
  },

  {
    name: 'update_project',
    group: CAPABILITY_GROUPS.PROJECTS,
    riskTier: RISK_TIERS.WRITE,
    description: 'Update an existing project details, status, or priority.',
    schema: z.object({
      projectId: z.string().describe('Project identifier'),
      name: z.string().min(1).optional().describe('New project name'),
      description: z.string().optional().describe('New description'),
      category: z.string().optional().describe('New category'),
      techStack: z.array(z.string()).optional().describe('New tech stack list'),
      repoUrl: z.string().optional().describe('New repository URL'),
      status: z.enum(['planning', 'active', 'paused', 'completed']).optional().describe('New project status'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('New priority tier')
    }),
    handler: async (store, args) => {
      const { projectId, ...updates } = args;
      const updated = await store.updateProject(projectId, updates);
      await store.recordAudit({
        action: 'update_project',
        actor: 'assistant',
        mode: 'AUTOPILOT',
        targetType: 'project',
        targetId: updated.id,
        details: updates
      });
      return { message: `Project "${updated.name}" updated successfully.`, project: updated };
    }
  },

  {
    name: 'delete_project',
    group: CAPABILITY_GROUPS.PROJECTS,
    riskTier: RISK_TIERS.DESTRUCTIVE,
    description: 'Permanently delete a project and its associated tasks with explicit confirmation safeguard.',
    schema: z.object({
      projectId: z.string().min(1).describe('Project identifier to delete'),
      confirmDelete: z.boolean().describe('Must explicitly be true to confirm permanent deletion')
    }),
    handler: async (store, args) => {
      if (args.confirmDelete !== true) {
        throw new Error('Destructive operation aborted: confirmDelete must be explicitly set to true.');
      }
      const result = await store.deleteProject(args.projectId);
      await store.recordAudit({
        action: 'delete_project',
        actor: 'user',
        mode: 'APPROVE',
        targetType: 'project',
        targetId: args.projectId,
        details: { deletedTasks: result.deletedTaskCount, projectName: result.deletedProject.name }
      });
      return {
        message: `Project "${result.deletedProject.name}" and ${result.deletedTaskCount} associated tasks were permanently deleted.`,
        deletedProjectId: args.projectId,
        deletedTaskCount: result.deletedTaskCount
      };
    }
  },

  // ==========================================
  // GROUP B: TASKS
  // ==========================================
  {
    name: 'list_tasks',
    group: CAPABILITY_GROUPS.TASKS,
    riskTier: RISK_TIERS.READ,
    description: 'List tasks across all projects or for a specific project, with optional filters.',
    schema: z.object({
      projectId: z.string().optional().describe('Filter by specific project ID'),
      status: z.enum(['todo', 'in_progress', 'blocked', 'done']).optional().describe('Filter by status'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Filter by priority'),
      isMaintenance: z.boolean().optional().describe('Filter maintenance tasks'),
      isBug: z.boolean().optional().describe('Filter bug reports')
    }),
    handler: async (store, args) => {
      const tasks = store.listTasks(args);
      return { count: tasks.length, tasks };
    }
  },

  {
    name: 'create_task',
    group: CAPABILITY_GROUPS.TASKS,
    riskTier: RISK_TIERS.WRITE,
    description: 'Create and persist a new task associated with an existing project.',
    schema: z.object({
      projectId: z.string().describe('ID of the project to which this task belongs'),
      title: z.string().min(1).describe('Task title'),
      description: z.string().optional().describe('Detailed task requirements'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Priority tier'),
      status: z.enum(['todo', 'in_progress', 'blocked', 'done']).optional().describe('Initial status'),
      dueDate: z.string().optional().describe('Due date in ISO format (YYYY-MM-DD)'),
      blocker: z.string().optional().describe('Details of blocker if status is blocked'),
      isMaintenance: z.boolean().optional().describe('True if this is a recurring maintenance task'),
      isBug: z.boolean().optional().describe('True if this task tracks a user-recorded bug')
    }),
    handler: async (store, args) => {
      const created = await store.createTask(args);
      await store.recordAudit({
        action: 'create_task',
        actor: 'assistant',
        mode: 'AUTOPILOT',
        targetType: 'task',
        targetId: created.id,
        details: { projectId: created.projectId, title: created.title, priority: created.priority }
      });
      return { message: `Task "${created.title}" created successfully.`, task: created };
    }
  },

  {
    name: 'update_task_status',
    group: CAPABILITY_GROUPS.TASKS,
    riskTier: RISK_TIERS.WRITE,
    description: 'Update task status (todo, in_progress, blocked, done) and record or clear blocker information.',
    schema: z.object({
      taskId: z.string().describe('ID of the task to update'),
      status: z.enum(['todo', 'in_progress', 'blocked', 'done']).describe('New status'),
      blockerReason: z.string().nullable().optional().describe('Explanation of blocker if status is blocked')
    }),
    handler: async (store, args) => {
      const updated = await store.updateTaskStatus(args.taskId, args.status, args.blockerReason);
      await store.recordAudit({
        action: 'update_task_status',
        actor: 'assistant',
        mode: 'AUTOPILOT',
        targetType: 'task',
        targetId: updated.id,
        details: { newStatus: updated.status, blockerReason: args.blockerReason }
      });
      return { message: `Task "${updated.title}" status changed to ${updated.status}.`, task: updated };
    }
  },

  {
    name: 'reopen_task',
    group: CAPABILITY_GROUPS.TASKS,
    riskTier: RISK_TIERS.WRITE,
    description: 'Reopen a previously completed or blocked task back to active status (todo or in_progress).',
    schema: z.object({
      taskId: z.string().describe('ID of the task to reopen'),
      targetStatus: z.enum(['todo', 'in_progress']).optional().describe('Status to reopen to (default: todo)')
    }),
    handler: async (store, args) => {
      const updated = await store.reopenTask(args.taskId, args.targetStatus || 'todo');
      await store.recordAudit({
        action: 'reopen_task',
        actor: 'assistant',
        mode: 'AUTOPILOT',
        targetType: 'task',
        targetId: updated.id,
        details: { reopenedTo: updated.status }
      });
      return { message: `Task "${updated.title}" reopened to ${updated.status}.`, task: updated };
    }
  },

  {
    name: 'delete_task',
    group: CAPABILITY_GROUPS.TASKS,
    riskTier: RISK_TIERS.DESTRUCTIVE,
    description: 'Delete a task with explicit confirmation.',
    schema: z.object({
      taskId: z.string().describe('ID of the task to delete'),
      confirmDelete: z.boolean().describe('Must explicitly be true to confirm deletion')
    }),
    handler: async (store, args) => {
      if (args.confirmDelete !== true) {
        throw new Error('Destructive operation aborted: confirmDelete must be true.');
      }
      const result = await store.deleteTask(args.taskId);
      await store.recordAudit({
        action: 'delete_task',
        actor: 'user',
        mode: 'APPROVE',
        targetType: 'task',
        targetId: args.taskId,
        details: { taskTitle: result.deletedTask.title, projectId: result.deletedTask.projectId }
      });
      return { message: `Task "${result.deletedTask.title}" was deleted.`, deletedTaskId: args.taskId };
    }
  },

  // ==========================================
  // GROUP C: BLOCKERS
  // ==========================================
  {
    name: 'list_blockers',
    group: CAPABILITY_GROUPS.BLOCKERS,
    riskTier: RISK_TIERS.READ,
    description: 'List all active blockers across projects or for a specific project.',
    schema: z.object({
      projectId: z.string().optional().describe('Optional project ID to filter blockers')
    }),
    handler: async (store, args) => {
      const blockers = store.listBlockers(args.projectId);
      return { blockerCount: blockers.length, blockers };
    }
  },

  {
    name: 'manage_blocker',
    group: CAPABILITY_GROUPS.BLOCKERS,
    riskTier: RISK_TIERS.WRITE,
    description: 'Record an explicit blocker on a task or resolve an existing blocker.',
    schema: z.object({
      taskId: z.string().describe('Target task identifier'),
      action: z.enum(['block', 'resolve']).describe('Action: block or resolve'),
      blockerReason: z.string().optional().describe('Explanation of blocker (required when action is block)'),
      newStatus: z.enum(['in_progress', 'done']).optional().describe('Target status upon resolution (default: in_progress)')
    }),
    handler: async (store, args) => {
      if (args.action === 'block') {
        if (!args.blockerReason || !args.blockerReason.trim()) {
          throw new Error('blockerReason is required when action is block.');
        }
        const updated = await store.addBlocker(args.taskId, args.blockerReason);
        await store.recordAudit({
          action: 'block_task',
          actor: 'assistant',
          mode: 'AUTOPILOT',
          targetType: 'task',
          targetId: args.taskId,
          details: { blockerReason: args.blockerReason }
        });
        return { message: `Task "${updated.title}" marked as blocked: ${args.blockerReason}`, task: updated };
      } else {
        const updated = await store.resolveBlocker(args.taskId, args.newStatus || 'in_progress');
        await store.recordAudit({
          action: 'resolve_blocker',
          actor: 'assistant',
          mode: 'AUTOPILOT',
          targetType: 'task',
          targetId: args.taskId,
          details: { resolvedToStatus: updated.status }
        });
        return { message: `Blocker on "${updated.title}" resolved. Task status is now ${updated.status}.`, task: updated };
      }
    }
  },

  // ==========================================
  // GROUP D: PROJECT HEALTH
  // ==========================================
  {
    name: 'get_project_health',
    group: CAPABILITY_GROUPS.HEALTH,
    riskTier: RISK_TIERS.READ,
    description: 'Derive transparent project health information from persisted records (bugs, blockers, incomplete work).',
    schema: z.object({
      projectId: z.string().optional().describe('Optional project ID to assess single project; omit for all projects')
    }),
    handler: async (store, args, { healthService }) => {
      return healthService.getHealth(args.projectId);
    }
  },

  // ==========================================
  // GROUP E: MAINTENANCE
  // ==========================================
  {
    name: 'list_maintenance_tasks',
    group: CAPABILITY_GROUPS.MAINTENANCE,
    riskTier: RISK_TIERS.READ,
    description: 'List project maintenance tasks categorized by overdue status, upcoming deadlines, and completions.',
    schema: z.object({
      projectId: z.string().optional().describe('Filter maintenance tasks by project ID'),
      includeCompleted: z.boolean().optional().describe('Include completed maintenance tasks')
    }),
    handler: async (store, args, { maintenanceService }) => {
      return maintenanceService.getMaintenanceSummary(args);
    }
  },

  // ==========================================
  // GROUP F: GITHUB INTELLIGENCE
  // ==========================================
  {
    name: 'inspect_github_repo',
    group: CAPABILITY_GROUPS.GITHUB,
    riskTier: RISK_TIERS.READ,
    description: 'Inspect a GitHub repository URL for structure, dependencies, CI/CD, and security findings.',
    schema: z.object({
      repoUrl: z.string().min(1).describe('Valid GitHub repository URL (https://github.com/owner/repo)'),
      branch: z.string().optional().describe('Optional branch to inspect (defaults to default branch)')
    }),
    handler: async (store, args, { githubService }) => {
      const service = githubService || new GitHubService();
      const report = await service.inspectRepository(args.repoUrl, { branch: args.branch });
      return report;
    }
  },

  // ==========================================
  // GROUP G: VERIFICATION & PLANNING
  // ==========================================
  {
    name: 'generate_rescue_plan',
    group: CAPABILITY_GROUPS.VERIFICATION,
    riskTier: RISK_TIERS.READ,
    description: 'Synthesize a deterministic, evidence-based project rescue plan with supported remediation actions and health projections.',
    schema: z.object({
      projectId: z.string().optional().describe('Unique identifier or name of the project to generate a rescue plan for'),
      projectName: z.string().optional().describe('Project name (optional alternative to projectId)')
    }),
    handler: async (store, args, { healthService }) => {
      const identifier = (args.projectId || args.projectName || '').trim();
      if (!identifier) {
        throw new Error('Project identifier is required (provide projectId or projectName).');
      }

      let project = store.getProject(identifier);
      if (!project) {
        const allProjects = store.listProjects();
        const searchLower = identifier.toLowerCase();
        const exactMatches = allProjects.filter(p => p.name && p.name.trim().toLowerCase() === searchLower);
        if (exactMatches.length === 1) {
          project = store.getProject(exactMatches[0].id);
        } else if (exactMatches.length > 1) {
          throw new Error(`Ambiguous project name "${identifier}": matches ${exactMatches.length} projects. Specify unique projectId.`);
        } else {
          const partialMatches = allProjects.filter(p => p.name && p.name.toLowerCase().includes(searchLower));
          if (partialMatches.length === 1) {
            project = store.getProject(partialMatches[0].id);
          } else if (partialMatches.length > 1) {
            throw new Error(`Ambiguous project name "${identifier}": matches ${partialMatches.length} projects. Specify unique projectId.`);
          }
        }
      }

      if (!project) {
        throw new Error(`Project "${identifier}" was not found.`);
      }

      const tasks = store.listTasks({ projectId: project.id });
      const health = healthService.getHealth(project.id);
      return generateRescuePlan(project, tasks, health);
    }
  },

  {
    name: 'get_priority_recommendations',
    group: CAPABILITY_GROUPS.VERIFICATION,
    riskTier: RISK_TIERS.READ,
    description: 'Compute transparent priority recommendations for pending tasks with explicit reasoning.',
    schema: z.object({
      projectId: z.string().optional().describe('Filter recommendations to a specific project'),
      limit: z.number().int().min(1).max(20).optional().describe('Maximum recommendations to return (default 5)')
    }),
    handler: async (store, args, { priorityService }) => {
      return priorityService.getRecommendations(args);
    }
  },

  {
    name: 'get_audit_log',
    group: CAPABILITY_GROUPS.VERIFICATION,
    riskTier: RISK_TIERS.READ,
    description: 'Retrieve structured audit trail events for agent mutations, approvals, and compliance verification.',
    schema: z.object({
      action: z.string().optional().describe('Filter by action type'),
      targetType: z.string().optional().describe('Filter by target type (project, task)'),
      targetId: z.string().optional().describe('Filter by target ID'),
      actor: z.string().optional().describe('Filter by actor (user, assistant)'),
      limit: z.number().int().min(1).max(100).optional().describe('Number of records to retrieve (default: 50)')
    }),
    handler: async (store, args) => {
      const logs = store.listAuditLogs(args);
      return { count: logs.length, auditLogs: logs };
    }
  }
];

/**
 * Helper to query tool definitions by name or group.
 */
export function getToolDefinition(name) {
  return TOOL_DEFINITIONS.find(t => t.name === name) || null;
}

export function getToolsByGroup(group) {
  return TOOL_DEFINITIONS.filter(t => t.group === group);
}

export function getAllToolNames() {
  return TOOL_DEFINITIONS.map(t => t.name);
}
