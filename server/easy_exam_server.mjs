import fs from "node:fs/promises";
import fsSync from "node:fs";
import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  bindCoursesToFormalSession,
  createSessionsThenConfigureCourses,
} from "./course_session_binding.mjs";
import { bindPapersToFormalSession, detectSessionPaperBindings } from "./paper_binding.mjs";
import { shouldSkipRecentFailedPaperBindCheck } from "./paper_bind_scheduler.mjs";
import { fetchPaperUnitInfo } from "./paper_unit_info.mjs";
import { bindDefaultTrialPaperToSession } from "./trial_default_paper.mjs";
import {
  assignCourseCodesForExamConfig,
  ensureFormalCoursesCreated,
  normalizeCourseRecords,
} from "./course_creation.mjs";
import { prepareCandidatesForCourseImport } from "./candidate_course_assignment.mjs";
import { buildTenantCandidateEntries } from "./candidate_tenant_payload.mjs";
import {
  normalizeCustomPersonalFieldNames,
  normalizeCustomPersonalFieldRequests,
  normalizeImportPersonalFieldRequests,
  syncImportPersonalFields,
} from "./candidate_personal_fields.mjs";
import { isFrontendRoute, webContentType } from "./frontend_routes.mjs";
import {
  buildAuthContext,
  buildLoginCookie,
  buildLogoutCookie,
  canViewOwner,
  createSession,
  deleteLocalUser,
  deleteSession,
  deleteSessionsForEmail,
  getSessionUser,
  isAdminUser,
  normalizeEmail,
  parseCookies,
  restoreSessions,
  sanitizeUsers,
  serializeSessions,
  shouldAllowWithoutAuth,
  updateLocalUser,
  upsertLocalUser,
  verifyLogin,
} from "./local_auth.mjs";
import { handleRequirementRequest } from "./requirement_request_api.mjs";
import {
  acquireOperationBatchCreation,
  buildOperationBatchDraft,
  operationBatchCodeIsValid,
  operationBatchDraftForReconciliation,
  operationBatchFailureState,
  operationBatchNeedsReconciliation,
  releaseOperationBatchCreation,
  resolveOperationBatchResultWrite,
} from "./operation_batch.mjs";
import { runOperationBatchCreationFlow } from "./operation_batch_creation_flow.mjs";
import {
  createOperationBatchCoordinator,
  operationBatchCreationFailureResponse,
  readFreshOperationBatchTask,
  withFreshOperationBatchTask,
} from "./operation_batch_coordinator.mjs";
import {
  applyOperationBatchManagedResult,
  buildDesiredOperationBatchSnapshot,
} from "./operation_batch_update.mjs";
import {
  inspectOperationBatchManagedSnapshot,
  runOperationBatchManagedUpdate,
  runOperationBatchScheduleInitialization,
} from "./operation_batch_update_runner.mjs";
import {
  createOperationBatchUpdateApi,
  createOperationBatchUpdateService,
} from "./operation_batch_update_service.mjs";
import {
  checkOperationConsoleAutomationEnvironment,
  enableOperationConsoleAutomation,
  installOperationConsoleAutomationDeps,
} from "./operation_console_env.mjs";
import {
  OPERATION_BATCH_RECONCILIATION_REQUIRED,
  runOperationBatchCreation,
  runOperationBatchReconciliation,
} from "./operation_batch_runner.mjs";
import { createOperationPersonnelTaskService } from "./operation_personnel_task_service.mjs";
import {
  runOperationPersonnelAttempt,
  runOperationPersonnelInspection,
  runOperationPersonnelRecheck,
} from "./operation_personnel_task_runner.mjs";
import { deleteTaskSessionsFromTenant } from "./session_deletion.mjs";
import { calculateRoomSizes } from "./room_assignment.mjs";
import {
  apiKeyHint,
  apiKeyProfileId,
  apiKeyProfileCredentialsForUser,
  apiKeyProfilesForUser,
  currentUserLogin,
  deleteApiKeyProfileForUser,
  defaultUserSettings,
  normalizeUserSettings,
  loginForApiKeyProfile,
  publicApiKeyProfiles,
  publicApiKeyProfilesForUser,
  saveUserLogin,
  updateApiKeyProfileForUser,
  upsertApiKeyProfileInRecord,
} from "./user_settings.mjs";
import { runCustomerServiceSchedulerForTargets } from "./customer_service_scheduler.mjs";
import {
  appendSessionChangeHistory,
  buildSessionChangeDiff,
  editableSessionFieldsFromDetail,
  fetchTenantSessionDetail,
  localSessionFieldsForChange,
  mergeSessionChangePayload,
  putTenantSessionDetail,
  sessionChangeBasePayloadFromTask,
  sessionChangeHistoryFromStep,
  sessionChangeSummary,
  tenantSessionChangeErrorMessage,
  validateSessionChangeRequest,
} from "./session_change.mjs";
import {
  syncExamConfigToTencentDocs,
  tencentDocsSettingsFromEnv,
} from "./tencent_docs_sync.mjs";
import { handleWechatCollector } from "./wechat_collector_api.mjs";
import { createFanweiBridgeStore } from "./fanwei_bridge.mjs";
import {
  buildFanweiRequirementModel,
  normalizeFanweiDomPayload,
  validateFanweiReadPayload,
} from "./fanwei_requirement_mapper.mjs";
import {
  buildFanweiProjectConfig,
  buildProjectWorkflow,
  normalizeFanweiBusinessRequirement,
} from "./project_workflow.mjs";
import {
  defaultOperationBatchName,
  resolveOperationBatchName,
  withOperationBatchNameEditorDefaults,
} from "./operation_batch_name.mjs";
import { buildAutoConfigFromRequirement } from "./requirement_auto_config_adapter.mjs";
import {
  buildWindowsChromeLaunchArgs,
  createChromeDevToolsTab,
  evaluateChromeDevToolsExpression,
  fetchChromeDevToolsTabs,
  fanweiAutoReadPlatform,
  fanweiAutoReadUnavailableMessage,
  findMacChromeExecutable,
  findWindowsChromeExecutable,
  runChromeDevToolsFanweiRead,
  uploadFilesToChromeDevToolsFileInput,
} from "./fanwei_auto_read.mjs";
import {
  buildScoreStampAttachmentPrepareScript,
  buildScoreStampApplicationFillScript,
  buildScoreStampApplicationPayload,
  buildScoreStampApplicationSaveScript,
} from "./score_stamp_application.mjs";
import {
  normalizeEmailSettings,
  redactEmailSettings,
  sendContentRequirementEmail,
  writeEmailSettingsFile,
} from "./content_requirement_email.mjs";
import { convertScoreFeedbackToPdf } from "./score_feedback_pdf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const webFile = path.join(rootDir, "outputs", "web_prototype", "easy_exam_automation.html");
const webModulesDir = path.join(rootDir, "web");
const runtimeDir = path.resolve(rootDir, process.env.EASY_EXAM_RUNTIME_DIR || ".easy_exam_runtime");
const sessionChangeFeatureEnabled =
  process.env.SESSION_CHANGE_ENABLED === "1" ||
  path.basename(runtimeDir) === ".easy_exam_runtime_test";
const uploadsDir = path.join(runtimeDir, "uploads");
const generatedDir = path.join(runtimeDir, "generated");
const settingsPath = path.join(runtimeDir, "settings.json");
const authSettingsPath = path.join(runtimeDir, "auth.json");
const authUsersPath = path.join(runtimeDir, "auth_users.json");
const authSessionsPath = path.join(runtimeDir, "auth_sessions.json");
const userSettingsPath = path.join(runtimeDir, "user_settings.json");
const emailSettingsPath = path.join(runtimeDir, "email_settings.json");
const parserScript = path.join(__dirname, "exam_request_parser.py");
const fanweiWorkbookScript = path.join(__dirname, "fanwei_requirement_workbook.py");
const candidateParserScript = path.join(__dirname, "candidate_list_parser.py");
const monitorAccountExporterScript = path.join(__dirname, "monitor_account_exporter.py");
const scoreFeedbackExporterScript = path.join(__dirname, "score_feedback_exporter.py");
const zipDirectoryScript = path.join(__dirname, "zip_directory.py");
const taskStateScript = path.join(__dirname, "task_state_db.py");
const requirementStateScript = path.join(__dirname, "requirement_request_db.py");
const scoreFeedbackTemplatePath = path.join(rootDir, "template", "成绩单模板.xlsx");
const examRequestTemplatePath = path.join(rootDir, "template", "v2易考新建考试需求单.xlsx");
const fanweiHelperRuntimePackagesDir = path.join(runtimeDir, "fanwei-helper");
const fanweiHelperProjectPackagesDir = path.resolve(
  process.env.EASY_EXAM_FANWEI_HELPER_PACKAGES_DIR || path.join(rootDir, "dist", "fanwei-helper"),
);
const taskDbPath = path.join(runtimeDir, "task_state.sqlite3");
const requirementDbPath = path.resolve(
  rootDir,
  process.env.REQUIREMENT_DB_PATH || path.join(rootDir, ".easy_exam_runtime", "requirement_requests.sqlite3"),
);
function resolvePythonBin() {
  if (process.env.CODEX_PYTHON) return process.env.CODEX_PYTHON;
  if (process.env.PYTHON) return process.env.PYTHON;
  const bundledPython = path.join(
    process.env.HOME || "",
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    "bin",
    "python3",
  );
  if (fsSync.existsSync(bundledPython)) return bundledPython;
  return "python3";
}
const pythonBin = resolvePythonBin();
const PAPER_BIND_SCHEDULER_INTERVAL_MS = Number(process.env.PAPER_BIND_SCHEDULER_INTERVAL_MS || 60 * 60 * 1000);
const PAPER_BIND_SCHEDULER_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAPER_BIND_FAILURE_COOLDOWN_MS = Number(process.env.PAPER_BIND_FAILURE_COOLDOWN_MS || 60 * 60 * 1000);
const fanweiBridge = createFanweiBridgeStore();

async function loadEnvFile() {
  const envPath = path.join(rootDir, ".env");
  try {
    const raw = await fs.readFile(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const key = match[1];
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {}
}

const state = {
  imports: new Map(),
  candidateImports: new Map(),
  jobs: new Map(),
  settings: {
    login: {
      url: "",
      username: "",
      password: "",
      tenantApiKey: "",
    },
  },
  auth: {},
  authUsers: [],
  authSessions: [],
  userSettings: defaultUserSettings(),
};

function json(res, code, payload) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function corsJson(res, code, payload) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function badRequest(res, message) {
  json(res, 400, { error: message });
}

function notFound(res) {
  json(res, 404, { error: "Not found" });
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function redirectToLogin(_req, res, url) {
  const next = `${url.pathname}${url.search}`;
  redirect(res, `/login?next=${encodeURIComponent(next)}`);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function ensureRuntime() {
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.mkdir(generatedDir, { recursive: true });
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw);
    state.settings = {
      ...state.settings,
      ...parsed,
      login: {
        ...state.settings.login,
        ...(parsed.login || {}),
      },
    };
  } catch {}
  try {
    const raw = await fs.readFile(authSettingsPath, "utf8");
    state.auth = JSON.parse(raw);
  } catch {}
  try {
    const raw = await fs.readFile(authUsersPath, "utf8");
    state.authUsers = JSON.parse(raw);
  } catch {}
  try {
    const raw = await fs.readFile(authSessionsPath, "utf8");
    state.authSessions = JSON.parse(raw);
  } catch {
    state.authSessions = [];
  }
  try {
    const raw = await fs.readFile(userSettingsPath, "utf8");
    state.userSettings = normalizeUserSettings(JSON.parse(raw));
  } catch {
    state.userSettings = defaultUserSettings();
  }
}

function parseJsonSafe(buffer) {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    return null;
  }
}

function decodeName(raw = "") {
  return decodeURIComponent(raw).replace(/[^\w.\-\u4e00-\u9fff]/g, "_");
}

function safeFileName(raw = "file") {
  return decodeName(raw).slice(0, 160) || "file";
}

function safeExcelFileName(raw = "monitor_accounts") {
  const base = safeFileName(raw).replace(/\.(xlsx|xls|csv)$/i, "").trim() || "monitor_accounts";
  return `${base}.xlsx`;
}

function safeZipFileName(raw = "archive") {
  const base = safeFileName(raw).replace(/\.zip$/i, "").trim() || "archive";
  return `${base}.zip`;
}

function monitorSessionUrl(sessionId) {
  const normalized = String(sessionId || "").trim();
  return normalized ? `https://eztest.org/monitor/session/${encodeURIComponent(normalized)}/` : "";
}

function normalizeApiBase(base) {
  return String(base || "https://eztest.cn").replace(/\/+$/, "");
}

function tenantHeadersForLogin(login = {}, extra = {}) {
  const apiKey = login.tenantApiKey || (login.allowEnvFallback ? process.env.YIKAO_API_KEY : "");
  if (!apiKey) {
    throw new Error("未配置租户 API Key，请在后台连接中填写并保存。");
  }
  return {
    Authorization: `Key ${apiKey}`,
    ...extra,
  };
}

function tenantErrorMessage(status, action) {
  return status === 401
    ? `租户 API 返回 401，请检查租户 API Key。`
    : status === 403
      ? `租户 API 返回 403，当前 Key 无权限${action}。`
      : status === 429
        ? "租户 API 返回 429，请稍后重试。"
        : `租户 API ${action}失败：${status}`;
}

async function readTenantJsonWithLogin(login, tenantUrl, options = {}, action = "请求") {
  const { includeResponseMeta = false, ...fetchOptions } = options;
  const response = await fetch(tenantUrl, {
    ...fetchOptions,
    headers: tenantHeadersForLogin(login, fetchOptions.headers || {}),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const error = new Error(tenantErrorMessage(response.status, action));
    error.status = response.status;
    error.detail = payload;
    throw error;
  }
  return includeResponseMeta
    ? { __tenantResponse: true, httpStatus: response.status, body: payload }
    : payload;
}

function normalizeSessionDate(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{1,2})/);
  if (!match) return text;
  const [, year, month, day, hour, minute] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function boolValue(value) {
  if (typeof value === "boolean") return value;
  const text = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "是", "需要", "开启", "开启录制"].includes(text);
}

