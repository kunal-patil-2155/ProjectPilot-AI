/**
 * ProjectPilot AI - Autonomous Project Rescue Service Unit Tests (Phase 1)
 * Verifies pure, deterministic, evidence-based rescue planning.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateRescuePlan, SUPPORTED_RESCUE_TOOLS } from '../src/services/rescueService.js';
import { HealthService } from '../src/services/healthService.js';

describe('Autonomous Project Rescue - RescueService (Phase 1)', () => {

  // 1. Critical Blocker Detection & Supported Remediation
  test('1. Critical blocker detection produces supported update_task_status action with disclaimers', () => {
    const project = { id: 'proj-omega', name: 'Omega Cloud', status: 'active', priority: 'high' };
    const tasks = [
      {
        id: 'task-db-lock',
        projectId: 'proj-omega',
        title: 'Connection Pool Migration',
        status: 'blocked',
        priority: 'critical',
        blocker: 'Deadlock in PostgreSQL cluster under load',
        dueDate: new Date(Date.now() + 86400000).toISOString()
      },
      {
        id: 'task-auth-ok',
        projectId: 'proj-omega',
        title: 'OAuth Tokens',
        status: 'done',
        priority: 'high',
        dueDate: new Date(Date.now() + 86400000).toISOString()
      }
    ];

    const plan = generateRescuePlan(project, tasks);

    assert.equal(plan.projectId, 'proj-omega');
    assert.equal(plan.baselineHealth.healthStatus, 'At Risk');
    assert.equal(plan.actions.length, 1);

    const action = plan.actions[0];
    assert.equal(action.type, 'UNBLOCK_TASK');
    assert.equal(action.targetId, 'task-db-lock');
    assert.equal(action.tool, 'update_task_status');
    assert.deepEqual(action.params, {
      taskId: 'task-db-lock',
      status: 'in_progress'
    });
    assert.equal(action.riskLevel, 'medium');
    assert.ok(action.evidence.includes('Deadlock in PostgreSQL'));
    assert.ok(action.rationale.includes('Developer must verify'));
    assert.ok(action.isSafeToExecute);

    // Limitations must disclose the administrative boundary
    assert.ok(plan.limitations.some(l => l.includes('administratively clear blocker flags')));
  });

  // 2. Overdue Task Detection & Unsupported Deadline Changes
  test('2. Overdue task detection routes to notRemediable without fabricating deadline write tools', () => {
    const pastDate = new Date(Date.now() - 5 * 86400000).toISOString();
    const project = { id: 'proj-overdue', name: 'Overdue Project', status: 'active' };
    const tasks = [
      {
        id: 'task-overdue-1',
        projectId: 'proj-overdue',
        title: 'Deploy to Staging',
        status: 'in_progress',
        priority: 'critical',
        dueDate: pastDate
      }
    ];

    const plan = generateRescuePlan(project, tasks);

    // Overdue tasks cannot be rescheduled via existing MCP tools
    assert.equal(plan.actions.length, 0, 'No fake executable tool action should be proposed for deadline update');
    assert.ok(plan.notRemediable.some(nr => nr.type === 'OVERDUE_TASK_MANUAL_RESCHEDULE'));

    const overdueItem = plan.notRemediable.find(nr => nr.targetId === 'task-overdue-1');
    assert.ok(overdueItem);
    assert.equal(overdueItem.priority, 'critical');
    assert.ok(overdueItem.reason.includes('Existing MCP write tools do not support modifying task due dates'));
    assert.ok(plan.limitations.some(l => l.includes('Overdue task deadlines cannot be automatically modified')));
  });

  // 3. Zero-Task / Insufficient-Data Handling
  test('3. Zero-task project reports insufficient data and offers non-executable setup checklist', () => {
    const project = { id: 'proj-empty', name: 'Brand New Project', status: 'planning' };
    const tasks = [];

    const plan = generateRescuePlan(project, tasks);

    assert.equal(plan.baselineHealth.healthStatus, 'Insufficient Data');
    assert.equal(plan.actions.length, 0, 'Must produce 0 executable actions to prevent fabricating tasks');
    assert.equal(plan.projectedHealth, null, 'Must return null for projected health when data is insufficient');
    assert.ok(plan.notRemediable.some(nr => nr.type === 'INSUFFICIENT_DATA_SETUP_CHECKLIST'));

    const checklistItem = plan.notRemediable.find(nr => nr.type === 'INSUFFICIENT_DATA_SETUP_CHECKLIST');
    assert.ok(Array.isArray(checklistItem.checklist));
    assert.ok(checklistItem.checklist.length >= 3);
  });

  // 4. Healthy Project Produces No Unnecessary Actions
  test('4. Healthy project produces no unnecessary actions', () => {
    const project = {
      id: 'proj-healthy',
      name: 'Flawless API',
      status: 'active',
      description: 'Production ready service',
      category: 'Backend',
      techStack: ['Node.js', 'PostgreSQL'],
      repoUrl: 'https://github.com/org/flawless'
    };
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const tasks = [
      { id: 't-1', projectId: 'proj-healthy', title: 'Task 1', status: 'done', priority: 'medium', dueDate: futureDate },
      { id: 't-2', projectId: 'proj-healthy', title: 'Task 2', status: 'done', priority: 'high', dueDate: futureDate }
    ];

    const plan = generateRescuePlan(project, tasks);

    assert.equal(plan.baselineHealth.healthStatus, 'Healthy');
    assert.equal(plan.actions.length, 0);
    assert.equal(plan.notRemediable.length, 0);
    assert.ok(plan.projectedHealth);
    assert.equal(plan.projectedHealth.status, 'Healthy');
    assert.equal(plan.projectedHealth.statusChange, 'No Change (Healthy)');
    assert.equal(plan.projectedHealth.isImprovement, false);
  });

  // 5. Unsupported Changes Become Manual Recommendations (Bugs, Overdue, Metadata)
  test('5. Open bugs and missing metadata become manual recommendations in notRemediable', () => {
    const project = { id: 'proj-bugs', name: 'Buggy App', status: 'active', category: 'General' };
    const tasks = [
      {
        id: 'task-bug-1',
        projectId: 'proj-bugs',
        title: 'Buffer Overflow in Parser',
        status: 'todo',
        priority: 'critical',
        isBug: true
      }
    ];

    const plan = generateRescuePlan(project, tasks);

    // Bug cannot be marked done automatically
    assert.equal(plan.actions.length, 0);
    const bugItem = plan.notRemediable.find(nr => nr.type === 'OPEN_BUG_MANUAL_REPAIR');
    assert.ok(bugItem);
    assert.equal(bugItem.targetId, 'task-bug-1');
    assert.ok(bugItem.reason.includes('cannot verify source code fixes'));

    // Missing metadata recommendation
    assert.ok(plan.notRemediable.some(nr => nr.type === 'MISSING_PROJECT_METADATA'));
  });

  // 6. Every Executable Action Maps to a Real Supported MCP Tool Schema
  test('6. Every executable action maps strictly to a real supported MCP tool schema', () => {
    const project = { id: 'proj-schema', name: 'Schema Test', status: 'paused' };
    const tasks = [
      {
        id: 'task-blocked-1',
        projectId: 'proj-schema',
        title: 'Network Gateway',
        status: 'blocked',
        priority: 'high',
        blocker: 'Firewall rules'
      },
      {
        id: 'task-open-2',
        projectId: 'proj-schema',
        title: 'Documentation',
        status: 'todo',
        priority: 'medium'
      }
    ];

    const plan = generateRescuePlan(project, tasks);

    assert.ok(plan.actions.length >= 2, 'Should have unblock action and activate project action');
    for (const act of plan.actions) {
      assert.ok(SUPPORTED_RESCUE_TOOLS[act.tool], `Tool ${act.tool} must be in supported rescue tools`);
      const allowedParams = SUPPORTED_RESCUE_TOOLS[act.tool];
      for (const paramKey of Object.keys(act.params)) {
        assert.ok(
          allowedParams.includes(paramKey),
          `Parameter "${paramKey}" must be supported by MCP tool "${act.tool}". Allowed: ${allowedParams.join(', ')}`
        );
      }
    }
  });

  // 7. No Fabricated Project or Task Records
  test('7. No fabricated project or task records exist in actions', () => {
    const project = { id: 'proj-real-id', name: 'Real Project', status: 'active' };
    const tasks = [
      { id: 'task-real-alpha', projectId: 'proj-real-id', title: 'Task Alpha', status: 'blocked', priority: 'critical', blocker: 'Wait' }
    ];

    const plan = generateRescuePlan(project, tasks);

    for (const act of plan.actions) {
      if (act.tool === 'update_task_status') {
        assert.equal(act.targetId, 'task-real-alpha');
        assert.equal(act.params.taskId, 'task-real-alpha');
      }
      if (act.tool === 'update_project') {
        assert.equal(act.targetId, 'proj-real-id');
        assert.equal(act.params.projectId, 'proj-real-id');
      }
    }
  });

  // 8. No False Guarantee of Health Improvement
  test('8. Projected health derives strictly from health rules and never guarantees false perfection', () => {
    const pastDate = new Date(Date.now() - 3 * 86400000).toISOString();
    const project = { id: 'proj-mixed', name: 'Mixed Risks', status: 'active' };
    const tasks = [
      // 1 critical blocker (can be administratively unblocked)
      { id: 't-block', projectId: 'proj-mixed', title: 'Blocked Core', status: 'blocked', priority: 'critical', blocker: 'Vendor down' },
      // 1 critical overdue task (CANNOT be rescheduled automatically)
      { id: 't-overdue', projectId: 'proj-mixed', title: 'Overdue Core', status: 'todo', priority: 'critical', dueDate: pastDate }
    ];

    const plan = generateRescuePlan(project, tasks);

    assert.equal(plan.baselineHealth.healthStatus, 'At Risk');
    assert.equal(plan.actions.length, 1); // Unblocks t-block

    // Even though t-block is unblocked in projection, t-overdue remains overdue critical!
    // Therefore projected health MUST still be At Risk!
    assert.ok(plan.projectedHealth);
    assert.equal(plan.projectedHealth.status, 'At Risk', 'Projected health must remain At Risk due to unresolved critical overdue task');
    assert.equal(plan.projectedHealth.statusChange, 'No Change (At Risk)');
    assert.equal(plan.projectedHealth.isImprovement, false);
    assert.ok(plan.projectedHealth.disclaimer.includes('administrative estimate'));
  });

  // 9. Input Objects Remain Unchanged (Immutability)
  test('9. Input project, tasks, and health objects remain strictly unchanged', () => {
    const project = { id: 'proj-immutable', name: 'Immutable Test', status: 'paused', priority: 'medium' };
    const tasks = [
      { id: 't-imm-1', projectId: 'proj-immutable', title: 'Task 1', status: 'blocked', priority: 'high', blocker: 'Wait' },
      { id: 't-imm-2', projectId: 'proj-immutable', title: 'Task 2', status: 'done', priority: 'low' }
    ];

    // Deep freeze inputs to test immutability at the runtime engine level
    Object.freeze(project);
    tasks.forEach(t => Object.freeze(t));
    Object.freeze(tasks);

    const snapshotProj = JSON.stringify(project);
    const snapshotTasks = JSON.stringify(tasks);

    const plan = generateRescuePlan(project, tasks);

    assert.ok(plan);
    assert.equal(JSON.stringify(project), snapshotProj, 'Project object must not be mutated');
    assert.equal(JSON.stringify(tasks), snapshotTasks, 'Tasks array must not be mutated');
  });

  // 10. Deterministic Action Ordering
  test('10. Actions follow deterministic ordering (Critical blockers -> High blockers -> Project updates)', () => {
    const project = { id: 'proj-order', name: 'Ordering Test', status: 'paused' };
    const tasks = [
      { id: 't-low-block', projectId: 'proj-order', title: 'Low Block', status: 'blocked', priority: 'low', blocker: 'B1' },
      { id: 't-crit-block', projectId: 'proj-order', title: 'Crit Block', status: 'blocked', priority: 'critical', blocker: 'B2' },
      { id: 't-high-block', projectId: 'proj-order', title: 'High Block', status: 'blocked', priority: 'high', blocker: 'B3' }
    ];

    const plan1 = generateRescuePlan(project, tasks);
    const plan2 = generateRescuePlan(project, tasks);

    assert.deepEqual(
      plan1.actions.map(a => a.id),
      plan2.actions.map(a => a.id),
      'Action ordering must be 100% deterministic'
    );

    assert.equal(plan1.actions[0].id, 'action-unblock-t-crit-block', 'Critical blocker must be first');
    assert.equal(plan1.actions[1].id, 'action-unblock-t-high-block', 'High blocker must be second');
    assert.equal(plan1.actions[2].id, 'action-unblock-t-low-block', 'Low blocker must be third');
    assert.equal(plan1.actions[3].id, 'action-activate-proj-order', 'Project activation must follow task actions');
  });

  // 11. Missing or Malformed Optional Fields
  test('11. Handles missing or malformed optional fields safely', () => {
    const malformedProject = { id: 'proj-malformed' }; // Missing name, status, priority, description, etc.
    const malformedTasks = [
      { id: 't-mal-1' }, // Missing title, status, priority
      { id: 't-mal-2', dueDate: 'invalid-date-string', blocker: 'Some issue' },
      null, // null element in tasks
      undefined
    ];

    const plan = generateRescuePlan(malformedProject, malformedTasks);

    assert.ok(plan);
    assert.equal(plan.projectId, 'proj-malformed');
    assert.ok(Array.isArray(plan.actions));
    assert.ok(Array.isArray(plan.notRemediable));
  });

  // 12. Multiple Simultaneous Risks Handled Comprehensively
  test('12. Multiple simultaneous risks are comprehensively classified', () => {
    const pastDate = new Date(Date.now() - 4 * 86400000).toISOString();
    const futureDate = new Date(Date.now() + 4 * 86400000).toISOString();
    const project = { id: 'proj-multi', name: 'Multi Risk', status: 'paused' };
    const tasks = [
      { id: 't1', projectId: 'proj-multi', title: 'Critical Blocker', status: 'blocked', priority: 'critical', blocker: 'Auth fail' },
      { id: 't2', projectId: 'proj-multi', title: 'Normal Blocker', status: 'blocked', priority: 'medium', blocker: 'Asset pending' },
      { id: 't3', projectId: 'proj-multi', title: 'Overdue Critical', status: 'todo', priority: 'critical', dueDate: pastDate },
      { id: 't4', projectId: 'proj-multi', title: 'Critical Bug', status: 'todo', priority: 'critical', isBug: true },
      { id: 't5', projectId: 'proj-multi', title: 'Completed Work', status: 'done', priority: 'low', dueDate: futureDate }
    ];

    const plan = generateRescuePlan(project, tasks);

    // Executable actions: unblock t1, unblock t2, activate project
    assert.equal(plan.actions.length, 3);
    assert.ok(plan.actions.some(a => a.targetId === 't1'));
    assert.ok(plan.actions.some(a => a.targetId === 't2'));
    assert.ok(plan.actions.some(a => a.targetId === 'proj-multi'));

    // notRemediable: t3 (overdue), t4 (bug), missing metadata
    assert.ok(plan.notRemediable.some(nr => nr.targetId === 't3'));
    assert.ok(plan.notRemediable.some(nr => nr.targetId === 't4'));
    assert.ok(plan.notRemediable.some(nr => nr.type === 'MISSING_PROJECT_METADATA'));
  });

  // 13. Project and Task Identifiers are Preserved Correctly
  test('13. Project and task identifiers are preserved exactly in generated plan', () => {
    const customProjId = 'proj_alpha_99_special';
    const customTaskId = 'task_omega_88_critical';
    const project = { id: customProjId, name: 'Special Project', status: 'active' };
    const tasks = [
      { id: customTaskId, projectId: customProjId, title: 'Test Task', status: 'blocked', priority: 'high', blocker: 'API Limit' }
    ];

    const plan = generateRescuePlan(project, tasks);

    assert.equal(plan.projectId, customProjId);
    assert.equal(plan.planId, `rescue-plan-${customProjId}`);
    assert.equal(plan.actions[0].targetId, customTaskId);
    assert.equal(plan.actions[0].params.taskId, customTaskId);
  });

  // 14. Empty and Invalid Inputs Fail Safely
  test('14. Empty and invalid inputs fail safely with clear errors', () => {
    assert.throws(() => generateRescuePlan(null), /Invalid project: project must be a non-null object/);
    assert.throws(() => generateRescuePlan(undefined), /Invalid project: project must be a non-null object/);
    assert.throws(() => generateRescuePlan('not-an-object'), /Invalid project: project must be a non-null object/);
    assert.throws(() => generateRescuePlan({}), /Invalid project: project.id is required/);
    assert.throws(() => generateRescuePlan({ id: '   ' }), /Invalid project: project.id is required/);
  });

  // 15. Pre-calculated Health Object Can Be Provided
  test('15. Pre-calculated health object is respected when provided', () => {
    const project = { id: 'proj-precalc', name: 'Precalc Test', status: 'active' };
    const tasks = [
      { id: 't-pre-1', projectId: 'proj-precalc', title: 'Task', status: 'done', priority: 'low' }
    ];
    const customHealth = {
      healthStatus: 'Healthy',
      statusReasons: ['Custom health evaluation reason'],
      metrics: {
        totalTasks: 1,
        completedCount: 1,
        completionRate: 100,
        criticalBlockerCount: 0,
        nonCriticalBlockerCount: 0,
        overdueCount: 0,
        criticalBugCount: 0
      },
      evidence: {
        dataCompleteness: { percentage: 100, rating: 'Complete', missingMetadata: [] }
      }
    };

    const plan = generateRescuePlan(project, tasks, customHealth);

    assert.equal(plan.baselineHealth.healthStatus, 'Healthy');
    assert.equal(plan.baselineHealth.statusReasons[0], 'Custom health evaluation reason');
  });

});
