/**
 * ProjectPilot AI - Domain Services Tests (Health, Priority, Maintenance)
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStore } from '../src/db/store.js';
import { HealthService } from '../src/services/healthService.js';
import { PriorityService } from '../src/services/priorityService.js';
import { MaintenanceService } from '../src/services/maintenanceService.js';

describe('ProjectPilot Services', () => {
  let tempDir;
  let storeFile;
  let store;
  let healthService;
  let priorityService;
  let maintenanceService;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-serv-'));
    storeFile = path.join(tempDir, 'test-store.json');
    store = new ProjectStore(storeFile);
    await store.init();

    healthService = new HealthService(store);
    priorityService = new PriorityService(store);
    maintenanceService = new MaintenanceService(store);
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test('HealthService calculates truthful health metrics and status', () => {
    const allHealth = healthService.getHealth();
    assert.equal(allHealth.scope, 'all_projects');
    assert.ok(allHealth.aggregate.totalProjects >= 3);
    assert.ok(allHealth.projects.length >= 3);

    // Test specific project with known blocker from sample data (proj-checkout)
    const checkoutHealth = healthService.getHealth('proj-checkout');
    assert.equal(checkoutHealth.projectId, 'proj-checkout');
    assert.equal(checkoutHealth.healthStatus, 'At Risk');
    assert.ok(checkoutHealth.metrics.explicitBlockers.length >= 1);
    assert.ok(checkoutHealth.statusReasons.some(r => r.includes('active blocker')));
  });

  test('PriorityService transparently ranks tasks and provides explicit reasons', () => {
    const recs = priorityService.getRecommendations({ limit: 4 });
    assert.ok(recs.recommendations.length > 0);
    assert.ok(recs.recommendations.length <= 4);

    // Verify ordering: descending by score
    for (let i = 0; i < recs.recommendations.length - 1; i++) {
      assert.ok(
        recs.recommendations[i].score >= recs.recommendations[i + 1].score,
        'Tasks must be ordered descending by score'
      );
    }

    // Every recommendation must provide reasons
    for (const rec of recs.recommendations) {
      assert.ok(rec.reasons.length > 0, 'Every recommendation must have explicit reasons');
      assert.ok(typeof rec.score === 'number');
      assert.ok(rec.title);
      assert.ok(rec.projectName);
    }
  });

  test('MaintenanceService groups overdue and upcoming maintenance tasks', () => {
    const maint = maintenanceService.getMaintenanceSummary({ includeCompleted: true });
    assert.ok(maint.totalMaintenanceTasks >= 2);
    assert.ok(Array.isArray(maint.categories.overdue));
    assert.ok(Array.isArray(maint.categories.dueSoon));

    // Sample data has 1 overdue task (task-devpulse-db)
    const overdueTask = maint.categories.overdue.find(m => m.taskId === 'task-devpulse-db');
    assert.ok(overdueTask, 'Should detect task-devpulse-db as overdue');
    assert.ok(overdueTask.daysOverdue >= 1);

    // Sample data has 1 due soon task (task-cloudsync-cert)
    const dueSoonTask = maint.categories.dueSoon.find(m => m.taskId === 'task-cloudsync-cert');
    assert.ok(dueSoonTask, 'Should detect task-cloudsync-cert as due soon');
    assert.ok(typeof dueSoonTask.daysRemaining === 'number');
  });
});
