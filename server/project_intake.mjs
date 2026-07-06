const BUSINESS_FIELD_ALIASES = [
  ["title", "标题"],
  ["applicant", "申请人"],
  ["applicant_department", "申请人部门"],
  ["application_date", "申请日期"],
  ["operation_serial_number", "运控流水号"],
  ["project_name", "项目名称"],
  ["project_code", "项目编码"],
  ["customer_name", "客户名称"],
  ["customer_project_attribute", "客户及项目属性"],
  ["business_direction", "业务方向"],
  ["system_type", "系统类型"],
  ["estimated_subject_count", "预估科次"],
  ["expected_revenue", "预计收入"],
  ["billing_basis", "结算依据"],
  ["exam_service_scope", "考试服务范围"],
  ["registration_method", "报名方式"],
  ["registration_website_required", "是否需要报名网站"],
  ["online_registration_start_time", "在线报名开始时间"],
  ["ata_invigilator_arrangement", "是否需要ATA安排人工监考"],
  ["ata_central_venue_required", "是否需要ATA安排集中监考场地"],
  ["ata_content_participation", "ATA内容制作参与方式"],
  ["content_source", "内容来源"],
  ["question_types", "试题类型"],
  ["subject_count", "科目数"],
  ["paper_count", "试卷数"],
  ["closed_item_writing_required", "是否需要封闭制题"],
  ["manual_marking_required", "是否需要人工阅卷"],
  ["epi_test_required", "EPI测试"],
  ["personality_test_tool", "性格测试工具"],
  ["other_notes", "其他说明"],
];

const OPTION_FIELDS = new Set([
  "customer_project_attribute",
  "business_direction",
  "system_type",
  "billing_basis",
  "exam_service_scope",
  "registration_method",
  "registration_website_required",
  "ata_invigilator_arrangement",
  "ata_central_venue_required",
  "ata_content_participation",
  "content_source",
  "question_types",
  "closed_item_writing_required",
  "manual_marking_required",
  "epi_test_required",
  "personality_test_tool",
]);

const TEMPLATE_TEXT_REGIONS = [
  ["title", [0.158, 0.031, 0.83, 0.03]],
  ["applicant", [0.158, 0.061, 0.34, 0.03]],
  ["applicant_department", [0.649, 0.061, 0.34, 0.03]],
  ["application_date", [0.158, 0.09, 0.34, 0.03]],
  ["operation_serial_number", [0.649, 0.09, 0.34, 0.03]],
  ["project_name", [0.158, 0.119, 0.34, 0.03]],
  ["project_code", [0.649, 0.119, 0.34, 0.03]],
  ["customer_name", [0.158, 0.148, 0.83, 0.03]],
  ["estimated_subject_count", [0.158, 0.266, 0.34, 0.03]],
  ["expected_revenue", [0.649, 0.266, 0.34, 0.03]],
  ["online_registration_start_time", [0.158, 0.558, 0.83, 0.03]],
  ["subject_count", [0.158, 0.748, 0.34, 0.03]],
  ["paper_count", [0.547, 0.747, 0.213, 0.05]],
  ["other_notes", [0.158, 0.832, 0.83, 0.035]],
];

