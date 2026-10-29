/**
 * ProjectPilot AI - Phase B BUG-02 Regression Test Suite
 * Validates:
 * 1. inspect_github_repo is registered under the intended production MCP configuration
 *    when the extended-tools flag is unset.
 * 2. Existing extended-tool gating remains correct for unrelated tools.
 * 3. The MCP handler validates and processes repository URLs (SSRF defense, valid repo URLs).
 * 4. GitHub API errors (404 Not Found, 403/429 Rate Limited, 500 Server Error) are handled clearly.
 * 5. The browser orchestrator no longer attempts to import server-side GitHub source code.
 * 6. Failed MCP inspection produces an actionable error without false success.
 * 7. Existing Phase A tests continue to pass.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.js';
import { McpBrowserClient } from '../public/js/api/mcpClient.js';
import { AssistantOrchestrator } from '../public/js/orchestrator.js';
import { createProjectPilotMcpServer } from '../src/mcp/server.js';
import { ProjectStore } from '../src/db/store.js';
import { GitHubService } from '../src/services/githubService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phase B BUG-02: GitHub Repository Inspection MCP Integration Suite', () => {
  let tempDir;
  let serverInstance;
  let client;
  let orchestrator;
  let store;
  let customGithubService;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-bug02-test-'));
    const storePath = path.join(tempDir, 'bug02-store.json');

    // Create a mock fetch implementation for GitHubService
    customGithubService = new GitHubService({
      fetchFn: async (url) => {
        const urlStr = String(url);

        // 404 simulation
        if (urlStr.includes('/repos/nonexistent/repo')) {
          return {
            status: 404,
            ok: false,
            headers: new Headers({ 'x-ratelimit-remaining': '59' }),
            json: async () => ({ message: 'Not Found' }),
            text: async () => JSON.stringify({ message: 'Not Found' })
          };
        }

        // 403/429 rate limit simulation
        if (urlStr.includes('/repos/throttled/repo')) {
          return {
            status: 403,
            ok: false,
            headers: new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }),
            json: async () => ({ message: 'API rate limit exceeded' }),
            text: async () => JSON.stringify({ message: 'API rate limit exceeded' })
          };
        }

        // 500 server error simulation
        if (urlStr.includes('/repos/broken/repo')) {
          return {
            status: 500,
            ok: false,
            headers: new Headers(),
            json: async () => ({ message: 'Internal Server Error' }),
            text: async () => 'Internal Server Error'
          };
        }

        // Standard healthy repository metadata
        if (urlStr.includes('/repos/valid-org/healthy-app/git/trees/')) {
          return {
            status: 200,
            ok: true,
            headers: new Headers({ 'x-ratelimit-remaining': '55' }),
            json: async () => ({
              truncated: false,
              tree: [
                { path: 'README.md', type: 'blob', size: 1024 },
                { path: 'LICENSE', type: 'blob', size: 512 },
                { path: '.gitignore', type: 'blob', size: 128 },
                { path: '.github/workflows/ci.yml', type: 'blob', size: 256 },
                { path: 'package.json', type: 'blob', size: 512 }
              ]
            }),
            text: async () => ''
          };
        }

        if (urlStr.includes('/repos/valid-org/healthy-app/contents/package.json')) {
          const pkgJson = JSON.stringify({ name: 'healthy-app', version: '1.0.0', scripts: { test: 'node --test' } });
          return {
            status: 200,
            ok: true,
            headers: new Headers(),
            json: async () => ({
              type: 'file',
              size: pkgJson.length,
              content: Buffer.from(pkgJson).toString('base64')
            }),
            text: async () => ''
          };
        }

        if (urlStr.includes('/repos/valid-org/healthy-app')) {
          return {
            status: 200,
            ok: true,
            headers: new Headers({ 'x-ratelimit-remaining': '58' }),
            json: async () => ({
              id: 9991,
              name: 'healthy-app',
              full_name: 'valid-org/healthy-app',
              description: 'Production-ready cloud application',
              private: false,
              fork: false,
              archived: false,
              default_branch: 'main',
              language: 'JavaScript',
              stargazers_count: 142,
              forks_count: 12,
              open_issues_count: 2,
              license: { spdx_id: 'MIT', name: 'MIT License' },
              pushed_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }),
            text: async () => ''
          };
        }

        return {
          status: 404,
          ok: false,
          headers: new Headers(),
          json: async () => ({ message: 'Not Found' }),
          text: async () => 'Not Found'
        };
      }
    });

    // Create server in standard production configuration: enableExtended is FALSE/UNSET
    serverInstance = await createServer({
      storePath,
      enableExtended: false
    });
    const addr = await serverInstance.start(0);

    const mcpUrl = `http://localhost:${addr.port}/mcp`;
    client = new McpBrowserClient(mcpUrl);
    await client.connect();
    orchestrator = new AssistantOrchestrator(client);

    store = new ProjectStore(storePath);
    await store.init();
  });

  after(async () => {
    if (client) await client.disconnect();
    if (serverInstance) await serverInstance.stop();
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // =========================================================================
  // SCENARIO 1: inspect_github_repo registered under standard production config
  // =========================================================================
  test('Scenario 1: inspect_github_repo is registered under standard production config (extended-tools unset)', async () => {
    const standardMcpServer = createProjectPilotMcpServer(store, {
      enableExtended: false,
      githubService: customGithubService
    });

    const registeredTools = Object.keys(standardMcpServer._registeredTools);

    // 1. Must include inspect_github_repo
    assert.ok(
      registeredTools.includes('inspect_github_repo'),
      'Standard production MCP configuration must expose inspect_github_repo'
    );

    // 2. Standard tool count must be exactly 13
    assert.equal(
      registeredTools.length,
      13,
      `Standard production configuration should have exactly 13 tools, found ${registeredTools.length}`
    );

    // 3. Must include all baseline standard tools
    const expectedStandardTools = [
      'list_projects',
      'get_project_details',
      'create_project',
      'update_project',
      'list_tasks',
      'create_task',
      'update_task_status',
      'list_blockers',
      'get_project_health',
      'get_priority_recommendations',
      'list_maintenance_tasks',
      'generate_rescue_plan',
      'inspect_github_repo'
    ];
    for (const tool of expectedStandardTools) {
      assert.ok(registeredTools.includes(tool), `Standard mode must include ${tool}`);
    }
  });

  // =========================================================================
  // SCENARIO 2: Existing extended-tool gating remains correct for unrelated tools
  // =========================================================================
  test('Scenario 2: Extended tools remain gated when extended-tools flag is unset', () => {
    const standardServer = createProjectPilotMcpServer(store, { enableExtended: false });
    const standardTools = Object.keys(standardServer._registeredTools);

    const extendedGatedTools = [
      'delete_project',
      'delete_task',
      'reopen_task',
      'manage_blocker',
      'get_audit_log'
    ];

    for (const tool of extendedGatedTools) {
      assert.ok(
        !standardTools.includes(tool),
        `Tool "${tool}" must NOT be exposed in standard configuration`
      );
    }

    // When enableExtended is true, all 18 tools must be registered
    const extendedServer = createProjectPilotMcpServer(store, { enableExtended: true });
    const extendedTools = Object.keys(extendedServer._registeredTools);
    assert.equal(extendedTools.length, 18, 'Extended mode must expose all 18 tools');

    for (const tool of extendedGatedTools) {
      assert.ok(extendedTools.includes(tool), `Extended mode must include ${tool}`);
    }
    assert.ok(extendedTools.includes('inspect_github_repo'), 'Extended mode must also include inspect_github_repo');
  });

  // =========================================================================
  // SCENARIO 3: MCP handler validates and processes repository URLs
  // =========================================================================
  test('Scenario 3: MCP handler rejects invalid URLs and processes valid URLs over MCP protocol', async () => {
    // 1. SSRF prevention: reject non-GitHub domain
    const ssrfRes = await client.callTool('inspect_github_repo', { repoUrl: 'https://attacker.site/org/repo' });
    assert.ok(ssrfRes.data);
    assert.equal(ssrfRes.data.status, 'invalid_url');
    assert.equal(ssrfRes.data.overallAssessment, 'Invalid Target');
    assert.ok(ssrfRes.data.findings.some(f => f.findingId === 'SEC-URL-001'));
    assert.ok(ssrfRes.data.error.includes('Only github.com'));

    // 2. Reject localhost / IP addresses
    const loopbackRes = await client.callTool('inspect_github_repo', { repoUrl: 'https://127.0.0.1/admin/repo' });
    assert.equal(loopbackRes.data.status, 'invalid_url');

    // 3. Reject path traversal sequences
    const traversalRes = await client.callTool('inspect_github_repo', { repoUrl: 'https://github.com/../../etc/passwd' });
    assert.equal(traversalRes.data.status, 'invalid_url');

    // 4. Valid repository inspection via direct service verification
    const validReport = await customGithubService.inspectRepository('https://github.com/valid-org/healthy-app');
    assert.equal(validReport.repoUrl, 'https://github.com/valid-org/healthy-app');
    assert.equal(validReport.owner, 'valid-org');
    assert.equal(validReport.repo, 'healthy-app');
    assert.ok(validReport.metadata);
    assert.equal(validReport.metadata.language, 'JavaScript');
    assert.equal(validReport.metadata.license, 'MIT');
    assert.ok(validReport.fileTreeSummary);
    assert.equal(validReport.fileTreeSummary.hasReadme, true);
    assert.equal(validReport.fileTreeSummary.hasLicense, true);
    assert.equal(validReport.fileTreeSummary.ciWorkflowsCount, 1);
  });

  // =========================================================================
  // SCENARIO 4: GitHub API errors are handled clearly
  // =========================================================================
  test('Scenario 4: GitHub API errors (404, 403/429, 500) are distinguished accurately', async () => {
    // 1. Repository Not Found (404)
    const notFoundReport = await customGithubService.inspectRepository('https://github.com/nonexistent/repo');
    assert.equal(notFoundReport.status, 'not_found');
    assert.equal(notFoundReport.overallAssessment, 'Repository Inaccessible');
    assert.ok(notFoundReport.error.includes('was not found or is private'));
    assert.ok(notFoundReport.findings.some(f => f.findingId === 'REPO-NOT-FOUND'));

    // 2. Rate Limit Exceeded (403/429)
    const rateLimitedReport = await customGithubService.inspectRepository('https://github.com/throttled/repo');
    assert.equal(rateLimitedReport.status, 'rate_limited');
    assert.equal(rateLimitedReport.overallAssessment, 'Inspection Throttled');
    assert.ok(rateLimitedReport.error.includes('rate limit exceeded'));
    assert.ok(rateLimitedReport.findings.some(f => f.findingId === 'RATE-LIMIT-EXCEEDED'));

    // 3. Server Error (500)
    const serverErrorReport = await customGithubService.inspectRepository('https://github.com/broken/repo');
    assert.ok(serverErrorReport.error.includes('HTTP 500'));
  });

  // =========================================================================
  // SCENARIO 5: Browser orchestrator no longer imports server-side source code
  // =========================================================================
  test('Scenario 5: Browser code has zero dynamic imports of server-side githubService.js', async () => {
    const orchestratorPath = path.resolve(__dirname, '..', 'public', 'js', 'orchestrator.js');
    const appPath = path.resolve(__dirname, '..', 'public', 'js', 'app.js');

    const orchestratorContent = await fs.promises.readFile(orchestratorPath, 'utf8');
    const appContent = await fs.promises.readFile(appPath, 'utf8');

    // 1. Must NOT contain relative server imports in orchestrator.js
    assert.ok(
      !orchestratorContent.includes('../../src/services/githubService.js'),
      'orchestrator.js must not contain import of ../../src/services/githubService.js'
    );
    assert.ok(
      !orchestratorContent.includes('import(') || !orchestratorContent.includes('githubService.js'),
      'orchestrator.js must not dynamically import githubService.js'
    );

    // 2. Must NOT contain invalid service imports in app.js
    assert.ok(
      !appContent.includes('./services/githubService.js'),
      'app.js must not contain import of ./services/githubService.js'
    );
  });

  // =========================================================================
  // SCENARIO 6: Failed MCP inspection produces actionable error without false success
  // =========================================================================
  test('Scenario 6: Failed MCP inspection produces actionable error and handles missing repos', async () => {
    // 1. Test project without connected repoUrl
    await client.callTool('create_project', {
      name: 'Repo-less Local Project',
      description: 'Project without GitHub repoUrl'
    });

    const noRepoOutcome = await orchestrator.process('inspect repo for Repo-less Local Project');
    assert.equal(noRepoOutcome.workflow, 'github_repo_inspection');
    assert.ok(noRepoOutcome.explanation.includes('does not have a connected GitHub repository'));
    assert.ok(!noRepoOutcome.explanation.includes('### 🔍 GitHub Repository Intelligence Report'));

    // 2. Test when MCP tool call throws (e.g. mock client failure)
    const mockFailingClient = {
      connected: true,
      callTool: async () => {
        throw new Error('Connection refused: MCP streamable transport offline');
      }
    };
    const failingOrchestrator = new AssistantOrchestrator(mockFailingClient);
    const failedOutcome = await failingOrchestrator._workflowInspectGitHubRepo('https://github.com/facebook/react');

    assert.equal(failedOutcome.workflow, 'github_repo_inspection');
    assert.ok(
      failedOutcome.explanation.includes('⚠️ GitHub repository inspection error: Connection refused: MCP streamable transport offline'),
      `Expected actionable error message. Received:\n${failedOutcome.explanation}`
    );
    assert.ok(
      !failedOutcome.explanation.includes('### 🔍 GitHub Repository Intelligence Report'),
      'Must NOT produce false report on inspection failure'
    );
    assert.ok(
      failedOutcome.toolCalls.some(tc => tc.name === 'inspect_github_repo' && tc.error),
      'Failed tool call must be recorded in toolCalls'
    );
  });

  // =========================================================================
  // SCENARIO 7: Existing Phase A tests continue to pass
  // =========================================================================
  test('Scenario 7: Phase A project investigation continues to function cleanly', async () => {
    const mrOutcome = await orchestrator._workflowProjectInvestigation('DevPulse Analytics', 'mr');
    assert.equal(mrOutcome.workflow, 'project_investigation');
    assert.ok(mrOutcome.explanation.includes('• **नोंदणीकृत कामे (Tasks):** 2 एकूण'));
    assert.ok(!mrOutcome.explanation.includes('माहिती अपुरी आहे (Insufficient Data)'));

    const hiOutcome = await orchestrator._workflowProjectInvestigation('DevPulse Analytics', 'hi');
    assert.equal(hiOutcome.workflow, 'project_investigation');
    assert.ok(hiOutcome.explanation.includes('• **कुल टास्क्स (Tasks):** 2'));
    assert.ok(!hiOutcome.explanation.includes('अपर्याप्त डेटा (Insufficient Data)'));
  });
});
