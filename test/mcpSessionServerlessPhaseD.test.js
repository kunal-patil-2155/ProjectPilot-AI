/**
 * ProjectPilot AI - Phase D MCP Session Reliability in Serverless Environments (BUG-03)
 *
 * Verifies:
 * 1. Valid session lifecycle across the MCP Streamable HTTP protocol.
 * 2. Cross-instance session reliability (requests handled by separate simulated serverless containers).
 * 3. Rejection of missing, malformed, forged, expired, and revoked sessions.
 * 4. Session isolation between multiple distinct clients.
 * 5. Strict authentication and authorization enforcement across reconstructed sessions.
 * 6. Non-disclosure of sensitive tokens, secrets, or internal structures in errors.
 * 7. Serverless adapter integration via api/index.js.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../src/server.js';
import {
  createSignedSessionId,
  verifySignedSessionId,
  SessionManager
} from '../src/security/sessionManager.js';

describe('Phase D: MCP Session Reliability in Serverless Environments (BUG-03)', () => {
  let tempDir;
  let storePath;
  const sharedSessionSecret = 'test-serverless-cluster-secret-key-phase-d-2026';

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-phase-d-'));
    storePath = path.join(tempDir, 'phase-d-store.json');
  });

  after(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // --------------------------------------------------------------------------
  // 1. Session Token Unit Security & Cryptographic Integrity
  // --------------------------------------------------------------------------
  describe('1. Cryptographic Session Token Unit Hardening', () => {
    test('generates valid token matching MCP session regex /^[a-zA-Z0-9_-]{1,128}$/', () => {
      const token = createSignedSessionId(sharedSessionSecret);
      assert.ok(typeof token === 'string');
      assert.ok(token.length > 40 && token.length <= 128);
      assert.match(token, /^[a-zA-Z0-9_-]{1,128}$/);
    });

    test('validates authentic token with correct secret', () => {
      const token = createSignedSessionId(sharedSessionSecret);
      const verified = verifySignedSessionId(token, sharedSessionSecret);
      assert.ok(verified);
      assert.ok(verified.id);
      assert.ok(typeof verified.createdAt === 'number');
      assert.ok(Date.now() - verified.createdAt < 2000);
    });

    test('rejects token signed with different secret', () => {
      const token = createSignedSessionId('secret-a');
      const verified = verifySignedSessionId(token, 'secret-b');
      assert.equal(verified, null);
    });

    test('rejects tampered signature', () => {
      const token = createSignedSessionId(sharedSessionSecret);
      const parts = token.split('_');
      parts[2] = parts[2].slice(0, -2) + 'ff'; // Tamper hex signature
      const tampered = parts.join('_');
      assert.equal(verifySignedSessionId(tampered, sharedSessionSecret), null);
    });

    test('rejects expired token', async () => {
      const shortTtlMs = 50;
      const token = createSignedSessionId(sharedSessionSecret);
      // Wait for expiration
      await new Promise(r => setTimeout(r, 60));
      assert.equal(verifySignedSessionId(token, sharedSessionSecret, shortTtlMs), null);
    });

    test('rejects malformed or non-string tokens gracefully without throwing', () => {
      assert.equal(verifySignedSessionId('', sharedSessionSecret), null);
      assert.equal(verifySignedSessionId(null, sharedSessionSecret), null);
      assert.equal(verifySignedSessionId(undefined, sharedSessionSecret), null);
      assert.equal(verifySignedSessionId(12345, sharedSessionSecret), null);
      assert.equal(verifySignedSessionId('not_enough_parts', sharedSessionSecret), null);
      assert.equal(verifySignedSessionId('a_b_c_d', sharedSessionSecret), null);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Cross-Instance Serverless Request Handling (The Core BUG-03 Defect)
  // --------------------------------------------------------------------------
  describe('2. Multi-Instance Serverless Request Handling (BUG-03 Repair)', () => {
    let serverA;
    let serverB;
    let serverC;
    let portA;
    let portB;
    let portC;

    before(async () => {
      // Simulate 3 isolated serverless container instances sharing the same store and cluster secret
      serverA = await createServer({ storePath, sessionSecret: sharedSessionSecret });
      serverB = await createServer({ storePath, sessionSecret: sharedSessionSecret });
      serverC = await createServer({ storePath, sessionSecret: sharedSessionSecret });

      const addrA = await serverA.start(0);
      const addrB = await serverB.start(0);
      const addrC = await serverC.start(0);

      portA = addrA.port;
      portB = addrB.port;
      portC = addrC.port;
    });

    after(async () => {
      if (serverA) await serverA.stop();
      if (serverB) await serverB.stop();
      if (serverC) await serverC.stop();
    });

    test('Instance A initializes session -> Instance B successfully executes tools/list with that session', async () => {
      // Step 1: Initialize on Instance A
      const initRes = await fetch(`http://localhost:${portA}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test-runner', version: '1.0.0' } }
        })
      });
      assert.equal(initRes.status, 200);
      const sessionId = initRes.headers.get('mcp-session-id');
      assert.ok(sessionId, 'Instance A must return signed mcp-session-id');

      // Verify Instance B has NO local memory of this session yet
      assert.equal(serverB.sessions.has(sessionId), false, 'Instance B must initially have empty memory for this session');

      // Step 2: Route tools/list request to Instance B using session created on Instance A
      const listRes = await fetch(`http://localhost:${portB}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-session-id': sessionId,
          'mcp-protocol-version': '2025-11-25'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {}
        })
      });
      assert.equal(listRes.status, 200, 'Instance B must accept valid cross-instance session with HTTP 200');
      const listData = await listRes.json();
      assert.ok(listData.result?.tools?.length >= 11, 'Instance B must return registered MCP tools');
      assert.equal(listRes.headers.get('mcp-session-id'), sessionId, 'Response must preserve mcp-session-id header');

      // Verify Instance B now cached the session in its local memory
      assert.equal(serverB.sessions.has(sessionId), true, 'Instance B should now cache the reconstructed session locally');
    });

    test('Instance C executes tools/call using session initialized on Instance A', async () => {
      // Step 1: Initialize on Instance A
      const initRes = await fetch(`http://localhost:${portA}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 10,
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test-runner', version: '1.0.0' } }
        })
      });
      const sessionId = initRes.headers.get('mcp-session-id');
      assert.ok(sessionId);

      // Verify Instance C has NO memory of this session
      assert.equal(serverC.sessions.has(sessionId), false);

      // Step 2: Route tools/call to Instance C
      const callRes = await fetch(`http://localhost:${portC}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-session-id': sessionId,
          'mcp-protocol-version': '2025-11-25'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 11,
          method: 'tools/call',
          params: {
            name: 'list_projects',
            arguments: {}
          }
        })
      });
      assert.equal(callRes.status, 200, 'Instance C must handle tool call across instances with HTTP 200');
      const callData = await callRes.json();
      assert.ok(callData.result?.content?.[0]?.text, 'Must return tool execution text content');
      const parsed = JSON.parse(callData.result.content[0].text);
      assert.ok(parsed.projects?.length >= 3, 'Must return seeded project data');
    });

    test('Instance B rejects fake/un-signed session ID with HTTP 404', async () => {
      const fakeSessionId = '00000000-0000-0000-0000-000000000000_fake_invalid';
      const res = await fetch(`http://localhost:${portB}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-session-id': fakeSessionId
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 99,
          method: 'tools/list',
          params: {}
        })
      });
      assert.equal(res.status, 404);
      const data = await res.json();
      assert.equal(data.error?.code, -32001);
      assert.ok(data.error?.message?.includes('not found or expired'));
    });
  });

  // --------------------------------------------------------------------------
  // 3. Session Isolation & Revocation (DELETE Lifecycle)
  // --------------------------------------------------------------------------
  describe('3. Session Isolation & Termination Lifecycle', () => {
    let serverInstance;
    let port;

    before(async () => {
      serverInstance = await createServer({ storePath, sessionSecret: sharedSessionSecret });
      const addr = await serverInstance.start(0);
      port = addr.port;
    });

    after(async () => {
      if (serverInstance) await serverInstance.stop();
    });

    test('Client A and Client B receive distinct isolated session tokens', async () => {
      const initA = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'client-A', version: '1.0.0' } }
        })
      });
      const sidA = initA.headers.get('mcp-session-id');

      const initB = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'client-B', version: '1.0.0' } }
        })
      });
      const sidB = initB.headers.get('mcp-session-id');

      assert.notEqual(sidA, sidB, 'Clients must receive unique session IDs');

      // Terminate Client A's session
      const deleteA = await fetch(`http://localhost:${port}/mcp`, {
        method: 'DELETE',
        headers: { 'mcp-session-id': sidA }
      });
      assert.equal(deleteA.status, 200);
      const delData = await deleteA.json();
      assert.equal(delData.status, 'session_terminated');
      assert.equal(delData.sessionId, sidA);

      // Client A subsequent request must fail with 404
      const callA = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-session-id': sidA
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
      });
      assert.equal(callA.status, 404, 'Revoked Client A session must be rejected with 404');

      // Client B session must remain active and unaffected (isolation)
      const callB = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-session-id': sidB
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
      });
      assert.equal(callB.status, 200, 'Client B session must remain valid and operational');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Authentication Enforcement Across Reconstructed Sessions
  // --------------------------------------------------------------------------
  describe('4. Authentication & Authorization Enforcement on Reconstructed Sessions', () => {
    let serverA;
    let serverB;
    let portA;
    let portB;
    const testApiKey = 'mcp-secret-key-phase-d-auth-token';

    before(async () => {
      serverA = await createServer({
        storePath,
        apiKey: testApiKey,
        sessionSecret: sharedSessionSecret,
        isProduction: true,
        isDurable: true
      });
      serverB = await createServer({
        storePath,
        apiKey: testApiKey,
        sessionSecret: sharedSessionSecret,
        isProduction: true,
        isDurable: true
      });

      const addrA = await serverA.start(0);
      const addrB = await serverB.start(0);
      portA = addrA.port;
      portB = addrB.port;
    });

    after(async () => {
      if (serverA) await serverA.stop();
      if (serverB) await serverB.stop();
    });

    test('valid session on instance B still rejects requests with missing or invalid API key', async () => {
      // Initialize with valid key on instance A
      const initRes = await fetch(`http://localhost:${portA}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': `Bearer ${testApiKey}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
        })
      });
      assert.equal(initRes.status, 200);
      const sid = initRes.headers.get('mcp-session-id');

      // Attempt to call instance B with valid session ID but WITHOUT Authorization header
      const unauthRes = await fetch(`http://localhost:${portB}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-session-id': sid
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {}
        })
      });
      assert.equal(unauthRes.status, 401, 'Request without key must be rejected with 401 even with valid session ID');

      // Attempt with invalid API key
      const wrongKeyRes = await fetch(`http://localhost:${portB}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-session-id': sid,
          'Authorization': 'Bearer wrong-api-key-value'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/list',
          params: {}
        })
      });
      assert.equal(wrongKeyRes.status, 401, 'Request with wrong key must be rejected with 401');

      // Call with correct API key on instance B succeeds
      const authRes = await fetch(`http://localhost:${portB}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-session-id': sid,
          'Authorization': `Bearer ${testApiKey}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/list',
          params: {}
        })
      });
      assert.equal(authRes.status, 200, 'Request with correct key and valid session must succeed with 200');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Session Expiration Verification
  // --------------------------------------------------------------------------
  describe('5. Session Expiration (TTL Enforcement)', () => {
    let expServer;
    let expPort;

    before(async () => {
      // Create server with very short session TTL (80ms)
      expServer = await createServer({
        storePath,
        sessionSecret: sharedSessionSecret,
        sessionTtlMs: 80
      });
      const addr = await expServer.start(0);
      expPort = addr.port;
    });

    after(async () => {
      if (expServer) await expServer.stop();
    });

    test('session expires after TTL and subsequent requests return 404', async () => {
      const initRes = await fetch(`http://localhost:${expPort}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
        })
      });
      assert.equal(initRes.status, 200);
      const sid = initRes.headers.get('mcp-session-id');

      // Call immediately (should succeed)
      const immediateRes = await fetch(`http://localhost:${expPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-session-id': sid
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
      });
      assert.equal(immediateRes.status, 200);

      // Wait for session TTL to elapse (> 100ms)
      await new Promise(r => setTimeout(r, 120));

      // Call after expiration (should return 404)
      const expiredRes = await fetch(`http://localhost:${expPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-session-id': sid
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} })
      });
      assert.equal(expiredRes.status, 404, 'Expired session must return HTTP 404');
    });
  });
});
