/**
 * ProjectPilot AI - Frontend Application Entrypoint
 * Orchestrates views, handles user interactions, manages accessible dialogs,
 * and communicates exclusively through the Model Context Protocol (MCP) client.
 */

import { McpBrowserClient } from './api/mcpClient.js';
import { AssistantOrchestrator } from './orchestrator.js';

// Application State
const state = {
  mcpClient: null,
  orchestrator: null,
  activeView: 'dashboard',
  projects: [],
  tasks: [],
  health: null,
  recommendations: [],
  maintenance: null,
  voiceEnabled: true,
  telemetryLog: []
};

// ==========================================================================
// INITIALIZATION
// ==========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  setupModernDialogFallbacks();
  setupNavigation();
  setupModals();
  setupAssistantChat();
  setupInspector();

  // Initialize MCP client
  state.mcpClient = new McpBrowserClient('/mcp');
  state.orchestrator = new AssistantOrchestrator(state.mcpClient);

  // Hook into MCP telemetry events
  state.mcpClient.onEvent((event, payload) => {
    recordTelemetry(event, payload);
    updateMcpStatusUi();
  });

  try {
    showToast('Initializing MCP Streamable HTTP session...', 'info');
    await state.mcpClient.connect();
    showToast('MCP Connected (Streamable HTTP 2025-11-25)', 'success');
    await refreshAllData();
  } catch (err) {
    console.error('Initial MCP connection error:', err);
    showToast(`MCP Connection Error: ${err.message}`, 'error');
  }
});

// ==========================================================================
// MODERN WEB GUIDANCE: ACCESSIBLE DIALOGS & LIGHT DISMISS FALLBACK
// ==========================================================================

function setupModernDialogFallbacks() {
  const dialogs = document.querySelectorAll('dialog');
  dialogs.forEach(dialog => {
    // If browser doesn't natively support closedby="any", fallback outside click handler
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isContent = (
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width
        );
        if (!isContent) {
          dialog.close();
        }
      });
    }
  });
}

// ==========================================================================
// NAVIGATION & VIEW SWITCHING
// ==========================================================================

function setupNavigation() {
  const sidebar = document.getElementById('appSidebar');
  const toggleBtn = document.getElementById('sidebarToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
    });
  }

  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const viewName = item.dataset.view;
      switchView(viewName);
    });
  });

  const refreshBtn = document.getElementById('refreshDashboardBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      await refreshAllData();
      showToast('All telemetry re-synchronized via MCP', 'success');
      refreshBtn.disabled = false;
    });
  }
}

