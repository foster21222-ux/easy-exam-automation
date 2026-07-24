import assert from "node:assert/strict";
import test from "node:test";

import {
  createOperationBatchUpdateService,
} from "./operation_batch_update_service.mjs";
import { createOperationBatchCoordinator } from "./operation_batch_coordinator.mjs";
import {
  acquireOperationBatchCreation,
  releaseOperationBatchCreation,
} from "./operation_batch.mjs";

const actor = { email: "owner@example.com", role: "operator" };

function snapshot({
  batchName = "湖北邮政社招_2026年8月",
  name = "日程1",
  start = "2026-08-22T09:00:00",
  end = "2026-08-22T11:00:00",
} = {}) {
  return {
    batchName,
    examStartDate: start.slice(0, 10),
    examEndDate: end.slice(0, 10),
    schedules: [{ requirementIndex: 0, name, start, end }],
  };
}

function taskFrom({ desired = snapshot(), applied = snapshot(), taskId = "task-a" } = {}) {
  const operationBatch = {
    code: "EZT260003",
    status: "created_unpublished",
    ...(applied ? { managedSnapshot: structuredClone(applied), managedSnapshotVersion: 1 } : {}),
  };
  return {
    taskId,
    ownerEmail: actor.email,
    config: {
      operationBatchCode: "EZT260003",
      businessRequirement: { batch_name: desired.batchName },
      examRequirements: desired.schedules.map((schedule, index) => ({
        id: `requirement-${index + 1}`,
        version: 1,
        fields: {
          "考试名称": schedule.name,
          "考试日期时间": `${schedule.start.replace("T", " ").slice(0, 16)} - ${schedule.end.replace("T", " ").slice(0, 16)}`,
        },
      })),
      operationBatch,
    },
  };
}

function createHarness(options = {}) {
  const tasks = new Map(
    (options.tasks || [taskFrom(options)]).map((task) => [task.taskId, structuredClone(task)]),
  );
  const inspections = [...(options.inspections || [])];
  const jobs = [];
  const persisted = [];
  const updateInstructions = [];
  const profileInFlight = new Set();
  const taskInFlight = new Set();
  const coordinator = createOperationBatchCoordinator({
    acquireLock: acquireOperationBatchCreation,
    releaseLock: releaseOperationBatchCreation,
    profileInFlight,
    taskInFlight,
  });
  let nowValue = Date.parse("2026-08-01T00:00:00.000Z");
  const readTask = async (taskId) => {
    const task = tasks.get(taskId);
    return task ? structuredClone(task) : null;
  };
  const updateTaskConfig = async (taskId, patch) => {
    const current = tasks.get(taskId);
    if (!current) return null;
    const next = {
      ...current,
      config: { ...current.config, ...structuredClone(patch) },
    };
    tasks.set(taskId, next);
    persisted.push(structuredClone(next));
    return structuredClone(next);
  };
  const service = createOperationBatchUpdateService({
    readTask,
    updateTaskConfig,
    coordinator,
    runInspection: async (instruction) => {
      if (options.onInspect) await options.onInspect(instruction, tasks);
      const value = inspections.length ? inspections.shift() : options.inspected;
      if (value instanceof Error) throw value;
      return structuredClone(value || snapshot());
    },
    runUpdate: async (instruction) => {
      updateInstructions.push(structuredClone(instruction));
      if (options.runUpdate) return options.runUpdate(instruction);
      return {
        verified: true,
        snapshot: structuredClone(instruction.desiredSnapshot),
        checkpoints: ["exact_readback_verified"],
      };
    },
    now: () => nowValue,
    makeAttemptId: () => `attempt-${updateInstructions.length + jobs.length + 1}`,
    defer: (job) => jobs.push(job),
  });
  return {
    service,
    tasks,
    persisted,
    jobs,
    updateInstructions,
    profileInFlight,
    taskInFlight,
    setNow(value) {
      nowValue = typeof value === "number" ? value : Date.parse(value);
    },
    task(taskId = "task-a") {
      return tasks.get(taskId);
    },
    async runNext() {
      const job = jobs.shift();
      assert.ok(job, "expected one deferred update job");
      await job();
    },
  };
}

async function previewForChangedTask(options = {}) {
  const applied = snapshot();
  const desired = snapshot({ name: "日程1-更新" });
  const harness = createHarness({
    applied,
    desired,
    inspected: applied,
    ...options,
  });
  const preview = await harness.service.preview("task-a", actor);
  return { harness, preview, applied, desired };
}

