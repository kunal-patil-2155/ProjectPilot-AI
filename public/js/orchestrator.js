/**
 * ProjectPilot AI - Conversational Assistant Orchestration Layer
 * Converts developer natural language requests into deterministic MCP tool calls,
 * verifies stored state, and formats transparent Alexa+-style responses.
 */

export class AssistantOrchestrator {
  /**
   * @param {import('./api/mcpClient.js').McpBrowserClient} mcpClient
   */
  constructor(mcpClient) {
    this.mcpClient = mcpClient;
    this.pendingResolution = null; // Used when clarifying ambiguous tasks/projects
  }

  /**
   * Process a conversational input and execute the appropriate MCP workflow.
   * @param {string} userText
   * @returns {Promise<{
   *   workflow: string,
   *   toolCalls: Array<{ name: string, args: any, result: any }>,
   *   explanation: string,
   *   clarificationOptions?: Array<{ label: string, action: string }>
   * }>}
   */
  async process(userText) {
    const text = (userText || '').trim();
    if (!text) {
      return {
        workflow: 'empty',
        toolCalls: [],
        explanation: 'Please provide a request or choose one of the suggested workflow prompts.'
      };
    }

    const lower = text.toLowerCase();

    // Check if we are handling an active clarification reply
    if (this.pendingResolution) {
      const resolution = this.pendingResolution;
      this.pendingResolution = null;
      return this._handleClarificationSelection(text, resolution);
    }

    // -------------------------------------------------------------
    // Workflow 1: Daily priorities
    // -------------------------------------------------------------
    if (
      lower.includes('daily priorit') ||
      lower.includes('what should i work on') ||
      lower.includes("what's my next task") ||
      lower.includes('recommendation') ||
      lower.includes('prioritize') ||
      lower.includes('top priorit')
    ) {
      return this._workflowDailyPriorities();
    }

    // -------------------------------------------------------------
    // Workflow 2: Project investigation
    // -------------------------------------------------------------
    if (
      lower.startsWith('inspect') ||
      lower.startsWith('investigate') ||
      lower.includes('how is project') ||
      lower.includes('project status') ||
      lower.includes('check project') ||
      lower.includes('health of')
    ) {
      return this._workflowProjectInvestigation(text);
    }

    // -------------------------------------------------------------
    // Workflow 3: Complete a task
    // -------------------------------------------------------------
    if (
      lower.startsWith('complete task') ||
      lower.startsWith('finish task') ||
      lower.startsWith('mark task') ||
      lower.includes('complete the task') ||
      lower.includes('mark done')
    ) {
      return this._workflowCompleteTask(text);
    }

    // -------------------------------------------------------------
    // Workflow 4: Remaining work
    // -------------------------------------------------------------
    if (
      lower.includes('remaining work') ||
      lower.includes('what is left') ||
      lower.includes("what's left") ||
      lower.includes('outstanding tasks') ||
      lower.includes('pending tasks') ||
      lower.includes('unfinished work')
    ) {
      return this._workflowRemainingWork();
    }

    // -------------------------------------------------------------
    // Workflow 5: Maintenance review
    // -------------------------------------------------------------
    if (
      lower.includes('maintenance') ||
      lower.includes('overdue') ||
      lower.includes('cert') ||
      lower.includes('rotation')
    ) {
      return this._workflowMaintenanceReview();
    }

    // -------------------------------------------------------------
    // Fallback: Unsupported or Ambiguous request
    // -------------------------------------------------------------
    return {
      workflow: 'unsupported',
      toolCalls: [],
      explanation: `I could not deterministically map "${text}" to an executable MCP workflow.
ProjectPilot AI uses a transparent intent router rather than a generative model.
You can ask me to:
1. "Show daily priorities" (Workflow 1)
2. "Investigate project <Name>" (Workflow 2)
3. "Complete task <Title/ID>" (Workflow 3)
4. "Show remaining work" (Workflow 4)
5. "Review maintenance tasks" (Workflow 5)`
    };
  }

  // =============================================================
  // WORKFLOW IMPLEMENTATIONS
  // =============================================================

