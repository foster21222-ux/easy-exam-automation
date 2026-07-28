import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildOperationPersonnelTaskDraft,
  operationPersonnelTaskFingerprint,
} from "./operation_personnel_task.mjs";
import { normalizeOperationPersonnelSnapshot } from "./operation_personnel_task_runner.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeBin = process.execPath;
const pythonBin = process.env.CODEX_PYTHON || "python3";
const taskStateScript = path.join(rootDir, "server", "task_state_db.py");

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function baseTask(taskId = "task-a", ownerEmail = "") {
  return {
    taskId,
    ownerEmail,
    projectName: "示例考试",
    config: {
      requirementRequestId: "",
      operationBatchCode: "EZT260003",
      operationBatch: {
        code: "EZT260003",
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
      },
      businessRequirement: {
        batch_name: "湖北邮政招聘考试",
        operation_serial_number: "R0042483",
        project_code: "P260001",
        project_name: "示例考试",
        ata_invigilator_arrangement: "需要安排分散人工监考",
      },
      examRequirement: {
        id: "requirement-1",
        version: 3,
        fields: {
          "考试名称": "湖北邮政招聘考试",
          "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00",
        },
        config: {
          startTimeDisplay: "2026/08/22 09:00",
          endTimeDisplay: "2026/08/22 11:00",
          earlyLoginMinutes: 30,
          courses: [{ code: "C001", name: "综合能力" }],
        },
      },
    },
    sessions: [{
      sessionType: "formal",
      start: "2026/08/22 09:00",
      end: "2026/08/22 11:00",
      candidateCount: 81,
    }],
  };
}

function previewState(task, {
  token = "preview-token",
  expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  attemptId = "",
} = {}) {
  const draft = buildOperationPersonnelTaskDraft(task, {
    environment: "test",
    now: "2026-07-23T02:00:00.000Z",
  });
  draft.managedSchedules = structuredClone(
    task.config.operationBatch.managedSnapshot.schedules,
  );
  const snapshot = normalizeOperationPersonnelSnapshot({
    batch: {
      ...draft.batch,
      batchName: "",
      projectDepartment: "",
      projectManager: "",
      systemType: "",
      published: false,
    },
    schedules: [],
    personnel: {},
    dates: {},
    requirements: [],
    taskSheet: {
      type: "分散在线监考",
      conditions: [{ name: "人员配置", satisfied: true }],
      content: "任务内容",
    },
    sendRecords: [],
    directoryMatch: {
      to: [{ group: "演练组", id: "demo-user", name: "张乐翔" }],
      cc: [],
    },
  });
  draft.operationRequirements = structuredClone(snapshot.requirements);
  draft.operationTaskSheet = structuredClone(snapshot.taskSheet);
  draft.operationBatch = structuredClone(snapshot.batch);
  draft.directoryMatch = structuredClone(snapshot.directoryMatch);
  draft.previewOperationSnapshot = structuredClone(snapshot);
  draft.previewBaselineSnapshot = structuredClone(snapshot);
  const activeAttempt = attemptId ? {
    attemptId,
    kind: "initial",
    operator: "",
    environment: "test",
    requirementVersion: 3,
    draftVersion: 1,
    fingerprint: operationPersonnelTaskFingerprint(draft),
    recipients: { to: draft.directoryMatch.to, cc: [] },
    managedSchedules: structuredClone(draft.managedSchedules),
    changeSummary: "",
    createdAt: "2026-07-23T02:00:00.000Z",
    startedAt: "2026-07-23T02:00:01.000Z",
    status: "result_unknown",
    target: snapshot,
    baseline: snapshot,
    previewBinding: {
      baselineSnapshotFingerprint: fingerprint(snapshot),
      operationSnapshotFingerprint: fingerprint(snapshot),
      directoryMatchFingerprint: fingerprint(snapshot.directoryMatch),
      managedScheduleFingerprint: fingerprint(draft.managedSchedules),
    },
    verification: {
      phase: "reopened",
      deadlineAt: new Date(Date.now() + 15_000).toISOString(),
    },
    error: { code: "PERSONNEL_SEND_RESULT_UNKNOWN", message: "未发现发送记录" },
  } : null;
  return {
    schemaVersion: 1,
    environment: "test",
    status: attemptId ? "result_unknown" : "ready",
    draft,
    draftVersion: 1,
    sourceFingerprint: fingerprint(draft),
    lastSuccessfulFingerprint: "",
    scheduleCodeMap: draft.scheduleCodeMap,
    lastOperationSnapshot: null,
    checkpoints: attemptId ? {
      submit_send: {
        name: "submit_send",
        status: "completed",
        readback: { kind: "initial", startedAt: "2026-07-23T02:00:01.000Z" },
      },
    } : {},
    activePreview: attemptId ? null : {
      token,
      expiresAt,
      requirementVersion: 3,
      draftVersion: 1,
      kind: "initial",
      externalBaseline: false,
      baselineSendRecord: null,
      baselineSnapshotFingerprint: fingerprint(snapshot),
      operationSnapshotFingerprint: fingerprint(snapshot),
      directoryMatchFingerprint: fingerprint(snapshot.directoryMatch),
      managedScheduleFingerprint: fingerprint(draft.managedSchedules),
    },
    activeAttempt,
    sendHistory: [],
    changeSummary: "",
    events: [],
  };
}

