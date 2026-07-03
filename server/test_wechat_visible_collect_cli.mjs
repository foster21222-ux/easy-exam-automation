import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const nodeBin = "/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node";
const repoRoot = path.resolve(import.meta.dirname, "..");

test("visible WeChat collector defaults attachment cutoff to the group checkpoint update time", async () => {
  const moduleUrl = new URL("../scripts/wechat_visible_collect.mjs", import.meta.url);
  const { resolveAttachmentModifiedSince } = await import(moduleUrl.href);

  assert.equal(
    resolveAttachmentModifiedSince({}, { updatedAt: "2026-06-24T08:00:00.000Z" }),
    "2026-06-24T08:00:00.000Z",
  );
  assert.equal(
    resolveAttachmentModifiedSince({ attachmentModifiedSince: "2026-06-25T08:00:00.000Z" }, { updatedAt: "2026-06-24T08:00:00.000Z" }),
    "2026-06-25T08:00:00.000Z",
  );
  assert.equal(resolveAttachmentModifiedSince({}, {}), "");
});

test("visible WeChat collector associates only downloaded files named in the current chat text", async () => {
  const moduleUrl = new URL("../scripts/wechat_visible_collect.mjs", import.meta.url);
  const { matchAttachmentsToVisibleText } = await import(moduleUrl.href);
  const attachments = [
    { name: "考试名单.xlsx", path: "/wechat/msg/file/考试名单.xlsx" },
    { name: "其他项目说明.docx", path: "/wechat/msg/file/其他项目说明.docx" },
  ];

  const matched = matchAttachmentsToVisibleText(
    attachments,
    "客户：文件已发，请看 考试名单 . XLSX，确认后回复。",
  );

  assert.deepEqual(matched.map((file) => file.name), ["考试名单.xlsx"]);
  assert.deepEqual(matchAttachmentsToVisibleText(attachments, "客户：文件稍后补充。"), []);
});

test("visible WeChat collector crops the WeChat window to the chat transcript region", async () => {
  const moduleUrl = new URL("../scripts/wechat_visible_collect.mjs", import.meta.url);
  const { buildChatCaptureRect } = await import(moduleUrl.href);

  assert.equal(buildChatCaptureRect("529,48,1200,860"), "849,104,880,624");
  assert.equal(buildChatCaptureRect("529,48,1200,860", {
    leftInset: 300,
    topInset: 60,
    rightInset: 20,
    bottomInset: 200,
  }), "829,108,880,600");
  assert.throws(
    () => buildChatCaptureRect("0,0,500,400", { leftInset: 400, bottomInset: 250 }),
    /聊天正文截图区域过小/,
  );
});

