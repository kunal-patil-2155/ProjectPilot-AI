/**
 * ProjectPilot AI - Data Store & Persistence Tests
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStore } from '../src/db/store.js';

describe('ProjectStore CRUD & Persistence', () => {
  let tempDir;
  let storeFile;
  let store;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-test-'));
    storeFile = path.join(tempDir, 'test-store.json');
    store = new ProjectStore(storeFile);
    await store.init();
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test('initializes with sample data when file does not exist', () => {
    const projects = store.listProjects();
    const tasks = store.listTasks();
    assert.ok(projects.length >= 3, 'Should seed at least 3 projects');
    assert.ok(tasks.length >= 5, 'Should seed at least 5 tasks');
  });

  test('Project CRUD operations work with validation', async () => {
    // Create
    const created = await store.createProject({
      name: 'Telemetry Hub',
      description: 'Distributed metrics aggregator',
      category: 'DevOps',
      techStack: ['Go', 'Kafka'],
      repoUrl: 'https://github.com/example/telemetry-hub',
      status: 'active',
      priority: 'high'
    });

    assert.ok(created.id, 'Should generate an ID');
    assert.equal(created.name, 'Telemetry Hub');
    assert.equal(created.priority, 'high');

    // Read
    const retrieved = store.getProject(created.id);
    assert.ok(retrieved);
    assert.equal(retrieved.name, 'Telemetry Hub');
    assert.ok(Array.isArray(retrieved.tasks));

    // Update
    const updated = await store.updateProject(created.id, {
      priority: 'critical',
      description: 'Updated description'
    });
    assert.equal(updated.priority, 'critical');
    assert.equal(updated.description, 'Updated description');

    // List with filter
    const criticals = store.listProjects({ priority: 'critical' });
    assert.ok(criticals.some(p => p.id === created.id));

    // Delete
    const deleteResult = await store.deleteProject(created.id);
    assert.equal(deleteResult.success, true);
    assert.equal(store.getProject(created.id), null);
  });

  test('rejects invalid project input', async () => {
    await assert.rejects(
      async () => store.createProject({ name: '' }),
      /Project name is required/
    );

    await assert.rejects(
      async () => store.createProject({ name: 'Valid', status: 'invalid_status' }),
      /Invalid project status/
    );

    await assert.rejects(
      async () => store.createProject({ name: 'Valid', priority: 'ultra' }),
      /Invalid priority/
    );
  });

  test('Task CRUD operations and reference integrity', async () => {
    const projects = store.listProjects();
    const targetProject = projects[0];

    // Create task
    const task = await store.createTask({
      projectId: targetProject.id,
      title: 'Setup automated smoke test runner',
      description: 'Run health check script after deployment',
      priority: 'high',
      status: 'todo',
      dueDate: new Date(Date.now() + 86400000).toISOString()
    });

    assert.ok(task.id);
    assert.equal(task.projectId, targetProject.id);
    assert.equal(task.status, 'todo');

    // Reject task with non-existent project
    await assert.rejects(
      async () => store.createTask({
        projectId: 'proj-non-existent-12345',
        title: 'Orphaned Task'
      }),
      /does not exist/
    );

    // Update status to blocked with reason
    const blocked = await store.updateTaskStatus(task.id, 'blocked', 'Awaiting test cluster access');
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.blocker, 'Awaiting test cluster access');

    // Verify listBlockers returns it
    const blockers = store.listBlockers(targetProject.id);
    assert.ok(blockers.some(b => b.taskId === task.id));

    // Complete task: status 'done' clears blocker and sets completedAt
    const completed = await store.updateTaskStatus(task.id, 'done');
    assert.equal(completed.status, 'done');
    assert.equal(completed.blocker, null);
    assert.ok(completed.completedAt);
  });

  test('persistence across restart: new instance retains changes without overwriting', async () => {
    // Add custom project and task
    const customProj = await store.createProject({
      name: 'Persistent Gateway',
      category: 'Backend',
      priority: 'critical'
    });

    const customTask = await store.createTask({
      projectId: customProj.id,
      title: 'Persistent Task Check',
      priority: 'high'
    });

    // Simulate server restart: create completely new ProjectStore on the same file
    const restartedStore = new ProjectStore(storeFile);
    await restartedStore.init();

    const fetchedProj = restartedStore.getProject(customProj.id);
    assert.ok(fetchedProj, 'Project must survive server restart');
    assert.equal(fetchedProj.name, 'Persistent Gateway');

    const fetchedTask = restartedStore.getTask(customTask.id);
    assert.ok(fetchedTask, 'Task must survive server restart');
    assert.equal(fetchedTask.title, 'Persistent Task Check');
  });
});
