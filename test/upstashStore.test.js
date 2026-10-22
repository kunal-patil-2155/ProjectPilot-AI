/**
 * ProjectPilot AI - Upstash Redis Serverless Persistence Tests (P0 Remediation)
 * Tests:
 * 1. Data survives separate store instances using the same remote backend.
 * 2. Updates are visible across independent requests.
 * 3. Existing data is not overwritten during initialization.
 * 4. Network failures do not report false success.
 * 5. Concurrent updates do not silently lose data.
 * 6. Production refuses to start or serve state-mutating requests when required persistence is unavailable.
 * 7. Local JSON-based tests continue to work.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMockUpstashServer } from './helpers/mockUpstashServer.js';
import { UpstashRedisStore } from '../src/db/upstashStore.js';
import { createStore, ProjectStore } from '../src/db/store.js';
import { createServer } from '../src/server.js';

describe('Upstash Redis Serverless Persistence (P0 Remediation)', () => {
  let mockUpstash;
  let upstashConfig;

  before(async () => {
    mockUpstash = createMockUpstashServer({ token: 'test-upstash-token-xyz' });
    upstashConfig = await mockUpstash.start();
  });

  after(async () => {
    if (mockUpstash) await mockUpstash.stop();
  });

  // 1. Data survives separate store instances
  test('1. Data survives separate store instances using the same remote backend', async () => {
    // Instance A creates a project
    const storeA = new UpstashRedisStore({
      url: upstashConfig.url,
      token: upstashConfig.token,
      storeKey: 'test:projectpilot:durability'
    });
    await storeA.init();

    const created = await storeA.createProject({
      name: 'Alpha Distributed Engine',
      category: 'Backend',
      priority: 'high',
      status: 'active'
    });
    assert.ok(created.id);

    // Instance B initializes independently and reads from the same remote store
    const storeB = new UpstashRedisStore({
      url: upstashConfig.url,
      token: upstashConfig.token,
      storeKey: 'test:projectpilot:durability'
    });
    await storeB.init();

    const projectOnB = storeB.getProject(created.id);
    assert.ok(projectOnB, 'Project created on Instance A must be readable on Instance B');
    assert.equal(projectOnB.name, 'Alpha Distributed Engine');
    assert.equal(projectOnB.priority, 'high');
  });

  // 2. Updates are visible across independent requests
  test('2. Updates are visible across independent requests / instances via sync()', async () => {
    const storeKey = 'test:projectpilot:visibility';
    const instanceA = new UpstashRedisStore({
      url: upstashConfig.url,
      token: upstashConfig.token,
      storeKey
    });
    await instanceA.init();

    const project = await instanceA.createProject({ name: 'Task Runner', status: 'active' });
    const task = await instanceA.createTask({ projectId: project.id, title: 'Build Cache Layer' });

    const instanceB = new UpstashRedisStore({
      url: upstashConfig.url,
      token: upstashConfig.token,
      storeKey
    });
    await instanceB.init();

    // Instance A mutates task status
    await instanceA.updateTaskStatus(task.id, 'done');

    // Instance B syncs (as happens at the start of every serverless request)
    await instanceB.sync();
    const taskOnB = instanceB.getTask(task.id);
    assert.equal(taskOnB.status, 'done', 'Status update on Instance A must be visible on Instance B after sync');
  });

  // 3. Existing data is not overwritten during initialization
  test('3. Existing remote data is not overwritten during initialization (no re-seeding)', async () => {
    const storeKey = 'test:projectpilot:no_overwrite';
    const initStore = new UpstashRedisStore({
      url: upstashConfig.url,
      token: upstashConfig.token,
      storeKey
    });
    await initStore.init();

    // Modify a project's name
    const projects = initStore.listProjects();
    const target = projects[0];
    await initStore.updateProject(target.id, { name: 'Custom User Renamed Project' });

    // New instance boots up (simulating Lambda cold start)
    const coldStartInstance = new UpstashRedisStore({
      url: upstashConfig.url,
      token: upstashConfig.token,
      storeKey
    });
    await coldStartInstance.init();

    const verified = coldStartInstance.getProject(target.id);
    assert.equal(verified.name, 'Custom User Renamed Project', 'Cold start must not overwrite established user changes with initial seed');
  });

  // 4. Network failures do not report false success
  test('4. Network failures do not report false success and fail closed', async () => {
    const storeKey = 'test:projectpilot:network_err';
    const store = new UpstashRedisStore({
      url: upstashConfig.url,
      token: upstashConfig.token,
      storeKey
    });
    await store.init();

    // Inject temporary failure into mock server
    mockUpstash.setFailNext(true);

    await assert.rejects(
      async () => {
        await store.createProject({ name: 'Should Fail Project' });
      },
      /Remote persistence error/
    );

    // Verify that the failed project is NOT present in storage
    await store.sync();
    const all = store.listProjects();
    assert.ok(!all.some(p => p.name === 'Should Fail Project'), 'Failed write must not be persisted');
  });

  // 5. Concurrent updates do not silently lose data
  test('5. Concurrent updates do not silently lose data and resolve via CAS versioning', async () => {
    const storeKey = 'test:projectpilot:concurrency';
    const store1 = new UpstashRedisStore({
      url: upstashConfig.url,
      token: upstashConfig.token,
      storeKey
    });
    await store1.init();

    const proj = await store1.createProject({ name: 'Concurrent Service', status: 'active' });

    const store2 = new UpstashRedisStore({
      url: upstashConfig.url,
      token: upstashConfig.token,
      storeKey
    });
    await store2.init();

    // Both instances attempt to create tasks concurrently
    const [res1, res2] = await Promise.all([
      store1.createTask({ projectId: proj.id, title: 'Task From Instance 1' }),
      store2.createTask({ projectId: proj.id, title: 'Task From Instance 2' })
    ]);

    assert.ok(res1.id);
    assert.ok(res2.id);

    // Sync and verify that BOTH tasks were persisted without silent overwrite
    await store1.sync();
    const tasks = store1.listTasks({ projectId: proj.id });
    assert.equal(tasks.length, 2, 'Both concurrent tasks must survive in persisted store');
  });

  // 6. Production refuses to start or serve state-mutating requests when required persistence is unavailable
  test('6. Production refuses to start or serve state-mutating requests when required persistence is unavailable', async () => {
    // A. Startup failure when required persistence is explicitly misconfigured
    await assert.rejects(
      async () => {
        await createServer({
          isProduction: true,
          backend: 'redis',
          url: 'https://example-missing-token.upstash.io',
          token: '' // Missing token
        });
      },
      /Durable persistence configuration error/
    );

    // B. Production without durable storage refuses mutating MCP requests with 503
    const ephemeralProdServer = await createServer({
      isProduction: true,
      isDurable: false, // Local file fallback in production
      apiKey: null
    });
    const { port } = await ephemeralProdServer.start(0);

    try {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 10,
          method: 'tools/call',
          params: {
            name: 'create_project',
            arguments: { name: 'Dangerous Ephemeral Project' }
          }
        })
      });

      assert.equal(res.status, 503, 'Must return 503 Service Unavailable when attempting mutation without durable storage');
      const body = await res.json();
      assert.ok(body.error.message.includes('Durable persistence is not configured'));
    } finally {
      await ephemeralProdServer.stop();
    }
  });

  // 7. Local JSON-based store continues to work
  test('7. Local JSON-based store factory creates ProjectStore when remote storage is not requested', async () => {
    const localStore = await createStore({
      isProduction: false,
      storePath: null // In-memory/temp default
    });
    assert.ok(localStore instanceof ProjectStore);
    const projects = localStore.listProjects();
    assert.ok(projects.length > 0);
  });

  // 8. Server automatically synchronizes remote store on incoming /api/info and /mcp read requests
  test('8. Server automatically synchronizes remote store on incoming read requests', async () => {
    const storeKey = 'test:projectpilot:autosync';
    const serverStore = new UpstashRedisStore({
      url: upstashConfig.url,
      token: upstashConfig.token,
      storeKey
    });
    await serverStore.init();

    const remoteServer = await createServer({
      isProduction: true,
      isDurable: true,
      store: serverStore
    });
    const { port } = await remoteServer.start(0);

    try {
      // Direct remote mutation via separate instance (simulating external container update)
      const externalStore = new UpstashRedisStore({
        url: upstashConfig.url,
        token: upstashConfig.token,
        storeKey
      });
      await externalStore.init();
      await externalStore.createProject({
        name: 'AutoSynced Distributed Microservice',
        category: 'Cloud',
        priority: 'high'
      });

      // Call /api/info on the server WITHOUT manual sync
      const res = await fetch(`http://localhost:${port}/api/info`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.dataStats.projects >= 4, 'Server should have automatically synced the new project count from Redis');
    } finally {
      await remoteServer.stop();
    }
  });

  // 9. CORS strict allowlist permits project Vercel domains while blocking deceptive prefixes
  test('9. CORS strict allowlist permits project Vercel domains while blocking deceptive prefixes', async () => {
    const corsServer = await createServer({ isProduction: true });
    const { port } = await corsServer.start(0);

    try {
      // Deceptive prefix domain must be rejected
      const evilRes = await fetch(`http://localhost:${port}/api/info`, {
        headers: { 'Origin': 'https://project-pilot-ai-evil.com' }
      });
      assert.equal(evilRes.status, 403, 'Cross-origin request from deceptive prefix must be rejected with 403');
      assert.equal(evilRes.headers.get('access-control-allow-origin'), null);

      // Legitimate preview domain on vercel.app must be accepted
      const legitRes = await fetch(`http://localhost:${port}/api/info`, {
        headers: { 'Origin': 'https://project-pilot-ai-staging-preview.vercel.app' }
      });
      assert.equal(legitRes.status, 200, 'Legitimate Vercel preview domain must be accepted');
      assert.equal(legitRes.headers.get('access-control-allow-origin'), 'https://project-pilot-ai-staging-preview.vercel.app');
    } finally {
      await corsServer.stop();
    }
  });
});
