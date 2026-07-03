import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { createWechatCollectorHandler } from "./wechat_collector_api.mjs";

function makeReq(method, pathname, body = null) {
  const req = Readable.from(body ? [JSON.stringify(body)] : []);
  req.method = method;
  req.url = pathname;
  return req;
}

function makeRes() {
  return {
    statusCode: 0,
    bodyText: "",
    writeHead(code) {
      this.statusCode = code;
    },
    end(content = "") {
      this.bodyText = String(content);
      this.body = this.bodyText ? JSON.parse(this.bodyText) : null;
    },
  };
}

async function call(handler, method, pathname, body) {
  const req = makeReq(method, pathname, body);
  const res = makeRes();
  const handled = await handler(req, res, new URL(pathname, "http://127.0.0.1"));
  return { handled, statusCode: res.statusCode, body: res.body };
}

test("wechat collector API reads config and status from runtime files", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  writeFileSync(configPath, JSON.stringify({
    groups: [
      {
        group_name: "AI赋能运营自动化小组",
        project_name: "易考自动化需求",
        customer_name: "内部测试客户",
        requirement_request_id: "wechat-ai-ops",
        enabled: true,
        interval_minutes: 15,
      },
    ],
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-24T10:00:00.000Z",
    finishedAt: "2026-06-24T10:00:03.000Z",
    groups: [{ groupName: "AI赋能运营自动化小组", status: "pushed", requestId: "wechat-ai-ops" }],
  }));
  const handler = createWechatCollectorHandler({ configPath, statusPath });

  const config = await call(handler, "GET", "/api/wechat-collector/config");
  const status = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(config.handled, true);
  assert.equal(config.statusCode, 200);
  assert.equal(config.body.config.groups[0].group_name, "AI赋能运营自动化小组");
  assert.equal(status.handled, true);
  assert.equal(status.statusCode, 200);
  assert.equal(status.body.status.groups[0].status, "pushed");
});

test("wechat collector API summarizes configured groups with latest run and checkpoint", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const statePath = path.join(dir, "wechat-checkpoints.json");
  writeFileSync(configPath, JSON.stringify({
    groups: [
      {
        group_name: "AI赋能运营自动化小组",
        project_name: "易考自动化需求",
        customer_name: "内部测试客户",
        requirement_request_id: "wechat-ai-ops",
        enabled: true,
        interval_minutes: 15,
      },
      {
        group_name: "某客户考试项目群",
        project_name: "某客户校招考试",
        customer_name: "某客户",
        requirement_request_id: "customer-campus-2026",
        enabled: true,
        interval_minutes: 30,
      },
    ],
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T08:00:00.000Z",
    finishedAt: "2026-06-25T08:01:00.000Z",
    groups: [
      {
        groupName: "AI赋能运营自动化小组",
        status: "pushed",
        requestId: "wechat-ai-ops",
        messageCount: 4,
        changeCount: 1,
      },
      {
        groupName: "某客户考试项目群",
        status: "skipped_interval",
        requestId: "customer-campus-2026",
        lastRunAt: "2026-06-25T07:45:00.000Z",
        nextRunAt: "2026-06-25T08:15:00.000Z",
      },
    ],
  }));
  writeFileSync(statePath, JSON.stringify({
    groups: {
      "AI赋能运营自动化小组": {
        requestId: "wechat-ai-ops",
        updatedAt: "2026-06-25T08:01:00.000Z",
        lastMessageHash: "hash-a",
      },
      "某客户考试项目群": {
        requestId: "customer-campus-2026",
        updatedAt: "2026-06-25T07:45:00.000Z",
        lastMessageHash: "hash-b",
      },
    },
  }));
  const handler = createWechatCollectorHandler({ configPath, statusPath, statePath });

  const status = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(status.statusCode, 200);
  assert.equal(status.body.groups.length, 2);
  assert.deepEqual(status.body.groups[0], {
    groupName: "AI赋能运营自动化小组",
    projectName: "易考自动化需求",
    customerName: "内部测试客户",
    requirementRequestId: "wechat-ai-ops",
    enabled: true,
    intervalMinutes: 15,
    initialCollectionMode: "ocr_current_window",
    initialCollectedAt: "",
    latestStatus: "pushed",
    latestRunAt: "2026-06-25T08:01:00.000Z",
    requestId: "wechat-ai-ops",
    messageCount: 4,
    changeCount: 1,
    latestError: "",
    checkpointUpdatedAt: "2026-06-25T08:01:00.000Z",
    nextRunAt: "2026-06-25T08:16:00.000Z",
  });
  assert.equal(status.body.groups[1].latestStatus, "skipped_interval");
  assert.equal(status.body.groups[1].latestRunAt, "2026-06-25T07:45:00.000Z");
  assert.equal(status.body.groups[1].nextRunAt, "2026-06-25T08:15:00.000Z");
});

test("wechat collector group summary includes latest failure detail", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: true,
      interval_minutes: 15,
    }],
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T08:00:00.000Z",
    finishedAt: "2026-06-25T08:01:00.000Z",
    groups: [{
      groupName: "AI赋能运营自动化小组",
      status: "failed",
      error: "需求中心不可用：fetch failed",
    }],
  }));
  const handler = createWechatCollectorHandler({ configPath, statusPath });

  const status = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(status.statusCode, 200);
  assert.equal(status.body.groups[0].latestStatus, "failed");
  assert.equal(status.body.groups[0].latestError, "需求中心不可用：fetch failed");
});

test("wechat collector status preserves invalid configured intervals for diagnosis", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: true,
      interval_minutes: 0,
    }],
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T08:00:00.000Z",
    finishedAt: "2026-06-25T08:01:00.000Z",
    groups: [{ groupName: "AI赋能运营自动化小组", status: "pushed" }],
  }));
  const handler = createWechatCollectorHandler({ configPath, statusPath });

  const status = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(status.statusCode, 200);
  assert.equal(status.body.groups[0].intervalMinutes, 0);
  assert.equal(status.body.groups[0].nextRunAt, "");
  assert.equal(status.body.readiness.checks.find((item) => item.key === "config_valid").ok, false);
});

test("wechat collector API reads recent JSONL run history", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const historyPath = path.join(dir, "wechat-run-history.jsonl");
  writeFileSync(historyPath, [
    JSON.stringify({ finishedAt: "2026-06-25T08:00:00.000Z", groups: [{ groupName: "A", status: "failed" }] }),
    "not json",
    JSON.stringify({ finishedAt: "2026-06-25T08:15:00.000Z", groups: [{ groupName: "A", status: "pushed" }] }),
  ].join("\n"));
  const handler = createWechatCollectorHandler({
    configPath: path.join(dir, "wechat-requirement-groups.json"),
    statusPath: path.join(dir, "wechat-last-run.json"),
    historyPath,
    historyLimit: 2,
  });

  const status = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(status.statusCode, 200);
  assert.equal(status.body.history.length, 2);
  assert.equal(status.body.history[0].groups[0].status, "pushed");
  assert.equal(status.body.history[1].groups[0].status, "failed");
  assert.equal(status.body.historyPath, historyPath);
});

test("wechat collector API lists recent runtime config backups", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configBackupDir = path.join(dir, "wechat-config-backups");
  mkdirSync(configBackupDir, { recursive: true });
  const oldBackup = path.join(configBackupDir, "20260625T080000Z-wechat-requirement-groups.json");
  const newBackup = path.join(configBackupDir, "20260626T090000Z-wechat-requirement-groups.json");
  writeFileSync(oldBackup, JSON.stringify({ groups: [{ group_name: "旧群" }] }));
  writeFileSync(newBackup, JSON.stringify({ groups: [{ group_name: "新群" }] }));
  const handler = createWechatCollectorHandler({
    configPath: path.join(dir, "wechat-requirement-groups.json"),
    statusPath: path.join(dir, "wechat-last-run.json"),
    configBackupDir,
  });

  const status = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(status.statusCode, 200);
  assert.equal(status.body.configBackups.length, 2);
  assert.equal(status.body.configBackups[0].path, newBackup);
  assert.equal(status.body.configBackups[0].fileName, path.basename(newBackup));
  assert.equal(status.body.configBackups[1].path, oldBackup);
});

