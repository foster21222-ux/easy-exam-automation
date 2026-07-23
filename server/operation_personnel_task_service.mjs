import { createHash, randomUUID } from "node:crypto";

import {
  buildOperationPersonnelTaskDraft,
  buildOperationPersonnelTaskStatus,
  diffOperationPersonnelTaskDrafts,
  operationPersonnelTaskFingerprint,
} from "./operation_personnel_task.mjs";
import {
  normalizeOperationPersonnelSnapshot,
  operationPersonnelConflicts,
} from "./operation_personnel_task_runner.mjs";

const VALID_ENVIRONMENTS = new Set(["test", "production"]);
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const ACTIVE_ATTEMPT_STATUSES = new Set(["queued", "running"]);
const PENDING_REQUIREMENT_STATUSES = new Set(["pending_internal_review", "pending_review"]);

function text(value) {
  return String(value ?? "").trim();
}

function serviceError(code, status, message) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
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

function draftSourceFingerprint(draft = {}) {
  return fingerprint(draft);
}

function nowIso(now) {
  return new Date(now()).toISOString();
}

function requirementRequestId(task = {}) {
  return [
    task.config?.requirementRequestId,
    task.config?.initialRequirementRequestId,
    task.config?.businessRequirement?.requirementRequestId,
  ].map(text).find(Boolean) || "";
}

function requirementVersion(task = {}, requirement = {}) {
  const singular = Number(task.config?.examRequirement?.version);
  if (Number.isFinite(singular)) return singular;
  const multiple = (task.config?.examRequirements || []).map((item) => ({
    id: text(item?.id),
    version: Number(item?.version || 0),
  }));
  if (multiple.length) return stableJson(multiple);
  const external = Number(requirement?.version);
  return Number.isFinite(external) ? external : 0;
}

function hasPendingRequirementChange(requirement = {}) {
  return (requirement?.changeRequests || []).some((item) => (
    PENDING_REQUIREMENT_STATUSES.has(text(item?.status))
  ));
}

function canAccess(task, actor = {}) {
  if (!actor?.role || actor.role === "admin") return true;
  return Boolean(text(task?.ownerEmail))
    && text(task.ownerEmail).toLowerCase() === text(actor.email).toLowerCase();
}

function assertTask(task, actor) {
  if (!task || !canAccess(task, actor)) {
    throw serviceError("PERSONNEL_TASK_NOT_FOUND", 404, "人员任务不存在");
  }
  return task;
}

function assertEnvironment(environment) {
  if (!VALID_ENVIRONMENTS.has(environment)) {
    throw serviceError(
      "PERSONNEL_ENVIRONMENT_INVALID",
      409,
      `未知运控收件环境：${environment || "空"}`,
    );
  }
}

function stateDefaults(environment, draft = {}) {
  return {
    schemaVersion: 1,
    environment,
    status: "ready",
    draft,
    draftVersion: 1,
    sourceFingerprint: draft && Object.keys(draft).length
      ? draftSourceFingerprint(draft)
      : "",
    lastSuccessfulFingerprint: "",
    scheduleCodeMap: draft.scheduleCodeMap || {},
    lastOperationSnapshot: null,
    checkpoints: {},
    activePreview: null,
    activeAttempt: null,
    sendHistory: [],
    changeSummary: "",
    events: [],
  };
}

function normalizedState(task, environment, draft = null) {
  const existing = task?.config?.operationPersonnelTask || {};
  const generated = draft || existing.draft || {};
  return {
    ...stateDefaults(environment, generated),
    ...structuredClone(existing),
    environment,
    draft: structuredClone(existing.draft || generated),
    scheduleCodeMap: structuredClone(existing.scheduleCodeMap || generated.scheduleCodeMap || {}),
    checkpoints: structuredClone(existing.checkpoints || {}),
    activePreview: existing.activePreview ? structuredClone(existing.activePreview) : null,
    activeAttempt: existing.activeAttempt ? structuredClone(existing.activeAttempt) : null,
    sendHistory: structuredClone(existing.sendHistory || []),
    events: structuredClone(existing.events || []),
  };
}

