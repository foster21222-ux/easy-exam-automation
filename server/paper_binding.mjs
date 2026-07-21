const INVALID_PAPER_BINDING_MESSAGE = "试卷绑定参数不合法，请检查 session_id / course_code / form_codes";
const MISSING_FORM_CODES_MESSAGE = "科目已创建成功，但未获取到有效试卷 code，无法绑定到考试场次";

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

function normalizeCourseCode(course) {
  return String(course?.code || course?.course_code || "").trim();
}

function normalizeCourseName(course) {
  return String(course?.name || course?.course_name || course?.title || "").trim();
}

function normalizeCoursePaperName(course) {
  return String(course?.paper_name || course?.paperName || course?.form_name || course?.formName || "").trim();
}

function unwrapCourseDetail(payload) {
  const candidates = [payload?.data, payload?.course, payload];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate[0] || {};
    if (candidate && typeof candidate === "object") return candidate;
  }
  return {};
}

function hasSessionCourseFields(value) {
  return Boolean(
    value?.courses ||
    value?.course_list ||
    value?.courseList ||
    value?.subjects ||
    value?.subject_list ||
    value?.course ||
    value?.data?.courses ||
    value?.data?.course_list ||
    value?.data?.subjects,
  );
}

function unwrapSessionDetail(payload, sessionId) {
  const targetId = String(sessionId || "").trim();
  const directCandidates = [
    payload,
    payload?.data,
    payload?.result,
    payload?.session,
    payload?.detail,
  ].filter((item) => item && typeof item === "object" && !Array.isArray(item));
  for (const item of directCandidates) {
    const itemId = String(item.id ?? item.session_id ?? item.sessionId ?? "").trim();
    if (!targetId || itemId === targetId || (!itemId && hasSessionCourseFields(item))) return item;
  }
  const listCandidates = [
    payload?.results,
    payload?.data?.results,
    payload?.data?.list,
    payload?.list,
    Array.isArray(payload) ? payload : null,
  ];
  for (const candidate of listCandidates) {
    if (!Array.isArray(candidate)) continue;
    const match = candidate.find((item) => {
      const itemId = String(item?.id ?? item?.session_id ?? item?.sessionId ?? "").trim();
      return itemId === targetId;
    });
    if (match) return match;
  }
  return {};
}

function normalizePaperName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[，、；;:：|｜-]/g, "");
}

function stripLeadingPaperPrefix(value) {
  return String(value || "")
    .trim()
    .replace(/^\d{8}[-_]\d{1,2}[-_]\d{1,2}[_\- ]*/, "")
    .replace(/^\d{8}[_\-]\d{1,2}[A-Za-z0-9]*[^一-龥A-Za-z0-9]*/, "")
    .replace(/^\d{8}[_\-]\d{1,2}[A-Za-z0-9]*/, "")
    .replace(/^\d{1,2}[A-Za-z0-9]*[^一-龥A-Za-z0-9]*/, "")
    .trim();
}

function extractLeadingCourseCode(value) {
  const match = String(value || "").trim().match(/^(\d{8}-\d{1,2}-\d{1,2})/);
  return match ? match[1] : "";
}

function paperNameMatches(expectedName, actualName) {
  const expected = normalizePaperName(expectedName);
  const actual = normalizePaperName(actualName);
  if (!expected || !actual) return false;
  if (expected === actual) return true;

  const expectedBody = normalizePaperName(stripLeadingPaperPrefix(expectedName));
  const actualBody = normalizePaperName(stripLeadingPaperPrefix(actualName));
  if (expectedBody && actualBody && expectedBody === actualBody) return true;
  if (expectedBody && actual.includes(expectedBody)) return true;
  if (actualBody && expected.includes(actualBody)) return true;
  if (expected.length >= 6 && actual.includes(expected)) return true;
  if (actual.length >= 6 && expected.includes(actual)) return true;
  return false;
}

