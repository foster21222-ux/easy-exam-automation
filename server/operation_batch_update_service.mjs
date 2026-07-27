import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { operationBatchCodeIsValid } from "./operation_batch.mjs";
import {
  applyOperationBatchManagedResult,
  buildDesiredOperationBatchSnapshot,
  operationBatchManagedDiff,
  operationBatchUpdateState,
} from "./operation_batch_update.mjs";

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const ACTIVE_ATTEMPT_STATUSES = new Set(["pending", "running"]);
const TERMINAL_ATTEMPT_STATUSES = new Set(["succeeded", "conflict", "failed"]);
const PERSISTED_UPDATE_RECOVERY_STATUSES = new Set([
  "updating",
  "update_failed",
  "update_conflict",
]);

function text(value) {
  return String(value ?? "").trim();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function tokenHash(value) {
  return createHash("sha256").update(text(value)).digest("hex");
}

function tokenMatches(token, expectedHash) {
  const actual = Buffer.from(tokenHash(token), "hex");
  const expected = Buffer.from(text(expectedHash), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function nowIso(now) {
  return new Date(now()).toISOString();
}

function operationBatchPageStatus(persistedStatus, computedStatus) {
  const persisted = text(persistedStatus);
  return PERSISTED_UPDATE_RECOVERY_STATUSES.has(persisted)
    ? persisted
    : text(computedStatus);
}

function normalizedActor(actor = {}) {
  return {
    email: text(actor.email),
    role: text(actor.role),
  };
}

function actorFingerprint(actor) {
  return fingerprint(normalizedActor(actor));
}

function taskVersion(task = {}) {
  const requirements = Array.isArray(task.config?.examRequirements)
    ? task.config.examRequirements
    : task.config?.examRequirement?.fields
      ? [task.config.examRequirement]
      : [];
  return stableJson({
    fanwei: Number(task.config?.fanweiSource?.version || 0),
    requirements: requirements.map((requirement, index) => ({
      id: text(requirement?.id || `requirement-${index + 1}`),
      version: Number(requirement?.version || 0),
    })),
  });
}

function serviceError(code, status, message, detail = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, detail);
  return error;
}

function canAccess(task, actor = {}) {
  if (!actor?.role || actor.role === "admin") return true;
  return Boolean(text(task?.ownerEmail))
    && text(task.ownerEmail).toLowerCase() === text(actor.email).toLowerCase();
}

function assertTask(task, actor) {
  if (!task || !canAccess(task, actor)) {
    throw serviceError("OPERATION_BATCH_UPDATE_NOT_FOUND", 404, "运营批次修改任务不存在");
  }
  return task;
}

function desiredFor(task) {
  const desired = buildDesiredOperationBatchSnapshot(task);
  if (!desired.complete) {
    throw serviceError(
      "OPERATION_BATCH_SCHEDULE_INCOMPLETE",
      409,
      "运营批次日程尚未完整，不能修改",
      { missing: desired.missing },
    );
  }
  return desired.snapshot;
}

function batchCode(task = {}) {
  const code = text(task.config?.operationBatchCode || task.config?.operationBatch?.code);
  if (!operationBatchCodeIsValid(code)) {
    throw serviceError(
      "OPERATION_BATCH_CODE_REQUIRED",
      409,
      "缺少有效的运控批次代码",
    );
  }
  return code;
}

function managedSnapshot(task = {}) {
  const value = task.config?.operationBatch?.managedSnapshot;
  return value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value)
    : null;
}

function differingManagedFields(expected = {}, actual = {}) {
  const differences = [];
  const add = (path, expectedValue, actualValue, requirementIndex) => {
    if (stableJson(expectedValue) === stableJson(actualValue)) return;
    differences.push({
      path,
      expected: expectedValue ?? "",
      actual: actualValue ?? "",
      ...(requirementIndex === undefined ? {} : { requirementIndex }),
    });
  };
  for (const field of ["batchName", "examStartDate", "examEndDate"]) {
    add(field, expected?.[field], actual?.[field]);
  }
  const expectedSchedules = Array.isArray(expected?.schedules) ? expected.schedules : [];
  const actualSchedules = Array.isArray(actual?.schedules) ? actual.schedules : [];
  const count = Math.max(expectedSchedules.length, actualSchedules.length);
  for (let index = 0; index < count; index += 1) {
    const expectedSchedule = expectedSchedules[index];
    const actualSchedule = actualSchedules[index];
    if (!expectedSchedule || !actualSchedule) {
      add(`schedules[${index}]`, expectedSchedule, actualSchedule, index);
      continue;
    }
    add(
      `schedules[${index}].requirementIndex`,
      expectedSchedule.requirementIndex,
      actualSchedule.requirementIndex,
      index,
    );
    for (const field of ["name", "start", "end"]) {
      add(
        `schedules[${index}].${field}`,
        expectedSchedule[field],
        actualSchedule[field],
        index,
      );
    }
  }
  return differences;
}

function snapshotsEqual(left, right) {
  return differingManagedFields(left, right).length === 0;
}

function baselineShapeDifferences(inspected = {}, desired = {}) {
  const inspectedSchedules = inspected?.schedules;
  const desiredSchedules = Array.isArray(desired?.schedules) ? desired.schedules : [];
  if (!Array.isArray(inspectedSchedules)) {
    return [{
      path: "schedules",
      expected: "array",
      actual: typeof inspectedSchedules,
    }];
  }
  if (inspectedSchedules.length > desiredSchedules.length) {
    return [{
      path: "schedules.length",
      expected: desiredSchedules.length,
      actual: inspectedSchedules.length,
    }];
  }
  const differences = [];
  inspectedSchedules.forEach((schedule, index) => {
    if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
      differences.push({
        path: `schedules[${index}]`,
        expected: "schedule",
        actual: schedule ?? "",
        requirementIndex: index,
      });
      return;
    }
    if (schedule.requirementIndex !== index) {
      differences.push({
        path: `schedules[${index}].requirementIndex`,
        expected: index,
        actual: schedule.requirementIndex ?? "",
        requirementIndex: index,
      });
    }
  });
  return differences;
}

