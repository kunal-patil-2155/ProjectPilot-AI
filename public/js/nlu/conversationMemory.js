/**
 * ProjectPilot AI - Context & Conversation Memory
 * Manages active entities (project, task, blocker), conversation turns,
 * anaphora resolution ("this project", "that error", "fix it"), and language preference.
 */

export class ConversationMemory {
  constructor() {
    this.activeProject = null;        // { id, name, category, health, status }
    this.activeTask = null;           // { id, title, status, priority, blocker }
    this.lastInvestigation = null;    // { projectId, projectName, health, blocker, findings, timestamp }
    this.lastErrorOrBlocker = null;   // { text, projectId, taskId, reason, timestamp }
    this.preferredLanguage = 'en';    // 'en' | 'hi' | 'mr' | 'hinglish' | 'marathiglish'
    this.recentTurns = [];            // Max 10 turns
    this.maxTurns = 10;
  }

  /**
   * Sets the active project in conversational context.
   */
  setActiveProject(project) {
    if (!project) return;
    this.activeProject = {
      id: project.id,
      name: project.name,
      category: project.category || 'General',
      status: project.status || 'active',
      health: project.health || null
    };
  }

  /**
   * Sets the active task in conversational context.
   */
  setActiveTask(task) {
    if (!task) return;
    this.activeTask = {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority || 'medium',
      blocker: task.blocker || null,
      projectId: task.projectId || this.activeProject?.id
    };

    if (task.blocker) {
      this.lastErrorOrBlocker = {
        text: task.blocker,
        projectId: this.activeTask.projectId,
        taskId: task.id,
        reason: task.blocker,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Records findings from an evidence-based project investigation.
   */
  recordInvestigation(investigation) {
    if (!investigation) return;
    this.lastInvestigation = {
      ...investigation,
      timestamp: new Date().toISOString()
    };

    if (investigation.project) {
      this.setActiveProject(investigation.project);
    }

    if (investigation.blockers && investigation.blockers.length > 0) {
      const topBlocker = investigation.blockers[0];
      this.lastErrorOrBlocker = {
        text: topBlocker.blockerReason || topBlocker.blocker || 'Active critical blocker',
        projectId: investigation.project?.id || topBlocker.projectId,
        taskId: topBlocker.id || topBlocker.taskId,
        reason: topBlocker.blockerReason || topBlocker.blocker,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Records a user or assistant dialogue turn.
   */
  recordTurn(role, text, intent = null) {
    if (!text) return;
    this.recentTurns.push({
      role,
      text: String(text).trim(),
      intent,
      timestamp: new Date().toISOString()
    });

    if (this.recentTurns.length > this.maxTurns) {
      this.recentTurns.shift();
    }
  }

  /**
   * Resolves anaphoric expressions ("this project", "that error", "fix it", "same issue")
   * against active memory state.
   * @param {string} text
   * @returns {{
   *   resolvedProject: Object|null,
   *   resolvedTask: Object|null,
   *   resolvedError: Object|null,
   *   isFollowUp: boolean,
   *   anaphoraType: string|null
   * }}
   */
  resolveAnaphora(text) {
    if (!text) {
      return { resolvedProject: null, resolvedTask: null, resolvedError: null, isFollowUp: false, anaphoraType: null };
    }

    const lower = text.toLowerCase().trim();

    // 1. Check project anaphora
    const projectAnaphoraRegex = /\b(?:this\s+project|that\s+project|the\s+project|my\s+project|same\s+project|it|toch\s+project|vahi\s+project|is\s+project|ya\s+project)\b/i;
    const hasProjectRef = projectAnaphoraRegex.test(lower);

    // 2. Check error / blocker anaphora
    const errorAnaphoraRegex = /\b(?:this\s+error|that\s+error|the\s+error|the\s+blocker|this\s+blocker|same\s+issue|that\s+issue|this\s+issue|he\s+error|ye\s+error|vahi\s+issue|toch\s+issue)\b/i;
    const hasErrorRef = errorAnaphoraRegex.test(lower);

    // 3. Check action anaphora ("fix it", "resolve it", "same issue fix karo", "he fix kara")
    const actionFixRegex = /\b(?:fix\s+it|resolve\s+it|solve\s+it|fix\s+karo|solve\s+karo|he\s+fix\s+kara|durust\s+kara)\b/i;
    const hasActionFix = actionFixRegex.test(lower);

    // 4. Check findings query follow-up ("what did you find", "explain it", "explain this", "what happened")
    const findingsQueryRegex = /\b(?:what\s+did\s+you\s+find|findings|kay\s+sapadla|kya\s+mila|explain\s+it|explain\s+this|explain\s+findings|he\s+sanga|yeh\s+batao)\b/i;
    const hasFindingsQuery = findingsQueryRegex.test(lower);

    let anaphoraType = null;
    if (hasActionFix) anaphoraType = 'ACTION_FIX';
    else if (hasErrorRef) anaphoraType = 'ERROR_REF';
    else if (hasFindingsQuery) anaphoraType = 'FINDINGS_REF';
    else if (hasProjectRef) anaphoraType = 'PROJECT_REF';

    return {
      resolvedProject: (hasProjectRef || hasErrorRef || hasActionFix || hasFindingsQuery) ? this.activeProject : null,
      resolvedTask: (hasActionFix || hasErrorRef) ? this.activeTask : null,
      resolvedError: (hasErrorRef || hasActionFix) ? this.lastErrorOrBlocker : null,
      isFollowUp: Boolean(anaphoraType),
      anaphoraType
    };
  }

  /**
   * Clears context memory.
   */
  clear() {
    this.activeProject = null;
    this.activeTask = null;
    this.lastInvestigation = null;
    this.lastErrorOrBlocker = null;
    this.preferredLanguage = 'en';
    this.recentTurns = [];
  }
}
