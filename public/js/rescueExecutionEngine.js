/**
 * ProjectPilot AI - Autonomous Project Rescue Execution Engine (Phase 4)
 * Sequentially executes validated, authorized rescue plan actions through MCP write tools,
 * revalidates project/task freshness before each write, handles partial failures safely,
 * and verifies actual persistent outcomes before recalculating truthful health metrics.
 */

/**
 * Valid action execution outcome states.
 */
export const ACTION_OUTCOMES = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  SKIPPED_STALE: 'SKIPPED_STALE',
  SKIPPED_DEPENDENCY: 'SKIPPED_DEPENDENCY',
  CANCELLED: 'CANCELLED'
};

/**
 * Strict allowlist of supported MCP write tools and allowed parameter keys.
 * Browser input is NEVER trusted to specify arbitrary tools or parameters.
 */
export const ALLOWED_EXECUTION_TOOLS = {
  update_task_status: ['taskId', 'status', 'blockerReason'],
  update_project: ['projectId', 'status']
};

/**
 * Strict allowlist of supported rescue action types.
 */
export const ALLOWED_ACTION_TYPES = new Set(['UNBLOCK_TASK', 'ACTIVATE_PROJECT']);

export class RescueExecutionEngine {
  /**
   * @param {import('./api/mcpClient.js').McpBrowserClient} mcpClient
   */
  constructor(mcpClient) {
    this.mcpClient = mcpClient;
    this.isExecuting = false;
    this.cancellationRequested = false;
  }

  /**
   * Request safe cancellation of the active execution loop.
   */
  requestCancellation() {
    if (this.isExecuting) {
      this.cancellationRequested = true;
      return true;
    }
    return false;
  }

