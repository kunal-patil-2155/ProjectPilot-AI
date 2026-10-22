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

/**
 * Creates and configures an McpServer instance with all 11 tools.
 * @param {import('../db/store.js').ProjectStore} store
 */
export function createProjectPilotMcpServer(store) {
  const healthService = new HealthService(store);
  const priorityService = new PriorityService(store);
  const maintenanceService = new MaintenanceService(store);

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

  return server;
}