  async _workflowDailyPriorities() {
    const toolCalls = [];

    // Step 1: Call get_priority_recommendations tool
    const recsRes = await this.mcpClient.callTool('get_priority_recommendations', { limit: 4 });
    toolCalls.push({
      name: 'get_priority_recommendations',
      args: { limit: 4 },
      result: recsRes.data
    });

    // Step 2: Call list_blockers to correlate
    const blockersRes = await this.mcpClient.callTool('list_blockers', {});
    toolCalls.push({
      name: 'list_blockers',
      args: {},
      result: blockersRes.data
    });

    const recs = recsRes.data?.recommendations || [];
    const blockerCount = blockersRes.data?.blockerCount || 0;

    let explanation = `Here are your calculated daily priorities based on ${recsRes.data?.evaluatedTaskCount || 0} pending tasks:\n\n`;

    if (blockerCount > 0) {
      explanation += `⚠️ **Attention:** There are **${blockerCount} active blocker(s)** in your projects that may require immediate unblocking.\n\n`;
    }

    if (recs.length === 0) {
      explanation += 'No pending tasks found. All recorded work is currently marked as done!';
    } else {
      recs.forEach((r, idx) => {
        explanation += `**${idx + 1}. [${r.priority.toUpperCase()}] ${r.title}** (Project: *${r.projectName}*)\n`;
        explanation += `   • **Score:** ${r.score} pts | **Status:** ${r.currentStatus} | **Readiness:** ${r.executionReadiness}\n`;
        explanation += `   • **Why prioritized:** ${r.reasons.join('; ')}\n\n`;
      });
    }

    return {
      workflow: 'daily_priorities',
      toolCalls,
      explanation
    };
  }

  async _workflowProjectInvestigation(rawText) {
    const toolCalls = [];

    // Step 1: Retrieve all projects to match the requested name
    const projectsRes = await this.mcpClient.callTool('list_projects', {});
    toolCalls.push({
      name: 'list_projects',
      args: {},
      result: projectsRes.data
    });

    const projects = projectsRes.data?.projects || [];

    // Extract search query by removing trigger words
    const cleanQuery = rawText
      .replace(/^(inspect|investigate|check|how is|health of|status of|project)\s+/i, '')
      .replace(/\s+(project|health|status)$/i, '')
      .trim()
      .toLowerCase();

    // Find candidate projects
    const matches = projects.filter(p =>
      p.id.toLowerCase() === cleanQuery ||
      p.name.toLowerCase().includes(cleanQuery) ||
      p.category.toLowerCase().includes(cleanQuery)
    );

    if (matches.length === 0) {
      return {
        workflow: 'project_investigation',
        toolCalls,
        explanation: `I could not find any project matching "${cleanQuery}".\nAvailable projects: ${projects.map(p => p.name).join(', ')}.`
      };
    }

    if (matches.length > 1) {
      this.pendingResolution = {
        action: 'investigate_project',
        candidates: matches
      };
      return {
        workflow: 'project_investigation_ambiguous',
        toolCalls,
        explanation: `Multiple projects match "${cleanQuery}". Which one would you like to investigate?`,
        clarificationOptions: matches.map(p => ({
          label: `${p.name} (${p.category})`,
          action: p.id
        }))
      };
    }

    const targetProject = matches[0];

    // Step 2: Call get_project_details tool
    const detailsRes = await this.mcpClient.callTool('get_project_details', { projectId: targetProject.id });
    toolCalls.push({
      name: 'get_project_details',
      args: { projectId: targetProject.id },
      result: detailsRes.data
    });

    const p = detailsRes.data?.project;
    const health = detailsRes.data?.health;
    const blockers = detailsRes.data?.blockers || [];

    let explanation = `### Project Health Report: ${p.name} (${p.category})\n`;
    explanation += `• **Status:** ${p.status.toUpperCase()} | **Priority:** ${p.priority.toUpperCase()} | **Tech Stack:** ${p.techStack.join(', ') || 'None'}\n`;
    explanation += `• **Repository:** ${p.repoUrl || 'Not specified'}\n`;
    explanation += `• **Derived Health:** **${health?.healthStatus || 'Unknown'}**\n`;
    if (health?.statusReasons?.length) {
      explanation += `  *Reasons:* ${health.statusReasons.join('; ')}\n`;
    }

    explanation += `\n**Task Metrics:**\n`;
    explanation += `• Total Tasks: ${health?.metrics?.totalTasks || 0} (${health?.metrics?.completedCount || 0} completed, ${health?.metrics?.completionRate || 0}% progress)\n`;
    explanation += `• Incomplete Work: ${health?.metrics?.incompleteCount || 0} task(s)\n`;
    explanation += `• User-Reported Bugs: ${health?.metrics?.userRecordedBugs?.length || 0}\n`;
    explanation += `• Active Blockers: ${blockers.length}\n`;

    if (blockers.length > 0) {
      explanation += `\n**Active Blockers Detail:**\n`;
      blockers.forEach(b => {
        explanation += `  - 🛑 *${b.taskTitle}*: ${b.blockerReason}\n`;
      });
    }

    return {
      workflow: 'project_investigation',
      toolCalls,
      explanation
    };
  }

