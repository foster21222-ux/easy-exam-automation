import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createOperationBatchUpdateApi,
  createOperationBatchUpdateService,
} from "./operation_batch_update_service.mjs";
import { createOperationBatchCoordinator } from "./operation_batch_coordinator.mjs";
import {
  acquireOperationBatchCreation,
  releaseOperationBatchCreation,
} from "./operation_batch.mjs";

const actor = { email: "owner@example.com", role: "operator" };

function snapshot(name = "日程1") {
  return {
    batchName: "湖北邮政社招_2026年8月",
    examStartDate: "2026-08-22",
    examEndDate: "2026-08-22",
    schedules: [{
      requirementIndex: 0,
      name,
      start: "2026-08-22T09:00:00",
      end: "2026-08-22T11:00:00",
    }],
  };
}

function task({ desired = snapshot("日程1-更新"), applied = snapshot() } = {}) {
  return {
    taskId: "task-a",
    ownerEmail: actor.email,
    config: {
      operationBatchCode: "EZT260003",
      businessRequirement: { batch_name: desired.batchName },
      examRequirements: [{
        id: "requirement-1",
        version: 1,
        fields: {
          "考试名称": desired.schedules[0].name,
          "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00",
        },
      }],
      operationBatch: {
        code: "EZT260003",
        status: "created_unpublished",
        managedSnapshot: structuredClone(applied),
        managedSnapshotVersion: 1,
      },
    },
  };
}

async function withRuntime(options, run) {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "easy-exam-batch-update-routes-"));
  const statePath = path.join(runtimeDir, "task.json");
  const jobs = [];
  const inspections = [...(options.inspections || [snapshot()])];
  await writeFile(statePath, `${JSON.stringify(task(options), null, 2)}\n`, "utf8");
  const readTask = async (taskId) => {
    const current = JSON.parse(await readFile(statePath, "utf8"));
    return current.taskId === taskId ? current : null;
  };
  const updateTaskConfig = async (taskId, patch) => {
    const current = await readTask(taskId);
    if (!current) return null;
    const next = { ...current, config: { ...current.config, ...structuredClone(patch) } };
    await writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  };
  const coordinator = createOperationBatchCoordinator({
    acquireLock: acquireOperationBatchCreation,
    releaseLock: releaseOperationBatchCreation,
    profileInFlight: new Set(),
    taskInFlight: new Set(),
  });
  const service = createOperationBatchUpdateService({
    readTask,
    updateTaskConfig,
    coordinator,
    runInspection: options.runInspection
      || (async () => structuredClone(inspections.shift() || snapshot())),
    runUpdate: options.runUpdate || (async (instruction) => ({
      verified: true,
      snapshot: structuredClone(instruction.desiredSnapshot),
      checkpoints: ["exact_readback_verified"],
    })),
    now: () => Date.parse("2026-08-01T00:00:00.000Z"),
    makeAttemptId: () => "attempt-a",
    defer: (job) => jobs.push(job),
    assertAutomationEnabled: options.assertAutomationEnabled,
  });
  const api = createOperationBatchUpdateApi({
    service,
    readTask,
    workflowForTask: (current) => ({
      taskId: current.taskId,
      batchStatus: current.config.operationBatch.status,
      managedSnapshotVersion: current.config.operationBatch.managedSnapshotVersion || 0,
    }),
  });
  try {
    return await run({
      api,
      readTask,
      async runNext() {
        const job = jobs.shift();
        assert.ok(job);
        await job();
      },
    });
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
}

test("update-state returns desired, applied, page state, and fresh task workflow", async () => {
  await withRuntime({}, async ({ api }) => {
    const response = await api.state("task-a", actor);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.state.status, "update_available");
    assert.deepEqual(response.body.desiredSnapshot, snapshot("日程1-更新"));
    assert.deepEqual(response.body.appliedSnapshot, snapshot());
    assert.equal(response.body.task.taskId, "task-a");
    assert.deepEqual(response.body.workflow, {
      taskId: "task-a",
      batchStatus: "created_unpublished",
      managedSnapshotVersion: 1,
    });
  });
});

