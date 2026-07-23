import assert from "node:assert/strict";
import test from "node:test";

import * as operationPersonnelRunner from "./operation_personnel_task_runner.mjs";
import {
  inspectOperationPersonnelTask,
  matchOperationPersonnelRecipients,
  normalizeOperationPersonnelSnapshot,
  operationPersonnelConflicts,
  runOperationPersonnelInspection,
} from "./operation_personnel_task_runner.mjs";

function validInstruction(overrides = {}) {
  const target = {
    batch: {
      code: "EZT260003",
      projectCode: "P001",
      projectName: "项目一",
      batchName: "批次一",
      projectDepartment: "交付一部",
      projectManager: "项目经理",
      systemType: "易考",
      published: true,
    },
    schedules: [{
      scheduleEntryId: "schedule-1",
      scheduleCode: 1,
      subjectCode: "SUB-1",
      subjectName: "科目一",
      start: "2026-08-22 10:00",
      end: "2026-08-22 11:00",
      durationMinutes: 60,
      earlyLoginMinutes: 30,
    }],
    personnel: {
      serviceType: "ATA 监考－分散在线监考",
      platform: "悦站",
      loginMonitoring: "是",
      monitorRatio: "1:50",
      candidateBasis: 60,
      monitorCount: 2,
      earliestLoginMinutes: 30,
      trialIncluded: false,
    },
    dates: {
      start: "2026-07-23",
      end: "2026-08-19",
      nameListDue: "2026-08-19",
    },
    requirements: [{ name: "在线监考", value: "需要" }],
    taskSheet: {
      type: "分散在线监考",
      conditions: [{ name: "人员配置", satisfied: true }],
      content: "任务内容",
    },
    directoryMatch: {
      to: [{ group: "演示组", id: "u1", name: "张乐翔" }],
      cc: [],
    },
  };
  return {
    environment: "test",
    kind: "initial",
    batch: target.batch,
    target,
    checkpoints: {},
    ...overrides,
  };
}

function fakeOperationPage(overrides = {}) {
  const target = validInstruction().target;
  return {
    events: [],
    state: {
      batch: { ...target.batch, published: overrides.published === true },
      schedules: overrides.schedules ?? [],
      personnel: {
        ...target.personnel,
        platform: overrides.personnelPlatform ?? "",
      },
      dates: overrides.dates ?? {},
      requirements: overrides.requirements ?? [],
      taskSheet: overrides.taskSheet ?? target.taskSheet,
      sendRecords: overrides.sendRecords ?? [],
      selectedRecipients: { to: [], cc: [] },
    },
    sendRecordsAfterReopen: overrides.sendRecordsAfterReopen,
  };
}

function fakeOperationContext(page = fakeOperationPage()) {
  return {
    pages: () => [page],
    close: async () => page.events.push("context:close"),
  };
}

function advancingClock(start = Date.parse("2026-07-23T02:00:00.000Z")) {
  let current = start;
  return () => {
    const value = current;
    current += 1000;
    return value;
  };
}