test("visible WeChat collector uses window-service identity and verifies the target conversation", async () => {
  const moduleUrl = new URL("../scripts/wechat_visible_collect.mjs", import.meta.url);
  const {
    assertWechatConversationTitle,
    buildOpenWechatGroupScript,
    parseWechatWindowInfo,
  } = await import(moduleUrl.href);

  assert.deepEqual(parseWechatWindowInfo("1903,918,72,1200,860"), {
    windowId: 1903,
    x: 918,
    y: 72,
    width: 1200,
    height: 860,
  });
  assert.doesNotThrow(() => assertWechatConversationTitle(
    "AI赋能运营自动化小组（3）\n昨天 20:47\n考试时间改到 7-1",
    "AI赋能运营自动化小组",
  ));
  assert.throws(
    () => assertWechatConversationTitle("文件传输助手\n昨天 21:28", "AI赋能运营自动化小组"),
    /当前微信会话不是目标群/,
  );
  const script = buildOpenWechatGroupScript("AI赋能运营自动化小组", {
    windowHelper: "/repo/scripts/wechat_window.swift",
  });
  assert.match(script, /wechat_window\.swift' open-group/);
  assert.doesNotMatch(script, /keystroke "f" using/);
  assert.doesNotMatch(script, /System Events/);
});

test("visible WeChat collector builds a window-id screenshot and relative crop plan", async () => {
  const moduleUrl = new URL("../scripts/wechat_visible_collect.mjs", import.meta.url);
  const { buildWechatWindowCapturePlan } = await import(moduleUrl.href);

  assert.deepEqual(buildWechatWindowCapturePlan({
    windowId: 1903,
    width: 1200,
    height: 860,
  }, {
    leftInset: 320,
    topInset: 56,
    rightInset: 0,
    bottomInset: 180,
  }), {
    captureRect: "320,56,880,624",
    screenshotArgs: ["-x", "-o", "-l1903"],
    cropArgs: ["-c", "624", "880", "--cropOffset", "56", "320"],
  });
});

test("visible WeChat collector rejects an empty raw capture instead of treating it as no new messages", async () => {
  const moduleUrl = new URL("../scripts/wechat_visible_collect.mjs", import.meta.url);
  const { assertCapturedTextUsable } = await import(moduleUrl.href);

  assert.equal(assertCapturedTextUsable("客户：考试时间改到 10 点。", { captureMode: "ocr" }), "客户：考试时间改到 10 点。");
  assert.throws(() => assertCapturedTextUsable("  \n\t", { captureMode: "ocr" }), /OCR 未识别到任何聊天文字/);
  assert.throws(() => assertCapturedTextUsable("", { captureMode: "clipboard" }), /未读取到任何聊天文字/);
});

test("visible WeChat collector rejects OCR text with no requirement signal", async () => {
  const moduleUrl = new URL("../scripts/wechat_visible_collect.mjs", import.meta.url);
  const { assertDraftHasRequirementSignal } = await import(moduleUrl.href);

  assert.doesNotThrow(() => assertDraftHasRequirementSignal({
    requirement: { exam_name: "AI 运营考试" },
    changeRecords: [],
  }));
  assert.doesNotThrow(() => assertDraftHasRequirementSignal({
    requirement: {},
    changeRecords: [{ type: "subject_change" }],
  }));
  for (const requirement of [{}, {
    exam_name: undefined,
    subjects: [],
    formal_exam_time_range: "",
  }]) {
    assert.throws(() => {
      try {
        assertDraftHasRequirementSignal({ requirement, changeRecords: [] });
      } catch (error) {
        assert.equal(error.code, "NO_REQUIREMENT_SIGNAL");
        throw error;
      }
    }, /未识别到需求字段或需求变更/);
  }
});

test("visible WeChat collector accepts LLM candidates as a requirement signal", async () => {
  const moduleUrl = new URL("../scripts/wechat_visible_collect.mjs", import.meta.url);
  const { assertDraftHasRequirementSignal, buildLlmParserConfig } = await import(moduleUrl.href);

  assert.doesNotThrow(() => assertDraftHasRequirementSignal({
    requirement: {},
    changeRecords: [],
    analysisCandidates: {
      requirementCandidates: {
        subjects: { value: ["数学"], evidence: ["客户：科目增加数学"], confidence: 0.9 },
      },
    },
  }));
  assert.deepEqual(buildLlmParserConfig({
    llmParse: "candidate",
    llmModel: "test-model",
    llmEndpoint: "https://llm.example/v1/responses",
  }, { OPENAI_API_KEY: "secret" }), {
    enabled: true,
    provider: "openai",
    model: "test-model",
    endpoint: "https://llm.example/v1/responses",
    apiKey: "secret",
  });
  assert.deepEqual(buildLlmParserConfig({}, {}, {
    llm_parse: {
      enabled: true,
      provider: "qwen",
      model: "qwen-plus",
      endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      api_key: "qwen-secret",
    },
  }), {
    enabled: true,
    provider: "qwen",
    model: "qwen-plus",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    apiKey: "qwen-secret",
  });
  assert.equal(buildLlmParserConfig({}, {}).enabled, false);
});

test("visible WeChat collector keeps the previous checkpoint when there are no new messages", async () => {
  const moduleUrl = new URL("../scripts/wechat_visible_collect.mjs", import.meta.url);
  const { buildStateUpdateForRun } = await import(moduleUrl.href);

  const update = buildStateUpdateForRun({
    draft: { checkpoint: { messageCount: 0, lastMessageHash: "empty-hash" } },
    pushResult: { skipped: "no_new_messages", requestId: "wechat-ai-ops" },
    requestId: "wechat-ai-ops",
  });

  assert.deepEqual(update, { requestId: "wechat-ai-ops" });
});

test("visible WeChat collector trims run history to the configured maximum", async () => {
  const moduleUrl = new URL("../scripts/wechat_visible_collect.mjs", import.meta.url);
  const { appendRunHistory } = await import(moduleUrl.href);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wechat-visible-cli-"));
  const historyPath = path.join(tempDir, "wechat-run-history.jsonl");

  appendRunHistory(historyPath, { finishedAt: "2026-06-25T08:00:00.000Z", groups: [{ status: "failed" }] }, { maxEntries: 2 });
  appendRunHistory(historyPath, { finishedAt: "2026-06-25T08:15:00.000Z", groups: [{ status: "pushed" }] }, { maxEntries: 2 });
  appendRunHistory(historyPath, { finishedAt: "2026-06-25T08:30:00.000Z", groups: [{ status: "no_new_messages" }] }, { maxEntries: 2 });

  const history = readFileSync(historyPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(history.length, 2);
  assert.equal(history[0].groups[0].status, "pushed");
  assert.equal(history[1].groups[0].status, "no_new_messages");
});

test("visible WeChat collector writes scheduler-safe dry-run output", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wechat-visible-cli-"));
  const configPath = path.join(tempDir, "groups.json");
  const outputPath = path.join(tempDir, "last-run.json");
  const historyPath = path.join(tempDir, "wechat-run-history.jsonl");
  writeFileSync(configPath, JSON.stringify({
    groups: [
      {
        group_name: "AI赋能运营自动化小组",
        project_name: "易考自动化需求",
        customer_name: "内部测试客户",
        requirement_request_id: "wechat-ai-ops",
        enabled: true,
      },
    ],
  }));

  execFileSync(nodeBin, [
    "scripts/wechat_visible_collect.mjs",
    "--config", configPath,
    "--group", "AI赋能运营自动化小组",
    "--dry-run",
    "--push",
    "--api", "http://127.0.0.1:8765",
    "--output", outputPath,
    "--history", historyPath,
  ], { cwd: repoRoot, encoding: "utf8" });

  const summary = JSON.parse(readFileSync(outputPath, "utf8"));
  const history = readFileSync(historyPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.match(summary.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(summary.finishedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(summary.groups.length, 1);
  assert.equal(summary.groups[0].groupName, "AI赋能运营自动化小组");
  assert.equal(summary.groups[0].status, "dry_run");
  assert.equal(summary.groups[0].requestId, "wechat-ai-ops");
  assert.equal(summary.groups[0].messageCount, 0);
  assert.equal(summary.groups[0].changeCount, 0);
  assert.match(summary.groups[0].appleScript, /tell application "WeChat" to activate/);
  assert.equal(history.length, 1);
  assert.equal(history[0].groups[0].status, "dry_run");
});

test("visible WeChat collector can dry-run OCR screenshot capture mode", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wechat-visible-cli-"));
  const configPath = path.join(tempDir, "groups.json");
  const outputPath = path.join(tempDir, "last-run.json");
  const screenshotPath = path.join(tempDir, "chat.png");
  writeFileSync(configPath, JSON.stringify({
    groups: [
      {
        group_name: "AI赋能运营自动化小组",
        project_name: "易考自动化需求",
        customer_name: "内部测试客户",
        requirement_request_id: "wechat-ai-ops",
        enabled: true,
      },
    ],
  }));

  execFileSync(nodeBin, [
    "scripts/wechat_visible_collect.mjs",
    "--config", configPath,
    "--group", "AI赋能运营自动化小组",
    "--dry-run",
    "--captureMode", "ocr",
    "--screenshotPath", screenshotPath,
    "--ocrTool", "scripts/ocr_image.swift",
    "--output", outputPath,
  ], { cwd: repoRoot, encoding: "utf8" });

  const summary = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(summary.groups[0].status, "dry_run");
  assert.equal(summary.groups[0].captureMode, "ocr");
  assert.equal(summary.groups[0].screenshotPath, screenshotPath);
  assert.match(summary.groups[0].ocrCommand, /ocr_image\.swift/);
  assert.match(summary.groups[0].appleScript, /wechat_window\.swift' open-group/);
  assert.doesNotMatch(summary.groups[0].appleScript, /System Events/);
});

test("visible WeChat collector preflight checks window geometry without capturing chat", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wechat-visible-cli-"));
  const binDir = path.join(tempDir, "bin");
  const configPath = path.join(tempDir, "groups.json");
  const outputPath = path.join(tempDir, "preflight.json");
  mkdirSync(binDir);
  writeFileSync(path.join(binDir, "osascript"), "#!/bin/sh\nprintf '529,48,1200,860\\n'\n");
  chmodSync(path.join(binDir, "osascript"), 0o755);
  writeFileSync(path.join(binDir, "swift"), "#!/bin/sh\nprintf '1903,918,72,1200,860\\n'\n");
  chmodSync(path.join(binDir, "swift"), 0o755);
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true }],
  }));

  execFileSync(nodeBin, [
    "scripts/wechat_visible_collect.mjs",
    "--config", configPath,
    "--group", "AI赋能运营自动化小组",
    "--dry-run",
    "--check-window",
    "--captureMode", "ocr",
    "--output", outputPath,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
  });

  const summary = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(summary.groups[0].status, "dry_run");
  assert.equal(summary.groups[0].captureRect, "320,56,880,624");
  assert.equal(existsSync(summary.groups[0].screenshotPath), false);
});

