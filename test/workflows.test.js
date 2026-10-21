/**
 * ProjectPilot AI - Multi-Step Assistant Conversational Workflows Tests
 * Validates that user natural-language commands are transparently routed
 * to real MCP tool executions and verified before confirming state changes.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../src/server.js';
import { McpBrowserClient } from '../public/js/api/mcpClient.js';
import { AssistantOrchestrator } from '../public/js/orchestrator.js';

describe('Assistant Conversational Workflows (Alexa+ Track Simulation)', () => {
  let tempDir;
  let serverInstance;
  let client;
  let orchestrator;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-wf-test-'));
    const storePath = path.join(tempDir, 'wf-test-store.json');
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

  test('Workflow 1: Daily priorities ("What should I work on today?")', async () => {
    const outcome = await orchestrator.process('What should I work on today?');
    assert.equal(outcome.workflow, 'daily_priorities');
    assert.equal(outcome.toolCalls.length, 2, 'Should call get_priority_recommendations and list_blockers');

    assert.equal(outcome.toolCalls[0].name, 'get_priority_recommendations');
    assert.equal(outcome.toolCalls[1].name, 'list_blockers');

    assert.ok(outcome.explanation.includes('Here are your calculated daily priorities'));
    assert.ok(outcome.explanation.includes('Why prioritized'));
  });

  test('Workflow 2: Project investigation ("Inspect DevPulse Analytics")', async () => {
    const outcome = await orchestrator.process('Inspect DevPulse Analytics');
    assert.equal(outcome.workflow, 'project_investigation');

    const toolNames = outcome.toolCalls.map(tc => tc.name);
    assert.ok(toolNames.includes('list_projects'));
    assert.ok(toolNames.includes('get_project_details'));

    assert.ok(outcome.explanation.includes('DevPulse Analytics'));
    assert.ok(outcome.explanation.includes('Derived Health'));
    assert.ok(outcome.explanation.includes('Task Metrics'));
  });

  test('Workflow 3: Complete a task ("Complete task task-cloudsync-1")', async () => {
    const outcome = await orchestrator.process('Complete task task-cloudsync-1');
    assert.equal(outcome.workflow, 'complete_task');

    const updateCall = outcome.toolCalls.find(tc => tc.name === 'update_task_status');
    assert.ok(updateCall, 'Must call update_task_status');
    assert.equal(updateCall.args.taskId, 'task-cloudsync-1');
    assert.equal(updateCall.args.status, 'done');

    assert.ok(outcome.explanation.includes('Confirmed:'));
    assert.ok(outcome.explanation.includes('DONE'));
  });

  test('Workflow 4: Remaining work ("Show remaining work")', async () => {
    const outcome = await orchestrator.process('Show remaining work');
    assert.equal(outcome.workflow, 'remaining_work');

    const toolNames = outcome.toolCalls.map(tc => tc.name);
    assert.ok(toolNames.includes('list_tasks'));
    assert.ok(toolNames.includes('list_projects'));

    assert.ok(outcome.explanation.includes('Remaining Work Summary'));
  });

  test('Workflow 5: Maintenance review ("Review maintenance tasks")', async () => {
    const outcome = await orchestrator.process('Review maintenance tasks');
    assert.equal(outcome.workflow, 'maintenance_review');

    const maintCall = outcome.toolCalls.find(tc => tc.name === 'list_maintenance_tasks');
    assert.ok(maintCall, 'Must call list_maintenance_tasks');

    assert.ok(outcome.explanation.includes('Maintenance Tasks Review'));
    assert.ok(outcome.explanation.includes('OVERDUE MAINTENANCE'));
  });

  test('Ambiguity resolution: prompts user when multiple tasks match', async () => {
    // Both task-devpulse-leak and task-devpulse-db are pending and have 'devpulse' in ID
    const outcome = await orchestrator.process('complete task devpulse');
    assert.equal(outcome.workflow, 'complete_task_ambiguous');
    assert.ok(outcome.clarificationOptions.length >= 2, 'Should have at least 2 candidate options');
    assert.ok(outcome.explanation.includes('Multiple tasks match'));
  });

  test('Honest fallback for unsupported or out-of-scope requests', async () => {
    const outcome = await orchestrator.process('Write me a poetry about the moon');
    assert.equal(outcome.workflow, 'unsupported');
    assert.equal(outcome.toolCalls.length, 0);
    assert.ok(outcome.explanation.includes('transparent intent router rather than a generative model'));
  });
});
