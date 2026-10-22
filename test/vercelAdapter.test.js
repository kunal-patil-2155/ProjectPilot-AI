import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import handler from '../api/index.js';
import { createServer } from '../src/server.js';

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
    assert.equal(toolsData.result?.tools?.length, 12, 'Must list all 12 MCP tools');
    const toolNames = toolsData.result.tools.map(t => t.name);
    assert.ok(toolNames.includes('generate_rescue_plan'));
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
});