  /**
   * Sequentially executes approved actions with pre-execution validation and post-write verification.
   * 
   * @param {Object} plan - The authorized pending rescue plan
   * @param {Set<string>|Array<string>} selectedActionIds - Explicitly approved action IDs
   * @param {Function} [onProgress] - Callback for live execution progress: (actionId, outcome, details) => void
   * @returns {Promise<Object>} Execution report containing per-action outcomes and recalculated health
   */
  async executePlan(plan, selectedActionIds, onProgress = null) {
    // Concurrency Mutex: Prevent duplicate submissions from rapid clicks or concurrent calls
    if (this.isExecuting) {
      throw new Error('Execution already in progress. Duplicate execution request prevented.');
    }

    if (!plan || !plan.planId || !plan.projectId || !Array.isArray(plan.actions)) {
      throw new Error('Invalid plan: A valid authorized rescue plan object is required for execution.');
    }

    const selectedSet = new Set(selectedActionIds);
    if (selectedSet.size === 0) {
      throw new Error('No actions selected: Cannot execute an empty action selection.');
    }

    const planActionIds = new Set(plan.actions.map(a => a.id));
    for (const id of selectedSet) {
      if (!planActionIds.has(id)) {
        throw new Error(`Unauthorized or invalid action ID "${id}": Not part of the rescue plan.`);
      }
    }

    // Filter to selected, executable actions matching the trusted allowlist
    const actionsToExecute = plan.actions.filter(a => selectedSet.has(a.id) && ALLOWED_ACTION_TYPES.has(a.type));
    if (actionsToExecute.length === 0) {
      throw new Error('No authorized executable actions found in selected action IDs.');
    }

    this.isExecuting = true;
    this.cancellationRequested = false;

    const startTime = new Date().toISOString();
    const actionRecords = actionsToExecute.map(action => ({
      id: action.id,
      type: action.type,
      targetId: action.targetId,
      title: action.title || action.targetId,
      description: action.description,
      tool: action.tool,
      params: { ...action.params },
      preconditions: { ...action.preconditions },
      outcome: ACTION_OUTCOMES.PENDING,
      beforeState: null,
      afterState: null,
      error: null,
      verified: false
    }));

    try {
      // Step 1: Initial Freshness Check of Target Project
      let initialDetails;
      try {
        const detailsRes = await this.mcpClient.callTool('get_project_details', { projectId: plan.projectId });
        if (detailsRes.isError || !detailsRes.data?.project) {
          return {
            status: 'STALE_PLAN',
            projectId: plan.projectId,
            projectName: plan.projectName,
            startedAt: startTime,
            completedAt: new Date().toISOString(),
            error: `Project "${plan.projectId}" could not be retrieved from persistence prior to execution.`,
            actions: actionRecords,
            summary: { total: actionRecords.length, succeeded: 0, failed: 0, skipped: actionRecords.length }
          };
        }
        initialDetails = detailsRes.data;
      } catch (err) {
        return {
          status: 'STALE_PLAN',
          projectId: plan.projectId,
          projectName: plan.projectName,
          startedAt: startTime,
          completedAt: new Date().toISOString(),
          error: `Failed to verify project existence prior to execution: ${err.message}`,
          actions: actionRecords,
          summary: { total: actionRecords.length, succeeded: 0, failed: 0, skipped: actionRecords.length }
        };
      }

      // Step 2: Sequential Execution Loop (strictly at most one write action at a time)
      for (let i = 0; i < actionRecords.length; i++) {
        const record = actionRecords[i];
        const originalAction = actionsToExecute[i];

        // Safe cancellation check between actions
        if (this.cancellationRequested) {
          record.outcome = ACTION_OUTCOMES.CANCELLED;
          record.error = 'Execution cancelled by user between sequential steps.';
          onProgress?.(record.id, ACTION_OUTCOMES.CANCELLED, record);
          continue;
        }

        record.outcome = ACTION_OUTCOMES.RUNNING;
        onProgress?.(record.id, ACTION_OUTCOMES.RUNNING, record);

        // Sub-step 2A: Validate tool and parameters against trusted allowlist
        const toolValidation = this._validateToolAndParams(originalAction);
        if (!toolValidation.valid) {
          record.outcome = ACTION_OUTCOMES.FAILED;
          record.error = toolValidation.error;
          onProgress?.(record.id, ACTION_OUTCOMES.FAILED, record);
          continue;
        }

        // Sub-step 2B: Fresh Read & Preconditions Check
        let freshDetails;
        try {
          const freshRes = await this.mcpClient.callTool('get_project_details', { projectId: plan.projectId });
          if (freshRes.isError || !freshRes.data?.project) {
            record.outcome = ACTION_OUTCOMES.SKIPPED_STALE;
            record.error = `Project "${plan.projectId}" was deleted or unavailable during execution.`;
            onProgress?.(record.id, ACTION_OUTCOMES.SKIPPED_STALE, record);
            continue;
          }
          freshDetails = freshRes.data;
        } catch (readErr) {
          record.outcome = ACTION_OUTCOMES.FAILED;
          record.error = `Pre-action read failed: ${readErr.message}`;
          onProgress?.(record.id, ACTION_OUTCOMES.FAILED, record);
          continue;
        }

        const freshProject = freshDetails.project;
        const freshTasks = freshProject.tasks || [];

        const preconditionCheck = this._checkPreconditions(originalAction, freshProject, freshTasks);
        if (!preconditionCheck.satisfied) {
          record.outcome = ACTION_OUTCOMES.SKIPPED_STALE;
          record.error = preconditionCheck.reason;
          record.beforeState = preconditionCheck.observedState;
          onProgress?.(record.id, ACTION_OUTCOMES.SKIPPED_STALE, record);
          continue;
        }

        record.beforeState = preconditionCheck.observedState;

        // Sub-step 2C: Dispatched Write Operation (Single write via trusted client)
        let writeRes;
        try {
          writeRes = await this.mcpClient.callTool(originalAction.tool, originalAction.params);
        } catch (writeErr) {
          // In case of lost response or timeout, do NOT blindly retry.
          // Mark outcome as uncertain until post-write verification checks actual persistence.
          writeRes = { isError: true, error: writeErr.message, isUncertainTimeout: true };
        }

        if (writeRes.isError && !writeRes.isUncertainTimeout) {
          record.outcome = ACTION_OUTCOMES.FAILED;
          record.error = writeRes.content?.[0]?.text || writeRes.error || 'MCP write tool returned failure.';
          onProgress?.(record.id, ACTION_OUTCOMES.FAILED, record);
          continue;
        }

        // Sub-step 2D: Post-Execution Verification through fresh read
        try {
          const verifyRes = await this.mcpClient.callTool('get_project_details', { projectId: plan.projectId });
          if (verifyRes.isError || !verifyRes.data?.project) {
            record.outcome = ACTION_OUTCOMES.FAILED;
            record.error = 'Verification failed: Project record was not found after write operation.';
            onProgress?.(record.id, ACTION_OUTCOMES.FAILED, record);
            continue;
          }

          const verifiedProject = verifyRes.data.project;
          const verifiedTasks = verifiedProject.tasks || [];

          const verifyCheck = this._verifyStateTransition(originalAction, verifiedProject, verifiedTasks);
          if (verifyCheck.verified) {
            record.outcome = ACTION_OUTCOMES.SUCCEEDED;
            record.verified = true;
            record.afterState = verifyCheck.observedState;
            onProgress?.(record.id, ACTION_OUTCOMES.SUCCEEDED, record);
          } else {
            record.outcome = ACTION_OUTCOMES.FAILED;
            record.error = verifyCheck.reason;
            record.afterState = verifyCheck.observedState;
            onProgress?.(record.id, ACTION_OUTCOMES.FAILED, record);
          }
        } catch (verifyErr) {
          record.outcome = ACTION_OUTCOMES.FAILED;
          record.error = `Post-write verification read failed: ${verifyErr.message}`;
          onProgress?.(record.id, ACTION_OUTCOMES.FAILED, record);
        }
      }

      // Step 3: Recalculate Truthful Post-Execution Health from live records
      let postHealth = null;
      try {
        const healthRes = await this.mcpClient.callTool('get_project_health', { projectId: plan.projectId });
        if (!healthRes.isError && healthRes.data) {
          postHealth = healthRes.data;
        }
      } catch (healthErr) {
        console.warn('Post-execution health recalculation warning:', healthErr);
      }

      // Step 4: Compute Final Execution Status
      const succeededCount = actionRecords.filter(a => a.outcome === ACTION_OUTCOMES.SUCCEEDED).length;
      const failedCount = actionRecords.filter(a => a.outcome === ACTION_OUTCOMES.FAILED).length;
      const skippedCount = actionRecords.filter(a => a.outcome === ACTION_OUTCOMES.SKIPPED_STALE).length;
      const cancelledCount = actionRecords.filter(a => a.outcome === ACTION_OUTCOMES.CANCELLED).length;

      let finalStatus;
      if (succeededCount === actionRecords.length) {
        finalStatus = 'COMPLETED';
      } else if (succeededCount > 0) {
        finalStatus = 'PARTIALLY_COMPLETED';
      } else if (cancelledCount > 0 && succeededCount === 0 && failedCount === 0) {
        finalStatus = 'CANCELLED';
      } else {
        finalStatus = 'FAILED';
      }

      return {
        status: finalStatus,
        projectId: plan.projectId,
        projectName: plan.projectName,
        planId: plan.planId,
        startedAt: startTime,
        completedAt: new Date().toISOString(),
        actions: actionRecords,
        baselineHealth: plan.baselineHealth,
        recalculatedHealth: postHealth,
        remainingNotRemediable: plan.notRemediable || [],
        summary: {
          total: actionRecords.length,
          succeeded: succeededCount,
          failed: failedCount,
          skipped: skippedCount,
          cancelled: cancelledCount
        },
        disclaimer: 'Administrative status transitions unblock workflow progression; they do NOT verify source code fixes, test coverage, or physical resolution of external dependencies.'
      };
    } finally {
      this.isExecuting = false;
      this.cancellationRequested = false;
    }
  }

