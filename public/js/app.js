/**
 * ProjectPilot AI - Frontend Application Entrypoint
 * Orchestrates views, handles user interactions, manages accessible dialogs,
 * and communicates exclusively through the Model Context Protocol (MCP) client.
 */

import { McpBrowserClient } from './api/mcpClient.js';
import { AssistantOrchestrator } from './orchestrator.js';
import { ReadAloudEngine } from './speech/readAloudEngine.js';

// Application State
const state = {
  mcpClient: null,
  orchestrator: null,
  readAloudEngine: null,
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
  setupGitHubAuditView();
  setupAuditLogView();

  // Initialize READ ALOUD 2.0 Engine
  state.readAloudEngine = new ReadAloudEngine();
  if (typeof window !== 'undefined') {
    window.readAloudEngine = state.readAloudEngine;
  }
  setupReadAloudControls();

  // Initialize MCP client strictly in memory (no persistent credentials in localStorage, sessionStorage, or cookies)
  state.mcpClient = new McpBrowserClient('/mcp');
  state.orchestrator = new AssistantOrchestrator(state.mcpClient);

  // Hook into MCP telemetry events
  state.mcpClient.onEvent((event, payload) => {
    recordTelemetry(event, payload);
    updateMcpStatusUi();
  });

  // Query backend gateway capabilities for developer settings
  fetchBackendInfo().catch(() => {});

  try {
    showToast('Initializing MCP Streamable HTTP session...', 'info');
    await state.mcpClient.connect();
    showToast('MCP Connected (Streamable HTTP 2025-11-25)', 'success');
    await refreshAllData();
  } catch (err) {
    if (err.message && err.message.includes('401')) {
      setAuthStatus('auth_failed', 'Authentication required by MCP Gateway (HTTP 401).');
      showToast('Authentication required by MCP server. Please configure your API key in Developer Settings.', 'warning');
      const settingsModal = document.getElementById('settingsModal');
      if (settingsModal) {
        updateSettingsModalUi();
        settingsModal.showModal();
      }
      return;
    }
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
      if (window.innerWidth <= 992) {
        sidebar.classList.toggle('mobile-open');
      } else {
        sidebar.classList.toggle('collapsed');
      }
    });
  }

  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const viewName = item.dataset.view;
      switchView(viewName);
      if (window.innerWidth <= 992) {
        sidebar.classList.remove('mobile-open');
      }
    });
  });

  const rescueBtn = document.getElementById('dashboardRescueBtn');
  if (rescueBtn) {
    rescueBtn.addEventListener('click', async () => {
      switchView('assistant');
      await executeAssistantPrompt('Investigate DevPulse Analytics');
    });
  }

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

