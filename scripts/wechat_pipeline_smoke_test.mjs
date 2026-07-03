#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const nodeBin = process.env.CODEX_NODE || process.execPath;
const pythonBin = process.env.CODEX_PYTHON || "/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    args[key] = argv[index + 1];
    index += 1;
  }
  return args;
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(apiBase, timeoutMs = 10000) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${apiBase}/api/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`本机临时服务启动超时：${lastError}`);
}

function runNode(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeBin, args, {
      cwd: rootDir,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`命令失败：${args.join(" ")}\n${stderr || stdout}`));
      }
    });
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
  return payload;
}

async function main() {
  const args = parseArgs(process.argv);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-wechat-smoke-"));
  const port = Number(args.port || await findFreePort());
  const apiBase = `http://127.0.0.1:${port}`;
  const dbPath = path.join(tempDir, "requirements.sqlite3");
  const configPath = path.join(tempDir, "wechat-groups.json");
  const statePath = path.join(tempDir, "wechat-state.json");
  const initialChatPath = path.join(tempDir, "initial-chat.txt");
  const changeChatPath = path.join(tempDir, "change-chat.txt");
  const requestId = args.requestId || "wechat-smoke-test";
  const groupName = "AI赋能运营自动化小组";

  writeFileSync(configPath, `${JSON.stringify({
    groups: [{
      group_name: groupName,
      project_name: "易考自动化需求",
      customer_name: "内部测试客户",
      requirement_request_id: requestId,
      enabled: true,
      interval_minutes: 15,
    }],
  }, null, 2)}\n`);
  writeFileSync(initialChatPath, [
    "2026/06/23 09:02 项目经理：客户启动会确认，考试名称是 2026 校招笔试。",
    "2026/06/23 09:06 客户张：正式考试 8 月 20 日上午 9 点到 11 点，试考 8 月 19 日下午 3 点到 4 点。",
    "2026/06/23 09:08 客户张：科目是行测和英语，需要视频监控和录制，不需要鹰眼，网页考试，允许离开 3 次。",
    "2026/06/23 09:15 项目经理：登录规则先按提前 30 分钟，迟到 15 分钟不能进。",
  ].join("\n"));
  writeFileSync(changeChatPath, [
    "2026/06/24 10:00 客户张：考试时间改到 7-1 时间 10点-12点。",
    "2026/06/24 10:01 客户张：提前登录、迟到时间都是 30分钟。",
    "2026/06/24 10:02 客户张：本次不考英语，改成数学。",
  ].join("\n"));

  const service = spawn(nodeBin, ["server/easy_exam_server.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(port),
      REQUIREMENT_DB_PATH: dbPath,
      CODEX_PYTHON: pythonBin,
      CODEX_NODE: nodeBin,
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serviceStderr = "";
  service.stderr.on("data", (chunk) => {
    serviceStderr += chunk.toString("utf8");
  });

  try {
    await waitForHealth(apiBase);
    await runNode(["scripts/wechat_requirement_collect.mjs",
      "--config", configPath,
      "--state", statePath,
      "--group", groupName,
      "--input", initialChatPath,
      "--push",
      "--api", apiBase,
    ]);
    await runNode(["scripts/wechat_requirement_collect.mjs",
      "--config", configPath,
      "--state", statePath,
      "--group", groupName,
      "--input", changeChatPath,
      "--push",
      "--api", apiBase,
    ]);

    const requirement = await fetchJson(`${apiBase}/api/requirements/${encodeURIComponent(requestId)}`);
    const changeRequests = requirement.changeRequests || [];
    if (requirement.latest?.requirement?.exam_name !== "2026 校招笔试") {
      throw new Error("初始需求没有写入需求中心");
    }
    if (!changeRequests.some((item) => item.status === "pending_internal_review")) {
      throw new Error("后续变更没有进入待人工审核变更单");
    }

    process.stdout.write(`${JSON.stringify({
      ok: true,
      apiBase,
      requestId,
      requirement,
    }, null, 2)}\n`);
  } finally {
    service.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1000);
      service.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (service.exitCode && service.exitCode !== 0 && serviceStderr) {
      process.stderr.write(serviceStderr);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
