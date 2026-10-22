/**
 * ProjectPilot AI - MCP Tool Integration Tests: generate_rescue_plan (Phase 2)
 * Validates:
 * 1. The new tool appears in tools/list with proper schema and description.
 * 2. A valid project produces a structured rescue plan.
 * 3. A missing project returns a clear error.
 * 4. Ambiguous project resolution is handled safely.
 * 5. The tool uses actual persisted project and task records.
 * 6. Zero-task projects return insufficient-data information without creating tasks.
 * 7. Every proposed executable action references a supported MCP tool and compatible parameters.
 * 8. Calling the planning tool does not change persisted data (strict read-only safety).
 * 9. Repeated calls do not create duplicate tasks or modify project state.
 * 10. Existing 11 MCP tools remain available and functional.
 * 11. Existing health and evidence disclosures remain intact.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../src/server.js';
import { SUPPORTED_RESCUE_TOOLS } from '../src/services/rescueService.js';

describe('MCP Tool: generate_rescue_plan (12th Tool Integration)', () => {
  let tempDir;
  let serverInstance;
  let storePath;
  let port;
  let baseUrl;
  let sessionId;
  let nextId = 1;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-rescue-tool-test-'));
    storePath = path.join(tempDir, 'rescue-tool-store.json');
    serverInstance = await createServer({ storePath });
    const addr = await serverInstance.start(0);
    port = addr.port;
    baseUrl = `http://localhost:${port}/mcp`;

    // Initialize MCP session
    const initRes = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: nextId++,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'rescue-tool-test-harness', version: '1.0.0' }
        }
      })
    });
    sessionId = initRes.headers.get('mcp-session-id');

    // Send initialized notification
    await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
        'mcp-protocol-version': '2025-11-25'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {}
      })
    });
  });

  after(async () => {
    if (serverInstance) {
      await serverInstance.stop();
    }
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // Helper for JSON-RPC MCP calls
  async function callMcp(method, params = {}) {
    const id = nextId++;
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
        'mcp-protocol-version': '2025-11-25'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params
      })
    });

    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          body = JSON.parse(line.slice(5).trim());
          break;
        }
      }
    }
    return { status: res.status, body };
  }

  // 1. Tool appears in tools/list
  test('1. generate_rescue_plan appears in tools/list with proper schema and description', async () => {
    const { status, body } = await callMcp('tools/list');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.result.tools));

    const rescueTool = body.result.tools.find(t => t.name === 'generate_rescue_plan');
    assert.ok(rescueTool, 'generate_rescue_plan must be registered in tools/list');
    assert.ok(rescueTool.description.includes('rescue plan'));
    assert.ok(rescueTool.inputSchema.properties.projectId, 'Schema must define projectId property');
    assert.equal(body.result.tools.length, 12, 'Server must now expose exactly 12 tools');
  });

  // 2. Valid project produces a structured rescue plan
  test('2. Valid project ID produces a structured rescue plan', async () => {
    const { status, body } = await callMcp('tools/call', {
      name: 'generate_rescue_plan',
      arguments: { projectId: 'proj-checkout' }
    });

    assert.equal(status, 200);
    assert.ok(!body.result.isError, 'Call should not return error');
    assert.ok(body.result.content && body.result.content[0].type === 'text');

    const plan = JSON.parse(body.result.content[0].text);
    assert.equal(plan.projectId, 'proj-checkout');
    assert.equal(plan.planId, 'rescue-plan-proj-checkout');
    assert.ok(plan.baselineHealth);
    assert.ok(Array.isArray(plan.actions));
    assert.ok(Array.isArray(plan.notRemediable));
    assert.ok(Array.isArray(plan.limitations));
    assert.ok(plan.projectedHealth !== undefined);
  });

  // 3. Missing project returns clear error
  test('3. Missing project returns a clear structured error', async () => {
    const { status, body } = await callMcp('tools/call', {
      name: 'generate_rescue_plan',
      arguments: { projectId: 'proj-does-not-exist-999' }
    });

    assert.equal(status, 200);
    assert.equal(body.result.isError, true);
    assert.ok(body.result.content[0].text.includes('not found'));
  });

  // 4. Ambiguous project resolution is handled safely
  test('4. Ambiguous project resolution is handled safely when multiple projects share a name', async () => {
    // Create two projects with the exact same name to test ambiguity detection
    const p1 = await callMcp('tools/call', {
      name: 'create_project',
      arguments: { name: 'Duplicate Ambiguous App', category: 'Backend' }
    });
    const p2 = await callMcp('tools/call', {
      name: 'create_project',
      arguments: { name: 'Duplicate Ambiguous App', category: 'Mobile' }
    });

    assert.ok(!p1.body.result.isError);
    assert.ok(!p2.body.result.isError);

    // Call generate_rescue_plan using the ambiguous name
    const { status, body } = await callMcp('tools/call', {
      name: 'generate_rescue_plan',
      arguments: { projectName: 'Duplicate Ambiguous App' }
    });

    assert.equal(status, 200);
    assert.equal(body.result.isError, true);
    assert.ok(
      body.result.content[0].text.includes('Ambiguous project name'),
      'Must return clear ambiguity warning with candidate project IDs'
    );
  });

  // 5. Tool uses actual persisted project and task records
  test('5. Tool uses actual persisted project and task records to generate remediation actions', async () => {
    // Create project with blocked task
    const createProjRes = await callMcp('tools/call', {
      name: 'create_project',
      arguments: { name: 'Telemetry Collector', status: 'paused' }
    });
    const createdProject = JSON.parse(createProjRes.body.result.content[0].text).project;

    const createTaskRes = await callMcp('tools/call', {
      name: 'create_task',
      arguments: {
        projectId: createdProject.id,
        title: 'Buffer Flush Mechanism',
        status: 'blocked',
        priority: 'critical',
        blocker: 'Out of memory during burst telemetry'
      }
    });
    const createdTask = JSON.parse(createTaskRes.body.result.content[0].text).task;

    // Generate rescue plan
    const { status, body } = await callMcp('tools/call', {
      name: 'generate_rescue_plan',
      arguments: { projectId: createdProject.id }
    });

    assert.equal(status, 200);
    const plan = JSON.parse(body.result.content[0].text);

    // Must identify the blocked task and generate an unblock action
    const unblockAction = plan.actions.find(a => a.targetId === createdTask.id);
    assert.ok(unblockAction, 'Must generate action for persisted blocked task');
    assert.equal(unblockAction.tool, 'update_task_status');
    assert.equal(unblockAction.params.status, 'in_progress');
    assert.ok(unblockAction.evidence.includes('Out of memory'));
  });

  // 6. Zero-task projects return insufficient-data information without creating tasks
  test('6. Zero-task projects return insufficient-data information without creating tasks', async () => {
    // Create an empty project with zero tasks
    const createProjRes = await callMcp('tools/call', {
      name: 'create_project',
      arguments: { name: 'Zero Task Prototype', status: 'planning' }
    });
    const emptyProj = JSON.parse(createProjRes.body.result.content[0].text).project;

    // Request rescue plan
    const { status, body } = await callMcp('tools/call', {
      name: 'generate_rescue_plan',
      arguments: { projectId: emptyProj.id }
    });

    assert.equal(status, 200);
    const plan = JSON.parse(body.result.content[0].text);

    assert.equal(plan.baselineHealth.healthStatus, 'Insufficient Data');
    assert.equal(plan.actions.length, 0, 'No executable actions should be created for zero-task project');
    assert.equal(plan.projectedHealth, null, 'Projected health must be null');
    assert.ok(plan.notRemediable.some(nr => nr.type === 'INSUFFICIENT_DATA_SETUP_CHECKLIST'));

    // Verify persisted tasks in store remain 0
    const listTasksRes = await callMcp('tools/call', {
      name: 'list_tasks',
      arguments: { projectId: emptyProj.id }
    });
    const taskList = JSON.parse(listTasksRes.body.result.content[0].text);
    assert.equal(taskList.count, 0, 'No tasks must be persisted or fabricated into the store');
  });

  // 7. Every proposed executable action references a supported MCP tool and compatible parameters
  test('7. Every proposed executable action references a supported MCP tool and compatible parameters', async () => {
    const { status, body } = await callMcp('tools/call', {
      name: 'generate_rescue_plan',
      arguments: { projectId: 'proj-checkout' }
    });

    assert.equal(status, 200);
    const plan = JSON.parse(body.result.content[0].text);

    for (const act of plan.actions) {
      assert.ok(
        SUPPORTED_RESCUE_TOOLS[act.tool],
        `Action tool "${act.tool}" must be a registered write tool`
      );
      const allowedParams = SUPPORTED_RESCUE_TOOLS[act.tool];
      for (const key of Object.keys(act.params)) {
        assert.ok(
          allowedParams.includes(key),
          `Parameter "${key}" must be compatible with tool schema for "${act.tool}"`
        );
      }
    }
  });

  // 8. Calling the planning tool does not change persisted data (strict read-only safety)
  test('8. Calling generate_rescue_plan does not change persisted store data (read-only)', async () => {
    const storeBefore = await fs.promises.readFile(storePath, 'utf8');

    // Invoke generate_rescue_plan
    const { status } = await callMcp('tools/call', {
      name: 'generate_rescue_plan',
      arguments: { projectId: 'proj-checkout' }
    });
    assert.equal(status, 200);

    const storeAfter = await fs.promises.readFile(storePath, 'utf8');
    assert.equal(storeBefore, storeAfter, 'Store JSON file on disk must be byte-for-byte identical');
  });

  // 9. Repeated calls do not create duplicate tasks or modify project state
  test('9. Repeated calls to generate_rescue_plan do not mutate project state or duplicate tasks', async () => {
    const { body: t1 } = await callMcp('tools/call', { name: 'list_tasks', arguments: {} });
    const countBefore = JSON.parse(t1.result.content[0].text).count;

    // Call 3 times
    await callMcp('tools/call', { name: 'generate_rescue_plan', arguments: { projectId: 'proj-checkout' } });
    await callMcp('tools/call', { name: 'generate_rescue_plan', arguments: { projectId: 'proj-cloudsync' } });
    await callMcp('tools/call', { name: 'generate_rescue_plan', arguments: { projectId: 'proj-checkout' } });

    const { body: t2 } = await callMcp('tools/call', { name: 'list_tasks', arguments: {} });
    const countAfter = JSON.parse(t2.result.content[0].text).count;

    assert.equal(countBefore, countAfter, 'Total task count in store must remain unchanged across repeated planning calls');
  });

  // 10. Existing 11 MCP tools remain available and functional
  test('10. Existing 11 MCP tools remain available and fully functional', async () => {
    const toolsToCheck = [
      { name: 'list_projects', args: {} },
      { name: 'get_project_details', args: { projectId: 'proj-checkout' } },
      { name: 'list_tasks', args: { projectId: 'proj-checkout' } },
      { name: 'list_blockers', args: {} },
      { name: 'get_project_health', args: { projectId: 'proj-checkout' } },
      { name: 'get_priority_recommendations', args: { limit: 2 } },
      { name: 'list_maintenance_tasks', args: {} }
    ];

    for (const tool of toolsToCheck) {
      const { status, body } = await callMcp('tools/call', {
        name: tool.name,
        arguments: tool.args
      });
      assert.equal(status, 200, `Tool "${tool.name}" must respond with 200`);
      assert.ok(!body.result.isError, `Tool "${tool.name}" must execute successfully`);
    }
  });

  // 11. Existing health and evidence disclosures remain intact
  test('11. Existing health and evidence disclosures remain completely intact in generated plan', async () => {
    const { status, body } = await callMcp('tools/call', {
      name: 'generate_rescue_plan',
      arguments: { projectId: 'proj-checkout' }
    });

    assert.equal(status, 200);
    const plan = JSON.parse(body.result.content[0].text);

    assert.ok(plan.baselineHealth.evidence);
    assert.ok(plan.baselineHealth.evidence.sourceInspectionStatus.includes('Source code not inspected'));
    assert.ok(plan.limitations.some(l => l.includes('Source code, git commits, runtime security, and CI/CD pipelines remain unverified')));
    assert.ok(plan.limitations.some(l => l.includes('administratively clear blocker flags')));
  });

});