function targetFromDraft(draft = {}, snapshot = {}) {
  return normalizeOperationPersonnelSnapshot({
    batch: {
      ...(snapshot.batch || {}),
      ...(draft.operationBatch || {}),
      ...(draft.batch || {}),
      published: true,
    },
    schedules: draft.schedules || [],
    personnel: draft.personnel || {},
    dates: draft.dates || {},
    requirements: draft.operationRequirements || snapshot.requirements || [],
    taskSheet: draft.operationTaskSheet || snapshot.taskSheet || {},
    sendRecords: snapshot.sendRecords || [],
    directoryMatch: draft.directoryMatch || snapshot.directoryMatch || {},
  });
}

function editableDraft(base, input = {}) {
  const draft = structuredClone(base);
  const changes = [];
  const set = (path, value) => {
    const keys = path.split(".");
    let owner = draft;
    for (const key of keys.slice(0, -1)) owner = owner[key];
    const key = keys.at(-1);
    if (stableJson(owner[key]) === stableJson(value)) return;
    changes.push({ path, before: owner[key] ?? "", after: value ?? "" });
    owner[key] = value;
  };
  const dates = input.draft?.dates || input.dates || {};
  for (const key of ["start", "end", "nameListDue"]) {
    if (Object.hasOwn(dates, key)) set(`dates.${key}`, text(dates[key]));
  }
  const personnel = input.draft?.personnel || input.personnel || {};
  if (Object.hasOwn(input, "monitorCount")) personnel.monitorCount = input.monitorCount;
  if (Object.hasOwn(input, "monitorRatio")) personnel.monitorRatio = input.monitorRatio;
  if (Object.hasOwn(personnel, "monitorCount")) {
    set("personnel.monitorCount", Number(personnel.monitorCount) || text(personnel.monitorCount));
  }
  if (Object.hasOwn(personnel, "monitorRatio")) {
    set("personnel.monitorRatio", text(personnel.monitorRatio));
  }
  const validIsoDate = (value) => {
    const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1])
      && date.getUTCMonth() === Number(match[2]) - 1
      && date.getUTCDate() === Number(match[3]);
  };
  const datesValid = ["start", "end", "nameListDue"].every((key) => validIsoDate(draft.dates?.[key]))
    && draft.dates.start <= draft.dates.end;
  const monitorCountValid = Number.isFinite(Number(draft.personnel?.monitorCount))
    && Number(draft.personnel.monitorCount) > 0;
  const resolvable = new Map([
    ["PERSONNEL_DATES_REQUIRED", datesValid],
    ["MONITOR_COUNT_REQUIRED", monitorCountValid],
  ]);
  const warnings = (draft.warnings || []).filter(
    (item) => !(resolvable.has(item.code) && resolvable.get(item.code)),
  );
  for (const [code, resolved] of resolvable) {
    if (!resolved && !warnings.some((item) => item.code === code)) warnings.push({ code });
  }
  draft.warnings = warnings;
  return { draft, changes: changes.sort((left, right) => left.path.localeCompare(right.path)) };
}

