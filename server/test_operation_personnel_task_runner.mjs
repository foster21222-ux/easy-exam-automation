import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectOperationPersonnelTask,
  matchOperationPersonnelRecipients,
  normalizeOperationPersonnelSnapshot,
  operationPersonnelConflicts,
  runOperationPersonnelInspection,
} from "./operation_personnel_task_runner.mjs";

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
        scheduleCode: 1,
        subjectCode: "",
        subjectName: "科目一",
        start: "2026-08-22 10:00",
        end: "",
        durationMinutes: "",
        earlyLoginMinutes: "",
      },
      {
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