test("visible WeChat collector skips when another run holds the lock", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wechat-visible-cli-"));
  const configPath = path.join(tempDir, "groups.json");
  const outputPath = path.join(tempDir, "last-run.json");
  const historyPath = path.join(tempDir, "wechat-run-history.jsonl");
  const lockPath = path.join(tempDir, "wechat.lock");
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true }],
  }));
  writeFileSync(lockPath, "already running");

  assert.throws(() => execFileSync(nodeBin, [
    "scripts/wechat_visible_collect.mjs",
    "--config", configPath,
    "--group", "AI赋能运营自动化小组",
    "--dry-run",
    "--output", outputPath,
    "--lockPath", lockPath,
  ], { cwd: repoRoot, encoding: "utf8" }), /另一个微信群采集任务正在运行/);

  const summary = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(summary.status, "skipped");
  assert.equal(summary.error, "另一个微信群采集任务正在运行");
});

test("visible WeChat collector releases the lock after a dry run", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wechat-visible-cli-"));
  const configPath = path.join(tempDir, "groups.json");
  const outputPath = path.join(tempDir, "last-run.json");
  const lockPath = path.join(tempDir, "wechat.lock");
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true }],
  }));

  execFileSync(nodeBin, [
    "scripts/wechat_visible_collect.mjs",
    "--config", configPath,
    "--group", "AI赋能运营自动化小组",
    "--dry-run",
    "--output", outputPath,
    "--lockPath", lockPath,
  ], { cwd: repoRoot, encoding: "utf8" });

  assert.equal(existsSync(lockPath), false);
});

