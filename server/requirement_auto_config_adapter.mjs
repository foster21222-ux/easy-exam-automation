const TRUE_VALUES = new Set(["是", "需要", "开启", "启用", "true", "yes", "y", "1"]);
const FALSE_VALUES = new Set(["否", "不需要", "无需", "关闭", "禁用", "false", "no", "n", "0"]);

export function buildAutoConfigFromRequirement(requirement = {}, options = {}) {
  const warnings = [];
  const formalRange = parseDateTimeRange(requirement.formal_exam_time_range);
  const mockRange = parseDateTimeRange(requirement.mock_exam_time_range);
  const subjects = normalizeSubjects(requirement.subjects || requirement.subjects_text);
  const paperNames = normalizeSubjects(requirement.paper_names || requirement.paper_names_text);
  const examType = normalizeExamType(requirement.exam_client_type);
  const courses = buildGeneratedCourses(subjects, formalRange.start, paperNames);

  if (!requirement.exam_name) warnings.push("缺少考试名称。");
  if (!formalRange.start || !formalRange.end) warnings.push("正式考试时间无法解析。");
  if (requirement.mock_exam_time_range && (!mockRange.start || !mockRange.end)) warnings.push("试考时间无法解析，试考自动创建会跳过。");
  if (!requirement.mock_exam_time_range) warnings.push("未读取到试考时间，试考自动创建会跳过。");
  if (!subjects.length) warnings.push("未读取到科目信息，批量导入科目步骤会跳过。");
  if (subjects.length && !courses.length) warnings.push("科目信息缺少考试日期，无法按规则生成 code/form_codes。");
  if (paperNames.length && paperNames.length !== subjects.length) warnings.push("试卷名称数量与科目数量不一致，请按科目顺序逐项填写。");

  const config = {
    examName: normalizeText(requirement.exam_name),
    u8Code: normalizeText(requirement.u8_code),
    projectManager: normalizeText(requirement.project_manager),
    customerName: normalizeText(options.customerName || requirement.customer_name),
    candidateCount: normalizeInteger(requirement.candidate_count) ?? "",
    startTimeDisplay: formatDisplayDateTime(formalRange.start),
    endTimeDisplay: formatDisplayDateTime(formalRange.end),
    startTimeIso: formatIsoDateTime(formalRange.start),
    endTimeIso: formatIsoDateTime(formalRange.end),
    earlyLoginMinutes: normalizeInteger(requirement.early_login_minutes),
    lateLimitMinutes: normalizeInteger(requirement.late_limit_minutes),
    timeRule: normalizeText(requirement.time_rule),
    examAddress: normalizeText(requirement.exam_address),
    unifiedExamAddress: normalizeText(requirement.exam_address) === "统一考试地址",
    preLoginPrompt: normalizeRichText(requirement.pre_login_prompt),
    welcomeText: normalizeText(requirement.welcome_text),
    pledgeContent: normalizeRichText(requirement.pledge_content),
    videoMonitor: normalizeBoolean(requirement.video_monitor_required),
    videoRecord: normalizeBoolean(requirement.video_record_required),
    loginVerifyMode: "考后公安验证",
    hawkeye: normalizeBoolean(requirement.hawkeye_required),
    examType,
    clientExam: examType === "客户端考试",
    webExam: examType === "网页考试",
    leaveLimit: normalizeInteger(requirement.leave_limit_count),
    clientLoginLimit: normalizeInteger(requirement.client_login_limit) || 10,
    manualScore: normalizeEnabledText(requirement.manual_score_text),
    manualScoreText: normalizeText(requirement.manual_score_text),
    watermark: normalizeBoolean(requirement.watermark_enabled),
    disableCopy: normalizeBoolean(requirement.copy_forbidden),
    subjects,
    courses,
    subjectImportPath: "",
    mockExamEnabled: Boolean(mockRange.start && mockRange.end),
    mockExamName: requirement.exam_name ? `${normalizeText(requirement.exam_name)}-试考` : "",
    mockStartTimeDisplay: formatDisplayDateTime(mockRange.start),
    mockEndTimeDisplay: formatDisplayDateTime(mockRange.end),
    mockStartTimeIso: formatIsoDateTime(mockRange.start),
    mockEndTimeIso: formatIsoDateTime(mockRange.end),
    visibleFields: ["姓名", "身份证号"],
    editableFields: [],
    requiredFields: [],
    confirmOnly: true,
  };

  return { config, warnings };
}

export function parseDateTimeRange(value) {
  const text = normalizeText(value);
  if (!text) return { start: null, end: null };
  const flexibleRange = parseFlexibleDateTimeRange(text);
  if (flexibleRange.start && flexibleRange.end) return flexibleRange;
  const matches = [...text.matchAll(/(\d{4}[/-]\d{1,2}[/-]\d{1,2})\s+(\d{1,2}:\d{2})(?::\d{2})?/g)];
  if (matches.length < 2) return { start: null, end: null };
  return {
    start: parseDateTime(`${matches[0][1]} ${matches[0][2]}`),
    end: parseDateTime(`${matches[1][1]} ${matches[1][2]}`),
  };
}