function normalizePaperCandidate(value) {
  if (value && typeof value === "object") {
    const code = String(value.code || value.form_code || value.formCode || "").trim();
    return {
      code,
      name: String(value.name || value.paper_name || value.paperName || value.title || code).trim(),
      courseCode: String(value.course_code || value.courseCode || value.course || value.subject_code || value.subjectCode || "").trim(),
      courseName: String(value.course_name || value.courseName || value.subject_name || value.subjectName || "").trim(),
    };
  }
  const code = String(value || "").trim();
  return { code, name: code, courseCode: "", courseName: "" };
}

function normalizeSessionCourseCandidate(value) {
  if (!value || typeof value !== "object") return null;
  const code = String(
    value.code ||
    value.course_code ||
    value.courseCode ||
    value.subject_code ||
    value.subjectCode ||
    value.id ||
    "",
  ).trim();
  const name = String(value.name || value.course_name || value.courseName || value.title || code).trim();
  const formLists = [
    value.res,
    value.results,
    value.forms,
    value.form_codes,
    value.formCodes,
    value.papers,
    value.paper_list,
    value.paperList,
    value.form,
    value.paper,
  ];
  const papers = formLists.flatMap((item) => {
    if (Array.isArray(item)) return item.map(normalizePaperCandidate);
    if (item && typeof item === "object") return [normalizePaperCandidate(item)];
    return normalizeFormCodes(item).map((formCode) => ({ code: formCode, name: formCode }));
  }).filter((paper) => paper.code || paper.name);
  return code || name || papers.length ? { code, name, papers } : null;
}

function extractSessionCourses(payload, sessionId) {
  const detail = unwrapSessionDetail(payload, sessionId);
  const courseLists = [
    detail?.courses,
    detail?.course_list,
    detail?.courseList,
    detail?.subjects,
    detail?.subject_list,
    detail?.course,
    detail?.data?.courses,
    detail?.data?.course_list,
    detail?.data?.subjects,
  ];
  for (const candidate of courseLists) {
    const courses = (Array.isArray(candidate) ? candidate : candidate && typeof candidate === "object" ? [candidate] : [])
      .map(normalizeSessionCourseCandidate)
      .filter(Boolean);
    if (courses.length) return courses;
  }
  return [];
}

function normalizeFormList(payload) {
  const candidates = [
    payload?.form_list,
    payload?.forms,
    payload?.results,
    payload?.res,
    payload?.data?.form_list,
    payload?.data?.results,
    Array.isArray(payload) ? payload : null,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map(normalizePaperCandidate).filter((paper) => paper.code);
  }
  return [];
}

function sessionFormResults(sessionId, papers, source = "session_forms") {
  return (Array.isArray(papers) ? papers : []).map((paper) => ({
    session_id: String(sessionId || ""),
    course_name: paper.courseName || "科目",
    course_code: paper.courseCode || "",
    form_codes: [paper.code].filter(Boolean),
    paper_names: [paper.name].filter(Boolean),
    source,
  }));
}

function filterSessionFormsForCourses(papers, courses = []) {
  const requestedCourses = Array.isArray(courses) ? courses : [];
  if (!requestedCourses.length) return papers;
  const requested = requestedCourses.map((course) => ({
    code: normalizeCourseCode(course),
    paperName: normalizeCoursePaperName(course),
  }));
  const requestedCodes = new Set(requested.map((course) => course.code).filter(Boolean));
  if (!requestedCodes.size) return papers;
  const withCourseCodes = papers.filter((paper) => paper.courseCode);
  return papers.filter((paper) => requested.some((course) => {
    if (withCourseCodes.length && paper.courseCode !== course.code) return false;
    return !course.paperName || paperNameMatches(course.paperName, paper.name);
  }));
}

async function fetchSessionForms({ login, apiBase, sessionId, courses, requestJson, emitLog }) {
  const path = `/tenant/api/session/${encodeURIComponent(sessionId)}/forms/`;
  emitLog(`[试卷绑定] 人工绑定回查 GET ${path}`);
  const payload = await requestJson(login, `${apiBase}${path}`, { method: "GET" }, `查询场次试卷列表 ${sessionId}`);
  emitLog(`[试卷绑定] 场次试卷列表 responseBody = ${compactBody(payload)}`);
  const papers = filterSessionFormsForCourses(normalizeFormList(payload), courses);
  return sessionFormResults(sessionId, papers);
}

