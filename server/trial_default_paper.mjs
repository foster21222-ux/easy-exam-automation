const DEFAULT_TRIAL_COURSE_CODE = "SKTY";
const DEFAULT_TRIAL_COURSE_NAME = "试考";
const DEFAULT_TRIAL_BINDING_MESSAGE = "试考试卷绑定参数不合法，请检查 session_id / course_code / form_codes";

function compactBody(value) {
  if (value === undefined || value === null || value === "") return "";
  return typeof value === "string" ? value.slice(0, 1000) : JSON.stringify(value).slice(0, 1000);
}

function normalizeFormCodes(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object") return String(item.code || item.form_code || item.formCode || "").trim();
        return String(item || "").trim();
      })
      .filter(Boolean);
  }
  return String(value || "")
    .split(/[\s,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unwrapCourseDetail(payload) {
  const candidates = [payload?.data, payload?.course, payload];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate[0] || {};
    if (candidate && typeof candidate === "object") return candidate;
  }
  return {};
}

function extractDefaultTrialCourse(payload) {
  const course = unwrapCourseDetail(payload);
  const formLists = [
    course?.res,
    course?.results,
    course?.forms,
    course?.form_codes,
    course?.formCodes,
    course?.data?.res,
    course?.data?.results,
    course?.data?.form_codes,
    course?.data?.formCodes,
  ];
  return {
    name: String(course?.name || course?.course_name || DEFAULT_TRIAL_COURSE_NAME).trim(),
    code: String(course?.code || course?.course_code || DEFAULT_TRIAL_COURSE_CODE).trim(),
    formCodes: Array.from(new Set(formLists.flatMap((value) => normalizeFormCodes(value)))),
  };
}

async function fetchDefaultTrialCourse({ login, apiBase, requestJson, emitLog }) {
  const path = `/tenant/api/courses/${encodeURIComponent(DEFAULT_TRIAL_COURSE_CODE)}/?apply=form`;
  emitLog(`[试考默认卷] GET ${path}`);
  const detail = await requestJson(login, `${apiBase}${path}`, { method: "GET" }, `查询默认试考科目 ${DEFAULT_TRIAL_COURSE_CODE}`);
  emitLog(`[试考默认卷] 科目详情 responseBody = ${compactBody(detail)}`);
  return extractDefaultTrialCourse(detail);
}

async function createDefaultTrialCourse({ login, apiBase, requestJson, emitLog }) {
  const path = "/tenant/api/course/";
  const payload = {
    name: DEFAULT_TRIAL_COURSE_NAME,
    code: DEFAULT_TRIAL_COURSE_CODE,
    form_codes: [],
  };
  emitLog(`[试考默认卷] POST ${path}`);
  emitLog(`[试考默认卷] payload = ${JSON.stringify(payload)}`);
  const result = await requestJson(
    login,
    `${apiBase}${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    `创建默认试考科目 ${DEFAULT_TRIAL_COURSE_CODE}`,
  );
  emitLog(`[试考默认卷] 默认试考科目创建成功：${DEFAULT_TRIAL_COURSE_NAME}/${DEFAULT_TRIAL_COURSE_CODE}`);
  return {
    name: String(result?.name || DEFAULT_TRIAL_COURSE_NAME).trim(),
    code: String(result?.code || result?.course_code || DEFAULT_TRIAL_COURSE_CODE).trim(),
  };
}

async function ensureDefaultTrialCourse({
  login,
  apiBase,
  requestJson,
  emitLog = () => {},
}) {
  try {
    const course = await fetchDefaultTrialCourse({ login, apiBase, requestJson, emitLog });
    emitLog(`[试考默认卷] 已找到默认试考科目：${course.name}/${course.code}`);
    return course;
  } catch (error) {
    if (error?.status !== 404) throw error;
    emitLog(`[试考默认卷] 未找到默认试考科目 ${DEFAULT_TRIAL_COURSE_CODE}，开始创建`);
    return await createDefaultTrialCourse({ login, apiBase, requestJson, emitLog });
  }
}

function validateDefaultTrialBinding({ sessionId, courseCode, formCodes }) {
  const normalizedSessionId = typeof sessionId === "number" ? String(sessionId) : sessionId;
  if (typeof normalizedSessionId !== "string" || !normalizedSessionId.trim()) {
    throw new Error(DEFAULT_TRIAL_BINDING_MESSAGE);
  }
  if (typeof courseCode !== "string" || !courseCode.trim()) {
    throw new Error(DEFAULT_TRIAL_BINDING_MESSAGE);
  }
  const normalizedFormCodes = normalizeFormCodes(formCodes);
  if (!normalizedFormCodes.length) {
    return null;
  }
  return {
    sessionId: normalizedSessionId.trim(),
    courseCode: courseCode.trim(),
    formCodes: normalizedFormCodes,
  };
}

async function postDefaultTrialPaperBinding({ login, apiBase, binding, requestJson, emitLog }) {
  const path = `/tenant/api/course/session/${encodeURIComponent(binding.sessionId)}/`;
  const payload = {
    course_code: binding.courseCode,
    form_codes: binding.formCodes,
  };

  emitLog(`[试考默认卷] POST ${path}`);
  emitLog(`[试考默认卷] payload = ${JSON.stringify(payload)}`);
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
      `绑定默认试考卷到试考场次 ${binding.sessionId}`,
    );
    const httpStatus = responseBody?.__tenantResponse ? responseBody.httpStatus : 200;
    const body = responseBody?.__tenantResponse ? responseBody.body : responseBody;
    emitLog(`[试考默认卷] httpStatus = ${httpStatus}`);
    emitLog(`[试考默认卷] responseBody = ${compactBody(body)}`);
    return { ...payload, responseBody: body };
  } catch (error) {
    emitLog(`[试考默认卷] httpStatus = ${error?.status || "未知"}`, "warning");
    emitLog(`[试考默认卷] responseBody = ${compactBody(error?.detail)}`, "warning");
    if (error?.status === 400) {
      const bindingError = new Error(DEFAULT_TRIAL_BINDING_MESSAGE);
      bindingError.status = error.status;
      bindingError.detail = error.detail;
      throw bindingError;
    }
    throw error;
  }
}

async function bindDefaultTrialPaperToSession({
  login,
  apiBase,
  sessionId,
  requestJson,
  emitLog = () => {},
}) {
  emitLog(`[试考默认卷] 开始绑定默认试考卷，session_id=${sessionId || ""}`);
  const course = await ensureDefaultTrialCourse({ login, apiBase, requestJson, emitLog });
  const binding = validateDefaultTrialBinding({
    sessionId,
    courseCode: course.code || DEFAULT_TRIAL_COURSE_CODE,
    formCodes: course.formCodes || [],
  });
  if (!binding) {
    emitLog(`[试考默认卷] 默认试考科目 ${DEFAULT_TRIAL_COURSE_CODE} 未关联试卷，等待人工关联`, "warning");
    return { status: "waiting_manual", missingCourseCodes: [DEFAULT_TRIAL_COURSE_CODE] };
  }

  const response = await postDefaultTrialPaperBinding({ login, apiBase, binding, requestJson, emitLog });
  emitLog("[试考默认卷] 试考试卷绑定完成");
  return {
    status: "success",
    results: [{
      session_id: binding.sessionId,
      course_name: course.name || DEFAULT_TRIAL_COURSE_NAME,
      course_code: binding.courseCode,
      form_codes: binding.formCodes,
      responseBody: response.responseBody,
    }],
  };
}

export {
  DEFAULT_TRIAL_BINDING_MESSAGE,
  DEFAULT_TRIAL_COURSE_CODE,
  DEFAULT_TRIAL_COURSE_NAME,
  bindDefaultTrialPaperToSession,
  ensureDefaultTrialCourse,
};
