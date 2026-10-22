/**
 * ProjectPilot AI - Developer Settings & Authentication UI Tests (Phase 5 / P1-2)
 * Tests:
 * 1. In-memory API key handling in McpBrowserClient (zero persistence to localStorage/sessionStorage/cookies).
 * 2. Proper Authorization header construction ('Bearer <key>').
 * 3. Secret sanitization and defense-in-depth against credential leaks in telemetry/events.
 * 4. Live MCP Gateway integration: read-only access without credentials, authenticated mutations with valid key, rejection with invalid/missing key.
 * 5. Dynamic key replacement and clearing taking effect immediately.
 * 6. Accessible modal DOM structure and password masking verification.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { McpBrowserClient } from '../public/js/api/mcpClient.js';
import { createServer } from '../src/server.js';
import { ProjectStore } from '../src/db/store.js';

describe('Developer Settings & In-Memory Authentication (P1-2)', () => {
  let tempDir;
  let prodServerWithKey;
  let prodPortWithKey;
  let prodUrlWithKey;

  let prodServerNoKey;
  let prodPortNoKey;
  let prodUrlNoKey;

  const TEST_API_KEY = 'developer-secure-token-alexa-plus-2026';

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-devsettings-'));

    // 1. Production server with configured key
    const storeWithKey = new ProjectStore(path.join(tempDir, 'store-withkey.json'));
    await storeWithKey.init();
    prodServerWithKey = await createServer({
      isProduction: true,
      isDurable: true,
      apiKey: TEST_API_KEY,
      store: storeWithKey
    });
    const addr1 = await prodServerWithKey.start(0);
    prodPortWithKey = addr1.port;
    prodUrlWithKey = `http://localhost:${prodPortWithKey}/mcp`;

    // 2. Production server without configured key (public access policy)
    const storeNoKey = new ProjectStore(path.join(tempDir, 'store-nokey.json'));
    await storeNoKey.init();
    prodServerNoKey = await createServer({
      isProduction: true,
      isDurable: true,
      apiKey: null,
      store: storeNoKey
    });
    const addr2 = await prodServerNoKey.start(0);
    prodPortNoKey = addr2.port;
    prodUrlNoKey = `http://localhost:${prodPortNoKey}/mcp`;
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

  describe('1. In-Memory Key Handling & Lifecycle', () => {
    test('defaults to null API key and hasApiKey() reports false', () => {
      const client = new McpBrowserClient(prodUrlWithKey);
      assert.equal(client.apiKey, null);
      assert.equal(client.hasApiKey(), false);
    });

    test('setApiKey stores trimmed string strictly in memory', () => {
      const client = new McpBrowserClient(prodUrlWithKey);
      client.setApiKey('  secret-token-123  ');
      assert.equal(client.apiKey, 'secret-token-123');
      assert.equal(client.hasApiKey(), true);
    });

    test('clearApiKey purges credential from memory immediately', () => {
      const client = new McpBrowserClient(prodUrlWithKey, { apiKey: 'initial-key' });
      assert.equal(client.hasApiKey(), true);

      client.clearApiKey();
      assert.equal(client.apiKey, null);
      assert.equal(client.hasApiKey(), false);
    });

    test('falsy and empty keys reset credential to null', () => {
      const client = new McpBrowserClient(prodUrlWithKey);
      client.setApiKey('valid-key');
      assert.equal(client.hasApiKey(), true);

      client.setApiKey('');
      assert.equal(client.apiKey, null);
      assert.equal(client.hasApiKey(), false);

      client.setApiKey('valid-key-2');
      client.setApiKey(null);
      assert.equal(client.apiKey, null);
      assert.equal(client.hasApiKey(), false);
    });
  });

  describe('2. Authorization Header Construction', () => {
    test('omits Authorization header when no API key is configured', () => {
      const client = new McpBrowserClient(prodUrlWithKey);
      const headers = client._buildHeaders();
      assert.equal(headers['Authorization'], undefined);
      assert.equal(headers['authorization'], undefined);
      assert.equal(headers['mcp-protocol-version'], '2025-11-25');
    });

    test('attaches Bearer Authorization header when API key is set', () => {
      const client = new McpBrowserClient(prodUrlWithKey);
      client.setApiKey(TEST_API_KEY);
      const headers = client._buildHeaders();
      assert.equal(headers['Authorization'], `Bearer ${TEST_API_KEY}`);
    });

    test('respects session ID and extra headers while preserving Bearer token', () => {
      const client = new McpBrowserClient(prodUrlWithKey);
      client.sessionId = 'session-xyz-987';
      client.setApiKey(TEST_API_KEY);
      const headers = client._buildHeaders({ 'x-custom-test': '123' });

      assert.equal(headers['mcp-session-id'], 'session-xyz-987');
      assert.equal(headers['Authorization'], `Bearer ${TEST_API_KEY}`);
      assert.equal(headers['x-custom-test'], '123');
    });
  });

  describe('3. Zero Persistence to Browser Storage (Security Compliance)', () => {
    test('client does not read or write to localStorage or sessionStorage', () => {
      let accessedStorage = false;
      const storageTrap = {
        getItem() { accessedStorage = true; return null; },
        setItem() { accessedStorage = true; },
        removeItem() { accessedStorage = true; },
        clear() { accessedStorage = true; }
      };

      global.localStorage = storageTrap;
      global.sessionStorage = storageTrap;

      try {
        const client = new McpBrowserClient(prodUrlWithKey);
        client.setApiKey('test-temp-key');
        assert.equal(client.apiKey, 'test-temp-key');
        client.clearApiKey();
        assert.equal(client.apiKey, null);

        assert.equal(accessedStorage, false, 'Client must NOT interact with localStorage or sessionStorage');
      } finally {
        delete global.localStorage;
        delete global.sessionStorage;
      }
    });
  });

  describe('4. Telemetry Sanitization & Secret Disclosure Prevention', () => {
    test('_sanitizeHeaders replaces sensitive tokens with [REDACTED]', () => {
      const client = new McpBrowserClient(prodUrlWithKey);
      const rawHeaders = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer super-secret-key-12345',
        'x-api-key': 'raw-api-key-999',
        'mcp-protocol-version': '2025-11-25'
      };

      const sanitized = client._sanitizeHeaders(rawHeaders);
      assert.equal(sanitized['Authorization'], 'Bearer [REDACTED]');
      assert.equal(sanitized['x-api-key'], '[REDACTED]');
      assert.equal(sanitized['mcp-protocol-version'], '2025-11-25');
      assert.equal(sanitized['Content-Type'], 'application/json');

      // Original headers remain untouched
      assert.equal(rawHeaders['Authorization'], 'Bearer super-secret-key-12345');
    });

    test('onEvent listeners receive sanitized headers without raw API credentials', async () => {
      const client = new McpBrowserClient(prodUrlWithKey, { apiKey: TEST_API_KEY });
      const emittedEvents = [];

      client.onEvent((event, payload) => {
        emittedEvents.push({ event, payload });
      });

      await client.connect();

      assert.ok(emittedEvents.length > 0);
      for (const { event, payload } of emittedEvents) {
        if (payload?.headers) {
          const authHeader = payload.headers['Authorization'] || payload.headers['authorization'];
          if (authHeader) {
            assert.equal(authHeader, 'Bearer [REDACTED]', `Event '${event}' leaked raw Authorization header!`);
          }
        }
      }
    });
  });

  describe('5. Live Authentication Flow: Read-Only vs Mutating Operations', () => {
    test('public read-only inspection succeeds without credentials on unauthenticated gateway', async () => {
      const client = new McpBrowserClient(prodUrlNoKey); // Public instance with no key
      await client.connect();

      // Read-only tool call: get_project_health
      const healthRes = await client.callTool('get_project_health', { projectId: 'proj-cloudsync' });
      assert.ok(healthRes.data);
      assert.equal(healthRes.data.projectId, 'proj-cloudsync');
    });

    test('mutating operation without credentials on unauthenticated production gateway is rejected with HTTP 401', async () => {
      const client = new McpBrowserClient(prodUrlNoKey); // Public instance with no key
      await client.connect();

      await assert.rejects(
        async () => {
          await client.callTool('create_project', {
            name: 'Unauthorized Project Attempt'
          });
        },
        (err) => {
          assert.ok(err.message.includes('Authentication required') || err.message.includes('401'));
          return true;
        }
      );
    });

    test('mutating operation with invalid credentials is rejected with HTTP 401', async () => {
      const client = new McpBrowserClient(prodUrlWithKey, { apiKey: 'incorrect-bogus-key' });

      await assert.rejects(
        async () => {
          await client.connect();
        },
        (err) => {
          assert.ok(err.message.includes('401') || err.message.includes('Authentication failed'));
          return true;
        }
      );
    });

    test('applying valid key allows authorized mutating operations', async () => {
      const client = new McpBrowserClient(prodUrlWithKey);
      client.setApiKey(TEST_API_KEY);

      await client.connect();

      const createRes = await client.callTool('create_project', {
        name: 'Developer Settings Authorized Project',
        description: 'Created through verified in-memory authentication',
        category: 'Backend'
      });

      assert.ok(createRes.data);
      assert.equal(createRes.data.project.name, 'Developer Settings Authorized Project');
      assert.ok(createRes.data.project.id);
    });

    test('clearing key immediately blocks subsequent mutations', async () => {
      const client = new McpBrowserClient(prodUrlWithKey, { apiKey: TEST_API_KEY });
      await client.connect();

      // First mutation succeeds with key
      const task1 = await client.callTool('create_task', {
        projectId: 'proj-cloudsync',
        title: 'Authorized Task Before Clear'
      });
      assert.ok(task1.data.task.id);

      // Clear key from memory
      client.clearApiKey();
      assert.equal(client.hasApiKey(), false);

      // Reconnect/callTool without key must now be rejected
      await assert.rejects(
        async () => {
          await client.callTool('create_task', {
            projectId: 'proj-cloudsync',
            title: 'Unauthorized Task After Clear'
          });
        },
        (err) => {
          assert.ok(err.message.includes('Authentication required') || err.message.includes('401'));
          return true;
        }
      );
    });

    test('replacing key takes effect immediately without client re-instantiation', async () => {
      const client = new McpBrowserClient(prodUrlWithKey, { apiKey: 'bad-key-1' });

      // Bad key fails
      await assert.rejects(async () => {
        await client.connect();
      });

      // Replace key in-memory with valid token
      client.setApiKey(TEST_API_KEY);
      await client.connect();

      const task = await client.callTool('create_task', {
        projectId: 'proj-cloudsync',
        title: 'Authorized Task After Key Replacement'
      });
      assert.ok(task.data.task.id);
    });
  });

  describe('6. Accessible Developer Settings Modal HTML Contract', () => {
    test('public/index.html defines required Developer Settings dialog and accessible elements', () => {
      const htmlPath = path.resolve('public/index.html');
      const html = fs.readFileSync(htmlPath, 'utf8');

      // 1. Settings dialog element
      assert.ok(html.includes('<dialog id="settingsModal"'), 'Must define #settingsModal dialog');
      assert.ok(html.includes('closedby="any"'), 'Dialog must support closedby="any"');
      assert.ok(html.includes('aria-labelledby="settingsModalTitle"'), 'Dialog must have accessible aria-labelledby');

      // 2. Password-masked API key input
      assert.ok(html.includes('type="password"'), 'API key input must have type="password"');
      assert.ok(html.includes('id="settingsApiKeyInput"'), 'Must define #settingsApiKeyInput');
      assert.ok(html.includes('autocomplete="off"'), 'API key input must have autocomplete="off"');
      assert.ok(html.includes('aria-describedby="settingsApiKeyHelp"'), 'Input must have aria-describedby');

      // 3. Actions & buttons
      assert.ok(html.includes('id="toggleApiKeyVisibilityBtn"'), 'Must define show/hide password toggle button');
      assert.ok(html.includes('id="clearSettingsKeyBtn"'), 'Must define #clearSettingsKeyBtn');
      assert.ok(html.includes('id="saveSettingsBtn"'), 'Must define #saveSettingsBtn');
      assert.ok(html.includes('id="openSettingsBtn"'), 'Must define header #openSettingsBtn');
      assert.ok(html.includes('id="sidebarSettingsBtn"'), 'Must define sidebar #sidebarSettingsBtn');

      // 4. Status badges
      assert.ok(html.includes('id="settingsAuthStatusBadge"'), 'Must define #settingsAuthStatusBadge');
      assert.ok(html.includes('id="settingsServerEnvBadge"'), 'Must define #settingsServerEnvBadge');
      assert.ok(html.includes('id="settingsStorageBackendBadge"'), 'Must define #settingsStorageBackendBadge');
      assert.ok(html.includes('id="settingsErrorMessage"'), 'Must define #settingsErrorMessage');
      assert.ok(html.includes('role="alert"'), 'Error box must have role="alert"');
    });

    test('styles.css defines Developer Settings card and sidebar button styles', () => {
      const cssPath = path.resolve('public/css/styles.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      assert.ok(css.includes('.settings-connection-card'), 'Must define .settings-connection-card');
      assert.ok(css.includes('.settings-status-row'), 'Must define .settings-status-row');
      assert.ok(css.includes('.input-with-button'), 'Must define .input-with-button');
      assert.ok(css.includes('.form-error-box'), 'Must define .form-error-box');
      assert.ok(css.includes('.sidebar-action-btn'), 'Must define .sidebar-action-btn');
    });
  });

  describe('7. Backend Gateway Transparency (/api/info)', () => {
    test('/api/info exposes authConfigured and storage backend truthfully', async () => {
      const res = await fetch(`http://localhost:${prodPortWithKey}/api/info`);
      assert.equal(res.status, 200);

      const info = await res.json();
      assert.equal(info.product, 'ProjectPilot AI');
      assert.equal(info.authConfigured, true, 'Server must report authConfigured=true when key is active');
      assert.equal(info.isProduction, true);
      assert.equal(info.isDurable, true);
      assert.equal(info.storageBackend, 'upstash_redis');
    });
  });
});
