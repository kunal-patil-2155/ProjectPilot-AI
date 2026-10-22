import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../src/server.js';
import { McpBrowserClient } from '../public/js/api/mcpClient.js';
import { AssistantOrchestrator } from '../public/js/orchestrator.js';

describe('Advanced Conversational Orchestration & Execution Modes (Phases 3 & 4)', () => {
  let tempDir;
  let serverInstance;
  let client;
  let orchestrator;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-advanced-wf-'));
    const storePath = path.join(tempDir, 'advanced-wf-store.json');
    serverInstance = await createServer({ storePath });
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

  describe('1. Execution Modes (ASK, APPROVE, AUTOPILOT)', () => {
    test('defaults to APPROVE mode and switches correctly via commands', async () => {
      assert.equal(orchestrator.getExecutionMode(), 'APPROVE');

      const toAsk = await orchestrator.process('switch to ask mode');
      assert.equal(toAsk.workflow, 'mode_change');
      assert.equal(orchestrator.getExecutionMode(), 'ASK');
      assert.ok(toAsk.explanation.includes('ASK'));

      const toAutopilot = await orchestrator.process('switch to autopilot mode');
      assert.equal(toAutopilot.workflow, 'mode_change');
      assert.equal(orchestrator.getExecutionMode(), 'AUTOPILOT');
      assert.ok(toAutopilot.explanation.includes('AUTOPILOT'));

      await orchestrator.process('switch to approve mode');
      assert.equal(orchestrator.getExecutionMode(), 'APPROVE');
    });

    test('ASK mode proposes plan without performing state mutations', async () => {
      orchestrator.setExecutionMode('ASK');

      const outcome = await orchestrator.process('resolve blocker for task-checkout-oauth');
      assert.equal(outcome.workflow, 'manage_blocker_plan');
      assert.ok(outcome.explanation.includes('Proposed Action (ASK Mode)'));
      assert.ok(outcome.explanation.includes('Would update task'));

      // Verify task in store remains unchanged (still blocked)
      const tasksRes = await client.callTool('list_tasks', { status: 'blocked' });
      assert.ok(tasksRes.data.tasks.some(t => t.id === 'task-checkout-oauth'));

      // Switch back to APPROVE for subsequent tests
      orchestrator.setExecutionMode('APPROVE');
    });

    test('ASK mode: complete task returns advisory plan without mutating task status or calling write tools', async () => {
      orchestrator.setExecutionMode('ASK');

      const outcome = await orchestrator.process('Complete task task-cloudsync-1');
      assert.equal(outcome.workflow, 'complete_task_plan');
      assert.ok(!outcome.toolCalls.some(tc => tc.name === 'update_task_status'), 'Write tool update_task_status must NOT be called in ASK mode');
      assert.ok(outcome.explanation.includes('Proposed Task Completion (ASK Mode)'));
      assert.ok(outcome.explanation.includes('task-cloudsync-1'));
      assert.ok(outcome.explanation.includes('DONE'));
      assert.ok(!outcome.explanation.includes('Confirmed:'), 'Must not claim task was confirmed done');

      // Verify task in persistent store remains untouched (still todo)
      const tasksRes = await client.callTool('list_tasks', { projectId: 'proj-cloudsync' });
      const targetTask = tasksRes.data.tasks.find(t => t.id === 'task-cloudsync-1');
      assert.ok(targetTask);
      assert.equal(targetTask.status, 'in_progress', 'Task status must remain in_progress in store');
      assert.equal(targetTask.completedAt, null);

      orchestrator.setExecutionMode('APPROVE');
    });

    test('ASK mode: reopen task returns advisory plan without mutating task status', async () => {
      // Mark task as done directly first
      await client.callTool('update_task_status', { taskId: 'task-cloudsync-1', status: 'done' });

      orchestrator.setExecutionMode('ASK');

      const outcome = await orchestrator.process('reopen task task-cloudsync-1');
      assert.equal(outcome.workflow, 'reopen_task_plan');
      assert.ok(!outcome.toolCalls.some(tc => tc.name === 'update_task_status'), 'Write tool update_task_status must NOT be called in ASK mode');
      assert.ok(outcome.explanation.includes('Proposed Task Reopen (ASK Mode)'));
      assert.ok(outcome.explanation.includes('TODO'));
      assert.ok(!outcome.explanation.includes('Reopened Successfully'));

      // Verify task in persistent store remains done
      const tasksRes = await client.callTool('list_tasks', { projectId: 'proj-cloudsync' });
      const targetTask = tasksRes.data.tasks.find(t => t.id === 'task-cloudsync-1');
      assert.ok(targetTask);
      assert.equal(targetTask.status, 'done', 'Task status must remain done in store');

      orchestrator.setExecutionMode('APPROVE');
    });

    test('Ambiguous task identity does not mutate tasks', async () => {
      orchestrator.setExecutionMode('ASK');

      // Ambiguous complete query matching multiple tasks
      const ambigComplete = await orchestrator.process('complete task task');
      assert.equal(ambigComplete.workflow, 'complete_task_ambiguous');
      assert.ok(ambigComplete.clarificationOptions?.length > 1);
      assert.ok(!ambigComplete.toolCalls.some(tc => tc.name === 'update_task_status'));

      // Ambiguous reopen query matching multiple tasks
      const ambigReopen = await orchestrator.process('reopen task task');
      assert.equal(ambigReopen.workflow, 'reopen_task_ambiguous');
      assert.ok(ambigReopen.clarificationOptions?.length > 1);
      assert.ok(!ambigReopen.toolCalls.some(tc => tc.name === 'update_task_status'));

      orchestrator.setExecutionMode('APPROVE');
    });

    test('AUTOPILOT mode preserves direct execution with verification', async () => {
      orchestrator.setExecutionMode('AUTOPILOT');

      // Reopen task
      const reopenRes = await orchestrator.process('reopen task task-cloudsync-1');
      assert.equal(reopenRes.workflow, 'reopen_task');
      assert.ok(reopenRes.toolCalls.some(tc => tc.name === 'update_task_status'));
      assert.ok(reopenRes.explanation.includes('Task Reopened Successfully'));

      let tasksRes = await client.callTool('list_tasks', { projectId: 'proj-cloudsync' });
      let targetTask = tasksRes.data.tasks.find(t => t.id === 'task-cloudsync-1');
      assert.equal(targetTask.status, 'todo');

      // Complete task
      const completeRes = await orchestrator.process('Complete task task-cloudsync-1');
      assert.equal(completeRes.workflow, 'complete_task');
      assert.ok(completeRes.toolCalls.some(tc => tc.name === 'update_task_status'));
      assert.ok(completeRes.explanation.includes('DONE'));

      tasksRes = await client.callTool('list_tasks', { projectId: 'proj-cloudsync' });
      targetTask = tasksRes.data.tasks.find(t => t.id === 'task-cloudsync-1');
      assert.equal(targetTask.status, 'done');

      orchestrator.setExecutionMode('APPROVE');
    });

    test('APPROVE mode gating: autonomous multi-step rescue requires explicit approval', async () => {
      orchestrator.setExecutionMode('APPROVE');

      // 1. Staging a rescue plan produces preview card with zero mutating write calls
      const prep = await orchestrator.process('Rescue project Mobile Checkout SDK');
      assert.equal(prep.workflow, 'rescue_plan');
      assert.equal(prep.isApprovalCard, true);
      assert.ok(!prep.toolCalls.some(tc => tc.name === 'update_task_status' || tc.name === 'update_project'));

      // 2. Cancellation leaves state completely untouched
      const cancel = await orchestrator.process('cancel plan');
      assert.equal(cancel.workflow, 'rescue_plan_cancelled');

      // 3. Verify no mutation occurred on tasks
      const tasksRes = await client.callTool('list_tasks', { projectId: 'proj-checkout' });
      const blockedTask = tasksRes.data.tasks.find(t => t.id === 'task-checkout-oauth');
      assert.ok(blockedTask);
      assert.equal(blockedTask.status, 'blocked');
    });
  });

  describe('2. GitHub Repository Intelligence Workflow', () => {
    test('routes repository inspection for registered project', async () => {
      const outcome = await orchestrator.process('Audit repository for CloudSync Gateway');
      assert.equal(outcome.workflow, 'github_repo_inspection');
      assert.ok(outcome.explanation.includes('GitHub Repository Intelligence Report'));
      assert.ok(outcome.explanation.includes('cloudsync-gateway'));
    });

    test('handles project with no connected repository truthfully', async () => {
      // Create project with no repoUrl
      await client.callTool('create_project', {
        name: 'Local Offline Service',
        description: 'Internal tool without version control'
      });

      const outcome = await orchestrator.process('inspect repo for Local Offline Service');
      assert.equal(outcome.workflow, 'github_repo_inspection');
      assert.ok(outcome.explanation.includes('does not have a connected GitHub repository'));
    });
  });

  describe('3. Blocker Resolution & Health Recalculation', () => {
    test('resolves active blocker and surfaces recalculated health in AUTOPILOT mode', async () => {
      orchestrator.setExecutionMode('AUTOPILOT');

      const outcome = await orchestrator.process('resolve the blocker for DevPulse Analytics');
      assert.equal(outcome.workflow, 'manage_blocker');
      assert.ok(outcome.explanation.includes('Blocker Resolved Successfully'));
      assert.ok(outcome.explanation.includes('Updated Project Health'));

      // Verify task status changed from blocked to in_progress
      const tasksRes = await client.callTool('list_tasks', { projectId: 'proj-devpulse' });
      const unblocked = tasksRes.data.tasks.find(t => t.id === 'task-devpulse-leak');
      assert.ok(unblocked);
      assert.equal(unblocked.status, 'in_progress');
      assert.equal(unblocked.blocker, null);
    });
  });

  describe('4. Create Task Workflow', () => {
    test('creates and verifies task associated with specified project', async () => {
      orchestrator.setExecutionMode('AUTOPILOT');

      const outcome = await orchestrator.process('create critical task Database Sharding Audit for CloudSync Gateway');
      assert.equal(outcome.workflow, 'create_task');
      assert.ok(outcome.explanation.includes('Task Created Successfully'));
      assert.ok(outcome.explanation.includes('Database Sharding Audit'));
      assert.ok(outcome.explanation.includes('CRITICAL'));

      // Verify task persists
      const tasks = await client.callTool('list_tasks', { projectId: 'proj-cloudsync' });
      const found = tasks.data.tasks.find(t => t.title.includes('Database Sharding Audit'));
      assert.ok(found);
      assert.equal(found.priority, 'critical');
    });
  });

  describe('5. Reopen Task Workflow', () => {
    test('reopens completed task and verifies state mutation', async () => {
      // Mark done first
      await client.callTool('update_task_status', { taskId: 'task-cloudsync-1', status: 'done' });

      const outcome = await orchestrator.process('reopen task task-cloudsync-1');
      assert.equal(outcome.workflow, 'reopen_task');
      assert.ok(outcome.explanation.includes('Task Reopened Successfully'));
      assert.ok(outcome.explanation.includes('TODO'));

      const tasks = await client.callTool('list_tasks', { projectId: 'proj-cloudsync' });
      const task = tasks.data.tasks.find(t => t.id === 'task-cloudsync-1');
      assert.equal(task.status, 'todo');
      assert.equal(task.completedAt, null);
    });
  });

  describe('6. Audit Log Workflow', () => {
    test('retrieves recorded audit trail events', async () => {
      const outcome = await orchestrator.process('show audit log');
      assert.equal(outcome.workflow, 'audit_log');
      assert.ok(outcome.explanation.includes('Audit Trail & Activity History'));
    });
  });
});
