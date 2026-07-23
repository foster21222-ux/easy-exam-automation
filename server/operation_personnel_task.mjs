import { createHash, randomUUID } from "node:crypto";
import { operationBatchCodeIsValid } from "./operation_batch.mjs";

const SCHEMA_VERSION = 1;
const RECIPIENT_RULES = Object.freeze({
  test: { toGroup: "演示组", toNames: ["张乐翔"], ccGroup: "", ccCount: 0 },
  production: { toGroup: "拓展二部", toNames: ["唐润梅"], ccGroup: "结算组", ccCount: 4 },
});

function text(value) {
  return String(value ?? "").trim();
}

function confirmedTruthy(value) {
  return value === true || ["是", "需要", "true", "1"].includes(text(value).toLowerCase());
}

function taskRequirements(task) {
  const items = task.config?.examRequirements;
  return Array.isArray(items) && items.length
    ? items
    : (task.config?.examRequirement?.fields ? [task.config.examRequirement] : []);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function subjectStableKey(course, existing = {}, makeId = randomUUID) {
  const code = text(course?.code || course?.course_code);
  if (code) return `course:${code}`;
  const seed = text(course?.personnelSubjectKey || existing.subjectKey);
  return seed || `subject:${makeId()}`;
}

function assignScheduleCodes(entries, previousMap = {}) {
  const used = Object.values(previousMap).map((item) => Number(item.scheduleCode || 0));
  let nextCode = Math.max(0, ...used) + 1;
  const scheduleCodeMap = { ...previousMap };
  const schedules = entries.map((entry) => {
    const previous = scheduleCodeMap[entry.scheduleEntryId];
    const scheduleCode = Number(previous?.scheduleCode || nextCode++);
    scheduleCodeMap[entry.scheduleEntryId] = {
      scheduleEntryId: entry.scheduleEntryId,
      scheduleCode,
      subjectKey: entry.subjectKey,
      requirementId: entry.requirementId,
      sessionType: entry.sessionType,
      courseIndex: entry.courseIndex,
    };
    return { ...entry, scheduleCode };
  });
  return { schedules, scheduleCodeMap };
}

function dateValue(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatShanghaiDate(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function daysBefore(dateText, days) {
  const parsed = dateValue(dateText);
  if (!Number.isFinite(parsed)) return "";
  return formatShanghaiDate(parsed - days * 24 * 60 * 60 * 1000);
}

function simultaneousCandidatePeak(sessions) {
  const events = sessions.flatMap((session) => {
    const start = dateValue(session.start);
    const end = dateValue(session.end);
    const count = Number(session.candidateCount || session.candidate_count || 0);
    return Number.isFinite(start) && Number.isFinite(end) && end > start && count > 0
      ? [{ at: start, delta: count }, { at: end, delta: -count }]
      : [];
  }).sort((left, right) => left.at - right.at || left.delta - right.delta);
  let current = 0;
  let peak = 0;
  for (const event of events) {
    current += event.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

function includesTrialMonitoring(task, requirement) {
  return requirement?.config?.trialMonitoringRequired === true
    || task.config?.trialMonitoringRequired === true
    || [requirement?.fields?.["试考监考"], task.config?.businessRequirement?.trial_monitoring_required]
      .some((value) => ["是", "需要", "true"].includes(text(value).toLowerCase()));
}

function scheduleRows(task, previousMap, makeId, warnings) {
  const rows = [];
  for (const requirement of taskRequirements(task)) {
    const config = requirement.config || {};
    const sessionType = text(config.sessionType) === "trial" || config.isTrial === true ? "trial" : "formal";
    if (sessionType === "trial" && !includesTrialMonitoring(task, requirement)) continue;
    const courses = Array.isArray(config.courses) && config.courses.length
      ? config.courses
      : [{ name: requirement.fields?.["考试名称"] }];
    courses.forEach((course, courseIndex) => {
      const requirementId = text(requirement.id) || `requirement-${courseIndex + 1}`;
      const existing = Object.values(previousMap).find((item) => item.requirementId === requirementId
        && item.sessionType === sessionType && Number(item.courseIndex) === courseIndex) || {};
      const subjectKey = subjectStableKey(course, existing, makeId);
      const scheduleEntryId = `${requirementId}:${sessionType}:${subjectKey}`;
      const start = text(config.startTimeDisplay || config.start || requirement.fields?.["考试日期时间"]);
      const end = text(config.endTimeDisplay || config.end);
      const startAt = dateValue(start);
      const endAt = dateValue(end);
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
        warnings.push({ code: "INVALID_SCHEDULE_RANGE", scheduleEntryId });
      }
      rows.push({
        scheduleEntryId,
        requirementId,
        sessionType,
        subjectKey,
        courseIndex,
        subjectCode: text(course?.code || course?.course_code),
        subjectName: text(course?.name || course?.course_name || requirement.fields?.["考试名称"]),
        start,
        end,
        earlyLoginMinutes: Number(config.earlyLoginMinutes || 0),
      });
    });
  }
  return rows.sort((left, right) => dateValue(left.start) - dateValue(right.start));
}

function unsupported(task) {
  const business = task.config?.businessRequirement || {};
  const service = text(business.ata_invigilator_arrangement);
  return !service.includes("分散人工监考")
    || confirmedTruthy(business.highEndSupplementRequired)
    || confirmedTruthy(business.high_end_supplement_required);
}

function sourceVersion(task) {
  const requirements = taskRequirements(task);
  return {
    requirements: requirements.map((item) => ({ id: text(item.id), version: Number(item.version || 0) })),
    fanwei: Number(task.config?.fanweiSource?.version || 0),
  };
}

export function buildOperationPersonnelTaskDraft(task = {}, options = {}) {
  const environment = text(options.environment || task.config?.operationPersonnelTask?.environment || "test");
  const recipientsRule = RECIPIENT_RULES[environment];
  const warnings = [];
  if (!recipientsRule) warnings.push({ code: "INVALID_RECIPIENT_ENVIRONMENT", environment });
  const previousMap = options.scheduleCodeMap || task.config?.operationPersonnelTask?.scheduleCodeMap || {};
  const rows = scheduleRows(task, previousMap, options.makeId || randomUUID, warnings);
  const { schedules, scheduleCodeMap } = assignScheduleCodes(rows, previousMap);
  const formalSchedules = schedules.filter((item) => item.sessionType === "formal");
  const peak = simultaneousCandidatePeak((Array.isArray(task.sessions) ? task.sessions : [])
    .filter((session) => text(session.sessionType || "formal") === "formal"));
  const estimated = Number(
    task.config?.operationBatch?.estimatedMaxSubjectCount
    || task.config?.operationBatch?.draft?.fields?.estimatedMaxSubjectCount?.value
    || task.config?.estimatedMaxSubjectCount
    || 0,
  );
  const candidateBasis = peak || (estimated > 0 ? estimated : "");
  if (!candidateBasis) warnings.push({ code: "MONITOR_COUNT_REQUIRED" });
  const earliestStart = formalSchedules.map((item) => item.start).sort((left, right) => dateValue(left) - dateValue(right))[0] || "";
  const now = options.now || new Date().toISOString();
  const today = formatShanghaiDate(dateValue(now));
  const due = daysBefore(earliestStart, 3);
  const validDates = due && due >= today;
  if (!validDates) warnings.push({ code: "PERSONNEL_DATES_REQUIRED" });
  if (unsupported(task)) warnings.push({ code: "UNSUPPORTED_PERSONNEL_TASK" });
  const recipients = recipientsRule
    ? { ...recipientsRule, toNames: [...recipientsRule.toNames], ruleVersion: 1 }
    : { toGroup: "", toNames: [], ccGroup: "", ccCount: 0, ruleVersion: 1 };
  return {
    schemaVersion: SCHEMA_VERSION,
    environment,
    batch: {
      code: text(task.config?.operationBatchCode || task.config?.operationBatch?.code),
      operationTaskSerial: text(task.config?.businessRequirement?.operation_serial_number),
      projectCode: text(task.config?.businessRequirement?.project_code),
      projectName: text(task.config?.businessRequirement?.project_name || task.projectName),
    },
    schedules,
    personnel: {
      serviceType: "ATA 监考－分散在线监考",
      platform: "悦站",
      loginMonitoring: "是",
      monitorRatio: "1:50",
      candidateBasis,
      monitorCount: candidateBasis ? Math.max(1, Math.ceil(candidateBasis / 50)) : "",
      earliestLoginMinutes: Math.max(0, ...formalSchedules.map((item) => item.earlyLoginMinutes)),
      trialIncluded: schedules.some((item) => item.sessionType === "trial"),
    },
    dates: { start: today, end: validDates ? due : "", nameListDue: validDates ? due : "" },
    recipients,
    sourceVersion: sourceVersion(task),
    warnings,
    scheduleCodeMap,
  };
}

export function operationPersonnelTaskFingerprint(draft) {
  const material = {
    environment: draft.environment,
    batch: draft.batch,
    schedules: draft.schedules,
    personnel: draft.personnel,
    dates: draft.dates,
    recipients: {
      ruleVersion: draft.recipients.ruleVersion,
      toGroup: draft.recipients.toGroup,
      toNames: draft.recipients.toNames,
      ccGroup: draft.recipients.ccGroup,
      ccCount: draft.recipients.ccCount,
    },
  };
  return createHash("sha256").update(stableJson(material)).digest("hex");
}

function changedFields(before, after, prefix = "") {
  const fields = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const left = before?.[key];
    const right = after?.[key];
    if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
      fields.push(...changedFields(left, right, path));
    } else if (stableJson(left) !== stableJson(right)) {
      fields.push({ path, before: left ?? "", after: right ?? "" });
    }
  }
  return fields;
}

const FIELD_LABELS = { "dates.start": "人员落实开始日期", "dates.end": "人员落实结束日期", "dates.nameListDue": "人员名单提交日期" };

export function diffOperationPersonnelTaskDrafts(before = {}, after = {}) {
  const beforeById = new Map((before.schedules || []).map((item) => [item.scheduleEntryId, item]));
  const afterById = new Map((after.schedules || []).map((item) => [item.scheduleEntryId, item]));
  const added = [...afterById].filter(([id]) => !beforeById.has(id)).map(([, item]) => item);
  const deleted = [...beforeById].filter(([id]) => !afterById.has(id)).map(([, item]) => item);
  const changed = [...afterById].filter(([id, item]) => beforeById.has(id) && stableJson(beforeById.get(id)) !== stableJson(item))
    .map(([id, item]) => ({ before: beforeById.get(id), after: item }));
  const fields = [
    ...changedFields(before.dates, after.dates, "dates"),
    ...changedFields(before.personnel, after.personnel, "personnel"),
  ];
  const parts = [];
  if (added.length) parts.push(`考试日程：新增 ${added.length} 项`);
  if (changed.length) parts.push(`考试日程：修改 ${changed.length} 项`);
  if (deleted.length) parts.push(`考试日程：删除 ${deleted.length} 项`);
  for (const field of fields) parts.push(`${FIELD_LABELS[field.path] || field.path}：${field.before} → ${field.after}`);
  return { schedules: { added, changed, deleted }, fields, summary: parts.join("；") };
}

export function buildOperationPersonnelTaskStatus(task = {}, draft = {}) {
  const state = task.config?.operationPersonnelTask || {};
  const persistent = text(state.status);
  const actions = (id, label) => [{ id, label }];
  if ((draft.warnings || []).some((item) => item.code === "INVALID_RECIPIENT_ENVIRONMENT")) return { status: "unsupported", actions: [] };
  if (["operation_conflict", "result_unknown", "failed_resumable"].includes(persistent)) {
    return {
      status: persistent,
      actions: persistent === "result_unknown" ? actions("recheck", "重新核对发送记录") : actions("resume", persistent === "failed_resumable" ? "继续未完成流程" : "检查并发送人员任务单"),
    };
  }
  if (!operationBatchCodeIsValid(draft.batch?.code)) return { status: "waiting_batch", actions: [] };
  const fingerprint = operationPersonnelTaskFingerprint(draft);
  if (state.lastSuccessfulFingerprint && state.lastSuccessfulFingerprint === fingerprint) return { status: "sent", actions: [] };
  if (state.lastSuccessfulFingerprint) return { status: "changes_pending", actions: actions("preview_resend", "检查变更并重新发送") };
  if (persistent === "changes_pending") return { status: "changes_pending", actions: actions("preview_resend", "检查变更并重新发送") };
  if (persistent === "sent") return { status: "sent", actions: [] };
  if ((draft.warnings || []).some((item) => item.code === "UNSUPPORTED_PERSONNEL_TASK")) return { status: "unsupported", actions: [] };
  if (state.pendingChange === true || task.config?.pendingChange === true) return { status: "blocked_pending_change", actions: [] };
  if ((draft.warnings || []).length) return { status: "needs_review", actions: actions("preview", "检查并发送人员任务单") };
  return { status: "ready", actions: actions("preview", "检查并发送人员任务单") };
}