const TEMPLATE_OPTION_REGIONS = [
  ["customer_project_attribute", [0.158, 0.178, 0.83, 0.032], ["新客户新项目", "老客户新项目", "老客户老项目"]],
  ["business_direction", [0.158, 0.207, 0.83, 0.032], ["政府", "企业", "院校", "人社"]],
  ["system_type", [0.158, 0.237, 0.83, 0.032], ["易考", "易面", "远鉴", "MTS", "待定", "其它"]],
  ["billing_basis", [0.158, 0.296, 0.83, 0.032], ["按报名科次结算", "按参考科次结算", "按开考科次结算", "其他", "待定"]],
  ["exam_service_scope", [0.158, 0.326, 0.83, 0.17], ["全流程服务", "落卖考位或监督考", "系统数据操作", "报名服务", "考务文档整理", "考生通知服务", "客服或技术支持服务", "提供顾问及咨询服务", "需备注说明"]],
  ["registration_method", [0.158, 0.498, 0.83, 0.032], ["客户提供报名表", "客户提供报名表后在线缴费", "即报即考", "考生在线报名", "集体在线报名", "其它"]],
  ["registration_website_required", [0.158, 0.527, 0.83, 0.032], ["标准网站（仅报名）", "标准网站（报名+缴费）", "定制门户", "有接口对接需求"]],
  ["ata_invigilator_arrangement", [0.158, 0.585, 0.34, 0.047], ["不需要", "需要安排分散人工监考", "需要安排集中人工监考"]],
  ["ata_central_venue_required", [0.649, 0.585, 0.34, 0.047], ["不需要", "需要"]],
  ["ata_content_participation", [0.158, 0.636, 0.49, 0.032], ["需要ATA制题或使用历史项目试卷", "不需要ATA提供制题或内容服务"]],
  ["content_source", [0.158, 0.668, 0.49, 0.044], ["ATA现有内容", "ATA命制新内容", "使用ATA历史试卷", "客户自命题"]],
  ["question_types", [0.158, 0.714, 0.83, 0.032], ["客观题", "主观题", "操作题", "听力题", "口语题", "打字题", "其它题型"]],
  ["closed_item_writing_required", [0.158, 0.773, 0.34, 0.032], ["不需要", "需要"]],
  ["manual_marking_required", [0.649, 0.773, 0.34, 0.032], ["不需要", "需要"]],
  ["epi_test_required", [0.158, 0.803, 0.34, 0.032], ["不需要", "需要"]],
  ["personality_test_tool", [0.649, 0.803, 0.34, 0.032], ["不需要", "OPA", "ATA情绪特质测评"]],
];

const TEMPLATE_MARK_REGIONS = [
  ["billing_basis", "按报名科次结算", [0.166, 0.305, 0.012, 0.014]],
  ["billing_basis", "按参考科次结算", [0.285, 0.305, 0.012, 0.014]],
  ["billing_basis", "按开考科次结算", [0.410, 0.305, 0.012, 0.014]],
  ["billing_basis", "其他", [0.528, 0.305, 0.012, 0.014]],
  ["billing_basis", "待定", [0.588, 0.305, 0.012, 0.014]],
  ["ata_invigilator_arrangement", "不需要", [0.166, 0.604, 0.012, 0.014]],
  ["ata_invigilator_arrangement", "需要安排分散人工监考", [0.244, 0.604, 0.012, 0.014]],
  ["ata_invigilator_arrangement", "需要安排集中人工监考", [0.166, 0.627, 0.012, 0.014]],
  ["ata_central_venue_required", "不需要", [0.658, 0.604, 0.012, 0.014]],
  ["ata_central_venue_required", "需要", [0.728, 0.604, 0.012, 0.014]],
  ["ata_content_participation", "需要ATA制题或使用历史项目试卷", [0.166, 0.653, 0.012, 0.014]],
  ["ata_content_participation", "不需要ATA提供制题或内容服务", [0.385, 0.653, 0.012, 0.014]],
  ["closed_item_writing_required", "不需要", [0.166, 0.797, 0.012, 0.014]],
  ["closed_item_writing_required", "需要", [0.244, 0.797, 0.012, 0.014]],
  ["manual_marking_required", "不需要", [0.658, 0.797, 0.012, 0.014]],
  ["manual_marking_required", "需要", [0.728, 0.797, 0.012, 0.014]],
  ["epi_test_required", "不需要", [0.166, 0.826, 0.012, 0.014]],
  ["epi_test_required", "需要", [0.244, 0.826, 0.012, 0.014]],
  ["personality_test_tool", "不需要", [0.658, 0.826, 0.012, 0.014]],
  ["personality_test_tool", "OPA", [0.728, 0.826, 0.012, 0.014]],
  ["personality_test_tool", "ATA情绪特质测评", [0.790, 0.826, 0.012, 0.014]],
];

const TEMPLATE_FIELDS = new Set([
  ...TEMPLATE_TEXT_REGIONS.map(([field]) => field),
  ...TEMPLATE_OPTION_REGIONS.map(([field]) => field),
  ...TEMPLATE_MARK_REGIONS.map(([field]) => field),
]);

const SAFE_NUMERIC_TEMPLATE_FALLBACK_FIELDS = new Set([
  "subject_count",
  "paper_count",
]);

const CHECKBOX_TEMPLATE_FIELDS = new Set([
  "exam_service_scope",
  "registration_method",
  "registration_website_required",
  "content_source",
  "question_types",
  "system_type",
]);

