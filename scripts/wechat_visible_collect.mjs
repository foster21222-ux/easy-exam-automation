#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readWechatDownloadedFilePreview, scanWechatDownloadedFiles } from "../server/wechat_attachment_scanner.mjs";
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
      if (isDeadPidLock(lockPath)) {
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

function isDeadPidLock(lockPath) {
  try {
    const pid = Number(readFileSync(lockPath, "utf8").split(/\s+/)[0]);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return error?.code === "ESRCH";
    }
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

export function resolveGroupRunState(group = {}, groupState = {}) {
  const currentRequestId = String(group.requirementRequestId || "").trim();
  const previousRequestId = String(groupState?.requestId || "").trim();
  if (currentRequestId && previousRequestId && currentRequestId !== previousRequestId) {
    return {};
  }
  return groupState || {};
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

function scanDownloadedAttachments(args, groupState = {}, visibleText = "") {
  const roots = args.attachmentRoot ? [args.attachmentRoot] : undefined;
  return scanWechatDownloadedFiles({
    roots,
    maxFiles: resolveAttachmentScanMaxFiles(args),
    previewChars: 0,
    modifiedSince: resolveAttachmentModifiedSince(args, groupState),
    visibleText,
  }).files;
}

export function resolveAttachmentScanMaxFiles(args = {}) {
  return Number(args.attachmentMaxFiles || 20);
}

function hydrateMatchedAttachmentPreviews(attachments = [], args = {}) {
  const previewChars = Number(args.attachmentPreviewChars || 500);
  return attachments.map((file) => ({
    ...file,
    preview: readWechatDownloadedFilePreview(file.path, {
      previewChars,
      imageOcrCommand: args.attachmentImageOcrCommand,
    }),
  }));
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
  checkpoint = null,
  scrollPages,
  scrollSteps,
  scrollLines,
  scrollBursts,
  initialCollection = false,
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
      checkpoint,
      scrollPages,
      scrollSteps,
      scrollLines,
      scrollBursts,
      initialCollection,
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
  checkpoint = null,
  scrollPages,
  scrollSteps,
  scrollLines,
  scrollBursts,
  initialCollection = false,
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
  const initialWindowInfo = checkWindow ? getWechatWindowInfo(windowHelper) : null;
  const initialAdjustmentPlan = initialWindowInfo
    ? resolveWechatWindowAdjustmentPlan(initialWindowInfo, captureInsets)
    : null;
  const scrollPlan = resolveScrollCapturePlan(
    { scrollPages, scrollSteps, scrollLines, scrollBursts },
    checkpoint,
    { captureHeight: initialAdjustmentPlan?.chatCaptureSize?.height, initialCollection },
  );
  if (dryRun) {
    const captureRect = initialWindowInfo
      ? buildWechatWindowCapturePlan(initialWindowInfo, captureInsets).captureRect
      : "";
    return {
      script,
      text: "",
      captureMode: "ocr",
      screenshotPath: resolvedScreenshotPath,
      ocrCommand,
      captureInsets,
      ...scrollPlan,
      ...(initialAdjustmentPlan || {}),
      ...(captureRect ? { captureRect } : {}),
    };
  }
  mkdirSync(path.dirname(resolvedScreenshotPath), { recursive: true });
  execFileSync("osascript", ["-e", script], { encoding: "utf8" });
  let windowInfo = getWechatWindowInfo(windowHelper);
  let adjustmentPlan = resolveWechatWindowAdjustmentPlan(windowInfo, captureInsets);
  if (adjustmentPlan.windowAdjustment.resized) {
    resizeWechatWindow(windowHelper, adjustmentPlan.windowAdjustment.targetWindow);
    windowInfo = getWechatWindowInfo(windowHelper);
    adjustmentPlan = {
      ...resolveWechatWindowAdjustmentPlan(windowInfo, captureInsets),
      windowAdjustment: {
        ...adjustmentPlan.windowAdjustment,
        resized: true,
        reason: "resized",
        afterWindow: { width: windowInfo.width, height: windowInfo.height },
      },
    };
  }
  const plan = buildWechatWindowCapturePlan(windowInfo, captureInsets);
  const adjustedScrollPlan = resolveScrollCapturePlan(
    { scrollPages, scrollSteps, scrollLines, scrollBursts },
    checkpoint,
    { captureHeight: adjustmentPlan.chatCaptureSize.height, initialCollection },
  );
  const windowScreenshotPath = `${resolvedScreenshotPath}.window.png`;
  const maxTitleAttempts = 12;
  for (let attempt = 1; attempt <= maxTitleAttempts; attempt += 1) {
    execFileSync("screencapture", [...plan.screenshotArgs, windowScreenshotPath], { encoding: "utf8" });
    const windowOcrCommand = buildOcrCommand(resolvedOcrTool, windowScreenshotPath);
    const windowText = execFileSync(windowOcrCommand[0], windowOcrCommand.slice(1), { encoding: "utf8" });
    try {
      assertWechatConversationTitle(windowText, groupName);
      break;
    } catch (error) {
      if (!shouldRetryWechatConversationTitle(error, { attempt, maxAttempts: maxTitleAttempts })) throw error;
      if (shouldReopenWechatGroupDuringTitleRetry(error, { attempt, maxAttempts: maxTitleAttempts })) {
        execFileSync("osascript", ["-e", script], { encoding: "utf8" });
      }
      waitSync(1_000);
    }
  }
  const capturePagesOnce = () => {
    const pages = [];
    const screenshotPaths = [];
    let checkpointLocated = false;
    let scrollCount = 0;
    const scrollDirection = adjustedScrollPlan.scrollDirection || "up";
    const restoreDirection = scrollDirection === "down" ? "up" : "down";
    try {
      for (let index = 0; index < adjustedScrollPlan.scrollPages; index += 1) {
        const pageScreenshotPath = index === 0
          ? resolvedScreenshotPath
          : withPageSuffix(resolvedScreenshotPath, index + 1);
        execFileSync("screencapture", [...plan.screenshotArgs, windowScreenshotPath], { encoding: "utf8" });
        execFileSync("sips", [...plan.cropArgs, windowScreenshotPath, "--out", pageScreenshotPath], { encoding: "utf8" });
        const command = buildOcrCommand(resolvedOcrTool, pageScreenshotPath);
        const pageText = execFileSync(command[0], command.slice(1), { encoding: "utf8" });
        pages.push(pageText);
        screenshotPaths.push(pageScreenshotPath);
        if (textContainsCheckpoint(pageText, checkpoint)) {
          checkpointLocated = true;
          break;
        }
        if (index >= adjustedScrollPlan.scrollPages - 1) break;
        scrollWechatChat(windowHelper, scrollDirection, adjustedScrollPlan);
        scrollCount += 1;
        waitSync(800);
        if (pages.length >= 2 && normalizeTextLines(pages.at(-1)).join("\n") === normalizeTextLines(pages.at(-2)).join("\n")) break;
      }
    } finally {
      for (let index = 0; index < scrollCount; index += 1) {
        try {
          scrollWechatChat(windowHelper, restoreDirection, adjustedScrollPlan);
          waitSync(150);
        } catch {
          break;
        }
      }
    }
    return { pages, screenshotPaths, checkpointLocated, scrollCount };
  };
  let pageCapture = capturePagesOnce();
  let text = mergeWechatScrollPageTexts(pageCapture.pages, { scrollDirection: adjustedScrollPlan.scrollDirection || "up" });
  if (!text.trim()) {
    // 微信偶发会在左侧选中目标群但右侧停在空白占位；重新打开微信群后再采集一次。
    execFileSync("osascript", ["-e", script], { encoding: "utf8" });
    waitSync(1_000);
    pageCapture = capturePagesOnce();
    text = mergeWechatScrollPageTexts(pageCapture.pages, { scrollDirection: adjustedScrollPlan.scrollDirection || "up" });
  }
  const command = buildOcrCommand(resolvedOcrTool, resolvedScreenshotPath);
  return {
    script,
    text,
    captureMode: "ocr",
    screenshotPath: resolvedScreenshotPath,
    screenshotPaths: pageCapture.screenshotPaths,
    windowScreenshotPath,
    ocrCommand,
    captureRect: plan.captureRect,
    captureInsets,
    conversationTitleVerified: true,
    ...adjustmentPlan,
    scrollPages: adjustedScrollPlan.scrollPages,
    scrollPageCount: pageCapture.pages.length,
    scrollSteps: adjustedScrollPlan.scrollSteps,
    scrollStepCount: pageCapture.scrollCount,
    scrollLines: adjustedScrollPlan.scrollLines,
    scrollBursts: adjustedScrollPlan.scrollBursts,
    scrollBaseHeight: adjustedScrollPlan.scrollBaseHeight,
    ...(adjustedScrollPlan.scrollDirection ? { scrollDirection: adjustedScrollPlan.scrollDirection } : {}),
    checkpointLocated: pageCapture.checkpointLocated,
    checkpointSearched: Boolean(checkpoint?.lastMessageHash),
  };
}

export function mergeWechatScrollPageTexts(pages = [], { scrollDirection = "up" } = {}) {
  const normalizedPages = pages.map((page) => normalizeTextLines(page)).filter((lines) => lines.length);
  const orderedPages = scrollDirection === "down" ? normalizedPages : normalizedPages.reverse();
  const merged = [];
  for (const lines of orderedPages) {
    const overlap = commonBoundaryOverlap(merged, lines);
    merged.push(...lines.slice(overlap));
  }
  return merged.join("\n");
}

function normalizeTextLines(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function commonBoundaryOverlap(leftLines, rightLines) {
  const max = Math.min(leftLines.length, rightLines.length);
  for (let count = max; count > 0; count -= 1) {
    const leftTail = leftLines.slice(leftLines.length - count);
    const rightHead = rightLines.slice(0, count);
    if (leftTail.every((line, index) => line === rightHead[index])) return count;
  }
  return 0;
}

const DEFAULT_SCROLL_BASE_HEIGHT = 624;
const DEFAULT_MIN_CHAT_CAPTURE_HEIGHT = 480;
const DEFAULT_TARGET_WECHAT_WINDOW = { width: 1200, height: 860 };

export function resolveScrollCapturePlan(
  { scrollPages, scrollSteps, scrollLines, scrollBursts } = {},
  checkpoint = null,
  { captureHeight, baseHeight = DEFAULT_SCROLL_BASE_HEIGHT, initialCollection = false } = {},
) {
  const resolvedLines = clampInteger(scrollLines, 48, 8, 120);
  const fallbackBursts = scaledScrollBursts(captureHeight, baseHeight);
  const resolvedBursts = clampInteger(scrollBursts, fallbackBursts, 1, 12);
  const hasCheckpoint = Boolean(checkpoint?.lastMessageHash);
  const defaultSteps = hasCheckpoint || initialCollection ? 10 : 0;
  const withDirection = (plan) => initialCollection ? { ...plan, scrollDirection: "down" } : plan;
  if (scrollSteps !== undefined && scrollSteps !== "") {
    const steps = clampInteger(scrollSteps, defaultSteps, 0, 20);
    return withDirection({
      scrollSteps: steps,
      scrollPages: steps + 1,
      scrollLines: resolvedLines,
      scrollBursts: resolvedBursts,
      scrollBaseHeight: baseHeight,
    });
  }
  if (scrollPages !== undefined && scrollPages !== "") {
    const pages = clampInteger(scrollPages, defaultSteps + 1, 1, 21);
    return withDirection({
      scrollSteps: Math.max(0, pages - 1),
      scrollPages: pages,
      scrollLines: resolvedLines,
      scrollBursts: resolvedBursts,
      scrollBaseHeight: baseHeight,
    });
  }
  const steps = defaultSteps;
  return withDirection({
    scrollSteps: steps,
    scrollPages: steps + 1,
    scrollLines: resolvedLines,
    scrollBursts: resolvedBursts,
    scrollBaseHeight: baseHeight,
  });
}

function scaledScrollBursts(captureHeight, baseHeight) {
  const height = Number(captureHeight);
  const base = Number(baseHeight);
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(base) || base <= 0) return 4;
  return clampInteger(Math.round(4 * height / base), 4, 2, 8);
}

export function resolveWechatWindowAdjustmentPlan(
  windowInfo,
  captureInsets = {},
  {
    minChatCaptureHeight = DEFAULT_MIN_CHAT_CAPTURE_HEIGHT,
    targetWindow = DEFAULT_TARGET_WECHAT_WINDOW,
  } = {},
) {
  const plan = buildWechatWindowCapturePlan(windowInfo, captureInsets);
  const [, , width, height] = plan.captureRect.split(",").map((value) => Number(value));
  const wechatWindow = {
    windowId: windowInfo.windowId,
    x: windowInfo.x,
    y: windowInfo.y,
    width: windowInfo.width,
    height: windowInfo.height,
  };
  const originalWindow = { width: windowInfo.width, height: windowInfo.height };
  const normalizedTarget = {
    width: Math.max(Math.round(Number(targetWindow.width || DEFAULT_TARGET_WECHAT_WINDOW.width)), Math.round(windowInfo.width)),
    height: Math.max(Math.round(Number(targetWindow.height || DEFAULT_TARGET_WECHAT_WINDOW.height)), Math.round(windowInfo.height)),
  };
  const tooSmall = height < minChatCaptureHeight;
  return {
    wechatWindow,
    chatCaptureSize: { width, height },
    windowAdjustment: {
      checked: true,
      resized: tooSmall,
      reason: tooSmall ? "chat_capture_too_small" : "size_ok",
      minChatCaptureHeight,
      targetWindow: normalizedTarget,
      originalWindow,
    },
  };
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function textContainsCheckpoint(text, checkpoint) {
  if (!checkpoint?.lastMessageHash) return false;
  return normalizeTextLines(text).some((line) => sha256(line) === checkpoint.lastMessageHash);
}

function scrollWechatChat(windowHelper, direction, { scrollLines, scrollBursts }) {
  execFileSync("swift", [windowHelper, "scroll-chat", direction, String(scrollLines), String(scrollBursts)], { encoding: "utf8" });
}

function resizeWechatWindow(windowHelper, { width, height }) {
  execFileSync("swift", [windowHelper, "resize-window", String(width), String(height)], { encoding: "utf8" });
  waitSync(800);
}

function withPageSuffix(filePath, pageNumber) {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.page-${pageNumber}${parsed.ext || ".png"}`);
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
  const normalizedText = normalizeWechatTitleText(ocrText);
  const normalizedGroup = normalizeWechatTitleText(groupName);
  if (normalizedGroup && normalizedText.includes(`${normalizedGroup}-搜一搜`)) {
    throw new Error(`当前微信仍停留在搜索页，未打开目标群：${groupName}`);
  }
  if (normalizedGroup && normalizedText.includes(normalizedGroup)) return;
  throw new Error(`当前微信会话不是目标群：${groupName}`);
}

function normalizeWechatTitleText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/…/g, "")
    .toLowerCase()
    .replace(/l/g, "i");
}

export function shouldRetryWechatConversationTitle(error, { attempt, maxAttempts } = {}) {
  const message = error instanceof Error ? error.message : String(error || "");
  return attempt < maxAttempts && message.includes("当前微信会话不是目标群");
}

export function shouldReopenWechatGroupDuringTitleRetry(error, { attempt, maxAttempts } = {}) {
  const message = error instanceof Error ? error.message : String(error || "");
  return attempt < maxAttempts && message.includes("当前微信会话不是目标群") && attempt % 4 === 0;
}

function waitSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function escapeAppleScript(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function parseMacIdleSeconds(ioregOutput = "") {
  const match = String(ioregOutput || "").match(/"HIDIdleTime"\s*=\s*(\d+)/);
  if (!match) return null;
  return Number(match[1]) / 1_000_000_000;
}

function readMacIdleSeconds() {
  try {
    return parseMacIdleSeconds(execFileSync("ioreg", ["-c", "IOHIDSystem"], { encoding: "utf8" }));
  } catch {
    return null;
  }
}

function pendingConfirmationPathForArgs(args = {}) {
  if (args.pendingConfirmationPath) return args.pendingConfirmationPath;
  const baseDir = args.output ? path.dirname(args.output) : ".easy_exam_runtime";
  return path.join(baseDir, "wechat-pending-confirmation.json");
}

function readPendingConfirmation(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writePendingConfirmation(filePath, payload) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function clearPendingConfirmation(filePath) {
  if (!filePath) return;
  rmSync(filePath, { force: true });
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + Math.max(1, Number(minutes || 1)) * 60_000);
}

function activeDueGroupsForUserGate(groups = [], state = {}, args = {}) {
  if (args.force || args.dryRun) return [];
  return groups.filter((group) => {
    const groupState = resolveGroupRunState(group, state.groups?.[group.groupName]);
    const checkpoint = groupState?.checkpoint || null;
    if (!checkpoint?.lastMessageHash) return false;
    return !shouldSkipByInterval(group, groupState, { force: false }).skip;
  });
}

function buildUserConfirmationPayload({
  status = "waiting",
  reason = "user_active",
  groups = [],
  now = new Date(),
  idleSeconds = null,
  idleThresholdSeconds = 300,
  confirmationTimeoutMinutes = 5,
  snoozeMinutes = 15,
} = {}) {
  const createdAt = now.toISOString();
  return {
    confirmationId: `wechat-confirm-${now.getTime()}-${crypto.randomUUID()}`,
    status,
    reason,
    groups,
    createdAt,
    updatedAt: createdAt,
    idleSeconds,
    idleThresholdSeconds,
    promptExpiresAt: addMinutes(now, confirmationTimeoutMinutes).toISOString(),
    snoozedUntil: status === "snoozed" ? addMinutes(now, snoozeMinutes).toISOString() : "",
    detail: "检测到用户正在使用这台 Mac，自动采集已暂停，等待确认或稍后重试。",
  };
}

function notifyUserConfirmation(pending) {
  try {
    const title = "微信群自动采集等待确认";
    const groupText = (pending.groups || []).join("、") || "已启用微信群";
    const body = `检测到你正在使用电脑，已暂停 ${groupText} 的自动采集。可在 easy-exam 系统配置中确认执行或稍后提醒。`;
    execFileSync("osascript", [
      "-e",
      `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"`,
    ], { encoding: "utf8" });
  } catch {
    // 通知失败不能影响调度状态；网页状态仍是权威提示入口。
  }
}

function writeUserGateRunSummary({
  args,
  startedAt,
  status,
  groups,
  pending,
  detail,
} = {}) {
  const runSummary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    status,
    detail: detail || pending?.detail || "",
    confirmationId: pending?.confirmationId || "",
    groups: groups.map((groupName) => ({
      groupName,
      status,
      detail: detail || pending?.detail || "",
    })),
  };
  writeJsonFile(args.output, runSummary);
  appendRunHistory(historyPathForArgs(args), runSummary, { maxEntries: args.historyMaxEntries });
  process.stdout.write(`${JSON.stringify({ results: runSummary.groups.map((group) => ({ groupName: group.groupName, skipped: status })) }, null, 2)}\n`);
}