function selectFormCodesForCourse({ courseCode, paperName, formPapers }) {
  const papers = (Array.isArray(formPapers) ? formPapers : []).map(normalizePaperCandidate).filter((paper) => paper.code);
  if (!paperName) return { status: papers.length ? "matched" : "missing", formCodes: papers.map((paper) => paper.code), candidates: papers };

  const matches = papers.filter((paper) => {
    const leadingCourseCode = extractLeadingCourseCode(paper.name);
    if (leadingCourseCode && leadingCourseCode !== courseCode) return false;
    return paperNameMatches(paperName, paper.name);
  });
  if (matches.length === 1) return { status: "matched", formCodes: [matches[0].code], candidates: matches };
  if (matches.length > 1) return { status: "ambiguous", formCodes: [], candidates: matches };
  return { status: "missing", formCodes: [], candidates: papers };
}

function duplicatePaperMatchForCourse({ courseCode, courseName, paperName, candidates }) {
  return {
    course_code: courseCode,
    course_name: courseName,
    paper_name: paperName,
    candidates: (Array.isArray(candidates) ? candidates : []).map((paper) => ({
      code: paper.code,
      name: paper.name,
    })),
  };
}

async function fetchTenantFormList({ login, apiBase, requestJson, emitLog }) {
  const path = "/tenant/api/form/list/?form_type=form&order_by=-id";
  emitLog(`[试卷绑定] GET ${path}`);
  const payload = await requestJson(login, `${apiBase}${path}`, { method: "GET" }, "查询租户试卷列表");
  const papers = normalizeFormList(payload);
  emitLog(`[试卷绑定] 租户试卷列表 responseBody = ${compactBody(payload)}`);
  return papers;
}

async function fetchSessionPaperBindingDetail({ login, apiBase, sessionId, courses, requestJson, emitLog }) {
  try {
    const formResults = await fetchSessionForms({ login, apiBase, sessionId, courses, requestJson, emitLog });
    if (formResults.length) {
      return { source: "forms", results: formResults };
    }
  } catch (error) {
    emitLog(`[试卷绑定] 场次试卷列表回查失败：${error instanceof Error ? error.message : String(error)}`, "warning");
  }

  const detailPath = `/tenant/api/session/${encodeURIComponent(sessionId)}/`;
  emitLog(`[试卷绑定] 人工绑定回查 GET ${detailPath}`);
  try {
    const payload = await requestJson(login, `${apiBase}${detailPath}`, { method: "GET" }, `回查正式场次试卷 ${sessionId}`);
    emitLog(`[试卷绑定] 人工绑定回查 responseBody = ${compactBody(payload)}`);
    return { source: "detail", payload };
  } catch (error) {
    emitLog(`[试卷绑定] 人工绑定详情回查失败：${error instanceof Error ? error.message : String(error)}`, "warning");
    const listPath = `/tenant/api/session/?session_ids=${encodeURIComponent(sessionId)}`;
    emitLog(`[试卷绑定] 人工绑定回查 GET ${listPath}`);
    const payload = await requestJson(login, `${apiBase}${listPath}`, { method: "GET" }, `回查正式场次列表试卷 ${sessionId}`);
    emitLog(`[试卷绑定] 人工绑定列表回查 responseBody = ${compactBody(payload)}`);
    return { source: "list", payload };
  }
}

