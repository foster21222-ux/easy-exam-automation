import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pythonBin = process.env.CODEX_PYTHON || "python3";
const taskStateScript = path.join(rootDir, "server", "task_state_db.py");

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

function task({
  desired = snapshot("日程1-更新"),
  applied = snapshot(),
  status = "created_unpublished",
  incompleteSchedule = false,
} = {}) {
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
          "考试日期时间": incompleteSchedule
            ? ""
            : "2026/08/22 09:00 - 2026/08/22 11:00",
        },
      }],
      operationBatch: {
        code: "EZT260003",
        status,
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
    statusPollIntervalSeconds: 2,
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

async function reserveLoopbackPort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      server.close((error) => {
        if (error) return reject(error);
        if (!address || typeof address === "string") {
          return reject(new Error("loopback port was not assigned"));
        }
        return resolve(address.port);
      });
    });
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 1000)),
  ]);
  if (stopped || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  await exited;
}

async function startServer(runtimeDir, env = {}) {
  const port = await reserveLoopbackPort();
  const child = spawn(process.execPath, [path.join(rootDir, "server", "easy_exam_server.mjs")], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      EASY_EXAM_RUNTIME_DIR: runtimeDir,
      REQUIREMENT_DB_PATH: path.join(runtimeDir, "requirement_requests.sqlite3"),
      PAPER_BIND_SCHEDULER_DISABLED: "1",
      OPERATION_CONSOLE_AUTOMATION_ENABLED: "0",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  try {
    await new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        clearTimeout(timer);
        child.stdout.off("data", onOutput);
        child.off("error", onError);
        child.off("exit", onExit);
        callback(value);
      };
      const timer = setTimeout(
        () => finish(reject, new Error("server startup timed out")),
        10000,
      );
      const onOutput = (chunk) => {
        if (String(chunk).includes("Easy Exam server running")) finish(resolve);
      };
      const onError = (error) => finish(reject, error);
      const onExit = (code) => finish(
        reject,
        new Error(`server exited early: ${code}: ${stderr}`),
      );
      child.stdout.on("data", onOutput);
      child.once("error", onError);
      child.once("exit", onExit);
    });
  } catch (error) {
    await stopServer(child);
    throw error;
  }
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => stopServer(child),
  };
}

