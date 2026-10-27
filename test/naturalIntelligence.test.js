/**
 * ProjectPilot AI - Natural Intelligence & Multilingual Understanding Test Suite
 * Validates conversational context memory, spelling normalization, technical token shielding,
 * multilingual understanding (English, Hindi, Marathi, Hinglish, Marathiglish),
 * anaphora resolution, evidence-based responses, and execution-mode safety.
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
  SpellingNormalizer,
  damerauLevenshtein,
  LanguageDetector,
  ConversationMemory,
  IntentClassifier,
  NaturalResponseEngine,
  LocalNaturalIntelligenceEngine
} from '../public/js/orchestrator.js';

describe('ProjectPilot AI - Natural Intelligence & Multilingual Understanding', () => {
  let tempDir;
  let serverInstance;
  let client;
  let orchestrator;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-nlu-test-'));
    const storePath = path.join(tempDir, 'nlu-test-store.json');
    serverInstance = await createServer({ storePath, extendedTools: true });
    const addr = await serverInstance.start(0);

    const mcpUrl = `http://localhost:${addr.port}/mcp`;
    client = new McpBrowserClient(mcpUrl);
    await client.connect();
    orchestrator = new AssistantOrchestrator(client);

    // Seed ImperialStay with an active task and blocker for scenario validation
    const p1 = await client.callTool('create_project', {
      name: 'ImperialStay',
      description: 'Luxury hotel booking and hospitality platform',
      category: 'Hospitality',
      techStack: ['React', 'Node.js', 'PostgreSQL'],
      priority: 'high'
    });
    const impProjId = p1.data?.project?.id;
    await client.callTool('create_task', {
      projectId: impProjId,
      title: 'Fix checkout payment gateway failure',
      status: 'blocked',
      priority: 'critical',
      blocker: 'PostgreSQL migration timeout on payments table'
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
  // SUB-SUITE 1: Spelling Normalization & Technical Token Shielding
  // =========================================================================
  describe('1. Spelling Normalization & Technical Token Shielding', () => {
    const normalizer = new SpellingNormalizer();

    test('Corrects common developer contractions and typos', () => {
      const res = normalizer.normalize('wht is the stat of my pendng tast');
      assert.ok(res.normalized.includes('what'));
      assert.ok(res.normalized.includes('status'));
      assert.ok(res.normalized.includes('pending'));
      assert.ok(res.normalized.includes('task'));
    });

    test('Damerau-Levenshtein calculation accurately measures distance and transposition', () => {
      assert.equal(damerauLevenshtein('project', 'project'), 0);
      assert.equal(damerauLevenshtein('eror', 'error'), 1); // deletion
      assert.equal(damerauLevenshtein('tast', 'task'), 1); // substitution
      assert.equal(damerauLevenshtein('proejct', 'project'), 1); // transposition
    });

    test('Strictly preserves technical identifiers, IDs, code, and URLs', () => {
      const input = 'fix eror in proj-123 and test func() at https://github.com/org/repo';
      const res = normalizer.normalize(input);
      assert.ok(res.normalized.includes('error'), 'Typo "eror" should be corrected to "error"');
      assert.ok(res.normalized.includes('proj-123'), 'Project ID "proj-123" must be preserved exactly');
      assert.ok(res.normalized.includes('func()'), 'Code token "func()" must be preserved exactly');
      assert.ok(res.normalized.includes('https://github.com/org/repo'), 'URL must be preserved exactly');
    });
  });

  // =========================================================================
  // SUB-SUITE 2: Multilingual Language Detection
  // =========================================================================
  describe('2. Multilingual Language Detection', () => {
    const detector = new LanguageDetector();

    test('Detects standard English inputs', () => {
      const res = detector.detect('What should I work on today?');
      assert.equal(res.language, 'en');
    });

    test('Detects Romanized Hindi and Hinglish inputs', () => {
      const res1 = detector.detect('mera project ka status batao');
      assert.ok(['hi', 'hinglish'].includes(res1.language));

      const res2 = detector.detect('aaj kya karna hai');
      assert.ok(['hi', 'hinglish'].includes(res2.language));
    });

    test('Detects Romanized Marathi and Marathiglish inputs', () => {
      const res1 = detector.detect('majha app open hot nahi');
      assert.ok(['mr', 'marathiglish'].includes(res1.language));

      const res2 = detector.detect('aaj kay karu');
      assert.ok(['mr', 'marathiglish'].includes(res2.language));
    });

    test('Detects Devanagari script for Hindi and Marathi', () => {
      const resHindi = detector.detect('प्रोजेक्ट का स्टेटस बताओ');
      assert.equal(resHindi.language, 'hi');
      assert.equal(resHindi.script, 'devanagari');

      const resMarathi = detector.detect('माझा ॲप सुरू होत नाही');
      assert.equal(resMarathi.language, 'mr');
      assert.equal(resMarathi.script, 'devanagari');
    });

    test('Detects explicit language switch commands ("explain this error in simple marathi")', () => {
      const res = detector.detect('explain this error in simple marathi');
      assert.equal(res.isSwitchCommand, true);
      assert.equal(res.requestedLanguage, 'mr');
    });
  });

  // =========================================================================
  // SUB-SUITE 3: Context Memory & Anaphora Resolution
  // =========================================================================
  describe('3. Context Memory & Anaphora Resolution', () => {
    test('Tracks active project and resolves project anaphora', () => {
      const memory = new ConversationMemory();
      memory.setActiveProject({ id: 'proj-omega', name: 'Omega Cloud' });

      const anaphora = memory.resolveAnaphora('What is the status of this project?');
      assert.equal(anaphora.isFollowUp, true);
      assert.equal(anaphora.anaphoraType, 'PROJECT_REF');
      assert.equal(anaphora.resolvedProject?.id, 'proj-omega');
    });

    test('Resolves action anaphora ("same issue fix karo", "fix it")', () => {
      const memory = new ConversationMemory();
      memory.setActiveProject({ id: 'proj-omega', name: 'Omega Cloud' });
      memory.lastErrorOrBlocker = { text: 'Connection timeout', taskId: 'task-1' };

      const anaphora = memory.resolveAnaphora('same issue fix karo');
      assert.equal(anaphora.isFollowUp, true);
      assert.equal(anaphora.anaphoraType, 'ACTION_FIX');
      assert.equal(anaphora.resolvedProject?.id, 'proj-omega');
      assert.equal(anaphora.resolvedError?.text, 'Connection timeout');
    });

    test('Resolves findings follow-up anaphora ("What did you find?")', () => {
      const memory = new ConversationMemory();
      memory.recordInvestigation({
        project: { id: 'proj-omega', name: 'Omega Cloud' },
        health: { healthStatus: 'At Risk' },
        blockers: [{ id: 'b-1', blockerReason: 'Migration failed' }]
      });

      const anaphora = memory.resolveAnaphora('What did you find? Explain it in English.');
      assert.equal(anaphora.isFollowUp, true);
      assert.equal(anaphora.anaphoraType, 'FINDINGS_REF');
      assert.equal(anaphora.resolvedProject?.id, 'proj-omega');
    });
  });

  // =========================================================================
  // SUB-SUITE 4: Zero-Cost Local Natural Intelligence Model Provider
  // =========================================================================
  describe('4. Local Natural Intelligence Model Provider', () => {
    test('Provides 100% offline, zero-cost deterministic analysis', async () => {
      const provider = new LocalNaturalIntelligenceEngine();
      assert.equal(provider.providerName, 'local-natural-intelligence');

      const response = await provider.generateResponse({
        intent: 'INVESTIGATE_PROJECT',
        query: 'Investigate DevPulse Analytics',
        context: { project: { name: 'DevPulse Analytics' } },
        language: 'en'
      });

      assert.equal(response.provider, 'local-natural-intelligence');
      assert.equal(response.isExternalLlm, false);
      assert.ok(response.content.length > 0);
    });
  });

  // =========================================================================
  // SUB-SUITE 5: The 12 Explicit Verification Scenarios
  // =========================================================================
  describe('5. The 12 Mandatory Natural Intelligence Scenarios', () => {

    test('Scenario 1: "fix eror in my project" handles typo and ambiguous target gracefully', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('fix eror in my project');

      assert.equal(outcome.workflow, 'ambiguous_action');
      assert.ok(outcome.explanation.includes('Clarification Needed') || outcome.explanation.includes('Which project'));
      assert.ok(Array.isArray(outcome.clarificationOptions));
      assert.ok(outcome.clarificationOptions.length > 0, 'Must provide available projects as clarification choices');
    });

    test('Scenario 2: "why app not working" handles informal diagnostic speech', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('why app not working');

      assert.equal(outcome.workflow, 'ambiguous_diagnostic');
      assert.ok(outcome.explanation.includes('Clarification Needed') || outcome.explanation.includes('specify which project'));
      assert.ok(Array.isArray(outcome.clarificationOptions));
    });

    test('Scenario 3: "check my projects pending task" handles typos and routes to remaining work', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('check my projects pending task');

      assert.equal(outcome.workflow, 'remaining_work');
      assert.ok(outcome.explanation.includes('Remaining Work Summary'));
      assert.ok(outcome.toolCalls.some(tc => tc.name === 'list_tasks'));
    });

    test('Scenario 4: "majha app open hot nahi" provides Marathi diagnostic response', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('majha app open hot nahi');

      assert.equal(outcome.workflow, 'ambiguous_diagnostic');
      assert.ok(
        outcome.explanation.includes('स्पष्टीकरण') ||
        outcome.explanation.includes('प्रोजेक्ट') ||
        outcome.explanation.includes('निवडा'),
        'Must respond with Marathi guidance'
      );
    });

    test('Scenario 5: "mera project ka status batao" provides Hindi project guidance', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('mera project ka status batao');

      assert.equal(outcome.workflow, 'ambiguous_diagnostic');
      assert.ok(
        outcome.explanation.includes('स्पष्ट करें') ||
        outcome.explanation.includes('प्रोजेक्ट') ||
        outcome.explanation.includes('स्थिति'),
        'Must respond with Hindi guidance'
      );
    });

    test('Scenario 6: "explain this error in simple marathi" explains blocker in simple Marathi', async () => {
      const testOrch = new AssistantOrchestrator(client);
      // Pre-seed an active project with a blocker
      await testOrch.process('Investigate project ImperialStay');

      const outcome = await testOrch.process('explain this error in simple marathi');
      assert.equal(outcome.workflow, 'explain_error');
      assert.ok(outcome.explanation.includes('स्पष्टीकरण') || outcome.explanation.includes('एरर'), 'Must provide Marathi explanation');
      assert.ok(outcome.explanation.includes('उपाय') || outcome.explanation.includes('कारण'), 'Must include root cause or fix in Marathi');
    });

    test('Scenario 7: "Investigate project ImperialStay" resolves project and records in memory', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('Investigate project ImperialStay');

      assert.equal(outcome.workflow, 'project_investigation');
      assert.ok(outcome.explanation.includes('### Project Health & Intelligence Report: ImperialStay'));
      assert.ok(outcome.explanation.includes('[Verified from project records]'));

      // Verify stored in conversational memory
      assert.ok(testOrch.memory.activeProject);
      assert.equal(testOrch.memory.activeProject.name, 'ImperialStay');
      assert.ok(testOrch.memory.lastInvestigation);
    });

    test('Scenario 8: Multi-turn Turn 2 — "What did you find? Explain it in English."', async () => {
      const testOrch = new AssistantOrchestrator(client);
      // Turn 1
      await testOrch.process('Investigate project ImperialStay');

      // Turn 2
      const outcome = await testOrch.process('What did you find? Explain it in English.');
      assert.equal(outcome.workflow, 'investigation_findings_summary');
      assert.ok(outcome.explanation.includes('Investigation Findings: **ImperialStay**'));
      assert.ok(outcome.explanation.includes('Verified Evidence:'));
    });

    test('Scenario 9: Multi-turn Turn 3 — "same issue fix karo" respects APPROVE mode and requires approval', async () => {
      const testOrch = new AssistantOrchestrator(client);
      testOrch.setExecutionMode('APPROVE');

      // Turn 1: Investigate project
      await testOrch.process('Investigate project ImperialStay');

      // Turn 2: Summarize findings
      await testOrch.process('What did you find? Explain it in English.');

      // Turn 3: "same issue fix karo"
      const outcome = await testOrch.process('same issue fix karo');
      assert.equal(outcome.workflow, 'manage_blocker_plan');
      assert.ok(outcome.explanation.includes('APPROVE Mode'));
      assert.ok(outcome.explanation.includes('Proposed Blocker Resolution'));
      assert.ok(outcome.explanation.includes('Action requires explicit confirmation'));
      assert.equal(outcome.toolCalls.length, 0, 'Must NOT execute mutation without explicit user confirmation');
    });

    test('Scenario 10: Ambiguous request triggers structured interactive clarification', async () => {
      const testOrch = new AssistantOrchestrator(client);
      const outcome = await testOrch.process('fix issue');

      assert.equal(outcome.workflow, 'ambiguous_action');
      assert.ok(Array.isArray(outcome.clarificationOptions));
      assert.ok(outcome.clarificationOptions.length > 0);
    });

    test('Scenario 11: Project query with 0 tasks reports Insufficient Data and never claims healthy', async () => {
      const testOrch = new AssistantOrchestrator(client);
      // Create project with 0 tasks
      const newProjRes = await client.callTool('create_project', {
        name: 'Empty Test Project For Audit',
        category: 'Experimental',
        priority: 'low'
      });
      const createdProjId = newProjRes.data?.project?.id;
      assert.ok(createdProjId);

      const outcome = await testOrch.process(`Investigate project ${createdProjId}`);
      assert.equal(outcome.workflow, 'project_investigation');
      assert.ok(outcome.explanation.includes('[Insufficient data]'));
      assert.ok(outcome.explanation.includes('Total Tasks: 0'));
      assert.ok(!outcome.explanation.includes('Derived Health: **Healthy**'), 'Must never claim 0-task project is Healthy');
    });

    test('Scenario 12: Action requiring explicit approval cannot mutate in APPROVE or ASK mode', async () => {
      const testOrch = new AssistantOrchestrator(client);
      testOrch.setExecutionMode('ASK');

      // Attempting to complete a task in ASK mode
      const tasksRes = await client.callTool('list_tasks', {});
      const openTask = tasksRes.data?.tasks?.find(t => t.status !== 'done');
      if (openTask) {
        const askOutcome = await testOrch.process(`complete task ${openTask.id}`);
        assert.equal(askOutcome.workflow, 'complete_task_plan');
        assert.ok(askOutcome.explanation.includes('ASK Mode'));
        assert.ok(!askOutcome.toolCalls.some(tc => tc.name === 'update_task_status'), 'ASK mode must never execute update_task_status');
      }
    });
  });
});