async function detectSessionPaperBindings({
  login,
  apiBase,
  sessionId,
  courses,
  requestJson,
  emitLog = () => {},
}) {
  const normalizedSessionId = typeof sessionId === "number" ? String(sessionId) : String(sessionId || "").trim();
  if (!normalizedSessionId) throw new Error(INVALID_PAPER_BINDING_MESSAGE);

  const payload = await fetchSessionPaperBindingDetail({
    login,
    apiBase,
    sessionId: normalizedSessionId,
    courses,
    requestJson,
    emitLog,
  });
  if (payload?.source === "forms") {
    emitLog("[试卷绑定] 人工绑定回查确认正式场次已有试卷", "success");
    return { status: "success", results: payload.results };
  }
  const sessionCourses = extractSessionCourses(payload?.payload, normalizedSessionId);
  const results = [];
  const missingCourseCodes = [];
  const requestedCourses = Array.isArray(courses) ? courses : [];

  if (!requestedCourses.length) {
    for (const sessionCourse of sessionCourses) {
      const papers = (sessionCourse.papers || []).filter((paper) => paper.code || paper.name);
      if (!papers.length) continue;
      results.push({
        session_id: normalizedSessionId,
        course_name: sessionCourse.name || "科目",
        course_code: sessionCourse.code || "",
        form_codes: papers.map((paper) => paper.code).filter(Boolean),
        paper_names: papers.map((paper) => paper.name).filter(Boolean),
        source: "session_detail",
      });
    }
    if (results.length) {
      emitLog("[试卷绑定] 人工绑定回查确认正式场次已有试卷", "success");
      return { status: "success", results };
    }
    emitLog("[试卷绑定] 人工绑定回查未发现已绑定试卷", "warning");
    return { status: "waiting_manual", missingCourseCodes: [] };
  }

  for (const course of requestedCourses) {
    const requestedCourseCode = normalizeCourseCode(course);
    const requestedCourseName = normalizeCourseName(course);
    const requestedPaperName = normalizeCoursePaperName(course);
    if (!requestedCourseCode) throw new Error(INVALID_PAPER_BINDING_MESSAGE);
    const matched = sessionCourses.find((candidate) => {
      if (candidate.code && candidate.code === requestedCourseCode) return true;
      return !candidate.code && requestedCourseName && candidate.name === requestedCourseName;
    });
    const papers = (matched?.papers || [])
      .filter((paper) => paper.code || paper.name)
      .filter((paper) => !requestedPaperName || paperNameMatches(requestedPaperName, paper.name));
    if (!matched || !papers.length) {
      missingCourseCodes.push(requestedCourseCode);
      continue;
    }
    results.push({
      session_id: normalizedSessionId,
      course_name: matched.name || requestedCourseName,
      course_code: matched.code || requestedCourseCode,
      form_codes: papers.map((paper) => paper.code).filter(Boolean),
      paper_names: papers.map((paper) => paper.name).filter(Boolean),
      source: "session_detail",
    });
  }

  if (missingCourseCodes.length) {
    emitLog(`[试卷绑定] 人工绑定回查仍缺少试卷：${missingCourseCodes.join("、")}`, "warning");
    return { status: "waiting_manual", missingCourseCodes };
  }
  emitLog("[试卷绑定] 人工绑定回查确认正式场次已有试卷", "success");
  return { status: "success", results };
}

function extractCourseCode(payload, fallbackCode) {
  const course = unwrapCourseDetail(payload);
  return String(course?.code || course?.course_code || fallbackCode || "").trim();
}

function extractFormCodesFromCourseDetail(payload) {
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
  const codes = formLists.flatMap((value) => normalizeFormCodes(value));
  return Array.from(new Set(codes));
}

function extractFormPapersFromCourseDetail(payload) {
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
  return formLists.flatMap((value) => {
    if (Array.isArray(value)) return value.map(normalizePaperCandidate).filter((paper) => paper.code);
    return normalizeFormCodes(value).map((code) => ({ code, name: code }));
  });
}

async function fetchCourseFormBinding({ login, apiBase, courseCode, requestJson, emitLog }) {
  const path = `/tenant/api/courses/${encodeURIComponent(courseCode)}/?apply=form`;
  emitLog(`[试卷绑定] GET ${path}`);
  const detail = await requestJson(login, `${apiBase}${path}`, { method: "GET" }, `查询科目试卷 ${courseCode}`);
  emitLog(`[试卷绑定] 科目详情 responseBody = ${compactBody(detail)}`);
  return {
    courseCode: extractCourseCode(detail, courseCode),
    formCodes: extractFormCodesFromCourseDetail(detail),
    formPapers: extractFormPapersFromCourseDetail(detail),
    detail,
  };
}

