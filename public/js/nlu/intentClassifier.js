/**
 * ProjectPilot AI - Multilingual Intent Classifier & Entity Extractor
 * Identifies developer intent, target entities, requested actions,
 * and detects ambiguity requiring clarification across English, Hindi, and Marathi.
 */

export const INTENTS = {
  INVESTIGATE_PROJECT: 'INVESTIGATE_PROJECT',
  REMAINING_WORK: 'REMAINING_WORK',
  DAILY_PRIORITIES: 'DAILY_PRIORITIES',
  COMPLETE_TASK: 'COMPLETE_TASK',
  REOPEN_TASK: 'REOPEN_TASK',
  CREATE_TASK: 'CREATE_TASK',
  MANAGE_BLOCKER: 'MANAGE_BLOCKER',
  MAINTENANCE_REVIEW: 'MAINTENANCE_REVIEW',
  RESCUE_PROJECT: 'RESCUE_PROJECT',
  GITHUB_INSPECT: 'GITHUB_INSPECT',
  EXPLAIN_ERROR: 'EXPLAIN_ERROR',
  AUDIT_LOG: 'AUDIT_LOG',
  SWITCH_MODE: 'SWITCH_MODE',
  GREETING: 'GREETING',
  AMBIGUOUS_ACTION: 'AMBIGUOUS_ACTION',
  UNSUPPORTED: 'UNSUPPORTED'
};

export class IntentClassifier {
  constructor(options = {}) {
    this.memory = options.memory || null;
  }

