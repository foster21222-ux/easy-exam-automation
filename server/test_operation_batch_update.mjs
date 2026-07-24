import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOperationBatchManagedResult,
  buildDesiredOperationBatchSnapshot,
  operationBatchManagedDiff,
  operationBatchUpdateState,
} from "./operation_batch_update.mjs";

function taskWithRequirements(items) {
  return {
    taskId: "task-a",
    config: {
      operationBatchCode: "EZT260003",
      businessRequirement: { batch_name: " 湖北邮政社招_2026年8月 " },
      operationBatch: {},
      examRequirements: items.map((item, index) => ({
        id: `requirement-${index + 1}`,
        fields: {
          "考试名称": item.name,
          "考试日期时间": item.range,
          "科目信息": item.subjects || "",
        },
      })),
    },
  };
}

function taskWithAppliedCount(appliedCount, desiredCount) {
  const task = taskWithRequirements(Array.from(
    { length: desiredCount },
    (_, index) => ({
      name: `日程${index + 1}`,
      range: `2026/08/${String(22 + index).padStart(2, "0")} 09:00 - 2026/08/${String(22 + index).padStart(2, "0")} 11:00`,
    }),
  ));
  task.config.operationBatch.managedSnapshot = {
    batchName: "湖北邮政社招_2026年8月",
    examStartDate: "2026-08-22",
    examEndDate: `2026-08-${String(21 + appliedCount).padStart(2, "0")}`,
    schedules: Array.from({ length: appliedCount }, (_, requirementIndex) => ({
      requirementIndex,
      name: `日程${requirementIndex + 1}`,
      start: `2026-08-${String(22 + requirementIndex).padStart(2, "0")}T09:00:00`,
      end: `2026-08-${String(22 + requirementIndex).padStart(2, "0")}T11:00:00`,
    })),
  };
  return task;
}

test("builds indexed schedules and overview date range", () => {
  const desired = buildDesiredOperationBatchSnapshot(taskWithRequirements([
    { name: "日程二", range: "2026/08/23 09:00 - 2026/08/23 11:00" },
    { name: " 日程一 ", range: "2026/08/22 15:00 - 2026/08/24 01:00" },
  ]));

  assert.equal(desired.complete, true);
  assert.equal(desired.snapshot.batchName, "湖北邮政社招_2026年8月");
  assert.equal(desired.snapshot.examStartDate, "2026-08-22");
  assert.equal(desired.snapshot.examEndDate, "2026-08-24");
  assert.deepEqual(desired.snapshot.schedules, [
    {
      requirementIndex: 0,
      name: "日程二",
      start: "2026-08-23T09:00:00",
      end: "2026-08-23T11:00:00",
    },
    {
      requirementIndex: 1,
      name: "日程一",
      start: "2026-08-22T15:00:00",
      end: "2026-08-24T01:00:00",
    },
  ]);
});

test("one incomplete requirement suppresses the complete schedule set", () => {
  const desired = buildDesiredOperationBatchSnapshot(taskWithRequirements([
    { name: "完整", range: "2026/08/22 09:00 - 2026/08/22 11:00" },
    { name: "缺时间", range: "" },
  ]));

  assert.equal(desired.complete, false);
  assert.deepEqual(desired.snapshot, {
    batchName: "湖北邮政社招_2026年8月",
    examStartDate: "",
    examEndDate: "",
    schedules: [],
  });
  assert.deepEqual(desired.missing, [{ requirementIndex: 1, fields: ["考试日期时间"] }]);
});

test("strict date parsing rejects impossible and reversed ranges", () => {
  const desired = buildDesiredOperationBatchSnapshot(taskWithRequirements([
    { name: "不存在日期", range: "2026/02/29 09:00 - 2026/02/29 11:00" },
    { name: "反向日期", range: "2026/08/22 11:00 - 2026/08/22 09:00" },
  ]));

  assert.equal(desired.complete, false);
  assert.deepEqual(desired.missing, [
    { requirementIndex: 0, fields: ["考试日期时间"] },
    { requirementIndex: 1, fields: ["考试日期时间"] },
  ]);
  assert.deepEqual(desired.snapshot.schedules, []);
});

