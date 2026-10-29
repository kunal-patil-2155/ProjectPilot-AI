/**
 * ProjectPilot AI - Priority Recommendations Service
 * Transparent prioritisation mechanism based strictly on available information.
 * Computes deterministic scores and explains why each task is recommended.
 */

export class PriorityService {
  constructor(store) {
    this.store = store;
  }

  /**
   * Calculate transparent priority recommendations across pending tasks.
   * @param {Object} options - { projectId, limit }
   */
  getRecommendations(options = {}) {
    const { projectId = null, limit = 5 } = options;
    const now = new Date();

    // Get incomplete tasks
    let tasks = this.store.listTasks({
      projectId,
      status: null
    }).filter(t => t.status !== 'done');

    const projectsMap = new Map();
    for (const p of this.store.listProjects()) {
      projectsMap.set(p.id, p);
    }

    const scoredTasks = tasks.map(task => {
      const project = projectsMap.get(task.projectId);
      let score = 0;
      const reasons = [];

      // 1. Explicit Priority
      switch (task.priority) {
        case 'critical':
          score += 40;
          reasons.push('Marked as Critical priority (+40 pts)');
          break;
        case 'high':
          score += 30;
          reasons.push('Marked as High priority (+30 pts)');
          break;
        case 'medium':
          score += 20;
          reasons.push('Marked as Medium priority (+20 pts)');
          break;
        case 'low':
          score += 10;
          reasons.push('Marked as Low priority (+10 pts)');
          break;
      }

      // 2. User-recorded Bug
      if (task.isBug) {
        score += 15;
        reasons.push('User-reported defect/bug (+15 pts)');
      }

      // 3. Due Date Urgency
      if (task.dueDate) {
        const dueDate = new Date(task.dueDate);
        const diffMs = dueDate.getTime() - now.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        if (diffDays < 0) {
          score += 25;
          const overdueDays = Math.max(1, Math.round(Math.abs(diffDays)));
          reasons.push(`Overdue by approximately ${overdueDays} day(s) (+25 pts)`);
        } else if (diffDays <= 1) {
          score += 20;
          reasons.push('Due within 24 hours (+20 pts)');
        } else if (diffDays <= 3) {
          score += 10;
          reasons.push(`Due in ${Math.ceil(diffDays)} days (+10 pts)`);
        } else if (diffDays <= 7) {
          score += 5;
          reasons.push(`Due in ${Math.ceil(diffDays)} days (+5 pts)`);
        }
      }

      // 4. Project Status & Priority
      if (project) {
        if (project.status === 'active') {
          score += 10;
          reasons.push(`Belongs to active project "${project.name}" (+10 pts)`);
        } else if (project.status === 'planning') {
          score += 5;
          reasons.push(`Belongs to planning project "${project.name}" (+5 pts)`);
        } else if (project.status === 'paused') {
          score -= 10;
          reasons.push(`Project "${project.name}" is currently paused (-10 pts)`);
        }

        if (project.priority === 'critical') {
          score += 10;
          reasons.push('Parent project is Critical priority (+10 pts)');
        }
      }

      // 5. Blocker Considerations
      let executionReadiness = 'Ready';
      if (task.status === 'blocked' || task.blocker) {
        executionReadiness = 'Blocked — Unblocking Required';
        // Blockers require immediate attention to unblock, but cannot be completed directly;
        // apply a 20-point penalty so executable tasks rightfully take priority
        score -= 20;
        reasons.push('Active blocker penalty (-20 pts)');
        reasons.push(`Blocked: "${task.blocker || 'Recorded as blocked'}"`);
      } else if (task.status === 'in_progress') {
        score += 8;
        reasons.push('Already in progress — finish existing work before switching (+8 pts)');
      }

      return {
        taskId: task.id,
        title: task.title,
        projectId: task.projectId,
        projectName: project ? project.name : 'Unknown',
        currentStatus: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        isBug: Boolean(task.isBug),
        isMaintenance: Boolean(task.isMaintenance),
        executionReadiness,
        score,
        reasons
      };
    });

    // Sort: 1. Score (descending), 2. Due Date (earliest first), 3. Task ID (stable ascending)
    scoredTasks.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const timeA = a.dueDate ? new Date(a.dueDate).getTime() : NaN;
      const timeB = b.dueDate ? new Date(b.dueDate).getTime() : NaN;
      const validA = !Number.isNaN(timeA);
      const validB = !Number.isNaN(timeB);

      if (validA && validB) {
        if (timeA !== timeB) return timeA - timeB;
      } else if (validA && !validB) {
        return -1;
      } else if (!validA && validB) {
        return 1;
      }
      return String(a.taskId).localeCompare(String(b.taskId));
    });

    const recommendations = scoredTasks.slice(0, limit);

    return {
      evaluatedTaskCount: tasks.length,
      recommendationCount: recommendations.length,
      methodology: 'Deterministic scoring: priority tier + due date proximity + bug urgency + project status - blockers (tie-breakers: due date, task ID).',
      recommendations
    };
  }
}