function runTaskState(runtimeDir, action, payload) {
  const output = execFileSync(
    pythonBin,
    [taskStateScript, path.join(runtimeDir, "task_state.sqlite3"), action],
    { input: JSON.stringify(payload) },
  );
  return JSON.parse(String(output));
}

function seedTask(runtimeDir, task, personnelState = null) {
  const config = structuredClone(task.config);
  if (personnelState) config.operationPersonnelTask = personnelState;
  runTaskState(runtimeDir, "create", {
    taskId: task.taskId,
    projectName: task.projectName,
    ownerEmail: task.ownerEmail,
    config,
  });
  for (const session of task.sessions || []) {
    runTaskState(runtimeDir, "upsert_session", {
      taskId: task.taskId,
      requirementIndex: 0,
      sessionType: session.sessionType,
      session: {
        session_id: `${task.taskId}-${session.sessionType}`,
        name: task.projectName,
        start: session.start,
        end: session.end,
        candidate_count: session.candidateCount,
        status: "success",
      },
    });
  }
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      server.close((error) => {
        if (error) return reject(error);
        if (!address || typeof address === "string") return reject(new Error("loopback port was not assigned"));
        return resolve(address.port);
      });
    });
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  let onExit;
  const exited = new Promise((resolve) => {
    onExit = resolve;
    child.once("exit", onExit);
  });
  if (child.exitCode !== null || child.signalCode !== null) {
    child.off("exit", onExit);
    return;
  }
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
  const child = spawn(nodeBin, [path.join(rootDir, "server", "easy_exam_server.mjs")], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      EASY_EXAM_RUNTIME_DIR: runtimeDir,
      REQUIREMENT_DB_PATH: path.join(runtimeDir, "requirement_requests.sqlite3"),
      PAPER_BIND_SCHEDULER_DISABLED: "1",
      APP_LOGIN_EMAIL: "",
      APP_LOGIN_PASSWORD: "",
      OPERATION_CONSOLE_AUTOMATION_ENABLED: "0",
      OPERATION_CONSOLE_ENVIRONMENT: "test",
      OPERATION_CONSOLE_BASE_URL: "http://127.0.0.1:9",
      OPERATION_CONSOLE_USER_DATA_DIR: path.join(runtimeDir, "operation-console-profile"),
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
      const timer = setTimeout(() => finish(reject, new Error("server startup timed out")), 10000);
      const onOutput = (chunk) => {
        if (String(chunk).includes("Easy Exam server running")) finish(resolve);
      };
      const onError = (error) => finish(reject, error);
      const onExit = (code) => finish(reject, new Error(`server exited early: ${code}: ${stderr}`));
      child.stdout.on("data", onOutput);
      child.once("error", onError);
      child.once("exit", onExit);
    });
  } catch (error) {
    await stopServer(child);
    throw error;
  }
  return {
    child,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => stopServer(child),
  };
}

async function withRuntime(run) {
  const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-personnel-routes-"));
  try {
    return await run(runtimeDir);
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
}

test("personnel task state is visible and external personnel actions block when automation is disabled", async () => {
  await withRuntime(async (runtimeDir) => {
    seedTask(runtimeDir, baseTask());
    const runtime = await startServer(runtimeDir);
    try {
      const state = await fetch(`${runtime.baseUrl}/api/tasks/task-a/operation-personnel-task`);
      assert.equal(state.status, 200);
      assert.equal((await state.json()).state.environment, "test");

      const preview = await fetch(`${runtime.baseUrl}/api/tasks/task-a/operation-personnel-task/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(preview.status, 409);
      const body = await preview.json();
      assert.equal(body.errorCode, "PERSONNEL_AUTOMATION_DISABLED");
      assert.match(body.error, /浏览器自动化未启用/);

      for (const action of ["send", "recheck"]) {
        const response = await fetch(
          `${runtime.baseUrl}/api/tasks/task-a/operation-personnel-task/${action}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          },
        );
        assert.equal(response.status, 409);
        assert.equal((await response.json()).errorCode, "PERSONNEL_AUTOMATION_DISABLED");
      }
    } finally {
      await runtime.close();
    }
  });
});