function validatePaperBinding({ sessionId, courseCode, formCodes }) {
  const normalizedSessionId = typeof sessionId === "number" ? String(sessionId) : sessionId;
  if (typeof normalizedSessionId !== "string" || !normalizedSessionId.trim()) {
    throw new Error(INVALID_PAPER_BINDING_MESSAGE);
  }
  if (typeof courseCode !== "string" || !courseCode.trim()) {
    throw new Error(INVALID_PAPER_BINDING_MESSAGE);
  }
  const normalizedFormCodes = normalizeFormCodes(formCodes);
  if (!normalizedFormCodes.length) {
    throw new Error(MISSING_FORM_CODES_MESSAGE);
  }
  return {
    sessionId: normalizedSessionId.trim(),
    courseCode: courseCode.trim(),
    formCodes: normalizedFormCodes,
  };
}

async function postCourseSessionFormCodes({ login, apiBase, binding, requestJson, emitLog }) {
  const path = `/tenant/api/course/session/${encodeURIComponent(binding.sessionId)}/`;
  const payload = {
    course_code: binding.courseCode,
    form_codes: binding.formCodes,
  };

  emitLog(`[试卷绑定] POST ${path}`);
  emitLog(`[试卷绑定] HTTP Method = POST`);
  emitLog(`[试卷绑定] session_id = ${binding.sessionId}`);
  emitLog(`[试卷绑定] payload = ${JSON.stringify(payload)}`);

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
      `绑定试卷 ${binding.formCodes.join("、")} 到正式场次 ${binding.sessionId}`,
    );
    const httpStatus = responseBody?.__tenantResponse ? responseBody.httpStatus : 200;
    const body = responseBody?.__tenantResponse ? responseBody.body : responseBody;
    emitLog(`[试卷绑定] httpStatus = ${httpStatus}`);
    emitLog(`[试卷绑定] responseBody = ${compactBody(body)}`);
    return { ...payload, responseBody: body };
  } catch (error) {
    emitLog(`[试卷绑定] url = ${path}`, "warning");
    emitLog(`[试卷绑定] requestBody = ${JSON.stringify(payload)}`, "warning");
    emitLog(`[试卷绑定] httpStatus = ${error?.status || "未知"}`, "warning");
    emitLog(`[试卷绑定] responseBody = ${compactBody(error?.detail)}`, "warning");
    if (error?.status === 400) {
      const bindingError = new Error(INVALID_PAPER_BINDING_MESSAGE);
      bindingError.status = error.status;
      bindingError.detail = error.detail;
      throw bindingError;
    }
    throw error;
  }
}