function switchView(viewName) {
  state.activeView = viewName;
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  const targetPanel = document.getElementById(`view${capitalize(viewName)}`);
  if (targetPanel) {
    targetPanel.classList.add('active');
  }
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ==========================================================================
// DATA REFRESH VIA MCP TOOLS
// ==========================================================================

async function refreshAllData() {
  if (!state.mcpClient) return;

  try {
    // 1. list_projects
    const projRes = await state.mcpClient.callTool('list_projects', {});
    state.projects = projRes.data?.projects || [];

    // 2. list_tasks
    const tasksRes = await state.mcpClient.callTool('list_tasks', {});
    state.tasks = tasksRes.data?.tasks || [];

    // 3. get_project_health
    const healthRes = await state.mcpClient.callTool('get_project_health', {});
    state.health = healthRes.data;

    // 4. get_priority_recommendations
    const recsRes = await state.mcpClient.callTool('get_priority_recommendations', { limit: 5 });
    state.recommendations = recsRes.data?.recommendations || [];

    // 5. list_maintenance_tasks
    const maintRes = await state.mcpClient.callTool('list_maintenance_tasks', { includeCompleted: true });
    state.maintenance = maintRes.data;

    renderDashboard();
    renderProjects();
    renderTasks();
    renderHealthAndBlockers();
    renderMaintenance();
    updateSidebarCounters();
    populateProjectDropdowns();
  } catch (err) {
    console.error('Failed to sync data via MCP:', err);
    showToast(`Sync error: ${err.message}`, 'error');
  }
}

function updateSidebarCounters() {
  const projCount = document.getElementById('navProjectCount');
  if (projCount) projCount.textContent = state.projects.length;

  const taskCount = document.getElementById('navTaskCount');
  if (taskCount) taskCount.textContent = state.tasks.filter(t => t.status !== 'done').length;

  const blockers = state.tasks.filter(t => t.status === 'blocked' || t.blocker);
  const blockerCount = document.getElementById('navBlockerCount');
  if (blockerCount) blockerCount.textContent = blockers.length;

  const maintCount = document.getElementById('navMaintenanceCount');
  if (maintCount && state.maintenance) {
    maintCount.textContent = state.maintenance.pendingCount || 0;
  }
}

// ==========================================================================
// RENDER: DASHBOARD OVERVIEW
// ==========================================================================

function renderDashboard() {
  // Stats
  const activeProjects = state.projects.filter(p => p.status === 'active');
  const pendingTasks = state.tasks.filter(t => t.status !== 'done');
  const activeBlockers = state.tasks.filter(t => t.status === 'blocked' || t.blocker);
  const maintenancePending = state.maintenance?.pendingCount || 0;

  document.getElementById('statActiveProjects').textContent = activeProjects.length;
  document.getElementById('statOpenTasks').textContent = pendingTasks.length;
  document.getElementById('statActiveBlockers').textContent = activeBlockers.length;
  document.getElementById('statMaintenanceDue').textContent = maintenancePending;

  // Recommendations
  const container = document.getElementById('priorityRecommendationsList');
  if (!container) return;

  if (state.recommendations.length === 0) {
    container.innerHTML = '<div class="empty-state">No pending tasks to prioritize.</div>';
    return;
  }

  container.innerHTML = state.recommendations.map(rec => `
    <div class="recommendation-item">
      <div class="rec-header">
        <div class="rec-title-group">
          <span class="rec-score-badge">${rec.score} pts</span>
          <span class="badge badge-${rec.priority}">${rec.priority}</span>
          <span class="rec-title">${escapeHtml(rec.title)}</span>
        </div>
        <button class="btn btn-secondary btn-sm quick-complete-btn" data-task-id="${rec.taskId}">Complete</button>
      </div>
      <div class="rec-project">Project: <strong>${escapeHtml(rec.projectName)}</strong> | Status: ${rec.currentStatus} | Readiness: ${rec.executionReadiness}</div>
      <ul class="rec-reasons">
        ${rec.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
      </ul>
    </div>
  `).join('');

  container.querySelectorAll('.quick-complete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const taskId = btn.dataset.taskId;
      await handleCompleteTask(taskId);
    });
  });
}

// ==========================================================================
// RENDER: PROJECTS VIEW
// ==========================================================================