test("wechat collector API includes launchd scheduler status", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const handler = createWechatCollectorHandler({
    configPath: path.join(dir, "wechat-requirement-groups.json"),
    statusPath: path.join(dir, "wechat-last-run.json"),
    schedulerStatus: () => ({
      label: "com.ata.easy-exam-wechat-collector",
      plistPath: path.join(dir, "com.ata.easy-exam-wechat-collector.plist"),
      installed: true,
      loaded: true,
      detail: "launchd job is loaded",
    }),
    serviceStatus: () => ({
      label: "com.ata.easy-exam-service",
      plistPath: path.join(dir, "com.ata.easy-exam-service.plist"),
      installed: true,
      loaded: true,
      detail: "launchd job is loaded",
    }),
  });

  const status = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(status.handled, true);
  assert.equal(status.statusCode, 200);
  assert.equal(status.body.scheduler.label, "com.ata.easy-exam-wechat-collector");
  assert.equal(status.body.scheduler.installed, true);
  assert.equal(status.body.scheduler.loaded, true);
  assert.equal(status.body.service.label, "com.ata.easy-exam-service");
  assert.equal(status.body.service.loaded, true);
  assert.equal(status.body.service.httpReachable, true);
  assert.match(status.body.readiness.checks.find((item) => item.key === "local_service").detail, /HTTP 服务当前可访问/);
});

test("wechat collector API includes requirement center health status", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const handler = createWechatCollectorHandler({
    configPath: path.join(dir, "wechat-requirement-groups.json"),
    statusPath: path.join(dir, "wechat-last-run.json"),
    requirementCenterStatus: async () => ({
      apiBase: "http://127.0.0.1:8765",
      available: true,
      detail: "requirement center is reachable",
    }),
  });

  const status = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(status.handled, true);
  assert.equal(status.statusCode, 200);
  assert.equal(status.body.requirementCenter.apiBase, "http://127.0.0.1:8765");
  assert.equal(status.body.requirementCenter.available, true);
});

test("wechat collector API includes OCR readiness status", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const handler = createWechatCollectorHandler({
    configPath: path.join(dir, "wechat-requirement-groups.json"),
    statusPath: path.join(dir, "wechat-last-run.json"),
    ocrStatus: async () => ({
      available: true,
      toolPath: "/repo/scripts/ocr_image.swift",
      swiftAvailable: true,
      detail: "macOS Vision OCR helper is ready",
    }),
  });

  const status = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(status.handled, true);
  assert.equal(status.statusCode, 200);
  assert.equal(status.body.ocr.available, true);
  assert.equal(status.body.ocr.swiftAvailable, true);
  assert.equal(status.body.readiness.checks.find((item) => item.key === "ocr_capture").ok, true);
});

test("wechat collector API summarizes automation readiness", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const pipelineSmokeStatusPath = path.join(dir, "wechat-pipeline-smoke.json");
  const lockPath = path.join(dir, "wechat-visible-collect.lock");
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true }],
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T08:00:00.000Z",
    finishedAt: "2026-06-25T08:01:00.000Z",
    groups: [{ groupName: "AI赋能运营自动化小组", status: "pushed" }],
  }));
  writeFileSync(pipelineSmokeStatusPath, JSON.stringify({
    ok: true,
    requestId: "wechat-smoke-test",
    finishedAt: "2026-06-25T07:30:00.000Z",
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    pipelineSmokeStatusPath,
    lockPath,
    now: () => new Date("2026-06-25T08:00:00.000Z"),
    serviceStatus: () => ({ installed: true, loaded: true }),
    schedulerStatus: () => ({ installed: true, loaded: true }),
    requirementCenterStatus: async () => ({ apiBase: "http://127.0.0.1:8765", available: true }),
    ocrStatus: async () => ({ available: true, detail: "ready" }),
  });

  const status = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(status.statusCode, 200);
  assert.deepEqual(status.body.readiness.checks.filter((item) => !item.ok).map((item) => item.key), []);
  assert.equal(status.body.readiness.ready, true);
  assert.equal(status.body.readiness.checks.find((item) => item.key === "config_valid").ok, true);
  assert.equal(status.body.readiness.checks.find((item) => item.key === "enabled_groups").ok, true);
  assert.equal(status.body.readiness.checks.find((item) => item.key === "last_run").ok, true);
  assert.equal(status.body.readiness.checks.find((item) => item.key === "requirement_push").ok, true);
  assert.equal(status.body.readiness.checks.find((item) => item.key === "pipeline_smoke").ok, true);
});

test("wechat collector readiness reports a stale scheduler heartbeat", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true }],
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T06:00:00.000Z",
    finishedAt: "2026-06-25T06:01:00.000Z",
    groups: [{ groupName: "AI赋能运营自动化小组", status: "pushed" }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    lastRunMaxAgeMs: 60 * 60 * 1000,
    now: () => new Date("2026-06-25T08:00:00.000Z"),
    serviceStatus: () => ({ installed: true, loaded: true }),
    schedulerStatus: () => ({ installed: true, loaded: true }),
    requirementCenterStatus: async () => ({ available: true }),
    ocrStatus: async () => ({ available: true }),
  });

  const status = await call(handler, "GET", "/api/wechat-collector/status");
  const heartbeat = status.body.readiness.checks.find((item) => item.key === "scheduler_heartbeat");

  assert.equal(status.body.readiness.checks.find((item) => item.key === "last_run").ok, true);
  assert.equal(heartbeat.ok, false);
  assert.match(heartbeat.detail, /超过 60 分钟/);
  assert.equal(status.body.runFreshness.stale, true);
});

test("wechat collector readiness reports invalid runtime config", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const pipelineSmokeStatusPath = path.join(dir, "wechat-pipeline-smoke.json");
  writeFileSync(configPath, JSON.stringify({
    groups: [
      { group_name: "AI赋能运营自动化小组", enabled: true, interval_minutes: 15 },
      { group_name: "AI赋能运营自动化小组", enabled: true, interval_minutes: 30 },
    ],
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T08:00:00.000Z",
    finishedAt: "2026-06-25T08:01:00.000Z",
    groups: [{ groupName: "AI赋能运营自动化小组", status: "pushed" }],
  }));
  writeFileSync(pipelineSmokeStatusPath, JSON.stringify({
    ok: true,
    requestId: "wechat-smoke-test",
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    pipelineSmokeStatusPath,
    now: () => new Date("2026-06-25T08:30:00.000Z"),
    serviceStatus: () => ({ installed: true, loaded: true }),
    schedulerStatus: () => ({ installed: true, loaded: true }),
    requirementCenterStatus: async () => ({ apiBase: "http://127.0.0.1:8765", available: true }),
    ocrStatus: async () => ({ available: true, detail: "ready" }),
  });

  const status = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(status.statusCode, 200);
  assert.equal(status.body.readiness.ready, false);
  assert.equal(status.body.readiness.checks.find((item) => item.key === "config_valid").ok, false);
  assert.match(status.body.readiness.checks.find((item) => item.key === "config_valid").detail, /微信群名称重复/);
});