function serializedError(error, fallbackCode, differingFields) {
  return {
    code: text(error?.code) || fallbackCode,
    message: error instanceof Error ? error.message : String(error),
    ...(differingFields?.length
      ? { differingFields: structuredClone(differingFields) }
      : {}),
  };
}

function acquireAutomation(coordinator, taskId) {
  try {
    return coordinator.acquireAutomation(taskId);
  } catch (error) {
    if (!error.code) error.code = "OPERATION_BATCH_UPDATE_LOCKED";
    if (!error.status) error.status = 409;
    throw error;
  }
}

function nextAttempt(operationBatch, attemptId, update) {
  const attempts = Array.isArray(operationBatch.updateAttempts)
    ? structuredClone(operationBatch.updateAttempts)
    : [];
  const index = attempts.findIndex((attempt) => attempt.attemptId === attemptId);
  if (index < 0) return null;
  attempts[index] = { ...attempts[index], ...structuredClone(update) };
  return attempts;
}

export function createOperationBatchUpdateService(dependencies = {}) {
  const {
    readTask,
    updateTaskConfig,
    coordinator,
    runInspection,
    runUpdate,
    now = Date.now,
    makePreviewToken = () => randomBytes(32).toString("base64url"),
    makeAttemptId = randomUUID,
    defer = (job) => setImmediate(() => void job()),
    assertAutomationEnabled = () => {},
  } = dependencies;

  async function persistOperationBatch(taskId, operationBatch) {
    return updateTaskConfig(taskId, { operationBatch });
  }

  async function readAuthorized(taskId, actor) {
    return assertTask(await readTask(taskId), actor);
  }

  async function state(taskId, actor) {
    const task = await readAuthorized(taskId, actor);
    const desired = buildDesiredOperationBatchSnapshot(task);
    const current = task.config?.operationBatch || {};
    const localState = operationBatchUpdateState(task);
    return {
      taskId,
      state: localState,
      desiredSnapshot: desired.snapshot,
      appliedSnapshot: managedSnapshot(task),
      missing: desired.missing,
      pageStatus: operationBatchPageStatus(current.status, localState.status),
    };
  }

  async function preview(taskId, actor) {
    const release = acquireAutomation(coordinator, taskId);
    try {
      const initialTask = await readAuthorized(taskId, actor);
      assertAutomationEnabled();
      const code = batchCode(initialTask);
      const desired = desiredFor(initialTask);
      const initialVersion = taskVersion(initialTask);
      const desiredFingerprint = fingerprint(desired);
      const inspectedCurrent = await runInspection({ batch: { code } });
      const freshTask = await readAuthorized(taskId, actor);
      const freshDesired = desiredFor(freshTask);
      if (
        taskVersion(freshTask) !== initialVersion
        || fingerprint(freshDesired) !== desiredFingerprint
      ) {
        throw serviceError(
          "OPERATION_BATCH_PREVIEW_STALE",
          409,
          "运营批次预览已过期：项目在检查期间发生变化",
        );
      }

      const current = freshTask.config?.operationBatch || {};
      const applied = managedSnapshot(freshTask);
      if (!applied) {
        const differingFields = baselineShapeDifferences(
          inspectedCurrent,
          freshDesired,
        );
        if (differingFields.length) {
          throw serviceError(
            "OPERATION_BATCH_UPDATE_CONFLICT",
            409,
            "运控当前日程结构不能作为安全追加基线",
            {
              differingFields,
              inspectedCurrent: structuredClone(inspectedCurrent),
            },
          );
        }
      }
      if (applied) {
        const differingFields = differingManagedFields(applied, inspectedCurrent);
        if (differingFields.length) {
          throw serviceError(
            "OPERATION_BATCH_UPDATE_CONFLICT",
            409,
            "运控当前受管字段与已应用快照不一致",
            {
              differingFields,
              inspectedCurrent: structuredClone(inspectedCurrent),
            },
          );
        }
        if (
          (applied.schedules || []).length
          > (freshDesired.schedules || []).length
        ) {
          throw serviceError(
            "OPERATION_BATCH_UPDATE_CONFLICT",
            409,
            "不允许减少已同步的运营批次日程数量",
            {
              differingFields: differingManagedFields(freshDesired, applied),
              inspectedCurrent: structuredClone(inspectedCurrent),
            },
          );
        }
      }
      const baseline = applied || inspectedCurrent;
      const changes = operationBatchManagedDiff(baseline, freshDesired);
      if (!changes.length) {
        if (!applied) {
          const patch = applyOperationBatchManagedResult(freshTask, {
            verified: true,
            snapshot: inspectedCurrent,
            action: "baseline",
            syncedAt: nowIso(now),
          });
          await persistOperationBatch(taskId, {
            ...patch.operationBatch,
            status: "success",
            activeUpdatePreview: null,
          });
        } else {
          await persistOperationBatch(taskId, {
            ...current,
            status: "success",
            activeUpdatePreview: null,
          });
        }
        return {
          taskId,
          action: "none",
          changes: [],
          inspectedCurrent: structuredClone(inspectedCurrent),
          desiredSnapshot: structuredClone(freshDesired),
        };
      }

      const token = text(makePreviewToken());
      const createdAt = nowIso(now);
      const expiresAt = new Date(now() + PREVIEW_TTL_MS).toISOString();
      const activeUpdatePreview = {
        tokenHash: tokenHash(token),
        taskId,
        taskVersion: initialVersion,
        desiredFingerprint,
        inspectedCurrentFingerprint: fingerprint(inspectedCurrent),
        actorFingerprint: actorFingerprint(actor),
        changes: structuredClone(changes),
        inspectedCurrent: structuredClone(inspectedCurrent),
        createdAt,
        expiresAt,
      };
      await persistOperationBatch(taskId, {
        ...current,
        status: "update_available",
        activeUpdatePreview,
      });
      return {
        taskId,
        action: "update",
        previewToken: token,
        expiresAt,
        changes: structuredClone(changes),
        inspectedCurrent: structuredClone(inspectedCurrent),
        desiredSnapshot: structuredClone(freshDesired),
      };
    } finally {
      release();
    }
  }

  async function persistAttempt(taskId, attemptId, update, batchUpdate = {}) {
    const task = await readTask(taskId);
    if (!task) return null;
    const current = task.config?.operationBatch || {};
    const updateAttempts = nextAttempt(current, attemptId, update);
    if (!updateAttempts) return null;
    return persistOperationBatch(taskId, {
      ...current,
      ...structuredClone(batchUpdate),
      updateAttempts,
    });
  }

  async function finishSuccess(taskId, attemptId, desired, result = {}) {
    const task = await readTask(taskId);
    if (!task) return null;
    const patch = applyOperationBatchManagedResult(task, {
      verified: true,
      snapshot: desired,
      action: "update",
      syncedAt: nowIso(now),
      detailUrl: result.detailUrl,
      checkpoints: result.checkpoints,
    });
    const completedAt = nowIso(now);
    const updateAttempts = nextAttempt(patch.operationBatch, attemptId, {
      status: "succeeded",
      checkpoint: "completed",
      inspectedAfter: structuredClone(desired),
      completedAt,
      error: null,
    });
    if (!updateAttempts) return null;
    return persistOperationBatch(taskId, {
      ...patch.operationBatch,
      status: "success",
      activeUpdatePreview: null,
      updateAttempts,
    });
  }

  async function reconcileFailure(taskId, attemptId, instruction, failure) {
    await persistAttempt(taskId, attemptId, {
      checkpoint: "reconciling",
    });
    let inspectedAfter;
    try {
      inspectedAfter = await runInspection({ batch: { code: instruction.batch.code } });
    } catch (inspectionError) {
      await persistAttempt(taskId, attemptId, {
        status: "failed",
        checkpoint: "failed",
        completedAt: nowIso(now),
        error: serializedError(
          inspectionError,
          "OPERATION_BATCH_RECONCILIATION_FAILED",
        ),
      }, {
        status: "update_failed",
      });
      return;
    }
    if (snapshotsEqual(inspectedAfter, instruction.desiredSnapshot)) {
      await finishSuccess(taskId, attemptId, instruction.desiredSnapshot, {
        checkpoints: ["reconciled_exact_readback"],
      });
      return;
    }
    if (snapshotsEqual(inspectedAfter, instruction.batch.expectedAppliedSnapshot)) {
      await persistAttempt(taskId, attemptId, {
        status: "failed",
        checkpoint: "safe_retry",
        inspectedAfter: structuredClone(inspectedAfter),
        completedAt: nowIso(now),
        error: {
          code: "OPERATION_BATCH_SAFE_RETRY",
          message: failure instanceof Error ? failure.message : String(failure),
        },
      }, {
        status: "update_failed",
      });
      return;
    }
    const differingFields = differingManagedFields(
      instruction.desiredSnapshot,
      inspectedAfter,
    );
    await persistAttempt(taskId, attemptId, {
      status: "conflict",
      checkpoint: "manual_review",
      inspectedAfter: structuredClone(inspectedAfter),
      completedAt: nowIso(now),
      error: {
        code: "OPERATION_BATCH_UPDATE_CONFLICT",
        message: failure instanceof Error ? failure.message : String(failure),
        differingFields: structuredClone(differingFields),
      },
    }, {
      status: "update_conflict",
    });
  }

  async function runAttempt(taskId, attemptId, instruction, release) {
    try {
      await persistAttempt(taskId, attemptId, {
        status: "running",
        checkpoint: "applying",
      });
      let result;
      try {
        result = await runUpdate(instruction);
      } catch (error) {
        await reconcileFailure(taskId, attemptId, instruction, error);
        return;
      }
      if (
        result?.verified === true
        && snapshotsEqual(result.snapshot, instruction.desiredSnapshot)
      ) {
        await finishSuccess(taskId, attemptId, instruction.desiredSnapshot, result);
        return;
      }
      await reconcileFailure(
        taskId,
        attemptId,
        instruction,
        serviceError(
          "OPERATION_BATCH_READBACK_UNVERIFIED",
          409,
          "运营批次修改结果未通过精确回读验证",
        ),
      );
    } finally {
      release();
    }
  }

  async function handleDeferredAttemptRejection(taskId, attemptId, error) {
    try {
      await persistAttempt(taskId, attemptId, {
        status: "failed",
        checkpoint: "failed",
        completedAt: nowIso(now),
        error: serializedError(error, "OPERATION_BATCH_UPDATE_FAILED"),
      }, {
        status: "update_failed",
      });
    } catch {
      // The deferred job has no caller; a second persistence failure cannot be recovered here.
    }
  }

  async function start(taskId, input = {}, actor) {
    const release = acquireAutomation(coordinator, taskId);
    let transferred = false;
    try {
      const task = await readAuthorized(taskId, actor);
      assertAutomationEnabled();
      const code = batchCode(task);
      const desired = desiredFor(task);
      const current = task.config?.operationBatch || {};
      const previewState = current.activeUpdatePreview;
      if (
        !previewState
        || previewState.taskId !== taskId
        || !tokenMatches(input.previewToken, previewState.tokenHash)
      ) {
        throw serviceError(
          "OPERATION_BATCH_PREVIEW_STALE",
          409,
          "运营批次预览已过期，请重新检查",
        );
      }
      if (previewState.actorFingerprint !== actorFingerprint(actor)) {
        throw serviceError(
          "OPERATION_BATCH_PREVIEW_ACTOR_MISMATCH",
          409,
          "运营批次预览确认人不一致",
        );
      }
      const expiresAt = Date.parse(previewState.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= now()) {
        throw serviceError(
          "OPERATION_BATCH_PREVIEW_STALE",
          409,
          "运营批次预览已过期，请重新检查",
        );
      }
      const applied = managedSnapshot(task);
      if (applied && snapshotsEqual(applied, desired)) {
        throw serviceError(
          "OPERATION_BATCH_CONTENT_UNCHANGED",
          409,
          "运营批次期望状态未变化，不允许重复修改",
        );
      }
      const stale = previewState.taskVersion !== taskVersion(task)
        || previewState.desiredFingerprint !== fingerprint(desired)
        || previewState.inspectedCurrentFingerprint
          !== fingerprint(previewState.inspectedCurrent)
        || previewState.inspectedCurrentFingerprint
          !== fingerprint(applied || previewState.inspectedCurrent)
        || !Array.isArray(previewState.changes)
        || previewState.changes.length === 0;
      if (stale) {
        throw serviceError(
          "OPERATION_BATCH_PREVIEW_STALE",
          409,
          "运营批次预览已过期，请重新检查",
        );
      }
      const active = (current.updateAttempts || []).find((attempt) => (
        ACTIVE_ATTEMPT_STATUSES.has(attempt.status)
      ));
      if (active) {
        throw serviceError(
          "OPERATION_BATCH_UPDATE_IN_PROGRESS",
          409,
          "运营批次修改正在执行",
        );
      }
      const attemptId = text(makeAttemptId());
      const attempt = {
        attemptId,
        status: "pending",
        checkpoint: "queued",
        desiredSnapshot: structuredClone(desired),
        inspectedBefore: structuredClone(previewState.inspectedCurrent),
        inspectedAfter: null,
        changes: structuredClone(previewState.changes),
        actor: normalizedActor(actor),
        createdAt: nowIso(now),
        completedAt: null,
        error: null,
      };
      await persistOperationBatch(taskId, {
        ...current,
        status: "updating",
        activeUpdatePreview: null,
        updateAttempts: [
          ...(Array.isArray(current.updateAttempts) ? current.updateAttempts : []),
          attempt,
        ],
      });
      const instruction = {
        batch: {
          code,
          expectedAppliedSnapshot: structuredClone(previewState.inspectedCurrent),
        },
        desiredSnapshot: structuredClone(desired),
        changes: structuredClone(previewState.changes),
      };
      transferred = true;
      try {
        defer(() => runAttempt(taskId, attemptId, instruction, release).catch(
          (error) => handleDeferredAttemptRejection(taskId, attemptId, error),
        ));
      } catch (error) {
        transferred = false;
        throw error;
      }
      return { statusCode: 202, taskId, attemptId };
    } finally {
      if (!transferred) release();
    }
  }

  async function attempt(taskId, attemptId, actor) {
    const task = await readAuthorized(taskId, actor);
    const result = (task.config?.operationBatch?.updateAttempts || [])
      .find((item) => item.attemptId === attemptId);
    if (!result) {
      throw serviceError(
        "OPERATION_BATCH_ATTEMPT_NOT_FOUND",
        404,
        "运营批次修改尝试不存在",
      );
    }
    return {
      taskId,
      attempt: structuredClone(result),
      completed: TERMINAL_ATTEMPT_STATUSES.has(result.status),
    };
  }

  return {
    authorizedTask: readAuthorized,
    state,
    preview,
    start,
    attempt,
  };
}

