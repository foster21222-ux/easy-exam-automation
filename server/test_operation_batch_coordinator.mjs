import assert from "node:assert/strict";
import test from "node:test";

import {
  createOperationBatchCoordinator,
  readFreshOperationBatchTask,
  withFreshOperationBatchTask,
} from "./operation_batch_coordinator.mjs";
import {
  acquireOperationBatchCreation,
  releaseOperationBatchCreation,
  resolveOperationBatchResultWrite,
} from "./operation_batch.mjs";

function coordinator(events = []) {
  const profileInFlight = new Set();
  const taskInFlight = new Set();
  const acquireLock = (inFlight, key) => {
    events.push(`acquire:${key}`);
    acquireOperationBatchCreation(inFlight, key);
  };
  const releaseLock = (inFlight, key) => {
    events.push(`release:${key}`);
    releaseOperationBatchCreation(inFlight, key);
  };
  return {
    profileInFlight,
    taskInFlight,
    value: createOperationBatchCoordinator({
      acquireLock,
      releaseLock,
      profileInFlight,
      taskInFlight,
      profileKey: "persistent-profile",
    }),
  };
}

test("automation locks profile then task and releases task then profile", () => {
  const events = [];
  const { value } = coordinator(events);
  const release = value.acquireAutomation("task-a");

  assert.deepEqual(events, ["acquire:persistent-profile", "acquire:task-a"]);
  release();
  assert.deepEqual(events, [
    "acquire:persistent-profile",
    "acquire:task-a",
    "release:task-a",
    "release:persistent-profile",
  ]);
});

test("task lock failure immediately releases the profile lock", () => {
  const events = [];
  const { profileInFlight, taskInFlight, value } = coordinator(events);
  taskInFlight.add("task-a");

  assert.throws(() => value.acquireAutomation("task-a"), /正在创建/);
  assert.equal(profileInFlight.size, 0);
  assert.deepEqual(events, [
    "acquire:persistent-profile",
    "acquire:task-a",
    "release:persistent-profile",
  ]);
});

test("deferred create and reconcile runners block same-task manual recording and deletion", async () => {
  for (const operation of ["create", "reconcile"]) {
    const { profileInFlight, taskInFlight, value } = coordinator();
    const started = Promise.withResolvers();
    const finish = Promise.withResolvers();
    const automation = withFreshOperationBatchTask({
      acquire: () => value.acquireAutomation("task-a"),
      readTask: async () => ({ taskId: "task-a", config: {} }),
      run: async (task) => {
        started.resolve(task);
        await finish.promise;
        return operation;
      },
    });
    await started.promise;

    assert.throws(() => value.acquireTask("task-a"), /正在创建/, `${operation}: manual recording`);
    assert.throws(() => value.acquireTask("task-a"), /正在创建/, `${operation}: task deletion`);
    const releaseTaskB = value.acquireTask("task-b");
    releaseTaskB();
    assert.equal(profileInFlight.has("persistent-profile"), true);
    assert.equal(taskInFlight.has("task-a"), true);

    finish.resolve();
    assert.equal(await automation, operation);
    assert.equal(profileInFlight.size, 0);
    assert.equal(taskInFlight.size, 0);
  }
});

test("missing fresh task releases locks without calling the external operation", async () => {
  const { profileInFlight, taskInFlight, value } = coordinator();
  let runCalls = 0;
  const result = await withFreshOperationBatchTask({
    acquire: () => value.acquireAutomation("task-a"),
    readTask: async () => null,
    onMissing: async () => "not-found",
    run: async () => {
      runCalls += 1;
      return "created";
    },
  });

  assert.equal(result, "not-found");
  assert.equal(runCalls, 0);
  assert.equal(profileInFlight.size, 0);
  assert.equal(taskInFlight.size, 0);
});

test("lock conflict reads preserve a fresh deletion and only fall back on read failure", async () => {
  const staleTask = { taskId: "task-a", config: { operationBatchCode: "OLD260001" } };

  assert.equal(await readFreshOperationBatchTask(async () => null, staleTask), null);
  assert.strictEqual(
    await readFreshOperationBatchTask(async () => { throw new Error("read failed"); }, staleTask),
    staleTask,
  );
});

test("fresh same-code and different-code results never write over the stored task", async () => {
  const { value } = coordinator();
  const storedTask = {
    taskId: "task-a",
    config: {
      operationBatchCode: "EZT260003",
      operationBatch: {
        code: "EZT260003",
        events: [{ type: "operation_batch_recorded", code: "EZT260003" }],
      },
    },
  };
  let writes = 0;
  const persist = (operationBatchCode) => withFreshOperationBatchTask({
    acquire: () => value.acquireTask("task-a"),
    readTask: async () => structuredClone(storedTask),
    run: async (freshTask) => {
      const resolution = resolveOperationBatchResultWrite(freshTask, { operationBatchCode });
      if (resolution.status === "apply") writes += 1;
      return resolution;
    },
  });

  assert.equal((await persist("EZT260003")).status, "idempotent");
  assert.equal((await persist("QTT260007")).status, "conflict");
  assert.equal(writes, 0);
  assert.equal(storedTask.config.operationBatchCode, "EZT260003");
  assert.equal(storedTask.config.operationBatch.events.length, 1);
});