// Expose on window for dynamic controls
if (typeof window !== 'undefined') {
  window.switchView = switchView;
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
    await renderAuditLogView();
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
      const statusClass = hp.healthStatus === 'Healthy'
        ? 'health-healthy'
        : (hp.healthStatus === 'At Risk'
          ? 'health-risk'
          : (hp.healthStatus === 'Insufficient Data' ? 'health-insufficient' : 'health-attention'));
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
// DEVELOPER SETTINGS & AUTHENTICATION STATE (IN-MEMORY ONLY)
// ==========================================================================

const authUiState = {
  status: 'not_configured', // 'not_configured' | 'configured' | 'connected' | 'auth_failed'
  statusMessage: 'No API key is held in application memory. Read-only inspection is active; mutating operations require an API key in production.',
  backendInfo: null
};

function setAuthStatus(status, message) {
  authUiState.status = status;
  if (message) authUiState.statusMessage = message;
  updateSettingsModalUi();
}

async function fetchBackendInfo() {
  try {
    const res = await fetch('/api/info');
    if (res.ok) {
      authUiState.backendInfo = await res.json();
    }
  } catch {
    authUiState.backendInfo = null;
  }
  updateSettingsModalUi();
}

function updateSettingsModalUi() {
  const badge = document.getElementById('settingsAuthStatusBadge');
  const explanation = document.getElementById('settingsStatusExplanation');
  const clearBtn = document.getElementById('clearSettingsKeyBtn');
  const envBadge = document.getElementById('settingsServerEnvBadge');
  const storageBadge = document.getElementById('settingsStorageBackendBadge');
  const inspectorAuthBadge = document.getElementById('inspectorAuthStatusBadge');

  const hasKey = state.mcpClient ? state.mcpClient.hasApiKey() : false;

  if (clearBtn) {
    clearBtn.disabled = !hasKey;
  }

  if (badge) {
    switch (authUiState.status) {
      case 'connected':
        badge.className = 'badge badge-success';
        badge.textContent = 'Connected & Authenticated';
        break;
      case 'configured':
        badge.className = 'badge badge-info';
        badge.textContent = 'Configured (In-Memory)';
        break;
      case 'auth_failed':
        badge.className = 'badge badge-danger';
        badge.textContent = 'Authentication failed (HTTP 401)';
        break;
      case 'not_configured':
      default:
        badge.className = 'badge badge-secondary';
        badge.textContent = 'Not configured';
        break;
    }
  }

  if (explanation) {
    explanation.textContent = authUiState.statusMessage;
  }

  if (inspectorAuthBadge) {
    if (hasKey) {
      inspectorAuthBadge.className = 'badge badge-success';
      inspectorAuthBadge.textContent = 'Configured (In-Memory)';
    } else {
      inspectorAuthBadge.className = 'badge badge-secondary';
      inspectorAuthBadge.textContent = 'In-Memory (None)';
    }
  }

  if (envBadge) {
    if (authUiState.backendInfo) {
      const isProd = authUiState.backendInfo.isProduction;
      const isAuth = authUiState.backendInfo.authConfigured;
      envBadge.textContent = isProd
        ? (isAuth ? 'Production (Key Enforced)' : 'Production (No Key)')
        : 'Development (Local)';
      envBadge.className = isProd ? 'badge badge-warning' : 'badge badge-info';
    } else {
      envBadge.textContent = 'Online';
      envBadge.className = 'badge badge-secondary';
    }
  }

  if (storageBadge) {
    if (authUiState.backendInfo) {
      const isDurable = authUiState.backendInfo.isDurable;
      storageBadge.textContent = isDurable ? 'Upstash Redis (Durable CAS)' : 'Local JSON Store';
      storageBadge.className = isDurable ? 'badge badge-success' : 'badge badge-secondary';
    } else {
      storageBadge.textContent = 'Standard';
      storageBadge.className = 'badge badge-secondary';
    }
  }
}

function setupDeveloperSettingsModal() {
  const settingsModal = document.getElementById('settingsModal');
  if (!settingsModal) return;

  const openSettingsBtns = document.querySelectorAll('#openSettingsBtn, #sidebarSettingsBtn, #inspectorOpenSettingsBtn');
  openSettingsBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const inspectorModal = document.getElementById('inspectorModal');
      if (inspectorModal && inspectorModal.open) {
        inspectorModal.close();
      }

      const errBox = document.getElementById('settingsErrorMessage');
      if (errBox) errBox.style.display = 'none';

      const keyInput = document.getElementById('settingsApiKeyInput');
      if (keyInput) {
        keyInput.value = '';
        keyInput.type = 'password';
      }

      const toggleBtn = document.getElementById('toggleApiKeyVisibilityBtn');
      if (toggleBtn) toggleBtn.textContent = 'Show';

      await fetchBackendInfo();
      updateSettingsModalUi();
      settingsModal.showModal();
      if (keyInput) keyInput.focus();
    });
  });

  // Toggle Password Masking
  const toggleBtn = document.getElementById('toggleApiKeyVisibilityBtn');
  const keyInput = document.getElementById('settingsApiKeyInput');
  if (toggleBtn && keyInput) {
    toggleBtn.addEventListener('click', () => {
      const isPassword = keyInput.type === 'password';
      keyInput.type = isPassword ? 'text' : 'password';
      toggleBtn.textContent = isPassword ? 'Hide' : 'Show';
    });
  }

  // Clear Key Button
  const clearBtn = document.getElementById('clearSettingsKeyBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (state.mcpClient) {
        state.mcpClient.clearApiKey();
      }
      if (keyInput) keyInput.value = '';
      const errBox = document.getElementById('settingsErrorMessage');
      if (errBox) errBox.style.display = 'none';

      setAuthStatus('not_configured', 'API key cleared from memory. Read-only mode active.');
      showToast('API key removed from session memory.', 'info');
    });
  }

  // Apply Key (Form Submit)
  const settingsForm = document.getElementById('settingsForm');
  if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const entered = keyInput ? keyInput.value.trim() : '';
      const errBox = document.getElementById('settingsErrorMessage');

      if (!entered) {
        if (errBox) {
          errBox.textContent = 'Please enter an API key or use Clear Key to reset credentials.';
          errBox.style.display = 'block';
        }
        return;
      }

      // 1. Hold key strictly in memory on client
      state.mcpClient.setApiKey(entered);

      // 2. Clear input immediately from DOM
      keyInput.value = '';
      keyInput.type = 'password';
      if (toggleBtn) toggleBtn.textContent = 'Show';
      if (errBox) errBox.style.display = 'none';

      setAuthStatus('configured', 'API key configured in application memory. Verifying connection...');

      // 3. Test verification against MCP endpoint
      try {
        await state.mcpClient.connect();
        setAuthStatus('connected', 'Connected and authenticated with MCP Gateway.');
        showToast('API key verified and applied to session memory!', 'success');
        await refreshAllData();
        settingsModal.close();
      } catch (connErr) {
        if (connErr.message && connErr.message.includes('401')) {
          setAuthStatus('auth_failed', 'Authentication failed (HTTP 401): Invalid API key.');
          if (errBox) {
            errBox.textContent = 'Authentication failed: The entered API key was rejected by the server.';
            errBox.style.display = 'block';
          }
          showToast('Authentication failed: Invalid API key', 'error');
        } else {
          setAuthStatus('configured', `Configured in memory (Gateway notice: ${connErr.message})`);
          showToast(`Applied in memory. Gateway notice: ${connErr.message}`, 'warning');
        }
      }
    });
  }
}

