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
