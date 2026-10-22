/**
 * ProjectPilot AI - Production Authentication & Authorization Tests (P0 Remediation)
 * Tests:
 * 1. Missing production API key does not allow anonymous writes.
 * 2. Invalid credentials are rejected (timing-safe check).
 * 3. Valid credentials permit authorized operations.
 * 4. Destructive operations are protected.
 * 5. Read-only operations follow the documented access policy.
 * 6. No equivalent write route bypasses authentication.
 * 7. Errors do not expose secrets.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../src/server.js';
import { ProjectStore } from '../src/db/store.js';

describe('Production Authentication & Authorization (P0 Remediation)', () => {
  let tempDir;
  let prodServerNoKey;
  let prodPortNoKey;
  let prodServerWithKey;
  let prodPortWithKey;
  const PROD_API_KEY = 'prod-secret-key-super-secure-token-12345';

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-auth-test-'));

    // 1. Production server WITHOUT API key configured
    prodServerNoKey = await createServer({
      isProduction: true,
      isDurable: true, // Durable storage enabled to isolate auth testing
      apiKey: null,
      store: new ProjectStore(path.join(tempDir, 'store-nokey.json'))
    });
    const addr1 = await prodServerNoKey.start(0);
    prodPortNoKey = addr1.port;

    // 2. Production server WITH API key configured
    prodServerWithKey = await createServer({
      isProduction: true,
      isDurable: true,
      apiKey: PROD_API_KEY,
      store: new ProjectStore(path.join(tempDir, 'store-withkey.json'))
    });
    const addr2 = await prodServerWithKey.start(0);
    prodPortWithKey = addr2.port;
  });

  after(async () => {
    if (prodServerNoKey) await prodServerNoKey.stop();
    if (prodServerWithKey) await prodServerWithKey.stop();
    if (tempDir) {
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // 1. Missing production API key does not allow anonymous writes
  test('1. Missing production API key rejects anonymous write attempts (401)', async () => {
    const res = await fetch(`http://localhost:${prodPortNoKey}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_project',
          arguments: { name: 'Unauthorized Production Project' }
        }
      })
    });

    assert.equal(res.status, 401, 'Anonymous writes must be blocked in production when no API key is configured');
    const body = await res.json();
    assert.equal(body.error?.code, -32000);
    assert.ok(body.error?.message.includes('Authentication required'));
  });

  // 2. Invalid credentials are rejected
  test('2. Invalid credentials are rejected with 401', async () => {
    const res = await fetch(`http://localhost:${prodPortWithKey}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': 'Bearer wrong-attacker-token-xyz',
        'mcp-protocol-version': '2025-11-25'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'create_project',
          arguments: { name: 'Attacker Project' }
        }
      })
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.ok(body.error?.message.includes('Authentication failed'));
  });

  // 3. Valid credentials permit authorized operations
  test('3. Valid credentials permit authorized operations', async () => {
    // A. Handshake
    const initRes = await fetch(`http://localhost:${prodPortWithKey}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${PROD_API_KEY}`,
        'mcp-protocol-version': '2025-11-25'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'TestClient', version: '1.0' }
        }
      })
    });

    assert.equal(initRes.status, 200);
    const sessionId = initRes.headers.get('mcp-session-id');

    // B. Authorized Write Tool Call
    const writeRes = await fetch(`http://localhost:${prodPortWithKey}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${PROD_API_KEY}`,
        'mcp-session-id': sessionId,
        'mcp-protocol-version': '2025-11-25'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'create_project',
          arguments: { name: 'Authorized Production Project' }
        }
      })
    });

    assert.equal(writeRes.status, 200);
    const writeBody = await writeRes.json();
    assert.ok(!writeBody.error);
    assert.ok(writeBody.result?.content?.[0]?.text?.includes('Authorized Production Project'));
  });

  // 4. Destructive operations are protected
  test('4. Destructive operations require valid authentication in production', async () => {
    // Attempt anonymous delete_project on server with no key configured
    const delResNoKey = await fetch(`http://localhost:${prodPortNoKey}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'delete_project',
          arguments: { projectId: 'proj-1', confirmDelete: true }
        }
      })
    });

    assert.equal(delResNoKey.status, 401, 'Destructive operation delete_project must be blocked anonymously in production');

    // Attempt delete_task anonymously
    const delTaskNoKey = await fetch(`http://localhost:${prodPortNoKey}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'delete_task',
          arguments: { taskId: 'task-1', confirmDelete: true }
        }
      })
    });

    assert.equal(delTaskNoKey.status, 401, 'Destructive operation delete_task must be blocked anonymously in production');
  });

  // 5. Read-only operations follow the documented access policy
  test('5. Read-only operations follow the documented access policy in production when key is not configured', async () => {
    // Safe read: /api/info
    const infoRes = await fetch(`http://localhost:${prodPortNoKey}/api/info`);
    assert.equal(infoRes.status, 200);
    const infoBody = await infoRes.json();
    assert.equal(infoBody.status, 'operational');
    assert.equal(infoBody.authConfigured, false);

    // Safe read: tools/list over /mcp
    const listRes = await fetch(`http://localhost:${prodPortNoKey}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'ReadOnlyClient', version: '1.0' }
        }
      })
    });

    assert.equal(listRes.status, 200, 'Read-only initialize handshake should be permitted for inspection under read policy');
  });

  // 6. No equivalent write route bypasses authentication
  test('6. No other mutating tool (update_project, update_task_status, reopen_task, manage_blocker) bypasses auth', async () => {
    const mutatingTools = [
      { name: 'update_project', arguments: { projectId: 'p1', name: 'New' } },
      { name: 'create_task', arguments: { projectId: 'p1', title: 'New' } },
      { name: 'update_task_status', arguments: { taskId: 't1', status: 'done' } },
      { name: 'reopen_task', arguments: { taskId: 't1' } },
      { name: 'manage_blocker', arguments: { taskId: 't1', action: 'block', blockerReason: 'Blocked' } }
    ];

    for (const tool of mutatingTools) {
      const res = await fetch(`http://localhost:${prodPortNoKey}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 8,
          method: 'tools/call',
          params: tool
        })
      });

      assert.equal(res.status, 401, `Tool '${tool.name}' must not bypass authentication`);
      const body = await res.json();
      assert.ok(body.error?.message.includes(tool.name));
    }
  });

  // 7. Errors do not expose secrets
  test('7. Error responses do not leak expected API keys or credentials', async () => {
    const res = await fetch(`http://localhost:${prodPortWithKey}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': 'Bearer incorrect-key',
        'mcp-protocol-version': '2025-11-25'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/list',
        params: {}
      })
    });

    const bodyText = await res.text();
    assert.ok(!bodyText.includes(PROD_API_KEY), 'Error response must never disclose the expected secret API key');
    assert.ok(!res.headers.get('www-authenticate')?.includes(PROD_API_KEY));
  });
});