function renderProjects() {
  const grid = document.getElementById('projectsGrid');
  if (!grid) return;

  const statusFilter = document.getElementById('projectFilterStatus')?.value || '';
  const priorityFilter = document.getElementById('projectFilterPriority')?.value || '';

  let filtered = [...state.projects];
  if (statusFilter) filtered = filtered.filter(p => p.status === statusFilter);
  if (priorityFilter) filtered = filtered.filter(p => p.priority === priorityFilter);

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state">No projects found matching current filters.</div>';
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const tasks = state.tasks.filter(t => t.projectId === p.id);
    const completed = tasks.filter(t => t.status === 'done').length;
    const progress = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;
    const blockers = tasks.filter(t => t.status === 'blocked' || t.blocker).length;

    return `
      <div class="project-card">
        <div class="project-category">${escapeHtml(p.category || 'General')}</div>
        <div class="project-card-header">
          <div class="project-name">${escapeHtml(p.name)}</div>
          <span class="badge badge-${p.priority}">${p.priority}</span>
        </div>
        <p class="project-desc">${escapeHtml(p.description || 'No description provided.')}</p>

        <div class="tech-stack-row">
          ${(p.techStack || []).map(t => `<span class="tech-tag">${escapeHtml(t)}</span>`).join('')}
        </div>

        <div class="project-progress-bar">
          <div class="project-progress-fill" style="width: ${progress}%"></div>
        </div>

        <div class="project-meta-row">
          <span>${completed} of ${tasks.length} tasks done (${progress}%)</span>
          ${blockers > 0 ? `<span class="text-danger">⚠️ ${blockers} blocker(s)</span>` : `<span class="badge badge-done">Active</span>`}
        </div>

        <div class="project-actions">
          <button class="btn btn-secondary btn-sm inspect-proj-btn" data-proj-id="${p.id}" data-proj-name="${escapeHtml(p.name)}">
            Inspect via MCP
          </button>
          <button class="btn btn-secondary btn-sm edit-proj-btn" data-proj-id="${p.id}">Edit</button>
          <button class="btn btn-icon delete-proj-btn" data-proj-id="${p.id}" title="Delete project">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.inspect-proj-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const projName = btn.dataset.projName;
      switchView('assistant');
      await executeAssistantPrompt(`Investigate project ${projName}`);
    });
  });

  grid.querySelectorAll('.edit-proj-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openEditProjectModal(btn.dataset.projId);
    });
  });

  grid.querySelectorAll('.delete-proj-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const projId = btn.dataset.projId;
      if (confirm(`Are you sure you want to delete project ${projId} and its tasks?`)) {
        await handleDeleteProject(projId);
      }
    });
  });
}

// ==========================================================================
// RENDER: TASKS VIEW
// ==========================================================================

function renderTasks() {
  const tbody = document.getElementById('tasksTableBody');
  if (!tbody) return;

  const projFilter = document.getElementById('taskFilterProject')?.value || '';
  const statusFilter = document.getElementById('taskFilterStatus')?.value || '';
  const priorityFilter = document.getElementById('taskFilterPriority')?.value || '';

  let filtered = [...state.tasks];
  if (projFilter) filtered = filtered.filter(t => t.projectId === projFilter);
  if (statusFilter) filtered = filtered.filter(t => t.status === statusFilter);
  if (priorityFilter) filtered = filtered.filter(t => t.priority === priorityFilter);

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No tasks matching filters.</td></tr>';
    return;
  }

  const projMap = new Map(state.projects.map(p => [p.id, p]));

  tbody.innerHTML = filtered.map(task => {
    const project = projMap.get(task.projectId);
    const dueDateDisplay = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—';
    const isOverdue = task.dueDate && task.status !== 'done' && new Date(task.dueDate) < new Date();

    let flagsHtml = '';
    if (task.isBug) flagsHtml += '<span class="badge badge-critical" style="margin-right:4px;">BUG</span>';
    if (task.isMaintenance) flagsHtml += '<span class="badge badge-mcp" style="margin-right:4px;">MAINT</span>';
    if (task.blocker) flagsHtml += `<div class="text-danger" style="font-size:0.75rem; margin-top:2px;">🛑 ${escapeHtml(task.blocker)}</div>`;

    return `
      <tr>
        <td>
          <select class="select-field task-status-select" data-task-id="${task.id}" style="padding:4px 8px; width:auto; font-size:0.75rem;">
            <option value="todo" ${task.status === 'todo' ? 'selected' : ''}>Todo</option>
            <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
            <option value="blocked" ${task.status === 'blocked' ? 'selected' : ''}>Blocked</option>
            <option value="done" ${task.status === 'done' ? 'selected' : ''}>Done</option>
          </select>
        </td>
        <td>
          <div style="font-weight:600;">${escapeHtml(task.title)}</div>
          ${task.description ? `<div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(task.description)}</div>` : ''}
        </td>
        <td>${escapeHtml(project ? project.name : task.projectId)}</td>
        <td><span class="badge badge-${task.priority}">${task.priority}</span></td>
        <td class="${isOverdue ? 'text-danger font-bold' : ''}">${dueDateDisplay}</td>
        <td>${flagsHtml || '<span style="color:var(--text-muted);">—</span>'}</td>
        <td>
          <div style="display:flex; gap:6px;">
            ${task.status !== 'done' ? `
              <button class="btn btn-secondary btn-sm task-done-btn" data-task-id="${task.id}" title="Mark completed">
                ✓ Done
              </button>
            ` : ''}
            <button class="btn btn-icon task-delete-btn" data-task-id="${task.id}" title="Delete task">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.task-status-select').forEach(select => {
    select.addEventListener('change', async (e) => {
      const taskId = select.dataset.taskId;
      const newStatus = select.value;
      let blockerReason = null;
      if (newStatus === 'blocked') {
        blockerReason = prompt('Enter blocker details:', 'External dependency issue') || 'Blocked';
      }
      await handleUpdateTaskStatus(taskId, newStatus, blockerReason);
    });
  });

  tbody.querySelectorAll('.task-done-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await handleCompleteTask(btn.dataset.taskId);
    });
  });

  tbody.querySelectorAll('.task-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('Delete this task?')) {
        await handleDeleteTask(btn.dataset.taskId);
      }
    });
  });
}