// ==========================================================================
// MODAL DIALOGS SETUP & SUBMISSION
// ==========================================================================

function setupModals() {
  const projectModal = document.getElementById('projectModal');
  const taskModal = document.getElementById('taskModal');
  const inspectorModal = document.getElementById('inspectorModal');

  // Developer Settings modal
  setupDeveloperSettingsModal();

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
        if (err.message && (err.message.includes('401') || err.message.includes('Authentication'))) {
          setAuthStatus('auth_failed', 'Authentication required: Mutating operation rejected (HTTP 401).');
          showToast('Authentication required: Mutating operations require an API key. Open Settings to configure.', 'warning');
        } else {
          showToast(`Project operation failed: ${err.message}`, 'error');
        }
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
        if (err.message && (err.message.includes('401') || err.message.includes('Authentication'))) {
          setAuthStatus('auth_failed', 'Authentication required: Mutating operation rejected (HTTP 401).');
          showToast('Authentication required: Mutating operations require an API key. Open Settings to configure.', 'warning');
        } else {
          showToast(`Task creation failed: ${err.message}`, 'error');
        }
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

  // Execution mode selector buttons
  const modeSelector = document.getElementById('executionModeSelector');
  if (modeSelector) {
    const buttons = modeSelector.querySelectorAll('.mode-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        state.orchestrator.setExecutionMode(mode);
        buttons.forEach(b => b.classList.toggle('active', b === btn));
        showToast(`Execution mode set to ${mode}`, 'info');
      });
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
      if (state.readAloudEngine) {
        state.readAloudEngine.setAutoPlay(state.voiceEnabled);
      }
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
        const boxes = outcome.toolCalls.map(tc => `
          <div class="tool-invocation-box">
            <div class="tool-inv-header">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
              <span>MCP Tool: ${tc.name}</span>
            </div>
            <div class="tool-inv-args">${escapeHtml(JSON.stringify(tc.args, null, 2))}</div>
          </div>
        `).join('');

        toolInvocationsHtml = `
          <details class="technical-details-disclosure">
            <summary class="technical-details-summary">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
              <span>View Technical Execution Traces (${outcome.toolCalls.length} tool invocation(s))</span>
            </summary>
            <div class="technical-details-content">
              ${boxes}
            </div>
          </details>
        `;
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

      const rescueCardHtml = outcome.cardHtml || '';
      const msgId = `asst-msg-${Date.now()}`;
      msgEl.dataset.messageId = msgId;
      const audioBarHtml = renderMessageAudioBar(outcome.explanation, msgId);

      msgEl.innerHTML = `
        <div class="msg-sender">ProjectPilot Assistant</div>
        <div class="msg-text">
          ${formatMarkdown(outcome.explanation)}
          ${rescueCardHtml}
          ${toolInvocationsHtml}
          ${clarificationButtons}
        </div>
        ${audioBarHtml}
      `;

      wireMessageAudioBar(msgEl.querySelector('.msg-audio-actions'), outcome.explanation, msgId);

      if (outcome.cardHtml) {
        setupRescueCardListeners(msgEl.querySelector('.rescue-plan-card'));
      }

      msgEl.querySelectorAll('.clarification-chip').forEach(btn => {
        btn.addEventListener('click', async () => {
          await executeAssistantPrompt(btn.dataset.choice);
        });
      });
    }

    if (dashSnippet) {
      dashSnippet.textContent = outcome.explanation.slice(0, 300) + (outcome.explanation.length > 300 ? '...' : '');
    }

    // Voice simulation (READ ALOUD 2.0)
    if (state.voiceEnabled && (state.readAloudEngine || 'speechSynthesis' in window)) {
      speakAssistantResponse(outcome.explanation, { messageId: msgEl ? msgEl.dataset.messageId : null });
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

if (typeof window !== 'undefined') {
  window.executeAssistantPrompt = executeAssistantPrompt;
}

function setupRescueCardListeners(card) {
  if (!card || card.dataset.initialized) return;
  card.dataset.initialized = 'true';

  const approveBtn = card.querySelector('.rescue-approve-btn');
  const cancelBtn = card.querySelector('.rescue-cancel-btn');
  const selectAll = card.querySelector('.rescue-select-all');
  const checkboxes = card.querySelectorAll('.rescue-action-checkbox');

  function updateApproveButton() {
    if (!approveBtn) return;
    const selectedCount = state.orchestrator.selectedActionIds.size;
    approveBtn.textContent = `Approve Selected (${selectedCount})`;
    approveBtn.disabled = selectedCount === 0;

    if (selectAll) {
      selectAll.checked = selectedCount === checkboxes.length && checkboxes.length > 0;
    }
  }

  checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const actionId = cb.dataset.actionId;
      try {
        state.orchestrator.toggleActionSelection(actionId, cb.checked);
        const item = cb.closest('.rescue-action-item');
        if (item) {
          item.classList.toggle('selected', cb.checked);
        }
        updateApproveButton();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  if (selectAll) {
    selectAll.addEventListener('change', () => {
      try {
        state.orchestrator.selectAllActions(selectAll.checked);
        checkboxes.forEach(cb => {
          cb.checked = selectAll.checked;
          const item = cb.closest('.rescue-action-item');
          if (item) {
            item.classList.toggle('selected', selectAll.checked);
          }
        });
        updateApproveButton();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      const pName = state.orchestrator.pendingRescuePlan?.projectName || 'Project';
      state.orchestrator.cancelRescuePlan();
      card.classList.add('rescue-card-cancelled');
      card.querySelectorAll('button, input').forEach(el => el.disabled = true);
      showToast('Rescue plan cancelled', 'info');
      appendChatMessage('assistant', 'ProjectPilot Assistant', `❌ The rescue plan for **${pName}** has been cancelled. No persistent actions were executed.`);
    });
  }

  if (approveBtn) {
    approveBtn.addEventListener('click', async () => {
      const selectedCount = state.orchestrator.selectedActionIds.size;
      if (selectedCount === 0) {
        showToast('Please select at least one action to execute, or cancel the plan.', 'warning');
        return;
      }

      // Concurrency guard: disable buttons immediately to prevent duplicate clicks
      approveBtn.disabled = true;
      if (cancelBtn) cancelBtn.disabled = true;
      card.querySelectorAll('input').forEach(el => el.disabled = true);
      approveBtn.innerHTML = '⚙️ Executing Actions...';

      showToast(`Executing ${selectedCount} approved action(s) sequentially...`, 'info');

      try {
        const executionResult = await state.orchestrator.executeRescuePlan((actionId, outcome, record) => {
          const actionItem = card.querySelector(`[data-action-id="${actionId}"]`);
          if (actionItem) {
            const badges = actionItem.querySelector('.rescue-action-badges');
            if (badges) {
              let progBadge = badges.querySelector('.rescue-exec-badge');
              if (!progBadge) {
                progBadge = document.createElement('span');
                progBadge.className = 'rescue-badge rescue-exec-badge';
                badges.appendChild(progBadge);
              }
              progBadge.textContent = outcome;
              if (outcome === 'SUCCEEDED') progBadge.className = 'rescue-badge rescue-exec-badge badge-success';
              else if (outcome === 'FAILED') progBadge.className = 'rescue-badge rescue-exec-badge badge-danger';
              else if (outcome === 'SKIPPED_STALE' || outcome === 'SKIPPED_DEPENDENCY') progBadge.className = 'rescue-badge rescue-exec-badge badge-warning';
              else if (outcome === 'RUNNING') progBadge.className = 'rescue-badge rescue-exec-badge badge-running';
            }
          }
        });

        // Mark card completed
        card.classList.add('rescue-card-executed');
        approveBtn.textContent = 'Execution Completed';

        // Render verification card message in chat
        appendChatMessage(
          'assistant',
          'ProjectPilot Assistant',
          executionResult.explanation,
          null,
          executionResult.cardHtml
        );

        showToast(`Rescue execution finished: ${executionResult.report.status}`, 'success');

        // Refresh UI state
        try {
          if (typeof loadProjects === 'function') await loadProjects();
          if (typeof loadDashboardMetrics === 'function') await loadDashboardMetrics();
        } catch (refreshErr) {
          console.warn('UI refresh warning after rescue execution:', refreshErr);
        }
      } catch (err) {
        showToast(`Execution failed: ${err.message}`, 'error');
        approveBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        card.querySelectorAll('input').forEach(el => el.disabled = false);
        approveBtn.textContent = `Approve Selected (${state.orchestrator.selectedActionIds.size})`;
      }
    });
  }
}

function renderMessageAudioBar(text, messageId) {
  return `
    <div class="msg-audio-actions" data-message-id="${messageId}">
      <button type="button" class="btn-read-aloud" data-action="read" aria-label="Read this message aloud" title="Read Aloud">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
        <span>Read Aloud</span>
      </button>
      <div class="msg-audio-live-controls hidden">
        <span class="msg-reading-indicator">
          <span class="pulse-dot"></span> <span class="chunk-counter">Reading...</span>
        </span>
        <button type="button" class="btn-audio-mini btn-pause" aria-label="Pause speech" title="Pause">⏸</button>
        <button type="button" class="btn-audio-mini btn-stop" aria-label="Stop speech" title="Stop">⏹</button>
        <button type="button" class="btn-audio-mini btn-restart" aria-label="Restart speech" title="Restart">🔄</button>
      </div>
    </div>
  `;
}

function wireMessageAudioBar(container, rawText, messageId) {
  if (!container || container.dataset.wired) return;
  container.dataset.wired = 'true';
  const readBtn = container.querySelector('.btn-read-aloud');
  const pauseBtn = container.querySelector('.btn-pause');
  const stopBtn = container.querySelector('.btn-stop');
  const restartBtn = container.querySelector('.btn-restart');

  if (readBtn) {
    readBtn.addEventListener('click', () => {
      if (state.readAloudEngine) {
        state.readAloudEngine.speak(rawText, { messageId });
      }
    });
  }
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      if (state.readAloudEngine) {
        if (state.readAloudEngine.status === 'playing') {
          state.readAloudEngine.pause();
        } else {
          state.readAloudEngine.resume();
        }
      }
    });
  }
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      if (state.readAloudEngine) {
        state.readAloudEngine.stop();
      }
    });
  }
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      if (state.readAloudEngine) {
        state.readAloudEngine.restart();
      }
    });
  }
}

