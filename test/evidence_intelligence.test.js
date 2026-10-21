/**
 * ProjectPilot AI - Evidence-Based Project Intelligence & Truthful Health Tests
 * Verifies:
 * 1. Project with zero tasks receives 'Insufficient Data' (never an unjustified 'Healthy').
 * 2. Accurate task progress computation on registered tasks.
 * 3. Health Classification Precedence:
 *    - Active critical blocker at 80% completion -> At Risk
 *    - Active critical blocker at 100% completion -> At Risk
 *    - Overdue critical work -> At Risk
 *    - Unresolved critical bug -> At Risk
 *    - Ordinary overdue tasks -> Attention Needed
 *    - Noncritical blockers or unresolved noncritical bugs -> Attention Needed
 *    - Sufficient assessment data, no material risks -> Healthy
 *    - Active vs resolved blockers
 *    - Completed tasks with old due dates (never overdue)
 * 4. Honest reporting of missing metadata and data completeness audit.
 * 5. Accurate source code inspection status ('Source code not inspected').
 * 6. Repository metadata clearly distinguished from source-code analysis.
 * 7. Real judge-created dynamic projects investigated accurately via natural language.
 * 8. Status distribution handles 'Insufficient Data' in aggregate health.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../src/server.js';
import { McpBrowserClient } from '../public/js/api/mcpClient.js';
import { AssistantOrchestrator } from '../public/js/orchestrator.js';
import { ProjectStore } from '../src/db/store.js';
import { HealthService } from '../src/services/healthService.js';

describe('Evidence-Based Project Intelligence & Truthful Health', () => {
  let tempDir;
  let serverInstance;
  let client;
  let orchestrator;
  let storePath;
  let store;
  let healthService;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-evidence-test-'));
    storePath = path.join(tempDir, 'evidence-store.json');
    serverInstance = await createServer({ storePath });
    const addr = await serverInstance.start(0);

    const mcpUrl = `http://localhost:${addr.port}/mcp`;
    client = new McpBrowserClient(mcpUrl);
    await client.connect();
    orchestrator = new AssistantOrchestrator(client);

    store = new ProjectStore(storePath);
    await store.init();
    healthService = new HealthService(store);
  });

  after(async () => {
    if (serverInstance) {
      await serverInstance.stop();
    }
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('1. Health Model Correctness for Zero-Task Projects', () => {
    test('Scenario 1 & 9: Project with zero registered tasks reports Insufficient Data, not Healthy', async () => {
      const proj = await store.createProject({
        name: 'Judge Zero Task Project',
        description: 'Clean project created with no recorded tasks',
        category: 'Backend'
      });

      const health = healthService.getHealth(proj.id);

      assert.notEqual(health.healthStatus, 'Healthy', 'Zero-task project must NEVER be classified as Healthy');
      assert.equal(health.healthStatus, 'Insufficient Data');
      assert.equal(health.metrics.totalTasks, 0);
      assert.equal(health.metrics.taskProgress, 'No task data');
      assert.equal(health.metrics.completionRate, 0);
      assert.ok(
        health.statusReasons.includes('No registered tasks are available to evaluate progress.'),
        'Must provide explicit reason explaining lack of tasks'
      );
      assert.ok(health.evidence.dataCompleteness.missingFields.some(f => f.includes('tasks')));
    });
  });

  describe('2. Accurate Task Progress on Registered Tasks', () => {
    test('Calculates truthful task progress and completion rate', async () => {
      const proj = await store.createProject({
        name: 'Progress Verification Project',
        category: 'Fullstack'
      });

      // Add 4 tasks: 3 done, 1 in_progress
      await store.createTask({ projectId: proj.id, title: 'Task 1', status: 'done' });
      await store.createTask({ projectId: proj.id, title: 'Task 2', status: 'done' });
      await store.createTask({ projectId: proj.id, title: 'Task 3', status: 'done' });
      await store.createTask({ projectId: proj.id, title: 'Task 4', status: 'in_progress' });

      const health = healthService.getHealth(proj.id);

      assert.equal(health.metrics.totalTasks, 4);
      assert.equal(health.metrics.completedCount, 3);
      assert.equal(health.metrics.incompleteCount, 1);
      assert.equal(health.metrics.completionRate, 75);
      assert.equal(health.metrics.taskProgress, '75% (3/4 completed)');
      assert.equal(health.healthStatus, 'Healthy');
    });
  });

  describe('3. Health Classification Precedence Scenarios', () => {
    test('Scenario 2: 80% completion with an active critical blocker is At Risk', async () => {
      const proj = await store.createProject({
        name: 'Eighty Percent Critical Blocker Project',
        category: 'Mobile'
      });

      // 4 completed, 1 critical blocked (80% completion)
      await store.createTask({ projectId: proj.id, title: 'Task 1', status: 'done' });
      await store.createTask({ projectId: proj.id, title: 'Task 2', status: 'done' });
      await store.createTask({ projectId: proj.id, title: 'Task 3', status: 'done' });
      await store.createTask({ projectId: proj.id, title: 'Task 4', status: 'done' });
      await store.createTask({
        projectId: proj.id,
        title: 'Payment Gateway Integration',
        priority: 'critical',
        status: 'blocked',
        blocker: 'Merchant sandbox credentials pending verification from upstream provider'
      });

      const health = healthService.getHealth(proj.id);
      assert.equal(health.metrics.completionRate, 80);
      assert.equal(health.healthStatus, 'At Risk');
      assert.equal(health.metrics.criticalBlockerCount, 1);
      assert.ok(health.statusReasons.some(r => r.includes('active blocker')));
    });

    test('Scenario 3: 100% completion with an active critical blocker is At Risk', async () => {
      const proj = await store.createProject({
        name: 'Hundred Percent Critical Blocker Project',
        category: 'Infrastructure'
      });

      // Task completed but flagged with an active critical blocker
      await store.createTask({
        projectId: proj.id,
        title: 'Production Deployment Task',
        priority: 'critical',
        status: 'done',
        blocker: 'Upstream gateway TLS certificate revoked'
      });

      const health = healthService.getHealth(proj.id);
      assert.equal(health.metrics.completionRate, 100);
      assert.equal(health.healthStatus, 'At Risk');
      assert.equal(health.metrics.criticalBlockerCount, 1);
      assert.ok(health.statusReasons.some(r => r.includes('active blocker')));
    });

    test('Scenario 4: Overdue critical work triggers At Risk', async () => {
      const proj = await store.createProject({
        name: 'Overdue Critical Task Project',
        category: 'Security'
      });

      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      await store.createTask({
        projectId: proj.id,
        title: 'Patch CVE vulnerability in auth middleware',
        status: 'in_progress',
        priority: 'critical',
        dueDate: threeDaysAgo
      });

      const health = healthService.getHealth(proj.id);
      assert.equal(health.healthStatus, 'At Risk');
      assert.equal(health.metrics.overdueCount, 1);
      assert.ok(health.statusReasons.some(r => r.includes('critical/high priority')));
    });

    test('Scenario 5: Unresolved critical bug triggers At Risk', async () => {
      const proj = await store.createProject({
        name: 'Critical Bug Project',
        category: 'Core'
      });

      await store.createTask({
        projectId: proj.id,
        title: 'Data corruption under concurrent writes',
        status: 'in_progress',
        priority: 'critical',
        isBug: true
      });

      const health = healthService.getHealth(proj.id);
      assert.equal(health.healthStatus, 'At Risk');
      assert.equal(health.metrics.criticalBugCount, 1);
      assert.ok(health.statusReasons.some(r => r.includes('critical user-recorded bug(s) open')));
    });

    test('Scenario 6: Ordinary overdue tasks trigger Attention Needed when no critical risks exist', async () => {
      const proj = await store.createProject({
        name: 'Overdue Medium Task Project',
        category: 'DevOps'
      });

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      await store.createTask({
        projectId: proj.id,
        title: 'Log rotation cleanup',
        status: 'todo',
        priority: 'medium',
        dueDate: yesterday
      });

      const health = healthService.getHealth(proj.id);
      assert.equal(health.healthStatus, 'Attention Needed');
      assert.equal(health.metrics.overdueCount, 1);
      assert.ok(health.statusReasons.some(r => r.includes('1 overdue task(s) past deadline')));
    });

    test('Scenario 7: Noncritical blockers trigger Attention Needed', async () => {
      const proj = await store.createProject({
        name: 'Noncritical Blocker Project',
        category: 'UI'
      });

      await store.createTask({
        projectId: proj.id,
        title: 'Style icon asset update',
        status: 'blocked',
        priority: 'medium',
        blocker: 'Waiting on SVG export from designer'
      });

      const health = healthService.getHealth(proj.id);
      assert.equal(health.healthStatus, 'Attention Needed');
      assert.equal(health.metrics.nonCriticalBlockerCount, 1);
      assert.equal(health.metrics.criticalBlockerCount, 0);
      assert.ok(health.statusReasons.some(r => r.includes('active non-critical blocker')));
    });

    test('Scenario 7: Unresolved noncritical bugs trigger Attention Needed', async () => {
      const proj = await store.createProject({
        name: 'Noncritical Bug Project',
        category: 'Frontend'
      });

      await store.createTask({
        projectId: proj.id,
        title: 'Tooltip alignment offset by 2px',
        status: 'todo',
        priority: 'low',
        isBug: true
      });

      const health = healthService.getHealth(proj.id);
      assert.equal(health.healthStatus, 'Attention Needed');
      assert.ok(health.statusReasons.some(r => r.includes('user-recorded bug(s) pending resolution')));
    });

    test('Scenario 8: Sufficient assessment data and no material risks reports Healthy', async () => {
      const proj = await store.createProject({
        name: 'Model Healthy Project',
        category: 'Services'
      });

      await store.createTask({ projectId: proj.id, title: 'API spec review', status: 'done' });
      await store.createTask({ projectId: proj.id, title: 'Endpoint implementation', status: 'done' });

      const health = healthService.getHealth(proj.id);
      assert.equal(health.healthStatus, 'Healthy');
      assert.equal(health.metrics.completionRate, 100);
      assert.ok(health.statusReasons.includes('All recorded tasks proceeding with no open blockers or overdue deadlines'));
    });

    test('Edge Case: Active versus resolved blockers', async () => {
      const proj = await store.createProject({
        name: 'Resolved Blocker Edge Case',
        category: 'Data'
      });

      // Task with resolved blocker flag
      await store.createTask({
        projectId: proj.id,
        title: 'Migrate DB records',
        status: 'in_progress',
        priority: 'critical',
        blocker: 'resolved'
      });

      const health = healthService.getHealth(proj.id);
      assert.equal(health.metrics.explicitBlockers.length, 0, 'Resolved blocker must not be counted as active blocker');
      assert.equal(health.metrics.criticalBlockerCount, 0);
    });

    test('Edge Case: Completed tasks with past due dates are never counted as overdue', async () => {
      const proj = await store.createProject({
        name: 'Completed Overdue Edge Case',
        category: 'Release'
      });

      const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      await store.createTask({
        projectId: proj.id,
        title: 'Release v1.0.0',
        status: 'done',
        priority: 'critical',
        dueDate: lastMonth
      });

      const health = healthService.getHealth(proj.id);
      assert.equal(health.metrics.overdueCount, 0, 'Completed tasks must never be marked overdue');
      assert.equal(health.healthStatus, 'Healthy');
    });

    test('Edge Case: Tasks with missing due dates are not counted as overdue', async () => {
      const proj = await store.createProject({
        name: 'Missing Due Date Edge Case',
        category: 'Design'
      });

      await store.createTask({
        projectId: proj.id,
        title: 'Design wireframes',
        status: 'in_progress',
        priority: 'high',
        dueDate: null
      });

      const health = healthService.getHealth(proj.id);
      assert.equal(health.metrics.overdueCount, 0);
    });
  });

  describe('4. Data Completeness & Missing Metadata Audit', () => {
    test('Identifies missing metadata vs missing task records honestly', async () => {
      const minimalProj = await store.createProject({
        name: 'Barebones Project'
        // description, category, techStack, repoUrl omitted
      });

      const health = healthService.getHealth(minimalProj.id);
      const completeness = health.evidence.dataCompleteness;

      assert.equal(completeness.rating, 'Minimal');
      assert.ok(completeness.missingMetadata.includes('description'));
      assert.ok(completeness.missingMetadata.includes('category'));
      assert.ok(completeness.missingMetadata.includes('techStack'));
      assert.ok(completeness.missingMetadata.includes('repoUrl'));
      assert.equal(completeness.hasTaskRecords, false);
      assert.ok(completeness.percentage <= 40);
    });

    test('Reports Complete rating when all core fields and tasks are registered', async () => {
      const fullProj = await store.createProject({
        name: 'Fully Specified Project',
        description: 'Complete production spec for automated testing',
        category: 'Fullstack',
        techStack: ['Node.js', 'PostgreSQL'],
        repoUrl: 'https://github.com/example/full-spec'
      });
      await store.createTask({ projectId: fullProj.id, title: 'Initial setup', status: 'done' });

      const health = healthService.getHealth(fullProj.id);
      const completeness = health.evidence.dataCompleteness;

      assert.equal(completeness.rating, 'Complete');
      assert.equal(completeness.missingFields.length, 0);
      assert.equal(completeness.hasTaskRecords, true);
      assert.equal(completeness.percentage, 100);
    });
  });

  describe('5. Evidence Audit: Source Code and Repository Truthfulness', () => {
    test('Explicitly reports that source code was not inspected', async () => {
      const proj = await store.createProject({
        name: 'Audit Integrity Project',
        techStack: ['Rust', 'WebAssembly']
      });

      const health = healthService.getHealth(proj.id);

      assert.equal(
        health.evidence.sourceInspectionStatus,
        'Source code not inspected (no repository analyzer connected)'
      );
      assert.ok(health.evidence.securityAuditStatus.includes('Unverified'));
      assert.ok(health.evidence.testAuditStatus.includes('No automated test audit'));
      assert.ok(health.evidence.maintenanceAuditStatus.includes('user-registered tasks only'));
    });

    test('Repository URL is recorded but clearly audited as uninspected remote code', async () => {
      const proj = await store.createProject({
        name: 'Repo Linked Project',
        repoUrl: 'https://github.com/judge-eval/service-alpha'
      });

      const health = healthService.getHealth(proj.id);
      assert.ok(health.evidence.repositoryStatus.includes('Registered remote URL'));
      assert.ok(health.evidence.repositoryStatus.includes('uninspected'));
    });

    test('Missing repository URL is audited as Repository not connected', async () => {
      const proj = await store.createProject({
        name: 'No Repo Project'
      });

      const health = healthService.getHealth(proj.id);
      assert.equal(health.evidence.repositoryStatus, 'Repository not connected');
    });
  });

  describe('6. Real Judge-Created Project via Assistant Natural-Language Investigation', () => {
    test('Investigates judge-created project with only name, description, and repoUrl', async () => {
      // Judge creates dynamic project with only:
      // * Project name
      // * Short description
      // * Repository URL
      const judgeProj = await client.callTool('create_project', {
        name: 'Judge Evaluation Engine',
        description: 'Custom evaluation harness submitted by hackathon judge',
        repoUrl: 'https://github.com/hackathon-judge/eval-engine'
      });
      const judgeProjData = judgeProj.data?.project;
      assert.ok(judgeProjData?.id);

      // Conversational investigation query
      const outcome = await orchestrator.process('Investigate Judge Evaluation Engine');

      assert.equal(outcome.workflow, 'project_investigation');
      assert.ok(outcome.explanation.includes('### Project Health & Intelligence Report: Judge Evaluation Engine'));

      // 1. Explicit bracketed evidence labels
      assert.ok(outcome.explanation.includes('[Verified from project records]'));
      assert.ok(outcome.explanation.includes('[Calculated from registered tasks]'));
      assert.ok(outcome.explanation.includes('[Source code not inspected]'));
      assert.ok(outcome.explanation.includes('[Insufficient data]'));

      // 2. Truthful health & progress for zero tasks
      assert.ok(outcome.explanation.includes('• **Derived Health:** **Insufficient Data**'));
      assert.ok(outcome.explanation.includes('• **Task Progress:** No task data'));
      assert.ok(outcome.explanation.includes('No registered tasks are available to evaluate progress.'));

      // 3. Registered repository URL reported accurately
      assert.ok(outcome.explanation.includes('https://github.com/hackathon-judge/eval-engine'));
      assert.ok(outcome.explanation.includes('[Registered remote URL]'));

      // 4. Missing fields reported honestly
      assert.ok(outcome.explanation.includes('Missing Project Records:'));
      assert.ok(outcome.explanation.includes('techStack'));
      assert.ok(outcome.explanation.includes('tasks'));

      // 5. Cautionary disclaimer regarding absence of bugs != bug-free code (Scenario 10)
      assert.ok(outcome.explanation.includes('A lack of recorded bugs or blockers does NOT indicate that the software is bug-free'));
    });

    test('Investigates dynamic project with active blocker and surfaces blocker details', async () => {
      const dynamicProj = await client.callTool('create_project', {
        name: 'Judge Production Pipeline',
        category: 'DevOps',
        techStack: ['GitHub Actions', 'Terraform', 'AWS ECS']
      });
      const projId = dynamicProj.data?.project?.id;
      assert.ok(projId);

      // Add a blocked task with high priority (critical blocker)
      await client.callTool('create_task', {
        projectId: projId,
        title: 'Provision multi-region RDS read replica',
        priority: 'high',
        status: 'blocked',
        blocker: 'AWS account service quota for db.m5.large instances exceeded'
      });

      const outcome = await orchestrator.process('Inspect project Judge Production Pipeline');

      assert.equal(outcome.workflow, 'project_investigation');
      assert.ok(outcome.explanation.includes('Judge Production Pipeline'));
      assert.ok(outcome.explanation.includes('• **Derived Health:** **At Risk**'));
      assert.ok(outcome.explanation.includes('Active Blockers: 1'));
      assert.ok(outcome.explanation.includes('AWS account service quota for db.m5.large instances exceeded'));
      assert.ok(outcome.explanation.includes('[Calculated from registered tasks]'));
      assert.ok(outcome.explanation.includes('[Source code not inspected]'));
    });
  });

  describe('7. Aggregate Health Distribution', () => {
    test('Aggregate health includes insufficientData in statusDistribution', () => {
      const allHealth = healthService.getHealth();
      assert.equal(allHealth.scope, 'all_projects');
      assert.ok('insufficientData' in allHealth.aggregate.statusDistribution);
      assert.ok('healthy' in allHealth.aggregate.statusDistribution);
      assert.ok('attentionNeeded' in allHealth.aggregate.statusDistribution);
      assert.ok('atRisk' in allHealth.aggregate.statusDistribution);

      const dist = allHealth.aggregate.statusDistribution;
      const distSum = dist.healthy + dist.attentionNeeded + dist.atRisk + dist.insufficientData;
      assert.equal(distSum, allHealth.aggregate.totalProjects, 'Status distribution sum must equal totalProjects');
    });
  });

  describe('8. MCP Protocol Tool Compatibility', () => {
    test('MCP Tool get_project_health returns upgraded evidence and status', async () => {
      const projRes = await client.callTool('create_project', {
        name: 'MCP Health Protocol Test'
      });
      const projId = projRes.data?.project?.id;
      assert.ok(projId);

      const healthRes = await client.callTool('get_project_health', { projectId: projId });
      assert.equal(healthRes.isError, undefined);
      const parsedHealth = healthRes.data;

      assert.equal(parsedHealth.healthStatus, 'Insufficient Data');
      assert.equal(parsedHealth.metrics.taskProgress, 'No task data');
      assert.equal(parsedHealth.evidence.sourceInspectionStatus, 'Source code not inspected (no repository analyzer connected)');
      assert.ok(parsedHealth.evidence.dataCompleteness.missingFields.length > 0);
    });
  });
});