function normalizeDateTimeText(value) {
  return normalizeText(value)
    .replace(/[：]/g, ":")
    .replace(/[－–—~～]/g, "-")
    .replace(/到|至/g, "-")
    .replace(/\s*:\s*/g, ":")
    .replace(/([0-2]?\d)\s*[点时]\s*半/g, "$1:30")
    .replace(/([0-2]?\d)\s*[点时](?!\s*半)/g, "$1:00")
    .replace(/分/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dateMatchToParts(match) {
  const offset = match.length >= 5 ? 1 : 0;
  const year = match[offset + 1] ? Number(match[offset + 1]) : new Date().getFullYear();
  return { year, month: Number(match[offset + 2]), day: Number(match[offset + 3]) };
}

function extractTimeTokens(text) {
  return [...String(text || "").matchAll(/(?:^|[^\d])([0-2]?\d)(?::([0-5]?\d))?(?::[0-5]?\d)?(?=$|[^\d])/g)]
    .map((match) => ({ hour: Number(match[1]), minute: match[2] === undefined ? 0 : Number(match[2]) }))
    .filter((item) => item.hour >= 0 && item.hour <= 23 && item.minute >= 0 && item.minute <= 59);
}

function isValidDateTime(value) {
  if (!value) return false;
  const date = new Date(value.year, value.month - 1, value.day);
  return date.getFullYear() === value.year
    && date.getMonth() === value.month - 1
    && date.getDate() === value.day
    && value.hour >= 0
    && value.hour <= 23
    && value.minute >= 0
    && value.minute <= 59;
}

function parseFlexibleDateTimeRange(value) {
  const text = normalizeDateTimeText(value);
  const datePattern = /(^|[^\d:：]|[^\d][:：])(?:(\d{4})\s*[\/\-.年]\s*)?(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})\s*(?:日)?/g;
  const dateMatches = [...text.matchAll(datePattern)]
    .filter((match) => isValidDateTime({ ...dateMatchToParts(match), hour: 0, minute: 0 }));
  if (dateMatches.length >= 2) {
    const startDate = dateMatchToParts(dateMatches[0]);
    const endDate = dateMatchToParts(dateMatches[1]);
    const startTime = extractTimeTokens(text.slice(dateMatches[0].index + dateMatches[0][0].length, dateMatches[1].index))[0];
    const endTime = extractTimeTokens(text.slice(dateMatches[1].index + dateMatches[1][0].length))[0];
    const start = startTime ? { ...startDate, ...startTime } : null;
    const end = endTime ? { ...endDate, ...endTime } : null;
    return isValidDateTime(start) && isValidDateTime(end) ? { start, end } : { start: null, end: null };
  }
  if (dateMatches.length === 1) {
    const date = dateMatchToParts(dateMatches[0]);
    const times = extractTimeTokens(text.slice(dateMatches[0].index + dateMatches[0][0].length));
    if (times.length >= 2) {
      const start = { ...date, ...times[0] };
      const end = { ...date, ...times[1] };
      return isValidDateTime(start) && isValidDateTime(end) ? { start, end } : { start: null, end: null };
    }
  }
  return { start: null, end: null };
}

function parseDateTime(value) {
  const match = normalizeText(value).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  if (!year || !month || !day || hour < 0 || minute < 0) return null;
  return { year, month, day, hour, minute };
}

function formatDisplayDateTime(value) {
  if (!value) return "";
  return [
    String(value.year).padStart(4, "0"),
    String(value.month).padStart(2, "0"),
    String(value.day).padStart(2, "0"),
  ].join("/") + ` ${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
}

function formatIsoDateTime(value) {
  if (!value) return "";
  return [
    String(value.year).padStart(4, "0"),
    String(value.month).padStart(2, "0"),
    String(value.day).padStart(2, "0"),
  ].join("-") + `T${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}:00.000`;
}

function buildGeneratedCourses(subjects, start, paperNames = []) {
  if (!subjects.length || !start) return [];
  const prefix = [
    String(start.year).padStart(4, "0"),
    String(start.month).padStart(2, "0"),
    String(start.day).padStart(2, "0"),
  ].join("");
  return subjects.map((subject, index) => {
    const code = `${prefix}-01-${String(index + 1).padStart(2, "0")}`;
    const paperName = normalizeText(paperNames[index]);
    return { name: subject, code, form_codes: [code], ...(paperName ? { paper_name: paperName } : {}) };
  });
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeRichText(value) {
  const text = normalizeText(value);
  return richTextPlainText(text) ? text : "";
}

function richTextPlainText(value) {
  return normalizeText(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

function normalizeSubjects(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean);
  return normalizeText(value).split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean);
}

function normalizeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const match = normalizeText(value).match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function normalizeBoolean(value, defaultValue = false) {
  if (typeof value === "boolean") return value;
  const text = normalizeText(value).toLowerCase();
  if (!text) return defaultValue;
  if (TRUE_VALUES.has(text)) return true;
  if (FALSE_VALUES.has(text)) return false;
  return defaultValue;
}

function normalizeEnabledText(value, defaultValue = false) {
  const text = normalizeText(value);
  if (!text) return defaultValue;
  const lowered = text.toLowerCase();
  if (FALSE_VALUES.has(lowered) || /不需要|无需|不开|关闭|否/.test(lowered)) return false;
  return true;
}

function normalizeExamType(value) {
  const text = normalizeText(value);
  if (["web", "WEB", "Web", "网页考试", "浏览器考试"].includes(text)) return "网页考试";
  if (["client", "CLIENT", "Client", "客户端考试", "锁定考试"].includes(text)) return "客户端考试";
  return text;
}
