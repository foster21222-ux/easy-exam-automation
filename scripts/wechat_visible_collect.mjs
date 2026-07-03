#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { scanWechatDownloadedFiles } from "../server/wechat_attachment_scanner.mjs";
import { parseWechatRequirementWithLlm } from "../server/wechat_llm_requirement_parser.mjs";
import {
  buildWechatRequirementDraft,
  loadWechatGroupConfig,
  pushWechatDraftToRequirementCenter,
  validateWechatGroupConfig,
} from "../server/wechat_requirement_collector.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    if (key === "dry-run") {
      args.dryRun = true;
    } else if (key === "push") {
      args.push = true;
    } else if (key === "force") {
      args.force = true;
    } else if (key === "check-window") {
      args.checkWindow = true;
    } else {
      args[key] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function readState(statePath) {
  if (!statePath || !existsSync(statePath)) return {};
  return JSON.parse(readFileSync(statePath, "utf8"));
}

function writeState(statePath, groupName, values) {
  if (!statePath) return;
  const state = readState(statePath);
  state.groups = state.groups || {};
  state.groups[groupName] = {
    ...state.groups[groupName],
    ...values,
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function writeJsonFile(filePath, payload) {
  if (!filePath) return;
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function historyPathForArgs(args) {
  return args.history || (args.output ? path.join(path.dirname(args.output), "wechat-run-history.jsonl") : "");
}

export function appendRunHistory(filePath, payload, { maxEntries = 500 } = {}) {
  if (!filePath) return;
  mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = existsSync(filePath)
    ? readFileSync(filePath, "utf8").split(/\n+/).map((line) => line.trim()).filter(Boolean)
    : [];
  lines.push(JSON.stringify(payload));
  const retained = lines.slice(-Math.max(1, Number(maxEntries || 500)));
  writeFileSync(filePath, `${retained.join("\n")}\n`, "utf8");
}

function acquireRunLock(lockPath, { maxAgeMs = 30 * 60 * 1000 } = {}) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
    closeSync(fd);
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") {
      if (isStaleLock(lockPath, maxAgeMs)) {
        rmSync(lockPath, { force: true });
        return acquireRunLock(lockPath, { maxAgeMs });
      }
      return false;
    }
    throw error;
  }
}

function isStaleLock(lockPath, maxAgeMs) {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return false;
  try {
    return Date.now() - statSync(lockPath).mtimeMs > maxAgeMs;
  } catch {
    return false;
  }
}

function releaseRunLock(lockPath) {
  if (!lockPath) return;
  rmSync(lockPath, { force: true });
}

export function resolveAttachmentModifiedSince(args = {}, groupState = {}) {
  return args.attachmentModifiedSince || groupState?.updatedAt || "";
}

export function buildStateUpdateForRun({ draft, pushResult, requestId = "" } = {}) {
  const resolvedRequestId = pushResult?.requestId || requestId || undefined;
  if (pushResult?.skipped === "no_new_messages") {
    return { requestId: resolvedRequestId };
  }
  return {
    checkpoint: draft?.checkpoint,
    requestId: resolvedRequestId,
  };
}

function scanDownloadedAttachments(args, groupState = {}) {
  const roots = args.attachmentRoot ? [args.attachmentRoot] : undefined;
  return scanWechatDownloadedFiles({
    roots,
    maxFiles: Number(args.attachmentMaxFiles || 5),
    previewChars: Number(args.attachmentPreviewChars || 500),
    modifiedSince: resolveAttachmentModifiedSince(args, groupState),
  }).files;
}

function normalizeAttachmentMatchText(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
}

export function matchAttachmentsToVisibleText(attachments = [], visibleText = "") {
  const normalizedText = normalizeAttachmentMatchText(visibleText);
  if (!normalizedText) return [];
  return attachments.filter((file) => {
    const normalizedName = normalizeAttachmentMatchText(file?.name);
    return Boolean(normalizedName && normalizedText.includes(normalizedName));
  });
}

export function assertCapturedTextUsable(text, { captureMode = "clipboard" } = {}) {
  const value = String(text || "");
  if (value.trim()) return value;
  if (captureMode === "ocr") {
    throw new Error("OCR 未识别到任何聊天文字，请确认微信窗口可见且屏幕未锁定");
  }
  throw new Error("未读取到任何聊天文字，请确认微信窗口和目标群可见");
}

export function assertDraftHasRequirementSignal(draft = {}) {
  const requirement = draft.requirement && typeof draft.requirement === "object" ? draft.requirement : {};
  const changeRecords = Array.isArray(draft.changeRecords) ? draft.changeRecords : [];
  const analysisCandidates = draft.analysisCandidates || {};
  const requirementCandidates = analysisCandidates.requirementCandidates || {};
  const changeCandidates = Array.isArray(analysisCandidates.changeCandidates) ? analysisCandidates.changeCandidates : [];
  const hasRequirementValue = Object.values(requirement).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "string") return value.trim().length > 0;
    return value !== undefined && value !== null;
  });
  if (hasRequirementValue || changeRecords.length || Object.keys(requirementCandidates).length || changeCandidates.length) return;
  const error = new Error("OCR 文本未识别到需求字段或需求变更，已禁止写入 checkpoint 和需求中心");
  error.code = "NO_REQUIREMENT_SIGNAL";
  throw error;
}

