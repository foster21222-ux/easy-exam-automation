import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectOperationBatchManagedSnapshot,
  openOperationBatchByCode,
  runOperationBatchManagedUpdate,
  runOperationBatchScheduleInitialization,
} from "./operation_batch_update_runner.mjs";

const existingSchedule = {
  name: "日程一",
  start: "2026-08-22 09:00",
  end: "2026-08-22 11:00",
};

const appliedSnapshot = {
  batchName: "湖北邮政社招_2026年8月",
  examStartDate: "2026-08-22",
  examEndDate: "2026-08-22",
  schedules: [{
    requirementIndex: 0,
    name: "日程一",
    start: "2026-08-22T09:00:00",
    end: "2026-08-22T11:00:00",
  }],
};

const desiredSnapshot = {
  batchName: "湖北邮政社招_2026年9月",
  examStartDate: "2026-09-02",
  examEndDate: "2026-09-03",
  schedules: [
    {
      requirementIndex: 0,
      name: "日程一新名称",
      start: "2026-09-02T09:00:00",
      end: "2026-09-02T11:00:00",
    },
    {
      requirementIndex: 1,
      name: "日程二",
      start: "2026-09-03T09:00:00",
      end: "2026-09-03T11:00:00",
    },
  ],
};

const instructionWithOneEditAndOneAppend = {
  batch: {
    code: "EZT260003",
    expectedAppliedSnapshot: appliedSnapshot,
  },
  desiredSnapshot,
  changes: [
    {
      path: "batchName",
      before: "湖北邮政社招_2026年8月",
      after: "湖北邮政社招_2026年9月",
    },
    {
      path: "examStartDate",
      before: "2026-08-22",
      after: "2026-09-02",
    },
    {
      path: "examEndDate",
      before: "2026-08-22",
      after: "2026-09-03",
    },
    {
      path: "schedules[0].name",
      before: "日程一",
      after: "日程一新名称",
      requirementIndex: 0,
    },
    {
      path: "schedules[0].start",
      before: "2026-08-22T09:00:00",
      after: "2026-09-02T09:00:00",
      requirementIndex: 0,
    },
    {
      path: "schedules[0].end",
      before: "2026-08-22T11:00:00",
      after: "2026-09-02T11:00:00",
      requirementIndex: 0,
    },
    {
      path: "schedules[1]",
      before: "",
      after: "日程二",
      requirementIndex: 1,
    },
  ],
};

function fakeOperationBatchPage({
  batchName = appliedSnapshot.batchName,
  examStartDate = appliedSnapshot.examStartDate,
  examEndDate = appliedSnapshot.examEndDate,
  schedules = [existingSchedule],
  readbackSnapshot,
} = {}) {
  const page = {
    actions: [],
    writes: [],
    searches: [],
    openedCodes: [],
    state: {
      batchName,
      examStartDate,
      examEndDate,
      schedules: structuredClone(schedules),
    },
    saved: false,
  };
  const adapter = {
    async openBatchByCode(actualPage, { batchCode }) {
      actualPage.searches.push(batchCode);
      actualPage.openedCodes.push(batchCode);
      actualPage.actions.push(`打开批次:${batchCode}`);
      return `http://operation/batch/batchDetail?batch_guid=${"a".repeat(32)}`;
    },
    async readOverview(actualPage) {
      const source = actualPage.saved && readbackSnapshot
        ? readbackSnapshot
        : actualPage.state;
      return {
        batchName: source.batchName,
        examStartDate: source.examStartDate,
        examEndDate: source.examEndDate,
      };
    },
    async readSchedules(actualPage) {
      const source = actualPage.saved && readbackSnapshot
        ? readbackSnapshot
        : actualPage.state;
      return structuredClone(source.schedules || []);
    },
    async writeOverview(actualPage, field, label, value) {
      actualPage.writes.push([label, value]);
      actualPage.state[field] = value;
    },
    async writeSchedule(actualPage, requirementIndex, field, label, value) {
      actualPage.writes.push([`日程${requirementIndex + 1}.${label}`, value]);
      actualPage.state.schedules[requirementIndex][field] = value;
    },
    async appendSchedule(actualPage, requirementIndex) {
      actualPage.actions.push("新增日程");
      actualPage.writes.push([`新增日程${requirementIndex + 1}`, true]);
      actualPage.state.schedules.push({ name: "", start: "", end: "" });
    },
    async save(actualPage) {
      actualPage.actions.push("保存");
      actualPage.saved = true;
    },
  };
  return { page, adapter };
}