function positiveNumber(value, fallback = undefined) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(String(value).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function buildPersonalInformation() {
  return {
    full_name: {
      editable: false,
      required: false,
      visible: true,
      default: true,
      type: "text",
      order: 0,
      label: "姓名",
    },
    email: {
      editable: false,
      required: false,
      visible: false,
      type: "email",
      order: 1,
      label: "邮箱",
    },
    phone: {
      editable: false,
      required: false,
      visible: false,
      type: "text",
      order: 2,
      label: "手机号码",
    },
    gender: {
      editable: false,
      required: false,
      visible: false,
      type: "radio",
      choices: ["男", "女"],
      order: 3,
      label: "性别",
    },
    identity_id: {
      editable: false,
      required: false,
      visible: true,
      default: true,
      type: "text",
      order: 4,
      label: "身份证号",
    },
    id_number: {
      editable: false,
      required: false,
      visible: false,
      type: "text",
      order: 5,
      label: "证件号",
    },
  };
}

function applyTimeRule(payload, rule, fallbackRule = "") {
  const normalized = String(rule || fallbackRule || "").replace(/\s+/g, "");
  delete payload.later_deduction;
  delete payload.auto_add_time;

  if (!normalized) return;
  if (normalized.includes("不扣时")) {
    payload.later_deduction = false;
    return;
  }
  if (normalized.includes("迟到及离开")) {
    payload.auto_add_time = false;
    return;
  }
  if (normalized.includes("迟到")) {
    payload.later_deduction = true;
  }
}

function extractSessionId(result) {
  return (
    result?.id ||
    result?.session_id ||
    result?.data?.id ||
    result?.data?.session_id ||
    result?.session?.id ||
    ""
  );
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function saveApiCreationCapture(job, created) {
  const shotsDir = path.join(runtimeDir, "shots", job.id);
  await fs.mkdir(shotsDir, { recursive: true });
  const fileName = "api-create-confirm.svg";
  const rows = created
    .map((item, index) => {
      const y = 250 + index * 94;
      const kind = item.kind === "mock" ? "试考" : "正式考试";
      return `
        <rect x="92" y="${y}" width="1360" height="64" rx="18" fill="#f8fafc" stroke="#dbe4f0"/>
        <text x="124" y="${y + 40}" font-size="28" font-weight="700" fill="#0f172a">${escapeXml(kind)}</text>
        <text x="310" y="${y + 40}" font-size="26" fill="#1e293b">${escapeXml(item.name)}</text>
        <text x="930" y="${y + 40}" font-size="24" fill="#64748b">session_id: ${escapeXml(item.id || "-")}</text>
        <text x="124" y="${y + 88}" font-size="22" fill="#64748b">${escapeXml(item.start || "")} ~ ${escapeXml(item.end || "")}</text>
      `;
    })
    .join("");
  const height = Math.max(520, 340 + created.length * 94);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1544" height="${height}" viewBox="0 0 1544 ${height}">
  <rect width="1544" height="${height}" fill="#f5f7fb"/>
  <rect x="56" y="56" width="1432" height="${height - 112}" rx="28" fill="#ffffff" stroke="#d9e2ef"/>
  <text x="92" y="126" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="34" font-weight="800" fill="#0f172a">易考创建完成确认</text>
  <text x="92" y="174" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="22" fill="#64748b">租户 API 已返回创建成功结果，以下为本次创建的考试场次。</text>
  <rect x="92" y="202" width="230" height="42" rx="21" fill="#ecfdf5"/>
  <circle cx="120" cy="223" r="11" fill="#22c55e"/>
  <text x="144" y="231" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="20" font-weight="700" fill="#15803d">创建完成</text>
  <g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">${rows}</g>
</svg>`;
  await fs.writeFile(path.join(shotsDir, fileName), svg, "utf8");
  return {
    title: "创建完成",
    url: `/artifacts/${encodeURIComponent(job.id)}/${encodeURIComponent(fileName)}`,
  };
}

function buildSessionPayloads(config) {
  const videoMonitor = boolValue(config.videoMonitor);
  const clientExam = boolValue(config.clientExam) || String(config.examType || "").includes("客户端");
  const preLoginPrompt = normalizeRequirementRichField(config.preLoginPrompt);
  const pledgeContent = normalizeRequirementRichField(config.pledgeContent);
  const usePostPoliceVerify = videoMonitor && String(config.loginVerifyMode || "考后公安验证").includes("考后公安");
  const unifiedExamAddress =
    boolValue(config.unifiedExamAddress) || String(config.examAddress || config.examUrlType || "").includes("统一");
  const common = {
    allow_anonymous: false,
    unified_exam_address: unifiedExamAddress,
    face_detection: false,
    face_detection_dur: true,
    face_detection_review: false,
    police_detection: false,
    police_detection_after: usePostPoliceVerify,
    app_required: false,
    publish_permit: false,
    ip_white_list: false,
    public_score: false,
    show_score_detail: false,
    publish_score: false,
    send_result_email: false,
    manual_score: boolValue(config.manualScore),
    new_mark: false,
    practice_mode: false,
    monitor: videoMonitor,
    monitor_replay: true,
    anonymous_monitor: true,
    audio_monitor: videoMonitor,
    eagle_eye: boolValue(config.hawkeye),
    watermark: true,
    copy_item_unable: true,
    message: String(config.welcomeText || ""),
    notice: preLoginPrompt,
    nda: Boolean(pledgeContent),
    nda_notice: pledgeContent,
    personal: buildPersonalInformation(),
  };

  const main = {
    ...common,
    name: String(config.examName || "").trim(),
    start: normalizeSessionDate(config.startTimeDisplay),
    end: normalizeSessionDate(config.endTimeDisplay),
    save_video: videoMonitor && boolValue(config.videoRecord),
  };
  applyTimeRule(main, config.timeRule);
  const early = positiveNumber(config.earlyLoginMinutes);
  const later = positiveNumber(config.lateLimitMinutes);
  if (early !== undefined && early > 0) main.early = early;
  if (later !== undefined && later > 0) main.later = later;
  if (clientExam) {
    Object.assign(main, {
      client_required: true,
      lock_screen: true,
      exclusive_network: true,
      login_times: positiveNumber(config.clientLoginLimit, 10),
    });
  } else {
    Object.assign(main, {
      client_required: false,
      lock_screen: true,
      login_times: positiveNumber(config.clientLoginLimit, 10),
      lock_screen_exit_sec: positiveNumber(config.webLeaveSeconds, 5),
      lock_screen_time: positiveNumber(config.leaveLimit, 5),
    });
  }

  const payloads = [{ kind: "main", payload: main }];
  if (config.mockExamEnabled && config.mockStartTimeDisplay && config.mockEndTimeDisplay) {
    const trial = {
      ...common,
      name: String(config.mockExamName || `${config.examName}-试考`).trim(),
      start: normalizeSessionDate(config.mockStartTimeDisplay),
      end: normalizeSessionDate(config.mockEndTimeDisplay),
      save_video: false,
      nda: false,
      nda_notice: "",
    };
    applyTimeRule(trial, "不扣时");
    delete trial.early;
    delete trial.later;
    if (clientExam) {
      Object.assign(trial, {
        client_required: true,
        lock_screen: true,
        exclusive_network: true,
        login_times: 20,
      });
    } else {
      Object.assign(trial, {
        client_required: false,
        lock_screen: true,
        login_times: positiveNumber(config.clientLoginLimit, 10),
        lock_screen_exit_sec: positiveNumber(config.webLeaveSeconds, 5),
        lock_screen_time: positiveNumber(config.leaveLimit, 10),
      });
    }
    payloads.push({ kind: "mock", payload: trial });
  }
  return payloads;
}

async function runYikaoApiCreationJob({ job, login }) {
  const ts = () => new Date().toISOString();
  const updateJobStep = (stepKey, status, result = {}) => (
    updateTaskStep(job.taskId, stepKey, status, result, job.requirementIndex)
  );
  const emitLog = (message, level = "success") => {
    pushEvent(job, { type: "log", level, message, ts: ts() });
  };
  const emitStage = (stage, percent) => {
    pushEvent(job, { type: "stage", stage, percent, ts: ts() });
  };

  let activeStep = "formal_session_create";
  try {
    pushEvent(job, { type: "status", status: "running", message: "租户 API 创建考试中", ts: ts() });
    emitStage("读取需求单", 10);
    const payloads = buildSessionPayloads(job.config);
    const apiBase = normalizeApiBase(process.env.YIKAO_API_BASE || login.apiBase || "https://eztest.cn");
    emitLog("[API 创建] 使用租户 API：POST /tenant/api/session/");
    emitLog(`[API 创建] 待创建场次：${payloads.map((item) => item.payload.name).join("、")}`);

    const created = await createSessionsThenConfigureCourses({
      sessionPayloads: payloads,
      createSession: async (item, index) => {
        activeStep = item.kind === "main" ? "formal_session_create" : "trial_session_create";
        await updateJobStep(activeStep, "running", {
          message: `开始创建${item.kind === "main" ? "正式考试" : "试考"}：${item.payload.name}`,
        });
        emitStage(item.kind === "main" ? "创建主考试" : "创建试考", 20 + index * 35);
        emitLog(`[API 创建] 开始创建${item.kind === "main" ? "主考试" : "试考"}：${item.payload.name}`);
        emitLog(
          `[API 创建] 扣时字段：timeRule=${item.kind === "main" ? job.config.timeRule || "未填写" : "不扣时"}，auto_add_time=${JSON.stringify(item.payload.auto_add_time)}，later_deduction=${JSON.stringify(item.payload.later_deduction)}`,
        );
        const result = await readTenantJsonWithLogin(
          login,
          `${apiBase}/tenant/api/session/`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item.payload),
          },
          "创建考试场次",
        );
        const sessionId = extractSessionId(result);
        const createdSession = {
          kind: item.kind,
          name: item.payload.name,
          start: item.payload.start,
          end: item.payload.end,
          id: sessionId,
          url: result?.url,
          result,
        };
        await runTaskState("upsert_session", {
          taskId: job.taskId,
          requirementIndex: job.requirementIndex,
          sessionType: item.kind === "main" ? "formal" : "trial",
          session: {
            session_id: sessionId,
            name: item.payload.name,
            start: item.payload.start,
            end: item.payload.end,
            status: "success",
            url: result?.url || "",
          },
        });
        await updateJobStep(activeStep, "success", {
          message: `创建成功：${item.payload.name}${sessionId ? `，session_id=${sessionId}` : ""}`,
          result: { sessionId, name: item.payload.name, kind: item.kind },
        });
        emitLog(`[API 创建] 创建成功：${item.payload.name}${sessionId ? `，session_id=${sessionId}` : ""}`);
        return createdSession;
      },
      configureCourses: async (formalSession) => {
        activeStep = "course_create";
        await updateJobStep("course_create", "running", { message: "开始创建并确认正式考试科目" });
        emitStage("正式考试科目", 85);
        const courses = await ensureFormalCoursesCreated({
          login,
          apiBase,
          config: job.config,
          requestJson: readTenantJsonWithLogin,
          emitLog,
        });
        job.config = { ...job.config, courses };
        await persistTaskRequirementCourses(job.taskId, job.requirementIndex, courses);
        await updateJobStep("course_create", "success", {
          message: courses.length
            ? `科目创建/确认完成，最终科目编号：${courses.map((course) => `${course.name}/${course.code}`).join("、")}`
            : "需求单科目为空，已跳过科目创建。",
          result: { courses },
        });

        activeStep = "paper_bind";
        await updateJobStep("paper_bind", "running", {
          message: "开始将科目绑定到正式考试场次",
        });
        const bindResult = await bindCoursesToFormalSession({
          login,
          apiBase,
          sessionId: formalSession.id,
          courses,
          requestJson: readTenantJsonWithLogin,
          emitLog,
        });
        await updateJobStep("paper_bind", "success", {
          message: courses.length ? `已将 ${courses.length} 个科目绑定到正式考试场次` : "需求单科目为空，已跳过正式场次科目绑定。",
          result: { bindResult },
        });
      },
    });

    const trialSession = created.find((session) => session?.kind === "mock");
    if (trialSession?.id) {
      activeStep = "trial_paper_bind";
      await updateJobStep("trial_paper_bind", "running", {
        message: `开始绑定试考默认试卷，session_id=${trialSession.id}`,
      });
      const trialPaperLogs = [];
      const trialEmitLog = (message, level = "success") => {
        trialPaperLogs.push(message);
        emitLog(message, level);
      };
      const bindResult = await bindDefaultTrialPaperToSession({
        login,
        apiBase,
        sessionId: trialSession.id,
        requestJson: readTenantJsonWithLogin,
        emitLog: trialEmitLog,
      });
      if (bindResult.status === "waiting_manual") {
        await updateJobStep("trial_paper_bind", "waiting_manual", {
          message: trialPaperLogs.join("\n") || "默认试考科目未关联试卷，请在租户后台关联后重试",
          result: { sessionId: trialSession.id, bindResult },
        });
      } else {
        await updateJobStep("trial_paper_bind", "success", {
          message: trialPaperLogs.join("\n") || "试考默认试卷绑定成功",
          result: { sessionId: trialSession.id, bindResult },
        });
      }
    } else {
      await updateJobStep("trial_paper_bind", "skipped", {
        message: "需求单未启用试考，跳过试考试卷绑定",
      });
    }

    const creationCapture = await saveApiCreationCapture(job, created);
    pushEvent(job, { type: "captures", captures: [creationCapture], ts: ts() });
    emitLog("[API 创建] 已生成创建完成确认截图，可在网页最后确认截图区域查看");
    emitLog("[腾讯文档] 项目共享大表未自动填写，请在考试详情中点击“触发填写”。");
    emitStage("完成", 100);
    pushEvent(job, {
      type: "done",
      ts: ts(),
      summary: {
        created,
        captures: [creationCapture],
      },
    });
  } catch (error) {
    await updateJobStep(activeStep, "failed", {
      errorMessage: error instanceof Error ? error.message : String(error),
      message: `步骤执行失败：${error instanceof Error ? error.message : String(error)}`,
    }).catch(() => {});
    const detail = error?.detail ? `；接口返回：${JSON.stringify(error.detail).slice(0, 1000)}` : "";
    pushEvent(job, {
      type: "error",
      ts: ts(),
      message: `${error instanceof Error ? error.message : String(error)}${detail}`,
    });
  }
}

async function runPythonJson(args) {
  const child = spawn(pythonBin, args, {
    cwd: rootDir,
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

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || "脚本执行失败");
  }
  return JSON.parse(stdout);
}

async function runTaskState(action, payload = {}) {
  const child = spawn(pythonBin, [taskStateScript, taskDbPath, action], {
    cwd: rootDir,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  child.stdin.end(JSON.stringify(payload));
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) throw new Error(stderr.trim() || `任务状态操作失败：${action}`);
  return JSON.parse(stdout || "null");
}

async function runRequirementState(action, payload = {}) {
  const child = spawn(pythonBin, [requirementStateScript, requirementDbPath, action], {
    cwd: rootDir,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  child.stdin.end(JSON.stringify(payload));
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) throw new Error(stderr.trim() || `需求状态操作失败：${action}`);
  return JSON.parse(stdout || "null");
}

function taskRequirementIds(task = {}) {
  return [
    task.config?.requirementRequestId,
    task.config?.initialRequirementRequestId,
    task.config?.businessRequirement?.requirementRequestId,
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

async function updateTaskStep(taskId, stepKey, status, result = {}, requirementIndex = null) {
  if (!taskId) return null;
  return await runTaskState("update_step", { taskId, stepKey, status, result, requirementIndex });
}

async function findVisibleTaskBySessionId(req, sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) return null;
  const sessions = await runTaskState("list_sessions");
  const session = (sessions || []).find((item) => String(item.session_id || "").trim() === normalizedSessionId);
  if (!session) return null;
  const task = await runTaskState("get", { taskId: session.taskId });
  if (!task || !visibleByOwner(auth, req, task)) return null;
  return task;
}

function taskSessionForId(task, sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  return (task?.sessions || []).find((session) => String(session.session_id || "").trim() === normalizedSessionId) || null;
}

function taskSessionSubStatusKey(sessionType = "") {
  return sessionType === "formal" ? "formalExamStatus" : "trialExamStatus";
}

function taskSessionImportStepKey(sessionType = "") {
  return sessionType === "formal" ? "formal_candidate_import" : "trial_candidate_import";
}

function mergedStepSubStatus(task, stepKey, sessionType, status) {
  const existing = (task?.steps || []).find((step) => step.stepKey === stepKey)?.subStatus || {};
  return {
    ...existing,
    [taskSessionSubStatusKey(sessionType)]: status,
  };
}

function mergedRequirementStepSubStatus(task, stepKey, requirementIndex, sessionType, status) {
  const step = taskStepByKey(task, stepKey);
  const requirementKey = String(Number(requirementIndex || 0));
  const existing = step?.requirementProgress?.[requirementKey]?.subStatus || {};
  return {
    ...existing,
    [taskSessionSubStatusKey(sessionType)]: status,
  };
}

async function updateTaskSessionProgress(task, sessionId, patch = {}) {
  const session = taskSessionForId(task, sessionId);
  if (!task?.taskId || !session) return null;
  return await runTaskState("upsert_session", {
    taskId: task.taskId,
    requirementIndex: Number(session.requirementIndex || 0),
    sessionType: session.sessionType,
    session: {
      session_id: session.session_id,
      name: session.name,
      start: session.start,
      end: session.end,
      candidate_count: Number(patch.candidateCount ?? session.candidateCount ?? 0),
      room_count: Number(patch.roomCount ?? session.roomCount ?? 0),
      status: patch.status || session.status || "success",
      url: session.url || "",
    },
  });
}

function taskStepByKey(task, stepKey) {
  return (task?.steps || []).find((step) => step.stepKey === stepKey) || null;
}

async function syncTaskDetailSessionState(req, task) {
  if (!task?.taskId) return task;
  const login = getYikaoLoginForTask(task);
  let currentTask = task;
  for (const session of task.sessions || []) {
    const sessionId = String(session.session_id || "").trim();
    if (!sessionId) continue;
    let latestState = null;
    try {
      latestState = await getSessionImportState(login, sessionId);
    } catch {
      continue;
    }
    const entriesNum = Number(latestState?.entriesNum || 0);
    const roomsCount = Number(latestState?.roomsCount || 0);
    const currentSession = taskSessionForId(currentTask, sessionId) || session;
    if (
      entriesNum !== Number(currentSession.candidateCount || 0) ||
      roomsCount !== Number(currentSession.roomCount || 0)
    ) {
      currentTask = await updateTaskSessionProgress(currentTask, sessionId, {
        candidateCount: entriesNum,
        roomCount: roomsCount,
      }) || currentTask;
    }

    if (entriesNum > 0) {
      const importStepKey = taskSessionImportStepKey(session.sessionType);
      const importStep = taskStepByKey(currentTask, importStepKey);
      const requirementIndex = Number(session.requirementIndex || 0);
      const importRequirement = importStep?.requirementProgress?.[String(requirementIndex)] || null;
      if (importRequirement?.status !== "success") {
        currentTask = await updateTaskStep(currentTask.taskId, importStepKey, "success", {
          message: `同步场次状态：考生导入已完成，${entriesNum} 人`,
          result: { sessionId, entriesNum },
        }, requirementIndex) || currentTask;
      }
    }

    if (roomsCount > 0) {
      const subKey = taskSessionSubStatusKey(session.sessionType);
      const requirementIndex = Number(session.requirementIndex || 0);
      const roomsStep = taskStepByKey(currentTask, "sessions_auto_rooms");
      const roomsRequirement = roomsStep?.requirementProgress?.[String(requirementIndex)] || null;
      if (roomsRequirement?.subStatus?.[subKey] !== "success") {
        currentTask = await updateTaskStep(currentTask.taskId, "sessions_auto_rooms", "running", {
          subStatus: mergedRequirementStepSubStatus(currentTask, "sessions_auto_rooms", requirementIndex, session.sessionType, "success"),
          message: `同步场次状态：${session.sessionType === "formal" ? "正式考试" : "试考"}已完成自动分班，${roomsCount} 个班级`,
          result: { sessionId, entriesNum, roomCount: roomsCount },
        }, requirementIndex) || currentTask;
      }
      const monitorStep = taskStepByKey(currentTask, "sessions_invigilator_export");
      const monitorRequirement = monitorStep?.requirementProgress?.[String(requirementIndex)] || null;
      if (monitorRequirement?.subStatus?.[subKey] !== "success") {
        currentTask = await updateTaskStep(currentTask.taskId, "sessions_invigilator_export", "running", {
          subStatus: mergedRequirementStepSubStatus(currentTask, "sessions_invigilator_export", requirementIndex, session.sessionType, "success"),
          message: `同步场次状态：${session.sessionType === "formal" ? "正式考试" : "试考"}监考账号可下载`,
          result: { sessionId, roomCount: roomsCount },
        }, requirementIndex) || currentTask;
      }
    }
  }
  return currentTask;
}

async function parseWorkbook(uploadPath) {
  return await runPythonJson([parserScript, uploadPath]);
}

function pinTaskApiKeyProfile(config = {}, login = {}) {
  const tenantApiKey = String(login?.tenantApiKey || "").trim();
  if (!tenantApiKey) return config;
  return {
    ...config,
    apiKeyProfileId: apiKeyProfileId({
      apiBase: process.env.YIKAO_API_BASE || login.apiBase,
      tenantApiKey,
    }),
  };
}

async function bindTaskToAutomationLogin(taskId, login = {}) {
  const task = await runTaskState("get", { taskId });
  if (!task) throw new Error("任务不存在，无法固定自动配置账号。");
  const config = pinTaskApiKeyProfile(task.config || {}, login);
  const examRequirements = Array.isArray(config.examRequirements)
    ? config.examRequirements.map((requirement) => ({
      ...requirement,
      config: pinTaskApiKeyProfile(requirement?.config || {}, login),
    }))
    : null;
  return await runTaskState("update_config", {
    taskId,
    sourceAccount: login.username || "",
    config: {
      ...config,
      ...(examRequirements ? { examRequirements } : {}),
    },
  });
}

async function createImportFromWorkbook({
  importId,
  uploadPath,
  filename,
  req,
  messagePrefix = "需求单解析完成",
  ownerEmail = "",
  existingTaskId = "",
  buildTaskConfig = null,
}) {
  const parsed = await parseWorkbook(uploadPath);
  const taskSummaries = await runTaskState("list_all");
  const existingTasks = [];
  for (const summary of taskSummaries || []) {
    const detail = await runTaskState("get", { taskId: summary.taskId });
    if (detail) existingTasks.push(detail);
  }
  parsed.config = assignCourseCodesForExamConfig(parsed?.config || {}, existingTasks);
  const projectName = String(parsed?.config?.examName || filename.replace(/\.[^.]+$/, "") || "未命名项目").trim();
  const authUser = getAuthUserFromRequest(auth, req);
  const login = getYikaoLoginForRequest(req);
  parsed.config = pinTaskApiKeyProfile(parsed.config, login);
  const taskOwnerEmail = ownerEmail || authUser?.email || "";
  const uploadId = importId || randomUUID();
  const extraConfig = typeof buildTaskConfig === "function"
    ? await buildTaskConfig({ parsed, uploadId, projectName, existingTasks })
    : {};
  const taskConfig = { ...(parsed?.config || {}), ...(extraConfig || {}) };
  let task = null;
  if (existingTaskId) {
    task = await runTaskState("update_config", { taskId: existingTaskId, config: taskConfig });
  } else {
    task = await runTaskState("create", {
      projectName,
      sourceAccount: login.username || "",
      ownerEmail: auth.enabled ? taskOwnerEmail : "",
      config: taskConfig,
    });
  }
  await updateTaskStep(task.taskId, "requirement_parse", "success", {
    message: `${messagePrefix}：${filename}`,
    result: { filename, uploadId },
  });
  const record = { id: uploadId, taskId: task.taskId, filename, uploadPath, parsed, createdAt: new Date().toISOString() };
  state.imports.set(uploadId, record);
  return { uploadId, taskId: task.taskId, ...parsed, filename };
}

function createJob(importRecord, login) {
  const job = {
    id: randomUUID(),
    importId: importRecord.id,
    taskId: importRecord.taskId,
    requirementIndex: Number(importRecord.requirementIndex || 0),
    config: importRecord.parsed.config,
    login,
    status: "queued",
    progress: 0,
    stage: "等待开始",
    logs: [],
    captures: [],
    events: [],
    listeners: new Set(),
    createdAt: new Date().toISOString(),
  };
  state.jobs.set(job.id, job);
  return job;
}

function pushEvent(job, evt) {
  job.events.push(evt);
  if (evt.type === "log") {
    job.logs.unshift({
      level: evt.level || "",
      message: evt.message,
      ts: evt.ts,
    });
  }
  if (evt.type === "stage") {
    job.stage = evt.stage;
    job.progress = evt.percent;
  }
  if (evt.type === "status") {
    job.status = evt.status;
    job.statusMessage = evt.message;
  }
  if (evt.type === "captures") {
    job.captures = [...job.captures, ...(evt.captures || [])];
  }
  if (evt.type === "done") {
    job.status = "done";
  }
  if (evt.type === "error") {
    job.status = "error";
    job.statusMessage = evt.message;
    job.logs.unshift({
      level: "warn",
      message: evt.message,
      ts: evt.ts,
    });
  }

  for (const send of job.listeners) {
    send(evt);
  }
}

async function handleImport(req, res) {
  const filename = decodeName(new URL(req.url, "http://localhost").searchParams.get("filename") || "需求单.xlsx");
  const body = await readBody(req);
  if (!body.length) {
    return badRequest(res, "未收到文件内容");
  }

  const importId = randomUUID();
  const uploadPath = path.join(uploadsDir, `${importId}-${filename}`);
  await fs.writeFile(uploadPath, body);
  const parsed = await parseWorkbook(uploadPath);
  const taskSummaries = await runTaskState("list_all");
  const existingTasks = [];
  for (const summary of taskSummaries || []) {
    const detail = await runTaskState("get", { taskId: summary.taskId });
    if (detail) existingTasks.push(detail);
  }
  parsed.config = assignCourseCodesForExamConfig(parsed?.config || {}, existingTasks);
  const projectName = String(parsed?.config?.examName || filename.replace(/\.[^.]+$/, "") || "未命名项目").trim();
  const authUser = getAuthUserFromRequest(auth, req);
  const login = getYikaoLoginForRequest(req);
  parsed.config = pinTaskApiKeyProfile(parsed.config, login);
  const task = await runTaskState("create", {
    projectName,
    sourceAccount: login.username || "",
    ownerEmail: auth.enabled ? authUser?.email || "" : "",
    config: parsed?.config || {},
  });
  await updateTaskStep(task.taskId, "requirement_parse", "success", {
    message: `需求单解析完成：${filename}`,
    result: { filename, uploadId: importId },
  });
  const record = { id: importId, taskId: task.taskId, filename, uploadPath, parsed, createdAt: new Date().toISOString() };
  state.imports.set(importId, record);
  json(res, 200, { uploadId: importId, taskId: task.taskId, ...parsed, filename });
}

function sampleFanweiR0042182() {
  return normalizeFanweiDomPayload({
    requestid: "1505614",
    fields: {
      "ATA内容制题参与方式": "需要ATA制题或使用历史项目试卷",
      "EPI测试": "需要",
      "业务方向": "企业",
      "其他说明": "四川省公路规划勘察设计研究院有限公司\n四川省通川工程技术开发有限公司校招笔试",
      "内容来源": "ATA现有内容",
      "客户及项目属性": "老客户新项目",
      "性格测试工具": "OPA",
      "报名方式": "客户提供报名表",
      "是否需要ATA安排人工监考": "需要安排分散人工监考",
      "是否需要ATA安排集中监考场地": "不需要",
      "是否需要人工阅卷": "需要",
      "是否需要封闭制题": "不需要",
      "是否需要报名网站": "",
      "科目数": "1",
      "系统类型": "易考",
      "结算依据": "按参考科次结算",
      "考核内容是否仅性格测试": "否",
      "考试服务范围": "全流程服务（如需提供4项及以上的单项服务，请直接选择全流程服务）",
      "试卷数": "1",
      "试题类型": "客观题；主观题",
      "运控流水号": "R0042182",
      "阅卷安排": "客户安排阅卷",
      "附件": "附件2：服务确认单.xlsx",
      "项目名称": "蜀道投资集团有限责任公司招聘笔试",
      "项目编码": "F0020795",
      "预估收入": "11.00",
      "预估科次": "11",
    },
    serviceConfirmation: {
      fields: {
        "单位名称": "四川省公路规划勘察设计研究院有限公司",
        "考试名称": "四川省通川工程技术开发有限公司校招笔试",
        "考试时间": "2026年7月5日9：30-11：30",
        "预计人次": "11",
        "科目数量": "1",
        "考场规则": "提前登录30分钟，迟到时间20分钟；最小答题时间60分钟",
        "ATA人工监考": "需要",
        "在线巡考": "需要（3个）",
      },
    },
    opaRows: [
      {
        "OPA报告类型": "全方位胜任力报告-UCF",
        "OPA测评工具": "SHL-OPQ32",
        "备注": "SHL20项胜任力维度报告",
        "常模类型": "OPQ professional（专业人士）",
        "序号": "1",
        "时长（分钟）": "30",
        "是否即测即出报告": "是",
      },
      {
        "OPA报告类型": "情绪倾向报告（标准）-SHLEmotion",
        "OPA测评工具": "SHL-OPQ32",
        "备注": "OPA界面风格的报告",
        "常模类型": "OPQ professional（专业人士）",
        "序号": "2",
        "时长（分钟）": "30",
        "是否即测即出报告": "是",
      },
    ],
    examSceneRows: [
      {
        "场次安排说明": "9：30-11：30",
        "序号": "1",
        "考试日期": "2026-07-05",
        "考试时间": "上午",
      },
    ],
  });
}

function validateFanweiReadPayloadForRequest(payload) {
  try {
    return validateFanweiReadPayload(payload?.fanwei ?? payload?.raw, payload?.serialNo);
  } catch (error) {
    error.status = 400;
    throw error;
  }
}

let fanweiRequirementDefaultsPromise = null;

function loadFanweiRequirementDefaults() {
  if (!fanweiRequirementDefaultsPromise) {
    fanweiRequirementDefaultsPromise = runPythonJson([
      fanweiWorkbookScript,
      "--defaults",
      examRequestTemplatePath,
    ]).catch((error) => {
      fanweiRequirementDefaultsPromise = null;
      throw error;
    });
  }
  return fanweiRequirementDefaultsPromise;
}

async function buildFanweiRequirementPreviewFromPayload(payload) {
  const fanwei = validateFanweiReadPayloadForRequest(payload);
  const model = buildFanweiRequirementModel(fanwei);
  model.requirementFields = {
    ...(await loadFanweiRequirementDefaults()),
    ...model.requirementFields,
  };
  return { fanwei: model };
}

async function findFanweiProject(serialNo, ownerEmail = "") {
  const normalizedSerial = String(serialNo || "").trim();
  const normalizedOwner = normalizeEmail(ownerEmail || "");
  if (!normalizedSerial) return null;
  const summaries = await runTaskState("list_all");
  for (const summary of summaries || []) {
    if (normalizedOwner && normalizeEmail(summary.ownerEmail || "") !== normalizedOwner) continue;
    const task = await runTaskState("get", { taskId: summary.taskId });
    const sourceKey = String(task?.config?.projectCard?.sourceKey || task?.config?.fanweiSource?.serialNo || "").trim();
    if (sourceKey === normalizedSerial) return task;
  }
  return null;
}

async function handleFanweiRequirementPreview(req, res) {
  const payload = parseJsonSafe(await readBody(req)) || {};
  json(res, 200, await buildFanweiRequirementPreviewFromPayload(payload));
}

async function createFanweiRequirementImportFromPayload(payload, req, options = {}) {
  const fanwei = validateFanweiReadPayloadForRequest(payload);
  const model = buildFanweiRequirementModel(fanwei);
  model.requirementFields = {
    ...(await loadFanweiRequirementDefaults()),
    ...model.requirementFields,
  };
  const submittedRequirementFields = Array.isArray(payload.requirementFieldsList)
    ? payload.requirementFieldsList
    : [payload.requirementFields];
  const requirementFieldsList = submittedRequirementFields
    .filter((fields) => fields && typeof fields === "object" && !Array.isArray(fields))
    .map((fields) => ({ ...model.requirementFields, ...editableRequirementFieldsRecord(fields) }));
  if (!requirementFieldsList.length) requirementFieldsList.push({ ...model.requirementFields });
  model.requirementFields = { ...requirementFieldsList[0] };
  const importId = randomUUID();
  const baseName = safeFileName(`泛微_${model.fields["运控流水号"] || payload.serialNo || importId}_易考新建考试需求单.xlsx`);
  const payloadPath = path.join(generatedDir, `${importId}-fanwei-requirement.json`);
  const uploadPath = path.join(uploadsDir, `${importId}-${baseName}`);
  const user = getAuthUserFromRequest(auth, req);
  const ownerEmail = options.ownerEmail || user?.email || "";
  const existingTask = await findFanweiProject(model.fields["运控流水号"] || payload.serialNo, auth.enabled ? ownerEmail : "");
  const existingOperationBatchCode = [
    existingTask?.config?.operationBatchCode,
    existingTask?.config?.operationBatch?.code,
  ].find((code) => operationBatchCodeIsValid(code)) || "";
  const existingRequirementCount = Array.isArray(existingTask?.config?.examRequirements)
    ? existingTask.config.examRequirements.length
    : 0;
  if (operationBatchCodeIsValid(existingOperationBatchCode) && requirementFieldsList.length < existingRequirementCount) {
    const error = new Error("批次创建后不允许删除已对应运控日程的易考需求单。");
    error.status = 409;
    error.errorCode = "OPERATION_BATCH_SCHEDULE_DELETE_FORBIDDEN";
    throw error;
  }
  await fs.writeFile(payloadPath, JSON.stringify(model, null, 2), "utf8");
  await runPythonJson([fanweiWorkbookScript, examRequestTemplatePath, payloadPath, uploadPath]);
  let examRequirements = [];
  const imported = await createImportFromWorkbook({
    importId,
    uploadPath,
    filename: baseName,
    req,
    messagePrefix: "泛微需求单生成并解析完成",
    ownerEmail,
    existingTaskId: existingTask?.taskId || "",
    buildTaskConfig: ({ parsed, uploadId, existingTasks }) => {
      const otherProjectTasks = (existingTasks || []).filter((task) => task?.taskId !== existingTask?.taskId);
      const projectRequirementConfigs = [];
      examRequirements = requirementFieldsList.map((fields, index) => {
        const generated = buildAutoConfigFromRequirement(
          autoConfigRequirementFromFields(fields, parsed.config || {}),
          { customerName: parsed.config?.customerName || "" },
        );
        let config = {
          ...(index === 0 ? parsed.config : {}),
          ...generated.config,
          apiKeyProfileId: parsed.config?.apiKeyProfileId || generated.config?.apiKeyProfileId || "",
        };
        config = assignCourseCodesForExamConfig(config, otherProjectTasks, projectRequirementConfigs);
        projectRequirementConfigs.push(config);
        const previewRows = index === 0 && Array.isArray(parsed.previewRows)
          ? parsed.previewRows
          : Object.entries(fields).map(([label, value]) => ["易考需求单", label, String(value ?? ""), "项目卡"]);
        const warnings = index === 0 && Array.isArray(parsed.warnings) ? parsed.warnings : generated.warnings;
        return {
          fields,
          config,
          previewRows,
          warnings,
          metrics: {
            recognizedFields: Object.values(fields).filter((value) => String(value ?? "").trim()).length,
            needsReview: warnings.length,
            etaMinutes: 4,
          },
          filename: index === 0 ? baseName : "",
          uploadId: index === 0 ? uploadId : "",
        };
      });
      return buildFanweiProjectConfig({
        fanwei,
        model,
        parsed,
        filename: baseName,
        uploadId,
        requirements: examRequirements,
        previousConfig: existingTask?.config || {},
      });
    },
  });
  return { ...imported, fanwei: model, examRequirements, workbookPath: uploadPath, projectReused: Boolean(existingTask) };
}

async function handleFanweiRequirementImport(req, res) {
  const payload = parseJsonSafe(await readBody(req)) || {};
  try {
    json(res, 200, await createFanweiRequirementImportFromPayload(payload, req));
  } catch (error) {
    json(res, error.status || 500, {
      error: error instanceof Error ? error.message : String(error),
      errorCode: error.errorCode,
      detail: error.detail,
    });
  }
}

async function handleProjectWorkflow(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  const batchDraft = buildOperationBatchDraft(task, operationBatchDraftOverridesFromTask(task));
  return json(res, 200, { ok: true, task: withOperationBatchNameEditorDefaults(task), batchDraft, workflow: buildProjectWorkflow(task, batchDraft) });
}

function editableStringRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [String(key), String(item ?? "").trim()]));
}

const richRequirementFields = new Set(["考前等待提示", "考试承诺书内容"]);

function richRequirementPlainText(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\u00a0/g, " ")
    .trim();
}

function normalizeRequirementRichField(value) {
  const text = String(value ?? "").trim();
  return richRequirementPlainText(text) ? text : "";
}

function editableRequirementFieldsRecord(value) {
  const fields = editableStringRecord(value);
  for (const field of richRequirementFields) {
    if (Object.hasOwn(fields, field)) fields[field] = normalizeRequirementRichField(fields[field]);
  }
  return fields;
}

function projectRequirementFieldChanges(beforeFields = {}, afterFields = {}) {
  const before = editableStringRecord(beforeFields);
  const after = editableStringRecord(afterFields);
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .filter((field) => before[field] !== after[field])
    .map((field) => ({
      field,
      before: before[field] || "",
      after: after[field] || "",
    }));
}

function fanweiHistoryFields(raw = {}) {
  const fields = {};
  for (const [field, value] of Object.entries(editableStringRecord(raw.fields))) {
    fields[`泛微需求 / ${field}`] = value;
  }
  for (const [field, value] of Object.entries(editableStringRecord(raw.serviceConfirmation?.fields))) {
    fields[`服务确认 / ${field}`] = value;
  }
  editableExamSceneRows(raw.examSceneRows).forEach((row, index) => {
    for (const [field, value] of Object.entries(row)) fields[`考试场次 ${index + 1} / ${field}`] = value;
  });
  return fields;
}

function appendProjectSourceChangeHistory(task = {}, record = {}) {
  const history = Array.isArray(task.config?.projectSourceChangeHistory)
    ? [...task.config.projectSourceChangeHistory]
    : [];
  if (!record.changes?.length) return history;
  history.push({ changeId: randomUUID(), ...record });
  return history;
}

function editableExamSceneRows(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((row) => ({
    "考试日期": String(row?.["考试日期"] || "").trim(),
    "场次安排说明": String(row?.["场次安排说明"] || "").trim(),
    "备注": String(row?.["备注"] || "").trim(),
  }));
}

function autoConfigRequirementFromFields(fields = {}, current = {}) {
  return {
    exam_name: fields["考试名称"],
    formal_exam_time_range: fields["考试日期时间"],
    mock_exam_time_range: fields["试考日期时间"],
    early_login_minutes: fields["提前登录时间"],
    late_limit_minutes: fields["限制迟到时间"],
    time_rule: fields["试卷扣时规则"],
    exam_address: fields["考试地址"],
    pre_login_prompt: normalizeRequirementRichField(fields["考前等待提示"]),
    welcome_text: fields["欢迎语"],
    pledge_content: normalizeRequirementRichField(fields["考试承诺书内容"]),
    video_monitor_required: fields["视频监控"],
    video_record_required: fields["视频录制"],
    hawkeye_required: fields["鹰眼监控"],
    exam_client_type: fields["考试类型"],
    client_login_limit: fields["登陆次数"],
    manual_score_text: fields["人工判分"],
    paper_names_text: fields["试卷名称"],
    subjects_text: fields["科目信息"],
    watermark_enabled: current.watermark,
    copy_forbidden: current.disableCopy,
    leave_limit_count: current.leaveLimit,
    u8_code: current.u8Code,
    project_manager: current.projectManager,
    customer_name: current.customerName,
    candidate_count: current.candidateCount,
  };
}

function mergeRequirementCoursePaperNames(currentCourses = [], generatedCourses = []) {
  return (Array.isArray(currentCourses) ? currentCourses : []).map((course, index) => {
    const next = { ...course };
    const generated = generatedCourses[index] || {};
    const paperName = String(generated.paper_name || generated.paperName || "").trim();
    if (paperName) next.paper_name = paperName;
    else delete next.paper_name;
    return next;
  });
}

function taskExamRequirements(task = {}) {
  const requirements = task.config?.examRequirements;
  if (Array.isArray(requirements) && requirements.length) return requirements;
  return task.config?.examRequirement?.fields ? [task.config.examRequirement] : [];
}

async function persistTaskRequirementCourses(taskId, requirementIndex, courses) {
  const task = await runTaskState("get", { taskId });
  const requirements = taskExamRequirements(task);
  const normalizedIndex = Math.max(Number(requirementIndex || 0), 0);
  if (!requirements.length || !requirements[normalizedIndex]) {
    return await runTaskState("update_config", { taskId, config: { courses } });
  }
  const examRequirements = [...requirements];
  examRequirements[normalizedIndex] = {
    ...examRequirements[normalizedIndex],
    config: {
      ...(examRequirements[normalizedIndex].config || {}),
      courses,
    },
  };
  return await runTaskState("update_config", {
    taskId,
    config: {
      examRequirements,
      examRequirement: examRequirements[0],
      ...(normalizedIndex === 0 ? { courses } : {}),
    },
  });
}

async function handleProjectSourceSnapshotUpdate(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  const payload = parseJsonSafe(await readBody(req)) || {};
  const source = String(payload.source || "").trim();
  const now = new Date().toISOString();
  let configPatch = {};

  if (source === "fanwei") {
    const currentSource = task.config?.fanweiSource || {};
    const currentRaw = currentSource.raw || {};
    let raw = {
      ...currentRaw,
      fields: editableStringRecord(payload.fields),
      serviceConfirmation: {
        ...(currentRaw.serviceConfirmation || {}),
        fields: editableStringRecord(payload.serviceConfirmationFields),
      },
      examSceneRows: editableExamSceneRows(payload.examSceneRows),
    };
    const requirementFields = taskExamRequirements(task)[0]?.fields || task.config?.examRequirement?.fields || {};
    const normalizedRequirement = normalizeFanweiBusinessRequirement(raw, { requirementFields });
    const batchName = resolveOperationBatchName({
      previousValue: currentSource.raw?.fields?.["批次名称"],
      previousMode: currentSource.batchNameMode,
      generatedValue: defaultOperationBatchName({
        customerName: normalizedRequirement.customer_name,
        projectName: normalizedRequirement.project_name,
        examStart: requirementFields["考试日期时间"],
      }),
      submittedValue: payload.restoreBatchNameAuto === true ? "" : raw.fields["批次名称"],
      restoreAuto: payload.restoreBatchNameAuto === true,
    });
    raw = {
      ...raw,
      fields: { ...raw.fields, "批次名称": batchName.value },
    };
    const changes = projectRequirementFieldChanges(fanweiHistoryFields(currentRaw), fanweiHistoryFields(raw));
    const businessRequirement = {
      ...normalizeFanweiBusinessRequirement(raw, { requirementFields }),
      batch_name: batchName.value,
      batch_name_mode: batchName.mode,
      batch_name_auto_value: batchName.autoValue,
    };
    const fanweiSource = {
      ...currentSource,
      version: Number(currentSource.version || 0) + 1,
      modifiedAt: now,
      serialNo: businessRequirement.operation_serial_number || currentSource.serialNo || "",
      batchNameMode: batchName.mode,
      batchNameAutoValue: batchName.autoValue,
      raw,
    };
    const projectCard = {
      ...(task.config?.projectCard || {}),
      sourceKey: fanweiSource.serialNo || task.config?.projectCard?.sourceKey || "",
      updatedAt: now,
    };
    configPatch = {
      projectCard,
      fanweiSource,
      businessRequirement,
      customerName: businessRequirement.customer_name || task.config?.customerName || "",
      projectCode: businessRequirement.project_code || task.config?.projectCode || "",
      projectSourceChangeHistory: appendProjectSourceChangeHistory(task, {
        source: "fanwei",
        reviewStatus: "auto_confirmed",
        changedAt: now,
        versionBefore: Number(currentSource.version || 0),
        versionAfter: Number(fanweiSource.version || 0),
        changes,
      }),
    };
  } else if (source === "examRequirement") {
    const currentRequirements = taskExamRequirements(task);
    const requestedIndex = Number(payload.requirementIndex ?? 0);
    const requirementIndex = Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < currentRequirements.length
      ? requestedIndex
      : 0;
    const current = currentRequirements[requirementIndex] || task.config?.examRequirement || {};
    const currentConfig = current.config || {};
    const fields = editableRequirementFieldsRecord(payload.fields);
    const changes = projectRequirementFieldChanges(current.fields, fields);
    const generated = buildAutoConfigFromRequirement(
      autoConfigRequirementFromFields(fields, currentConfig),
      { customerName: task.config?.customerName || currentConfig.customerName || "" },
    );
    const generatedConfig = generated.config || {};
    const courseBasisUnchanged = JSON.stringify(currentConfig.subjects || []) === JSON.stringify(generatedConfig.subjects || [])
      && String(currentConfig.startTimeDisplay || "") === String(generatedConfig.startTimeDisplay || "");
    const config = {
      ...currentConfig,
      ...generatedConfig,
      ...(courseBasisUnchanged ? {
        courses: mergeRequirementCoursePaperNames(currentConfig.courses, generatedConfig.courses),
        subjectImportPath: currentConfig.subjectImportPath || generatedConfig.subjectImportPath || "",
      } : {}),
      apiKeyProfileId: currentConfig.apiKeyProfileId || "",
    };
    const examRequirement = {
      ...current,
      version: Number(current.version || 0) + 1,
      modifiedAt: now,
      confirmedAt: now,
      fields,
      config,
    };
    const examRequirements = currentRequirements.length ? [...currentRequirements] : [examRequirement];
    examRequirements[requirementIndex] = examRequirement;
    const currentSource = task.config?.fanweiSource || {};
    const currentRaw = currentSource.raw || {};
    const currentBusinessRequirement = task.config?.businessRequirement || {};
    const batchName = resolveOperationBatchName({
      previousValue: currentRaw.fields?.["批次名称"] || currentBusinessRequirement.batch_name,
      previousMode: currentSource.batchNameMode || currentBusinessRequirement.batch_name_mode,
      generatedValue: defaultOperationBatchName({
        customerName: currentBusinessRequirement.customer_name || currentRaw.fields?.["客户名称"],
        projectName: currentBusinessRequirement.project_name || currentRaw.fields?.["项目名称"],
        examStart: examRequirements[0]?.fields?.["考试日期时间"],
      }),
      submittedValue: currentRaw.fields?.["批次名称"] || currentBusinessRequirement.batch_name,
    });
    const fanweiSource = {
      ...currentSource,
      batchNameMode: batchName.mode,
      batchNameAutoValue: batchName.autoValue,
      raw: {
        ...currentRaw,
        fields: { ...(currentRaw.fields || {}), "批次名称": batchName.value },
      },
    };
    const businessRequirement = {
      ...currentBusinessRequirement,
      batch_name: batchName.value,
      batch_name_mode: batchName.mode,
      batch_name_auto_value: batchName.autoValue,
    };
    configPatch = {
      examRequirements,
      examRequirement: examRequirements[0],
      fanweiSource,
      businessRequirement,
      projectSourceChangeHistory: appendProjectSourceChangeHistory(task, {
        source: "examRequirement",
        reviewStatus: "auto_confirmed",
        requirementIndex,
        changedAt: now,
        versionBefore: Number(current.version || 0),
        versionAfter: Number(examRequirement.version || 0),
        changes,
      }),
    };
  } else {
    return badRequest(res, "仅支持修改泛微业务需求或易考需求单。");
  }

  const updated = await runTaskState("update_config", {
    taskId,
    config: configPatch,
    projectName: source === "fanwei" ? (configPatch.businessRequirement?.project_name || task.projectName || "") : undefined,
  });
  const batchDraft = buildOperationBatchDraft(updated, operationBatchDraftOverridesFromTask(updated));
  return json(res, 200, { ok: true, task: updated, batchDraft, workflow: buildProjectWorkflow(updated, batchDraft) });
}

async function handleFanweiBridgeToken(req, res) {
  const user = getAuthUserFromRequest(auth, req);
  if (auth.enabled && !user) return json(res, 401, { error: "请先登录" });
  const issued = fanweiBridge.issue({ userEmail: user?.email || "" });
  json(res, 200, {
    token: issued.token,
    expiresAt: new Date(issued.expiresAt).toISOString(),
  });
}

async function handleFanweiBridgeSubmit(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }
  const payload = parseJsonSafe(await readBody(req)) || {};
  const bridge = fanweiBridge.consume(payload.token);
  if (!bridge) return corsJson(res, 401, { error: "泛微读取口令已失效，请回测试平台重新复制读取脚本。" });
  try {
    const imported = await createFanweiRequirementImportFromPayload(payload, req, {
      ownerEmail: bridge.userEmail || "",
    });
    fanweiBridge.saveResult(payload.token, imported);
    return corsJson(res, 200, {
      ok: true,
      uploadId: imported.uploadId,
      taskId: imported.taskId,
      examName: imported.config?.examName || "",
    });
  } catch (error) {
    return corsJson(res, 500, { error: error?.message || "泛微需求单生成失败" });
  }
}

async function handleFanweiBridgeResult(req, res) {
  const payload = parseJsonSafe(await readBody(req)) || {};
  const token = String(payload.token || "").trim();
  if (!token) return badRequest(res, "缺少泛微读取口令。");
  const result = fanweiBridge.takeResult(token);
  if (!result) return json(res, 202, { pending: true });
  return json(res, 200, result);
}

async function runCommandCapture(command, args, { timeoutMs = 15000 } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("本机 Chrome 自动读取超时，请确认泛微单页已经打开。"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(stdout).toString("utf8");
      const errorOutput = Buffer.concat(stderr).toString("utf8").trim();
      if (code === 0) return resolve(output);
      reject(new Error(errorOutput || `本机 Chrome 自动读取失败，退出码 ${code}`));
    });
  });
}

function fanweiAutoReadErrorReason(error) {
  const message = error?.message || String(error);
  if (message.includes("通过 AppleScript 执行 JavaScript 的功能已关闭")) {
    return "chrome_applescript_javascript_disabled";
  }
  if (
    message.includes("ECONNREFUSED") ||
    message.includes("fetch failed") ||
    message.includes("无法连接 Chrome DevTools")
  ) {
    return "chrome_devtools_unavailable";
  }
  return "";
}

async function launchWindowsFanweiChrome() {
  const chromePath = findWindowsChromeExecutable({ existsSync: fsSync.existsSync });
  if (!chromePath) return false;
  const userDataDir = path.join(runtimeDir, "chrome-fanwei-profile");
  await fs.mkdir(userDataDir, { recursive: true });
  const args = buildWindowsChromeLaunchArgs({
    userDataDir,
    port: 9222,
    startUrl: "https://oa.ata.net.cn/",
  });
  const child = spawn(chromePath, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return true;
}

async function launchMacFanweiChrome() {
  const chromePath = findMacChromeExecutable({ existsSync: fsSync.existsSync });
  if (!chromePath) return false;
  const userDataDir = path.join(runtimeDir, "chrome-fanwei-profile");
  await fs.mkdir(userDataDir, { recursive: true });
  const args = buildWindowsChromeLaunchArgs({
    userDataDir,
    port: 9222,
    startUrl: "https://oa.ata.net.cn/",
  });
  const child = spawn(chromePath, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return true;
}

async function launchFanweiChromeForDevTools() {
  if (process.platform === "win32") return await launchWindowsFanweiChrome();
  if (process.platform === "darwin") return await launchMacFanweiChrome();
  return false;
}

async function waitForFanweiDevToolsChrome({ timeoutMs = 5000 } = {}) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      return await runChromeDevToolsFanweiRead({ serialNo: "", timeoutMs: 1000, requireFanweiTab: false });
    } catch (nextError) {
      lastError = nextError;
    }
  }
  if (lastError) throw lastError;
  return { connected: false, fanweiTabFound: false };
}

async function runFanweiDevToolsReadWithAutoLaunch({ serialNo = "", timeoutMs = 5000 } = {}) {
  try {
    return await runChromeDevToolsFanweiRead({ serialNo, timeoutMs });
  } catch (error) {
    const reason = fanweiAutoReadErrorReason(error);
    if (reason !== "chrome_devtools_unavailable") throw error;
    const launched = await launchFanweiChromeForDevTools();
    if (!launched) throw error;
    await waitForFanweiDevToolsChrome({ timeoutMs: 5000 });
    return await runChromeDevToolsFanweiRead({ serialNo, timeoutMs });
  }
}

async function ensureFanweiDevToolsChromeAvailable({ timeoutMs = 5000 } = {}) {
  try {
    const status = await runChromeDevToolsFanweiRead({ serialNo: "", timeoutMs, requireFanweiTab: false });
    if (status?.fanweiTabFound === false) {
      const launched = await launchFanweiChromeForDevTools();
      if (!launched) return status;
      const nextStatus = await waitForFanweiDevToolsChrome({ timeoutMs });
      return { ...nextStatus, launchedChrome: true };
    }
    return status;
  } catch (error) {
    const reason = fanweiAutoReadErrorReason(error);
    if (reason !== "chrome_devtools_unavailable") throw error;
    const launched = await launchFanweiChromeForDevTools();
    if (!launched) throw error;
    const status = await waitForFanweiDevToolsChrome({ timeoutMs });
    return { ...status, launchedChrome: true };
  }
}

async function readFanweiFromLocalChrome(serialNo) {
  const platform = fanweiAutoReadPlatform();
  if (platform === "windows_devtools" || platform === "chrome_devtools") {
    return await runFanweiDevToolsReadWithAutoLaunch({ serialNo, timeoutMs: 15000 });
  }
  const error = new Error(fanweiAutoReadUnavailableMessage("unsupported_platform", process.platform));
  error.reason = "unsupported_platform";
  throw error;
}

async function handleFanweiAutoReadStatus(_req, res) {
  const platform = fanweiAutoReadPlatform();
  if (platform === "unsupported") {
    return json(res, 200, {
      available: false,
      platform,
      reason: "unsupported_platform",
      message: fanweiAutoReadUnavailableMessage("unsupported_platform", process.platform),
    });
  }
  try {
    const status = await ensureFanweiDevToolsChromeAvailable({ timeoutMs: 5000 });
    return json(res, 200, { available: true, platform, ...status });
  } catch (error) {
    const reason = fanweiAutoReadErrorReason(error) || (platform === "windows_devtools" || platform === "chrome_devtools" ? "chrome_devtools_unavailable" : "chrome_applescript_javascript_disabled");
    return json(res, 200, {
      available: false,
      platform,
      reason,
      message: fanweiAutoReadUnavailableMessage(reason, process.platform),
    });
  }
}

function isLoopbackRequest(req) {
  const address = String(req.socket?.remoteAddress || "").toLowerCase();
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function handleFanweiLocalRead(req, res) {
  if (!isLoopbackRequest(req)) {
    return json(res, 403, { error: "该读取接口仅允许在服务所在电脑本机使用。" });
  }
  const payload = parseJsonSafe(await readBody(req)) || {};
  const serialNo = String(payload.serialNo || "").trim();
  if (!serialNo) return badRequest(res, "请填写泛微流水号。");
  let fanwei = null;
  try {
    fanwei = await readFanweiFromLocalChrome(serialNo);
  } catch (error) {
    const reason = error.reason || fanweiAutoReadErrorReason(error);
    if (reason) return json(res, 503, { error: fanweiAutoReadUnavailableMessage(reason, process.platform), reason });
    throw error;
  }
  if (!fanwei) {
    return json(res, 404, {
      error: `没有在已打开的 Chrome 泛微主表页中读到 ${serialNo}，请先打开对应泛微单。`,
    });
  }
  return json(res, 200, { ok: true, data: fanwei });
}

async function handleFanweiAutoRead(req, res) {
  const payload = parseJsonSafe(await readBody(req)) || {};
  const serialNo = String(payload.serialNo || "").trim();
  if (!serialNo) return badRequest(res, "请填写泛微流水号。");
  let fanwei = null;
  try {
    fanwei = await readFanweiFromLocalChrome(serialNo);
  } catch (error) {
    const reason = error.reason || fanweiAutoReadErrorReason(error);
    if (reason) return json(res, 503, { error: fanweiAutoReadUnavailableMessage(reason, process.platform), reason });
    throw error;
  }
  if (!fanwei) {
    return json(res, 404, {
      error: `没有在已打开的 Chrome 泛微主表页中读到 ${serialNo}，请先打开对应泛微单。`,
    });
  }
  const user = getAuthUserFromRequest(auth, req);
  const imported = await createFanweiRequirementImportFromPayload(
    { serialNo, fanwei },
    req,
    { ownerEmail: user?.email || "" },
  );
  return json(res, 200, imported);
}

async function handleCandidateParse(req, res) {
  const url = new URL(req.url, "http://localhost");
  const filename = safeFileName(url.searchParams.get("filename") || "candidates.xlsx");
  const ext = path.extname(filename).toLowerCase();
  if (![".xlsx", ".xls", ".csv"].includes(ext)) {
    return badRequest(res, "文件格式不支持，仅支持 .xlsx、.xls、.csv");
  }

  const body = await readBody(req);
  if (!body.length) {
    return badRequest(res, "未上传文件");
  }

  const importId = randomUUID();
  const uploadPath = path.join(uploadsDir, `${importId}-${filename}`);
  await fs.writeFile(uploadPath, body);
  const parsed = await runPythonJson([candidateParserScript, "parse", uploadPath]);
  state.candidateImports.set(importId, {
    id: importId,
    filename,
    uploadPath,
    parsed,
    createdAt: new Date().toISOString(),
  });
  json(res, 200, { uploadId: importId, filename, ...parsed });
}

const candidateFieldLabels = {
  permit: "准考证号",
  full_name: "姓名",
  identity_id: "身份证号",
  course_code: "科目编号",
  mobile: "手机号",
  email: "邮箱",
};

function candidateFieldLabel(field) {
  return candidateFieldLabels[field] || "字段";
}

const candidateMobileFieldAliases = new Set(["手机号码", "手机号", "手机", "联系电话", "电话", "mobile", "phone"]);

function normalizeCandidateHeader(value) {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function candidatePermitMappedFromMobile(fieldMapping = {}) {
  const permitSource = normalizeCandidateHeader(fieldMapping?.permit);
  return Boolean(permitSource) && [...candidateMobileFieldAliases].some((alias) => normalizeCandidateHeader(alias) === permitSource);
}

function isValidCandidatePermit(value) {
  return /^[A-Za-z0-9]+$/.test(String(value || "").trim());
}

const candidateIdentityWeights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const candidateIdentityCodes = "10X98765432";

function normalizeCandidateIdentityId(value) {
  return String(value || "").trim().toUpperCase();
}

function candidateIdentityBirthDateIsValid(value) {
  const birth = value.slice(6, 14);
  const year = Number(birth.slice(0, 4));
  const month = Number(birth.slice(4, 6));
  const day = Number(birth.slice(6, 8));
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function candidateIdentityChecksum(value) {
  const total = candidateIdentityWeights.reduce((sum, weight, index) => sum + Number(value[index]) * weight, 0);
  return candidateIdentityCodes[total % 11];
}

function validateCandidateIdentityId(value) {
  const normalized = normalizeCandidateIdentityId(value);
  if (!normalized) return "";
  if (!/^\d{17}[\dX]$/.test(normalized)) return "身份证号格式不正确";
  if (!candidateIdentityBirthDateIsValid(normalized)) return "身份证号出生日期不合法";
  if (candidateIdentityChecksum(normalized) !== normalized.slice(-1)) return "身份证号校验码错误";
  return "";
}

function normalizeCandidateMobile(value) {
  return String(value || "").trim().replace(/[\s\u3000-]+/g, "");
}

function isValidCandidateMobile(value) {
  return /^1[3-9]\d{9}$/.test(normalizeCandidateMobile(value));
}

function validateCandidateMobile(value, options = {}) {
  const normalized = normalizeCandidateMobile(value);
  if (!normalized) return options.required ? "手机号不能为空" : "";
  if (!/^\d{11}$/.test(normalized)) return "手机号必须为 11 位数字";
  if (!/^1[3-9]\d{9}$/.test(normalized)) return "手机号格式不正确";
  return "";
}

function validateCandidatePayload(candidates = [], fieldMapping = {}) {
  const errors = [];
  if (!Array.isArray(candidates) || !candidates.length) {
    return ["缺少考生数据"];
  }
  const permitRows = new Map();
  const identityRows = new Map();
  const permitFromMobile = candidatePermitMappedFromMobile(fieldMapping);
  candidates.forEach((candidate, index) => {
    const row = index + 2;
    const permit = permitFromMobile
      ? normalizeCandidateMobile(candidate?.permit)
      : String(candidate?.permit || "").trim();
    const fullName = String(candidate?.full_name || "").trim();
    const identityId = normalizeCandidateIdentityId(candidate?.identity_id);
    const mobile = normalizeCandidateMobile(candidate?.mobile);
    if (!permit) errors.push(`第 ${row} 行缺少${candidateFieldLabel("permit")}`);
    if (!fullName) errors.push(`第 ${row} 行缺少${candidateFieldLabel("full_name")}`);
    if (permit && !isValidCandidatePermit(permit)) errors.push(`第 ${row} 行准考证号只能包含英文字母和数字`);
    const identityError = validateCandidateIdentityId(identityId);
    if (identityError) errors.push(`第 ${row} 行${identityError}`);
    const mobileError =
      permitFromMobile && fieldMapping?.mobile === fieldMapping?.permit
        ? ""
        : validateCandidateMobile(mobile);
    if (mobileError) errors.push(`第 ${row} 行${mobileError}`);
    if (permitFromMobile) {
      const permitMobileError = validateCandidateMobile(permit, { required: true });
      if (permitMobileError) errors.push(`第 ${row} 行${permitMobileError}`);
    }
    if (permit) permitRows.set(permit, [...(permitRows.get(permit) || []), row]);
    if (identityId) identityRows.set(identityId, [...(identityRows.get(identityId) || []), row]);
    if (/^\s*\d+(?:\.\d+)?[eE]\+?\d+\s*$/.test(identityId)) {
      errors.push(`第 ${row} 行${candidateFieldLabel("identity_id")}为科学计数法格式，请修正原始文件后再导入`);
    }
    if (/^\s*\d+(?:\.\d+)?[eE]\+?\d+\s*$/.test(permit)) {
      errors.push(`第 ${row} 行${candidateFieldLabel("permit")}为科学计数法格式，请修正原始文件后再导入`);
    }
  });
  for (const [permit, rows] of permitRows.entries()) {
    if (rows.length > 1) errors.push(`准考证号重复：${permit}，行号：${rows.join("、")}`);
  }
  for (const [identityId, rows] of identityRows.entries()) {
    if (rows.length > 1) errors.push(`证件号重复：${identityId}，行号：${rows.join("、")}`);
  }
  return errors;
}

const disallowedCandidateCustomFieldNames = new Set(["姓名", "身份证号", "证件号", "准考证号", "科目编号", "科目名称"]);

function validateCandidateCustomFields(candidates = []) {
  const errors = [];
  for (const [index, candidate] of candidates.entries()) {
    const row = candidate?.__row || index + 2;
    const customFields = candidate?.custom_fields || {};
    if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) continue;
    const rawNames = Object.keys(customFields).map((name) => String(name || "").trim());
    const names = rawNames.filter(Boolean);
    if (rawNames.some((name) => !name)) errors.push(`第 ${row} 行自定义字段名称不能为空`);
    if (names.length > 30) errors.push(`第 ${row} 行自定义字段超过 30 个`);
    const seen = new Set();
    for (const name of names) {
      if (disallowedCandidateCustomFieldNames.has(name)) errors.push(`第 ${row} 行自定义字段不能作为导入信息项：${name}`);
      if (seen.has(name)) errors.push(`第 ${row} 行自定义字段名称重复：${name}`);
      seen.add(name);
    }
  }
  return errors;
}

function candidateCustomFieldNames(candidates = []) {
  const names = new Set();
  for (const candidate of candidates) {
    const customFields = candidate?.custom_fields || {};
    if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) continue;
    for (const name of Object.keys(customFields)) {
      const trimmed = String(name || "").trim();
      if (trimmed) names.add(trimmed);
    }
  }
  return [...names];
}

function normalizeImportCustomFieldRequests(payloadCustomFields = [], candidates = []) {
  const requested = normalizeCustomPersonalFieldRequests(payloadCustomFields);
  if (requested.length) return requested;
  return normalizeCustomPersonalFieldRequests(
    candidateCustomFieldNames(candidates).map((name) => ({ source_column: name, target_name: name, enabled: true })),
  );
}

const baseImportFieldDefinitions = [
  { key: "full_name", field_name: "姓名", field_code: "full_name" },
  { key: "permit", field_name: "准考证号", field_code: "permit" },
  { key: "identity_id", field_name: "身份证号", field_code: "identity_id" },
  { key: "id_card", field_name: "身份证号", field_code: "identity_id" },
  { key: "phone", field_name: "手机号码", field_code: "phone" },
  { key: "mobile", field_name: "手机号码", field_code: "phone" },
  { key: "email", field_name: "邮箱", field_code: "email" },
  { key: "course_code", field_name: "科目编号", field_code: "course_code" },
  { key: "course_name", field_name: "科目名称", field_code: "course_name" },
];
const excludedPersonalSyncBaseKeys = new Set(["permit", "course_code", "course_name"]);

function normalizeSourceColumns(sourceColumns = []) {
  const seen = new Set();
  return (Array.isArray(sourceColumns) ? sourceColumns : [])
    .map((name) => String(name || "").trim())
    .filter(Boolean)
    .filter((name) => {
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
}

function buildSelectedImportFields(fieldMapping = {}, payloadCustomFields = []) {
  const selectedBaseFields = baseImportFieldDefinitions
    .filter((definition) => !excludedPersonalSyncBaseKeys.has(definition.key))
    .map((definition, index) => {
      const sourceColumn = String(fieldMapping?.[definition.key] || "").trim();
      if (!sourceColumn) return null;
      return {
        field_name: definition.field_name,
        field_code: definition.field_code,
        source_column: sourceColumn,
        field_kind: "base",
        enabled: true,
        order_index: index,
      };
    })
    .filter(Boolean);
  const selectedCustomFields = normalizeImportCustomFieldRequests(payloadCustomFields).map((field, index) => ({
    ...field,
    field_kind: "custom",
    enabled: true,
    order_index: selectedBaseFields.length + index,
  }));
  const selectedImportFields = normalizeImportPersonalFieldRequests([
    ...selectedBaseFields,
    ...selectedCustomFields,
  ]);
  const selectedSourceColumns = new Set(selectedImportFields.map((field) => field.source_column).filter(Boolean));
  return {
    selectedImportFields,
    base_names: selectedBaseFields.map((field) => field.field_name),
    custom_names: selectedCustomFields.map((field) => field.field_name),
    selected_source_columns: [...selectedSourceColumns],
  };
}

function unselectedSourceColumns(sourceColumns = [], selectedSourceColumns = []) {
  const selected = new Set((selectedSourceColumns || []).map((name) => String(name || "").trim()).filter(Boolean));
  return normalizeSourceColumns(sourceColumns).filter((name) => !selected.has(name));
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function tenantSessionId(value = {}) {
  return String(value?.id ?? value?.session_id ?? value?.sessionId ?? "").trim();
}

function extractTenantSessionConfig(payload, sessionId) {
  const targetId = String(sessionId || "").trim();
  const directCandidates = [
    payload,
    payload?.data,
    payload?.result,
    payload?.session,
    payload?.detail,
  ].filter(objectValue);
  for (const item of directCandidates) {
    const itemId = tenantSessionId(item);
    if (!targetId || !itemId || itemId === targetId) return item;
  }
  return normalizeTenantList(payload).find((item) => tenantSessionId(item) === targetId) || null;
}

function personalFieldLabels(personal = {}) {
  return Object.entries(objectValue(personal) || {})
    .map(([key, value]) => String(value?.label || value?.name || value?.field_name || key || "").trim())
    .filter(Boolean);
}

function buildSessionPersonalPutPayload(sessionDetail, personal) {
  const original = objectValue(sessionDetail);
  if (!original) {
    throw new Error("场次信息项同步失败：未获取到原场次配置");
  }
  return {
    ...original,
    personal,
  };
}

async function getTenantSessionDetail(login, sessionId) {
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const detailUrl = new URL(`/tenant/api/session/${encodeURIComponent(sessionId)}/`, base);
  let detailError = null;
  try {
    const payload = await readTenantJsonWithLogin(login, detailUrl, {}, "获取原场次配置");
    const detail = extractTenantSessionConfig(payload, sessionId);
    if (detail) return { detail, source: "detail" };
  } catch (error) {
    detailError = error;
  }

  const listUrl = new URL("/tenant/api/session/", base);
  listUrl.searchParams.set("session_ids", sessionId);
  const payload = await readTenantJsonWithLogin(login, listUrl, {}, "获取原场次配置");
  const detail = extractTenantSessionConfig(payload, sessionId);
  if (!detail) {
    const error = new Error("场次信息项同步失败：未获取到原场次配置");
    error.detail = detailError?.detail || null;
    error.status = detailError?.status || 502;
    throw error;
  }
  return {
    detail,
    source: "list",
    detail_error: detailError
      ? { status: detailError.status || null, message: detailError.message || String(detailError), detail: detailError.detail || null }
      : null,
  };
}

async function ensureSessionCustomPersonalFields(login, sessionId, customFields = []) {
  const requests = normalizeImportPersonalFieldRequests(customFields);
  const names = requests.map((field) => field.field_name);
  if (!names.length) return { updated: false, names: [], mappings: [] };
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const sessionUrl = new URL(`/tenant/api/session/${encodeURIComponent(sessionId)}/`, base);
  try {
    const sessionConfig = await getTenantSessionDetail(login, sessionId);
    const sessionDetail = sessionConfig.detail;
    const existingPersonal =
      sessionDetail?.personal && typeof sessionDetail.personal === "object" && !Array.isArray(sessionDetail.personal)
        ? sessionDetail.personal
        : {};
    const existingNames = personalFieldLabels(existingPersonal);
    const sync = syncImportPersonalFields(existingPersonal, requests);
    const putPayload = buildSessionPersonalPutPayload(sessionDetail, sync.personal);
    await readTenantJsonWithLogin(
      login,
      sessionUrl,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(putPayload) },
      "修改场次信息项",
    );
    return {
      updated: true,
      method: "PUT",
      names,
      mappings: sync.mappings,
      reused: sync.mappings.filter((field) => field.status === "existing").map((field) => field.field_name),
      created: sync.mappings.filter((field) => field.status === "created").map((field) => field.field_name),
      existing_names: existingNames,
      source: sessionConfig.source,
      detail_error: sessionConfig.detail_error || null,
    };
  } catch (error) {
    const detail = error?.detail ? `：${JSON.stringify(error.detail)}` : "";
    const wrapped = new Error(`场次信息项同步失败，无法导入考生。${error instanceof Error ? error.message : String(error)}${detail}`);
    wrapped.status = error?.status || 502;
    wrapped.detail = error?.detail || null;
    wrapped.names = names;
    throw wrapped;
  }
}

async function handleCandidateTemplate(req, res) {
  const payload = parseJsonSafe(await readBody(req));
  const candidates = payload?.candidates || [];
  const errors = validateCandidatePayload(candidates, payload?.fieldMapping || payload?.field_mapping || payload?.mapping || {});
  if (errors.length) {
    return json(res, 400, { error: "考生数据校验失败", errors });
  }

  const templateId = randomUUID();
  const payloadPath = path.join(generatedDir, `${templateId}.json`);
  const outputPath = path.join(generatedDir, `${templateId}-candidates.xlsx`);
  await fs.writeFile(payloadPath, JSON.stringify({ candidates }, null, 2), "utf8");
  const result = await runPythonJson([candidateParserScript, "template", payloadPath, outputPath]);
  if (!result.ok) {
    return json(res, 400, { error: "考生模板生成失败", errors: result.errors || [] });
  }
  res.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": 'attachment; filename="yikao_candidates_template.xlsx"',
  });
  createReadStream(outputPath).pipe(res);
}

async function handleExamRequestTemplate(req, res) {
  try {
    await fs.access(examRequestTemplatePath);
  } catch {
    return notFound(res);
  }
  res.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": 'attachment; filename="v2_yikao_exam_request_template.xlsx"',
  });
  createReadStream(examRequestTemplatePath).pipe(res);
}

async function handleFanweiHelperInstaller(url, res) {
  const platform = String(url.searchParams.get("platform") || "").toLowerCase();
  const packageNames = {
    windows: "yikao-fanwei-helper-win-x64.zip",
    macos: "yikao-fanwei-helper-darwin-arm64.zip",
  };
  const fileName = packageNames[platform];
  if (!fileName) {
    return badRequest(res, "不支持的本机助手平台，请选择 windows 或 macos。");
  }

  let packagePath = "";
  for (const directory of [fanweiHelperRuntimePackagesDir, fanweiHelperProjectPackagesDir]) {
    const candidate = path.join(directory, fileName);
    try {
      await fs.access(candidate);
      packagePath = candidate;
      break;
    } catch {}
  }
  if (!packagePath) {
    return json(res, 503, { error: `泛微本机助手安装包（${platform}）尚未生成，请联系管理员。` });
  }

  const stat = await fs.stat(packagePath);
  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Content-Length": stat.size,
    "Cache-Control": "private, no-store",
  });
  createReadStream(packagePath).pipe(res);
}

async function handleMonitorAccountsExcel(req, res) {
  const payload = parseJsonSafe(await readBody(req));
  const session = payload?.session || {};
  const rooms = Array.isArray(payload?.rooms) ? payload.rooms : [];
  if (!String(session.session_id || "").trim()) {
    return badRequest(res, "缺少 session_id");
  }
  if (!rooms.length) {
    return badRequest(res, "缺少监考账号数据");
  }

  const exportId = randomUUID();
  const fileName = safeExcelFileName(`${session.session_id}-${session.name || "监考账号"}`);
  const payloadPath = path.join(generatedDir, `${exportId}-monitor-accounts.json`);
  const outputPath = path.join(generatedDir, `${exportId}-monitor-accounts.xlsx`);
  const monitorUrl = monitorSessionUrl(session.session_id);
  await fs.writeFile(
    payloadPath,
    JSON.stringify(
      {
        session,
        rooms: rooms.map((room) => ({
          name: String(room.name || ""),
          num: room.num ?? "",
          account: String(room.account || ""),
          pwd: String(room.pwd || ""),
          monitor_url: monitorUrl,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );
  const result = await runPythonJson([monitorAccountExporterScript, payloadPath, outputPath]);
  if (!result.ok) {
    return json(res, 400, { error: "监考账号 Excel 生成失败", errors: result.errors || [] });
  }
  res.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  });
  createReadStream(outputPath).pipe(res);
}

async function findCachedMonitorAccounts(sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) return [];
  let files = [];
  try {
    files = await fs.readdir(generatedDir);
  } catch {
    return [];
  }
  const candidates = [];
  for (const file of files) {
    if (!file.endsWith("-monitor-accounts.json")) continue;
    const filePath = path.join(generatedDir, file);
    try {
      const stat = await fs.stat(filePath);
      candidates.push({ filePath, mtimeMs: stat.mtimeMs });
    } catch {}
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const candidate of candidates) {
    try {
      const payload = JSON.parse(await fs.readFile(candidate.filePath, "utf8"));
      if (String(payload?.session?.session_id || "").trim() !== normalizedSessionId) continue;
      return (Array.isArray(payload?.rooms) ? payload.rooms : []).map(normalizeMonitorRoom);
    } catch {}
  }
  return [];
}

function findTaskMonitorRooms(task, sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!task?.steps?.length || !normalizedSessionId) return [];
  const candidateSteps = ["sessions_invigilator_export", "sessions_auto_rooms"];
  for (const stepKey of candidateSteps) {
    const step = task.steps.find((item) => item.stepKey === stepKey);
    const result = step?.result || {};
    if (String(result.sessionId || "").trim() !== normalizedSessionId) continue;
    if (Array.isArray(result.rooms)) return result.rooms.map(normalizeMonitorRoom);
  }
  return [];
}

function hasCompleteMonitorAccounts(rooms = []) {
  return rooms.length > 0 && rooms.every((room) => room.account && room.pwd);
}

function mergeMonitorRooms(tenantRooms = [], cachedRooms = []) {
  if (!tenantRooms.length) return cachedRooms;
  if (!cachedRooms.length) return tenantRooms;
  return tenantRooms.map((room, index) => {
    const cached =
      cachedRooms.find((item) => item.name && item.name === room.name) ||
      cachedRooms[index] ||
      {};
    return {
      ...room,
      num: room.num || cached.num || "",
      account: room.account || cached.account || "",
      pwd: room.pwd || cached.pwd || "",
      monitor_url: room.monitor_url || cached.monitor_url || "",
    };
  });
}

async function handleSessionMonitorAccounts(sessionId, req, res) {
  const query = new URL(req.url, "http://localhost").searchParams;
  const sessionName = String(query.get("name") || "");
  const task = await findVisibleTaskBySessionId(req, sessionId).catch(() => null);
  if (!task) return notFound(res);
  const login = getYikaoLoginForTask(task);
  const tenantRooms = (await getRoomList(login, sessionId)).map(normalizeMonitorRoom);
  const taskRooms = findTaskMonitorRooms(task, sessionId);
  const cachedRooms = hasCompleteMonitorAccounts(taskRooms) ? taskRooms : await findCachedMonitorAccounts(sessionId);
  const rooms = mergeMonitorRooms(tenantRooms, cachedRooms);
  if (!rooms.length) {
    return badRequest(res, "当前场次还没有分班，暂无监考账号");
  }
  const missing = rooms.filter((room) => !room.account || !room.pwd);
  if (missing.length) {
    return badRequest(res, "当前场次班级没有返回完整监考账号/口令，请在名单导入页完成自动分班后下载或重新分班。");
  }
  return json(res, 200, {
    session: {
      session_id: sessionId,
      name: sessionName,
      url: monitorSessionUrl(sessionId),
    },
    rooms: rooms.map((room) => ({ ...room, monitor_url: monitorSessionUrl(sessionId) })),
  });
}

function normalizeTenantList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.sessions)) return payload.sessions;
  return [];
}

function parseDateValue(value) {
  if (!value) return 0;
  const normalized = String(value).replace(/\//g, "-").replace(" ", "T");
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : 0;
}

function randomRoomPassword() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let value = "";
  for (let index = 0; index < 6; index += 1) {
    value += alphabet[randomInt(0, alphabet.length)];
  }
  return value;
}

function buildRooms(sizes) {
  return sizes.map((num, index) => ({
    num,
    name: `第${index + 1}班`,
    account: `room${String(index + 1).padStart(3, "0")}`,
    pwd: randomRoomPassword(),
  }));
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function normalizeMonitorRoom(room = {}, index = 0) {
  return {
    name: firstNonEmpty(room.name, room.room_name, room.title, `第${index + 1}班`),
    num: room.num ?? room.entry_num ?? room.entries_num ?? room.candidate_count ?? room.entries_count ?? "",
    account: firstNonEmpty(room.account, room.monitor_account, room.username, room.user_name, room.login_name),
    pwd: firstNonEmpty(room.pwd, room.password, room.monitor_password, room.room_password),
    monitor_url: firstNonEmpty(room.monitor_url, room.monitorUrl, room.url),
  };
}

function validateRooms(rooms, entriesNum) {
  const normalizedRooms = rooms.map((room) => ({
    num: Number(room?.num),
    name: String(room?.name || ""),
    account: String(room?.account || ""),
    pwd: String(room?.pwd || ""),
  }));
  const invalid = normalizedRooms.filter(
    (room) =>
      !Number.isInteger(room.num) ||
      room.num <= 0 ||
      !room.name ||
      !room.account ||
      !room.pwd,
  );
  const total = normalizedRooms.reduce((sum, room) => sum + (Number.isInteger(room.num) ? room.num : 0), 0);
  return {
    ok: invalid.length === 0 && total === entriesNum,
    rooms: normalizedRooms,
    invalid,
    total,
  };
}

function getEntriesNum(payload) {
  const value = payload?.entries_num ?? payload?.data?.entries_num;
  const num = Number(value);
  return Number.isInteger(num) ? num : 0;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeImportErrors(errors = []) {
  if (!Array.isArray(errors)) return [];
  return errors.map((error) => {
    if (error && typeof error === "object") {
      return {
        ...error,
        entry: String(error.entry ?? error.permit ?? error.identity_id ?? ""),
        error: error.error ?? error.code ?? "",
      };
    }
    return { entry: String(error), error: "" };
  });
}

function summarizeStatuses(items = []) {
  return items.reduce((acc, item) => {
    const status = String(item.status ?? "unknown");
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
}

function isSoftDeletedPermitConflict(cleanup) {
  const failed = cleanup?.failed || [];
  if (!cleanup || !cleanup.requested || cleanup.succeeded > 0 || !failed.length) return false;
  return failed.every((item) => {
    const detail = typeof item.detail === "string" ? item.detail : JSON.stringify(item.detail || "");
    return Number(item.status) === 403 && /not existed/i.test(detail);
  });
}

function diagnoseCandidateImport({ errors = [], fail = 0, entriesNum = 0, requestedCount = 0, importState = null, attempts = [] }) {
  const codes = [...new Set(errors.map((error) => String(error.error || "")).filter(Boolean))];
  const all4002 = errors.length > 0 && errors.every((error) => String(error.error || "") === "4002");
  const alreadyExistsLikely = Number(fail) > 0 && all4002;
  const canContinueRoomAssign = Number(fail) > 0 && entriesNum >= requestedCount && requestedCount > 0;
  const messages = [];
  if (importState) {
    messages.push(
      `已刷新易考最新状态：当前场次 ${importState.entriesNum} 人，班级 ${importState.roomsCount} 个。`,
    );
  }
  if (attempts.length > 1) {
    messages.push(`检测到重复账号错误后已重试 ${attempts.length - 1} 次。`);
  }
  const cleanupCount = attempts.reduce((sum, attempt) => sum + Number(attempt.duplicate_cleanup?.succeeded || 0), 0);
  if (cleanupCount > 0) {
    messages.push(`已按当前场次执行重复准考证号清理 ${cleanupCount} 条。`);
  }
  if (attempts.some((attempt) => attempt.blocked_by_soft_deleted_permit_conflict)) {
    messages.push(
      "当前场次最新状态为 0 人，但租户 API 仍返回 4002，且当前场次删除接口提示记录不存在；准考证号仍被易考占用。系统不会自动修改准考证号，请先在易考后台/API 释放该准考证号后再重试。",
    );
  }
  if (alreadyExistsLikely) {
    messages.push("租户 API 返回 4002：考生账号重复。");
  }
  if (Number(fail) > 0) {
    messages.push(`导入请求 ${requestedCount} 人，失败 ${fail} 人，当前场次接口统计 ${entriesNum} 人。`);
  }
  if (canContinueRoomAssign) {
    messages.push("当前场次考生数已满足本次名单人数，系统将按当前场次考生继续自动分班。");
  } else if (Number(fail) > 0) {
    messages.push("当前场次考生数不足，本次不会自动分班。请确认易考后台删除状态已经释放后重试。");
  }
  return {
    codes,
    all4002,
    alreadyExistsLikely,
    canContinueRoomAssign,
    blockedBySoftDeletedPermitConflict: attempts.some((attempt) => attempt.blocked_by_soft_deleted_permit_conflict),
    messages,
  };
}

function normalizeRooms(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rooms)) return payload.rooms;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

async function getEntryCount(login, sessionId) {
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const tenantUrl = new URL(`/tenant/api/session/${encodeURIComponent(sessionId)}/entry_count/`, base);
  return await readTenantJsonWithLogin(login, tenantUrl, {}, "查询场次考生统计");
}

async function getEntryList(login, sessionId) {
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const tenantUrl = new URL(`/tenant/api/session/${encodeURIComponent(sessionId)}/entry/`, base);
  const payload = await readTenantJsonWithLogin(login, tenantUrl, {}, "查询场次考生列表");
  if (Array.isArray(payload?.entries)) return payload.entries;
  return normalizeTenantList(payload);
}

async function getRoomList(login, sessionId) {
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const tenantUrl = new URL(`/tenant/api/session/${encodeURIComponent(sessionId)}/rooms/`, base);
  const payload = await readTenantJsonWithLogin(login, tenantUrl, {}, "查询场次班级列表");
  return normalizeRooms(payload);
}

async function getSessionImportState(login, sessionId) {
  const [entryCount, entries, rooms] = await Promise.all([
    getEntryCount(login, sessionId),
    getEntryList(login, sessionId).catch(() => []),
    getRoomList(login, sessionId).catch(() => []),
  ]);
  return {
    entryCount,
    entries,
    rooms,
    entriesNum: getEntriesNum(entryCount),
    entriesListCount: Array.isArray(entries) ? entries.length : 0,
    roomsCount: Array.isArray(rooms) ? rooms.length : 0,
  };
}

function normalizeScoreFieldName(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-:：]/g, "")
    .replace(/[（(](?:必填|选填)[）)]$/u, "");
}

function findDeepValue(source, aliases, depth = 3, seen = new Set()) {
  if (!source || typeof source !== "object" || seen.has(source) || depth < 0) return "";
  seen.add(source);
  const normalizedAliases = new Set(aliases.map((alias) => normalizeScoreFieldName(alias)));
  const fieldLabel = source.name ?? source.label ?? source.field_name ?? source.fieldName ?? source.title ?? source.key;
  if (fieldLabel && normalizedAliases.has(normalizeScoreFieldName(fieldLabel))) {
    const fieldValue = source.value ?? source.field_value ?? source.fieldValue ?? source.content ?? source.data;
    if (fieldValue !== undefined && fieldValue !== null && String(fieldValue).trim() !== "") return fieldValue;
  }
  for (const [key, value] of Object.entries(source)) {
    if (!normalizedAliases.has(normalizeScoreFieldName(key))) continue;
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  for (const value of Object.values(source)) {
    if (!value || typeof value !== "object") continue;
    const candidates = Array.isArray(value) ? value : [value];
    for (const candidate of candidates) {
      const nested = findDeepValue(candidate, aliases, depth - 1, seen);
      if (nested !== undefined && nested !== null && String(nested).trim() !== "") return nested;
    }
  }
  return "";
}

function mergePreferNonEmpty(primary = {}, fallback = {}) {
  const merged = { ...(fallback || {}) };
  for (const [key, value] of Object.entries(primary || {})) {
    if (value === undefined || value === null || String(value).trim() === "") {
      if (merged[key] === undefined) merged[key] = value;
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function normalizeScoreStatusForLog(status = "") {
  const normalized = String(status || "").trim();
  if (!normalized || ["已完成", "未开考", "参考", "缺考"].includes(normalized)) return "";
  return normalized;
}

function normalizeScoreRow(entry = {}, fallback = {}, examName = "") {
  const merged = mergePreferNonEmpty(entry, fallback);
  const customFields = {
    ...(fallback?.custom_fields || {}),
    ...(fallback?.customFields || {}),
    ...(entry?.custom_fields || {}),
    ...(entry?.customFields || {}),
  };
  const source = { ...merged, custom_fields: customFields };
  const rawStatus = String(findDeepValue(source, ["exam_status", "status", "entry_status", "examStatus", "考试状态", "状态"]) || "").trim();
  return {
    name: String(findDeepValue(source, ["name", "full_name", "real_name", "姓名"]) || "").trim(),
    gender: String(findDeepValue(source, ["gender", "sex", "性别"]) || "").trim(),
    identity_id: String(findDeepValue(source, ["identity_id", "id_card", "idCard", "identity", "cert_no", "证件号码", "身份证号", "身份证号码"]) || "").trim(),
    mobile: String(findDeepValue(source, ["mobile", "phone", "mobile_phone", "telephone", "手机号码", "手机号", "联系电话"]) || "").trim(),
    email: String(findDeepValue(source, ["email", "mail", "邮箱", "邮箱地址"]) || "").trim(),
    course: String(findDeepValue(source, ["course", "course_name", "subject", "subject_name", "科目", "考试科目"]) || examName || "").trim(),
    permit: String(findDeepValue(source, ["permit", "admission_ticket", "admissionTicket", "ticket", "entry", "account", "login", "准考证号"]) || "").trim(),
    exam_status: rawStatus.toLowerCase() === "valid" ? "未开考" : rawStatus,
    score: findDeepValue(source, ["score", "point", "total_score", "totalScore", "final_score", "total", "得分", "分数", "成绩", "总分"]),
    violation: String(findDeepValue(source, ["violation", "discipline", "cheat", "违纪情况", "违纪", "违规"]) || "无").trim() || "无",
  };
}

function attachCourseNamesToCandidates(candidates = [], courses = []) {
  const courseNameByCode = new Map(
    (courses || [])
      .map((course) => [
        String(course?.code || course?.course_code || "").trim(),
        String(course?.name || course?.course_name || "").trim(),
      ])
      .filter(([code, name]) => code && name),
  );
  return (candidates || []).map((candidate) => ({
    ...candidate,
    course_name: courseNameByCode.get(String(candidate?.course_code || "").trim()) || candidate?.course_name || "",
  }));
}

function scoreCourseFallback(courses = [], examName = "") {
  const configuredNames = (courses || [])
    .map((course) => String(course?.name || course?.course_name || "").trim())
    .filter(Boolean);
  return configuredNames.length === 1 ? configuredNames[0] : String(examName || "").trim();
}

function scoreRowKey(row = {}) {
  return String(row.permit || row.identity_id || row.name || "").trim();
}

function mergeScoreRows({ tenantEntries = [], localCandidates = [], examName = "" }) {
  const localByKey = new Map();
  for (const candidate of localCandidates) {
    const normalized = normalizeScoreRow(candidate, {}, examName);
    const key = scoreRowKey(normalized);
    if (key) localByKey.set(key, candidate);
  }
  const rows = [];
  const usedKeys = new Set();
  for (const entry of tenantEntries) {
    const tenantRow = normalizeScoreRow(entry, {}, examName);
    const key = scoreRowKey(tenantRow);
    const fallback = key ? localByKey.get(key) : null;
    const row = normalizeScoreRow(entry, fallback || {}, examName);
    if (key) usedKeys.add(key);
    rows.push(row);
  }
  for (const candidate of localCandidates) {
    const row = normalizeScoreRow(candidate, {}, examName);
    const key = scoreRowKey(row);
    if (key && usedKeys.has(key)) continue;
    rows.push(row);
  }
  return rows;
}

function scoreValuePresent(row = {}) {
  return String(normalizeScoreRow(row).score ?? "").trim() !== "";
}

function tenantErrorDetail(error) {
  if (!error) return "";
  if (typeof error.detail === "string") return error.detail;
  if (error.detail !== undefined) {
    try {
      return JSON.stringify(error.detail);
    } catch {}
  }
  return error instanceof Error ? error.message : String(error);
}

function normalizeScorePageList(payload) {
  const candidateKeys = ["entries", "scores", "score", "results", "data", "items", "list", "rows"];
  if (Array.isArray(payload?.entries)) return payload.entries;
  if (Array.isArray(payload?.scores)) return payload.scores;
  if (Array.isArray(payload?.score)) return payload.score;
  for (const key of candidateKeys) {
    const value = payload?.[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      const nested = normalizeScorePageList(value);
      if (nested.length) return nested;
    }
  }
  return normalizeTenantList(payload);
}

async function fetchAllSessionEntries(login, sessionId, logs = [], perPage = 50) {
  logs.push("[成绩处理] 开始分页查询场次考生状态");
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const entries = [];
  for (let page = 1; page <= 1000; page += 1) {
    const tenantUrl = new URL(
      `/tenant/api/session/${encodeURIComponent(sessionId)}/entry/${encodeURIComponent(page)}/${encodeURIComponent(perPage)}/`,
      base,
    );
    try {
      const payload = await readTenantJsonWithLogin(login, tenantUrl, {}, "分页查询场次考生状态");
      const items = normalizeScorePageList(payload);
      logs.push(`[成绩处理] entry 第 ${page} 页返回 ${items.length} 条`);
      entries.push(...items);
      if (items.length === 0 || items.length < perPage) break;
    } catch (error) {
      logs.push(`[成绩处理] entry 第 ${page} 页查询失败：HTTP ${error?.status || ""} ${tenantErrorDetail(error)}`.trim());
      throw error;
    }
  }
  logs.push(`[成绩处理] 场次考生状态查询完成，总人数=${entries.length}`);
  return entries;
}

async function fetchAllSessionScores(login, sessionId, logs = [], perPage = 50) {
  logs.push("[成绩处理] 开始分页查询场次考生成绩");
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const scores = [];
  for (let page = 1; page <= 1000; page += 1) {
    const tenantUrl = new URL(
      `/tenant/api/session/${encodeURIComponent(sessionId)}/score/${encodeURIComponent(page)}/${encodeURIComponent(perPage)}/`,
      base,
    );
    try {
      const payload = await readTenantJsonWithLogin(login, tenantUrl, {}, "分页查询场次考生成绩");
      const items = normalizeScorePageList(payload);
      logs.push(`[成绩处理] score 第 ${page} 页返回 ${items.length} 条`);
      scores.push(...items);
      if (items.length === 0 || items.length < perPage) break;
    } catch (error) {
      logs.push(`[成绩处理] score 第 ${page} 页查询失败：HTTP ${error?.status || ""} ${tenantErrorDetail(error)}`.trim());
      throw error;
    }
  }
  logs.push(`[成绩处理] 场次考生成绩查询完成，有成绩人数=${scores.length}`);
  return scores;
}

async function fetchSingleEntryStatus(login, sessionId, permit, logs = []) {
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const tenantUrl = new URL(
    `/tenant/api/session/${encodeURIComponent(sessionId)}/entry/${encodeURIComponent(permit)}/`,
    base,
  );
  try {
    return await readTenantJsonWithLogin(login, tenantUrl, {}, "查询单个考生状态");
  } catch (error) {
    logs.push(
      `[成绩处理] 考生 permit=${permit} 单个状态查询失败：HTTP ${error?.status || ""} ${tenantErrorDetail(error)}`.trim(),
    );
    return null;
  }
}

async function fetchSingleEntryScore(login, sessionId, permit, logs = []) {
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const tenantUrl = new URL(
    `/tenant/api/session/${encodeURIComponent(sessionId)}/entry/${encodeURIComponent(permit)}/score/`,
    base,
  );
  try {
    return await readTenantJsonWithLogin(login, tenantUrl, {}, "查询单个考生成绩");
  } catch (error) {
    if (Number(error?.status) === 404) {
      logs.push(`[成绩处理] 考生 permit=${permit} 单个成绩为空，按无成绩处理`);
      return null;
    }
    logs.push(
      `[成绩处理] 考生 permit=${permit} 单个成绩查询失败：HTTP ${error?.status || ""} ${tenantErrorDetail(error)}`.trim(),
    );
    return null;
  }
}

function normalizeAssessmentReports(payload = {}) {
  const reports = Array.isArray(payload?.reports)
    ? payload.reports
    : Array.isArray(payload?.data?.reports)
      ? payload.data.reports
      : [];
  return reports
    .map((report) => ({
      name: String(report?.name || report?.title || report?.label || "").trim(),
      url: String(report?.url || report?.link || report?.href || "").trim(),
      status: String(report?.status || "").trim(),
    }))
    .filter((report) => report.name && report.url);
}

async function fetchSingleEntryScoreDetail(login, sessionId, permit, logs = []) {
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const tenantUrl = new URL(
    `/tenant/api/session/${encodeURIComponent(sessionId)}/entry/${encodeURIComponent(permit)}/score/detail/`,
    base,
  );
  try {
    return await readTenantJsonWithLogin(login, tenantUrl, {}, "查询单个考生成绩详情");
  } catch (error) {
    const status = Number(error?.status);
    if (status === 403 || status === 404) return null;
    logs.push(
      `[成绩处理] 考生 permit=${permit} 测评报告查询失败：HTTP ${error?.status || ""} ${tenantErrorDetail(error)}`.trim(),
    );
    return null;
  }
}

function shouldQueryAssessmentReports(row = {}) {
  const status = String(row.exam_status || "").trim();
  return Boolean(row.permit) && (scoreValuePresent(row) || status === "已完成" || status === "参考");
}

async function attachAssessmentReportsToRows({ login, sessionId, rows = [], logs = [] }) {
  const outputRows = rows.map((row) => ({ ...row }));
  const candidates = outputRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => shouldQueryAssessmentReports(row));
  if (!candidates.length) {
    logs.push("[成绩处理] 无已完成考生，跳过测评报告链接查询");
    return outputRows;
  }

  logs.push(`[成绩处理] 开始查询测评报告链接，候选人数=${candidates.length}`);
  const concurrency = 4;
  let candidateWithReports = 0;
  let reportLinkCount = 0;
  for (let index = 0; index < candidates.length; index += concurrency) {
    const batch = candidates.slice(index, index + concurrency);
    const details = await Promise.all(
      batch.map(({ row }) => fetchSingleEntryScoreDetail(login, sessionId, row.permit, logs)),
    );
    details.forEach((detail, detailIndex) => {
      const reports = normalizeAssessmentReports(detail);
      if (!reports.length) return;
      const target = outputRows[batch[detailIndex].index];
      target.reports = reports;
      candidateWithReports += 1;
      reportLinkCount += reports.length;
    });
  }
  logs.push(`[成绩处理] 测评报告链接查询完成：${candidateWithReports} 名考生有报告，共 ${reportLinkCount} 个链接`);
  return outputRows;
}

function stripAssessmentReports(rows = []) {
  return rows.map(({ reports, score_reports, assessment_reports, ...row }) => row);
}

function countAssessmentReportLinks(rows = []) {
  return rows.reduce((total, row) => {
    const reports = Array.isArray(row?.reports) ? row.reports : [];
    return total + reports.filter((report) => report?.url).length;
  }, 0);
}

function contentDispositionFileName(header = "") {
  const encodedMatch = String(header || "").match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }
  const plainMatch = String(header || "").match(/filename="?([^";]+)"?/i);
  return plainMatch ? plainMatch[1] : "";
}

function safeReportPathName(raw = "file", fallback = "file") {
  const value = String(raw || "").trim() || fallback;
  const normalized = value
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/[^\w.\-\u4e00-\u9fff]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120)
    .replace(/^\.+|\.+$/g, "")
    .trim();
  return normalized || fallback;
}

function uniqueReportPathName(usedNames, rawName) {
  const baseName = safeReportPathName(rawName);
  const extension = path.extname(baseName);
  const stem = extension ? baseName.slice(0, -extension.length) : baseName;
  let candidate = baseName;
  let index = 2;
  while (usedNames.has(candidate)) {
    candidate = `${stem}_${index}${extension}`;
    index += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function scoreReportCandidateFolderName(row = {}, index = 0) {
  const name = String(row?.name || row?.姓名 || "").trim();
  const permit = String(row?.permit || row?.准考证号 || row?.ticket || "").trim();
  return safeReportPathName([name, permit].filter(Boolean).join("_"), `考生_${index + 1}`);
}

function assessmentReportsFromScoreRows(rows = []) {
  const folderNames = new Set();
  const reportItems = [];
  for (const [rowIndex, row] of rows.entries()) {
    const reports = Array.isArray(row?.reports)
      ? row.reports
      : Array.isArray(row?.score_reports)
        ? row.score_reports
        : Array.isArray(row?.assessment_reports)
          ? row.assessment_reports
          : [];
    const filteredReports = reports.filter((report) => report?.url);
    if (!filteredReports.length) continue;
    const folderName = uniqueReportPathName(folderNames, scoreReportCandidateFolderName(row, rowIndex));
    filteredReports.forEach((report, reportIndex) => {
      reportItems.push({ row, rowIndex, report, reportIndex, folderName });
    });
  }
  return reportItems;
}

function scoreReportFileExtension(response, reportUrl) {
  const contentType = String(response?.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase();
  const contentTypeExtensions = new Map([
    ["application/pdf", ".pdf"],
    ["application/msword", ".doc"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
    ["application/vnd.ms-excel", ".xls"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
    ["application/zip", ".zip"],
  ]);
  if (contentTypeExtensions.has(contentType)) return contentTypeExtensions.get(contentType);
  try {
    const urlPathName = decodeURIComponent(new URL(reportUrl).pathname);
    const extension = path.extname(urlPathName);
    if (/^\.[a-z0-9]{1,12}$/i.test(extension)) return extension;
  } catch {}
  return ".pdf";
}

function scoreReportFileName(report = {}, response, reportUrl, index = 0) {
  const headerFileName = contentDispositionFileName(response?.headers?.get?.("content-disposition"));
  const rawName = headerFileName || String(report?.name || "").trim() || `测评文档_${index + 1}`;
  const fileName = safeReportPathName(rawName, `测评文档_${index + 1}`);
  if (path.extname(fileName)) return fileName;
  return `${fileName}${scoreReportFileExtension(response, reportUrl)}`;
}

function scoreFeedbackPayloadPathFromResult(result = {}) {
  const explicitPath = String(result?.payloadPath || "").trim();
  if (explicitPath) return explicitPath;
  const workbookPath = String(result?.filePath || "").trim();
  return workbookPath ? workbookPath.replace(/\.xlsx$/i, ".json") : "";
}

function scoreReportArchiveFileName(task, session) {
  return safeZipFileName(`${task?.projectName || session?.name || "测评文档"}-测评文档`);
}

function scoreReportUrl(rawUrl, login = {}) {
  const base = normalizeApiBase(process.env.YIKAO_API_BASE || login.apiBase || "https://eztest.cn");
  return new URL(String(rawUrl || "").trim(), base);
}

function scoreReportFetchHeaders(login = {}, reportUrl) {
  const headers = { Accept: "*/*" };
  const base = normalizeApiBase(process.env.YIKAO_API_BASE || login.apiBase || "https://eztest.cn");
  try {
    return reportUrl.host === new URL(base).host ? tenantHeadersForLogin(login, headers) : headers;
  } catch {
    return headers;
  }
}

async function downloadAssessmentReportFiles({ login, reportItems = [], outputDir }) {
  const usedFileNamesByFolder = new Map();
  let downloaded = 0;
  for (const item of reportItems) {
    const reportUrl = scoreReportUrl(item.report.url, login);
    const response = await fetch(reportUrl, {
      headers: scoreReportFetchHeaders(login, reportUrl),
    });
    if (!response.ok) {
      throw new Error(`测评文档下载失败：${item.folderName}/${item.report?.name || `测评文档_${item.reportIndex + 1}`}，HTTP ${response.status}`);
    }
    const folderPath = path.join(outputDir, item.folderName);
    await fs.mkdir(folderPath, { recursive: true });
    if (!usedFileNamesByFolder.has(item.folderName)) {
      usedFileNamesByFolder.set(item.folderName, new Set());
    }
    const usedFileNames = usedFileNamesByFolder.get(item.folderName);
    const fileName = uniqueReportPathName(
      usedFileNames,
      scoreReportFileName(item.report, response, reportUrl, item.reportIndex),
    );
    await fs.writeFile(path.join(folderPath, fileName), Buffer.from(await response.arrayBuffer()));
    downloaded += 1;
  }
  return downloaded;
}

async function zipDirectory(sourceDir, zipPath) {
  const result = await runPythonJson([zipDirectoryScript, sourceDir, zipPath]);
  if (!result.ok) {
    throw new Error((result.errors || []).join("；") || "测评文档打包失败");
  }
}

function scorePermit(row = {}, examName = "") {
  return normalizeScoreRow(row, {}, examName).permit;
}

async function mergeEntryAndScoreRows({ login, sessionId, entries = [], scores = [], localCandidates = [], examName = "", logs = [] }) {
  logs.push("[成绩处理] 开始按 permit 合并状态和成绩");
  const scoreByPermit = new Map();
  for (const score of scores) {
    const permit = scorePermit(score, examName);
    if (!permit) {
      logs.push("[成绩处理] 发现无法匹配的成绩记录：缺少准考证号，已跳过合并");
      continue;
    }
    scoreByPermit.set(permit, score);
  }

  const localByKey = new Map();
  for (const candidate of localCandidates) {
    const normalized = normalizeScoreRow(candidate, {}, examName);
    const key = scoreRowKey(normalized);
    if (key) localByKey.set(key, candidate);
  }

  const rows = [];
  for (const entry of entries) {
    let entryDetail = entry;
    let entryRow = normalizeScoreRow(entryDetail, {}, examName);
    const permit = entryRow.permit;
    const fallback = permit ? localByKey.get(permit) : null;
    let scoreDetail = permit ? scoreByPermit.get(permit) : null;
    const status = String(entryRow.exam_status || "").trim();
    const hasPagedScore = scoreDetail && scoreValuePresent(scoreDetail);

    if (permit && (!status || status === "未开考")) {
      logs.push(`[成绩处理] 考生 permit=${permit} ${status || "状态为空"}，补充查询单个考生状态`);
      const singleStatus = await fetchSingleEntryStatus(login, sessionId, permit, logs);
      if (singleStatus) {
        entryDetail = mergePreferNonEmpty(singleStatus, entryDetail);
        entryRow = normalizeScoreRow(entryDetail, {}, examName);
      }
    }

    if (permit && !hasPagedScore && (!entryRow.exam_status || entryRow.exam_status === "未开考" || entryRow.exam_status === "已完成")) {
      if (entryRow.exam_status === "已完成") {
        logs.push(`[成绩处理] 考生 permit=${permit} 已完成但分页成绩缺失，补充查询单个考生成绩`);
      } else if (entryRow.exam_status === "未开考") {
        logs.push(`[成绩处理] 考生 permit=${permit} 未开考，补充查询单个考生成绩确认无成绩`);
      } else {
        logs.push(`[成绩处理] 考生 permit=${permit} 状态不明确且无分页成绩，补充查询单个考生成绩`);
      }
      const singleScore = await fetchSingleEntryScore(login, sessionId, permit, logs);
      if (singleScore && scoreValuePresent(singleScore)) scoreDetail = singleScore;
    }

    let row = normalizeScoreRow(entryDetail, mergePreferNonEmpty(scoreDetail || {}, fallback || {}), examName);
    const hasScore = String(row.score ?? "").trim() !== "";
    if (hasScore) {
      row.exam_status = "已完成";
      logs.push(`[成绩处理] 考生 permit=${permit || row.permit} 有成绩，状态转换为参考`);
    } else if (!row.exam_status) {
      row.exam_status = "未开考";
      logs.push(`[成绩处理] 考生 permit=${permit || row.permit} 状态为空且无成绩，按缺考写入`);
    } else if (row.exam_status === "未开考") {
      logs.push(`[成绩处理] 考生 permit=${permit || row.permit} 未开考，状态转换为缺考`);
    } else if (row.exam_status === "已完成") {
      logs.push(`[成绩处理] 考生 permit=${permit || row.permit} 已完成，状态转换为参考`);
      if (!hasScore) logs.push(`[成绩处理] 考生 permit=${permit || row.permit} 已完成但未查询到成绩，得分列保留空白`);
    } else {
      logs.push(`[成绩处理] 考生 permit=${permit || row.permit} 状态为 ${row.exam_status}，已保留原状态`);
    }
    if (!hasScore && row.exam_status === "未开考") {
      logs.push(`[成绩处理] 考生 permit=${permit || row.permit} 无成绩，按缺考写入`);
    }
    rows.push(row);
  }
  return rows;
}

async function postCandidatesToTenant(login, sessionId, candidates, customFieldMappings = []) {
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const tenantUrl = new URL(`/tenant/api/session/${encodeURIComponent(sessionId)}/entry/`, base);
  const response = await fetch(tenantUrl, {
    method: "POST",
    headers: tenantHeadersForLogin(login, { "Content-Type": "application/json" }),
    body: JSON.stringify(buildTenantCandidateEntries(candidates, customFieldMappings)),
  });
  const text = await response.text();
  let payloadResponse = null;
  try {
    payloadResponse = text ? JSON.parse(text) : null;
  } catch {
    payloadResponse = text;
  }
  return { response, payloadResponse };
}

async function deleteCandidatePermit(login, sessionId, permit) {
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const tenantUrl = new URL(
    `/tenant/api/session/${encodeURIComponent(sessionId)}/entry/${encodeURIComponent(permit)}/`,
    base,
  );
  const response = await fetch(tenantUrl, {
    method: "DELETE",
    headers: tenantHeadersForLogin(login),
  });
  const text = await response.text();
  let detail = null;
  try {
    detail = text ? JSON.parse(text) : null;
  } catch {
    detail = text;
  }
  return {
    permit,
    ok: response.ok,
    status: response.status,
    detail,
  };
}

async function cleanupDuplicateCandidatePermits(login, sessionId, errors) {
  const permits = [
    ...new Set(
      normalizeImportErrors(errors)
        .filter((error) => String(error.error || "") === "4002")
        .map((error) => String(error.entry || "").trim())
        .filter(Boolean),
    ),
  ];
  const results = [];
  const concurrency = 12;
  for (let index = 0; index < permits.length; index += concurrency) {
    const batch = permits.slice(index, index + concurrency);
    const batchResults = await Promise.all(batch.map((permit) => deleteCandidatePermit(login, sessionId, permit)));
    results.push(...batchResults);
  }
  const failedItems = results.filter((item) => !(item.ok || item.status === 404));
  return {
    requested: permits.length,
    succeeded: results.filter((item) => item.ok || item.status === 404).length,
    failed_count: failedItems.length,
    failed_statuses: summarizeStatuses(failedItems),
    failed: failedItems
      .slice(0, 20)
      .map((item) => ({ permit: item.permit, status: item.status, detail: item.detail })),
  };
}

async function pollProgressbar(login, progressbarId, timeoutMs = 90000) {
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const startedAt = Date.now();
  let lastPayload = null;
  while (Date.now() - startedAt < timeoutMs) {
    const tenantUrl = new URL(`/tenant/api/progressbar/${encodeURIComponent(progressbarId)}/`, base);
    lastPayload = await readTenantJsonWithLogin(login, tenantUrl, {}, "查询分班进度");
    const status = String(lastPayload?.status || "");
    const percent = Number(lastPayload?.percent || 0);
    if (status === "finished" || percent >= 100) {
      return lastPayload;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const error = new Error("progressbar 查询超时");
  error.detail = lastPayload;
  throw error;
}

async function handleSessions(req, res) {
  const url = new URL(req.url, "http://localhost");
  const login = getYikaoLoginForRequest(req);
  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const tenantUrl = new URL("/tenant/api/session/", base);
  const sessionIds = url.searchParams.get("session_ids");
  if (sessionIds) tenantUrl.searchParams.set("session_ids", sessionIds);

  const activeKey = login.tenantApiKey || (login.allowEnvFallback ? process.env.YIKAO_API_KEY || "" : "");
  const keyHint = activeKey ? `末尾 ${activeKey.slice(-4)}` : "未配置";
  const response = await fetch(tenantUrl, {
    headers: tenantHeadersForLogin(login),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message =
      response.status === 401
        ? "租户 API 返回 401，请检查租户 API Key。"
        : response.status === 403
          ? "租户 API 返回 403，当前 Key 无权限获取场次。"
          : response.status === 429
            ? "租户 API 返回 429，请稍后重试。"
            : `租户 API 获取场次失败：${response.status}`;
    return json(res, response.status, {
      error: message,
      detail: payload,
      diagnostics: {
        apiBase: base,
        url: tenantUrl.toString(),
        status: response.status,
        keyHint,
        rawType: Array.isArray(payload) ? "array" : typeof payload,
      },
    });
  }

  const now = Date.now();
  const normalized = normalizeTenantList(payload)
    .map((item) => ({
      session_id: String(item.id ?? item.session_id ?? ""),
      name: String(item.name ?? ""),
      start: item.start ?? "",
      end: item.end ?? "",
      url: item.url ?? "",
    }));
  const validSessions = normalized.filter((item) => item.session_id && item.name);
  const droppedInvalid = normalized.length - validSessions.length;
  const futureSessions = validSessions.filter((item) => {
      const endTime = parseDateValue(item.end);
      return endTime ? endTime >= now : true;
    });
  const expiredSessions = validSessions.filter((item) => {
    const endTime = parseDateValue(item.end);
    return Boolean(endTime && endTime < now);
  });
  const sessions = futureSessions
    .sort((a, b) => {
      const aStart = parseDateValue(a.start);
      const bStart = parseDateValue(b.start);
      if (aStart && bStart && aStart !== bStart) return aStart - bStart;
      return Number(b.session_id) - Number(a.session_id);
    });
  json(res, 200, {
    sessions,
    diagnostics: {
      apiBase: base,
      url: tenantUrl.toString(),
      status: response.status,
      keyHint,
      rawType: Array.isArray(payload) ? "array" : typeof payload,
      rawCount: normalized.length,
      validCount: validSessions.length,
      unexpiredCount: sessions.length,
      expiredCount: expiredSessions.length,
      droppedInvalid,
      serverNow: new Date(now).toISOString(),
      expiredSamples: expiredSessions.slice(0, 5),
      invalidSamples: normalized.filter((item) => !item.session_id || !item.name).slice(0, 5),
    },
  });
}

async function handleCandidateImport(req, res) {
  const payload = parseJsonSafe(await readBody(req));
  const sessionId = String(payload?.session_id || "").trim();
  let candidates = payload?.candidates || [];
  if (!sessionId) {
    return badRequest(res, "未选择场次");
  }
  const errors = [
    ...validateCandidatePayload(candidates, payload?.fieldMapping || payload?.field_mapping || {}),
    ...validateCandidateCustomFields(candidates),
  ];
  if (errors.length) {
    return json(res, 400, { error: "考生数据校验失败", errors });
  }

  const task = await findVisibleTaskBySessionId(req, sessionId);
  if (!task) return notFound(res);
  const login = getYikaoLoginForTask(task);
  const courseAssignment = prepareCandidatesForCourseImport(candidates, task, { sessionId });
  if (courseAssignment.errors.length) {
    return json(res, 400, {
      error: "考生科目分配失败",
      errors: courseAssignment.errors,
      hint: "多科目考试需要在名单中填写“科目编号”，例如 20260629-01-01 或 20260629-01-02。",
    });
  }
  candidates = courseAssignment.candidates;
  const {
    selectedImportFields,
    base_names: selectedBaseFieldNames,
    custom_names: selectedCustomFieldNames,
    selected_source_columns: selectedSourceColumns,
  } = buildSelectedImportFields(payload?.field_mapping || {}, payload?.custom_fields || []);
  const customFieldNames = selectedImportFields.map((field) => field.field_name);
  const skippedSourceColumns = unselectedSourceColumns(payload?.source_columns || [], selectedSourceColumns);
  let personalFields = { updated: false, names: [], mappings: [] };
  if (selectedImportFields.length) {
    try {
      personalFields = await ensureSessionCustomPersonalFields(login, sessionId, selectedImportFields);
    } catch (error) {
      return json(res, error?.status && Number(error.status) >= 400 ? Number(error.status) : 502, {
        error: error?.message || "场次信息项同步失败，无法导入考生。",
        detail: error?.detail || null,
        custom_fields: {
          selected_count: customFieldNames.length,
          names: customFieldNames,
        },
      });
    }
  }
  const customFieldMappings = personalFields.mappings || [];
  const tenantCandidateFieldMappings = customFieldMappings.filter((field) => {
    const fieldCode = String(field?.field_code || "");
    return field.field_kind === "custom" || fieldCode === "phone" || fieldCode === "email";
  });
  let localCustomFieldSave = null;
  if (task?.taskId && customFieldMappings.length) {
    localCustomFieldSave = await runTaskState("upsert_custom_fields", {
      taskId: task.taskId,
      sessionId,
      fields: customFieldMappings,
    });
  }

  let beforeState = null;
  try {
    beforeState = await getSessionImportState(login, sessionId);
  } catch (error) {
    beforeState = { error: error.message || String(error), detail: error.detail || null };
  }

  let payloadResponse = null;
  let importErrors = [];
  let finalResponseStatus = 200;
  const attempts = [];
  const maxAttempts = 4;
  const retryDelays = [1500, 3000, 5000];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { response, payloadResponse: currentPayload } = await postCandidatesToTenant(
      login,
      sessionId,
      candidates,
      tenantCandidateFieldMappings,
    );
    payloadResponse = currentPayload;
    finalResponseStatus = response.status;

    if (!response.ok) {
      const message =
        response.status === 401
          ? "租户 API 返回 401，请检查租户 API Key。"
          : response.status === 403
            ? "租户 API 返回 403，当前 Key 无权限导入考生。"
            : response.status === 429
              ? "租户 API 返回 429，请稍后重试。"
              : `租户 API 导入考生失败：${response.status}`;
      return json(res, response.status, { error: message, detail: payloadResponse, before_state: beforeState });
    }

    const currentFail = Number(payloadResponse?.fail ?? 0);
    importErrors = normalizeImportErrors(payloadResponse?.errors || []);
    let currentState = null;
    try {
      currentState = await getSessionImportState(login, sessionId);
    } catch (error) {
      currentState = { error: error.message || String(error), detail: error.detail || null, entriesNum: 0 };
    }
    attempts.push({
      attempt,
      succeed: Number(payloadResponse?.succeed ?? 0),
      fail: currentFail,
      entries_num: Number(currentState?.entriesNum || 0),
      rooms_count: Number(currentState?.roomsCount || 0),
      error_codes: [...new Set(importErrors.map((error) => String(error.error || "")).filter(Boolean))],
    });

    const currentSucceed = Number(payloadResponse?.succeed ?? 0);
    const all4002 = importErrors.length > 0 && importErrors.every((error) => String(error.error || "") === "4002");
    const enoughEntries = Number(currentState?.entriesNum || 0) >= candidates.length;
    if (!currentFail || enoughEntries || !all4002 || currentSucceed > 0 || attempt >= maxAttempts) {
      break;
    }

    const cleanup = await cleanupDuplicateCandidatePermits(login, sessionId, importErrors);
    attempts[attempts.length - 1].duplicate_cleanup = cleanup;
    if (Number(currentState?.entriesNum || 0) === 0 && isSoftDeletedPermitConflict(cleanup)) {
      attempts[attempts.length - 1].blocked_by_soft_deleted_permit_conflict = true;
      break;
    }
    await wait(retryDelays[attempt - 1] || 5000);
  }

  const succeed = Number(payloadResponse?.succeed ?? 0);
  const fail = Number(payloadResponse?.fail ?? 0);
  let importState = null;
  try {
    importState = await getSessionImportState(login, sessionId);
  } catch (error) {
    importState = { error: error.message || String(error), detail: error.detail || null, entriesNum: 0 };
  }
  const entryCount = importState?.entryCount || null;
  const entriesNum = Number(importState?.entriesNum || 0);
  const diagnosis = diagnoseCandidateImport({
    errors: importErrors,
    fail,
    entriesNum,
    requestedCount: candidates.length,
    importState,
    attempts,
  });
  let localCandidateSave = null;
  if (task?.taskId) {
    localCandidateSave = await runTaskState("upsert_candidates", { taskId: task.taskId, sessionId, candidates });
    const session = taskSessionForId(task, sessionId);
    await updateTaskSessionProgress(task, sessionId, {
      candidateCount: entriesNum,
      roomCount: Number(importState?.roomsCount || session?.roomCount || 0),
    });
    if (session?.sessionType && entriesNum > 0) {
      await updateTaskStep(task.taskId, taskSessionImportStepKey(session.sessionType), "success", {
        message: `考生导入完成：${entriesNum} 人`,
        result: {
          sessionId,
          entriesNum,
          requestedCount: candidates.length,
          fail,
        },
      }, Number(session.requirementIndex || 0));
    }
  }

  json(res, 200, {
    succeed,
    fail,
    permits: payloadResponse?.permits || [],
    errors: importErrors,
    requestedCount: candidates.length,
    before_state: beforeState,
    import_state: importState,
    attempts,
    entry_count: entryCount,
    entries_num: entriesNum,
    diagnosis,
    custom_fields: {
      selected_count: customFieldNames.length,
      names: customFieldNames,
      base_names: selectedBaseFieldNames,
      custom_names: selectedCustomFieldNames,
      skipped_source_columns: skippedSourceColumns,
      saved_locally: Boolean(localCandidateSave),
      save_result: localCandidateSave,
      fields_saved_locally: Boolean(localCustomFieldSave),
      fields_save_result: localCustomFieldSave,
      sent_to_yikao: customFieldNames.length > 0,
      personal_fields: personalFields,
      field_mappings: customFieldMappings,
      message: customFieldNames.length
        ? "自定义字段已配置到考试场次，并使用字段 code 随考生导入请求发送到易考，同时保存到本地系统。"
        : "未选择自定义字段。",
    },
  });
}

async function handleRoomsPreview(sessionId, req, res) {
  const payload = parseJsonSafe(await readBody(req));
  const targetSize = Number(payload?.targetSize || 30);
  if (!sessionId) {
    return badRequest(res, "session_id 为空");
  }
  if (!Number.isInteger(targetSize) || targetSize <= 0) {
    return badRequest(res, "每个班级人数必须是正整数");
  }

  const task = await findVisibleTaskBySessionId(req, sessionId);
  if (!task) return notFound(res);
  const login = getYikaoLoginForTask(task);

  const latestState = await getSessionImportState(login, sessionId);
  const entryCount = latestState.entryCount;
  const entriesNum = latestState.entriesNum;
  if (!entriesNum) {
    return badRequest(res, "entries_num = 0，当前场次没有可分班考生");
  }

  const rooms = buildRooms(calculateRoomSizes(entriesNum, targetSize));
  json(res, 200, {
    session_id: sessionId,
    entries_num: entriesNum,
    targetSize,
    rooms,
    entry_count: entryCount,
    entries_list_count: latestState.entriesListCount,
    rooms_count: latestState.roomsCount,
  });
}

async function handleRoomsAuto(sessionId, req, res) {
  const payload = parseJsonSafe(await readBody(req));
  const requestedRooms = Array.isArray(payload?.rooms) ? payload.rooms : [];
  const overwrite = Boolean(payload?.overwrite);
  const targetSize = Number(payload?.targetSize || 30);
  if (!sessionId) {
    return badRequest(res, "session_id 为空");
  }
  if (!Number.isInteger(targetSize) || targetSize <= 0) {
    return badRequest(res, "每个班级人数必须是正整数");
  }

  const task = await findVisibleTaskBySessionId(req, sessionId);
  if (!task) return notFound(res);
  const login = getYikaoLoginForTask(task);

  const base = normalizeApiBase(process.env.YIKAO_API_BASE);
  const roomsUrl = new URL(`/tenant/api/session/${encodeURIComponent(sessionId)}/rooms/`, base);
  const latestState = await getSessionImportState(login, sessionId);
  const entriesNum = Number(latestState.entriesNum || 0);
  if (!entriesNum) {
    return badRequest(res, "entries_num = 0，当前场次没有可分班考生");
  }
  const existingRooms = normalizeRooms(latestState.rooms).filter((room) => room?.id || room?.name);
  if (existingRooms.length && !overwrite) {
    return json(res, 409, {
      needConfirmOverwrite: true,
      message: "当前场次已存在班级，是否删除后重新分班？",
      existingCount: existingRooms.length,
      latest_state: {
        entries_num: entriesNum,
        entries_list_count: latestState.entriesListCount,
        rooms_count: latestState.roomsCount,
      },
    });
  }

  if (existingRooms.length && overwrite) {
    await readTenantJsonWithLogin(
      login,
      roomsUrl,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_ids: [] }),
      },
      "删除已有分班",
    );
  }

  let rooms = requestedRooms;
  const requestedTotal = requestedRooms.reduce((sum, room) => sum + Number(room?.num || 0), 0);
  if (!requestedRooms.length || requestedTotal !== entriesNum) {
    rooms = buildRooms(calculateRoomSizes(entriesNum, targetSize));
  }
  const roomValidation = validateRooms(rooms, entriesNum);
  if (!roomValidation.ok) {
    return json(res, 400, {
      error: "自动分班生成了无效班级，请检查每个班级人数设置。",
      entries_num: entriesNum,
      rooms_total: roomValidation.total,
      invalid_rooms: roomValidation.invalid,
      rooms,
    });
  }
  rooms = roomValidation.rooms;

  const result = await readTenantJsonWithLogin(
    login,
    roomsUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rooms,
      }),
    },
    "自动分班",
  );
  const progressbarId = result?.id;
  if (!progressbarId) {
    return json(res, 500, { error: "自动分班接口未返回 progressbar id", detail: result });
  }
  const progressbar = await pollProgressbar(login, progressbarId);
  const session = taskSessionForId(task, sessionId);
  if (task?.taskId && session?.sessionType) {
    await updateTaskSessionProgress(task, sessionId, {
      candidateCount: entriesNum,
      roomCount: rooms.length,
    });
    const requirementIndex = Number(session.requirementIndex || 0);
    const roomsSubStatus = mergedRequirementStepSubStatus(
      task,
      "sessions_auto_rooms",
      requirementIndex,
      session.sessionType,
      "success",
    );
    const monitorSubStatus = mergedRequirementStepSubStatus(
      task,
      "sessions_invigilator_export",
      requirementIndex,
      session.sessionType,
      "success",
    );
    await updateTaskStep(task.taskId, "sessions_auto_rooms", "running", {
      subStatus: roomsSubStatus,
      message: `${session.sessionType === "formal" ? "正式考试" : "试考"}自动分班完成：${entriesNum} 人，${rooms.length} 个班级`,
      result: { sessionId, entriesNum, roomCount: rooms.length, progressbarId, rooms },
    }, requirementIndex);
    await updateTaskStep(task.taskId, "sessions_invigilator_export", "running", {
      subStatus: monitorSubStatus,
      message: `${session.sessionType === "formal" ? "正式考试" : "试考"}监考账号已生成：${rooms.length} 个班级`,
      result: { sessionId, roomCount: rooms.length, rooms },
    }, requirementIndex);
  }
  json(res, 200, {
    session_id: sessionId,
    progressbar_id: progressbarId,
    rooms,
    progressbar,
    latest_state: {
      entries_num: entriesNum,
      entries_list_count: latestState.entriesListCount,
      rooms_count_before: latestState.roomsCount,
    },
  });
}

async function handleCreateJob(req, res) {
  const payload = parseJsonSafe(await readBody(req));
  if (!payload?.uploadId && !payload?.taskId) {
    return badRequest(res, "缺少 uploadId 或 taskId");
  }
  let importRecord = null;
  let requirementIndex = 0;
  if (payload.taskId) {
    const task = await runTaskState("get", { taskId: payload.taskId });
    if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
    const requirements = taskExamRequirements(task);
    if (requirements.length) {
      requirementIndex = Number(payload.requirementIndex ?? 0);
      if (!Number.isInteger(requirementIndex) || requirementIndex < 0 || requirementIndex >= requirements.length) {
        return badRequest(res, "需求单序号不存在，请刷新项目后重试。");
      }
      const requirement = requirements[requirementIndex];
      importRecord = {
        id: requirement.uploadId || `task:${task.taskId}:requirement:${requirementIndex + 1}`,
        taskId: task.taskId,
        requirementIndex,
        filename: requirement.filename || `${task.projectName || "项目"}-需求单${requirementIndex + 1}.xlsx`,
        uploadPath: "",
        parsed: {
          config: requirement.config || {},
          previewRows: requirement.previewRows || [],
          warnings: requirement.warnings || [],
        },
        createdAt: requirement.confirmedAt || task.createdAt,
      };
    }
  }
  if (!importRecord && payload.uploadId) {
    const uploadedRecord = state.imports.get(payload.uploadId) || null;
    importRecord = uploadedRecord ? { ...uploadedRecord, requirementIndex } : null;
  }
  if (!importRecord) {
    return badRequest(res, "需求单记录不存在，请重新导入。");
  }
  const config = importRecord.parsed?.config || {};
  if (!config.examName || !config.startTimeDisplay || !config.endTimeDisplay) {
    return badRequest(res, "需求单缺少考试名称或考试时间，请重新导入并检查表格。");
  }

  const storedLogin = getYikaoLoginForRequest(req);
  const login = auth.enabled ? storedLogin : { ...storedLogin, ...(payload.login || {}) };
  if (!login.url || !login.username || !login.password) {
    return badRequest(res, "请先填写并保存后台登录配置。");
  }

  const job = createJob(importRecord, login);
  pushEvent(job, { type: "status", status: "queued", message: "任务已创建", ts: new Date().toISOString() });

  const hasTenantApiKey = Boolean(login.tenantApiKey || (login.allowEnvFallback ? process.env.YIKAO_API_KEY : ""));
  if (!hasTenantApiKey) {
    pushEvent(job, {
      type: "error",
      ts: new Date().toISOString(),
      message: "缺少租户 API Key，已停用浏览器自动化路径，请先填写租户 API Key。",
    });
    return json(res, 400, {
      error: "缺少租户 API Key",
      message: "已停用浏览器自动化路径，请先填写租户 API Key 后再开始配置。",
    });
  }

  await bindTaskToAutomationLogin(job.taskId, login);

  runYikaoApiCreationJob({ job, login });

  json(res, 200, { jobId: job.id, taskId: job.taskId });
}

function getAuthUserFromRequest(auth, req) {
  if (!auth.enabled) return { email: "" };
  const cookies = parseCookies(req.headers.cookie || "");
  return getSessionUser(auth, cookies[auth.cookieName]) || null;
}

function getYikaoLoginForRequest(req) {
  const user = getAuthUserFromRequest(auth, req);
  const login = currentUserLogin({
    user,
    userSettings: state.userSettings,
    legacySettings: state.settings,
  });
  return {
    ...login,
    allowEnvFallback: !auth.enabled,
  };
}

function getYikaoLoginForTask(task = {}) {
  const ownerEmail = normalizeEmail(task.ownerEmail || "");
  const profileId = String(task.config?.apiKeyProfileId || "").trim();
  const profileLabel = String(task.sourceAccount || "").trim();
  if (ownerEmail) {
    const login = loginForApiKeyProfile({
      user: { email: ownerEmail },
      userSettings: state.userSettings,
      legacySettings: state.settings,
      profileId,
      profileLabel,
    });
    if (login?.tenantApiKey) return { ...login, allowEnvFallback: !auth.enabled };
  }
  const login = loginForApiKeyProfile({
    user: ownerEmail ? { email: ownerEmail } : null,
    userSettings: state.userSettings,
    legacySettings: state.settings,
    profileId,
    profileLabel,
  });
  return { ...login, allowEnvFallback: !auth.enabled };
}

function publicYikaoLogin(login) {
  return {
    url: login?.url || "",
    username: login?.username || "",
    password: login?.password || "",
    tenantApiKey: login?.tenantApiKey || "",
  };
}

async function handleGetSettings(req, res) {
  json(res, 200, { ...state.settings, login: publicYikaoLogin(getYikaoLoginForRequest(req)) });
}

async function handleSaveSettings(req, res) {
  const payload = parseJsonSafe(await readBody(req));
  if (!auth.enabled) {
    const nextLogin = {
      ...state.settings.login,
      ...(payload?.login || {}),
    };
    const nextSettings = {
      ...state.settings,
      login: nextLogin,
    };
    if (nextLogin.tenantApiKey) {
      upsertApiKeyProfileInRecord(nextSettings, {
        apiBase: nextLogin.apiBase || "https://eztest.cn",
        tenantApiKey: nextLogin.tenantApiKey,
        label: nextLogin.username || nextLogin.tenantApiKey,
        login: nextLogin,
      }, { current: true });
    }
    state.settings = nextSettings;
    await fs.writeFile(settingsPath, JSON.stringify(nextSettings, null, 2), "utf8");
    return json(res, 200, { ok: true, settings: state.settings });
  }

  const user = getAuthUserFromRequest(auth, req);
  if (!user) return json(res, 401, { error: "请先登录" });
  saveUserLogin(state.userSettings, user, payload?.login || {});
  await fs.writeFile(userSettingsPath, JSON.stringify(state.userSettings, null, 2), "utf8");
  json(res, 200, { ok: true, settings: { ...state.settings, login: publicYikaoLogin(getYikaoLoginForRequest(req)) } });
}

async function handleCustomerServiceScheduler(req, res, url) {
  const user = getAuthUserFromRequest(auth, req);
  if (auth.enabled && !user) return json(res, 401, { error: "请先登录" });

  const profileMatch = url.pathname.match(/^\/api\/customer-service-scheduler\/profiles\/([^/]+)$/);
  const profileCredentialsMatch = url.pathname.match(
    /^\/api\/customer-service-scheduler\/profiles\/([^/]+)\/credentials$/,
  );
  if (req.method === "GET" && url.pathname === "/api/customer-service-scheduler") {
    return json(res, 200, {
      ok: true,
      profiles: auth.enabled
        ? publicApiKeyProfilesForUser({ user, userSettings: state.userSettings })
        : publicApiKeyProfiles(state.settings.apiKeyProfiles || []),
    });
  }

  if (req.method === "GET" && profileCredentialsMatch) {
    const profileId = decodeURIComponent(profileCredentialsMatch[1]);
    const credentials = apiKeyProfileCredentialsForUser({
      user: auth.enabled ? user : null,
      userSettings: state.userSettings,
      legacySettings: state.settings,
      profileId,
    });
    if (!credentials) return json(res, 404, { error: "未找到账号配置。" });
    res.setHeader("Cache-Control", "no-store");
    return json(res, 200, { ok: true, credentials });
  }

  if (req.method === "PATCH" && profileMatch) {
    const payload = parseJsonSafe(await readBody(req)) || {};
    const profileId = decodeURIComponent(profileMatch[1]);
    try {
      if (auth.enabled) {
        updateApiKeyProfileForUser(state.userSettings, user, profileId, payload);
        await fs.writeFile(userSettingsPath, JSON.stringify(state.userSettings, null, 2), "utf8");
      } else {
        updateLocalApiKeyProfile(profileId, payload);
        await fs.writeFile(settingsPath, JSON.stringify(state.settings, null, 2), "utf8");
      }
      return json(res, 200, {
        ok: true,
        profiles: auth.enabled
          ? publicApiKeyProfilesForUser({ user, userSettings: state.userSettings })
          : publicApiKeyProfiles(state.settings.apiKeyProfiles || []),
      });
    } catch (error) {
      return badRequest(res, error instanceof Error ? error.message : String(error));
    }
  }

  if (req.method === "DELETE" && profileMatch) {
    const profileId = decodeURIComponent(profileMatch[1]);
    try {
      if (auth.enabled) {
        deleteApiKeyProfileForUser(state.userSettings, user, profileId);
        await fs.writeFile(userSettingsPath, JSON.stringify(state.userSettings, null, 2), "utf8");
      } else {
        deleteLocalApiKeyProfile(profileId);
        await fs.writeFile(settingsPath, JSON.stringify(state.settings, null, 2), "utf8");
      }
      return json(res, 200, {
        ok: true,
        profiles: auth.enabled
          ? publicApiKeyProfilesForUser({ user, userSettings: state.userSettings })
          : publicApiKeyProfiles(state.settings.apiKeyProfiles || []),
      });
    } catch (error) {
      return badRequest(res, error instanceof Error ? error.message : String(error));
    }
  }

  if (req.method === "POST" && url.pathname === "/api/customer-service-scheduler/run") {
    const payload = parseJsonSafe(await readBody(req)) || {};
    const requestedProfileId = String(payload.profileId || "");
    const profiles = auth.enabled
      ? apiKeyProfilesForUser({ user, userSettings: state.userSettings })
      : state.settings.apiKeyProfiles || [];
    const selectedProfiles = requestedProfileId
      ? profiles.filter((profile) => profile.id === requestedProfileId)
      : profiles.filter((profile) => profile.customerServiceScheduler?.enabled !== false);
    const targets = selectedProfiles
      .filter((profile) => profile.tenantApiKey)
      .map((profile) => {
        const profileLogin = loginForApiKeyProfile({
          user: auth.enabled ? user : null,
          userSettings: state.userSettings,
          legacySettings: state.settings,
          profileId: profile.id,
        });
        return {
          userId: auth.enabled ? normalizeEmail(user.email) : "local",
          profileId: profile.id,
          label: profile.label,
          apiBase: profile.apiBase,
          apiKey: profile.tenantApiKey,
          keyHint: profile.keyHint,
          login: {
            url: profileLogin.url,
            username: profileLogin.username,
            password: profileLogin.password,
          },
        };
      });
    const summary = await runCustomerServiceSchedulerForTargets({
      targets,
      dryRun: payload.dryRun !== false,
      logger: () => {},
    });
    return json(res, 200, { ok: summary.failedProfiles === 0, summary });
  }

  return false;
}

function updateLocalApiKeyProfile(profileId, updates = {}) {
  const profiles = state.settings.apiKeyProfiles || [];
  const index = profiles.findIndex((profile) => profile.id === profileId);
  if (index < 0) throw new Error("未找到 API Key 配置。");
  const nextAccount = normalizeEmail(
    updates.login?.username || updates.label || profiles[index].login?.username || profiles[index].label || "",
  );
  const duplicateAccount = nextAccount && profiles.some((profile, profileIndex) => (
    profileIndex !== index &&
    normalizeEmail(profile.login?.username || profile.label || "") === nextAccount
  ));
  if (duplicateAccount) throw new Error("该账号邮箱已绑定一个 API Key，请编辑原账号。");
  profiles[index] = {
    ...profiles[index],
    label: updates.label === undefined ? profiles[index].label : String(updates.label || "").trim(),
    remark: updates.remark === undefined ? String(profiles[index].remark || "") : String(updates.remark || "").trim(),
    tenantApiKey: String(updates.tenantApiKey || profiles[index].tenantApiKey || "").trim(),
    keyHint: apiKeyHint(updates.tenantApiKey || profiles[index].tenantApiKey),
    login: updates.login && typeof updates.login === "object"
      ? {
          ...(profiles[index].login || {}),
          ...updates.login,
          username: String(updates.login.username || updates.label || profiles[index].login?.username || profiles[index].label || "").trim(),
          password: updates.login.password === undefined
            ? String(profiles[index].login?.password || "")
            : String(updates.login.password || ""),
        }
      : profiles[index].login,
    current: updates.current === undefined ? profiles[index].current : Boolean(updates.current),
    customerServiceScheduler: {
      ...(profiles[index].customerServiceScheduler || {}),
      ...(updates.customerServiceScheduler || {}),
      enabled: updates.customerServiceScheduler?.enabled === false
        ? false
        : updates.customerServiceScheduler?.enabled === true
          ? true
          : profiles[index].customerServiceScheduler?.enabled !== false,
    },
    updatedAt: new Date().toISOString(),
  };
  if (updates.current === true || profiles[index].current) {
    if (updates.current === true) {
      profiles.forEach((profile, profileIndex) => {
        if (profileIndex !== index) profile.current = false;
      });
    }
    state.settings.login = {
      ...(state.settings.login || {}),
      ...(profiles[index].login || {}),
      username: profiles[index].login?.username || profiles[index].label || state.settings.login?.username || "",
      tenantApiKey: profiles[index].tenantApiKey,
    };
  }
  state.settings.apiKeyProfiles = profiles;
}

function deleteLocalApiKeyProfile(profileId) {
  const profiles = state.settings.apiKeyProfiles || [];
  const nextProfiles = profiles.filter((profile) => profile.id !== profileId);
  if (nextProfiles.length === profiles.length) throw new Error("未找到 API Key 配置。");
  if (!nextProfiles.some((profile) => profile.current) && nextProfiles.length) {
    nextProfiles[nextProfiles.length - 1].current = true;
  }
  const current = nextProfiles.find((profile) => profile.current);
  state.settings = {
    ...state.settings,
    apiKeyProfiles: nextProfiles,
    login: {
      ...(state.settings.login || {}),
      ...(current?.login || {}),
      username: current?.login?.username || current?.label || state.settings.login?.username || "",
      tenantApiKey: current?.tenantApiKey || "",
    },
  };
}

function requireAdmin(auth, req, res) {
  if (!auth.enabled) return { email: "", role: "admin" };
  const user = getAuthUserFromRequest(auth, req);
  if (!user) {
    json(res, 401, { error: "请先登录" });
    return null;
  }
  if (!isAdminUser(user)) {
    json(res, 403, { error: "只有管理员可以执行此操作" });
    return null;
  }
  return user;
}

async function saveAuthUsers(auth) {
  await fs.writeFile(authUsersPath, JSON.stringify(auth.users || [], null, 2), "utf8");
}

async function saveAuthSessions(auth) {
  await fs.writeFile(authSessionsPath, JSON.stringify(serializeSessions(auth), null, 2), "utf8");
}

async function handleAuthLogin(auth, req, res) {
  if (!auth.enabled) {
    return json(res, 200, { ok: true, enabled: false, authenticated: true, user: null });
  }

  const payload = parseJsonSafe(await readBody(req)) || {};
  const email = String(payload.email || "");
  const password = String(payload.password || "");
  const user = await verifyLogin(auth, email, password);
  if (!user) {
    return json(res, 401, { error: "邮箱或密码错误" });
  }

  const session = createSession(auth, user);
  await saveAuthSessions(auth);
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": buildLoginCookie(auth, session.token),
  });
  res.end(JSON.stringify({ ok: true, enabled: true, authenticated: true, user: session.user }));
}

function handleAuthMe(auth, req, res) {
  if (!auth.enabled) {
    return json(res, 200, { enabled: false, authenticated: true, user: null });
  }
  const user = getAuthUserFromRequest(auth, req);
  json(res, 200, { enabled: true, authenticated: Boolean(user), user });
}

async function handleAuthUsers(auth, req, res, url) {
  if (!requireAdmin(auth, req, res)) return;

  if (req.method === "GET" && url.pathname === "/api/auth/users") {
    return json(res, 200, { users: sanitizeUsers(auth.users || []) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/users") {
    const payload = parseJsonSafe(await readBody(req)) || {};
    try {
      const user = upsertLocalUser(auth, {
        email: payload.email,
        password: payload.password,
      });
      await saveAuthUsers(auth);
      return json(res, 200, { ok: true, user: sanitizeUsers([user])[0], users: sanitizeUsers(auth.users) });
    } catch (error) {
      return badRequest(res, error instanceof Error ? error.message : String(error));
    }
  }

  const userMatch = url.pathname.match(/^\/api\/auth\/users\/([^/]+)$/);
  if (!userMatch) return notFound(res);
  const email = decodeURIComponent(userMatch[1]);

  if (req.method === "PATCH") {
    const payload = parseJsonSafe(await readBody(req)) || {};
    const user = updateLocalUser(auth, email, {
      disabled: payload.disabled,
      password: payload.password,
    });
    if (!user) return notFound(res);
    if (payload.disabled === true) deleteSessionsForEmail(auth, email);
    await saveAuthUsers(auth);
    await saveAuthSessions(auth);
    return json(res, 200, { ok: true, user: sanitizeUsers([user])[0], users: sanitizeUsers(auth.users) });
  }

  if (req.method === "DELETE") {
    const deleted = deleteLocalUser(auth, email);
    if (!deleted) return notFound(res);
    deleteSessionsForEmail(auth, email);
    delete state.userSettings.users[normalizeEmail(email)];
    await saveAuthUsers(auth);
    await saveAuthSessions(auth);
    await fs.writeFile(userSettingsPath, JSON.stringify(state.userSettings, null, 2), "utf8");
    return json(res, 200, { ok: true, users: sanitizeUsers(auth.users) });
  }

  return notFound(res);
}

async function handleAuthLogout(auth, req, res) {
  if (auth.enabled) {
    const cookies = parseCookies(req.headers.cookie || "");
    deleteSession(auth, cookies[auth.cookieName]);
    await saveAuthSessions(auth);
  }
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": buildLogoutCookie(auth),
  });
  res.end(JSON.stringify({ ok: true }));
}

function handleJobState(job, res) {
  json(res, 200, {
    id: job.id,
    taskId: job.taskId,
    status: job.status,
    statusMessage: job.statusMessage || "",
    progress: job.progress,
    stage: job.stage,
    logs: job.logs,
    captures: job.captures,
  });
}

function visibleByOwner(auth, req, item) {
  return canViewOwner(getAuthUserFromRequest(auth, req), item?.ownerEmail || "");
}

async function handleTaskList(req, res) {
  const requestUrl = new URL(req.url, "http://127.0.0.1");
  const includeArchived = requestUrl.searchParams.get("includeArchived") === "1";
  const tasks = await runTaskState(includeArchived ? "list_all" : "list");
  json(res, 200, { tasks: tasks.filter((task) => visibleByOwner(auth, req, task)) });
}

async function handleExamList(req, res) {
  const sessions = await runTaskState("list_sessions");
  json(res, 200, { sessions: sessions.filter((session) => visibleByOwner(auth, req, session)) });
}

async function handleTaskDetail(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (task && !visibleByOwner(auth, req, task)) return notFound(res);
  if (!task) return notFound(res);
  let syncedTask = task;
  try {
    syncedTask = await syncTaskDetailSessionState(req, task);
  } catch {
    syncedTask = task;
  }
  try {
    syncedTask.candidates = await runTaskState("list_candidates", { taskId });
  } catch {
    syncedTask.candidates = [];
  }
  const enrichedTask = await enrichTaskPaperUnitInfoForDetail(req, syncedTask);
  return json(res, 200, {
    ...withOperationBatchNameEditorDefaults(enrichedTask),
    sessionChangeFeatureEnabled,
  });
}

function sessionChangeDisabled(res) {
  return json(res, 403, {
    error: "修改场次信息仅在测试控制台启用。请使用 PORT=8876 EASY_EXAM_RUNTIME_DIR=.easy_exam_runtime_test npm start 启动。",
    featureEnabled: false,
  });
}

function sessionChangeApiBase(login) {
  return normalizeApiBase(process.env.YIKAO_API_BASE || login.apiBase || "https://eztest.cn");
}

async function visibleTaskSession(taskId, sessionId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) {
    notFound(res);
    return {};
  }
  const session = taskSessionForId(task, sessionId);
  if (!session) {
    json(res, 404, { error: "场次不属于当前任务，不能修改。" });
    return { task };
  }
  return { task, session };
}

async function handleSessionChangePreview(taskId, sessionId, req, res) {
  if (!sessionChangeFeatureEnabled) return sessionChangeDisabled(res);
  const { task, session } = await visibleTaskSession(taskId, sessionId, req, res);
  if (!task || !session) return;
  const login = getYikaoLoginForTask(task);
  const apiBase = sessionChangeApiBase(login);
  try {
    const detail = await fetchTenantSessionDetail({
      apiBase,
      sessionId,
      login,
      requestJson: readTenantJsonWithLogin,
    });
    return json(res, 200, {
      taskId,
      sessionId,
      sessionType: session.sessionType,
      apiBase,
      editable: ["name", "start", "end", "early", "later", "message", "notice"],
      current: editableSessionFieldsFromDetail(detail),
      featureEnabled: true,
    });
  } catch (error) {
    return json(res, 200, {
      warning: tenantSessionChangeErrorMessage(error),
      detail: sessionChangeSummary(error?.detail || error?.message || ""),
      featureEnabled: true,
      apiBase,
      sessionId,
      taskId,
      sessionType: session.sessionType,
      editable: ["name", "start", "end", "early", "later", "message", "notice"],
      current: localSessionFieldsForChange(session),
      fallback: true,
    });
  }
}

async function handleSessionChange(taskId, sessionId, req, res) {
  if (!sessionChangeFeatureEnabled) return sessionChangeDisabled(res);
  const payload = parseJsonSafe(await readBody(req));
  if (!payload?.confirm) return badRequest(res, "请确认后再提交场次修改。");
  const validation = validateSessionChangeRequest(payload?.changes || {});
  if (!validation.ok) return json(res, 400, { error: "场次修改参数校验失败", errors: validation.errors });

  const { task, session } = await visibleTaskSession(taskId, sessionId, req, res);
  if (!task || !session) return;
  const login = getYikaoLoginForTask(task);
  const apiBase = sessionChangeApiBase(login);
  let detail = null;
  let detailWarning = null;
  try {
    detail = await fetchTenantSessionDetail({
      apiBase,
      sessionId,
      login,
      requestJson: readTenantJsonWithLogin,
    });
  } catch (error) {
    detailWarning = {
      warning: tenantSessionChangeErrorMessage(error),
      detail: sessionChangeSummary(error?.detail || error?.message || ""),
    };
    detail = sessionChangeBasePayloadFromTask(task, session);
  }

  const before = editableSessionFieldsFromDetail(detail);
  const putPayload = mergeSessionChangePayload(detail, validation.changes);
  const after = editableSessionFieldsFromDetail(putPayload);
  const diff = buildSessionChangeDiff(before, after);
  if (!diff.length) return json(res, 400, { error: "没有检测到需要修改的场次字段。", diff });

  let tenantBody = null;
  try {
    tenantBody = await putTenantSessionDetail({
      apiBase,
      sessionId,
      payload: putPayload,
      login,
      requestJson: readTenantJsonWithLogin,
    });
  } catch (error) {
    return json(res, error?.status && Number(error.status) >= 400 ? Number(error.status) : 502, {
      error: tenantSessionChangeErrorMessage(error),
      detail: sessionChangeSummary(error?.detail || error?.message || ""),
      apiBase,
      sessionId,
      diff,
    });
  }

  let verifyStatus = "";
  let verifiedSession = null;
  let verifyWarning = null;
  try {
    const verifyUrl = new URL("/tenant/api/session/", normalizeApiBase(apiBase));
    verifyUrl.searchParams.set("session_ids", String(sessionId));
    const verifyPayload = await readTenantJsonWithLogin(
      login,
      verifyUrl,
      { method: "GET", includeResponseMeta: true },
      `回查场次信息 ${sessionId}`,
    );
    verifyStatus = verifyPayload.httpStatus;
    const matched = normalizeTenantList(verifyPayload.body)
      .find((item) => String(item.id ?? item.session_id ?? "") === String(sessionId));
    if (matched) {
      verifiedSession = {
        session_id: String(matched.id ?? matched.session_id ?? sessionId),
        name: String(matched.name ?? ""),
        start: matched.start ?? "",
        end: matched.end ?? "",
        url: matched.url ?? "",
      };
    }
  } catch (error) {
    verifyWarning = {
      warning: tenantSessionChangeErrorMessage(error),
      detail: sessionChangeSummary(error?.detail || error?.message || ""),
    };
  }

  const updatedTask = await runTaskState("upsert_session", {
    taskId,
    requirementIndex: Number(session.requirementIndex || 0),
    sessionType: session.sessionType,
    session: {
      session_id: session.session_id,
      name: after.name || session.name,
      start: after.start || session.start,
      end: after.end || session.end,
      candidate_count: Number(session.candidateCount || 0),
      room_count: Number(session.roomCount || 0),
      status: session.status || "success",
      url: session.url || "",
    },
  });
  const message = `修改${session.sessionType === "formal" ? "正式考试" : "试考"}场次 ${sessionId}：${diff.map((item) => item.label).join("、")}`;
  const previousChangeStep = (updatedTask?.steps || task?.steps || []).find((item) => item.stepKey === "session_change");
  const history = appendSessionChangeHistory(sessionChangeHistoryFromStep(previousChangeStep), {
    changedAt: new Date().toISOString(),
    operator: getAuthUserFromRequest(auth, req)?.email || "",
    sessionId,
    sessionType: session.sessionType,
    apiBase,
    status: "success",
    tenantStatus: 200,
    verifyStatus,
    diff,
    tenantResponseSummary: sessionChangeSummary(tenantBody),
    verifiedSession,
    warning: detailWarning || verifyWarning || null,
  });
  const changeRecord = history[0];
  const loggedTask = await updateTaskStep(taskId, "session_change", "success", {
    message,
    result: {
      sessionId,
      sessionType: session.sessionType,
      apiBase,
      changedFields: diff.map((item) => item.field),
      diff,
      tenantResponseSummary: sessionChangeSummary(tenantBody),
      tenantStatus: 200,
      verifyStatus,
      verifiedSession,
      history,
    },
  }) || updatedTask;

  return json(res, 200, {
    ok: true,
    task: loggedTask,
    session: taskSessionForId(loggedTask, sessionId),
    apiBase,
    diff,
    tenantStatus: 200,
    verifyStatus,
    verifiedSession,
    tenantResponseSummary: sessionChangeSummary(tenantBody),
    detailWarning,
    verifyWarning,
    changeRecord,
    logs: [message],
  });
}

async function enrichTaskPaperUnitInfoForDetail(req, task) {
  const states = taskRequirementIndexes(task).map((requirementIndex) => ({
    requirementIndex,
    state: paperFormBindState(task, requirementIndex),
  }));
  const successfulStates = states.filter(({ state }) => (
    state.status === "success" && Array.isArray(state.result?.bindResult?.results) && state.result.bindResult.results.length
  ));
  if (!successfulStates.length) return task;

  const login = getYikaoLoginForTask(task);
  const apiBase = normalizeApiBase(process.env.YIKAO_API_BASE || login.apiBase || "https://eztest.cn");
  const formCodes = [...new Set(successfulStates.flatMap(({ state }) => (
    state.result.bindResult.results.flatMap((item) => (Array.isArray(item.form_codes) ? item.form_codes : []))
  )).map((item) => String(item || "").trim()).filter(Boolean))];
  const unitInfoEntries = await Promise.all(formCodes.map(async (formCode) => {
    try {
      const unitInfo = await fetchPaperUnitInfo({
        login,
        apiBase,
        formCode,
        requestJson: readTenantJsonWithLogin,
      });
      return [formCode, unitInfo];
    } catch (error) {
      return [formCode, null];
    }
  }));
  const unitInfoByCode = new Map(unitInfoEntries);
  const paperFormBinds = Array.isArray(task.config?.paperFormBinds) ? [...task.config.paperFormBinds] : [];
  for (const { requirementIndex, state } of successfulStates) {
    const bindResult = state.result.bindResult;
    const withUnitInfo = bindResult.results.map((item) => {
      const unitInfos = (Array.isArray(item.form_codes) ? item.form_codes : [])
        .map((formCode) => unitInfoByCode.get(String(formCode || "").trim()))
        .filter(Boolean);
      return {
        ...item,
        ...(unitInfos.length === 1 ? { unit_info: unitInfos[0] } : {}),
        ...(unitInfos.length > 1 ? { unit_infos: unitInfos } : {}),
      };
    });
    paperFormBinds[requirementIndex] = {
      ...state,
      result: {
        ...(state.result || {}),
        bindResult: {
          ...bindResult,
          results: withUnitInfo,
        },
      },
    };
  }

  return {
    ...task,
    config: {
      ...(task.config || {}),
      paperFormBinds,
      paperFormBind: paperFormBinds[0] || task.config?.paperFormBind || {},
    },
  };
}

function sharedSheetSessionFieldsFromDetail(detail = {}) {
  const clientLoginLimit = positiveNumber(detail?.login_times ?? detail?.loginTimes);
  const leaveLimit = positiveNumber(detail?.lock_screen_time ?? detail?.lockScreenTime);
  return {
    ...(clientLoginLimit !== undefined ? { clientLoginLimit, login_times: clientLoginLimit } : {}),
    ...(leaveLimit !== undefined ? { leaveLimit, lock_screen_time: leaveLimit } : {}),
    ...(detail?.client_required !== undefined ? { client_required: Boolean(detail.client_required) } : {}),
  };
}

async function enrichSharedSheetSessions(login, sessions = [], logs = []) {
  const enriched = [];
  for (const session of sessions) {
    const sessionId = String(session?.session_id || session?.id || "").trim();
    if (!sessionId) {
      enriched.push(session);
      continue;
    }
    try {
      const { detail } = await getTenantSessionDetail(login, sessionId);
      const fields = sharedSheetSessionFieldsFromDetail(detail);
      enriched.push({ ...session, ...fields });
      const loginTimesText = fields.clientLoginLimit !== undefined ? `，login_times=${fields.clientLoginLimit}` : "";
      logs.push(`[项目共享大表] 已同步场次详情，session_id=${sessionId}${loginTimesText}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logs.push(`[项目共享大表] 场次详情同步失败，已停止写表，session_id=${sessionId}：${message}`);
      throw new Error(`场次详情同步失败，无法保证 L 列与考试配置一致，session_id=${sessionId}：${message}`);
    }
  }
  return enriched;
}