function attemptOptions(page = fakeOperationPage(), overrides = {}) {
  return {
    context: fakeOperationContext(page),
    readBatchPages: async () => exactBatchPages(),
    openBatchRow: async () => page.events.push("batch:open"),
    readBatch: async () => ({ ...page.state.batch }),
    readSchedules: async () => page.state.schedules,
    readPersonnel: async () => page.state.personnel,
    readDates: async () => page.state.dates,
    readRequirements: async () => page.state.requirements,
    readTaskSheet: async () => page.state.taskSheet,
    readSendRecords: async () => page.state.sendRecords,
    readDirectoryGroups: async () => [
      { name: "演示组", people: [{ id: "u1", name: "张乐翔" }] },
    ],
    publishBatch: async () => {
      page.events.push("publish:click");
      page.state.batch.published = true;
    },
    syncExamSchedules: async (_actualPage, schedules) => {
      page.events.push("schedules:fill");
      page.state.schedules = structuredClone(schedules);
    },
    syncPersonnelConfig: async (_actualPage, personnel) => {
      page.events.push("personnel:fill");
      page.state.personnel = structuredClone(personnel);
    },
    syncPersonnelDates: async (_actualPage, dates) => {
      page.events.push("dates:fill");
      page.state.dates = structuredClone(dates);
    },
    syncExamServiceRequirements: async (_actualPage, requirements) => {
      page.events.push("requirements:fill");
      page.state.requirements = structuredClone(requirements);
    },
    openTaskSheet: async () => page.events.push("task-sheet:open"),
    selectRecipients: async (_actualPage, recipients) => {
      page.events.push("recipients:select");
      page.state.selectedRecipients = structuredClone(recipients);
    },
    readSelectedRecipients: async () => page.state.selectedRecipients,
    confirmSend: async (_actualPage, attempt) => {
      page.events.push("send:confirm");
      if (page.sendRecordsAfterReopen === undefined) {
        page.state.sendRecords.push({
          type: attempt.kind === "resend" ? "再次发送" : "首次发送",
          sentAt: new Date(Date.parse(attempt.startedAt) + 1000).toISOString(),
        });
      }
    },
    closeTaskSheet: async () => page.events.push("task-sheet:close"),
    reopenTaskSheet: async () => {
      page.events.push("task-sheet:reopen");
      if (page.sendRecordsAfterReopen !== undefined) {
        page.state.sendRecords = structuredClone(page.sendRecordsAfterReopen);
      }
    },
    sleep: async () => {},
    now: advancingClock(),
    ...overrides,
  };
}

function exactBatchPages(rows = [{ cells: ["EZT260003"], rowId: "target" }]) {
  return {
    headers: ["批次代码"],
    pages: [rows],
  };
}

function inspectionReaders(overrides = {}) {
  return {
    readBatchPages: async () => exactBatchPages(),
    openBatchRow: async () => {},
    readBatch: async () => ({ code: "EZT260003" }),
    readSchedules: async () => [],
    readPersonnel: async () => ({}),
    readDates: async () => ({}),
    readRequirements: async () => [],
    readTaskSheet: async () => ({}),
    readSendRecords: async () => [],
    readDirectoryGroups: async () => [
      { name: "演示组", people: [{ id: "u1", name: "张乐翔" }] },
    ],
    ...overrides,
  };
}

function visibleSnapshot(evidence = {}) {
  return {
    batch: { code: "EZT260003" },
    schedules: [],
    personnel: { platform: "" },
    dates: {},
    requirements: [],
    taskSheet: {},
    sendRecords: [],
    directoryGroups: [
      { name: "演示组", people: [{ id: "u1", name: "张乐翔" }] },
    ],
    evidence: {
      batch: { present: true },
      schedules: { present: true },
      personnel: { present: true },
      dates: { present: true },
      requirements: { present: true },
      taskSheet: { present: true },
      sendRecords: { present: true },
      directoryGroups: { present: true },
      ...evidence,
    },
  };
}

test("attempt applies checkpoints in the approved order", async () => {
  const observed = [];
  await operationPersonnelRunner.runOperationPersonnelAttempt(validInstruction(), attemptOptions(
    fakeOperationPage(),
    { onCheckpoint: async ({ name, status }) => observed.push(`${name}:${status}`) },
  ));
  assert.deepEqual(observed.filter((item) => item.endsWith(":completed")), [
    "inspect_batch:completed",
    "publish_batch:completed",
    "sync_exam_schedules:completed",
    "sync_personnel_config:completed",
    "sync_personnel_dates:completed",
    "sync_exam_service_requirements:completed",
    "verify_task_sheet:completed",
    "select_recipients:completed",
    "submit_send:completed",
    "verify_send_record:completed",
  ]);
});

test("published batches skip the publish click but still complete the checkpoint", async () => {
  const page = fakeOperationPage({ published: true });
  await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page),
  );
  assert.equal(page.events.filter((item) => item === "publish:click").length, 0);
});

test("never retries the final send click when the send record is delayed", async () => {
  const page = fakeOperationPage({ sendRecordsAfterReopen: [] });
  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page),
  );
  assert.equal(page.events.filter((item) => item === "send:confirm").length, 1);
  assert.equal(page.events.filter((item) => item === "task-sheet:reopen").length, 1);
  assert.equal(result.status, "result_unknown");
});