const SINGLE_CHOICE_TEMPLATE_FIELDS = new Set([
  "customer_project_attribute",
  "business_direction",
  "billing_basis",
  "ata_invigilator_arrangement",
  "ata_central_venue_required",
  "ata_content_participation",
  "closed_item_writing_required",
  "manual_marking_required",
  "epi_test_required",
  "personality_test_tool",
]);

const TEMPLATE_TABLE_BOUNDS = {
  x: 0.011,
  y: 0.035,
  width: 0.971,
  height: 0.955,
};

const TEMPLATE_IMAGE_ASPECT_RATIO = 1020 / 1004;

function normalizeSpaces(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeValue(value = "") {
  return normalizeSpaces(value)
    .replace(/[□☐○◎●◉◌]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitOcrLines(text = "") {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => normalizeSpaces(line))
    .filter(Boolean);
}

function selectedOptions(text = "") {
  const matches = [];
  const pattern = /[☑✅■●◉◎]\s*([^☐□○◌☑✅■●◉◎•]+)/g;
  let match = pattern.exec(text);
  while (match) {
    const value = normalizeValue(match[1]);
    if (value) matches.push(value);
    match = pattern.exec(text);
  }
  return matches;
}

function normalizeOptionText(value = "") {
  return normalizeSpaces(value)
    .replace(/\+/g, "＋")
    .replace(/[()]/g, (char) => char === "(" ? "（" : "）")
    .replace(/[□☐○〇◌•口厂囗凵]/g, "○")
    .replace(/[☑✅■●◉◎√✓凶区囚网]/g, "◎");
}

function optionIndexes(text, option) {
  const indexes = [];
  let start = 0;
  while (start < text.length) {
    const index = text.indexOf(option, start);
    if (index < 0) break;
    const before = text[index - 1] || "";
    if (!(option === "需要" && before === "不")) indexes.push(index);
    start = index + Math.max(1, option.length);
  }
  return indexes;
}

function nearestOptionMarkerBefore(text, index) {
  for (let cursor = index - 1; cursor >= Math.max(0, index - 12); cursor -= 1) {
    const char = text[cursor];
    if (/[◎vV]/.test(char)) return "selected";
    if (/[○]/.test(char)) return "unselected";
  }
  return "";
}

function checkboxOptionWithoutMarkerLooksSelected(text, index, field) {
  if (!CHECKBOX_TEMPLATE_FIELDS.has(field)) return false;
  const before = text.slice(Math.max(0, index - 4), index);
  if (/○\s*$/.test(before)) return false;
  return index === 0 || /\s$/.test(text[index - 1] || "");
}

function selectedOptionsByFixedOrder(text = "", options = [], field = "") {
  const normalized = normalizeOptionText(text);
  const selected = [];
  for (const option of options) {
    const aliases = [option];
    if (option === "标准网站（报名+缴费）") aliases.push("标准网站（报名＋缴费）");
    if (option === "落卖考位或监督考") aliases.push("落实考位或监督考", "洛实考位或监督考");
    const indexes = aliases.flatMap((item) => optionIndexes(normalized, normalizeOptionText(item)));
    const marked = indexes.some((index) => {
      const marker = nearestOptionMarkerBefore(normalized, index);
      return marker === "selected" || checkboxOptionWithoutMarkerLooksSelected(normalized, index, field);
    });
    if (marked) selected.push(option);
  }
  if (SINGLE_CHOICE_TEMPLATE_FIELDS.has(field) && selected.length > 1) return [selected[0]];
  return selected;
}

function fieldValueFromLine(line, label) {
  const index = line.indexOf(label);
  if (index < 0) return "";
  const nextChar = line[index + label.length] || "";
  if (nextChar && !/[:：\s]/.test(nextChar)) return "";
  const rest = line.slice(index + label.length).replace(/^[:：\s]+/, "").trim();
  if (!rest) return "";
  const nextLabelIndex = BUSINESS_FIELD_ALIASES
    .map(([, item]) => rest.indexOf(item))
    .filter((item) => item > 0)
    .sort((a, b) => a - b)[0];
  const rawValue = nextLabelIndex ? rest.slice(0, nextLabelIndex) : rest;
  return normalizeValue(rawValue);
}

function firstValueAfterLabel(lines, label) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const inlineValue = fieldValueFromLine(line, label);
    if (inlineValue) return inlineValue;
    if (line === label || line.endsWith(label)) {
      for (let next = index + 1; next < Math.min(lines.length, index + 4); next += 1) {
        const candidate = normalizeValue(lines[next]);
        if (candidate && !BUSINESS_FIELD_ALIASES.some(([, item]) => candidate === item)) return candidate;
      }
    }
  }
  return "";
}