async function handleProjectSharedSheetFill(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);

  await updateTaskStep(taskId, "project_shared_sheet", "running", {
    message: "开始填写项目共享大表",
  });

  const logs = [];
  try {
    const sessions = (task.sessions || []).filter((session) => (
      (session.sessionType === "formal" || session.sessionType === "trial") && session.session_id
    ));
    if (!sessions.some((session) => session.sessionType === "formal")) {
      throw new Error("缺少正式考试 session_id，无法填写项目共享大表");
    }
    for (const session of sessions) {
      const label = session.sessionType === "trial" ? "试考" : "正式考试";
      const requirementText = Number.isFinite(Number(session.requirementIndex))
        ? `需求单 ${Number(session.requirementIndex) + 1} `
        : "";
      logs.push(`[项目共享大表] 开始填写${requirementText}${label}信息，session_id=${session.session_id}`);
    }
    if (!sessions.some((session) => session.sessionType === "trial")) {
      logs.push("[项目共享大表] 当前任务无试考场次，跳过试考填写");
    }
    const login = getYikaoLoginForTask(task);
    const syncedSessions = await enrichSharedSheetSessions(login, sessions, logs);

    const settings = tencentDocsSettingsFromEnv(process.env);
    if (!settings.enabled) throw new Error("腾讯文档授权未配置，无法填写项目共享大表");
    const syncResult = await syncExamConfigToTencentDocs({
      config: task.config || {},
      created: syncedSessions,
      settings,
    });
    logs.push(`[项目共享大表] 已填写 ${syncResult.updatedRows} 个考试场次`);
    logs.push("[项目共享大表] 填写完成");
    const updated = await updateTaskStep(taskId, "project_shared_sheet", "success", {
      message: logs.join("\n"),
      result: {
        updatedRows: syncResult.updatedRows,
        sessionIds: sessions.map((session) => String(session.session_id)),
      },
    });
    return json(res, 200, updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated = await updateTaskStep(taskId, "project_shared_sheet", "failed", {
      errorMessage: message,
      message: [...logs, `[项目共享大表] 填写失败：${message}`].join("\n"),
    });
    return json(res, 500, updated);
  }
}

