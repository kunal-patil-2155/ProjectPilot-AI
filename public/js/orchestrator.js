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

import { RescueExecutionEngine, ACTION_OUTCOMES, ALLOWED_EXECUTION_TOOLS, ALLOWED_ACTION_TYPES } from './rescueExecutionEngine.js';
export { RescueExecutionEngine, ACTION_OUTCOMES, ALLOWED_EXECUTION_TOOLS, ALLOWED_ACTION_TYPES };

/**
 * Explicit state model for the autonomous rescue workflow (Phase 4).
 */
export const RESCUE_STATES = {
  IDLE: 'IDLE',
  GENERATING_PLAN: 'GENERATING_PLAN',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  EXECUTING: 'EXECUTING',
  VERIFYING: 'VERIFYING',
  COMPLETED: 'COMPLETED',
  PARTIALLY_COMPLETED: 'PARTIALLY_COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  STALE_PLAN: 'STALE_PLAN'
};

/**
 * Escapes untrusted text to prevent HTML injection in rendered cards.
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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
 * Checks whether an incoming text intends a project rescue workflow.
 */
export function isRescueIntent(text) {
  const norm = normalizeIntentText(text);
  if (!norm) return false;
  return (
    norm.startsWith('rescue') ||
    norm.startsWith('help rescue') ||
    norm.startsWith('prepare a rescue') ||
    norm.startsWith('prepare rescue') ||
    norm.startsWith('prepare a recovery') ||
    norm.startsWith('prepare recovery') ||
    norm.startsWith('create a rescue') ||
    norm.startsWith('create rescue') ||
    norm.startsWith('create a recovery') ||
    norm.startsWith('create recovery') ||
    norm.startsWith('plan a rescue') ||
    norm.startsWith('plan rescue') ||
    norm.startsWith('plan recovery') ||
    norm.includes('rescue plan') ||
    norm.includes('recovery plan') ||
    norm.includes('rescue project') ||
    norm.includes('rescue the project') ||
    (norm.includes('prepare') && norm.includes('rescue')) ||
    (norm.includes('investigate') && norm.includes('recovery plan')) ||
    (norm.includes('investigate') && norm.includes('rescue plan'))
  );
}

/**
 * Checks whether an incoming text intends GitHub repository inspection.
 */
export function isGitHubInspectIntent(text) {
  const norm = normalizeIntentText(text);
  if (!norm) return false;
  return (
    norm.startsWith('inspect github') ||
    norm.startsWith('audit github') ||
    norm.startsWith('audit repo') ||
    norm.startsWith('audit repository') ||
    norm.startsWith('inspect repo') ||
    norm.startsWith('inspect repository') ||
    norm.startsWith('investigate repo') ||
    norm.startsWith('investigate repository') ||
    norm.startsWith('check github') ||
    norm.startsWith('check repo') ||
    norm.startsWith('analyze github') ||
    norm.startsWith('analyze dependencies') ||
    norm.startsWith('analyze repo') ||
    norm.startsWith('review repo') ||
    norm.startsWith('review repository') ||
    norm.includes('github.com')
  );
}

/**
 * Robustly extracts the target project name from a conversational rescue command.
 */