test("inspection navigates by the exact persisted code and reads overview plus visible schedule order", async () => {
  const { page, adapter } = fakeOperationBatchPage({
    batchName: " 可见批次 ",
    examStartDate: "2026/08/22",
    examEndDate: "2026/08/23",
    schedules: [
      { name: "同名日程", start: "2026/08/23 09:00", end: "2026/08/23 11:00" },
      { name: "同名日程", start: "2026/08/22 09:00", end: "2026/08/22 11:00" },
    ],
  });

  const snapshot = await inspectOperationBatchManagedSnapshot({
    batch: { code: "EZT260003" },
  }, { page, adapter, baseUrl: "http://operation" });

  assert.deepEqual(page.searches, ["EZT260003"]);
  assert.deepEqual(page.openedCodes, ["EZT260003"]);
  assert.deepEqual(snapshot, {
    batchName: "可见批次",
    examStartDate: "2026-08-22",
    examEndDate: "2026-08-23",
    schedules: [
      {
        requirementIndex: 0,
        name: "同名日程",
        start: "2026-08-23T09:00:00",
        end: "2026-08-23T11:00:00",
      },
      {
        requirementIndex: 1,
        name: "同名日程",
        start: "2026-08-22T09:00:00",
        end: "2026-08-22T11:00:00",
      },
    ],
  });
});

test("exact-code navigation advances to the persisted batch page before opening its card", async () => {
  const events = [];
  const detailUrl = `http://operation/batch/batchDetail?batch_guid=${"b".repeat(32)}`;
  const page = {
    url: () => detailUrl,
    async waitForLoadState(state) {
      assert.equal(state, "domcontentloaded");
      events.push("detail:loaded");
    },
    locator(selector) {
      assert.equal(selector, ".header-title");
      return {
        count: async () => 1,
        first: () => ({
          locator(childSelector) {
            assert.equal(childSelector, ":scope > span");
            return {
              count: async () => 1,
              innerText: async () => "EZT260003",
            };
          },
        }),
      };
    },
  };
  const firstPage = [["OLD260001", "其他批次"]];
  const secondPage = [["EZT260003", "目标批次"]];

  const openedUrl = await openOperationBatchByCode(page, {
    batchCode: "EZT260003",
    batchListUrl: "http://operation/batch/batchList",
    options: {
      searchBatchListPages: async () => ({
        headers: ["批次代码", "批次名称"],
        pages: [firstPage, secondPage],
      }),
      startBatchListSearch: async () => ({
        headers: ["批次代码", "批次名称"],
        layout: "cards",
        rows: firstPage,
      }),
      advanceBatchListPage: async (_page, activePage) => {
        events.push(`advance:${activePage}`);
        return secondPage;
      },
      openExactBatchCard: async (_page, code) => {
        events.push(`open:${code}`);
      },
    },
  });

  assert.equal(openedUrl, detailUrl);
  assert.deepEqual(events, [
    "advance:1",
    "open:EZT260003",
    "detail:loaded",
  ]);
});

test("exact-code navigation rejects an ambiguous detail identity header", async () => {
  const page = {
    url: () => `http://operation/batch/batchDetail?batch_guid=${"c".repeat(32)}`,
    locator(selector) {
      assert.equal(selector, ".header-title");
      return {
        count: async () => 2,
        first: () => ({
          locator: () => ({
            count: async () => 1,
            innerText: async () => "EZT260003",
          }),
        }),
      };
    },
  };
  const rows = [["EZT260003", "目标批次"]];

  await assert.rejects(
    () => openOperationBatchByCode(page, {
      batchCode: "EZT260003",
      batchListUrl: "http://operation/batch/batchList",
      options: {
        searchBatchListPages: async () => ({
          headers: ["批次代码", "批次名称"],
          pages: [rows],
        }),
        startBatchListSearch: async () => ({
          headers: ["批次代码", "批次名称"],
          layout: "cards",
          rows,
        }),
        openExactBatchCard: async () => {},
      },
    }),
    (error) => error?.code === "OPERATION_BATCH_UPDATE_CONFLICT"
      && /身份/.test(error.message),
  );
});