function scoreFeedbackFileName(task, session) {
  return safeExcelFileName(`${task?.projectName || session?.name || "成绩反馈单"}-成绩反馈单`);
}

function scoreFeedbackDownloadFileName(task, session, format) {
  const fileName = scoreFeedbackFileName(task, session);
  return format === "pdf" ? fileName.replace(/\.xlsx$/i, ".pdf") : fileName;
}

function scoreFeedbackFormalSessions(task = {}) {
  return (task.sessions || []).filter((session) => session.sessionType === "formal" && session.session_id);
}

function scoreStampApplicationStatusMessage(stampApplication = {}) {
  if (stampApplication.status === "opened" && stampApplication.saved) return "已自动打开 OA 成绩盖章申请页、上传加密压缩包并保存，请核对后提交";
  if (stampApplication.status === "opened") return "已自动打开 OA 成绩盖章申请页并上传加密压缩包，请核对后提交";
  if (stampApplication.status === "failed") return `自动发起 OA 成绩盖章申请失败：${stampApplication.errorMessage || "未知错误"}`;
  if (stampApplication.status === "skipped") return stampApplication.message || "已跳过 OA 成绩盖章申请";
  return "";
}

function parseChromeJsonValue(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  const textValue = String(value ?? "").trim();
  if (!textValue) return fallback;
  return JSON.parse(textValue);
}

