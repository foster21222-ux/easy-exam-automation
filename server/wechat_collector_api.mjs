import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  getEasyExamServiceLaunchdStatus,
  getWechatCollectorLaunchdStatus,
  installEasyExamServiceLaunchd,
  installWechatCollectorLaunchd,
  uninstallEasyExamServiceLaunchd,
  uninstallWechatCollectorLaunchd,
} from "./wechat_launchd_manager.mjs";
import {
  defaultWechatFileRoots,
  scanWechatDownloadedFiles,
} from "./wechat_attachment_scanner.mjs";
import {
  buildWechatRequirementDraft,
  pushWechatDraftToRequirementCenter,
} from "./wechat_requirement_collector.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const runtimeDir = path.join(rootDir, ".easy_exam_runtime");
const execFileAsync = promisify(execFile);

function defaultJson(res, code, payload) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function defaultReadBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks);
}

function parseJsonSafe(buffer) {
  try {
    return JSON.parse(Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || ""));
  } catch {
    return null;
  }
}

function parseIntegerQueryParam(url, name, { defaultValue, min, max }) {
  const raw = url.searchParams.get(name);
  if (raw === null) return { ok: true, value: defaultValue };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    return { ok: false, error: `附件扫描参数无效：${name} 必须是 ${min}-${max} 的整数` };
  }
  return { ok: true, value };
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function readRequiredJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJsonFile(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function backupExistingJsonFile(filePath, backupDir, now = () => new Date()) {
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
  const timestamp = (now() instanceof Date ? now() : new Date(now()))
    .toISOString()
    .replaceAll(":", "")
    .replaceAll("-", "")
    .replace(/\.\d{3}Z$/, "Z");
  const backupPath = path.join(backupDir, `${timestamp}-${path.basename(filePath)}`);
  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(backupPath, raw, "utf8");
  return backupPath;
}

async function listRecentConfigBackups(backupDir, limit = 10) {
  try {
    const entries = await fs.readdir(backupDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => ({
        fileName: entry.name,
        path: path.join(backupDir, entry.name),
      }))
      .sort((left, right) => right.fileName.localeCompare(left.fileName))
      .slice(0, Math.max(1, Number(limit || 10)));
  } catch {
    return [];
  }
}

async function readLogTail(filePath, maxChars = 4000) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return {
      path: filePath,
      exists: true,
      text: text.slice(Math.max(0, text.length - maxChars)),
    };
  } catch {
    return {
      path: filePath,
      exists: false,
      text: "",
    };
  }
}

async function readRunHistory(filePath, limit = 20) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text.split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(-Math.max(1, Number(limit || 20)))
      .reverse();
  } catch {
    return [];
  }
}