test("personnel preview blocks an unknown configured environment", async () => {
  await withRuntime(async (runtimeDir) => {
    seedTask(runtimeDir, baseTask());
    const runtime = await startServer(runtimeDir, {
      OPERATION_CONSOLE_AUTOMATION_ENABLED: "1",
      OPERATION_CONSOLE_ENVIRONMENT: "staging",
    });
    try {
      const response = await fetch(`${runtime.baseUrl}/api/tasks/task-a/operation-personnel-task/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).errorCode, "PERSONNEL_ENVIRONMENT_INVALID");
    } finally {
      await runtime.close();
    }
  });
});

test("personnel preview and send reject malformed or non-object JSON before service work", async () => {
  await withRuntime(async (runtimeDir) => {
    seedTask(runtimeDir, baseTask());
    const runtime = await startServer(runtimeDir, {
      OPERATION_CONSOLE_AUTOMATION_ENABLED: "1",
      OPERATION_CONSOLE_ENVIRONMENT: "staging",
    });
    try {
      for (const action of ["preview", "send"]) {
        for (const body of ['{"broken"', "[]", "null", '"value"', "1"]) {
          const response = await fetch(
            `${runtime.baseUrl}/api/tasks/task-a/operation-personnel-task/${action}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body,
            },
          );
          assert.equal(response.status, 400);
          assert.equal((await response.json()).errorCode, "PERSONNEL_INVALID_JSON");
        }
      }
    } finally {
      await runtime.close();
    }
  });
});

test("personnel preview and send treat empty request bodies as empty objects", async () => {
  await withRuntime(async (runtimeDir) => {
    seedTask(runtimeDir, baseTask());
    const runtime = await startServer(runtimeDir, {
      OPERATION_CONSOLE_AUTOMATION_ENABLED: "1",
      OPERATION_CONSOLE_ENVIRONMENT: "staging",
    });
    try {
      for (const action of ["preview", "send"]) {
        for (const body of ["", " \n\t "]) {
          const response = await fetch(
            `${runtime.baseUrl}/api/tasks/task-a/operation-personnel-task/${action}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body,
            },
          );
          assert.equal(response.status, 409);
          assert.equal(
            (await response.json()).errorCode,
            "PERSONNEL_ENVIRONMENT_INVALID",
          );
        }
      }
    } finally {
      await runtime.close();
    }
  });
});

test("all personnel task routes hide a project from a different ordinary owner", async () => {
  await withRuntime(async (runtimeDir) => {
    seedTask(runtimeDir, baseTask("task-a", "owner@example.com"));
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
        { method: "GET", path: "" },
        { method: "POST", path: "/preview" },
        { method: "POST", path: "/send" },
        { method: "GET", path: "/attempts/attempt-hidden" },
        { method: "POST", path: "/recheck" },
      ];
      for (const route of routes) {
        const response = await fetch(
          `${runtime.baseUrl}/api/tasks/task-a/operation-personnel-task${route.path}`,
          {
            method: route.method,
            headers: {
              Cookie: "easy_exam_session=other-session",
              "Content-Type": "application/json",
            },
            ...(route.method === "POST" ? { body: '{"broken"' } : {}),
          },
        );
        assert.equal(response.status, 404, `${route.method} ${route.path || "/"}`);
        assert.equal(
          (await response.json()).errorCode,
          "PERSONNEL_TASK_NOT_FOUND",
          `${route.method} ${route.path || "/"}`,
        );
      }
    } finally {
      await runtime.close();
    }
  });
});

test("personnel send rejects an expired preview token", async () => {
  await withRuntime(async (runtimeDir) => {
    const task = baseTask();
    seedTask(runtimeDir, task, previewState(task, {
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    }));
    const runtime = await startServer(runtimeDir, {
      OPERATION_CONSOLE_AUTOMATION_ENABLED: "1",
    });
    try {
      const response = await fetch(`${runtime.baseUrl}/api/tasks/task-a/operation-personnel-task/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previewToken: "preview-token",
          draftVersion: 1,
        }),
      });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).errorCode, "PERSONNEL_PREVIEW_STALE");
    } finally {
      await runtime.close();
    }
  });
});

