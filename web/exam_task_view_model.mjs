const STATUS_PRIORITY = {
  failed: 5,
  running: 4,
  waiting_manual: 3,
  success: 2,
  pending: 1,
};

function aggregateStatus(sessions) {
  const statuses = sessions.map((session) => session.status || "pending");
  if (sessions.length && statuses.every((status) => status === "success")) return "success";
  return statuses.reduce(
    (selected, status) =>
      (STATUS_PRIORITY[status] || 1) > (STATUS_PRIORITY[selected] || 1) ? status : selected,
    "pending",
  );
}

function parseExamTime(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const normalized = String(value).trim().replace(/\//g, "-").replace(" ", "T");
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function resolveTaskProgress(sessions) {
  const session = sessions.find((item) => Number.isFinite(Number(item?.progress)));
  return session ? Number(session.progress) : 0;
}

function textValue(value) {
  return String(value ?? "").trim();
}

export function unifiedExamCodeFromUrl(value) {
  const match = textValue(value).match(/\/exam\/(\d+)\/uniform\/login\/?/i);
  return match ? `E${match[1]}` : "";
}

export function isUnifiedExamAddress(taskOrSession = {}) {
  const config = taskOrSession.config || {};
  const addressText = textValue(config.examAddress || config.examUrlType);
  if (addressText.includes("独立")) return false;
  if (addressText.includes("统一")) return true;
  if (config.unifiedExamAddress !== undefined) return Boolean(config.unifiedExamAddress);
  return Boolean(
    unifiedExamCodeFromUrl(taskOrSession.url) ||
      unifiedExamCodeFromUrl(config.examUrl) ||
      config.unifiedExamCode ||
      config.unifiedExamPassword ||
      taskOrSession.unified_exam_code ||
      taskOrSession.unifiedExamCode,
  );
}

export function resolveUnifiedExamCode(taskOrSession = {}) {
  const config = taskOrSession.config || {};
  const urlCode = unifiedExamCodeFromUrl(taskOrSession.url) || unifiedExamCodeFromUrl(config.examUrl);
  if (urlCode) return urlCode;

  const explicitUnifiedCode = textValue(
    config.unifiedExamCode ||
      config.unifiedExamPassword ||
      taskOrSession.unified_exam_code ||
      taskOrSession.unifiedExamCode,
  );
  if (explicitUnifiedCode) return explicitUnifiedCode;
  if (!isUnifiedExamAddress(taskOrSession)) return "";

  return textValue(
      config.examPassword ||
      config.examCode ||
      taskOrSession.exam_code ||
      taskOrSession.examCode,
  );
}

export function isExamTaskEnded(task, now = new Date()) {
  const formalSession = task?.formalSession || (task?.sessions || []).find((session) => session.sessionType === "formal") || null;
  if (!formalSession) return false;
  const endTime = parseExamTime(formalSession.end);
  const startTime = parseExamTime(formalSession.start);
  const comparisonTime = Number.isFinite(endTime) ? endTime : startTime;
  return Number.isFinite(comparisonTime) && comparisonTime < now.getTime();
}

export function aggregateExamSessions(sessions = []) {
  const tasks = new Map();
  for (const session of sessions) {
    if (!session?.taskId) continue;
    if (!tasks.has(session.taskId)) {
      tasks.set(session.taskId, {
        taskId: session.taskId,
        projectName: session.projectName || session.name || "未命名考试",
        sourceAccount: session.sourceAccount || "",
        config: session.config || {},
        sessions: [],
      });
    }
    const task = tasks.get(session.taskId);
    if (!Object.keys(task.config || {}).length && session.config) task.config = session.config;
    task.sessions.push(session);
  }
  return [...tasks.values()]
    .map((task, index) => {
      const formalSession = task.sessions.find((session) => session.sessionType === "formal") || null;
      return {
        ...task,
        formalSession,
        trialSession: task.sessions.find((session) => session.sessionType === "trial") || null,
        status: aggregateStatus(task.sessions),
        progress: resolveTaskProgress(task.sessions),
        unifiedExamCode: resolveUnifiedExamCode(task) || task.sessions.map(resolveUnifiedExamCode).find(Boolean) || "",
        sortIndex: index,
      };
    })
    .sort((left, right) => {
      const leftTime = parseExamTime(left.formalSession?.start);
      const rightTime = parseExamTime(right.formalSession?.start);
      if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) return left.sortIndex - right.sortIndex;
      if (!Number.isFinite(leftTime)) return 1;
      if (!Number.isFinite(rightTime)) return -1;
      return rightTime - leftTime || left.sortIndex - right.sortIndex;
    })
    .map(({ sortIndex, ...task }) => task);
}

export function matchesExamTask(task, query = "") {
  const normalized = String(query).trim().toLowerCase();
  if (!normalized) return true;
  return [
    task.projectName,
    task.sourceAccount,
    ...task.sessions.flatMap((session) => [session.name, session.session_id]),
  ].some((value) => String(value || "").toLowerCase().includes(normalized));
}

export function resolveCandidateTaskContext(task, requestedSessionId = "") {
  const selectedSession = (task?.sessions || []).find(
    (session) =>
      ["formal", "trial"].includes(session.sessionType) &&
      String(session.session_id || "").trim() &&
      String(session.session_id) === String(requestedSessionId),
  ) || null;
  return {
    sessions: selectedSession ? [selectedSession] : [],
    selectedSession,
  };
}
