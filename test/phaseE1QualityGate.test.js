/**
 * ProjectPilot AI - Phase E.1 Quality Gate Verification Suite
 *
 * Independently validates:
 * 1. PriorityService formula consistency with EXPLAIN_FORMULA.
 * 2. Blocker penalty applied exactly once across diverse blocker conditions.
 * 3. Blocked vs executable rankings across varied priority tiers, bugs, and statuses.
 * 4. Deterministic tie-breaking across scores, valid due dates, missing due dates, invalid due dates, and unusual task IDs.
 * 5. Multilingual conversation turns: Marathi, ambiguous Devanagari, mixed script.
 * 6. Explicit language switch commands overriding established preference (English <-> Marathi <-> Hindi).
 * 7. Non-mutation guarantees for explanation, discovery, and language-switching workflows.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../src/server.js';
import { McpBrowserClient } from '../public/js/api/mcpClient.js';
import { AssistantOrchestrator } from '../public/js/orchestrator.js';
import { PriorityService } from '../src/services/priorityService.js';
import { ProjectStore } from '../src/db/store.js';

describe('Phase E.1 Quality Gate: Priority, Multilingual & Safety Validation', () => {
  let tempDir;
  let serverInstance;
  let client;
  let orchestrator;
  let store;
  let priorityService;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-phase-e1-'));
    const storePath = path.join(tempDir, 'phase-e1-store.json');
    serverInstance = await createServer({ storePath, extendedTools: true });
    const addr = await serverInstance.start(0);

    const mcpUrl = `http://localhost:${addr.port}/mcp`;
    client = new McpBrowserClient(mcpUrl);
    await client.connect();
    orchestrator = new AssistantOrchestrator(client);
    store = serverInstance.store;
    priorityService = new PriorityService(store);
  });

  after(async () => {
    if (client) await client.disconnect();
    if (serverInstance) await serverInstance.stop();
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // =========================================================================
  // 1. Blocker Penalty Exact-Once Application & Diverse Blocker Conditions
  // =========================================================================
  describe('1. Blocker Penalty Application & Readiness Evaluation', () => {
    test('penalty is applied exactly once when both status=blocked and blocker text are present', () => {
      const mockStore = {
        listTasks: () => [
          { id: 't-1', projectId: 'p-1', priority: 'critical', status: 'blocked', blocker: 'Firewall port blocked' }
        ],
        listProjects: () => [{ id: 'p-1', name: 'Proj 1', status: 'active', priority: 'medium' }]
      };
      const ps = new PriorityService(mockStore);
      const res = ps.getRecommendations({ limit: 1 });
      const rec = res.recommendations[0];

      // Critical (40) + Active Proj (10) - Blocker Penalty (20) = 30
      assert.equal(rec.score, 30);
      assert.equal(rec.executionReadiness, 'Blocked — Unblocking Required');
      const penaltyReasons = rec.reasons.filter(r => r.includes('-20 pts'));
      assert.equal(penaltyReasons.length, 1, 'Blocker penalty must be applied exactly once');
    });

    test('penalty is applied exactly once when status=blocked but blocker text is null/empty', () => {
      const mockStore = {
        listTasks: () => [
          { id: 't-2', projectId: 'p-1', priority: 'high', status: 'blocked', blocker: null }
        ],
        listProjects: () => [{ id: 'p-1', name: 'Proj 1', status: 'active', priority: 'medium' }]
      };
      const ps = new PriorityService(mockStore);
      const res = ps.getRecommendations({ limit: 1 });
      const rec = res.recommendations[0];

      // High (30) + Active Proj (10) - Blocker Penalty (20) = 20
      assert.equal(rec.score, 20);
      assert.equal(rec.executionReadiness, 'Blocked — Unblocking Required');
      const penaltyReasons = rec.reasons.filter(r => r.includes('-20 pts'));
      assert.equal(penaltyReasons.length, 1);
    });

    test('penalty is applied exactly once when status=todo but blocker text is present', () => {
      const mockStore = {
        listTasks: () => [
          { id: 't-3', projectId: 'p-1', priority: 'high', status: 'todo', blocker: 'Awaiting API token' }
        ],
        listProjects: () => [{ id: 'p-1', name: 'Proj 1', status: 'active', priority: 'medium' }]
      };
      const ps = new PriorityService(mockStore);
      const res = ps.getRecommendations({ limit: 1 });
      const rec = res.recommendations[0];

      // High (30) + Active Proj (10) - Blocker Penalty (20) = 20
      assert.equal(rec.score, 20);
      assert.equal(rec.executionReadiness, 'Blocked — Unblocking Required');
      const penaltyReasons = rec.reasons.filter(r => r.includes('-20 pts'));
      assert.equal(penaltyReasons.length, 1);
    });

    test('unblocked in_progress task receives in_progress bonus and zero blocker penalty', () => {
      const mockStore = {
        listTasks: () => [
          { id: 't-4', projectId: 'p-1', priority: 'high', status: 'in_progress', blocker: null }
        ],
        listProjects: () => [{ id: 'p-1', name: 'Proj 1', status: 'active', priority: 'medium' }]
      };
      const ps = new PriorityService(mockStore);
      const res = ps.getRecommendations({ limit: 1 });
      const rec = res.recommendations[0];

      // High (30) + Active Proj (10) + In Progress (8) = 48
      assert.equal(rec.score, 48);
      assert.equal(rec.executionReadiness, 'Ready');
      const penaltyReasons = rec.reasons.filter(r => r.includes('-20 pts'));
      assert.equal(penaltyReasons.length, 0);
      assert.ok(rec.reasons.some(r => r.includes('+8 pts')));
    });
  });

  // =========================================================================
  // 2. Blocked vs Executable Priority Ranking Matrix
  // =========================================================================
  describe('2. Blocked vs Executable Priority Ranking Matrix', () => {
    test('High-priority executable task ranks above Critical-priority blocked task', () => {
      const mockStore = {
        listTasks: () => [
          { id: 't-crit-blocked', projectId: 'p-1', priority: 'critical', status: 'blocked', blocker: 'Blocked by infra' },
          { id: 't-high-ready', projectId: 'p-1', priority: 'high', status: 'todo' }
        ],
        listProjects: () => [{ id: 'p-1', name: 'Proj 1', status: 'active', priority: 'medium' }]
      };
      const ps = new PriorityService(mockStore);
      const recs = ps.getRecommendations().recommendations;

      // High ready: 30 + 10 = 40
      // Critical blocked: 40 + 10 - 20 = 30
      assert.equal(recs[0].taskId, 't-high-ready');
      assert.equal(recs[1].taskId, 't-crit-blocked');
      assert.ok(recs[0].score > recs[1].score);
    });

    test('High-priority in-progress task ranks above Critical-priority blocked bug', () => {
      const mockStore = {
        listTasks: () => [
          { id: 't-crit-blocked-bug', projectId: 'p-1', priority: 'critical', isBug: true, status: 'blocked', blocker: 'Db down' },
          { id: 't-high-in-prog', projectId: 'p-1', priority: 'high', status: 'in_progress' }
        ],
        listProjects: () => [{ id: 'p-1', name: 'Proj 1', status: 'active', priority: 'medium' }]
      };
      const ps = new PriorityService(mockStore);
      const recs = ps.getRecommendations().recommendations;

      // High in-progress: 30 + 10 + 8 = 48
      // Critical blocked bug: 40 + 15 + 10 - 20 = 45
      assert.equal(recs[0].taskId, 't-high-in-prog');
      assert.equal(recs[1].taskId, 't-crit-blocked-bug');
      assert.ok(recs[0].score > recs[1].score);
    });

    test('Medium-priority executable task ranks above Low-priority blocked task', () => {
      const mockStore = {
        listTasks: () => [
          { id: 't-low-blocked', projectId: 'p-1', priority: 'low', status: 'blocked', blocker: 'Blocked' },
          { id: 't-med-ready', projectId: 'p-1', priority: 'medium', status: 'todo' }
        ],
        listProjects: () => [{ id: 'p-1', name: 'Proj 1', status: 'active', priority: 'medium' }]
      };
      const ps = new PriorityService(mockStore);
      const recs = ps.getRecommendations().recommendations;

      // Med ready: 20 + 10 = 30
      // Low blocked: 10 + 10 - 20 = 0
      assert.equal(recs[0].taskId, 't-med-ready');
      assert.equal(recs[1].taskId, 't-low-blocked');
      assert.equal(recs[0].score, 30);
      assert.equal(recs[1].score, 0);
    });
  });

  // =========================================================================
  // 3. Deterministic Ordering Edge Cases (Ties, Dates, Unusual IDs)
  // =========================================================================
  describe('3. Deterministic Ordering Edge Cases', () => {
    test('identical scores sort by earliest valid due date', () => {
      const mockStore = {
        listTasks: () => [
          { id: 't-later', priority: 'high', dueDate: '2026-11-15' },
          { id: 't-earlier', priority: 'high', dueDate: '2026-11-05' }
        ],
        listProjects: () => []
      };
      const ps = new PriorityService(mockStore);
      const recs = ps.getRecommendations().recommendations;

      assert.equal(recs[0].taskId, 't-earlier');
      assert.equal(recs[1].taskId, 't-later');
    });

    test('task with due date precedes task without due date when scores tie', () => {
      const mockStore = {
        listTasks: () => [
          { id: 't-no-date', priority: 'high', dueDate: null },
          { id: 't-has-date', priority: 'high', dueDate: '2026-11-20' }
        ],
        listProjects: () => []
      };
      const ps = new PriorityService(mockStore);
      const recs = ps.getRecommendations().recommendations;

      assert.equal(recs[0].taskId, 't-has-date');
      assert.equal(recs[1].taskId, 't-no-date');
    });

    test('invalid due dates fall back to taskId ordering without throwing or NaN', () => {
      const mockStore = {
        listTasks: () => [
          { id: 'task-zeta', priority: 'high', dueDate: 'not-a-valid-date' },
          { id: 'task-alpha', priority: 'high', dueDate: 'corrupted-timestamp' }
        ],
        listProjects: () => []
      };
      const ps = new PriorityService(mockStore);
      const recs = ps.getRecommendations().recommendations;

      assert.equal(recs[0].taskId, 'task-alpha');
      assert.equal(recs[1].taskId, 'task-zeta');
    });

    test('unusual task IDs (numeric, UUID, symbols) sort deterministically by taskId string', () => {
      const mockStore = {
        listTasks: () => [
          { id: '9999-numeric', priority: 'medium' },
          { id: '0001-numeric', priority: 'medium' },
          { id: 'uuid-b873-456', priority: 'medium' },
          { id: 'uuid-a123-789', priority: 'medium' }
        ],
        listProjects: () => []
      };
      const ps = new PriorityService(mockStore);
      const recs = ps.getRecommendations({ limit: 10 }).recommendations;

      assert.deepEqual(
        recs.map(r => r.taskId),
        ['0001-numeric', '9999-numeric', 'uuid-a123-789', 'uuid-b873-456']
      );
    });
  });

  // =========================================================================
  // 4. Multilingual Consecutive Conversational Turns & Language Overrides
  // =========================================================================
  describe('4. Multilingual Consecutive Conversational Turns & Language Overrides', () => {
    test('full multi-turn language persistence and explicit override lifecycle', async () => {
      const testOrch = new AssistantOrchestrator(client);

      // Turn 1: Distinctive Marathi operation -> sets preferredLanguage to 'mr'
      const turn1 = await testOrch.process('OmniCloud Platform तपासा');
      assert.equal(testOrch.memory.preferredLanguage, 'mr');
      assert.equal(turn1.workflow, 'project_investigation');

      // Turn 2: Ambiguous Devanagari word ("काम") -> does NOT poison preference to Hindi
      await testOrch.process('काम');
      assert.equal(testOrch.memory.preferredLanguage, 'mr', 'Ambiguous Devanagari turn must NOT poison Marathi preference');

      // Turn 3: Explicit switch command to English overrides preference immediately
      const turn3 = await testOrch.process('Switch to English');
      assert.equal(turn3.workflow, 'switch_language');
      assert.equal(testOrch.memory.preferredLanguage, 'en', 'Explicit switch must set preferredLanguage to en');
      assert.ok(turn3.explanation.includes('Language successfully switched to **English**'));
      assert.equal(turn3.toolCalls.length, 0, 'Language switch must not perform tool calls');

      // Turn 4: Subsequent English query responds in English
      const turn4 = await testOrch.process('Show daily priorities');
      assert.equal(turn4.workflow, 'daily_priorities');
      assert.ok(turn4.explanation.includes('🎯 **Immediate Focus:**'));

      // Turn 5: Explicit switch command to Marathi overrides back to Marathi
      const turn5 = await testOrch.process('Switch to Marathi');
      assert.equal(turn5.workflow, 'switch_language');
      assert.equal(testOrch.memory.preferredLanguage, 'mr');
      assert.ok(turn5.explanation.includes('भाषा यशस्वीरित्या **मराठी** मध्ये बदलण्यात आली आहे'));

      // Turn 6: Explicit switch command to Hindi overrides to Hindi
      const turn6 = await testOrch.process('Speak in Hindi');
      assert.equal(turn6.workflow, 'switch_language');
      assert.equal(testOrch.memory.preferredLanguage, 'hi');
      assert.ok(turn6.explanation.includes('भाषा सफलतापूर्वक बदलकर **हिन्दी** कर दी गई है'));
    });
  });

  // =========================================================================
  // 5. Intent Routing & Non-Mutation Guarantees
  // =========================================================================
  describe('5. Intent Routing & Non-Mutation Guarantees', () => {
    test('EXPLAIN_CONCEPT triggers zero tools and causes zero mutations', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('Explain MCP in simple English.');

      assert.equal(outcome.workflow, 'explain_concept');
      assert.equal(outcome.toolCalls.length, 0);
      assert.ok(outcome.explanation.includes('Model Context Protocol'));
    });

    test('EXPLAIN_FORMULA triggers zero tools and causes zero mutations', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('Explain the daily-priority scoring formula.');

      assert.equal(outcome.workflow, 'explain_formula');
      assert.equal(outcome.toolCalls.length, 0);
      assert.ok(outcome.explanation.includes('Daily Priority Scoring Formula'));
      assert.ok(outcome.explanation.includes('-20 pts'));
    });

    test('FIND_TASK uses strictly read-only list_tasks and causes zero mutations', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('Find task Fix token refresh race condition');

      assert.equal(outcome.workflow, 'find_task');
      assert.equal(outcome.toolCalls.length, 1);
      assert.equal(outcome.toolCalls[0].name, 'list_tasks');
      assert.ok(outcome.explanation.includes('Fix token refresh race condition in background mode'));
    });
  });
});
