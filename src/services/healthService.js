/**
 * ProjectPilot AI - Project Health Service
 * Derives truthful health metrics strictly from persisted records.
 * Distinguishes user bugs, incomplete tasks, critical vs non-critical blockers,
 * overdue work, and clearly audits evidence vs unverified claims.
 */

export class HealthService {
  constructor(store) {
    this.store = store;
  }

  /**
   * Derive project health for a single project or all projects.
   * @param {string|null} projectId
   */
  getHealth(projectId = null) {
    if (projectId) {
      const project = this.store.getProject(projectId);
      if (!project) {
        throw new Error(`Project not found with ID "${projectId}".`);
      }
      return this._calculateProjectHealth(project);
    }

    const allProjects = this.store.listProjects();
    const projectSummaries = allProjects.map(p => {
      const full = this.store.getProject(p.id);
      return this._calculateProjectHealth(full);
    });

    const totalTasks = projectSummaries.reduce((sum, p) => sum + p.metrics.totalTasks, 0);
    const completedTasks = projectSummaries.reduce((sum, p) => sum + p.metrics.completedCount, 0);
    const totalBlockers = projectSummaries.reduce((sum, p) => sum + p.metrics.explicitBlockers.length, 0);
    const totalBugs = projectSummaries.reduce((sum, p) => sum + p.metrics.userRecordedBugs.length, 0);
    const totalOverdue = projectSummaries.reduce((sum, p) => sum + p.metrics.overdueCount, 0);

    return {
      scope: 'all_projects',
      generatedAt: new Date().toISOString(),
      aggregate: {
        totalProjects: allProjects.length,
        totalTasks,
        completedTasks,
        overallCompletionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        totalBlockers,
        totalBugs,
        totalOverdue,
        statusDistribution: {
          healthy: projectSummaries.filter(p => p.healthStatus === 'Healthy').length,
          attentionNeeded: projectSummaries.filter(p => p.healthStatus === 'Attention Needed').length,
          atRisk: projectSummaries.filter(p => p.healthStatus === 'At Risk').length,
          insufficientData: projectSummaries.filter(p => p.healthStatus === 'Insufficient Data').length
        }
      },
      projects: projectSummaries
    };
  }

  _calculateProjectHealth(project) {
    const tasks = project.tasks || [];
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'done');
    const incompleteTasks = tasks.filter(t => t.status !== 'done');

    // Active blockers: tasks that are explicitly blocked or have an unresolved blocker description
    const explicitBlockers = tasks.filter(t => {
      if (t.blockerResolved === true) return false;
      if (t.blocker && String(t.blocker).trim().toLowerCase() === 'resolved') return false;
      if (t.status === 'blocked') return true;
      if (Boolean(t.blocker)) return true;
      return false;
    });

    // Blocker severity classification
    const criticalBlockers = explicitBlockers.filter(b => b.priority === 'critical' || b.priority === 'high');
    const nonCriticalBlockers = explicitBlockers.filter(b => b.priority !== 'critical' && b.priority !== 'high');

    // User-recorded bug classification
    const userRecordedBugs = tasks.filter(t => t.isBug === true);
    const openBugs = userRecordedBugs.filter(b => b.status !== 'done');
    const criticalBugs = openBugs.filter(b => b.priority === 'critical');
    const nonCriticalBugs = openBugs.filter(b => b.priority !== 'critical');

    // Maintenance tasks
    const maintenanceTasks = tasks.filter(t => t.isMaintenance === true);

    // Overdue work classification (completed tasks are never overdue)
    const now = new Date();
    const overdueTasks = tasks.filter(t => {
      if (!t.dueDate || t.status === 'done') return false;
      const due = new Date(t.dueDate);
      return !isNaN(due.getTime()) && due < now;
    });
    const overdueCriticalOrHigh = overdueTasks.filter(t => t.priority === 'critical' || t.priority === 'high');
    const overdueNormal = overdueTasks.filter(t => t.priority !== 'critical' && t.priority !== 'high');

    const completionRate = totalTasks > 0
      ? Math.round((completedTasks.length / totalTasks) * 100)
      : 0;

    const taskProgress = totalTasks === 0
      ? 'No task data'
      : `${completionRate}% (${completedTasks.length}/${totalTasks} completed)`;

    // Transparent health model precedence
    let healthStatus = 'Healthy';
    const statusReasons = [];