test("wechat collector readiness requires a passing pipeline smoke test", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const pipelineSmokeStatusPath = path.join(dir, "wechat-pipeline-smoke.json");
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true }],
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T08:00:00.000Z",
    finishedAt: "2026-06-25T08:01:00.000Z",
    groups: [{ groupName: "AI赋能运营自动化小组", status: "pushed" }],
  }));
  writeFileSync(pipelineSmokeStatusPath, JSON.stringify({
    ok: false,
    requestId: "",
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    pipelineSmokeStatusPath,
    now: () => new Date("2026-06-25T08:30:00.000Z"),
    serviceStatus: () => ({ installed: true, loaded: true }),
    schedulerStatus: () => ({ installed: true, loaded: true }),
    requirementCenterStatus: async () => ({ apiBase: "http://127.0.0.1:8765", available: true }),
    ocrStatus: async () => ({ available: true, detail: "ready" }),
  });

  const status = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(status.body.readiness.checks.find((item) => item.key === "last_run").ok, true);
  assert.equal(status.body.readiness.checks.find((item) => item.key === "requirement_push").ok, true);
  assert.equal(status.body.readiness.checks.find((item) => item.key === "pipeline_smoke").ok, false);
  assert.equal(status.body.readiness.ready, false);
});

test("wechat collector readiness requires a recent passing pipeline smoke test", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const pipelineSmokeStatusPath = path.join(dir, "wechat-pipeline-smoke.json");
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true }],
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T08:00:00.000Z",
    finishedAt: "2026-06-25T08:01:00.000Z",
    groups: [{ groupName: "AI赋能运营自动化小组", status: "pushed" }],
  }));
  writeFileSync(pipelineSmokeStatusPath, JSON.stringify({
    ok: true,
    requestId: "wechat-smoke-test",
    finishedAt: "2026-06-24T07:59:00.000Z",
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    pipelineSmokeStatusPath,
    pipelineSmokeMaxAgeMs: 24 * 60 * 60 * 1000,
    now: () => new Date("2026-06-25T08:00:00.000Z"),
    serviceStatus: () => ({ installed: true, loaded: true }),
    schedulerStatus: () => ({ installed: true, loaded: true }),
    requirementCenterStatus: async () => ({ apiBase: "http://127.0.0.1:8765", available: true }),
    ocrStatus: async () => ({ available: true, detail: "ready" }),
  });

  const status = await call(handler, "GET", "/api/wechat-collector/status");
  const smokeCheck = status.body.readiness.checks.find((item) => item.key === "pipeline_smoke");

  assert.equal(status.statusCode, 200);
  assert.equal(status.body.pipelineSmoke.ok, true);
  assert.equal(status.body.pipelineSmoke.fresh, false);
  assert.equal(status.body.pipelineSmoke.stale, true);
  assert.equal(smokeCheck.ok, false);
  assert.match(smokeCheck.detail, /链路自检已超过 24 小时/);
  assert.equal(status.body.readiness.ready, false);
});

test("wechat collector readiness requires a recent requirement-center push", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true }],
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T08:00:00.000Z",
    finishedAt: "2026-06-25T08:01:00.000Z",
    groups: [{ groupName: "AI赋能运营自动化小组", status: "collected" }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    serviceStatus: () => ({ installed: true, loaded: true }),
    schedulerStatus: () => ({ installed: true, loaded: true }),
    requirementCenterStatus: async () => ({ apiBase: "http://127.0.0.1:8765", available: true }),
    ocrStatus: async () => ({ available: true, detail: "ready" }),
  });

  const status = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(status.body.readiness.checks.find((item) => item.key === "last_run").ok, true);
  assert.equal(status.body.readiness.checks.find((item) => item.key === "requirement_push").ok, false);
  assert.equal(status.body.readiness.ready, false);
});

test("wechat collector readiness treats skipped runs as not successful", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true }],
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T08:00:00.000Z",
    finishedAt: "2026-06-25T08:01:00.000Z",
    status: "skipped",
    groups: [],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    serviceStatus: () => ({ installed: true, loaded: true }),
    schedulerStatus: () => ({ installed: true, loaded: true }),
    requirementCenterStatus: async () => ({ apiBase: "http://127.0.0.1:8765", available: true }),
    ocrStatus: async () => ({ available: true, detail: "ready" }),
  });

  const status = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(status.body.readiness.ready, false);
  assert.equal(status.body.readiness.checks.find((item) => item.key === "last_run").ok, false);
});

test("wechat collector readiness treats no-new-message runs as successful but not pushed", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const pipelineSmokeStatusPath = path.join(dir, "wechat-pipeline-smoke.json");
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true }],
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T08:00:00.000Z",
    finishedAt: "2026-06-25T08:01:00.000Z",
    groups: [{ groupName: "AI赋能运营自动化小组", status: "no_new_messages" }],
  }));
  writeFileSync(pipelineSmokeStatusPath, JSON.stringify({ ok: true }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    pipelineSmokeStatusPath,
    serviceStatus: () => ({ installed: true, loaded: true }),
    schedulerStatus: () => ({ installed: true, loaded: true }),
    requirementCenterStatus: async () => ({ apiBase: "http://127.0.0.1:8765", available: true }),
    ocrStatus: async () => ({ available: true, detail: "ready" }),
  });

  const status = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(status.body.readiness.checks.find((item) => item.key === "last_run").ok, true);
  assert.equal(status.body.readiness.checks.find((item) => item.key === "requirement_push").ok, false);
  assert.equal(status.body.readiness.ready, false);
});

test("wechat collector readiness treats no-requirement-signal runs as a successful heartbeat", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true }],
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T08:00:00.000Z",
    finishedAt: "2026-06-25T08:01:00.000Z",
    groups: [{ groupName: "AI赋能运营自动化小组", status: "no_requirement_signal" }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    serviceStatus: () => ({ installed: true, loaded: true }),
    schedulerStatus: () => ({ installed: true, loaded: true }),
    requirementCenterStatus: async () => ({ apiBase: "http://127.0.0.1:8765", available: true }),
    ocrStatus: async () => ({ available: true, detail: "ready" }),
  });

  const status = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(status.body.readiness.checks.find((item) => item.key === "last_run").ok, true);
  assert.equal(status.body.readiness.checks.find((item) => item.key === "requirement_push").ok, false);
});

test("wechat collector readiness treats dry-run preflight as not a successful collection", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true }],
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T08:00:00.000Z",
    finishedAt: "2026-06-25T08:01:00.000Z",
    groups: [{ groupName: "AI赋能运营自动化小组", status: "dry_run", captureMode: "ocr" }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    serviceStatus: () => ({ installed: true, loaded: true }),
    schedulerStatus: () => ({ installed: true, loaded: true }),
    requirementCenterStatus: async () => ({ apiBase: "http://127.0.0.1:8765", available: true }),
    ocrStatus: async () => ({ available: true, detail: "ready" }),
  });

  const status = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(status.body.readiness.ready, false);
  assert.equal(status.body.readiness.checks.find((item) => item.key === "last_run").ok, false);
  assert.match(status.body.readiness.checks.find((item) => item.key === "last_run").detail, /预检/);
});

test("wechat collector API reports active and stale collection locks", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const lockPath = path.join(dir, "wechat-visible-collect.lock");
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true }],
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T08:00:00.000Z",
    finishedAt: "2026-06-25T08:01:00.000Z",
    groups: [{ groupName: "AI赋能运营自动化小组", status: "pushed" }],
  }));
  writeFileSync(lockPath, "active");
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    lockPath,
    lockMaxAgeMs: 60_000,
    serviceStatus: () => ({ installed: true, loaded: true }),
    schedulerStatus: () => ({ installed: true, loaded: true }),
    requirementCenterStatus: async () => ({ apiBase: "http://127.0.0.1:8765", available: true }),
    ocrStatus: async () => ({ available: true, detail: "ready" }),
  });

  const active = await call(handler, "GET", "/api/wechat-collector/status");
  const oldDate = new Date(Date.now() - 120_000);
  utimesSync(lockPath, oldDate, oldDate);
  const stale = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(active.body.lock.exists, true);
  assert.equal(active.body.lock.stale, false);
  assert.equal(active.body.readiness.ready, false);
  assert.equal(active.body.readiness.checks.find((item) => item.key === "collector_lock").ok, false);
  assert.equal(stale.body.lock.exists, true);
  assert.equal(stale.body.lock.stale, true);
  assert.equal(stale.body.readiness.checks.find((item) => item.key === "collector_lock").ok, true);
});

