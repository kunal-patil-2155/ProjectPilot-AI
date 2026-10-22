/**
 * ProjectPilot AI - Autonomous Project Rescue Service (Phase 1)
 * Pure, deterministic planning service that derives evidence-based rescue plans
 * strictly from persisted records and supported MCP tool contracts.
 * 
 * Rules:
 * - Pure functional service: no side effects, no disk writes, no network calls, no MCP invocations.
 * - Input immutability: project, tasks, and health objects are never mutated.
 * - Evidence grounding: only proposes actions executable through real, existing MCP write tools.
 * - Truthful projections: health projections are simulated using existing health rules and
 *   never guarantee uninspected technical or code-level perfection.
 */

import { HealthService } from './healthService.js';

/**
 * Valid MCP write tools and their allowed parameter keys according to MCP server schemas.
 */
export const SUPPORTED_RESCUE_TOOLS = {
  update_task_status: ['taskId', 'status', 'blockerReason'],
  update_project: ['projectId', 'name', 'description', 'category', 'techStack', 'repoUrl', 'status', 'priority'],
  create_task: ['projectId', 'title', 'description', 'priority', 'status', 'dueDate', 'blocker', 'isMaintenance', 'isBug']
};

/**
 * Generates an evidence-based, deterministic rescue plan for a project.
 * 
 * @param {Object} project - The project record
 * @param {Array<Object>} [tasks=[]] - List of tasks associated with the project
 * @param {Object|null} [health=null] - Pre-calculated project health object (derived if omitted)
 * @returns {Object} Structured rescue plan object
 */
