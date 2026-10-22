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