test("wechat collector API includes launchd log tails", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const logsDir = path.join(dir, "logs");
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  writeFileSync(path.join(dir, "service.stdout.log"), "service started\nready\n");
  writeFileSync(path.join(dir, "collector.err.log"), "collector failed\n");
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    logPaths: {
      serviceStdout: path.join(dir, "service.stdout.log"),
      serviceStderr: path.join(logsDir, "missing-service.err.log"),
      collectorStdout: path.join(logsDir, "missing-collector.log"),
      collectorStderr: path.join(dir, "collector.err.log"),
    },
  });

  const status = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(status.statusCode, 200);
  assert.match(status.body.logs.serviceStdout.text, /service started/);
  assert.equal(status.body.logs.serviceStderr.exists, false);
  assert.match(status.body.logs.collectorStderr.text, /collector failed/);
});

test("wechat collector API can install and uninstall scheduler by explicit request", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const pipelineSmokeStatusPath = path.join(dir, "wechat-pipeline-smoke.json");
  const calls = [];
  const scheduler = {
    label: "com.ata.easy-exam-wechat-collector",
    plistPath: path.join(dir, "com.ata.easy-exam-wechat-collector.plist"),
    installed: true,
    loaded: true,
    detail: "launchd job is loaded",
  };
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: true,
      interval_minutes: 15,
    }],
  }));
  writeFileSync(pipelineSmokeStatusPath, JSON.stringify({
    ok: true,
    requestId: "wechat-smoke-test",
    finishedAt: "2026-06-25T07:30:00.000Z",
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T07:45:00.000Z",
    finishedAt: "2026-06-25T07:46:00.000Z",
    groups: [{ groupName: "AI赋能运营自动化小组", status: "pushed" }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    pipelineSmokeStatusPath,
    now: () => new Date("2026-06-25T08:00:00.000Z"),
    installScheduler: () => {
      calls.push("install");
      return scheduler;
    },
    uninstallScheduler: () => {
      calls.push("uninstall");
      return { ...scheduler, installed: false, loaded: false };
    },
  });

  const installed = await call(handler, "POST", "/api/wechat-collector/scheduler/install");
  const uninstalled = await call(handler, "POST", "/api/wechat-collector/scheduler/uninstall");

  assert.equal(installed.statusCode, 200);
  assert.equal(installed.body.scheduler.installed, true);
  assert.equal(uninstalled.statusCode, 200);
  assert.equal(uninstalled.body.scheduler.loaded, false);
  assert.deepEqual(calls, ["install", "uninstall"]);
});

test("wechat collector API rejects scheduler install until pipeline smoke test is fresh", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const pipelineSmokeStatusPath = path.join(dir, "wechat-pipeline-smoke.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: true,
      interval_minutes: 15,
    }],
  }));
  writeFileSync(pipelineSmokeStatusPath, JSON.stringify({
    ok: true,
    requestId: "wechat-smoke-test",
    finishedAt: "2026-06-24T07:59:00.000Z",
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath: path.join(dir, "wechat-last-run.json"),
    pipelineSmokeStatusPath,
    pipelineSmokeMaxAgeMs: 24 * 60 * 60 * 1000,
    now: () => new Date("2026-06-25T08:00:00.000Z"),
    installScheduler: () => {
      calls.push("install");
      return { installed: true, loaded: true };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/scheduler/install");

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /链路自检已超过 24 小时/);
  assert.deepEqual(calls, []);
});

test("wechat collector API rejects scheduler install until a recent real WeChat push succeeds", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const pipelineSmokeStatusPath = path.join(dir, "wechat-pipeline-smoke.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: true,
      interval_minutes: 15,
    }],
  }));
  writeFileSync(pipelineSmokeStatusPath, JSON.stringify({
    ok: true,
    requestId: "wechat-smoke-test",
    finishedAt: "2026-06-25T07:30:00.000Z",
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath: path.join(dir, "wechat-last-run.json"),
    pipelineSmokeStatusPath,
    now: () => new Date("2026-06-25T08:00:00.000Z"),
    installScheduler: () => {
      calls.push("install");
      return { installed: true, loaded: true };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/scheduler/install");

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /真实微信试跑/);
  assert.deepEqual(calls, []);
});

test("wechat collector API requires every enabled group to have a recent real WeChat push", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const pipelineSmokeStatusPath = path.join(dir, "wechat-pipeline-smoke.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [
      { group_name: "已验证项目群", enabled: true, interval_minutes: 15 },
      { group_name: "待验证项目群", enabled: true, interval_minutes: 15 },
      { group_name: "已停用项目群", enabled: false, interval_minutes: 15 },
    ],
  }));
  writeFileSync(pipelineSmokeStatusPath, JSON.stringify({
    ok: true,
    requestId: "wechat-smoke-test",
    finishedAt: "2026-06-25T07:30:00.000Z",
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T07:45:00.000Z",
    finishedAt: "2026-06-25T07:46:00.000Z",
    groups: [{ groupName: "已验证项目群", status: "pushed" }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    pipelineSmokeStatusPath,
    historyPath: path.join(dir, "wechat-run-history.jsonl"),
    now: () => new Date("2026-06-25T08:00:00.000Z"),
    installScheduler: () => {
      calls.push("install");
      return { installed: true, loaded: true };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/scheduler/install");

  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /待验证项目群/);
  assert.doesNotMatch(result.body.error, /已停用项目群/);
  assert.deepEqual(calls, []);
});

test("wechat collector API accepts recent per-group pushes accumulated in run history", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const historyPath = path.join(dir, "wechat-run-history.jsonl");
  const pipelineSmokeStatusPath = path.join(dir, "wechat-pipeline-smoke.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [
      { group_name: "先试跑项目群", enabled: true, interval_minutes: 15 },
      { group_name: "后试跑项目群", enabled: true, interval_minutes: 15 },
    ],
  }));
  writeFileSync(pipelineSmokeStatusPath, JSON.stringify({
    ok: true,
    requestId: "wechat-smoke-test",
    finishedAt: "2026-06-25T07:30:00.000Z",
  }));
  writeFileSync(historyPath, `${JSON.stringify({
    finishedAt: "2026-06-25T07:40:00.000Z",
    groups: [{ groupName: "先试跑项目群", status: "pushed" }],
  })}\n`);
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T07:45:00.000Z",
    finishedAt: "2026-06-25T07:46:00.000Z",
    groups: [{ groupName: "后试跑项目群", status: "pushed" }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    historyPath,
    pipelineSmokeStatusPath,
    now: () => new Date("2026-06-25T08:00:00.000Z"),
    installScheduler: () => {
      calls.push("install");
      return { installed: true, loaded: true };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/scheduler/install");

  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls, ["install"]);
});

test("wechat collector API rejects scheduler install when no groups are enabled", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: false,
      interval_minutes: 15,
    }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath: path.join(dir, "wechat-last-run.json"),
    installScheduler: () => {
      calls.push("install");
      return { installed: true, loaded: true };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/scheduler/install");

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /还没有启用的微信群配置/);
  assert.deepEqual(calls, []);
});

test("wechat collector API rejects scheduler install when runtime config is invalid", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: true,
      interval_minutes: 0,
    }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath: path.join(dir, "wechat-last-run.json"),
    installScheduler: () => {
      calls.push("install");
      return { installed: true, loaded: true };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/scheduler/install");

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /采集间隔必须是正整数/);
  assert.deepEqual(calls, []);
});