function scoreStampArchivePassword() {
  return String(process.env.SCORE_STAMP_ARCHIVE_PASSWORD || "1234");
}

function scoreStampArchiveFileName(pdfFileName = "成绩单.pdf") {
  const base = safeFileName(String(pdfFileName || "成绩单.pdf").replace(/\.pdf$/i, "")).trim() || "成绩单";
  return safeZipFileName(`${base}-盖章附件`);
}

async function runZipCommand(args, options = {}) {
  const child = spawn("zip", args, {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) throw new Error(stderr.trim() || "加密压缩包生成失败");
}

async function createPasswordProtectedScoreArchive({ pdfPath, pdfFileName } = {}) {
  const resolvedPdfPath = path.resolve(String(pdfPath || ""));
  const generatedRoot = path.resolve(generatedDir);
  if (!resolvedPdfPath || !resolvedPdfPath.startsWith(`${generatedRoot}${path.sep}`)) {
    throw new Error("成绩单 PDF 文件不存在，请先完成成绩处理");
  }
  await fs.access(resolvedPdfPath);
  const archivePassword = scoreStampArchivePassword();
  const archiveFileName = scoreStampArchiveFileName(pdfFileName);
  const archiveDir = await fs.mkdtemp(path.join(generatedDir, "score-stamp-archive-"));
  const archivePath = path.join(archiveDir, archiveFileName);
  const stagingDir = await fs.mkdtemp(path.join(generatedDir, "score-stamp-"));
  const stagedPdfPath = path.join(stagingDir, safeFileName(pdfFileName || "成绩单.pdf"));
  try {
    await fs.copyFile(resolvedPdfPath, stagedPdfPath);
    await runZipCommand(["-q", "-P", archivePassword, "-j", archivePath, stagedPdfPath]);
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
  return {
    stampArchiveFileName: archiveFileName,
    stampArchivePath: archivePath,
    stampArchivePassword: archivePassword,
  };
}

async function ensurePasswordProtectedScoreArchive(scoreResult = {}) {
  const archivePath = path.resolve(String(scoreResult.stampArchivePath || ""));
  const generatedRoot = path.resolve(generatedDir);
  const expectedArchiveFileName = scoreResult.stampArchiveFileName || scoreStampArchiveFileName(scoreResult.pdfFileName);
  if (archivePath && archivePath.startsWith(`${generatedRoot}${path.sep}`)) {
    try {
      await fs.access(archivePath);
      if (path.basename(archivePath) === expectedArchiveFileName) {
        return {
          ...scoreResult,
          stampArchiveFileName: expectedArchiveFileName,
          stampArchivePassword: scoreResult.stampArchivePassword || scoreStampArchivePassword(),
        };
      }
    } catch {}
  }
  return {
    ...scoreResult,
    ...(await createPasswordProtectedScoreArchive({
      pdfPath: scoreResult.pdfFilePath,
      pdfFileName: scoreResult.pdfFileName,
    })),
  };
}

async function resolveCreatedChromeTab(tab, workflowUrl) {
  if (tab?.webSocketDebuggerUrl) return tab;
  const tabs = await fetchChromeDevToolsTabs({ timeoutMs: 5000 });
  const expectedWorkflowId = new URL(workflowUrl).hash.match(/workflowid=([^&]+)/)?.[1] || "105021";
  return (Array.isArray(tabs) ? tabs : []).find((item) => tab?.id && item.id === tab.id) ||
    (Array.isArray(tabs) ? tabs : []).find((item) => String(item?.url || "").includes(`workflowid=${expectedWorkflowId}`));
}

function isChromeNavigationRetryableError(error) {
  const message = error?.message || String(error || "");
  return /Execution context was destroyed|Cannot find context|Cannot find default execution context|Inspected target navigated|Target closed|WebSocket 在操作完成前已关闭/.test(message);
}

async function withScoreStampChromeRetry({ tab, workflowUrl, operation, attempts = 4, delayMs = 1000 } = {}) {
  let currentTab = tab;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation(currentTab);
    } catch (error) {
      lastError = error;
      if (!isChromeNavigationRetryableError(error) || attempt === attempts - 1) throw error;
      await wait(delayMs);
      currentTab = await resolveCreatedChromeTab(currentTab, workflowUrl) || currentTab;
    }
  }
  throw lastError || new Error("Chrome DevTools 操作失败");
}

