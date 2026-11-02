/**
 * ProjectPilot AI - Judge Demo Mode & Sandboxed Security Integration Test Suite
 * Gate 2.22 Verification: Friction-Free Judge Experience & Production Isolation
 *
 * Verifies that:
 * 1. Anonymous Streamable HTTP initialize handshake succeeds with HTTP 200 and issues a signed session ID.
 * 2. Anonymous tools/list discovers the complete MCP tool catalog.
 * 3. Anonymous list_projects returns realistic sample projects from the demo sandbox.
 * 4. Anonymous get_project_details and get_project_health calculate truthful evidence-based health.
 * 5. Anonymous list_blockers retrieves active blockers accurately.
 * 6. Anonymous get_priority_recommendations computes prioritized recommendations with explicit reasoning.
 * 7. Anonymous generate_rescue_plan synthesizes a deterministic rescue plan with remediation actions.
 * 8. Anonymous safe demo mutation (update_task_status) updates task in the sandbox store.
 * 9. Production store isolation: anonymous mutations never touch or modify the persistent production store.
 * 10. Session isolation: mutations in session A's sandbox do not affect session B's sandbox.
 * 11. Administrative mutations (create_project, create_task) without master API key are rejected with HTTP 401.
 * 12. Destructive operations (delete_project, delete_task) without master API key are rejected with HTTP 401.
 * 13. Master API key authentication unlocks persistent store mutations for administrative and destructive operations.
 * 14. Gateway /api/info reports judgeDemoMode: true and operational statistics truthfully.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer, DemoSandboxStore } from '../src/server.js';
import { ProjectStore } from '../src/db/store.js';

describe('ProjectPilot AI — Judge Demo Mode & Sandboxed Security (Gate 2.22)', () => {
  let tempDir;
  let server;
  let port;
  let prodStore;

  const MASTER_API_KEY = 'master-admin-key-32-chars-judge-demo-pass';
  const MCP_BASE_HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-11-25',
    'x-judge-demo': 'true'
  };

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-judgedemo-'));
    prodStore = new ProjectStore(path.join(tempDir, 'prod-store.json'));
    await prodStore.init();

    // Create server with production settings, durable storage emulation, and Judge Demo Mode active
    server = await createServer({
      isProduction: true,
      isDurable: true,
      apiKey: MASTER_API_KEY,
      judgeDemoMode: true,
      store: prodStore,
      enableExtended: true
    });

    const addr = await server.start(0);
    port = addr.port;
  });

  after(async () => {
    if (server) await server.stop();
    if (tempDir) {
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // 1. Anonymous initialize handshake
  test('1. Anonymous initialize handshake succeeds with HTTP 200 and issues signed session ID', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: MCP_BASE_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'JudgeBrowserClient', version: '1.0' }
        }
      })
    });

    assert.equal(res.status, 200, 'Anonymous initialize handshake must succeed with HTTP 200 in Judge Demo Mode');
    const sessionId = res.headers.get('mcp-session-id');
    assert.ok(sessionId, 'Gateway must return signed mcp-session-id header');
    assert.match(sessionId, /^[a-zA-Z0-9_-]{1,128}$/, 'Session ID must conform to MCP spec regex');

    const body = await res.json();
    assert.equal(body.result?.serverInfo?.name, 'projectpilot-mcp');
    assert.equal(body.result?.protocolVersion, '2025-11-25');
  });

  // 2. Anonymous tools/list tool discovery
  test('2. Anonymous tools/list discovers the complete MCP tool catalog', async () => {
    // A. Init session
    const initRes = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: MCP_BASE_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Judge', version: '1.0' } }
      })
    });
    const sid = initRes.headers.get('mcp-session-id');

    // B. List tools
    const listRes = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { ...MCP_BASE_HEADERS, 'mcp-session-id': sid },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
        params: {}
      })
    });

    assert.equal(listRes.status, 200);
    const body = await listRes.json();
    assert.ok(Array.isArray(body.result?.tools));
    const toolNames = body.result.tools.map(t => t.name);

    assert.ok(toolNames.includes('list_projects'), 'Must discover list_projects');
    assert.ok(toolNames.includes('get_project_health'), 'Must discover get_project_health');
    assert.ok(toolNames.includes('get_priority_recommendations'), 'Must discover get_priority_recommendations');
    assert.ok(toolNames.includes('generate_rescue_plan'), 'Must discover generate_rescue_plan');
    assert.ok(toolNames.includes('update_task_status'), 'Must discover update_task_status');
  });

  // 3. Anonymous list_projects returns realistic sample projects
  test('3. Anonymous list_projects returns populated sample projects from demo sandbox', async () => {
    const initRes = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: MCP_BASE_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Judge', version: '1.0' } }
      })
    });
    const sid = initRes.headers.get('mcp-session-id');

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { ...MCP_BASE_HEADERS, 'mcp-session-id': sid },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'list_projects', arguments: {} }
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    assert.ok(data.projects.length >= 3, 'Must return populated sample projects');
    assert.ok(data.projects.some(p => p.id === 'proj-cloudsync'));
  });

  // 4. Anonymous get_project_details and get_project_health calculate truthful health
  test('4. Anonymous get_project_details and get_project_health calculate truthful health', async () => {
    const initRes = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: MCP_BASE_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Judge', version: '1.0' } }
      })
    });
    const sid = initRes.headers.get('mcp-session-id');

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { ...MCP_BASE_HEADERS, 'mcp-session-id': sid },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'get_project_health', arguments: { projectId: 'proj-cloudsync' } }
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    const health = JSON.parse(body.result.content[0].text);
    assert.equal(health.projectId, 'proj-cloudsync');
    assert.ok(health.healthStatus, 'Must report transparent health status');
    assert.ok(Array.isArray(health.statusReasons), 'Must report transparent status reasons');
    assert.ok(health.metrics, 'Must report metrics breakdown');
  });

  // 5. Anonymous list_blockers retrieves active blockers
  test('5. Anonymous list_blockers retrieves active blockers accurately', async () => {
    const initRes = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: MCP_BASE_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 8,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Judge', version: '1.0' } }
      })
    });
    const sid = initRes.headers.get('mcp-session-id');

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { ...MCP_BASE_HEADERS, 'mcp-session-id': sid },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'list_blockers', arguments: {} }
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    assert.ok(data.blockerCount >= 1);
    assert.ok(Array.isArray(data.blockers));
  });

  // 6. Anonymous get_priority_recommendations computes recommendations
  test('6. Anonymous get_priority_recommendations computes transparent rankings with reasoning', async () => {
    const initRes = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: MCP_BASE_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Judge', version: '1.0' } }
      })
    });
    const sid = initRes.headers.get('mcp-session-id');

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { ...MCP_BASE_HEADERS, 'mcp-session-id': sid },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'get_priority_recommendations', arguments: { limit: 5 } }
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    assert.ok(Array.isArray(data.recommendations));
    assert.ok(data.recommendations.length > 0);
    assert.ok(data.recommendations[0].reasons, 'Must contain transparent scoring reasons');
    assert.ok(data.recommendations[0].score !== undefined, 'Must contain computed priority score');
  });

  // 7. Anonymous generate_rescue_plan synthesizes valid rescue plan
  test('7. Anonymous generate_rescue_plan synthesizes deterministic rescue plan with remediation actions', async () => {
    const initRes = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: MCP_BASE_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 12,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Judge', version: '1.0' } }
      })
    });
    const sid = initRes.headers.get('mcp-session-id');

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { ...MCP_BASE_HEADERS, 'mcp-session-id': sid },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: { name: 'generate_rescue_plan', arguments: { projectId: 'proj-cloudsync' } }
      })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    const plan = JSON.parse(body.result.content[0].text);
    assert.ok(plan.projectId === 'proj-cloudsync' || plan.project?.id === 'proj-cloudsync');
    assert.ok(Array.isArray(plan.actions));
  });

  // 8. Anonymous safe demo mutation (update_task_status) succeeds in sandbox
  test('8. Anonymous safe demo mutation (update_task_status) modifies the sandbox store', async () => {
    const initRes = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: MCP_BASE_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 14,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Judge', version: '1.0' } }
      })
    });
    const sid = initRes.headers.get('mcp-session-id');

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { ...MCP_BASE_HEADERS, 'mcp-session-id': sid },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: {
          name: 'update_task_status',
          arguments: { taskId: 'task-cloudsync-1', status: 'done' }
        }
      })
    });

    assert.equal(res.status, 200, 'Safe demo mutation update_task_status must succeed with HTTP 200');
    const body = await res.json();
    assert.ok(!body.error);
    const result = JSON.parse(body.result.content[0].text);
    assert.equal(result.task?.status, 'done');
  });

  // 9. Production store isolation
  test('9. Production store isolation: anonymous mutations never touch persistent production store', async () => {
    // Record initial status in persistent prodStore
    const initialTask = prodStore.getTask('task-cloudsync-1');
    const initialStatus = initialTask.status;

    // Execute anonymous mutation in a demo session
    const initRes = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: MCP_BASE_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 16,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Judge', version: '1.0' } }
      })
    });
    const sid = initRes.headers.get('mcp-session-id');

    await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { ...MCP_BASE_HEADERS, 'mcp-session-id': sid },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 17,
        method: 'tools/call',
        params: {
          name: 'update_task_status',
          arguments: { taskId: 'task-cloudsync-1', status: 'done' }
        }
      })
    });

    // Check persistent prodStore directly
    const prodTaskAfter = prodStore.getTask('task-cloudsync-1');
    assert.equal(prodTaskAfter.status, initialStatus, 'Persistent production task status must remain untouched');
  });

  // 10. Session isolation
  test('10. Session isolation: mutations in session A do not affect session B', async () => {
    // Session A
    const resA = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: MCP_BASE_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 18,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Judge A', version: '1.0' } }
      })
    });
    const sidA = resA.headers.get('mcp-session-id');

    // Session B
    const resB = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: MCP_BASE_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 19,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Judge B', version: '1.0' } }
      })
    });
    const sidB = resB.headers.get('mcp-session-id');

    // Mutate in Session A
    await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { ...MCP_BASE_HEADERS, 'mcp-session-id': sidA },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/call',
        params: { name: 'update_task_status', arguments: { taskId: 'task-cloudsync-1', status: 'done' } }
      })
    });

    // Inspect in Session B
    const checkB = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { ...MCP_BASE_HEADERS, 'mcp-session-id': sidB },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/call',
        params: { name: 'list_tasks', arguments: { projectId: 'proj-cloudsync' } }
      })
    });
    const bodyB = await checkB.json();
    const dataB = JSON.parse(bodyB.result.content[0].text);
    const taskB = dataB.tasks.find(t => t.id === 'task-cloudsync-1');

    assert.notEqual(taskB.status, 'done', 'Session B must not observe mutations made in Session A');
  });

  // 11. Administrative mutations without master API key rejected with 401
  test('11. Administrative mutations (create_project, create_task) without master API key are rejected with HTTP 401', async () => {
    const initRes = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: MCP_BASE_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 22,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Judge', version: '1.0' } }
      })
    });
    const sid = initRes.headers.get('mcp-session-id');

    // Attempt create_project without key
    const projRes = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { ...MCP_BASE_HEADERS, 'mcp-session-id': sid },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 23,
        method: 'tools/call',
        params: { name: 'create_project', arguments: { name: 'Unauthorized Demo Project' } }
      })
    });

    assert.equal(projRes.status, 401);
    const projBody = await projRes.json();
    assert.ok(projBody.error?.message.includes('Administrative operation \'create_project\' is restricted'));

    // Attempt create_task without key
    const taskRes = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { ...MCP_BASE_HEADERS, 'mcp-session-id': sid },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 24,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { projectId: 'proj-cloudsync', title: 'Unauthorized Task' } }
      })
    });

    assert.equal(taskRes.status, 401);
    const taskBody = await taskRes.json();
    assert.ok(taskBody.error?.message.includes('Administrative operation \'create_task\' is restricted'));
  });

  // 12. Destructive operations without master API key rejected with 401
  test('12. Destructive operations (delete_project, delete_task) without master API key are rejected with HTTP 401', async () => {
    const initRes = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: MCP_BASE_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 25,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Judge', version: '1.0' } }
      })
    });
    const sid = initRes.headers.get('mcp-session-id');

    // Attempt delete_project without key
    const delProjRes = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { ...MCP_BASE_HEADERS, 'mcp-session-id': sid },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 26,
        method: 'tools/call',
        params: { name: 'delete_project', arguments: { projectId: 'proj-cloudsync', confirmDelete: true } }
      })
    });

    assert.equal(delProjRes.status, 401);
    const delBody = await delProjRes.json();
    assert.ok(delBody.error?.message.includes('delete_project'));

    // Attempt delete_task without key
    const delTaskRes = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { ...MCP_BASE_HEADERS, 'mcp-session-id': sid },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 27,
        method: 'tools/call',
        params: { name: 'delete_task', arguments: { taskId: 'task-cloudsync-1', confirmDelete: true } }
      })
    });

    assert.equal(delTaskRes.status, 401);
  });

  // 13. Master API key authentication unlocks persistent store mutations
  test('13. Master API key authentication unlocks persistent store mutations for administrative operations', async () => {
    // Authenticated initialize
    const initRes = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        ...MCP_BASE_HEADERS,
        'Authorization': `Bearer ${MASTER_API_KEY}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 28,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Admin', version: '1.0' } }
      })
    });
    assert.equal(initRes.status, 200);
    const sid = initRes.headers.get('mcp-session-id');

    // Create project with valid key
    const createRes = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        ...MCP_BASE_HEADERS,
        'mcp-session-id': sid,
        'Authorization': `Bearer ${MASTER_API_KEY}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 29,
        method: 'tools/call',
        params: {
          name: 'create_project',
          arguments: {
            name: 'Master Key Persistent Project',
            description: 'Persisted to production database',
            category: 'DevOps'
          }
        }
      })
    });

    assert.equal(createRes.status, 200);
    const createBody = await createRes.json();
    assert.ok(!createBody.error);

    // Verify it is actually in persistent prodStore
    const prodProjects = prodStore.listProjects();
    const created = prodProjects.find(p => p.name === 'Master Key Persistent Project');
    assert.ok(created, 'Authorized project must be committed to the persistent production store');
  });

  // 14. Gateway /api/info transparency
  test('14. Gateway /api/info reports judgeDemoMode: true and operational statistics truthfully', async () => {
    const res = await fetch(`http://localhost:${port}/api/info`);
    assert.equal(res.status, 200);

    const info = await res.json();
    assert.equal(info.product, 'ProjectPilot AI');
    assert.equal(info.status, 'operational');
    assert.equal(info.judgeDemoMode, true, '/api/info must report judgeDemoMode: true');
    assert.equal(info.authConfigured, true);
    assert.equal(info.isProduction, true);
    assert.ok(info.dataStats.projects >= 1);
    assert.ok(info.dataStats.tasks >= 1);
  });
});