function resolveUserActivityGate({ args, groups, state, startedAt }) {
  const dueGroups = activeDueGroupsForUserGate(groups, state, args);
  if (!dueGroups.length) return { blocked: false };
  const pendingPath = pendingConfirmationPathForArgs(args);
  const now = new Date();
  const confirmationTimeoutMinutes = Number(args.confirmationTimeoutMinutes || 5);
  const snoozeMinutes = Number(args.snoozeMinutes || 15);
  const pending = readPendingConfirmation(pendingPath);
  if (pending?.status === "waiting") {
    const promptExpiresAt = new Date(pending.promptExpiresAt || 0);
    if (!Number.isNaN(promptExpiresAt.getTime()) && now < promptExpiresAt) {
      return { blocked: true, status: "waiting_user_confirmation", pending, pendingPath, groups: pending.groups || dueGroups.map((group) => group.groupName) };
    }
    const snoozed = {
      ...pending,
      status: "snoozed",
      updatedAt: now.toISOString(),
      snoozedUntil: addMinutes(now, snoozeMinutes).toISOString(),
      detail: "用户未确认本轮自动采集，已自动延后，稍后重新判断是否空闲。",
    };
    writePendingConfirmation(pendingPath, snoozed);
    return { blocked: true, status: "snoozed_user_active", pending: snoozed, pendingPath, groups: snoozed.groups || dueGroups.map((group) => group.groupName) };
  }
  if (pending?.status === "snoozed") {
    const snoozedUntil = new Date(pending.snoozedUntil || 0);
    if (!Number.isNaN(snoozedUntil.getTime()) && now < snoozedUntil) {
      return { blocked: true, status: "snoozed_user_active", pending, pendingPath, groups: pending.groups || dueGroups.map((group) => group.groupName) };
    }
  }
  if (pending?.status === "paused_today") {
    const pausedUntil = new Date(pending.pausedUntil || 0);
    if (!Number.isNaN(pausedUntil.getTime()) && now < pausedUntil) {
      return { blocked: true, status: "paused_user_requested", pending, pendingPath, groups: pending.groups || dueGroups.map((group) => group.groupName) };
    }
    clearPendingConfirmation(pendingPath);
  }
  const idleThresholdSeconds = Number(args.userIdleMinSeconds || 300);
  const idleSeconds = readMacIdleSeconds();
  if (idleSeconds !== null && idleSeconds < idleThresholdSeconds) {
    const nextPending = buildUserConfirmationPayload({
      groups: dueGroups.map((group) => group.groupName),
      now,
      idleSeconds,
      idleThresholdSeconds,
      confirmationTimeoutMinutes,
      snoozeMinutes,
    });
    writePendingConfirmation(pendingPath, nextPending);
    notifyUserConfirmation(nextPending);
    return { blocked: true, status: "waiting_user_confirmation", pending: nextPending, pendingPath, groups: nextPending.groups };
  }
  clearPendingConfirmation(pendingPath);
  return { blocked: false, startedAt };
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
  const userGate = resolveUserActivityGate({ args, groups, state, startedAt });
  if (userGate.blocked) {
    writeUserGateRunSummary({
      args,
      startedAt,
      status: userGate.status,
      groups: userGate.groups,
      pending: userGate.pending,
    });
    return;
  }
  const llmParserConfig = buildLlmParserConfig(args, process.env, rawConfig);
  const results = [];
  const runSummary = {
    startedAt,
    finishedAt: "",
    groups: [],
  };
  let pushApiReachable = false;
  for (const group of groups) {
    const groupState = resolveGroupRunState(group, state.groups?.[group.groupName]);
    const requestId = group.requirementRequestId || groupState?.requestId || "";
    const groupSummary = {
      groupName: group.groupName,
      status: "failed",
      requestId,
      captureMode: args.captureMode || "clipboard",
      messageCount: 0,
      changeCount: 0,
      attachmentCount: 0,
      attachmentCandidateCount: 0,
    };
    try {
      const checkpoint = groupState?.checkpoint || null;
      const initialCollection = Boolean(args.force && !checkpoint?.lastMessageHash);
      if (!args.force && !args.dryRun && !checkpoint?.lastMessageHash) {
        groupSummary.status = "needs_initial_collection";
        groupSummary.detail = "本群还没有完成初始化，请先执行一次“立即采集本群”。";
        results.push({ groupName: group.groupName, skipped: "needs_initial_collection" });
        runSummary.groups.push(groupSummary);
        continue;
      }
      const interval = shouldSkipByInterval(group, groupState, { force: args.force });
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
        checkpoint,
        scrollPages: args.scrollPages,
        scrollSteps: args.scrollSteps,
        scrollLines: args.scrollLines,
        scrollBursts: args.scrollBursts,
        initialCollection,
      });
      groupSummary.captureMode = captured.captureMode || args.captureMode || "clipboard";
      if (captured.screenshotPath) groupSummary.screenshotPath = captured.screenshotPath;
      if (captured.screenshotPaths) groupSummary.screenshotPaths = captured.screenshotPaths;
      if (captured.ocrCommand) groupSummary.ocrCommand = captured.ocrCommand;
      if (captured.captureRect) groupSummary.captureRect = captured.captureRect;
      if (captured.captureInsets) groupSummary.captureInsets = captured.captureInsets;
      if (captured.scrollPages) groupSummary.scrollPages = captured.scrollPages;
      if (captured.scrollPageCount) groupSummary.scrollPageCount = captured.scrollPageCount;
      if (captured.scrollSteps !== undefined) groupSummary.scrollSteps = captured.scrollSteps;
      if (captured.scrollStepCount !== undefined) groupSummary.scrollStepCount = captured.scrollStepCount;
      if (captured.scrollLines !== undefined) groupSummary.scrollLines = captured.scrollLines;
      if (captured.scrollBursts !== undefined) groupSummary.scrollBursts = captured.scrollBursts;
      if (captured.scrollBaseHeight !== undefined) groupSummary.scrollBaseHeight = captured.scrollBaseHeight;
      if (captured.scrollDirection) groupSummary.scrollDirection = captured.scrollDirection;
      if (captured.wechatWindow) groupSummary.wechatWindow = captured.wechatWindow;
      if (captured.chatCaptureSize) groupSummary.chatCaptureSize = captured.chatCaptureSize;
      if (captured.windowAdjustment) groupSummary.windowAdjustment = captured.windowAdjustment;
      if (captured.checkpointSearched) groupSummary.checkpointLocated = captured.checkpointLocated;
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
          scrollPages: captured.scrollPages,
          scrollSteps: captured.scrollSteps,
          scrollLines: captured.scrollLines,
          scrollBursts: captured.scrollBursts,
          scrollBaseHeight: captured.scrollBaseHeight,
          scrollDirection: captured.scrollDirection,
          wechatWindow: captured.wechatWindow,
          chatCaptureSize: captured.chatCaptureSize,
          windowAdjustment: captured.windowAdjustment,
          appleScript: captured.script,
        });
        runSummary.groups.push(groupSummary);
        continue;
      }
      const capturedText = assertCapturedTextUsable(captured.text, { captureMode: groupSummary.captureMode });
      const attachmentModifiedSince = resolveAttachmentModifiedSince(args, groupState);
      const attachmentCandidates = scanDownloadedAttachments(args, groupState, capturedText);
      const attachments = hydrateMatchedAttachmentPreviews(
        matchAttachmentsToVisibleText(attachmentCandidates, capturedText),
        args,
      );
      groupSummary.attachmentCandidateCount = attachmentCandidates.length;
      groupSummary.attachmentCount = attachments.length;
      groupSummary.attachmentModifiedSince = attachmentModifiedSince;
      const draft = buildWechatRequirementDraft({
        config,
        groupName: group.groupName,
        text: capturedText,
        checkpoint,
        attachments,
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