// ==========================================================================
// RENDER: HEALTH & BLOCKERS VIEW
// ==========================================================================

function renderHealthAndBlockers() {
  const blockersList = document.getElementById('blockersDetailList');
  const healthContainer = document.getElementById('projectHealthCards');
  const badge = document.getElementById('blockerCountBadge');

  const blockedTasks = state.tasks.filter(t => t.status === 'blocked' || t.blocker);
  if (badge) badge.textContent = blockedTasks.length;

  if (blockersList) {
    if (blockedTasks.length === 0) {
      blockersList.innerHTML = '<div class="empty-state">No active blockers recorded across projects.</div>';
    } else {
      const projMap = new Map(state.projects.map(p => [p.id, p]));
      blockersList.innerHTML = blockedTasks.map(t => {
        const project = projMap.get(t.projectId);
        return `
          <div class="blocker-item">
            <div class="blocker-task-title">${escapeHtml(t.title)}</div>
            <div class="blocker-reason-text">🛑 Blocker: ${escapeHtml(t.blocker || 'Recorded as blocked')}</div>
            <div style="font-size:0.75rem; color:var(--text-muted); display:flex; justify-content:space-between; align-items:center;">
              <span>Project: <strong>${escapeHtml(project ? project.name : t.projectId)}</strong></span>
              <button class="btn btn-secondary btn-sm unblock-btn" data-task-id="${t.id}">Unblock & Move to In Progress</button>
            </div>
          </div>
        `;
      }).join('');

      blockersList.querySelectorAll('.unblock-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          await handleUpdateTaskStatus(btn.dataset.taskId, 'in_progress', null);
        });
      });
    }
  }

  if (healthContainer && state.health?.projects) {
    healthContainer.innerHTML = state.health.projects.map(hp => {
      const statusClass = hp.healthStatus === 'Healthy' ? 'health-healthy' : (hp.healthStatus === 'At Risk' ? 'health-risk' : 'health-attention');
      return `
        <div class="health-project-row">
          <div>
            <div style="font-weight:700;">${escapeHtml(hp.projectName)}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">
              ${hp.metrics.totalTasks} total tasks | ${hp.metrics.completedCount} completed (${hp.metrics.completionRate}%) | ${hp.metrics.explicitBlockers.length} blockers | ${hp.metrics.userRecordedBugs.length} bugs
            </div>
            ${hp.statusReasons?.length ? `<div style="font-size:0.75rem; color:var(--text-secondary); margin-top:4px;">${escapeHtml(hp.statusReasons.join(', '))}</div>` : ''}
          </div>
          <span class="health-status-badge ${statusClass}">${hp.healthStatus}</span>
        </div>
      `;
    }).join('');
  }
}

// ==========================================================================
// RENDER: MAINTENANCE VIEW
// ==========================================================================

function renderMaintenance() {
  if (!state.maintenance) return;

  const categories = state.maintenance.categories || {};
  const overdue = categories.overdue || [];
  const dueSoon = categories.dueSoon || [];
  const scheduled = categories.scheduledLater || [];

  document.getElementById('maintOverdueBadge').textContent = overdue.length;
  document.getElementById('maintDueSoonBadge').textContent = dueSoon.length;
  document.getElementById('maintScheduledBadge').textContent = scheduled.length;

  renderMaintenanceList('maintOverdueList', overdue, true);
  renderMaintenanceList('maintDueSoonList', dueSoon, false);
  renderMaintenanceList('maintScheduledList', scheduled, false);
}