export function buildLlmParserConfig(args = {}, env = process.env, runtimeConfig = {}) {
  const saved = runtimeConfig.llm_parse || runtimeConfig.llmParse || {};
  const mode = String(args.llmParse || env.WECHAT_LLM_PARSE || (saved.enabled ? "candidate" : "") || "").trim();
  if (mode !== "candidate") return { enabled: false };
  return {
    enabled: true,
    provider: String(args.llmProvider || env.WECHAT_LLM_PROVIDER || saved.provider || "openai").trim(),
    model: String(args.llmModel || env.WECHAT_LLM_MODEL || saved.model || "gpt-4.1-mini").trim(),
    endpoint: String(args.llmEndpoint || env.WECHAT_LLM_ENDPOINT || saved.endpoint || "https://api.openai.com/v1/responses").trim(),
    apiKey: String(args.llmApiKey || env.OPENAI_API_KEY || env.WECHAT_LLM_API_KEY || saved.api_key || saved.apiKey || "").replace(/\s+/g, ""),
  };
}

async function assertRequirementCenterReachable(apiBase = "http://127.0.0.1:8765") {
  const endpoint = new URL("/api/requirements", String(apiBase || "http://127.0.0.1:8765").endsWith("/")
    ? String(apiBase || "http://127.0.0.1:8765")
    : `${apiBase}/`).toString();
  try {
    const response = await fetch(endpoint, { method: "GET" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`需求中心不可用：${detail}`);
  }
}

function shouldSkipByInterval(group, groupState, { force = false, now = new Date() } = {}) {
  if (force) return { skip: false };
  const intervalMinutes = Number(group.intervalMinutes || 0);
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return { skip: false };
  if (!groupState?.updatedAt) return { skip: false };
  const lastRunAt = new Date(groupState.updatedAt);
  if (Number.isNaN(lastRunAt.getTime())) return { skip: false };
  const nextRunAt = new Date(lastRunAt.getTime() + intervalMinutes * 60 * 1000);
  if (now < nextRunAt) {
    return {
      skip: true,
      lastRunAt: lastRunAt.toISOString(),
      nextRunAt: nextRunAt.toISOString(),
    };
  }
  return { skip: false };
}

function captureVisibleWechatText(groupName, {
  dryRun = false,
  captureMode = "clipboard",
  screenshotPath = "",
  ocrTool = "",
  chatLeftInset,
  chatTopInset,
  chatRightInset,
  chatBottomInset,
  checkWindow = false,
} = {}) {
  return captureMode === "ocr"
    ? captureVisibleWechatTextByOcr(groupName, {
      dryRun,
      screenshotPath,
      ocrTool,
      chatLeftInset,
      chatTopInset,
      chatRightInset,
      chatBottomInset,
      checkWindow,
    })
    : captureVisibleWechatTextByClipboard(groupName, { dryRun });
}

function captureVisibleWechatTextByClipboard(groupName, { dryRun = false } = {}) {
  const script = `
set targetGroup to "${escapeAppleScript(groupName)}"
set the clipboard to targetGroup
tell application "WeChat" to activate
delay 0.5
tell application "System Events"
  tell process "WeChat"
    keystroke "f" using {command down}
    delay 0.2
    keystroke "a" using {command down}
    delay 0.1
    keystroke "v" using {command down}
    delay 0.8
    key code 36
    delay 0.8
    key code 53
    delay 0.2
    keystroke "a" using {command down}
    delay 0.2
    keystroke "c" using {command down}
  end tell
end tell
delay 0.2
`;
  if (dryRun) return { script, text: "" };
  execFileSync("osascript", ["-e", script], { encoding: "utf8" });
  const text = execFileSync("pbpaste", { encoding: "utf8" });
  return { script, text };
}

function captureVisibleWechatTextByOcr(groupName, {
  dryRun = false,
  screenshotPath = "",
  ocrTool = "",
  chatLeftInset,
  chatTopInset,
  chatRightInset,
  chatBottomInset,
  checkWindow = false,
} = {}) {
  const windowHelper = path.resolve(path.join("scripts", "wechat_window.swift"));
  const script = buildOpenWechatGroupScript(groupName, { windowHelper });
  const resolvedScreenshotPath = screenshotPath || defaultScreenshotPath(groupName);
  const resolvedOcrTool = ocrTool || path.join("scripts", "ocr_image.swift");
  const ocrCommand = buildOcrCommand(resolvedOcrTool, resolvedScreenshotPath).join(" ");
  const captureInsets = {
    leftInset: Number(chatLeftInset ?? 320),
    topInset: Number(chatTopInset ?? 56),
    rightInset: Number(chatRightInset ?? 0),
    bottomInset: Number(chatBottomInset ?? 180),
  };
  if (dryRun) {
    const captureRect = checkWindow
      ? buildWechatWindowCapturePlan(getWechatWindowInfo(windowHelper), captureInsets).captureRect
      : "";
    return {
      script,
      text: "",
      captureMode: "ocr",
      screenshotPath: resolvedScreenshotPath,
      ocrCommand,
      captureInsets,
      ...(captureRect ? { captureRect } : {}),
    };
  }
  mkdirSync(path.dirname(resolvedScreenshotPath), { recursive: true });
  execFileSync("osascript", ["-e", script], { encoding: "utf8" });
  const windowInfo = getWechatWindowInfo(windowHelper);
  const plan = buildWechatWindowCapturePlan(windowInfo, captureInsets);
  const windowScreenshotPath = `${resolvedScreenshotPath}.window.png`;
  execFileSync("screencapture", [...plan.screenshotArgs, windowScreenshotPath], { encoding: "utf8" });
  const windowOcrCommand = buildOcrCommand(resolvedOcrTool, windowScreenshotPath);
  const windowText = execFileSync(windowOcrCommand[0], windowOcrCommand.slice(1), { encoding: "utf8" });
  assertWechatConversationTitle(windowText, groupName);
  execFileSync("sips", [...plan.cropArgs, windowScreenshotPath, "--out", resolvedScreenshotPath], { encoding: "utf8" });
  const command = buildOcrCommand(resolvedOcrTool, resolvedScreenshotPath);
  const text = execFileSync(command[0], command.slice(1), { encoding: "utf8" });
  return {
    script,
    text,
    captureMode: "ocr",
    screenshotPath: resolvedScreenshotPath,
    windowScreenshotPath,
    ocrCommand,
    captureRect: plan.captureRect,
    captureInsets,
    conversationTitleVerified: true,
  };
}

export function buildChatCaptureRect(windowRect, {
  leftInset = 320,
  topInset = 56,
  rightInset = 0,
  bottomInset = 180,
} = {}) {
  const values = String(windowRect || "").split(",").map((value) => Number(value));
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`无法解析微信窗口截图区域：${windowRect || "空"}`);
  }
  const [x, y, width, height] = values;
  const insets = [leftInset, topInset, rightInset, bottomInset].map((value) => Math.max(0, Math.round(Number(value))));
  if (insets.some((value) => !Number.isFinite(value))) {
    throw new Error("聊天正文截图边距必须是数字");
  }
  const [left, top, right, bottom] = insets;
  const captureWidth = Math.round(width - left - right);
  const captureHeight = Math.round(height - top - bottom);
  if (captureWidth < 320 || captureHeight < 240) {
    throw new Error(`聊天正文截图区域过小：${captureWidth}x${captureHeight}`);
  }
  return `${Math.round(x + left)},${Math.round(y + top)},${captureWidth},${captureHeight}`;
}