test("resend only accepts a record later than attempt start", () => {
  assert.equal(operationPersonnelRunner.findAttemptSendRecord([
    { type: "再次发送", sentAt: "2026-07-23T01:59:59.000Z" },
  ], {
    kind: "resend",
    startedAt: "2026-07-23T02:00:00.000Z",
  }), null);
  assert.equal(operationPersonnelRunner.findAttemptSendRecord([
    { type: "再次发送", sentAt: "2026-07-23T02:00:01.000Z" },
  ], {
    kind: "resend",
    startedAt: "2026-07-23T02:00:00.000Z",
  }).sentAt, "2026-07-23T02:00:01.000Z");
});

test("recheck is read-only", async () => {
  const page = fakeOperationPage({ sendRecords: [] });
  await operationPersonnelRunner.runOperationPersonnelRecheck(
    {
      ...validInstruction(),
      attempt: { kind: "initial", startedAt: "2026-07-23T02:00:00.000Z" },
    },
    attemptOptions(page),
  );
  assert.equal(page.events.some((item) => (
    /publish|fill|delete|send:confirm|recipients:select/.test(item)
  )), false);
});

test("resume skips a verified checkpoint and blocks drift before continuing", async () => {
  const captured = {};
  await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(fakeOperationPage(), {
      onCheckpoint: async (update) => {
        if (update.status === "completed") captured[update.name] = update;
      },
    }),
  );

  const matching = fakeOperationPage({ personnelPlatform: "悦站" });
  await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction({
      checkpoints: { sync_personnel_config: captured.sync_personnel_config },
    }),
    attemptOptions(matching),
  );
  assert.equal(matching.events.includes("personnel:fill"), false);

  const drifted = fakeOperationPage({ personnelPlatform: "其他平台" });
  await assert.rejects(() => operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction({
      checkpoints: { sync_personnel_config: captured.sync_personnel_config },
    }),
    attemptOptions(drifted),
  ), { code: "PERSONNEL_OPERATION_CONFLICT" });
});

test("resume after submit never clicks final confirmation again", async () => {
  const captured = {};
  await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(fakeOperationPage(), {
      onCheckpoint: async (update) => {
        if (update.status === "completed") captured[update.name] = update;
      },
    }),
  );
  const page = fakeOperationPage({
    published: true,
    sendRecords: [{ type: "首次发送", sentAt: "2026-07-23T02:00:10.000Z" }],
  });
  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction({
      checkpoints: { submit_send: captured.submit_send },
    }),
    attemptOptions(page),
  );
  assert.equal(page.events.includes("send:confirm"), false);
  assert.equal(result.status, "sent");
});

test("schedule deletion requires one exact schedule entry id and code row", async () => {
  const baseline = validInstruction().target;
  const target = { ...structuredClone(baseline), schedules: [] };
  const page = fakeOperationPage({
    published: true,
    schedules: baseline.schedules,
    personnelPlatform: "悦站",
    dates: baseline.dates,
    requirements: baseline.requirements,
  });
  await assert.rejects(() => operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction({ kind: "resend", baseline, target }),
    attemptOptions(page, {
      findScheduleRows: async () => [{ id: "row-a" }, { id: "row-b" }],
      deleteSchedule: async () => page.events.push("schedule:delete"),
    }),
  ), { code: "PERSONNEL_SCHEDULE_NOT_UNIQUE" });
  assert.equal(page.events.includes("schedule:delete"), false);
});

test("task sheet conditions must all be satisfied before recipients are selected", async () => {
  const page = fakeOperationPage({
    taskSheet: {
      ...validInstruction().target.taskSheet,
      conditions: [{ name: "人员配置", satisfied: false }],
    },
  });
  await assert.rejects(() => operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page),
  ), { code: "PERSONNEL_TASK_SHEET_BLOCKED" });
  assert.equal(page.events.includes("recipients:select"), false);
});

