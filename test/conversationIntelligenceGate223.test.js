/**
 * ProjectPilot AI - Gate 2.23: Conversation Intelligence Regression & Domain Verification Tests
 *
 * Verifies conversational natural-language handling across the 6 core judge domains:
 * Domain 1 — Project Discovery ("Show me all my projects.", "List my projects.", "What projects are registered?")
 * Domain 2 — Project Investigation ("Investigate my project.", "Give me a complete project status report.", "How is my project progressing?")
 * Domain 3 — Project Health & Risk ("Which project is at risk?", "Which project needs immediate attention?", "Identify unhealthy projects and explain the evidence.")
 * Domain 4 — Blocker Analysis ("Show me all active blockers.", "Which tasks are blocked?", "What is preventing project progress?")
 * Domain 5 — Daily Priorities ("What should I work on today?", "Show my top three priorities.", "Which task should I complete first?")
 * Domain 6 — Rescue Planning ("Generate a rescue plan.", "Which project needs a rescue plan?", "Prepare a recovery strategy for my most critical project.")
 *
 * Plus multilingual queries (Hindi, Marathi), entity extraction, predicate guards, and live MCP execution.
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
  isRescueIntent,
  isBlockerReviewIntent,
  isProjectsListIntent,
  isProjectHealthIntent,
  isProjectInvestigationIntent,
  extractRescueQuery,
  extractProjectQuery
} from '../public/js/orchestrator.js';
import { IntentClassifier, INTENTS } from '../public/js/nlu/intentClassifier.js';

describe('Gate 2.23: Conversation Intelligence Across 6 Core Domains', () => {
  let tempDir;
  let serverInstance;
  let client;
  let orchestrator;
  let classifier;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-gate223-'));
    const storePath = path.join(tempDir, 'gate223-store.json');
    serverInstance = await createServer({ storePath });
    const addr = await serverInstance.start(0);

    const mcpUrl = `http://localhost:${addr.port}/mcp`;
    client = new McpBrowserClient(mcpUrl);
    await client.connect();
    orchestrator = new AssistantOrchestrator(client);
    classifier = new IntentClassifier();
  });

  after(async () => {
    if (client) await client.disconnect();
    if (serverInstance) await serverInstance.stop();
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // =========================================================================
  // SECTION 1: INTENT CLASSIFICATION ACROSS ALL 6 DOMAINS
  // =========================================================================
  describe('1. Intent Classifier Domain Categorization', () => {
    // Domain 1: Project Discovery
    test('Domain 1: Project Discovery phrases classify as LIST_PROJECTS', () => {
      const phrases = [
        'Show me all my projects.',
        'List my projects.',
        'What projects are registered?',
        'Show all projects',
        'List all projects',
        'Show my projects',
        'What are my projects',
        'Registered projects'
      ];
      for (const phrase of phrases) {
        const result = classifier.classify(phrase);
        assert.equal(result.intent, INTENTS.LIST_PROJECTS, `Failed for "${phrase}"`);
      }
    });

    test('Domain 1: Multilingual discovery phrases classify as LIST_PROJECTS', () => {
      const phrases = [
        'Mere sare projects dikhao',
        'Sabhi projects ki list dikhao',
        'Majhe sarv projects dakva',
        'Sagale projects dakhva'
      ];
      for (const phrase of phrases) {
        const result = classifier.classify(phrase);
        assert.equal(result.intent, INTENTS.LIST_PROJECTS, `Failed for "${phrase}"`);
      }
    });

    // Domain 2: Project Investigation
    test('Domain 2: Project Investigation phrases classify as INVESTIGATE_PROJECT', () => {
      const phrases = [
        'Investigate my project.',
        'Give me a complete project status report.',
        'How is my project progressing?',
        'Inspect DevPulse Analytics',
        'Check status of Mobile Checkout SDK',
        'Give me a complete project status report on DevPulse Analytics'
      ];
      for (const phrase of phrases) {
        const result = classifier.classify(phrase);
        assert.equal(result.intent, INTENTS.INVESTIGATE_PROJECT, `Failed for "${phrase}"`);
      }
    });

    // Domain 3: Project Health & Risk
    test('Domain 3: Health & Risk phrases classify as PROJECT_HEALTH', () => {
      const phrases = [
        'Which project is at risk?',
        'Which project needs immediate attention?',
        'Identify unhealthy projects and explain the evidence.',
        'What projects are at risk?',
        'Show project health',
        'Health of all projects',
        'Projects at risk'
      ];
      for (const phrase of phrases) {
        const result = classifier.classify(phrase);
        assert.equal(result.intent, INTENTS.PROJECT_HEALTH, `Failed for "${phrase}"`);
      }
    });

    test('Domain 3: Multilingual health phrases classify as PROJECT_HEALTH', () => {
      const phrases = [
        'Kaunsa project risk me hai?',
        'Khatre me kaunsa project hai?',
        'Konta project dhokyat aahe?'
      ];
      for (const phrase of phrases) {
        const result = classifier.classify(phrase);
        assert.equal(result.intent, INTENTS.PROJECT_HEALTH, `Failed for "${phrase}"`);
      }
    });

    // Domain 4: Blocker Analysis
    test('Domain 4: Blocker phrases classify as LIST_BLOCKERS', () => {
      const phrases = [
        'Show me all active blockers.',
        'Which tasks are blocked?',
        'What is preventing project progress?',
        'Show all blocked tasks',
        'List blockers across all projects',
        'Are there any blocked tasks?'
      ];
      for (const phrase of phrases) {
        const result = classifier.classify(phrase);
        assert.equal(result.intent, INTENTS.LIST_BLOCKERS, `Failed for "${phrase}"`);
      }
    });

    // Domain 5: Daily Priorities
    test('Domain 5: Priority phrases classify as DAILY_PRIORITIES', () => {
      const phrases = [
        'What should I work on today?',
        'Show my top three priorities.',
        'Which task should I complete first?',
        'What are my daily priorities?',
        'What is my top priority?'
      ];
      for (const phrase of phrases) {
        const result = classifier.classify(phrase);
        assert.equal(result.intent, INTENTS.DAILY_PRIORITIES, `Failed for "${phrase}"`);
      }
    });

    // Domain 6: Rescue Planning
    test('Domain 6: Rescue planning phrases classify as RESCUE_PROJECT', () => {
      const phrases = [
        'Generate a rescue plan.',
        'Which project needs a rescue plan?',
        'Prepare a recovery strategy for my most critical project.',
        'Prepare a rescue plan for DevPulse Analytics',
        'Rescue Mobile Checkout SDK',
        'Create a recovery plan'
      ];
      for (const phrase of phrases) {
        const result = classifier.classify(phrase);
        assert.equal(result.intent, INTENTS.RESCUE_PROJECT, `Failed for "${phrase}"`);
      }
    });
  });

  // =========================================================================
  // SECTION 2: HELPER PREDICATES & EXTRACTION GUARDS
  // =========================================================================
  describe('2. Predicate Functions & Collision Avoidance', () => {
    test('isProjectsListIntent matches discovery queries without false positives on blockers', () => {
      assert.equal(isProjectsListIntent('Show me all my projects.'), true);
      assert.equal(isProjectsListIntent('List my projects.'), true);
      assert.equal(isProjectsListIntent('What projects are registered?'), true);

      // Guard: must NOT match blocker or task queries
      assert.equal(isProjectsListIntent('List blockers across all projects'), false);
      assert.equal(isProjectsListIntent('Show all blocked tasks'), false);
      assert.equal(isProjectsListIntent('Show overdue tasks'), false);
    });

    test('isProjectHealthIntent matches health queries without false positives on investigation', () => {
      assert.equal(isProjectHealthIntent('Which project is at risk?'), true);
      assert.equal(isProjectHealthIntent('Which project needs immediate attention?'), true);
      assert.equal(isProjectHealthIntent('Identify unhealthy projects and explain the evidence.'), true);
    });

    test('isBlockerReviewIntent correctly matches active blockers and progress impediments', () => {
      assert.equal(isBlockerReviewIntent('Show me all active blockers.'), true);
      assert.equal(isBlockerReviewIntent('Which tasks are blocked?'), true);
      assert.equal(isBlockerReviewIntent('What is preventing project progress?'), true);
      assert.equal(isBlockerReviewIntent('resolve blocker task-123'), false); // Excludes mutation
    });

    test('isRescueIntent correctly identifies recovery strategy requests', () => {
      assert.equal(isRescueIntent('Generate a rescue plan.'), true);
      assert.equal(isRescueIntent('Which project needs a rescue plan?'), true);
      assert.equal(isRescueIntent('Prepare a recovery strategy for my most critical project.'), true);
    });

    test('isProjectInvestigationIntent excludes discovery, health, rescue, and blocker queries', () => {
      assert.equal(isProjectInvestigationIntent('Show me all my projects.'), false);
      assert.equal(isProjectInvestigationIntent('Which project is at risk?'), false);
      assert.equal(isProjectInvestigationIntent('Generate a rescue plan.'), false);
      assert.equal(isProjectInvestigationIntent('Show me all active blockers.'), false);
      assert.equal(isProjectInvestigationIntent('Investigate DevPulse Analytics'), true);
    });

    test('extractRescueQuery returns empty for generic requests so auto-targeting activates', () => {
      assert.equal(extractRescueQuery('Generate a rescue plan.'), '');
      assert.equal(extractRescueQuery('Which project needs a rescue plan?'), '');
      assert.equal(extractRescueQuery('Prepare a recovery strategy for my most critical project.'), '');
      assert.equal(extractRescueQuery('Prepare a rescue plan for DevPulse Analytics'), 'DevPulse Analytics');
    });

    test('extractProjectQuery correctly extracts named projects vs generic inquiries', () => {
      assert.equal(extractProjectQuery('Investigate my project.'), '');
      assert.equal(extractProjectQuery('Give me a complete project status report.'), '');
      assert.equal(extractProjectQuery('How is my project progressing?'), '');
      assert.equal(extractProjectQuery('Give me a complete project status report on DevPulse Analytics'), 'DevPulse Analytics');
      assert.equal(extractProjectQuery('Investigate DevPulse Analytics'), 'DevPulse Analytics');
    });
  });

  // =========================================================================
  // SECTION 3: LIVE END-TO-END WORKFLOW EXECUTION
  // =========================================================================
  describe('3. Live Assistant Workflow Execution & Truthful Evidence', () => {
    // -----------------------------------------------------------------------
    // Domain 1: Project Discovery
    // -----------------------------------------------------------------------
    test('Domain 1: "Show me all my projects." returns list_projects workflow with project details', async () => {
      const outcome = await orchestrator.process('Show me all my projects.');
      assert.equal(outcome.workflow, 'list_projects');
      assert.ok(outcome.toolCalls.some(tc => tc.name === 'list_projects'));
      assert.ok(outcome.explanation.includes('Registered Projects'));
      assert.ok(outcome.explanation.includes('DevPulse Analytics'));
      assert.ok(outcome.explanation.includes('Mobile Checkout SDK'));
      assert.ok(outcome.clarificationOptions.length >= 2);
    });

    test('Domain 1: "What projects are registered?" returns list_projects workflow', async () => {
      const outcome = await orchestrator.process('What projects are registered?');
      assert.equal(outcome.workflow, 'list_projects');
      assert.ok(outcome.toolCalls.some(tc => tc.name === 'list_projects'));
    });

    test('Domain 1: Hindi project discovery query returns localized report', async () => {
      const outcome = await orchestrator.process('Mere sare projects dikhao');
      assert.equal(outcome.workflow, 'list_projects');
      assert.ok(outcome.explanation.includes('पंजीकृत परियोजनाएं'));
    });

    test('Domain 1: Marathi project discovery query returns localized report', async () => {
      const outcome = await orchestrator.process('Majhe sarv projects dakva');
      assert.equal(outcome.workflow, 'list_projects');
      assert.ok(outcome.explanation.includes('नोंदणीकृत प्रकल्प'));
    });

    // -----------------------------------------------------------------------
    // Domain 2: Project Investigation
    // -----------------------------------------------------------------------
    test('Domain 2: "Investigate my project." prompts with portfolio projects without crashing', async () => {
      const outcome = await orchestrator.process('Investigate my project.');
      assert.equal(outcome.workflow, 'project_investigation');
      assert.ok(outcome.toolCalls.some(tc => tc.name === 'list_projects'));
      assert.ok(outcome.explanation.includes('Available projects:'));
      assert.ok(outcome.clarificationOptions.length >= 1);
    });

    test('Domain 2: "Give me a complete project status report on DevPulse Analytics" investigates project', async () => {
      const outcome = await orchestrator.process('Give me a complete project status report on DevPulse Analytics');
      assert.equal(outcome.workflow, 'project_investigation');
      assert.ok(outcome.toolCalls.some(tc => tc.name === 'get_project_details'));
      assert.ok(outcome.explanation.includes('DevPulse Analytics'));
    });

    // -----------------------------------------------------------------------
    // Domain 3: Project Health & Risk Assessment
    // -----------------------------------------------------------------------
    test('Domain 3: "Which project is at risk?" derives truth directly from get_project_health', async () => {
      const outcome = await orchestrator.process('Which project is at risk?');
      assert.equal(outcome.workflow, 'project_health');
      assert.ok(outcome.toolCalls.some(tc => tc.name === 'get_project_health'));
      assert.ok(outcome.explanation.includes('Projects At Risk') || outcome.explanation.includes('At Risk'));
      assert.ok(outcome.explanation.includes('DevPulse Analytics'));
      assert.ok(outcome.clarificationOptions.some(opt => opt.action.includes('rescue')));
    });

    test('Domain 3: "Which project needs immediate attention?" highlights attention-needed projects', async () => {
      const outcome = await orchestrator.process('Which project needs immediate attention?');
      assert.equal(outcome.workflow, 'project_health');
      assert.ok(outcome.toolCalls.some(tc => tc.name === 'get_project_health'));
      assert.ok(outcome.explanation.includes('Immediate Attention') || outcome.explanation.includes('At Risk'));
    });

    test('Domain 3: "Identify unhealthy projects and explain the evidence." presents transparent reasons', async () => {
      const outcome = await orchestrator.process('Identify unhealthy projects and explain the evidence.');
      assert.equal(outcome.workflow, 'project_health');
      assert.ok(outcome.toolCalls.some(tc => tc.name === 'get_project_health'));
      assert.ok(outcome.explanation.includes('Evidence:'));
    });

    // -----------------------------------------------------------------------
    // Domain 4: Blocker Analysis
    // -----------------------------------------------------------------------
    test('Domain 4: "Show me all active blockers." calls list_blockers and reports impediments', async () => {
      const outcome = await orchestrator.process('Show me all active blockers.');
      assert.equal(outcome.workflow, 'blocker_review');
      assert.ok(outcome.toolCalls.some(tc => tc.name === 'list_blockers'));
      assert.ok(outcome.explanation.includes('Active Blocked Tasks'));
      assert.ok(outcome.explanation.includes('Blocker Reason'));
    });

    test('Domain 4: "What is preventing project progress?" routes to blocker review', async () => {
      const outcome = await orchestrator.process('What is preventing project progress?');
      assert.equal(outcome.workflow, 'blocker_review');
      assert.ok(outcome.toolCalls.some(tc => tc.name === 'list_blockers'));
    });

    // -----------------------------------------------------------------------
    // Domain 5: Daily Priorities
    // -----------------------------------------------------------------------
    test('Domain 5: "What should I work on today?" calculates deterministic priorities', async () => {
      const outcome = await orchestrator.process('What should I work on today?');
      assert.equal(outcome.workflow, 'daily_priorities');
      assert.ok(outcome.toolCalls.some(tc => tc.name === 'get_priority_recommendations'));
      assert.ok(outcome.toolCalls.some(tc => tc.name === 'list_blockers'));
      assert.ok(outcome.explanation.includes('daily priorities'));
    });

    test('Domain 5: "Show my top three priorities." requests limit 3', async () => {
      const outcome = await orchestrator.process('Show my top three priorities.');
      assert.equal(outcome.workflow, 'daily_priorities');
      const recTool = outcome.toolCalls.find(tc => tc.name === 'get_priority_recommendations');
      assert.ok(recTool);
      assert.equal(recTool.args.limit, 3);
    });

    test('Domain 5: "Which task should I complete first?" highlights the immediate top focus', async () => {
      const outcome = await orchestrator.process('Which task should I complete first?');
      assert.equal(outcome.workflow, 'daily_priorities');
      assert.ok(outcome.explanation.includes('Top Recommendation to Complete First') || outcome.explanation.includes('Immediate Focus'));
    });

    // -----------------------------------------------------------------------
    // Domain 6: Rescue Planning
    // -----------------------------------------------------------------------
    test('Domain 6: "Which project needs a rescue plan?" targets the at-risk project', async () => {
      const outcome = await orchestrator.process('Which project needs a rescue plan?');
      assert.equal(outcome.workflow, 'rescue_plan_recommendation');
      assert.ok(outcome.toolCalls.some(tc => tc.name === 'get_project_health'));
      assert.ok(outcome.explanation.includes('DevPulse Analytics'));
      assert.ok(outcome.clarificationOptions.some(opt => opt.action.includes('rescue')));
    });

    test('Domain 6: "Generate a rescue plan." automatically targets highest at-risk project', async () => {
      const outcome = await orchestrator.process('Generate a rescue plan.');
      assert.equal(outcome.workflow, 'rescue_plan');
      assert.ok(outcome.toolCalls.some(tc => tc.name === 'generate_rescue_plan'));
      assert.ok(outcome.explanation.includes('Rescue Plan Prepared'));
      assert.ok(outcome.isApprovalCard);
    });
  });
});

