import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  bindCoursesToFormalSession,
  createSessionsThenConfigureCourses,
} from "./course_session_binding.mjs";
import { bindPapersToFormalSession } from "./paper_binding.mjs";
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
  businessDraftToCustomer,
  businessDraftToRequirement,
  businessTemplateMarkRegions,
  businessTemplateOptionRegions,
  businessTemplateTextRegions,
  parseBusinessRequirementOcr,
  parseBusinessRequirementTemplateRegions,
  templateFrameFromTableBounds,
  templateRectToImageRect,
} from "./project_intake.mjs";
import {
  applyOperationBatchResult,
  buildOperationBatchDraft,
} from "./operation_batch.mjs";
import {
  checkOperationConsoleAutomationEnvironment,
  enableOperationConsoleAutomation,
  installOperationConsoleAutomationDeps,
} from "./operation_console_env.mjs";
import { runOperationBatchCreation } from "./operation_batch_runner.mjs";
import { deleteTaskSessionsFromTenant } from "./session_deletion.mjs";
import {
  apiKeyProfilesForUser,
  currentUserLogin,
  deleteApiKeyProfileForUser,
  defaultUserSettings,
  normalizeUserSettings,
  publicApiKeyProfiles,
  publicApiKeyProfilesForUser,
  saveUserLogin,
  updateApiKeyProfileForUser,
  upsertApiKeyProfileInRecord,
} from "./user_settings.mjs";
import { runCustomerServiceSchedulerForTargets } from "./customer_service_scheduler.mjs";
import {
  syncExamConfigToTencentDocs,
  tencentDocsSettingsFromEnv,
} from "./tencent_docs_sync.mjs";
import { createWechatCollectorHandler } from "./wechat_collector_api.mjs";
import { disableWechatGroupsForDeletedTask } from "./wechat_project_cleanup.mjs";
import {
  normalizeEmailSettings,
  redactEmailSettings,
  sendContentRequirementEmail,
} from "./content_requirement_email.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const webFile = path.join(rootDir, "outputs", "web_prototype", "easy_exam_automation.html");
const webModulesDir = path.join(rootDir, "web");
const runtimeDir = path.join(rootDir, ".easy_exam_runtime");
const uploadsDir = path.join(runtimeDir, "uploads");
const generatedDir = path.join(runtimeDir, "generated");
const settingsPath = path.join(runtimeDir, "settings.json");
const authSettingsPath = path.join(runtimeDir, "auth.json");
const authUsersPath = path.join(runtimeDir, "auth_users.json");
const authSessionsPath = path.join(runtimeDir, "auth_sessions.json");
const userSettingsPath = path.join(runtimeDir, "user_settings.json");
const emailSettingsPath = path.join(runtimeDir, "email_settings.json");
const parserScript = path.join(__dirname, "exam_request_parser.py");
const candidateParserScript = path.join(__dirname, "candidate_list_parser.py");
const monitorAccountExporterScript = path.join(__dirname, "monitor_account_exporter.py");
const scoreFeedbackExporterScript = path.join(__dirname, "score_feedback_exporter.py");
const taskStateScript = path.join(__dirname, "task_state_db.py");
const requirementStateScript = path.join(__dirname, "requirement_request_db.py");
const ocrImageScript = path.join(rootDir, "scripts", "ocr_image.swift");
const scoreFeedbackTemplatePath = path.join(rootDir, "template", "成绩单模板.xlsx");
const examRequestTemplatePath = path.join(rootDir, "template", "v2易考新建考试需求单.xlsx");
const taskDbPath = path.join(runtimeDir, "task_state.sqlite3");
const requirementDbPath = path.join(runtimeDir, "requirement_requests.sqlite3");
const wechatGroupConfigPath = path.join(runtimeDir, "wechat-requirement-groups.json");
const pythonBin =
  process.env.CODEX_PYTHON ||
  process.env.PYTHON ||
  "python3";