    if (totalTasks === 0) {
      // Rule 1: A project with zero registered tasks must NEVER be reported as Healthy
      healthStatus = 'Insufficient Data';
      statusReasons.push('No registered tasks are available to evaluate progress.');
    } else {
      // Rule 2: Active critical blockers indicate At Risk (even if completion is high)
      if (criticalBlockers.length > 0) {
        healthStatus = 'At Risk';
        statusReasons.push(`${criticalBlockers.length} active blocker(s) recorded (critical/high priority)`);
      }

      // Rule 3: Critical open bugs indicate At Risk
      if (criticalBugs.length > 0) {
        healthStatus = 'At Risk';
        statusReasons.push(`${criticalBugs.length} critical user-recorded bug(s) open`);
      }

      // Rule 4: Overdue critical or high tasks indicate At Risk
      if (overdueCriticalOrHigh.length > 0) {
        healthStatus = 'At Risk';
        statusReasons.push(`${overdueTasks.length} overdue task(s) past deadline (${overdueCriticalOrHigh.length} critical/high priority)`);
      }

      // Rule 5: Active non-critical blockers indicate Attention Needed (unless already At Risk)
      if (nonCriticalBlockers.length > 0) {
        if (healthStatus !== 'At Risk') {
          healthStatus = 'Attention Needed';
        }
        statusReasons.push(`${nonCriticalBlockers.length} active non-critical blocker(s) recorded`);
      }

      // Rule 6: Non-critical open bugs indicate Attention Needed (unless already At Risk)
      if (nonCriticalBugs.length > 0) {
        if (healthStatus !== 'At Risk') {
          healthStatus = 'Attention Needed';
        }
        statusReasons.push(`${nonCriticalBugs.length} user-recorded bug(s) pending resolution`);
      }

      // Rule 7: Ordinary overdue tasks indicate Attention Needed (unless already At Risk)
      if (overdueNormal.length > 0) {
        if (healthStatus !== 'At Risk') {
          healthStatus = 'Attention Needed';
        }
        statusReasons.push(`${overdueNormal.length} overdue task(s) past deadline`);
      }

      // Rule 8: Incomplete tasks with completion < 50% indicate Attention Needed (unless already At Risk)
      if (completionRate < 50) {
        if (healthStatus !== 'At Risk') {
          healthStatus = 'Attention Needed';
        }
        statusReasons.push(`Completion rate is ${completionRate}% with ${incompleteTasks.length} pending task(s)`);
      }

      // Rule 9: Healthy if no negative conditions
      if (statusReasons.length === 0) {
        statusReasons.push('All recorded tasks proceeding with no open blockers or overdue deadlines');
      }
    }

    const dataCompleteness = this._assessDataCompleteness(project, tasks);

    return {
      projectId: project.id,
      projectName: project.name,
      projectStatus: project.status,
      priority: project.priority,
      healthStatus,
      statusReasons,
      metrics: {
        totalTasks,
        completedCount: completedTasks.length,
        completionRate,
        taskProgress,
        incompleteCount: incompleteTasks.length,
        overdueCount: overdueTasks.length,
        overdueTasks: overdueTasks.map(o => ({
          taskId: o.id,
          title: o.title,
          priority: o.priority,
          dueDate: o.dueDate,
          daysOverdue: Math.max(1, Math.round((now.getTime() - new Date(o.dueDate).getTime()) / (1000 * 60 * 60 * 24)))
        })),
        explicitBlockers: explicitBlockers.map(b => ({
          taskId: b.id,
          title: b.title,
          priority: b.priority,
          isCritical: b.priority === 'critical' || b.priority === 'high',
          blockerDescription: b.blocker || 'Status set to blocked without details'
        })),
        criticalBlockerCount: criticalBlockers.length,
        nonCriticalBlockerCount: nonCriticalBlockers.length,
        userRecordedBugs: userRecordedBugs.map(b => ({
          taskId: b.id,
          title: b.title,
          status: b.status,
          priority: b.priority,
          isCritical: b.priority === 'critical'
        })),
        criticalBugCount: criticalBugs.length,
        maintenanceCount: maintenanceTasks.length
      },
      evidence: {
        sourceInspectionStatus: 'Source code not inspected (no repository analyzer connected)',
        repositoryStatus: project.repoUrl
          ? `Registered remote URL (${project.repoUrl}) - remote git commits and test suites uninspected`
          : 'Repository not connected',
        testAuditStatus: 'No automated test audit performed by this system (external test suites not executed)',
        securityAuditStatus: 'Unverified (no security or dependency scanning executed)',
        maintenanceAuditStatus: 'Maintenance tracking reflects user-registered tasks only; no infrastructure daemon connected',
        dataCompleteness,
        lastVerifiedTime: new Date().toISOString()
      },
      auditNotice: 'ProjectPilot derives intelligence strictly from registered user records. Zero user-recorded bugs or tasks indicates absence of logged records, not absence of software defects. Source code, test coverage, and runtime security remain unverified unless a verified analyzer integration is connected.'
    };
  }

  _assessDataCompleteness(project, tasks) {
    const missingMetadata = [];
    if (!project.description || !project.description.trim()) missingMetadata.push('description');
    if (!project.category || !project.category.trim() || project.category.trim() === 'General') missingMetadata.push('category');
    if (!Array.isArray(project.techStack) || project.techStack.length === 0) missingMetadata.push('techStack');
    if (!project.repoUrl || !project.repoUrl.trim()) missingMetadata.push('repoUrl');

    const missingRecords = [];
    if (!tasks || tasks.length === 0) {
      missingRecords.push('tasks (no recorded tasks to evaluate progress)');
    }

    const allMissing = [...missingMetadata, ...missingRecords];
    const totalChecklist = 5;
    const registeredCount = totalChecklist - allMissing.length;
    const percentage = Math.round((registeredCount / totalChecklist) * 100);

    let rating = 'Complete';
    if (percentage <= 40) rating = 'Minimal';
    else if (percentage < 80) rating = 'Partial';

    return {
      percentage,
      rating,
      missingMetadata,
      missingRecords,
      missingFields: allMissing,
      hasTaskRecords: Boolean(tasks && tasks.length > 0),
      summary: `${registeredCount}/${totalChecklist} core fields registered (${rating})`
    };
  }
}