test("visible WeChat collector clears a stale lock and continues", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wechat-visible-cli-"));
  const configPath = path.join(tempDir, "groups.json");
  const outputPath = path.join(tempDir, "last-run.json");
  const lockPath = path.join(tempDir, "wechat.lock");
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true }],
  }));
  writeFileSync(lockPath, "stale run");
  const oldDate = new Date(Date.now() - 60_000);
  utimesSync(lockPath, oldDate, oldDate);

  execFileSync(nodeBin, [
    "scripts/wechat_visible_collect.mjs",
    "--config", configPath,
    "--group", "AI赋能运营自动化小组",
    "--dry-run",
    "--output", outputPath,
    "--lockPath", lockPath,
    "--lockMaxAgeMs", "1",
  ], { cwd: repoRoot, encoding: "utf8" });

  const summary = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(summary.groups[0].status, "dry_run");
  assert.equal(existsSync(lockPath), false);
});

test("visible WeChat collector skips a group before its interval elapses", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wechat-visible-cli-"));
  const configPath = path.join(tempDir, "groups.json");
  const statePath = path.join(tempDir, "state.json");
  const outputPath = path.join(tempDir, "last-run.json");
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true, interval_minutes: 30 }],
  }));
  writeFileSync(statePath, JSON.stringify({
    groups: {
      "AI赋能运营自动化小组": { updatedAt: new Date().toISOString() },
    },
  }));

  execFileSync(nodeBin, [
    "scripts/wechat_visible_collect.mjs",
    "--config", configPath,
    "--state", statePath,
    "--group", "AI赋能运营自动化小组",
    "--dry-run",
    "--output", outputPath,
  ], { cwd: repoRoot, encoding: "utf8" });

  const summary = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(summary.groups[0].status, "skipped_interval");
  assert.equal(summary.groups[0].messageCount, 0);
});