function parseSchedule(lines) {
  const schedules = [];
  const dateOnlyIndexes = [];
  for (const [index, line] of lines.entries()) {
    const match = line.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2}).{0,20}(上午|下午|晚上|\d{1,2}:\d{2}(?:\s*[-~至]\s*\d{1,2}:\d{2})?)/);
    if (match) {
      schedules.push({
        exam_date: match[1].replace(/\//g, "-"),
        exam_time: match[2],
        note: "",
      });
      continue;
    }
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(line)) {
      dateOnlyIndexes.push(index);
    }
  }
  for (const index of dateOnlyIndexes) {
    const previousLabels = lines.slice(Math.max(0, index - 8), index);
    if (!previousLabels.some((line) => line.includes("考试日期") || line.includes("考试时间"))) continue;
    const examTime = normalizeValue(lines[index + 1] || "");
    if (!/^(上午|下午|晚上|全天|\d{1,2}:\d{2}(?:\s*[-~至]\s*\d{1,2}:\d{2})?)$/.test(examTime)) continue;
    const note = normalizeValue(lines[index + 2] || "");
    schedules.push({
      exam_date: lines[index].replace(/\//g, "-"),
      exam_time: examTime,
      note: isBusinessLabel(note) ? "" : note,
    });
  }
  return schedules;
}

function isBusinessLabel(value = "") {
  const text = normalizeSpaces(value);
  return BUSINESS_FIELD_ALIASES.some(([, label]) => text === label || text.startsWith(`${label} `));
}

function normalizeTemplateTextField(field, value) {
  if (field !== "title") return value;
  return String(value || "")
    .replace(/^页目需求任务单/, "项目需求任务单")
    .replace(/^目需求任务单/, "项目需求任务单");
}

function isNonNoteOptionValue(field, value) {
  if (field !== "other_notes") return false;
  return /^[是否\s、,，]+$/.test(String(value || ""));
}

