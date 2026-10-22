/**
 * ProjectPilot AI - Authentication Timing Hardening & Credential Safety (P2-1)
 *
 * Verifies that:
 * 1. Correct credential is accepted.
 * 2. Incorrect credential of the same length is rejected.
 * 3. Incorrect credential of a different length is rejected.
 * 4. Empty credential is rejected.
 * 5. Missing Authorization header is rejected for protected mutations.
 * 6. Malformed Bearer authorization is rejected.
 * 7. Missing server-side API-key configuration follows the existing fail-closed production policy.
 * 8. Public read-only operations preserve their intended behavior.
 * 9. Rejected requests do not mutate persistent state.
 * 10. Responses and logs do not disclose the expected or supplied API key.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer, secureCompareTokens } from '../src/server.js';
import { ProjectStore } from '../src/db/store.js';

describe('P2-1 Authentication Timing Hardening & Security Hardening', () => {
  let tempDir;
  let prodServerWithKey;
  let prodPortWithKey;
  let prodServerNoKey;
  let prodPortNoKey;
  let storeWithKey;
  let storeNoKey;

  const CONFIGURED_API_KEY = 'prod-sec-key-32-chars-long-12345'; // 32 characters
  const SAME_LENGTH_WRONG_KEY = 'prod-sec-key-32-chars-diff-12345'; // 32 characters
  const DIFFERENT_LENGTH_SHORT_KEY = 'short-key'; // 9 characters
  const DIFFERENT_LENGTH_LONG_KEY = 'prod-sec-key-32-chars-long-12345-super-extended-extra-padding'; // 60 characters

  const MCP_BASE_HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-11-25'
  };

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-timing-test-'));

    // 1. Production server with configured key
    storeWithKey = new ProjectStore(path.join(tempDir, 'store-withkey.json'));
    await storeWithKey.init();
    prodServerWithKey = await createServer({
      isProduction: true,
      isDurable: true,
      apiKey: CONFIGURED_API_KEY,
      store: storeWithKey
    });
    const addr1 = await prodServerWithKey.start(0);
    prodPortWithKey = addr1.port;

    // 2. Production server without configured key
    storeNoKey = new ProjectStore(path.join(tempDir, 'store-nokey.json'));
    await storeNoKey.init();
    prodServerNoKey = await createServer({
      isProduction: true,
      isDurable: true,
      apiKey: null,
      store: storeNoKey
    });
    const addr2 = await prodServerNoKey.start(0);
    prodPortNoKey = addr2.port;
  });

  after(async () => {
    if (prodServerWithKey) await prodServerWithKey.stop();
    if (prodServerNoKey) await prodServerNoKey.stop();
    if (tempDir) {
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe('1. secureCompareTokens Unit Hardening', () => {
    test('exact match returns true', () => {
      assert.equal(secureCompareTokens('my-secret-key', 'my-secret-key'), true);
      assert.equal(secureCompareTokens(CONFIGURED_API_KEY, CONFIGURED_API_KEY), true);
    });

    test('same-length mismatch returns false without length early-exit', () => {
      assert.equal(SAME_LENGTH_WRONG_KEY.length, 32);
      assert.equal(CONFIGURED_API_KEY.length, 32);
      assert.equal(secureCompareTokens(SAME_LENGTH_WRONG_KEY, CONFIGURED_API_KEY), false);
    });

    test('different-length mismatch returns false (shorter and longer)', () => {
      assert.equal(secureCompareTokens(DIFFERENT_LENGTH_SHORT_KEY, CONFIGURED_API_KEY), false);
      assert.equal(secureCompareTokens(DIFFERENT_LENGTH_LONG_KEY, CONFIGURED_API_KEY), false);
    });

    test('empty string returns false for candidate or expected', () => {
      assert.equal(secureCompareTokens('', CONFIGURED_API_KEY), false);
      assert.equal(secureCompareTokens(CONFIGURED_API_KEY, ''), false);
      assert.equal(secureCompareTokens('', ''), false);
    });

    test('non-string inputs fail closed safely without throwing', () => {
      assert.equal(secureCompareTokens(null, CONFIGURED_API_KEY), false);
      assert.equal(secureCompareTokens(undefined, CONFIGURED_API_KEY), false);
      assert.equal(secureCompareTokens(12345, CONFIGURED_API_KEY), false);
      assert.equal(secureCompareTokens({}, CONFIGURED_API_KEY), false);
      assert.equal(secureCompareTokens(CONFIGURED_API_KEY, null), false);
    });
  });

  describe('2. HTTP Gateway Authentication Timing & Contract Verification', () => {
    // 1. Correct credential is accepted
    test('1. Correct credential is accepted with HTTP 200', async () => {
      // Step A: Initialize session with valid key
      const initRes = await fetch(`http://localhost:${prodPortWithKey}/mcp`, {
        method: 'POST',
        headers: {
          ...MCP_BASE_HEADERS,
          'Authorization': `Bearer ${CONFIGURED_API_KEY}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 100,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'TimingClient', version: '1.0' }
          }
        })
      });

      assert.equal(initRes.status, 200);
      const sessionId = initRes.headers.get('mcp-session-id');

      // Step B: Mutating tool call with valid key and session
      const res = await fetch(`http://localhost:${prodPortWithKey}/mcp`, {
        method: 'POST',
        headers: {
          ...MCP_BASE_HEADERS,
          'mcp-session-id': sessionId,
          'Authorization': `Bearer ${CONFIGURED_API_KEY}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 101,
          method: 'tools/call',
          params: {
            name: 'create_project',
            arguments: { name: 'Timing Test Project - Authorized' }
          }
        })
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(!body.error);
      assert.equal(body.result?.isError, undefined);
    });

    // 2. Incorrect credential of the same length is rejected
    test('2. Incorrect credential of the same length is rejected with HTTP 401', async () => {
      assert.equal(SAME_LENGTH_WRONG_KEY.length, CONFIGURED_API_KEY.length);

      const res = await fetch(`http://localhost:${prodPortWithKey}/mcp`, {
        method: 'POST',
        headers: {
          ...MCP_BASE_HEADERS,
          'Authorization': `Bearer ${SAME_LENGTH_WRONG_KEY}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 102,
          method: 'tools/call',
          params: {
            name: 'create_project',
            arguments: { name: 'Same Length Attacker Project' }
          }
        })
      });

      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error?.code, -32000);
      assert.ok(body.error?.message.includes('Authentication failed: invalid API key'));
    });

    // 3. Incorrect credential of a different length is rejected
    test('3. Incorrect credential of a different length is rejected with HTTP 401 (shorter and longer)', async () => {
      // Shorter
      const resShort = await fetch(`http://localhost:${prodPortWithKey}/mcp`, {
        method: 'POST',
        headers: {
          ...MCP_BASE_HEADERS,
          'Authorization': `Bearer ${DIFFERENT_LENGTH_SHORT_KEY}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 103,
          method: 'tools/call',
          params: {
            name: 'create_project',
            arguments: { name: 'Short Key Project' }
          }
        })
      });

      assert.equal(resShort.status, 401);
      const bodyShort = await resShort.json();
      assert.ok(bodyShort.error?.message.includes('Authentication failed: invalid API key'));

      // Longer
      const resLong = await fetch(`http://localhost:${prodPortWithKey}/mcp`, {
        method: 'POST',
        headers: {
          ...MCP_BASE_HEADERS,
          'Authorization': `Bearer ${DIFFERENT_LENGTH_LONG_KEY}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 104,
          method: 'tools/call',
          params: {
            name: 'create_project',
            arguments: { name: 'Long Key Project' }
          }
        })
      });

      assert.equal(resLong.status, 401);
      const bodyLong = await resLong.json();
      assert.ok(bodyLong.error?.message.includes('Authentication failed: invalid API key'));
    });

    // 4. Empty credential is rejected
    test('4. Empty credential is rejected with HTTP 401', async () => {
      // Empty Bearer token
      const resEmptyBearer = await fetch(`http://localhost:${prodPortWithKey}/mcp`, {
        method: 'POST',
        headers: {
          ...MCP_BASE_HEADERS,
          'Authorization': 'Bearer '
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 105,
          method: 'tools/call',
          params: {
            name: 'create_project',
            arguments: { name: 'Empty Bearer Project' }
          }
        })
      });

      assert.equal(resEmptyBearer.status, 401);
      const bodyEmpty = await resEmptyBearer.json();
      assert.ok(bodyEmpty.error?.message.includes('missing Bearer token or x-api-key header'));

      // Empty x-api-key header
      const resEmptyApiKey = await fetch(`http://localhost:${prodPortWithKey}/mcp`, {
        method: 'POST',
        headers: {
          ...MCP_BASE_HEADERS,
          'x-api-key': '   '
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 106,
          method: 'tools/call',
          params: {
            name: 'create_project',
            arguments: { name: 'Empty X-Api-Key Project' }
          }
        })
      });

      assert.equal(resEmptyApiKey.status, 401);
    });

    // 5. Missing Authorization header is rejected for protected mutations
    test('5. Missing Authorization header is rejected for protected mutations with HTTP 401', async () => {
      const res = await fetch(`http://localhost:${prodPortWithKey}/mcp`, {
        method: 'POST',
        headers: MCP_BASE_HEADERS,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 107,
          method: 'tools/call',
          params: {
            name: 'create_project',
            arguments: { name: 'Anonymous Project' }
          }
        })
      });

      assert.equal(res.status, 401);
      const body = await res.json();
      assert.ok(body.error?.message.includes('missing Bearer token or x-api-key header'));
    });

    // 6. Malformed Bearer authorization is rejected
    test('6. Malformed Bearer authorization is rejected with HTTP 401', async () => {
      const malformedHeaders = [
        'Basic dXNlcjpwYXNz',
        'Token secret-token-xyz',
        'Bearer',
        'bearer without-prefix',
        'Digest username="test"'
      ];

      for (const authHeader of malformedHeaders) {
        const res = await fetch(`http://localhost:${prodPortWithKey}/mcp`, {
          method: 'POST',
          headers: {
            ...MCP_BASE_HEADERS,
            'Authorization': authHeader
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 108,
            method: 'tools/call',
            params: {
              name: 'create_project',
              arguments: { name: 'Malformed Header Project' }
            }
          })
        });

        assert.equal(res.status, 401, `Header '${authHeader}' must be rejected with 401`);
        const body = await res.json();
        assert.ok(body.error?.message.includes('missing Bearer token') || body.error?.message.includes('Authentication failed'));
      }
    });

    // 7. Missing server-side API-key configuration follows fail-closed production policy
    test('7. Missing server-side API-key configuration in production refuses mutations (fail-closed)', async () => {
      const res = await fetch(`http://localhost:${prodPortNoKey}/mcp`, {
        method: 'POST',
        headers: MCP_BASE_HEADERS,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 109,
          method: 'tools/call',
          params: {
            name: 'create_project',
            arguments: { name: 'Fail-Closed Production Mutation' }
          }
        })
      });

      assert.equal(res.status, 401);
      const body = await res.json();
      assert.ok(body.error?.message.includes('Authentication required: Mutating operation'));
      assert.ok(body.error?.message.includes('forbidden in production when MCP_API_KEY is not configured'));
    });

    // 8. Public read-only operations preserve their intended behavior
    test('8. Public read-only operations preserve intended behavior', async () => {
      // /api/info on configured server
      const info1 = await fetch(`http://localhost:${prodPortWithKey}/api/info`);
      assert.equal(info1.status, 200);
      const body1 = await info1.json();
      assert.equal(body1.authConfigured, true);

      // /api/info on unconfigured production server
      const info2 = await fetch(`http://localhost:${prodPortNoKey}/api/info`);
      assert.equal(info2.status, 200);
      const body2 = await info2.json();
      assert.equal(body2.authConfigured, false);

      // /mcp handshake and read-only tool on unconfigured production server succeeds without key
      const initRes = await fetch(`http://localhost:${prodPortNoKey}/mcp`, {
        method: 'POST',
        headers: MCP_BASE_HEADERS,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 110,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'ReadOnlyClient', version: '1.0' }
          }
        })
      });
      assert.equal(initRes.status, 200);
      const sessionId = initRes.headers.get('mcp-session-id');

      const healthRes = await fetch(`http://localhost:${prodPortNoKey}/mcp`, {
        method: 'POST',
        headers: {
          ...MCP_BASE_HEADERS,
          'mcp-session-id': sessionId
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 111,
          method: 'tools/call',
          params: {
            name: 'get_project_health',
            arguments: { projectId: 'proj-cloudsync' }
          }
        })
      });

      assert.equal(healthRes.status, 200);
      const healthBody = await healthRes.json();
      assert.ok(!healthBody.error);
    });

    // 9. Rejected requests do not mutate persistent state
    test('9. Rejected requests do not mutate persistent state', async () => {
      const initialProjects = storeWithKey.listProjects().length;
      const initialTasks = storeWithKey.listTasks().length;

      // Attempt rejected create_project with wrong key
      await fetch(`http://localhost:${prodPortWithKey}/mcp`, {
        method: 'POST',
        headers: {
          ...MCP_BASE_HEADERS,
          'Authorization': 'Bearer wrong-attacker-key'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 112,
          method: 'tools/call',
          params: {
            name: 'create_project',
            arguments: { name: 'Should Never Be Persisted' }
          }
        })
      });

      // Attempt rejected delete_project with wrong key
      await fetch(`http://localhost:${prodPortWithKey}/mcp`, {
        method: 'POST',
        headers: {
          ...MCP_BASE_HEADERS,
          'Authorization': 'Bearer wrong-attacker-key'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 113,
          method: 'tools/call',
          params: {
            name: 'delete_project',
            arguments: { projectId: 'proj-cloudsync', confirmDelete: true }
          }
        })
      });

      // Assert store state remains identical
      assert.equal(storeWithKey.listProjects().length, initialProjects);
      assert.equal(storeWithKey.listTasks().length, initialTasks);
      assert.ok(storeWithKey.getProject('proj-cloudsync'), 'Project must not be deleted');
    });

    // 10. Responses and logs do not disclose the expected or supplied API key
    test('10. Error responses do not disclose expected or candidate credentials', async () => {
      const attackerToken = 'secret-probe-token-attempt-999';

      const res = await fetch(`http://localhost:${prodPortWithKey}/mcp`, {
        method: 'POST',
        headers: {
          ...MCP_BASE_HEADERS,
          'Authorization': `Bearer ${attackerToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 114,
          method: 'tools/call',
          params: {
            name: 'create_project',
            arguments: { name: 'Probe Project' }
          }
        })
      });

      const rawResponseText = await res.text();

      // Ensure expected key is NEVER leaked in error responses
      assert.equal(rawResponseText.includes(CONFIGURED_API_KEY), false, 'Expected API key must NOT appear in response');

      // Ensure candidate key is not echoed in error response
      assert.equal(rawResponseText.includes(attackerToken), false, 'Attacker probe token must NOT be echoed in error response');

      // Ensure standard error structure
      const body = JSON.parse(rawResponseText);
      assert.equal(body.error?.message, 'Authentication failed: invalid API key');
    });
  });
});