function renderMaintenanceList(elementId, items, isOverdue) {
  const container = document.getElementById(elementId);
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state">${isOverdue ? 'No overdue maintenance items.' : 'No maintenance tasks in this category.'}</div>`;
    return;
  }

  container.innerHTML = items.map(m => `
    <div class="maintenance-item">
      <div style="font-weight:600; font-size:0.88rem;">${escapeHtml(m.title)}</div>
      <div style="font-size:0.76rem; color:var(--text-muted); margin: 4px 0;">Project: ${escapeHtml(m.projectName)} | Due: ${new Date(m.dueDate).toLocaleDateString()}</div>
      ${isOverdue ? `<div class="text-danger" style="font-size:0.74rem; font-weight:700;">⚠️ ${m.daysOverdue} day(s) overdue</div>` : ''}
      <div style="margin-top:8px;">
        <button class="btn btn-secondary btn-sm quick-complete-btn" data-task-id="${m.taskId}">Mark Completed</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.quick-complete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await handleCompleteTask(btn.dataset.taskId);
    });
  });
}

// ==========================================================================
// MCP OPERATIONS: CRUD HANDLERS
// ==========================================================================

async function handleCompleteTask(taskId) {
  try {
    showToast(`Calling MCP tool update_task_status (done)...`, 'info');
    await state.mcpClient.callTool('update_task_status', {
      taskId,
      status: 'done'
    });
    showToast(`Task marked as completed!`, 'success');
    await refreshAllData();
  } catch (err) {
    showToast(`Failed to complete task: ${err.message}`, 'error');
  }
}

async function handleUpdateTaskStatus(taskId, status, blockerReason) {
  try {
    showToast(`Updating task via MCP...`, 'info');
    await state.mcpClient.callTool('update_task_status', {
      taskId,
      status,
      blockerReason: blockerReason || undefined
    });
    showToast(`Task updated to ${status}!`, 'success');
    await refreshAllData();
  } catch (err) {
    showToast(`Failed to update status: ${err.message}`, 'error');
  }
}

async function handleDeleteProject(projectId) {
  try {
    // We can call delete directly or delete via task store
    // Let's call store through custom or task tools
    const res = await fetch(`/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': state.mcpClient.sessionId,
        'mcp-protocol-version': '2025-11-25'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'update_project',
          arguments: { projectId, status: 'completed' }
        }
      })
    });
    showToast('Project updated!', 'success');
    await refreshAllData();
  } catch (err) {
    showToast(`Delete failed: ${err.message}`, 'error');
  }
}

async function handleDeleteTask(taskId) {
  try {
    await state.mcpClient.callTool('update_task_status', { taskId, status: 'done' });
    showToast('Task cleared!', 'success');
    await refreshAllData();
  } catch (err) {
    showToast(`Failed to remove task: ${err.message}`, 'error');
  }
}

// ==========================================================================
// MODAL DIALOGS SETUP & SUBMISSION
// ==========================================================================