test("recipient matching requires the exact environment directory result", () => {
  assert.deepEqual(matchOperationPersonnelRecipients({
    environment: "test",
    groups: [{ name: "演示组", people: [{ id: "u1", name: "张乐翔" }] }],
  }), {
    to: [{ id: "u1", name: "张乐翔" }],
    cc: [],
  });
  assert.throws(() => matchOperationPersonnelRecipients({
    environment: "production",
    groups: [
      { name: "拓展二部", people: [{ id: "u1", name: "唐润梅" }] },
      { name: "结算组", people: [{ id: "u2", name: "甲" }] },
    ],
  }), /结算组必须精确匹配 4 人/);
});

test("snapshot normalization is stable and keeps only matched directory people", () => {
  assert.deepEqual(normalizeOperationPersonnelSnapshot({
    batch: {
      code: " EZT260003 ",
      projectCode: " P001 ",
      published: true,
    },
    schedules: [
      { scheduleCode: "2", subjectName: " 科目二 ", start: " 2026-08-22 12:00 " },
      { scheduleCode: 1, subjectName: " 科目一 ", start: " 2026-08-22 10:00 " },
    ],
    personnel: { platform: " 悦站 ", monitorCount: "2" },
    directoryMatch: {
      to: [{ group: " 演示组 ", id: " u1 ", name: " 张乐翔 ", email: "secret@example.com" }],
      cc: [],
      groups: [{ name: "不应保存", people: [{ id: "secret" }] }],
    },
  }), {
    batch: {
      code: "EZT260003",
      projectCode: "P001",
      projectName: "",
      batchName: "",
      projectDepartment: "",
      projectManager: "",
      systemType: "",
      published: true,
    },
    schedules: [
      {
        scheduleEntryId: "",
        scheduleCode: 1,
        subjectCode: "",
        subjectName: "科目一",
        start: "2026-08-22 10:00",
        end: "",
        durationMinutes: "",
        earlyLoginMinutes: "",
      },
      {
        scheduleEntryId: "",
        scheduleCode: 2,
        subjectCode: "",
        subjectName: "科目二",
        start: "2026-08-22 12:00",
        end: "",
        durationMinutes: "",
        earlyLoginMinutes: "",
      },
    ],
    personnel: {
      serviceType: "",
      platform: "悦站",
      loginMonitoring: "",
      monitorRatio: "",
      candidateBasis: "",
      monitorCount: 2,
      earliestLoginMinutes: "",
      trialIncluded: false,
    },
    dates: { start: "", end: "", nameListDue: "" },
    requirements: [],
    taskSheet: { type: "", conditions: [], content: "" },
    sendRecords: [],
    directoryMatch: {
      to: [{ group: "演示组", id: "u1", name: "张乐翔" }],
      cc: [],
    },
  });
});

test("inspection opens only the exact batch code and returns a read-only snapshot", async () => {
  const opened = [];
  const page = { marker: "page" };
  const instruction = { environment: "test", batch: { code: "EZT260003" } };
  const snapshot = await inspectOperationPersonnelTask(page, instruction, {
    readBatchPages: async () => ({
      headers: ["关联代码", "批次代码"],
      pages: [
        [{ cells: ["EZT260003", "EZT260030"], rowId: "wrong-column-token" }],
        [{ cells: ["other", "EZT260003"], rowId: "target" }],
      ],
    }),
    openBatchRow: async (actualPage, row) => {
      assert.strictEqual(actualPage, page);
      opened.push(row.rowId);
    },
    readBatch: async () => ({ code: "EZT260003", projectCode: "P001", published: false }),
    readSchedules: async () => [{ scheduleCode: 1, start: "2026-08-22 10:00" }],
    readPersonnel: async () => ({ platform: "悦站" }),
    readDates: async () => ({ start: "2026-07-23" }),
    readRequirements: async () => [{ name: "在线监考", value: "需要" }],
    readTaskSheet: async () => ({ type: "分散在线监考", content: "任务内容" }),
    readSendRecords: async () => [{ type: "首次发送", sentAt: "2026-07-23 11:00" }],
    readDirectoryGroups: async () => [
      { name: "演示组", people: [{ id: "u1", name: "张乐翔", email: "hidden@example.com" }] },
      { name: "其它组", people: [{ id: "u9", name: "不应返回" }] },
    ],
  });

  assert.deepEqual(opened, ["target"]);
  assert.deepEqual(snapshot.directoryMatch, {
    to: [{ group: "演示组", id: "u1", name: "张乐翔" }],
    cc: [],
  });
  assert.equal(JSON.stringify(snapshot).includes("hidden@example.com"), false);
  assert.equal(JSON.stringify(snapshot).includes("不应返回"), false);
});

