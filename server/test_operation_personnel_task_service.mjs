import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { buildOperationPersonnelTaskDraft, operationPersonnelTaskFingerprint } from "./operation_personnel_task.mjs";
import { normalizeOperationPersonnelSnapshot } from "./operation_personnel_task_runner.mjs";
import { createOperationPersonnelTaskService } from "./operation_personnel_task_service.mjs";

const START = Date.parse("2026-07-23T02:00:00.000Z");
const ADMIN = { role: "admin" };

function managedSchedule(overrides = {}) {
  return {
    requirementIndex: 0,
    name: "湖北邮政招聘考试",
    start: "2026-08-22T09:00:00",
    end: "2026-08-22T11:00:00",
    ...overrides,
  };
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

function valueFingerprint(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function owner() {
  return { email: "owner@example.com", role: "user" };
}

function baseTask() {
  return {
    taskId: "task-a",
    ownerEmail: "owner@example.com",
    projectName: "示例考试",
    config: {
      requirementRequestId: "requirement-a",
      operationBatchCode: "EZT260003",
      operationBatch: {
        code: "EZT260003",
        status: "success",
        managedSnapshot: {
          batchName: "湖北邮政招聘考试",
          examStartDate: "2026-08-22",
          examEndDate: "2026-08-22",
          schedules: [managedSchedule()],
        },
      },
      businessRequirement: {
        batch_name: "湖北邮政招聘考试",
        operation_serial_number: "R0042483",
        project_code: "P260001",
        project_name: "示例考试",
        ata_invigilator_arrangement: "需要安排分散人工监考",
      },
      examRequirement: {
        id: "requirement-1",
        version: 3,
        fields: {
          "考试名称": "湖北邮政招聘考试",
          "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00",
        },
        config: {
          startTimeDisplay: "2026/08/22 09:00",
          endTimeDisplay: "2026/08/22 11:00",
          earlyLoginMinutes: 30,
          courses: [{ code: "C001", name: "综合能力" }],
        },
      },
    },
    sessions: [{
      sessionType: "formal",
      start: "2026/08/22 09:00",
      end: "2026/08/22 11:00",
      candidateCount: 81,
    }],
  };
}

function inspectionFor(task, environment = "test") {
  const draft = buildOperationPersonnelTaskDraft(task, {
    environment,
    now: new Date(START).toISOString(),
  });
  const to = environment === "production"
    ? [{ group: "拓展二部", id: "p1", name: "唐润梅" }]
    : [{ group: "演练组", id: "t1", name: "张乐翔" }];
  const cc = environment === "production"
    ? ["c1", "c2", "c3", "c4"].map((id, index) => ({
      group: "结算组",
      id,
      name: `结算${index + 1}`,
    }))
    : [];
  return {
    batch: {
      ...draft.batch,
      batchName: "",
      projectDepartment: "",
      projectManager: "",
      systemType: "",
      published: false,
    },
    schedules: [],
    personnel: {},
    dates: {},
    requirements: [],
    taskSheet: {
      type: "分散在线监考",
      conditions: [{ name: "人员配置", satisfied: true }],
      content: "任务内容",
    },
    sendRecords: [],
    directoryMatch: { to, cc },
  };
}

function requirementsForPersonnel(personnel = {}) {
  return [
    {
      name: "正式考试-最早登录系统时间",
      value: `考生可于考试开始前${personnel.earliestLoginMinutes}分钟登录`,
    },
    { name: "正式考试-监考人员安排", value: "ATA监考-分散" },
    { name: "正式考试-监考人员数量", value: String(personnel.monitorCount) },
    { name: "正式考试-监考人员比例", value: String(personnel.monitorRatio) },
    { name: "正式考试-监考登录监控", value: String(personnel.loginMonitoring) },
  ];
}

function successfulAttemptResult(overrides = {}) {
  return {
    status: "sent",
    sendRecord: { type: "首次发送", sentAt: "2026-07-23T02:00:20.000Z" },
    operationSnapshot: { batch: { code: "EZT260003", published: true } },
    completedAt: "2026-07-23T02:00:21.000Z",
    ...overrides,
  };
}

function serviceHarness(options = {}) {
  let currentTime = START;
  const task = baseTask();
  const requirement = options.requirement || { requestId: "requirement-a", version: 3, changeRequests: [] };
  const runnerCalls = [];
  const inspectionInstructions = [];
  const attemptInstructions = [];
  const recheckInstructions = [];
  const deferredJobs = [];
  const profileLocks = [];
  const taskLocks = [];
  const persistedStates = [];
  let tokenCounter = 0;
  let attemptCounter = 0;
  let inspection = inspectionFor(task, options.environment || "test");
  const setBatchScheduleStatus = (status) => {
    task.config.operationBatch.status = status;
    task.config.operationBatch.managedSnapshot = {
      batchName: "湖北邮政招聘考试",
      examStartDate: "2026-08-22",
      examEndDate: "2026-08-22",
      schedules: [managedSchedule(
        status === "update_available" ? { start: "2026-08-22T08:00:00" } : {},
      )],
    };
  };
  const setSynchronizedManagedSchedule = (overrides = {}) => {
    const schedule = managedSchedule(overrides);
    task.config.examRequirement.fields["考试日期时间"] = [
      schedule.start.replace("T", " "),
      schedule.end.replace("T", " "),
    ].join(" - ");
    task.config.operationBatch.status = "success";
    task.config.operationBatch.managedSnapshot = {
      batchName: "湖北邮政招聘考试",
      examStartDate: schedule.start.slice(0, 10),
      examEndDate: schedule.end.slice(0, 10),
      schedules: [schedule],
    };
  };
  setBatchScheduleStatus(options.batchScheduleStatus || "success");
  let batchChangedAfterInspection = false;

  if (options.alreadySent || options.changedAfterSend) {
    const currentDraft = buildOperationPersonnelTaskDraft(task, {
      environment: options.environment || "test",
      now: new Date(START).toISOString(),
    });
    currentDraft.managedSchedules = structuredClone(
      task.config.operationBatch.managedSnapshot.schedules,
    );
    task.config.operationPersonnelTask = {
      schemaVersion: 1,
      environment: options.environment || "test",
      status: "sent",
      draft: currentDraft,
      draftVersion: 1,
      sourceFingerprint: operationPersonnelTaskFingerprint(currentDraft),
      lastSuccessfulFingerprint: options.changedAfterSend
        ? "previous-fingerprint"
        : operationPersonnelTaskFingerprint(currentDraft),
      scheduleCodeMap: currentDraft.scheduleCodeMap,
      lastOperationSnapshot: structuredClone(inspection),
      checkpoints: {},
      activePreview: null,
      activeAttempt: null,
      sendHistory: [],
      changeSummary: "",
      events: [],
    };
  }

  if (options.orphanedAttemptCheckpoint || options.resultUnknown) {
    const draft = buildOperationPersonnelTaskDraft(task, {
      environment: options.environment || "test",
      now: new Date(START).toISOString(),
    });
    draft.managedSchedules = structuredClone(
      task.config.operationBatch.managedSnapshot.schedules,
    );
    const operationSnapshot = normalizeOperationPersonnelSnapshot(inspection);
    draft.operationBatch = structuredClone(operationSnapshot.batch);
    draft.operationRequirements = structuredClone(operationSnapshot.requirements);
    draft.operationTaskSheet = structuredClone(operationSnapshot.taskSheet);
    draft.directoryMatch = structuredClone(operationSnapshot.directoryMatch);
    draft.previewOperationSnapshot = structuredClone(operationSnapshot);
    const target = normalizeOperationPersonnelSnapshot({
      batch: {
        ...draft.operationBatch,
        ...draft.batch,
        published: true,
      },
      schedules: inspection.schedules,
      personnel: draft.personnel,
      dates: draft.dates,
      requirements: requirementsForPersonnel(draft.personnel),
      taskSheet: draft.operationTaskSheet,
      directoryMatch: draft.directoryMatch,
    });
    const checkpointName = options.orphanedAttemptCheckpoint || "verify_send_record";
    const attempt = {
      attemptId: "attempt-orphan",
      kind: "initial",
      operator: "owner@example.com",
      environment: options.environment || "test",
      requirementVersion: 3,
      draftVersion: 1,
      fingerprint: operationPersonnelTaskFingerprint(draft),
      recipients: { to: inspection.directoryMatch.to, cc: inspection.directoryMatch.cc },
      managedSchedules: structuredClone(draft.managedSchedules),
      changeSummary: "",
      createdAt: "2026-07-23T02:00:00.000Z",
      startedAt: "2026-07-23T02:00:01.000Z",
      status: "running",
      target,
      baseline: structuredClone(target),
      previewBinding: {
        operationSnapshotFingerprint: valueFingerprint(operationSnapshot),
        directoryMatchFingerprint: valueFingerprint(operationSnapshot.directoryMatch),
        managedScheduleFingerprint: valueFingerprint(draft.managedSchedules),
      },
    };
    task.config.operationPersonnelTask = {
      schemaVersion: 1,
      environment: options.environment || "test",
      status: options.resultUnknown ? "result_unknown" : "sending",
      draft,
      draftVersion: 1,
      sourceFingerprint: operationPersonnelTaskFingerprint(draft),
      lastSuccessfulFingerprint: "",
      scheduleCodeMap: draft.scheduleCodeMap,
      lastOperationSnapshot: null,
      checkpoints: {
        ...(options.submitStartedAt ? {
          submit_send: {
            name: "submit_send",
            status: "running",
            readback: { kind: "initial", startedAt: options.submitStartedAt },
          },
        } : {}),
        [checkpointName]: {
          name: checkpointName,
          status: "running",
          ...(checkpointName === "submit_send"
            ? { readback: { kind: "initial", startedAt: attempt.startedAt } }
            : {}),
        },
      },
      activePreview: null,
      activeAttempt: attempt,
      sendHistory: [],
      changeSummary: "",
      events: [],
    };
  }

  const updateTaskConfig = async (taskId, config) => {
    assert.equal(taskId, task.taskId);
    persistedStates.push(structuredClone(config.operationPersonnelTask));
    task.config = { ...task.config, ...structuredClone(config) };
    return task;
  };
  const runnerResult = options.runnerResult || successfulAttemptResult();
  const service = createOperationPersonnelTaskService({
    readTask: async (taskId) => taskId === task.taskId ? task : null,
    updateTaskConfig,
    readRequirement: async () => requirement,
    coordinator: {
      acquireProfile() {
        profileLocks.push("acquire");
        return () => profileLocks.push("release");
      },
      acquireTask(taskId) {
        assert.equal(taskId, task.taskId);
        taskLocks.push("acquire");
        return () => taskLocks.push("release");
      },
    },
    runInspection: async (instruction) => {
      runnerCalls.push("inspection");
      inspectionInstructions.push(structuredClone(instruction));
      assert.equal(instruction.environment, options.environment || "test");
      options.onInspection?.(task);
      const result = structuredClone(
        typeof options.inspectionResult === "function"
          ? options.inspectionResult(instruction, inspection)
          : inspection,
      );
      if (options.changeBatchAfterInspection && !batchChangedAfterInspection) {
        batchChangedAfterInspection = true;
        setBatchScheduleStatus(options.changeBatchAfterInspection);
      }
      if (options.changeManagedScheduleAfterInspection && !batchChangedAfterInspection) {
        batchChangedAfterInspection = true;
        setSynchronizedManagedSchedule(options.changeManagedScheduleAfterInspection);
      }
      if (options.externalBaseline) {
        result.sendRecords = structuredClone(options.externalSendRecords || [{
          type: "首次发送",
          sentAt: "2026-07-23 10:09:34",
        }]);
        if (!instruction.directoryProbeSummary) {
          result.directoryMatch = { to: [], cc: [] };
        }
      }
      return result;
    },
    runAttempt: async (instruction, runnerOptions) => {
      runnerCalls.push("attempt");
      attemptInstructions.push(structuredClone(instruction));
      if (options.checkpoint) await runnerOptions.onCheckpoint(options.checkpoint);
      if (typeof runnerResult === "function") return runnerResult();
      return typeof runnerResult?.then === "function" ? runnerResult : structuredClone(runnerResult);
    },
    runRecheck: async (instruction) => {
      runnerCalls.push("recheck");
      recheckInstructions.push(structuredClone(instruction));
      return structuredClone(options.recheckResult || { status: "result_unknown", sendRecord: null });
    },
    environment: options.environment ?? "test",
    activeAttemptIds: new Set(),
    now: () => currentTime,
    makeToken: () => `preview-${++tokenCounter}`,
    makeAttemptId: () => `attempt-${++attemptCounter}`,
    defer: (job) => deferredJobs.push(job),
  });

  return {
    service,
    task,
    requirement,
    runnerCalls,
    inspectionInstructions,
    attemptInstructions,
    recheckInstructions,
    deferredJobs,
    profileLocks,
    taskLocks,
    inspections: inspectionInstructions,
    persistedStates,
    attempts: attemptInstructions,
    setBatchScheduleStatus,
    setSynchronizedManagedSchedule,
    setInspection(value) {
      inspection = value;
    },
    advance(ms) {
      currentTime += ms;
    },
    async runDeferred() {
      while (deferredJobs.length) await deferredJobs.shift()();
    },
  };
}

test("preview token binds requirement, draft, operation snapshot and directory", async () => {
  const harness = serviceHarness();
  const preview = await harness.service.preview("task-a", owner(), {});
  const active = harness.task.config.operationPersonnelTask.activePreview;

  assert.equal(active.requirementVersion, 3);
  assert.equal(active.draftVersion, preview.draftVersion);
  assert.match(active.operationSnapshotFingerprint, /^[a-f0-9]{64}$/);
  assert.match(active.directoryMatchFingerprint, /^[a-f0-9]{64}$/);
  assert.match(active.managedScheduleFingerprint, /^[a-f0-9]{64}$/);
  harness.task.config.examRequirement.version += 1;

  await assert.rejects(
    harness.service.send("task-a", owner(), {
      previewToken: preview.previewToken,
      draftVersion: preview.draftVersion,
      changeSummary: "",
    }),
    { code: "PERSONNEL_PREVIEW_STALE", status: 409 },
  );
});

test("preview blocks before operation inspection when batch schedules are incomplete", async () => {
  const harness = serviceHarness({ batchScheduleStatus: "waiting_schedule" });
  await assert.rejects(
    harness.service.preview("task-a", ADMIN),
    (error) => error.code === "PERSONNEL_BATCH_SCHEDULE_INCOMPLETE"
      && /请先在建批次环节完成批次信息修改/.test(error.message),
  );
  assert.equal(harness.inspections.length, 0);
});

test("preview blocks when batch update is available or failed", async () => {
  for (const status of ["update_available", "updating", "update_failed"]) {
    const harness = serviceHarness({ batchScheduleStatus: status });
    await assert.rejects(
      harness.service.preview("task-a", ADMIN),
      (error) => error.code === "PERSONNEL_BATCH_UPDATE_REQUIRED",
    );
  }
});

test("preview exposes managed schedules without schedule write codes", async () => {
  const harness = serviceHarness({ batchScheduleStatus: "success" });
  const preview = await harness.service.preview("task-a", ADMIN);
  assert.deepEqual(preview.state.draft.managedSchedules, [{
    requirementIndex: 0,
    name: "湖北邮政招聘考试",
    start: "2026-08-22T09:00:00",
    end: "2026-08-22T11:00:00",
  }]);
  assert.equal(Object.hasOwn(preview.state.draft.managedSchedules[0], "scheduleCode"), false);
});

test("preview rechecks the batch schedule gate before persisting", async () => {
  const harness = serviceHarness({ changeBatchAfterInspection: "update_available" });
  await assert.rejects(
    harness.service.preview("task-a", ADMIN),
    (error) => error.code === "PERSONNEL_BATCH_UPDATE_REQUIRED",
  );
  assert.equal(harness.persistedStates.length, 0);
});

test("preview rejects a successful managed snapshot changed before persistence", async () => {
  const harness = serviceHarness({
    changeManagedScheduleAfterInspection: {
      start: "2026-08-22T10:00:00",
      end: "2026-08-22T12:00:00",
    },
  });
  await assert.rejects(
    harness.service.preview("task-a", ADMIN),
    (error) => error.code === "PERSONNEL_BATCH_SCHEDULE_CONFLICT",
  );
  assert.equal(harness.persistedStates.length, 0);
});

test("send invalidates a confirmed preview when batch schedules changed", async () => {
  const harness = serviceHarness({ batchScheduleStatus: "success" });
  const preview = await harness.service.preview("task-a", ADMIN);
  harness.setBatchScheduleStatus("update_available");
  await assert.rejects(
    harness.service.send("task-a", ADMIN, {
      previewToken: preview.previewToken,
      draftVersion: preview.draftVersion,
    }),
    (error) => error.code === "PERSONNEL_BATCH_UPDATE_REQUIRED",
  );
  assert.equal(harness.attempts.length, 0);
});

test("send rejects a successful managed schedule changed after preview", async () => {
  const harness = serviceHarness({ batchScheduleStatus: "success" });
  const preview = await harness.service.preview("task-a", ADMIN);
  harness.setSynchronizedManagedSchedule({
    start: "2026-08-22T10:00:00",
    end: "2026-08-22T12:00:00",
  });

  await assert.rejects(
    harness.service.send("task-a", ADMIN, {
      previewToken: preview.previewToken,
      draftVersion: preview.draftVersion,
    }),
    (error) => error.code === "PERSONNEL_BATCH_SCHEDULE_CONFLICT",
  );
  assert.equal(harness.attempts.length, 0);
  assert.equal(harness.task.config.operationPersonnelTask.activePreview, null);
});

test("send keeps managed schedules outside the operation target and forwards them read-only", async () => {
  const harness = serviceHarness();
  const visible = inspectionFor(harness.task);
  visible.schedules = [{
    scheduleEntryId: "visible-1",
    scheduleCode: 88,
    subjectCode: "C001",
    subjectName: "综合能力",
    start: "2026-08-22 09:00:00",
    end: "2026-08-22 11:00:00",
    durationMinutes: 120,
    earlyLoginMinutes: 30,
  }];
  harness.setInspection(visible);

  const preview = await harness.service.preview("task-a", ADMIN);
  await harness.service.send("task-a", ADMIN, {
    previewToken: preview.previewToken,
    draftVersion: preview.draftVersion,
  });

  const attempt = harness.task.config.operationPersonnelTask.activeAttempt;
  assert.deepEqual(attempt.target.schedules, visible.schedules);
  assert.deepEqual(attempt.managedSchedules, [managedSchedule()]);
  await harness.runDeferred();
  assert.deepEqual(harness.attempts[0].managedSchedules, [managedSchedule()]);
});

test("ordinary resend uses draft changes even when operation configuration is unchanged", async () => {
  const harness = serviceHarness({ changedAfterSend: true });
  harness.task.config.examRequirement.fields["考试日期时间"] =
    "2026/08/22 10:00 - 2026/08/22 12:00";
  harness.task.config.operationBatch.managedSnapshot = {
    batchName: "湖北邮政招聘考试",
    examStartDate: "2026-08-22",
    examEndDate: "2026-08-22",
    schedules: [managedSchedule({
      start: "2026-08-22T10:00:00",
      end: "2026-08-22T12:00:00",
    })],
  };
  const draft = buildOperationPersonnelTaskDraft(harness.task, {
    environment: "test",
    now: new Date(START).toISOString(),
  });
  const current = inspectionFor(harness.task);
  current.batch = { ...draft.batch, published: true };
  current.schedules = [{
    scheduleEntryId: "visible-1",
    scheduleCode: 88,
    subjectCode: "C001",
    subjectName: "综合能力",
    start: "2026-08-22 09:00:00",
    end: "2026-08-22 11:00:00",
    durationMinutes: 120,
    earlyLoginMinutes: 30,
  }];
  current.personnel = structuredClone(draft.personnel);
  current.dates = structuredClone(draft.dates);
  current.requirements = requirementsForPersonnel(draft.personnel);
  harness.task.config.operationPersonnelTask.lastOperationSnapshot = structuredClone(current);
  harness.setInspection(current);

  const preview = await harness.service.preview("task-a", ADMIN);
  assert.deepEqual(preview.operationChanges, []);
  assert.equal(
    preview.changes.fields.some((item) => item.path === "managedSchedules"),
    true,
  );
  const accepted = await harness.service.send("task-a", ADMIN, {
    previewToken: preview.previewToken,
    draftVersion: preview.draftVersion,
    changeSummary: "批次受管日程已调整",
  });
  assert.equal(accepted.statusCode, 202);
});

test("unpublished initial preview defers task sheet and directory inspection until send", async () => {
  const harness = serviceHarness({
    inspectionResult(instruction, inspection) {
      assert.equal(instruction.allowUnpublishedPreview, true);
      return {
        ...inspection,
        batch: { ...inspection.batch, published: false },
        taskSheet: {},
        sendRecords: [],
        directoryMatch: { to: [], cc: [] },
      };
    },
  });

  const preview = await harness.service.preview("task-a", owner(), {});

  assert.equal(preview.state.activePreview.kind, "initial");
  assert.deepEqual(preview.state.draft.directoryMatch, { to: [], cc: [] });
  assert.equal(preview.state.draft.previewOperationSnapshot.batch.published, false);
});

test("changing requirement 2 invalidates a preview even when the singular legacy alias is unchanged", async () => {
  const harness = serviceHarness();
  const first = structuredClone(harness.task.config.examRequirement);
  harness.task.config.examRequirements = [
    first,
    {
      ...structuredClone(first),
      id: "requirement-2",
      version: 7,
      config: {
        ...structuredClone(first.config),
        startTimeDisplay: "2026/08/23 09:00",
        endTimeDisplay: "2026/08/23 11:00",
      },
    },
  ];
  harness.task.config.examRequirements[1].fields = {
    "考试名称": "湖北邮政招聘考试（二）",
    "考试日期时间": "2026/08/23 09:00 - 2026/08/23 11:00",
  };
  harness.task.config.operationBatch.managedSnapshot = {
    batchName: "湖北邮政招聘考试",
    examStartDate: "2026-08-22",
    examEndDate: "2026-08-23",
    schedules: [
      managedSchedule(),
      {
        requirementIndex: 1,
        name: "湖北邮政招聘考试（二）",
        start: "2026-08-23T09:00:00",
        end: "2026-08-23T11:00:00",
      },
    ],
  };
  const preview = await harness.service.preview("task-a", owner(), {});
  harness.task.config.examRequirements[1].version += 1;

  await assert.rejects(
    harness.service.send("task-a", owner(), {
      previewToken: preview.previewToken,
      draftVersion: preview.draftVersion,
      changeSummary: "",
    }),
    { code: "PERSONNEL_PREVIEW_STALE", status: 409 },
  );
  assert.equal(harness.deferredJobs.length, 0);
  assert.equal(harness.task.config.operationPersonnelTask.activeAttempt, null);
});

test("preview rejects an unsupported personnel scope before inspection or token persistence", async () => {
  const harness = serviceHarness();
  harness.task.config.businessRequirement.high_end_supplement_required = "是";

  await assert.rejects(
    harness.service.preview("task-a", owner(), {}),
    { code: "PERSONNEL_TASK_UNSUPPORTED", status: 409 },
  );
  assert.deepEqual(harness.runnerCalls, []);
  assert.equal(harness.task.config.operationPersonnelTask, undefined);
  assert.equal(harness.deferredJobs.length, 0);
});

test("send rejects residual draft warnings before queueing an attempt", async () => {
  const harness = serviceHarness();
  const preview = await harness.service.preview("task-a", owner(), {});
  const state = harness.task.config.operationPersonnelTask;
  state.draft.warnings.push({ code: "UNSUPPORTED_PERSONNEL_TASK" });
  state.sourceFingerprint = valueFingerprint(state.draft);

  await assert.rejects(
    harness.service.send("task-a", owner(), {
      previewToken: preview.previewToken,
      draftVersion: preview.draftVersion,
      changeSummary: "",
    }),
    { code: "PERSONNEL_DRAFT_INCOMPLETE", status: 409 },
  );
  assert.equal(harness.deferredJobs.length, 0);
  assert.equal(state.activeAttempt, null);
  assert.equal(state.activePreview.token, preview.previewToken);
});

test("visible prior send record adopts an external resend baseline in two inspections", async () => {
  const harness = serviceHarness({ externalBaseline: true });
  const preview = await harness.service.preview("task-a", owner(), {});
  const state = harness.task.config.operationPersonnelTask;

  assert.equal(harness.inspectionInstructions.length, 2);
  assert.equal(harness.inspectionInstructions[0].directoryProbeSummary, undefined);
  assert.match(
    harness.inspectionInstructions[1].directoryProbeSummary,
    /personnel|dates|schedules/,
  );
  assert.equal(state.activePreview.kind, "resend");
  assert.equal(state.activePreview.externalBaseline, true);
  assert.deepEqual(state.activePreview.baselineSendRecord, {
    type: "首次发送",
    sentAt: "2026-07-23 10:09:34",
  });
  assert.match(state.activePreview.baselineSnapshotFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(state.lastSuccessfulFingerprint, "");
  assert.equal(state.sendHistory.length, 0);
  assert.equal(
    state.events.some((item) => (
      item.type === "operation_personnel_external_send_baseline_adopted"
    )),
    true,
  );
  assert.equal(preview.state.activePreview.kind, "resend");
});

test("test external baseline excludes allowed identity and equivalent schedule display differences", async () => {
  const harness = serviceHarness({ externalBaseline: true });
  const draft = buildOperationPersonnelTaskDraft(harness.task, {
    environment: "test",
    now: new Date(START).toISOString(),
  });
  const current = inspectionFor(harness.task, "test");
  current.batch = {
    ...draft.batch,
    projectCode: "4473-26",
    projectName: "测试运控项目",
    published: true,
  };
  current.schedules = draft.schedules.map((schedule) => ({
    scheduleEntryId: "",
    scheduleCode: schedule.scheduleCode,
    subjectCode: "",
    subjectName: schedule.subjectName,
    start: schedule.start.replaceAll("/", "-"),
    end: schedule.end.replaceAll("/", "-"),
    durationMinutes: 120,
    earlyLoginMinutes: schedule.earlyLoginMinutes,
  }));
  current.personnel = {
    ...draft.personnel,
    candidateBasis: "",
    monitorCount: 3,
  };
  current.dates = { ...draft.dates, end: "2026-08-18" };
  harness.setInspection(current);

  const preview = await harness.service.preview("task-a", owner(), {});
  const paths = preview.operationChanges.map((item) => item.path);

  assert.equal(paths.includes("batch.projectCode"), false);
  assert.equal(paths.includes("batch.projectName"), false);
  assert.equal(paths.includes("schedules"), false);
  assert.equal(paths.includes("personnel.monitorCount"), true);
  assert.equal(paths.includes("dates.end"), true);
  assert.equal(paths.includes("requirements"), false);

  await harness.service.send("task-a", owner(), {
    previewToken: preview.previewToken,
    draftVersion: preview.draftVersion,
    changeSummary: "人员数量和结束日期已调整",
  });
  const attempt = harness.task.config.operationPersonnelTask.activeAttempt;
  assert.deepEqual(attempt.target.schedules, current.schedules);
  assert.equal(attempt.target.batch.projectCode, "4473-26");
  assert.equal(attempt.target.batch.projectName, "测试运控项目");
  assert.equal(
    attempt.target.requirements.find((item) => (
      item.name === "正式考试-监考人员数量"
    )).value,
    String(draft.personnel.monitorCount),
  );
});

test("unchanged external baseline blocks before directory inspection", async () => {
  const harness = serviceHarness({ externalBaseline: true });
  const draft = buildOperationPersonnelTaskDraft(harness.task, {
    environment: "test",
    now: new Date(START).toISOString(),
  });
  const current = inspectionFor(harness.task, "test");
  current.batch.published = true;
  current.schedules = structuredClone(draft.schedules);
  current.personnel = structuredClone(draft.personnel);
  current.dates = structuredClone(draft.dates);
  current.requirements = requirementsForPersonnel(draft.personnel);
  harness.setInspection(current);

  await assert.rejects(
    harness.service.preview("task-a", owner(), {}),
    { code: "PERSONNEL_CONTENT_UNCHANGED", status: 409 },
  );
  assert.equal(harness.inspectionInstructions.length, 1);
  assert.equal(harness.task.config.operationPersonnelTask, undefined);
});

test("external baseline blocks drift between snapshot and directory inspection", async () => {
  const harness = serviceHarness({
    externalBaseline: true,
    inspectionResult: (instruction, current) => {
      const result = structuredClone(current);
      if (instruction.directoryProbeSummary) {
        result.dates.end = "2099-01-01";
      }
      return result;
    },
  });

  await assert.rejects(
    harness.service.preview("task-a", owner(), {}),
    {
      code: "PERSONNEL_OPERATION_CONFLICT",
      status: 409,
    },
  );
  assert.equal(harness.inspectionInstructions.length, 2);
  assert.equal(harness.task.config.operationPersonnelTask, undefined);
});

test("external resend preview binds the adopted baseline against tampering", async () => {
  const harness = serviceHarness({ externalBaseline: true });
  const preview = await harness.service.preview("task-a", owner(), {});
  harness.task.config.operationPersonnelTask.draft.previewBaselineSnapshot.dates.end = "2099-01-01";

  await assert.rejects(
    harness.service.send("task-a", owner(), {
      previewToken: preview.previewToken,
      draftVersion: preview.draftVersion,
      changeSummary: "人员日期调整",
    }),
    { code: "PERSONNEL_PREVIEW_STALE", status: 409 },
  );
});

test("external resend requires a reviewed change summary", async () => {
  const harness = serviceHarness({ externalBaseline: true });
  const preview = await harness.service.preview("task-a", owner(), {});

  await assert.rejects(
    harness.service.send("task-a", owner(), {
      previewToken: preview.previewToken,
      draftVersion: preview.draftVersion,
      changeSummary: "",
    }),
    { code: "PERSONNEL_CHANGE_SUMMARY_REQUIRED", status: 400 },
  );
  assert.equal(harness.deferredJobs.length, 0);
});

test("external resend writes local success only after the new send record", async () => {
  const harness = serviceHarness({
    externalBaseline: true,
    runnerResult: successfulAttemptResult({
      sendRecord: {
        type: "再次发送",
        sentAt: "2026-07-23T02:00:20.000Z",
      },
    }),
  });
  const preview = await harness.service.preview("task-a", owner(), {});
  const accepted = await harness.service.send("task-a", owner(), {
    previewToken: preview.previewToken,
    draftVersion: preview.draftVersion,
    changeSummary: "人员日期调整",
  });
  const queued = harness.task.config.operationPersonnelTask;

  assert.equal(accepted.statusCode, 202);
  assert.equal(queued.activeAttempt.kind, "resend");
  assert.deepEqual(
    queued.activeAttempt.baseline,
    queued.draft.previewBaselineSnapshot,
  );
  assert.equal(queued.lastSuccessfulFingerprint, "");
  assert.equal(queued.sendHistory.length, 0);

  await harness.runDeferred();
  const completed = harness.task.config.operationPersonnelTask;
  assert.match(completed.lastSuccessfulFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(completed.sendHistory.length, 1);
  assert.equal(completed.sendHistory[0].attemptId, accepted.attemptId);
});

test("preview token expires after ten minutes", async () => {
  const harness = serviceHarness();
  const preview = await harness.service.preview("task-a", owner(), {});
  assert.equal(preview.expiresAt, "2026-07-23T02:10:00.000Z");
  harness.advance(10 * 60 * 1000 + 1);

  await assert.rejects(
    harness.service.send("task-a", owner(), {
      previewToken: preview.previewToken,
      draftVersion: preview.draftVersion,
      changeSummary: "",
    }),
    { code: "PERSONNEL_PREVIEW_STALE", status: 409 },
  );
});

test("preview token rejects an invalid expiresAt value", async () => {
  const harness = serviceHarness();
  const preview = await harness.service.preview("task-a", owner(), {});
  harness.task.config.operationPersonnelTask.activePreview.expiresAt = "not-a-date";
  await assert.rejects(
    harness.service.send("task-a", owner(), {
      previewToken: preview.previewToken,
      draftVersion: preview.draftVersion,
      changeSummary: "",
    }),
    { code: "PERSONNEL_PREVIEW_STALE", status: 409 },
  );
});

test("preview rejects a requirement version changed during the operation inspection", async () => {
  const harness = serviceHarness({
    onInspection: (task) => {
      task.config.examRequirement.version += 1;
    },
  });
  await assert.rejects(
    harness.service.preview("task-a", owner(), {}),
    { code: "PERSONNEL_PREVIEW_STALE", status: 409 },
  );
  assert.equal(harness.task.config.operationPersonnelTask, undefined);
});

test("identical successful fingerprint cannot be resent", async () => {
  const harness = serviceHarness({ alreadySent: true });
  const preview = await harness.service.preview("task-a", owner(), {});
  await assert.rejects(
    harness.service.send("task-a", owner(), {
      previewToken: preview.previewToken,
      draftVersion: preview.draftVersion,
      changeSummary: "",
    }),
    { code: "PERSONNEL_CONTENT_UNCHANGED", status: 409 },
  );
});

test("get keeps a synchronized successful managed schedule in sent state", async () => {
  const harness = serviceHarness({ alreadySent: true });

  const current = await harness.service.get("task-a", owner());

  assert.equal(current.state.status, "sent");
  assert.deepEqual(current.state.draft.managedSchedules, [managedSchedule()]);
});

test("get exposes a fresh draft and changes_pending after a sent requirement changes", async () => {
  const harness = serviceHarness({ alreadySent: true });
  harness.task.config.examRequirement.version += 1;
  harness.task.config.examRequirement.config.startTimeDisplay = "2026/08/23 09:00";
  harness.task.config.examRequirement.config.endTimeDisplay = "2026/08/23 11:00";

  const current = await harness.service.get("task-a", owner());

  assert.equal(current.state.status, "changes_pending");
  assert.equal(current.state.draft.schedules[0].start, "2026/08/23 09:00");
  assert.equal(current.state.draft.sourceVersion.requirements[0].version, 4);
  assert.equal(current.state.activeAttempt, null);
  assert.equal(current.state.sendHistory.length, 0);
});

test("service environment is authoritative and request environment is ignored", async () => {
  const harness = serviceHarness({ environment: "test" });
  const preview = await harness.service.preview("task-a", owner(), { environment: "production" });
  assert.equal(preview.state.environment, "test");
  assert.deepEqual(preview.state.draft.recipients.toNames, ["张乐翔"]);
  assert.equal(preview.state.draft.recipients.ccCount, 0);
});

test("send validates the complete previewed operation snapshot binding", async () => {
  const mutations = [
    (state) => { state.draft.operationBatch.batchName = "外部修改"; },
    (state) => { state.draft.operationRequirements.push({ name: "新增需求", value: "是" }); },
    (state) => { state.draft.operationTaskSheet.content = "变化后的任务内容"; },
    (state) => { state.draft.previewOperationSnapshot.batch.batchName = "快照被替换"; },
    (state) => { state.activePreview.operationSnapshotFingerprint = "0".repeat(64); },
  ];
  for (const mutate of mutations) {
    const harness = serviceHarness();
    const preview = await harness.service.preview("task-a", owner(), {});
    mutate(harness.task.config.operationPersonnelTask);
    await assert.rejects(
      harness.service.send("task-a", owner(), {
        previewToken: preview.previewToken,
        draftVersion: preview.draftVersion,
        changeSummary: "",
      }),
      { code: "PERSONNEL_PREVIEW_STALE", status: 409 },
    );
  }
});

test("unknown service environment blocks get and preview", async () => {
  const harness = serviceHarness({ environment: "staging" });
  const current = await harness.service.get("task-a", owner());
  assert.equal(current.state.status, "unsupported");
  assert.equal(current.state.environment, "staging");

  await assert.rejects(
    harness.service.preview("task-a", owner(), { environment: "test" }),
    { code: "PERSONNEL_ENVIRONMENT_INVALID", status: 409 },
  );
});

test("missing service environment cannot fall back to a test draft", async () => {
  const harness = serviceHarness({ environment: "" });
  const current = await harness.service.get("task-a", owner());
  assert.equal(current.state.status, "unsupported");
  assert.deepEqual(current.state.draft, {});
});

test("pending external requirement change blocks preview", async () => {
  const harness = serviceHarness({
    requirement: { changeRequests: [{ status: "pending_internal_review" }] },
  });
  await assert.rejects(
    harness.service.preview("task-a", owner(), {}),
    { code: "PERSONNEL_PENDING_REQUIREMENT_CHANGE", status: 409 },
  );
});

test("non-owner cannot read or operate a personnel task", async () => {
  const harness = serviceHarness();
  const stranger = { email: "other@example.com", role: "user" };
  await assert.rejects(harness.service.get("task-a", stranger), {
    code: "PERSONNEL_TASK_NOT_FOUND",
    status: 404,
  });
  await assert.rejects(harness.service.preview("task-a", stranger, {}), {
    code: "PERSONNEL_TASK_NOT_FOUND",
    status: 404,
  });
});

test("editable draft changes increment version and append an auto-confirmed audit event", async () => {
  const harness = serviceHarness();
  const preview = await harness.service.preview("task-a", owner(), {
    dates: { end: "2026-08-18" },
    monitorCount: 4,
  });
  assert.equal(preview.draftVersion, 2);
  assert.equal(preview.state.draft.dates.end, "2026-08-18");
  assert.equal(preview.state.draft.personnel.monitorCount, 4);
  assert.deepEqual(
    preview.state.events.at(-1).changes.map((item) => item.path),
    ["dates.end", "personnel.monitorCount"],
  );
  assert.equal(preview.state.events.at(-1).type, "operation_personnel_draft_auto_confirmed");
});

test("editable dates and monitor count clear only the warnings they resolve", async () => {
  const harness = serviceHarness();
  harness.task.sessions[0].candidateCount = 0;
  harness.task.config.examRequirement.config.startTimeDisplay = "invalid";
  harness.task.config.examRequirement.config.endTimeDisplay = "2026/07/24 11:00";
  const preview = await harness.service.preview("task-a", owner(), {
    dates: {
      start: "2026-07-23",
      end: "2026-07-23",
      nameListDue: "2026-07-23",
    },
    monitorCount: 2,
  });
  assert.equal(
    preview.state.draft.warnings.some((item) => item.code === "PERSONNEL_DATES_REQUIRED"),
    false,
  );
  assert.equal(
    preview.state.draft.warnings.some((item) => item.code === "MONITOR_COUNT_REQUIRED"),
    false,
  );
  assert.equal(
    preview.state.draft.warnings.some((item) => item.code === "INVALID_SCHEDULE_RANGE"),
    true,
  );
  assert.equal(preview.state.draft.personnel.monitorCount, 2);
});

test("invalid edited dates and monitor count keep their resolvable warnings", async () => {
  const harness = serviceHarness();
  harness.task.sessions[0].candidateCount = 0;
  harness.task.config.examRequirement.config.startTimeDisplay = "2026/07/24 09:00";
  harness.task.config.examRequirement.config.endTimeDisplay = "2026/07/24 11:00";
  const preview = await harness.service.preview("task-a", owner(), {
    dates: {
      start: "2026-02-30",
      end: "2026-02-28",
      nameListDue: "not-a-date",
    },
    monitorCount: 0,
  });
  assert.equal(
    preview.state.draft.warnings.some((item) => item.code === "PERSONNEL_DATES_REQUIRED"),
    true,
  );
  assert.equal(
    preview.state.draft.warnings.some((item) => item.code === "MONITOR_COUNT_REQUIRED"),
    true,
  );
});

test("monitor count accepts only positive integer numbers or digit strings", async () => {
  for (const [value, expected] of [[2, 2], ["3", 3]]) {
    const harness = serviceHarness();
    const preview = await harness.service.preview("task-a", owner(), { monitorCount: value });
    assert.equal(preview.state.draft.personnel.monitorCount, expected);
    assert.equal(
      preview.state.draft.warnings.some((item) => item.code === "MONITOR_COUNT_REQUIRED"),
      false,
    );
  }

  for (const value of [1.5, "1.5", 0, -1, true, [1], { value: 1 }, "", " "]) {
    const harness = serviceHarness();
    const preview = await harness.service.preview("task-a", owner(), { monitorCount: value });
    assert.equal(
      preview.state.draft.warnings.some((item) => item.code === "MONITOR_COUNT_REQUIRED"),
      true,
      `monitorCount=${JSON.stringify(value)}`,
    );
  }
});

test("monitor ratio requires a positive integer ratio and keeps one stable warning", async () => {
  for (const value of ["1:50", "2:75"]) {
    const harness = serviceHarness();
    const preview = await harness.service.preview("task-a", owner(), {
      personnel: { monitorRatio: value },
    });
    assert.equal(preview.state.draft.personnel.monitorRatio, value);
    assert.equal(
      preview.state.draft.warnings.some((item) => item.code === "MONITOR_RATIO_REQUIRED"),
      false,
    );
  }

  for (const value of ["", " ", "abc", "0:50", "1:0", "1.5:50", true, ["1:50"], { ratio: "1:50" }]) {
    const harness = serviceHarness();
    const first = await harness.service.preview("task-a", owner(), {
      personnel: { monitorRatio: value },
    });
    assert.equal(
      first.state.draft.warnings.filter((item) => item.code === "MONITOR_RATIO_REQUIRED").length,
      1,
      `monitorRatio=${JSON.stringify(value)}`,
    );
    const second = await harness.service.preview("task-a", owner(), {
      personnel: { monitorRatio: value },
    });
    assert.equal(
      second.state.draft.warnings.filter((item) => item.code === "MONITOR_RATIO_REQUIRED").length,
      1,
      `repeat monitorRatio=${JSON.stringify(value)}`,
    );
  }
});

test("preview returns actual operation to target changes separately from draft edits", async () => {
  const harness = serviceHarness();
  const preview = await harness.service.preview("task-a", owner(), {
    monitorCount: 4,
  });
  assert.ok(Array.isArray(preview.operationChanges));
  assert.deepEqual(
    preview.operationChanges.find((item) => item.path === "batch.published"),
    { path: "batch.published", before: false, after: true },
  );
  assert.equal(preview.operationChanges.some((item) => item.path === "schedules"), false);
  assert.ok(preview.operationChanges.some((item) => item.path === "personnel.monitorCount"));
  assert.equal(preview.changes.fields.some((item) => item.path === "personnel.monitorCount"), true);
});

test("send persists queued attempt and returns before the runner completes", async () => {
  const pending = Promise.withResolvers();
  const harness = serviceHarness({ runnerResult: pending.promise });
  const preview = await harness.service.preview("task-a", owner(), {});
  const accepted = await harness.service.send("task-a", owner(), {
    previewToken: preview.previewToken,
    draftVersion: preview.draftVersion,
    changeSummary: "",
  });

  assert.equal(accepted.statusCode, 202);
  assert.equal(harness.task.config.operationPersonnelTask.activeAttempt.status, "queued");
  assert.equal(harness.runnerCalls.includes("attempt"), false);
  pending.resolve(successfulAttemptResult());
});

test("resend requires a non-empty reviewed change summary", async () => {
  const harness = serviceHarness({ changedAfterSend: true });
  const preview = await harness.service.preview("task-a", owner(), {});
  await assert.rejects(
    harness.service.send("task-a", owner(), {
      previewToken: preview.previewToken,
      draftVersion: preview.draftVersion,
      changeSummary: " ",
    }),
    { code: "PERSONNEL_CHANGE_SUMMARY_REQUIRED", status: 400 },
  );
});

test("preview token is consumed once and double submit cannot create two attempts", async () => {
  const harness = serviceHarness();
  const preview = await harness.service.preview("task-a", owner(), {});
  const payload = {
    previewToken: preview.previewToken,
    draftVersion: preview.draftVersion,
    changeSummary: "",
  };
  const first = await harness.service.send("task-a", owner(), payload);
  assert.equal(first.statusCode, 202);
  assert.equal(harness.task.config.operationPersonnelTask.activePreview, null);
  await assert.rejects(
    harness.service.send("task-a", owner(), payload),
    { code: "PERSONNEL_ATTEMPT_IN_PROGRESS", status: 409 },
  );
  assert.equal(harness.deferredJobs.length, 1);
});

test("a resumable orphan keeps its attempt id and completed checkpoints", async () => {
  const harness = serviceHarness({ orphanedAttemptCheckpoint: "sync_personnel_dates" });
  harness.task.config.operationPersonnelTask.activeAttempt.error = {
    code: "OLD_FAILURE",
    message: "previous failure",
  };
  harness.task.config.operationPersonnelTask.activeAttempt.completedAt =
    "2026-07-23T02:00:02.000Z";
  const preview = await harness.service.preview("task-a", owner(), {});
  const accepted = await harness.service.send("task-a", owner(), {
    previewToken: preview.previewToken,
    draftVersion: preview.draftVersion,
    changeSummary: "",
  });
  assert.equal(accepted.attemptId, "attempt-orphan");
  assert.equal(
    harness.task.config.operationPersonnelTask.checkpoints.sync_personnel_dates.status,
    "running",
  );
  assert.equal(harness.task.config.operationPersonnelTask.activeAttempt.error, null);
  assert.equal(harness.task.config.operationPersonnelTask.activeAttempt.completedAt, "");
});

test("changed resumable target gets a new attempt id and clears old checkpoints", async () => {
  const harness = serviceHarness({ orphanedAttemptCheckpoint: "sync_personnel_dates" });
  const preview = await harness.service.preview("task-a", owner(), { monitorCount: 4 });
  const accepted = await harness.service.send("task-a", owner(), {
    previewToken: preview.previewToken,
    draftVersion: preview.draftVersion,
    changeSummary: "",
  });
  assert.equal(accepted.attemptId, "attempt-1");
  assert.deepEqual(harness.task.config.operationPersonnelTask.checkpoints, {});
  assert.equal(
    harness.task.config.operationPersonnelTask.activeAttempt.target.personnel.monitorCount,
    4,
  );
});

test("queued attempt retains the exact previewed batch identity", async () => {
  const harness = serviceHarness();
  harness.task.config.operationBatch.draft = {
    fields: {
      batchName: { value: "2026 秋季批次" },
    },
  };
  const inspected = inspectionFor(harness.task);
  inspected.batch.batchName = "2026 秋季批次";
  inspected.batch.projectDepartment = "交付一部";
  inspected.batch.projectManager = "负责人";
  inspected.batch.systemType = "易考";
  harness.setInspection(inspected);
  const preview = await harness.service.preview("task-a", owner(), {});
  await harness.service.send("task-a", owner(), {
    previewToken: preview.previewToken,
    draftVersion: preview.draftVersion,
    changeSummary: "",
  });
  await harness.runDeferred();
  assert.equal(harness.attemptInstructions[0].target.batch.batchName, "2026 秋季批次");
  assert.equal(harness.attemptInstructions[0].target.batch.projectDepartment, "交付一部");
});

test("background attempt persists checkpoints and atomically records success", async () => {
  const checkpoint = {
    name: "submit_send",
    status: "running",
    startedAt: "2026-07-23T02:00:10.000Z",
    targetDigest: "digest",
    readback: { kind: "initial", startedAt: "2026-07-23T02:00:10.000Z" },
  };
  const harness = serviceHarness({ checkpoint });
  const preview = await harness.service.preview("task-a", owner(), {});
  const accepted = await harness.service.send("task-a", owner(), {
    previewToken: preview.previewToken,
    draftVersion: preview.draftVersion,
    changeSummary: "",
  });
  await harness.runDeferred();

  const state = harness.task.config.operationPersonnelTask;
  assert.deepEqual(state.checkpoints.submit_send, checkpoint);
  assert.equal(state.status, "sent");
  assert.equal(state.activeAttempt.attemptId, accepted.attemptId);
  assert.equal(state.activeAttempt.status, "sent");
  assert.equal(state.sendHistory.length, 1);
  assert.equal(state.sendHistory[0].attemptId, accepted.attemptId);
  assert.equal(state.sendHistory[0].fingerprint, state.lastSuccessfulFingerprint);
});

test("failure classification preserves the irreversible submit boundary", async () => {
  for (const checkpoint of [
    { name: "sync_personnel_dates", status: "running" },
    {
      name: "submit_send",
      status: "running",
      readback: { kind: "initial", startedAt: "2026-07-23T02:00:10.000Z" },
    },
  ]) {
    const failure = new Error("runner stopped");
    const harness = serviceHarness({
      checkpoint,
      runnerResult: async () => { throw failure; },
    });
    const preview = await harness.service.preview("task-a", owner(), {});
    await harness.service.send("task-a", owner(), {
      previewToken: preview.previewToken,
      draftVersion: preview.draftVersion,
      changeSummary: "",
    });
    await harness.runDeferred();
    assert.equal(
      harness.task.config.operationPersonnelTask.status,
      checkpoint.name === "submit_send" ? "result_unknown" : "failed_resumable",
    );
  }
});

test("restart recovery distinguishes pre-send failure from unknown send result", async () => {
  const beforeSend = serviceHarness({ orphanedAttemptCheckpoint: "sync_personnel_dates" });
  assert.equal((await beforeSend.service.get("task-a", owner())).state.status, "failed_resumable");

  const afterSend = serviceHarness({ orphanedAttemptCheckpoint: "verify_send_record" });
  assert.equal((await afterSend.service.get("task-a", owner())).state.status, "result_unknown");
});

test("attempt lookup is project-scoped", async () => {
  const harness = serviceHarness({ resultUnknown: true });
  await assert.rejects(harness.service.attempt("task-a", owner(), "attempt-other"), {
    code: "PERSONNEL_ATTEMPT_NOT_FOUND",
    status: 404,
  });
  assert.equal(
    (await harness.service.attempt("task-a", owner(), "attempt-orphan")).attempt.attemptId,
    "attempt-orphan",
  );
});

test("sent personnel state does not expose a stale active-attempt error", async () => {
  const harness = serviceHarness({ resultUnknown: true });
  harness.task.config.operationPersonnelTask.status = "sent";
  harness.task.config.operationPersonnelTask.activeAttempt.status = "sent";
  harness.task.config.operationPersonnelTask.activeAttempt.error = {
    code: "PERSONNEL_OPERATION_CONFLICT",
    message: "旧错误",
  };

  const result = await harness.service.get("task-a", owner());

  assert.equal(result.state.status, "sent");
  assert.equal(result.state.activeAttempt.error, null);
});

test("result_unknown blocks preview without inspection or persistence", async () => {
  const harness = serviceHarness({ resultUnknown: true });
  const before = structuredClone(harness.task.config.operationPersonnelTask);
  await assert.rejects(
    harness.service.preview("task-a", owner(), {}),
    { code: "PERSONNEL_RESULT_UNKNOWN", status: 409 },
  );
  assert.deepEqual(harness.runnerCalls, []);
  assert.deepEqual(harness.task.config.operationPersonnelTask, before);
  assert.equal(harness.deferredJobs.length, 0);
});

test("recheck only runs for result_unknown and never invokes send", async () => {
  const harness = serviceHarness({ resultUnknown: true });
  await harness.service.recheck("task-a", owner());
  assert.deepEqual(harness.runnerCalls, ["recheck"]);
});

test("recheck uses the irreversible submit checkpoint start time", async () => {
  const harness = serviceHarness({
    resultUnknown: true,
    submitStartedAt: "2026-07-23T02:00:10.000Z",
  });
  await harness.service.recheck("task-a", owner());
  assert.equal(
    harness.recheckInstructions[0].attempt.startedAt,
    "2026-07-23T02:00:10.000Z",
  );
});

test("recheck reconciles a newly visible record without another send or attempt id", async () => {
  const harness = serviceHarness({
    resultUnknown: true,
    recheckResult: {
      status: "sent",
      sendRecord: { type: "首次发送", sentAt: "2026-07-23T02:00:20.000Z" },
      operationSnapshot: { batch: { published: true } },
    },
  });
  harness.task.config.operationPersonnelTask.activeAttempt.error = {
    code: "PERSONNEL_OPERATION_CONFLICT",
    message: "旧错误",
  };
  const result = await harness.service.recheck("task-a", owner());
  assert.equal(result.state.status, "sent");
  assert.equal(result.state.sendHistory.length, 1);
  assert.equal(result.state.sendHistory[0].attemptId, "attempt-orphan");
  assert.equal(result.state.activeAttempt.attemptId, "attempt-orphan");
  assert.equal(result.state.activeAttempt.error, null);
  assert.deepEqual(harness.runnerCalls, ["recheck"]);
});

test("recheck normalizes the real runner return shape into a resend baseline", async () => {
  const sendRecord = { type: "首次发送", sentAt: "2026-07-23T02:00:20.000Z" };
  const historical = { type: "首次发送", sentAt: "2026-07-22T02:00:20.000Z" };
  const harness = serviceHarness({
    resultUnknown: true,
    recheckResult: {
      status: "sent",
      sendRecord,
      sendRecords: [historical],
    },
  });
  harness.task.config.operationPersonnelTask.activeAttempt.operationSnapshot = {
    batch: { published: true },
  };
  const result = await harness.service.recheck("task-a", owner());
  assert.equal(result.state.lastOperationSnapshot.batch.code, "EZT260003");
  assert.equal(result.state.lastOperationSnapshot.personnel.platform, "悦站");
  assert.deepEqual(result.state.lastOperationSnapshot.sendRecords, [sendRecord, historical]);
  assert.deepEqual(
    result.state.sendHistory[0].operationSnapshot,
    result.state.lastOperationSnapshot,
  );
});