test("wechat collector API can install and uninstall easy exam service by explicit request", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const calls = [];
  const service = {
    label: "com.ata.easy-exam-service",
    plistPath: path.join(dir, "com.ata.easy-exam-service.plist"),
    installed: true,
    loaded: true,
    detail: "launchd job is loaded",
  };
  const handler = createWechatCollectorHandler({
    configPath: path.join(dir, "wechat-requirement-groups.json"),
    statusPath: path.join(dir, "wechat-last-run.json"),
    installService: () => {
      calls.push("install-service");
      return service;
    },
    uninstallService: () => {
      calls.push("uninstall-service");
      return { ...service, installed: false, loaded: false };
    },
  });

  const installed = await call(handler, "POST", "/api/wechat-collector/service/install");
  const uninstalled = await call(handler, "POST", "/api/wechat-collector/service/uninstall");

  assert.equal(installed.statusCode, 200);
  assert.equal(installed.body.service.installed, true);
  assert.equal(uninstalled.statusCode, 200);
  assert.equal(uninstalled.body.service.loaded, false);
  assert.deepEqual(calls, ["install-service", "uninstall-service"]);
});

test("wechat collector API can install and uninstall the whole automation stack", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const pipelineSmokeStatusPath = path.join(dir, "wechat-pipeline-smoke.json");
  const calls = [];
  const service = { label: "com.ata.easy-exam-service", installed: true, loaded: true };
  const scheduler = { label: "com.ata.easy-exam-wechat-collector", installed: true, loaded: true };
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: true,
      interval_minutes: 15,
    }],
  }));
  writeFileSync(pipelineSmokeStatusPath, JSON.stringify({
    ok: true,
    requestId: "wechat-smoke-test",
    finishedAt: "2026-06-25T07:30:00.000Z",
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T07:45:00.000Z",
    finishedAt: "2026-06-25T07:46:00.000Z",
    groups: [{ groupName: "AI赋能运营自动化小组", status: "pushed" }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    pipelineSmokeStatusPath,
    now: () => new Date("2026-06-25T08:00:00.000Z"),
    installService: () => {
      calls.push("install-service");
      return service;
    },
    installScheduler: () => {
      calls.push("install-scheduler");
      return scheduler;
    },
    uninstallScheduler: () => {
      calls.push("uninstall-scheduler");
      return { ...scheduler, installed: false, loaded: false };
    },
    uninstallService: () => {
      calls.push("uninstall-service");
      return { ...service, installed: false, loaded: false };
    },
  });

  const installed = await call(handler, "POST", "/api/wechat-collector/automation/install");
  const uninstalled = await call(handler, "POST", "/api/wechat-collector/automation/uninstall");

  assert.equal(installed.statusCode, 200);
  assert.equal(installed.body.service.loaded, true);
  assert.equal(installed.body.scheduler.loaded, true);
  assert.equal(uninstalled.statusCode, 200);
  assert.equal(uninstalled.body.service.loaded, false);
  assert.equal(uninstalled.body.scheduler.loaded, false);
  assert.deepEqual(calls, ["install-service", "install-scheduler", "uninstall-scheduler", "uninstall-service"]);
});

test("wechat collector API rolls back service install when automation scheduler install fails", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const pipelineSmokeStatusPath = path.join(dir, "wechat-pipeline-smoke.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: true,
      interval_minutes: 15,
    }],
  }));
  writeFileSync(pipelineSmokeStatusPath, JSON.stringify({
    ok: true,
    requestId: "wechat-smoke-test",
    finishedAt: "2026-06-25T07:30:00.000Z",
  }));
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T07:45:00.000Z",
    finishedAt: "2026-06-25T07:46:00.000Z",
    groups: [{ groupName: "AI赋能运营自动化小组", status: "pushed" }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    pipelineSmokeStatusPath,
    now: () => new Date("2026-06-25T08:00:00.000Z"),
    installService: () => {
      calls.push("install-service");
      return { label: "com.ata.easy-exam-service", installed: true, loaded: true };
    },
    installScheduler: () => {
      calls.push("install-scheduler");
      throw new Error("scheduler install failed");
    },
    uninstallService: () => {
      calls.push("uninstall-service");
      return { label: "com.ata.easy-exam-service", installed: false, loaded: false };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/automation/install");

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 500);
  assert.equal(result.body.ok, false);
  assert.match(result.body.error, /scheduler install failed/);
  assert.equal(result.body.rollback.service.loaded, false);
  assert.deepEqual(calls, ["install-service", "install-scheduler", "uninstall-service"]);
});

test("wechat collector API rejects automation install until pipeline smoke test has passed", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: true,
      interval_minutes: 15,
    }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath: path.join(dir, "wechat-last-run.json"),
    pipelineSmokeStatusPath: path.join(dir, "wechat-pipeline-smoke.json"),
    installService: () => {
      calls.push("install-service");
      return { installed: true, loaded: true };
    },
    installScheduler: () => {
      calls.push("install-scheduler");
      return { installed: true, loaded: true };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/automation/install");

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /还没有通过链路自检/);
  assert.deepEqual(calls, []);
});

test("wechat collector API rejects automation install until a recent real WeChat push succeeds", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const pipelineSmokeStatusPath = path.join(dir, "wechat-pipeline-smoke.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: true,
      interval_minutes: 15,
    }],
  }));
  writeFileSync(pipelineSmokeStatusPath, JSON.stringify({
    ok: true,
    requestId: "wechat-smoke-test",
    finishedAt: "2026-06-25T07:30:00.000Z",
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath: path.join(dir, "wechat-last-run.json"),
    pipelineSmokeStatusPath,
    now: () => new Date("2026-06-25T08:00:00.000Z"),
    installService: () => {
      calls.push("install-service");
      return { installed: true, loaded: true };
    },
    installScheduler: () => {
      calls.push("install-scheduler");
      return { installed: true, loaded: true };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/automation/install");

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /真实微信试跑/);
  assert.deepEqual(calls, []);
});

test("wechat collector API rejects automation install when no groups are enabled", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: false,
      interval_minutes: 15,
    }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath: path.join(dir, "wechat-last-run.json"),
    installService: () => {
      calls.push("install-service");
      return { installed: true, loaded: true };
    },
    installScheduler: () => {
      calls.push("install-scheduler");
      return { installed: true, loaded: true };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/automation/install");

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /还没有启用的微信群配置/);
  assert.deepEqual(calls, []);
});

test("wechat collector API can run the visible collector once by explicit request", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: true,
      interval_minutes: 15,
    }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    requirementCenterStatus: async () => ({ apiBase: "http://127.0.0.1:8765", available: true, detail: "ok" }),
    runCollectorOnce: async (options) => {
      calls.push(options);
      return {
        ok: true,
        status: {
          startedAt: "2026-06-25T08:00:00.000Z",
          finishedAt: "2026-06-25T08:00:05.000Z",
          groups: [{ groupName: "AI赋能运营自动化小组", status: "pushed", requestId: "wechat-ai-ops" }],
        },
      };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/run-once");

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.run.status.groups[0].status, "pushed");
  assert.equal(calls[0].configPath, configPath);
  assert.equal(calls[0].statusPath, statusPath);
});

test("wechat collector run-once bypasses group intervals", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: true,
      interval_minutes: 15,
    }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    nodePath: "node",
    requirementCenterStatus: async () => ({ apiBase: "http://127.0.0.1:8765", available: true, detail: "ok" }),
    execFileImpl: async (command, args) => {
      calls.push({ command, args });
      writeFileSync(statusPath, JSON.stringify({
        startedAt: "2026-06-25T08:00:00.000Z",
        finishedAt: "2026-06-25T08:00:05.000Z",
        groups: [{ groupName: "AI赋能运营自动化小组", status: "pushed" }],
      }));
      return { stdout: "", stderr: "" };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/run-once");

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.run.ok, true);
  assert.ok(calls[0].args.includes("--force"));
  assert.ok(calls[0].args.includes("--captureMode"));
  assert.ok(calls[0].args.includes("ocr"));
});