  /**
   * Classifies user input into intent, entities, and required action.
   * @param {string} normalizedText
   * @param {{ language: string, script: string }} langInfo
   * @param {Array<Object>} [availableProjects=[]]
   * @returns {{
   *   intent: string,
   *   targetProject: string|null,
   *   targetTask: string|null,
   *   targetRepo: string|null,
   *   actionType: string|null,
   *   requiresClarification: boolean,
   *   clarificationReason: string|null,
   *   confidence: number
   * }}
   */
  classify(normalizedText, langInfo = { language: 'en' }, availableProjects = []) {
    if (!normalizedText) {
      return {
        intent: INTENTS.UNSUPPORTED,
        targetProject: null,
        targetTask: null,
        targetRepo: null,
        actionType: null,
        requiresClarification: false,
        clarificationReason: null,
        confidence: 0
      };
    }

    const lower = normalizedText.toLowerCase().trim();

    // 0. Check Context Memory Anaphora
    const anaphora = this.memory ? this.memory.resolveAnaphora(normalizedText) : null;

    // 1. Mode Switch Intent
    if (lower.startsWith('switch to ') || lower.startsWith('set mode to ') || lower.startsWith('change mode to ')) {
      return {
        intent: INTENTS.SWITCH_MODE,
        targetProject: null,
        targetTask: null,
        targetRepo: null,
        actionType: lower.includes('autopilot') ? 'AUTOPILOT' : (lower.includes('ask') ? 'ASK' : 'APPROVE'),
        requiresClarification: false,
        clarificationReason: null,
        confidence: 0.99
      };
    }

    // 2. Greeting Intent
    if (
      /^(?:hi|hello|hey|namaste|namaskar|good\s+morning|good\s+evening|pranam|kasa\s+kay|kaise\s+ho)\b/i.test(lower) &&
      lower.split(/\s+/).length <= 3
    ) {
      return {
        intent: INTENTS.GREETING,
        targetProject: null,
        targetTask: null,
        targetRepo: null,
        actionType: null,
        requiresClarification: false,
        clarificationReason: null,
        confidence: 0.95
      };
    }

    // 3. Explain Error Intent (English / Hindi / Marathi)
    if (
      lower.includes('explain this error') ||
      lower.includes('explain error') ||
      lower.includes('error explain') ||
      lower.includes('error kyu') ||
      lower.includes('error ka yetoy') ||
      lower.includes('he kashamule') ||
      lower.includes('yeh kyu hua') ||
      (anaphora?.anaphoraType === 'ERROR_REF' && (lower.includes('explain') || lower.includes('sanga') || lower.includes('batao') || lower.includes('why')))
    ) {
      return {
        intent: INTENTS.EXPLAIN_ERROR,
        targetProject: anaphora?.resolvedProject?.id || null,
        targetTask: anaphora?.resolvedTask?.id || null,
        targetRepo: null,
        actionType: 'explain_error',
        requiresClarification: !anaphora?.resolvedError && !anaphora?.resolvedProject,
        clarificationReason: (!anaphora?.resolvedError && !anaphora?.resolvedProject)
          ? 'Which project or error would you like me to explain?'
          : null,
        confidence: 0.92
      };
    }

    // 4. Anaphora Action Fix ("fix it", "same issue fix karo", "he fix kara")
    if (anaphora?.anaphoraType === 'ACTION_FIX') {
      if (anaphora.resolvedProject) {
        return {
          intent: INTENTS.MANAGE_BLOCKER,
          targetProject: anaphora.resolvedProject.id,
          targetTask: anaphora.resolvedTask?.id || null,
          targetRepo: null,
          actionType: 'resolve_blocker',
          requiresClarification: false,
          clarificationReason: null,
          confidence: 0.9
        };
      }
      return {
        intent: INTENTS.AMBIGUOUS_ACTION,
        targetProject: null,
        targetTask: null,
        targetRepo: null,
        actionType: 'fix',
        requiresClarification: true,
        clarificationReason: 'Which project or issue would you like me to fix? Please specify the project or task name.',
        confidence: 0.8
      };
    }

    // 5. Findings Query Follow-up ("What did you find? Explain it in English.")
    if (anaphora?.anaphoraType === 'FINDINGS_REF') {
      return {
        intent: INTENTS.INVESTIGATE_PROJECT,
        targetProject: anaphora.resolvedProject?.id || null,
        targetTask: null,
        targetRepo: null,
        actionType: 'summarize_findings',
        requiresClarification: !anaphora.resolvedProject,
        clarificationReason: !anaphora.resolvedProject ? 'Which project investigation would you like me to summarize?' : null,
        confidence: 0.95
      };
    }

    // 6. Rescue Intent (Autonomous Rescue Workflow)
    if (
      lower.startsWith('rescue') ||
      lower.startsWith('help rescue') ||
      lower.includes('rescue plan') ||
      lower.includes('recovery plan') ||
      lower.includes('rescue project') ||
      lower.includes('bachao project') ||
      lower.includes('rescue kara')
    ) {
      return {
        intent: INTENTS.RESCUE_PROJECT,
        targetProject: this._extractProjectQuery(lower),
        targetTask: null,
        targetRepo: null,
        actionType: 'generate_rescue_plan',
        requiresClarification: false,
        clarificationReason: null,
        confidence: 0.94
      };
    }

    // 7. GitHub Repository Intelligence Intent
    if (
      lower.startsWith('inspect github') ||
      lower.startsWith('audit github') ||
      lower.startsWith('audit repo') ||
      lower.startsWith('audit repository') ||
      lower.startsWith('inspect repo') ||
      lower.startsWith('check github') ||
      lower.includes('github.com')
    ) {
      const match = lower.match(/https?:\/\/github\.com\/[^\s]+/i);
      return {
        intent: INTENTS.GITHUB_INSPECT,
        targetProject: null,
        targetTask: null,
        targetRepo: match ? match[0] : null,
        actionType: 'inspect_github_repo',
        requiresClarification: !match && !lower.includes('github.com'),
        clarificationReason: (!match && !lower.includes('github.com')) ? 'Please provide the GitHub repository URL to inspect.' : null,
        confidence: 0.93
      };
    }

    // 8. Daily Priorities Intent (English / Hindi / Marathi)
    if (
      lower.includes('daily priorit') ||
      lower.includes('what should i work on') ||
      lower.includes("what's my next task") ||
      lower.includes('recommendation') ||
      lower.includes('prioritize') ||
      lower.includes('top priorit') ||
      lower.includes('aaj kay karu') ||
      lower.includes('aaj kya karna hai') ||
      lower.includes('aaj kya karu') ||
      lower.includes('aajche kam') ||
      lower.includes('priorities batao') ||
      lower.includes('priority sanga')
    ) {
      return {
        intent: INTENTS.DAILY_PRIORITIES,
        targetProject: null,
        targetTask: null,
        targetRepo: null,
        actionType: 'get_priority_recommendations',
        requiresClarification: false,
        clarificationReason: null,
        confidence: 0.95
      };
    }

    // 9. Remaining Work / Pending Tasks Intent (English / Hindi / Marathi)
    if (
      lower.includes('remaining work') ||
      lower.includes('what is left') ||
      lower.includes("what's left") ||
      lower.includes('outstanding tasks') ||
      lower.includes('pending tasks') ||
      lower.includes('pending task') ||
      lower.includes('unfinished work') ||
      lower.includes('what is pending') ||
      lower.includes('wht is pending') ||
      lower.includes('baki kam') ||
      lower.includes('kam baki aahe') ||
      lower.includes('baki kaam') ||
      lower.includes('bache hue task')
    ) {
      return {
        intent: INTENTS.REMAINING_WORK,
        targetProject: this._extractProjectQuery(lower) || anaphora?.resolvedProject?.id || null,
        targetTask: null,
        targetRepo: null,
        actionType: 'list_tasks',
        requiresClarification: false,
        clarificationReason: null,
        confidence: 0.92
      };
    }

    // 10. Complete Task Intent
    if (
      lower.startsWith('complete task') ||
      lower.startsWith('finish task') ||
      lower.startsWith('mark task') ||
      lower.includes('complete the task') ||
      lower.includes('mark done') ||
      lower.includes('kam jhale') ||
      lower.includes('kam pura ho gaya') ||
      lower.includes('task complete karo')
    ) {
      return {
        intent: INTENTS.COMPLETE_TASK,
        targetProject: anaphora?.resolvedProject?.id || null,
        targetTask: this._extractTaskQuery(lower),
        targetRepo: null,
        actionType: 'update_task_status',
        requiresClarification: false,
        clarificationReason: null,
        confidence: 0.91
      };
    }

    // 11. Reopen Task Intent
    if (
      lower.startsWith('reopen task') ||
      lower.startsWith('re-open task') ||
      lower.includes('wapas open karo') ||
      lower.includes('parat suru kara')
    ) {
      return {
        intent: INTENTS.REOPEN_TASK,
        targetProject: anaphora?.resolvedProject?.id || null,
        targetTask: this._extractTaskQuery(lower),
        targetRepo: null,
        actionType: 'reopen_task',
        requiresClarification: false,
        clarificationReason: null,
        confidence: 0.91
      };
    }

    // 12. Create Task / Add Bug Intent
    if (
      (lower.startsWith('create ') || lower.startsWith('add ') || lower.startsWith('banao ')) &&
      (lower.includes('task') || lower.includes('bug') || lower.includes('issue'))
    ) {
      return {
        intent: INTENTS.CREATE_TASK,
        targetProject: anaphora?.resolvedProject?.id || null,
        targetTask: null,
        targetRepo: null,
        actionType: 'create_task',
        requiresClarification: false,
        clarificationReason: null,
        confidence: 0.88
      };
    }

    // 13. Blocker Management Intent
    if (
      lower.startsWith('resolve blocker') ||
      lower.startsWith('clear blocker') ||
      lower.startsWith('unblock task') ||
      lower.includes('resolve the blocker') ||
      lower.includes('blocker solve karo') ||
      lower.includes('blocker hatwa') ||
      lower.startsWith('block task')
    ) {
      return {
        intent: INTENTS.MANAGE_BLOCKER,
        targetProject: anaphora?.resolvedProject?.id || null,
        targetTask: this._extractTaskQuery(lower),
        targetRepo: null,
        actionType: lower.startsWith('block task') ? 'block' : 'unblock',
        requiresClarification: false,
        clarificationReason: null,
        confidence: 0.91
      };
    }

    // 14. Maintenance Review Intent
    if (
      lower.includes('maintenance') ||
      lower.includes('cert expiry') ||
      lower.includes('rotation') ||
      lower.includes('overdue maintenance')
    ) {
      return {
        intent: INTENTS.MAINTENANCE_REVIEW,
        targetProject: null,
        targetTask: null,
        targetRepo: null,
        actionType: 'list_maintenance_tasks',
        requiresClarification: false,
        clarificationReason: null,
        confidence: 0.9
      };
    }

    // 15. Audit Log Intent
    if (
      lower.includes('audit log') ||
      lower.includes('audit trail') ||
      lower.includes('audit history') ||
      lower.includes('activity history')
    ) {
      return {
        intent: INTENTS.AUDIT_LOG,
        targetProject: null,
        targetTask: null,
        targetRepo: null,
        actionType: 'get_audit_log',
        requiresClarification: false,
        clarificationReason: null,
        confidence: 0.94
      };
    }

    // 16. Project Investigation Intent (Default for health, issues, performance, checking status)
    if (
      lower.startsWith('inspect') ||
      lower.startsWith('investigate') ||
      lower.startsWith('audit') ||
      lower.startsWith('examine') ||
      lower.startsWith('check') ||
      lower.startsWith('show') ||
      lower.startsWith('what is') ||
      lower.startsWith("what's") ||
      lower.startsWith('how is') ||
      lower.startsWith('tell me about') ||
      lower.includes('not running properly') ||
      lower.includes('not working properly') ||
      lower.includes('not working') ||
      lower.includes('not runing') ||
      lower.includes('error ka yetoy') ||
      lower.includes('slow chal raha') ||
      lower.includes('open hot nahi') ||
      lower.includes('status batao') ||
      lower.includes('status sanga') ||
      lower.includes('project status') ||
      lower.includes('project health')
    ) {
      const extracted = this._extractProjectQuery(lower) || anaphora?.resolvedProject?.id || null;
      return {
        intent: INTENTS.INVESTIGATE_PROJECT,
        targetProject: extracted,
        targetTask: null,
        targetRepo: null,
        actionType: 'investigate_project',
        requiresClarification: false,
        clarificationReason: null,
        confidence: 0.89
      };
    }

    // Fallback: Unsupported or Ambiguous
    return {
      intent: INTENTS.UNSUPPORTED,
      targetProject: anaphora?.resolvedProject?.id || null,
      targetTask: null,
      targetRepo: null,
      actionType: null,
      requiresClarification: true,
      clarificationReason: 'I could not determine the exact project action. Please choose one of the available workflows or specify a project.',
      confidence: 0.2
    };
  }

  _extractProjectQuery(lowerText) {
    // Strips common investigative filler words across English, Hindi, and Marathi
    return lowerText
      .replace(/^(?:investigate|inspect|audit|examine|check(?:\s+out)?|show(?:\s+me)?|what\s+is|what's|how\s+is|tell\s+me\s+about|give\s+me(?:\s+details)?)\s+/i, '')
      .replace(/^(?:the\s+|my\s+|our\s+|this\s+|mera\s+|meri\s+|majha\s+|majhi\s+|majhe\s+)?(?:project\s+|app\s+)?/i, '')
      .replace(/\s+(?:status|health|details|doing|please|slow\s+chal\s+raha\s+hai|not\s+running\s+properly|not\s+working|error\s+ka\s+yetoy|open\s+hot\s+nahi|ka\s+status\s+batao|check\s+karo)$/i, '')
      .trim();
  }

  _extractTaskQuery(lowerText) {
    return lowerText
      .replace(/^(?:complete\s+task|finish\s+task|mark\s+task|complete\s+the\s+task|reopen\s+task|re-open\s+task|unblock\s+task|block\s+task)\s+/i, '')
      .replace(/['"]+/g, '')
      .trim();
  }
}
