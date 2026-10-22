import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStore } from '../src/db/store.js';
import { HealthService } from '../src/services/healthService.js';
import { PriorityService } from '../src/services/priorityService.js';
import { MaintenanceService } from '../src/services/maintenanceService.js';
import { GitHubService } from '../src/services/githubService.js';
import {
  TOOL_DEFINITIONS,
  CAPABILITY_GROUPS,
  RISK_TIERS,
  getToolDefinition,
  getToolsByGroup,
  getAllToolNames
} from '../src/mcp/toolRegistry.js';
import { createProjectPilotMcpServer } from '../src/mcp/server.js';

describe('Unified Central Tool Registry (Phase 2)', () => {
  let tempDir;
  let storeFile;
  let store;
  let services;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'projectpilot-registry-test-'));
    storeFile = path.join(tempDir, 'registry-store.json');
    store = new ProjectStore(storeFile);
    await store.init();

    services = {
      healthService: new HealthService(store),
      priorityService: new PriorityService(store),
      maintenanceService: new MaintenanceService(store),
      githubService: new GitHubService({
        fetchFn: async (url) => {
          if (url.includes('/repos/')) {
            return {
              status: 200,
              ok: true,
              headers: new Headers({ 'x-ratelimit-remaining': '60' }),
              json: async () => ({
                id: 101,
                name: 'test-repo',
                full_name: 'test-org/test-repo',
                description: 'A verified test repository',
                default_branch: 'main',
                license: { spdx_id: 'MIT' }
              })
            };
          }
          return { status: 404, ok: false, headers: new Headers(), json: async () => ({}) };
        }
      })
    };
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('1. Registry Completeness & Structure', () => {
    test('exposes all capability groups A through G', () => {
      const groups = Object.values(CAPABILITY_GROUPS);
      assert.ok(groups.includes('Projects'));
      assert.ok(groups.includes('Tasks'));
      assert.ok(groups.includes('Blockers'));
      assert.ok(groups.includes('Project Health'));
      assert.ok(groups.includes('Maintenance'));
      assert.ok(groups.includes('GitHub Intelligence'));
      assert.ok(groups.includes('Verification & Planning'));

      for (const group of groups) {
        const tools = getToolsByGroup(group);
        assert.ok(tools.length > 0, `Capability group "${group}" must have registered tools`);
      }
    });

    test('every registered tool has a valid schema, risk tier, and description', () => {
      const names = getAllToolNames();
      assert.ok(names.length >= 17, `Should have at least 17 unified tools, found ${names.length}`);

      for (const def of TOOL_DEFINITIONS) {
        assert.ok(def.name, 'Tool must have a name');
        assert.ok(def.group, `Tool ${def.name} must belong to a group`);
        assert.ok(def.description, `Tool ${def.name} must have a description`);
        assert.ok(
          Object.values(RISK_TIERS).includes(def.riskTier),
          `Tool ${def.name} must declare a valid risk tier (read, write, destructive)`
        );
        assert.ok(def.schema, `Tool ${def.name} must have a Zod schema`);
        assert.equal(typeof def.handler, 'function', `Tool ${def.name} must have a handler function`);
      }
    });
  });

  describe('2. Project Group Tools', () => {
    test('delete_project aborts without confirmDelete flag', async () => {
      const tool = getToolDefinition('delete_project');
      assert.equal(tool.riskTier, RISK_TIERS.DESTRUCTIVE);

      await assert.rejects(
        async () => tool.handler(store, { projectId: 'proj-cloudsync', confirmDelete: false }, services),
        /confirmDelete must be explicitly set to true/
      );
    });

    test('delete_project permanently removes project and records audit trail', async () => {
      const tool = getToolDefinition('delete_project');
      const result = await tool.handler(store, { projectId: 'proj-cloudsync', confirmDelete: true }, services);

      assert.ok(result.message.includes('permanently deleted'));
      assert.equal(store.getProject('proj-cloudsync'), null);

      // Check audit log
      const logs = store.listAuditLogs({ action: 'delete_project' });
      assert.ok(logs.length >= 1);
      assert.equal(logs[0].targetId, 'proj-cloudsync');
    });
  });

  describe('3. Task Group Tools', () => {
    test('reopen_task restores a done task to todo and updates timestamps', async () => {
      const updateTool = getToolDefinition('update_task_status');
      await updateTool.handler(store, { taskId: 'task-cloudsync-1', status: 'done' }, services);

      const reopenTool = getToolDefinition('reopen_task');
      const res = await reopenTool.handler(store, { taskId: 'task-cloudsync-1', targetStatus: 'todo' }, services);

      assert.equal(res.task.status, 'todo');
      assert.equal(res.task.completedAt, null);

      const logs = store.listAuditLogs({ action: 'reopen_task' });
      assert.ok(logs.length >= 1);
    });

    test('delete_task requires explicit confirmDelete', async () => {
      const tool = getToolDefinition('delete_task');
      await assert.rejects(
        async () => tool.handler(store, { taskId: 'task-cloudsync-1', confirmDelete: false }, services),
        /confirmDelete must be true/
      );

      const res = await tool.handler(store, { taskId: 'task-cloudsync-1', confirmDelete: true }, services);
      assert.equal(res.deletedTaskId, 'task-cloudsync-1');
      assert.equal(store.getTask('task-cloudsync-1'), null);
    });
  });

  describe('4. Blocker Management Tools', () => {
    test('manage_blocker can block and subsequently resolve a task with audit tracking', async () => {
      const tool = getToolDefinition('manage_blocker');

      // Block
      const blockRes = await tool.handler(store, {
        taskId: 'task-devpulse-leak',
        action: 'block',
        blockerReason: 'Upstream gateway DNS resolving to invalid IP'
      }, services);

      assert.equal(blockRes.task.status, 'blocked');
      assert.ok(blockRes.task.blocker.includes('DNS'));

      // Resolve
      const resolveRes = await tool.handler(store, {
        taskId: 'task-devpulse-leak',
        action: 'resolve',
        newStatus: 'in_progress'
      }, services);

      assert.equal(resolveRes.task.status, 'in_progress');
      assert.equal(resolveRes.task.blocker, null);

      const audit = store.listAuditLogs({ targetId: 'task-devpulse-leak' });
      assert.ok(audit.some(a => a.action === 'block_task'));
      assert.ok(audit.some(a => a.action === 'resolve_blocker'));
    });
  });

  describe('5. Audit Log Tool', () => {
    test('get_audit_log returns recorded events with filtering', async () => {
      await store.recordAudit({
        action: 'test_action',
        actor: 'user',
        mode: 'APPROVE',
        targetType: 'project',
        targetId: 'proj-test',
        details: { key: 'value' }
      });

      const tool = getToolDefinition('get_audit_log');
      const res = await tool.handler(store, { action: 'test_action' }, services);

      assert.ok(res.count >= 1);
      assert.equal(res.auditLogs[0].action, 'test_action');
      assert.equal(res.auditLogs[0].targetId, 'proj-test');
    });
  });

  describe('6. Extended MCP Server Integration', () => {
    test('server in extended mode registers all advanced tools', async () => {
      const mcpServer = createProjectPilotMcpServer(store, { enableExtended: true, githubService: services.githubService });
      assert.ok(mcpServer);

      const registered = Object.keys(mcpServer._registeredTools);
      assert.ok(registered.includes('inspect_github_repo'), 'Should expose inspect_github_repo');
      assert.ok(registered.includes('delete_project'), 'Should expose delete_project');
      assert.ok(registered.includes('reopen_task'), 'Should expose reopen_task');
      assert.ok(registered.includes('delete_task'), 'Should expose delete_task');
      assert.ok(registered.includes('manage_blocker'), 'Should expose manage_blocker');
      assert.ok(registered.includes('get_audit_log'), 'Should expose get_audit_log');
      assert.equal(registered.length, 18, 'Extended mode should expose all 18 tools');
    });
  });
});
