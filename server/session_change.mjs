import path from "node:path";

const fieldLabels = {
  name: "场次名称",
  start: "开始时间",
  end: "结束时间",
  early: "提前登录分钟",
  later: "迟到限制分钟",
  message: "欢迎语",
  notice: "登录提示",
};

export const allowedSessionChangeFields = ["name", "start", "end", "early", "later", "message", "notice"];
const allowedSet = new Set(allowedSessionChangeFields);
const putSessionFieldSet = new Set([
  "name",
  "start",
  "end",
  "forms",
  "allow_anonymous",
  "unified_exam_address",
  "face_detection",
  "face_detection_dur",
  "face_detection_review",
  "police_detection",
  "police_detection_after",
  "app_required",
  "publish_permit",
  "ip_white_list",
  "public_score",
  "show_score_detail",
  "publish_score",
  "send_result_email",
  "manual_score",
  "new_mark",
  "practice_mode",
  "monitor",
  "monitor_replay",
  "anonymous_monitor",
  "audio_monitor",
  "eagle_eye",
  "watermark",
  "copy_item_unable",
  "message",
  "notice",
  "nda",
  "nda_notice",
  "personal",
  "save_video",
  "early",
  "later",
  "client_required",
  "lock_screen",
  "exclusive_network",
  "login_times",
  "auto_add_time",
  "later_deduction",
]);

export function featureEnabledForRuntime(runtimeDir, env = process.env) {
  return env.SESSION_CHANGE_ENABLED === "1" || path.basename(String(runtimeDir || "")) === ".easy_exam_runtime_test";
}

function text(value) {
  return String(value ?? "").trim();
}

function parseDateLike(value) {
  const raw = text(value);
  if (!raw) return Number.NaN;
  const time = Date.parse(raw.replace(/\//g, "-").replace(" ", "T"));
  return Number.isFinite(time) ? time : Number.NaN;
}

function normalizeMinute(value, field, errors) {
  if (value === "" || value === null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    errors.push(`${fieldLabels[field]}不能为负数或非数字`);
    return undefined;
  }
  return Math.floor(num);
}

export function validateSessionChangeRequest(rawChanges = {}) {
  const changes = {};
  const errors = [];
  const source = rawChanges && typeof rawChanges === "object" && !Array.isArray(rawChanges) ? rawChanges : {};

  for (const field of Object.keys(source)) {
    if (!allowedSet.has(field)) errors.push(`不支持修改字段：${field}`);
  }
  if (errors.length) return { ok: false, errors, changes: {} };

  for (const field of allowedSessionChangeFields) {
    if (!Object.hasOwn(source, field)) continue;
    if (field === "early" || field === "later") {
      const value = normalizeMinute(source[field], field, errors);
      if (value !== undefined) changes[field] = value;
      continue;
    }
    changes[field] = text(source[field]);
  }

  if (Object.hasOwn(changes, "name") && !changes.name) errors.push("场次名称不能为空");
  if (Object.hasOwn(changes, "start")) {
    const startTime = parseDateLike(changes.start);
    if (!Number.isFinite(startTime)) errors.push("开始时间格式不正确");
  }
  if (Object.hasOwn(changes, "end")) {
    const endTime = parseDateLike(changes.end);
    if (!Number.isFinite(endTime)) errors.push("结束时间格式不正确");
  }
  if (Object.hasOwn(changes, "start") && Object.hasOwn(changes, "end")) {
    const startTime = parseDateLike(changes.start);
    const endTime = parseDateLike(changes.end);
    if (Number.isFinite(startTime) && Number.isFinite(endTime) && endTime <= startTime) {
      errors.push("结束时间必须晚于开始时间");
    }
  }

  return { ok: errors.length === 0, errors, changes };
}

export function editableSessionFieldsFromDetail(detail = {}) {
  return Object.fromEntries(allowedSessionChangeFields.map((field) => [field, detail[field] ?? ""]));
}

export function localSessionFieldsForChange(session = {}) {
  return {
    name: session.name ?? "",
    start: session.start ?? "",
    end: session.end ?? "",
    early: session.early ?? "",
    later: session.later ?? "",
    message: session.message ?? "",
    notice: session.notice ?? "",
  };
}

export function sessionChangeBasePayloadFromTask(task = {}, session = {}) {
  const config = task?.config || {};
  const common = task?.config?.sessionChangeBase || {};
  return {
    ...common,
    name: session.name ?? "",
    start: session.start ?? "",
    end: session.end ?? "",
    personal: common.personal || config.personal || {},
    ...(session.message !== undefined && session.message !== "" ? { message: session.message } : {}),
    ...(session.notice !== undefined && session.notice !== "" ? { notice: session.notice } : {}),
    ...(session.early !== undefined && session.early !== "" ? { early: session.early } : {}),
    ...(session.later !== undefined && session.later !== "" ? { later: session.later } : {}),
  };
}

export function mergeSessionChangePayload(original = {}, changes = {}) {
  const source = original && typeof original === "object" && !Array.isArray(original) ? original : {};
  const payload = {};
  for (const [field, value] of Object.entries(source)) {
    if (putSessionFieldSet.has(field)) payload[field] = value;
  }
  for (const field of ["name", "start", "end"]) {
    if (!Object.hasOwn(payload, field)) payload[field] = "";
  }
  for (const field of allowedSessionChangeFields) {
    if (!Object.hasOwn(changes, field)) continue;
    if ((field === "early" || field === "later") && changes[field] === null) {
      delete payload[field];
      continue;
    }
    payload[field] = changes[field];
  }
  return payload;
}

export function buildSessionChangeDiff(before = {}, after = {}) {
  const rows = [];
  for (const field of allowedSessionChangeFields) {
    const oldValue = before[field] ?? "";
    const newValue = after[field] ?? "";
    if (String(oldValue) === String(newValue)) continue;
    rows.push({ field, label: fieldLabels[field], before: oldValue, after: newValue });
  }
  return rows;
}

export function sessionChangeSummary(body) {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.info !== undefined ? { info: body.info } : {}),
      ...(body.error !== undefined ? { error: body.error } : {}),
      ...(body.detail !== undefined && typeof body.detail !== "object" ? { detail: body.detail } : {}),
    };
  }
  return { bodyType: typeof body, body: String(body ?? "").slice(0, 500) };
}