  async _workflowCompleteTask(rawText) {
    const toolCalls = [];

    // Step 1: List all incomplete tasks to match target
    const tasksRes = await this.mcpClient.callTool('list_tasks', {});
    toolCalls.push({
      name: 'list_tasks',
      args: {},
      result: tasksRes.data
    });

    const allTasks = tasksRes.data?.tasks || [];
    const pendingTasks = allTasks.filter(t => t.status !== 'done');

    const cleanQuery = rawText
      .replace(/^(complete|finish|mark done|mark)\s+(task\s+)?/i, '')
      .replace(/['"]/g, '')
      .trim()
      .toLowerCase();

    // Match by exact ID first, or substring of ID/title
    let matches = pendingTasks.filter(t =>
      t.id.toLowerCase() === cleanQuery ||
      t.id.toLowerCase().includes(cleanQuery) ||
      t.title.toLowerCase().includes(cleanQuery)
    );

    // If an exact ID matches, prioritize it
    const exactIdMatch = matches.find(t => t.id.toLowerCase() === cleanQuery);
    if (exactIdMatch) {
      matches = [exactIdMatch];
    }

    if (matches.length === 0) {
      // Check if task was already done
      const alreadyDone = allTasks.find(t =>
        t.id.toLowerCase() === cleanQuery ||
        t.title.toLowerCase().includes(cleanQuery)
      );
      if (alreadyDone && alreadyDone.status === 'done') {
        return {
          workflow: 'complete_task',
          toolCalls,
          explanation: `Task "${alreadyDone.title}" (${alreadyDone.id}) is already marked as completed.`
        };
      }

      return {
        workflow: 'complete_task',
        toolCalls,
        explanation: `Could not find any pending task matching "${cleanQuery}".\nOpen tasks: ${pendingTasks.map(t => `"${t.title}"`).slice(0, 4).join(', ')}...`
      };
    }

    if (matches.length > 1) {
      this.pendingResolution = {
        action: 'complete_task',
        candidates: matches
      };
      return {
        workflow: 'complete_task_ambiguous',
        toolCalls,
        explanation: `Multiple tasks match "${cleanQuery}". Which task would you like to mark as completed?`,
        clarificationOptions: matches.map(t => ({
          label: `${t.title} (${t.id})`,
          action: t.id
        }))
      };
    }

    const target = matches[0];

    // Step 2: Call update_task_status tool
    const updateRes = await this.mcpClient.callTool('update_task_status', {
      taskId: target.id,
      status: 'done'
    });
    toolCalls.push({
      name: 'update_task_status',
      args: { taskId: target.id, status: 'done' },
      result: updateRes.data
    });

    // Step 3: Verify stored state from tool result
    const updatedTask = updateRes.data?.task;
    const verified = updatedTask && updatedTask.status === 'done';

    if (!verified) {
      return {
        workflow: 'complete_task',
        toolCalls,
        explanation: `⚠️ Verification failed: Could not confirm that task "${target.title}" was saved as 'done'.`
      };
    }

    const explanation = `✅ **Confirmed:** Task "${updatedTask.title}" (${updatedTask.id}) has been updated and verified as **DONE** in local persistence.\nCompleted at: ${new Date(updatedTask.completedAt).toLocaleString()}`;

    return {
      workflow: 'complete_task',
      toolCalls,
      explanation
    };
  }

  async _workflowRemainingWork() {
    const toolCalls = [];

    // Step 1: List all incomplete tasks
    const tasksRes = await this.mcpClient.callTool('list_tasks', {});
    toolCalls.push({
      name: 'list_tasks',
      args: {},
      result: tasksRes.data
    });

    // Step 2: List projects for grouping
    const projectsRes = await this.mcpClient.callTool('list_projects', {});
    toolCalls.push({
      name: 'list_projects',
      args: {},
      result: projectsRes.data
    });

    const tasks = tasksRes.data?.tasks || [];
    const projects = projectsRes.data?.projects || [];
    const projMap = new Map(projects.map(p => [p.id, p]));

    const outstanding = tasks.filter(t => t.status !== 'done');

    let explanation = `### Remaining Work Summary (${outstanding.length} open task${outstanding.length === 1 ? '' : 's'})\n\n`;

    if (outstanding.length === 0) {
      explanation += `🎉 Fantastic! You have zero outstanding tasks across all projects.`;
      return { workflow: 'remaining_work', toolCalls, explanation };
    }

    // Group by project
    const byProject = new Map();
    for (const t of outstanding) {
      const list = byProject.get(t.projectId) || [];
      list.push(t);
      byProject.set(t.projectId, list);
    }

    for (const [projId, pTasks] of byProject.entries()) {
      const project = projMap.get(projId);
      explanation += `**${project ? project.name : projId}** (${pTasks.length} pending):\n`;
      pTasks.forEach(t => {
        const badge = t.status === 'blocked' ? '🛑 BLOCKED' : (t.status === 'in_progress' ? '⚡ IN PROGRESS' : '⏳ TODO');
        const bugBadge = t.isBug ? ' [BUG]' : '';
        explanation += `  • [${t.priority.toUpperCase()}] ${t.title}${bugBadge} — *${badge}*\n`;
      });
      explanation += '\n';
    }

    return {
      workflow: 'remaining_work',
      toolCalls,
      explanation
    };
  }

  async _workflowMaintenanceReview() {
    const toolCalls = [];

    // Step 1: Call list_maintenance_tasks
    const maintRes = await this.mcpClient.callTool('list_maintenance_tasks', { includeCompleted: true });
    toolCalls.push({
      name: 'list_maintenance_tasks',
      args: { includeCompleted: true },
      result: maintRes.data
    });

    const categories = maintRes.data?.categories || {};
    const overdue = categories.overdue || [];
    const dueSoon = categories.dueSoon || [];
    const scheduledLater = categories.scheduledLater || [];

    let explanation = `### Maintenance Tasks Review\n`;
    explanation += `Total tracked maintenance: ${maintRes.data?.totalMaintenanceTasks || 0} (${maintRes.data?.pendingCount || 0} pending)\n\n`;

    if (overdue.length > 0) {
      explanation += `🚨 **OVERDUE MAINTENANCE (${overdue.length}):**\n`;
      overdue.forEach(m => {
        explanation += `• **${m.title}** (Project: *${m.projectName}*)\n  Due: ${new Date(m.dueDate).toLocaleDateString()} (${m.daysOverdue} day(s) overdue)\n`;
      });
      explanation += '\n';
    }

    if (dueSoon.length > 0) {
      explanation += `⚠️ **Upcoming This Week (${dueSoon.length}):**\n`;
      dueSoon.forEach(m => {
        explanation += `• **${m.title}** (Project: *${m.projectName}*)\n  Due in: ${m.daysRemaining} day(s) (${new Date(m.dueDate).toLocaleDateString()})\n`;
      });
      explanation += '\n';
    }

    if (scheduledLater.length > 0) {
      explanation += `📅 **Scheduled Later:** ${scheduledLater.length} task(s).\n\n`;
    }

    explanation += `*Notice: ${maintRes.data?.monitoringDisclaimer}*`;

    return {
      workflow: 'maintenance_review',
      toolCalls,
      explanation
    };
  }

  async _handleClarificationSelection(input, resolution) {
    if (resolution.action === 'investigate_project') {
      const match = resolution.candidates.find(c =>
        c.id.toLowerCase() === input.toLowerCase() ||
        c.name.toLowerCase().includes(input.toLowerCase())
      );
      if (match) {
        return this._workflowProjectInvestigation(`inspect project ${match.name}`);
      }
    }

    if (resolution.action === 'complete_task') {
      const match = resolution.candidates.find(c =>
        c.id.toLowerCase() === input.toLowerCase() ||
        c.title.toLowerCase().includes(input.toLowerCase())
      );
      if (match) {
        return this._workflowCompleteTask(`complete task ${match.id}`);
      }
    }

    // If input did not match any clarification candidate, route as fresh command
    return this.process(input);
  }
}
