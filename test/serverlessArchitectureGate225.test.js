/**
 * ProjectPilot AI - Vercel Serverless Initialization Architecture Test Suite
 * Gate 2.25 Verification (v2.1.1)
 *
 * Verifies all 10 Phase 4 criteria:
 * 1. Vercel Preview initialization with a valid session secret and Judge Demo Mode.
 * 2. Judge Demo Mode initialization without Upstash credentials.
 * 3. Production initialization without a valid session secret must fail closed.
 * 4. Production durable-storage requirements must remain strictly enforced.
 * 5. Demo mutations cannot modify persistent storage.
 * 6. Anonymous users cannot perform administrative/destructive operations.
 * 7. MCP session signing and validation remain functional.
 * 8. Serverless initialization failures are logged without leaking secrets.
 * 9. Concurrent server initialization remains deduplicated.
 * 10. Failed initialization can be retried safely.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import handler from '../api/index.js';
import {
  createServer,
  getOrInitServer,
  _resetServerlessInstanceForTest,
  logSanitizedError,
  sanitizeLogText,
  DemoSandboxStore
} from '../src/server.js';
import { ProjectStore } from '../src/db/store.js';
import { verifySignedSessionId } from '../src/security/sessionManager.js';

function createMockResponse() {
  const res = new EventEmitter();
  res.headers = {};
  res.statusCode = 200;
  res.headersSent = false;
  res.writableEnded = false;
  res.finished = false;
  res.body = '';

  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  res.writeHead = (code, headers = {}) => {
    res.statusCode = code;
    res.headersSent = true;
    for (const [k, v] of Object.entries(headers)) {
      res.headers[k.toLowerCase()] = v;
    }
  };
  res.write = (chunk) => {
    res.body += chunk ? chunk.toString() : '';
  };
  res.end = (chunk) => {
    if (chunk) res.write(chunk);
    res.writableEnded = true;
    res.finished = true;
    res.emit('finish');
  };
  return res;
}

function createMockRequest(url = '/api?route=/api/info', method = 'GET', headers = {}, body = null) {
  const req = new EventEmitter();
  req.url = url;
  req.method = method;
  req.headers = { host: 'localhost', ...headers };
  req[Symbol.asyncIterator] = async function* () {
    if (body) {
      yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    }
  };
  return req;
}

test('Gate 2.25: Vercel Serverless Initialization Architecture Repair (v2.1.1)', async (t) => {
  const VALID_SESSION_SECRET = 'test-secret-min-32-chars-long-gate-225-audit';
  const MASTER_KEY = 'master-admin-key-32-chars-gate-225';

  // 1. Vercel Preview initialization with a valid session secret and Judge Demo Mode
  await t.test('1. Vercel Preview initialization with valid session secret and Judge Demo Mode succeeds', async () => {
    _resetServerlessInstanceForTest();
    const envBackup = { ...process.env };
    try {
      process.env.VERCEL = '1';
      process.env.MCP_SESSION_SECRET = VALID_SESSION_SECRET;
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      delete process.env.REQUIRE_DURABLE_STORAGE;

      const req = createMockRequest('/api?route=/api/info');
      const res = createMockResponse();

      await handler(req, res);

      assert.equal(res.statusCode, 200, 'Preview request must return HTTP 200');
      const data = JSON.parse(res.body);
      assert.equal(data.status, 'operational');
      assert.equal(data.judgeDemoMode, true, 'judgeDemoMode must be enabled in preview');
    } finally {
      process.env = envBackup;
      _resetServerlessInstanceForTest();
    }
  });

  // 2. Judge Demo Mode initialization without Upstash credentials
  await t.test('2. Judge Demo Mode initializes cleanly without requiring Upstash credentials', async () => {
    _resetServerlessInstanceForTest();
    const envBackup = { ...process.env };
    try {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      delete process.env.REQUIRE_DURABLE_STORAGE;

      const instance = await createServer({
        judgeDemoMode: true,
        sessionSecret: VALID_SESSION_SECRET
      });

      assert.ok(instance, 'Server must initialize');
      assert.ok(instance.store instanceof DemoSandboxStore, 'Store must be an in-memory DemoSandboxStore');
      await instance.stop();
    } finally {
      process.env = envBackup;
      _resetServerlessInstanceForTest();
    }
  });

  // 3. Production initialization without a valid session secret must fail
  await t.test('3. Production initialization without a valid session secret fails closed', async () => {
    _resetServerlessInstanceForTest();
    const envBackup = { ...process.env };
    try {
      process.env.VERCEL = '1';
      delete process.env.MCP_SESSION_SECRET;

      await assert.rejects(
        async () => {
          await createServer({
            isProduction: true,
            requireSessionSecret: true
          });
        },
        /Configuration error: Dedicated MCP_SESSION_SECRET of at least 32 characters is required in production/
      );
    } finally {
      process.env = envBackup;
      _resetServerlessInstanceForTest();
    }
  });

  // 4. Production durable-storage requirements must remain enforced
  await t.test('4. Production durable-storage requirements remain strictly enforced', async () => {
    _resetServerlessInstanceForTest();
    const envBackup = { ...process.env };
    try {
      process.env.REQUIRE_DURABLE_STORAGE = 'true';
      delete process.env.UPSTASH_REDIS_REST_URL;

      // In production mode (judgeDemoMode: false), must fail if durable storage is missing
      await assert.rejects(
        async () => {
          await createServer({
            isProduction: true,
            judgeDemoMode: false,
            sessionSecret: VALID_SESSION_SECRET
          });
        },
        /Durable storage is required in production/
      );
    } finally {
      process.env = envBackup;
      _resetServerlessInstanceForTest();
    }
  });

  // 5. Demo mutations cannot modify persistent storage
  await t.test('5. Demo mutations remain isolated and cannot modify persistent storage', async () => {
    _resetServerlessInstanceForTest();
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-gate225-'));
    const prodFile = path.join(tempDir, 'prod-store.json');

    try {
      const prodStore = new ProjectStore(prodFile);
      await prodStore.init();

      // Verify baseline task status
      const initialTask = prodStore.getTask('task-cloudsync-1');
      assert.equal(initialTask.status, 'in_progress');

      const serverInstance = await createServer({
        judgeDemoMode: true,
        sessionSecret: VALID_SESSION_SECRET,
        store: prodStore
      });

      const server = http.createServer((req, res) => {
        serverInstance.server.emit('request', req, res);
      });
      await new Promise(r => server.listen(0, r));
      const port = server.address().port;

      try {
        // Step A: Init anonymous demo session
        const initRes = await fetch(`http://localhost:${port}/mcp`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'accept': 'application/json, text/event-stream'
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'DemoJudge', version: '1.0' } }
          })
        });
        assert.equal(initRes.status, 200);
        const sid = initRes.headers.get('mcp-session-id');

        // Step B: Mutate task status in demo mode
        const mutRes = await fetch(`http://localhost:${port}/mcp`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'accept': 'application/json, text/event-stream',
            'mcp-session-id': sid
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
              name: 'update_task_status',
              arguments: { taskId: 'task-cloudsync-1', status: 'done' }
            }
          })
        });
        assert.equal(mutRes.status, 200);
        const mutData = await mutRes.json();
        assert.ok(!mutData.error);

        // Step C: Verify persistent store was NOT modified
        const freshProdStore = new ProjectStore(prodFile);
        await freshProdStore.init();
        const unmutatedTask = freshProdStore.getTask('task-cloudsync-1');
        assert.equal(unmutatedTask.status, 'in_progress', 'Persistent store must remain completely unmodified');
      } finally {
        await new Promise(r => server.close(r));
        await serverInstance.stop();
      }
    } finally {
      try { await fs.promises.rm(tempDir, { recursive: true, force: true }); } catch {}
      _resetServerlessInstanceForTest();
    }
  });

  // 6. Anonymous users cannot perform administrative/destructive operations
  await t.test('6. Anonymous users in Judge Demo Mode are rejected with HTTP 401 for administrative operations', async () => {
    _resetServerlessInstanceForTest();
    const serverInstance = await createServer({
      judgeDemoMode: true,
      sessionSecret: VALID_SESSION_SECRET,
      apiKey: MASTER_KEY
    });

    const server = http.createServer((req, res) => {
      serverInstance.server.emit('request', req, res);
    });
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    try {
      const initRes = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'DemoJudge', version: '1.0' } }
        })
      });
      const sid = initRes.headers.get('mcp-session-id');

      const adminTools = ['create_project', 'create_task', 'delete_project', 'delete_task', 'reopen_task', 'manage_blocker'];
      for (const tool of adminTools) {
        const res = await fetch(`http://localhost:${port}/mcp`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'accept': 'application/json, text/event-stream',
            'mcp-session-id': sid
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: tool, arguments: { projectId: 'p1', taskId: 't1', confirmDelete: true } }
          })
        });
        assert.equal(res.status, 401, `Tool '${tool}' must require master API key in Judge Demo Mode`);
        const body = await res.json();
        assert.ok(body.error?.message.includes('Master API key required') || body.error?.message.includes('Authentication required'));
      }
    } finally {
      await new Promise(r => server.close(r));
      await serverInstance.stop();
      _resetServerlessInstanceForTest();
    }
  });

  // 7. MCP session signing and validation remain functional
  await t.test('7. MCP session signing and HMAC validation reject tampered session tokens', async () => {
    _resetServerlessInstanceForTest();
    const serverInstance = await createServer({
      judgeDemoMode: true,
      sessionSecret: VALID_SESSION_SECRET
    });

    const server = http.createServer((req, res) => {
      serverInstance.server.emit('request', req, res);
    });
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    try {
      const initRes = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'DemoJudge', version: '1.0' } }
        })
      });
      const sid = initRes.headers.get('mcp-session-id');
      assert.ok(sid);

      // Verify signature validates
      const verified = verifySignedSessionId(sid, VALID_SESSION_SECRET);
      assert.ok(verified && verified.id, 'Session token must validate with correct secret');

      // Tamper with the token
      const tamperedSid = sid.slice(0, -4) + 'zzzz';
      const tamperedRes = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream',
          'mcp-session-id': tamperedSid
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {}
        })
      });
      assert.equal(tamperedRes.status, 404, 'Tampered session ID must be rejected with HTTP 404');
    } finally {
      await new Promise(r => server.close(r));
      await serverInstance.stop();
      _resetServerlessInstanceForTest();
    }
  });

  // 8. Serverless initialization failures are logged without leaking secrets
  await t.test('8. logSanitizedError redacts tokens and passwords while logging stack traces', () => {
    const originalConsoleError = console.error;
    let loggedText = '';
    console.error = (...args) => {
      loggedText += args.join(' ');
    };

    try {
      const fakeError = new Error('Connection failed to https://redis.upstash.com?token=super-secret-token-xyz123 with Bearer my-top-secret-bearer-999');
      fakeError.stack = 'Error at createStore: apiKey: super-secret-api-key\n    at src/server.js:100:15';

      logSanitizedError('Serverless failure:', fakeError);

      assert.ok(loggedText.includes('Serverless failure:'), 'Must log prefix');
      assert.ok(loggedText.includes('[REDACTED]'), 'Must replace secrets with [REDACTED]');
      assert.ok(!loggedText.includes('super-secret-token-xyz123'), 'Must never leak raw token parameter');
      assert.ok(!loggedText.includes('my-top-secret-bearer-999'), 'Must never leak raw bearer token');
      assert.ok(!loggedText.includes('super-secret-api-key'), 'Must never leak raw api key in stack');
    } finally {
      console.error = originalConsoleError;
    }
  });

  // 9. Concurrent server initialization remains deduplicated
  await t.test('9. Concurrent serverless getOrInitServer calls share a single initialization promise', async () => {
    _resetServerlessInstanceForTest();
    const promises = Array.from({ length: 8 }, () => getOrInitServer({ sessionSecret: VALID_SESSION_SECRET }));
    const instances = await Promise.all(promises);

    for (let i = 1; i < instances.length; i++) {
      assert.equal(instances[i], instances[0], 'All concurrent calls must resolve to the identical instance reference');
    }
    _resetServerlessInstanceForTest();
  });

  // 10. Failed initialization can be retried safely
  await t.test('10. Failed serverless initialization can be retried and recovers cleanly', async () => {
    _resetServerlessInstanceForTest();
    const envBackup = { ...process.env };
    try {
      process.env.REQUIRE_DURABLE_STORAGE = 'true';
      process.env.NODE_ENV = 'production';
      process.env.VERCEL = '1';
      delete process.env.UPSTASH_REDIS_REST_URL;

      const req1 = createMockRequest();
      const res1 = createMockResponse();

      await handler(req1, res1);
      assert.equal(res1.statusCode, 500, 'Attempt 1 with bad config must return 500');

      // Clear the forced error
      delete process.env.REQUIRE_DURABLE_STORAGE;
      process.env.NODE_ENV = 'development';
      delete process.env.VERCEL;

      const req2 = createMockRequest();
      const res2 = createMockResponse();

      await handler(req2, res2);
      assert.equal(res2.statusCode, 200, 'Attempt 2 with corrected config must recover and return 200');
    } finally {
      process.env = envBackup;
      _resetServerlessInstanceForTest();
    }
  });
});