test("reports every missing managed schedule field in stable order", () => {
  const desired = buildDesiredOperationBatchSnapshot(taskWithRequirements([
    { name: "", range: "" },
  ]));

  assert.deepEqual(desired.missing, [{
    requirementIndex: 0,
    fields: ["考试名称", "考试日期时间"],
  }]);
});

test("subject-only changes do not produce managed changes", () => {
  const before = taskWithRequirements([{
    name: "考试",
    range: "2026/08/22 09:00 - 2026/08/22 11:00",
    subjects: "语文",
  }]);
  const after = taskWithRequirements([{
    name: "考试",
    range: "2026/08/22 09:00 - 2026/08/22 11:00",
    subjects: "数学",
  }]);
  const beforeSnapshot = buildDesiredOperationBatchSnapshot(before).snapshot;
  const afterSnapshot = buildDesiredOperationBatchSnapshot(after).snapshot;

  assert.deepEqual(beforeSnapshot, afterSnapshot);
  assert.deepEqual(operationBatchManagedDiff(beforeSnapshot, afterSnapshot), []);
});

test("managed diff compares normalized values by schedule index", () => {
  const before = {
    batchName: " 批次 ",
    examStartDate: "2026-08-22",
    examEndDate: "2026-08-22",
    schedules: [{
      requirementIndex: 0,
      name: " 日程 ",
      start: "2026-08-22T09:00:00",
      end: "2026-08-22T11:00:00",
      subjects: "语文",
    }],
  };
  const after = {
    batchName: "批次",
    examStartDate: "2026-08-22",
    examEndDate: "2026-08-22",
    schedules: [{
      requirementIndex: 0,
      name: "日程",
      start: "2026-08-22T09:00:00",
      end: "2026-08-22T11:00:00",
      subjects: "数学",
    }],
  };

  assert.deepEqual(operationBatchManagedDiff(before, after), []);
});

test("schedule count decrease is a conflict and increase is append-only", () => {
  assert.equal(operationBatchUpdateState(taskWithAppliedCount(2, 1)).status, "update_conflict");

  const appendState = operationBatchUpdateState(taskWithAppliedCount(1, 2));
  assert.equal(appendState.status, "update_available");
  const appendedScheduleChanges = appendState.changes.filter((change) => change.path.startsWith("schedules["));
  assert.equal(appendedScheduleChanges.length, 3);
  assert.equal(appendedScheduleChanges.every((change) => change.requirementIndex === 1), true);
});

test("a changed applied schedule index is a conflict", () => {
  const task = taskWithAppliedCount(1, 1);
  task.config.operationBatch.managedSnapshot.schedules[0].requirementIndex = 1;

  assert.equal(operationBatchUpdateState(task).status, "update_conflict");
});

test("status priority favors conflicts, then incomplete schedules, then managed differences", () => {
  const conflict = taskWithAppliedCount(2, 1);
  conflict.config.examRequirements[0].fields["考试日期时间"] = "";
  assert.equal(operationBatchUpdateState(conflict).status, "update_conflict");

  const waiting = taskWithAppliedCount(1, 2);
  waiting.config.examRequirements[1].fields["考试日期时间"] = "";
  assert.equal(operationBatchUpdateState(waiting).status, "waiting_schedule");

  const changed = taskWithAppliedCount(1, 1);
  changed.config.examRequirements[0].fields["考试名称"] = "新日程";
  assert.equal(operationBatchUpdateState(changed).status, "update_available");

  assert.equal(operationBatchUpdateState(taskWithAppliedCount(1, 1)).status, "success");
});

test("valid legacy batch without a managed snapshot requires a read-only baseline", () => {
  const task = taskWithRequirements([{
    name: "日程",
    range: "2026/08/22 09:00 - 2026/08/22 11:00",
  }]);
  task.config.operationBatch.draft = {
    fields: {
      batchName: { value: "历史创建草稿" },
      examStartDate: { value: "2020-01-01" },
      examEndDate: { value: "2020-01-02" },
    },
  };

  const state = operationBatchUpdateState(task);

  assert.equal(state.baselineRequired, true);
  assert.notDeepEqual(
    state.changes.map((change) => change.before),
    ["历史创建草稿", "2020-01-01", "2020-01-02"],
  );
});