function applyBusinessScreenshotHeuristics(lines, draft) {
  const dateIndex = lines.findIndex((line) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(line));
  if (dateIndex >= 0) {
    draft.application_date = draft.application_date && !isBusinessLabel(draft.application_date) ? draft.application_date : lines[dateIndex].replace(/\//g, "-");
    const applicant = lines[dateIndex - 1];
    if (applicant && !isBusinessLabel(applicant)) draft.applicant = draft.applicant && !isBusinessLabel(draft.applicant) ? draft.applicant : applicant;
    const projectName = lines[dateIndex + 1];
    if (projectName && !isBusinessLabel(projectName)) draft.project_name = draft.project_name && !isBusinessLabel(draft.project_name) ? draft.project_name : projectName;
  }

  const operationIndex = lines.findIndex((line) => /^R\d+/i.test(line));
  if (operationIndex >= 0) {
    draft.operation_serial_number = lines[operationIndex];
    const department = lines[operationIndex - 1];
    if (department && !isBusinessLabel(department)) draft.applicant_department = department;
  }
  const projectCode = lines.find((line) => /^F\d+/i.test(line));
  if (projectCode) draft.project_code = projectCode;

  const numericValues = lines.filter((line) => /^\d+(?:\.\d+)?$/.test(line));
  const subjectEstimate = numericValues.find((line) => Number(line) > 1);
  if (subjectEstimate) draft.estimated_subject_count = subjectEstimate;
  const revenueIndex = lines.findIndex((line) => /预估收入|预计收入/.test(line));
  if (revenueIndex >= 0) {
    const revenue = lines.slice(revenueIndex + 1).find((line) => /^\d+(?:\.\d+)?$/.test(line));
    if (revenue) draft.expected_revenue = revenue;
  }

  const billingLine = lines.find((line) => line.includes("按报名科次结算") && /[☑✅■●◉◎]/.test(line));
  const billing = selectedOptions(billingLine || "").find((item) => item.includes("结算"));
  if (billing) draft.billing_basis = billing;

  const centralVenueLine = lines.find((line) => line.includes("集中监考") && /[☑✅■●◉◎]/.test(line));
  if (centralVenueLine) {
    const options = selectedOptions(centralVenueLine);
    if (options.length) draft.ata_central_venue_required = options[0].replace(/^需要ATA安排集中监考\s*/, "");
  }

  const questionTypeLine = lines.find((line) => line.includes("客观题") && line.includes("主观题"));
  if (questionTypeLine) {
    const checked = [];
    const compact = questionTypeLine.replace(/\s+/g, "");
    if (/[vV√☑✅■]\s*客观题|[vV√☑✅■]客观题/.test(questionTypeLine) || compact.startsWith("v客观题")) checked.push("客观题");
    if (questionTypeLine.includes("主观题") && !/口\s*主观题|□\s*主观题|☐\s*主观题/.test(questionTypeLine)) checked.push("主观题");
    if (checked.length) draft.question_types = checked.join("、");
  }

  const subjectCountIndex = lines.findIndex((line) => line === "科目数");
  if (subjectCountIndex >= 0) {
    const value = lines.slice(subjectCountIndex + 1).find((line) => /^\d+$/.test(line));
    if (value) draft.subject_count = value;
  }
  const paperCountIndex = lines.findIndex((line) => line === "试卷数");
  if (paperCountIndex >= 0) {
    const value = lines.slice(paperCountIndex + 1).find((line) => /^\d+$/.test(line));
    if (value) draft.paper_count = value;
  }
}

export function parseBusinessRequirementOcr(text = "") {
  const lines = splitOcrLines(text);
  const draft = {};
  for (const [field, label] of BUSINESS_FIELD_ALIASES) {
    let value = firstValueAfterLabel(lines, label);
    if (OPTION_FIELDS.has(field)) {
      const optionLine = lines.find((line) => line.includes(label) && /[☑✅■●◉◎]/.test(line));
      const options = selectedOptions(optionLine || value);
      if (options.length) value = options.join("、");
    }
    if (value) draft[field] = value;
  }
  const schedules = parseSchedule(lines);
  if (schedules.length) draft.exam_schedule = schedules;
  applyBusinessScreenshotHeuristics(lines, draft);
  if (draft.project_name && !draft.exam_name) draft.exam_name = draft.project_name;
  return draft;
}

export function businessTemplateTextRegions() {
  return TEMPLATE_TEXT_REGIONS.map(([field, rect]) => ({ field, rect }));
}

export function businessTemplateOptionRegions() {
  return TEMPLATE_OPTION_REGIONS.map(([field, rect, options]) => ({ field, rect, options }));
}

export function businessTemplateMarkRegions() {
  return TEMPLATE_MARK_REGIONS.map(([field, label, rect]) => ({ field, label, rect }));
}

export function templateRectToImageRect(rect, frame = null) {
  if (!frame) return rect;
  const x = Number(frame.x ?? 0);
  const y = Number(frame.y ?? 0);
  const width = Number(frame.width ?? 1);
  const height = Number(frame.height ?? 1);
  return [
    x + rect[0] * width,
    y + rect[1] * height,
    rect[2] * width,
    rect[3] * height,
  ];
}

export function templateFrameFromTableBounds(bounds = null) {
  if (!bounds?.detected) return null;
  const tableX = Number(bounds.tableX ?? bounds.x ?? 0);
  const tableY = Number(bounds.tableY ?? bounds.y ?? 0);
  const tableWidth = Number(bounds.tableWidth ?? bounds.width ?? 0);
  const tableHeight = Number(bounds.tableHeight ?? bounds.height ?? 0);
  if (!(tableWidth > 0 && tableHeight > 0)) return null;
  const width = tableWidth / TEMPLATE_TABLE_BOUNDS.width;
  const imageWidth = Number(bounds.imageWidth || 0);
  const imageHeight = Number(bounds.imageHeight || 0);
  const height = imageWidth > 0 && imageHeight > 0
    ? width * TEMPLATE_IMAGE_ASPECT_RATIO * (imageWidth / imageHeight)
    : tableHeight / TEMPLATE_TABLE_BOUNDS.height;
  return {
    x: tableX - TEMPLATE_TABLE_BOUNDS.x * width,
    y: tableY - TEMPLATE_TABLE_BOUNDS.y * height,
    width,
    height,
    detected: true,
    tableBounds: { x: tableX, y: tableY, width: tableWidth, height: tableHeight },
    imageWidth: bounds.imageWidth,
    imageHeight: bounds.imageHeight,
  };
}

export function parseBusinessRequirementTemplateRegions(regions = {}, fallbackText = "", markSelections = {}) {
  const fallbackDraft = parseBusinessRequirementOcr(fallbackText);
  const draft = {};
  for (const [field, value] of Object.entries(fallbackDraft)) {
    if (!TEMPLATE_FIELDS.has(field)) draft[field] = value;
  }
  for (const [field] of TEMPLATE_TEXT_REGIONS) {
    const value = normalizeTemplateTextField(field, normalizeValue(regions[field] || ""));
    if ((field === "subject_count" || field === "paper_count") && value) {
      const number = value.match(/\d+(?:\.\d+)?/);
      if (number) draft[field] = number[0];
      continue;
    }
    if (value && !isBusinessLabel(value) && !isNonNoteOptionValue(field, value)) draft[field] = value;
  }
  for (const field of SAFE_NUMERIC_TEMPLATE_FALLBACK_FIELDS) {
    const value = fallbackDraft[field] || "";
    const numeric = Number(value);
    const safe = field === "paper_count" ? numeric > 0 && numeric <= 20 : numeric > 0;
    if (!draft[field] && /^\d+(?:\.\d+)?$/.test(value) && safe) {
      draft[field] = fallbackDraft[field];
    }
  }
  for (const [field, , options] of TEMPLATE_OPTION_REGIONS) {
    const selected = selectedOptionsByFixedOrder(regions[field] || "", options, field);
    if (selected.length) draft[field] = selected.join("、");
  }
  for (const [field] of TEMPLATE_MARK_REGIONS) {
    const selected = markSelections[field];
    if (Array.isArray(selected) && selected.length && (SINGLE_CHOICE_TEMPLATE_FIELDS.has(field) || !draft[field] || String(draft[field]).includes("、"))) {
      draft[field] = selected.join("、");
    }
  }
  if (draft.project_name && !draft.exam_name) draft.exam_name = draft.project_name;
  return draft;
}

export function normalizeBusinessRequirementDraft(input = {}) {
  const draft = {};
  const allowed = new Set([
    ...BUSINESS_FIELD_ALIASES.map(([field]) => field),
    "exam_name",
    "exam_schedule",
  ]);
  for (const [field, value] of Object.entries(input || {})) {
    if (!allowed.has(field)) continue;
    if (Array.isArray(value)) {
      draft[field] = value;
    } else if (value !== null && value !== undefined) {
      const normalized = normalizeValue(value);
      if (normalized) draft[field] = normalized;
    }
  }
  if (!draft.exam_name && draft.project_name) draft.exam_name = draft.project_name;
  return draft;
}

function firstExamScheduleTimeRange(schedule = []) {
  const first = Array.isArray(schedule) ? schedule.find((item) => item?.exam_date || item?.exam_time) : null;
  if (!first) return "";
  return normalizeSpaces([first.exam_date, first.exam_time].filter(Boolean).join(" "));
}

export function businessDraftToRequirement(draft = {}) {
  const normalized = normalizeBusinessRequirementDraft(draft);
  const requirement = { ...normalized };
  if (normalized.project_name && !requirement.exam_name) {
    requirement.exam_name = normalized.project_name;
  }
  if (!requirement.formal_exam_time_range) {
    const timeRange = firstExamScheduleTimeRange(normalized.exam_schedule);
    if (timeRange) requirement.formal_exam_time_range = timeRange;
  }
  return requirement;
}

export function businessDraftToCustomer(draft = {}) {
  const normalized = normalizeBusinessRequirementDraft(draft);
  return {
    name: normalized.customer_name || "",
    applicant: normalized.applicant || "",
    applicantDepartment: normalized.applicant_department || "",
  };
}

export function businessFieldAliases() {
  return BUSINESS_FIELD_ALIASES.map(([field, label]) => ({ field, label }));
}
