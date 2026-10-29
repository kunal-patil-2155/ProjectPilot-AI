/**
 * ProjectPilot AI - Phase C Intent Routing & Workflow Verification Tests
 *
 * Verifies repairs for:
 * - BUG-04: Cross-project blocker query routing vs greedy project investigation
 * - BUG-05: Overdue task query routing vs maintenance review
 * - BUG-07: Greeting and identity routing without restrictive word count limits
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
  isBlockerReviewIntent,
  isOverdueTasksIntent,
  isMaintenanceReviewIntent,
  isGreetingOrIdentityIntent,
  isProjectInvestigationIntent
} from '../public/js/orchestrator.js';
import { IntentClassifier, INTENTS } from '../public/js/nlu/intentClassifier.js';

describe('Phase C: Intent Routing & Workflow Reliability (BUG-04, BUG-05, BUG-07)', () => {
  let tempDir;
  let serverInstance;
  let client;
  let orchestrator;
  let classifier;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-phase-c-'));
    const storePath = path.join(tempDir, 'phase-c-store.json');
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

  // --------------------------------------------------------------------------
  // Item 1: The seven observed phrases and workflows
  // --------------------------------------------------------------------------
  describe('1. Seven Observed Production Phrases & Workflows', () => {
    test('"Investigate DevPulse Analytics" routes to project investigation workflow', async () => {
      const result = await orchestrator.process('Investigate DevPulse Analytics');
      assert.equal(result.workflow, 'project_investigation');
      assert.ok(result.explanation.includes('DevPulse Analytics'));
      assert.ok(result.toolCalls.some(tc => tc.name === 'get_project_details'));
    });

    test('"Show all blocked tasks" routes to blocker review workflow', async () => {
      const result = await orchestrator.process('Show all blocked tasks');
      assert.equal(result.workflow, 'blocker_review');
      assert.ok(result.toolCalls.some(tc => tc.name === 'list_blockers'));
      assert.ok(result.explanation.includes('Active Blocked Tasks'));
    });

    test('"Show all overdue tasks" routes to overdue tasks workflow', async () => {
      const result = await orchestrator.process('Show all overdue tasks');
      assert.equal(result.workflow, 'overdue_tasks');
      assert.ok(result.toolCalls.some(tc => tc.name === 'list_tasks'));
      assert.ok(result.toolCalls.some(tc => tc.name === 'list_projects'));
      assert.ok(result.explanation.includes('Overdue Tasks'));
    });

    test('"Review maintenance tasks" routes to maintenance review workflow', async () => {
      const result = await orchestrator.process('Review maintenance tasks');
      assert.equal(result.workflow, 'maintenance_review');
      assert.ok(result.toolCalls.some(tc => tc.name === 'list_maintenance_tasks'));
      assert.ok(result.explanation.includes('Maintenance Tasks Review'));
    });

    test('"Show overdue certificate rotations" routes to maintenance review workflow', async () => {
      const result = await orchestrator.process('Show overdue certificate rotations');
      assert.equal(result.workflow, 'maintenance_review');
      assert.ok(result.toolCalls.some(tc => tc.name === 'list_maintenance_tasks'));
      assert.ok(result.explanation.includes('Maintenance Tasks Review'));
    });

    test('"Hello, who are you?" routes to greeting workflow', async () => {
      const result = await orchestrator.process('Hello, who are you?');
      assert.equal(result.workflow, 'greeting');
      assert.equal(result.toolCalls.length, 0);
      assert.ok(result.explanation.length > 20);
    });

    test('"Introduce yourself." routes to greeting workflow', async () => {
      const result = await orchestrator.process('Introduce yourself.');
      assert.equal(result.workflow, 'greeting');
      assert.equal(result.toolCalls.length, 0);
      assert.ok(result.explanation.length > 20);
    });
  });

  // --------------------------------------------------------------------------
  // Item 2: All four cross-project blocker-query variants
  // --------------------------------------------------------------------------
  describe('2. Cross-Project Blocker Query Variants (BUG-04)', () => {
    const blockerVariants = [
      'Show all blocked tasks',
      'List blockers across all projects',
      'Which tasks are blocked?',
      'Find all blocked work'
    ];

    for (const phrase of blockerVariants) {
      test(`Classifier & Orchestrator route: "${phrase}"`, async () => {
        const classified = classifier.classify(phrase);
        assert.equal(classified.intent, INTENTS.LIST_BLOCKERS, `IntentClassifier must classify "${phrase}" as LIST_BLOCKERS`);

        assert.equal(isBlockerReviewIntent(phrase), true, `isBlockerReviewIntent("${phrase}") must be true`);
        assert.equal(isProjectInvestigationIntent(phrase), false, `isProjectInvestigationIntent("${phrase}") must be false`);

        const result = await orchestrator.process(phrase);
        assert.equal(result.workflow, 'blocker_review', `Orchestrator must execute blocker_review for "${phrase}"`);
        assert.ok(result.toolCalls.some(tc => tc.name === 'list_blockers'));
        assert.ok(result.explanation.includes('Active Blocked Tasks') || result.explanation.includes('No Active Blockers Found'));
      });
    }
  });

  // --------------------------------------------------------------------------
  // Item 3: All four overdue-task-query variants
  // --------------------------------------------------------------------------
  describe('3. Overdue Task Query Variants (BUG-05)', () => {
    const overdueVariants = [
      'Show all overdue tasks',
      'Review overdue tasks',
      'What tasks are overdue?',
      'List tasks past their due date'
    ];

    for (const phrase of overdueVariants) {
      test(`Classifier & Orchestrator route: "${phrase}"`, async () => {
        const classified = classifier.classify(phrase);
        assert.equal(classified.intent, INTENTS.OVERDUE_TASKS, `IntentClassifier must classify "${phrase}" as OVERDUE_TASKS`);

        assert.equal(isOverdueTasksIntent(phrase), true, `isOverdueTasksIntent("${phrase}") must be true`);
        assert.equal(isMaintenanceReviewIntent(phrase), false, `isMaintenanceReviewIntent("${phrase}") must be false`);
        assert.equal(isProjectInvestigationIntent(phrase), false, `isProjectInvestigationIntent("${phrase}") must be false`);

        const result = await orchestrator.process(phrase);
        assert.equal(result.workflow, 'overdue_tasks', `Orchestrator must execute overdue_tasks for "${phrase}"`);
        assert.ok(result.toolCalls.some(tc => tc.name === 'list_tasks'));
        assert.ok(result.toolCalls.some(tc => tc.name === 'list_projects'));
        assert.ok(!result.toolCalls.some(tc => tc.name === 'list_maintenance_tasks'), 'Must not call list_maintenance_tasks');
      });
    }
  });

  // --------------------------------------------------------------------------
  // Item 4: Completed tasks are excluded from overdue results
  // --------------------------------------------------------------------------
  describe('4. Overdue Task Filtering: Completed Tasks Excluded', () => {
    test('tasks with status done/completed and past due date are excluded from overdue results', async () => {
      // Create a task that is past due but completed
      const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const createRes = await client.callTool('create_task', {
        projectId: 'proj-devpulse',
        title: 'Completed Past-Due Integration Check',
        priority: 'high',
        status: 'done',
        dueDate: pastDate
      });
      const createdTaskId = createRes.data?.task?.id;
      assert.ok(createdTaskId, 'Task should be created');

      const result = await orchestrator.process('Show all overdue tasks');
      assert.equal(result.workflow, 'overdue_tasks');
      // Must NOT contain the completed task
      assert.ok(!result.explanation.includes(createdTaskId), `Completed task ${createdTaskId} must not appear in overdue tasks list`);
      assert.ok(!result.explanation.includes('Completed Past-Due Integration Check'));
    });
  });

  // --------------------------------------------------------------------------
  // Item 5: Missing due dates do not create false overdue results
  // --------------------------------------------------------------------------
  describe('5. Overdue Task Filtering: Missing Due Dates Handled Safely', () => {
    test('tasks without dueDate or with invalid dueDate are not considered overdue', async () => {
      // Create task with no due date
      const createRes = await client.callTool('create_task', {
        projectId: 'proj-cloudsync',
        title: 'Task With No Due Date Specified',
        priority: 'medium',
        status: 'todo'
      });
      const noDueDateTaskId = createRes.data?.task?.id;
      assert.ok(noDueDateTaskId);

      const result = await orchestrator.process('Show all overdue tasks');
      assert.equal(result.workflow, 'overdue_tasks');
      assert.ok(!result.explanation.includes(noDueDateTaskId), 'Task without due date must not appear in overdue results');
      assert.ok(!result.explanation.includes('Task With No Due Date Specified'));
    });
  });

  // --------------------------------------------------------------------------
  // Item 6: Explicit maintenance requests still invoke maintenance review
  // --------------------------------------------------------------------------
  describe('6. Explicit Maintenance Routing Preserved', () => {
    const maintenancePhrases = [
      'Review maintenance tasks',
      'Show overdue certificate rotations',
      'Check upcoming SSL certificate renewals'
    ];

    for (const phrase of maintenancePhrases) {
      test(`routes "${phrase}" to maintenance review`, async () => {
        assert.equal(isMaintenanceReviewIntent(phrase), true);
        assert.equal(isOverdueTasksIntent(phrase), false);

        const result = await orchestrator.process(phrase);
        assert.equal(result.workflow, 'maintenance_review');
        assert.ok(result.toolCalls.some(tc => tc.name === 'list_maintenance_tasks'));
      });
    }
  });

  // --------------------------------------------------------------------------
  // Item 7: Project names beginning with or containing common routing verbs remain investigable
  // --------------------------------------------------------------------------
  describe('7. Project Names with Common Routing Verbs Remain Investigable', () => {
    const projectInvestigationPhrases = [
      { text: 'Investigate DevPulse Analytics', expectedProject: 'DevPulse Analytics' },
      { text: 'Show me DevPulse Analytics', expectedProject: 'DevPulse Analytics' },
      { text: 'Inspect CloudSync Gateway', expectedProject: 'CloudSync Gateway' }
    ];

    for (const { text, expectedProject } of projectInvestigationPhrases) {
      test(`routes "${text}" to project_investigation for ${expectedProject}`, async () => {
        assert.equal(isProjectInvestigationIntent(text), true);
        assert.equal(isBlockerReviewIntent(text), false);
        assert.equal(isOverdueTasksIntent(text), false);

        const result = await orchestrator.process(text);
        assert.equal(result.workflow, 'project_investigation');
        assert.ok(result.explanation.includes(expectedProject));
        assert.ok(result.toolCalls.some(tc => tc.name === 'get_project_details'));
      });
    }
  });

  // --------------------------------------------------------------------------
  // Item 8: Greetings with additional questions are recognized (BUG-07)
  // --------------------------------------------------------------------------
  describe('8. Greetings & Capability Inquiries (BUG-07)', () => {
    const greetingPhrases = [
      'Hello, who are you?',
      'Introduce yourself.',
      'What can you do?',
      'What are your capabilities?'
    ];

    for (const phrase of greetingPhrases) {
      test(`routes greeting/identity query: "${phrase}"`, async () => {
        assert.equal(isGreetingOrIdentityIntent(phrase), true);
        assert.equal(isProjectInvestigationIntent(phrase), false);

        const result = await orchestrator.process(phrase);
        assert.equal(result.workflow, 'greeting');
        assert.equal(result.toolCalls.length, 0);
        assert.ok(result.explanation.length > 20);
      });
    }
  });

  // --------------------------------------------------------------------------
  // Item 9: Unsupported requests do not silently invoke unrelated write operations
  // --------------------------------------------------------------------------
  describe('9. Unsupported Requests Safety Check', () => {
    const unhandledQueries = [
      'What is the capital of France?',
      'Tell me a funny joke about space travel',
      'Explain quantum computing in detail'
    ];

    for (const query of unhandledQueries) {
      test(`unsupported query "${query}" does not trigger state mutations or write tools`, async () => {
        const result = await orchestrator.process(query);

        // Ensure no write tools were called
        const writeTools = ['create_task', 'update_task_status', 'delete_task', 'reopen_task', 'delete_project', 'execute_rescue_action'];
        const calledWriteTools = (result.toolCalls || []).filter(tc => writeTools.includes(tc.name));
        assert.equal(calledWriteTools.length, 0, `No write tools should be invoked for "${query}"`);

        // Workflow should be natural conversational response or fallback, not destructive
        assert.notEqual(result.workflow, 'complete_task');
        assert.notEqual(result.workflow, 'manage_blocker');
        assert.notEqual(result.workflow, 'create_task');
      });
    }
  });
});