test("update-state returns desired, applied, page state, and fresh task workflow", async () => {
  await withRuntime({}, async ({ api }) => {
    const response = await api.state("task-a", actor);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.state.status, "update_available");
    assert.equal(response.body.pageStatus, "update_available");
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

test("update-state does not let persisted success hide a fresh managed update", async () => {
  await withRuntime({ status: "success" }, async ({ api }) => {
    const response = await api.state("task-a", actor);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.state.status, "update_available");
    assert.equal(response.body.pageStatus, "update_available");
  });
});

test("update-state does not let persisted success hide fresh missing schedules", async () => {
  await withRuntime({
    status: "success",
    incompleteSchedule: true,
  }, async ({ api }) => {
    const response = await api.state("task-a", actor);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.state.status, "waiting_schedule");
    assert.equal(response.body.pageStatus, "waiting_schedule");
    assert.deepEqual(response.body.missing, [{
      requirementIndex: 0,
      fields: ["考试日期时间"],
    }]);
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
    assert.equal(update.body.workflow.batchStatus, "updating");

    const pending = await api.attempt("task-a", "attempt-a", actor);
    assert.equal(pending.statusCode, 200);
    assert.equal(pending.body.status, "pending");
    assert.equal(pending.body.checkpoint, "queued");
    assert.equal(pending.body.completed, false);
    assert.equal(pending.body.remainingSeconds, 2);
    assert.equal(pending.body.countdownKind, "next_status_poll");
    assert.equal(pending.body.error, null);
    assert.equal(pending.body.finalReadback, null);
    assert.equal(pending.body.task.config.operationBatch.status, "updating");
    assert.equal(pending.body.workflow.batchStatus, "updating");

    await runNext();

    const terminal = await api.attempt("task-a", "attempt-a", actor);
    assert.equal(terminal.statusCode, 200);
    assert.equal(terminal.body.status, "succeeded");
    assert.equal(terminal.body.checkpoint, "completed");
    assert.equal(terminal.body.completed, true);
    assert.equal(terminal.body.remainingSeconds, 0);
    assert.equal(terminal.body.countdownKind, "next_status_poll");
    assert.deepEqual(terminal.body.finalReadback, snapshot("日程1-更新"));
    assert.equal(terminal.body.task.config.operationBatch.status, "success");
    assert.equal(terminal.body.workflow.batchStatus, "success");
    assert.equal(terminal.body.workflow.managedSnapshotVersion, 2);
  });
});

test("safe-retry attempt reads return matching failed task and workflow states", async () => {
  await withRuntime({
    inspections: [snapshot(), snapshot()],
    runUpdate: async () => {
      throw new Error("保存失败");
    },
  }, async ({ api, runNext }) => {
    const preview = await api.preview("task-a", actor);
    const update = await api.start(
      "task-a",
      { previewToken: preview.body.previewToken },
      actor,
    );
    await runNext();

    const terminal = await api.attempt("task-a", update.body.attemptId, actor);

    assert.equal(terminal.statusCode, 200);
    assert.equal(terminal.body.status, "failed");
    assert.equal(terminal.body.checkpoint, "safe_retry");
    assert.equal(terminal.body.completed, true);
    assert.equal(terminal.body.remainingSeconds, 0);
    assert.equal(terminal.body.task.config.operationBatch.status, "update_failed");
    assert.equal(terminal.body.workflow.batchStatus, "update_failed");
  });
});

test("manual-conflict attempt reads return matching conflict task and workflow states", async () => {
  await withRuntime({
    inspections: [snapshot(), snapshot("部分修改")],
    runUpdate: async () => {
      throw new Error("保存结果未知");
    },
  }, async ({ api, runNext }) => {
    const preview = await api.preview("task-a", actor);
    const update = await api.start(
      "task-a",
      { previewToken: preview.body.previewToken },
      actor,
    );
    await runNext();

    const terminal = await api.attempt("task-a", update.body.attemptId, actor);

    assert.equal(terminal.statusCode, 200);
    assert.equal(terminal.body.status, "conflict");
    assert.equal(terminal.body.checkpoint, "manual_review");
    assert.equal(terminal.body.completed, true);
    assert.equal(terminal.body.remainingSeconds, 0);
    assert.equal(terminal.body.task.config.operationBatch.status, "update_conflict");
    assert.equal(terminal.body.workflow.batchStatus, "update_conflict");
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

test("auth-enabled update routes never leak a cross-owner task through error context", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "easy-exam-batch-update-auth-"));
  const hiddenTask = task();
  hiddenTask.ownerEmail = "owner@example.com";
  execFileSync(
    pythonBin,
    [taskStateScript, path.join(runtimeDir, "task_state.sqlite3"), "create"],
    { input: JSON.stringify(hiddenTask) },
  );
  writeFileSync(path.join(runtimeDir, "auth_sessions.json"), JSON.stringify([{
    token: "other-session",
    user: { email: "other@example.com", role: "user" },
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  }]));
  const runtime = await startServer(runtimeDir, {
    APP_LOGIN_EMAIL: "admin@example.com",
    APP_LOGIN_PASSWORD: "password",
  });
  try {
    const routes = [
      { method: "GET", path: "update-state" },
      { method: "POST", path: "update-preview" },
      { method: "POST", path: "update", body: { previewToken: "hidden" } },
      { method: "GET", path: "update-attempts/hidden-attempt" },
    ];
    for (const route of routes) {
      const response = await fetch(
        `${runtime.baseUrl}/api/tasks/task-a/operation-batch/${route.path}`,
        {
          method: route.method,
          headers: {
            Cookie: "easy_exam_session=other-session",
            "Content-Type": "application/json",
          },
          ...(route.method === "POST"
            ? { body: JSON.stringify(route.body || {}) }
            : {}),
        },
      );
      const body = await response.json();
      assert.equal(response.status, 404, `${route.method} ${route.path}`);
      assert.equal(body.errorCode, "OPERATION_BATCH_UPDATE_NOT_FOUND");
      assert.equal(Object.hasOwn(body, "task"), false);
      assert.equal(Object.hasOwn(body, "workflow"), false);
      assert.equal(JSON.stringify(body).includes("owner@example.com"), false);
      assert.equal(JSON.stringify(body).includes('"config"'), false);
    }
  } finally {
    await runtime.close();
    await rm(runtimeDir, { recursive: true, force: true });
  }
});
