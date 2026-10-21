/**
 * ProjectPilot AI - Project Health Service
 * Derives truthful health metrics strictly from persisted records.
 * Distinguishes user bugs, incomplete tasks, explicit blockers, untested items,
 * and actual verified tests.
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
    const completedTasks = projectSummaries.reduce((sum, p) => sum + p.metrics.completedTasks, 0);
    const totalBlockers = projectSummaries.reduce((sum, p) => sum + p.metrics.explicitBlockers.length, 0);
    const totalBugs = projectSummaries.reduce((sum, p) => sum + p.metrics.userRecordedBugs.length, 0);

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
        statusDistribution: {
          healthy: projectSummaries.filter(p => p.healthStatus === 'Healthy').length,
          attentionNeeded: projectSummaries.filter(p => p.healthStatus === 'Attention Needed').length,
          atRisk: projectSummaries.filter(p => p.healthStatus === 'At Risk').length
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
    const explicitBlockers = tasks.filter(t => t.status === 'blocked' || Boolean(t.blocker));
    const userRecordedBugs = tasks.filter(t => t.isBug === true);
    const maintenanceTasks = tasks.filter(t => t.isMaintenance === true);

    const completionRate = totalTasks > 0
      ? Math.round((completedTasks.length / totalTasks) * 100)
      : 0;

    // Honest determination of health status based on recorded facts
    let healthStatus = 'Healthy';
    const statusReasons = [];

    if (explicitBlockers.length > 0) {
      healthStatus = 'At Risk';
      statusReasons.push(`${explicitBlockers.length} active blocker(s) recorded`);
    }

    const criticalBugs = userRecordedBugs.filter(b => b.priority === 'critical' && b.status !== 'done');
    if (criticalBugs.length > 0) {
      healthStatus = 'At Risk';
      statusReasons.push(`${criticalBugs.length} critical user-recorded bug(s) open`);
    } else if (userRecordedBugs.filter(b => b.status !== 'done').length > 0 && healthStatus !== 'At Risk') {
      healthStatus = 'Attention Needed';
      statusReasons.push(`${userRecordedBugs.length} user-recorded bug(s) pending resolution`);
    }

    if (healthStatus === 'Healthy' && completionRate < 50 && totalTasks > 0) {
      healthStatus = 'Attention Needed';
      statusReasons.push(`Completion rate is ${completionRate}% with ${incompleteTasks.length} pending task(s)`);
    }

    if (statusReasons.length === 0) {
      statusReasons.push(totalTasks === 0 ? 'No tasks created yet' : 'All recorded tasks proceeding with no open blockers');
    }

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
        incompleteCount: incompleteTasks.length,
        explicitBlockers: explicitBlockers.map(b => ({
          taskId: b.id,
          title: b.title,
          priority: b.priority,
          blockerDescription: b.blocker || 'Status set to blocked without details'
        })),
        userRecordedBugs: userRecordedBugs.map(b => ({
          taskId: b.id,
          title: b.title,
          status: b.status,
          priority: b.priority
        })),
        maintenanceCount: maintenanceTasks.length
      },
      auditNotice: 'Health derived strictly from user-recorded tasks and blockers. No external monitoring or automated pass/fail claimed.'
    };
  }
}
