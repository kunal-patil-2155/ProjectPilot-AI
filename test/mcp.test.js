/**
 * ProjectPilot AI - MCP Protocol & Tools Integration Tests
 * Validates real Streamable HTTP transport, handshake, session handling,
 * tool discovery, and all 11 tool invocations against specification 2025-11-25.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../src/server.js';

describe('Model Context Protocol (MCP) Streamable HTTP Server', () => {
  let tempDir;
  let serverInstance;
  let port;
  let baseUrl;
  let sessionId;
  let nextId = 1;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-mcp-test-'));
    const storePath = path.join(tempDir, 'mcp-test-store.json');
    serverInstance = await createServer({ storePath });
    const addr = await serverInstance.start(0);
    port = addr.port;
    baseUrl = `http://localhost:${port}/mcp`;
  });

  after(async () => {
    await serverInstance.stop();
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // Helper to make JSON-RPC calls over Streamable HTTP
  async function callMcp(method, params = {}, customHeaders = {}) {
    const id = nextId++;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
      ...customHeaders
    };
    if (sessionId && !headers['mcp-session-id']) {
      headers['mcp-session-id'] = sessionId;
    }

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params
      })
    });

    const sid = res.headers.get('mcp-session-id');
    if (sid && !sessionId) sessionId = sid;

    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      // SSE format fallback
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          body = JSON.parse(line.slice(5).trim());
          break;
        }
      }
    }

    return { status: res.status, headers: res.headers, body };
  }

  test('Step 1: MCP Handshake & Protocol Version Negotiation (2025-11-25)', async () => {
    const res = await fetch(baseUrl, {
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
          clientInfo: { name: 'test-harness', version: '1.0.0' }
        }
      })
    });

    assert.equal(res.status, 200);
    sessionId = res.headers.get('mcp-session-id');
    assert.ok(sessionId, 'Server must return mcp-session-id in stateful mode');

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = JSON.parse(text.split('\n').find(l => l.startsWith('data:')).slice(5).trim());
    }

    assert.equal(data.result.protocolVersion, '2025-11-25');
    assert.equal(data.result.serverInfo.name, 'projectpilot-mcp');
    assert.ok(data.result.capabilities.tools);
  });

  test('Step 2: MCP notifications/initialized notification', async () => {
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
        method: 'notifications/initialized',
        params: {}
      })
    });

    assert.equal(res.status, 202, 'Notification must return HTTP 202 Accepted');
  });

  test('Step 3: Tool Discovery (tools/list) exposes all 11 mandatory tools', async () => {
    const { status, body } = await callMcp('tools/list');
    assert.equal(status, 200);
    assert.ok(body.result.tools, 'Result should have tools array');

    const expectedTools = [
      'list_projects',
      'get_project_details',
      'create_project',
      'update_project',
      'list_tasks',
      'create_task',
      'update_task_status',
      'list_blockers',
      'get_project_health',
      'get_priority_recommendations',
      'list_maintenance_tasks',
      'generate_rescue_plan'
    ];

    const discoveredNames = body.result.tools.map(t => t.name);
    for (const tool of expectedTools) {
      assert.ok(
        discoveredNames.includes(tool),
        `Mandatory MCP tool "${tool}" must be exposed in tools/list`
      );
    }
  });

  test('Tool 1: list_projects', async () => {
    const { status, body } = await callMcp('tools/call', {
      name: 'list_projects',
      arguments: { status: 'active' }
    });
    assert.equal(status, 200);
    const parsed = JSON.parse(body.result.content[0].text);
    assert.ok(parsed.count > 0);
    assert.ok(parsed.projects.every(p => p.status === 'active'));
  });

  test('Tool 2: get_project_details', async () => {
    const { status, body } = await callMcp('tools/call', {
      name: 'get_project_details',
      arguments: { projectId: 'proj-cloudsync' }
    });
    assert.equal(status, 200);
    const parsed = JSON.parse(body.result.content[0].text);
    assert.equal(parsed.project.id, 'proj-cloudsync');
    assert.ok(parsed.health);
    assert.ok(Array.isArray(parsed.project.tasks));
  });

  test('Tool 3: create_project', async () => {
    const { status, body } = await callMcp('tools/call', {
      name: 'create_project',
      arguments: {
        name: 'Event Gateway Service',
        description: 'Serverless event ingest broker',
        category: 'Backend',
        techStack: ['Node.js', 'AWS EventBridge'],
        priority: 'high'
      }
    });
    assert.equal(status, 200);
    const parsed = JSON.parse(body.result.content[0].text);
    assert.equal(parsed.project.name, 'Event Gateway Service');
    assert.ok(parsed.project.id);
  });

  test('Tool 4: update_project', async () => {
    const { status, body } = await callMcp('tools/call', {
      name: 'update_project',
      arguments: {
        projectId: 'proj-cloudsync',
        description: 'Updated sync gateway description'
      }
    });
    assert.equal(status, 200);
    const parsed = JSON.parse(body.result.content[0].text);
    assert.equal(parsed.project.description, 'Updated sync gateway description');
  });

  test('Tool 5: list_tasks', async () => {
    const { status, body } = await callMcp('tools/call', {
      name: 'list_tasks',
      arguments: { priority: 'critical' }
    });
    assert.equal(status, 200);
    const parsed = JSON.parse(body.result.content[0].text);
    assert.ok(parsed.count > 0);
    assert.ok(parsed.tasks.every(t => t.priority === 'critical'));
  });

  test('Tool 6: create_task', async () => {
    const { status, body } = await callMcp('tools/call', {
      name: 'create_task',
      arguments: {
        projectId: 'proj-cloudsync',
        title: 'Add HMAC payload signature validation',
        priority: 'high',
        status: 'todo'
      }
    });
    assert.equal(status, 200);
    const parsed = JSON.parse(body.result.content[0].text);
    assert.equal(parsed.task.title, 'Add HMAC payload signature validation');
    assert.equal(parsed.task.projectId, 'proj-cloudsync');
  });

  test('Tool 7: update_task_status', async () => {
    const { status, body } = await callMcp('tools/call', {
      name: 'update_task_status',
      arguments: {
        taskId: 'task-cloudsync-1',
        status: 'done'
      }
    });
    assert.equal(status, 200);
    const parsed = JSON.parse(body.result.content[0].text);
    assert.equal(parsed.task.status, 'done');
    assert.ok(parsed.task.completedAt);
  });

  test('Tool 8: list_blockers', async () => {
    const { status, body } = await callMcp('tools/call', {
      name: 'list_blockers',
      arguments: {}
    });
    assert.equal(status, 200);
    const parsed = JSON.parse(body.result.content[0].text);
    assert.ok(parsed.blockerCount >= 1);
    assert.ok(parsed.blockers.some(b => b.taskId === 'task-checkout-oauth'));
  });

  test('Tool 9: get_project_health', async () => {
    const { status, body } = await callMcp('tools/call', {
      name: 'get_project_health',
      arguments: { projectId: 'proj-checkout' }
    });
    assert.equal(status, 200);
    const parsed = JSON.parse(body.result.content[0].text);
    assert.equal(parsed.healthStatus, 'At Risk');
    assert.ok(parsed.metrics.explicitBlockers.length >= 1);
  });

  test('Tool 10: get_priority_recommendations', async () => {
    const { status, body } = await callMcp('tools/call', {
      name: 'get_priority_recommendations',
      arguments: { limit: 3 }
    });
    assert.equal(status, 200);
    const parsed = JSON.parse(body.result.content[0].text);
    assert.equal(parsed.recommendations.length, 3);
    assert.ok(parsed.recommendations[0].score >= parsed.recommendations[1].score);
  });

  test('Tool 11: list_maintenance_tasks', async () => {
    const { status, body } = await callMcp('tools/call', {
      name: 'list_maintenance_tasks',
      arguments: { includeCompleted: true }
    });
    assert.equal(status, 200);
    const parsed = JSON.parse(body.result.content[0].text);
    assert.ok(parsed.totalMaintenanceTasks >= 2);
    assert.ok(parsed.categories.overdue.length >= 1);
  });

  test('Tool 12: generate_rescue_plan', async () => {
    const { status, body } = await callMcp('tools/call', {
      name: 'generate_rescue_plan',
      arguments: { projectId: 'proj-checkout' }
    });
    assert.equal(status, 200);
    assert.ok(!body.result.isError);
    const plan = JSON.parse(body.result.content[0].text);
    assert.equal(plan.projectId, 'proj-checkout');
    assert.equal(plan.baselineHealth.healthStatus, 'At Risk');
    assert.ok(Array.isArray(plan.actions));
    assert.ok(Array.isArray(plan.notRemediable));
    assert.ok(Array.isArray(plan.limitations));
  });

  test('Error handling: tool error on invalid project query', async () => {
    const { status, body } = await callMcp('tools/call', {
      name: 'get_project_details',
      arguments: { projectId: 'non-existent-proj-id-xyz' }
    });
    assert.equal(status, 200);
    assert.equal(body.result.isError, true);
    assert.ok(body.result.content[0].text.includes('not found'));
  });

  test('Error handling: request with invalid session returns 404', async () => {
    const { status, body } = await callMcp('tools/list', {}, {
      'mcp-session-id': 'invalid-session-uuid-00000'
    });
    assert.equal(status, 404);
    assert.equal(body.error.code, -32001);
  });

  test('Session Termination: HTTP DELETE /mcp cleans up session', async () => {
    const res = await fetch(baseUrl, {
      method: 'DELETE',
      headers: {
        'mcp-session-id': sessionId
      }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'session_terminated');

    // Subsequent request with the deleted session must fail with 404
    const checkRes = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
        'mcp-protocol-version': '2025-11-25'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: nextId++,
        method: 'tools/list',
        params: {}
      })
    });
    assert.equal(checkRes.status, 404);
  });
});