function setupModals() {
  const projectModal = document.getElementById('projectModal');
  const taskModal = document.getElementById('taskModal');
  const inspectorModal = document.getElementById('inspectorModal');

  // Triggers
  document.querySelectorAll('.trigger-new-project, #openNewProjectBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('projectModalTitle').textContent = 'Create New Project';
      document.getElementById('projectIdField').value = '';
      document.getElementById('projectForm').reset();
      projectModal.showModal();
    });
  });

  document.querySelectorAll('.trigger-new-task, #openNewTaskBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('taskModalTitle').textContent = 'Create Task';
      document.getElementById('taskIdField').value = '';
      document.getElementById('taskForm').reset();
      document.getElementById('blockerReasonGroup').style.display = 'none';
      populateProjectDropdowns();
      taskModal.showModal();
    });
  });

  const inspectorBtn = document.getElementById('openInspectorBtn');
  const mcpStatusPill = document.getElementById('mcpStatusPill');
  [inspectorBtn, mcpStatusPill].forEach(trigger => {
    if (trigger) {
      trigger.addEventListener('click', () => {
        updateInspectorModal();
        inspectorModal.showModal();
      });
    }
  });

  // Watch task status select for conditional blocker field
  const taskStatus = document.getElementById('taskStatus');
  if (taskStatus) {
    taskStatus.addEventListener('change', () => {
      const isBlocked = taskStatus.value === 'blocked';
      document.getElementById('blockerReasonGroup').style.display = isBlocked ? 'block' : 'none';
    });
  }

  // Project Form Submit
  const projectForm = document.getElementById('projectForm');
  if (projectForm) {
    projectForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const projId = document.getElementById('projectIdField').value;
      const name = document.getElementById('projectName').value.trim();
      const description = document.getElementById('projectDesc').value.trim();
      const category = document.getElementById('projectCategory').value.trim();
      const status = document.getElementById('projectStatus').value;
      const priority = document.getElementById('projectPriority').value;
      const repoUrl = document.getElementById('projectRepo').value.trim();
      const techStack = document.getElementById('projectTechStack').value
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      try {
        if (projId) {
          // Update via MCP
          await state.mcpClient.callTool('update_project', {
            projectId: projId,
            name, description, category, status, priority, repoUrl, techStack
          });
          showToast(`Project "${name}" updated via MCP!`, 'success');
        } else {
          // Create via MCP
          await state.mcpClient.callTool('create_project', {
            name, description, category, status, priority, repoUrl, techStack
          });
          showToast(`Project "${name}" created via MCP!`, 'success');
        }
        projectModal.close();
        await refreshAllData();
      } catch (err) {
        showToast(`Project operation failed: ${err.message}`, 'error');
      }
    });
  }

  // Task Form Submit
  const taskForm = document.getElementById('taskForm');
  if (taskForm) {
    taskForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const projectId = document.getElementById('taskProjectId').value;
      const title = document.getElementById('taskTitle').value.trim();
      const description = document.getElementById('taskDesc').value.trim();
      const status = document.getElementById('taskStatus').value;
      const priority = document.getElementById('taskPriority').value;
      const dueDate = document.getElementById('taskDueDate').value || undefined;
      const isBug = document.getElementById('taskIsBug').checked;
      const isMaintenance = document.getElementById('taskIsMaintenance').checked;
      const blocker = status === 'blocked' ? document.getElementById('taskBlocker').value.trim() : undefined;

      try {
        await state.mcpClient.callTool('create_task', {
          projectId,
          title,
          description: description || undefined,
          status,
          priority,
          dueDate,
          isBug,
          isMaintenance,
          blocker
        });
        showToast(`Task "${title}" created via MCP!`, 'success');
        taskModal.close();
        await refreshAllData();
      } catch (err) {
        showToast(`Task creation failed: ${err.message}`, 'error');
      }
    });
  }
}

function openEditProjectModal(projectId) {
  const p = state.projects.find(proj => proj.id === projectId);
  if (!p) return;

  document.getElementById('projectModalTitle').textContent = `Edit Project: ${p.name}`;
  document.getElementById('projectIdField').value = p.id;
  document.getElementById('projectName').value = p.name;
  document.getElementById('projectDesc').value = p.description || '';
  document.getElementById('projectCategory').value = p.category || '';
  document.getElementById('projectStatus').value = p.status;
  document.getElementById('projectPriority').value = p.priority;
  document.getElementById('projectRepo').value = p.repoUrl || '';
  document.getElementById('projectTechStack').value = (p.techStack || []).join(', ');

  document.getElementById('projectModal').showModal();
}

function populateProjectDropdowns() {
  const selects = [
    document.getElementById('taskProjectId'),
    document.getElementById('taskFilterProject')
  ];

  selects.forEach(select => {
    if (!select) return;
    const currentVal = select.value;
    const isFilter = select.id.includes('Filter');

    let html = isFilter ? '<option value="">All Projects</option>' : '';
    state.projects.forEach(p => {
      html += `<option value="${p.id}">${escapeHtml(p.name)}</option>`;
    });

    select.innerHTML = html;
    if (currentVal) select.value = currentVal;
  });

  // Attach filter change listeners
  const filterElements = [
    'projectFilterStatus',
    'projectFilterPriority',
    'taskFilterProject',
    'taskFilterStatus',
    'taskFilterPriority'
  ];
  filterElements.forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.dataset.hasListener) {
      el.dataset.hasListener = 'true';
      el.addEventListener('change', () => {
        if (id.startsWith('project')) renderProjects();
        if (id.startsWith('task')) renderTasks();
      });
    }
  });
}

// ==========================================================================
// ASSISTANT CONVERSATION & WORKFLOW ORCHESTRATION
// ==========================================================================

