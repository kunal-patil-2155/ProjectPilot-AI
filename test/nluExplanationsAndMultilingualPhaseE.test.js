/**
 * ProjectPilot AI - Phase E Verification Suite
 *
 * Verifies:
 * 1. E1: Multilingual detection for "DevPulse Analytics तपासा", Hindi, English, mixed, and ambiguous Devanagari.
 * 2. E1: Language preference persistence without poisoning on ambiguous input.
 * 3. E2: Conceptual explanations (MCP, Streamable HTTP, Architecture) without tool calls.
 * 4. E2: Formula explanations based on actual PriorityService weights and blocker penalty.
 * 5. E2: Contextual language-change follow-ups ("Explain this in Marathi").
 * 6. E3: Task title lookup (FIND_TASK) with matching and missing tasks (zero mutations).
 * 7. E4: Blocker penalty (-20 pts) elevating executable alternatives above blocked tasks.
 * 8. E4: All-blocked task detection and notification.
 * 9. E4: Deterministic secondary and tertiary tie-breaking (due date proximity, task ID).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../src/server.js';
import { McpBrowserClient } from '../public/js/api/mcpClient.js';
import {
  AssistantOrchestrator,
  LanguageDetector,
  ConversationMemory,
  IntentClassifier
} from '../public/js/orchestrator.js';
import { PriorityService } from '../src/services/priorityService.js';
import { ProjectStore } from '../src/db/store.js';

describe('Phase E: Natural Intelligence, Architectural Explanations & Multilingual Reliability', () => {
  let tempDir;
  let serverInstance;
  let client;
  let orchestrator;
  let store;
  let priorityService;
  let projId;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-phase-e-'));
    const storePath = path.join(tempDir, 'phase-e-store.json');
    serverInstance = await createServer({ storePath, extendedTools: true });
    const addr = await serverInstance.start(0);

    const mcpUrl = `http://localhost:${addr.port}/mcp`;
    client = new McpBrowserClient(mcpUrl);
    await client.connect();
    orchestrator = new AssistantOrchestrator(client);

    store = serverInstance.store;
    priorityService = new PriorityService(store);

    // Seed test project and tasks
    const p1 = await client.callTool('create_project', {
      name: 'OmniCloud Platform',
      description: 'Distributed cloud synchronization engine',
      category: 'Cloud Infrastructure',
      priority: 'critical'
    });
    projId = p1.data?.project?.id;

    // Task 1: Critical priority but BLOCKED
    await client.callTool('create_task', {
      projectId: projId,
      title: 'Fix Redis connection pool leak',
      status: 'blocked',
      priority: 'critical',
      blocker: 'Firewall blocking port 6379'
    });

    // Task 2: High priority and READY to execute
    await client.callTool('create_task', {
      projectId: projId,
      title: 'Optimize API rate limiter token bucket',
      status: 'in_progress',
      priority: 'high'
    });
  });

  after(async () => {
    if (client) await client.disconnect();
    if (serverInstance) await serverInstance.stop();
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // =========================================================================
  // 1. E1: Multilingual Detection & Ambiguity Handling (BUG-06)
  // =========================================================================
  describe('1. Multilingual Detection & Ambiguity Handling (BUG-06)', () => {
    const detector = new LanguageDetector();

    test('correctly detects Marathi for "DevPulse Analytics तपासा" without Hindi bias', () => {
      const res = detector.detect('DevPulse Analytics तपासा');
      assert.equal(res.language, 'mr', 'Must detect Marathi for Devanagari "तपासा"');
      assert.ok(res.confidence >= 0.8, 'Must have high confidence for distinctive Marathi verb');
    });

    test('correctly distinguishes Hindi Devanagari input', () => {
      const res = detector.detect('प्रोजेक्ट की स्थिति बताओ');
      assert.equal(res.language, 'hi');
      assert.ok(res.confidence >= 0.8);
    });

    test('correctly identifies standard English', () => {
      const res = detector.detect('Show me all overdue tasks');
      assert.equal(res.language, 'en');
      assert.ok(res.confidence >= 0.9);
    });

    test('treats ambiguous Devanagari tokens with low confidence (< 0.7) to prevent preference poisoning', () => {
      // "अनलिटिक्स" has no distinctive Hindi or Marathi lexical tokens
      const res = detector.detect('अनलिटिक्स');
      assert.ok(res.confidence < 0.7, 'Ambiguous Devanagari input must not yield high confidence');
    });

    test('preserves established context language across consecutive turns', () => {
      // First turn establishes Marathi
      const res1 = detector.detect('सर्व कामे दाखवा', 'mr');
      assert.equal(res1.language, 'mr');

      // Ambiguous second turn preserves Marathi context
      const res2 = detector.detect('प्रकल्प', 'mr');
      assert.equal(res2.language, 'mr', 'Must preserve established Marathi context');
    });
  });

  // =========================================================================
  // 2. E1: Language Preference Persistence in Orchestrator
  // =========================================================================
  describe('2. Language Preference Persistence in Orchestrator', () => {
    test('ambiguous Devanagari turn does NOT poison persistent preferredLanguage to Hindi', async () => {
      const testOrch = new AssistantOrchestrator(client);
      assert.equal(testOrch.memory.preferredLanguage, 'en', 'Initial preferred language must be English');

      // Process an ambiguous Devanagari input
      await testOrch.process('अनलिटिक्स');

      // Preferred language must still be English (NOT poisoned to Hindi)
      assert.equal(testOrch.memory.preferredLanguage, 'en', 'Ambiguous input must not poison preference to Hindi');
    });

    test('distinctive Marathi turn ("DevPulse Analytics तपासा") updates preference to Marathi', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('DevPulse Analytics तपासा');

      assert.equal(outcome.workflow, 'project_investigation');
      assert.equal(testOrch.memory.preferredLanguage, 'mr', 'Distinctive Marathi input must establish Marathi preference');
      assert.ok(
        outcome.explanation.includes('तपासणी') ||
        outcome.explanation.includes('आरोग्य दर्जा') ||
        outcome.explanation.includes('नोंदणीकृत कामे'),
        'Must format investigation in Marathi'
      );
    });
  });

  // =========================================================================
  // 3. E2: Conceptual Explanations (BUG-08)
  // =========================================================================
  describe('3. Conceptual Explanations (BUG-08)', () => {
    test('"Explain MCP in simple English." returns conceptual architecture explanation with zero mutations', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('Explain MCP in simple English.');

      assert.equal(outcome.workflow, 'explain_concept');
      assert.equal(outcome.toolCalls.length, 0, 'Conceptual explanations must make zero tool calls');
      assert.ok(outcome.explanation.includes('Model Context Protocol (MCP) in Simple English'));
      assert.ok(outcome.explanation.includes('Tool Discovery'));
      assert.ok(outcome.explanation.includes('Safe Tool Calling'));
      assert.ok(outcome.explanation.includes('Context Sharing'));
    });

    test('"Explain Streamable HTTP" explains transport protocol details', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('Explain Streamable HTTP');

      assert.equal(outcome.workflow, 'explain_concept');
      assert.equal(outcome.toolCalls.length, 0);
      assert.ok(outcome.explanation.includes('Streamable HTTP Transport'));
      assert.ok(outcome.explanation.includes('POST /mcp'));
      assert.ok(outcome.explanation.includes('GET /mcp'));
    });

    test('"Explain ProjectPilot architecture" outlines system components', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('Explain ProjectPilot architecture');

      assert.equal(outcome.workflow, 'explain_concept');
      assert.ok(outcome.explanation.includes('ProjectPilot AI Architecture Overview'));
      assert.ok(outcome.explanation.includes('MCP Streamable HTTP Gateway'));
      assert.ok(outcome.explanation.includes('Natural Intelligence Pipeline'));
    });
  });

  // =========================================================================
  // 4. E2: Priority Scoring Formula Explanations
  // =========================================================================
  describe('4. Priority Scoring Formula Explanations', () => {
    test('"Explain the daily-priority scoring formula." details exact formula without listing tasks', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('Explain the daily-priority scoring formula.');

      assert.equal(outcome.workflow, 'explain_formula');
      assert.equal(outcome.toolCalls.length, 0, 'Formula explanation must NOT invoke task listing tools');
      assert.ok(outcome.explanation.includes('Daily Priority Scoring Formula'));
      assert.ok(outcome.explanation.includes('`Critical`: **+40 pts**'));
      assert.ok(outcome.explanation.includes('`High`: **+30 pts**'));
      assert.ok(outcome.explanation.includes('`isBug`') && outcome.explanation.includes('+15 pts'));
      assert.ok(outcome.explanation.includes('Overdue: **+25 pts**'));
      assert.ok(outcome.explanation.includes('Active blocker penalty: **-20 pts**'));
    });
  });

  // =========================================================================
  // 5. E2: Contextual Language Follow-up ("Explain this in Marathi")
  // =========================================================================
  describe('5. Contextual Language Follow-up ("Explain this in Marathi")', () => {
    test('"Explain this in Marathi" after investigation translates findings into Marathi', async () => {
      const testOrch = new AssistantOrchestrator(client);

      // Turn 1: Investigate project
      await testOrch.process('Investigate project OmniCloud Platform');
      assert.ok(testOrch.memory.lastInvestigation);

      // Turn 2: Follow up with language change
      const outcome = await testOrch.process('Explain this in Marathi');
      assert.equal(outcome.workflow, 'investigation_findings_summary');
      assert.ok(
        outcome.explanation.includes('तपासणी निष्कर्ष') ||
        outcome.explanation.includes('आरोग्य दर्जा') ||
        outcome.explanation.includes('सक्रिय अडथळे'),
        'Must render findings in Marathi'
      );
      assert.ok(outcome.explanation.includes('OmniCloud Platform'));
    });
  });

  // =========================================================================
  // 6. E3: Task Discovery (FIND_TASK)
  // =========================================================================
  describe('6. Task Discovery (FIND_TASK)', () => {
    test('finds task by title substring using list_tasks without mutations', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('Find task Redis connection pool leak');

      assert.equal(outcome.workflow, 'find_task');
      assert.equal(outcome.toolCalls.length, 1);
      assert.equal(outcome.toolCalls[0].name, 'list_tasks');
      assert.ok(outcome.explanation.includes('Fix Redis connection pool leak'));
      assert.ok(outcome.explanation.includes('CRITICAL'));
    });

    test('returns clear not-found message when searching nonexistent task', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('Find task completely nonexistent task 9999');

      assert.equal(outcome.workflow, 'find_task');
      assert.ok(outcome.explanation.includes('No task matching'));
      assert.ok(outcome.explanation.includes('completely nonexistent task 9999'));
    });

    test('prompts for title when generic "find a task by its title" is sent without query', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('find a task by its title');

      assert.equal(outcome.workflow, 'find_task');
      assert.ok(outcome.explanation.includes('Please provide the task title or identifier'));
    });
  });

  // =========================================================================
  // 7. E4: Priority Ranking Correctness & Blocker Penalty (BUG-09)
  // =========================================================================
  describe('7. Priority Ranking Correctness & Blocker Penalty (BUG-09)', () => {
    test('blocked task receives -20 blocker penalty, elevating executable alternative to top', async () => {
      const recs = priorityService.getRecommendations({ projectId: projId });
      assert.ok(recs.recommendations.length >= 2);

      const blockedTask = recs.recommendations.find(r => r.title.includes('Redis connection pool leak'));
      const readyTask = recs.recommendations.find(r => r.title.includes('Optimize API rate limiter token bucket'));

      assert.ok(blockedTask, 'Must evaluate blocked task');
      assert.ok(readyTask, 'Must evaluate ready task');

      // Verify blocked task has penalty in reasons
      assert.ok(blockedTask.reasons.some(r => r.includes('-20 pts')));
      assert.equal(blockedTask.executionReadiness, 'Blocked — Unblocking Required');

      // Ready task (High +30 + active proj +10 + in_progress +8 = 48)
      // Blocked task (Critical +40 + active proj +10 - 20 blocker = 30)
      // Therefore ready task must rank HIGHER than blocked task
      assert.ok(
        readyTask.score > blockedTask.score,
        `Ready task score (${readyTask.score}) must exceed blocked task score (${blockedTask.score})`
      );
    });

    test('daily priorities workflow highlights immediate focus on executable task', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('What should I work on today?');

      assert.equal(outcome.workflow, 'daily_priorities');
      assert.ok(outcome.explanation.includes('🎯 **Immediate Focus:**'));
      assert.ok(outcome.explanation.includes('Readiness: Ready'));
    });

    test('deterministic tie-breaking: identical scores sort by earliest due date, then task ID', () => {
      const dateEarlier = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
      const dateLater = new Date(Date.now() + 21 * 86400000).toISOString().split('T')[0];

      const mockStore = {
        listTasks: () => [
          { id: 'task-b', title: 'Task B', projectId: 'p1', priority: 'medium', dueDate: dateLater, status: 'todo' },
          { id: 'task-a', title: 'Task A', projectId: 'p1', priority: 'medium', dueDate: dateEarlier, status: 'todo' },
          { id: 'task-c', title: 'Task C', projectId: 'p1', priority: 'medium', dueDate: dateEarlier, status: 'todo' }
        ],
        listProjects: () => [{ id: 'p1', name: 'Project 1', status: 'active' }]
      };

      const testPriority = new PriorityService(mockStore);
      const recs = testPriority.getRecommendations({ limit: 3 });

      assert.equal(recs.recommendations.length, 3);
      // All 3 have identical score (medium 20 + active 10 = 30)
      assert.equal(recs.recommendations[0].score, 30);
      assert.equal(recs.recommendations[1].score, 30);
      assert.equal(recs.recommendations[2].score, 30);

      // task-a and task-c both have due date 2026-11-05 (earlier than task-b 2026-11-10)
      // Between task-a and task-c, task-a comes first due to lexicographical task ID tie-breaking!
      assert.equal(recs.recommendations[0].taskId, 'task-a');
      assert.equal(recs.recommendations[1].taskId, 'task-c');
      assert.equal(recs.recommendations[2].taskId, 'task-b');
    });

    test('all-blocked scenario clearly states that no executable task is available', async () => {
      // Mock store where every single task is blocked
      const allBlockedStore = {
        listTasks: () => [
          { id: 't-1', title: 'Blocked Task 1', projectId: 'p1', priority: 'critical', status: 'blocked', blocker: 'Wait on team' },
          { id: 't-2', title: 'Blocked Task 2', projectId: 'p1', priority: 'high', status: 'blocked', blocker: 'Wait on vendor' }
        ],
        listProjects: () => [{ id: 'p1', name: 'Project 1', status: 'active' }]
      };

      const customOrch = new AssistantOrchestrator({
        callTool: async (name) => {
          if (name === 'get_priority_recommendations') {
            const p = new PriorityService(allBlockedStore);
            return { data: p.getRecommendations() };
          }
          if (name === 'list_blockers') {
            return { data: { blockerCount: 2 } };
          }
          return { data: {} };
        }
      });

      const outcome = await customOrch.process('What should I work on today?');
      assert.equal(outcome.workflow, 'daily_priorities');
      assert.ok(outcome.explanation.includes('All recommended pending tasks are currently blocked'));
      assert.ok(outcome.explanation.includes('No executable tasks are immediately available'));
    });
  });
});
