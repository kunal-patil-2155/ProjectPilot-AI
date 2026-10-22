/**
 * ProjectPilot AI - MCP Server Implementation
 * Implements the 11 mandatory MCP tools using @modelcontextprotocol/sdk.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { HealthService } from '../services/healthService.js';
import { PriorityService } from '../services/priorityService.js';
import { MaintenanceService } from '../services/maintenanceService.js';
import { generateRescuePlan } from '../services/rescueService.js';
import { GitHubService } from '../services/githubService.js';

/**
 * Creates and configures an McpServer instance with all tools.
 * @param {import('../db/store.js').ProjectStore} store
 * @param {Object} [options]
 */
export function createProjectPilotMcpServer(store, options = {}) {
  const healthService = new HealthService(store);
  const priorityService = new PriorityService(store);
  const maintenanceService = new MaintenanceService(store);
  const githubService = options.githubService || new GitHubService();

  const server = new McpServer({
    name: 'projectpilot-mcp',
    version: '1.0.0'
  });

  // 1. list_projects
  server.tool(
    'list_projects',
    'List all software projects with optional filtering by status, category, or priority.',
    {
      status: z.enum(['planning', 'active', 'paused', 'completed']).optional().describe('Filter by status'),
      category: z.string().optional().describe('Filter by category'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Filter by priority')
    },
    async (args) => {
      try {
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

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ count: enriched.length, projects: enriched }, null, 2)
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error listing projects: ${err.message}` }]
        };
      }
    }
  );

  // 2. get_project_details
  server.tool(
    'get_project_details',
    'Retrieve comprehensive project details including all associated tasks, active blockers, and derived health metrics.',
    {
      projectId: z.string().describe('Unique identifier of the project to retrieve')
    },
    async (args) => {
      try {
        const project = store.getProject(args.projectId);
        if (!project) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Project with ID "${args.projectId}" was not found.` }]
          };
        }

        const health = healthService.getHealth(args.projectId);
        const blockers = store.listBlockers(args.projectId);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              project,
              health,
              blockers
            }, null, 2)
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error retrieving project details: ${err.message}` }]
        };
      }
    }
  );

  // 3. create_project
  server.tool(
    'create_project',
    'Create and persist a new software project with metadata and tech stack.',
    {
      name: z.string().min(1).describe('Project name'),
      description: z.string().optional().describe('Project mission and purpose'),
      category: z.string().optional().describe('Category (e.g. Fullstack, Backend, Mobile, DevOps, AI/ML)'),
      techStack: z.array(z.string()).optional().describe('List of technologies and frameworks'),
      repoUrl: z.string().optional().describe('Version control repository URL'),
      status: z.enum(['planning', 'active', 'paused', 'completed']).optional().describe('Initial status (default: active)'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Priority tier (default: medium)')
    },
    async (args) => {
      try {
        const created = await store.createProject(args);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              message: `Project "${created.name}" created successfully.`,
              project: created
            }, null, 2)
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to create project: ${err.message}` }]
        };
      }
    }
  );

  // 4. update_project
  server.tool(
    'update_project',
    'Update an existing project details, status, or priority.',
    {
      projectId: z.string().describe('Project identifier'),
      name: z.string().min(1).optional().describe('New project name'),
      description: z.string().optional().describe('New description'),
      category: z.string().optional().describe('New category'),
      techStack: z.array(z.string()).optional().describe('New tech stack list'),
      repoUrl: z.string().optional().describe('New repository URL'),
      status: z.enum(['planning', 'active', 'paused', 'completed']).optional().describe('New project status'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('New priority tier')
    },
    async (args) => {
      try {
        const { projectId, ...updates } = args;
        const updated = await store.updateProject(projectId, updates);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              message: `Project "${updated.name}" updated successfully.`,
              project: updated
            }, null, 2)
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to update project: ${err.message}` }]
        };
      }
    }
  );

  // 5. list_tasks
  server.tool(
    'list_tasks',
    'List tasks across all projects or for a specific project, with optional filters.',
    {
      projectId: z.string().optional().describe('Filter by specific project ID'),
      status: z.enum(['todo', 'in_progress', 'blocked', 'done']).optional().describe('Filter by status'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Filter by priority'),
      isMaintenance: z.boolean().optional().describe('Filter maintenance tasks'),
      isBug: z.boolean().optional().describe('Filter bug reports')
    },
    async (args) => {
      try {
        const tasks = store.listTasks(args);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ count: tasks.length, tasks }, null, 2)
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to list tasks: ${err.message}` }]
        };
      }
    }
  );

  // 6. create_task
  server.tool(
    'create_task',
    'Create and persist a new task associated with an existing project.',
    {
      projectId: z.string().describe('ID of the project to which this task belongs'),
      title: z.string().min(1).describe('Task title'),
      description: z.string().optional().describe('Detailed task requirements'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Priority tier'),
      status: z.enum(['todo', 'in_progress', 'blocked', 'done']).optional().describe('Initial status'),
      dueDate: z.string().optional().describe('Due date in ISO format (YYYY-MM-DD)'),
      blocker: z.string().optional().describe('Details of blocker if status is blocked'),
      isMaintenance: z.boolean().optional().describe('True if this is a recurring maintenance task'),
      isBug: z.boolean().optional().describe('True if this task tracks a user-recorded bug')
    },
    async (args) => {
      try {
        const created = await store.createTask(args);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              message: `Task "${created.title}" created successfully.`,
              task: created
            }, null, 2)
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to create task: ${err.message}` }]
        };
      }
    }
  );

  // 7. update_task_status
  server.tool(
    'update_task_status',
    'Update task status (todo, in_progress, blocked, done) and record or clear blocker information.',
    {
      taskId: z.string().describe('ID of the task to update'),
      status: z.enum(['todo', 'in_progress', 'blocked', 'done']).describe('New status'),
      blockerReason: z.string().nullable().optional().describe('Explanation of blocker if status is blocked')
    },
    async (args) => {
      try {
        const updated = await store.updateTaskStatus(args.taskId, args.status, args.blockerReason);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              message: `Task "${updated.title}" status changed to ${updated.status}.`,
              task: updated
            }, null, 2)
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to update task status: ${err.message}` }]
        };
      }
    }
  );

  // 8. list_blockers
  server.tool(
    'list_blockers',
    'List all active blockers across projects or for a specific project.',
    {
      projectId: z.string().optional().describe('Optional project ID to filter blockers')
    },
    async (args) => {
      try {
        const blockers = store.listBlockers(args.projectId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              blockerCount: blockers.length,
              blockers
            }, null, 2)
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to list blockers: ${err.message}` }]
        };
      }
    }
  );

  // 9. get_project_health
  server.tool(
    'get_project_health',
    'Derive transparent project health information from persisted records (bugs, blockers, incomplete work).',
    {
      projectId: z.string().optional().describe('Optional project ID to assess single project; omit for all projects')
    },
    async (args) => {
      try {
        const health = healthService.getHealth(args.projectId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(health, null, 2)
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to get project health: ${err.message}` }]
        };
      }
    }
  );

  // 10. get_priority_recommendations
  server.tool(
    'get_priority_recommendations',
    'Compute transparent priority recommendations for pending tasks with explicit reasoning.',
    {
      projectId: z.string().optional().describe('Filter recommendations to a specific project'),
      limit: z.number().int().min(1).max(20).optional().describe('Maximum recommendations to return (default 5)')
    },
    async (args) => {
      try {
        const recs = priorityService.getRecommendations(args);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(recs, null, 2)
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to get recommendations: ${err.message}` }]
        };
      }
    }
  );

  // 11. list_maintenance_tasks
  server.tool(
    'list_maintenance_tasks',
    'List project maintenance tasks categorized by overdue status, upcoming deadlines, and completions.',
    {
      projectId: z.string().optional().describe('Filter maintenance tasks by project ID'),
      includeCompleted: z.boolean().optional().describe('Include completed maintenance tasks')
    },
    async (args) => {
      try {
        const maintenance = maintenanceService.getMaintenanceSummary(args);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(maintenance, null, 2)
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to list maintenance tasks: ${err.message}` }]
        };
      }
    }
  );

  // 12. generate_rescue_plan
  server.tool(
    'generate_rescue_plan',
    'Synthesize a deterministic, evidence-based project rescue plan with supported remediation actions and health projections.',
    {
      projectId: z.string().optional().describe('Unique identifier or name of the project to generate a rescue plan for'),
      projectName: z.string().optional().describe('Project name (optional alternative to projectId)')
    },
    async (args) => {
      try {
        const identifier = (args.projectId || args.projectName || '').trim();
        if (!identifier) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'Project identifier is required (provide projectId or projectName).' }]
          };
        }

        let project = null;

        // 1. Direct ID lookup
        const byId = store.getProject(identifier);
        if (byId) {
          project = byId;
        } else {
          // 2. Name-based lookup across all projects
          const allProjects = store.listProjects();
          const searchLower = identifier.toLowerCase();

          // A. Exact case-insensitive name match
          const exactMatches = allProjects.filter(p => p.name && p.name.trim().toLowerCase() === searchLower);

          if (exactMatches.length === 1) {
            project = store.getProject(exactMatches[0].id);
          } else if (exactMatches.length > 1) {
            return {
              isError: true,
              content: [{
                type: 'text',
                text: `Ambiguous project name "${identifier}": matches ${exactMatches.length} projects (${exactMatches.map(p => `${p.name} [${p.id}]`).join(', ')}). Please specify the unique projectId.`
              }]
            };
          } else {
            // B. Substring / partial match if no exact match
            const partialMatches = allProjects.filter(p => p.name && p.name.toLowerCase().includes(searchLower));
            if (partialMatches.length === 1) {
              project = store.getProject(partialMatches[0].id);
            } else if (partialMatches.length > 1) {
              return {
                isError: true,
                content: [{
                  type: 'text',
                  text: `Ambiguous project name "${identifier}": matches ${partialMatches.length} projects (${partialMatches.map(p => `${p.name} [${p.id}]`).join(', ')}). Please specify the unique projectId.`
                }]
              };
            }
          }
        }

        if (!project) {
          return {
            isError: true,
            content: [{
              type: 'text',
              text: `Project "${identifier}" was not found.`
            }]
          };
        }

        const tasks = store.listTasks({ projectId: project.id });
        const health = healthService.getHealth(project.id);
        const plan = generateRescuePlan(project, tasks, health);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(plan, null, 2)
          }]
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to generate rescue plan: ${err.message}` }]
        };
      }
    }
  );

  // Extend with advanced project operations tools (Groups A-G) when extended mode is enabled
  const enableExtended = options.enableExtended === true || process.env.PROJECTPILOT_EXTENDED_TOOLS === 'true';
  if (enableExtended) {
    // 13. inspect_github_repo
    server.tool(
      'inspect_github_repo',
      'Inspect a GitHub repository URL for structure, dependencies, CI/CD, and security findings.',
      {
        repoUrl: z.string().min(1).describe('Valid GitHub repository URL (https://github.com/owner/repo)'),
        branch: z.string().optional().describe('Optional branch to inspect')
      },
      async (args) => {
        try {
          const report = await githubService.inspectRepository(args.repoUrl, { branch: args.branch });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(report, null, 2)
            }]
          };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Failed to inspect repository: ${err.message}` }]
          };
        }
      }
    );

    // 14. delete_project
    server.tool(
      'delete_project',
      'Permanently delete a project and its associated tasks with explicit confirmation safeguard.',
      {
        projectId: z.string().min(1).describe('Project identifier to delete'),
        confirmDelete: z.boolean().describe('Must explicitly be true to confirm permanent deletion')
      },
      async (args) => {
        try {
          if (args.confirmDelete !== true) {
            return {
              isError: true,
              content: [{ type: 'text', text: 'Destructive operation aborted: confirmDelete must be true.' }]
            };
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
            content: [{
              type: 'text',
              text: JSON.stringify({
                message: `Project "${result.deletedProject.name}" and ${result.deletedTaskCount} tasks deleted.`,
                deletedProjectId: args.projectId,
                deletedTaskCount: result.deletedTaskCount
              }, null, 2)
            }]
          };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Failed to delete project: ${err.message}` }]
          };
        }
      }
    );

    // 15. reopen_task
    server.tool(
      'reopen_task',
      'Reopen a previously completed or blocked task back to active status (todo or in_progress).',
      {
        taskId: z.string().describe('ID of the task to reopen'),
        targetStatus: z.enum(['todo', 'in_progress']).optional().describe('Status to reopen to (default: todo)')
      },
      async (args) => {
        try {
          const updated = await store.reopenTask(args.taskId, args.targetStatus || 'todo');
          await store.recordAudit({
            action: 'reopen_task',
            actor: 'assistant',
            mode: 'AUTOPILOT',
            targetType: 'task',
            targetId: updated.id,
            details: { reopenedTo: updated.status }
          });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                message: `Task "${updated.title}" reopened to ${updated.status}.`,
                task: updated
              }, null, 2)
            }]
          };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Failed to reopen task: ${err.message}` }]
          };
        }
      }
    );

    // 16. delete_task
    server.tool(
      'delete_task',
      'Delete a task with explicit confirmation.',
      {
        taskId: z.string().describe('ID of the task to delete'),
        confirmDelete: z.boolean().describe('Must explicitly be true to confirm deletion')
      },
      async (args) => {
        try {
          if (args.confirmDelete !== true) {
            return {
              isError: true,
              content: [{ type: 'text', text: 'Destructive operation aborted: confirmDelete must be true.' }]
            };
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
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                message: `Task "${result.deletedTask.title}" was deleted.`,
                deletedTaskId: args.taskId
              }, null, 2)
            }]
          };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Failed to delete task: ${err.message}` }]
          };
        }
      }
    );

    // 17. manage_blocker
    server.tool(
      'manage_blocker',
      'Record an explicit blocker on a task or resolve an existing blocker.',
      {
        taskId: z.string().describe('Target task identifier'),
        action: z.enum(['block', 'resolve']).describe('Action: block or resolve'),
        blockerReason: z.string().optional().describe('Explanation of blocker (required when action is block)'),
        newStatus: z.enum(['in_progress', 'done']).optional().describe('Target status upon resolution (default: in_progress)')
      },
      async (args) => {
        try {
          if (args.action === 'block') {
            if (!args.blockerReason || !args.blockerReason.trim()) {
              return {
                isError: true,
                content: [{ type: 'text', text: 'blockerReason is required when action is block.' }]
              };
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
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  message: `Task "${updated.title}" marked as blocked.`,
                  task: updated
                }, null, 2)
              }]
            };
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
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  message: `Blocker on "${updated.title}" resolved.`,
                  task: updated
                }, null, 2)
              }]
            };
          }
        } catch (err) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Failed to manage blocker: ${err.message}` }]
          };
        }
      }
    );

    // 18. get_audit_log
    server.tool(
      'get_audit_log',
      'Retrieve structured audit trail events for agent mutations, approvals, and compliance verification.',
      {
        action: z.string().optional().describe('Filter by action type'),
        targetType: z.string().optional().describe('Filter by target type (project, task)'),
        targetId: z.string().optional().describe('Filter by target ID'),
        actor: z.string().optional().describe('Filter by actor (user, assistant)'),
        limit: z.number().int().min(1).max(100).optional().describe('Number of records to retrieve (default: 50)')
      },
      async (args) => {
        try {
          const logs = store.listAuditLogs(args);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ count: logs.length, auditLogs: logs }, null, 2)
            }]
          };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Failed to get audit log: ${err.message}` }]
          };
        }
      }
    );
  }

  return server;
}