export function parseWechatWindowInfo(value) {
  const numbers = String(value || "").trim().split(",").map((item) => Number(item));
  if (numbers.length !== 5 || numbers.some((item) => !Number.isFinite(item))) {
    throw new Error(`无法解析微信窗口信息：${value || "空"}`);
  }
  const [windowId, x, y, width, height] = numbers;
  return { windowId, x, y, width, height };
}

export function buildWechatWindowCapturePlan(windowInfo, captureInsets = {}) {
  const captureRect = buildChatCaptureRect(`0,0,${windowInfo.width},${windowInfo.height}`, captureInsets);
  const [left, top, width, height] = captureRect.split(",");
  return {
    captureRect,
    screenshotArgs: ["-x", "-o", `-l${windowInfo.windowId}`],
    cropArgs: ["-c", height, width, "--cropOffset", top, left],
  };
}

export function assertWechatConversationTitle(ocrText, groupName) {
  const normalizedText = String(ocrText || "").normalize("NFKC").replace(/\s+/g, "");
  const normalizedGroup = String(groupName || "").normalize("NFKC").replace(/\s+/g, "");
  if (normalizedGroup && normalizedText.includes(normalizedGroup)) return;
  throw new Error(`当前微信会话不是目标群：${groupName}`);
}

function getWechatWindowInfo(windowHelper = path.resolve(path.join("scripts", "wechat_window.swift"))) {
  const value = execFileSync("swift", [windowHelper, "info"], { encoding: "utf8" }).trim();
  return parseWechatWindowInfo(value);
}