async function startScoreStampApplication(task, scoreResult, req) {
  if (process.env.SCORE_STAMP_AUTO_DISABLED === "1") {
    return {
      status: "skipped",
      attemptedAt: new Date().toISOString(),
      message: "已按环境配置跳过 OA 成绩盖章申请自动发起",
    };
  }
  const pdfFilePath = path.resolve(String(scoreResult.pdfFilePath || ""));
  const generatedRoot = path.resolve(generatedDir);
  if (!pdfFilePath || !pdfFilePath.startsWith(`${generatedRoot}${path.sep}`)) {
    throw new Error("成绩单 PDF 文件不存在，请先完成成绩处理");
  }
  await fs.access(pdfFilePath);
  const archiveFilePath = path.resolve(String(scoreResult.stampArchivePath || ""));
  if (!archiveFilePath || !archiveFilePath.startsWith(`${generatedRoot}${path.sep}`)) {
    throw new Error("成绩单加密压缩包不存在，请先重新发起盖章申请");
  }
  await fs.access(archiveFilePath);

  const payload = buildScoreStampApplicationPayload({
    task,
    scoreResult,
    user: getAuthUserFromRequest(auth, req) || {},
  });
  const platform = fanweiAutoReadPlatform();
  if (platform === "unsupported") {
    throw new Error(fanweiAutoReadUnavailableMessage("unsupported_platform", process.platform));
  }
  await ensureFanweiDevToolsChromeAvailable({ timeoutMs: 5000 });
  const createdTab = await createChromeDevToolsTab({ url: payload.workflowUrl, timeoutMs: 10000 });
  const tab = await resolveCreatedChromeTab(createdTab, payload.workflowUrl);
  if (!tab?.webSocketDebuggerUrl) {
    throw new Error("已打开 OA 页面，但未取得可自动填写的 Chrome DevTools 标签页。");
  }
  const raw = await withScoreStampChromeRetry({
    tab,
    workflowUrl: payload.workflowUrl,
    operation: (currentTab) => evaluateChromeDevToolsExpression({
      tab: currentTab,
      expression: buildScoreStampApplicationFillScript(payload),
      timeoutMs: 45000,
    }),
  });
  const pageResult = parseChromeJsonValue(raw);
  if (!pageResult.ok) {
    const detail = (pageResult.warnings || []).join("；") ||
      (pageResult.url ? `页面地址：${pageResult.url}` : "") ||
      `返回：${JSON.stringify(pageResult).slice(0, 240)}`;
    throw new Error(`OA 成绩盖章申请页预填失败：${detail}`);
  }
  const uploadResult = await withScoreStampChromeRetry({
    tab,
    workflowUrl: payload.workflowUrl,
    operation: (currentTab) => uploadFilesToChromeDevToolsFileInput({
      tab: currentTab,
      filePaths: [archiveFilePath],
      selector: 'input[type="file"][data-codex-score-stamp-upload="1"]',
      prepareExpression: buildScoreStampAttachmentPrepareScript(),
      timeoutMs: 30000,
    }),
  });
  if (!uploadResult.ok || !uploadResult.uploaded) {
    throw new Error("OA 成绩盖章申请页未找到可上传附件的文件控件，请检查页面附件区域。");
  }
  const saveRaw = await withScoreStampChromeRetry({
    tab,
    workflowUrl: payload.workflowUrl,
    operation: (currentTab) => evaluateChromeDevToolsExpression({
      tab: currentTab,
      expression: buildScoreStampApplicationSaveScript(),
      timeoutMs: 15000,
    }),
  });
  const saveResult = parseChromeJsonValue(saveRaw);
  if (!saveResult.ok || !saveResult.saved) {
    const detail = (saveResult.warnings || []).join("；") ||
      (saveResult.url ? `页面地址：${saveResult.url}` : "") ||
      `返回：${JSON.stringify(saveResult).slice(0, 240)}`;
    throw new Error(`OA 成绩盖章申请页保存失败：${detail}`);
  }
  return {
    status: "opened",
    attemptedAt: new Date().toISOString(),
    workflowUrl: payload.workflowUrl,
    pageUrl: pageResult.url || "",
    pdfFileName: payload.pdfFileName,
    archiveFileName: payload.archiveFileName,
    archivePassword: payload.archivePassword,
    filled: Array.isArray(pageResult.filled) ? pageResult.filled : [],
    uploadedFileNames: Array.isArray(uploadResult.fileNames) && uploadResult.fileNames.length
      ? uploadResult.fileNames
      : [payload.archiveFileName].filter(Boolean),
    uploadHiddenValue: uploadResult.hiddenValue || "",
    saved: Boolean(saveResult.saved),
    saveButtonText: saveResult.buttonText || "",
    warnings: Array.isArray(pageResult.warnings) ? pageResult.warnings : [],
  };
}

async function tryStartScoreStampApplication(task, scoreResult, req) {
  try {
    return await startScoreStampApplication(task, scoreResult, req);
  } catch (error) {
    return {
      status: "failed",
      attemptedAt: new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

function scoreFeedbackExamTime(sessions = []) {
  const ranges = [];
  for (const session of sessions) {
    const range = [session.start, session.end].filter(Boolean).join(" ~ ");
    if (range && !ranges.includes(range)) ranges.push(range);
  }
  return ranges.join("；");
}

async function handleScoreProcess(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  const formalSessions = scoreFeedbackFormalSessions(task);
  if (!formalSessions.length) return badRequest(res, "缺少正式考试 session_id，无法处理成绩");

  await updateTaskStep(taskId, "score_process", "running", {
    message: "开始成绩处理：读取全部正式考试成绩并生成一张成绩反馈单",
  });

  const login = getYikaoLoginForTask(task);
  const examName = task.projectName || formalSessions[0]?.name || "正式考试";
  const examTime = scoreFeedbackExamTime(formalSessions);
  const processedDate = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());
  const exportId = randomUUID();
  const payloadPath = path.join(generatedDir, `${exportId}-score-feedback.json`);
  const pdfPayloadPath = path.join(generatedDir, `${exportId}-score-feedback-pdf.json`);
  const outputPath = path.join(generatedDir, `${exportId}-score-feedback.xlsx`);
  const pdfSourcePath = path.join(generatedDir, `${exportId}-score-feedback-pdf-source.xlsx`);
  const pdfOutputPath = path.join(generatedDir, `${exportId}-score-feedback.pdf`);
  const fileName = scoreFeedbackFileName(task, formalSessions[0]);
  const pdfFileName = fileName.replace(/\.xlsx$/i, ".pdf");
  const logs = [];

  try {
    const rowsWithReports = [];
    let totalTenantEntries = 0;
    let totalTenantScores = 0;
    let totalLocalCandidates = 0;
    for (const [index, formalSession] of formalSessions.entries()) {
      const requirementIndex = Number(formalSession.requirementIndex || 0);
      const sessionConfig = taskRequirementConfig(task, requirementIndex);
      const courses = Array.isArray(sessionConfig.courses) && sessionConfig.courses.length
        ? sessionConfig.courses
        : task?.config?.courses || [];
      const defaultCourse = scoreCourseFallback(courses, formalSession.name || examName);
      logs.push(`[成绩处理] 开始处理正式考试 ${index + 1}/${formalSessions.length}，session_id=${formalSession.session_id}`);
      const tenantEntries = await fetchAllSessionEntries(login, formalSession.session_id, logs);
      const tenantScores = await fetchAllSessionScores(login, formalSession.session_id, logs);
      const storedCandidates = await runTaskState("list_candidates", {
        taskId,
        sessionId: formalSession.session_id,
      }).catch(() => []);
      const localCandidates = attachCourseNamesToCandidates(storedCandidates, courses);
      const sessionRows = await mergeEntryAndScoreRows({
        login,
        sessionId: formalSession.session_id,
        entries: tenantEntries,
        scores: tenantScores,
        localCandidates,
        examName: defaultCourse,
        logs,
      });
      const sessionRowsWithReports = await attachAssessmentReportsToRows({
        login,
        sessionId: formalSession.session_id,
        rows: sessionRows,
        logs,
      });
      rowsWithReports.push(...sessionRowsWithReports);
      totalTenantEntries += tenantEntries.length;
      totalTenantScores += tenantScores.length;
      totalLocalCandidates += localCandidates.length;
      logs.push(`[成绩处理] 正式考试 ${index + 1}/${formalSessions.length} 汇总完成：输出 ${sessionRows.length} 条`);
    }
    const rows = rowsWithReports;
    const missingScores = rows.filter((row) => String(row.score ?? "").trim() === "").length;
    const unknownStatuses = [...new Set(rows.map((row) => normalizeScoreStatusForLog(row.exam_status)).filter(Boolean))];
    logs.push(`成绩数据：正式考试 ${formalSessions.length} 场，状态 ${totalTenantEntries} 条，成绩 ${totalTenantScores} 条，本地补充 ${totalLocalCandidates} 条，输出 ${rows.length} 条。`);
    if (missingScores) logs.push(`有 ${missingScores} 名考生未读取到得分字段，得分列保留空白。`);
    if (unknownStatuses.length) logs.push(`发现未转换考试状态，已保留原值：${unknownStatuses.join("、")}`);
    const reportLinkCount = countAssessmentReportLinks(rowsWithReports);
    logs.push("[成绩处理] 开始写入成绩单模板");
    if (reportLinkCount) {
      logs.push("[成绩处理] PDF 保持原成绩单格式，不写入测评报告链接");
      await fs.writeFile(
        pdfPayloadPath,
        JSON.stringify({ examName, examTime, processedDate, rows: stripAssessmentReports(rowsWithReports) }, null, 2),
        "utf8",
      );
      const pdfSourceResult = await runPythonJson([scoreFeedbackExporterScript, scoreFeedbackTemplatePath, pdfPayloadPath, pdfSourcePath]);
      if (!pdfSourceResult.ok) {
        throw new Error((pdfSourceResult.errors || []).join("；") || "成绩单 PDF 源文件生成失败");
      }
      await convertScoreFeedbackToPdf({ inputPath: pdfSourcePath, outputPath: pdfOutputPath });
      logs.push(`[成绩处理] 成绩单 PDF 生成成功：${pdfFileName}`);
      await fs.writeFile(
        payloadPath,
        JSON.stringify({ examName, examTime, processedDate, rows: rowsWithReports }, null, 2),
        "utf8",
      );
      const result = await runPythonJson([scoreFeedbackExporterScript, scoreFeedbackTemplatePath, payloadPath, outputPath]);
      if (!result.ok) {
        throw new Error((result.errors || []).join("；") || "成绩反馈单生成失败");
      }
      logs.push(`[成绩处理] 成绩反馈单生成成功：${fileName}，已追加 ${reportLinkCount} 个测评报告链接`);
    } else {
      await fs.writeFile(
        payloadPath,
        JSON.stringify({ examName, examTime, processedDate, rows: rowsWithReports }, null, 2),
        "utf8",
      );
      const result = await runPythonJson([scoreFeedbackExporterScript, scoreFeedbackTemplatePath, payloadPath, outputPath]);
      if (!result.ok) {
        throw new Error((result.errors || []).join("；") || "成绩反馈单生成失败");
      }
      logs.push(`[成绩处理] 成绩反馈单生成成功：${fileName}`);
      await convertScoreFeedbackToPdf({ inputPath: outputPath, outputPath: pdfOutputPath });
      logs.push(`[成绩处理] 成绩单 PDF 生成成功：${pdfFileName}`);
    }
    const scoreResult = {
      sessionId: formalSessions[0].session_id,
      sessionIds: formalSessions.map((session) => String(session.session_id)),
      fileName,
      filePath: outputPath,
      payloadPath,
      pdfFileName,
      pdfFilePath: pdfOutputPath,
      rowCount: rows.length,
      sessionCount: formalSessions.length,
      missingScores,
      reportLinkCount,
    };
    Object.assign(scoreResult, await ensurePasswordProtectedScoreArchive(scoreResult));
    logs.push(`[盖章申请] 已生成加密压缩包：${scoreResult.stampArchiveFileName}，默认密码：${scoreResult.stampArchivePassword}`);
    const stampApplication = await tryStartScoreStampApplication(task, scoreResult, req);
    scoreResult.stampApplication = stampApplication;
    const stampMessage = scoreStampApplicationStatusMessage(stampApplication);
    if (stampMessage) logs.push(`[盖章申请] ${stampMessage}`);
    const updated = await updateTaskStep(taskId, "score_process", "success", {
      message: logs.join("\n"),
      result: scoreResult,
    });
    return json(res, 200, updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated = await updateTaskStep(taskId, "score_process", "failed", {
      errorMessage: message,
      message: [...logs, message].filter(Boolean).join("\n"),
    });
    return json(res, 500, updated);
  }
}

async function handleScoreDownload(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  const step = (task.steps || []).find((item) => item.stepKey === "score_process");
  const result = step?.result || {};
  const requestUrl = new URL(req.url, "http://localhost");
  const format = requestUrl.searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
  const formalSession = (task.sessions || []).find((session) => session.sessionType === "formal");
  const workbookStoredPath = String(result.filePath || "").trim();
  const legacyPdfFilePath = workbookStoredPath.replace(/\.xlsx$/i, ".pdf");
  const storedFilePath = String(format === "pdf" ? result.pdfFilePath || legacyPdfFilePath : workbookStoredPath).trim();
  const filePath = storedFilePath ? path.resolve(storedFilePath) : "";
  const generatedRoot = path.resolve(generatedDir);
  if (!filePath || !filePath.startsWith(`${generatedRoot}${path.sep}`)) {
    return badRequest(res, "成绩反馈单文件不存在，请先触发成绩处理");
  }
  if (format === "pdf" && !result.pdfFilePath) {
    try {
      await fs.access(filePath);
    } catch {
      const workbookFilePath = workbookStoredPath ? path.resolve(workbookStoredPath) : "";
      if (!workbookFilePath || !workbookFilePath.startsWith(`${generatedRoot}${path.sep}`)) {
        return badRequest(res, "成绩反馈单 Excel 文件不存在，请重新处理");
      }
      try {
        await fs.access(workbookFilePath);
        await convertScoreFeedbackToPdf({ inputPath: workbookFilePath, outputPath: filePath });
      } catch {
        return badRequest(res, "成绩单 PDF 生成失败，请重新处理");
      }
    }
  } else {
    try {
      await fs.access(filePath);
    } catch {
      return badRequest(res, "成绩反馈单文件不存在，请重新处理");
    }
  }
  res.writeHead(200, {
    "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(scoreFeedbackDownloadFileName(task, formalSession, format))}`,
  });
  createReadStream(filePath).pipe(res);
}

async function handleScoreReportDownload(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  const step = (task.steps || []).find((item) => item.stepKey === "score_process");
  const result = step?.result || {};
  if (step?.status !== "success") {
    return badRequest(res, "请先完成成绩处理后再下载测评文档");
  }
  const storedPayloadPath = String(scoreFeedbackPayloadPathFromResult(result) || "").trim();
  const payloadPath = storedPayloadPath ? path.resolve(storedPayloadPath) : "";
  const generatedRoot = path.resolve(generatedDir);
  if (!payloadPath || !payloadPath.startsWith(`${generatedRoot}${path.sep}`)) {
    return badRequest(res, "成绩处理数据不存在，请重新处理");
  }

  let payload;
  try {
    payload = JSON.parse(await fs.readFile(payloadPath, "utf8"));
  } catch {
    return badRequest(res, "成绩处理数据读取失败，请重新处理");
  }

  const reportItems = assessmentReportsFromScoreRows(payload.rows || []);
  if (!reportItems.length) {
    return badRequest(res, "当前成绩处理结果没有测评文档，请先重新处理成绩");
  }

  const login = getYikaoLoginForTask(task);
  const formalSession = (task.sessions || []).find((session) => session.sessionType === "formal");
  const tempDir = await fs.mkdtemp(path.join(generatedDir, "score-reports-"));
  const zipPath = `${tempDir}.zip`;
  try {
    const downloaded = await downloadAssessmentReportFiles({ login, reportItems, outputDir: tempDir });
    if (!downloaded) {
      throw new Error("未下载到测评文档");
    }
    await zipDirectory(tempDir, zipPath);
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(zipPath, { force: true }).catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    return json(res, 500, { error: message || "测评文档打包失败" });
  }

  const cleanupZip = () => {
    fs.rm(zipPath, { force: true }).catch(() => {});
  };
  res.on("finish", cleanupZip);
  res.on("close", cleanupZip);
  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(scoreReportArchiveFileName(task, formalSession))}`,
  });
  createReadStream(zipPath).pipe(res);
}

async function handleScoreStampArchiveDownload(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  const step = (task.steps || []).find((item) => item.stepKey === "score_process");
  const result = step?.result || {};
  if (step?.status !== "success") {
    return badRequest(res, "请先完成成绩处理并生成成绩单 PDF");
  }
  let preparedResult;
  try {
    preparedResult = await ensurePasswordProtectedScoreArchive(result);
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
  if (preparedResult.stampArchivePath !== result.stampArchivePath) {
    await updateTaskStep(taskId, "score_process", "success", {
      message: `[盖章申请] 已生成加密压缩包：${preparedResult.stampArchiveFileName}，默认密码：${preparedResult.stampArchivePassword}`,
      result: preparedResult,
    });
  }
  const archivePath = path.resolve(String(preparedResult.stampArchivePath || ""));
  const generatedRoot = path.resolve(generatedDir);
  if (!archivePath || !archivePath.startsWith(`${generatedRoot}${path.sep}`)) {
    return badRequest(res, "盖章附件压缩包不存在，请重新处理成绩");
  }
  try {
    await fs.access(archivePath);
  } catch {
    return badRequest(res, "盖章附件压缩包不存在，请重新处理成绩");
  }
  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(preparedResult.stampArchiveFileName || scoreStampArchiveFileName(preparedResult.pdfFileName))}`,
  });
  createReadStream(archivePath).pipe(res);
}

