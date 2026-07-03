const INVALID_BINDING_MESSAGE = "科目已创建，但绑定参数不合法，请检查 session_id / course_code";

function compactBody(value) {
  if (value === undefined || value === null || value === "") return "";
  return typeof value === "string" ? value.slice(0, 1000) : JSON.stringify(value).slice(0, 1000);
}

function parseSessionDateTime(value) {
  const match = String(value || "").trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{1,2})/);
  if (!match) return null;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
}

function validateSessionPayloadTimes(sessionPayloads = [], now = new Date()) {
  for (const item of sessionPayloads) {
    const payload = item?.payload || {};
    const end = parseSessionDateTime(payload.end);
    if (!end || end > now) continue;
    const kindName = item?.kind === "mock" ? "试考" : "正式考试";
    throw new Error(
      `${kindName}时间已结束：${payload.name || kindName} ${payload.start || ""} - ${payload.end || ""}`,
    );
  }
}

export async function createSessionsThenConfigureCourses({
  sessionPayloads,
  createSession,
  configureCourses,
  now,
}) {
  const created = [];
  const formalIndex = sessionPayloads.findIndex((item) => item?.kind === "main");
  if (formalIndex < 0) {
    throw new Error("未找到正式考试创建参数");
  }
  validateSessionPayloadTimes(sessionPayloads, now || new Date());
  const formalSession = await createSession(sessionPayloads[formalIndex], formalIndex);
  created.push(formalSession);
  if (!formalSession?.id) {
    throw new Error("未获取正式考试 session_id，无法创建和绑定科目");
  }
  for (const [index, item] of sessionPayloads.entries()) {
    if (index === formalIndex) continue;
    created.push(await createSession(item, index));
  }
  await configureCourses(formalSession);
  return created;
}

export function validateCourseBinding({ sessionId, courseCode }) {
  const normalizedSessionId = typeof sessionId === "number" ? String(sessionId) : sessionId;
  if (typeof normalizedSessionId !== "string" || !normalizedSessionId.trim()) {
    throw new Error(INVALID_BINDING_MESSAGE);
  }
  if (typeof courseCode !== "string" || !courseCode.trim()) {
    throw new Error(INVALID_BINDING_MESSAGE);
  }
  return {
    sessionId: normalizedSessionId.trim(),
    courseCode: courseCode.trim(),
  };
}

export async function bindCoursesToFormalSession({
  login,
  apiBase,
  sessionId,
  courses,
  requestJson,
  emitLog,
}) {
  if (!Array.isArray(courses) || !courses.length) {
    emitLog("[科目绑定] 未读取到可绑定科目，跳过正式场次科目绑定。", "success");
    return { status: "success", results: [], skipped: true };
  }
  const preparedBindings = [];
  const results = [];

  for (const requestedCourse of courses) {
    const requestedCode = typeof requestedCourse?.code === "string" ? requestedCourse.code.trim() : "";
    if (!requestedCode) throw new Error(INVALID_BINDING_MESSAGE);
    const validated = validateCourseBinding({ sessionId, courseCode: requestedCode });
    preparedBindings.push(validated);
  }

  for (const validated of preparedBindings) {
    const path = `/tenant/api/course/session/${encodeURIComponent(validated.sessionId)}/`;
    const payload = {
      course_code: validated.courseCode,
    };

    emitLog(`[科目绑定] POST ${path}`);
    emitLog(`[科目绑定] HTTP Method = POST`);
    emitLog(`[科目绑定] session_id = ${validated.sessionId}`);
    emitLog(`[科目绑定] payload = ${JSON.stringify(payload)}`);

    try {
      const responseBody = await requestJson(
        login,
        `${apiBase}${path}`,
        {
          method: "POST",
          includeResponseMeta: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        `绑定科目 ${validated.courseCode} 到正式场次 ${validated.sessionId}`,
      );
      const httpStatus = responseBody?.__tenantResponse ? responseBody.httpStatus : 200;
      const body = responseBody?.__tenantResponse ? responseBody.body : responseBody;
      emitLog(`[科目绑定] httpStatus = ${httpStatus}`);
      emitLog(`[科目绑定] responseBody = ${compactBody(body)}`);
      results.push({ ...payload, responseBody: body });
    } catch (error) {
      emitLog(`[科目绑定] httpStatus = ${error?.status || "未知"}`, "warning");
      emitLog(`[科目绑定] responseBody = ${compactBody(error?.detail)}`, "warning");
      if (error?.status === 400) {
        const bindingError = new Error(INVALID_BINDING_MESSAGE);
        bindingError.status = error.status;
        bindingError.detail = error.detail;
        throw bindingError;
      }
      throw error;
    }
  }
  return { status: "success", results };
}

export { INVALID_BINDING_MESSAGE };