export function buildOpenWechatGroupScript(groupName, {
  windowHelper = path.resolve(path.join("scripts", "wechat_window.swift")),
} = {}) {
  const openCommand = `swift ${quoteShellArg(windowHelper)} open-group ${quoteShellArg(groupName)}`;
  return `
do shell script "${escapeAppleScript(openCommand)}"
`;
}

function quoteShellArg(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function buildOcrCommand(ocrTool, screenshotPath) {
  const tool = String(ocrTool || "").trim() || path.join("scripts", "ocr_image.swift");
  return tool.endsWith(".swift")
    ? ["swift", tool, screenshotPath]
    : [tool, screenshotPath];
}

function defaultScreenshotPath(groupName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(".easy_exam_runtime", "wechat-screenshots", `${safeFilePart(groupName)}-${stamp}.png`);
}

function safeFilePart(value) {
  return String(value || "wechat").replace(/[^\w.\-\u4e00-\u9fff]+/g, "_").slice(0, 80) || "wechat";
}

function escapeAppleScript(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function main() {
  const startedAt = new Date().toISOString();
  const args = parseArgs(process.argv);
  if (!args.config) {
    throw new Error("用法：node scripts/wechat_visible_collect.mjs --config config/wechat-requirement-groups.example.json --state .easy_exam_runtime/wechat-checkpoints.json --group AI赋能运营自动化小组");
  }
  const lockPath = args.lockPath || path.join(".easy_exam_runtime", "wechat-visible-collect.lock");
  const lockMaxAgeMs = Number(args.lockMaxAgeMs || 30 * 60 * 1000);
  if (!acquireRunLock(lockPath, { maxAgeMs: lockMaxAgeMs })) {
    const skipped = {
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "skipped",
      error: "另一个微信群采集任务正在运行",
      groups: [],
    };
    writeJsonFile(args.output, skipped);
    appendRunHistory(historyPathForArgs(args), skipped, { maxEntries: args.historyMaxEntries });
    console.error(skipped.error);
    process.exitCode = 1;
    return;
  }
  try {
  const rawConfig = JSON.parse(readFileSync(args.config, "utf8"));
  const config = loadWechatGroupConfig(rawConfig);
  const validation = validateWechatGroupConfig(config, { requireEnabled: true });
  if (!validation.ok) throw new Error(validation.error);
  let groups = config.groups.filter((group) => group.enabled);
  if (args.group) {
    const targetGroup = config.groups.find((group) => group.groupName === args.group);
    if (!targetGroup) throw new Error(`未配置微信群：${args.group}`);
    if (targetGroup.enabled === false) throw new Error(`微信群已停用：${args.group}`);
    groups = [targetGroup];
  }
  if (!groups.length) throw new Error("没有找到可采集的微信群配置。");

  const state = readState(args.state);
  const llmParserConfig = buildLlmParserConfig(args, process.env, rawConfig);
  const results = [];
  const runSummary = {
    startedAt,
    finishedAt: "",
    groups: [],
  };
  let pushApiReachable = false;
  for (const group of groups) {
    const groupSummary = {
      groupName: group.groupName,
      status: "failed",
      requestId: group.requirementRequestId || state.groups?.[group.groupName]?.requestId || "",
      captureMode: args.captureMode || "clipboard",
      messageCount: 0,
      changeCount: 0,
      attachmentCount: 0,
      attachmentCandidateCount: 0,
    };
    try {
      const interval = shouldSkipByInterval(group, state.groups?.[group.groupName], { force: args.force });
      if (interval.skip) {
        groupSummary.status = "skipped_interval";
        groupSummary.lastRunAt = interval.lastRunAt;
        groupSummary.nextRunAt = interval.nextRunAt;
        results.push({ groupName: group.groupName, skipped: "interval", nextRunAt: interval.nextRunAt });
        runSummary.groups.push(groupSummary);
        continue;
      }
      if (args.push && !args.dryRun && !pushApiReachable) {
        await assertRequirementCenterReachable(args.api);
        pushApiReachable = true;
      }
      const captured = captureVisibleWechatText(group.groupName, {
        dryRun: args.dryRun,
        captureMode: args.captureMode || "clipboard",
        screenshotPath: args.screenshotPath,
        ocrTool: args.ocrTool,
        chatLeftInset: args.chatLeftInset,
        chatTopInset: args.chatTopInset,
        chatRightInset: args.chatRightInset,
        chatBottomInset: args.chatBottomInset,
        checkWindow: args.checkWindow,
      });
      groupSummary.captureMode = captured.captureMode || args.captureMode || "clipboard";
      if (captured.screenshotPath) groupSummary.screenshotPath = captured.screenshotPath;
      if (captured.ocrCommand) groupSummary.ocrCommand = captured.ocrCommand;
      if (captured.captureRect) groupSummary.captureRect = captured.captureRect;
      if (captured.captureInsets) groupSummary.captureInsets = captured.captureInsets;
      if (args.dryRun) {
        groupSummary.status = "dry_run";
        groupSummary.appleScript = captured.script;
        results.push({
          groupName: group.groupName,
          captureMode: groupSummary.captureMode,
          screenshotPath: captured.screenshotPath,
          ocrCommand: captured.ocrCommand,
          captureRect: captured.captureRect,
          captureInsets: captured.captureInsets,
          appleScript: captured.script,
        });
        runSummary.groups.push(groupSummary);
        continue;
      }
      const capturedText = assertCapturedTextUsable(captured.text, { captureMode: groupSummary.captureMode });
      const checkpoint = state.groups?.[group.groupName]?.checkpoint || null;
      const requestId = group.requirementRequestId || state.groups?.[group.groupName]?.requestId || "";
      const draft = buildWechatRequirementDraft({
        config,
        groupName: group.groupName,
        text: capturedText,
        checkpoint,
      });
      if (llmParserConfig.enabled) {
        try {
          draft.analysisCandidates = await parseWechatRequirementWithLlm({
            text: capturedText,
            ruleResult: draft,
            config: llmParserConfig,
          });
        } catch (error) {
          draft.analysisCandidates = {
            enabled: true,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
      assertDraftHasRequirementSignal(draft);
      const attachmentModifiedSince = resolveAttachmentModifiedSince(args, state.groups?.[group.groupName]);
      const attachmentCandidates = scanDownloadedAttachments(args, state.groups?.[group.groupName]);
      const attachments = matchAttachmentsToVisibleText(attachmentCandidates, capturedText);
      groupSummary.attachmentCandidateCount = attachmentCandidates.length;
      groupSummary.attachmentCount = attachments.length;
      groupSummary.attachmentModifiedSince = attachmentModifiedSince;
      groupSummary.messageCount = draft.messages.length;
      groupSummary.changeCount = draft.changeRecords.length;
      const result = { draft };
      if (args.push) {
        result.push = await pushWechatDraftToRequirementCenter(draft, {
          apiBase: args.api,
          requestId,
          attachments,
        });
        groupSummary.status = result.push?.skipped === "no_new_messages" ? "no_new_messages" : "pushed";
        groupSummary.requestId = result.push?.requestId || requestId || "";
      } else {
        groupSummary.status = "collected";
        groupSummary.requestId = requestId;
      }
      writeState(args.state, group.groupName, buildStateUpdateForRun({
        draft,
        pushResult: result.push,
        requestId,
      }));
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error?.code === "NO_REQUIREMENT_SIGNAL") {
        groupSummary.status = "no_requirement_signal";
        groupSummary.detail = message;
        results.push({ groupName: group.groupName, skipped: "no_requirement_signal" });
      } else {
        groupSummary.status = "failed";
        groupSummary.error = message;
        results.push({ groupName: group.groupName, error: groupSummary.error });
      }
    } finally {
      if (!runSummary.groups.includes(groupSummary)) runSummary.groups.push(groupSummary);
    }
  }
  runSummary.finishedAt = new Date().toISOString();
  writeJsonFile(args.output, runSummary);
  appendRunHistory(historyPathForArgs(args), runSummary, { maxEntries: args.historyMaxEntries });
  if (runSummary.groups.some((group) => group.status === "failed")) {
    process.exitCode = 1;
  }

  process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
  } catch (error) {
    const failed = {
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      groups: [],
    };
    writeJsonFile(args.output, failed);
    appendRunHistory(historyPathForArgs(args), failed, { maxEntries: args.historyMaxEntries });
    console.error(failed.error);
    process.exitCode = 1;
  } finally {
    releaseRunLock(lockPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
