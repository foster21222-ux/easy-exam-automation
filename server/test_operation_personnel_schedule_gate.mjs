import assert from "node:assert/strict";
import test from "node:test";

import { operationPersonnelScheduleGate } from "./operation_personnel_schedule_gate.mjs";

function taskWith(operationBatch = {}) {
  return {
    taskId: "task-a",
    config: {
      operationBatchCode: "EZT260003",
      businessRequirement: { batch_name: "湖北邮政招聘考试" },
      operationBatch,
      examRequirements: [{
        id: "requirement-1",
        fields: {
          "考试名称": "湖北邮政招聘考试",
          "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00",
        },
      }],
    },
  };
}

function taskWithAppliedSnapshot() {
  return taskWith({
    status: "success",
    managedSnapshot: {
      batchName: "湖北邮政招聘考试",
      examStartDate: "2026-08-22",
      examEndDate: "2026-08-22",
      schedules: [{
        requirementIndex: 0,
        name: "湖北邮政招聘考试",
        start: "2026-08-22T09:00:00",
        end: "2026-08-22T11:00:00",
      }],
    },
  });
}

test("blocks personnel task when batch schedules are incomplete", () => {
  const result = operationPersonnelScheduleGate(taskWith({
    status: "waiting_schedule",
    managedSnapshot: null,
  }));

  assert.equal(result.ok, false);
  assert.equal(result.code, "PERSONNEL_BATCH_SCHEDULE_INCOMPLETE");
  assert.match(result.message, /请先在建批次环节完成批次信息修改/);
});

test("blocks personnel task when managed batch update is required", () => {
  const task = taskWithAppliedSnapshot();
  task.config.examRequirements[0].fields["考试日期时间"] =
    "2026/08/22 10:00 - 2026/08/22 12:00";
  const result = operationPersonnelScheduleGate(task);

  assert.equal(result.ok, false);
  assert.equal(result.code, "PERSONNEL_BATCH_UPDATE_REQUIRED");
});

test("blocks historical batch without a managed snapshot", () => {
  const result = operationPersonnelScheduleGate(taskWith({
    status: "success",
    managedSnapshot: null,
  }));

  assert.equal(result.ok, false);
  assert.equal(result.code, "PERSONNEL_BATCH_UPDATE_REQUIRED");
});

test("blocks conflicting schedule identity and count", () => {
  const task = taskWithAppliedSnapshot();
  task.config.operationBatch.managedSnapshot.schedules[0].requirementIndex = 1;
  const result = operationPersonnelScheduleGate(task);

  assert.equal(result.ok, false);
  assert.equal(result.code, "PERSONNEL_BATCH_SCHEDULE_CONFLICT");
});

test("returns normalized read-only schedules when batch is synchronized", () => {
  const result = operationPersonnelScheduleGate(taskWithAppliedSnapshot());

  assert.equal(result.ok, true);
  assert.deepEqual(result.schedules, [{
    requirementIndex: 0,
    name: "湖北邮政招聘考试",
    start: "2026-08-22T09:00:00",
    end: "2026-08-22T11:00:00",
  }]);
});
