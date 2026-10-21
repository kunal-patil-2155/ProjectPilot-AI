/**
 * ProjectPilot AI - Conversational Assistant Orchestration Layer
 * Converts developer natural language requests into deterministic MCP tool calls,
 * verifies stored state, and formats transparent Alexa+-style responses.
 */

export const GENERIC_PROJECT_WORDS = new Set([
  'app', 'apps', 'project', 'projects', 'system', 'systems',
  'management', 'service', 'services', 'tool', 'tools', 'platform',
  'the', 'a', 'an', 'my', 'our', 'this', 'and', 'or', 'for', 'of', 'in', 'on', 'to'
]);

/**
 * Normalizes text for intent routing by trimming and stripping polite prefixes.
 */
export function normalizeIntentText(rawText) {
  if (!rawText) return '';
  return rawText
    .trim()
    .toLowerCase()
    .replace(/[?.!,;:]+$/, '')
    .replace(/^(?:can\s+you\s+|could\s+you\s+|please\s+|kindly\s+)/i, '')
    .trim();
}

/**
 * Normalizes a project name or query string for punctuation-insensitive matching.
 * Collapses dashes, quotes, colons, slashes, and whitespace.
 */
export function normalizeForComparison(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212\-_/\\:;,."'`()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks whether an incoming text intends a project investigation.
 */
export function isProjectInvestigationIntent(text) {
  const norm = normalizeIntentText(text);
  if (!norm) return false;

  return (
    norm.startsWith('inspect') ||
    norm.startsWith('investigate') ||
    norm.startsWith('audit') ||
    norm.startsWith('examine') ||
    norm.startsWith('check ') ||
    norm === 'check' ||
    norm.startsWith('show me') ||
    norm.startsWith('show the health') ||
    norm.startsWith('show health') ||
    norm.startsWith('show the status') ||
    norm.startsWith('show status') ||
    norm.startsWith('show project') ||
    norm.startsWith('show the project') ||
    norm.startsWith('what is the health') ||
    norm.startsWith("what's the health") ||
    norm.startsWith('what is the status') ||
    norm.startsWith("what's the status") ||
    norm.startsWith('what is status') ||
    norm.startsWith('what is health') ||
    norm.startsWith('what is project') ||
    norm.startsWith("what's project") ||
    norm.startsWith('what is the project') ||
    norm.startsWith("what's the project") ||
    norm.startsWith('how is') ||
    norm.startsWith('give me details') ||
    norm.startsWith('tell me about') ||
    norm.startsWith('details about') ||
    norm.startsWith('details on') ||
    norm.startsWith('details of') ||
    norm.startsWith('status of') ||
    norm.startsWith('health of') ||
    norm.includes('project status') ||
    norm.includes('project health') ||
    norm.includes('health of project') ||
    norm.includes('status of project')
  );
}

/**
 * Robustly extracts the target project name from a conversational command.
 */
export function extractProjectQuery(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let text = rawText.trim();
  // Strip trailing punctuation
  text = text.replace(/[?.!,;:]+$/, '').trim();
  // Strip leading conversational polite words
  text = text.replace(/^(?:can\s+you\s+|could\s+you\s+|please\s+|kindly\s+)/i, '').trim();
  // Strip trailing polite/filler words
  text = text.replace(/\s+(doing|please|now)$/i, '').trim();

  // If input is purely a command or command + filler (e.g. "investigate project", "inspect the project")
  const strippedCommandOnly = text.replace(
    /^(?:investigate|inspect|check(?:\s+out)?|show(?:\s+me)?|what\s+is|what's|how\s+is|tell\s+me\s+about|give\s+me(?:\s+the)?\s+details(?:\s+about|\s+on|\s+for|\s+of)?|details|status|health)\s+(?:the\s+|my\s+|our\s+|this\s+)?(?:project)?$/i,
    ''
  ).trim();
  if (!strippedCommandOnly) {
    return '';
  }

  const patterns = [
    /^(?:what\s+is|what's)\s+(?:the\s+)?(?:health|status|details)\s+(?:of|for|about|on)\s+(?:the\s+|my\s+|our\s+|this\s+)?(?:project\s+)?(.+)$/i,
    /^(?:what\s+is|what's)\s+(?:the\s+|my\s+|our\s+|this\s+)?(?:project\s+)?(.+?)(?:\s+(?:status|health|details))?$/i,
    /^how\s+is\s+(?:the\s+|my\s+|our\s+|this\s+)?(?:project\s+)?(.+?)(?:\s+doing)?$/i,
    /^give\s+me\s+(?:the\s+)?details\s+(?:about|on|for|of)\s+(?:the\s+|my\s+|our\s+|this\s+)?(?:project\s+)?(.+)$/i,
    /^tell\s+me\s+about\s+(?:the\s+|my\s+|our\s+|this\s+)?(?:project\s+)?(.+)$/i,
    /^show(?:\s+me)?\s+(?:the\s+)?(?:health|status|details)\s+(?:of|for|about|on)\s+(?:the\s+|my\s+|our\s+|this\s+)?(?:project\s+)?(.+)$/i,
    /^show(?:\s+me)?\s+(?:the\s+|my\s+|our\s+|this\s+)?(?:project\s+)(.+)$/i,
    /^show\s+me\s+(.+)$/i,
    /^(?:investigate|inspect|audit|examine)\s+(?:the\s+|my\s+|our\s+|this\s+)?(?:project\s+)?(.+)$/i,
    /^check(?:\s+out)?\s+(?:the\s+|my\s+|our\s+|this\s+)?(?:project\s+)?(.+)$/i,
    /^(?:details|status|health)\s+(?:of|about|for|on)\s+(?:the\s+|my\s+|our\s+|this\s+)?(?:project\s+)?(.+)$/i,
    /^project\s+(.+)$/i
  ];

  for (const pat of patterns) {
    const match = text.match(pat);
    if (match && match[1] && match[1].trim()) {
      return match[1].trim();
    }
  }

  return text;
}

/**
 * Deterministically resolves a project from live project data according to strict priority order:
 * 1. Exact project ID
 * 2. Exact project name
 * 3. Normalized project-name match (ignoring harmless punctuation/dashes)
 * 4. Unique, meaningful project-name match
 * 5. Category matching
 */
export function resolveProject(rawText, projects) {
  if (!rawText || !projects || projects.length === 0) {
    return { status: 'empty', candidates: [] };
  }

  const cleanedRaw = rawText.trim().replace(/[?.!,;:]+$/, '').trim();
  const extracted = extractProjectQuery(rawText);

  // If candidate is empty after extraction
  if (!extracted) {
    return { status: 'empty', candidates: [] };
  }

  // Candidate queries to evaluate
  const candidateQueries = [extracted];
  const trimmedSuffix = extracted.replace(/\s+(project|health|status)$/i, '').trim();
  if (trimmedSuffix && trimmedSuffix !== extracted && !candidateQueries.includes(trimmedSuffix)) {
    candidateQueries.push(trimmedSuffix);
  }
  if (cleanedRaw !== extracted && !candidateQueries.includes(cleanedRaw)) {
    candidateQueries.push(cleanedRaw);
  }

  const normalizedRaw = normalizeForComparison(cleanedRaw);

  // ==========================================
  // Priority 1: Exact project ID
  // ==========================================
  for (const q of candidateQueries) {
    const idMatches = projects.filter(p => p.id.toLowerCase() === q.toLowerCase());
    if (idMatches.length === 1) {
      return { status: 'matched', project: idMatches[0], matchedBy: 'exact_id' };
    }
    if (idMatches.length > 1) {
      return { status: 'ambiguous', candidates: idMatches, matchedBy: 'exact_id' };
    }
  }

  // ==========================================
  // Priority 2: Exact project name (case-insensitive & trimmed)
  // ==========================================
  for (const q of candidateQueries) {
    const exactNameMatches = projects.filter(p => p.name.trim().toLowerCase() === q.trim().toLowerCase());
    if (exactNameMatches.length === 1) {
      return { status: 'matched', project: exactNameMatches[0], matchedBy: 'exact_name' };
    }
    if (exactNameMatches.length > 1) {
      return { status: 'ambiguous', candidates: exactNameMatches, matchedBy: 'exact_name' };
    }
  }

  // Check if an exact project name is embedded in cleanedRaw (as full phrase)
  const embeddedExactMatches = projects.filter(p => {
    const pName = p.name.trim().toLowerCase();
    return pName.length >= 3 && cleanedRaw.toLowerCase().includes(pName);
  });
  if (embeddedExactMatches.length === 1) {
    return { status: 'matched', project: embeddedExactMatches[0], matchedBy: 'embedded_exact_name' };
  }
  if (embeddedExactMatches.length > 1) {
    // Check if one candidate's name is an exact match to extracted
    const exactExtracted = embeddedExactMatches.find(p => p.name.toLowerCase() === extracted.toLowerCase());
    if (exactExtracted) {
      return { status: 'matched', project: exactExtracted, matchedBy: 'exact_name' };
    }
    return { status: 'ambiguous', candidates: embeddedExactMatches, matchedBy: 'embedded_exact_name' };
  }

  // ==========================================
  // Priority 3: Normalized project-name match (ignoring harmless punctuation/dashes)
  // ==========================================
  for (const q of candidateQueries) {
    const normQ = normalizeForComparison(q);
    if (!normQ) continue;
    const normMatches = projects.filter(p => normalizeForComparison(p.name) === normQ);
    if (normMatches.length === 1) {
      return { status: 'matched', project: normMatches[0], matchedBy: 'normalized_name' };
    }
    if (normMatches.length > 1) {
      return { status: 'ambiguous', candidates: normMatches, matchedBy: 'normalized_name' };
    }
  }

  // Embedded normalized match
  const embeddedNormMatches = projects.filter(p => {
    const normP = normalizeForComparison(p.name);
    return normP.length >= 3 && (normalizedRaw === normP || normalizedRaw.includes(normP));
  });
  if (embeddedNormMatches.length === 1) {
    return { status: 'matched', project: embeddedNormMatches[0], matchedBy: 'embedded_normalized_name' };
  }
  if (embeddedNormMatches.length > 1) {
    return { status: 'ambiguous', candidates: embeddedNormMatches, matchedBy: 'embedded_normalized_name' };
  }

  // ==========================================
  // Priority 4: Unique, meaningful project-name match
  // ==========================================
  const queryTokens = normalizeForComparison(extracted).split(/\s+/).filter(Boolean);
  const meaningfulTokens = queryTokens.filter(t => !GENERIC_PROJECT_WORDS.has(t) && t.length >= 2);

  if (meaningfulTokens.length > 0) {
    const meaningfulMatches = projects.filter(p => {
      const pNorm = normalizeForComparison(p.name);
      const pTokens = new Set(pNorm.split(/\s+/));
      if (pNorm.includes(normalizeForComparison(extracted))) return true;
      return meaningfulTokens.every(tok => pTokens.has(tok) || pNorm.includes(tok));
    });

    if (meaningfulMatches.length === 1) {
      return { status: 'matched', project: meaningfulMatches[0], matchedBy: 'meaningful_tokens' };
    }
    if (meaningfulMatches.length > 1) {
      return { status: 'ambiguous', candidates: meaningfulMatches, matchedBy: 'meaningful_tokens' };
    }
  }

  // ==========================================
  // Priority 5: Category matching (only if genuinely refers to a category)
  // ==========================================
  const categoryMatches = projects.filter(p => {
    const catNorm = normalizeForComparison(p.category);
    const qNorm = normalizeForComparison(extracted);
    return catNorm && qNorm && (catNorm === qNorm || qNorm === `category ${catNorm}`);
  });
  if (categoryMatches.length === 1) {
    return { status: 'matched', project: categoryMatches[0], matchedBy: 'category' };
  }
  if (categoryMatches.length > 1) {
    return { status: 'ambiguous', candidates: categoryMatches, matchedBy: 'category' };
  }

  // No match
  return { status: 'not_found', query: extracted, candidates: [] };
}

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
    // Workflow 3: Complete a task (evaluated before project investigation)
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
    // Workflow 4: Remaining work (evaluated before project investigation)
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
    // Workflow 5: Maintenance review (evaluated before project investigation)
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
    // Workflow 2: Project investigation
    // -------------------------------------------------------------
    if (isProjectInvestigationIntent(text)) {
      return this._workflowProjectInvestigation(text);
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

    // Step 1: Always retrieve live projects from the real MCP tool
    const projectsRes = await this.mcpClient.callTool('list_projects', {});
    toolCalls.push({
      name: 'list_projects',
      args: {},
      result: projectsRes.data
    });

    const projects = projectsRes.data?.projects || [];

    // Resolve project using the multi-tier deterministic matching engine
    const resolution = resolveProject(rawText, projects);

    if (resolution.status === 'empty') {
      const projectListStr = projects.length > 0
        ? projects.map(p => `• **${p.name}** (${p.category})`).join('\n')
        : 'No projects currently registered.';
      return {
        workflow: 'project_investigation',
        toolCalls,
        explanation: `Please specify a project name to investigate.\n\nAvailable projects:\n${projectListStr}`
      };
    }

    if (resolution.status === 'not_found') {
      const projectListStr = projects.length > 0
        ? projects.map(p => `• **${p.name}** (${p.category})`).join('\n')
        : 'No projects currently registered.';
      return {
        workflow: 'project_investigation',
        toolCalls,
        explanation: `I could not find any project matching "${resolution.query || rawText}".\n\nAvailable projects:\n${projectListStr}\n\nPlease select one of the projects above or specify another project name.`
      };
    }

    if (resolution.status === 'ambiguous') {
      this.pendingResolution = {
        action: 'investigate_project',
        candidates: resolution.candidates
      };
      return {
        workflow: 'project_investigation_ambiguous',
        toolCalls,
        explanation: `Multiple projects match "${extractProjectQuery(rawText) || rawText}". Which one would you like to investigate?`,
        clarificationOptions: resolution.candidates.map(p => ({
          label: `${p.name} (${p.category})`,
          action: p.id
        }))
      };
    }

    const targetProject = resolution.project;

    // Step 2: Call real MCP get_project_details tool using matched project's actual ID
    let detailsRes;
    try {
      detailsRes = await this.mcpClient.callTool('get_project_details', { projectId: targetProject.id });
      toolCalls.push({
        name: 'get_project_details',
        args: { projectId: targetProject.id },
        result: detailsRes.data
      });
    } catch (err) {
      toolCalls.push({
        name: 'get_project_details',
        args: { projectId: targetProject.id },
        error: err.message
      });
      return {
        workflow: 'project_investigation',
        toolCalls,
        explanation: `⚠️ Failed to retrieve project details for "${targetProject.name}" (${targetProject.id}): ${err.message}`
      };
    }

    const p = detailsRes.data?.project;
    if (!p) {
      return {
        workflow: 'project_investigation',
        toolCalls,
        explanation: `⚠️ No detailed record was found in the database for project "${targetProject.name}" (${targetProject.id}).`
      };
    }

    const health = detailsRes.data?.health;
    const blockers = detailsRes.data?.blockers || [];
    const metrics = health?.metrics || {};
    const evidence = health?.evidence || {};
    const completeness = evidence.dataCompleteness || { percentage: 0, rating: 'Unknown', missingFields: [], summary: 'N/A' };

    let explanation = `### Project Health & Intelligence Report: ${p.name} (${p.category || 'General'})\n`;
    explanation += `• **Project ID:** \`${p.id}\`\n\n`;

    explanation += `#### 1. Registered Metadata [Verified from project records]\n`;
    explanation += `• **Status:** ${(p.status || 'active').toUpperCase()} | **Priority:** ${(p.priority || 'medium').toUpperCase()} | **Category:** ${p.category || 'Not specified'}\n`;
    explanation += `• **Technology Stack:** ${Array.isArray(p.techStack) && p.techStack.length ? p.techStack.join(', ') : 'Not registered'}\n`;
    explanation += `• **Description:** ${p.description ? p.description : 'None registered'}\n`;
    explanation += `• **Repository:** ${p.repoUrl ? `${p.repoUrl} [Registered remote URL]` : 'None registered [Repository not connected]'}\n`;
    explanation += `• **Last Record Update:** ${p.updatedAt ? new Date(p.updatedAt).toISOString() : (p.createdAt ? new Date(p.createdAt).toISOString() : 'Not available')}\n\n`;

    explanation += `#### 2. Project Health & Derived Metrics [Calculated from registered tasks]\n`;
    explanation += `• **Derived Health:** **${health?.healthStatus || 'Unknown'}**\n`;
    if (health?.statusReasons?.length) {
      explanation += `  *Health Assessment:* ${health.statusReasons.join('; ')}\n`;
    }
    explanation += `• **Task Progress:** ${metrics.taskProgress || (metrics.totalTasks === 0 ? 'No task data' : `${metrics.completionRate}%`)}\n`;

    explanation += `\n**Task Metrics:**\n`;
    explanation += `• Total Tasks: ${metrics.totalTasks || 0} (${metrics.completedCount || 0} completed, ${metrics.completionRate || 0}% progress)\n`;
    explanation += `• Incomplete Work: ${metrics.incompleteCount || 0} task(s)\n`;
    explanation += `• Overdue Work: ${metrics.overdueCount || 0} task(s) past deadline\n`;
    explanation += `• User-Reported Bugs: ${metrics.userRecordedBugs?.length || 0}\n`;
    explanation += `• Active Blockers: ${blockers.length}\n`;
    explanation += `• Maintenance Items: ${metrics.maintenanceCount || 0} task(s)\n`;

    if (blockers.length > 0) {
      explanation += `\n**Active Blockers Detail:**\n`;
      blockers.forEach(b => {
        explanation += `  - 🛑 *${b.taskTitle}*: ${b.blockerReason}\n`;
      });
    }

    if (metrics.overdueTasks?.length > 0) {
      explanation += `\n**Overdue Work Detail:**\n`;
      metrics.overdueTasks.forEach(o => {
        explanation += `  - ⚠️ *${o.title}* (${o.priority}) - Due: ${o.dueDate} (${o.daysOverdue} day(s) overdue)\n`;
      });
    }

    explanation += `\n#### 3. Evidence Audit & Unknowns\n`;
    explanation += `• **Source Code Inspection:** [Source code not inspected] No static analysis or codebase scanner connected.\n`;
    explanation += `• **Repository Status:** ${p.repoUrl ? `[Repository registered] (${p.repoUrl}) - remote git commits and tests have not been executed.` : `[Repository not connected]`}\n`;
    explanation += `• **Test & Runtime Verification:** [Unverified] No automated test suite executed by this system.\n`;
    explanation += `• **Data Completeness:** ${completeness.percentage}% (${completeness.summary})\n`;
    if (completeness.missingFields?.length > 0) {
      explanation += `• **Missing Project Records:** ${completeness.missingFields.join(', ')}\n`;
    } else {
      explanation += `• **Missing Project Records:** None (all core metadata registered)\n`;
    }

    if (metrics.totalTasks === 0) {
      explanation += `\n> ⚠️ **[Insufficient data]** *This project has no registered tasks. A lack of recorded bugs or blockers does NOT indicate that the software is bug-free or production-ready.*`;
    } else {
      explanation += `\n> ℹ️ *Note: Health and metrics are derived strictly from user-recorded tasks. Zero recorded bugs indicates absence of logged records, not proof that the codebase is bug-free.*`;
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
        c.name.toLowerCase() === input.toLowerCase() ||
        c.name.toLowerCase().includes(input.toLowerCase())
      );
      if (match) {
        return this._workflowProjectInvestigation(`inspect project ${match.id}`);
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