async function handleScoreStampApplication(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  const step = (task.steps || []).find((item) => item.stepKey === "score_process");
  const result = step?.result || {};
  if (step?.status !== "success") {
    return badRequest(res, "请先完成成绩处理并生成成绩单 PDF");
  }
  const preparedResult = await ensurePasswordProtectedScoreArchive(result);
  const stampApplication = await tryStartScoreStampApplication(task, preparedResult, req);
  const mergedResult = { ...preparedResult, stampApplication };
  const message = `[盖章申请] ${scoreStampApplicationStatusMessage(stampApplication)}`;
  const updated = await updateTaskStep(taskId, "score_process", "success", {
    message,
    result: mergedResult,
  });
  const statusCode = stampApplication.status === "opened" || stampApplication.status === "skipped" ? 200 : 500;
  return json(res, statusCode, { ok: statusCode === 200, task: updated, stampApplication, error: stampApplication.errorMessage });
}

async function handleTaskHide(taskId, req, res) {
  const initialTask = await runTaskState("get", { taskId });
  if (!initialTask || !visibleByOwner(auth, req, initialTask)) return notFound(res);
  const requestUrl = new URL(req.url, "http://127.0.0.1");
  if (requestUrl.searchParams.get("archive") === "1") {
    const result = await runTaskState("hide", { taskId });
    if (!result?.hidden) return notFound(res);
    const archivedTask = await runTaskState("get", { taskId });
    return json(res, 200, { ok: true, archived: true, task: archivedTask });
  }
  return await withFreshOperationBatchTask({
    acquire: () => operationBatchCoordinator.acquireTask(taskId),
    readTask: () => runTaskState("get", { taskId }),
    onAcquireError: (error) => operationBatchLockConflictResponse(taskId, initialTask, res, error),
    onMissing: () => notFound(res),
    run: async (task) => {
      if (!visibleByOwner(auth, req, task)) return notFound(res);
      const login = getYikaoLoginForTask(task);
      const apiBase = normalizeApiBase(process.env.YIKAO_API_BASE || login.apiBase || "https://eztest.cn");
      const logs = [];
      const deletion = await deleteTaskSessionsFromTenant({
        login,
        apiBase,
        sessions: task.sessions || [],
        requestJson: readTenantJsonWithLogin,
        emitLog: (message) => logs.push(message),
      });
      const result = await runTaskState("delete", { taskId });
      if (!result?.deleted) return notFound(res);
      return json(res, 200, {
        ok: true,
        deleted: true,
        taskId,
        deletedSessionIds: deletion.deletedSessionIds,
        logs,
      });
    },
  });
}

function operationBatchDraftOverridesFromTask(task = {}) {
  const fields = task.config?.operationBatch?.draft?.fields || {};
  return {
    fields: Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, item?.value || ""])),
  };
}

const operationBatchAutomationInFlight = new Set();
const operationBatchResultInFlight = new Set();
const operationBatchAutomationLockKey = "persistent-profile";
const operationBatchCoordinator = createOperationBatchCoordinator({
  acquireLock: acquireOperationBatchCreation,
  releaseLock: releaseOperationBatchCreation,
  profileInFlight: operationBatchAutomationInFlight,
  taskInFlight: operationBatchResultInFlight,
  profileKey: operationBatchAutomationLockKey,
});
let operationBatchUpdateApi;
const operationPersonnelTaskActiveAttempts = new Set();
let operationPersonnelTaskService;

function operationBatchUpdateRunnerOptions() {
  return {
    baseUrl: process.env.OPERATION_CONSOLE_BASE_URL,
    userDataDir: process.env.OPERATION_CONSOLE_USER_DATA_DIR,
  };
}

function assertOperationBatchUpdateAutomationEnabled() {
  if (process.env.OPERATION_CONSOLE_AUTOMATION_ENABLED === "1") return;
  const error = new Error(
    "运营控制台浏览器自动化未启用。请先确认测试环境已登录，并设置 OPERATION_CONSOLE_AUTOMATION_ENABLED=1 后重启服务。",
  );
  error.status = 409;
  error.code = "OPERATION_BATCH_AUTOMATION_DISABLED";
  throw error;
}

function getOperationBatchUpdateApi() {
  if (operationBatchUpdateApi) return operationBatchUpdateApi;
  const readTask = (taskId) => runTaskState("get", { taskId });
  const service = createOperationBatchUpdateService({
    readTask,
    updateTaskConfig: (taskId, config) => runTaskState("update_config", { taskId, config }),
    coordinator: operationBatchCoordinator,
    runInspection: (instruction) => inspectOperationBatchManagedSnapshot(
      instruction,
      operationBatchUpdateRunnerOptions(),
    ),
    runUpdate: (instruction) => runOperationBatchManagedUpdate(
      instruction,
      operationBatchUpdateRunnerOptions(),
    ),
    assertAutomationEnabled: assertOperationBatchUpdateAutomationEnabled,
  });
  operationBatchUpdateApi = createOperationBatchUpdateApi({
    service,
    workflowForTask: (task) => {
      const batchDraft = buildOperationBatchDraft(
        task,
        operationBatchDraftOverridesFromTask(task),
      );
      return buildProjectWorkflow(task, batchDraft);
    },
  });
  return operationBatchUpdateApi;
}

function getOperationPersonnelTaskService() {
  if (operationPersonnelTaskService) return operationPersonnelTaskService;
  const runnerOptions = () => ({
    baseUrl: process.env.OPERATION_CONSOLE_BASE_URL,
    userDataDir: process.env.OPERATION_CONSOLE_USER_DATA_DIR,
  });
  operationPersonnelTaskService = createOperationPersonnelTaskService({
    readTask: (taskId) => runTaskState("get", { taskId }),
    updateTaskConfig: (taskId, config) => runTaskState("update_config", { taskId, config }),
    readRequirement: (requestId) => requestId
      ? runRequirementState("get", { requestId })
      : null,
    coordinator: operationBatchCoordinator,
    activeAttemptIds: operationPersonnelTaskActiveAttempts,
    runInspection: (instruction) => runOperationPersonnelInspection(instruction, runnerOptions()),
    runAttempt: (instruction, options) => runOperationPersonnelAttempt(
      instruction,
      { ...options, ...runnerOptions() },
    ),
    runRecheck: (instruction) => runOperationPersonnelRecheck(instruction, runnerOptions()),
    environment: process.env.OPERATION_CONSOLE_ENVIRONMENT || "",
  });
  return operationPersonnelTaskService;
}

function operationPersonnelTaskActor(req) {
  if (!auth.enabled) return { email: "", role: "admin" };
  return getAuthUserFromRequest(auth, req);
}

function operationPersonnelTaskError(res, error) {
  return json(res, Number(error?.status || 500), {
    error: error instanceof Error ? error.message : String(error),
    ...(error?.code ? { errorCode: error.code } : {}),
  });
}

async function assertOperationPersonnelTaskVisible(taskId, req) {
  const task = await runTaskState("get", { taskId });
  if (task && visibleByOwner(auth, req, task)) return;
  const error = new Error("人员任务不存在");
  error.status = 404;
  error.code = "PERSONNEL_TASK_NOT_FOUND";
  throw error;
}

async function readOperationPersonnelPayload(req) {
  const body = await readBody(req);
  if (!body.toString("utf8").trim()) return {};
  const payload = parseJsonSafe(body);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload;
  const error = new Error("请求 JSON 格式无效");
  error.status = 400;
  error.code = "PERSONNEL_INVALID_JSON";
  throw error;
}

function assertOperationPersonnelAutomationEnabled() {
  if (process.env.OPERATION_CONSOLE_AUTOMATION_ENABLED === "1") return;
  const error = new Error(
    "运营控制台浏览器自动化未启用。请先确认测试环境已登录，并设置 OPERATION_CONSOLE_AUTOMATION_ENABLED=1 后重启服务。",
  );
  error.status = 409;
  error.code = "PERSONNEL_AUTOMATION_DISABLED";
  throw error;
}

async function handleOperationPersonnelTaskState(taskId, req, res) {
  try {
    const result = await getOperationPersonnelTaskService().get(
      taskId,
      operationPersonnelTaskActor(req),
    );
    return json(res, 200, result);
  } catch (error) {
    return operationPersonnelTaskError(res, error);
  }
}

async function handleOperationPersonnelTaskPreview(taskId, req, res) {
  try {
    await assertOperationPersonnelTaskVisible(taskId, req);
    const payload = await readOperationPersonnelPayload(req);
    assertOperationPersonnelAutomationEnabled();
    const result = await getOperationPersonnelTaskService().preview(
      taskId,
      operationPersonnelTaskActor(req),
      payload,
    );
    return json(res, 200, result);
  } catch (error) {
    return operationPersonnelTaskError(res, error);
  }
}

async function handleOperationPersonnelTaskSend(taskId, req, res) {
  try {
    await assertOperationPersonnelTaskVisible(taskId, req);
    const payload = await readOperationPersonnelPayload(req);
    assertOperationPersonnelAutomationEnabled();
    const result = await getOperationPersonnelTaskService().send(
      taskId,
      operationPersonnelTaskActor(req),
      payload,
    );
    return json(res, 202, { attemptId: result.attemptId });
  } catch (error) {
    return operationPersonnelTaskError(res, error);
  }
}

const operationPersonnelCheckpointOrder = [
  "inspect_batch",
  "publish_batch",
  "sync_exam_schedules",
  "sync_personnel_config",
  "sync_personnel_dates",
  "sync_exam_service_requirements",
  "verify_task_sheet",
  "select_recipients",
  "submit_send",
  "verify_send_record",
];

function operationPersonnelAttemptResponse(result) {
  const attempt = result.attempt || {};
  const checkpoints = result.state?.checkpoints || {};
  const checkpoint = operationPersonnelCheckpointOrder
    .filter((name) => checkpoints[name])
    .at(-1) || "";
  const deadline = Date.parse(attempt.verification?.deadlineAt);
  const remainingSeconds = Number.isFinite(deadline)
    ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    : 0;
  return {
    attemptId: attempt.attemptId,
    status: attempt.status,
    checkpoint,
    verificationPhase: attempt.verification?.phase || "",
    remainingSeconds,
    completed: ["sent", "failed_resumable", "result_unknown"].includes(attempt.status),
    error: attempt.error || null,
  };
}

function operationPersonnelTaskRecheckResponse(result) {
  return {
    taskId: result.taskId,
    ...operationPersonnelAttemptResponse({
      state: result.state,
      attempt: result.state?.activeAttempt,
    }),
  };
}

async function handleOperationPersonnelTaskAttempt(taskId, attemptId, req, res) {
  try {
    const result = await getOperationPersonnelTaskService().attempt(
      taskId,
      operationPersonnelTaskActor(req),
      attemptId,
    );
    return json(res, 200, operationPersonnelAttemptResponse(result));
  } catch (error) {
    return operationPersonnelTaskError(res, error);
  }
}

async function handleOperationPersonnelTaskRecheck(taskId, req, res) {
  try {
    await assertOperationPersonnelTaskVisible(taskId, req);
    assertOperationPersonnelAutomationEnabled();
    const result = await getOperationPersonnelTaskService().recheck(
      taskId,
      operationPersonnelTaskActor(req),
    );
    return json(res, 200, operationPersonnelTaskRecheckResponse(result));
  } catch (error) {
    return operationPersonnelTaskError(res, error);
  }
}

async function readOperationBatchUpdatePayload(req) {
  const body = await readBody(req);
  if (!body.toString("utf8").trim()) return {};
  const payload = parseJsonSafe(body);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload;
  const error = new Error("请求 JSON 格式无效");
  error.status = 400;
  error.code = "OPERATION_BATCH_UPDATE_INVALID_JSON";
  throw error;
}

function sendOperationBatchUpdateResponse(res, result) {
  return json(res, result.statusCode, result.body);
}

async function handleOperationBatchUpdateState(taskId, req, res) {
  const result = await getOperationBatchUpdateApi().state(
    taskId,
    operationPersonnelTaskActor(req),
  );
  return sendOperationBatchUpdateResponse(res, result);
}

async function handleOperationBatchUpdatePreview(taskId, req, res) {
  let payload;
  try {
    payload = await readOperationBatchUpdatePayload(req);
  } catch (error) {
    return json(res, error.status || 400, {
      error: error.message,
      errorCode: error.code,
    });
  }
  const result = await getOperationBatchUpdateApi().preview(
    taskId,
    operationPersonnelTaskActor(req),
    payload,
  );
  return sendOperationBatchUpdateResponse(res, result);
}

async function handleOperationBatchUpdateStart(taskId, req, res) {
  let payload;
  try {
    payload = await readOperationBatchUpdatePayload(req);
  } catch (error) {
    return json(res, error.status || 400, {
      error: error.message,
      errorCode: error.code,
    });
  }
  const result = await getOperationBatchUpdateApi().start(
    taskId,
    payload,
    operationPersonnelTaskActor(req),
  );
  return sendOperationBatchUpdateResponse(res, result);
}

async function handleOperationBatchUpdateAttempt(taskId, attemptId, req, res) {
  const result = await getOperationBatchUpdateApi().attempt(
    taskId,
    attemptId,
    operationPersonnelTaskActor(req),
  );
  return sendOperationBatchUpdateResponse(res, result);
}

async function operationBatchLockConflictResponse(taskId, task, res, error) {
  const currentTask = await readFreshOperationBatchTask(
    () => runTaskState("get", { taskId }),
    task,
  );
  return json(res, error?.status || 409, {
    error: error instanceof Error ? error.message : String(error),
    task: currentTask,
  });
}

async function persistOperationBatchResult(taskId, task, result) {
  const resolution = resolveOperationBatchResultWrite(task, result);
  if (resolution.status === "conflict" || resolution.status === "idempotent") {
    return { ...resolution, task };
  }
  const updated = await runTaskState("update_config", { taskId, config: resolution.patch });
  return { ...resolution, task: updated };
}

async function handleOperationBatchDraft(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  if (req.method !== "POST") {
    const draft = buildOperationBatchDraft(task, operationBatchDraftOverridesFromTask(task));
    return json(res, 200, { ok: true, draft, task });
  }
  const payload = parseJsonSafe(await readBody(req)) || {};
  return await withFreshOperationBatchTask({
    acquire: () => operationBatchCoordinator.acquireTask(taskId),
    readTask: () => runTaskState("get", { taskId }),
    onAcquireError: (error) => operationBatchLockConflictResponse(taskId, task, res, error),
    onMissing: () => notFound(res),
    run: async (freshTask) => {
      if (!visibleByOwner(auth, req, freshTask)) return notFound(res);
      const draft = buildOperationBatchDraft(freshTask, payload);
      const current = freshTask.config?.operationBatch || {};
      const operationBatch = {
        ...current,
        status: current.status || "draft",
        draft,
        updatedAt: new Date().toISOString(),
      };
      const updated = await runTaskState("update_config", { taskId, config: { operationBatch } });
      return json(res, 200, { ok: true, draft, task: updated });
    },
  });
}

async function handleOperationBatchCreate(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  const payload = parseJsonSafe(await readBody(req));
  return await withFreshOperationBatchTask({
    acquire: () => operationBatchCoordinator.acquireAutomation(taskId),
    readTask: () => runTaskState("get", { taskId }),
    onAcquireError: (error) => operationBatchLockConflictResponse(taskId, task, res, error),
    onMissing: () => notFound(res),
    run: async (lockedTask) => {
      if (!visibleByOwner(auth, req, lockedTask)) return notFound(res);
      const lockedCode = lockedTask.config?.operationBatchCode || lockedTask.config?.operationBatch?.code || "";
      if (operationBatchCodeIsValid(lockedCode)) {
        return json(res, 200, {
          ok: true,
          task: lockedTask,
          operationBatch: lockedTask.config?.operationBatch || {},
          operationBatchCode: lockedCode,
          skipped: "operation_batch_already_created",
        });
      }
      if (operationBatchNeedsReconciliation(lockedTask)) {
        return json(res, 409, {
          error: "运营批次创建结果待同步，请先执行批次对账。",
          errorCode: OPERATION_BATCH_RECONCILIATION_REQUIRED,
          task: lockedTask,
        });
      }
      if (process.env.OPERATION_CONSOLE_AUTOMATION_ENABLED !== "1") {
        return json(res, 409, {
          error: "运营控制台浏览器自动化未启用。请先确认测试环境已登录，并设置 OPERATION_CONSOLE_AUTOMATION_ENABLED=1 后重启服务。",
        });
      }
      const draft = buildOperationBatchDraft(lockedTask, payload || operationBatchDraftOverridesFromTask(lockedTask));
      const missing = (draft.warnings || []).map((item) => item.message).filter(Boolean);
      if (missing.length) {
        return badRequest(res, `批次草稿仍有缺失字段：${missing.join("；")}`);
      }
      let externalBatchConfirmed = false;
      try {
        const current = lockedTask.config?.operationBatch || {};
        await runTaskState("update_config", {
          taskId,
          config: {
            operationBatch: {
              ...current,
              status: "creating",
              draft,
              updatedAt: new Date().toISOString(),
            },
          },
        });
        const result = await runOperationBatchCreationFlow({
          taskId,
          task: lockedTask,
          desired: buildDesiredOperationBatchSnapshot(lockedTask),
          createBatch: async () => {
            const created = await runOperationBatchCreation(draft, {
              baseUrl: process.env.OPERATION_CONSOLE_BASE_URL,
              userDataDir: process.env.OPERATION_CONSOLE_USER_DATA_DIR,
              allowTaskMismatch: process.env.OPERATION_CONSOLE_ALLOW_TEST_TASK_MISMATCH === "1",
            });
            externalBatchConfirmed = true;
            return created;
          },
          persistBatch: async (created) => {
            const freshTask = await runTaskState("get", { taskId });
            if (!freshTask) {
              const error = new Error("运营批次已创建，但本地任务已不存在，无法保存创建结果");
              error.status = 409;
              throw error;
            }
            const saved = await persistOperationBatchResult(taskId, freshTask, {
              ...created,
              eventType: "operation_batch_created",
            });
            if (saved.status === "conflict") {
              const error = new Error(
                `运营批次代码冲突：当前为 ${saved.existingOperationBatchCode}，本次为 ${saved.operationBatchCode}`,
              );
              error.status = 409;
              error.operationBatchConflict = saved;
              throw error;
            }
            return saved;
          },
          initializeSchedules: (instruction) => runOperationBatchScheduleInitialization(
            instruction,
            {
              baseUrl: process.env.OPERATION_CONSOLE_BASE_URL,
              userDataDir: process.env.OPERATION_CONSOLE_USER_DATA_DIR,
            },
          ),
          persistManaged: async (managedResult) => {
            const freshTask = await runTaskState("get", { taskId });
            if (!freshTask) {
              const error = new Error("运营批次已初始化，但本地任务已不存在，无法保存回读结果");
              error.status = 409;
              throw error;
            }
            const updated = await runTaskState("update_config", {
              taskId,
              config: applyOperationBatchManagedResult(freshTask, managedResult),
            });
            return { task: updated };
          },
          persistFailure: async (error) => {
            const freshTask = await runTaskState("get", { taskId });
            if (!freshTask) {
              const missing = new Error("运营批次代码已保存，但本地任务已不存在，无法保存初始化失败状态");
              missing.status = 409;
              throw missing;
            }
            const current = freshTask.config?.operationBatch || {};
            const updated = await runTaskState("update_config", {
              taskId,
              config: {
                operationBatch: {
                  ...current,
                  status: "update_failed",
                  errorCode: String(error?.code || ""),
                  errorMessage: error instanceof Error ? error.message : String(error),
                  updatedAt: new Date().toISOString(),
                },
              },
            });
            return { task: updated };
          },
        });
        return json(res, 200, {
          ok: true,
          status: result.status,
          task: result.task,
          operationBatch: result.task.config?.operationBatch || {},
          operationBatchCode: result.operationBatchCode,
        });
      } catch (error) {
        if (error?.operationBatchConflict) {
          return json(res, 409, {
            error: error.message,
            task: error.operationBatchConflict.task,
          });
        }
        if (error?.operationBatchStatus === "update_failed") {
          return json(res, error.status || 409, {
            error: error.message,
            ...(error.code ? { errorCode: error.code } : {}),
            status: "update_failed",
            operationBatchCode: error.operationBatchCode,
            task: error.task,
          });
        }
        const failure = operationBatchFailureState(error, externalBatchConfirmed);
        let failedTask;
        try {
          failedTask = await runTaskState("get", { taskId });
        } catch (readError) {
          const response = operationBatchCreationFailureResponse({
            error: new Error(`${error instanceof Error ? error.message : String(error)}；读取最新任务失败：${readError instanceof Error ? readError.message : String(readError)}`),
            externalBatchConfirmed,
            failure,
            reconciliationErrorCode: OPERATION_BATCH_RECONCILIATION_REQUIRED,
          });
          return json(res, response.statusCode, response.body);
        }
        if (!failedTask) {
          const response = operationBatchCreationFailureResponse({
            error,
            externalBatchConfirmed,
            failure,
            reconciliationErrorCode: OPERATION_BATCH_RECONCILIATION_REQUIRED,
          });
          return json(res, response.statusCode === 409 ? 409 : 404, response.body);
        }
        const failedCurrent = failedTask.config?.operationBatch || {};
        const updated = await runTaskState("update_config", {
          taskId,
          config: {
            operationBatch: {
              ...failedCurrent,
              draft,
              ...failure,
              updatedAt: new Date().toISOString(),
            },
          },
        });
        const response = operationBatchCreationFailureResponse({
          error,
          externalBatchConfirmed,
          failure,
          task: updated,
          reconciliationErrorCode: OPERATION_BATCH_RECONCILIATION_REQUIRED,
        });
        return json(res, response.statusCode, response.body);
      }
    },
  });
}

async function handleOperationBatchReconcile(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  return await withFreshOperationBatchTask({
    acquire: () => operationBatchCoordinator.acquireAutomation(taskId),
    readTask: () => runTaskState("get", { taskId }),
    onAcquireError: (error) => operationBatchLockConflictResponse(taskId, task, res, error),
    onMissing: () => notFound(res),
    run: async (lockedTask) => {
      if (!visibleByOwner(auth, req, lockedTask)) return notFound(res);
      const lockedCode = lockedTask.config?.operationBatchCode || lockedTask.config?.operationBatch?.code || "";
      if (operationBatchCodeIsValid(lockedCode)) {
        return json(res, 200, {
          ok: true,
          task: lockedTask,
          operationBatch: lockedTask.config?.operationBatch || {},
          operationBatchCode: lockedCode,
          skipped: "operation_batch_already_created",
        });
      }
      if (!operationBatchNeedsReconciliation(lockedTask)) {
        return json(res, 409, {
          error: "当前运营批次没有待同步结果，请先创建批次。",
          task: lockedTask,
        });
      }
      if (process.env.OPERATION_CONSOLE_AUTOMATION_ENABLED !== "1") {
        return json(res, 409, {
          error: "运营控制台浏览器自动化未启用。请先确认测试环境已登录，并设置 OPERATION_CONSOLE_AUTOMATION_ENABLED=1 后重启服务。",
        });
      }
      const draft = operationBatchDraftForReconciliation(lockedTask);
      let externalBatchConfirmed = false;
      try {
        const current = lockedTask.config?.operationBatch || {};
        await runTaskState("update_config", {
          taskId,
          config: {
            operationBatch: {
              ...current,
              draft,
              status: "reconciling",
              updatedAt: new Date().toISOString(),
            },
          },
        });
        const reconciled = await runOperationBatchReconciliation(draft, {
          baseUrl: process.env.OPERATION_CONSOLE_BASE_URL,
          userDataDir: process.env.OPERATION_CONSOLE_USER_DATA_DIR,
        });
        if (!reconciled) {
          throw new Error("批次列表未找到唯一匹配的运营批次代码");
        }
        externalBatchConfirmed = true;
        const freshTask = await runTaskState("get", { taskId });
        if (!freshTask) {
          const error = new Error("已找到运营批次，但本地任务已不存在，无法保存对账结果");
          error.status = 409;
          throw error;
        }
        const saved = await persistOperationBatchResult(taskId, freshTask, {
          ...reconciled,
          eventType: "operation_batch_reconciled",
        });
        if (saved.status === "conflict") {
          return json(res, 409, {
            error: `运营批次代码冲突：当前为 ${saved.existingOperationBatchCode}，本次为 ${saved.operationBatchCode}`,
            task: saved.task,
          });
        }
        return json(res, 200, {
          ok: true,
          task: saved.task,
          operationBatch: saved.task.config?.operationBatch || {},
          operationBatchCode: saved.operationBatchCode,
          ...(saved.status === "idempotent" ? { skipped: "operation_batch_result_already_recorded" } : {}),
        });
      } catch (error) {
        let pendingTask;
        try {
          pendingTask = await runTaskState("get", { taskId });
        } catch (readError) {
          return json(res, 500, {
            error: `${error instanceof Error ? error.message : String(error)}；读取最新任务失败：${readError instanceof Error ? readError.message : String(readError)}`,
            errorCode: OPERATION_BATCH_RECONCILIATION_REQUIRED,
          });
        }
        if (!pendingTask) {
          return json(res, externalBatchConfirmed ? 409 : 404, {
            error: error instanceof Error ? error.message : String(error),
            errorCode: OPERATION_BATCH_RECONCILIATION_REQUIRED,
          });
        }
        const pendingCurrent = pendingTask.config?.operationBatch || {};
        const updated = await runTaskState("update_config", {
          taskId,
          config: {
            operationBatch: {
              ...pendingCurrent,
              draft,
              status: "reconciliation_required",
              errorCode: OPERATION_BATCH_RECONCILIATION_REQUIRED,
              errorMessage: error instanceof Error ? error.message : String(error),
              updatedAt: new Date().toISOString(),
            },
          },
        });
        return json(res, 409, {
          error: error instanceof Error ? error.message : String(error),
          errorCode: OPERATION_BATCH_RECONCILIATION_REQUIRED,
          task: updated,
        });
      }
    },
  });
}

async function handleOperationBatchResult(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  const payload = parseJsonSafe(await readBody(req)) || {};
  return await withFreshOperationBatchTask({
    acquire: () => operationBatchCoordinator.acquireTask(taskId),
    readTask: () => runTaskState("get", { taskId }),
    onAcquireError: (error) => operationBatchLockConflictResponse(taskId, task, res, error),
    onMissing: () => notFound(res),
    run: async (freshTask) => {
      if (!visibleByOwner(auth, req, freshTask)) return notFound(res);
      let saved;
      try {
        saved = await persistOperationBatchResult(taskId, freshTask, {
          ...payload,
          eventType: "operation_batch_recorded",
        });
      } catch (error) {
        return badRequest(res, error instanceof Error ? error.message : String(error));
      }
      if (saved.status === "conflict") {
        return json(res, 409, {
          error: `运营批次代码冲突：当前为 ${saved.existingOperationBatchCode}，本次为 ${saved.operationBatchCode}`,
          task: saved.task,
        });
      }
      return json(res, 200, {
        ok: true,
        task: saved.task,
        operationBatch: saved.task.config?.operationBatch || {},
        operationBatchCode: saved.operationBatchCode,
        ...(saved.status === "idempotent" ? { skipped: "operation_batch_result_already_recorded" } : {}),
      });
    },
  });
}

async function readEmailSettings() {
  try {
    const raw = await fs.readFile(emailSettingsPath, "utf8");
    return normalizeEmailSettings(JSON.parse(raw));
  } catch {
    return normalizeEmailSettings({});
  }
}

