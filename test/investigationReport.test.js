/**
 * ProjectPilot AI - Phase A: BUG-01 Regression Test Suite
 * Validates the fix for the project-investigation task-property mismatch
 * (detailsRes.data.project.tasks vs detailsRes.data.tasks).
 *
 * Scenarios:
 * 1. Project containing 2 tasks (proj-devpulse) is reported as having 2 tasks in Marathi and Hindi.
 * 2. Report does not claim 0 tasks or output "Insufficient Data" when tasks exist.
 * 3. Existing health status ('At Risk') and blockers are preserved.
 * 4. A genuinely empty project (0 tasks) still correctly reports 0 tasks and "Insufficient Data".
 * 5. Missing or malformed response data (null, undefined, non-array) handled safely without throwing.
 * 6. Both Marathi ('mr') and Hindi ('hi') paths in orchestrator.js pass and render detailsRes.data.project.tasks.
 * 7. Language-specific formatting, structure, and truthful score labels remain intact.
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
  NaturalResponseEngine
} from '../public/js/orchestrator.js';

describe('Phase A BUG-01: Project Investigation Task-Property Regression Suite', () => {
  let tempDir;
  let serverInstance;
  let client;
  let orchestrator;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-bug01-test-'));
    const storePath = path.join(tempDir, 'bug01-store.json');
    serverInstance = await createServer({ storePath, extendedTools: true });
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

  // =========================================================================
  // SCENARIO 1: Accurate task count for project with 2 tasks in MR and HI
  // =========================================================================
  test('Scenario 1: Project with 2 tasks (proj-devpulse) reports exactly 2 tasks in Marathi and Hindi', async () => {
    // 1. Marathi report via orchestrator workflow
    const mrOutcome = await orchestrator._workflowProjectInvestigation('DevPulse Analytics', 'mr');
    assert.equal(mrOutcome.workflow, 'project_investigation');
    assert.ok(
      mrOutcome.explanation.includes('• **नोंदणीकृत कामे (Tasks):** 2 एकूण'),
      `Expected Marathi output to report 2 tasks. Received:\n${mrOutcome.explanation}`
    );
    assert.ok(
      !mrOutcome.explanation.includes('• **नोंदणीकृत कामे (Tasks):** 0'),
      'Must NOT report 0 tasks when 2 tasks exist'
    );

    // 2. Hindi report via orchestrator workflow
    const hiOutcome = await orchestrator._workflowProjectInvestigation('DevPulse Analytics', 'hi');
    assert.equal(hiOutcome.workflow, 'project_investigation');
    assert.ok(
      hiOutcome.explanation.includes('• **कुल टास्क्स (Tasks):** 2'),
      `Expected Hindi output to report 2 tasks. Received:\n${hiOutcome.explanation}`
    );
    assert.ok(
      !hiOutcome.explanation.includes('• **कुल टास्क्स (Tasks):** 0'),
      'Must NOT report 0 tasks when 2 tasks exist'
    );
  });

  // =========================================================================
  // SCENARIO 2: Does not claim 0 tasks or Insufficient Data when tasks exist
  // =========================================================================
  test('Scenario 2: Report does not incorrectly claim 0 tasks or output Insufficient Data when tasks exist', async () => {
    const mrOutcome = await orchestrator._workflowProjectInvestigation('DevPulse Analytics', 'mr');
    assert.ok(
      !mrOutcome.explanation.includes('माहिती अपुरी आहे (Insufficient Data)'),
      'Marathi report must not output Insufficient Data when project has registered tasks'
    );
    assert.ok(
      !mrOutcome.explanation.includes('कोणतीही कामे (tasks) नोंदवलेली नाहीत'),
      'Marathi report must not state no tasks registered when project has 2 tasks'
    );

    const hiOutcome = await orchestrator._workflowProjectInvestigation('DevPulse Analytics', 'hi');
    assert.ok(
      !hiOutcome.explanation.includes('अपर्याप्त डेटा (Insufficient Data)'),
      'Hindi report must not output Insufficient Data when project has registered tasks'
    );
    assert.ok(
      !hiOutcome.explanation.includes('कोई टास्क्स दर्ज नहीं हैं'),
      'Hindi report must not state no tasks registered when project has 2 tasks'
    );
  });

  // =========================================================================
  // SCENARIO 3: Existing health status (At Risk) and blockers are preserved
  // =========================================================================
  test('Scenario 3: Preserves health status (At Risk) and blocker findings for blocked project', async () => {
    // proj-checkout has 1 critical blocker and status 'At Risk'
    const mrOutcome = await orchestrator._workflowProjectInvestigation('Mobile Checkout SDK', 'mr');
    assert.equal(mrOutcome.workflow, 'project_investigation');
    assert.ok(
      mrOutcome.explanation.includes('**आरोग्य दर्जा (Health):** At Risk (स्कोअर: N/A)'),
      `Expected At Risk with (स्कोअर: N/A). Received:\n${mrOutcome.explanation}`
    );
    assert.ok(
      mrOutcome.explanation.includes('**सक्रिय अडथळे (Blockers):** 1'),
      'Expected 1 active blocker in Marathi'
    );
    assert.ok(
      mrOutcome.explanation.includes('[गंभीर अडथळा / Critical Blocker]'),
      'Expected critical blocker header in Marathi'
    );
    assert.ok(
      mrOutcome.explanation.includes('Upstream identity service v2 rejects concurrent token refresh calls with HTTP 429.'),
      'Expected verified blocker evidence reason in Marathi'
    );

    const hiOutcome = await orchestrator._workflowProjectInvestigation('Mobile Checkout SDK', 'hi');
    assert.equal(hiOutcome.workflow, 'project_investigation');
    assert.ok(
      hiOutcome.explanation.includes('**हेल्थ स्थिति (Health):** At Risk (स्कोर: N/A)'),
      `Expected At Risk with (स्कोर: N/A). Received:\n${hiOutcome.explanation}`
    );
    assert.ok(
      hiOutcome.explanation.includes('**सक्रिय ब्लॉकर्स (Blockers):** 1'),
      'Expected 1 active blocker in Hindi'
    );
    assert.ok(
      hiOutcome.explanation.includes('[क्रिटिकल ब्लॉकर / Critical Blocker]'),
      'Expected critical blocker header in Hindi'
    );

    // English direct engine format
    const engine = new NaturalResponseEngine();
    const enReport = engine.formatInvestigationReport({
      project: { name: 'Mobile Checkout SDK', status: 'active' },
      health: { healthStatus: 'At Risk' },
      blockers: [{ id: 'task-checkout-oauth', title: 'OAuth race', blockerReason: 'HTTP 429' }],
      tasks: [{ id: 'task-1' }, { id: 'task-2' }],
      language: 'en'
    });
    assert.ok(enReport.includes('**Health Classification:** `At Risk` (Score: N/A)'));
    assert.ok(enReport.includes('**Registered Tasks:** 2 total | **Active Blockers:** 1'));
    assert.ok(enReport.includes('[CRITICAL BLOCKER] OAuth race'));
  });

  // =========================================================================
  // SCENARIO 4: Genuinely empty project (0 tasks) correctly reports 0 tasks
  // =========================================================================
  test('Scenario 4: Genuinely empty project (0 tasks) still correctly reports 0 tasks and Insufficient Data', async () => {
    // Create a new project with zero tasks
    const createRes = await client.callTool('create_project', {
      name: 'Empty Zero Task Project',
      description: 'Project specifically created with zero tasks',
      category: 'Research',
      priority: 'low'
    });
    const emptyProjId = createRes.data?.project?.id;
    assert.ok(emptyProjId, 'Project creation must return project id');

    // 1. Marathi check
    const mrOutcome = await orchestrator._workflowProjectInvestigation('Empty Zero Task Project', 'mr');
    assert.ok(
      mrOutcome.explanation.includes('• **नोंदणीकृत कामे (Tasks):** 0 एकूण'),
      `Expected 0 tasks for empty project in Marathi. Received:\n${mrOutcome.explanation}`
    );
    assert.ok(
      mrOutcome.explanation.includes('ℹ️ **माहिती अपुरी आहे (Insufficient Data):** या प्रोजेक्टमध्ये कोणतीही कामे (tasks) नोंदवलेली नाहीत'),
      'Must display Insufficient Data alert when project genuinely has 0 tasks'
    );
    assert.ok(
      mrOutcome.explanation.includes('**आरोग्य दर्जा (Health):** Insufficient Data (स्कोअर: N/A)'),
      'Health status must be Insufficient Data for zero-task project'
    );

    // 2. Hindi check
    const hiOutcome = await orchestrator._workflowProjectInvestigation('Empty Zero Task Project', 'hi');
    assert.ok(
      hiOutcome.explanation.includes('• **कुल टास्क्स (Tasks):** 0'),
      `Expected 0 tasks for empty project in Hindi. Received:\n${hiOutcome.explanation}`
    );
    assert.ok(
      hiOutcome.explanation.includes('ℹ️ **अपर्याप्त डेटा (Insufficient Data):** इस प्रोजेक्ट में कोई टास्क्स दर्ज नहीं हैं'),
      'Must display Insufficient Data alert when project genuinely has 0 tasks'
    );
    assert.ok(
      hiOutcome.explanation.includes('**हेल्थ स्थिति (Health):** Insufficient Data (स्कोर: N/A)'),
      'Health status must be Insufficient Data in Hindi for zero-task project'
    );

    // 3. English engine check
    const engine = new NaturalResponseEngine();
    const enReport = engine.formatInvestigationReport({
      project: { name: 'Empty Zero Task Project', status: 'planning' },
      health: { healthStatus: 'Insufficient Data' },
      blockers: [],
      tasks: [],
      language: 'en'
    });
    assert.ok(enReport.includes('**Registered Tasks:** 0 total | **Active Blockers:** 0'));
    assert.ok(enReport.includes('ℹ️ **Insufficient Data:** Project has 0 registered tasks.'));
    assert.ok(enReport.includes('**Health Classification:** `Insufficient Data` (Score: N/A)'));
  });

  // =========================================================================
  // SCENARIO 5: Missing or malformed response data handled safely
  // =========================================================================
  test('Scenario 5: Missing or malformed response data handled safely without throwing', () => {
    const engine = new NaturalResponseEngine();

    const malformedInputs = [
      { project: null, health: null, blockers: null, tasks: null },
      { project: undefined, health: undefined, blockers: undefined, tasks: undefined },
      { project: {}, health: {}, blockers: 'not-an-array', tasks: 'not-an-array' },
      { project: { name: 'Broken' }, health: { healthStatus: 'At Risk', score: undefined }, blockers: null, tasks: 42 },
      { project: { name: 'Score Present' }, health: { healthStatus: 'Healthy', score: 85 }, blockers: [], tasks: [{ id: '1' }] }
    ];

    for (const input of malformedInputs) {
      for (const lang of ['en', 'mr', 'hi', 'hinglish', 'marathiglish']) {
        assert.doesNotThrow(() => {
          const res = engine.formatInvestigationReport({ ...input, language: lang });
          assert.equal(typeof res, 'string', 'Must always return a valid string');
          assert.ok(res.length > 0, 'Report string must not be empty');
        }, `formatInvestigationReport threw with lang=${lang} on input ${JSON.stringify(input)}`);
      }
    }
  });

  // =========================================================================
  // SCENARIO 6: Both Marathi and Hindi paths in orchestrator.js pass tasks
  // =========================================================================
  test('Scenario 6: Both Marathi (mr) and Hindi (hi) paths in orchestrator.js pass and render detailsRes.data.project.tasks', async () => {
    // 1. Direct workflow method verification for Marathi ('mr')
    const mrDirect = await orchestrator._workflowProjectInvestigation('DevPulse Analytics', 'mr');
    assert.equal(mrDirect.workflow, 'project_investigation');
    assert.ok(
      mrDirect.explanation.includes('• **नोंदणीकृत कामे (Tasks):** 2 एकूण'),
      `Expected 2 tasks in Marathi direct call. Received:\n${mrDirect.explanation}`
    );
    assert.ok(
      mrDirect.toolCalls.some(tc => tc.name === 'get_project_details'),
      'Must have invoked get_project_details MCP tool'
    );

    // 2. Direct workflow method verification for Hindi ('hi')
    const hiDirect = await orchestrator._workflowProjectInvestigation('DevPulse Analytics', 'hi');
    assert.equal(hiDirect.workflow, 'project_investigation');
    assert.ok(
      hiDirect.explanation.includes('• **कुल टास्क्स (Tasks):** 2'),
      `Expected 2 tasks in Hindi direct call. Received:\n${hiDirect.explanation}`
    );
    assert.ok(
      hiDirect.toolCalls.some(tc => tc.name === 'get_project_details'),
      'Must have invoked get_project_details MCP tool'
    );

    // 3. End-to-end natural language dispatch (Marathi phrasing)
    const mrResult = await orchestrator.process('DevPulse Analytics cha status sanga');
    assert.equal(mrResult.workflow, 'project_investigation');
    assert.ok(
      mrResult.explanation.includes('• **नोंदणीकृत कामे (Tasks):** 2 एकूण'),
      `Expected 2 tasks in Marathi end-to-end response. Received:\n${mrResult.explanation}`
    );

    // 4. End-to-end natural language dispatch (Hindi phrasing)
    const hiResult = await orchestrator.process('DevPulse Analytics ka status batao');
    assert.equal(hiResult.workflow, 'project_investigation');
    assert.ok(
      hiResult.explanation.includes('• **कुल टास्क्स (Tasks):** 2'),
      `Expected 2 tasks in Hindi end-to-end response. Received:\n${hiResult.explanation}`
    );
  });

  // =========================================================================
  // SCENARIO 7: Language-specific formatting, structure, and score labels
  // =========================================================================
  test('Scenario 7: Language-specific formatting, structure, and score labels are preserved', () => {
    const engine = new NaturalResponseEngine();

    // With score = undefined -> Score: N/A / (स्कोअर: N/A) / (स्कोर: N/A)
    const mrReport = engine.formatInvestigationReport({
      project: { name: 'CloudSync Gateway', status: 'active' },
      health: { healthStatus: 'Healthy' },
      blockers: [],
      tasks: [{ id: 't1' }, { id: 't2' }],
      language: 'mr'
    });
    assert.ok(mrReport.startsWith('### 🔍 **CloudSync Gateway — तपासणी अहवाल**'));
    assert.ok(mrReport.includes('• **सद्यस्थिती:** ACTIVE | **आरोग्य दर्जा (Health):** Healthy (स्कोअर: N/A)'));
    assert.ok(mrReport.includes('• **नोंदणीकृत कामे (Tasks):** 2 एकूण | **सक्रिय अडथळे (Blockers):** 0'));
    assert.ok(mrReport.includes('✅ **सर्व प्रणाली सामान्य:** सध्या कोणताही सक्रिय अडथळा आढळला नाही.'));
    assert.ok(mrReport.includes('#### 💡 **पुढील शिफारसी (Recommended Next Actions):**'));

    const hiReport = engine.formatInvestigationReport({
      project: { name: 'CloudSync Gateway', status: 'active' },
      health: { healthStatus: 'Healthy' },
      blockers: [],
      tasks: [{ id: 't1' }, { id: 't2' }],
      language: 'hi'
    });
    assert.ok(hiReport.startsWith('### 🔍 **CloudSync Gateway — प्रोजेक्ट जाँच रिपोर्ट**'));
    assert.ok(hiReport.includes('• **स्टेटस:** ACTIVE | **हेल्थ स्थिति (Health):** Healthy (स्कोर: N/A)'));
    assert.ok(hiReport.includes('• **कुल टास्क्स (Tasks):** 2 | **सक्रिय ब्लॉकर्स (Blockers):** 0'));
    assert.ok(hiReport.includes('✅ **सिस्टम सुचारू:** प्रोजेक्ट में कोई सक्रिय ब्लॉकर नहीं है।'));
    assert.ok(hiReport.includes('#### 💡 **सुझावित अगले कदम (Recommended Next Steps):**'));

    // When score is explicitly supplied (e.g. 92)
    const mrReportWithScore = engine.formatInvestigationReport({
      project: { name: 'CloudSync Gateway', status: 'active' },
      health: { healthStatus: 'Healthy', score: 92 },
      blockers: [],
      tasks: [{ id: 't1' }],
      language: 'mr'
    });
    assert.ok(mrReportWithScore.includes('(स्कोअर: 92/100)'));

    const hiReportWithScore = engine.formatInvestigationReport({
      project: { name: 'CloudSync Gateway', status: 'active' },
      health: { healthStatus: 'Healthy', score: 92 },
      blockers: [],
      tasks: [{ id: 't1' }],
      language: 'hi'
    });
    assert.ok(hiReportWithScore.includes('(स्कोर: 92/100)'));

    const enReportWithScore = engine.formatInvestigationReport({
      project: { name: 'CloudSync Gateway', status: 'active' },
      health: { healthStatus: 'Healthy', score: 92 },
      blockers: [],
      tasks: [{ id: 't1' }],
      language: 'en'
    });
    assert.ok(enReportWithScore.includes('(Score: 92/100)'));
  });
});
