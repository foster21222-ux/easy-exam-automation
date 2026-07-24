import assert from "node:assert/strict";
import test from "node:test";

import { runOperationBatchCreationFlow } from "./operation_batch_creation_flow.mjs";

const completeTask = {
  taskId: "task-a",
  config: { businessRequirement: { batch_name: "湖北邮政社招_2026年8月" } },
};

const completeDesired = {
  complete: true,
  missing: [],
  snapshot: {
    batchName: "湖北邮政社招_2026年8月",
    examStartDate: "2026-08-22",
    examEndDate: "2026-08-22",
    schedules: [{
      requirementIndex: 0,
      name: "日程1",
      start: "2026-08-22T09:00:00",
      end: "2026-08-22T11:00:00",
    }],
  },
};

test("persists created batch code before schedule initialization fails", async () => {
  const calls = [];
  const failureTask = {
    config: {
      operationBatchCode: "EZT260003",
      operationBatch: { code: "EZT260003", status: "update_failed" },
    },
  };
  await assert.rejects(runOperationBatchCreationFlow({
    taskId: "task-a",
    task: completeTask,
    desired: completeDesired,
    createBatch: async () => ({
      operationBatchCode: "EZT260003",
      detailUrl: "/batch/1",
    }),
    persistBatch: async (result) => {
      calls.push(["persistBatch", result.operationBatchCode]);
      return { task: { config: { operationBatchCode: result.operationBatchCode } } };
    },
    initializeSchedules: async () => {
      calls.push(["initialize"]);
      throw new Error("日程保存后回读不一致");
    },
    persistManaged: async () => { calls.push(["persistManaged"]); },
    persistFailure: async (error) => {
      calls.push(["persistFailure", error.message]);
      return { task: failureTask };
    },
  }), (error) => {
    assert.match(error.message, /日程保存后回读不一致/);
    assert.equal(error.operationBatchCode, "EZT260003");
    assert.equal(error.operationBatchStatus, "update_failed");
    assert.strictEqual(error.task, failureTask);
    return true;
  });
  assert.deepEqual(calls, [
    ["persistBatch", "EZT260003"],
    ["initialize"],
    ["persistFailure", "日程保存后回读不一致"],
  ]);
});

test("creates no schedules when any requirement is incomplete", async () => {
  const calls = [];
  let creationDesired;
  const result = await runOperationBatchCreationFlow({
    taskId: "task-incomplete",
    task: {
      taskId: "task-incomplete",
      config: { businessRequirement: { batch_name: "湖北邮政社招_2026年8月" } },
    },
    desired: {
      complete: false,
      missing: [{ requirementIndex: 1, fields: ["考试日期时间"] }],
      snapshot: {
        batchName: "湖北邮政社招_2026年8月",
        examStartDate: "",
        examEndDate: "",
        schedules: [],
      },
    },
    createBatch: async ({ desired }) => {
      creationDesired = desired;
      return { operationBatchCode: "EZT260003", detailUrl: "/batch/1" };
    },
    persistBatch: async () => {
      calls.push("persistBatch");
      return { task: { config: { operationBatchCode: "EZT260003" } } };
    },
    initializeSchedules: async () => { calls.push("initialize"); },
    persistManaged: async () => { calls.push("persistManaged"); },
    persistFailure: async () => { calls.push("persistFailure"); },
  });
  assert.deepEqual(calls, ["persistBatch"]);
  assert.deepEqual(creationDesired.snapshot.schedules, []);
  assert.equal(result.status, "waiting_schedule");
  assert.equal(result.operationBatchCode, "EZT260003");
});

test("persists only the verified schedule initialization readback", async () => {
  const calls = [];
  const verified = {
    verified: true,
    snapshot: structuredClone(completeDesired.snapshot),
    detailUrl: "/batch/1",
    checkpoints: ["exact_readback_verified"],
  };
  const managedTask = {
    config: {
      operationBatchCode: "EZT260003",
      operationBatch: {
        code: "EZT260003",
        status: "created_unpublished",
        managedSnapshot: verified.snapshot,
      },
    },
  };
  const result = await runOperationBatchCreationFlow({
    taskId: "task-a",
    task: completeTask,
    desired: completeDesired,
    createBatch: async () => ({
      operationBatchCode: "EZT260003",
      detailUrl: "/batch/1",
    }),
    persistBatch: async () => {
      calls.push("persistBatch");
      return { task: { config: { operationBatchCode: "EZT260003" } } };
    },
    initializeSchedules: async (instruction) => {
      calls.push("initialize");
      assert.deepEqual(instruction, {
        batch: { code: "EZT260003" },
        desiredSnapshot: completeDesired.snapshot,
      });
      return verified;
    },
    persistManaged: async (resultToPersist) => {
      calls.push("persistManaged");
      assert.strictEqual(resultToPersist, verified);
      return { task: managedTask };
    },
    persistFailure: async () => { calls.push("persistFailure"); },
  });

  assert.deepEqual(calls, ["persistBatch", "initialize", "persistManaged"]);
  assert.deepEqual(result, {
    status: "success",
    operationBatchCode: "EZT260003",
    task: managedTask,
    managedResult: verified,
  });
});

test("rejects an unverified initialization result and retains the persisted code", async () => {
  const calls = [];
  await assert.rejects(runOperationBatchCreationFlow({
    taskId: "task-a",
    task: completeTask,
    desired: completeDesired,
    createBatch: async () => ({ operationBatchCode: "EZT260003" }),
    persistBatch: async () => {
      calls.push("persistBatch");
      return { task: { config: { operationBatchCode: "EZT260003" } } };
    },
    initializeSchedules: async () => {
      calls.push("initialize");
      return { verified: false, snapshot: completeDesired.snapshot };
    },
    persistManaged: async () => { calls.push("persistManaged"); },
    persistFailure: async () => {
      calls.push("persistFailure");
      return {
        task: {
          config: {
            operationBatchCode: "EZT260003",
            operationBatch: { code: "EZT260003", status: "update_failed" },
          },
        },
      };
    },
  }), (error) => {
    assert.equal(error.operationBatchCode, "EZT260003");
    assert.equal(error.operationBatchStatus, "update_failed");
    return true;
  });
  assert.deepEqual(calls, ["persistBatch", "initialize", "persistFailure"]);
});

test("does not persist or initialize an invalid create result", async () => {
  const calls = [];
  await assert.rejects(runOperationBatchCreationFlow({
    taskId: "task-a",
    task: completeTask,
    desired: completeDesired,
    createBatch: async () => ({ operationBatchCode: "invalid" }),
    persistBatch: async () => { calls.push("persistBatch"); },
    initializeSchedules: async () => { calls.push("initialize"); },
    persistManaged: async () => { calls.push("persistManaged"); },
    persistFailure: async () => { calls.push("persistFailure"); },
  }), /运营批次代码格式不合法/);
  assert.deepEqual(calls, []);
});