function setupAssistantChat() {
  const form = document.getElementById('assistantChatForm');
  const input = document.getElementById('assistantChatInput');
  const dashForm = document.getElementById('dashboardAssistantForm');
  const dashInput = document.getElementById('dashboardPromptInput');
  const toggleVoice = document.getElementById('toggleVoiceBtn');
  const clearBtn = document.getElementById('clearChatBtn');

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const prompt = input.value.trim();
      if (!prompt) return;
      input.value = '';
      await executeAssistantPrompt(prompt);
    });
  }

  if (dashForm) {
    dashForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const prompt = dashInput.value.trim();
      if (!prompt) return;
      dashInput.value = '';
      switchView('assistant');
      await executeAssistantPrompt(prompt);
    });
  }

  // Prompt chips
  document.querySelectorAll('.chip-prompt').forEach(chip => {
    chip.addEventListener('click', async () => {
      const prompt = chip.dataset.prompt;
      switchView('assistant');
      await executeAssistantPrompt(prompt);
    });
  });

  if (toggleVoice) {
    toggleVoice.addEventListener('click', () => {
      state.voiceEnabled = !state.voiceEnabled;
      document.getElementById('voiceToggleLabel').textContent = `Voice: ${state.voiceEnabled ? 'Enabled' : 'Muted'}`;
      showToast(`Voice synthesis ${state.voiceEnabled ? 'enabled' : 'muted'}`, 'info');
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const stream = document.getElementById('chatMessageStream');
      stream.innerHTML = '';
      showToast('Chat dialogue cleared', 'info');
    });
  }
}

async function executeAssistantPrompt(promptText) {
  const stream = document.getElementById('chatMessageStream');
  const dashSnippet = document.getElementById('dashboardAssistantOutput');

  // 1. Render User Message
  appendChatMessage('user', 'Developer', promptText);

  // 2. Render Temporary "Thinking / Calling MCP" Placeholder
  const placeholderId = `ai-thinking-${Date.now()}`;
  appendChatMessage('assistant', 'ProjectPilot Assistant', 'Invoking verified MCP tool over Streamable HTTP...', placeholderId);

  try {
    const outcome = await state.orchestrator.process(promptText);

    // Replace placeholder with final result
    const msgEl = document.getElementById(placeholderId);
    if (msgEl) {
      let toolInvocationsHtml = '';
      if (outcome.toolCalls?.length) {
        toolInvocationsHtml = outcome.toolCalls.map(tc => `
          <div class="tool-invocation-box">
            <div class="tool-inv-header">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
              <span>MCP Tool: ${tc.name}</span>
            </div>
            <div class="tool-inv-args">${escapeHtml(JSON.stringify(tc.args, null, 2))}</div>
          </div>
        `).join('');
      }

      let clarificationButtons = '';
      if (outcome.clarificationOptions?.length) {
        clarificationButtons = `
          <div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:8px;">
            ${outcome.clarificationOptions.map(opt => `
              <button class="btn btn-secondary btn-sm clarification-chip" data-choice="${escapeHtml(opt.action)}">${escapeHtml(opt.label)}</button>
            `).join('')}
          </div>
        `;
      }

      msgEl.innerHTML = `
        <div class="msg-sender">ProjectPilot Assistant</div>
        <div class="msg-text">
          ${formatMarkdown(outcome.explanation)}
          ${toolInvocationsHtml}
          ${clarificationButtons}
        </div>
      `;

      msgEl.querySelectorAll('.clarification-chip').forEach(btn => {
        btn.addEventListener('click', async () => {
          await executeAssistantPrompt(btn.dataset.choice);
        });
      });
    }

    if (dashSnippet) {
      dashSnippet.textContent = outcome.explanation.slice(0, 300) + (outcome.explanation.length > 300 ? '...' : '');
    }

    // Voice simulation
    if (state.voiceEnabled && 'speechSynthesis' in window) {
      speakAssistantResponse(outcome.explanation);
    }

    // Refresh UI data to reflect any state changes made by tools
    await refreshAllData();
  } catch (err) {
    console.error('Assistant execution failed:', err);
    const msgEl = document.getElementById(placeholderId);
    if (msgEl) {
      msgEl.innerHTML = `
        <div class="msg-sender">ProjectPilot Assistant</div>
        <div class="msg-text text-danger">⚠️ Error executing MCP workflow: ${escapeHtml(err.message)}</div>
      `;
    }
  }

  // Scroll stream to bottom
  if (stream) stream.scrollTop = stream.scrollHeight;
}

