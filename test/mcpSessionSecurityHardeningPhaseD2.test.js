/**
 * ProjectPilot AI - Phase D.2 MCP Session Security Hardening & Regression Suite
 *
 * Verifies all 12 required Phase D.2 security scenarios:
 * 1. Production startup fails closed without MCP_SESSION_SECRET
 * 2. Rejection of predictable secret fallbacks (commit SHA, static salt not used in production)
 * 3. Cross-instance token verification with a shared configured secret
 * 4. Rejection of tokens signed with a different secret
 * 5. Deterministic rejection of invalid, expired, and future-dated timestamps
 * 6. Clock-skew boundary behavior (boundary accepted, beyond rejected)
 * 7. Cross-instance revocation propagation when durable storage is present
 * 8. Non-durable fallback behavior (process-local revocation, conservative 1h TTL)
 * 9. Durable revocation-write failure fails closed (503 response, no false-positive 200)
 * 10. Durable revocation-lookup failure fails closed (503 response)
 * 11. Authentication enforcement after session reconstruction (401 on missing/invalid API key)
 * 12. Defensive SDK compatibility guards (controlled 500 without disclosing internals)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto, { randomUUID } from 'node:crypto';
import {
  createServer,
  reconstructMcpTransport
} from '../src/server.js';
import {
  SessionManager,
  createSignedSessionId,
  verifySignedSessionId,
  DEFAULT_SESSION_TTL_MS,
  DEFAULT_NON_DURABLE_SESSION_TTL_MS,
  DEFAULT_CLOCK_SKEW_TOLERANCE_MS
} from '../src/security/sessionManager.js';

describe('Phase D.2: MCP Session Security Hardening & Regression', () => {
  const validSecret32 = '0123456789abcdef0123456789abcdef';
  const alternativeSecret32 = 'fedcba9876543210fedcba9876543210';
  let tempDir;
  let defaultStorePath;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-phase-d2-'));
    defaultStorePath = path.join(tempDir, 'phase-d2-store.json');
  });

  after(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // Helper for mock durable store
  function createMockDurableStore(options = {}) {
    const table = new Map();
    return {
      isDurable: true,
      listProjects: () => [],
      listTasks: () => [],
      listBlockers: () => [],
      async _command(args) {
        if (options.failOnSet && args[0] === 'SET') {
          const err = new Error('Upstash Redis connection timeout on SET');
          err.name = 'StorageError';
          throw err;
        }
        if (options.failOnGet && args[0] === 'GET') {
          const err = new Error('Upstash Redis network unreachable on GET');
          err.name = 'StorageError';
          throw err;
        }
        if (args[0] === 'SET') {
          table.set(args[1], args[2]);
          return 'OK';
        }
        if (args[0] === 'GET') {
          return table.get(args[1]) || null;
        }
        return null;
      }
    };
  }

  // --------------------------------------------------------------------------
  // Scenario 1: Production startup fails closed without MCP_SESSION_SECRET
  // --------------------------------------------------------------------------
  describe('Scenario 1: Production startup fails closed without MCP_SESSION_SECRET', () => {
    test('refuses to start when isProduction is true and requireSessionSecret is true without secret', async () => {
      const origEnvSecret = process.env.MCP_SESSION_SECRET;
      delete process.env.MCP_SESSION_SECRET;
      try {
        await assert.rejects(
          async () => {
            await createServer({
              storePath: defaultStorePath,
              isProduction: true,
              requireSessionSecret: true
            });
          },
          /Configuration error: Dedicated MCP_SESSION_SECRET of at least 32 characters is required in production/
        );
      } finally {
        if (origEnvSecret) process.env.MCP_SESSION_SECRET = origEnvSecret;
      }
    });

    test('refuses to start when MCP_SESSION_SECRET is shorter than 32 characters in production', async () => {
      await assert.rejects(
        async () => {
          await createServer({
            storePath: defaultStorePath,
            isProduction: true,
            requireSessionSecret: true,
            sessionSecret: 'too-short-secret-16'
          });
        },
        /Configuration error: Dedicated MCP_SESSION_SECRET of at least 32 characters is required in production/
      );
    });

    test('successfully initializes in production when valid 32+ character secret is provided', async () => {
      const server = await createServer({
        storePath: defaultStorePath,
        isProduction: true,
        requireSessionSecret: true,
        sessionSecret: validSecret32
      });
      assert.ok(server);
      assert.equal(typeof server.start, 'function');
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Rejection of predictable secret fallbacks
  // --------------------------------------------------------------------------
  describe('Scenario 2: Rejection of predictable secret fallbacks', () => {
    test('does NOT fall back to VERCEL_GIT_COMMIT_SHA or VERCEL_DEPLOYMENT_ID in production', async () => {
      const origCommit = process.env.VERCEL_GIT_COMMIT_SHA;
      const origDeploy = process.env.VERCEL_DEPLOYMENT_ID;
      const origSecret = process.env.MCP_SESSION_SECRET;
      try {
        process.env.VERCEL_GIT_COMMIT_SHA = '4059a9ea7a2915d0deab89163fec87af87ecb05f';
        process.env.VERCEL_DEPLOYMENT_ID = 'dpl_test1234567890abcdef1234567890';
        delete process.env.MCP_SESSION_SECRET;

        await assert.rejects(
          async () => {
            await createServer({
              storePath: defaultStorePath,
              isProduction: true,
              requireSessionSecret: true
            });
          },
          /Configuration error: Dedicated MCP_SESSION_SECRET/
        );
      } finally {
        if (origCommit) process.env.VERCEL_GIT_COMMIT_SHA = origCommit; else delete process.env.VERCEL_GIT_COMMIT_SHA;
        if (origDeploy) process.env.VERCEL_DEPLOYMENT_ID = origDeploy; else delete process.env.VERCEL_DEPLOYMENT_ID;
        if (origSecret) process.env.MCP_SESSION_SECRET = origSecret; else delete process.env.MCP_SESSION_SECRET;
      }
    });

    test('tokens signed with legacy commit SHA or static salt are rejected by properly configured servers', () => {
      const legacySecret = '4059a9ea7a2915d0deab89163fec87af87ecb05f';
      const token = createSignedSessionId(legacySecret);
      // Validated against a production server using dedicated secret
      const result = verifySignedSessionId(token, validSecret32);
      assert.equal(result, null, 'Tokens created with commit SHA must be rejected by production servers');
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Cross-instance token verification with a shared configured secret
  // --------------------------------------------------------------------------
  describe('Scenario 3: Cross-instance token verification with shared secret', () => {
    test('token generated on Instance A verifies on Instance B with identical secret', () => {
      const managerA = new SessionManager({ secret: validSecret32 });
      const managerB = new SessionManager({ secret: validSecret32 });

      const tokenFromA = managerA.generateSessionId();
      const verifiedOnB = managerB.verifySessionId(tokenFromA);

      assert.ok(verifiedOnB, 'Instance B must successfully verify token generated by Instance A');
      assert.ok(verifiedOnB.id);
      assert.ok(typeof verifiedOnB.createdAt === 'number');
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Rejection of tokens signed with a different secret
  // --------------------------------------------------------------------------
  describe('Scenario 4: Rejection of tokens signed with different secret', () => {
    test('token signed with Secret A is rejected by instance using Secret B', () => {
      const tokenA = createSignedSessionId(validSecret32);
      const resultB = verifySignedSessionId(tokenA, alternativeSecret32);
      assert.equal(resultB, null, 'Instance with Secret B must reject token signed with Secret A');
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Deterministic rejection of invalid, expired, and future-dated timestamps
  // --------------------------------------------------------------------------
  describe('Scenario 5: Rejection of invalid, expired, and future-dated timestamps', () => {
    const fixedNow = 1700000000000;
    const ttlMs = 3600000; // 1 hour
    const clockSkewMs = 60000; // 60 seconds

    test('accepts valid timestamp within TTL and clock-skew', () => {
      const id = randomUUID();
      const token = createSignedSessionId(validSecret32, { id, now: fixedNow - 10000 });
      const verified = verifySignedSessionId(token, validSecret32, {
        now: fixedNow,
        maxAgeMs: ttlMs,
        clockSkewToleranceMs: clockSkewMs
      });
      assert.ok(verified);
      assert.equal(verified.id, id);
      assert.equal(verified.createdAt, fixedNow - 10000);
    });

    test('rejects expired timestamp (created earlier than now - maxAgeMs)', () => {
      const id = randomUUID();
      const token = createSignedSessionId(validSecret32, { id, now: fixedNow - ttlMs - 1000 });
      const verified = verifySignedSessionId(token, validSecret32, {
        now: fixedNow,
        maxAgeMs: ttlMs,
        clockSkewToleranceMs: clockSkewMs
      });
      assert.equal(verified, null, 'Expired tokens must be rejected');
    });

    test('rejects future timestamp exceeding clock-skew tolerance', () => {
      const id = randomUUID();
      // Future timestamp 120 seconds ahead, when tolerance is only 60 seconds
      const token = createSignedSessionId(validSecret32, { id, now: fixedNow + 120000 });
      const verified = verifySignedSessionId(token, validSecret32, {
        now: fixedNow,
        maxAgeMs: ttlMs,
        clockSkewToleranceMs: clockSkewMs
      });
      assert.equal(verified, null, 'Tokens from the distant future must be rejected');
    });

    test('rejects malformed UUID structures in token', () => {
      const badId = 'not-a-valid-uuid-format';
      const token = createSignedSessionId(validSecret32, { id: badId, now: fixedNow });
      const verified = verifySignedSessionId(token, validSecret32, { now: fixedNow });
      assert.equal(verified, null, 'Non-UUID ID formats must be rejected');
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 6: Clock-skew boundary behavior
  // --------------------------------------------------------------------------
  describe('Scenario 6: Clock-skew boundary behavior', () => {
    const fixedNow = 1700000000000;
    const ttlMs = 3600000;
    const clockSkewMs = 60000;

    test('accepts timestamp exactly at upper clock skew boundary (now + clockSkewMs)', () => {
      const id = randomUUID();
      const token = createSignedSessionId(validSecret32, { id, now: fixedNow + clockSkewMs });
      const verified = verifySignedSessionId(token, validSecret32, {
        now: fixedNow,
        maxAgeMs: ttlMs,
        clockSkewToleranceMs: clockSkewMs
      });
      assert.ok(verified, 'Boundary timestamp (now + clockSkewMs) must be accepted');
      assert.equal(verified.id, id);
    });

    test('rejects timestamp 1ms beyond upper clock skew boundary (now + clockSkewMs + 1)', () => {
      const id = randomUUID();
      const token = createSignedSessionId(validSecret32, { id, now: fixedNow + clockSkewMs + 1 });
      const verified = verifySignedSessionId(token, validSecret32, {
        now: fixedNow,
        maxAgeMs: ttlMs,
        clockSkewToleranceMs: clockSkewMs
      });
      assert.equal(verified, null, 'Timestamp at now + clockSkewMs + 1 must be rejected');
    });

    test('rejects timestamp 1ms beyond expiration boundary (now - maxAgeMs - 1)', () => {
      const id = randomUUID();
      const token = createSignedSessionId(validSecret32, { id, now: fixedNow - ttlMs - 1 });
      const verified = verifySignedSessionId(token, validSecret32, {
        now: fixedNow,
        maxAgeMs: ttlMs,
        clockSkewToleranceMs: clockSkewMs
      });
      assert.equal(verified, null, 'Timestamp at now - maxAgeMs - 1 must be rejected');
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 7: Revocation across separate session-manager instances when durable storage is present
  // --------------------------------------------------------------------------
  describe('Scenario 7: Durable cross-instance revocation propagation', () => {
    test('revocation on Instance A immediately invalidates session on Instance B via shared durable store', async () => {
      const sharedStore = createMockDurableStore();
      const managerA = new SessionManager({ secret: validSecret32, isDurable: true, store: sharedStore });
      const managerB = new SessionManager({ secret: validSecret32, isDurable: true, store: sharedStore });

      const sessionId = managerA.generateSessionId();

      // Instance B initially verifies this session
      assert.equal(await managerB.isRevoked(sessionId), false);
      const transportB1 = await managerB.resolveTransport(sessionId, async (sid) => ({ sid }));
      assert.ok(transportB1, 'Session should be resolvable on Instance B prior to revocation');

      // Instance A revokes the session
      await managerA.revoke(sessionId);

      // Instance B now sees the session as revoked
      assert.equal(await managerB.isRevoked(sessionId), true);
      const transportB2 = await managerB.resolveTransport(sessionId, async (sid) => ({ sid }));
      assert.equal(transportB2, null, 'Revoked session must not be resolvable on Instance B');
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 8: Missing durable storage behavior
  // --------------------------------------------------------------------------
  describe('Scenario 8: Non-durable fallback behavior', () => {
    test('non-durable session manager defaults to 1-hour TTL and process-local revocation', async () => {
      const manager = new SessionManager({ secret: validSecret32, isDurable: false });

      // Verifies conservative 1-hour TTL
      assert.equal(manager.ttlMs, DEFAULT_NON_DURABLE_SESSION_TTL_MS);
      assert.equal(manager.ttlMs, 60 * 60 * 1000);

      // Local revocation
      const sid = manager.generateSessionId();
      manager.setLocal(sid, { dummy: true });
      assert.equal(manager.hasLocal(sid), true);

      await manager.revoke(sid);
      assert.equal(manager.hasLocal(sid), false);
      assert.equal(await manager.isRevoked(sid), true, 'Locally revoked session is known to this manager');

      // Separate non-durable instance has no shared storage
      const separateManager = new SessionManager({ secret: validSecret32, isDurable: false });
      assert.equal(await separateManager.isRevoked(sid), false, 'Separate non-durable instance does not have shared revocation');
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 9: Durable revocation-write failure (fails closed, responds with 503)
  // --------------------------------------------------------------------------
  describe('Scenario 9: Durable revocation-write failure fails closed', () => {
    let server;
    let port;
    const failingStore = createMockDurableStore({ failOnSet: true });

    before(async () => {
      server = await createServer({
        store: failingStore,
        isDurable: true,
        sessionSecret: validSecret32
      });
      const addr = await server.start(0);
      port = addr.port;
    });

    after(async () => {
      if (server) await server.stop();
    });

    test('DELETE /mcp returns 503 when durable revocation write fails (no false-positive 200)', async () => {
      const token = createSignedSessionId(validSecret32);

      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'DELETE',
        headers: {
          'mcp-session-id': token
        }
      });

      assert.equal(res.status, 503, 'Must return HTTP 503 when durable revocation fails');
      const body = await res.json();
      assert.match(body.error, /Failed to record session termination in durable storage/);
      assert.equal(body.status, undefined, 'Must not claim session was terminated');
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 10: Durable revocation-lookup failure (fails closed when durable storage errors out)
  // --------------------------------------------------------------------------
  describe('Scenario 10: Durable revocation-lookup failure fails closed', () => {
    let server;
    let port;
    const failingStore = createMockDurableStore({ failOnGet: true });

    before(async () => {
      server = await createServer({
        store: failingStore,
        isDurable: true,
        sessionSecret: validSecret32
      });
      const addr = await server.start(0);
      port = addr.port;
    });

    after(async () => {
      if (server) await server.stop();
    });

    test('POST /mcp returns 503 when durable lookup fails during transport resolution', async () => {
      const token = createSignedSessionId(validSecret32);

      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-session-id': token,
          'mcp-protocol-version': '2025-11-25'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 101,
          method: 'tools/list',
          params: {}
        })
      });

      assert.equal(res.status, 503, 'Must return HTTP 503 when durable lookup throws');
      const body = await res.json();
      assert.equal(body.error?.code, -32603);
      assert.match(body.error?.message, /Durable session lookup temporarily unavailable/);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 11: Authentication enforcement after session reconstruction
  // --------------------------------------------------------------------------
  describe('Scenario 11: Authentication enforcement on reconstructed sessions', () => {
    let server;
    let port;
    const expectedApiKey = 'test-phase-d2-configured-key-98765';

    before(async () => {
      server = await createServer({
        storePath: defaultStorePath,
        apiKey: expectedApiKey,
        sessionSecret: validSecret32
      });
      const addr = await server.start(0);
      port = addr.port;
    });

    after(async () => {
      if (server) await server.stop();
    });

    test('unauthenticated request using valid signed token returns 401 Unauthorized', async () => {
      const validToken = createSignedSessionId(validSecret32);

      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-session-id': validToken,
          'mcp-protocol-version': '2025-11-25'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 201,
          method: 'tools/list',
          params: {}
        })
      });

      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error?.code, -32000);
      assert.match(body.error?.message, /Authentication required/);
    });

    test('authenticated request using valid signed token and correct API key succeeds', async () => {
      const validToken = createSignedSessionId(validSecret32);

      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': `Bearer ${expectedApiKey}`,
          'mcp-session-id': validToken,
          'mcp-protocol-version': '2025-11-25'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 202,
          method: 'tools/list',
          params: {}
        })
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.result?.tools?.length >= 11);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 12: Controlled failure when expected SDK transport internals are unavailable
  // --------------------------------------------------------------------------
  describe('Scenario 12: Defensive SDK compatibility guards', () => {
    test('reconstructMcpTransport verifies _webStandardTransport internal before use', async () => {
      const sid = randomUUID();
      const mockStore = { listProjects: () => [], listTasks: () => [], listBlockers: () => [] };

      // Normal call succeeds with current SDK version
      const normalTransport = await reconstructMcpTransport(sid, mockStore, {}, { authenticated: true });
      assert.ok(normalTransport);
      assert.ok(normalTransport._webStandardTransport);
      assert.equal(normalTransport._webStandardTransport.sessionId, sid);
      assert.equal(normalTransport._webStandardTransport._initialized, true);
    });

    test('server returns clean 500 when transport reconstruction throws an unexpected internal error', async () => {
      // Create session manager where resolveTransport throws an SDK compatibility error
      const sessionManager = new SessionManager({ secret: validSecret32 });
      const badSessionId = sessionManager.generateSessionId();

      sessionManager.resolveTransport = async () => {
        throw new Error('SDK compatibility failure: Expected _webStandardTransport internal is missing or incompatible');
      };

      const server = await createServer({
        storePath: defaultStorePath,
        sessionSecret: validSecret32,
        sessionManager
      });
      const addr = await server.start(0);
      const port = addr.port;

      try {
        const res = await fetch(`http://localhost:${port}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            'mcp-session-id': badSessionId,
            'mcp-protocol-version': '2025-11-25'
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 301,
            method: 'tools/list',
            params: {}
          })
        });

        assert.equal(res.status, 500);
        const body = await res.json();
        assert.equal(body.error?.code, -32603);
        assert.equal(body.error?.message, 'Internal MCP transport reconstruction error');
        // Verify stack trace or internal names are NOT leaked
        assert.equal(JSON.stringify(body).includes('_webStandardTransport'), false);
        assert.equal(JSON.stringify(body).includes('stack'), false);
      } finally {
        await server.stop();
      }
    });
  });
});