async function writeEmailSettings(settings) {
  await writeEmailSettingsFile(emailSettingsPath, settings);
}

async function handleEmailSettings(req, res) {
  if (req.method === "GET") {
    return json(res, 200, { ok: true, email: redactEmailSettings(await readEmailSettings()) });
  }
  const payload = parseJsonSafe(await readBody(req)) || {};
  const existing = await readEmailSettings();
  const settings = normalizeEmailSettings(payload.email || payload, existing);
  await writeEmailSettings(settings);
  return json(res, 200, { ok: true, email: redactEmailSettings(settings) });
}

async function handleEmailTest(req, res) {
  const payload = parseJsonSafe(await readBody(req)) || {};
  try {
    const result = await sendContentRequirementEmail({
      task: { taskId: "email-test", projectName: "邮箱配置测试", config: {} },
      requirement: {},
      recipients: payload.recipients || "",
      emailSettings: await readEmailSettings(),
    });
    return json(res, 200, { ok: true, result });
  } catch (error) {
    return badRequest(res, error instanceof Error ? error.message : String(error));
  }
}

async function handleContentRequirementEmail(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  const payload = parseJsonSafe(await readBody(req)) || {};
  let requirement = null;
  const requestId = taskRequirementIds(task)[0] || "";
  if (requestId) {
    try {
      requirement = await runRequirementState("get", { requestId });
    } catch {}
  }
  try {
    const result = await sendContentRequirementEmail({
      task,
      requirement,
      recipients: payload.recipients || "",
      emailSettings: await readEmailSettings(),
    });
    const history = Array.isArray(task.config?.contentRequirementEmail?.history)
      ? task.config.contentRequirementEmail.history.slice(-9)
      : [];
    const updated = await runTaskState("update_config", {
      taskId,
      config: {
        contentRequirementEmail: {
          lastSentAt: result.sentAt,
          lastRecipients: result.recipients,
          lastSubject: result.subject,
          lastMessageId: result.messageId,
          history: [...history, result],
        },
      },
    });
    return json(res, 200, { ok: true, task: updated, result });
  } catch (error) {
    return badRequest(res, error instanceof Error ? error.message : String(error));
  }
}

async function handleContentTaskRemark(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  const payload = parseJsonSafe(await readBody(req)) || {};
  const key = String(payload.key || "").trim();
  if (!/^(formal|trial):\d+$/.test(key)) return badRequest(res, "备注对应的考试标识不合法。");
  const value = String(payload.value || "").trim().slice(0, 1000);
  const contentTaskRemarks = {
    ...(task.config?.contentTaskRemarks || {}),
    [key]: value,
  };
  const updated = await runTaskState("update_config", {
    taskId,
    config: { contentTaskRemarks },
  });
  return json(res, 200, { ok: true, task: updated });
}

async function handleOperationConsoleEnvironment(req, res) {
  const environment = await checkOperationConsoleAutomationEnvironment({ cwd: rootDir });
  return json(res, 200, { ok: true, environment });
}

async function handleOperationConsoleEnvironmentInstall(req, res) {
  try {
    installOperationConsoleAutomationDeps({ cwd: rootDir });
    const environment = await checkOperationConsoleAutomationEnvironment({ cwd: rootDir });
    return json(res, 200, { ok: true, environment });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleOperationConsoleEnvironmentEnable(req, res) {
  try {
    enableOperationConsoleAutomation({ envPath: path.join(rootDir, ".env") });
    const environment = await checkOperationConsoleAutomationEnvironment({ cwd: rootDir });
    json(res, 200, { ok: true, environment, restartScheduled: true });
    setTimeout(() => {
      const label = process.env.EASY_EXAM_SERVICE_LABEL || "com.ata.easy-exam-service";
      const service = `gui/${process.getuid()}/${label}`;
      const child = spawn("launchctl", ["kickstart", "-k", service], { detached: true, stdio: "ignore" });
      child.unref();
    }, 150);
    return;
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

function taskRequirementConfig(task = {}, requirementIndex = 0) {
  return taskExamRequirements(task)[Number(requirementIndex || 0)]?.config || task.config || {};
}

function taskRequirementIndexes(task = {}) {
  const requirementCount = taskExamRequirements(task).length;
  const sessionCount = (task.sessions || []).reduce(
    (count, session) => Math.max(count, Number(session.requirementIndex || 0) + 1),
    0,
  );
  return Array.from({ length: Math.max(requirementCount, sessionCount, 1) }, (_, index) => index);
}

function taskFormalSession(task = {}, requirementIndex = 0) {
  const normalizedIndex = Number(requirementIndex || 0);
  return (task.sessions || []).find((session) => (
    session.sessionType === "formal" && Number(session.requirementIndex || 0) === normalizedIndex
  ));
}

function paperFormBindState(task = {}, requirementIndex = 0) {
  const normalizedIndex = Number(requirementIndex || 0);
  return task.config?.paperFormBinds?.[normalizedIndex]
    || (normalizedIndex === 0 ? task.config?.paperFormBind : null)
    || {};
}

async function updatePaperFormBindState(taskId, requirementIndex, status, patch = {}) {
  const now = new Date().toISOString();
  const currentTask = await runTaskState("get", { taskId });
  const normalizedIndex = Math.max(Number(requirementIndex || 0), 0);
  const current = paperFormBindState(currentTask, normalizedIndex);
  const logs = Array.isArray(current.logs) ? current.logs.slice() : [];
  const message = String(patch.message || "").trim();
  if (message) logs.push({ time: now, message });
  const next = {
    ...current,
    requirementIndex: normalizedIndex,
    stepKey: "paper_form_bind",
    stepName: "试卷绑定",
    status,
    startedAt: current.startedAt || (status !== "pending" ? now : null),
    completedAt: ["success", "failed", "skipped"].includes(status) ? now : null,
    durationMs: null,
    errorMessage: patch.errorMessage || "",
    result: patch.result || current.result || {},
    logs,
  };
  if (next.startedAt && next.completedAt) {
    next.durationMs = Math.max(0, Date.parse(next.completedAt) - Date.parse(next.startedAt));
  }
  const paperFormBinds = Array.isArray(currentTask?.config?.paperFormBinds)
    ? [...currentTask.config.paperFormBinds]
    : [];
  paperFormBinds[normalizedIndex] = next;
  await runTaskState("update_config", {
    taskId,
    config: {
      paperFormBinds,
      ...(normalizedIndex === 0 ? { paperFormBind: next } : {}),
    },
  });
  return await runTaskState("get", { taskId });
}

function parseTaskStartTime(task = {}, requirementIndex = 0) {
  const requirementConfig = taskRequirementConfig(task, requirementIndex);
  const values = [
    requirementConfig.startTimeIso,
    requirementConfig.startTimeDisplay,
    requirementConfig.startTime,
    taskFormalSession(task, requirementIndex)?.start,
  ];
  for (const value of values) {
    if (!value) continue;
    const normalized = String(value).trim().replace(/\//g, "-").replace(" ", "T");
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function shouldAttemptScheduledPaperBind(task = {}, requirementIndex = 0, now = new Date()) {
  const current = paperFormBindState(task, requirementIndex);
  if (current.status === "success" || current.status === "running") return false;
  if (shouldSkipRecentFailedPaperBindCheck(current, now, PAPER_BIND_FAILURE_COOLDOWN_MS)) return false;
  const formalSession = taskFormalSession(task, requirementIndex);
  if (!formalSession?.session_id) return false;
  const courses = normalizeCourseRecords(taskRequirementConfig(task, requirementIndex));
  if (!courses.length) return false;
  const start = parseTaskStartTime(task, requirementIndex);
  if (!start) return false;
  const msUntilStart = start.getTime() - now.getTime();
  return msUntilStart > 0 && msUntilStart <= PAPER_BIND_SCHEDULER_WINDOW_MS;
}

async function runPaperFormBindForTask(task, login, { scheduled = false, requirementIndex = 0 } = {}) {
  const formalSession = taskFormalSession(task, requirementIndex);
  const courses = normalizeCourseRecords(taskRequirementConfig(task, requirementIndex));
  const apiBase = normalizeApiBase(process.env.YIKAO_API_BASE || login.apiBase || "https://eztest.cn");
  const paperLogs = [];
  const emitLog = (message) => paperLogs.push(message);
  await updatePaperFormBindState(task.taskId, requirementIndex, "running", {
    message: scheduled
      ? `需求单 ${Number(requirementIndex) + 1} 进入试卷绑定窗口，开始自动绑定试卷`
      : `开始绑定需求单 ${Number(requirementIndex) + 1} 的试卷，不修改其他场次`,
  });
  try {
    if (!courses.length) {
      const manualBindResult = await detectSessionPaperBindings({
        login,
        apiBase,
        sessionId: formalSession?.session_id,
        courses,
        requestJson: readTenantJsonWithLogin,
        emitLog,
      });
      if (manualBindResult.status === "success") {
        return {
          ok: true,
          status: 200,
          task: await updatePaperFormBindState(task.taskId, requirementIndex, "success", {
            message: paperLogs.join("\n") || "人工绑定回查确认正式场次已有试卷",
            result: {
              sessionId: formalSession?.session_id,
              courseCount: manualBindResult.results?.length || 0,
              bindResult: manualBindResult,
              detectedManualBinding: true,
            },
          }),
        };
      }
      const errorMessage = "任务未保存科目信息，且正式场次未检测到已绑定试卷";
      return {
        ok: false,
        status: 409,
        task: await updatePaperFormBindState(task.taskId, requirementIndex, "failed", {
          errorMessage,
          message: [...paperLogs, errorMessage].filter(Boolean).join("\n"),
          result: { sessionId: formalSession?.session_id, courseCount: 0, bindResult: manualBindResult, missingCourseCodes: [] },
        }),
      };
    }

    const bindResult = await bindPapersToFormalSession({
      login,
      apiBase,
      sessionId: formalSession?.session_id,
      courses,
      requestJson: readTenantJsonWithLogin,
      emitLog,
    });
    if (bindResult.status === "waiting_manual") {
      const manualBindResult = await detectSessionPaperBindings({
        login,
        apiBase,
        sessionId: formalSession?.session_id,
        courses,
        requestJson: readTenantJsonWithLogin,
        emitLog,
      });
      if (manualBindResult.status === "success") {
        return {
          ok: true,
          status: 200,
          task: await updatePaperFormBindState(task.taskId, requirementIndex, "success", {
            message: paperLogs.join("\n") || "人工绑定回查确认正式场次已有试卷",
            result: {
              sessionId: formalSession?.session_id,
              courseCount: courses.length,
              bindResult: manualBindResult,
              detectedManualBinding: true,
            },
          }),
        };
      }
      const missingCourseCodes = bindResult.missingCourseCodes || [];
      const duplicatePaperMatches = bindResult.duplicatePaperMatches || [];
      const duplicatePaperNames = duplicatePaperMatches
        .map((match) => `${match.course_code || "未知科目"}/${match.paper_name || "同名试卷"}`)
        .join("、");
      const errorMessage = duplicatePaperMatches.length
        ? `发现重复试卷，请人工确认：${duplicatePaperNames}`
        : `缺少试卷编号，无法绑定试卷：${missingCourseCodes.join("、") || "未获取到试卷 code"}`;
      return {
        ok: false,
        status: 409,
        task: await updatePaperFormBindState(task.taskId, requirementIndex, "failed", {
          errorMessage,
          message: [...paperLogs, errorMessage].filter(Boolean).join("\n"),
          result: { sessionId: formalSession?.session_id, courseCount: courses.length, bindResult, missingCourseCodes, duplicatePaperMatches },
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      task: await updatePaperFormBindState(task.taskId, requirementIndex, "success", {
        message: paperLogs.join("\n") || "试卷绑定成功",
        result: { sessionId: formalSession?.session_id, courseCount: courses.length, bindResult },
      }),
    };
  } catch (error) {
    const message = [...paperLogs, error instanceof Error ? error.message : String(error)].filter(Boolean).join("\n");
    return {
      ok: false,
      status: error?.status && Number(error.status) >= 400 ? Number(error.status) : 500,
      task: await updatePaperFormBindState(task.taskId, requirementIndex, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
        message,
      }),
    };
  }
}

async function runScheduledPaperBindingOnce(now = new Date()) {
  const summaries = await runTaskState("list_all");
  const results = [];
  for (const summary of summaries || []) {
    const task = await runTaskState("get", { taskId: summary.taskId });
    if (!task) continue;
    for (const requirementIndex of taskRequirementIndexes(task)) {
      if (!shouldAttemptScheduledPaperBind(task, requirementIndex, now)) continue;
      try {
        const login = getYikaoLoginForTask(task);
        const result = await runPaperFormBindForTask(task, login, { scheduled: true, requirementIndex });
        results.push({
          taskId: task.taskId,
          requirementIndex,
          status: paperFormBindState(result.task, requirementIndex).status || "unknown",
        });
      } catch (error) {
        results.push({
          taskId: task.taskId,
          requirementIndex,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  if (results.length) console.log(`[试卷绑定定时] 本轮处理 ${results.length} 个任务：${JSON.stringify(results)}`);
  return results;
}

async function handleTaskStepRetry(taskId, stepKey, req, res) {
  const visibleTask = await runTaskState("get", { taskId });
  if (!visibleTask || !visibleByOwner(auth, req, visibleTask)) return notFound(res);
  const payload = parseJsonSafe(await readBody(req)) || {};
  const requestedRequirementIndex = Number(payload.requirementIndex ?? 0);
  const requirementIndexes = taskRequirementIndexes(visibleTask);
  const requirementIndex = Number.isInteger(requestedRequirementIndex) && requirementIndexes.includes(requestedRequirementIndex)
    ? requestedRequirementIndex
    : 0;
  if (stepKey === "paper_bind") {
    const task = visibleTask;

    const formalSession = taskFormalSession(task, requirementIndex);
    const courses = normalizeCourseRecords(taskRequirementConfig(task, requirementIndex));
    const login = getYikaoLoginForTask(task);
    const apiBase = normalizeApiBase(process.env.YIKAO_API_BASE || login.apiBase || "https://eztest.cn");
    const retryLogs = [];
    const emitLog = (message) => retryLogs.push(message);

    await updateTaskStep(taskId, stepKey, "running", {
      incrementRetry: true,
      message: `开始单独重试需求单 ${requirementIndex + 1} 的正式场次绑定科目，不重新创建场次或科目`,
    }, requirementIndex);
    try {
      const bindResult = await bindCoursesToFormalSession({
        login,
        apiBase,
        sessionId: formalSession?.session_id,
        courses,
        requestJson: readTenantJsonWithLogin,
        emitLog,
      });
      const updated = await updateTaskStep(taskId, stepKey, "success", {
        message: retryLogs.join("\n") || "正式场次绑定科目重试成功",
        result: { sessionId: formalSession?.session_id, courseCount: courses.length, bindResult },
      }, requirementIndex);
      return json(res, 200, updated);
    } catch (error) {
      await updateTaskStep(taskId, stepKey, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
        message: [...retryLogs, error instanceof Error ? error.message : String(error)].filter(Boolean).join("\n"),
      }, requirementIndex);
      throw error;
    }
  }

  if (stepKey === "paper_form_bind") {
    const task = visibleTask;
    const login = getYikaoLoginForTask(task);
    const result = await runPaperFormBindForTask(task, login, { requirementIndex });
    return json(res, result.status, result.task);
  }

  if (stepKey === "trial_paper_bind") {
    const task = visibleTask;
    const trialSession = (task.sessions || []).find((session) => (
      session.sessionType === "trial" && Number(session.requirementIndex || 0) === requirementIndex
    ));
    const login = getYikaoLoginForTask(task);
    const apiBase = normalizeApiBase(process.env.YIKAO_API_BASE || login.apiBase || "https://eztest.cn");
    const trialPaperLogs = [];
    const emitLog = (message) => trialPaperLogs.push(message);

    await updateTaskStep(taskId, stepKey, "running", {
      incrementRetry: true,
      message: `开始重试需求单 ${requirementIndex + 1} 的试考默认试卷绑定`,
    }, requirementIndex);
    try {
      const bindResult = await bindDefaultTrialPaperToSession({
        login,
        apiBase,
        sessionId: trialSession?.session_id,
        requestJson: readTenantJsonWithLogin,
        emitLog,
      });
      if (bindResult.status === "waiting_manual") {
        const updated = await updateTaskStep(taskId, stepKey, "waiting_manual", {
          message: trialPaperLogs.join("\n") || "默认试考科目未关联试卷，请在租户后台关联后重试",
          result: { sessionId: trialSession?.session_id, bindResult },
        }, requirementIndex);
        return json(res, 409, updated);
      }
      const updated = await updateTaskStep(taskId, stepKey, "success", {
        message: trialPaperLogs.join("\n") || "试考默认试卷绑定重试成功",
        result: { sessionId: trialSession?.session_id, bindResult },
      }, requirementIndex);
      return json(res, 200, updated);
    } catch (error) {
      await updateTaskStep(taskId, stepKey, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
        message: [...trialPaperLogs, error instanceof Error ? error.message : String(error)].filter(Boolean).join("\n"),
      }, requirementIndex);
      throw error;
    }
  }

  const task = await updateTaskStep(taskId, stepKey, "pending", {
    incrementRetry: true,
    message: "已提交单步骤重试，等待对应业务执行器处理",
  });
  json(res, 200, task);
}

function handleEvents(job, req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write("\n");

  const send = (evt) => {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  };

  job.events.forEach(send);
  job.listeners.add(send);

  req.on("close", () => {
    job.listeners.delete(send);
  });
}

async function handleArtifact(urlPath, res) {
  const [, , jobId, fileName] = urlPath.split("/");
  const filePath = path.join(runtimeDir, "shots", jobId, fileName);
  try {
    await fs.access(filePath);
  } catch {
    return notFound(res);
  }
  const ext = path.extname(fileName).toLowerCase();
  const contentType =
    ext === ".svg" ? "image/svg+xml; charset=utf-8" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  res.writeHead(200, { "Content-Type": contentType });
  createReadStream(filePath).pipe(res);
}

async function buildHtml() {
  const html = await fs.readFile(webFile, "utf8");
  return html.replace(
    "</body>",
    `\n<script>window.EASY_EXAM_RUNTIME={apiBase:"",appVersion:"1.0.0"};</script>\n</body>`,
  );
}

async function handleWebModule(urlPath, res) {
  const relativePath = decodeURIComponent(urlPath.slice("/web/".length));
  const filePath = path.resolve(webModulesDir, relativePath);
  if (!filePath.startsWith(`${webModulesDir}${path.sep}`)) return notFound(res);
  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": webContentType(filePath),
      "Cache-Control": "no-store",
    });
    res.end(content);
  } catch {
    return notFound(res);
  }
}

async function requestHandler(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  try {
    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      return await handleAuthLogin(auth, req, res);
    }
    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      return handleAuthMe(auth, req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      return await handleAuthLogout(auth, req, res);
    }
    if ((req.method === "POST" || req.method === "OPTIONS") && url.pathname === "/api/fanwei/bridge/submit") {
      return await handleFanweiBridgeSubmit(req, res);
    }
    if (url.pathname === "/api/auth/users" || url.pathname.startsWith("/api/auth/users/")) {
      return await handleAuthUsers(auth, req, res, url);
    }
    if (auth.enabled && !shouldAllowWithoutAuth(req.method, url.pathname) && !getAuthUserFromRequest(auth, req)) {
      if (req.method === "GET" && (isFrontendRoute(url.pathname) || url.pathname === "/easy_exam_automation.html")) {
        return redirectToLogin(req, res, url);
      }
      return json(res, 401, { error: "请先登录" });
    }
    if (req.method === "GET" && url.pathname.startsWith("/web/")) {
      return await handleWebModule(url.pathname, res);
    }
    if (req.method === "GET" && (isFrontendRoute(url.pathname) || url.pathname === "/easy_exam_automation.html")) {
      return sendHtml(res, await buildHtml());
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/api/settings") {
      return await handleGetSettings(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/settings") {
      return await handleSaveSettings(req, res);
    }
    if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/email/settings") {
      if (!requireAdmin(auth, req, res)) return;
      return await handleEmailSettings(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/email/test") {
      if (!requireAdmin(auth, req, res)) return;
      return await handleEmailTest(req, res);
    }
    if (url.pathname === "/api/customer-service-scheduler" || url.pathname.startsWith("/api/customer-service-scheduler/")) {
      const handled = await handleCustomerServiceScheduler(req, res, url);
      if (handled !== false) return;
    }
    if (req.method === "POST" && url.pathname === "/api/import") {
      return await handleImport(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/fanwei/requirement-preview") {
      return await handleFanweiRequirementPreview(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/fanwei/requirement-import") {
      return await handleFanweiRequirementImport(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/fanwei/project-card") {
      return await handleFanweiRequirementImport(req, res);
    }
    if (req.method === "GET" && url.pathname === "/api/fanwei/auto-read/status") {
      return await handleFanweiAutoReadStatus(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/fanwei/local-read") {
      return await handleFanweiLocalRead(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/fanwei/auto-read") {
      return await handleFanweiAutoRead(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/fanwei/bridge-token") {
      return await handleFanweiBridgeToken(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/fanwei/bridge-result") {
      return await handleFanweiBridgeResult(req, res);
    }
    if (req.method === "GET" && url.pathname === "/api/fanwei/helper-installer") {
      return await handleFanweiHelperInstaller(url, res);
    }
    if (req.method === "GET" && url.pathname === "/api/templates/exam-request") {
      return await handleExamRequestTemplate(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/jobs") {
      return await handleCreateJob(req, res);
    }
    if (await handleRequirementRequest(req, res, url)) {
      return;
    }
    if (await handleWechatCollector(req, res, url)) {
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/operation-console/environment") {
      return await handleOperationConsoleEnvironment(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/operation-console/environment/install") {
      if (!requireAdmin(auth, req, res)) return;
      return await handleOperationConsoleEnvironmentInstall(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/operation-console/environment/enable") {
      if (!requireAdmin(auth, req, res)) return;
      return await handleOperationConsoleEnvironmentEnable(req, res);
    }
    if (req.method === "GET" && url.pathname === "/api/tasks") {
      return await handleTaskList(req, res);
    }
    if (req.method === "GET" && url.pathname === "/api/exams") {
      return await handleExamList(req, res);
    }
    const taskRetryMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/steps\/([^/]+)\/retry$/);
    if (req.method === "POST" && taskRetryMatch) {
      return await handleTaskStepRetry(decodeURIComponent(taskRetryMatch[1]), decodeURIComponent(taskRetryMatch[2]), req, res);
    }
    const operationBatchDraftMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-batch\/draft$/);
    if ((req.method === "GET" || req.method === "POST") && operationBatchDraftMatch) {
      return await handleOperationBatchDraft(decodeURIComponent(operationBatchDraftMatch[1]), req, res);
    }
    const projectWorkflowMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-workflow$/);
    if (req.method === "GET" && projectWorkflowMatch) {
      return await handleProjectWorkflow(decodeURIComponent(projectWorkflowMatch[1]), req, res);
    }
    const projectSourceSnapshotMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/source-snapshot$/);
    if (req.method === "PATCH" && projectSourceSnapshotMatch) {
      return await handleProjectSourceSnapshotUpdate(decodeURIComponent(projectSourceSnapshotMatch[1]), req, res);
    }
    const operationBatchCreateMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-batch\/create$/);
    if (req.method === "POST" && operationBatchCreateMatch) {
      return await handleOperationBatchCreate(decodeURIComponent(operationBatchCreateMatch[1]), req, res);
    }
    const operationBatchReconcileMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-batch\/reconcile$/);
    if (req.method === "POST" && operationBatchReconcileMatch) {
      return await handleOperationBatchReconcile(decodeURIComponent(operationBatchReconcileMatch[1]), req, res);
    }
    const operationBatchResultMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-batch\/result$/);
    if (req.method === "POST" && operationBatchResultMatch) {
      return await handleOperationBatchResult(decodeURIComponent(operationBatchResultMatch[1]), req, res);
    }
    const operationBatchUpdateStateMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-batch\/update-state$/);
    if (req.method === "GET" && operationBatchUpdateStateMatch) {
      return await handleOperationBatchUpdateState(decodeURIComponent(operationBatchUpdateStateMatch[1]), req, res);
    }
    const operationBatchUpdatePreviewMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-batch\/update-preview$/);
    if (req.method === "POST" && operationBatchUpdatePreviewMatch) {
      return await handleOperationBatchUpdatePreview(decodeURIComponent(operationBatchUpdatePreviewMatch[1]), req, res);
    }
    const operationBatchUpdateMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-batch\/update$/);
    if (req.method === "POST" && operationBatchUpdateMatch) {
      return await handleOperationBatchUpdateStart(decodeURIComponent(operationBatchUpdateMatch[1]), req, res);
    }
    const operationBatchUpdateAttemptMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-batch\/update-attempts\/([^/]+)$/);
    if (req.method === "GET" && operationBatchUpdateAttemptMatch) {
      return await handleOperationBatchUpdateAttempt(
        decodeURIComponent(operationBatchUpdateAttemptMatch[1]),
        decodeURIComponent(operationBatchUpdateAttemptMatch[2]),
        req,
        res,
      );
    }
    const personnelStateMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-personnel-task$/);
    if (req.method === "GET" && personnelStateMatch) {
      return await handleOperationPersonnelTaskState(decodeURIComponent(personnelStateMatch[1]), req, res);
    }
    const personnelPreviewMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-personnel-task\/preview$/);
    if (req.method === "POST" && personnelPreviewMatch) {
      return await handleOperationPersonnelTaskPreview(decodeURIComponent(personnelPreviewMatch[1]), req, res);
    }
    const personnelSendMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-personnel-task\/send$/);
    if (req.method === "POST" && personnelSendMatch) {
      return await handleOperationPersonnelTaskSend(decodeURIComponent(personnelSendMatch[1]), req, res);
    }
    const personnelAttemptMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-personnel-task\/attempts\/([^/]+)$/);
    if (req.method === "GET" && personnelAttemptMatch) {
      return await handleOperationPersonnelTaskAttempt(
        decodeURIComponent(personnelAttemptMatch[1]),
        decodeURIComponent(personnelAttemptMatch[2]),
        req,
        res,
      );
    }
    const personnelRecheckMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-personnel-task\/recheck$/);
    if (req.method === "POST" && personnelRecheckMatch) {
      return await handleOperationPersonnelTaskRecheck(decodeURIComponent(personnelRecheckMatch[1]), req, res);
    }
    const contentRequirementEmailMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/content-requirement-email$/);
    if (req.method === "POST" && contentRequirementEmailMatch) {
      return await handleContentRequirementEmail(decodeURIComponent(contentRequirementEmailMatch[1]), req, res);
    }
    const contentTaskRemarksMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/content-task-remarks$/);
    if (req.method === "PATCH" && contentTaskRemarksMatch) {
      return await handleContentTaskRemark(decodeURIComponent(contentTaskRemarksMatch[1]), req, res);
    }
    const sharedSheetFillMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/shared-sheet\/fill$/);
    if (req.method === "POST" && sharedSheetFillMatch) {
      return await handleProjectSharedSheetFill(decodeURIComponent(sharedSheetFillMatch[1]), req, res);
    }
    const scoreProcessMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/scores\/process$/);
    if (req.method === "POST" && scoreProcessMatch) {
      return await handleScoreProcess(decodeURIComponent(scoreProcessMatch[1]), req, res);
    }
    const scoreDownloadMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/scores\/download$/);
    if (req.method === "GET" && scoreDownloadMatch) {
      return await handleScoreDownload(decodeURIComponent(scoreDownloadMatch[1]), req, res);
    }
    const scoreReportDownloadMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/scores\/reports\/download$/);
    if (req.method === "GET" && scoreReportDownloadMatch) {
      return await handleScoreReportDownload(decodeURIComponent(scoreReportDownloadMatch[1]), req, res);
    }
    const scoreStampArchiveDownloadMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/scores\/stamp-archive\/download$/);
    if (req.method === "GET" && scoreStampArchiveDownloadMatch) {
      return await handleScoreStampArchiveDownload(decodeURIComponent(scoreStampArchiveDownloadMatch[1]), req, res);
    }
    const scoreStampApplicationMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/scores\/stamp-application$/);
    if (req.method === "POST" && scoreStampApplicationMatch) {
      return await handleScoreStampApplication(decodeURIComponent(scoreStampApplicationMatch[1]), req, res);
    }
    const sessionChangePreviewMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/sessions\/([^/]+)\/change-preview$/);
    if (req.method === "GET" && sessionChangePreviewMatch) {
      return await handleSessionChangePreview(
        decodeURIComponent(sessionChangePreviewMatch[1]),
        decodeURIComponent(sessionChangePreviewMatch[2]),
        req,
        res,
      );
    }
    const sessionChangeMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/sessions\/([^/]+)\/change$/);
    if (req.method === "POST" && sessionChangeMatch) {
      return await handleSessionChange(
        decodeURIComponent(sessionChangeMatch[1]),
        decodeURIComponent(sessionChangeMatch[2]),
        req,
        res,
      );
    }
    const taskDetailMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (req.method === "DELETE" && taskDetailMatch) {
      return await handleTaskHide(decodeURIComponent(taskDetailMatch[1]), req, res);
    }
    if (req.method === "GET" && taskDetailMatch) {
      return await handleTaskDetail(decodeURIComponent(taskDetailMatch[1]), req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/candidates/parse") {
      return await handleCandidateParse(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/candidates/generate-template") {
      return await handleCandidateTemplate(req, res);
    }
    if (req.method === "GET" && url.pathname === "/api/sessions") {
      return await handleSessions(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/candidates/import") {
      return await handleCandidateImport(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/rooms/monitor-accounts/excel") {
      return await handleMonitorAccountsExcel(req, res);
    }
    const roomsPreviewMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/rooms\/preview$/);
    if (req.method === "POST" && roomsPreviewMatch) {
      return await handleRoomsPreview(decodeURIComponent(roomsPreviewMatch[1]), req, res);
    }
    const monitorAccountsMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/monitor-accounts$/);
    if (req.method === "GET" && monitorAccountsMatch) {
      return await handleSessionMonitorAccounts(decodeURIComponent(monitorAccountsMatch[1]), req, res);
    }
    const roomsAutoMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/rooms\/auto$/);
    if (req.method === "POST" && roomsAutoMatch) {
      return await handleRoomsAuto(decodeURIComponent(roomsAutoMatch[1]), req, res);
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/events")) {
      const jobId = url.pathname.split("/")[3];
      const job = state.jobs.get(jobId);
      return job ? handleEvents(job, req, res) : notFound(res);
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
      const jobId = url.pathname.split("/")[3];
      const job = state.jobs.get(jobId);
      return job ? handleJobState(job, res) : notFound(res);
    }
    if (req.method === "GET" && url.pathname.startsWith("/artifacts/")) {
      return await handleArtifact(url.pathname, res);
    }
    notFound(res);
  } catch (error) {
    json(res, error.status || 500, {
      error: error instanceof Error ? error.message : String(error),
      detail: error.detail,
    });
  }
}

await loadEnvFile();
await ensureRuntime();
const auth = buildAuthContext({ localConfig: { ...state.auth, users: state.authUsers } });
restoreSessions(auth, state.authSessions);

const port = Number(process.env.PORT || 8765);
const host = process.env.HOST || "127.0.0.1";
const server = http.createServer(requestHandler);
server.listen(port, host, () => {
  console.log(`Easy Exam server running at http://${host}:${port}`);
});

if (process.env.PAPER_BIND_SCHEDULER_DISABLED !== "1") {
  setInterval(runScheduledPaperBindingOnce, PAPER_BIND_SCHEDULER_INTERVAL_MS).unref();
  runScheduledPaperBindingOnce().catch((error) => {
    console.warn(`[试卷绑定定时] 启动检查失败：${error instanceof Error ? error.message : String(error)}`);
  });
}

export {
  parseTaskStartTime,
  runScheduledPaperBindingOnce,
  shouldAttemptScheduledPaperBind,
};