const handleWechatCollector = createWechatCollectorHandler({
  configPath: wechatGroupConfigPath,
  groupActivityStatus: wechatGroupActivityStatus,
});

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
  const pledgeContent = String(config.pledgeContent || "").trim();
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
    notice: String(config.preLoginPrompt || ""),
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
        await updateTaskStep(job.taskId, activeStep, "running", {
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
        await updateTaskStep(job.taskId, activeStep, "success", {
          message: `创建成功：${item.payload.name}${sessionId ? `，session_id=${sessionId}` : ""}`,
          result: { sessionId, name: item.payload.name, kind: item.kind },
        });
        emitLog(`[API 创建] 创建成功：${item.payload.name}${sessionId ? `，session_id=${sessionId}` : ""}`);
        return createdSession;
      },
      configureCourses: async (formalSession) => {
        activeStep = "course_create";
        await updateTaskStep(job.taskId, "course_create", "running", { message: "开始创建并确认正式考试科目" });
        emitStage("正式考试科目", 85);
        const courses = await ensureFormalCoursesCreated({
          login,
          apiBase,
          config: job.config,
          requestJson: readTenantJsonWithLogin,
          emitLog,
        });
        job.config = { ...job.config, courses };
        await runTaskState("update_config", { taskId: job.taskId, config: { courses } });
        await updateTaskStep(job.taskId, "course_create", "success", {
          message: courses.length
            ? `科目创建/确认完成，最终科目编号：${courses.map((course) => `${course.name}/${course.code}`).join("、")}`
            : "需求单科目为空，已跳过科目创建。",
          result: { courses },
        });

        activeStep = "paper_bind";
        await updateTaskStep(job.taskId, "paper_bind", "running", {
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
        await updateTaskStep(job.taskId, "paper_bind", "success", {
          message: courses.length ? `已将 ${courses.length} 个科目绑定到正式考试场次` : "需求单科目为空，已跳过正式场次科目绑定。",
          result: { bindResult },
        });
      },
    });

    const trialSession = created.find((session) => session?.kind === "mock");
    if (trialSession?.id) {
      activeStep = "trial_paper_bind";
      await updateTaskStep(job.taskId, "trial_paper_bind", "running", {
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
        await updateTaskStep(job.taskId, "trial_paper_bind", "waiting_manual", {
          message: trialPaperLogs.join("\n") || "默认试考科目未关联试卷，请在租户后台关联后重试",
          result: { sessionId: trialSession.id, bindResult },
        });
      } else {
        await updateTaskStep(job.taskId, "trial_paper_bind", "success", {
          message: trialPaperLogs.join("\n") || "试考默认试卷绑定成功",
          result: { sessionId: trialSession.id, bindResult },
        });
      }
    } else {
      await updateTaskStep(job.taskId, "trial_paper_bind", "skipped", {
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
    await updateTaskStep(job.taskId, activeStep, "failed", {
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

async function wechatGroupActivityStatus(group = {}) {
  const groupTaskId = String(group.task_id || group.taskId || "").trim();
  const groupRequestId = String(group.requirement_request_id || group.requirementRequestId || "").trim();
  const groupProjectName = String(group.project_name || group.projectName || "").trim();
  if (!groupTaskId && !groupRequestId && !groupProjectName) return { active: true };

  let summaries = [];
  try {
    summaries = await runTaskState("list_all", {});
  } catch {
    return { active: true };
  }

  if (groupTaskId) {
    const summary = (summaries || []).find((item) => item.taskId === groupTaskId);
    return summary && !summary.hiddenAt
      ? { active: true }
      : { active: false, reason: "关联项目已删除，已停止微信群自动采集" };
  }

  if (groupRequestId) {
    for (const summary of summaries || []) {
      const task = await runTaskState("get", { taskId: summary.taskId });
      if (task?.hiddenAt) continue;
      if (taskRequirementIds(task).includes(groupRequestId)) return { active: true };
    }
    return { active: false, reason: "关联项目已删除，已停止微信群自动采集" };
  }

  const hasVisibleProject = (summaries || []).some((task) => (
    !task.hiddenAt && String(task.projectName || "").trim() === groupProjectName
  ));
  return hasVisibleProject
    ? { active: true }
    : { active: false, reason: "关联项目已删除，已停止微信群自动采集" };
}

async function runImageOcr(imagePath, rect = null) {
  const args = rect
    ? [ocrImageScript, "--rect-normalized", ...rect.map((item) => String(item)), imagePath]
    : [ocrImageScript, imagePath];
  const child = spawn("swift", args, {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) throw new Error(stderr.trim() || "截图 OCR 失败");
  return stdout.trim();
}

async function runImageMarkMetrics(imagePath, rect) {
  const child = spawn("swift", [ocrImageScript, "--mark-normalized", ...rect.map((item) => String(item)), imagePath], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) throw new Error(stderr.trim() || "截图标记检测失败");
  return JSON.parse(stdout || "{}");
}

async function runImageTemplateFrame(imagePath) {
  const child = spawn("swift", [ocrImageScript, "--template-bounds", imagePath], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) throw new Error(stderr.trim() || "截图模板边界检测失败");
  const bounds = JSON.parse(stdout || "{}");
  return templateFrameFromTableBounds(bounds);
}

async function runBusinessTemplateOcr(imagePath) {
  const frame = await runImageTemplateFrame(imagePath).catch(() => null);
  const regions = {};
  for (const item of [...businessTemplateTextRegions(), ...businessTemplateOptionRegions()]) {
    regions[item.field] = await runImageOcr(imagePath, templateRectToImageRect(item.rect, frame)).catch(() => "");
  }
  const markSelections = {};
  const markMetrics = {};
  for (const item of businessTemplateMarkRegions()) {
    const metrics = await runImageMarkMetrics(imagePath, templateRectToImageRect(item.rect, frame)).catch(() => null);
    markMetrics[`${item.field}:${item.label}`] = metrics;
    if (metrics && Number(metrics.darkRatio || 0) >= 0.03) {
      if (!markSelections[item.field]) markSelections[item.field] = [];
      markSelections[item.field].push(item.label);
    }
  }
  return { regions, markSelections, markMetrics, frame };
}

async function updateTaskStep(taskId, stepKey, status, result = {}) {
  if (!taskId) return null;
  return await runTaskState("update_step", { taskId, stepKey, status, result });
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

async function updateTaskSessionProgress(task, sessionId, patch = {}) {
  const session = taskSessionForId(task, sessionId);
  if (!task?.taskId || !session) return null;
  return await runTaskState("upsert_session", {
    taskId: task.taskId,
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
  const login = getYikaoLoginForRequest(req);
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
      if (importStep?.status !== "success") {
        currentTask = await updateTaskStep(currentTask.taskId, importStepKey, "success", {
          message: `同步场次状态：考生导入已完成，${entriesNum} 人`,
          result: { sessionId, entriesNum },
        }) || currentTask;
      }
    }

    if (roomsCount > 0) {
      const subKey = taskSessionSubStatusKey(session.sessionType);
      const roomsStep = taskStepByKey(currentTask, "sessions_auto_rooms");
      if (roomsStep?.subStatus?.[subKey] !== "success") {
        currentTask = await updateTaskStep(currentTask.taskId, "sessions_auto_rooms", "running", {
          subStatus: mergedStepSubStatus(currentTask, "sessions_auto_rooms", session.sessionType, "success"),
          message: `同步场次状态：${session.sessionType === "formal" ? "正式考试" : "试考"}已完成自动分班，${roomsCount} 个班级`,
          result: { sessionId, entriesNum, roomCount: roomsCount },
        }) || currentTask;
      }
      const monitorStep = taskStepByKey(currentTask, "sessions_invigilator_export");
      if (monitorStep?.subStatus?.[subKey] !== "success") {
        currentTask = await updateTaskStep(currentTask.taskId, "sessions_invigilator_export", "running", {
          subStatus: mergedStepSubStatus(currentTask, "sessions_invigilator_export", session.sessionType, "success"),
          message: `同步场次状态：${session.sessionType === "formal" ? "正式考试" : "试考"}监考账号可下载`,
          result: { sessionId, roomCount: roomsCount },
        }) || currentTask;
      }
    }
  }
  return currentTask;
}

async function parseWorkbook(uploadPath) {
  return await runPythonJson([parserScript, uploadPath]);
}

function createJob(importRecord, login) {
  const job = {
    id: randomUUID(),
    importId: importRecord.id,
    taskId: importRecord.taskId,
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

async function handleProjectIntakeScreenshot(req, res) {
  const url = new URL(req.url, "http://localhost");
  const filename = safeFileName(url.searchParams.get("filename") || "business-requirement.png");
  const ext = path.extname(filename).toLowerCase();
  if (![".png", ".jpg", ".jpeg"].includes(ext)) {
    return badRequest(res, "业务需求表截图仅支持 .png、.jpg、.jpeg");
  }
  const body = await readBody(req);
  if (!body.length) {
    return badRequest(res, "未收到业务需求表截图");
  }
  const uploadId = randomUUID();
  const uploadPath = path.join(uploadsDir, `${uploadId}-${filename}`);
  await fs.writeFile(uploadPath, body);
  const ocrText = await runImageOcr(uploadPath);
  const template = await runBusinessTemplateOcr(uploadPath);
  const draft = parseBusinessRequirementTemplateRegions(template.regions, ocrText, template.markSelections);
  state.imports.set(uploadId, {
    id: uploadId,
    filename,
    uploadPath,
    parsed: { ocrText, regions: template.regions, markSelections: template.markSelections, markMetrics: template.markMetrics, templateFrame: template.frame, draft },
    createdAt: new Date().toISOString(),
  });
  json(res, 200, { uploadId, filename, imagePath: uploadPath, ocrText, regions: template.regions, markSelections: template.markSelections, markMetrics: template.markMetrics, templateFrame: template.frame, draft });
}

async function handleProjectIntakeCreate(req, res) {
  const payload = parseJsonSafe(await readBody(req)) || {};
  const draft = businessDraftToRequirement(payload.draft || payload.requirement || {});
  const projectName = String(draft.project_name || draft.exam_name || "").trim();
  if (!projectName) {
    return badRequest(res, "请先确认项目名称，再创建项目");
  }
  const source = {
    type: "business_screenshot",
    uploadId: payload.uploadId || "",
    fileName: payload.filename || "",
    projectName,
  };
  const requirement = await runRequirementState("upsert", {
    customer: businessDraftToCustomer(draft),
    requirement: draft,
    message: payload.ocrText || payload.message || "",
    source: JSON.stringify(source),
  });
  const authUser = getAuthUserFromRequest(auth, req);
  const task = await runTaskState("create", {
    projectName,
    sourceAccount: "",
    ownerEmail: auth.enabled ? authUser?.email || "" : "",
    config: {
      businessRequirement: draft,
      requirementRequestId: requirement.requestId,
      initialRequirementRequestId: requirement.requestId,
      projectCode: draft.project_code || "",
      customerName: draft.customer_name || "",
      operationSerialNumber: draft.operation_serial_number || "",
      projectIntake: {
        source: "business_screenshot",
        uploadId: payload.uploadId || "",
        fileName: payload.filename || "",
        createdAt: new Date().toISOString(),
      },
    },
  });
  const updated = await updateTaskStep(task.taskId, "requirement_parse", "success", {
    message: `业务需求表已确认，初始需求单已生成：${requirement.requestId}`,
    result: {
      uploadId: payload.uploadId || "",
      requestId: requirement.requestId,
      source: "business_screenshot",
    },
  }) || task;
  json(res, 200, { ok: true, task: updated, requirement, taskId: updated.taskId, requirementRequestId: requirement.requestId });
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
  const login = getYikaoLoginForRequest(req);
  const query = new URL(req.url, "http://localhost").searchParams;
  const sessionName = String(query.get("name") || "");
  const task = await findVisibleTaskBySessionId(req, sessionId).catch(() => null);
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

function calculateRoomSizes(totalEntries, targetSize = 30) {
  if (!Number.isInteger(totalEntries) || totalEntries <= 0) {
    return [];
  }

  if (totalEntries <= targetSize + 2) {
    return [totalEntries];
  }

  const fullRooms = Math.floor(totalEntries / targetSize);
  const remainder = totalEntries % targetSize;

  if (remainder === 0) {
    return Array(fullRooms).fill(targetSize);
  }

  const sizes = Array(fullRooms).fill(targetSize);
  sizes[sizes.length - 1] += remainder;

  return sizes;
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
  const login = getYikaoLoginForRequest(req);
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
      });
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
  const login = getYikaoLoginForRequest(req);
  const targetSize = Number(payload?.targetSize || 30);
  if (!sessionId) {
    return badRequest(res, "session_id 为空");
  }
  if (!Number.isInteger(targetSize) || targetSize <= 0) {
    return badRequest(res, "每个班级人数必须是正整数");
  }

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
  const login = getYikaoLoginForRequest(req);
  const requestedRooms = Array.isArray(payload?.rooms) ? payload.rooms : [];
  const overwrite = Boolean(payload?.overwrite);
  const targetSize = Number(payload?.targetSize || 30);
  if (!sessionId) {
    return badRequest(res, "session_id 为空");
  }
  if (!Number.isInteger(targetSize) || targetSize <= 0) {
    return badRequest(res, "每个班级人数必须是正整数");
  }

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
  const task = await findVisibleTaskBySessionId(req, sessionId);
  const session = taskSessionForId(task, sessionId);
  if (task?.taskId && session?.sessionType) {
    await updateTaskSessionProgress(task, sessionId, {
      candidateCount: entriesNum,
      roomCount: rooms.length,
    });
    const roomsSubStatus = mergedStepSubStatus(task, "sessions_auto_rooms", session.sessionType, "success");
    const monitorSubStatus = mergedStepSubStatus(task, "sessions_invigilator_export", session.sessionType, "success");
    await updateTaskStep(task.taskId, "sessions_auto_rooms", "running", {
      subStatus: roomsSubStatus,
      message: `${session.sessionType === "formal" ? "正式考试" : "试考"}自动分班完成：${entriesNum} 人，${rooms.length} 个班级`,
      result: { sessionId, entriesNum, roomCount: rooms.length, progressbarId, rooms },
    });
    await updateTaskStep(task.taskId, "sessions_invigilator_export", "running", {
      subStatus: monitorSubStatus,
      message: `${session.sessionType === "formal" ? "正式考试" : "试考"}监考账号已生成：${rooms.length} 个班级`,
      result: { sessionId, roomCount: rooms.length, rooms },
    });
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
  if (!payload?.uploadId) {
    return badRequest(res, "缺少 uploadId");
  }
  const importRecord = state.imports.get(payload.uploadId);
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
  if (req.method === "GET" && url.pathname === "/api/customer-service-scheduler") {
    return json(res, 200, {
      ok: true,
      profiles: auth.enabled
        ? publicApiKeyProfilesForUser({ user, userSettings: state.userSettings })
        : publicApiKeyProfiles(state.settings.apiKeyProfiles || []),
    });
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
    const login = getYikaoLoginForRequest(req);
    const targets = selectedProfiles
      .filter((profile) => profile.tenantApiKey)
      .map((profile) => ({
        userId: auth.enabled ? normalizeEmail(user.email) : "local",
        profileId: profile.id,
        label: profile.label,
        apiBase: profile.apiBase,
        apiKey: profile.tenantApiKey,
        keyHint: profile.keyHint,
        login: {
          url: login.url,
          username: login.username,
          password: login.password,
        },
      }));
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
  if (updates.current === true) {
    profiles.forEach((profile) => {
      profile.current = false;
    });
    state.settings.login = {
      ...(state.settings.login || {}),
      tenantApiKey: profiles[index].tenantApiKey,
    };
  }
  profiles[index] = {
    ...profiles[index],
    label: updates.label === undefined ? profiles[index].label : String(updates.label || "").trim(),
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
      tenantApiKey: current?.tenantApiKey || "",
    },
  };
}

function requireAdmin(auth, req, res) {
  const user = getAuthUserFromRequest(auth, req);
  if (!user) {
    json(res, 401, { error: "请先登录" });
    return null;
  }
  if (!isAdminUser(user)) {
    json(res, 403, { error: "只有管理员可以管理用户" });
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
  const tasks = await runTaskState("list");
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
  return json(res, 200, syncedTask);
}

async function handleProjectSharedSheetFill(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);

  await updateTaskStep(taskId, "project_shared_sheet", "running", {
    message: "开始填写项目共享大表",
  });

  const logs = [];
  try {
    const formalSession = (task.sessions || []).find((session) => session.sessionType === "formal");
    if (!formalSession?.session_id) throw new Error("缺少正式考试 session_id，无法填写项目共享大表");
    const trialSession = (task.sessions || []).find((session) => session.sessionType === "trial");
    const sessions = [formalSession];
    logs.push(`[项目共享大表] 开始填写正式考试信息，session_id=${formalSession.session_id}`);
    if (trialSession?.session_id) {
      sessions.push(trialSession);
      logs.push(`[项目共享大表] 检测到试考场次，开始填写试考信息，session_id=${trialSession.session_id}`);
    } else {
      logs.push("[项目共享大表] 当前任务无试考场次，跳过试考填写");
    }

    const settings = tencentDocsSettingsFromEnv(process.env);
    if (!settings.enabled) throw new Error("腾讯文档授权未配置，无法填写项目共享大表");
    const syncResult = await syncExamConfigToTencentDocs({
      config: task.config || {},
      created: sessions,
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

async function handleScoreProcess(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  const formalSession = (task.sessions || []).find((session) => session.sessionType === "formal");
  if (!formalSession?.session_id) return badRequest(res, "缺少正式考试 session_id，无法处理成绩");

  await updateTaskStep(taskId, "score_process", "running", {
    message: "开始成绩处理：读取正式考试成绩并生成成绩反馈单",
  });

  const login = getYikaoLoginForRequest(req);
  const examName = task.projectName || formalSession.name || "正式考试";
  const examTime = [formalSession.start, formalSession.end].filter(Boolean).join(" ~ ");
  const processedDate = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());
  const exportId = randomUUID();
  const payloadPath = path.join(generatedDir, `${exportId}-score-feedback.json`);
  const outputPath = path.join(generatedDir, `${exportId}-score-feedback.xlsx`);
  const fileName = scoreFeedbackFileName(task, formalSession);
  const logs = [];

  try {
    logs.push(`[成绩处理] 开始处理正式考试成绩，session_id=${formalSession.session_id}`);
    const tenantEntries = await fetchAllSessionEntries(login, formalSession.session_id, logs);
    const tenantScores = await fetchAllSessionScores(login, formalSession.session_id, logs);
    const storedCandidates = await runTaskState("list_candidates", {
      taskId,
      sessionId: formalSession.session_id,
    }).catch(() => []);
    const localCandidates = attachCourseNamesToCandidates(storedCandidates, task?.config?.courses || []);
    const rows = await mergeEntryAndScoreRows({
      login,
      sessionId: formalSession.session_id,
      entries: tenantEntries,
      scores: tenantScores,
      localCandidates,
      examName,
      logs,
    });
    const missingScores = rows.filter((row) => String(row.score ?? "").trim() === "").length;
    const unknownStatuses = [...new Set(rows.map((row) => normalizeScoreStatusForLog(row.exam_status)).filter(Boolean))];
    logs.push(`成绩数据：状态 ${tenantEntries.length} 条，成绩 ${tenantScores.length} 条，本地补充 ${localCandidates.length} 条，输出 ${rows.length} 条。`);
    if (missingScores) logs.push(`有 ${missingScores} 名考生未读取到得分字段，得分列保留空白。`);
    if (unknownStatuses.length) logs.push(`发现未转换考试状态，已保留原值：${unknownStatuses.join("、")}`);
    logs.push("[成绩处理] 开始写入成绩单模板");
    await fs.writeFile(
      payloadPath,
      JSON.stringify({ examName, examTime, processedDate, rows }, null, 2),
      "utf8",
    );
    const result = await runPythonJson([scoreFeedbackExporterScript, scoreFeedbackTemplatePath, payloadPath, outputPath]);
    if (!result.ok) {
      throw new Error((result.errors || []).join("；") || "成绩反馈单生成失败");
    }
    logs.push(`[成绩处理] 成绩反馈单生成成功：${fileName}`);
    const updated = await updateTaskStep(taskId, "score_process", "success", {
      message: logs.join("\n"),
      result: {
        sessionId: formalSession.session_id,
        fileName,
        filePath: outputPath,
        rowCount: rows.length,
        missingScores,
      },
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
  const filePath = path.resolve(String(result.filePath || ""));
  const generatedRoot = path.resolve(generatedDir);
  if (!filePath || !filePath.startsWith(`${generatedRoot}${path.sep}`)) {
    return badRequest(res, "成绩反馈单文件不存在，请先触发成绩处理");
  }
  try {
    await fs.access(filePath);
  } catch {
    return badRequest(res, "成绩反馈单文件不存在，请重新处理");
  }
  res.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName || "成绩反馈单.xlsx")}`,
  });
  createReadStream(filePath).pipe(res);
}

function taskProjectCode(task = {}) {
  return String(task.config?.businessRequirement?.project_code || task.config?.projectCode || "").trim();
}

function taskDeletionConfirmText(task = {}) {
  return taskProjectCode(task) || String(task.projectName || task.config?.projectName || task.taskId || "").trim();
}

function taskDeleteTokenSecret() {
  return String(process.env.EASY_EXAM_DELETE_SECRET || `${rootDir}:${authSettingsPath}`);
}

function signTaskDeletePayload(payload) {
  return createHmac("sha256", taskDeleteTokenSecret()).update(payload).digest("base64url");
}

function createTaskDeleteConfirmationToken(task, now = new Date()) {
  const payload = {
    taskId: String(task.taskId || ""),
    confirmText: taskDeletionConfirmText(task),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signTaskDeletePayload(encoded)}`;
}

function verifyTaskDeleteConfirmationToken(token, task, now = new Date()) {
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature || signTaskDeletePayload(encoded) !== signature) return false;
  const payload = parseJsonSafe(Buffer.from(encoded, "base64url"));
  if (!payload) return false;
  if (String(payload.taskId || "") !== String(task.taskId || "")) return false;
  if (String(payload.confirmText || "") !== taskDeletionConfirmText(task)) return false;
  const expiresAt = new Date(payload.expiresAt || "");
  return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() >= now.getTime();
}

function buildTaskDeletePreview(task = {}) {
  const sessions = Array.isArray(task.sessions) ? task.sessions : [];
  const formalSessionCount = sessions.filter((session) => session.sessionType === "formal").length;
  const trialSessionCount = sessions.filter((session) => session.sessionType === "trial").length;
  return {
    taskId: task.taskId || "",
    projectName: task.projectName || task.config?.projectName || "",
    projectCode: taskProjectCode(task),
    requirementRequestId: task.config?.requirementRequestId || task.config?.initialRequirementRequestId || "",
    requiredConfirmText: taskDeletionConfirmText(task),
    formalSessionCount,
    trialSessionCount,
    sessionCount: sessions.length,
    sessions: sessions.map((session) => ({
      sessionId: session.session_id || session.sessionId || "",
      sessionName: session.session_name || session.sessionName || "",
      sessionType: session.sessionType || session.session_type || "",
    })),
    impacts: [
      "从项目管理和考试列表移除此项目",
      "同步删除易考正式/试考场次",
      "停用关联微信群采集任务",
    ],
  };
}

async function handleTaskDeletePreview(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  return json(res, 200, {
    ok: true,
    preview: buildTaskDeletePreview(task),
    confirmationToken: createTaskDeleteConfirmationToken(task),
  });
}

async function handleTaskHide(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  const payload = parseJsonSafe(await readBody(req)) || {};
  if (!verifyTaskDeleteConfirmationToken(payload.confirmationToken, task)) {
    return badRequest(res, "确认信息已过期或不匹配，请重新打开删除预览。");
  }
  if (String(payload.confirmText || "").trim() !== taskDeletionConfirmText(task)) {
    return badRequest(res, "请先输入项目编码或项目名称确认删除。");
  }
  const login = getYikaoLoginForRequest(req);
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
  const wechatCleanup = await disableWechatGroupsForDeletedTask({
    configPath: wechatGroupConfigPath,
    task,
  });
  return json(res, 200, {
    ok: true,
    deleted: true,
    taskId,
    deletedSessionIds: deletion.deletedSessionIds,
    disabledWechatGroupNames: wechatCleanup.disabledGroups,
    logs,
  });
}

function operationBatchDraftOverridesFromTask(task = {}) {
  const fields = task.config?.operationBatch?.draft?.fields || {};
  return {
    fields: Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, item?.value || ""])),
  };
}

async function handleOperationBatchDraft(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  const payload = req.method === "POST" ? (parseJsonSafe(await readBody(req)) || {}) : operationBatchDraftOverridesFromTask(task);
  const draft = buildOperationBatchDraft(task, payload);
  if (req.method !== "POST") {
    return json(res, 200, { ok: true, draft, task });
  }
  const current = task.config?.operationBatch || {};
  const operationBatch = {
    ...current,
    status: current.status || "draft",
    draft,
    updatedAt: new Date().toISOString(),
  };
  const updated = await runTaskState("update_config", { taskId, config: { operationBatch } });
  return json(res, 200, { ok: true, draft, task: updated });
}

async function handleOperationBatchCreate(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  const existingOperationBatchCode = task.config?.operationBatchCode || task.config?.operationBatch?.code || "";
  if (existingOperationBatchCode) {
    return json(res, 200, {
      ok: true,
      task,
      operationBatch: task.config?.operationBatch || {},
      operationBatchCode: existingOperationBatchCode,
      skipped: "operation_batch_already_created",
    });
  }
  if (process.env.OPERATION_CONSOLE_AUTOMATION_ENABLED !== "1") {
    return json(res, 409, {
      error: "运营控制台浏览器自动化未启用。请先确认测试环境已登录，并设置 OPERATION_CONSOLE_AUTOMATION_ENABLED=1 后重启服务。",
    });
  }
  const payload = parseJsonSafe(await readBody(req)) || operationBatchDraftOverridesFromTask(task);
  const draft = buildOperationBatchDraft(task, payload);
  const missing = (draft.warnings || []).map((item) => item.message).filter(Boolean);
  if (missing.length) {
    return badRequest(res, `批次草稿仍有缺失字段：${missing.join("；")}`);
  }
  const current = task.config?.operationBatch || {};
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
  try {
    const created = await runOperationBatchCreation(draft, {
      baseUrl: process.env.OPERATION_CONSOLE_BASE_URL,
      userDataDir: process.env.OPERATION_CONSOLE_USER_DATA_DIR,
      allowTaskMismatch: process.env.OPERATION_CONSOLE_ALLOW_TEST_TASK_MISMATCH === "1",
    });
    const freshTask = await runTaskState("get", { taskId });
    const patch = applyOperationBatchResult(freshTask, created);
    const updated = await runTaskState("update_config", { taskId, config: patch });
    return json(res, 200, { ok: true, task: updated, operationBatch: updated.config?.operationBatch || {}, operationBatchCode: updated.config?.operationBatchCode || "" });
  } catch (error) {
    const failedTask = await runTaskState("get", { taskId });
    const failedCurrent = failedTask.config?.operationBatch || {};
    const updated = await runTaskState("update_config", {
      taskId,
      config: {
        operationBatch: {
          ...failedCurrent,
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          updatedAt: new Date().toISOString(),
        },
      },
    });
    return json(res, 500, { error: error instanceof Error ? error.message : String(error), task: updated });
  }
}

async function handleOperationBatchResult(taskId, req, res) {
  const task = await runTaskState("get", { taskId });
  if (!task || !visibleByOwner(auth, req, task)) return notFound(res);
  const payload = parseJsonSafe(await readBody(req)) || {};
  let patch;
  try {
    patch = applyOperationBatchResult(task, payload);
  } catch (error) {
    return badRequest(res, error instanceof Error ? error.message : String(error));
  }
  const updated = await runTaskState("update_config", { taskId, config: patch });
  return json(res, 200, { ok: true, task: updated, operationBatch: updated.config?.operationBatch || {}, operationBatchCode: updated.config?.operationBatchCode || "" });
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
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(emailSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
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

async function updatePaperFormBindState(taskId, status, patch = {}) {
  const now = new Date().toISOString();
  const currentTask = await runTaskState("get", { taskId });
  const current = currentTask?.config?.paperFormBind || {};
  const logs = Array.isArray(current.logs) ? current.logs.slice() : [];
  const message = String(patch.message || "").trim();
  if (message) logs.push({ time: now, message });
  const next = {
    ...current,
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
  await runTaskState("update_config", { taskId, config: { paperFormBind: next } });
  return await runTaskState("get", { taskId });
}

async function handleTaskStepRetry(taskId, stepKey, req, res) {
  const visibleTask = await runTaskState("get", { taskId });
  if (!visibleTask || !visibleByOwner(auth, req, visibleTask)) return notFound(res);
  if (stepKey === "paper_bind") {
    const task = visibleTask;

    const formalSession = (task.sessions || []).find((session) => session.sessionType === "formal");
    const courses = normalizeCourseRecords(task.config || {});
    const login = getYikaoLoginForRequest(req);
    const apiBase = normalizeApiBase(process.env.YIKAO_API_BASE || login.apiBase || "https://eztest.cn");
    const retryLogs = [];
    const emitLog = (message) => retryLogs.push(message);

    await updateTaskStep(taskId, stepKey, "running", {
      incrementRetry: true,
      message: "开始单独重试正式场次绑定科目，不重新创建场次或科目",
    });
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
      });
      return json(res, 200, updated);
    } catch (error) {
      await updateTaskStep(taskId, stepKey, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
        message: [...retryLogs, error instanceof Error ? error.message : String(error)].filter(Boolean).join("\n"),
      });
      throw error;
    }
  }

  if (stepKey === "paper_form_bind") {
    const task = visibleTask;
    const formalSession = (task.sessions || []).find((session) => session.sessionType === "formal");
    const courses = normalizeCourseRecords(task.config || {});
    const login = getYikaoLoginForRequest(req);
    const apiBase = normalizeApiBase(process.env.YIKAO_API_BASE || login.apiBase || "https://eztest.cn");
    const paperLogs = [];
    const emitLog = (message) => paperLogs.push(message);

    await updatePaperFormBindState(taskId, "running", {
      message: "开始试卷绑定，不修改场次科目绑定结果",
    });
    try {
      const bindResult = await bindPapersToFormalSession({
        login,
        apiBase,
        sessionId: formalSession?.session_id,
        courses,
        requestJson: readTenantJsonWithLogin,
        emitLog,
      });
      if (bindResult.status === "waiting_manual") {
        const missingCourseCodes = bindResult.missingCourseCodes || [];
        const errorMessage = `缺少试卷编号，无法绑定试卷：${missingCourseCodes.join("、") || "未获取到试卷 code"}`;
        const updated = await updatePaperFormBindState(taskId, "failed", {
          errorMessage,
          message: [...paperLogs, errorMessage].filter(Boolean).join("\n"),
          result: { sessionId: formalSession?.session_id, courseCount: courses.length, bindResult, missingCourseCodes },
        });
        return json(res, 409, updated);
      }
      const updated = await updatePaperFormBindState(taskId, "success", {
        message: paperLogs.join("\n") || "试卷绑定成功",
        result: { sessionId: formalSession?.session_id, courseCount: courses.length, bindResult },
      });
      return json(res, 200, updated);
    } catch (error) {
      const message = [...paperLogs, error instanceof Error ? error.message : String(error)].filter(Boolean).join("\n");
      const updated = await updatePaperFormBindState(taskId, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
        message,
      });
      return json(res, error?.status && Number(error.status) >= 400 ? Number(error.status) : 500, updated);
    }
  }

  if (stepKey === "trial_paper_bind") {
    const task = visibleTask;
    const trialSession = (task.sessions || []).find((session) => session.sessionType === "trial");
    const login = getYikaoLoginForRequest(req);
    const apiBase = normalizeApiBase(process.env.YIKAO_API_BASE || login.apiBase || "https://eztest.cn");
    const trialPaperLogs = [];
    const emitLog = (message) => trialPaperLogs.push(message);

    await updateTaskStep(taskId, stepKey, "running", {
      incrementRetry: true,
      message: "开始重试试考默认试卷绑定",
    });
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
        });
        return json(res, 409, updated);
      }
      const updated = await updateTaskStep(taskId, stepKey, "success", {
        message: trialPaperLogs.join("\n") || "试考默认试卷绑定重试成功",
        result: { sessionId: trialSession?.session_id, bindResult },
      });
      return json(res, 200, updated);
    } catch (error) {
      await updateTaskStep(taskId, stepKey, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
        message: [...trialPaperLogs, error instanceof Error ? error.message : String(error)].filter(Boolean).join("\n"),
      });
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
      return await handleEmailSettings(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/email/test") {
      return await handleEmailTest(req, res);
    }
    if (url.pathname === "/api/customer-service-scheduler" || url.pathname.startsWith("/api/customer-service-scheduler/")) {
      const handled = await handleCustomerServiceScheduler(req, res, url);
      if (handled !== false) return;
    }
    if (req.method === "POST" && url.pathname === "/api/import") {
      return await handleImport(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/project-intake/business-screenshot") {
      return await handleProjectIntakeScreenshot(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/project-intake/projects") {
      return await handleProjectIntakeCreate(req, res);
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
      return await handleOperationConsoleEnvironmentInstall(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/operation-console/environment/enable") {
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
    const operationBatchCreateMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-batch\/create$/);
    if (req.method === "POST" && operationBatchCreateMatch) {
      return await handleOperationBatchCreate(decodeURIComponent(operationBatchCreateMatch[1]), req, res);
    }
    const operationBatchResultMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-batch\/result$/);
    if (req.method === "POST" && operationBatchResultMatch) {
      return await handleOperationBatchResult(decodeURIComponent(operationBatchResultMatch[1]), req, res);
    }
    const contentRequirementEmailMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/content-requirement-email$/);
    if (req.method === "POST" && contentRequirementEmailMatch) {
      return await handleContentRequirementEmail(decodeURIComponent(contentRequirementEmailMatch[1]), req, res);
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
    const taskDeletePreviewMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/delete-preview$/);
    if (req.method === "POST" && taskDeletePreviewMatch) {
      return await handleTaskDeletePreview(decodeURIComponent(taskDeletePreviewMatch[1]), req, res);
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