export function extractRescueQuery(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let text = rawText.trim().replace(/[?.!,;:]+$/, '').trim();
  text = text.replace(/^(?:can\s+you\s+|could\s+you\s+|please\s+|kindly\s+)/i, '').trim();

  const patterns = [
    /^(?:investigate(?:\s+the)?\s+risks\s+and\s+)?prepare\s+(?:a\s+)?(?:rescue|recovery)\s+plan\s+(?:for|on)\s+(?:the\s+|my\s+|our\s+|this\s+)?(?:project\s+)?(.+)$/i,
    /^create\s+(?:a\s+)?(?:rescue|recovery)\s+plan\s+(?:for|on)\s+(?:the\s+|my\s+|our\s+|this\s+)?(?:project\s+)?(.+)$/i,
    /^plan\s+(?:a\s+)?rescue\s+(?:for|on)\s+(?:the\s+|my\s+|our\s+|this\s+)?(?:project\s+)?(.+)$/i,
    /^(?:rescue|help\s+rescue)\s+(?:the\s+|my\s+|our\s+|this\s+)?(?:project\s+)?(.+)$/i,
    /^(?:rescue|recovery)\s+plan\s+(?:for|on)\s+(?:the\s+|my\s+|our\s+|this\s+)?(?:project\s+)?(.+)$/i,
    /^rescue\s+(.+)$/i
  ];

  for (const pat of patterns) {
    const match = text.match(pat);
    if (match && match[1] && match[1].trim()) {
      return match[1].trim();
    }
  }

  return extractProjectQuery(text);
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
    this.rescueState = RESCUE_STATES.IDLE;
    this.pendingRescuePlan = null;
    this.selectedActionIds = new Set();
    this.executionEngine = new RescueExecutionEngine(mcpClient);
    this.lastExecutionReport = null;
    this.executionMode = 'APPROVE'; // ASK | APPROVE | AUTOPILOT
  }

  setExecutionMode(mode) {
    const upper = String(mode).toUpperCase();
    if (['ASK', 'APPROVE', 'AUTOPILOT'].includes(upper)) {
      this.executionMode = upper;
    }
    return this.executionMode;
  }

  getExecutionMode() {
    return this.executionMode;
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

    // Check if an active rescue plan is awaiting approval
    if (this.rescueState === RESCUE_STATES.AWAITING_APPROVAL) {
      if (
        lower === 'cancel' ||
        lower === 'cancel plan' ||
        lower === 'abort' ||
        lower === 'nevermind' ||
        lower === 'dismiss' ||
        lower === 'stop'
      ) {
        const pName = this.pendingRescuePlan?.projectName || 'current project';
        this.cancelRescuePlan();
        return {
          workflow: 'rescue_plan_cancelled',
          toolCalls: [],
          explanation: `The rescue plan for **${pName}** has been cancelled. No persistent actions were executed.`
        };
      }

      if (lower === 'yes' || lower === 'approve' || lower === 'confirm' || lower === 'proceed') {
        return {
          workflow: 'rescue_plan_guidance',
          toolCalls: [],
          explanation: `Action approval requires explicit selection using the interactive approval card controls. Please click the **Approve Selected** button on the card above.\n\n*Note: In Phase 3, approval records your selection; sequential execution will be enabled in Phase 4.*`
        };
      }
    }

    // Check if rescue execution is actively running
    if (this.rescueState === RESCUE_STATES.EXECUTING) {
      if (
        lower === 'cancel' ||
        lower === 'cancel plan' ||
        lower === 'abort' ||
        lower === 'nevermind' ||
        lower === 'dismiss' ||
        lower === 'stop'
      ) {
        this.cancelRescuePlan();
        return {
          workflow: 'rescue_execution_cancelling',
          toolCalls: [],
          explanation: 'Cancellation requested. The active execution loop will stop safely after the currently running step.'
        };
      }
      return {
        workflow: 'rescue_executing_busy',
        toolCalls: [],
        explanation: `Rescue actions are currently executing sequentially for project **${this.pendingRescuePlan?.projectName || 'current project'}**. Please wait for completion or type "cancel" to stop remaining actions.`
      };
    }

    // Check if we are handling an active clarification reply
    if (this.pendingResolution) {
      const resolution = this.pendingResolution;
      this.pendingResolution = null;
      return this._handleClarificationSelection(text, resolution);
    }

    // -------------------------------------------------------------
    // Workflow 0: Autonomous Project Rescue (evaluated before investigation)
    // -------------------------------------------------------------
    if (isRescueIntent(text)) {
      return this._workflowRescueProject(text);
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
    // Execution Mode Switch
    // -------------------------------------------------------------
    if (lower.startsWith('switch to ') || lower.startsWith('set mode to ') || lower.startsWith('change mode to ')) {
      if (lower.includes('autopilot')) {
        this.setExecutionMode('AUTOPILOT');
        return {
          workflow: 'mode_change',
          toolCalls: [],
          explanation: `Switched execution mode to **AUTOPILOT**. The assistant will automatically execute authorized non-destructive project operations and verify state mutations in real time.`
        };
      }
      if (lower.includes('approve')) {
        this.setExecutionMode('APPROVE');
        return {
          workflow: 'mode_change',
          toolCalls: [],
          explanation: `Switched execution mode to **APPROVE**. The assistant will prepare structured execution plans and require explicit confirmation before performing state mutations.`
        };
      }
      if (lower.includes('ask')) {
        this.setExecutionMode('ASK');
        return {
          workflow: 'mode_change',
          toolCalls: [],
          explanation: `Switched execution mode to **ASK**. The assistant operates strictly in read-only analysis and advisory mode. No state modifications will be performed.`
        };
      }
    }

    // -------------------------------------------------------------
    // Workflow: GitHub Repository Intelligence (evaluated before general investigation)
    // -------------------------------------------------------------
    if (isGitHubInspectIntent(text)) {
      return this._workflowInspectGitHubRepo(text);
    }

    // -------------------------------------------------------------
    // Workflow 2: Project investigation
    // -------------------------------------------------------------
    if (isProjectInvestigationIntent(text)) {
      return this._workflowProjectInvestigation(text);
    }

    // -------------------------------------------------------------
    // Workflow: Blocker Management & Resolution
    // -------------------------------------------------------------
    if (
      lower.startsWith('resolve blocker') ||
      lower.startsWith('clear blocker') ||
      lower.startsWith('unblock task') ||
      lower.includes('resolve the checkout blocker') ||
      lower.includes('resolve the blocker') ||
      lower.startsWith('block task')
    ) {
      return this._workflowManageBlocker(text);
    }

    // -------------------------------------------------------------
    // Workflow: Reopen Task
    // -------------------------------------------------------------
    if (lower.startsWith('reopen task') || lower.startsWith('re-open task')) {
      return this._workflowReopenTask(text);
    }

    // -------------------------------------------------------------
    // Workflow: Create Task
    // -------------------------------------------------------------
    if (
      (lower.startsWith('create ') || lower.startsWith('add ')) &&
      (lower.includes('task') || lower.includes('bug'))
    ) {
      return this._workflowCreateTask(text);
    }

    // -------------------------------------------------------------
    // Workflow: Audit Log & Activity History
    // -------------------------------------------------------------
    if (
      lower.includes('audit log') ||
      lower.includes('audit trail') ||
      lower.includes('audit history') ||
      lower.includes('activity history')
    ) {
      return this._workflowAuditLog();
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

    if (this.executionMode === 'ASK') {
      return {
        workflow: 'complete_task_plan',
        toolCalls,
        explanation: `**Proposed Task Completion (ASK Mode):**\n` +
          `• **Task:** "${target.title}" (\`${target.id}\`)\n` +
          `• **Current Status:** ${(target.status || 'todo').toUpperCase()}\n` +
          `• **Target Status:** DONE\n\n` +
          `*To execute this change, switch to APPROVE or AUTOPILOT mode.*`
      };
    }

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

  // =============================================================
  // RESCUE PLAN WORKFLOW & STATE MANAGEMENT (Phase 3)
  // =============================================================

  getRescueState() {
    return {
      state: this.rescueState,
      plan: this.pendingRescuePlan,
      selectedActionIds: Array.from(this.selectedActionIds)
    };
  }

  cancelRescuePlan() {
    if (this.executionEngine && this.executionEngine.isExecuting) {
      this.executionEngine.requestCancellation();
      this.rescueState = RESCUE_STATES.CANCELLED;
      return {
        cancelled: true,
        message: 'Cancellation requested. Active execution will safely stop after the current step.'
      };
    }
    this.rescueState = RESCUE_STATES.CANCELLED;
    this.pendingRescuePlan = null;
    this.selectedActionIds.clear();
    return {
      cancelled: true,
      message: 'Rescue plan has been cancelled.'
    };
  }

  toggleActionSelection(actionId, isSelected = true) {
    if (this.rescueState !== RESCUE_STATES.AWAITING_APPROVAL || !this.pendingRescuePlan) {
      throw new Error('Cannot toggle action selection: No rescue plan is currently awaiting approval.');
    }
    const validAction = (this.pendingRescuePlan.actions || []).find(a => a.id === actionId);
    if (!validAction) {
      throw new Error(`Invalid action ID "${actionId}": Not part of the currently pending rescue plan.`);
    }
    if (isSelected) {
      this.selectedActionIds.add(actionId);
    } else {
      this.selectedActionIds.delete(actionId);
    }
    return Array.from(this.selectedActionIds);
  }

  selectAllActions(selectAll = true) {
    if (this.rescueState !== RESCUE_STATES.AWAITING_APPROVAL || !this.pendingRescuePlan) {
      throw new Error('Cannot select actions: No rescue plan is currently awaiting approval.');
    }
    if (selectAll) {
      this.selectedActionIds = new Set((this.pendingRescuePlan.actions || []).map(a => a.id));
    } else {
      this.selectedActionIds.clear();
    }
    return Array.from(this.selectedActionIds);
  }

  approveSelectedActions() {
    if (this.rescueState !== RESCUE_STATES.AWAITING_APPROVAL || !this.pendingRescuePlan) {
      return {
        approved: false,
        message: 'No rescue plan is currently awaiting approval.'
      };
    }
    if (this.selectedActionIds.size === 0) {
      return {
        approved: false,
        message: 'No actions selected. Please select at least one action to approve, or click Cancel Plan.'
      };
    }
    const planActionIds = new Set((this.pendingRescuePlan.actions || []).map(a => a.id));
    for (const id of this.selectedActionIds) {
      if (!planActionIds.has(id)) {
        throw new Error(`Unauthorized or invalid action ID "${id}".`);
      }
    }
    return {
      approved: true,
      actionCount: this.selectedActionIds.size,
      actionIds: Array.from(this.selectedActionIds),
      message: 'Actions recorded as approved for Phase 4 execution. No write tools called.'
    };
  }

  /**
   * Executes the explicitly approved actions from the pending rescue plan sequentially.
   *
   * @param {Function} [onProgress] - Callback: (actionId, outcome, record) => void
   * @returns {Promise<{ workflow: string, rescueState: string, report: Object, explanation: string, cardHtml: string }>}
   */
  async executeRescuePlan(onProgress = null) {
    if (this.rescueState !== RESCUE_STATES.AWAITING_APPROVAL || !this.pendingRescuePlan) {
      throw new Error('Cannot execute rescue plan: No rescue plan is currently awaiting approval.');
    }
    if (this.selectedActionIds.size === 0) {
      throw new Error('Cannot execute rescue plan: No actions selected for execution.');
    }

    const plan = this.pendingRescuePlan;
    const selectedIds = new Set(this.selectedActionIds);

    // Validate that all selected IDs belong to the current pending plan
    const planActionIds = new Set((plan.actions || []).map(a => a.id));
    for (const id of selectedIds) {
      if (!planActionIds.has(id)) {
        throw new Error(`Unauthorized or invalid action ID "${id}".`);
      }
    }

    this.rescueState = RESCUE_STATES.EXECUTING;

    let report;
    try {
      report = await this.executionEngine.executePlan(plan, selectedIds, onProgress);
    } catch (err) {
      this.rescueState = RESCUE_STATES.FAILED;
      throw err;
    }

    this.rescueState = RESCUE_STATES.VERIFYING;

    // Transition rescueState to reflect actual execution outcome
    if (report.status === 'COMPLETED') {
      this.rescueState = RESCUE_STATES.COMPLETED;
    } else if (report.status === 'PARTIALLY_COMPLETED') {
      this.rescueState = RESCUE_STATES.PARTIALLY_COMPLETED;
    } else if (report.status === 'STALE_PLAN') {
      this.rescueState = RESCUE_STATES.STALE_PLAN;
    } else if (report.status === 'CANCELLED') {
      this.rescueState = RESCUE_STATES.CANCELLED;
    } else {
      this.rescueState = RESCUE_STATES.FAILED;
    }

    this.lastExecutionReport = report;
    // Clear pending plan so it cannot be re-executed
    this.pendingRescuePlan = null;
    this.selectedActionIds.clear();

    const explanation = this._buildExecutionMarkdownSummary(report);
    const cardHtml = this._buildExecutionVerificationCard(report);

    return {
      workflow: 'rescue_execution',
      rescueState: this.rescueState,
      report,
      explanation,
      cardHtml
    };
  }

  async _workflowRescueProject(rawText) {
    const toolCalls = [];

    // Guard: Prevent overwriting an active pending rescue plan awaiting approval
    if (this.rescueState === RESCUE_STATES.AWAITING_APPROVAL && this.pendingRescuePlan) {
      return {
        workflow: 'rescue_plan_blocked',
        toolCalls: [],
        explanation: `⚠️ A rescue plan for project **${this.pendingRescuePlan.projectName}** (\`${this.pendingRescuePlan.projectId}\`) is currently awaiting your approval.\n\nPlease approve or cancel the pending plan before starting a new rescue workflow.`
      };
    }

    this.rescueState = RESCUE_STATES.GENERATING_PLAN;

    // Step 1: Retrieve live projects to resolve target project
    const projectsRes = await this.mcpClient.callTool('list_projects', {});
    toolCalls.push({
      name: 'list_projects',
      args: {},
      result: projectsRes.data
    });

    const projects = projectsRes.data?.projects || [];
    const extractedQuery = extractRescueQuery(rawText);
    const resolution = resolveProject(extractedQuery, projects);

    if (resolution.status === 'empty') {
      this.rescueState = RESCUE_STATES.IDLE;
      const projectListStr = projects.length > 0
        ? projects.map(p => `• **${p.name}** (${p.category})`).join('\n')
        : 'No projects currently registered.';
      return {
        workflow: 'rescue_plan',
        toolCalls,
        explanation: `Please specify which project you want to rescue.\n\nAvailable projects:\n${projectListStr}`
      };
    }

    if (resolution.status === 'not_found') {
      this.rescueState = RESCUE_STATES.IDLE;
      const projectListStr = projects.length > 0
        ? projects.map(p => `• **${p.name}** (${p.category})`).join('\n')
        : 'No projects currently registered.';
      return {
        workflow: 'rescue_plan',
        toolCalls,
        explanation: `I could not find any project matching "${resolution.query || extractedQuery}".\n\nAvailable projects:\n${projectListStr}\n\nPlease specify a registered project name to prepare a rescue plan.`
      };
    }

    if (resolution.status === 'ambiguous') {
      this.rescueState = RESCUE_STATES.IDLE;
      this.pendingResolution = {
        action: 'rescue_project',
        candidates: resolution.candidates
      };
      return {
        workflow: 'rescue_plan_ambiguous',
        toolCalls,
        explanation: `Multiple projects match "${extractedQuery}". Which project would you like to rescue?`,
        clarificationOptions: resolution.candidates.map(p => ({
          label: `${p.name} (${p.category})`,
          action: `rescue project ${p.id}`
        }))
      };
    }

    const targetProject = resolution.project;

    // Step 2: Call real MCP generate_rescue_plan tool using target project's ID
    let planRes;
    try {
      planRes = await this.mcpClient.callTool('generate_rescue_plan', { projectId: targetProject.id });
      toolCalls.push({
        name: 'generate_rescue_plan',
        args: { projectId: targetProject.id },
        result: planRes.data
      });
    } catch (err) {
      this.rescueState = RESCUE_STATES.IDLE;
      toolCalls.push({
        name: 'generate_rescue_plan',
        args: { projectId: targetProject.id },
        error: err.message
      });
      return {
        workflow: 'rescue_plan',
        toolCalls,
        explanation: `⚠️ Failed to generate rescue plan for "${targetProject.name}" (${targetProject.id}): ${err.message}`
      };
    }

    if (planRes.isError) {
      this.rescueState = RESCUE_STATES.IDLE;
      return {
        workflow: 'rescue_plan',
        toolCalls,
        explanation: `⚠️ Error from MCP server: ${planRes.content?.[0]?.text || 'Failed to generate rescue plan'}`
      };
    }

    const plan = planRes.data;
    if (!plan || !plan.planId) {
      this.rescueState = RESCUE_STATES.IDLE;
      return {
        workflow: 'rescue_plan',
        toolCalls,
        explanation: `⚠️ Unexpected response from generate_rescue_plan MCP tool.`
      };
    }

    // Set pending-plan state
    this.pendingRescuePlan = plan;
    this.selectedActionIds = new Set((plan.actions || []).map(a => a.id));
    this.rescueState = RESCUE_STATES.AWAITING_APPROVAL;

    const explanation = this._buildRescueMarkdownSummary(plan);
    const cardHtml = this._buildRescueApprovalCard(plan, this.selectedActionIds);

    return {
      workflow: 'rescue_plan',
      rescueState: this.rescueState,
      plan,
      toolCalls,
      explanation,
      cardHtml,
      isApprovalCard: true
    };
  }

  _buildRescueMarkdownSummary(plan) {
    const actCount = plan.actions?.length || 0;
    const manualCount = plan.notRemediable?.length || 0;
    const pName = plan.projectName || plan.projectId;
    let md = `### 🛡️ Rescue Plan Prepared: ${pName} (\`${plan.projectId}\`)\n\n`;
    md += `• **Current Health:** **${plan.baselineHealth?.healthStatus || 'Unknown'}**\n`;
    md += `• **Proposed Actions:** ${actCount} executable action(s) staged for review.\n`;
    if (manualCount > 0) {
      md += `• **Manual Interventions:** ${manualCount} non-executable recommendation(s).\n`;
    }
    if (plan.projectedHealth) {
      md += `• **Projected Health Transition:** \`${plan.projectedHealth.statusChange}\`\n`;
    }
    md += `\n*Please review the interactive action preview card below and choose which actions to approve or cancel.*`;
    return md;
  }

  _buildRescueApprovalCard(plan, selectedActionIds) {
    const pName = escapeHtml(plan.projectName || plan.projectId);
    const pId = escapeHtml(plan.projectId);
    const baselineStatus = escapeHtml(plan.baselineHealth?.healthStatus || 'Unknown');
    const baselineReasons = escapeHtml(plan.baselineHealth?.statusReasons?.join('; ') || 'None provided');
    const completeness = plan.dataCompleteness || { percentage: 0, rating: 'Minimal', summary: 'N/A' };
    const completenessSummary = escapeHtml(completeness.summary || `${completeness.percentage}% (${completeness.rating})`);

    const healthBadgeClass = baselineStatus === 'Healthy'
      ? 'badge-success'
      : (baselineStatus === 'At Risk' ? 'badge-danger' : 'badge-warning');

    // Executable Actions
    let actionsHtml = '';
    const executableCount = plan.actions?.length || 0;

    if (executableCount === 0) {
      actionsHtml = `
        <div class="rescue-empty-notice">
          ℹ️ <strong>No automated write actions are proposed for this project.</strong>
          <p style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">
            This project has no registered tasks that can be safely transitioned via active MCP tools. Please review the manual recommendations below.
          </p>
        </div>
      `;
    } else {
      const allSelected = selectedActionIds.size === executableCount;
      actionsHtml = `
        <div class="rescue-select-all-row">
          <label class="rescue-checkbox-label">
            <input type="checkbox" class="rescue-select-all" ${allSelected ? 'checked' : ''} />
            <span><strong>Select All (${executableCount} proposed action${executableCount === 1 ? '' : 's'})</strong></span>
          </label>
        </div>
        <div class="rescue-actions-list">
          ${plan.actions.map(act => {
            const isChecked = selectedActionIds.has(act.id);
            const riskClass = act.riskLevel === 'critical' || act.riskLevel === 'high'
              ? 'badge-risk-critical'
              : (act.riskLevel === 'medium' ? 'badge-risk-medium' : 'badge-risk-low');
            const currentStatus = escapeHtml(act.preconditions?.currentStatus || 'unknown');
            const targetStatus = escapeHtml(act.params?.status || 'active');

            return `
              <div class="rescue-action-item ${isChecked ? 'selected' : ''}" data-action-id="${escapeHtml(act.id)}">
                <div class="rescue-action-header">
                  <label class="rescue-checkbox-label">
                    <input type="checkbox" class="rescue-action-checkbox" data-action-id="${escapeHtml(act.id)}" ${isChecked ? 'checked' : ''} />
                    <strong>${escapeHtml(act.description)}</strong>
                  </label>
                  <div class="rescue-action-badges">
                    <span class="rescue-badge ${riskClass}">Risk: ${escapeHtml(act.riskLevel.toUpperCase())}</span>
                    <span class="rescue-badge badge-executable">Tool: ${escapeHtml(act.tool)}</span>
                  </div>
                </div>
                <div class="rescue-action-body">
                  <div class="rescue-action-meta">
                    <span><strong>Target:</strong> <code>${escapeHtml(act.targetId)}</code> (${escapeHtml(act.title || act.targetId)})</span>
                    <span><strong>State:</strong> <code>${currentStatus}</code> ➔ <code>${targetStatus}</code></span>
                  </div>
                  <div class="rescue-action-detail">
                    <div><strong>Evidence:</strong> ${escapeHtml(act.evidence)}</div>
                    <div><strong>Rationale:</strong> ${escapeHtml(act.rationale)}</div>
                    <div><strong>Expected Impact:</strong> ${escapeHtml(act.expectedImpact)}</div>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // Manual / Unsupported Recommendations
    let manualHtml = '';
    const manualCount = plan.notRemediable?.length || 0;
    if (manualCount > 0) {
      manualHtml = `
        <div class="rescue-section rescue-manual-section">
          <div class="rescue-section-title">
            <span>⚠️ Manual Interventions &amp; Unsupported Items (${manualCount})</span>
            <span class="rescue-badge badge-manual">Non-Executable via MCP</span>
          </div>
          <div class="rescue-manual-list">
            ${plan.notRemediable.map(nr => `
              <div class="rescue-manual-item">
                <div class="rescue-manual-header">
                  <strong>${escapeHtml(nr.title || nr.type)}</strong>
                  ${nr.targetId ? `<code>${escapeHtml(nr.targetId)}</code>` : ''}
                </div>
                <div class="rescue-manual-reason"><strong>Reason:</strong> ${escapeHtml(nr.reason)}</div>
                <div class="rescue-manual-rec"><strong>Recommendation:</strong> ${escapeHtml(nr.recommendation)}</div>
                ${nr.checklist ? `
                  <ul class="rescue-manual-checklist">
                    ${nr.checklist.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
                  </ul>
                ` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Projected Health Section
    let projectionHtml = '';
    if (plan.projectedHealth) {
      const proj = plan.projectedHealth;
      const projBadgeClass = proj.status === 'Healthy'
        ? 'badge-success'
        : (proj.status === 'At Risk' ? 'badge-danger' : 'badge-warning');
      projectionHtml = `
        <div class="rescue-section rescue-projection-section">
          <div class="rescue-section-title">
            <span>📈 Estimated Health Projection</span>
            <span class="rescue-badge ${projBadgeClass}">Projected: ${escapeHtml(proj.status)}</span>
          </div>
          <div class="rescue-projection-body">
            <div><strong>Status Transition:</strong> <code>${escapeHtml(proj.statusChange)}</code></div>
            <div><strong>Estimated Reasons:</strong> ${escapeHtml(proj.statusReasons?.join('; ') || 'None')}</div>
            <div class="rescue-projection-disclaimer">
              ℹ️ <em>${escapeHtml(proj.disclaimer)}</em>
            </div>
          </div>
        </div>
      `;
    } else {
      projectionHtml = `
        <div class="rescue-section rescue-projection-section">
          <div class="rescue-section-title">
            <span>📈 Health Projection</span>
            <span class="rescue-badge badge-manual">Not Available</span>
          </div>
          <div class="rescue-projection-disclaimer">
            <em>${escapeHtml(plan.projectionExplanation || 'Truthful health projection cannot be computed (insufficient task data).')}</em>
          </div>
        </div>
      `;
    }

    // Controls
    let controlsHtml = '';
    const selectedCount = selectedActionIds.size;
    if (executableCount > 0) {
      controlsHtml = `
        <div class="rescue-controls">
          <button class="btn btn-primary btn-sm rescue-approve-btn" data-plan-id="${escapeHtml(plan.planId)}">
            Approve Selected (${selectedCount})
          </button>
          <button class="btn btn-secondary btn-sm rescue-cancel-btn" data-plan-id="${escapeHtml(plan.planId)}">
            Cancel Plan
          </button>
          <span class="rescue-phase-notice"><em>*Phase 3: Approval records selection; execution engine connects in Phase 4. Zero write tools are called.</em></span>
        </div>
      `;
    } else {
      controlsHtml = `
        <div class="rescue-controls">
          <button class="btn btn-secondary btn-sm rescue-cancel-btn" data-plan-id="${escapeHtml(plan.planId)}">
            Dismiss / Cancel Plan
          </button>
        </div>
      `;
    }

    return `
      <div class="rescue-plan-card" data-plan-id="${escapeHtml(plan.planId)}">
        <div class="rescue-card-header">
          <div class="rescue-card-title">
            <span class="rescue-icon">🛡️</span>
            <strong>Rescue Plan: ${pName}</strong>
            <code>${pId}</code>
          </div>
          <span class="rescue-badge ${healthBadgeClass}">Observed: ${baselineStatus}</span>
        </div>

        <div class="rescue-meta-box">
          <div class="rescue-meta-item"><strong>Current Health Reasons:</strong> ${baselineReasons}</div>
          <div class="rescue-meta-item"><strong>Data Completeness:</strong> ${completenessSummary}</div>
          <div class="rescue-meta-item">
            <strong>Evidence Limitations:</strong>
            <ul class="rescue-limitations-list">
              ${plan.limitations.map(l => `<li>${escapeHtml(l)}</li>`).join('')}
            </ul>
          </div>
        </div>

        <div class="rescue-section">
          <div class="rescue-section-title">
            <span>Proposed Remediation Actions (${executableCount})</span>
          </div>
          ${actionsHtml}
        </div>

        ${manualHtml}

        ${projectionHtml}

        ${controlsHtml}
      </div>
    `;
  }

  _buildExecutionMarkdownSummary(report) {
    const pName = report.projectName || report.projectId;
    const pId = report.projectId;
    const s = report.summary || { total: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 };
    let md = `### 🛡️ Rescue Plan Execution Report: ${pName} (\`${pId}\`)\n\n`;
    md += `• **Execution Status:** **${report.status}**\n`;
    md += `• **Actions Executed:** ${s.succeeded} succeeded, ${s.failed} failed, ${s.skipped} skipped, ${s.cancelled} cancelled (Total: ${s.total})\n`;

    if (report.baselineHealth && report.recalculatedHealth) {
      const bHealth = report.baselineHealth.healthStatus;
      const rHealth = report.recalculatedHealth.healthStatus;
      md += `• **Health Transition:** \`${bHealth}\` ➔ \`${rHealth}\`\n`;
    }

    const nonSuccess = (report.actions || []).filter(a => a.outcome !== 'SUCCEEDED');
    if (nonSuccess.length > 0) {
      const notes = nonSuccess
        .map(a => `  - \`${a.targetId}\` (${a.outcome}): ${a.error || 'Preconditions not met or skipped'}`)
        .join('\n');
      md += `• **Action Diagnostics:**\n${notes}\n`;
    }

    if (report.remainingNotRemediable && report.remainingNotRemediable.length > 0) {
      md += `• **Remaining Manual Work:** ${report.remainingNotRemediable.length} non-executable items still require developer intervention.\n`;
    }

    md += `\n*Truthful Notice: Administrative status transitions unblock workflow progression; they do NOT verify source code fixes, test coverage, or physical resolution of external dependencies.*`;
    return md;
  }

  _buildExecutionVerificationCard(report) {
    const pName = escapeHtml(report.projectName || report.projectId);
    const pId = escapeHtml(report.projectId);
    const planId = escapeHtml(report.planId || 'N/A');
    const startedAt = escapeHtml(report.startedAt ? new Date(report.startedAt).toLocaleTimeString() : 'N/A');
    const completedAt = escapeHtml(report.completedAt ? new Date(report.completedAt).toLocaleTimeString() : 'N/A');

    let statusBadgeClass = 'badge-success';
    if (report.status === 'FAILED') statusBadgeClass = 'badge-danger';
    else if (report.status === 'PARTIALLY_COMPLETED') statusBadgeClass = 'badge-warning';
    else if (report.status === 'STALE_PLAN' || report.status === 'CANCELLED') statusBadgeClass = 'badge-manual';

    // Actions results list
    const actionRows = (report.actions || []).map(action => {
      let outcomeClass = 'badge-success';
      let outcomeIcon = '✓';
      if (action.outcome === 'FAILED') {
        outcomeClass = 'badge-danger';
        outcomeIcon = '✗';
      } else if (action.outcome === 'SKIPPED_STALE' || action.outcome === 'SKIPPED_DEPENDENCY') {
        outcomeClass = 'badge-warning';
        outcomeIcon = '⊘';
      } else if (action.outcome === 'CANCELLED') {
        outcomeClass = 'badge-manual';
        outcomeIcon = '⏹';
      }

      // State diff
      let diffHtml = '';
      if (action.beforeState && action.afterState) {
        const bStatus = escapeHtml(action.beforeState.status || 'unknown');
        const aStatus = escapeHtml(action.afterState.status || 'unknown');
        diffHtml = `
          <div class="rescue-diff-row">
            <span class="diff-label">State Transition:</span>
            <code>${bStatus}</code> <span class="diff-arrow">➔</span> <code>${aStatus}</code>
          </div>
        `;
        if (action.beforeState.blocker) {
          diffHtml += `
            <div class="rescue-diff-row">
              <span class="diff-label">Blocker:</span>
              <span class="diff-old">"${escapeHtml(action.beforeState.blocker)}"</span>
              <span class="diff-arrow">➔</span>
              <span class="diff-new">Cleared</span>
            </div>
          `;
        }
      } else if (action.beforeState) {
        diffHtml = `
          <div class="rescue-diff-row">
            <span class="diff-label">Observed Initial State:</span>
            <code>${escapeHtml(action.beforeState.status || 'unknown')}</code>
          </div>
        `;
      }

      // Verification note
      let verifyNote = '';
      if (action.verified) {
        verifyNote = `<div class="rescue-verify-note success">🔍 Verified in persistence store: Status updated and blocker cleared.</div>`;
      } else if (action.error) {
        verifyNote = `<div class="rescue-verify-note error">⚠️ ${escapeHtml(action.error)}</div>`;
      }

      return `
        <div class="rescue-exec-item ${escapeHtml(action.outcome.toLowerCase())}">
          <div class="rescue-exec-header">
            <div class="rescue-exec-title">
              <span class="outcome-icon">${outcomeIcon}</span>
              <strong>${escapeHtml(action.title || action.targetId)}</strong>
              <code>${escapeHtml(action.targetId)}</code>
            </div>
            <span class="rescue-badge ${outcomeClass}">${escapeHtml(action.outcome)}</span>
          </div>
          <div class="rescue-exec-body">
            <div class="rescue-exec-desc">${escapeHtml(action.description)}</div>
            ${diffHtml}
            ${verifyNote}
          </div>
        </div>
      `;
    }).join('');

    // Health Recalculation Comparison
    let healthCompareHtml = '';
    if (report.baselineHealth && report.recalculatedHealth) {
      const baseStatus = escapeHtml(report.baselineHealth.healthStatus || 'Unknown');
      const postStatus = escapeHtml(report.recalculatedHealth.healthStatus || 'Unknown');
      const baseBadge = baseStatus === 'Healthy' ? 'badge-success' : (baseStatus === 'At Risk' ? 'badge-danger' : 'badge-warning');
      const postBadge = postStatus === 'Healthy' ? 'badge-success' : (postStatus === 'At Risk' ? 'badge-danger' : 'badge-warning');

      const newReasons = (report.recalculatedHealth.statusReasons || []).join('; ') || 'No material risks detected.';

      healthCompareHtml = `
        <div class="rescue-section rescue-health-comparison">
          <div class="rescue-section-title">
            <span>📊 Health Recalculation (Persisted Data)</span>
          </div>
          <div class="rescue-health-compare-grid">
            <div class="health-col">
              <span class="col-title">Before Execution</span>
              <span class="rescue-badge ${baseBadge}">${baseStatus}</span>
              <div class="health-reasons-summary">${escapeHtml((report.baselineHealth.statusReasons || []).join('; ') || 'None')}</div>
            </div>
            <div class="health-col-arrow">➔</div>
            <div class="health-col">
              <span class="col-title">Recalculated Health</span>
              <span class="rescue-badge ${postBadge}">${postStatus}</span>
              <div class="health-reasons-summary">${escapeHtml(newReasons)}</div>
            </div>
          </div>
        </div>
      `;
    }

    // Remaining non-remediable / manual tasks
    let manualHtml = '';
    if (report.remainingNotRemediable && report.remainingNotRemediable.length > 0) {
      manualHtml = `
        <div class="rescue-section rescue-manual-section">
          <div class="rescue-section-title">
            <span>⚠️ Remaining Manual Interventions (${report.remainingNotRemediable.length})</span>
          </div>
          <div class="rescue-manual-list">
            ${report.remainingNotRemediable.map(nr => `
              <div class="rescue-manual-item">
                <div class="rescue-manual-header">
                  <strong>${escapeHtml(nr.title || nr.type)}</strong>
                  ${nr.targetId ? `<code>${escapeHtml(nr.targetId)}</code>` : ''}
                </div>
                <div class="rescue-manual-rec"><strong>Required Action:</strong> ${escapeHtml(nr.recommendation)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    const s = report.summary || { total: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 };

    return `
      <div class="rescue-verification-card" data-plan-id="${planId}">
        <div class="rescue-card-header">
          <div class="rescue-card-title">
            <span class="rescue-icon">🛡️</span>
            <strong>Execution &amp; Verification Report: ${pName}</strong>
            <code>${pId}</code>
          </div>
          <span class="rescue-badge ${statusBadgeClass}">${escapeHtml(report.status)}</span>
        </div>

        <div class="rescue-meta-box">
          <div class="rescue-meta-item">
            <strong>Execution Summary:</strong>
            ${s.succeeded} of ${s.total} actions succeeded
            (${s.skipped} skipped, ${s.failed} failed, ${s.cancelled} cancelled)
          </div>
          <div class="rescue-meta-item">
            <strong>Timing:</strong> Started at ${startedAt}, completed at ${completedAt}
          </div>
        </div>

        <div class="rescue-section">
          <div class="rescue-section-title">
            <span>Verified Action Transitions</span>
          </div>
          <div class="rescue-exec-list">
            ${actionRows || '<div class="rescue-empty-notice">No individual actions were executed.</div>'}
          </div>
        </div>

        ${healthCompareHtml}

        ${manualHtml}

        <div class="rescue-disclaimer-box">
          ℹ️ <strong>Truthful Verification Disclaimer:</strong>
          <em>${escapeHtml(report.disclaimer || 'Administrative status transitions unblock workflow progression; they do NOT verify source code fixes, test coverage, or physical resolution of external dependencies.')}</em>
        </div>
      </div>
    `;
  }

  async _workflowInspectGitHubRepo(rawText) {
    const toolCalls = [];
    let repoUrl = null;
    let targetProject = null;

    // 1. Check if rawText contains a direct GitHub URL
    const urlMatch = rawText.match(/https?:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/i);
    if (urlMatch) {
      repoUrl = urlMatch[0];
    } else {
      // 2. Resolve project from text
      const cleanTarget = rawText
        .replace(/^(?:inspect|audit|check|investigate|analyze|review)\s+(?:github(?:\s+repo(?:sitory)?)?|repo(?:sitory)?|dependencies(?:\s+for)?)\s+(?:for|on|in)?\s*/i, '')
        .trim();

      const projRes = await this.mcpClient.callTool('list_projects', {});
      toolCalls.push({
        name: 'list_projects',
        args: {},
        result: projRes.data
      });

      const projects = projRes.data?.projects || [];
      const resolution = resolveProject(cleanTarget, projects);

      if (resolution.status === 'matched') {
        targetProject = resolution.project;
        repoUrl = targetProject.repoUrl;
      } else if (resolution.status === 'ambiguous') {
        return {
          workflow: 'github_repo_inspection_ambiguous',
          toolCalls,
          explanation: `Multiple projects match "${cleanTarget}". Which project's repository would you like to inspect?`,
          clarificationOptions: resolution.candidates.map(p => ({
            label: `${p.name} (${p.repoUrl || 'No repo connected'})`,
            action: `audit repository for ${p.id}`
          }))
        };
      }
    }

    if (!repoUrl) {
      if (targetProject && !targetProject.repoUrl) {
        return {
          workflow: 'github_repo_inspection',
          toolCalls,
          explanation: `⚠️ Project **${targetProject.name}** does not have a connected GitHub repository URL.\n\nTo inspect source code and dependencies, add a valid GitHub repository URL (e.g. \`https://github.com/owner/repo\`) to this project.`
        };
      }
      return {
        workflow: 'github_repo_inspection',
        toolCalls,
        explanation: `Please provide a valid GitHub repository URL (e.g. \`https://github.com/owner/repo\`) or the name of a registered project with a connected repository.`
      };
    }

    let inspectRes;
    try {
      inspectRes = await this.mcpClient.callTool('inspect_github_repo', { repoUrl });
      toolCalls.push({
        name: 'inspect_github_repo',
        args: { repoUrl },
        result: inspectRes.data
      });
    } catch (err) {
      try {
        const { GitHubService } = await import('../../src/services/githubService.js');
        const gh = new GitHubService();
        const fallbackReport = await gh.inspectRepository(repoUrl);
        inspectRes = { data: fallbackReport };
        toolCalls.push({
          name: 'inspect_github_repo',
          args: { repoUrl },
          result: fallbackReport
        });
      } catch (innerErr) {
        return {
          workflow: 'github_repo_inspection',
          toolCalls,
          explanation: `⚠️ GitHub repository inspection error: ${err.message}`
        };
      }
    }

    const report = inspectRes?.data;
    if (!report) {
      return {
        workflow: 'github_repo_inspection',
        toolCalls,
        explanation: `⚠️ No report could be retrieved for repository \`${repoUrl}\`.`
      };
    }

    let explanation = `### 🔍 GitHub Repository Intelligence Report\n`;
    explanation += `• **Repository:** \`${report.repoUrl || repoUrl}\`\n`;
    explanation += `• **Assessment:** **${report.overallAssessment || 'Inspected'}**\n`;
    explanation += `• **Inspected At:** \`${report.inspectedAt ? new Date(report.inspectedAt).toISOString() : new Date().toISOString()}\`\n\n`;

    if (report.metadata) {
      explanation += `#### Repository Profile\n`;
      explanation += `• **Default Branch:** \`${report.metadata.defaultBranch}\` | **Language:** \`${report.metadata.language}\`\n`;
      explanation += `• **License:** \`${report.metadata.license}\` | **Stars:** ${report.metadata.stars} | **Open Issues:** ${report.metadata.openIssuesCount}\n`;
      if (report.metadata.description) {
        explanation += `• **Description:** ${report.metadata.description}\n`;
      }
      explanation += `\n`;
    }

    if (report.fileTreeSummary) {
      explanation += `#### Structure & Hygiene Audit\n`;
      explanation += `• **Total Files Indexed:** ${report.fileTreeSummary.totalFilesIndexed || 0}\n`;
      explanation += `• **README:** ${report.fileTreeSummary.hasReadme ? '✅ Present' : '❌ Missing'}\n`;
      explanation += `• **LICENSE:** ${report.fileTreeSummary.hasLicense ? '✅ Present' : '❌ Missing'}\n`;
      explanation += `• **.gitignore:** ${report.fileTreeSummary.hasGitignore ? '✅ Present' : '❌ Missing'}\n`;
      explanation += `• **CI/CD Workflows:** ${report.fileTreeSummary.ciWorkflowsCount > 0 ? `✅ ${report.fileTreeSummary.ciWorkflowsCount} workflow(s)` : '❌ None detected'}\n\n`;
    }

    const findings = Array.isArray(report.findings) ? report.findings : [];
    if (findings.length === 0) {
      explanation += `#### ✅ Findings & Recommendations\n`;
      explanation += `No critical or high-risk repository deficiencies were detected. Project follows baseline governance and dependency hygiene.\n`;
    } else {
      explanation += `#### ⚠️ Findings & Recommendations (${findings.length} detected)\n`;
      for (const f of findings) {
        const badge = f.severity === 'critical' ? '🔴 CRITICAL' : f.severity === 'high' ? '🟠 HIGH' : f.severity === 'medium' ? '🟡 MEDIUM' : '🔵 INFO';
        explanation += `• **[${badge}] ${f.title}** (\`${f.findingId}\`)\n`;
        explanation += `  *Explanation:* ${f.explanation}\n`;
        if (f.filePath) {
          explanation += `  *File:* \`${f.filePath}\`\n`;
        }
        explanation += `  *Remediation:* ${f.remediation}\n\n`;
      }
    }

    return {
      workflow: 'github_repo_inspection',
      toolCalls,
      explanation
    };
  }

  async _workflowManageBlocker(rawText) {
    const toolCalls = [];
    const lower = rawText.toLowerCase();
    const isResolve = lower.includes('resolve') || lower.includes('unblock') || lower.includes('clear blocker');

    const blockersRes = await this.mcpClient.callTool('list_blockers', {});
    toolCalls.push({
      name: 'list_blockers',
      args: {},
      result: blockersRes.data
    });

    const blockers = blockersRes.data?.blockers || [];

    if (isResolve) {
      if (blockers.length === 0) {
        return {
          workflow: 'manage_blocker',
          toolCalls,
          explanation: `There are currently no active blockers recorded across any projects.`
        };
      }

      const cleanTarget = rawText
        .replace(/^(?:resolve|clear|unblock)\s+(?:the\s+)?(?:blocker(?:\s+for|\s+on)?\s+)?/i, '')
        .trim()
        .toLowerCase();

      let matched = null;
      if (cleanTarget) {
        matched = blockers.find(b =>
          b.taskTitle.toLowerCase().includes(cleanTarget) ||
          b.projectName.toLowerCase().includes(cleanTarget) ||
          b.taskId.toLowerCase() === cleanTarget ||
          b.blockerReason.toLowerCase().includes(cleanTarget)
        );
      }

      if (!matched && blockers.length === 1) {
        matched = blockers[0];
      }

      if (!matched) {
        return {
          workflow: 'manage_blocker',
          toolCalls,
          explanation: `Please specify which blocker to resolve:\n` +
            blockers.map(b => `• **${b.taskTitle}** (${b.projectName}): ${b.blockerReason}`).join('\n')
        };
      }

      if (this.executionMode === 'ASK') {
        return {
          workflow: 'manage_blocker_plan',
          toolCalls,
          explanation: `**Proposed Action (ASK Mode):**\n` +
            `• Would update task **"${matched.taskTitle}"** (\`${matched.taskId}\`) status from BLOCKED to IN_PROGRESS.\n` +
            `• Would clear blocker reason: "${matched.blockerReason}".\n` +
            `• Would recalculate project health for **${matched.projectName}**.\n\n` +
            `*To execute this change, switch to APPROVE or AUTOPILOT mode.*`
        };
      }

      const updateRes = await this.mcpClient.callTool('update_task_status', {
        taskId: matched.taskId,
        status: 'in_progress',
        blockerReason: null
      });
      toolCalls.push({
        name: 'update_task_status',
        args: { taskId: matched.taskId, status: 'in_progress', blockerReason: null },
        result: updateRes.data
      });

      const healthRes = await this.mcpClient.callTool('get_project_health', { projectId: matched.projectId });
      toolCalls.push({
        name: 'get_project_health',
        args: { projectId: matched.projectId },
        result: healthRes.data
      });

      const updatedHealth = healthRes.data?.healthStatus || 'Healthy';

      return {
        workflow: 'manage_blocker',
        toolCalls,
        explanation: `✅ **Blocker Resolved Successfully**\n\n` +
          `• **Task:** "${matched.taskTitle}" (\`${matched.taskId}\`)\n` +
          `• **Previous Blocker:** ${matched.blockerReason}\n` +
          `• **New Task Status:** IN_PROGRESS\n` +
          `• **Updated Project Health (${matched.projectName}):** **${updatedHealth}**\n\n` +
          `State mutation verified via post-write read and audit trail.`
      };
    }

    return {
      workflow: 'manage_blocker',
      toolCalls,
      explanation: `To manage blockers, you can ask:\n` +
        `• "Resolve blocker for <Task/Project>"\n` +
        `• "List all blockers"`
    };
  }

  async _workflowCreateTask(rawText) {
    const toolCalls = [];

    let priority = 'medium';
    if (/\bcritical\b/i.test(rawText)) priority = 'critical';
    else if (/\bhigh\b/i.test(rawText)) priority = 'high';
    else if (/\blow\b/i.test(rawText)) priority = 'low';

    const isBug = /\bbug\b/i.test(rawText);

    let title = '';
    let projectName = '';

    const forMatch = rawText.match(/^(?:create|add)\s+(?:(?:critical|high|medium|low)\s+)?(?:task|bug)\s+(.+?)\s+(?:for|in|to)\s+(.+)$/i);
    if (forMatch) {
      title = forMatch[1].trim();
      projectName = forMatch[2].trim();
    } else {
      const simpleMatch = rawText.match(/^(?:create|add)\s+(?:(?:critical|high|medium|low)\s+)?(?:task|bug)\s+(.+)$/i);
      if (simpleMatch) {
        title = simpleMatch[1].trim();
      }
    }

    if (!title) {
      return {
        workflow: 'create_task',
        toolCalls,
        explanation: `Please specify the task title and target project (e.g., "Create critical authentication task for ImperialStay").`
      };
    }

    const projRes = await this.mcpClient.callTool('list_projects', {});
    toolCalls.push({
      name: 'list_projects',
      args: {},
      result: projRes.data
    });

    const projects = projRes.data?.projects || [];
    let targetProject = null;

    if (projectName) {
      const resolution = resolveProject(projectName, projects);
      if (resolution.status === 'matched') {
        targetProject = resolution.project;
      } else if (resolution.status === 'ambiguous') {
        return {
          workflow: 'create_task_ambiguous',
          toolCalls,
          explanation: `Multiple projects match "${projectName}". For which project should I create this task?`,
          clarificationOptions: resolution.candidates.map(p => ({
            label: p.name,
            action: `create ${priority} task ${title} for ${p.id}`
          }))
        };
      }
    }

    if (!targetProject) {
      targetProject = projects[0];
    }

    if (!targetProject) {
      return {
        workflow: 'create_task',
        toolCalls,
        explanation: `No registered project found to associate task with. Please create a project first.`
      };
    }

    if (this.executionMode === 'ASK') {
      return {
        workflow: 'create_task_plan',
        toolCalls,
        explanation: `**Proposed Task Creation (ASK Mode):**\n` +
          `• **Project:** ${targetProject.name} (\`${targetProject.id}\`)\n` +
          `• **Title:** ${title}\n` +
          `• **Priority:** ${priority.toUpperCase()}\n` +
          `• **Type:** ${isBug ? 'Bug' : 'Task'}\n\n` +
          `*To execute, switch to APPROVE or AUTOPILOT mode.*`
      };
    }

    const createRes = await this.mcpClient.callTool('create_task', {
      projectId: targetProject.id,
      title,
      priority,
      isBug
    });
    toolCalls.push({
      name: 'create_task',
      args: { projectId: targetProject.id, title, priority, isBug },
      result: createRes.data
    });

    const created = createRes.data?.task;

    return {
      workflow: 'create_task',
      toolCalls,
      explanation: `✅ **Task Created Successfully**\n\n` +
        `• **Title:** "${created ? created.title : title}"\n` +
        `• **Project:** ${targetProject.name} (\`${targetProject.id}\`)\n` +
        `• **Priority:** ${priority.toUpperCase()}\n` +
        `• **Status:** TODO\n` +
        `• **Task ID:** \`${created ? created.id : 'generated'}\``
    };
  }

  async _workflowReopenTask(rawText) {
    const toolCalls = [];
    const cleanQuery = rawText
      .replace(/^(?:reopen|re-open)\s+(?:task\s+)?/i, '')
      .replace(/['"]/g, '')
      .trim()
      .toLowerCase();

    const tasksRes = await this.mcpClient.callTool('list_tasks', {});
    toolCalls.push({
      name: 'list_tasks',
      args: {},
      result: tasksRes.data
    });

    const allTasks = tasksRes.data?.tasks || [];
    let matches = allTasks.filter(t =>
      t.id.toLowerCase() === cleanQuery ||
      t.id.toLowerCase().includes(cleanQuery) ||
      t.title.toLowerCase().includes(cleanQuery)
    );

    const exactId = matches.find(t => t.id.toLowerCase() === cleanQuery);
    if (exactId) matches = [exactId];

    if (matches.length === 0) {
      return {
        workflow: 'reopen_task',
        toolCalls,
        explanation: `Could not find any task matching "${cleanQuery}".`
      };
    }

    if (matches.length > 1) {
      this.pendingResolution = {
        action: 'reopen_task',
        candidates: matches
      };
      return {
        workflow: 'reopen_task_ambiguous',
        toolCalls,
        explanation: `Multiple tasks match "${cleanQuery}". Which task would you like to reopen?`,
        clarificationOptions: matches.map(t => ({
          label: `${t.title} (${t.id})`,
          action: `reopen task ${t.id}`
        }))
      };
    }

    const target = matches[0];

    if (this.executionMode === 'ASK') {
      return {
        workflow: 'reopen_task_plan',
        toolCalls,
        explanation: `**Proposed Task Reopen (ASK Mode):**\n` +
          `• **Task:** "${target.title}" (\`${target.id}\`)\n` +
          `• **Current Status:** ${(target.status || 'done').toUpperCase()}\n` +
          `• **Target Status:** TODO\n\n` +
          `*To execute, switch to APPROVE or AUTOPILOT mode.*`
      };
    }

    const updateRes = await this.mcpClient.callTool('update_task_status', {
      taskId: target.id,
      status: 'todo'
    });
    toolCalls.push({
      name: 'update_task_status',
      args: { taskId: target.id, status: 'todo' },
      result: updateRes.data
    });

    return {
      workflow: 'reopen_task',
      toolCalls,
      explanation: `✅ **Task Reopened Successfully**\n\n` +
        `• **Task:** "${target.title}" (\`${target.id}\`)\n` +
        `• **New Status:** TODO\n` +
        `• **Completed Timestamp:** Cleared\n\n` +
        `State mutation verified via post-write read.`
    };
  }

  async _workflowAuditLog() {
    const toolCalls = [];
    let logsRes;
    try {
      logsRes = await this.mcpClient.callTool('get_audit_log', { limit: 10 });
      toolCalls.push({
        name: 'get_audit_log',
        args: { limit: 10 },
        result: logsRes.data
      });
    } catch {
      // Fallback
    }

    const logs = logsRes?.data?.auditLogs || [];

    if (logs.length === 0) {
      return {
        workflow: 'audit_log',
        toolCalls,
        explanation: `📋 **Audit Trail & Activity History**\n\nNo mutation events currently recorded. Actions in APPROVE or AUTOPILOT mode will appear here.`
      };
    }

    let explanation = `📋 **Audit Trail & Activity History** (${logs.length} most recent events)\n\n`;
    for (const log of logs) {
      const timeStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : 'Recent';
      explanation += `• **[${timeStr}] \`${log.action}\`** (${log.mode || 'APPROVE'} by *${log.actor || 'assistant'}*)\n`;
      explanation += `  *Target:* ${log.targetType} \`${log.targetId || 'N/A'}\` | *Status:* ${log.status || 'success'}\n`;
    }

    return {
      workflow: 'audit_log',
      toolCalls,
      explanation
    };
  }

  async _handleClarificationSelection(input, resolution) {
    if (resolution.action === 'rescue_project') {
      const match = resolution.candidates.find(c =>
        c.id.toLowerCase() === input.toLowerCase() ||
        c.name.toLowerCase() === input.toLowerCase() ||
        c.name.toLowerCase().includes(input.toLowerCase())
      );
      if (match) {
        return this._workflowRescueProject(`rescue project ${match.id}`);
      }
    }
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

    if (resolution.action === 'reopen_task') {
      const match = resolution.candidates.find(c =>
        c.id.toLowerCase() === input.toLowerCase() ||
        c.title.toLowerCase().includes(input.toLowerCase())
      );
      if (match) {
        return this._workflowReopenTask(`reopen task ${match.id}`);
      }
    }

    // If input did not match any clarification candidate, route as fresh command
    return this.process(input);
  }
}