test("updates only changed managed fields, appends schedules, and verifies after exact-code re-entry", async () => {
  const { page, adapter } = fakeOperationBatchPage();

  const result = await runOperationBatchManagedUpdate(
    instructionWithOneEditAndOneAppend,
    { page, adapter, baseUrl: "http://operation" },
  );

  assert.deepEqual(page.writes, [
    ["批次名称", "湖北邮政社招_2026年9月"],
    ["考试开始日期", "2026-09-02"],
    ["考试结束日期", "2026-09-03"],
    ["日程1.考试名称", "日程一新名称"],
    ["日程1.开始时间", "2026-09-02 09:00"],
    ["日程1.结束时间", "2026-09-02 11:00"],
    ["新增日程2", true],
    ["日程2.考试名称", "日程二"],
    ["日程2.开始时间", "2026-09-03 09:00"],
    ["日程2.结束时间", "2026-09-03 11:00"],
  ]);
  assert.deepEqual(page.openedCodes, ["EZT260003", "EZT260003"]);
  assert.equal(page.actions.includes("删除日程"), false);
  assert.equal(page.actions.includes("取消发布"), false);
  assert.equal(page.writes.some(([label]) => label === "项目名称"), false);
  assert.deepEqual(result, {
    verified: true,
    snapshot: desiredSnapshot,
    detailUrl: `http://operation/batch/batchDetail?batch_guid=${"a".repeat(32)}`,
    checkpoints: [
      "opened_exact_batch",
      "expected_snapshot_verified",
      "managed_fields_saved",
      "reentered_exact_batch",
      "exact_readback_verified",
    ],
  });
});

test("does not write unchanged existing schedule fields", async () => {
  const { page, adapter } = fakeOperationBatchPage();
  const desired = structuredClone(appliedSnapshot);
  desired.schedules[0].name = "只改名称";

  await runOperationBatchManagedUpdate({
    batch: {
      code: "EZT260003",
      expectedAppliedSnapshot: appliedSnapshot,
    },
    desiredSnapshot: desired,
    changes: [{
      path: "schedules[0].name",
      before: "日程一",
      after: "只改名称",
      requirementIndex: 0,
    }],
  }, { page, adapter, baseUrl: "http://operation" });

  assert.deepEqual(page.writes, [["日程1.考试名称", "只改名称"]]);
});

test("rejects a schedule count decrease before any write or save", async () => {
  const currentSchedules = [
    existingSchedule,
    { name: "日程二", start: "2026-08-22 13:00", end: "2026-08-22 15:00" },
  ];
  const current = {
    ...appliedSnapshot,
    schedules: [
      appliedSnapshot.schedules[0],
      {
        requirementIndex: 1,
        name: "日程二",
        start: "2026-08-22T13:00:00",
        end: "2026-08-22T15:00:00",
      },
    ],
  };
  const { page, adapter } = fakeOperationBatchPage({ schedules: currentSchedules });

  await assert.rejects(
    () => runOperationBatchManagedUpdate({
      batch: {
        code: "EZT260003",
        expectedAppliedSnapshot: current,
      },
      desiredSnapshot: appliedSnapshot,
      changes: [],
    }, { page, adapter, baseUrl: "http://operation" }),
    (error) => error?.code === "OPERATION_BATCH_SCHEDULE_COUNT_DECREASE",
  );

  assert.deepEqual(page.writes, []);
  assert.equal(page.actions.includes("保存"), false);
  assert.equal(page.actions.includes("删除日程"), false);
});

test("rejects drift from the expected applied snapshot before any write", async () => {
  const { page, adapter } = fakeOperationBatchPage({ batchName: "人工改名" });

  await assert.rejects(
    () => runOperationBatchManagedUpdate(
      instructionWithOneEditAndOneAppend,
      { page, adapter, baseUrl: "http://operation" },
    ),
    (error) => error?.code === "OPERATION_BATCH_UPDATE_CONFLICT",
  );

  assert.deepEqual(page.writes, []);
  assert.equal(page.actions.includes("保存"), false);
});

test("readback mismatch after save and exact-code re-entry never returns verified success", async () => {
  const mismatched = structuredClone(desiredSnapshot);
  mismatched.schedules[1].end = "2026-09-03 11:01";
  const { page, adapter } = fakeOperationBatchPage({ readbackSnapshot: mismatched });

  await assert.rejects(
    () => runOperationBatchManagedUpdate(
      instructionWithOneEditAndOneAppend,
      { page, adapter, baseUrl: "http://operation" },
    ),
    (error) => error?.code === "OPERATION_BATCH_READBACK_MISMATCH"
      && error.actual?.schedules?.[1]?.end === "2026-09-03T11:01:00",
  );

  assert.deepEqual(page.openedCodes, ["EZT260003", "EZT260003"]);
  assert.equal(page.actions.includes("保存"), true);
});

