/**
 * ProjectPilot AI - Maintenance Tracking Service
 * Manages developer maintenance tasks (certs, migrations, db vacuums, credential rotation)
 * associated with projects without claiming simulated external automated monitoring.
 */

export class MaintenanceService {
  constructor(store) {
    this.store = store;
  }

  /**
   * List and categorize maintenance tasks.
   * @param {Object} options - { projectId, includeCompleted }
   */
  getMaintenanceSummary(options = {}) {
    const { projectId = null, includeCompleted = false } = options;
    const now = new Date();

    const tasks = this.store.listTasks({
      projectId,
      isMaintenance: true
    });

    const projectsMap = new Map();
    for (const p of this.store.listProjects()) {
      projectsMap.set(p.id, p);
    }

    const overdue = [];
    const dueSoon = [];
    const scheduledLater = [];
    const noDueDate = [];
    const completed = [];

    for (const task of tasks) {
      const project = projectsMap.get(task.projectId);
      const enhanced = {
        taskId: task.id,
        title: task.title,
        description: task.description,
        projectId: task.projectId,
        projectName: project ? project.name : 'Unknown',
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        completedAt: task.completedAt
      };

      if (task.status === 'done') {
        completed.push(enhanced);
        continue;
      }

      if (!task.dueDate) {
        noDueDate.push(enhanced);
        continue;
      }

      const dueTime = new Date(task.dueDate).getTime();
      const diffDays = (dueTime - now.getTime()) / (1000 * 60 * 60 * 24);

      if (diffDays < 0) {
        enhanced.daysOverdue = Math.max(1, Math.round(Math.abs(diffDays)));
        overdue.push(enhanced);
      } else if (diffDays <= 7) {
        enhanced.daysRemaining = Math.max(0, Math.ceil(diffDays));
        dueSoon.push(enhanced);
      } else {
        enhanced.daysRemaining = Math.ceil(diffDays);
        scheduledLater.push(enhanced);
      }
    }

    // Sort overdue by most overdue
    overdue.sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0));
    // Sort dueSoon by closest deadline
    dueSoon.sort((a, b) => (a.daysRemaining || 0) - (b.daysRemaining || 0));

    const totalMaintenance = tasks.length;
    const pendingCount = overdue.length + dueSoon.length + scheduledLater.length + noDueDate.length;

    return {
      scope: projectId ? `Project: ${projectId}` : 'All Projects',
      totalMaintenanceTasks: totalMaintenance,
      pendingCount,
      completedCount: completed.length,
      categories: {
        overdue,
        dueSoon,
        scheduledLater,
        noDueDate,
        ...(includeCompleted ? { completed } : {})
      },
      monitoringDisclaimer: 'Maintenance tracking relies on user-recorded schedules and task completions. Automatic cloud health or domain expiration probes are not integrated.'
    };
  }
}