test("visible WeChat collector force-runs a group before its interval elapses", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wechat-visible-cli-"));
  const configPath = path.join(tempDir, "groups.json");
  const statePath = path.join(tempDir, "state.json");
  const outputPath = path.join(tempDir, "last-run.json");
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true, interval_minutes: 30 }],
  }));
  writeFileSync(statePath, JSON.stringify({
    groups: {
      "AI赋能运营自动化小组": { updatedAt: new Date().toISOString() },
    },
  }));

  execFileSync(nodeBin, [
    "scripts/wechat_visible_collect.mjs",
    "--config", configPath,
    "--state", statePath,
    "--group", "AI赋能运营自动化小组",
    "--dry-run",
    "--force",
    "--output", outputPath,
  ], { cwd: repoRoot, encoding: "utf8" });

  const summary = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(summary.groups[0].status, "dry_run");
  assert.match(summary.groups[0].appleScript, /tell application "WeChat" to activate/);
});

test("visible WeChat collector rejects invalid direct config before activating WeChat", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wechat-visible-cli-"));
  const binDir = path.join(tempDir, "bin");
  const configPath = path.join(tempDir, "groups.json");
  const outputPath = path.join(tempDir, "last-run.json");
  const historyPath = path.join(tempDir, "wechat-run-history.jsonl");
  const lockPath = path.join(tempDir, "wechat.lock");
  const osascriptMarker = path.join(tempDir, "osascript-called");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "AI赋能运营自动化小组", enabled: true, interval_minutes: 0 }],
  }));
  writeFileSync(path.join(binDir, "osascript"), `#!/bin/sh\nprintf called > "${osascriptMarker}"\nexit 0\n`, { mode: 0o755 });
  writeFileSync(path.join(binDir, "pbpaste"), "#!/bin/sh\nprintf '客户：考试名称是 2026 校招笔试。\\n'\n", { mode: 0o755 });

  assert.throws(() => execFileSync(nodeBin, [
    "scripts/wechat_visible_collect.mjs",
    "--config", configPath,
    "--group", "AI赋能运营自动化小组",
    "--output", outputPath,
    "--history", historyPath,
    "--lockPath", lockPath,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
  }), /采集间隔必须是正整数/);
  assert.equal(existsSync(osascriptMarker), false);
  const summary = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(summary.status, "failed");
  assert.match(summary.error, /采集间隔必须是正整数/);
  assert.deepEqual(summary.groups, []);
  const history = readFileSync(historyPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "failed");
  assert.match(history[0].error, /采集间隔必须是正整数/);
});