test("personnel send returns 202 and ignores a forged request environment", async () => {
  await withRuntime(async (runtimeDir) => {
    const task = baseTask();
    seedTask(runtimeDir, task, previewState(task));
    const runtime = await startServer(runtimeDir, {
      OPERATION_CONSOLE_AUTOMATION_ENABLED: "1",
      OPERATION_CONSOLE_ENVIRONMENT: "test",
    });
    try {
      const response = await fetch(`${runtime.baseUrl}/api/tasks/task-a/operation-personnel-task/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previewToken: "preview-token",
          draftVersion: 1,
          environment: "production",
        }),
      });
      assert.equal(response.status, 202);
      const body = await response.json();
      assert.equal(typeof body.attemptId, "string");
      assert.ok(body.attemptId);

      const persisted = runTaskState(runtimeDir, "get", { taskId: "task-a" });
      assert.equal(persisted.config.operationPersonnelTask.activeAttempt.environment, "test");
    } finally {
      await runtime.close();
    }
  });
});

test("personnel send applies final edits and ignores forged read-only fields", async () => {
  await withRuntime(async (runtimeDir) => {
    const task = baseTask();
    seedTask(runtimeDir, task, previewState(task));
    const runtime = await startServer(runtimeDir, {
      OPERATION_CONSOLE_AUTOMATION_ENABLED: "1",
      OPERATION_CONSOLE_ENVIRONMENT: "test",
    });
    try {
      const response = await fetch(`${runtime.baseUrl}/api/tasks/task-a/operation-personnel-task/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previewToken: "preview-token",
          draftVersion: 1,
          changeSummary: "",
          edits: {
            dates: {
              start: "2026-07-28",
              end: "2026-08-19",
              nameListDue: "2026-08-19",
            },
            personnel: { monitorCount: "80", monitorRatio: "1:50" },
          },
          schedules: [{ scheduleCode: "伪造值" }],
          recipients: [{ name: "伪造收件人" }],
        }),
      });
      assert.equal(response.status, 202);

      const persisted = runTaskState(runtimeDir, "get", { taskId: "task-a" });
      const state = persisted.config.operationPersonnelTask;
      assert.equal(state.draft.dates.start, "2026-07-28");
      assert.equal(state.activeAttempt.target.dates.start, "2026-07-28");
      assert.equal(state.activeAttempt.target.personnel.monitorCount, 80);
      assert.deepEqual(state.activeAttempt.target.schedules, []);
      assert.deepEqual(state.activeAttempt.recipients, {
        to: [{ group: "演练组", id: "demo-user", name: "张乐翔" }],
        cc: [],
      });
    } finally {
      await runtime.close();
    }
  });
});

test("personnel attempt route hides an attempt that does not belong to the project", async () => {
  await withRuntime(async (runtimeDir) => {
    const taskA = baseTask("task-a");
    const taskB = baseTask("task-b");
    seedTask(runtimeDir, taskA, previewState(taskA, { attemptId: "attempt-a" }));
    seedTask(runtimeDir, taskB, previewState(taskB, { attemptId: "attempt-b" }));
    const runtime = await startServer(runtimeDir);
    try {
      const missing = await fetch(
        `${runtime.baseUrl}/api/tasks/task-a/operation-personnel-task/attempts/attempt-b`,
      );
      assert.equal(missing.status, 404);
      assert.equal((await missing.json()).errorCode, "PERSONNEL_ATTEMPT_NOT_FOUND");

      const found = await fetch(
        `${runtime.baseUrl}/api/tasks/task-a/operation-personnel-task/attempts/attempt-a`,
      );
      assert.equal(found.status, 200);
      const body = await found.json();
      assert.deepEqual(Object.keys(body).sort(), [
        "attemptId",
        "checkpoint",
        "completed",
        "error",
        "remainingSeconds",
        "status",
        "verificationPhase",
      ]);
      assert.equal(body.attemptId, "attempt-a");
      assert.equal(body.verificationPhase, "reopened");
      assert.ok(body.remainingSeconds >= 0 && body.remainingSeconds <= 15);
      assert.equal(JSON.stringify(body).includes("operationSnapshot"), false);
      assert.equal(JSON.stringify(body).includes("directoryMatch"), false);
    } finally {
      await runtime.close();
    }
  });
});