test("preview blocks when the exact live snapshot differs from the applied snapshot", async () => {
  const applied = snapshot();
  const inspected = snapshot({ name: "人工修改的日程" });
  const harness = createHarness({
    applied,
    desired: snapshot({ name: "计划修改的日程" }),
    inspected,
  });

  await assert.rejects(
    harness.service.preview("task-a", actor),
    (error) => {
      assert.equal(error.code, "OPERATION_BATCH_UPDATE_CONFLICT");
      assert.equal(error.status, 409);
      assert.deepEqual(error.differingFields.map((item) => item.path), ["schedules[0].name"]);
      assert.equal(error.differingFields[0].expected, "日程1");
      assert.equal(error.differingFields[0].actual, "人工修改的日程");
      return true;
    },
  );
  assert.equal(harness.task().config.operationBatch.activeUpdatePreview, undefined);
});

test("a baseline-free preview binds the first live inspection without inventing an applied snapshot", async () => {
  const inspected = snapshot({ name: "运控现状" });
  const desired = snapshot({ name: "期望日程" });
  const harness = createHarness({ applied: null, desired, inspected });

  const preview = await harness.service.preview("task-a", actor);
  const stored = harness.task().config.operationBatch.activeUpdatePreview;

  assert.equal(preview.action, "update");
  assert.match(preview.previewToken, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(stored.token, undefined);
  assert.match(stored.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(stored.taskId, "task-a");
  assert.equal(typeof stored.taskVersion, "string");
  assert.match(stored.desiredFingerprint, /^[a-f0-9]{64}$/);
  assert.match(stored.inspectedCurrentFingerprint, /^[a-f0-9]{64}$/);
  assert.match(stored.actorFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(stored.inspectedCurrent, inspected);
  assert.deepEqual(stored.changes, preview.changes);
  assert.equal(harness.task().config.operationBatch.managedSnapshot, undefined);
});

test("a baseline-free preview rejects live schedules beyond the desired count without saving", async () => {
  const desired = snapshot({ name: "期望日程" });
  const inspected = {
    ...snapshot({ name: "现有日程1" }),
    examEndDate: "2026-08-23",
    schedules: [
      snapshot({ name: "现有日程1" }).schedules[0],
      {
        requirementIndex: 1,
        name: "现有日程2",
        start: "2026-08-23T09:00:00",
        end: "2026-08-23T11:00:00",
      },
    ],
  };
  const harness = createHarness({ applied: null, desired, inspected });

  await assert.rejects(
    harness.service.preview("task-a", actor),
    (error) => {
      assert.equal(error.code, "OPERATION_BATCH_UPDATE_CONFLICT");
      assert.equal(error.status, 409);
      assert.deepEqual(error.differingFields.map((item) => item.path), ["schedules.length"]);
      assert.equal(error.differingFields[0].expected, 1);
      assert.equal(error.differingFields[0].actual, 2);
      return true;
    },
  );
  assert.equal(harness.persisted.length, 0);
  assert.equal(harness.task().config.operationBatch.managedSnapshot, undefined);
  assert.equal(harness.task().config.operationBatch.activeUpdatePreview, undefined);
});

test("a baseline-free preview rejects non-contiguous live requirement indices without saving", async () => {
  const desired = snapshot({ name: "期望日程" });
  const inspected = snapshot({ name: "现有日程" });
  inspected.schedules[0].requirementIndex = 2;
  const harness = createHarness({ applied: null, desired, inspected });

  await assert.rejects(
    harness.service.preview("task-a", actor),
    (error) => {
      assert.equal(error.code, "OPERATION_BATCH_UPDATE_CONFLICT");
      assert.equal(error.status, 409);
      assert.deepEqual(
        error.differingFields.map((item) => item.path),
        ["schedules[0].requirementIndex"],
      );
      assert.equal(error.differingFields[0].expected, 0);
      assert.equal(error.differingFields[0].actual, 2);
      return true;
    },
  );
  assert.equal(harness.persisted.length, 0);
  assert.equal(harness.task().config.operationBatch.managedSnapshot, undefined);
  assert.equal(harness.task().config.operationBatch.activeUpdatePreview, undefined);
});

test("a baseline-free preview permits a token-bound append from fewer contiguous live rows", async () => {
  const first = snapshot({ name: "现有日程1" }).schedules[0];
  const second = {
    requirementIndex: 1,
    name: "期望日程2",
    start: "2026-08-23T09:00:00",
    end: "2026-08-23T11:00:00",
  };
  const desired = {
    ...snapshot({ name: first.name }),
    examEndDate: "2026-08-23",
    schedules: [first, second],
  };
  const inspected = snapshot({ name: first.name });
  const harness = createHarness({ applied: null, desired, inspected });

  const preview = await harness.service.preview("task-a", actor);

  assert.equal(preview.action, "update");
  assert.match(preview.previewToken, /^[A-Za-z0-9_-]{40,}$/);
  assert.deepEqual(preview.inspectedCurrent, inspected);
  assert.deepEqual(
    harness.task().config.operationBatch.activeUpdatePreview.inspectedCurrent,
    inspected,
  );
  assert.equal(harness.task().config.operationBatch.managedSnapshot, undefined);
});

test("a baseline-free no-difference preview persists the inspected baseline and performs no write", async () => {
  const current = snapshot();
  let updateCalls = 0;
  const harness = createHarness({
    applied: null,
    desired: current,
    inspected: current,
    runUpdate: async () => {
      updateCalls += 1;
      throw new Error("must not update");
    },
  });

  const preview = await harness.service.preview("task-a", actor);

  assert.equal(preview.action, "none");
  assert.deepEqual(preview.changes, []);
  assert.equal(preview.previewToken, undefined);
  assert.deepEqual(harness.task().config.operationBatch.managedSnapshot, current);
  assert.equal(harness.task().config.operationBatch.managedSnapshotVersion, 1);
  assert.equal(updateCalls, 0);
});

test("rejects a stale preview token after requirement change", async () => {
  const { harness, preview } = await previewForChangedTask();
  harness.task().config.examRequirements[0].fields["考试日期时间"] =
    "2026/09/02 10:00 - 2026/09/02 12:00";

  await assert.rejects(
    harness.service.start("task-a", { previewToken: preview.previewToken }, actor),
    (error) => error.code === "OPERATION_BATCH_PREVIEW_STALE" && /预览已过期/.test(error.message),
  );
  assert.equal(harness.jobs.length, 0);
});

test("rejects task-version and applied-fingerprint changes after preview", async () => {
  {
    const { harness, preview } = await previewForChangedTask();
    harness.task().config.examRequirements[0].version += 1;

    await assert.rejects(
      harness.service.start("task-a", { previewToken: preview.previewToken }, actor),
      (error) => error.code === "OPERATION_BATCH_PREVIEW_STALE",
    );
  }
  {
    const { harness, preview } = await previewForChangedTask();
    harness.task().config.operationBatch.managedSnapshot.schedules[0].name =
      "本地并发替换的已应用快照";

    await assert.rejects(
      harness.service.start("task-a", { previewToken: preview.previewToken }, actor),
      (error) => error.code === "OPERATION_BATCH_PREVIEW_STALE",
    );
  }
});

test("rejects unchanged desired state before starting an update", async () => {
  const { harness, preview, applied } = await previewForChangedTask();
  harness.task().config.examRequirements[0].fields["考试名称"] =
    applied.schedules[0].name;

  await assert.rejects(
    harness.service.start("task-a", { previewToken: preview.previewToken }, actor),
    (error) => error.code === "OPERATION_BATCH_CONTENT_UNCHANGED",
  );
  assert.equal(harness.jobs.length, 0);
});

test("preview tokens expire, bind the actor, supersede old tokens, and are one-time", async () => {
  const actorB = { email: "other@example.com", role: "admin" };
  {
    const { harness, preview } = await previewForChangedTask();
    await assert.rejects(
      harness.service.start("task-a", { previewToken: preview.previewToken }, actorB),
      (error) => error.code === "OPERATION_BATCH_PREVIEW_ACTOR_MISMATCH",
    );
    assert.equal(harness.jobs.length, 0);
  }
  {
    const { harness, preview } = await previewForChangedTask();
    harness.setNow("2026-08-01T00:10:00.001Z");
    await assert.rejects(
      harness.service.start("task-a", { previewToken: preview.previewToken }, actor),
      (error) => error.code === "OPERATION_BATCH_PREVIEW_STALE",
    );
  }
  {
    const applied = snapshot();
    const desired = snapshot({ name: "日程1-更新" });
    const harness = createHarness({
      applied,
      desired,
      inspections: [applied, applied],
    });
    const oldPreview = await harness.service.preview("task-a", actor);
    const currentPreview = await harness.service.preview("task-a", actor);
    assert.notEqual(oldPreview.previewToken, currentPreview.previewToken);
    await assert.rejects(
      harness.service.start("task-a", { previewToken: oldPreview.previewToken }, actor),
      (error) => error.code === "OPERATION_BATCH_PREVIEW_STALE",
    );
    await harness.service.start(
      "task-a",
      { previewToken: currentPreview.previewToken },
      actor,
    );
    await harness.runNext();
    await assert.rejects(
      harness.service.start(
        "task-a",
        { previewToken: currentPreview.previewToken },
        actor,
      ),
      (error) => error.code === "OPERATION_BATCH_PREVIEW_STALE",
    );
  }
});

test("a preview token cannot be used for another task", async () => {
  const applied = snapshot();
  const tasks = [
    taskFrom({ taskId: "task-a", applied, desired: snapshot({ name: "A-更新" }) }),
    taskFrom({ taskId: "task-b", applied, desired: snapshot({ name: "B-更新" }) }),
  ];
  const harness = createHarness({ tasks, inspections: [applied] });
  const preview = await harness.service.preview("task-a", actor);

  await assert.rejects(
    harness.service.start("task-b", { previewToken: preview.previewToken }, actor),
    (error) => error.code === "OPERATION_BATCH_PREVIEW_STALE",
  );
});

test("an applied no-difference preview returns and persists success", async () => {
  const current = snapshot();
  const harness = createHarness({ applied: current, desired: current, inspected: current });
  harness.task().config.operationBatch.status = "update_available";

  const preview = await harness.service.preview("task-a", actor);

  assert.equal(preview.action, "none");
  assert.equal(harness.task().config.operationBatch.status, "success");
  assert.equal(harness.task().config.operationBatch.activeUpdatePreview, null);
});

test("preview rejects a desired schedule count decrease before issuing a token", async () => {
  const applied = {
    batchName: "湖北邮政社招_2026年8月",
    examStartDate: "2026-08-22",
    examEndDate: "2026-08-23",
    schedules: [
      snapshot().schedules[0],
      {
        requirementIndex: 1,
        name: "日程2",
        start: "2026-08-23T09:00:00",
        end: "2026-08-23T11:00:00",
      },
    ],
  };
  const harness = createHarness({ applied, desired: snapshot(), inspected: applied });

  await assert.rejects(
    harness.service.preview("task-a", actor),
    (error) => error.code === "OPERATION_BATCH_UPDATE_CONFLICT",
  );
  assert.equal(harness.task().config.operationBatch.activeUpdatePreview, undefined);
});

test("start persists the exact attempt lifecycle and uses only server-generated changes", async () => {
  const { harness, preview, applied, desired } = await previewForChangedTask();

  const started = await harness.service.start("task-a", {
    previewToken: preview.previewToken,
    changes: [{ path: "batchName", before: "伪造", after: "恶意覆盖" }],
  }, actor);
  let attempt = (await harness.service.attempt("task-a", started.attemptId, actor)).attempt;
  assert.deepEqual(attempt, {
    attemptId: started.attemptId,
    status: "pending",
    checkpoint: "queued",
    desiredSnapshot: desired,
    inspectedBefore: applied,
    inspectedAfter: null,
    changes: preview.changes,
    actor,
    createdAt: "2026-08-01T00:00:00.000Z",
    completedAt: null,
    error: null,
  });

  await harness.runNext();

  attempt = (await harness.service.attempt("task-a", started.attemptId, actor)).attempt;
  assert.equal(attempt.status, "succeeded");
  assert.equal(attempt.checkpoint, "completed");
  assert.deepEqual(attempt.inspectedAfter, desired);
  assert.equal(attempt.completedAt, "2026-08-01T00:00:00.000Z");
  assert.equal(attempt.error, null);
  assert.deepEqual(harness.task().config.operationBatch.managedSnapshot, desired);
  assert.deepEqual(harness.updateInstructions[0].changes, preview.changes);
  assert.deepEqual(harness.updateInstructions[0].batch.expectedAppliedSnapshot, applied);
  assert.deepEqual(
    harness.persisted
      .map((task) => task.config.operationBatch.updateAttempts?.at(-1)?.checkpoint)
      .filter(Boolean),
    ["queued", "applying", "completed"],
  );
});

test("an uncertain update reconciles to success when readback equals desired", async () => {
  const desired = snapshot({ name: "日程1-更新" });
  const { harness, preview } = await previewForChangedTask({
    inspections: [snapshot(), desired],
    runUpdate: async () => {
      throw Object.assign(new Error("保存响应中断"), { code: "NETWORK_INTERRUPTED" });
    },
  });
  const started = await harness.service.start("task-a", { previewToken: preview.previewToken }, actor);

  await harness.runNext();

  const { attempt } = await harness.service.attempt("task-a", started.attemptId, actor);
  assert.equal(attempt.status, "succeeded");
  assert.equal(attempt.checkpoint, "completed");
  assert.deepEqual(attempt.inspectedAfter, desired);
  assert.deepEqual(harness.task().config.operationBatch.managedSnapshot, desired);
});

test("readback equal to the applied snapshot records a safe retry without fabricating success", async () => {
  const applied = snapshot();
  const { harness, preview } = await previewForChangedTask({
    inspections: [applied, applied],
    runUpdate: async () => {
      throw new Error("保存失败");
    },
  });
  const started = await harness.service.start("task-a", { previewToken: preview.previewToken }, actor);

  await harness.runNext();

  const { attempt } = await harness.service.attempt("task-a", started.attemptId, actor);
  assert.equal(attempt.status, "failed");
  assert.equal(attempt.checkpoint, "safe_retry");
  assert.equal(attempt.error.code, "OPERATION_BATCH_SAFE_RETRY");
  assert.deepEqual(attempt.inspectedAfter, applied);
  assert.deepEqual(harness.task().config.operationBatch.managedSnapshot, applied);
  assert.notEqual(harness.task().config.operationBatch.status, "success");
});

test("partial readback becomes a manual conflict with differing inspected fields", async () => {
  const partial = snapshot({ name: "部分修改" });
  const { harness, preview } = await previewForChangedTask({
    inspections: [snapshot(), partial],
    runUpdate: async () => {
      throw new Error("保存结果未知");
    },
  });
  const started = await harness.service.start("task-a", { previewToken: preview.previewToken }, actor);

  await harness.runNext();

  const { attempt } = await harness.service.attempt("task-a", started.attemptId, actor);
  assert.equal(attempt.status, "conflict");
  assert.equal(attempt.checkpoint, "manual_review");
  assert.equal(attempt.error.code, "OPERATION_BATCH_UPDATE_CONFLICT");
  assert.deepEqual(attempt.error.differingFields.map((item) => item.path), ["schedules[0].name"]);
  assert.deepEqual(attempt.inspectedAfter, partial);
  assert.deepEqual(harness.task().config.operationBatch.managedSnapshot, snapshot());
});

test("a concurrent project change during inspection rejects the preview", async () => {
  const applied = snapshot();
  const harness = createHarness({
    applied,
    desired: snapshot({ name: "期望日程" }),
    inspected: applied,
    onInspect: async (_instruction, tasks) => {
      tasks.get("task-a").config.examRequirements[0].fields["考试名称"] = "并发新期望";
    },
  });

  await assert.rejects(
    harness.service.preview("task-a", actor),
    (error) => error.code === "OPERATION_BATCH_PREVIEW_STALE",
  );
  assert.equal(harness.task().config.operationBatch.activeUpdatePreview, undefined);
});

test("queued updates hold the shared automation lock and the per-project lock", async () => {
  const applied = snapshot();
  const tasks = [
    taskFrom({ taskId: "task-a", applied, desired: snapshot({ name: "A-更新" }) }),
    taskFrom({ taskId: "task-b", applied, desired: snapshot({ name: "B-更新" }) }),
  ];
  const harness = createHarness({
    tasks,
    inspections: [applied, applied, applied],
  });
  const preview = await harness.service.preview("task-a", actor);
  await harness.service.start("task-a", { previewToken: preview.previewToken }, actor);

  assert.equal(harness.profileInFlight.has("persistent-profile"), true);
  assert.equal(harness.taskInFlight.has("task-a"), true);
  await assert.rejects(
    harness.service.preview("task-a", actor),
    (error) => error.status === 409,
  );
  await assert.rejects(
    harness.service.preview("task-b", actor),
    (error) => error.status === 409,
  );

  await harness.runNext();

  assert.equal(harness.profileInFlight.size, 0);
  assert.equal(harness.taskInFlight.size, 0);
  const taskBPreview = await harness.service.preview("task-b", actor);
  assert.equal(taskBPreview.action, "update");
});