test("wechat collector run-once rejects when requirement center is unavailable before activating WeChat", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: true,
      interval_minutes: 15,
    }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath: path.join(dir, "wechat-last-run.json"),
    requirementCenterStatus: async () => ({
      apiBase: "http://127.0.0.1:8765",
      available: false,
      detail: "connect ECONNREFUSED 127.0.0.1:8765",
    }),
    runCollectorOnce: async () => {
      calls.push("called");
      return { ok: true, status: { groups: [] } };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/run-once");

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /需求中心不可用/);
  assert.match(result.body.error, /ECONNREFUSED/);
  assert.deepEqual(calls, []);
});

test("wechat collector run-once rejects when no enabled groups are configured before activating WeChat", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: false,
      interval_minutes: 15,
    }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath: path.join(dir, "wechat-last-run.json"),
    execFileImpl: async () => {
      calls.push("called");
      return { stdout: "", stderr: "" };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/run-once");

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /还没有启用的微信群配置/);
  assert.deepEqual(calls, []);
});

test("wechat collector run-once rejects invalid runtime config before activating WeChat", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [
      { group_name: "AI赋能运营自动化小组", enabled: true, interval_minutes: 15 },
      { group_name: "AI赋能运营自动化小组", enabled: true, interval_minutes: 30 },
    ],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath: path.join(dir, "wechat-last-run.json"),
    execFileImpl: async () => {
      calls.push("called");
      return { stdout: "", stderr: "" };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/run-once");

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /微信群名称重复/);
  assert.deepEqual(calls, []);
});

test("wechat collector run-once can target one configured group", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      project_name: "易考自动化需求",
      enabled: true,
      interval_minutes: 15,
    }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    nodePath: "node",
    requirementCenterStatus: async () => ({ apiBase: "http://127.0.0.1:8765", available: true, detail: "ok" }),
    execFileImpl: async (command, args) => {
      calls.push({ command, args });
      writeFileSync(statusPath, JSON.stringify({
        startedAt: "2026-06-25T08:00:00.000Z",
        finishedAt: "2026-06-25T08:00:05.000Z",
        groups: [{ groupName: "AI赋能运营自动化小组", status: "pushed" }],
      }));
      return { stdout: "", stderr: "" };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/run-once", {
    groupName: "AI赋能运营自动化小组",
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.run.ok, true);
  assert.ok(calls[0].args.includes("--group"));
  assert.equal(calls[0].args[calls[0].args.indexOf("--group") + 1], "AI赋能运营自动化小组");
  assert.ok(calls[0].args.includes("--push"));
  assert.ok(calls[0].args.includes("--force"));
});

test("wechat collector run-once rejects an unknown target group before activating WeChat", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: true,
      interval_minutes: 15,
    }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath: path.join(dir, "wechat-last-run.json"),
    execFileImpl: async () => {
      calls.push("called");
      return { stdout: "", stderr: "" };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/run-once", {
    groupName: "不存在的客户群",
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /未配置微信群/);
  assert.deepEqual(calls, []);
});

test("wechat collector run-once rejects a disabled target group before activating WeChat", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: false,
      interval_minutes: 15,
    }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath: path.join(dir, "wechat-last-run.json"),
    execFileImpl: async () => {
      calls.push("called");
      return { stdout: "", stderr: "" };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/run-once", {
    groupName: "AI赋能运营自动化小组",
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /微信群已停用/);
  assert.deepEqual(calls, []);
});

test("wechat collector API can dry-run the visible collector without pushing", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const preflightStatusPath = path.join(dir, "wechat-preflight-run.json");
  const calls = [];
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T07:00:00.000Z",
    finishedAt: "2026-06-25T07:00:05.000Z",
    groups: [{ groupName: "AI赋能运营自动化小组", status: "pushed" }],
  }));
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: true,
      interval_minutes: 15,
    }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    preflightStatusPath,
    nodePath: "node",
    execFileImpl: async (command, args) => {
      calls.push({ command, args });
      const outputIndex = args.indexOf("--output");
      writeFileSync(args[outputIndex + 1], JSON.stringify({
        startedAt: "2026-06-25T08:00:00.000Z",
        finishedAt: "2026-06-25T08:00:05.000Z",
        groups: [{
          groupName: "AI赋能运营自动化小组",
          status: "dry_run",
          captureMode: "ocr",
          screenshotPath: ".easy_exam_runtime/wechat-screenshots/AI赋能运营自动化小组.png",
        }],
      }));
      return { stdout: "", stderr: "" };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/dry-run");

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.run.ok, true);
  assert.equal(result.body.run.status.groups[0].status, "dry_run");
  assert.ok(calls[0].args.includes("--dry-run"));
  assert.ok(calls[0].args.includes("--check-window"));
  assert.ok(calls[0].args.includes("--force"));
  assert.ok(calls[0].args.includes("--captureMode"));
  assert.ok(calls[0].args.includes("ocr"));
  assert.equal(calls[0].args.includes("--push"), false);
  assert.equal(calls[0].args[calls[0].args.indexOf("--output") + 1], preflightStatusPath);
  assert.equal(JSON.parse(readFileSync(statusPath, "utf8")).groups[0].status, "pushed");
  assert.equal(JSON.parse(readFileSync(preflightStatusPath, "utf8")).groups[0].status, "dry_run");
});

test("wechat collector API rejects dry-run when runtime config is invalid", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const calls = [];
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      enabled: true,
      interval_minutes: 0,
    }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath: path.join(dir, "wechat-last-run.json"),
    preflightStatusPath: path.join(dir, "wechat-preflight-run.json"),
    execFileImpl: async () => {
      calls.push("called");
      return { stdout: "", stderr: "" };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/dry-run");

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /采集间隔必须是正整数/);
  assert.deepEqual(calls, []);
});

test("wechat collector status includes the latest preflight run separately from formal runs", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const preflightStatusPath = path.join(dir, "wechat-preflight-run.json");
  writeFileSync(statusPath, JSON.stringify({
    startedAt: "2026-06-25T07:00:00.000Z",
    finishedAt: "2026-06-25T07:00:05.000Z",
    groups: [{ groupName: "AI赋能运营自动化小组", status: "pushed" }],
  }));
  writeFileSync(preflightStatusPath, JSON.stringify({
    startedAt: "2026-06-25T08:00:00.000Z",
    finishedAt: "2026-06-25T08:00:05.000Z",
    groups: [{
      groupName: "AI赋能运营自动化小组",
      status: "dry_run",
      captureMode: "ocr",
      screenshotPath: ".easy_exam_runtime/wechat-screenshots/AI赋能运营自动化小组.png",
    }],
  }));
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    preflightStatusPath,
  });

  const result = await call(handler, "GET", "/api/wechat-collector/status");

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status.groups[0].status, "pushed");
  assert.equal(result.body.preflight.groups[0].status, "dry_run");
  assert.equal(result.body.preflight.groups[0].captureMode, "ocr");
  assert.equal(result.body.preflightPath, preflightStatusPath);
});