test("preview conflict is HTTP 409 with stable code, fresh task, workflow, and differing fields", async () => {
  await withRuntime({
    inspections: [snapshot("人工修改")],
  }, async ({ api }) => {
    const response = await api.preview("task-a", actor);

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.errorCode, "OPERATION_BATCH_UPDATE_CONFLICT");
    assert.equal(response.body.task.taskId, "task-a");
    assert.equal(response.body.workflow.batchStatus, "created_unpublished");
    assert.deepEqual(response.body.differingFields, [{
      path: "schedules[0].name",
      expected: "日程1",
      actual: "人工修改",
      requirementIndex: 0,
    }]);
  });
});

test("update returns 202 and terminal attempt reads return fresh success evidence", async () => {
  await withRuntime({
    inspections: [snapshot()],
  }, async ({ api, runNext }) => {
    const preview = await api.preview("task-a", actor);
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.body.task.config.operationBatch.status, "update_available");
    assert.equal(preview.body.workflow.batchStatus, "update_available");

    const update = await api.start("task-a", {
      previewToken: preview.body.previewToken,
      changes: [{ path: "batchName", after: "不可信客户端差异" }],
    }, actor);
    assert.equal(update.statusCode, 202);
    assert.equal(update.body.attemptId, "attempt-a");
    assert.equal(update.body.task.config.operationBatch.status, "updating");

    const pending = await api.attempt("task-a", "attempt-a", actor);
    assert.equal(pending.statusCode, 200);
    assert.equal(pending.body.status, "pending");
    assert.equal(pending.body.checkpoint, "queued");
    assert.equal(pending.body.completed, false);
    assert.equal(pending.body.remainingSeconds, 0);
    assert.equal(pending.body.error, null);
    assert.equal(pending.body.finalReadback, null);

    await runNext();

    const terminal = await api.attempt("task-a", "attempt-a", actor);
    assert.equal(terminal.statusCode, 200);
    assert.equal(terminal.body.status, "succeeded");
    assert.equal(terminal.body.checkpoint, "completed");
    assert.equal(terminal.body.completed, true);
    assert.deepEqual(terminal.body.finalReadback, snapshot("日程1-更新"));
    assert.equal(terminal.body.task.config.operationBatch.status, "success");
    assert.equal(terminal.body.workflow.batchStatus, "success");
    assert.equal(terminal.body.workflow.managedSnapshotVersion, 2);
  });
});

test("stale update responses include fresh task and workflow", async () => {
  await withRuntime({}, async ({ api }) => {
    const response = await api.start("task-a", { previewToken: "old-token" }, actor);

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.errorCode, "OPERATION_BATCH_PREVIEW_STALE");
    assert.equal(response.body.task.taskId, "task-a");
    assert.equal(response.body.workflow.managedSnapshotVersion, 1);
    assert.deepEqual(response.body.differingFields, []);
  });
});

test("automation-disabled preview fails before inspection and still returns fresh context", async () => {
  let inspectionCalls = 0;
  await withRuntime({
    assertAutomationEnabled() {
      throw Object.assign(new Error("运营控制台浏览器自动化未启用"), {
        status: 409,
        code: "OPERATION_BATCH_AUTOMATION_DISABLED",
      });
    },
    runInspection: async () => {
      inspectionCalls += 1;
      return snapshot();
    },
  }, async ({ api }) => {
    const response = await api.preview("task-a", actor);

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.errorCode, "OPERATION_BATCH_AUTOMATION_DISABLED");
    assert.equal(response.body.task.taskId, "task-a");
    assert.equal(response.body.workflow.managedSnapshotVersion, 1);
    assert.equal(inspectionCalls, 0);
  });
});
