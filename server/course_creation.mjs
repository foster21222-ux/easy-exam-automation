function normalizeCourseFormCodes(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[\s,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeCourseRecords(config = {}) {
  const rawCourses = Array.isArray(config.courses) ? config.courses : [];
  return rawCourses
    .map((course, index) => {
      const name = String(course?.name || course?.course_name || course?.title || "").trim();
      const code = String(course?.code || course?.course_code || "").trim();
      const formCodes = normalizeCourseFormCodes(course?.form_codes || course?.formCodes || code);
      return {
        name,
        code,
        form_codes: formCodes.length ? formCodes : code ? [code] : [],
        order: index + 1,
      };
    })
    .filter((course) => course.name && course.code);
}

function compactApiDetail(detail) {
  if (detail === undefined || detail === null) return "";
  return typeof detail === "string" ? detail.slice(0, 1000) : JSON.stringify(detail).slice(0, 1000);
}

function normalizeCourseList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.res)) return payload.res;
  if (payload && typeof payload === "object" && (payload.name || payload.code || payload.course_code)) return [payload];
  return [];
}

function normalizeCourseName(value) {
  return String(value || "").trim();
}

function parseCourseCode(value) {
  const match = String(value || "").trim().match(/^(\d{8})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    date: match[1],
    examSerial: Number.parseInt(match[2], 10),
    subjectSerial: Number.parseInt(match[3], 10),
  };
}

function buildCourseCode(date, examSerial, subjectSerial) {
  return `${date}-${String(examSerial).padStart(2, "0")}-${String(subjectSerial).padStart(2, "0")}`;
}

function extractExamDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}${match[2].padStart(2, "0")}${match[3].padStart(2, "0")}`;
}

function sameSingleFormCode(formCodes, oldCode) {
  return Array.isArray(formCodes) && formCodes.length === 1 && String(formCodes[0] || "").trim() === oldCode;
}

function withCourseCode(course, code) {
  const oldCode = String(course.code || "").trim();
  const formCodes = Array.isArray(course.form_codes) ? course.form_codes : [];
  return {
    ...course,
    code,
    form_codes: !formCodes.length || sameSingleFormCode(formCodes, oldCode) ? [code] : formCodes,
  };
}

function codePrefixAndSuffix(code) {
  const match = String(code || "").trim().match(/^(.+?)-(\d+)$/);
  if (!match) return null;
  return { prefix: match[1], suffix: Number.parseInt(match[2], 10), width: match[2].length };
}

function getErrorMessage(error) {
  const parts = [
    error?.message,
    typeof error?.detail === "string" ? error.detail : "",
    error?.detail?.message,
    error?.detail?.msg,
    error?.detail?.error,
    error?.detail ? JSON.stringify(error.detail) : "",
  ];
  return parts.filter(Boolean).join(" ");
}

function isCourseCodeExistsError(error) {
  const message = getErrorMessage(error);
  return error?.status === 400 && (message.includes("科目编码已存在") || message.includes("科目编号已存在"));
}

export function generateNextCourseCode(courseCode) {
  const parsed = parseCourseCode(courseCode);
  if (!parsed) {
    throw new Error(`科目编号格式不正确：${courseCode}`);
  }
  if (parsed.examSerial >= 99) {
    throw new Error("科目编号已占满，请手动处理。");
  }
  return buildCourseCode(parsed.date, parsed.examSerial + 1, parsed.subjectSerial);
}

function nextAvailableCourseCode(requestedCode, usedCodes) {
  if (!usedCodes.has(requestedCode)) return requestedCode;
  if (!parseCourseCode(requestedCode)) {
    const parts = codePrefixAndSuffix(requestedCode);
    if (!parts) return requestedCode;
    let next = parts.suffix + 1;
    let candidate = `${parts.prefix}-${String(next).padStart(parts.width, "0")}`;
    while (usedCodes.has(candidate)) {
      next += 1;
      candidate = `${parts.prefix}-${String(next).padStart(parts.width, "0")}`;
    }
    return candidate;
  }
  let candidate = generateNextCourseCode(requestedCode);
  while (usedCodes.has(candidate)) {
    candidate = generateNextCourseCode(candidate);
  }
  return candidate;
}

function nextAvailableCourseGroup(courses, usedCodes, emitLog = () => {}) {
  const nextCourses = courses.map((course) => ({ ...course }));
  const groups = new Map();
  for (const [index, course] of nextCourses.entries()) {
    const parsed = parseCourseCode(course.code);
    if (!parsed) continue;
    const key = `${parsed.date}-${String(parsed.examSerial).padStart(2, "0")}`;
    const group = groups.get(key) || { date: parsed.date, examSerial: parsed.examSerial, items: [] };
    group.items.push({ index, subjectSerial: parsed.subjectSerial, code: course.code });
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    let serial = group.examSerial;
    while (
      serial <= 99 &&
      group.items.some((item) => usedCodes.has(buildCourseCode(group.date, serial, item.subjectSerial)))
    ) {
      serial += 1;
    }
    if (serial > 99) throw new Error("科目编号已占满，请手动处理。");
    if (serial === group.examSerial) continue;
    for (const item of group.items) {
      const nextCode = buildCourseCode(group.date, serial, item.subjectSerial);
      emitLog(`[API 科目] 科目编号已占用，改用：${nextCode}`);
      nextCourses[item.index] = withCourseCode(nextCourses[item.index], nextCode);
    }
  }
  return nextCourses;
}

function existingCourseByName(courses, name) {
  const expected = normalizeCourseName(name);
  return courses.find((course) => normalizeCourseName(course?.name) === expected) || null;
}

export function assignCourseCodesForExamConfig(config = {}, existingTasks = []) {
  const date = extractExamDate(config.startTimeDisplay || config.startTime || config.examStartTime);
  const rawCourses = Array.isArray(config.courses) ? config.courses : [];
  if (!date || !rawCourses.length) return config;

  let sameDayTaskCount = 0;
  let maxSerial = 0;
  for (const task of existingTasks || []) {
    const taskConfig = task?.config || {};
    const taskDate = extractExamDate(taskConfig.startTimeDisplay || taskConfig.startTime || taskConfig.examStartTime);
    if (taskDate !== date) continue;
    sameDayTaskCount += 1;
    for (const course of taskConfig.courses || []) {
      const parsed = parseCourseCode(course?.code || course?.course_code);
      if (parsed?.date === date) maxSerial = Math.max(maxSerial, parsed.examSerial);
    }
  }

  const examSerial = Math.min(99, Math.max(sameDayTaskCount, maxSerial) + 1);
  if (examSerial > 99) throw new Error("科目编号已占满，请手动处理。");
  const courses = rawCourses.map((course, index) => {
    const code = buildCourseCode(date, examSerial, index + 1);
    const sourceCourse = {
      ...course,
      form_codes: normalizeCourseFormCodes(course?.form_codes || course?.formCodes || course?.code || course?.course_code),
    };
    return withCourseCode(sourceCourse, code);
  });
  return { ...config, courses };
}

async function createCourseWithAutoIncrement({
  login,
  apiBase,
  course,
  initialCode,
  requestJson,
  emitLog,
}) {
  let currentCode = initialCode;
  for (let attempt = 0; attempt < 99; attempt += 1) {
    emitLog(`[API 科目] 准备创建科目：${course.name} / ${currentCode}`);
    const currentCourse = withCourseCode(course, currentCode);
    const coursePayload = {
      name: currentCourse.name,
      code: currentCode,
      form_codes: currentCourse.form_codes,
    };

    try {
      const result = await requestJson(
        login,
        `${apiBase}/tenant/api/course/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(coursePayload),
        },
        `创建科目 ${currentCode}`,
      );
      emitLog(`[API 科目] 科目创建成功：${course.name} / ${currentCode}`);
      return { result, finalCourseCode: currentCode };
    } catch (error) {
      if (!isCourseCodeExistsError(error)) {
        emitLog(
          `[API 科目] 创建失败：${course.name} / ${currentCode}，状态码=${error?.status || "未知"}，响应=${compactApiDetail(error?.detail)}`,
          "warning",
        );
        throw error;
      }
      const nextCode = generateNextCourseCode(currentCode);
      emitLog(`[API 科目] 科目编号已存在：${currentCode}，尝试下一个编号：${nextCode}`);
      currentCode = nextCode;
    }
  }
  throw new Error("科目编号已连续占用，自动顺延失败，请手动处理");
}

