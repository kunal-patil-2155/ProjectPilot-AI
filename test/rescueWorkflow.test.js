/**
 * ProjectPilot AI - Conversational Rescue Workflow Tests (Phase 3)
 * Validates:
 * 1. Natural-language rescue intent invokes generate_rescue_plan.
 * 2. The returned plan appears in the approval card.
 * 3. Pending plans enter AWAITING_APPROVAL.
 * 4. Manual recommendations cannot be selected for execution.
 * 5. Selecting actions updates only the local pending-plan selection.
 * 6. Cancelling clears the pending plan.
 * 7. Cancellation never invokes a write tool.
 * 8. A natural-language "yes" never invokes a write tool.
 * 9. Approval controls never invoke a write tool in Phase 3.
 * 10. An existing pending plan cannot be silently overwritten.
 * 11. Invalid action IDs are rejected.
 * 12. Empty executable-action lists do not expose misleading approval controls.
 * 13. Malicious project/task text cannot execute injected HTML or JavaScript.
 * 14. Existing project investigation and all prior workflows remain functional.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../src/server.js';
import { McpBrowserClient } from '../public/js/api/mcpClient.js';
import { AssistantOrchestrator, RESCUE_STATES } from '../public/js/orchestrator.js';

describe('Autonomous Project Rescue - Conversational Workflow (Phase 3)', () => {
  let tempDir;
  let serverInstance;
  let storePath;
  let client;
  let orchestrator;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-rescue-wf-test-'));
    storePath = path.join(tempDir, 'rescue-wf-store.json');
    serverInstance = await createServer({ storePath });
    const addr = await serverInstance.start(0);

    const mcpUrl = `http://localhost:${addr.port}/mcp`;
    client = new McpBrowserClient(mcpUrl);
    await client.connect();
    orchestrator = new AssistantOrchestrator(client);
  });

  after(async () => {
    if (client) await client.disconnect();
    if (serverInstance) await serverInstance.stop();
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // 1 & 2 & 3. Rescue intent invokes generate_rescue_plan, card is returned, enters AWAITING_APPROVAL
  test('1, 2, 3: Rescue intent invokes generate_rescue_plan, returns approval card, and enters AWAITING_APPROVAL', async () => {
    const outcome = await orchestrator.process('Rescue project Mobile Checkout SDK');

    assert.equal(outcome.workflow, 'rescue_plan');
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);
    assert.ok(orchestrator.pendingRescuePlan);
    assert.equal(orchestrator.pendingRescuePlan.projectId, 'proj-checkout');

    // Tool calls must include generate_rescue_plan
    const rescueToolCall = outcome.toolCalls.find(tc => tc.name === 'generate_rescue_plan');
    assert.ok(rescueToolCall, 'Must call generate_rescue_plan MCP tool');
    assert.equal(rescueToolCall.args.projectId, 'proj-checkout');

    // Approval card HTML must be generated with required details
    assert.ok(outcome.cardHtml, 'Must generate approval card HTML');
    assert.ok(outcome.cardHtml.includes('rescue-plan-card'));
    assert.ok(outcome.cardHtml.includes('Mobile Checkout SDK'));
    assert.ok(outcome.cardHtml.includes('proj-checkout'));
    assert.ok(outcome.cardHtml.includes('Observed: At Risk'));
    assert.ok(outcome.cardHtml.includes('Approve Selected'));
    assert.ok(outcome.cardHtml.includes('Cancel Plan'));

    // Markdown summary
    assert.ok(outcome.explanation.includes('Rescue Plan Prepared'));
  });

  // Natural language variations
  test('Natural-language rescue intent variations resolve correctly', async () => {
    // Clear pending plan from previous test
    orchestrator.cancelRescuePlan();

    const variations = [
      'Prepare a rescue plan for CloudSync Gateway',
      'Investigate the risks and prepare a recovery plan for CloudSync Gateway',
      'Rescue CloudSync Gateway',
      'Create a rescue plan for CloudSync Gateway'
    ];

    for (const phrase of variations) {
      const outcome = await orchestrator.process(phrase);
      assert.equal(outcome.workflow, 'rescue_plan');
      assert.equal(orchestrator.pendingRescuePlan.projectId, 'proj-cloudsync');
      orchestrator.cancelRescuePlan();
    }
  });

  // 4. Manual recommendations cannot be selected for execution
  test('4. Manual recommendations cannot be selected for execution', async () => {
    const outcome = await orchestrator.process('Rescue project Mobile Checkout SDK');
    assert.equal(outcome.workflow, 'rescue_plan');

    // Card contains manual recommendations section
    assert.ok(outcome.cardHtml.includes('Manual Interventions &amp; Unsupported Items'));
    assert.ok(outcome.cardHtml.includes('Non-Executable via MCP'));

    // Manual items do not have checkboxes
    assert.ok(!outcome.cardHtml.includes('data-action-id="OVERDUE_TASK_MANUAL_RESCHEDULE"'));

    // Attempting to select a manual recommendation ID must throw
    assert.throws(
      () => orchestrator.toggleActionSelection('OVERDUE_TASK_MANUAL_RESCHEDULE'),
      /Invalid action ID "OVERDUE_TASK_MANUAL_RESCHEDULE"/
    );
  });

  // 5. Selecting actions updates only the local pending-plan selection
  test('5. Selecting actions updates only the local pending-plan selection in memory', async () => {
    const plan = orchestrator.pendingRescuePlan;
    assert.ok(plan && plan.actions.length > 0);

    const firstActionId = plan.actions[0].id;

    // By default all actions are selected
    assert.ok(orchestrator.selectedActionIds.has(firstActionId));

    // Deselect first action
    orchestrator.toggleActionSelection(firstActionId, false);
    assert.ok(!orchestrator.selectedActionIds.has(firstActionId));

    // Select all false
    orchestrator.selectAllActions(false);
    assert.equal(orchestrator.selectedActionIds.size, 0);

    // Select all true
    orchestrator.selectAllActions(true);
    assert.equal(orchestrator.selectedActionIds.size, plan.actions.length);
  });

  // 6 & 7. Cancelling clears the pending plan and never invokes a write tool
  test('6 & 7. Cancelling clears the pending plan and never invokes a write tool', async () => {
    const storeBefore = await fs.promises.readFile(storePath, 'utf8');

    // Cancel conversationally
    const outcome = await orchestrator.process('Cancel plan');

    assert.equal(outcome.workflow, 'rescue_plan_cancelled');
    assert.equal(orchestrator.rescueState, RESCUE_STATES.CANCELLED);
    assert.equal(orchestrator.pendingRescuePlan, null);
    assert.equal(orchestrator.selectedActionIds.size, 0);
    assert.equal(outcome.toolCalls.length, 0, 'No tool calls should be made on cancellation');

    const storeAfter = await fs.promises.readFile(storePath, 'utf8');
    assert.equal(storeBefore, storeAfter, 'Store on disk must remain byte-for-byte identical');
  });

  // 8. Natural-language "yes" never invokes a write tool
  test('8. Natural-language "yes" or "approve" never invokes a write tool', async () => {
    // Generate new plan
    await orchestrator.process('Rescue project Mobile Checkout SDK');
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);

    const storeBefore = await fs.promises.readFile(storePath, 'utf8');

    // Say "yes"
    const outcome = await orchestrator.process('yes');

    assert.equal(outcome.workflow, 'rescue_plan_guidance');
    assert.equal(outcome.toolCalls.length, 0, 'Must not call any tools');
    assert.ok(outcome.explanation.includes('Action approval requires explicit selection'));

    // Say "approve"
    const outcome2 = await orchestrator.process('approve');
    assert.equal(outcome2.workflow, 'rescue_plan_guidance');
    assert.equal(outcome2.toolCalls.length, 0);

    const storeAfter = await fs.promises.readFile(storePath, 'utf8');
    assert.equal(storeBefore, storeAfter, 'Store on disk must remain unmodified');
  });

  // 9. Approval controls never invoke a write tool in Phase 3
  test('9. Approval controls record selection and never invoke a write tool in Phase 3', async () => {
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);
    const storeBefore = await fs.promises.readFile(storePath, 'utf8');

    const approvalResult = orchestrator.approveSelectedActions();

    assert.equal(approvalResult.approved, true);
    assert.ok(approvalResult.actionCount > 0);
    assert.ok(approvalResult.message.includes('No write tools called'));

    const storeAfter = await fs.promises.readFile(storePath, 'utf8');
    assert.equal(storeBefore, storeAfter, 'Store on disk must remain completely unmodified');
  });

  // 10. An existing pending plan cannot be silently overwritten
  test('10. An existing pending plan cannot be silently overwritten while awaiting approval', async () => {
    // Orchestrator still has proj-checkout awaiting approval
    assert.equal(orchestrator.rescueState, RESCUE_STATES.AWAITING_APPROVAL);

    const outcome = await orchestrator.process('Rescue project DevPulse Analytics');

    assert.equal(outcome.workflow, 'rescue_plan_blocked');
    assert.ok(outcome.explanation.includes('currently awaiting your approval'));
    assert.equal(orchestrator.pendingRescuePlan.projectId, 'proj-checkout', 'Pending plan must not be overwritten');
  });

  // 11. Invalid action IDs are rejected
  test('11. Invalid or unauthorized action IDs are strictly rejected', () => {
    assert.throws(
      () => orchestrator.toggleActionSelection('malicious-injected-id'),
      /Invalid action ID "malicious-injected-id"/
    );
  });

  // 12. Empty executable-action lists do not expose misleading approval controls
  test('12. Empty executable-action lists do not expose misleading approval controls', async () => {
    orchestrator.cancelRescuePlan();

    // Create a project with zero tasks
    const createProjRes = await client.callTool('create_project', {
      name: 'Clean Slate Service',
      category: 'Backend'
    });
    const emptyProj = createProjRes.data.project;

    const outcome = await orchestrator.process(`Rescue project ${emptyProj.name}`);

    assert.equal(outcome.workflow, 'rescue_plan');
    assert.ok(outcome.cardHtml.includes('rescue-empty-notice'));
    assert.ok(!outcome.cardHtml.includes('rescue-approve-btn'), 'Must not render Approve Selected button when actions=0');
    assert.ok(outcome.cardHtml.includes('Dismiss / Cancel Plan'));
  });

  // 13. Malicious project/task text cannot execute injected HTML or JavaScript
  test('13. Malicious project or task text cannot execute injected HTML or JavaScript', async () => {
    orchestrator.cancelRescuePlan();

    // Create project with XSS payload in name
    const xssProjectRes = await client.callTool('create_project', {
      name: '<script>alert("xss-project")</script>',
      category: 'Security'
    });
    const xssProject = xssProjectRes.data.project;

    // Create blocked task with XSS payload in title and blocker
    await client.callTool('create_task', {
      projectId: xssProject.id,
      title: '<img src=x onerror=alert("xss-task")>',
      status: 'blocked',
      priority: 'critical',
      blocker: '<b onmouseover=alert("xss-blocker")>Critical</b>'
    });

    const outcome = await orchestrator.process(`Rescue project ${xssProject.id}`);

    assert.equal(outcome.workflow, 'rescue_plan');

    // Verify all raw HTML injection tags are escaped
    assert.ok(!outcome.cardHtml.includes('<script>alert("xss-project")</script>'));
    assert.ok(outcome.cardHtml.includes('&lt;script&gt;alert(&quot;xss-project&quot;)&lt;/script&gt;'));

    assert.ok(!outcome.cardHtml.includes('<img src=x onerror=alert("xss-task")>'));
    assert.ok(outcome.cardHtml.includes('&lt;img src=x onerror=alert(&quot;xss-task&quot;)&gt;'));

    assert.ok(!outcome.cardHtml.includes('<b onmouseover=alert("xss-blocker")>'));
    assert.ok(outcome.cardHtml.includes('&lt;b onmouseover=alert(&quot;xss-blocker&quot;)&gt;'));
  });

  // 14. Existing project investigation and all prior workflows remain functional
  test('14. Existing project investigation and all prior workflows remain completely functional', async () => {
    orchestrator.cancelRescuePlan();

    // Workflow 1: Daily priorities
    const w1 = await orchestrator.process('What should I work on today?');
    assert.equal(w1.workflow, 'daily_priorities');
    assert.ok(w1.explanation.includes('calculated daily priorities'));

    // Workflow 2: Project investigation
    const w2 = await orchestrator.process('Inspect DevPulse Analytics');
    assert.equal(w2.workflow, 'project_investigation');
    assert.ok(w2.explanation.includes('Project Health & Intelligence Report'));

    // Workflow 4: Remaining work
    const w4 = await orchestrator.process('Show remaining work');
    assert.equal(w4.workflow, 'remaining_work');
    assert.ok(w4.explanation.includes('Remaining Work Summary'));

    // Workflow 5: Maintenance review
    const w5 = await orchestrator.process('Review maintenance tasks');
    assert.equal(w5.workflow, 'maintenance_review');
    assert.ok(w5.explanation.includes('Maintenance Tasks Review'));
  });

});
