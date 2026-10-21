/**
 * ProjectPilot AI - Security & Defensive Hardening Regression Tests
 * Tests:
 * 1. Authentication & Authorization enforcement on /mcp (Bearer & x-api-key).
 * 2. Timing-safe comparison & rejection of unauthenticated/unauthorized callers.
 * 3. CORS origin validation & rejection of untrusted cross-origin requests.
 * 4. Content-Type and payload size restrictions (415 & 413).
 * 5. Path traversal prevention (confinement to public directory, null bytes, dotfiles).
 * 6. Information disclosure prevention & security headers.
 * 7. Rate limiting abuse resistance (429 Too Many Requests).
 * 8. Prototype pollution & invalid ID injection defense in data store.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../src/server.js';
import { ProjectStore } from '../src/db/store.js';

function rawGet(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: 'localhost',
        port,
        path: rawPath,
        method: 'GET'
      },
      (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('ProjectPilot AI - Security & Hardening Audit Tests', () => {
  let tempDir;
  let unauthServer;
  let unauthPort;
  let authServer;
  let authPort;
  let rateLimitedServer;
  let rateLimitedPort;
  const TEST_API_KEY = 'secret-test-key-32chars-long-abc';

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-sec-test-'));

    // 1. Server with NO authentication (Open / Local Development Mode)
    const unauthStorePath = path.join(tempDir, 'unauth-store.json');
    unauthServer = await createServer({
      storePath: unauthStorePath,
      rateLimit: { enabled: true, maxRequests: 200, windowMs: 10000 }
    });
    const unauthAddr = await unauthServer.start(0);
    unauthPort = unauthAddr.port;

    // 2. Server WITH authentication enabled
    const authStorePath = path.join(tempDir, 'auth-store.json');
    authServer = await createServer({
      storePath: authStorePath,
      apiKey: TEST_API_KEY,
      allowedOrigins: ['https://trusted-dashboard.com', 'http://localhost:3000'],
      rateLimit: { enabled: true, maxRequests: 200, windowMs: 10000 }
    });
    const authAddr = await authServer.start(0);
    authPort = authAddr.port;

    // 3. Server with tight rate limit for testing 429
    const rateStorePath = path.join(tempDir, 'rate-store.json');
    rateLimitedServer = await createServer({
      storePath: rateStorePath,
      rateLimit: { enabled: true, maxRequests: 3, windowMs: 10000 }
    });
    const rateAddr = await rateLimitedServer.start(0);
    rateLimitedPort = rateAddr.port;
  });

  after(async () => {
    if (unauthServer) await unauthServer.stop();
    if (authServer) await authServer.stop();
    if (rateLimitedServer) await rateLimitedServer.stop();
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('1. Authentication and Authorization on /mcp', () => {
    test('Rejects unauthenticated POST request to /mcp when API key is configured (401)', async () => {
      const res = await fetch(`http://localhost:${authPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'mcp-protocol-version': '2025-11-25'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {}
        })
      });

      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error.code, -32000);
      assert.ok(data.error.message.includes('Authentication required'));
      assert.ok(res.headers.get('www-authenticate'));
    });

    test('Rejects request with invalid API key (401)', async () => {
      const res = await fetch(`http://localhost:${authPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer wrong-invalid-api-key',
          'mcp-protocol-version': '2025-11-25'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {}
        })
      });

      assert.equal(res.status, 401);
      const data = await res.json();
      assert.ok(data.error.message.includes('Authentication failed'));
    });

    test('Accepts valid Bearer token in Authorization header (200)', async () => {
      const res = await fetch(`http://localhost:${authPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': `Bearer ${TEST_API_KEY}`,
          'mcp-protocol-version': '2025-11-25'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'SecTest', version: '1.0' }
          }
        })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.result?.protocolVersion, '2025-11-25');
    });

    test('Accepts valid token via x-api-key header (200)', async () => {
      const res = await fetch(`http://localhost:${authPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'x-api-key': TEST_API_KEY,
          'mcp-protocol-version': '2025-11-25'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'SecTest', version: '1.0' }
          }
        })
      });

      assert.equal(res.status, 200);
    });

    test('Unauthenticated request succeeds when server runs in local development mode', async () => {
      const res = await fetch(`http://localhost:${unauthPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'LocalDev', version: '1.0' }
          }
        })
      });

      assert.equal(res.status, 200);
    });
  });

  describe('2. Origin & Cross-Origin Controls (CORS)', () => {
    test('Allows request from explicitly configured trusted origin', async () => {
      const res = await fetch(`http://localhost:${authPort}/api/info`, {
        method: 'GET',
        headers: {
          'Origin': 'https://trusted-dashboard.com'
        }
      });

      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), 'https://trusted-dashboard.com');
      assert.equal(res.headers.get('vary'), 'Origin');
    });

    test('Rejects cross-origin request from untrusted origin (403)', async () => {
      const res = await fetch(`http://localhost:${authPort}/api/info`, {
        method: 'GET',
        headers: {
          'Origin': 'https://malicious-attacker.com'
        }
      });

      assert.equal(res.status, 403);
      assert.equal(res.headers.get('access-control-allow-origin'), null);
    });

    test('OPTIONS preflight from untrusted origin is rejected (403)', async () => {
      const res = await fetch(`http://localhost:${authPort}/mcp`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://evil-phishing-site.xyz'
        }
      });

      assert.equal(res.status, 403);
    });

    test('OPTIONS preflight from trusted origin responds with 204 and CORS headers', async () => {
      const res = await fetch(`http://localhost:${authPort}/mcp`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://trusted-dashboard.com'
        }
      });

      assert.equal(res.status, 204);
      assert.equal(res.headers.get('access-control-allow-origin'), 'https://trusted-dashboard.com');
      assert.ok(res.headers.get('access-control-allow-headers').includes('Authorization'));
    });
  });

  describe('3. HTTP & MCP Request Validation', () => {
    test('Rejects POST to /mcp with non-JSON Content-Type (415)', async () => {
      const res = await fetch(`http://localhost:${unauthPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain'
        },
        body: 'invalid-plain-text'
      });

      assert.equal(res.status, 415);
      const data = await res.json();
      assert.equal(data.error.code, -32700);
    });

    test('Rejects oversized request payload exceeding 2MB (413)', async () => {
      const oversizedPayload = Buffer.alloc(2.5 * 1024 * 1024, 'a');
      const res = await fetch(`http://localhost:${unauthPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: oversizedPayload
      });

      assert.equal(res.status, 413);
      const data = await res.json();
      assert.ok(data.error.message.includes('Payload Too Large'));
    });

    test('Rejects malformed session ID format (400)', async () => {
      const res = await fetch(`http://localhost:${unauthPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'mcp-session-id': '../../../../etc/passwd'
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/list' })
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.message.includes('Invalid mcp-session-id format'));
    });
  });

  describe('4. File-System Confinement & Path Traversal Defenses', () => {
    test('Rejects directory traversal attempt via dot-dots (403)', async () => {
      const res = await rawGet(unauthPort, '/../package.json');
      assert.equal(res.status, 403);
      assert.ok(res.body.includes('Forbidden'));
    });

    test('Rejects encoded traversal attempt (%2e%2e) (403)', async () => {
      const res = await rawGet(unauthPort, '/%2e%2e/package.json');
      assert.equal(res.status, 403);
    });

    test('Rejects attempts to access hidden dotfiles like .env (403)', async () => {
      const res = await rawGet(unauthPort, '/.env');
      assert.equal(res.status, 403);
    });

    test('Rejects null-byte poisoned path traversal (400)', async () => {
      const res = await rawGet(unauthPort, '/index.html%00.jpg');
      assert.equal(res.status, 400);
    });
  });

  describe('5. Information Disclosure & Security Headers', () => {
    test('Enforces standard defensive security headers on all responses', async () => {
      const res = await fetch(`http://localhost:${unauthPort}/api/info`);
      assert.equal(res.status, 200);

      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
      assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
      assert.ok(res.headers.get('content-security-policy'));
    });

    test('/api/info exposes operational statistics without disclosing secrets or paths', async () => {
      const res = await fetch(`http://localhost:${authPort}/api/info`, {
        headers: { 'Origin': 'https://trusted-dashboard.com' }
      });
      assert.equal(res.status, 200);
      const info = await res.json();

      assert.equal(info.product, 'ProjectPilot AI');
      assert.equal(info.authConfigured, true);
      assert.equal(typeof info.dataStats.projects, 'number');

      // Must NOT contain internal paths, keys, or process info
      const rawText = JSON.stringify(info);
      assert.ok(!rawText.includes(TEST_API_KEY), 'Must never leak API key');
      assert.ok(!rawText.includes(tempDir), 'Must not leak file system paths');
      assert.ok(!rawText.includes('process.env'), 'Must not leak environment');
    });
  });

  describe('6. Abuse Resistance & Rate Limiting', () => {
    test('Returns 429 Too Many Requests when request burst exceeds rate limit', async () => {
      let hit429 = false;
      // rateLimitedServer allows max 3 requests per 10 seconds
      for (let i = 0; i < 6; i++) {
        const res = await fetch(`http://localhost:${rateLimitedPort}/api/info`);
        if (res.status === 429) {
          hit429 = true;
          const retryAfter = res.headers.get('retry-after');
          assert.ok(retryAfter, 'Must supply Retry-After header');
          break;
        }
      }
      assert.ok(hit429, 'Must trigger 429 rate limit after burst');
    });
  });

  describe('7. Data Store Injection & Prototype Pollution Defense', () => {
    test('Rejects project creation with reserved prototype pollution ID', async () => {
      const store = new ProjectStore(path.join(tempDir, 'proto-store.json'));
      await store.init();

      await assert.rejects(
        async () => {
          await store.createProject({
            id: '__proto__',
            name: 'Exploit Project'
          });
        },
        /Invalid project ID format/
      );
    });

    test('Rejects project creation with path traversal ID', async () => {
      const store = new ProjectStore(path.join(tempDir, 'proto-store2.json'));
      await store.init();

      await assert.rejects(
        async () => {
          await store.createProject({
            id: '../../evil',
            name: 'Exploit Project'
          });
        },
        /Invalid project ID format/
      );
    });

    test('Rejects task creation with invalid ID', async () => {
      const store = new ProjectStore(path.join(tempDir, 'proto-store3.json'));
      await store.init();
      const proj = await store.createProject({ name: 'Valid Project' });

      await assert.rejects(
        async () => {
          await store.createTask({
            id: 'constructor',
            projectId: proj.id,
            title: 'Exploit Task'
          });
        },
        /Invalid task ID format/
      );
    });
  });
});
