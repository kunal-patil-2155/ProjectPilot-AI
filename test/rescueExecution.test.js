/**
 * ProjectPilot AI - Phase 4: Sequential Action Execution Engine,
 * Authorization, and Post-Execution Verification Test Suite
 * 
 * Covers all 24 required scenarios:
 *  1. Button approval initiates execution
 *  2. "yes" does not initiate execution
 *  3. "approve" does not initiate execution
 *  4. Cancelled plans cannot execute
 *  5. Stale plans cannot execute
 *  6. Manual actions cannot enter write queue
 *  7. Unknown action IDs rejected
 *  8. Unsupported tool names rejected
 *  9. Malformed parameters rejected
 * 10. Actions execute sequentially
 * 11. Project deletion handled safely
 * 12. Task deletion handled safely (marked SKIPPED_STALE)
 * 13. Task status change before execution detected (marked SKIPPED_STALE)
 * 14. Project ownership mismatches rejected
 * 15. Successful write verified against persisted data
 * 16. Failed write not reported successful
 * 17. Lost response does not trigger blind duplicate write
 * 18. Partial failure preserves earlier successful results
 * 19. Duplicate approval clicks do not duplicate execution (concurrency mutex)
 * 20. Cancellation during execution follows safe policy
 * 21. Final health assessment recalculated from actual persisted data
 * 22. Prior workflows still pass
 * 23. Security controls still pass
 * 24. No secrets in logs or responses
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../src/server.js';
import { McpBrowserClient } from '../public/js/api/mcpClient.js';
import { AssistantOrchestrator, RESCUE_STATES } from '../public/js/orchestrator.js';
import { RescueExecutionEngine, ACTION_OUTCOMES } from '../public/js/rescueExecutionEngine.js';

describe('Autonomous Project Rescue - Sequential Action Execution & Verification (Phase 4)', () => {
  let tempDir;
  let serverInstance;
  let storePath;
  let client;
  let orchestrator;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-phase4-test-'));
    storePath = path.join(tempDir, 'phase4-store.json');
    serverInstance = await createServer({ storePath, rateLimit: { enabled: false } });
    const addr = await serverInstance.start(0);

    const mcpUrl = `http://localhost:${addr.port}/mcp`;
    client = new McpBrowserClient(mcpUrl);
    await client.connect();
    orchestrator = new AssistantOrchestrator(client);
  });

  after(async () => {
    if (client) await client.disconnect();
    if (serverInstance) await serverInstance.stop();
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(() => {
    orchestrator.cancelRescuePlan();
  });

  // Scenario 1: Button approval initiates execution
  test('1. Button approval initiates sequential execution and returns verification report', async () => {
    // Stage a rescue plan for Mobile Checkout SDK (proj-checkout)
    const prep = await orchestrator.process('Rescue project Mobile Checkout SDK');
    assert.equal(prep.workflow, 'rescue_plan');
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);
    assert.ok(orchestrator.selectedActionIds.size > 0);

    const progressUpdates = [];
    const executionResult = await orchestrator.executeRescuePlan((actionId, outcome, record) => {
      progressUpdates.push({ actionId, outcome });
    });

    assert.equal(executionResult.workflow, 'rescue_execution');
    assert.equal(executionResult.rescueState, RESCUE_STATES.COMPLETED);
    assert.ok(executionResult.report);
    assert.equal(executionResult.report.status, 'COMPLETED');
    assert.ok(executionResult.report.summary.succeeded > 0);
    assert.equal(executionResult.report.summary.failed, 0);
    assert.ok(progressUpdates.length > 0);

    // Pending plan must be cleared so it cannot re-execute
    assert.equal(orchestrator.pendingRescuePlan, null);
    assert.equal(orchestrator.selectedActionIds.size, 0);

    // Verification card HTML and Markdown must be produced
    assert.ok(executionResult.cardHtml.includes('rescue-verification-card'));
    assert.ok(executionResult.cardHtml.includes('Execution &amp; Verification Report'));
    assert.ok(executionResult.explanation.includes('Rescue Plan Execution Report'));
  });

  // Scenario 2: Conversational "yes" does not initiate execution
  test('2. Natural-language "yes" does not initiate execution and never calls write tools', async () => {
    await orchestrator.process('Rescue project CloudSync Gateway');
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);

    const storeBefore = await fs.promises.readFile(storePath, 'utf8');

    const outcome = await orchestrator.process('yes');
    assert.equal(outcome.workflow, 'rescue_plan_guidance');
    assert.equal(outcome.toolCalls.length, 0);
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);

    const storeAfter = await fs.promises.readFile(storePath, 'utf8');
    assert.equal(storeBefore, storeAfter, 'Persistence store must remain completely untouched by "yes"');
  });

  // Scenario 3: Conversational "approve" does not initiate execution
  test('3. Natural-language "approve" does not initiate execution and never calls write tools', async () => {
    await orchestrator.process('Rescue project CloudSync Gateway');
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);

    const storeBefore = await fs.promises.readFile(storePath, 'utf8');

    const outcome = await orchestrator.process('approve');
    assert.equal(outcome.workflow, 'rescue_plan_guidance');
    assert.equal(outcome.toolCalls.length, 0);
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);

    const storeAfter = await fs.promises.readFile(storePath, 'utf8');
    assert.equal(storeBefore, storeAfter, 'Persistence store must remain completely untouched by "approve"');
  });

  // Scenario 4: Cancelled plans cannot execute
  test('4. Cancelled plans cannot execute', async () => {
    await orchestrator.process('Rescue project CloudSync Gateway');
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);

    orchestrator.cancelRescuePlan();
    assert.equal(orchestrator.rescueState, RESCUE_STATES.CANCELLED);
    assert.equal(orchestrator.pendingRescuePlan, null);

    await assert.rejects(
      async () => orchestrator.executeRescuePlan(),
      /Cannot execute rescue plan: No rescue plan is currently awaiting approval/
    );
  });

  // Scenario 5: Stale plans cannot execute
  test('5. Stale plans cannot execute if project was deleted before execution', async () => {
    // Create a temporary project and task
    const createProj = await client.callTool('create_project', {
      name: 'Transient Test App',
      category: 'Testing'
    });
    const projId = createProj.data.project.id;

    await client.callTool('create_task', {
      projectId: projId,
      title: 'Transient Blocker Task',
      status: 'blocked',
      blocker: 'Some obstacle'
    });

    // Stage rescue plan
    await orchestrator.process(`Rescue project ${projId}`);
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);

    // Delete project directly in store
    await serverInstance.store.deleteProject(projId);

    // Attempt execution
    const execResult = await orchestrator.executeRescuePlan();
    assert.equal(execResult.report.status, 'STALE_PLAN');
    assert.equal(execResult.rescueState, RESCUE_STATES.STALE_PLAN);
    assert.ok(
      execResult.report.error.includes('could not be retrieved') ||
      execResult.report.error.includes('not found') ||
      execResult.report.error.includes('prior to execution')
    );
  });

  // Scenario 6: Manual actions cannot enter write queue
  test('6. Manual recommendations cannot enter write queue or execute write tools', async () => {
    await orchestrator.process('Rescue project Mobile Checkout SDK');
    const plan = orchestrator.pendingRescuePlan;
    assert.ok(plan.notRemediable && plan.notRemediable.length > 0);

    // The executable actions array must only have allowlisted actions
    const allowedTypes = new Set(['UNBLOCK_TASK', 'ACTIVATE_PROJECT']);
    for (const a of plan.actions) {
      assert.ok(allowedTypes.has(a.type), `Action type ${a.type} must be allowlisted`);
    }

    // Manual items should never appear in plan.actions
    for (const manual of plan.notRemediable) {
      assert.ok(!plan.actions.some(a => a.id === manual.type || a.id === manual.title));
    }
  });

  // Scenario 7: Unknown action IDs rejected
  test('7. Unknown or injected action IDs are rejected prior to execution', async () => {
    await orchestrator.process('Rescue project CloudSync Gateway');
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);

    // Directly inject an unauthorized ID into the set
    orchestrator.selectedActionIds.add('injected-unauthorized-action-id');

    await assert.rejects(
      async () => orchestrator.executeRescuePlan(),
      /Unauthorized or invalid action ID "injected-unauthorized-action-id"/
    );
  });

  // Scenario 8: Unsupported tool names rejected
  test('8. Actions with unsupported tool names are safely rejected', async () => {
    const engine = new RescueExecutionEngine(client);
    const mockPlan = {
      planId: 'plan-test-unsupported',
      projectId: 'proj-cloudsync',
      projectName: 'CloudSync Gateway',
      actions: [{
        id: 'ACTION-BAD-TOOL',
        type: 'UNBLOCK_TASK',
        targetId: 'task-cloudsync-1',
        tool: 'delete_entire_database', // Disallowed tool
        params: { taskId: 'task-cloudsync-1' },
        preconditions: { currentStatus: 'blocked' }
      }]
    };

    const report = await engine.executePlan(mockPlan, ['ACTION-BAD-TOOL']);
    assert.equal(report.status, 'FAILED');
    assert.equal(report.actions[0].outcome, ACTION_OUTCOMES.FAILED);
    assert.ok(report.actions[0].error.includes('not permitted for automated rescue execution'));
  });

  // Scenario 9: Malformed parameters rejected
  test('9. Malformed parameters or unexpected keys are rejected before tool invocation', async () => {
    const engine = new RescueExecutionEngine(client);
    const mockPlan = {
      planId: 'plan-test-bad-param',
      projectId: 'proj-cloudsync',
      projectName: 'CloudSync Gateway',
      actions: [{
        id: 'ACTION-BAD-PARAM',
        type: 'UNBLOCK_TASK',
        targetId: 'task-cloudsync-1',
        tool: 'update_task_status',
        params: { taskId: 'task-cloudsync-1', status: 'invalid_status_value', injectedKey: true },
        preconditions: { currentStatus: 'blocked' }
      }]
    };

    const report = await engine.executePlan(mockPlan, ['ACTION-BAD-PARAM']);
    assert.equal(report.status, 'FAILED');
    assert.equal(report.actions[0].outcome, ACTION_OUTCOMES.FAILED);
    assert.ok(report.actions[0].error.includes('not permitted') || report.actions[0].error.includes('Invalid task status'));
  });

  // Scenario 10: Actions execute sequentially
  test('10. Actions execute sequentially with live progress updates in order', async () => {
    // Create two blocked tasks in a project
    const createProj = await client.callTool('create_project', {
      name: 'Sequential Execution Test App',
      category: 'Testing'
    });
    const projId = createProj.data.project.id;

    await client.callTool('create_task', {
      projectId: projId,
      title: 'Blocked Task 1',
      status: 'blocked',
      blocker: 'Blocker 1'
    });
    await client.callTool('create_task', {
      projectId: projId,
      title: 'Blocked Task 2',
      status: 'blocked',
      blocker: 'Blocker 2'
    });

    await orchestrator.process(`Rescue project ${projId}`);
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);

    const stepOrder = [];
    await orchestrator.executeRescuePlan((actionId, outcome) => {
      stepOrder.push(`${actionId}:${outcome}`);
    });

    // Check that each action entered RUNNING before SUCCEEDED sequentially
    assert.ok(stepOrder.length >= 4);
    assert.ok(stepOrder[0].endsWith(':RUNNING'));
    assert.ok(stepOrder[1].endsWith(':SUCCEEDED'));
    assert.ok(stepOrder[2].endsWith(':RUNNING'));
    assert.ok(stepOrder[3].endsWith(':SUCCEEDED'));
  });

  // Scenario 11: Project deletion handled safely mid-execution
  test('11. Project deletion handled safely: actions are skipped with clear rationale', async () => {
    const engine = new RescueExecutionEngine(client);
    const mockPlan = {
      planId: 'plan-test-nonexistent',
      projectId: 'proj-does-not-exist',
      projectName: 'Ghost Project',
      actions: [{
        id: 'ACTION-GHOST',
        type: 'UNBLOCK_TASK',
        targetId: 'task-ghost',
        tool: 'update_task_status',
        params: { taskId: 'task-ghost', status: 'in_progress' }
      }]
    };

    const report = await engine.executePlan(mockPlan, ['ACTION-GHOST']);
    assert.equal(report.status, 'STALE_PLAN');
    assert.ok(
      report.error.includes('Ghost Project') ||
      report.error.includes('proj-does-not-exist') ||
      report.error.includes('not found') ||
      report.error.includes('prior to execution')
    );
  });

  // Scenario 12: Task deletion handled safely (SKIPPED_STALE)
  test('12. Task deletion before execution is marked SKIPPED_STALE without halting loop', async () => {
    const createProj = await client.callTool('create_project', {
      name: 'Deleted Task Test App',
      category: 'Testing'
    });
    const projId = createProj.data.project.id;

    const t1 = await client.callTool('create_task', {
      projectId: projId,
      title: 'Will Be Deleted',
      status: 'blocked',
      blocker: 'Blocker A'
    });
    const t2 = await client.callTool('create_task', {
      projectId: projId,
      title: 'Will Remain',
      status: 'blocked',
      blocker: 'Blocker B'
    });

    await orchestrator.process(`Rescue project ${projId}`);
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);

    // Delete task 1 directly in store before executing plan
    await serverInstance.store.deleteTask(t1.data.task.id);

    const execResult = await orchestrator.executeRescuePlan();
    assert.equal(execResult.report.status, 'PARTIALLY_COMPLETED');

    const skippedAction = execResult.report.actions.find(a => a.targetId === t1.data.task.id);
    const succeededAction = execResult.report.actions.find(a => a.targetId === t2.data.task.id);

    assert.equal(skippedAction.outcome, ACTION_OUTCOMES.SKIPPED_STALE);
    assert.ok(skippedAction.error.includes('deleted or is missing'));
    assert.equal(succeededAction.outcome, ACTION_OUTCOMES.SUCCEEDED);
  });

  // Scenario 13: Task status change before execution detected (SKIPPED_STALE)
  test('13. Pre-execution task status change is detected and marked SKIPPED_STALE', async () => {
    const createProj = await client.callTool('create_project', {
      name: 'State Changed Test App',
      category: 'Testing'
    });
    const projId = createProj.data.project.id;

    const t = await client.callTool('create_task', {
      projectId: projId,
      title: 'Already Resolved Task',
      status: 'blocked',
      blocker: 'Dependency missing'
    });

    await orchestrator.process(`Rescue project ${projId}`);
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);

    // Someone else resolves the blocker and sets task to in_progress
    await client.callTool('update_task_status', {
      taskId: t.data.task.id,
      status: 'in_progress'
    });

    const execResult = await orchestrator.executeRescuePlan();
    const actionRecord = execResult.report.actions[0];
    assert.equal(actionRecord.outcome, ACTION_OUTCOMES.SKIPPED_STALE);
    assert.ok(actionRecord.error.includes('already in "in_progress" state with no active blocker'));
  });

  // Scenario 13B: Blocker text changed after planning is detected and marked SKIPPED_STALE
  test('13B. Pre-execution blocker text change is detected and marked SKIPPED_STALE', async () => {
    const createProj = await client.callTool('create_project', {
      name: 'Blocker Text Changed App',
      category: 'Testing'
    });
    const projId = createProj.data.project.id;

    const t = await client.callTool('create_task', {
      projectId: projId,
      title: 'Task With Dynamic Blocker',
      status: 'blocked',
      blocker: 'Original blocker reason'
    });

    await orchestrator.process(`Rescue project ${projId}`);
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);

    // Another user updates the blocker text
    await serverInstance.store.updateTask(t.data.task.id, {
      blocker: 'Brand new completely different blocker reason'
    });

    const execResult = await orchestrator.executeRescuePlan();
    const actionRecord = execResult.report.actions[0];
    assert.equal(actionRecord.outcome, ACTION_OUTCOMES.SKIPPED_STALE);
    assert.ok(actionRecord.error.includes('Task blocker text changed after planning'));
  });

  // Scenario 13C: Project status changed after planning is detected and marked SKIPPED_STALE
  test('13C. Pre-execution project status change is detected and marked SKIPPED_STALE', async () => {
    const createProj = await client.callTool('create_project', {
      name: 'Project Status Changed App',
      status: 'paused',
      category: 'Testing'
    });
    const projId = createProj.data.project.id;

    await client.callTool('create_task', {
      projectId: projId,
      title: 'Normal Task in Paused Project',
      status: 'todo'
    });

    await orchestrator.process(`Rescue project ${projId}`);
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);

    // Another user sets project to active
    await client.callTool('update_project', {
      projectId: projId,
      status: 'active'
    });

    const execResult = await orchestrator.executeRescuePlan();
    const actionRecord = execResult.report.actions[0];
    assert.equal(actionRecord.outcome, ACTION_OUTCOMES.SKIPPED_STALE);
    assert.ok(actionRecord.error.includes('Project status changed') || actionRecord.error.includes('already active'));
  });

  // Scenario 14: Project ownership mismatches rejected
  test('14. Project ownership mismatches are detected and rejected', async () => {
    const p1 = await client.callTool('create_project', { name: 'Owner App 1', category: 'Testing' });
    const p2 = await client.callTool('create_project', { name: 'Owner App 2', category: 'Testing' });

    const t = await client.callTool('create_task', {
      projectId: p2.data.project.id,
      title: 'Task in App 2',
      status: 'blocked',
      blocker: 'App 2 Blocker'
    });

    // Manually forge a plan targeting p1 but referencing task from p2
    const engine = new RescueExecutionEngine(client);
    const forgedPlan = {
      planId: 'plan-ownership-mismatch',
      projectId: p1.data.project.id,
      projectName: 'Owner App 1',
      actions: [{
        id: 'ACTION-MISMATCH',
        type: 'UNBLOCK_TASK',
        targetId: t.data.task.id,
        tool: 'update_task_status',
        params: { taskId: t.data.task.id, status: 'in_progress' }
      }]
    };

    const report = await engine.executePlan(forgedPlan, ['ACTION-MISMATCH']);
    assert.equal(report.actions[0].outcome, ACTION_OUTCOMES.SKIPPED_STALE);
    assert.ok(report.actions[0].error.includes('deleted or is missing') || report.actions[0].error.includes('ownership mismatch'));
  });

  // Scenario 15: Successful write verified against persisted data
  test('15. Successful write is verified against persisted data via re-read', async () => {
    const createProj = await client.callTool('create_project', {
      name: 'Verification App',
      category: 'Testing'
    });
    const projId = createProj.data.project.id;

    const t = await client.callTool('create_task', {
      projectId: projId,
      title: 'Verify Me Task',
      status: 'blocked',
      blocker: 'Critical bug'
    });

    await orchestrator.process(`Rescue project ${projId}`);
    const execResult = await orchestrator.executeRescuePlan();

    assert.equal(execResult.report.status, 'COMPLETED');
    const actionRecord = execResult.report.actions[0];
    assert.equal(actionRecord.verified, true);
    assert.equal(actionRecord.outcome, ACTION_OUTCOMES.SUCCEEDED);
    assert.equal(actionRecord.afterState.status, 'in_progress');
    assert.equal(actionRecord.afterState.blocker, null);

    // Verify directly in persistence file on disk
    const onDiskData = JSON.parse(await fs.promises.readFile(storePath, 'utf8'));
    const diskTask = onDiskData.tasks.find(tk => tk.id === t.data.task.id);
    assert.equal(diskTask.status, 'in_progress');
    assert.equal(diskTask.blocker, null);
  });

  // Scenario 16: Failed write not reported successful
  test('16. Failed write is not reported successful', async () => {
    const engine = new RescueExecutionEngine(client);
    const mockPlan = {
      planId: 'plan-fail-test',
      projectId: 'proj-cloudsync',
      projectName: 'CloudSync Gateway',
      actions: [{
        id: 'ACTION-INVALID-WRITE',
        type: 'UNBLOCK_TASK',
        targetId: 'task-cloudsync-1',
        tool: 'update_task_status',
        params: { taskId: 'non-existent-task-id-12345', status: 'in_progress' },
        preconditions: { currentStatus: 'blocked' }
      }]
    };

    const report = await engine.executePlan(mockPlan, ['ACTION-INVALID-WRITE']);
    assert.equal(report.status, 'FAILED');
    assert.equal(report.actions[0].outcome, ACTION_OUTCOMES.SKIPPED_STALE);
    assert.equal(report.actions[0].verified, false);
  });

  // Scenario 17: Lost response / timeout does not trigger blind duplicate write
  test('17. Lost response does not trigger blind duplicate write', async () => {
    // Create a project with a truly blocked task
    const p = await client.callTool('create_project', { name: 'Timeout Test App', category: 'Testing' });
    const t = await client.callTool('create_task', {
      projectId: p.data.project.id,
      title: 'Blocked Timeout Task',
      status: 'blocked',
      blocker: 'Timeout blocker'
    });

    let writeCallCount = 0;
    const mockClient = {
      async callTool(tool, args) {
        if (tool === 'get_project_details') {
          return client.callTool('get_project_details', args);
        }
        if (tool === 'get_project_health') {
          return client.callTool('get_project_health', args);
        }
        if (tool === 'update_task_status') {
          writeCallCount++;
          throw new Error('Connection timeout simulation');
        }
        return client.callTool(tool, args);
      }
    };

    const engine = new RescueExecutionEngine(mockClient);
    const mockPlan = {
      planId: 'plan-timeout-test',
      projectId: p.data.project.id,
      projectName: 'Timeout Test App',
      actions: [{
        id: 'ACTION-TIMEOUT',
        type: 'UNBLOCK_TASK',
        targetId: t.data.task.id,
        tool: 'update_task_status',
        params: { taskId: t.data.task.id, status: 'in_progress' },
        preconditions: { currentStatus: 'blocked' }
      }]
    };

    const report = await engine.executePlan(mockPlan, ['ACTION-TIMEOUT']);
    assert.equal(writeCallCount, 1, 'Write tool must only be called once, no blind retry');
    assert.equal(report.actions[0].outcome, ACTION_OUTCOMES.FAILED);
  });

  // Scenario 18: Partial failure preserves earlier successful results
  test('18. Partial failure preserves earlier successful results and reports PARTIALLY_COMPLETED', async () => {
    const createProj = await client.callTool('create_project', {
      name: 'Partial Success App',
      category: 'Testing'
    });
    const projId = createProj.data.project.id;

    const tGood = await client.callTool('create_task', {
      projectId: projId,
      title: 'Good Task',
      status: 'blocked',
      blocker: 'Blocker 1'
    });
    const tBad = await client.callTool('create_task', {
      projectId: projId,
      title: 'Task To Break',
      status: 'blocked',
      blocker: 'Blocker 2'
    });

    await orchestrator.process(`Rescue project ${projId}`);
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);

    // Delete tBad right before execution so action 2 fails with SKIPPED_STALE
    await serverInstance.store.deleteTask(tBad.data.task.id);

    const execResult = await orchestrator.executeRescuePlan();
    assert.equal(execResult.report.status, 'PARTIALLY_COMPLETED');
    assert.equal(execResult.rescueState, RESCUE_STATES.PARTIALLY_COMPLETED);

    const goodRecord = execResult.report.actions.find(a => a.targetId === tGood.data.task.id);
    const badRecord = execResult.report.actions.find(a => a.targetId === tBad.data.task.id);

    assert.equal(goodRecord.outcome, ACTION_OUTCOMES.SUCCEEDED);
    assert.equal(goodRecord.verified, true);
    assert.equal(badRecord.outcome, ACTION_OUTCOMES.SKIPPED_STALE);

    // Ensure good task actually persisted as in_progress in the file
    const diskData = JSON.parse(await fs.promises.readFile(storePath, 'utf8'));
    const diskGood = diskData.tasks.find(t => t.id === tGood.data.task.id);
    assert.equal(diskGood.status, 'in_progress');
  });

  // Scenario 19: Duplicate approval clicks do not duplicate execution (concurrency mutex)
  test('19. Duplicate execution requests are rejected by concurrency mutex', async () => {
    const createProj = await client.callTool('create_project', {
      name: 'Concurrency Mutex App',
      category: 'Testing'
    });
    const projId = createProj.data.project.id;

    await client.callTool('create_task', {
      projectId: projId,
      title: 'Mutex Task',
      status: 'blocked',
      blocker: 'Blocker'
    });

    await orchestrator.process(`Rescue project ${projId}`);
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);

    // Launch first execution
    const firstExecPromise = orchestrator.executeRescuePlan();

    // Immediate second execution must be rejected
    await assert.rejects(
      async () => orchestrator.executeRescuePlan(),
      /Cannot execute rescue plan: No rescue plan is currently awaiting approval|Execution already in progress/
    );

    const finalReport = await firstExecPromise;
    assert.equal(finalReport.report.status, 'COMPLETED');
  });

  // Scenario 19B: Duplicate action IDs in selection array do not cause duplicate execution
  test('19B. Duplicate action IDs in selection array do not cause duplicate execution', async () => {
    const createProj = await client.callTool('create_project', {
      name: 'Deduplication App',
      category: 'Testing'
    });
    const projId = createProj.data.project.id;

    await client.callTool('create_task', {
      projectId: projId,
      title: 'Dedup Task',
      status: 'blocked',
      blocker: 'Dedup blocker'
    });

    const planRes = await client.callTool('generate_rescue_plan', { projectId: projId });
    const plan = planRes.data;
    const actionId = plan.actions[0].id;

    let writeCalls = 0;
    const mockClient = {
      async callTool(tool, args) {
        if (tool === 'update_task_status') writeCalls++;
        return client.callTool(tool, args);
      }
    };

    const engine = new RescueExecutionEngine(mockClient);
    // Pass duplicate action ID array: [actionId, actionId, actionId]
    const report = await engine.executePlan(plan, [actionId, actionId, actionId]);
    assert.equal(report.status, 'COMPLETED');
    assert.equal(writeCalls, 1, 'Action must only be executed once despite duplicate IDs in input array');
  });

  // Scenario 20: Cancellation during execution follows safe policy
  test('20. Mid-execution cancellation safely stops execution after current step', async () => {
    const createProj = await client.callTool('create_project', {
      name: 'Mid Cancellation App',
      category: 'Testing'
    });
    const projId = createProj.data.project.id;

    await client.callTool('create_task', {
      projectId: projId,
      title: 'Task Alpha',
      status: 'blocked',
      blocker: 'Blocker A'
    });
    await client.callTool('create_task', {
      projectId: projId,
      title: 'Task Beta',
      status: 'blocked',
      blocker: 'Blocker B'
    });

    await orchestrator.process(`Rescue project ${projId}`);
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);

    // Hook progress callback to request cancellation after first step succeeds
    let cancelledTriggered = false;
    const execResult = await orchestrator.executeRescuePlan((actionId, outcome) => {
      if (outcome === ACTION_OUTCOMES.SUCCEEDED && !cancelledTriggered) {
        cancelledTriggered = true;
        orchestrator.cancelRescuePlan();
      }
    });

    // One action should have SUCCEEDED, the next should be CANCELLED
    const succeeded = execResult.report.actions.filter(a => a.outcome === ACTION_OUTCOMES.SUCCEEDED);
    const cancelled = execResult.report.actions.filter(a => a.outcome === ACTION_OUTCOMES.CANCELLED);

    assert.equal(succeeded.length, 1);
    assert.equal(cancelled.length, 1);
  });

  // Scenario 21: Final health assessment recalculated from actual data
  test('21. Final health assessment is recalculated from actual persisted state', async () => {
    const createProj = await client.callTool('create_project', {
      name: 'Health Recalculation App',
      category: 'Testing'
    });
    const projId = createProj.data.project.id;

    await client.callTool('create_task', {
      projectId: projId,
      title: 'Solitary Critical Blocker',
      priority: 'critical',
      status: 'blocked',
      blocker: 'Fatal API error'
    });

    await orchestrator.process(`Rescue project ${projId}`);
    const execResult = await orchestrator.executeRescuePlan();

    assert.ok(execResult.report.recalculatedHealth, 'Must contain post-execution recalculated health');
    assert.equal(execResult.report.recalculatedHealth.projectId, projId);
    // Baseline was At Risk due to active critical blocker
    assert.equal(execResult.report.baselineHealth.healthStatus, 'At Risk');
    // Now that blocker is cleared and task is in_progress, risk is removed
    assert.ok(
      execResult.report.recalculatedHealth.healthStatus === 'Healthy' ||
      execResult.report.recalculatedHealth.healthStatus === 'Attention Needed'
    );
  });

  // Scenario 22: Prior workflows still pass
  test('22. Existing assistant workflows continue to work seamlessly after rescue', async () => {
    // Daily priorities workflow
    const prioritiesOutcome = await orchestrator.process('What should I work on today?');
    assert.equal(prioritiesOutcome.workflow, 'daily_priorities');
    assert.ok(prioritiesOutcome.explanation.toLowerCase().includes('daily priorities'));

    // Project investigation workflow
    const inspectOutcome = await orchestrator.process('Inspect DevPulse Analytics');
    assert.equal(inspectOutcome.workflow, 'project_investigation');
    assert.ok(inspectOutcome.explanation.includes('DevPulse Analytics'));
  });

  // Scenario 23: Security tests still pass
  test('23. Security controls on disallowed tools and prototype keys remain enforced', async () => {
    const p = await client.callTool('create_project', { name: 'Proto Security App', category: 'Testing' });
    const t = await client.callTool('create_task', {
      projectId: p.data.project.id,
      title: 'Blocked Security Task',
      status: 'blocked',
      blocker: 'Security blocker'
    });

    const engine = new RescueExecutionEngine(client);
    const maliciousParams = JSON.parse(JSON.stringify({
      taskId: t.data.task.id,
      status: 'in_progress',
      unauthorizedKey: 'malicious-data'
    }));
    Object.defineProperty(maliciousParams, '__proto__', {
      value: { polluted: true },
      enumerable: true,
      configurable: true
    });

    const maliciousPlan = {
      planId: 'plan-security-test',
      projectId: p.data.project.id,
      projectName: 'Proto Security App',
      actions: [{
        id: 'ACTION-PROTOTYPE',
        type: 'UNBLOCK_TASK',
        targetId: t.data.task.id,
        tool: 'update_task_status',
        params: maliciousParams,
        preconditions: { currentStatus: 'blocked' }
      }]
    };

    const report = await engine.executePlan(maliciousPlan, ['ACTION-PROTOTYPE']);
    // Parameter validation or allowlist must reject unauthorized parameters
    assert.ok(report.actions[0].outcome === ACTION_OUTCOMES.FAILED || report.actions[0].outcome === ACTION_OUTCOMES.SKIPPED_STALE);
    assert.equal(Object.prototype.polluted, undefined, 'Prototype must not be polluted');
  });

  // Scenario 24: No secrets in logs or responses
  test('24. No secrets, credentials, or internal file paths leaked in report, card, or explanation', async () => {
    const createProj = await client.callTool('create_project', {
      name: 'Secret Leak Test App',
      category: 'Security'
    });
    const projId = createProj.data.project.id;

    await client.callTool('create_task', {
      projectId: projId,
      title: 'Secret Leak Task',
      status: 'blocked',
      blocker: 'Secret test blocker'
    });

    await orchestrator.process(`Rescue project ${projId}`);
    const execResult = await orchestrator.executeRescuePlan();

    const textToScan = [
      execResult.explanation,
      execResult.cardHtml,
      JSON.stringify(execResult.report)
    ].join(' ');

    assert.ok(!textToScan.includes('apiKey'), 'Must not disclose apiKey');
    assert.ok(!textToScan.includes('secret_'), 'Must not disclose secret tokens');
    assert.ok(!textToScan.includes('C:\\Users\\'), 'Must not disclose raw OS root paths in card');
  });
});