test("inspection rejects missing and duplicate exact batch rows", async () => {
  const instruction = { environment: "test", batch: { code: "EZT260003" } };
  await assert.rejects(() => inspectOperationPersonnelTask({}, instruction, {
    readBatchPages: async () => exactBatchPages([{ cells: ["EZT260030"] }]),
  }), /未找到批次代码 EZT260003/);
  await assert.rejects(() => inspectOperationPersonnelTask({}, instruction, {
    readBatchPages: async () => ({
      headers: ["批次代码"],
      pages: [
        [{ cells: ["EZT260003"] }],
        [{ cells: ["EZT260003"] }],
      ],
    }),
  }), /批次代码 EZT260003 精确匹配到 2 行/);
});

test("inspection rejects a detail identity that differs from the selected batch", async () => {
  await assert.rejects(() => inspectOperationPersonnelTask(
    {},
    { environment: "test", batch: { code: "EZT260003", projectCode: "P001" } },
    inspectionReaders({
      readBatch: async () => ({ code: "EZT260004", projectCode: "P001" }),
    }),
  ), /批次详情身份不一致.*EZT260003.*EZT260004/);
});

test("missing DOM controls, tables, and task sections block inspection", async () => {
  const instruction = { environment: "test", batch: { code: "EZT260003" } };
  for (const [section, missing] of [
    ["personnel", "人员落实平台"],
    ["schedules", "考试日程表"],
    ["taskSheet", "分散在线监考任务单"],
  ]) {
    await assert.rejects(() => inspectOperationPersonnelTask({}, instruction, {
      readBatchPages: async () => exactBatchPages(),
      openBatchRow: async () => {},
      readVisibleSnapshot: async () => visibleSnapshot({
        [section]: { present: false, missing: [missing] },
      }),
    }), new RegExp(`运控人员任务检查阻断.*${missing}`));
  }
});

test("a present operation control with an empty value remains fillable", async () => {
  const snapshot = await inspectOperationPersonnelTask(
    {},
    { environment: "test", batch: { code: "EZT260003" } },
    {
      readBatchPages: async () => exactBatchPages(),
      openBatchRow: async () => {},
      readVisibleSnapshot: async () => visibleSnapshot(),
    },
  );
  assert.equal(snapshot.personnel.platform, "");
  assert.deepEqual(operationPersonnelConflicts(
    { personnel: { platform: "悦站" } },
    snapshot,
    "initial",
  ), []);
});

test("first send may fill empty operation fields but never overwrite values", () => {
  assert.deepEqual(operationPersonnelConflicts(
    { personnel: { platform: "悦站" } },
    { personnel: { platform: "" } },
    "initial",
  ), []);
  assert.deepEqual(operationPersonnelConflicts(
    { personnel: { platform: "悦站" } },
    { personnel: { platform: "其他平台" } },
    "initial",
  ).map((item) => item.path), ["personnel.platform"]);
});

test("batch identity mismatches always block initial send", () => {
  assert.deepEqual(operationPersonnelConflicts(
    { batch: { projectCode: "P001" } },
    { batch: { projectCode: "" } },
    "initial",
  ).map((item) => item.path), ["batch.projectCode"]);
});

test("initial conflicts project only expected fields from a normalized actual snapshot", () => {
  const actual = normalizeOperationPersonnelSnapshot({
    batch: { code: "EZT260003", projectCode: "P001" },
    personnel: { platform: "" },
  });
  assert.deepEqual(operationPersonnelConflicts(
    { personnel: { platform: "悦站" } },
    actual,
    "initial",
  ), []);
});