function appendChatMessage(type, sender, text, elementId = null, cardHtml = null) {
  const stream = document.getElementById('chatMessageStream');
  if (!stream) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-msg msg-${type}`;
  const msgId = elementId || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  msgDiv.dataset.messageId = msgId;

  const isAssistant = type === 'assistant';
  const isPlaceholder = elementId && elementId.startsWith('ai-thinking-');
  const audioBarHtml = isAssistant && !isPlaceholder ? renderMessageAudioBar(text, msgId) : '';

  msgDiv.innerHTML = `
    <div class="msg-avatar">${type === 'user' ? 'DEV' : 'AI'}</div>
    <div class="msg-body" ${elementId ? `id="${elementId}"` : ''}>
      <div class="msg-sender">${escapeHtml(sender)}</div>
      <div class="msg-text">
        ${formatMarkdown(text)}
        ${cardHtml || ''}
      </div>
      ${audioBarHtml}
    </div>
  `;

  stream.appendChild(msgDiv);
  stream.scrollTop = stream.scrollHeight;

  if (isAssistant && !isPlaceholder) {
    wireMessageAudioBar(msgDiv.querySelector('.msg-audio-actions'), text, msgId);
  }
}

function speakAssistantResponse(text, options = {}) {
  try {
    if (state.readAloudEngine) {
      return state.readAloudEngine.speak(text, options);
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const plain = text.replace(/[*#_`>]/g, '');
      const utterance = new SpeechSynthesisUtterance(plain);
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    }
  } catch (err) {
    console.warn('Speech synthesis unavailable:', err);
  }
}