function operationSnapshotChanges(before = {}, after = {}, prefix = "") {
  if (stableJson(before) === stableJson(after)) return [];
  if (Array.isArray(before) || Array.isArray(after)
    || !before || !after
    || typeof before !== "object" || typeof after !== "object") {
    return [{ path: prefix, before: before ?? "", after: after ?? "" }];
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .flatMap((key) => operationSnapshotChanges(
      before[key],
      after[key],
      prefix ? `${prefix}.${key}` : key,
    ))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function irreversibleBoundaryReached(checkpoints = {}) {
  const submit = checkpoints.submit_send;
  return ["running", "submission_started", "completed"].includes(submit?.status)
    || Boolean(checkpoints.verify_send_record);
}

function recoverOrphanedAttempt(state, activeAttemptIds) {
  const attempt = state.activeAttempt;
  if (!attempt || !ACTIVE_ATTEMPT_STATUSES.has(attempt.status)
    || activeAttemptIds.has(attempt.attemptId)) {
    return state;
  }
  const status = irreversibleBoundaryReached(state.checkpoints)
    ? "result_unknown"
    : "failed_resumable";
  return {
    ...state,
    status,
    activeAttempt: { ...attempt, status },
  };
}

function attemptHistory(attempt, result, completedAt) {
  return {
    attemptId: attempt.attemptId,
    kind: attempt.kind,
    operator: attempt.operator,
    environment: attempt.environment,
    requirementVersion: attempt.requirementVersion,
    draftVersion: attempt.draftVersion,
    fingerprint: attempt.fingerprint,
    recipients: structuredClone(attempt.recipients),
    operationRecord: structuredClone(result.sendRecord),
    operationSnapshot: structuredClone(result.operationSnapshot || attempt.operationSnapshot || null),
    changeSummary: attempt.changeSummary,
    createdAt: attempt.createdAt,
    completedAt,
  };
}

function attemptMatchesPreview(attempt, preview) {
  return attempt
    && attempt.environment === preview.environment
    && attempt.kind === preview.kind
    && attempt.requirementVersion === preview.requirementVersion
    && attempt.draftVersion === preview.draftVersion
    && attempt.fingerprint === preview.fingerprint
    && stableJson(attempt.recipients) === stableJson(preview.recipients)
    && stableJson(attempt.target) === stableJson(preview.target)
    && stableJson(attempt.baseline) === stableJson(preview.baseline)
    && stableJson(attempt.previewBinding) === stableJson(preview.previewBinding);
}

function recheckedOperationSnapshot(state, result) {
  const attempt = state.activeAttempt;
  const layers = [
    state.lastOperationSnapshot,
    attempt.target,
    attempt.operationSnapshot,
    result.operationSnapshot,
  ].filter(Boolean);
  if (!layers.length) {
    throw serviceError(
      "PERSONNEL_RECHECK_SNAPSHOT_MISSING",
      409,
      "发送记录已出现，但缺少可核验的原发送快照",
    );
  }
  const nested = ["batch", "personnel", "dates", "taskSheet", "directoryMatch"];
  const merged = layers.reduce((current, layer) => {
    const next = { ...current, ...structuredClone(layer) };
    for (const key of nested) {
      next[key] = { ...(current[key] || {}), ...(layer[key] || {}) };
    }
    return next;
  }, {});
  const seenRecords = new Set();
  const records = [
    result.sendRecord,
    ...(result.sendRecords || []),
    ...(merged.sendRecords || []),
  ].filter((item) => {
    if (!item) return false;
    const key = `${text(item.type)}\u0000${text(item.sentAt)}`;
    if (seenRecords.has(key)) return false;
    seenRecords.add(key);
    return true;
  });
  return normalizeOperationPersonnelSnapshot({
    ...merged,
    sendRecords: records,
  });
}

function serializedFailure(error) {
  return {
    code: text(error?.code) || "PERSONNEL_ATTEMPT_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function createOperationPersonnelTaskService(dependencies = {}) {
  const {
    readTask,
    updateTaskConfig,
    readRequirement = async () => null,
    coordinator,
    runInspection,
    runAttempt,
    runRecheck,
    environment: rawEnvironment = "",
    activeAttemptIds = new Set(),
    now = Date.now,
    makeToken = randomUUID,
    makeAttemptId = randomUUID,
    defer = (job) => setImmediate(() => void job()),
  } = dependencies;
  const environment = text(rawEnvironment);

  async function readAuthorized(taskId, actor) {
    return assertTask(await readTask(taskId), actor);
  }

  async function readRequirementFor(task) {
    const requestId = requirementRequestId(task);
    return requestId ? await readRequirement(requestId) : null;
  }

  async function persistState(taskId, state) {
    return updateTaskConfig(taskId, { operationPersonnelTask: state });
  }

  async function withTaskLock(taskId, run) {
    const release = coordinator.acquireTask(taskId);
    try {
      return await run();
    } finally {
      release();
    }
  }

  async function updateAttemptState(taskId, attemptId, change) {
    return withTaskLock(taskId, async () => {
      const task = await readTask(taskId);
      if (!task) return null;
      const state = normalizedState(task, environment);
      if (state.activeAttempt?.attemptId !== attemptId) return null;
      const next = await change(state, task);
      await persistState(taskId, next);
      return next;
    });
  }

  async function get(taskId, actor) {
    const task = await readAuthorized(taskId, actor);
    if (!VALID_ENVIRONMENTS.has(environment)) {
      const state = normalizedState(task, environment, {});
      return {
        taskId,
        state: { ...state, status: "unsupported", draft: {} },
      };
    }
    const draft = buildOperationPersonnelTaskDraft(task, {
      environment,
      now: nowIso(now),
      scheduleCodeMap: task.config?.operationPersonnelTask?.scheduleCodeMap || {},
    });
    let state = normalizedState(task, environment, draft);
    state = recoverOrphanedAttempt(state, activeAttemptIds);
    if (!state.activeAttempt && !task.config?.operationPersonnelTask) {
      state.status = buildOperationPersonnelTaskStatus(task, draft).status;
    }
    return { taskId, state };
  }

  async function preview(taskId, actor, input = {}) {
    assertEnvironment(environment);
    const initialTask = await readAuthorized(taskId, actor);
    const existing = recoverOrphanedAttempt(
      normalizedState(initialTask, environment),
      activeAttemptIds,
    );
    if (existing.status === "result_unknown") {
      throw serviceError(
        "PERSONNEL_RESULT_UNKNOWN",
        409,
        "上次发送结果未知，只能重新核对发送记录",
      );
    }
    const requirement = await readRequirementFor(initialTask);
    if (hasPendingRequirementChange(requirement)) {
      throw serviceError(
        "PERSONNEL_PENDING_REQUIREMENT_CHANGE",
        409,
        "存在待审核的外部需求变更，不能预览人员任务",
      );
    }
    const inspectedRequirementVersion = requirementVersion(initialTask, requirement);
    const generated = buildOperationPersonnelTaskDraft(initialTask, {
      environment,
      now: nowIso(now),
      scheduleCodeMap: existing.scheduleCodeMap,
    });
    const edited = editableDraft(generated, input);
    const draft = edited.draft;

    const releaseProfile = coordinator.acquireProfile();
    let snapshot;
    try {
      snapshot = normalizeOperationPersonnelSnapshot(await runInspection({
        environment,
        batch: draft.batch,
        batchCode: draft.batch.code,
      }));
    } finally {
      releaseProfile();
    }
    const mode = existing.lastSuccessfulFingerprint ? "resend" : "initial";
    const target = targetFromDraft(draft, snapshot);
    const baseline = mode === "resend"
      ? normalizeOperationPersonnelSnapshot(existing.lastOperationSnapshot || {})
      : structuredClone(target);
    if (mode === "initial") baseline.batch.published = snapshot.batch.published;
    const conflicts = operationPersonnelConflicts(
      baseline || target,
      snapshot,
      mode,
    );
    if (conflicts.length) {
      const error = serviceError(
        "PERSONNEL_OPERATION_CONFLICT",
        409,
        `运控人员任务状态冲突：${conflicts.map((item) => item.path).join("、")}`,
      );
      error.conflicts = conflicts;
      throw error;
    }

    return withTaskLock(taskId, async () => {
      const freshTask = await readAuthorized(taskId, actor);
      const freshRequirement = await readRequirementFor(freshTask);
      if (hasPendingRequirementChange(freshRequirement)) {
        throw serviceError(
          "PERSONNEL_PENDING_REQUIREMENT_CHANGE",
          409,
          "存在待审核的外部需求变更，不能预览人员任务",
        );
      }
      const freshState = recoverOrphanedAttempt(
        normalizedState(freshTask, environment),
        activeAttemptIds,
      );
      const currentRequirementVersion = requirementVersion(freshTask, freshRequirement);
      if (currentRequirementVersion !== inspectedRequirementVersion) {
        throw serviceError(
          "PERSONNEL_PREVIEW_STALE",
          409,
          "人员任务需求版本已变化，请重新检查",
        );
      }
      const initialVersion = Number(freshState.draftVersion || 0) || 1;
      const draftVersion = edited.changes.length ? initialVersion + 1 : initialVersion;
      draft.operationRequirements = structuredClone(snapshot.requirements);
      draft.operationTaskSheet = structuredClone(snapshot.taskSheet);
      draft.operationBatch = structuredClone(snapshot.batch);
      draft.directoryMatch = structuredClone(snapshot.directoryMatch);
      draft.previewOperationSnapshot = structuredClone(snapshot);
      const sourceFingerprint = draftSourceFingerprint(draft);
      const token = text(makeToken());
      const createdAt = nowIso(now);
      const expiresAt = new Date(now() + PREVIEW_TTL_MS).toISOString();
      const activePreview = {
        token,
        expiresAt,
        requirementVersion: currentRequirementVersion,
        draftVersion,
        operationSnapshotFingerprint: fingerprint(snapshot),
        directoryMatchFingerprint: fingerprint(snapshot.directoryMatch),
      };
      const events = [
        ...freshState.events,
        {
          type: "operation_personnel_previewed",
          actor: text(actor?.email),
          createdAt,
        },
        ...(edited.changes.length ? [{
          type: "operation_personnel_draft_auto_confirmed",
          actor: text(actor?.email),
          changes: structuredClone(edited.changes),
          createdAt,
        }] : []),
      ];
      const next = {
        ...freshState,
        schemaVersion: 1,
        environment,
        status: buildOperationPersonnelTaskStatus(freshTask, draft).status,
        draft,
        draftVersion,
        sourceFingerprint,
        scheduleCodeMap: structuredClone(draft.scheduleCodeMap || {}),
        activePreview,
        events,
      };
      await persistState(taskId, next);
      return {
        taskId,
        previewToken: token,
        expiresAt,
        draftVersion,
        state: next,
        changes: diffOperationPersonnelTaskDrafts(freshState.draft || {}, draft),
        operationChanges: operationSnapshotChanges(snapshot, target),
      };
    });
  }

  async function persistCheckpoint(taskId, attemptId, checkpoint) {
    return updateAttemptState(taskId, attemptId, async (state) => ({
      ...state,
      checkpoints: {
        ...state.checkpoints,
        [checkpoint.name]: structuredClone(checkpoint),
      },
      events: [...state.events, {
        type: "operation_personnel_checkpoint",
        attemptId,
        checkpoint: checkpoint.name,
        status: checkpoint.status,
        createdAt: nowIso(now),
      }],
    }));
  }

  async function persistVerification(taskId, attemptId, verification) {
    return updateAttemptState(taskId, attemptId, async (state) => ({
      ...state,
      activeAttempt: {
        ...state.activeAttempt,
        verification: structuredClone(verification),
      },
    }));
  }

  async function finishAttempt(taskId, attemptId, result) {
    return updateAttemptState(taskId, attemptId, async (state) => {
      const attempt = state.activeAttempt;
      const completedAt = text(result.completedAt) || nowIso(now);
      if (result.status !== "sent" || !result.sendRecord) {
        return {
          ...state,
          status: "result_unknown",
          activeAttempt: {
            ...attempt,
            status: "result_unknown",
            completedAt,
            operationSnapshot: structuredClone(result.operationSnapshot || null),
          },
          events: [...state.events, {
            type: "operation_personnel_result_unknown",
            attemptId,
            createdAt: completedAt,
          }],
        };
      }
      const history = state.sendHistory.some((item) => item.attemptId === attemptId)
        ? state.sendHistory
        : [...state.sendHistory, attemptHistory(attempt, result, completedAt)];
      return {
        ...state,
        status: "sent",
        lastSuccessfulFingerprint: attempt.fingerprint,
        lastOperationSnapshot: structuredClone(result.operationSnapshot),
        activeAttempt: { ...attempt, status: "sent", completedAt },
        sendHistory: history,
        changeSummary: attempt.changeSummary,
        events: [...state.events, {
          type: "operation_personnel_sent",
          attemptId,
          createdAt: completedAt,
        }],
      };
    });
  }

  async function failAttempt(taskId, attemptId, failure) {
    return updateAttemptState(taskId, attemptId, async (state) => {
      const status = irreversibleBoundaryReached(state.checkpoints)
        ? "result_unknown"
        : "failed_resumable";
      const completedAt = nowIso(now);
      return {
        ...state,
        status,
        activeAttempt: {
          ...state.activeAttempt,
          status,
          completedAt,
          error: serializedFailure(failure),
        },
        events: [...state.events, {
          type: "operation_personnel_attempt_failed",
          attemptId,
          status,
          error: serializedFailure(failure),
          createdAt: completedAt,
        }],
      };
    });
  }

  async function runQueuedAttempt(taskId, attemptId) {
    activeAttemptIds.add(attemptId);
    let releaseProfile;
    try {
      releaseProfile = coordinator.acquireProfile();
      const running = await updateAttemptState(taskId, attemptId, async (state) => ({
        ...state,
        status: "applying_config",
        activeAttempt: {
          ...state.activeAttempt,
          status: "running",
          startedAt: state.activeAttempt.startedAt || nowIso(now),
        },
      }));
      if (!running) return;
      const attempt = running.activeAttempt;
      const result = await runAttempt({
        environment: attempt.environment,
        kind: attempt.kind,
        batch: attempt.target.batch,
        target: attempt.target,
        baseline: attempt.baseline,
        checkpoints: running.checkpoints,
      }, {
        now,
        onCheckpoint: (checkpoint) => persistCheckpoint(taskId, attemptId, checkpoint),
        onVerification: (verification) => persistVerification(taskId, attemptId, verification),
      });
      await finishAttempt(taskId, attemptId, result);
    } catch (error) {
      await failAttempt(taskId, attemptId, error);
    } finally {
      releaseProfile?.();
      activeAttemptIds.delete(attemptId);
    }
  }

  async function send(taskId, actor, input = {}) {
    assertEnvironment(environment);
    const queued = await withTaskLock(taskId, async () => {
      const task = await readAuthorized(taskId, actor);
      const requirement = await readRequirementFor(task);
      if (hasPendingRequirementChange(requirement)) {
        throw serviceError(
          "PERSONNEL_PENDING_REQUIREMENT_CHANGE",
          409,
          "存在待审核的外部需求变更，不能发送人员任务",
        );
      }
      const state = recoverOrphanedAttempt(
        normalizedState(task, environment),
        activeAttemptIds,
      );
      if (ACTIVE_ATTEMPT_STATUSES.has(state.activeAttempt?.status)) {
        throw serviceError(
          "PERSONNEL_ATTEMPT_IN_PROGRESS",
          409,
          "人员任务发送正在执行",
        );
      }
      if (state.status === "result_unknown") {
        throw serviceError(
          "PERSONNEL_RESULT_UNKNOWN",
          409,
          "上次发送结果未知，只能重新核对发送记录",
        );
      }
      const preview = state.activePreview;
      const expiresAt = Date.parse(preview?.expiresAt);
      const stale = !preview
        || preview.token !== text(input.previewToken)
        || !Number.isFinite(expiresAt)
        || expiresAt <= now()
        || preview.requirementVersion !== requirementVersion(task, requirement)
        || preview.draftVersion !== Number(input.draftVersion)
        || state.draftVersion !== Number(input.draftVersion)
        || state.environment !== environment
        || state.draft.environment !== environment
        || state.sourceFingerprint !== draftSourceFingerprint(state.draft)
        || preview.operationSnapshotFingerprint
          !== fingerprint(state.draft.previewOperationSnapshot || {})
        || preview.directoryMatchFingerprint !== fingerprint(state.draft.directoryMatch || {});
      if (stale) {
        throw serviceError(
          "PERSONNEL_PREVIEW_STALE",
          409,
          "人员任务预览已失效，请重新检查",
        );
      }
      const currentFingerprint = operationPersonnelTaskFingerprint(state.draft);
      if (state.lastSuccessfulFingerprint
        && state.lastSuccessfulFingerprint === currentFingerprint) {
        throw serviceError(
          "PERSONNEL_CONTENT_UNCHANGED",
          409,
          "人员任务内容未变化，不允许重复发送",
        );
      }
      const kind = state.lastSuccessfulFingerprint ? "resend" : "initial";
      const changeSummary = text(input.changeSummary);
      if (kind === "resend" && !changeSummary) {
        throw serviceError(
          "PERSONNEL_CHANGE_SUMMARY_REQUIRED",
          400,
          "重新发送人员任务必须填写已复核的变化摘要",
        );
      }
      const target = targetFromDraft(state.draft);
      const previous = state.activeAttempt?.status === "failed_resumable"
        ? state.activeAttempt
        : null;
      const recipients = {
        to: structuredClone(state.draft.directoryMatch?.to || []),
        cc: structuredClone(state.draft.directoryMatch?.cc || []),
      };
      const baseline = structuredClone(
        kind === "resend" ? state.lastOperationSnapshot : target,
      );
      const previewBinding = {
        operationSnapshotFingerprint: preview.operationSnapshotFingerprint,
        directoryMatchFingerprint: preview.directoryMatchFingerprint,
      };
      const resumeSameAttempt = attemptMatchesPreview(previous, {
        environment,
        kind,
        requirementVersion: preview.requirementVersion,
        draftVersion: state.draftVersion,
        fingerprint: currentFingerprint,
        recipients,
        target,
        baseline,
        previewBinding,
      });
      const attemptId = resumeSameAttempt ? previous.attemptId : text(makeAttemptId());
      const createdAt = resumeSameAttempt ? previous.createdAt : nowIso(now);
      const attempt = {
        ...(resumeSameAttempt ? previous : {}),
        attemptId,
        kind,
        operator: text(actor?.email),
        environment,
        requirementVersion: preview.requirementVersion,
        draftVersion: state.draftVersion,
        fingerprint: currentFingerprint,
        recipients,
        changeSummary,
        createdAt,
        status: "queued",
        target,
        baseline,
        previewBinding,
      };
      const next = {
        ...state,
        status: "ready",
        activePreview: null,
        activeAttempt: attempt,
        checkpoints: resumeSameAttempt ? state.checkpoints : {},
        changeSummary,
        events: [...state.events, {
          type: "operation_personnel_attempt_queued",
          attemptId,
          actor: text(actor?.email),
          createdAt,
        }],
      };
      await persistState(taskId, next);
      activeAttemptIds.add(attemptId);
      return attempt;
    });
    defer(() => runQueuedAttempt(taskId, queued.attemptId));
    return { statusCode: 202, attemptId: queued.attemptId };
  }

  async function attempt(taskId, actor, attemptId) {
    const result = await get(taskId, actor);
    if (result.state.activeAttempt?.attemptId !== text(attemptId)) {
      throw serviceError(
        "PERSONNEL_ATTEMPT_NOT_FOUND",
        404,
        "人员任务发送尝试不存在",
      );
    }
    return { ...result, attempt: result.state.activeAttempt };
  }

  async function recheck(taskId, actor) {
    assertEnvironment(environment);
    const task = await readAuthorized(taskId, actor);
    const state = recoverOrphanedAttempt(normalizedState(task, environment), activeAttemptIds);
    if (state.status !== "result_unknown" || !state.activeAttempt) {
      throw serviceError(
        "PERSONNEL_RECHECK_NOT_ALLOWED",
        409,
        "只有发送结果未知时才能重新核对发送记录",
      );
    }
    const originalAttemptId = state.activeAttempt.attemptId;
    const submitStartedAt = state.checkpoints.submit_send?.readback?.startedAt
      || state.activeAttempt.startedAt;
    const releaseProfile = coordinator.acquireProfile();
    let result;
    try {
      result = await runRecheck({
        environment,
        kind: state.activeAttempt.kind,
        batch: state.activeAttempt.target?.batch || state.draft.batch,
        attempt: {
          kind: state.activeAttempt.kind,
          startedAt: submitStartedAt,
        },
      });
    } finally {
      releaseProfile();
    }
    const next = await updateAttemptState(taskId, originalAttemptId, async (freshState) => {
      const freshAttempt = freshState.activeAttempt;
      const checkedAt = nowIso(now);
      if (!result.sendRecord) {
        return {
          ...freshState,
          status: "result_unknown",
          activeAttempt: { ...freshAttempt, status: "result_unknown" },
          events: [...freshState.events, {
            type: "operation_personnel_rechecked",
            attemptId: originalAttemptId,
            matched: false,
            createdAt: checkedAt,
          }],
        };
      }
      const completedAt = text(result.completedAt) || checkedAt;
      const operationSnapshot = recheckedOperationSnapshot(freshState, result);
      const reconciled = {
        ...result,
        operationSnapshot,
        completedAt,
      };
      const history = freshState.sendHistory.some((item) => item.attemptId === originalAttemptId)
        ? freshState.sendHistory
        : [...freshState.sendHistory, attemptHistory(freshAttempt, reconciled, completedAt)];
      return {
        ...freshState,
        status: "sent",
        lastSuccessfulFingerprint: freshAttempt.fingerprint,
        lastOperationSnapshot: operationSnapshot,
        activeAttempt: {
          ...freshAttempt,
          status: "sent",
          completedAt,
          operationSnapshot,
        },
        sendHistory: history,
        events: [...freshState.events, {
          type: "operation_personnel_rechecked",
          attemptId: originalAttemptId,
          matched: true,
          createdAt: checkedAt,
        }],
      };
    });
    return { taskId, state: next };
  }

  return { get, preview, send, attempt, recheck };
}