function appendChatMessage(type, sender, text, elementId = null) {
  const stream = document.getElementById('chatMessageStream');
  if (!stream) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-msg msg-${type}`;

  msgDiv.innerHTML = `
    <div class="msg-avatar">${type === 'user' ? 'DEV' : 'AI'}</div>
    <div class="msg-body" ${elementId ? `id="${elementId}"` : ''}>
      <div class="msg-sender">${escapeHtml(sender)}</div>
      <div class="msg-text">${formatMarkdown(text)}</div>
    </div>
  `;

  stream.appendChild(msgDiv);
  stream.scrollTop = stream.scrollHeight;
}

function speakAssistantResponse(text) {
  try {
    window.speechSynthesis.cancel();
    // Clean text of markdown chars
    const plain = text.replace(/[*#_`>]/g, '').slice(0, 200);
    const utterance = new SpeechSynthesisUtterance(plain);
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('Speech synthesis unavailable:', err);
  }
}

// ==========================================================================
// MCP PROTOCOL INSPECTOR & TELEMETRY
// ==========================================================================

function setupInspector() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.inspector-tab-content').forEach(tc => tc.classList.remove('active'));
      const target = document.getElementById(`tabContent${capitalize(tab.dataset.tab)}`);
      if (target) target.classList.add('active');
    });
  });

  const clearTelBtn = document.getElementById('clearTelemetryBtn');
  if (clearTelBtn) {
    clearTelBtn.addEventListener('click', () => {
      state.telemetryLog = [];
      const logContainer = document.getElementById('inspectorTelemetryLog');
      if (logContainer) logContainer.innerHTML = '';
    });
  }
}

function recordTelemetry(event, payload) {
  const entry = {
    timestamp: new Date().toLocaleTimeString(),
    event,
    payload
  };
  state.telemetryLog.push(entry);

  const logContainer = document.getElementById('inspectorTelemetryLog');
  if (!logContainer) return;

  const div = document.createElement('div');
  div.className = `telemetry-entry event-${event}`;
  div.innerHTML = `<strong>[${entry.timestamp}] ${event.toUpperCase()}</strong>: ${escapeHtml(JSON.stringify(payload))}`;
  logContainer.appendChild(div);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function updateMcpStatusUi() {
  const pill = document.getElementById('mcpStatusPill');
  if (!pill || !state.mcpClient) return;

  if (state.mcpClient.connected) {
    pill.className = 'mcp-status-pill status-connected';
    pill.querySelector('.status-label').textContent = 'MCP: Connected';
  } else {
    pill.className = 'mcp-status-pill status-disconnected';
    pill.querySelector('.status-label').textContent = 'MCP: Disconnected';
  }
}

function updateInspectorModal() {
  const client = state.mcpClient;
  if (!client) return;

  document.getElementById('inspectorSessionId').textContent = client.sessionId || 'None (Stateless)';
  document.getElementById('inspectorToolsCount').textContent = client.tools?.length || 0;

  const toolsList = document.getElementById('inspectorToolsList');
  if (toolsList && client.tools) {
    toolsList.innerHTML = client.tools.map(tool => `
      <div class="tool-spec-card">
        <div class="tool-name">${escapeHtml(tool.name)}</div>
        <div class="tool-desc">${escapeHtml(tool.description || 'No description.')}</div>
        <div style="margin-top:6px; font-family:var(--font-mono); font-size:0.7rem; color:var(--text-muted);">
          Inputs: ${escapeHtml(Object.keys(tool.inputSchema?.properties || {}).join(', ') || 'none')}
        </div>
      </div>
    `).join('');
  }
}

// ==========================================================================
// UTILITIES: TOASTS, ESCAPING, MARKDOWN
// ==========================================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button class="btn-close" style="font-size:1rem;" onclick="this.parentElement.remove()">&times;</button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentElement) toast.remove();
  }, 4000);
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMarkdown(str) {
  if (!str) return '';
  return escapeHtml(str)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}
