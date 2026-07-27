import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeBin = process.execPath;
const pythonBin = process.env.CODEX_PYTHON || "python3";
const taskStateScript = path.join(rootDir, "server", "task_state_db.py");

function seedTask(runtimeDir, task) {
  execFileSync(pythonBin, [taskStateScript, path.join(runtimeDir, "task_state.sqlite3"), "create"], {
    input: JSON.stringify(task),
  });
}

function fanweiImportPayload({ serialNo, requirementFieldsList }) {
  return {
    serialNo,
    fanwei: {
      fields: {
        "运控流水号": serialNo,
        "项目名称": "测试项目",
      },
    },
    requirementFieldsList,
  };
}

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

test("operation batch create route surfaces initialization failure as update_failed", () => {
  const source = readFileSync(
    path.join(rootDir, "server", "easy_exam_server.mjs"),
    "utf8",
  );
  assert.match(source, /runOperationBatchCreationFlow\(\{/);
  assert.match(source, /error\?\.operationBatchStatus === "update_failed"/);
  assert.match(source, /status: "update_failed"/);
  assert.match(source, /operationBatchCode: error\.operationBatchCode/);
});

test("rejects reducing Easy Exam requirements after batch creation", async () => {
  const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-operation-batch-routes-"));
  const taskId = "batch-schedule-delete-task";
  seedTask(runtimeDir, {
    taskId,
    projectName: "测试项目",
    config: {
      projectCard: { sourceKey: "R0031682" },
      operationBatchCode: "EZT260003",
      examRequirements: [
        { id: "requirement-1", fields: { "考试名称": "日程1", "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00" } },
        { id: "requirement-2", fields: { "考试名称": "日程2", "考试日期时间": "2026/08/23 09:00 - 2026/08/23 11:00" } },
      ],
    },
  });
  let child;
  try {
    const server = await startServer(runtimeDir);
    child = server.child;
    const response = await fetch(`${server.baseUrl}/api/fanwei/requirement-import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fanweiImportPayload({
        serialNo: "R0031682",
        requirementFieldsList: [
          { "考试名称": "日程1", "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00" },
        ],
      })),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "批次创建后不允许删除已对应运控日程的易考需求单。",
      errorCode: "OPERATION_BATCH_SCHEDULE_DELETE_FORBIDDEN",
    });
  } finally {
    await stopServer(child);
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("rejects reducing Easy Exam requirements when only the nested batch code is valid", async () => {
  const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-operation-batch-routes-"));
  const taskId = "nested-batch-schedule-delete-task";
  seedTask(runtimeDir, {
    taskId,
    projectName: "测试项目",
    config: {
      projectCard: { sourceKey: "R0031683" },
      operationBatchCode: "invalid",
      operationBatch: { code: "EZT260003" },
      examRequirements: [
        { id: "requirement-1", fields: { "考试名称": "日程1", "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00" } },
        { id: "requirement-2", fields: { "考试名称": "日程2", "考试日期时间": "2026/08/23 09:00 - 2026/08/23 11:00" } },
      ],
    },
  });
  let child;
  try {
    const server = await startServer(runtimeDir);
    child = server.child;
    const response = await fetch(`${server.baseUrl}/api/fanwei/requirement-import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fanweiImportPayload({
        serialNo: "R0031683",
        requirementFieldsList: [
          { "考试名称": "日程1", "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00" },
        ],
      })),
    });
    assert.equal(response.status, 409);
  } finally {
    await stopServer(child);
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("allows equal, increased, and unbatched Fanwei requirement imports", async () => {
  const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-operation-batch-routes-"));
  const requirement = (name, date) => ({ id: name, fields: { "考试名称": name, "考试日期时间": date } });
  const cases = [
    { taskId: "equal-batch-task", serialNo: "R0031684", operationBatchCode: "EZT260003", count: 2 },
    { taskId: "increased-batch-task", serialNo: "R0031685", operationBatchCode: "EZT260003", count: 3 },
    { taskId: "unbatched-task", serialNo: "R0031686", operationBatchCode: "invalid", count: 1 },
  ];
  for (const entry of cases) {
    seedTask(runtimeDir, {
      taskId: entry.taskId,
      projectName: "测试项目",
      config: {
        projectCard: { sourceKey: entry.serialNo },
        operationBatchCode: entry.operationBatchCode,
        examRequirements: [
          requirement("日程1", "2026/08/22 09:00 - 2026/08/22 11:00"),
          requirement("日程2", "2026/08/23 09:00 - 2026/08/23 11:00"),
        ],
      },
    });
  }
  let child;
  try {
    const server = await startServer(runtimeDir);
    child = server.child;
    for (const entry of cases) {
      const requirementFieldsList = [
        { "考试名称": "日程1", "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00" },
        { "考试名称": "日程2", "考试日期时间": "2026/08/23 09:00 - 2026/08/23 11:00" },
      ];
      if (entry.count === 3) requirementFieldsList.push({ "考试名称": "日程3", "考试日期时间": "2026/08/24 09:00 - 2026/08/24 11:00" });
      if (entry.count === 1) requirementFieldsList.pop();
      const response = await fetch(`${server.baseUrl}/api/fanwei/requirement-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fanweiImportPayload({ serialNo: entry.serialNo, requirementFieldsList })),
      });
      assert.equal(response.status, 200, entry.taskId);
    }
  } finally {
    await stopServer(child);
    rmSync(runtimeDir, { recursive: true, force: true });
  }
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

test("operation batch draft route does not let a request override mask a missing business batch name", async () => {
  const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-operation-batch-routes-"));
  const taskId = "missing-business-batch-name";
  seedTask(runtimeDir, {
    taskId,
    projectName: "不能回退使用的项目名",
    config: {
      businessRequirement: {
        project_name: "也不能用于重建批次名称",
        exam_schedule: [{ exam_date: "2026-08-22" }],
      },
    },
  });
  let child;
  try {
    const server = await startServer(runtimeDir);
    child = server.child;
    const response = await fetch(
      `${server.baseUrl}/api/tasks/${taskId}/operation-batch/draft`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: {
            batchName: "请求中的过期批次",
            remark: "仍允许保存的其它覆盖值",
          },
        }),
      },
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.draft.fields.batchName.value, "");
    assert.equal(body.draft.fields.batchName.source, "business_requirement");
    assert.equal(body.draft.fields.remark.value, "仍允许保存的其它覆盖值");
    assert.equal(body.draft.fields.remark.source, "manual");
    assert.deepEqual(
      body.draft.warnings.find((item) => item.field === "batchName"),
      { field: "batchName", message: "批次名称缺失，需要人工补充" },
    );
  } finally {
    await stopServer(child);
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("operation batch draft route does not restore a stale saved batch name", async () => {
  const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-operation-batch-routes-"));
  const taskId = "stale-saved-batch-name";
  seedTask(runtimeDir, {
    taskId,
    config: {
      businessRequirement: {
        batch_name: "业务需求权威批次",
      },
      operationBatch: {
        draft: {
          fields: {
            batchName: { value: "保存草稿中的过期批次" },
            remark: { value: "保留的草稿备注" },
          },
        },
      },
    },
  });
  let child;
  try {
    const server = await startServer(runtimeDir);
    child = server.child;
    const response = await fetch(
      `${server.baseUrl}/api/tasks/${taskId}/operation-batch/draft`,
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.draft.fields.batchName.value, "业务需求权威批次");
    assert.equal(body.draft.fields.batchName.source, "business_requirement");
    assert.equal(body.draft.fields.remark.value, "保留的草稿备注");
    assert.equal(body.draft.fields.remark.source, "manual");
  } finally {
    await stopServer(child);
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("legacy automatic batch name survives workflow reload and unchanged source save", async () => {
  const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-project-source-routes-"));
  const taskId = "legacy-auto-batch-task";
  const requirement = {
    id: "requirement-1",
    version: 1,
    fields: {
      "考试名称": "社会招聘考试",
      "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00",
    },
    config: {},
  };
  seedTask(runtimeDir, {
    taskId,
    projectName: "中国邮政集团公司湖北省分公司社会招聘考试",
    config: {
      fanweiSource: {
        version: 1,
        raw: {
          fields: {
            "项目名称": "中国邮政集团公司湖北省分公司社会招聘考试",
            "客户名称": "中国邮政集团公司湖北省分公司",
          },
        },
      },
      businessRequirement: {
        customer_name: "中国邮政集团公司湖北省分公司",
        project_name: "中国邮政集团公司湖北省分公司社会招聘考试",
      },
      examRequirements: [requirement],
      examRequirement: requirement,
    },
  });
  let child;
  try {
    const server = await startServer(runtimeDir);
    child = server.child;

    const detailResponse = await fetch(`${server.baseUrl}/api/tasks/${taskId}`);
    const detail = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.equal(detail.config.fanweiSource.raw.fields["批次名称"], "社招_2026年8月");
    assert.equal(detail.config.fanweiSource.batchNameMode, "auto");

    const workflowResponse = await fetch(`${server.baseUrl}/api/tasks/${taskId}/operation-workflow`);
    const workflowBody = await workflowResponse.json();
    assert.equal(workflowResponse.status, 200);
    assert.equal(workflowBody.task.config.fanweiSource.raw.fields["批次名称"], "社招_2026年8月");
    assert.equal(workflowBody.task.config.fanweiSource.batchNameMode, "auto");

    const saveResponse = await fetch(`${server.baseUrl}/api/tasks/${taskId}/source-snapshot`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "fanwei",
        fields: detail.config.fanweiSource.raw.fields,
      }),
    });
    const saved = await saveResponse.json();
    assert.equal(saveResponse.status, 200);
    assert.equal(saved.task.config.fanweiSource.raw.fields["批次名称"], "社招_2026年8月");
    assert.equal(saved.task.config.fanweiSource.batchNameMode, "auto");
    assert.equal(saved.task.config.businessRequirement.batch_name_mode, "auto");

    const dateResponse = await fetch(`${server.baseUrl}/api/tasks/${taskId}/source-snapshot`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "examRequirement",
        requirementIndex: 0,
        fields: {
          "考试名称": "社会招聘考试",
          "考试日期时间": "2026/09/22 09:00 - 2026/09/22 11:00",
        },
      }),
    });
    const dated = await dateResponse.json();
    assert.equal(dateResponse.status, 200);
    assert.equal(dated.task.config.fanweiSource.raw.fields["批次名称"], "社招_2026年9月");
    assert.equal(dated.task.config.fanweiSource.batchNameMode, "auto");
  } finally {
    await stopServer(child);
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("legacy custom batch name without mode stays manual on unchanged source save", async () => {
  const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-project-source-routes-"));
  const taskId = "legacy-custom-batch-task";
  const requirement = {
    id: "requirement-1",
    version: 1,
    fields: {
      "考试名称": "社会招聘考试",
      "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00",
    },
    config: {},
  };
  seedTask(runtimeDir, {
    taskId,
    projectName: "中国邮政集团公司湖北省分公司社会招聘考试",
    config: {
      fanweiSource: {
        version: 1,
        raw: {
          fields: {
            "项目名称": "中国邮政集团公司湖北省分公司社会招聘考试",
            "客户名称": "中国邮政集团公司湖北省分公司",
            "批次名称": "历史人工名称",
          },
        },
      },
      businessRequirement: {
        customer_name: "中国邮政集团公司湖北省分公司",
        project_name: "中国邮政集团公司湖北省分公司社会招聘考试",
        batch_name: "历史人工名称",
      },
      examRequirements: [requirement],
      examRequirement: requirement,
    },
  });
  let child;
  try {
    const server = await startServer(runtimeDir);
    child = server.child;

    const detailResponse = await fetch(`${server.baseUrl}/api/tasks/${taskId}`);
    const detail = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.equal(detail.config.fanweiSource.raw.fields["批次名称"], "历史人工名称");
    assert.equal(detail.config.fanweiSource.batchNameMode, "manual");

    const saveResponse = await fetch(`${server.baseUrl}/api/tasks/${taskId}/source-snapshot`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "fanwei",
        fields: detail.config.fanweiSource.raw.fields,
      }),
    });
    const saved = await saveResponse.json();
    assert.equal(saveResponse.status, 200);
    assert.equal(saved.task.config.fanweiSource.raw.fields["批次名称"], "历史人工名称");
    assert.equal(saved.task.config.fanweiSource.batchNameMode, "manual");
    assert.equal(saved.task.config.businessRequirement.batch_name, "历史人工名称");
    assert.equal(saved.task.config.businessRequirement.batch_name_mode, "manual");
    const batchNameAudit = (saved.task.config.projectSourceChangeHistory || [])
      .flatMap((record) => record.changes || [])
      .filter((change) => change.field === "泛微需求 / 批次名称");
    assert.deepEqual(batchNameAudit, []);
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
    assert.equal(autoBody.task.config.fanweiSource.raw.fields["批次名称"], "社招_2026年9月");
    assert.equal(autoBody.task.config.businessRequirement.batch_name, "社招_2026年9月");
    assert.equal(autoBody.task.config.businessRequirement.batch_name_auto_value, "社招_2026年9月");

    const manualResponse = await fetch(`${server.baseUrl}/api/tasks/${manualTaskId}/source-snapshot`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "examRequirement", requirementIndex: 0, fields: septemberFields }),
    });
    const manualBody = await manualResponse.json();
    assert.equal(manualResponse.status, 200);
    assert.equal(manualBody.task.config.fanweiSource.raw.fields["批次名称"], "客户指定批次");
    assert.equal(manualBody.task.config.businessRequirement.batch_name, "客户指定批次");
    assert.equal(manualBody.task.config.businessRequirement.batch_name_auto_value, "社招_2026年9月");

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
    assert.equal(restoreBody.task.config.businessRequirement.batch_name, "社招_2026年9月");
    assert.equal(restoreBody.task.config.businessRequirement.batch_name_mode, "auto");
  } finally {
    await stopServer(child);
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});