async function appendRunHistory(filePath, payload, { maxEntries = 500 } = {}) {
  let entries = [];
  try {
    const text = await fs.readFile(filePath, "utf8");
    entries = text.split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {}
  entries.push(payload);
  const trimmed = entries.slice(-Math.max(1, Number(maxEntries || 500)));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${trimmed.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
}

async function readCollectorLogs(paths = {}, maxChars = 4000) {
  const defaultPaths = {
    serviceStdout: path.join(runtimeDir, "logs", "service.stdout.log"),
    serviceStderr: path.join(runtimeDir, "logs", "service.stderr.log"),
    collectorStdout: path.join(runtimeDir, "wechat-collector.log"),
    collectorStderr: path.join(runtimeDir, "wechat-collector.err.log"),
  };
  const resolved = { ...defaultPaths, ...paths };
  return {
    serviceStdout: await readLogTail(resolved.serviceStdout, maxChars),
    serviceStderr: await readLogTail(resolved.serviceStderr, maxChars),
    collectorStdout: await readLogTail(resolved.collectorStdout, maxChars),
    collectorStderr: await readLogTail(resolved.collectorStderr, maxChars),
  };
}

async function readCollectorLockStatus(lockPath, maxAgeMs = 30 * 60 * 1000) {
  try {
    const stat = await fs.stat(lockPath);
    const ageMs = Math.max(0, Date.now() - stat.mtimeMs);
    const stale = Number.isFinite(maxAgeMs) && maxAgeMs > 0 && ageMs > maxAgeMs;
    return {
      path: lockPath,
      exists: true,
      stale,
      ageMs,
      maxAgeMs,
      detail: stale ? "采集锁已陈旧，下次运行会自动清理" : "采集任务可能正在运行",
    };
  } catch {
    return {
      path: lockPath,
      exists: false,
      stale: false,
      ageMs: 0,
      maxAgeMs,
      detail: "没有采集锁",
    };
  }
}

async function defaultRequirementCenterStatus({
  apiBase = "http://127.0.0.1:8765",
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") {
    return { apiBase, available: false, detail: "fetch is not available in this Node runtime" };
  }
  try {
    const endpoint = new URL("/api/requirements", apiBase.endsWith("/") ? apiBase : `${apiBase}/`).toString();
    const response = await fetchImpl(endpoint, { method: "GET" });
    return {
      apiBase,
      available: response.ok,
      detail: response.ok ? "requirement center is reachable" : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      apiBase,
      available: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function defaultOcrStatus({
  toolPath = path.join(rootDir, "scripts", "ocr_image.swift"),
  execFileImpl = execFileAsync,
} = {}) {
  let toolExists = false;
  try {
    await fs.access(toolPath);
    toolExists = true;
  } catch {}
  let swiftAvailable = false;
  let swiftDetail = "";
  try {
    const result = await execFileImpl("swift", ["--version"], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    swiftAvailable = true;
    swiftDetail = String(result.stdout || result.stderr || "").split("\n")[0] || "swift is available";
  } catch (error) {
    swiftDetail = error instanceof Error ? error.message : String(error);
  }
  return {
    available: toolExists && swiftAvailable,
    toolPath,
    toolExists,
    swiftAvailable,
    detail: toolExists && swiftAvailable
      ? `macOS Vision OCR helper is ready (${swiftDetail})`
      : `OCR 不可用：${toolExists ? "OCR 脚本存在" : "缺少 OCR 脚本"}；${swiftAvailable ? "Swift 可用" : swiftDetail}`,
  };
}

async function runVisibleCollector({
  configPath,
  statePath,
  statusPath,
  apiBase = "http://127.0.0.1:8765",
  groupName = "",
  nodePath = process.execPath,
  execFileImpl = execFileAsync,
  dryRun = false,
} = {}) {
  const scriptPath = path.join(rootDir, "scripts", "wechat_visible_collect.mjs");
  const args = [
    scriptPath,
    "--config", configPath || path.join(runtimeDir, "wechat-requirement-groups.json"),
    "--state", statePath || path.join(runtimeDir, "wechat-checkpoints.json"),
    "--force",
    "--captureMode", "ocr",
    "--output", statusPath || path.join(runtimeDir, "wechat-last-run.json"),
  ];
  if (groupName) args.push("--group", groupName);
  if (dryRun) {
    args.splice(5, 0, "--dry-run", "--check-window");
  } else {
    args.splice(5, 0, "--push", "--api", apiBase);
  }
  const startedAt = new Date().toISOString();
  try {
    const result = await execFileImpl(nodePath, args, {
      cwd: rootDir,
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const status = await readJsonFile(statusPath || path.join(runtimeDir, "wechat-last-run.json"), { startedAt, finishedAt: new Date().toISOString(), groups: [] });
    return { ok: true, status, stdout: result.stdout || "", stderr: result.stderr || "" };
  } catch (error) {
    const status = await readJsonFile(statusPath || path.join(runtimeDir, "wechat-last-run.json"), { startedAt, finishedAt: new Date().toISOString(), groups: [] });
    return {
      ok: false,
      status,
      stdout: error?.stdout || "",
      stderr: error?.stderr || "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function defaultRunCollectorOnce(options = {}) {
  return runVisibleCollector({ ...options, dryRun: false });
}

async function defaultDryRunCollector(options = {}) {
  return runVisibleCollector({ ...options, dryRun: true });
}

async function defaultRunPipelineSmokeTest({
  nodePath = process.execPath,
  execFileImpl = execFileAsync,
} = {}) {
  const scriptPath = path.join(rootDir, "scripts", "wechat_pipeline_smoke_test.mjs");
  const result = await execFileImpl(nodePath, [scriptPath], {
    cwd: rootDir,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(result.stdout || "{}");
}

function normalizeConfig(payload = {}) {
  const groups = Array.isArray(payload.groups) ? payload.groups : [];
  return {
    groups: groups.map((group) => {
      const rawInterval = group.interval_minutes ?? group.intervalMinutes ?? 15;
      return {
        group_name: String(group.group_name || group.groupName || "").trim(),
        project_name: String(group.project_name || group.projectName || "").trim(),
        customer_name: String(group.customer_name || group.customerName || "").trim(),
        requirement_request_id: String(group.requirement_request_id || group.requirementRequestId || "").trim(),
        enabled: group.enabled !== false,
        interval_minutes: Number(rawInterval),
        initial_collection_mode: normalizeInitialCollectionMode(group.initial_collection_mode || group.initialCollectionMode),
        initial_collected_at: String(group.initial_collected_at || group.initialCollectedAt || "").trim(),
      };
    }).filter((group) => group.group_name),
    llm_parse: normalizeLlmConfig(payload.llm_parse || payload.llmParse || {}),
  };
}

function normalizeInitialCollectionMode(value) {
  return String(value || "ocr_current_window").trim() === "none" ? "none" : "ocr_current_window";
}

function normalizeLlmConfig(payload = {}, previous = {}) {
  const provider = String(payload.provider || previous.provider || "openai").trim();
  const safeProvider = provider === "qwen" ? "qwen" : "openai";
  const defaultEndpoint = safeProvider === "qwen"
    ? "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    : "https://api.openai.com/v1/responses";
  const defaultModel = safeProvider === "qwen" ? "qwen-plus" : "gpt-4.1-mini";
  const clearApiKey = payload.clearApiKey === true || payload.clear_api_key === true;
  const hasNewKey = typeof payload.apiKey === "string" || typeof payload.api_key === "string";
  const nextKey = clearApiKey ? "" : normalizeApiKey(hasNewKey ? payload.apiKey ?? payload.api_key ?? "" : previous.api_key || "");
  return {
    enabled: payload.enabled === true,
    provider: safeProvider,
    model: String(payload.model || previous.model || defaultModel).trim(),
    endpoint: String(payload.endpoint || previous.endpoint || defaultEndpoint).trim(),
    api_key: nextKey,
  };
}

function normalizeApiKey(value) {
  return String(value || "").replace(/\s+/g, "");
}

function redactLlmConfig(config = {}) {
  return {
    enabled: config.enabled === true,
    provider: config.provider || "openai",
    model: config.model || "",
    endpoint: config.endpoint || "",
    apiKeyConfigured: Boolean(config.api_key),
  };
}

function llmModelsEndpoint(endpoint) {
  const url = new URL(endpoint || "https://api.openai.com/v1/responses");
  if (url.pathname.endsWith("/chat/completions")) {
    url.pathname = url.pathname.replace(/\/chat\/completions$/, "/models");
  } else if (url.pathname.endsWith("/responses")) {
    url.pathname = url.pathname.replace(/\/responses$/, "/models");
  } else if (!url.pathname.endsWith("/models")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/models`;
  }
  return url.toString();
}

function normalizeModelListPayload(payload = {}) {
  const items = Array.isArray(payload.data)
    ? payload.data
    : (Array.isArray(payload.models) ? payload.models : []);
  return items
    .map((item) => (typeof item === "string" ? item : item?.id))
    .filter(Boolean);
}

async function fetchLlmModels({ llmConfig, fetchImpl }) {
  if (!llmConfig.api_key) {
    return { ok: false, error: "请先填写或保存 API Key" };
  }
  if (typeof fetchImpl !== "function") {
    return { ok: false, error: "当前 Node 运行时不可用 fetch，无法验证 API Key" };
  }
  let endpoint = "";
  try {
    endpoint = llmModelsEndpoint(llmConfig.endpoint);
  } catch {
    return { ok: false, error: "LLM Endpoint 不是合法 URL" };
  }
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${normalizeApiKey(llmConfig.api_key)}`,
      },
    });
  } catch (error) {
    return { ok: false, error: `模型列表读取失败：${error instanceof Error ? error.message.replace(/Bearer\s+\S+/g, "Bearer ***") : String(error)}` };
  }
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, error: "模型列表响应不是合法 JSON" };
  }
  if (!response.ok) {
    return { ok: false, error: body.error?.message || `模型列表读取失败：HTTP ${response.status}` };
  }
  const models = normalizeModelListPayload(body);
  if (!models.length) {
    return { ok: false, error: "模型列表为空或格式不支持" };
  }
  return { ok: true, models, endpoint };
}

function redactConfig(config = {}) {
  return {
    ...config,
    llm_parse: redactLlmConfig(config.llm_parse || {}),
  };
}

function validateConfig(config) {
  const seen = new Set();
  for (const group of config.groups || []) {
    const name = group.group_name;
    if (seen.has(name)) {
      return { ok: false, error: `微信群名称重复：${name}` };
    }
    if (!Number.isInteger(group.interval_minutes) || group.interval_minutes < 1) {
      return { ok: false, error: `采集间隔必须是正整数：${name}` };
    }
    seen.add(name);
  }
  return { ok: true };
}

function validateRunTargetGroup(config, groupName) {
  if (!groupName) {
    return validateOperationalConfig(config);
  }
  const group = (config.groups || []).find((item) => item.group_name === groupName);
  if (!group) {
    return { ok: false, error: `未配置微信群：${groupName}` };
  }
  if (group.enabled === false) {
    return { ok: false, error: `微信群已停用：${groupName}` };
  }
  return { ok: true };
}

function validateOperationalConfig(config) {
  const configValidation = validateConfig(config);
  if (!configValidation.ok) return configValidation;
  return validateEnabledGroups(config);
}

function validateEnabledGroups(config) {
  const enabledGroups = (config.groups || []).filter((item) => item.enabled !== false);
  if (enabledGroups.length === 0) {
    return { ok: false, error: "还没有启用的微信群配置" };
  }
  return { ok: true };
}

function normalizePipelineSmokeStatus(pipelineSmoke = {}, {
  now = () => new Date(),
  maxAgeMs = 24 * 60 * 60 * 1000,
} = {}) {
  const finishedAt = pipelineSmoke.finishedAt || pipelineSmoke.completedAt || "";
  const finishedTime = new Date(finishedAt).getTime();
  const currentTime = now() instanceof Date ? now().getTime() : new Date(now()).getTime();
  const hasFreshnessTime = Number.isFinite(finishedTime) && Number.isFinite(currentTime);
  const ageMs = hasFreshnessTime ? Math.max(0, currentTime - finishedTime) : null;
  const stale = pipelineSmoke.ok === true && (!hasFreshnessTime || ageMs > maxAgeMs);
  const fresh = pipelineSmoke.ok === true && hasFreshnessTime && ageMs <= maxAgeMs;
  return {
    ...pipelineSmoke,
    finishedAt,
    fresh,
    stale,
    ageMs,
    maxAgeMs,
  };
}

function normalizeRunFreshness(status = {}, {
  now = () => new Date(),
  maxAgeMs = 60 * 60 * 1000,
} = {}) {
  const finishedAt = status.finishedAt || "";
  const finishedTime = new Date(finishedAt).getTime();
  const current = now();
  const currentTime = current instanceof Date ? current.getTime() : new Date(current).getTime();
  const hasFreshnessTime = Number.isFinite(finishedTime) && Number.isFinite(currentTime);
  const ageMs = hasFreshnessTime ? Math.max(0, currentTime - finishedTime) : null;
  return {
    finishedAt,
    fresh: hasFreshnessTime && ageMs <= maxAgeMs,
    stale: hasFreshnessTime && ageMs > maxAgeMs,
    ageMs,
    maxAgeMs,
  };
}

function normalizeRealPushStatus(status = {}, {
  config = { groups: [] },
  history = [],
  now = () => new Date(),
  maxAgeMs = 24 * 60 * 60 * 1000,
} = {}) {
  const current = now();
  const currentTime = current instanceof Date ? current.getTime() : new Date(current).getTime();
  const enabledGroupNames = (config.groups || [])
    .filter((group) => group.enabled !== false)
    .map((group) => group.group_name)
    .filter(Boolean);
  const recentPushByGroup = new Map();
  const stalePushGroups = new Set();
  for (const run of [status, ...history]) {
    for (const group of Array.isArray(run?.groups) ? run.groups : []) {
      if (group.status !== "pushed" || !group.groupName) continue;
      const finishedAt = group.finishedAt || group.lastRunAt || run.finishedAt || "";
      const finishedTime = new Date(finishedAt).getTime();
      const hasFreshnessTime = Number.isFinite(finishedTime) && Number.isFinite(currentTime);
      const ageMs = hasFreshnessTime ? Math.max(0, currentTime - finishedTime) : null;
      if (hasFreshnessTime && ageMs <= maxAgeMs) {
        if (!recentPushByGroup.has(group.groupName)) {
          recentPushByGroup.set(group.groupName, { finishedAt, ageMs });
        }
      } else {
        stalePushGroups.add(group.groupName);
      }
    }
  }
  const verifiedGroupNames = enabledGroupNames.filter((groupName) => recentPushByGroup.has(groupName));
  const missingGroupNames = enabledGroupNames.filter((groupName) => !recentPushByGroup.has(groupName));
  const staleGroupNames = missingGroupNames.filter((groupName) => stalePushGroups.has(groupName));
  const fresh = enabledGroupNames.length > 0 && missingGroupNames.length === 0;
  return {
    pushed: recentPushByGroup.size > 0 || stalePushGroups.size > 0,
    fresh,
    stale: !fresh && staleGroupNames.length > 0,
    finishedAt: status.finishedAt || "",
    ageMs: null,
    maxAgeMs,
    enabledGroupNames,
    verifiedGroupNames,
    missingGroupNames,
    staleGroupNames,
  };
}

function summarizeAttachmentScan(scan = {}, params = {}) {
  const roots = Array.isArray(scan.roots) ? scan.roots : [];
  const files = Array.isArray(scan.files) ? scan.files : [];
  const byType = {};
  for (const file of files) {
    const key = file.kind || file.extension || "unknown";
    byType[key] = (byType[key] || 0) + 1;
  }
  return {
    scannedAt: scan.scannedAt || new Date().toISOString(),
    rootCount: roots.length,
    accessibleRootCount: roots.filter((root) => root.exists).length,
    fileCount: files.length,
    byType,
    params,
  };
}

function buildReadiness({ config, status, service, scheduler, requirementCenter, ocr, lock, pipelineSmoke, realPush, runFreshness }) {
  const groups = config.groups || [];
  const enabledGroups = groups.filter((group) => group.enabled !== false);
  const configValidation = validateConfig(config);
  const runGroups = Array.isArray(status.groups) ? status.groups : [];
  const hasRun = Boolean(status.finishedAt);
  const successfulCollectionStatuses = new Set(["pushed", "collected", "skipped_interval", "no_new_messages", "no_requirement_signal"]);
  const allDryRun = runGroups.length > 0 && runGroups.every((group) => group.status === "dry_run");
  const lastRunOk = hasRun && runGroups.length > 0 && runGroups.every((group) => successfulCollectionStatuses.has(group.status));
  const pushOk = Boolean(realPush?.fresh);
  const pipelineSmokeOk = Boolean(pipelineSmoke?.ok && pipelineSmoke?.fresh);
  const heartbeatOk = !scheduler.loaded || Boolean(runFreshness?.fresh);
  const heartbeatMaxMinutes = Math.max(1, Math.round(Number(runFreshness?.maxAgeMs || 0) / 60000));
  const checks = [
    {
      key: "config_valid",
      label: "微信群配置",
      ok: configValidation.ok,
      detail: configValidation.ok ? "运行时微信群配置合法" : configValidation.error,
    },
    {
      key: "enabled_groups",
      label: "已启用微信群",
      ok: enabledGroups.length > 0,
      detail: enabledGroups.length ? `${enabledGroups.length} 个群已启用` : "还没有启用的微信群配置",
    },
    {
      key: "local_service",
      label: "本机服务",
      ok: Boolean(service.loaded),
      detail: `${service.loaded ? "本机服务 LaunchAgent 已加载" : "本机服务 LaunchAgent 未加载"}；${service.httpReachable ? "HTTP 服务当前可访问" : "HTTP 服务状态未知"}`,
    },
    {
      key: "requirement_center",
      label: "需求中心",
      ok: Boolean(requirementCenter.available),
      detail: requirementCenter.detail || (requirementCenter.available ? "需求中心可用" : "需求中心不可用"),
    },
    {
      key: "ocr_capture",
      label: "截图 OCR",
      ok: Boolean(ocr.available),
      detail: ocr.detail || (ocr.available ? "OCR 采集可用" : "OCR 采集不可用"),
    },
    {
      key: "collector_scheduler",
      label: "采集定时",
      ok: Boolean(scheduler.loaded),
      detail: scheduler.loaded ? "采集定时 LaunchAgent 已加载" : "采集定时 LaunchAgent 未加载",
    },
    {
      key: "scheduler_heartbeat",
      label: "采集心跳",
      ok: heartbeatOk,
      detail: !scheduler.loaded
        ? "采集定时未加载，加载后开始检查运行心跳"
        : (runFreshness?.fresh
          ? `最近运行在 ${heartbeatMaxMinutes} 分钟内`
          : (runFreshness?.stale ? `最近运行已超过 ${heartbeatMaxMinutes} 分钟` : "采集定时已加载但还没有运行摘要")),
    },
    {
      key: "collector_lock",
      label: "采集锁",
      ok: !lock.exists || lock.stale,
      detail: lock.detail || (!lock.exists ? "没有采集锁" : "采集任务可能正在运行"),
    },
    {
      key: "last_run",
      label: "最近运行",
      ok: lastRunOk,
      detail: hasRun
        ? (lastRunOk ? "最近一次采集运行成功" : (allDryRun ? "最近一次是预检脚本，不算正式采集运行" : "最近一次运行包含失败或无结果"))
        : "还没有运行记录",
    },
    {
      key: "requirement_push",
      label: "最近推送",
      ok: pushOk,
      detail: pushOk
        ? `最近 24 小时内 ${realPush.verifiedGroupNames.length} 个已启用群均已完成真实微信试跑`
        : (realPush?.missingGroupNames?.length
          ? `以下已启用群尚未在最近 24 小时完成真实微信试跑：${realPush.missingGroupNames.join("、")}`
          : "还没有完成真实微信试跑并推送到需求中心"),
    },
    {
      key: "pipeline_smoke",
      label: "链路自检",
      ok: pipelineSmokeOk,
      detail: pipelineSmokeOk
        ? "最近链路自检通过"
        : (pipelineSmoke?.stale ? "链路自检已超过 24 小时，请重新运行" : "还没有通过链路自检"),
    },
  ];
  return {
    ready: checks.every((item) => item.ok),
    checks,
  };
}

function addMinutes(isoTime, minutes) {
  const date = new Date(isoTime || "");
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + Math.max(1, Number(minutes || 15)) * 60 * 1000).toISOString();
}

function isValidIntervalMinutes(value) {
  return Number.isInteger(value) && value >= 1;
}

function buildGroupStatusSummary({ config, status, state }) {
  const runGroups = Array.isArray(status.groups) ? status.groups : [];
  const runByName = new Map(runGroups.map((group) => [group.groupName, group]));
  const checkpoints = state?.groups || {};
  return (config.groups || []).map((group) => {
    const groupName = group.group_name || "";
    const latestRun = runByName.get(groupName) || {};
    const checkpoint = checkpoints[groupName] || {};
    const intervalMinutes = Number(group.interval_minutes);
    const latestRunAt = latestRun.lastRunAt || latestRun.finishedAt || status.finishedAt || checkpoint.updatedAt || "";
    const checkpointUpdatedAt = checkpoint.updatedAt || "";
    return {
      groupName,
      projectName: group.project_name || "",
      customerName: group.customer_name || "",
      requirementRequestId: group.requirement_request_id || "",
      enabled: group.enabled !== false,
      intervalMinutes,
      initialCollectionMode: group.initial_collection_mode || "ocr_current_window",
      initialCollectedAt: group.initial_collected_at || checkpoint.ocr?.initialCollectedAt || "",
      latestStatus: latestRun.status || "not_run",
      latestRunAt,
      requestId: latestRun.requestId || checkpoint.requestId || group.requirement_request_id || "",
      messageCount: Number(latestRun.messageCount || 0),
      changeCount: Number(latestRun.changeCount || 0),
      latestError: latestRun.error || "",
      checkpointUpdatedAt,
      nextRunAt: latestRun.nextRunAt || (isValidIntervalMinutes(intervalMinutes)
        ? addMinutes(checkpointUpdatedAt || latestRunAt, intervalMinutes)
        : ""),
    };
  });
}

export function createWechatCollectorHandler(options = {}) {
  const configPath = options.configPath || path.join(runtimeDir, "wechat-requirement-groups.json");
  const configBackupDir = options.configBackupDir || path.join(runtimeDir, "wechat-config-backups");
  const statusPath = options.statusPath || path.join(runtimeDir, "wechat-last-run.json");
  const preflightStatusPath = options.preflightStatusPath || path.join(runtimeDir, "wechat-preflight-run.json");
  const pipelineSmokeStatusPath = options.pipelineSmokeStatusPath || path.join(runtimeDir, "wechat-pipeline-smoke.json");
  const attachmentScanStatusPath = options.attachmentScanStatusPath || path.join(runtimeDir, "wechat-attachment-scan.json");
  const historyPath = options.historyPath || path.join(path.dirname(statusPath), "wechat-run-history.jsonl");
  const historyLimit = Number(options.historyLimit || 20);
  const realPushHistoryLimit = Number(options.realPushHistoryLimit || 500);
  const statePath = options.statePath || path.join(runtimeDir, "wechat-checkpoints.json");
  const apiBase = options.apiBase || "http://127.0.0.1:8765";
  const lockPath = options.lockPath || path.join(runtimeDir, "wechat-visible-collect.lock");
  const lockMaxAgeMs = Number(options.lockMaxAgeMs || 30 * 60 * 1000);
  const logPaths = options.logPaths || {};
  const logMaxChars = Number(options.logMaxChars || 4000);
  const pipelineSmokeMaxAgeMs = Number(options.pipelineSmokeMaxAgeMs || 24 * 60 * 60 * 1000);
  const realPushMaxAgeMs = Number(options.realPushMaxAgeMs || 24 * 60 * 60 * 1000);
  const lastRunMaxAgeMs = Number(options.lastRunMaxAgeMs || 60 * 60 * 1000);
  const now = options.now || (() => new Date());
  const scanAttachments = options.scanAttachments || scanWechatDownloadedFiles;
  const schedulerStatus = options.schedulerStatus || getWechatCollectorLaunchdStatus;
  const serviceStatus = options.serviceStatus || getEasyExamServiceLaunchdStatus;
  const installScheduler = options.installScheduler || installWechatCollectorLaunchd;
  const uninstallScheduler = options.uninstallScheduler || uninstallWechatCollectorLaunchd;
  const installService = options.installService || installEasyExamServiceLaunchd;
  const uninstallService = options.uninstallService || uninstallEasyExamServiceLaunchd;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const requirementCenterStatus = options.requirementCenterStatus || (() => defaultRequirementCenterStatus({
    apiBase,
    fetchImpl,
  }));
  const ocrStatus = options.ocrStatus || (() => defaultOcrStatus({
    toolPath: options.ocrToolPath,
    execFileImpl: options.execFileImpl || execFileAsync,
  }));
  const runCollectorOnce = options.runCollectorOnce || ((runOptions = {}) => defaultRunCollectorOnce({
    configPath,
    statePath,
    statusPath,
    apiBase,
    nodePath: options.nodePath || process.execPath,
    execFileImpl: options.execFileImpl || execFileAsync,
    ...runOptions,
  }));
  const dryRunCollector = options.dryRunCollector || ((runOptions = {}) => defaultDryRunCollector({
    configPath,
    statePath,
    statusPath: preflightStatusPath,
    apiBase,
    nodePath: options.nodePath || process.execPath,
    execFileImpl: options.execFileImpl || execFileAsync,
    ...runOptions,
  }));
  const runPipelineSmokeTest = options.runPipelineSmokeTest || (() => defaultRunPipelineSmokeTest({
    nodePath: options.nodePath || process.execPath,
    execFileImpl: options.execFileImpl || execFileAsync,
  }));
  const json = options.json || defaultJson;
  const readBody = options.readBody || defaultReadBody;
  const validateFreshPipelineSmoke = async () => {
    const pipelineSmoke = normalizePipelineSmokeStatus(
      await readJsonFile(pipelineSmokeStatusPath, { ok: false, requestId: "", requirement: null }),
      { now, maxAgeMs: pipelineSmokeMaxAgeMs },
    );
    if (pipelineSmoke.ok !== true) {
      return { ok: false, error: "还没有通过链路自检，请先运行链路自检" };
    }
    if (!pipelineSmoke.fresh) {
      return {
        ok: false,
        error: pipelineSmoke.stale ? "链路自检已超过 24 小时，请重新运行" : "还没有通过链路自检，请先运行链路自检",
      };
    }
    return { ok: true, pipelineSmoke };
  };
  const validateFreshRealPush = async () => {
    const config = normalizeConfig(await readJsonFile(configPath, { groups: [] }));
    const history = await readRunHistory(historyPath, realPushHistoryLimit);
    const realPush = normalizeRealPushStatus(
      await readJsonFile(statusPath, { startedAt: "", finishedAt: "", groups: [] }),
      { config, history, now, maxAgeMs: realPushMaxAgeMs },
    );
    if (!realPush.fresh) {
      return {
        ok: false,
        error: realPush.missingGroupNames.length
          ? `以下已启用微信群尚未在最近 24 小时完成真实微信试跑：${realPush.missingGroupNames.join("、")}`
          : "还没有完成真实微信试跑，请先点击“立即试跑”",
      };
    }
    return { ok: true, realPush };
  };

  return async function handleWechatCollector(req, res, url = new URL(req.url, "http://127.0.0.1")) {
    if (req.method === "GET" && url.pathname === "/api/wechat-collector/config") {
      const config = normalizeConfig(await readJsonFile(configPath, { groups: [] }));
      json(res, 200, { config: redactConfig(config), path: configPath });
      return true;
    }

    if (req.method === "PUT" && url.pathname === "/api/wechat-collector/config") {
      const payload = parseJsonSafe(await readBody(req)) || {};
      const previousConfig = normalizeConfig(await readJsonFile(configPath, { groups: [] }));
      const config = normalizeConfig({
        ...payload,
        llm_parse: normalizeLlmConfig(payload.llm_parse || payload.llmParse || {}, previousConfig.llm_parse || {}),
      });
      const validation = validateConfig(config);
      if (!validation.ok) {
        json(res, 400, { error: validation.error });
        return true;
      }
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      const backupPath = await backupExistingJsonFile(configPath, configBackupDir, now);
      await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
      json(res, 200, { ok: true, config: redactConfig(config), path: configPath, backupPath });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wechat-collector/llm/models") {
      const payload = parseJsonSafe(await readBody(req)) || {};
      const previousConfig = normalizeConfig(await readJsonFile(configPath, { groups: [] }));
      const llmConfig = normalizeLlmConfig(payload.llm_parse || payload.llmParse || {}, previousConfig.llm_parse || {});
      const result = await fetchLlmModels({ llmConfig, fetchImpl });
      json(res, result.ok ? 200 : 400, result);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wechat-collector/config/restore") {
      const payload = parseJsonSafe(await readBody(req)) || {};
      const fileName = String(payload.fileName || "").trim();
      if (!fileName || fileName !== path.basename(fileName) || !fileName.endsWith(".json")) {
        json(res, 400, { error: "备份文件名不合法" });
        return true;
      }
      const backupPath = path.join(configBackupDir, fileName);
      let rawConfig = null;
      try {
        rawConfig = await readRequiredJsonFile(backupPath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          json(res, 404, { error: "备份文件不存在" });
          return true;
        }
        json(res, 400, { error: "备份配置不是合法 JSON" });
        return true;
      }
      const config = normalizeConfig(rawConfig);
      const validation = validateConfig(config);
      if (!validation.ok) {
        json(res, 400, { error: `备份配置不合法：${validation.error}` });
        return true;
      }
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      const currentBackupPath = await backupExistingJsonFile(configPath, configBackupDir, now);
      await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
      json(res, 200, { ok: true, config: redactConfig(config), path: configPath, backupPath, currentBackupPath });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/wechat-collector/status") {
      const status = await readJsonFile(statusPath, { startedAt: "", finishedAt: "", groups: [] });
      const runFreshness = normalizeRunFreshness(status, { now, maxAgeMs: lastRunMaxAgeMs });
      const preflight = await readJsonFile(preflightStatusPath, { startedAt: "", finishedAt: "", groups: [] });
      const pipelineSmoke = normalizePipelineSmokeStatus(
        await readJsonFile(pipelineSmokeStatusPath, { ok: false, requestId: "", requirement: null }),
        { now, maxAgeMs: pipelineSmokeMaxAgeMs },
      );
      const attachmentScan = await readJsonFile(attachmentScanStatusPath, null);
      const configBackups = await listRecentConfigBackups(configBackupDir);
      const config = normalizeConfig(await readJsonFile(configPath, { groups: [] }));
      const state = await readJsonFile(statePath, { groups: {} });
      const service = { ...serviceStatus(), httpReachable: true };
      const scheduler = schedulerStatus();
      const requirementCenter = await requirementCenterStatus();
      const ocr = await ocrStatus();
      const lock = await readCollectorLockStatus(lockPath, lockMaxAgeMs);
      const history = await readRunHistory(historyPath, historyLimit);
      const realPushHistory = historyLimit >= realPushHistoryLimit
        ? history
        : await readRunHistory(historyPath, realPushHistoryLimit);
      const realPush = normalizeRealPushStatus(status, {
        config,
        history: realPushHistory,
        now,
        maxAgeMs: realPushMaxAgeMs,
      });
      json(res, 200, {
        status,
        runFreshness,
        preflight,
        pipelineSmoke,
        attachmentScan,
        configBackups,
        history,
        service,
        scheduler,
        requirementCenter,
        ocr,
        lock,
        groups: buildGroupStatusSummary({ config, status, state }),
        readiness: buildReadiness({ config, status, service, scheduler, requirementCenter, ocr, lock, pipelineSmoke, realPush, runFreshness }),
        logs: await readCollectorLogs(logPaths, logMaxChars),
        path: statusPath,
        preflightPath: preflightStatusPath,
        pipelineSmokePath: pipelineSmokeStatusPath,
        attachmentScanPath: attachmentScanStatusPath,
        historyPath,
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/wechat-collector/attachments/scan") {
      const roots = url.searchParams.getAll("root").filter(Boolean);
      const maxFilesParam = parseIntegerQueryParam(url, "maxFiles", { defaultValue: 50, min: 1, max: 500 });
      const previewCharsParam = parseIntegerQueryParam(url, "previewChars", { defaultValue: 1200, min: 0, max: 5000 });
      if (!maxFilesParam.ok || !previewCharsParam.ok) {
        json(res, 400, { error: maxFilesParam.error || previewCharsParam.error });
        return true;
      }
      const maxFiles = maxFilesParam.value;
      const previewChars = previewCharsParam.value;
      const modifiedSince = url.searchParams.get("modifiedSince") || "";
      const scan = scanAttachments({
        roots: roots.length ? roots : defaultWechatFileRoots(),
        maxFiles,
        previewChars,
        modifiedSince,
      });
      const summary = summarizeAttachmentScan(scan, {
        rootCount: Array.isArray(scan.roots) ? scan.roots.length : roots.length || defaultWechatFileRoots().length,
        maxFiles,
        previewChars,
        modifiedSince,
      });
      await writeJsonFile(attachmentScanStatusPath, summary);
      json(res, 200, {
        ok: true,
        scan,
        summary,
      });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wechat-collector/pipeline-smoke-test") {
      let result;
      try {
        result = await runPipelineSmokeTest();
      } catch (error) {
        result = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          finishedAt: new Date().toISOString(),
        };
      }
      result = {
        ...result,
        finishedAt: result?.finishedAt || new Date().toISOString(),
      };
      await writeJsonFile(pipelineSmokeStatusPath, result);
      const ok = result?.ok === true;
      json(res, ok ? 200 : 500, { ok, result });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wechat-collector/scheduler/install") {
      const config = normalizeConfig(await readJsonFile(configPath, { groups: [] }));
      const validation = validateOperationalConfig(config);
      if (!validation.ok) {
        json(res, 400, { error: validation.error });
        return true;
      }
      const pipelineSmokeValidation = await validateFreshPipelineSmoke();
      if (!pipelineSmokeValidation.ok) {
        json(res, 400, { error: pipelineSmokeValidation.error });
        return true;
      }
      const realPushValidation = await validateFreshRealPush();
      if (!realPushValidation.ok) {
        json(res, 400, { error: realPushValidation.error });
        return true;
      }
      json(res, 200, { ok: true, scheduler: installScheduler() });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wechat-collector/scheduler/uninstall") {
      json(res, 200, { ok: true, scheduler: uninstallScheduler() });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wechat-collector/service/install") {
      json(res, 200, { ok: true, service: installService() });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wechat-collector/service/uninstall") {
      json(res, 200, { ok: true, service: uninstallService() });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wechat-collector/automation/install") {
      const config = normalizeConfig(await readJsonFile(configPath, { groups: [] }));
      const validation = validateOperationalConfig(config);
      if (!validation.ok) {
        json(res, 400, { error: validation.error });
        return true;
      }
      const pipelineSmokeValidation = await validateFreshPipelineSmoke();
      if (!pipelineSmokeValidation.ok) {
        json(res, 400, { error: pipelineSmokeValidation.error });
        return true;
      }
      const realPushValidation = await validateFreshRealPush();
      if (!realPushValidation.ok) {
        json(res, 400, { error: realPushValidation.error });
        return true;
      }
      const service = installService();
      try {
        const scheduler = installScheduler();
        json(res, 200, { ok: true, service, scheduler });
      } catch (error) {
        let rollback = {};
        try {
          rollback = { service: uninstallService() };
        } catch (rollbackError) {
          rollback = { error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) };
        }
        json(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          service,
          rollback,
        });
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wechat-collector/automation/uninstall") {
      const scheduler = uninstallScheduler();
      const service = uninstallService();
      json(res, 200, { ok: true, service, scheduler });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wechat-collector/run-once") {
      const payload = parseJsonSafe(await readBody(req)) || {};
      const groupName = String(payload.groupName || url.searchParams.get("groupName") || "").trim();
      const config = normalizeConfig(await readJsonFile(configPath, { groups: [] }));
      const validation = groupName ? validateConfig(config) : validateOperationalConfig(config);
      if (!validation.ok) {
        json(res, 400, { error: validation.error });
        return true;
      }
      const targetValidation = validateRunTargetGroup(config, groupName);
      if (!targetValidation.ok) {
        json(res, 400, { error: targetValidation.error });
        return true;
      }
      const requirementCenter = await requirementCenterStatus();
      if (!requirementCenter.available) {
        const detail = requirementCenter.detail ? `：${requirementCenter.detail}` : "";
        json(res, 400, { error: `需求中心不可用${detail}` });
        return true;
      }
      json(res, 200, { ok: true, run: await runCollectorOnce({ configPath, statePath, statusPath, apiBase, groupName }) });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/wechat-collector/dry-run") {
      const config = normalizeConfig(await readJsonFile(configPath, { groups: [] }));
      const validation = validateOperationalConfig(config);
      if (!validation.ok) {
        json(res, 400, { error: validation.error });
        return true;
      }
      json(res, 200, { ok: true, run: await dryRunCollector({ configPath, statePath, statusPath: preflightStatusPath, apiBase }) });
      return true;
    }

    return false;
  };
}

export const handleWechatCollector = createWechatCollectorHandler();