test("wechat collector API scans downloaded attachments read-only on request", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const attachmentScanStatusPath = path.join(dir, "wechat-attachment-scan.json");
  const handler = createWechatCollectorHandler({
    configPath: path.join(dir, "wechat-requirement-groups.json"),
    statusPath: path.join(dir, "wechat-last-run.json"),
    attachmentScanStatusPath,
    scanAttachments: ({ roots, maxFiles, previewChars, modifiedSince }) => ({
      scannedAt: "2026-06-25T09:00:00.000Z",
      roots: roots.map((root) => ({ path: root, exists: true })),
      files: [{
        path: path.join(roots[0], "客户说明.txt"),
        name: "客户说明.txt",
        kind: "text",
        extension: ".txt",
        sizeBytes: 42,
        modifiedAt: "2026-06-25T08:00:00.000Z",
        preview: `max=${maxFiles}; preview=${previewChars}; since=${modifiedSince}; 正式考试 7 月 1 日`,
      }],
    }),
  });

  const result = await call(
    handler,
    "GET",
    "/api/wechat-collector/attachments/scan?root=/tmp/wechat-files&maxFiles=3&previewChars=80&modifiedSince=2026-06-24T00%3A00%3A00.000Z",
  );

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.scan.roots[0].path, "/tmp/wechat-files");
  assert.equal(result.body.scan.files[0].name, "客户说明.txt");
  assert.match(result.body.scan.files[0].preview, /max=3; preview=80; since=2026-06-24T00:00:00.000Z/);

  const summary = JSON.parse(readFileSync(attachmentScanStatusPath, "utf8"));
  assert.deepEqual(summary, {
    scannedAt: "2026-06-25T09:00:00.000Z",
    rootCount: 1,
    accessibleRootCount: 1,
    fileCount: 1,
    byType: { text: 1 },
    params: {
      rootCount: 1,
      maxFiles: 3,
      previewChars: 80,
      modifiedSince: "2026-06-24T00:00:00.000Z",
    },
  });
  assert.equal(JSON.stringify(summary).includes("客户说明.txt"), false);

  const status = await call(handler, "GET", "/api/wechat-collector/status");
  assert.deepEqual(status.body.attachmentScan, summary);
});

test("wechat collector API records expanded attachment root count in scan params", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const attachmentScanStatusPath = path.join(dir, "wechat-attachment-scan.json");
  const handler = createWechatCollectorHandler({
    configPath: path.join(dir, "wechat-requirement-groups.json"),
    statusPath: path.join(dir, "wechat-last-run.json"),
    attachmentScanStatusPath,
    scanAttachments: () => ({
      scannedAt: "2026-06-25T09:00:00.000Z",
      roots: [
        { path: "/Users/ata/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/Backup/msg/file", exists: false },
        { path: "/Users/ata/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/all_users/msg/file", exists: false },
        { path: "/Users/ata/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/zhanglexiang_0a18/msg/file", exists: true },
      ],
      files: [],
    }),
  });

  const result = await call(handler, "GET", "/api/wechat-collector/attachments/scan?maxFiles=20&previewChars=220");

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.summary.rootCount, 3);
  assert.equal(result.body.summary.params.rootCount, 3);
  assert.equal(result.body.summary.accessibleRootCount, 1);
  assert.equal(JSON.parse(readFileSync(attachmentScanStatusPath, "utf8")).params.rootCount, 3);
});

test("wechat collector API rejects invalid attachment scan limits before scanning", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const calls = [];
  const handler = createWechatCollectorHandler({
    configPath: path.join(dir, "wechat-requirement-groups.json"),
    statusPath: path.join(dir, "wechat-last-run.json"),
    attachmentScanStatusPath: path.join(dir, "wechat-attachment-scan.json"),
    scanAttachments: (options) => {
      calls.push(options);
      return { scannedAt: "", roots: [], files: [] };
    },
  });

  for (const query of [
    "maxFiles=abc",
    "maxFiles=0",
    "maxFiles=1.5",
    "maxFiles=501",
    "previewChars=abc",
    "previewChars=-1",
    "previewChars=1.5",
    "previewChars=5001",
  ]) {
    const result = await call(handler, "GET", `/api/wechat-collector/attachments/scan?${query}`);
    assert.equal(result.statusCode, 400, query);
    assert.match(result.body.error, /附件扫描参数无效/, query);
  }

  assert.deepEqual(calls, []);
});

test("wechat collector API can run a safe pipeline smoke test on request", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const pipelineSmokeStatusPath = path.join(dir, "wechat-pipeline-smoke.json");
  const calls = [];
  const handler = createWechatCollectorHandler({
    configPath: path.join(dir, "wechat-requirement-groups.json"),
    statusPath: path.join(dir, "wechat-last-run.json"),
    pipelineSmokeStatusPath,
    runPipelineSmokeTest: async () => {
      calls.push("smoke");
      return {
        ok: true,
        requestId: "wechat-smoke-test",
        requirement: {
          latest: { requirement: { exam_name: "2026 校招笔试" } },
          changeRequests: [{ status: "pending_internal_review" }],
        },
      };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/pipeline-smoke-test");

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.result.requestId, "wechat-smoke-test");
  assert.match(result.body.result.finishedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.body.result.requirement.changeRequests[0].status, "pending_internal_review");
  assert.deepEqual(calls, ["smoke"]);
  assert.equal(JSON.parse(readFileSync(pipelineSmokeStatusPath, "utf8")).ok, true);
  assert.match(JSON.parse(readFileSync(pipelineSmokeStatusPath, "utf8")).finishedAt, /^\d{4}-\d{2}-\d{2}T/);

  const status = await call(handler, "GET", "/api/wechat-collector/status");
  assert.equal(status.body.pipelineSmoke.ok, true);
  assert.equal(status.body.pipelineSmoke.requestId, "wechat-smoke-test");
  assert.equal(status.body.pipelineSmokePath, pipelineSmokeStatusPath);
});

test("wechat collector API returns failure when pipeline smoke test reports not ok", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const pipelineSmokeStatusPath = path.join(dir, "wechat-pipeline-smoke.json");
  const handler = createWechatCollectorHandler({
    configPath: path.join(dir, "wechat-requirement-groups.json"),
    statusPath: path.join(dir, "wechat-last-run.json"),
    pipelineSmokeStatusPath,
    runPipelineSmokeTest: async () => ({
      ok: false,
      requestId: "wechat-smoke-test",
      error: "change request was not created",
    }),
  });

  const result = await call(handler, "POST", "/api/wechat-collector/pipeline-smoke-test");

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 500);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.result.ok, false);
  assert.equal(result.body.result.error, "change request was not created");
  assert.equal(JSON.parse(readFileSync(pipelineSmokeStatusPath, "utf8")).ok, false);

  const status = await call(handler, "GET", "/api/wechat-collector/status");
  assert.equal(status.body.pipelineSmoke.ok, false);
  assert.equal(status.body.readiness.checks.find((item) => item.key === "pipeline_smoke").ok, false);
});

test("wechat collector API persists pipeline smoke test exceptions as failed status", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const pipelineSmokeStatusPath = path.join(dir, "wechat-pipeline-smoke.json");
  const handler = createWechatCollectorHandler({
    configPath: path.join(dir, "wechat-requirement-groups.json"),
    statusPath: path.join(dir, "wechat-last-run.json"),
    pipelineSmokeStatusPath,
    runPipelineSmokeTest: async () => {
      throw new Error("temporary service failed to start");
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/pipeline-smoke-test");

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 500);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.result.ok, false);
  assert.equal(result.body.result.error, "temporary service failed to start");
  assert.match(result.body.result.finishedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.parse(readFileSync(pipelineSmokeStatusPath, "utf8")).error, "temporary service failed to start");
});

test("wechat collector API writes normalized runtime config", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const configBackupDir = path.join(dir, "config-backups");
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "旧客户项目群",
      project_name: "旧项目",
      customer_name: "旧客户",
      requirement_request_id: "old-request",
      enabled: true,
      interval_minutes: 15,
    }],
  }));
  const handler = createWechatCollectorHandler({ configPath, statusPath, configBackupDir });

  const result = await call(handler, "PUT", "/api/wechat-collector/config", {
    groups: [
      {
        groupName: "某客户考试项目群",
        projectName: "某客户校招考试",
        customerName: "某客户",
        requirementRequestId: "customer-campus-2026",
        enabled: false,
        intervalMinutes: 30,
      },
    ],
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 200);
  assert.match(result.body.backupPath, /config-backups/);
  assert.equal(result.body.config.groups[0].group_name, "某客户考试项目群");
  assert.equal(result.body.config.groups[0].enabled, false);
  const backup = JSON.parse(readFileSync(result.body.backupPath, "utf8"));
  assert.equal(backup.groups[0].group_name, "旧客户项目群");
  assert.equal(backup.groups[0].requirement_request_id, "old-request");
  const saved = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(saved.groups[0].project_name, "某客户校招考试");
  assert.equal(saved.groups[0].interval_minutes, 30);
});