test("an incomplete legacy batch still waits for all schedules", () => {
  const task = taskWithRequirements([
    { name: "完整", range: "2026/08/22 09:00 - 2026/08/22 11:00" },
    { name: "不完整", range: "" },
  ]);

  const state = operationBatchUpdateState(task);

  assert.equal(state.status, "waiting_schedule");
  assert.equal(state.baselineRequired, true);
  assert.deepEqual(state.missing, [{ requirementIndex: 1, fields: ["考试日期时间"] }]);
});

test("without a valid batch code the existing creation status is preserved", () => {
  const task = taskWithRequirements([{
    name: "日程",
    range: "2026/08/22 09:00 - 2026/08/22 11:00",
  }]);
  task.config.operationBatchCode = "";
  task.config.operationBatch.status = "reconciliation_required";

  assert.equal(operationBatchUpdateState(task).status, "reconciliation_required");
});

test("persists only a normalized read-back-verified managed result", () => {
  const task = taskWithAppliedCount(1, 1);
  task.config.operationBatch.managedSnapshotVersion = 2;
  task.config.operationBatch.code = "EZT260003";
  task.config.operationBatch.managedEvents = [{ type: "managed_sync", at: "2026-08-01T00:00:00.000Z" }];

  assert.throws(
    () => applyOperationBatchManagedResult(task, {
      verified: false,
      snapshot: task.config.operationBatch.managedSnapshot,
    }),
    /回读验证/,
  );

  const patch = applyOperationBatchManagedResult(task, {
    verified: true,
    snapshot: {
      batchName: " 湖北邮政社招_2026年8月 ",
      examStartDate: "2026/08/22",
      examEndDate: "2026/08/22",
      schedules: [{
        requirementIndex: 0,
        name: " 日程1 ",
        start: "2026/08/22 09:00",
        end: "2026/08/22 11:00",
        subjects: "不应持久化",
      }],
    },
    syncedAt: "2026-08-02T03:04:05.000Z",
    action: "update",
    detailUrl: " https://operation.example/batches/EZT260003 ",
    checkpoints: ["overview_saved", "schedule_verified"],
  });

  assert.deepEqual(patch.operationBatch.managedSnapshot, {
    batchName: "湖北邮政社招_2026年8月",
    examStartDate: "2026-08-22",
    examEndDate: "2026-08-22",
    schedules: [{
      requirementIndex: 0,
      name: "日程1",
      start: "2026-08-22T09:00:00",
      end: "2026-08-22T11:00:00",
    }],
  });
  assert.equal(patch.operationBatch.code, "EZT260003");
  assert.equal(patch.operationBatch.managedSnapshotVersion, 3);
  assert.equal(patch.operationBatch.lastManagedSyncAt, "2026-08-02T03:04:05.000Z");
  assert.deepEqual(patch.operationBatch.managedEvents, [
    { type: "managed_sync", at: "2026-08-01T00:00:00.000Z" },
    {
      type: "operation_batch_managed_sync",
      action: "update",
      at: "2026-08-02T03:04:05.000Z",
      version: 3,
      detailUrl: "https://operation.example/batches/EZT260003",
      checkpoints: ["overview_saved", "schedule_verified"],
    },
  ]);
});

test("rejects an invalid verified managed snapshot", () => {
  const task = taskWithRequirements([]);

  assert.throws(
    () => applyOperationBatchManagedResult(task, {
      verified: true,
      snapshot: {
        batchName: "批次",
        examStartDate: "2026-08-22",
        examEndDate: "2026-08-22",
        schedules: [{
          requirementIndex: 0,
          name: "日程",
          start: "2026-08-22T11:00:00",
          end: "2026-08-22T09:00:00",
        }],
      },
    }),
    /受管快照/,
  );
});