export async function ensureFormalCoursesCreated({
  login,
  apiBase,
  config,
  emitLog,
  requestJson,
}) {
  const courses = normalizeCourseRecords(config);
  if (!courses.length) {
    emitLog("[API 科目] 需求单科目为空，跳过科目创建，配置流程继续完成。", "success");
    return [];
  }

  emitLog(`[API 科目] 准备创建/确认 ${courses.length} 个科目`);
  let tenantCourses = [];
  try {
    const payload = await requestJson(
      login,
      `${apiBase}/tenant/api/courses/?apply=session`,
      { method: "GET" },
      "查询科目列表",
    );
    tenantCourses = normalizeCourseList(payload);
    emitLog(`[API 科目] 已读取科目列表：${tenantCourses.length} 个`);
  } catch (error) {
    emitLog(
      `[API 科目] 查询科目列表失败，改用逐个编号确认：状态码=${error?.status || "未知"}，响应=${compactApiDetail(error?.detail)}`,
      "warning",
    );
  }

  const usedCodes = new Set(
    tenantCourses.map((course) => String(course?.code || course?.course_code || "").trim()).filter(Boolean),
  );
  const confirmedCourses = [];

  const coursesToCreate = nextAvailableCourseGroup(courses, usedCodes, emitLog);

  for (const course of coursesToCreate) {
    const existing = existingCourseByName(tenantCourses, course.name);
    if (existing) {
      const existingCode = String(existing.code || existing.course_code || course.code).trim();
      emitLog(`[API 科目] 科目名称已存在，跳过创建：${course.name} / ${existingCode}`);
      confirmedCourses.push({ ...course, code: existingCode || course.code });
      if (existingCode) usedCodes.add(existingCode);
      continue;
    }

    let createCode = nextAvailableCourseCode(course.code, usedCodes);
    if (createCode !== course.code) {
      emitLog(`[API 科目] 科目编号已占用，改用：${createCode}`);
    }

    let existsByCode = false;
    if (!tenantCourses.length) {
      const encodedCode = encodeURIComponent(createCode);
      try {
        const existingByCode = await requestJson(
          login,
          `${apiBase}/tenant/api/courses/${encodedCode}/?apply=session`,
          { method: "GET" },
          `查询科目 ${createCode}`,
        );
        existsByCode = normalizeCourseList(existingByCode).length > 0;
        emitLog(`[API 科目] 查询科目：${createCode}，exists=${existsByCode}`);
      } catch (error) {
        if (error?.status === 404) {
          existsByCode = false;
          emitLog(`[API 科目] 科目不存在，准备创建：${createCode}`);
        } else {
          emitLog(
            `[API 科目] 查询科目失败：${createCode}，状态码=${error?.status || "未知"}，响应=${compactApiDetail(error?.detail)}`,
            "warning",
          );
          throw error;
        }
      }
      if (existsByCode) {
        createCode = nextAvailableCourseCode(createCode, new Set([...usedCodes, createCode]));
        emitLog(`[API 科目] 科目编号已存在但名称不同，改用：${createCode}`);
      }
    }

    emitLog(`[API 科目] 科目名称不存在，准备创建：${course.name} / ${createCode}`);

    const created = await createCourseWithAutoIncrement({
      login,
      apiBase,
      course,
      initialCode: createCode,
      requestJson,
      emitLog,
    });
    usedCodes.add(created.finalCourseCode);
    confirmedCourses.push(withCourseCode(course, created.finalCourseCode));
  }

  return confirmedCourses;
}

export { normalizeCourseRecords, normalizeCourseList, nextAvailableCourseCode, isCourseCodeExistsError };