export function createOperationBatchUpdateApi(dependencies = {}) {
  const {
    service,
    workflowForTask,
    statusPollIntervalSeconds = 2,
  } = dependencies;
  const nextStatusPollSeconds = Math.max(
    1,
    Math.ceil(Number(statusPollIntervalSeconds) || 2),
  );

  async function freshContext(taskId, actor) {
    const task = await service.authorizedTask(taskId, actor);
    return {
      task,
      workflow: await workflowForTask(task),
    };
  }

  async function errorContext(taskId, actor) {
    try {
      return await freshContext(taskId, actor);
    } catch {
      return {};
    }
  }

  async function invoke(taskId, actor, operation, shape = (result) => result) {
    try {
      const result = await operation();
      const statusCode = Number(result?.statusCode || 200);
      const body = shape(result);
      return {
        statusCode,
        body: {
          ...body,
          ...await freshContext(taskId, actor),
        },
      };
    } catch (error) {
      return {
        statusCode: Number(error?.status || 500),
        body: {
          error: error instanceof Error ? error.message : String(error),
          errorCode: text(error?.code) || "OPERATION_BATCH_UPDATE_FAILED",
          differingFields: structuredClone(error?.differingFields || []),
          ...await errorContext(taskId, actor),
        },
      };
    }
  }

  function state(taskId, actor) {
    return invoke(taskId, actor, () => service.state(taskId, actor));
  }

  function preview(taskId, actor) {
    return invoke(taskId, actor, () => service.preview(taskId, actor));
  }

  function start(taskId, input, actor) {
    return invoke(taskId, actor, () => service.start(taskId, input, actor), (result) => ({
      taskId: result.taskId,
      attemptId: result.attemptId,
    }));
  }

  function attempt(taskId, attemptId, actor) {
    return invoke(taskId, actor, () => service.attempt(taskId, attemptId, actor), (result) => {
      const current = result.attempt;
      return {
        attemptId: current.attemptId,
        status: current.status,
        checkpoint: current.checkpoint,
        remainingSeconds: result.completed ? 0 : nextStatusPollSeconds,
        countdownKind: "next_status_poll",
        completed: result.completed,
        error: current.error,
        inspectedBefore: current.inspectedBefore,
        finalReadback: current.inspectedAfter,
        changes: current.changes,
      };
    });
  }

  return { state, preview, start, attempt };
}

export {
  differingManagedFields,
};
