import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeBin = process.execPath;
const pythonBin = process.env.CODEX_PYTHON || "python3";
const taskStateScript = path.join(rootDir, "server", "task_state_db.py");

function seedProjectSourceTask(runtimeDir, taskId, { batchNameMode = "auto", batchName = "湖北邮政社招_2026年8月" } = {}) {
  const autoValue = "湖北邮政社招_2026年8月";
  const requirement = {
    id: "requirement-1",
    version: 1,
    fields: {
      "考试名称": "社会招聘考试",
      "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00",
    },
    config: {},
  };
  execFileSync(pythonBin, [taskStateScript, path.join(runtimeDir, "task_state.sqlite3"), "create"], {
    input: JSON.stringify({
      taskId,
      projectName: "中国邮政集团公司湖北省分公司社会招聘考试",
      config: {
        fanweiSource: {
          version: 1,
          batchNameMode,
          batchNameAutoValue: autoValue,
          raw: {
            fields: {
              "项目名称": "中国邮政集团公司湖北省分公司社会招聘考试",
              "客户名称": "中国邮政集团公司湖北省分公司",
              "批次名称": batchName,
            },
          },
        },
        businessRequirement: {
          customer_name: "中国邮政集团公司湖北省分公司",
          project_name: "中国邮政集团公司湖北省分公司社会招聘考试",
          batch_name: batchName,
          batch_name_mode: batchNameMode,
          batch_name_auto_value: autoValue,
        },
        examRequirements: [requirement],
        examRequirement: requirement,
      },
    }),
  });
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

async function startServer(runtimeDir) {
  const port = await reserveLoopbackPort();
  const child = spawn(nodeBin, [path.join(rootDir, "server", "easy_exam_server.mjs")], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      EASY_EXAM_RUNTIME_DIR: runtimeDir,
      PAPER_BIND_SCHEDULER_DISABLED: "1",
      APP_LOGIN_EMAIL: "",
      APP_LOGIN_PASSWORD: "",
      OPERATION_CONSOLE_AUTOMATION_ENABLED: "0",
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
  return { child, baseUrl: `http://127.0.0.1:${port}` };
}

test("operation batch route test reserves a kernel-assigned loopback port", async () => {
  const port = await reserveLoopbackPort();
  assert.equal(Number.isInteger(port), true);
  assert.ok(port > 0);
});

test("operation batch routes block create but admit reconcile for a persisted reconciling task", async () => {
  const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-operation-batch-routes-"));
  const taskId = "reconciling-task";
  execFileSync(pythonBin, [path.join(rootDir, "server", "task_state_db.py"), path.join(runtimeDir, "task_state.sqlite3"), "create"], {
    input: JSON.stringify({
      taskId,
      projectName: "待对账项目",
      config: { operationBatch: { status: "reconciling" } },
    }),
  });
  let child;
  try {
    const server = await startServer(runtimeDir);
    child = server.child;
    const create = await fetch(`${server.baseUrl}/api/tasks/${taskId}/operation-batch/create`, { method: "POST" });
    const createBody = await create.json();
    assert.equal(create.status, 409);
    assert.equal(createBody.errorCode, "OPERATION_BATCH_RECONCILIATION_REQUIRED");

    const reconcile = await fetch(`${server.baseUrl}/api/tasks/${taskId}/operation-batch/reconcile`, { method: "POST" });
    const reconcileBody = await reconcile.json();
    assert.equal(reconcile.status, 409);
    assert.match(reconcileBody.error, /浏览器自动化未启用/);
    assert.doesNotMatch(reconcileBody.error, /没有待同步结果/);
  } finally {
    await stopServer(child);
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("project source updates recalculate automatic batch names and preserve manual batch names", async () => {
  const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-project-source-routes-"));
  const autoTaskId = "auto-batch-task";
  const manualTaskId = "manual-batch-task";
  seedProjectSourceTask(runtimeDir, autoTaskId);
  seedProjectSourceTask(runtimeDir, manualTaskId, { batchNameMode: "manual", batchName: "客户指定批次" });
  let child;
  try {
    const server = await startServer(runtimeDir);
    child = server.child;
    const septemberFields = {
      "考试名称": "社会招聘考试",
      "考试日期时间": "2026/09/22 09:00 - 2026/09/22 11:00",
    };
    const autoResponse = await fetch(`${server.baseUrl}/api/tasks/${autoTaskId}/source-snapshot`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "examRequirement", requirementIndex: 0, fields: septemberFields }),
    });
    const autoBody = await autoResponse.json();
    assert.equal(autoResponse.status, 200);
    assert.equal(autoBody.task.config.fanweiSource.raw.fields["批次名称"], "湖北邮政社招_2026年9月");
    assert.equal(autoBody.task.config.businessRequirement.batch_name, "湖北邮政社招_2026年9月");
    assert.equal(autoBody.task.config.businessRequirement.batch_name_auto_value, "湖北邮政社招_2026年9月");

    const manualResponse = await fetch(`${server.baseUrl}/api/tasks/${manualTaskId}/source-snapshot`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "examRequirement", requirementIndex: 0, fields: septemberFields }),
    });
    const manualBody = await manualResponse.json();
    assert.equal(manualResponse.status, 200);
    assert.equal(manualBody.task.config.fanweiSource.raw.fields["批次名称"], "客户指定批次");
    assert.equal(manualBody.task.config.businessRequirement.batch_name, "客户指定批次");
    assert.equal(manualBody.task.config.businessRequirement.batch_name_auto_value, "湖北邮政社招_2026年9月");

    const restoreResponse = await fetch(`${server.baseUrl}/api/tasks/${manualTaskId}/source-snapshot`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "fanwei",
        fields: manualBody.task.config.fanweiSource.raw.fields,
        restoreBatchNameAuto: true,
      }),
    });
    const restoreBody = await restoreResponse.json();
    assert.equal(restoreResponse.status, 200);
    assert.equal(restoreBody.task.config.businessRequirement.batch_name, "湖北邮政社招_2026年9月");
    assert.equal(restoreBody.task.config.businessRequirement.batch_name_mode, "auto");
  } finally {
    await stopServer(child);
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});