test("visible WeChat collector rejects a disabled target group before activating WeChat", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wechat-visible-cli-"));
  const binDir = path.join(tempDir, "bin");
  const configPath = path.join(tempDir, "groups.json");
  const outputPath = path.join(tempDir, "last-run.json");
  const lockPath = path.join(tempDir, "wechat.lock");
  const osascriptMarker = path.join(tempDir, "osascript-called");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    groups: [
      { group_name: "AI赋能运营自动化小组", enabled: false, interval_minutes: 15 },
      { group_name: "其他已启用群", enabled: true, interval_minutes: 15 },
    ],
  }));
  writeFileSync(path.join(binDir, "osascript"), `#!/bin/sh\nprintf called > "${osascriptMarker}"\nexit 0\n`, { mode: 0o755 });
  writeFileSync(path.join(binDir, "pbpaste"), "#!/bin/sh\nprintf '客户：考试名称是 2026 校招笔试。\\n'\n", { mode: 0o755 });

  assert.throws(() => execFileSync(nodeBin, [
    "scripts/wechat_visible_collect.mjs",
    "--config", configPath,
    "--group", "AI赋能运营自动化小组",
    "--output", outputPath,
    "--lockPath", lockPath,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
  }), /微信群已停用/);
  assert.equal(existsSync(osascriptMarker), false);
});

test("visible WeChat collector rejects an unknown target group before activating WeChat", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wechat-visible-cli-"));
  const binDir = path.join(tempDir, "bin");
  const configPath = path.join(tempDir, "groups.json");
  const outputPath = path.join(tempDir, "last-run.json");
  const historyPath = path.join(tempDir, "wechat-run-history.jsonl");
  const lockPath = path.join(tempDir, "wechat.lock");
  const osascriptMarker = path.join(tempDir, "osascript-called");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "其他已启用群", enabled: true, interval_minutes: 15 }],
  }));
  writeFileSync(path.join(binDir, "osascript"), `#!/bin/sh\nprintf called > "${osascriptMarker}"\nexit 0\n`, { mode: 0o755 });

  assert.throws(() => execFileSync(nodeBin, [
    "scripts/wechat_visible_collect.mjs",
    "--config", configPath,
    "--group", "AI赋能运营自动化小组",
    "--output", outputPath,
    "--history", historyPath,
    "--lockPath", lockPath,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
  }), /未配置微信群/);
  assert.equal(existsSync(osascriptMarker), false);
  const summary = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(summary.status, "failed");
  assert.match(summary.error, /未配置微信群/);
  const history = readFileSync(historyPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(history[0].status, "failed");
  assert.match(history[0].error, /未配置微信群/);
});

test("visible WeChat collector checks push API before activating WeChat", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wechat-visible-cli-"));
  const configPath = path.join(tempDir, "groups.json");
  const outputPath = path.join(tempDir, "last-run.json");
  const lockPath = path.join(tempDir, "wechat.lock");
  const binDir = path.join(tempDir, "bin");
  const osascriptMarker = path.join(tempDir, "osascript-called");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      project_name: "易考自动化需求",
      customer_name: "内部测试客户",
      requirement_request_id: "wechat-ai-ops",
      enabled: true,
    }],
  }));
  writeFileSync(path.join(binDir, "osascript"), `#!/bin/sh\nprintf called > "${osascriptMarker}"\nexit 0\n`, { mode: 0o755 });
  writeFileSync(path.join(binDir, "pbpaste"), [
    "#!/bin/sh",
    "cat <<'EOF'",
    "考试名称：2026 校招笔试",
    "考试时间：2026-07-01 10:00-12:00",
    "考试科目：数学",
    "人数：100人",
    "EOF",
    "",
  ].join("\n"), { mode: 0o755 });

  let thrown = null;
  try {
    execFileSync(nodeBin, [
      "scripts/wechat_visible_collect.mjs",
      "--config", configPath,
      "--group", "AI赋能运营自动化小组",
      "--push",
      "--api", "http://127.0.0.1:9",
      "--output", outputPath,
      "--lockPath", lockPath,
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown);
  const summary = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(summary.groups[0].status, "failed");
  assert.match(summary.groups[0].error, /需求中心不可用/);
  assert.equal(existsSync(osascriptMarker), false);
});