  /**
   * Validates tool name and parameter keys against the trusted execution allowlist.
   */
  _validateToolAndParams(action) {
    if (!action || typeof action !== 'object') {
      return { valid: false, error: 'Action must be a non-null object.' };
    }
    if (!ALLOWED_ACTION_TYPES.has(action.type)) {
      return { valid: false, error: `Action type "${action.type}" is not in trusted allowlist.` };
    }
    if (!ALLOWED_EXECUTION_TOOLS[action.tool]) {
      return { valid: false, error: `MCP tool "${action.tool}" is not permitted for automated rescue execution.` };
    }

    const allowedKeys = ALLOWED_EXECUTION_TOOLS[action.tool];
    const paramKeys = Object.getOwnPropertyNames(action.params || {});
    for (const key of paramKeys) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype' || !allowedKeys.includes(key)) {
        return { valid: false, error: `Parameter key "${key}" is not permitted for tool "${action.tool}".` };
      }
    }

    // Type-specific schema constraints
    if (action.tool === 'update_task_status') {
      if (!action.params?.taskId || typeof action.params.taskId !== 'string') {
        return { valid: false, error: 'update_task_status requires a valid taskId string.' };
      }
      if (!['todo', 'in_progress', 'blocked', 'done'].includes(action.params.status)) {
        return { valid: false, error: `Invalid task status "${action.params.status}".` };
      }
    }

    if (action.tool === 'update_project') {
      if (!action.params?.projectId || typeof action.params.projectId !== 'string') {
        return { valid: false, error: 'update_project requires a valid projectId string.' };
      }
      if (action.params.status && !['planning', 'active', 'paused', 'completed'].includes(action.params.status)) {
        return { valid: false, error: `Invalid project status "${action.params.status}".` };
      }
    }

    return { valid: true };
  }

  /**
   * Re-evaluates target record preconditions against fresh persisted data.
   */
  _checkPreconditions(action, freshProject, freshTasks) {
    if (action.type === 'UNBLOCK_TASK') {
      const task = freshTasks.find(t => t.id === action.targetId);
      if (!task) {
        return {
          satisfied: false,
          reason: `Target task "${action.targetId}" was deleted or is missing from project.`,
          observedState: null
        };
      }

      if (task.projectId !== freshProject.id) {
        return {
          satisfied: false,
          reason: `Project ownership mismatch: Task "${action.targetId}" belongs to "${task.projectId}", not "${freshProject.id}".`,
          observedState: { projectId: task.projectId }
        };
      }

      const isCurrentlyBlocked = task.status === 'blocked' || Boolean(task.blocker);
      if (!isCurrentlyBlocked) {
        return {
          satisfied: false,
          reason: `Task "${task.title}" is already in "${task.status}" state with no active blocker.`,
          observedState: { status: task.status, blocker: task.blocker }
        };
      }

      // Check blocker text against expected precondition if specified
      if (action.preconditions?.currentBlocker !== undefined) {
        const expectedBlocker = action.preconditions.currentBlocker || null;
        const currentBlocker = task.blocker || null;
        if (expectedBlocker !== currentBlocker) {
          return {
            satisfied: false,
            reason: `Task blocker text changed after planning (expected "${expectedBlocker}", observed "${currentBlocker}").`,
            observedState: { status: task.status, blocker: task.blocker }
          };
        }
      }

      return {
        satisfied: true,
        observedState: { status: task.status, blocker: task.blocker }
      };
    }

    if (action.type === 'ACTIVATE_PROJECT') {
      if (action.preconditions?.currentStatus && freshProject.status !== action.preconditions.currentStatus) {
        return {
          satisfied: false,
          reason: `Project status changed from "${action.preconditions.currentStatus}" to "${freshProject.status}" after planning.`,
          observedState: { status: freshProject.status }
        };
      }

      if (freshProject.status === 'active') {
        return {
          satisfied: false,
          reason: `Project "${freshProject.name}" is already active.`,
          observedState: { status: freshProject.status }
        };
      }

      return {
        satisfied: true,
        observedState: { status: freshProject.status }
      };
    }

    return {
      satisfied: false,
      reason: `Unsupported action type: "${action.type}".`,
      observedState: null
    };
  }

  /**
   * Verifies that the attempted state transition actually persisted in the database.
   */
  _verifyStateTransition(action, verifiedProject, verifiedTasks) {
    if (action.type === 'UNBLOCK_TASK') {
      const task = verifiedTasks.find(t => t.id === action.targetId);
      if (!task) {
        return {
          verified: false,
          reason: `Verification failed: Task "${action.targetId}" could not be found after write.`,
          observedState: null
        };
      }

      const expectedStatus = action.params.status;
      const statusMatched = task.status === expectedStatus;
      const blockerCleared = task.blocker === null || task.blocker === undefined || task.blocker === '';

      if (statusMatched && blockerCleared) {
        return {
          verified: true,
          observedState: { status: task.status, blocker: task.blocker }
        };
      }

      return {
        verified: false,
        reason: `Verification failed: Expected status "${expectedStatus}" and cleared blocker; observed status "${task.status}" (blocker: "${task.blocker}").`,
        observedState: { status: task.status, blocker: task.blocker }
      };
    }

    if (action.type === 'ACTIVATE_PROJECT') {
      const expectedStatus = action.params.status;
      if (verifiedProject.status === expectedStatus) {
        return {
          verified: true,
          observedState: { status: verifiedProject.status }
        };
      }

      return {
        verified: false,
        reason: `Verification failed: Expected project status "${expectedStatus}"; observed "${verifiedProject.status}".`,
        observedState: { status: verifiedProject.status }
      };
    }

    return {
      verified: false,
      reason: `Unsupported action verification: "${action.type}".`,
      observedState: null
    };
  }
}