function setupReadAloudControls() {
  const engine = state.readAloudEngine;
  if (!engine) return;

  const voiceSelect = document.getElementById('voiceSelector');
  const speedSelect = document.getElementById('speedSelector');
  const playerBar = document.getElementById('readAloudPlayerBar');
  const playerStatusText = document.getElementById('readAloudStatusText');
  const playerProgressBadge = document.getElementById('readAloudProgressBadge');
  const playerVoiceBadge = document.getElementById('readAloudVoiceBadge');
  const playerPauseResumeBtn = document.getElementById('playerPauseResumeBtn');
  const playerStopBtn = document.getElementById('playerStopBtn');
  const playerRestartBtn = document.getElementById('playerRestartBtn');

  // Populate voice selector dropdown
  function populateVoiceDropdown() {
    if (!voiceSelect) return;
    const voices = engine.getVoices();
    voiceSelect.innerHTML = '<option value="">Voice: Auto (Language Matched)</option>';
    voices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})`;
      if (engine.preferredVoiceUri === v.voiceURI) {
        opt.selected = true;
      }
      voiceSelect.appendChild(opt);
    });
  }

  populateVoiceDropdown();
  if (engine.synth) {
    if (typeof engine.synth.addEventListener === 'function') {
      engine.synth.addEventListener('voiceschanged', populateVoiceDropdown);
    } else if ('onvoiceschanged' in engine.synth) {
      engine.synth.onvoiceschanged = populateVoiceDropdown;
    }
  }

  if (voiceSelect) {
    voiceSelect.addEventListener('change', () => {
      engine.setVoice(voiceSelect.value || null);
      showToast('Voice preference updated', 'info');
    });
  }

  if (speedSelect) {
    speedSelect.value = engine.rate.toFixed(2);
    speedSelect.addEventListener('change', () => {
      const newRate = parseFloat(speedSelect.value) || 0.95;
      engine.setRate(newRate);
      showToast(`Reading speed set to ${newRate.toFixed(2)}x`, 'info');
    });
  }

  // Global Player Bar Controls
  if (playerPauseResumeBtn) {
    playerPauseResumeBtn.addEventListener('click', () => {
      if (engine.status === 'playing') {
        engine.pause();
      } else if (engine.status === 'paused') {
        engine.resume();
      }
    });
  }

  if (playerStopBtn) {
    playerStopBtn.addEventListener('click', () => {
      engine.stop();
    });
  }

  if (playerRestartBtn) {
    playerRestartBtn.addEventListener('click', () => {
      engine.restart();
    });
  }

  // Hook into ReadAloudEngine state events
  engine.onStateChange(({ status, messageId }) => {
    // 1. Update Global Player Bar
    if (playerBar) {
      if (status === 'playing' || status === 'paused') {
        playerBar.classList.remove('hidden');
        if (status === 'paused') {
          playerBar.classList.add('player-paused');
          if (playerPauseResumeBtn) {
            playerPauseResumeBtn.innerHTML = '<span class="btn-icon">▶</span> <span class="btn-text">Resume</span>';
            playerPauseResumeBtn.setAttribute('aria-label', 'Resume speech');
          }
          if (playerStatusText) playerStatusText.textContent = 'Paused';
        } else {
          playerBar.classList.remove('player-paused');
          if (playerPauseResumeBtn) {
            playerPauseResumeBtn.innerHTML = '<span class="btn-icon">⏸</span> <span class="btn-text">Pause</span>';
            playerPauseResumeBtn.setAttribute('aria-label', 'Pause speech');
          }
          if (playerStatusText) playerStatusText.textContent = 'Reading response...';
        }
      } else {
        playerBar.classList.add('hidden');
      }
    }

    // 2. Update Message-level Audio Controls
    document.querySelectorAll('.msg-audio-actions').forEach(bar => {
      const barMsgId = bar.dataset.messageId;
      const readBtn = bar.querySelector('.btn-read-aloud');
      const liveControls = bar.querySelector('.msg-audio-live-controls');
      const miniPause = bar.querySelector('.btn-pause');

      if (status === 'playing' || status === 'paused') {
        if (barMsgId === messageId) {
          if (readBtn) readBtn.classList.add('hidden');
          if (liveControls) liveControls.classList.remove('hidden');
          if (miniPause) miniPause.textContent = status === 'paused' ? '▶' : '⏸';
        } else {
          if (readBtn) readBtn.classList.remove('hidden');
          if (liveControls) liveControls.classList.add('hidden');
        }
      } else {
        // Stopped or completed
        if (readBtn) readBtn.classList.remove('hidden');
        if (liveControls) liveControls.classList.add('hidden');
      }
    });
  });

  engine.onProgress(({ currentIndex, totalChunks, percentage, messageId }) => {
    if (playerProgressBadge) {
      playerProgressBadge.textContent = `Chunk ${currentIndex + 1} of ${totalChunks} (${percentage}%)`;
    }
    if (playerVoiceBadge) {
      const activeVoice = engine.currentUtterance?.voice?.name || 'Natural';
      playerVoiceBadge.textContent = `Voice: ${activeVoice}`;
    }

    if (messageId) {
      const activeBar = document.querySelector(`.msg-audio-actions[data-message-id="${messageId}"]`);
      if (activeBar) {
        const counter = activeBar.querySelector('.chunk-counter');
        if (counter) counter.textContent = `Chunk ${currentIndex + 1} of ${totalChunks}`;
      }
    }
  });

  engine.onComplete(() => {
    showToast('Read Aloud completed', 'info');
  });

  engine.onError((err) => {
    if (playerBar) playerBar.classList.add('hidden');
    showToast(err.message || 'Speech synthesis error', 'error');
  });

  // Wire initial welcome message audio actions
  const welcomeMsg = document.querySelector('.chat-msg[data-message-id="welcome-msg"]');
  if (welcomeMsg) {
    const rawText = welcomeMsg.querySelector('.msg-text')?.innerText || '';
    wireMessageAudioBar(welcomeMsg.querySelector('.msg-audio-actions'), rawText, 'welcome-msg');
  }
}

if (typeof window !== 'undefined') {
  window.speakAssistantResponse = speakAssistantResponse;
  window.setupReadAloudControls = setupReadAloudControls;
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
  // Defense-in-depth: clone and redact sensitive authorization headers from telemetry
  let safePayload = payload;
  if (payload && typeof payload === 'object') {
    if (payload.headers) {
      const sanitized = { ...payload.headers };
      if (sanitized['Authorization']) sanitized['Authorization'] = 'Bearer [REDACTED]';
      if (sanitized['authorization']) sanitized['authorization'] = 'Bearer [REDACTED]';
      if (sanitized['x-api-key']) sanitized['x-api-key'] = '[REDACTED]';
      safePayload = { ...payload, headers: sanitized };
    }
  }

  const entry = {
    timestamp: new Date().toLocaleTimeString(),
    event,
    payload: safePayload
  };
  state.telemetryLog.push(entry);

  const logContainer = document.getElementById('inspectorTelemetryLog');
  if (!logContainer) return;

  const div = document.createElement('div');
  div.className = `telemetry-entry event-${event}`;
  div.innerHTML = `<strong>[${entry.timestamp}] ${event.toUpperCase()}</strong>: ${escapeHtml(JSON.stringify(safePayload))}`;
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

  const authBadge = document.getElementById('inspectorAuthStatusBadge');
  if (authBadge) {
    if (client.hasApiKey()) {
      authBadge.className = 'badge badge-success';
      authBadge.textContent = 'Configured (In-Memory)';
    } else {
      authBadge.className = 'badge badge-secondary';
      authBadge.textContent = 'In-Memory (None)';
    }
  }

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
// GITHUB REPOSITORY AUDIT & FINDINGS VIEW
// ==========================================================================

function setupGitHubAuditView() {
  const form = document.getElementById('githubInspectForm');
  const input = document.getElementById('githubRepoInput');
  const resultsCard = document.getElementById('githubAuditResults');
  const content = document.getElementById('githubAuditContent');
  const badge = document.getElementById('githubAssessmentBadge');
  const title = document.getElementById('githubAuditTitle');

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = input.value.trim();
      if (!url) return;

      const btn = document.getElementById('githubInspectBtn');
      btn.disabled = true;
      btn.textContent = 'Auditing...';

      try {
        const res = await state.mcpClient.callTool('inspect_github_repo', { repoUrl: url });
        const report = res.data;

        if (resultsCard && content && report) {
          resultsCard.style.display = 'block';
          title.textContent = `Audit: ${report.owner ? `${report.owner}/${report.repo}` : url}`;
          if (badge) {
            badge.textContent = report.overallAssessment || 'Audited';
            badge.className = `badge ${report.status === 'invalid_url' || report.status === 'not_found' ? 'badge-danger' : 'badge-primary'}`;
          }

          let metaHtml = '';
          if (report.metadata) {
            metaHtml = `
              <div style="display:flex; flex-wrap:wrap; gap:16px; margin-bottom:16px; padding:12px; background:rgba(255,255,255,0.02); border-radius:var(--radius-md);">
                <div><strong>Default Branch:</strong> <code>${escapeHtml(report.metadata.defaultBranch)}</code></div>
                <div><strong>Language:</strong> ${escapeHtml(report.metadata.language)}</div>
                <div><strong>License:</strong> ${escapeHtml(report.metadata.license)}</div>
                <div><strong>Stars:</strong> ${report.metadata.stars}</div>
                <div><strong>Open Issues:</strong> ${report.metadata.openIssuesCount}</div>
              </div>
            `;
          }

          let hygieneHtml = '';
          if (report.fileTreeSummary) {
            hygieneHtml = `
              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:10px; margin-bottom:16px;">
                <div class="card" style="padding:10px;"><strong>README:</strong> ${report.fileTreeSummary.hasReadme ? '✅ Present' : '❌ Missing'}</div>
                <div class="card" style="padding:10px;"><strong>License File:</strong> ${report.fileTreeSummary.hasLicense ? '✅ Present' : '❌ Missing'}</div>
                <div class="card" style="padding:10px;"><strong>.gitignore:</strong> ${report.fileTreeSummary.hasGitignore ? '✅ Present' : '❌ Missing'}</div>
                <div class="card" style="padding:10px;"><strong>CI/CD:</strong> ${report.fileTreeSummary.ciWorkflowsCount > 0 ? `✅ ${report.fileTreeSummary.ciWorkflowsCount} Workflows` : '❌ None'}</div>
              </div>
            `;
          }

          const findings = Array.isArray(report.findings) ? report.findings : [];
          let findingsHtml = '';
          if (findings.length === 0) {
            findingsHtml = '<div class="empty-state">No security or hygiene deficiencies discovered. Repository follows healthy baseline standards.</div>';
          } else {
            findingsHtml = `
              <h3 style="margin-bottom:12px; font-size:0.95rem;">Findings (${findings.length})</h3>
              <div class="findings-grid">
                ${findings.map(f => `
                  <div class="finding-card severity-${escapeHtml(f.severity)}">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                      <strong>${escapeHtml(f.title)}</strong>
                      <span class="badge ${f.severity === 'critical' || f.severity === 'high' ? 'badge-danger' : 'badge-primary'}">${escapeHtml(f.severity.toUpperCase())}</span>
                    </div>
                    <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:6px;">${escapeHtml(f.explanation)}</div>
                    ${f.filePath ? `<div style="font-size:0.75rem; font-family:var(--font-mono); color:var(--text-muted); margin-bottom:6px;">File: ${escapeHtml(f.filePath)}</div>` : ''}
                    <div style="font-size:0.78rem; color:var(--text-muted);"><strong>Remediation:</strong> ${escapeHtml(f.remediation)}</div>
                  </div>
                `).join('')}
              </div>
            `;
          }

          content.innerHTML = metaHtml + hygieneHtml + findingsHtml;
        }

        showToast('Repository audit completed', 'success');
      } catch (err) {
        showToast(`Audit failed: ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Audit Repository';
      }
    });
  }
}