async function putCourseFormCodes({ login, apiBase, binding, requestJson, emitLog }) {
  const path = "/tenant/api/course/";
  const payload = {
    code: binding.courseCode,
    name: binding.courseName || binding.courseCode,
    form_codes: binding.formCodes,
  };
  emitLog(`[试卷绑定] PUT ${path}`);
  emitLog(`[试卷绑定] payload = ${JSON.stringify(payload)}`);
  const responseBody = await requestJson(
    login,
    `${apiBase}${path}`,
    {
      method: "PUT",
      includeResponseMeta: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    `更新科目绑定试卷 ${binding.courseCode}`,
  );
  const httpStatus = responseBody?.__tenantResponse ? responseBody.httpStatus : 200;
  const body = responseBody?.__tenantResponse ? responseBody.body : responseBody;
  emitLog(`[试卷绑定] 科目绑定试卷 httpStatus = ${httpStatus}`);
  emitLog(`[试卷绑定] 科目绑定试卷 responseBody = ${compactBody(body)}`);
  return { ...payload, responseBody: body };
}

async function bindPapersToFormalSession({
  login,
  apiBase,
  sessionId,
  courses,
  requestJson,
  emitLog = () => {},
}) {
  if (!Array.isArray(courses) || !courses.length) throw new Error(INVALID_PAPER_BINDING_MESSAGE);
  const preparedBindings = [];
  const missingCourseCodes = [];
  const duplicatePaperMatches = [];
  const results = [];
  let tenantFormList = null;

  emitLog(`[试卷绑定] 开始绑定试卷，session_id=${sessionId || ""}`);

  for (const course of courses) {
    const requestedCourseCode = normalizeCourseCode(course);
    const courseName = normalizeCourseName(course);
    const paperName = normalizeCoursePaperName(course);
    if (!requestedCourseCode) throw new Error(INVALID_PAPER_BINDING_MESSAGE);

    let refreshed;
    try {
      refreshed = await fetchCourseFormBinding({
        login,
        apiBase,
        courseCode: requestedCourseCode,
        requestJson,
        emitLog,
      });
    } catch (error) {
      if (error?.status === 404) {
        missingCourseCodes.push(requestedCourseCode);
        continue;
      }
      throw error;
    }

    const effectivePaperName = paperName || courseName;
    let shouldUpdateCourseForms = false;
    let selected = selectFormCodesForCourse({
      courseCode: requestedCourseCode,
      paperName: effectivePaperName,
      formPapers: refreshed.formPapers,
    });
    if (!selected.formCodes.length && !refreshed.formCodes.length) {
      if (!tenantFormList) {
        tenantFormList = await fetchTenantFormList({ login, apiBase, requestJson, emitLog });
      }
      selected = selectFormCodesForCourse({
        courseCode: requestedCourseCode,
        paperName: effectivePaperName,
        formPapers: tenantFormList,
      });
      shouldUpdateCourseForms = Boolean(selected.formCodes.length);
    }
    const selectedFormCodes = selected.formCodes.length ? selected.formCodes : paperName ? selected.formCodes : refreshed.formCodes;

    if (effectivePaperName) {
      emitLog(
        `[试卷绑定] 按试卷名称匹配：${effectivePaperName}，匹配状态=${selected.status}，候选=${selected.candidates.map((item) => `${item.code}/${item.name}`).join("、") || "无"}`,
        selected.status === "matched" ? "success" : "warning",
      );
    }

    if (!selectedFormCodes.length) {
      missingCourseCodes.push(requestedCourseCode);
      if (selected.status === "ambiguous") {
        duplicatePaperMatches.push(duplicatePaperMatchForCourse({
          courseCode: requestedCourseCode,
          courseName,
          paperName: effectivePaperName,
          candidates: selected.candidates,
        }));
      }
      continue;
    }

    const validated = validatePaperBinding({
      sessionId,
      courseCode: refreshed.courseCode || requestedCourseCode,
      formCodes: selectedFormCodes,
    });
    preparedBindings.push({
      ...validated,
      courseName,
      paperNames: selected.candidates.map((item) => item.name).filter(Boolean),
      shouldUpdateCourseForms,
    });
  }

  if (missingCourseCodes.length) {
    const duplicateNames = duplicatePaperMatches
      .map((match) => `${match.course_code}/${match.paper_name}`)
      .join("、");
    const message = duplicatePaperMatches.length
      ? `发现重复试卷，请人工确认：${duplicateNames}`
      : `${MISSING_FORM_CODES_MESSAGE}：${missingCourseCodes.join("、")}`;
    emitLog(`[试卷绑定] ${message}`, "warning");
    return {
      status: "waiting_manual",
      missingCourseCodes,
      ...(duplicatePaperMatches.length ? { duplicatePaperMatches } : {}),
    };
  }

  for (const binding of preparedBindings) {
    emitLog(`[试卷绑定] 科目=${binding.courseName || binding.courseCode}，course_code=${binding.courseCode}，form_codes=[${binding.formCodes.join(", ")}]`);
    if (binding.shouldUpdateCourseForms) {
      await putCourseFormCodes({ login, apiBase, binding, requestJson, emitLog });
    }
    const response = await postCourseSessionFormCodes({ login, apiBase, binding, requestJson, emitLog });
    emitLog("[试卷绑定] 调用试卷绑定接口成功");
    results.push({
      session_id: binding.sessionId,
      course_name: binding.courseName,
      course_code: binding.courseCode,
      form_codes: binding.formCodes,
      paper_names: binding.paperNames,
      responseBody: response.responseBody,
    });
  }

  emitLog("[试卷绑定] 正式考试试卷绑定完成");
  return { status: "success", results };
}

export {
  INVALID_PAPER_BINDING_MESSAGE,
  MISSING_FORM_CODES_MESSAGE,
  bindPapersToFormalSession,
  detectSessionPaperBindings,
  validatePaperBinding,
};
