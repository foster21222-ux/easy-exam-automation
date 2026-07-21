const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeApiBase(value = "https://eztest.cn") {
  return String(value || "https://eztest.cn").replace(/\/+$/, "");
}

export function normalizeTenantSessions(payload) {
  const candidates = [
    payload?.results,
    payload?.sessions,
    payload?.data?.results,
    payload?.data?.sessions,
    payload?.data?.list,
    payload?.list,
    payload?.data,
    payload,
  ];
  const list = candidates.find((item) => Array.isArray(item)) || [];
  return list
    .map((item) => normalizeTenantSession(item))
    .filter((item) => item.id);
}

export function normalizeTenantSession(item = {}) {
  const id = String(item.id ?? item.session_id ?? item.sessionId ?? "").trim();
  return {
    ...item,
    id,
    start: item.start ?? item.start_time ?? item.startTime,
    end: item.end ?? item.end_time ?? item.endTime,
    config: item.config && typeof item.config === "object" && !Array.isArray(item.config) ? item.config : {},
    extra: item.extra && typeof item.extra === "object" && !Array.isArray(item.extra) ? item.extra : {},
  };
}

export function parseSessionTime(value) {
  if (value === null || value === undefined || value === "") return NaN;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return parseSessionTime(Number(text));
  const normalized = text.replace(
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/,
    (_all, year, month, day, hour, minute, second = "00") =>
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`,
  );
  const parsed = Date.parse(normalized.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function decideCustomerServiceAction(session, now = Date.now()) {
  const startMs = parseSessionTime(session?.start);
  const endMs = parseSessionTime(session?.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { action: "skip_missing_time", desiredEnabled: null };
  }
  if (now < startMs - DAY_MS) return { action: "skip_before_window", desiredEnabled: null };
  const currentEnabled = session?.config?.customer_service === true || session?.extra?.open_talk === true;
  const desiredEnabled = now < endMs;
  if (!desiredEnabled) return { action: "disable", desiredEnabled };
  if (currentEnabled === desiredEnabled) return { action: "skip_already_correct", desiredEnabled };
  return { action: desiredEnabled ? "enable" : "disable", desiredEnabled };
}

export async function runCustomerServiceScheduler({
  apiBase = "https://eztest.cn",
  apiKey,
  login = {},
  now = Date.now(),
  fetchImpl = fetch,
  dryRun = false,
  logger = console.log,
} = {}) {
  if (!apiKey) throw new Error("YIKAO_API_KEY or tenant API key is required");
  const summary = { total: 0, planned: 0, updated: 0, skipped: 0, failed: 0 };
  const sessions = await listTenantSessions({ apiBase, apiKey, fetchImpl });
  summary.total = sessions.length;
  const actions = [];

  for (const item of sessions) {
    const decision = decideCustomerServiceAction(item, now);
    if (!["enable", "disable"].includes(decision.action)) {
      summary.skipped += 1;
      logger(`[客服定时] 跳过 ${item.id}: ${decision.action}`);
      continue;
    }
    summary.planned += 1;
    if (dryRun) {
      logger(`[客服定时] 计划 ${decision.action} ${item.id}`);
      continue;
    }
    actions.push({ item, decision });
  }

  if (dryRun || actions.length === 0) return summary;

  const webBase = normalizeWebBase(login?.url || "https://eztest.org");
  let cookie;
  try {
    cookie = await loginToEasyExamManager({ webBase, login, fetchImpl });
  } catch (error) {
    error.schedulerSummary = { ...summary, failed: 1 };
    error.pauseScheduler = true;
    throw error;
  }
  logger(`[客服定时] 管理端登录成功，本轮复用会话处理 ${actions.length} 个场次`);

  for (const { item, decision } of actions) {
    logger(`[客服定时] 执行 ${decision.action} ${item.id}`);
    try {
      const updateResult = await updateTenantSessionCustomerService({
        webBase,
        cookie,
        session: item,
        enabled: decision.desiredEnabled,
        fetchImpl,
      });
      if (updateResult?.skipped) {
        summary.skipped += 1;
        logger(`[客服定时] 跳过 ${item.id}: ${updateResult.reason}`);
      } else {
        summary.updated += 1;
      }
    } catch (error) {
      summary.failed += 1;
      logger(`[客服定时] 更新失败 ${item.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return summary;
}

export async function runCustomerServiceSchedulerForTargets({
  targets = [],
  now = Date.now(),
  fetchImpl = fetch,
  dryRun = false,
  logger = console.log,
} = {}) {
  const summary = {
    totalProfiles: targets.length,
    succeededProfiles: 0,
    failedProfiles: 0,
    total: 0,
    planned: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    profiles: [],
  };

  for (const target of targets) {
    try {
      const profileSummary = await runCustomerServiceScheduler({
        apiBase: target.apiBase,
        apiKey: target.apiKey,
        login: target.login || {},
        now,
        fetchImpl,
        dryRun,
        logger: (message) => logger(`[${target.userId || "local"} / ${target.label || target.profileId || "API Key"}] ${message}`),
      });
      summary.succeededProfiles += 1;
      addSchedulerTotals(summary, profileSummary);
      summary.profiles.push({
        userId: target.userId || "",
        profileId: target.profileId || "",
        label: target.label || "",
        keyHint: target.keyHint || "",
        ok: profileSummary.failed === 0,
        ...profileSummary,
      });
    } catch (error) {
      summary.failedProfiles += 1;
      const profileSummary = error?.schedulerSummary || {
        total: 0,
        planned: 0,
        updated: 0,
        skipped: 0,
        failed: 1,
      };
      addSchedulerTotals(summary, profileSummary);
      const message = error instanceof Error ? error.message : String(error);
      logger(`[${target.userId || "local"} / ${target.label || target.profileId || "API Key"}] ${message}`);
      summary.profiles.push({
        userId: target.userId || "",
        profileId: target.profileId || "",
        label: target.label || "",
        keyHint: target.keyHint || "",
        ok: false,
        ...profileSummary,
        paused: error?.pauseScheduler === true,
        error: message,
      });
    }
  }

  return summary;
}

async function listTenantSessions({ apiBase, apiKey, fetchImpl }) {
  const response = await fetchImpl(`${normalizeApiBase(apiBase)}/tenant/api/session/`, {
    headers: tenantHeaders(apiKey),
  });
  const payload = await readJsonResponse(response, "获取场次列表");
  return normalizeTenantSessions(payload);
}

async function updateTenantSessionCustomerService({ webBase, cookie, session, enabled, fetchImpl }) {
  await primeEasyExamSessionContext({ webBase, cookie, session, fetchImpl });
  const currentEnabled = await fetchManagerCustomerServiceState({ webBase, cookie, session, fetchImpl });
  if (currentEnabled === enabled) return { skipped: true, reason: "manager_already_correct" };
  const updateResponse = await fetchImpl(`${webBase}/dapi/schedule/session/${encodeURIComponent(session.id)}/customer/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      Cookie: cookie,
      Origin: webBase,
      Referer: `${webBase}/manager/schedule/session/${encodeURIComponent(session.id)}/`,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({ customer: enabled ? 1 : 0 }),
  });
  await readJsonResponse(updateResponse, "更新在线客服");
  return { skipped: false };
}

function tenantHeaders(apiKey, json = false) {
  return {
    Authorization: `Key ${apiKey}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function readJsonResponse(response, action) {
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const error = new Error(`${action}失败：${response.status}`);
    error.status = response.status;
    error.detail = payload;
    throw error;
  }
  return payload;
}

async function loginToEasyExamManager({ webBase, login = {}, fetchImpl }) {
  const username = String(login.username || "").trim();
  const password = String(login.password || "");
  if (!username || !password) throw new Error("缺少易考后台账号或密码，无法开关在线客服。");
  const loginPayload = username.includes("@")
    ? { email: username, password, remember: false, code: "" }
    : { phone: username, password, remember: false, code: "" };
  const response = await fetchImpl(`${webBase}/dapi/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(loginPayload),
  });
  await readJsonResponse(response, "登录易考后台");
  const cookie = cookieHeaderFromResponse(response);
  if (!cookie) throw new Error("登录易考后台失败：未返回登录 Cookie。");
  return cookie;
}

async function primeEasyExamSessionContext({ webBase, cookie, session, fetchImpl }) {
  const response = await fetchImpl(`${webBase}/dapi/schedule/session/${encodeURIComponent(session.id)}/get_session_detail_count/`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Cookie: cookie,
    },
  });
  await readJsonResponse(response, "初始化易考场次上下文");
}

async function fetchManagerCustomerServiceState({ webBase, cookie, session, fetchImpl }) {
  const response = await fetchImpl(`${webBase}/dapi/schedule/session/${encodeURIComponent(session.id)}/`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Cookie: cookie,
    },
  });
  const payload = await readJsonResponse(response, "读取易考场次详情");
  return payload?.data?.session?.config?.customer_service === true;
}

function normalizeWebBase(value = "https://eztest.org") {
  const text = String(value || "").trim();
  if (!text) return "https://eztest.org";
  try {
    const url = new URL(text);
    return `${url.protocol}//${url.host}`.replace(/\/+$/, "");
  } catch {
    return normalizeApiBase(text).replace("https://eztest.cn", "https://eztest.org");
  }
}

function cookieHeaderFromResponse(response) {
  const raw = response?.headers?.get?.("set-cookie") || response?.headers?.get?.("Set-Cookie") || "";
  if (!raw) return "";
  return String(raw)
    .split(/,(?=[^;,]+=)/)
    .map((item) => item.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function addSchedulerTotals(summary, item) {
  summary.total += item.total || 0;
  summary.planned += item.planned || 0;
  summary.updated += item.updated || 0;
  summary.skipped += item.skipped || 0;
  summary.failed += item.failed || 0;
}