test("initial conflicts reject an extra actual schedule by stable code membership", () => {
  const conflicts = operationPersonnelConflicts(
    { schedules: [{ scheduleCode: 1, start: "2026-08-22 10:00" }] },
    {
      schedules: [
        { scheduleCode: 1, start: "2026-08-22 10:00" },
        { scheduleCode: 2, start: "2026-08-23 10:00" },
      ],
    },
    "initial",
  );
  assert.deepEqual(conflicts.map((item) => item.path), ["schedules.2"]);
});

test("initial conflicts reject actual-only non-empty target configuration", () => {
  assert.deepEqual(operationPersonnelConflicts(
    { personnel: {} },
    { personnel: { platform: "其他平台", trialIncluded: false } },
    "initial",
  ).map((item) => item.path), ["personnel.platform"]);
  assert.deepEqual(operationPersonnelConflicts(
    { dates: {} },
    { dates: { start: "2026-07-23" } },
    "initial",
  ).map((item) => item.path), ["dates.start"]);
  assert.deepEqual(operationPersonnelConflicts(
    { requirements: [] },
    { requirements: [{ name: "在线监考", value: "需要" }] },
    "initial",
  ).map((item) => item.path), ["requirements.0"]);
});

test("initial conflicts ignore observational actual-only records and unrelated batch fields", () => {
  const actual = normalizeOperationPersonnelSnapshot({
    batch: {
      code: "EZT260003",
      projectCode: "P001",
      projectName: "不参与本次局部比较",
    },
    sendRecords: [{ type: "首次发送", sentAt: "2026-07-23 11:00" }],
  });
  assert.deepEqual(operationPersonnelConflicts(
    { batch: { projectCode: "P001" } },
    actual,
    "initial",
  ), []);
});

test("resend blocks any drift from the last successful operation snapshot", () => {
  const conflicts = operationPersonnelConflicts(
    { schedules: [{ scheduleCode: 1, start: "2026-08-22 10:00" }] },
    { schedules: [{ scheduleCode: 1, start: "2026-08-22 09:00" }] },
    "resend",
  );
  assert.equal(conflicts[0].path, "schedules.1.start");
});

test("missing or duplicate schedule codes are rejected before comparison", () => {
  assert.throws(() => normalizeOperationPersonnelSnapshot({
    schedules: [{ start: "2026-08-22 10:00" }],
  }), /考试日程缺少日程代码/);
  assert.throws(() => operationPersonnelConflicts(
    { schedules: [{ scheduleCode: 1, start: "2026-08-22 10:00" }] },
    {
      schedules: [
        { scheduleCode: 1, start: "2026-08-22 10:00" },
        { scheduleCode: 1, start: "2026-08-22 09:00" },
      ],
    },
    "resend",
  ), /考试日程代码 1 重复/);
});

test("run inspection always launches visibly and closes the shared operation context", async () => {
  const events = [];
  const page = {};
  const context = {
    pages: () => [page],
    close: async () => events.push("close"),
  };
  const result = await runOperationPersonnelInspection({
    environment: "test",
    batch: { code: "EZT260003" },
  }, {
    userDataDir: "/tmp/operation-personnel-profile",
    headless: true,
    env: { OPERATION_CONSOLE_HEADLESS: "1" },
    launchPersistentContext: async (userDataDir, launchOptions) => {
      events.push(["launch", userDataDir, launchOptions]);
      return context;
    },
    ...inspectionReaders({ openBatchRow: async () => events.push("open") }),
  });

  assert.equal(result.batch.code, "EZT260003");
  assert.deepEqual(events, [
    ["launch", "/tmp/operation-personnel-profile", { headless: false, viewport: null }],
    "open",
    "close",
  ]);
});

test("run inspection propagates context close failures", async () => {
  const closeError = new Error("inspection close failed");
  await assert.rejects(() => runOperationPersonnelInspection({
    environment: "test",
    batch: { code: "EZT260003" },
  }, {
    launchPersistentContext: async () => ({
      pages: () => [{}],
      close: async () => { throw closeError; },
    }),
    ...inspectionReaders(),
  }), (error) => error === closeError);
});