export function generateRescuePlan(project, tasks = [], health = null) {
  // Input validation & defensive checks
  if (!project || typeof project !== 'object') {
    throw new Error('Invalid project: project must be a non-null object.');
  }
  if (!project.id || typeof project.id !== 'string' || !project.id.trim()) {
    throw new Error('Invalid project: project.id is required and must be a non-empty string.');
  }

  // Treat inputs as read-only; safely extract tasks
  const rawTasks = Array.isArray(tasks)
    ? tasks
    : (Array.isArray(project.tasks) ? project.tasks : []);

  // Safe shallow copies of task objects to prevent any accidental mutations
  const safeTasks = rawTasks.filter(t => t && typeof t === 'object').map(t => ({ ...t }));

  // Derive baseline health if not provided or incomplete
  let baselineHealth = health;
  if (!baselineHealth || typeof baselineHealth !== 'object' || !baselineHealth.healthStatus) {
    const healthCalculator = new HealthService(null);
    baselineHealth = healthCalculator._calculateProjectHealth({ ...project, tasks: safeTasks });
  }

  const dataCompleteness = baselineHealth.evidence?.dataCompleteness || {
    percentage: 0,
    rating: 'Minimal',
    missingMetadata: [],
    missingRecords: safeTasks.length === 0 ? ['tasks'] : [],
    missingFields: []
  };

  const planId = `rescue-plan-${project.id}`;
  const createdAt = new Date().toISOString();
  const actions = [];
  const notRemediable = [];
  const limitations = [
    'Evidence boundary: Intelligence is derived strictly from persisted records. Source code, git commits, runtime security, and CI/CD pipelines remain unverified.'
  ];

  // RULE 1: ZERO-TASK / INSUFFICIENT DATA PROJECTS
  if (safeTasks.length === 0) {
    limitations.push('Project contains zero registered tasks; operational health cannot be evaluated or projected until task records exist.');
    notRemediable.push({
      type: 'INSUFFICIENT_DATA_SETUP_CHECKLIST',
      targetId: project.id,
      reason: 'Project has 0 registered tasks. Operational progress, blocker severity, and delivery timelines cannot be evaluated without task data.',
      recommendation: 'Register initial tasks to establish the project operational baseline.',
      checklist: [
        'Connect version control repository URL',
        'Create core architectural and technical specification tasks',
        'Register initial MVP milestone deliverables with due dates',
        'Set up automated test suite verification tasks'
      ]
    });

    return {
      planId,
      projectId: project.id,
      projectName: project.name || project.id,
      createdAt,
      baselineHealth,
      dataCompleteness,
      actions: [],
      notRemediable,
      limitations,
      projectedHealth: null,
      projectionExplanation: 'Truthful projection cannot be computed because the project contains zero registered tasks.'
    };
  }

  // RULE 2: ACTIVE BLOCKERS (Critical & Non-Critical)
  // Tasks where status === 'blocked' or blocker is present and not resolved
  const blockedTasks = safeTasks.filter(t => {
    if (t.blockerResolved === true) return false;
    if (t.blocker && String(t.blocker).trim().toLowerCase() === 'resolved') return false;
    if (t.status === 'blocked') return true;
    if (Boolean(t.blocker)) return true;
    return false;
  });

  for (const t of blockedTasks) {
    const isCritical = t.priority === 'critical' || t.priority === 'high';
    const blockerDesc = t.blocker ? String(t.blocker).trim() : 'Unspecified blocker dependency';
    const riskLevel = isCritical ? 'medium' : 'low';

    actions.push({
      id: `action-unblock-${t.id}`,
      type: 'UNBLOCK_TASK',
      targetId: t.id,
      title: t.title || t.id,
      description: `Transition task '${t.title || t.id}' from blocked to in_progress to clear administrative blocker state.`,
      evidence: `Task is recorded with status "${t.status}", priority "${t.priority || 'medium'}", and blocker: "${blockerDesc}".`,
      rationale: `Clearing the blocker administratively unblocks project tracking progression. Note: Developer must verify that the underlying dependency/obstacle has been physically resolved in the real environment.`,
      tool: 'update_task_status',
      params: {
        taskId: t.id,
        status: 'in_progress'
      },
      preconditions: {
        currentStatus: t.status,
        currentBlocker: t.blocker || null,
        priority: t.priority || 'medium'
      },
      riskLevel,
      expectedImpact: isCritical
        ? 'Administratively clears 1 active critical/high blocker, mitigating an At Risk health condition.'
        : 'Administratively clears 1 active non-critical blocker from project tracking.',
      isSafeToExecute: true
    });
  }

  if (blockedTasks.length > 0) {
    limitations.push('Unblocking actions administratively clear blocker flags in persisted records; they do not physically eliminate external technical obstacles or hardware dependencies.');
  }

  // RULE 3: OVERDUE TASKS
  // In existing healthService: t.dueDate && t.status !== 'done' && new Date(t.dueDate) < now
  const now = new Date();
  const overdueTasks = safeTasks.filter(t => {
    if (!t.dueDate || t.status === 'done') return false;
    const due = new Date(t.dueDate);
    return !isNaN(due.getTime()) && due < now;
  });

  for (const ot of overdueTasks) {
    const daysOverdue = Math.max(1, Math.round((now.getTime() - new Date(ot.dueDate).getTime()) / (1000 * 60 * 60 * 24)));
    const isCritical = ot.priority === 'critical' || ot.priority === 'high';

    notRemediable.push({
      type: 'OVERDUE_TASK_MANUAL_RESCHEDULE',
      targetId: ot.id,
      title: ot.title || ot.id,
      priority: ot.priority || 'medium',
      dueDate: ot.dueDate,
      daysOverdue,
      isCritical,
      reason: 'Existing MCP write tools do not support modifying task due dates (update_task_status only accepts taskId, status, and blockerReason).',
      recommendation: `Schedule renegotiation required for '${ot.title || ot.id}' (due ${ot.dueDate}, ${daysOverdue} day(s) overdue). If finished, mark the task done; otherwise agree on an updated delivery date.`
    });
  }

  if (overdueTasks.length > 0) {
    limitations.push('Overdue task deadlines cannot be automatically modified because existing MCP write tool contracts do not support due date updates on existing tasks.');
  }

  // RULE 4: USER-RECORDED BUGS
  // Tasks with isBug === true and status !== 'done'
  const openBugs = safeTasks.filter(t => t.isBug === true && t.status !== 'done');
  for (const bug of openBugs) {
    const isCritical = bug.priority === 'critical';
    notRemediable.push({
      type: 'OPEN_BUG_MANUAL_REPAIR',
      targetId: bug.id,
      title: bug.title || bug.id,
      priority: bug.priority || 'medium',
      status: bug.status || 'todo',
      isCritical,
      reason: 'Automated rescue cannot verify source code fixes, test outcomes, or deployment states for software bugs.',
      recommendation: `Manual engineering intervention required for ${isCritical ? 'critical ' : ''}bug '${bug.title || bug.id}'. Investigate root cause, apply code fix, and verify via test suite before marking done.`
    });
  }

  if (openBugs.length > 0) {
    limitations.push('Open software bugs require manual engineering investigation and verification; automated tools cannot mark bugs resolved without verified fixes.');
  }

  // RULE 5: PROJECT-LEVEL ADMINISTRATIVE STATUS
  // If project is 'paused' or 'completed' but contains incomplete/active work
  const incompleteTasks = safeTasks.filter(t => t.status !== 'done');
  if (project.status === 'paused' && incompleteTasks.length > 0) {
    actions.push({
      id: `action-activate-${project.id}`,
      type: 'ACTIVATE_PROJECT',
      targetId: project.id,
      title: project.name || project.id,
      description: `Update project status from 'paused' to 'active' to reflect ongoing development and rescue.`,
      evidence: `Project status is currently "paused" with ${incompleteTasks.length} pending task(s).`,
      rationale: `Active rescue operations require the project to be active rather than paused.`,
      tool: 'update_project',
      params: {
        projectId: project.id,
        status: 'active'
      },
      preconditions: {
        currentStatus: project.status
      },
      riskLevel: 'low',
      expectedImpact: 'Transitions project operational status to active across project tracking views.',
      isSafeToExecute: true
    });
  }

  // RULE 6: MISSING PROJECT METADATA
  if (dataCompleteness.missingMetadata && dataCompleteness.missingMetadata.length > 0) {
    notRemediable.push({
      type: 'MISSING_PROJECT_METADATA',
      targetId: project.id,
      missingFields: dataCompleteness.missingMetadata,
      reason: 'Missing project metadata (e.g. repository URL, description, tech stack) cannot be fabricated without user input or repository connection.',
      recommendation: `Provide values for missing fields: ${dataCompleteness.missingMetadata.join(', ')} using the update_project tool or settings.`
    });
    limitations.push('Missing metadata fields are reported for manual configuration; ProjectPilot will not fabricate URLs, descriptions, or tech stacks.');
  }

  // RULE 7: DETERMINISTIC ACTION ORDERING
  // Sort priority:
  // 1. Critical blockers (priority === 'critical')
  // 2. High blockers (priority === 'high')
  // 3. Other task actions
  // 4. Project-level actions (update_project)
  // Secondary sort: targetId ascending
  actions.sort((a, b) => {
    const getOrder = (act) => {
      if (act.type === 'UNBLOCK_TASK') {
        if (act.preconditions?.priority === 'critical') return 1;
        if (act.preconditions?.priority === 'high') return 2;
        return 3;
      }
      if (act.type === 'ACTIVATE_PROJECT') return 4;
      return 5;
    };
    const orderA = getOrder(a);
    const orderB = getOrder(b);
    if (orderA !== orderB) return orderA - orderB;
    return String(a.targetId).localeCompare(String(b.targetId));
  });

  // RULE 8: HEALTHY PROJECTS (No unnecessary write actions)
  if (baselineHealth.healthStatus === 'Healthy' && actions.length === 0 && notRemediable.length === 0) {
    limitations.push('Project is currently evaluated as Healthy with no open blockers, overdue deadlines, or open bugs. No automated actions are required.');
    return {
      planId,
      projectId: project.id,
      projectName: project.name || project.id,
      createdAt,
      baselineHealth,
      dataCompleteness,
      actions: [],
      notRemediable: [],
      limitations,
      projectedHealth: {
        status: 'Healthy',
        previousStatus: 'Healthy',
        statusChange: 'No Change (Healthy)',
        isImprovement: false,
        metrics: {
          completionRate: baselineHealth.metrics?.completionRate || 0,
          totalTasks: safeTasks.length,
          completedCount: baselineHealth.metrics?.completedCount || 0,
          criticalBlockerCount: 0,
          nonCriticalBlockerCount: 0,
          overdueCount: 0,
          criticalBugCount: 0
        },
        statusReasons: ['Project is currently healthy; all recorded tasks are proceeding with no open blockers or overdue deadlines.'],
        disclaimer: 'Baseline and projected status are both Healthy. Source code and external environments remain uninspected.'
      }
    };
  }

  // RULE 9: HEALTH PROJECTION (Simulate exact effect of proposed actions)
  let projectedHealth = null;
  if (actions.length > 0) {
    // Clone project and tasks for simulation
    const simProject = { ...project };
    const simTasks = safeTasks.map(t => ({ ...t }));

    for (const act of actions) {
      if (act.tool === 'update_task_status') {
        const task = simTasks.find(t => t.id === act.params.taskId);
        if (task) {
          task.status = act.params.status;
          if (act.params.status === 'blocked') {
            task.blocker = act.params.blockerReason || task.blocker;
          } else {
            task.blocker = null;
          }
          if (act.params.status === 'done') {
            task.completedAt = new Date().toISOString();
          }
        }
      } else if (act.tool === 'update_project') {
        if (act.params.status) simProject.status = act.params.status;
      }
    }

    const healthCalc = new HealthService(null);
    const simHealth = healthCalc._calculateProjectHealth({ ...simProject, tasks: simTasks });

    const statusRanks = { 'At Risk': 3, 'Attention Needed': 2, 'Healthy': 1, 'Insufficient Data': 0 };
    const currentRank = statusRanks[baselineHealth.healthStatus] ?? 2;
    const projectedRank = statusRanks[simHealth.healthStatus] ?? 2;
    const isImprovement = projectedRank < currentRank;

    let statusChange = `${baselineHealth.healthStatus} -> ${simHealth.healthStatus}`;
    if (baselineHealth.healthStatus === simHealth.healthStatus) {
      statusChange = `No Change (${baselineHealth.healthStatus})`;
    }

    projectedHealth = {
      status: simHealth.healthStatus,
      previousStatus: baselineHealth.healthStatus,
      statusChange,
      isImprovement,
      metrics: {
        completionRate: simHealth.metrics.completionRate,
        totalTasks: simHealth.metrics.totalTasks,
        completedCount: simHealth.metrics.completedCount,
        criticalBlockerCount: simHealth.metrics.criticalBlockerCount,
        nonCriticalBlockerCount: simHealth.metrics.nonCriticalBlockerCount,
        overdueCount: simHealth.metrics.overdueCount,
        criticalBugCount: simHealth.metrics.criticalBugCount
      },
      statusReasons: simHealth.statusReasons,
      disclaimer: 'Projected health is an administrative estimate derived from proposed field changes. Actual health cannot be verified until approved actions are executed and live state is re-fetched. Uninspected source code, tests, and root causes remain unverified.'
    };
  } else {
    // No executable actions were proposed (e.g. only notRemediable items like overdue tasks or open bugs)
    projectedHealth = {
      status: baselineHealth.healthStatus,
      previousStatus: baselineHealth.healthStatus,
      statusChange: `No Change (${baselineHealth.healthStatus})`,
      isImprovement: false,
      metrics: {
        completionRate: baselineHealth.metrics?.completionRate || 0,
        totalTasks: safeTasks.length,
        completedCount: baselineHealth.metrics?.completedCount || 0,
        criticalBlockerCount: baselineHealth.metrics?.criticalBlockerCount || 0,
        nonCriticalBlockerCount: baselineHealth.metrics?.nonCriticalBlockerCount || 0,
        overdueCount: baselineHealth.metrics?.overdueCount || 0,
        criticalBugCount: baselineHealth.metrics?.criticalBugCount || 0
      },
      statusReasons: baselineHealth.statusReasons || [],
      disclaimer: 'No automated write actions were proposed. Operational health remains unchanged; manual interventions are required for non-remediable items.'
    };
  }

  return {
    planId,
    projectId: project.id,
    projectName: project.name || project.id,
    createdAt,
    baselineHealth,
    dataCompleteness,
    actions,
    notRemediable,
    limitations,
    projectedHealth
  };
}