// ==========================================================================
// AUDIT LOG & COMPLIANCE VIEW
// ==========================================================================

function setupAuditLogView() {
  const refreshBtn = document.getElementById('refreshAuditBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      await renderAuditLogView();
      showToast('Audit trail refreshed', 'success');
      refreshBtn.disabled = false;
    });
  }
}

async function renderAuditLogView() {
  const tbody = document.getElementById('auditTableBody');
  if (!tbody || !state.mcpClient) return;

  try {
    const res = await state.mcpClient.callTool('get_audit_log', { limit: 25 });
    const logs = res.data?.auditLogs || [];

    const navBadge = document.getElementById('navAuditCount');
    if (navBadge) navBadge.textContent = logs.length;

    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No mutation events recorded yet. Mutations performed in APPROVE or AUTOPILOT mode will appear here.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(l => {
      const modeClass = l.mode === 'AUTOPILOT' ? 'badge-success' : (l.mode === 'APPROVE' ? 'badge-amber' : 'badge-info');
      const timeStr = l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : 'N/A';
      return `
        <tr>
          <td><code style="font-size:0.75rem;">${escapeHtml(timeStr)}</code></td>
          <td><strong>${escapeHtml(l.action)}</strong></td>
          <td>${escapeHtml(l.actor || 'assistant')}</td>
          <td><span class="badge ${modeClass}">${escapeHtml(l.mode || 'APPROVE')}</span></td>
          <td>${escapeHtml(l.targetType)} <code>${escapeHtml(l.targetId || '-')}</code></td>
          <td><span class="badge ${l.status === 'success' ? 'badge-success' : 'badge-danger'}">${escapeHtml(l.status || 'success')}</span></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-danger">Audit trail currently empty or recording first transaction.</td></tr>`;
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
    .replace(/^#### (.*?)$/gm, '<h5 style="margin: 12px 0 6px; color: var(--text-primary); font-size: 0.88rem; font-weight: 700;">$1</h5>')
    .replace(/^### (.*?)$/gm, '<h4 style="margin: 16px 0 8px; color: var(--text-primary); font-size: 0.98rem; font-weight: 700;">$1</h4>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; font-family: var(--font-mono); font-size: 0.82em;">$1</code>')
    .replace(/^[•\-] (.*?)$/gm, '<div style="margin: 3px 0; padding-left: 12px; position: relative;"><span style="position: absolute; left: 0; color: var(--accent-primary);">•</span>$1</div>')
    .replace(/\n\n/g, '<div style="height: 8px;"></div>')
    .replace(/\n/g, '<br>');
}