test("initializer rejects empty or incomplete desired schedules before browser launch", async () => {
  for (const desired of [
    { batchName: "目标批次", examStartDate: "2026-08-22", examEndDate: "2026-08-22", schedules: [] },
    {
      batchName: "目标批次",
      examStartDate: "2026-08-22",
      examEndDate: "2026-08-22",
      schedules: [{
        requirementIndex: 0,
        name: "",
        start: "2026-08-22T09:00:00",
        end: "2026-08-22T11:00:00",
      }],
    },
  ]) {
    let launches = 0;
    await assert.rejects(
      () => runOperationBatchScheduleInitialization({
        batch: { code: "EZT260003" },
        desiredSnapshot: desired,
      }, {
        launchPersistentContext: async () => {
          launches += 1;
          throw new Error("must not launch");
        },
      }),
      (error) => error?.code === "OPERATION_BATCH_INITIALIZATION_INCOMPLETE",
    );
    assert.equal(launches, 0);
  }
});

test("initializer appends the complete schedule set and returns verified readback evidence", async () => {
  const initialDesired = {
    batchName: appliedSnapshot.batchName,
    examStartDate: "2026-08-22",
    examEndDate: "2026-08-23",
    schedules: [
      {
        requirementIndex: 0,
        name: "日程一",
        start: "2026-08-22T09:00:00",
        end: "2026-08-22T11:00:00",
      },
      {
        requirementIndex: 1,
        name: "日程二",
        start: "2026-08-23T09:00:00",
        end: "2026-08-23T11:00:00",
      },
    ],
  };
  const { page, adapter } = fakeOperationBatchPage({
    examEndDate: "2026-08-22",
    schedules: [],
  });

  const result = await runOperationBatchScheduleInitialization({
    batch: { code: "EZT260003" },
    desiredSnapshot: initialDesired,
  }, { page, adapter, baseUrl: "http://operation" });

  assert.deepEqual(page.writes, [
    ["批次名称", appliedSnapshot.batchName],
    ["考试开始日期", "2026-08-22"],
    ["考试结束日期", "2026-08-23"],
    ["新增日程1", true],
    ["日程1.考试名称", "日程一"],
    ["日程1.开始时间", "2026-08-22 09:00"],
    ["日程1.结束时间", "2026-08-22 11:00"],
    ["新增日程2", true],
    ["日程2.考试名称", "日程二"],
    ["日程2.开始时间", "2026-08-23 09:00"],
    ["日程2.结束时间", "2026-08-23 11:00"],
  ]);
  assert.equal(result.verified, true);
  assert.deepEqual(result.snapshot, initialDesired);
  assert.ok(result.detailUrl.includes("/batch/batchDetail?batch_guid="));
  assert.equal(result.checkpoints.at(-1), "exact_readback_verified");
});

test("managed update accepts a token-bound live baseline with no schedules and appends all desired rows", async () => {
  const desired = {
    batchName: appliedSnapshot.batchName,
    examStartDate: "2026-08-22",
    examEndDate: "2026-08-22",
    schedules: [appliedSnapshot.schedules[0]],
  };
  const emptyBaseline = {
    batchName: appliedSnapshot.batchName,
    examStartDate: "2026-08-22",
    examEndDate: "2026-08-22",
    schedules: [],
  };
  const { page, adapter } = fakeOperationBatchPage({ schedules: [] });

  const result = await runOperationBatchManagedUpdate({
    batch: {
      code: "EZT260003",
      expectedAppliedSnapshot: emptyBaseline,
    },
    desiredSnapshot: desired,
    changes: [{
      path: "schedules[0]",
      before: "",
      after: "日程一",
      requirementIndex: 0,
    }],
  }, { page, adapter, baseUrl: "http://operation" });

  assert.equal(result.verified, true);
  assert.deepEqual(result.snapshot, desired);
  assert.deepEqual(page.writes, [
    ["新增日程1", true],
    ["日程1.考试名称", "日程一"],
    ["日程1.开始时间", "2026-08-22 09:00"],
    ["日程1.结束时间", "2026-08-22 11:00"],
  ]);
});
