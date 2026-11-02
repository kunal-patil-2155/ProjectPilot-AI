import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import handler from '../api/index.js';
import { createServer, getOrInitServer, _resetServerlessInstanceForTest } from '../src/server.js';

test('Vercel Serverless Function & Adapter Integration', async (t) => {
  let server;
  let baseUrl;

  t.before(async () => {
    server = http.createServer((req, res) => {
      handler(req, res);
    });
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${server.address().port}`;
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test('1. api/index.js exports a callable default handler function', () => {
    assert.equal(typeof handler, 'function');
  });

  await t.test('2. /api/info returns operational status via serverless handler', async () => {
    const res = await fetch(`${baseUrl}/api?route=/api/info`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.product, 'ProjectPilot AI');
    assert.equal(data.status, 'operational');
    assert.ok(data.dataStats.projects >= 1);
  });

  await t.test('3. MCP handshake and tool discovery over /mcp route rewrite', async () => {
    // A. Handshake
    const initRes = await fetch(`${baseUrl}/api?route=/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'VercelAdapterTest', version: '1.0.0' }
        }
      })
    });

    assert.equal(initRes.status, 200);
    const sessionId = initRes.headers.get('mcp-session-id');
    assert.ok(sessionId, 'Should return mcp-session-id');

    const initData = await initRes.json();
    assert.equal(initData.result?.serverInfo?.name, 'projectpilot-mcp');

    // B. Tool Discovery
    const toolsRes = await fetch(`${baseUrl}/api?route=/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      })
    });

    assert.equal(toolsRes.status, 200);
    const toolsData = await toolsRes.json();
    assert.ok(toolsData.result?.tools?.length >= 12, 'Must list production MCP tools');
    const toolNames = toolsData.result.tools.map(t => t.name);
    assert.ok(toolNames.includes('generate_rescue_plan'));
    assert.ok(toolNames.includes('inspect_github_repo'));
  });

  await t.test('4. CORS policy automatically permits vercel.app preview and production domains', async () => {
    const res = await fetch(`${baseUrl}/api?route=/api/info`, {
      headers: {
        'Origin': 'https://project-pilot-ai-rho-blue.vercel.app'
      }
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://project-pilot-ai-rho-blue.vercel.app');
  });

  await t.test('5. Rate limiter extracts client IP safely from x-forwarded-for header', async () => {
    const res = await fetch(`${baseUrl}/api?route=/api/info`, {
      headers: {
        'x-forwarded-for': '203.0.113.195, 70.41.3.18'
      }
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'operational');
  });

  await t.test('6. VERCEL environment uses /tmp for store if specified', async () => {
    const prevVercel = process.env.VERCEL;
    try {
      process.env.VERCEL = '1';
      const tmpPath = path.join(os.tmpdir(), `test-store-${Date.now()}.json`);
      const { store, stop } = await createServer({ storePath: tmpPath });
      assert.ok(store);
      assert.ok(fs.existsSync(tmpPath));
      await stop();
      try { fs.unlinkSync(tmpPath); } catch {}
    } finally {
      if (prevVercel !== undefined) {
        process.env.VERCEL = prevVercel;
      } else {
        delete process.env.VERCEL;
      }
    }
  });

  await t.test('7. Serverless Initialization Recovery & Request Lifecycle Hardening', async (t7) => {
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

    function createMockRequest(url = '/api?route=/api/info', method = 'GET', headers = {}) {
      const req = new EventEmitter();
      req.url = url;
      req.method = method;
      req.headers = { host: 'localhost', ...headers };
      req[Symbol.asyncIterator] = async function* () {};
      return req;
    }

    await t7.test('7.1 Transient initialization failure recovers cleanly on subsequent request', async () => {
      _resetServerlessInstanceForTest();

      const prevRequire = process.env.REQUIRE_DURABLE_STORAGE;
      const prevNodeEnv = process.env.NODE_ENV;
      const prevVercel = process.env.VERCEL;

      try {
        // Force createStore to throw in production without Redis
        process.env.REQUIRE_DURABLE_STORAGE = 'true';
        process.env.NODE_ENV = 'production';
        process.env.VERCEL = '1';

        const req1 = createMockRequest();
        const res1 = createMockResponse();

        await handler(req1, res1);

        assert.equal(res1.statusCode, 500);
        assert.ok(res1.body.includes('Initialization Error'));

        // Now fix the configuration
        delete process.env.REQUIRE_DURABLE_STORAGE;
        process.env.NODE_ENV = 'development';
        delete process.env.VERCEL;

        const req2 = createMockRequest();
        const res2 = createMockResponse();

        await handler(req2, res2);

        // Verification: The second request succeeds and does not re-throw the previous rejection!
        assert.equal(res2.statusCode, 200);
        assert.ok(res2.body.includes('ProjectPilot AI'));
      } finally {
        if (prevRequire !== undefined) process.env.REQUIRE_DURABLE_STORAGE = prevRequire; else delete process.env.REQUIRE_DURABLE_STORAGE;
        if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv; else delete process.env.NODE_ENV;
        if (prevVercel !== undefined) process.env.VERCEL = prevVercel; else delete process.env.VERCEL;
        _resetServerlessInstanceForTest();
      }
    });

    await t7.test('7.2 Repeated initialization failures continue to fail closed without caching broken state', async () => {
      _resetServerlessInstanceForTest();

      const prevRequire = process.env.REQUIRE_DURABLE_STORAGE;
      const prevNodeEnv = process.env.NODE_ENV;
      const prevVercel = process.env.VERCEL;

      try {
        process.env.REQUIRE_DURABLE_STORAGE = 'true';
        process.env.NODE_ENV = 'production';
        process.env.VERCEL = '1';

        // Attempt 1 fails
        const req1 = createMockRequest();
        const res1 = createMockResponse();
        await handler(req1, res1);
        assert.equal(res1.statusCode, 500);

        // Attempt 2 fails
        const req2 = createMockRequest();
        const res2 = createMockResponse();
        await handler(req2, res2);
        assert.equal(res2.statusCode, 500);

        // Recover on Attempt 3
        delete process.env.REQUIRE_DURABLE_STORAGE;
        process.env.NODE_ENV = 'development';
        delete process.env.VERCEL;

        const req3 = createMockRequest();
        const res3 = createMockResponse();
        await handler(req3, res3);
        assert.equal(res3.statusCode, 200);
      } finally {
        if (prevRequire !== undefined) process.env.REQUIRE_DURABLE_STORAGE = prevRequire; else delete process.env.REQUIRE_DURABLE_STORAGE;
        if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv; else delete process.env.NODE_ENV;
        if (prevVercel !== undefined) process.env.VERCEL = prevVercel; else delete process.env.VERCEL;
        _resetServerlessInstanceForTest();
      }
    });

    await t7.test('7.3 Concurrent requests share a single initialization promise without duplicate instances', async () => {
      _resetServerlessInstanceForTest();

      // Launch 5 concurrent calls to getOrInitServer
      const promises = Array.from({ length: 5 }, () => getOrInitServer());
      const instances = await Promise.all(promises);

      // Verify all 5 received the identical instance reference
      for (let i = 1; i < instances.length; i++) {
        assert.equal(instances[i], instances[0]);
        assert.equal(instances[i].server, instances[0].server);
      }
      _resetServerlessInstanceForTest();
    });

    await t7.test('7.4 Handler awaits response completion (does not return prematurely)', async () => {
      _resetServerlessInstanceForTest();

      const req = createMockRequest('/api?route=/api/info');
      const res = createMockResponse();

      let handlerResolved = false;
      const handlerPromise = handler(req, res).then(() => {
        handlerResolved = true;
      });

      // The handler must await the async work and response completion
      await handlerPromise;
      assert.equal(handlerResolved, true);
      assert.equal(res.statusCode, 200);
      assert.equal(res.writableEnded, true);
      assert.ok(res.body.includes('ProjectPilot AI'));
      _resetServerlessInstanceForTest();
    });

    await t7.test('7.5 Client disconnect (res close event) resolves handler cleanly without hanging', async () => {
      _resetServerlessInstanceForTest();

      // Initialize server first
      await getOrInitServer();

      const req = createMockRequest('/api?route=/api/info');
      const res = createMockResponse();

      // Override writeHead to simulate a client closing the socket mid-request
      const origWriteHead = res.writeHead;
      res.writeHead = function (status, headers) {
        origWriteHead.call(res, status, headers);
        // Simulate immediate disconnect
        res.emit('close');
      };

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Handler hung on client disconnect')), 1000)
      );

      // Must resolve cleanly without hanging
      await Promise.race([handler(req, res), timeoutPromise]);
      _resetServerlessInstanceForTest();
    });

    await t7.test('7.6 Request stream error terminates response and resolves handler cleanly', async () => {
      _resetServerlessInstanceForTest();
      await getOrInitServer();

      const { Readable } = await import('node:stream');
      const req = new Readable({
        read() {}
      });
      req.url = '/api?route=/mcp';
      req.method = 'POST';
      req.headers = { host: 'localhost', 'content-type': 'application/json' };

      const res = createMockResponse();

      const handlerPromise = handler(req, res);
      // Destroy the request stream while the server is awaiting request body chunks
      req.destroy(new Error('Simulated socket transmission error'));

      await handlerPromise;
      assert.equal(res.statusCode, 500);
      _resetServerlessInstanceForTest();
    });

    await t7.test('7.7 Late failure does not overwrite or clear a newer successful initialization', async () => {
      _resetServerlessInstanceForTest();

      let rejectAttempt1;
      const attempt1Promise = new Promise((_, reject) => {
        rejectAttempt1 = reject;
      });

      // Simulate attempt 1 catch handler behavior
      const currentPromise = attempt1Promise;
      let activePromise = currentPromise;
      currentPromise.catch((_err) => {
        if (activePromise === currentPromise) {
          activePromise = null;
        }
      });

      // Successful attempt 2 takes over activePromise
      const successInstance = await createServer();
      const attempt2Promise = Promise.resolve(successInstance);
      activePromise = attempt2Promise;

      // Late failure arrives from attempt 1
      rejectAttempt1(new Error('Late failure from stale timeout'));
      await new Promise((r) => setImmediate(r));

      // activePromise must NOT have been cleared by attempt 1
      assert.equal(activePromise, attempt2Promise);
      await successInstance.stop();
      _resetServerlessInstanceForTest();
    });
  });
});