test("wechat collector API drops legacy cc-connect group fields", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const handler = createWechatCollectorHandler({ configPath, statusPath });

  const result = await call(handler, "PUT", "/api/wechat-collector/config", {
    groups: [{
      groupName: "客户项目群",
      projectName: "客户考试项目",
      customerName: "客户",
      requirementRequestId: "customer-exam",
      enabled: true,
      intervalMinutes: 15,
      initialCollectionMode: "ocr_current_window",
      incrementalSource: "cc_connect",
      ccConnectEnabled: true,
      ccConnectChatId: "1234567890@chatroom",
      initialCollectedAt: "2026-06-30T08:00:00.000Z",
      incrementalStartedAt: "2026-06-30T08:05:00.000Z",
    }],
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.config.groups[0].incremental_source, undefined);
  assert.equal(result.body.config.groups[0].cc_connect_enabled, undefined);
  assert.equal(result.body.config.groups[0].cc_connect_chat_id, undefined);
  const saved = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(saved.groups[0].initial_collection_mode, "ocr_current_window");
  assert.equal(saved.groups[0].incremental_started_at, undefined);
});

test("wechat collector API saves and redacts LLM parser config", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const configBackupDir = path.join(dir, "config-backups");
  const handler = createWechatCollectorHandler({ configPath, statusPath, configBackupDir });

  const saved = await call(handler, "PUT", "/api/wechat-collector/config", {
    groups: [{ groupName: "AI赋能运营自动化小组", enabled: true, intervalMinutes: 15 }],
    llmParse: {
      enabled: true,
      provider: "qwen",
      model: "qwen-plus",
      endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      apiKey: "qwen-secret",
    },
  });
  const fetched = await call(handler, "GET", "/api/wechat-collector/config");

  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.config.llm_parse.enabled, true);
  assert.equal(saved.body.config.llm_parse.provider, "qwen");
  assert.equal(saved.body.config.llm_parse.apiKeyConfigured, true);
  assert.equal(saved.body.config.llm_parse.api_key, undefined);
  assert.equal(fetched.body.config.llm_parse.apiKeyConfigured, true);
  assert.equal(fetched.body.config.llm_parse.api_key, undefined);
  const raw = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(raw.llm_parse.api_key, "qwen-secret");

  const retained = await call(handler, "PUT", "/api/wechat-collector/config", {
    groups: [{ groupName: "AI赋能运营自动化小组", enabled: true, intervalMinutes: 15 }],
    llmParse: {
      enabled: true,
      provider: "openai",
      model: "gpt-4.1-mini",
      endpoint: "https://api.openai.com/v1/responses",
    },
  });
  assert.equal(retained.statusCode, 200);
  assert.equal(JSON.parse(readFileSync(configPath, "utf8")).llm_parse.api_key, "qwen-secret");

  const cleared = await call(handler, "PUT", "/api/wechat-collector/config", {
    groups: [{ groupName: "AI赋能运营自动化小组", enabled: true, intervalMinutes: 15 }],
    llmParse: { enabled: false, provider: "openai", clearApiKey: true },
  });
  assert.equal(cleared.statusCode, 200);
  assert.equal(JSON.parse(readFileSync(configPath, "utf8")).llm_parse.api_key, "");
});

test("wechat collector API validates LLM key and lists models", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true, interval_minutes: 15 }],
    llm_parse: {
      enabled: true,
      provider: "qwen",
      model: "qwen-plus",
      endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      api_key: "saved-key",
    },
  }));
  const calls = [];
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ id: "qwen-plus" }, { id: "qwen-max" }] }),
      };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/llm/models", {
    llmParse: {
      provider: "qwen",
      endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    },
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.models, ["qwen-plus", "qwen-max"]);
  assert.equal(calls[0].url, "https://dashscope.aliyuncs.com/compatible-mode/v1/models");
  assert.equal(calls[0].options.headers.Authorization, "Bearer saved-key");
});

test("wechat collector API removes whitespace from LLM key before validation", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true, interval_minutes: 15 }],
    llm_parse: {
      enabled: true,
      provider: "qwen",
      endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      api_key: " saved-\nkey ",
    },
  }));
  const calls = [];
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ id: "qwen-plus" }] }),
      };
    },
  });

  const result = await call(handler, "POST", "/api/wechat-collector/llm/models", {
    llmParse: { provider: "qwen" },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(calls[0].options.headers.Authorization, "Bearer saved-key");
});

test("wechat collector API restores runtime config from a backup safely", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const statusPath = path.join(dir, "wechat-last-run.json");
  const configBackupDir = path.join(dir, "config-backups");
  mkdirSync(configBackupDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "当前客户项目群",
      project_name: "当前项目",
      requirement_request_id: "current-request",
      enabled: true,
      interval_minutes: 15,
    }],
  }));
  const backupFileName = "20260627T010000Z-wechat-requirement-groups.json";
  writeFileSync(path.join(configBackupDir, backupFileName), JSON.stringify({
    groups: [{
      group_name: "恢复客户项目群",
      project_name: "恢复项目",
      requirement_request_id: "restored-request",
      enabled: false,
      interval_minutes: 30,
    }],
  }));
  const handler = createWechatCollectorHandler({ configPath, statusPath, configBackupDir });

  const result = await call(handler, "POST", "/api/wechat-collector/config/restore", { fileName: backupFileName });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.config.groups[0].group_name, "恢复客户项目群");
  assert.equal(result.body.config.groups[0].enabled, false);
  assert.match(result.body.currentBackupPath, /config-backups/);
  const currentBackup = JSON.parse(readFileSync(result.body.currentBackupPath, "utf8"));
  assert.equal(currentBackup.groups[0].group_name, "当前客户项目群");
  const restored = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(restored.groups[0].requirement_request_id, "restored-request");

  const rejected = await call(handler, "POST", "/api/wechat-collector/config/restore", { fileName: "../outside.json" });
  assert.equal(rejected.statusCode, 400);
  assert.match(rejected.body.error, /备份文件名不合法/);

  const missing = await call(handler, "POST", "/api/wechat-collector/config/restore", { fileName: "missing.json" });
  assert.equal(missing.statusCode, 404);
  assert.match(missing.body.error, /备份文件不存在/);

  const invalidFileName = "20260627T020000Z-wechat-requirement-groups.json";
  writeFileSync(path.join(configBackupDir, invalidFileName), "{not json");
  const invalid = await call(handler, "POST", "/api/wechat-collector/config/restore", { fileName: invalidFileName });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body.error, /合法 JSON/);
});

test("wechat collector API rejects duplicate group names", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  const handler = createWechatCollectorHandler({
    configPath,
    statusPath: path.join(dir, "wechat-last-run.json"),
  });

  const result = await call(handler, "PUT", "/api/wechat-collector/config", {
    groups: [
      { groupName: "AI赋能运营自动化小组", projectName: "项目 A" },
      { group_name: "AI赋能运营自动化小组", project_name: "项目 B" },
    ],
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 400);
  assert.match(result.body.error, /微信群名称重复/);
});

test("wechat collector API rejects invalid group intervals", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wechat-api-"));
  const handler = createWechatCollectorHandler({
    configPath: path.join(dir, "wechat-requirement-groups.json"),
    statusPath: path.join(dir, "wechat-last-run.json"),
  });

  for (const intervalMinutes of [0, "abc", 1.5]) {
    const result = await call(handler, "PUT", "/api/wechat-collector/config", {
      groups: [{ groupName: "AI赋能运营自动化小组", intervalMinutes }],
    });

    assert.equal(result.handled, true);
    assert.equal(result.statusCode, 400);
    assert.match(result.body.error, /采集间隔必须是正整数/);
  }
});