export function appendSessionChangeHistory(existing = [], record = {}) {
  const base = Array.isArray(existing) ? existing : [];
  const sessionType = String(record.sessionType || "");
  const item = {
    id: record.id || `${record.sessionId || "session"}-${Date.now()}`,
    changedAt: record.changedAt || new Date().toISOString(),
    operator: record.operator || "",
    sessionId: String(record.sessionId || ""),
    sessionType,
    sessionLabel: sessionType === "formal" ? "正式考试" : sessionType === "trial" ? "试考" : "场次",
    apiBase: record.apiBase || "",
    status: record.status || "success",
    tenantStatus: record.tenantStatus ?? "",
    verifyStatus: record.verifyStatus ?? "",
    diff: Array.isArray(record.diff) ? record.diff : [],
    tenantResponseSummary: record.tenantResponseSummary || {},
    verifiedSession: record.verifiedSession || null,
    warning: record.warning || null,
  };
  return [item, ...base].slice(0, 50);
}

export function sessionChangeHistoryFromStep(step = {}) {
  if (Array.isArray(step?.result?.history) && step.result.history.length) return step.result.history;
  if (!Array.isArray(step?.result?.diff) || !step.result.diff.length) return [];
  return appendSessionChangeHistory([], {
    id: `${step.result.sessionId || "session"}-legacy`,
    changedAt: step.completedAt || step.startedAt || "",
    operator: step.result.operator || "",
    sessionId: step.result.sessionId || "",
    sessionType: step.result.sessionType || "",
    apiBase: step.result.apiBase || "",
    status: step.status || "success",
    tenantStatus: step.result.tenantStatus || 200,
    verifyStatus: step.result.verifyStatus || "",
    diff: step.result.diff,
    tenantResponseSummary: step.result.tenantResponseSummary || {},
    verifiedSession: step.result.verifiedSession || null,
  });
}

export function tenantSessionChangeErrorMessage(error = {}) {
  const status = Number(error?.status || 0);
  if (status === 401) return "租户 API 返回 401，请检查租户 API Key。";
  if (status === 403) return "租户 API 返回 403，场次不存在、不属于当前租户，或当前 Key 无权限修改。";
  if (status === 429) return "租户 API 返回 429，请稍后重试。";
  return `租户 API 修改场次失败：${status || "未知"}`;
}

export async function fetchTenantSessionDetail({ apiBase, sessionId, requestJson, login }) {
  const base = String(apiBase || "").replace(/\/+$/, "");
  return await requestJson(
    login,
    `${base}/tenant/api/session/${encodeURIComponent(sessionId)}/`,
    { method: "GET" },
    `读取场次详情 ${sessionId}`,
  );
}

export async function putTenantSessionDetail({ apiBase, sessionId, payload, requestJson, login }) {
  const base = String(apiBase || "").replace(/\/+$/, "");
  return await requestJson(
    login,
    `${base}/tenant/api/session/${encodeURIComponent(sessionId)}/`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    `修改场次信息 ${sessionId}`,
  );
}
