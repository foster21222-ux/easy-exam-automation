const FULLWIDTH_COLON = /：/g;

function cleanText(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(FULLWIDTH_COLON, ":")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function compactDate(value) {
  const text = cleanText(value);
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return text;
  return `${Number(match[1])}/${Number(match[2])}/${Number(match[3])}`;
}

function parseDateParts(value) {
  const text = cleanText(value);
  const match = text.match(/(\d{4})\s*[年/-]\s*(\d{1,2})\s*[月/-]\s*(\d{1,2})\s*(?:日)?/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function normalizeDate(value) {
  const text = cleanText(value);
  const match = text.match(/(\d{4})\s*[年/-]\s*(\d{1,2})\s*[月/-]\s*(\d{1,2})\s*(?:日)?/);
  if (!match) return compactDate(text);
  return `${Number(match[1])}/${Number(match[2])}/${Number(match[3])}`;
}

function normalizeTime(value) {
  const text = cleanText(value);
  const match = text.match(/(\d{1,2})\s*:\s*(\d{2})(?::\d{2})?/);
  if (!match) return "";
  return `${Number(match[1])}:${match[2]}:00`;
}

function formatDateTimeRange(value) {
  const text = cleanText(value);
  const date = normalizeDate(text);
  const range = normalizeTimeRange(text);
  if (!date || !range) return "";
  const [start, end] = range.split("-");
  return `${date} ${start}-${date} ${end}`;
}

function deriveTrialRange(examRange) {
  const text = cleanText(examRange);
  const parts = parseDateParts(text);
  if (!parts) return "";
  const date = new Date(parts.year, parts.month - 1, parts.day - 1);
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${y}/${m}/${d} 10:00:00-${y}/${m}/${d} 17:00:00`;
}

function normalizeTimeRange(value) {
  const text = cleanText(value);
  const parts = text.split(/\s*(?:-|~|至|—|–)\s*/).map(normalizeTime).filter(Boolean);
  if (parts.length !== 2) return "";
  return parts.join("-");
}

function formatExamRange(scene) {
  const date = compactDate(scene?.["考试日期"]);
  const range = normalizeTimeRange(scene?.["场次安排说明"]);
  if (!date) return "";
  if (!range) {
    const timeLabel = cleanText(scene?.["考试时间"]);
    return timeLabel ? `${date} ${timeLabel}` : date;
  }
  const [start, end] = range.split("-");
  return `${date} ${start}-${date} ${end}`;
}

function extractRuleMinutes(ruleText) {
  const text = cleanText(ruleText);
  const early = text.match(/提前登录\s*(\d+)\s*分钟/);
  const late = text.match(/迟到(?:时间)?\s*(\d+)\s*分钟/);
  return {
    earlyLogin: early ? `${Number(early[1])}分钟` : "",
    lateLimit: late ? `${Number(late[1])}分钟` : "",
  };
}

function firstNonEmpty(...values) {
  return values.map(cleanText).find(Boolean) ?? "";
}

function deriveExamName(fields) {
  const projectName = firstNonEmpty(fields["项目名称"], fields["标题"]);
  const rawOther = cleanText(fields["其他说明"]);
  const splitCollapsedOther = rawOther
    .replace(/(有限公司|研究院|集团|学校|中心)\s+([^，,；;\n]+(?:考试|笔试|面试|测评|招聘|校招|统考|联考|考核))/g, "$1\n$2");
  const otherLines = splitCollapsedOther
    .split(/\n+/)
    .map((line) => line.replace(/^[\d、.．)\s-]+/, "").trim())
    .filter(Boolean)
    .filter((line) => !/^(无|暂无|详见附件|见附件|备注|说明)$/i.test(line));
  const nameLikeLines = otherLines.filter((line) => {
    if (line.length < 4 || line.length > 80) return false;
    if (/[:：]/.test(line)) return false;
    return /(考试|笔试|面试|测评|招聘|校招|统考|联考|考核)/.test(line);
  });
  if (nameLikeLines.length) return nameLikeLines.join("\n");
  return projectName;
}

function summarizeOpaRows(rows = []) {
  return rows
    .map((row) => {
      const seq = cleanText(row["序号"]);
      const tool = cleanText(row["OPA测评工具"]);
      const norm = cleanText(row["常模类型"]);
      const report = cleanText(row["OPA报告类型"]);
      const note = cleanText(row["备注"]);
      const instant = cleanText(row["是否即测即出报告"]);
      const minutes = cleanText(row["时长（分钟）"]);
      const parts = [
        seq ? `${seq}.` : "",
        tool,
        norm ? `常模：${norm}` : "",
        report ? `报告：${report}` : "",
        note ? `备注：${note}` : "",
        instant ? `即测即出：${instant}` : "",
        minutes ? `时长：${minutes}分钟` : "",
      ].filter(Boolean);
      return parts.join(" ");
    })
    .filter(Boolean)
    .join("\n");
}

export function mapFanweiToRequirementFields(fanwei) {
  const fields = fanwei?.fields ?? {};
  const confirmationFields = fanwei?.serviceConfirmation?.fields ?? {};
  const sceneRows = fanwei?.examSceneRows ?? [];
  const opaRows = fanwei?.opaRows ?? [];
  const firstScene = sceneRows[0] ?? {};
  const examRange = firstNonEmpty(formatDateTimeRange(confirmationFields["考试时间"]), formatExamRange(firstScene));
  const examName = firstNonEmpty(confirmationFields["考试名称"], deriveExamName(fields));
  const ruleMinutes = extractRuleMinutes(confirmationFields["考场规则"]);
  const projectCode = cleanText(fields["项目编码"]);
  const serialNo = cleanText(fields["运控流水号"]);
  const hasSubjective = cleanText(fields["试题类型"]).includes("主观题");
  const needsManualMarking = cleanText(fields["是否需要人工阅卷"]).includes("需要");
  const onlyPersonality = cleanText(fields["考核内容是否仅性格测试"]).includes("是");
  const subjectName = onlyPersonality ? "OPA测评" : firstNonEmpty(examName, fields["项目名称"], "综合科目");
  const notes = [
    confirmationFields["单位名称"] ? `单位名称：${cleanText(confirmationFields["单位名称"])}` : "",
    confirmationFields["预计人次"] ? `预计人次：${cleanText(confirmationFields["预计人次"])}` : "",
    confirmationFields["科目数量"] ? `科目数量：${cleanText(confirmationFields["科目数量"])}` : "",
    confirmationFields["考场规则"] ? `考场规则：${cleanText(confirmationFields["考场规则"])}` : "",
    confirmationFields["ATA人工监考"] ? `ATA人工监考：${cleanText(confirmationFields["ATA人工监考"])}` : "",
    confirmationFields["在线巡考"] ? `在线巡考：${cleanText(confirmationFields["在线巡考"])}` : "",
    confirmationFields["阅卷"] ? `阅卷：${cleanText(confirmationFields["阅卷"])}` : "",
    serialNo ? `泛微流水号：${serialNo}` : "",
    fanwei?.requestid ? `泛微requestid：${fanwei.requestid}` : "",
    projectCode ? `项目编码：${projectCode}` : "",
    fields["系统类型"] ? `系统类型：${cleanText(fields["系统类型"])}` : "",
    fields["考试服务范围"] ? `考试服务范围：${cleanText(fields["考试服务范围"])}` : "",
    fields["报名方式"] ? `报名方式：${cleanText(fields["报名方式"])}` : "",
    fields["是否需要报名网站"] ? `是否需要报名网站：${cleanText(fields["是否需要报名网站"])}` : "",
    fields["是否需要ATA安排人工监考"] ? `人工监考：${cleanText(fields["是否需要ATA安排人工监考"])}` : "",
    fields["是否需要ATA安排集中监考场地"] ? `集中场地：${cleanText(fields["是否需要ATA安排集中监考场地"])}` : "",
    fields["ATA内容制题参与方式"] ? `内容制题：${cleanText(fields["ATA内容制题参与方式"])}` : "",
    fields["内容来源"] ? `内容来源：${cleanText(fields["内容来源"])}` : "",
    fields["试题类型"] ? `试题类型：${cleanText(fields["试题类型"])}` : "",
    fields["其他说明"] ? `其他说明：${cleanText(fields["其他说明"])}` : "",
    opaRows.length ? `OPA明细：\n${summarizeOpaRows(opaRows)}` : "",
  ].filter(Boolean).join("\n");

  return {
    "考试名称": examName,
    "考试日期时间": examRange,
    "试考日期时间": deriveTrialRange(examRange),
    "提前登录时间": ruleMinutes.earlyLogin,
    "限制迟到时间": ruleMinutes.lateLimit,
    "人工判分": hasSubjective && needsManualMarking ? "旧版判分（包含系统判分及悦评对接）" : "否",
    "科目信息": subjectName,
    "特殊配置说明": notes,
  };
}

function appendPreview(rows, label, value, source) {
  const cleaned = cleanText(value);
  if (!cleaned) return;
  if (cleaned === "未识别") return;
  rows.push({ label, value: cleaned, source });
}

function isCheckedValue(value) {
  const text = cleanText(value);
  if (!text) return false;
  if (/标准网站（仅报名）\s*标准网站（报名\+缴费）\s*定制门户\s*有接口对接需求/.test(text)) return false;
  return !/(未识别|不需要|无需|否|未勾选)/.test(text);
}

function normalizeChoiceValue(value) {
  const text = cleanText(value);
  if (!text.includes("；")) return text;
  const parts = text.split("；").map(cleanText).filter(Boolean);
  const positive = parts.filter((part) => !/^(不需要|无需|否|未勾选)$/.test(part));
  return positive[0] || parts[0] || text;
}

export function buildFanweiRequirementModel(fanwei) {
  const normalized = normalizeFanweiDomPayload(fanwei);
  const fields = normalized.fields;
  for (const key of [
    "是否需要ATA安排人工监考",
    "是否需要ATA安排集中监考场地",
    "是否需要人工阅卷",
    "是否需要封闭制题",
    "EPI测试",
    "性格测试工具",
  ]) {
    fields[key] = normalizeChoiceValue(fields[key]);
  }
  const confirmationFields = normalized.serviceConfirmation?.fields ?? {};
  const mapped = mapFanweiToRequirementFields(normalized);
  const ruleMinutes = extractRuleMinutes(confirmationFields["考场规则"]);
  const subjectCount = firstNonEmpty(fields["科目数"], confirmationFields["科目数量"]);
  const paperCount = firstNonEmpty(fields["试卷数"]);
  const hasSubjective = cleanText(fields["试题类型"]).includes("主观题");
  const needsManualReview = cleanText(fields["是否需要人工阅卷"]).includes("需要");
  const requirementFields = {
    "考试名称": mapped["考试名称"],
    "考试日期时间": mapped["考试日期时间"],
    "试考日期时间": mapped["试考日期时间"],
    "提前登录时间": ruleMinutes.earlyLogin || "30分钟",
    "限制迟到时间": ruleMinutes.lateLimit || "20分钟",
    "试卷扣时规则": "迟到及离开扣时",
    "考试地址": "统一考试地址",
    "视频监控": "需要",
    "视频录制": "开启录制",
    "鹰眼监控": "需要",
    "考试类型": "客户端考试",
    "登陆次数": "10",
    "人工判分": hasSubjective && needsManualReview ? "旧版判分（包含系统判分及悦评对接）" : "否",
    "科目信息": mapped["科目信息"],
  };

  const previewFields = [];
  appendPreview(previewFields, "运控流水号", fields["运控流水号"], "泛微主表");
  appendPreview(previewFields, "项目编码", fields["项目编码"], "泛微主表");
  appendPreview(previewFields, "项目名称", fields["项目名称"], "泛微主表");
  appendPreview(previewFields, "考试服务范围", fields["考试服务范围"], "泛微主表");
  appendPreview(previewFields, "报名方式", fields["报名方式"], "泛微主表");
  appendPreview(previewFields, "单位名称", confirmationFields["单位名称"], "服务确认单");
  appendPreview(previewFields, "考试名称", mapped["考试名称"], "服务确认单");
  appendPreview(
    previewFields,
    "考试时间",
    mapped["考试日期时间"],
    confirmationFields["考试时间"] ? "服务确认单" : "泛微主表",
  );
  appendPreview(previewFields, "考场规则", confirmationFields["考场规则"], "服务确认单");
  appendPreview(previewFields, "预估科次", fields["预估科次"], "泛微主表");
  appendPreview(previewFields, "内容来源", fields["内容来源"], "泛微主表");
  appendPreview(previewFields, "试题类型", fields["试题类型"], "泛微主表");
  appendPreview(previewFields, "科目数量", subjectCount, subjectCount === cleanText(fields["科目数"]) ? "泛微主表" : "服务确认单");
  appendPreview(previewFields, "试卷数量", paperCount, "泛微主表");
  appendPreview(previewFields, "是否人工阅卷", fields["是否需要人工阅卷"], "泛微主表");
  appendPreview(previewFields, "阅卷安排", fields["阅卷安排"], "泛微主表");
  appendPreview(previewFields, "人工监考", fields["是否需要ATA安排人工监考"], "泛微主表");
  appendPreview(previewFields, "EPI测试", fields["EPI测试"], "泛微主表");
  appendPreview(previewFields, "性格测试工具", fields["性格测试工具"], "泛微主表");
  appendPreview(previewFields, "OPA明细", summarizeOpaRows(normalized.opaRows), "泛微主表");
  if (isCheckedValue(fields["是否需要报名网站"])) {
    appendPreview(previewFields, "是否需要报名网站", fields["是否需要报名网站"], "泛微主表");
  }
  appendPreview(previewFields, "其他说明", fields["其他说明"], "泛微主表");

  return {
    requestid: normalized.requestid,
    fields: {
      ...fields,
      ...confirmationFields,
      "考试名称": mapped["考试名称"],
      "考试日期时间": mapped["考试日期时间"],
      "试考日期时间": mapped["试考日期时间"],
      "科目数量": subjectCount,
      "试卷数量": paperCount,
      "人工监考": fields["是否需要ATA安排人工监考"],
      "科目信息": mapped["科目信息"],
    },
    requirementFields,
    previewFields,
  };
}

export function buildFanweiRequirementPreview(fanwei) {
  const mapped = mapFanweiToRequirementFields(fanwei);
  const certain = {};
  const needsReview = {};
  for (const [key, value] of Object.entries(mapped)) {
    if (!value) {
      needsReview[key] = "泛微单未提供，需人工确认";
    } else if (key === "特殊配置说明") {
      needsReview[key] = value;
    } else {
      certain[key] = value;
    }
  }
  return { certain, needsReview };
}

export function validateFanweiReadPayload(payload, expectedSerialNo = "") {
  const serialNo = cleanText(expectedSerialNo);
  if (!serialNo) throw new TypeError("请填写泛微流水号。");
  const normalized = normalizeFanweiDomPayload(payload);
  const meaningfulFields = Object.entries(normalized.fields)
    .filter(([key, value]) => cleanText(key) && cleanText(value));
  if (!meaningfulFields.length) {
    throw new TypeError("泛微读取没有返回可用字段，字段不能为空。");
  }
  const returnedSerialNo = cleanText(normalized.fields["运控流水号"]);
  if (!returnedSerialNo) {
    throw new TypeError("泛微读取结果未返回运控流水号。");
  }
  if (returnedSerialNo !== serialNo) {
    throw new TypeError(`泛微读取返回流水号 ${returnedSerialNo}，与输入流水号 ${serialNo} 不一致。`);
  }
  return normalized;
}

export function normalizeFanweiDomPayload(payload) {
  const fields = {};
  for (const [key, value] of Object.entries(payload?.fields ?? {})) {
    fields[cleanText(key)] = cleanText(value);
  }
  const serviceFields = {};
  for (const [key, value] of Object.entries(payload?.serviceConfirmation?.fields ?? {})) {
    serviceFields[cleanText(key)] = cleanText(value);
  }
  return {
    requestid: cleanText(payload?.requestid),
    fields,
    serviceConfirmation: { fields: serviceFields },
    examSceneRows: Array.isArray(payload?.examSceneRows) ? payload.examSceneRows : [],
    opaRows: Array.isArray(payload?.opaRows) ? payload.opaRows : [],
  };
}
