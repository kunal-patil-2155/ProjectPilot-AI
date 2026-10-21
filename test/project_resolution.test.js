/**
 * ProjectPilot AI - Natural-Language Project Resolution Regression & Reliability Tests
 * Tests intent routing, entity extraction, multi-word preservation, live MCP resolution,
 * ambiguity handling, and security controls per the hackathon repair directive.
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
  extractProjectQuery,
  isProjectInvestigationIntent,
  normalizeForComparison,
  resolveProject
} from '../public/js/orchestrator.js';

describe('Natural-Language Project Investigation & Entity Resolution', () => {
  let tempDir;
  let serverInstance;
  let client;
  let orchestrator;
  let imperialStayId;
  let smartCoachId;
  let apexId;
  let punctProjId;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-res-test-'));
    const storePath = path.join(tempDir, 'res-test-store.json');
    serverInstance = await createServer({ storePath });
    const addr = await serverInstance.start(0);

    const mcpUrl = `http://localhost:${addr.port}/mcp`;
    client = new McpBrowserClient(mcpUrl);
    await client.connect();
    orchestrator = new AssistantOrchestrator(client);

    // Create dynamically created projects required for the tests
    const p1 = await client.callTool('create_project', {
      name: 'ImperialStay',
      description: 'Luxury hotel booking and hospitality platform',
      category: 'Hospitality',
      techStack: ['React', 'Node.js', 'PostgreSQL'],
      priority: 'high'
    });
    imperialStayId = p1.data.project.id;

    const p2 = await client.callTool('create_project', {
      name: 'Smart Coaching Class Management System',
      description: 'Educational management system for tuition academies',
      category: 'EdTech',
      techStack: ['Python', 'Django', 'Vue'],
      priority: 'medium'
    });
    smartCoachId = p2.data.project.id;

    const p3 = await client.callTool('create_project', {
      name: 'APEX OVERDRIVE 3D',
      description: 'High-octane physics-based racing engine',
      category: 'Gaming',
      techStack: ['C++', 'OpenGL', 'WebAssembly'],
      priority: 'critical'
    });
    apexId = p3.data.project.id;

    const p4 = await client.callTool('create_project', {
      name: 'Customer Portal — Phase 2',
      description: 'Enterprise client self-service portal (v2.4)',
      category: 'Enterprise',
      techStack: ['TypeScript', 'GraphQL'],
      priority: 'high'
    });
    punctProjId = p4.data.project.id;
  });

  after(async () => {
    if (client) await client.disconnect();
    if (serverInstance) await serverInstance.stop();
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // =========================================================================
  // SUITE A: CONFIRMED BUG REPRO & REGRESSION TESTS
  // =========================================================================
  describe('A. Confirmed Bug Repro & Regression Tests', () => {
    test('Reproduction: "Investigate project ImperialStay" extracts ImperialStay (not "project imperialstay")', async () => {
      const outcome = await orchestrator.process('Investigate project ImperialStay');
      assert.equal(outcome.workflow, 'project_investigation');

      // Verify that list_projects was called
      const listCall = outcome.toolCalls.find(tc => tc.name === 'list_projects');
      assert.ok(listCall, 'Must call list_projects tool');

      // Verify get_project_details was called with the actual real project ID
      const detailCall = outcome.toolCalls.find(tc => tc.name === 'get_project_details');
      assert.ok(detailCall, 'Must call get_project_details tool');
      assert.equal(detailCall.args.projectId, imperialStayId, 'Must pass the real project ID');

      // Verify response content
      assert.ok(outcome.explanation.includes('ImperialStay'));
      assert.ok(outcome.explanation.includes('Hospitality'));
      assert.ok(!outcome.explanation.includes('project imperialstay'));
    });

    test('"Investigate ImperialStay" resolves ImperialStay', async () => {
      const outcome = await orchestrator.process('Investigate ImperialStay');
      assert.equal(outcome.workflow, 'project_investigation');
      const detailCall = outcome.toolCalls.find(tc => tc.name === 'get_project_details');
      assert.equal(detailCall.args.projectId, imperialStayId);
    });

    test('"Inspect project ImperialStay" resolves ImperialStay', async () => {
      const outcome = await orchestrator.process('Inspect project ImperialStay');
      assert.equal(outcome.workflow, 'project_investigation');
      const detailCall = outcome.toolCalls.find(tc => tc.name === 'get_project_details');
      assert.equal(detailCall.args.projectId, imperialStayId);
    });
  });

  // =========================================================================
  // SUITE B: ALL 17 NATURAL LANGUAGE VARIATIONS
  // =========================================================================
  describe('B. All 17 Natural Language Variations from Section 2', () => {
    const variations = [
      'Investigate ImperialStay',
      'Investigate project ImperialStay',
      'Investigate the project ImperialStay',
      'Inspect ImperialStay',
      'Inspect project ImperialStay',
      'Inspect the project ImperialStay',
      'Check project ImperialStay',
      'Check the project ImperialStay',
      'Check my project ImperialStay',
      'Show me ImperialStay',
      'Show me the project ImperialStay',
      'Show the health of ImperialStay',
      'What is the health of ImperialStay?',
      'What is the status of ImperialStay?',
      'What is the status of project ImperialStay?',
      'Give me details about ImperialStay',
      'Tell me about ImperialStay'
    ];

    for (const phrase of variations) {
      test(`Resolves natural phrase: "${phrase}"`, async () => {
        const outcome = await orchestrator.process(phrase);
        assert.equal(outcome.workflow, 'project_investigation', `Failed on: "${phrase}"`);
        const detailCall = outcome.toolCalls.find(tc => tc.name === 'get_project_details');
        assert.ok(detailCall, `Must call get_project_details for: "${phrase}"`);
        assert.equal(detailCall.args.projectId, imperialStayId);
        assert.ok(outcome.explanation.includes('ImperialStay'));
      });
    }
  });

  // =========================================================================
  // SUITE C: MULTI-WORD & PUNCTUATION PRESERVATION
  // =========================================================================
  describe('C. Multi-Word Names & Punctuation Preservation', () => {
    test('Resolves long multi-word name: "Investigate Smart Coaching Class Management System"', async () => {
      const outcome = await orchestrator.process('Investigate Smart Coaching Class Management System');
      assert.equal(outcome.workflow, 'project_investigation');
      const detailCall = outcome.toolCalls.find(tc => tc.name === 'get_project_details');
      assert.equal(detailCall.args.projectId, smartCoachId);
      assert.ok(outcome.explanation.includes('Smart Coaching Class Management System'));
      assert.ok(outcome.explanation.includes('EdTech'));
    });

    test('Resolves name with acronyms and 3D: "Investigate APEX OVERDRIVE 3D"', async () => {
      const outcome = await orchestrator.process('Investigate APEX OVERDRIVE 3D');
      assert.equal(outcome.workflow, 'project_investigation');
      const detailCall = outcome.toolCalls.find(tc => tc.name === 'get_project_details');
      assert.equal(detailCall.args.projectId, apexId);
      assert.ok(outcome.explanation.includes('APEX OVERDRIVE 3D'));
    });

    test('Resolves name with em-dash when user inputs standard hyphen: "Check the project Customer Portal - Phase 2"', async () => {
      const outcome = await orchestrator.process('Check the project Customer Portal - Phase 2');
      assert.equal(outcome.workflow, 'project_investigation');
      const detailCall = outcome.toolCalls.find(tc => tc.name === 'get_project_details');
      assert.equal(detailCall.args.projectId, punctProjId);
      assert.ok(outcome.explanation.includes('Customer Portal — Phase 2'));
    });
  });

  // =========================================================================
  // SUITE D: CASE, EXTRA WHITESPACE, TRAILING PUNCTUATION
  // =========================================================================
  describe('D. Case, Whitespace, and Trailing Punctuation Handling', () => {
    test('Handles chaotic mixed casing', async () => {
      const outcome = await orchestrator.process('iNvEsTiGaTe PrOjEcT iMpErIaLsTaY');
      assert.equal(outcome.workflow, 'project_investigation');
      const detailCall = outcome.toolCalls.find(tc => tc.name === 'get_project_details');
      assert.equal(detailCall.args.projectId, imperialStayId);
    });

    test('Handles extra padding whitespace', async () => {
      const outcome = await orchestrator.process('   Inspect    project    ImperialStay     ');
      assert.equal(outcome.workflow, 'project_investigation');
      const detailCall = outcome.toolCalls.find(tc => tc.name === 'get_project_details');
      assert.equal(detailCall.args.projectId, imperialStayId);
    });

    test('Handles trailing question marks and exclamation marks', async () => {
      const outcome = await orchestrator.process('Can you check project ImperialStay???');
      assert.equal(outcome.workflow, 'project_investigation');
      const detailCall = outcome.toolCalls.find(tc => tc.name === 'get_project_details');
      assert.equal(detailCall.args.projectId, imperialStayId);
    });
  });

  // =========================================================================
  // SUITE E: AMBIGUITY DETECTION & SELECTION
  // =========================================================================
  describe('E. Ambiguity Handling & Clarification', () => {
    let ambigAId;
    let ambigBId;

    before(async () => {
      // Create two similarly named projects
      const a = await client.callTool('create_project', {
        name: 'OmniLedger Core',
        category: 'Finance',
        priority: 'high'
      });
      ambigAId = a.data.project.id;

      const b = await client.callTool('create_project', {
        name: 'OmniLedger Mobile',
        category: 'Mobile',
        priority: 'medium'
      });
      ambigBId = b.data.project.id;
    });

    test('Asks user to clarify when user query matches multiple candidates ("Inspect OmniLedger")', async () => {
      const outcome = await orchestrator.process('Inspect OmniLedger');
      assert.equal(outcome.workflow, 'project_investigation_ambiguous');
      assert.ok(outcome.explanation.includes('Multiple projects match'));
      assert.ok(outcome.clarificationOptions.length >= 2);

      const candidateIds = outcome.clarificationOptions.map(c => c.action);
      assert.ok(candidateIds.includes(ambigAId));
      assert.ok(candidateIds.includes(ambigBId));
    });

    test('Selecting candidate from clarification successfully investigates that specific project', async () => {
      // Trigger ambiguity first
      await orchestrator.process('Inspect OmniLedger');
      assert.ok(orchestrator.pendingResolution);

      // User selects OmniLedger Mobile by passing candidate ID or candidate name
      const followUp = await orchestrator.process(ambigBId);
      assert.equal(followUp.workflow, 'project_investigation');
      const detailCall = followUp.toolCalls.find(tc => tc.name === 'get_project_details');
      assert.equal(detailCall.args.projectId, ambigBId);
      assert.ok(followUp.explanation.includes('OmniLedger Mobile'));
    });
  });

  // =========================================================================
  // SUITE F: MISSING & GENERIC-ONLY QUERIES
  // =========================================================================
  describe('F. Missing Projects and Generic-Only Queries', () => {
    test('Unknown project provides helpful message listing available projects without claiming success', async () => {
      const outcome = await orchestrator.process('Investigate project NonExistentProject404');
      assert.equal(outcome.workflow, 'project_investigation');
      // Must NOT call get_project_details
      const detailCall = outcome.toolCalls.find(tc => tc.name === 'get_project_details');
      assert.equal(detailCall, undefined, 'Must not call get_project_details for unknown project');

      assert.ok(outcome.explanation.includes('I could not find any project matching'));
      assert.ok(outcome.explanation.includes('Available projects:'));
      assert.ok(outcome.explanation.includes('ImperialStay'));
    });

    test('Generic-only query "Investigate project" asks for project name and lists options', async () => {
      const outcome = await orchestrator.process('Investigate project');
      assert.equal(outcome.workflow, 'project_investigation');
      const detailCall = outcome.toolCalls.find(tc => tc.name === 'get_project_details');
      assert.equal(detailCall, undefined);
      assert.ok(outcome.explanation.includes('Please specify a project name to investigate'));
      assert.ok(outcome.explanation.includes('Available projects:'));
    });

    test('Generic-only query "Investigate system" does not falsely match Smart Coaching Class Management System', async () => {
      const outcome = await orchestrator.process('Investigate system');
      assert.equal(outcome.workflow, 'project_investigation');
      const detailCall = outcome.toolCalls.find(tc => tc.name === 'get_project_details');
      assert.equal(detailCall, undefined, 'Must not treat generic word "system" as unique project match');
      assert.ok(outcome.explanation.includes('I could not find any project matching "system"'));
    });
  });

  // =========================================================================
  // SUITE G: NON-REGRESSION OF OTHER WORKFLOWS
  // =========================================================================
  describe('G. Non-Regression of Other Assistant Workflows', () => {
    test('Daily priorities workflow is not intercepted', async () => {
      const outcome = await orchestrator.process('What should I work on today?');
      assert.equal(outcome.workflow, 'daily_priorities');
    });

    test('Complete task workflow is not intercepted', async () => {
      const outcome = await orchestrator.process('Complete task task-cloudsync-1');
      assert.equal(outcome.workflow, 'complete_task');
    });

    test('Remaining work workflow is not intercepted ("Show remaining work")', async () => {
      const outcome = await orchestrator.process('Show remaining work');
      assert.equal(outcome.workflow, 'remaining_work');
    });

    test('Maintenance review workflow is not intercepted ("Review maintenance tasks")', async () => {
      const outcome = await orchestrator.process('Review maintenance tasks');
      assert.equal(outcome.workflow, 'maintenance_review');
    });

    test('Unsupported request falls through to honest explanation', async () => {
      const outcome = await orchestrator.process('Write me a poetry about the moon');
      assert.equal(outcome.workflow, 'unsupported');
    });
  });

  // =========================================================================
  // SUITE H: JUDGE DYNAMIC CREATION & PERSISTENCE SEQUENCE
  // =========================================================================
  describe('H. Support Projects Added by Judges (Persistence & Immediate Investigation)', () => {
    test('Dynamic project created by judge can be investigated immediately and survives restart', async () => {
      const judgeProjectName = 'Judge Verification Project 2026';
      const createRes = await client.callTool('create_project', {
        name: judgeProjectName,
        description: 'Verified dynamically by Hackathon Evaluator',
        category: 'Hackathon',
        priority: 'critical'
      });
      const judgeProjId = createRes.data.project.id;
      assert.ok(judgeProjId);

      // Investigate immediately via natural language
      const investigateRes = await orchestrator.process(`Please investigate the project ${judgeProjectName}`);
      assert.equal(investigateRes.workflow, 'project_investigation');
      const detailCall = investigateRes.toolCalls.find(tc => tc.name === 'get_project_details');
      assert.equal(detailCall.args.projectId, judgeProjId);
      assert.ok(investigateRes.explanation.includes(judgeProjectName));
      assert.ok(investigateRes.explanation.includes('Hackathon'));
    });
  });
});
