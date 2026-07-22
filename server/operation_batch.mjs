import { OPERATION_BATCH_RECONCILIATION_REQUIRED } from "./operation_batch_runner.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function field(value, source, label) {
  return { value: text(value), source, label };
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return "";
}

function numberText(value) {
  const raw = text(value).replace(/,/g, "");
  if (!raw) return "";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return raw;
  return Number.isInteger(parsed) ? String(parsed) : String(parsed);
}

function scheduleDates(business = {}) {
  const dates = Array.isArray(business.exam_schedule)
    ? business.exam_schedule.map((item) => text(item?.exam_date)).filter(Boolean)
    : [];
  if (dates.length) {
    return { start: dates[0], end: dates[dates.length - 1] };
  }
  const range = text(business.formal_exam_time_range);
  const matches = [...range.matchAll(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g)].map((item) => item[0].replaceAll("/", "-"));
  return { start: matches[0] || "", end: matches[matches.length - 1] || matches[0] || "" };
}

function batchNameFromBusiness(business = {}) {
  const projectName = text(business.project_name || business.exam_name);
  const { start } = scheduleDates(business);
  if (!projectName) return "";
  if (!start) return projectName;
  const match = start.match(/^(\d{4})-(\d{1,2})-/);
  return match ? `${projectName}_${match[1]}年${Number(match[2])}月` : projectName;
}

function centralVenueNotRequired(value) {
  const normalized = text(value);
  return normalized === "不需要" || normalized.includes("不需要");
}

function defaultSystemType(value) {
  const normalized = text(value);
  return normalized || "易考";
}

function operationBusinessDepartment(value) {
  const normalized = text(value);
  if (normalized.includes("办事处")) return { value: "地方业务中心", source: "default_rule" };
  return { value: normalized, source: "business_requirement" };
}

function personnelServiceFromInvigilatorArrangement(value) {
  const normalized = text(value);
  if (!normalized) return { value: "", source: "manual" };
  if (normalized.includes("不需要")) return { value: "不需要", source: "business_requirement" };
  if (normalized.includes("分散")) return { value: "分散人工监考", source: "business_requirement" };
  if (normalized.includes("集中")) return { value: "集中人工监考", source: "business_requirement" };
  return { value: normalized, source: "business_requirement" };
}

function buildWarnings(fields) {
  const warnings = [];
  for (const [key, item] of Object.entries(fields)) {
    if (!item.value && item.required) {
      warnings.push({ field: key, message: `${item.label}缺失，需要人工补充` });
    }
  }
  return warnings;
}

export function buildOperationBatchDraft(task = {}, overrides = {}) {
  const business = task.config?.businessRequirement || {};
  const estimatedCount = numberText(business.estimated_subject_count);
  const dates = scheduleDates(business);
  const systemType = defaultSystemType(business.system_type);
  const noCentralVenue = centralVenueNotRequired(business.ata_central_venue_required);
  const businessDepartment = operationBusinessDepartment(business.applicant_department);
  const servicePersonnel = personnelServiceFromInvigilatorArrangement(business.ata_invigilator_arrangement);
  const fields = {
    operationTaskSerial: field(business.operation_serial_number, "business_requirement", "考试需求任务单"),
    projectCode: field(business.project_code, "business_requirement", "项目编码"),
    projectName: field(firstNonEmpty(business.project_name, task.projectName), "business_requirement", "项目名称"),
    businessDirection: field(business.business_direction, "business_requirement", "业务方向"),
    businessDepartment: field(businessDepartment.value, businessDepartment.source, "业务部归属"),
    businessOwner: field(business.applicant, "business_requirement", "业务负责人"),
    batchName: field(batchNameFromBusiness(business), "default_rule", "批次名称"),
    projectDepartment: field("项目实施五部", "default_rule", "项目部归属"),
    examStartDate: field(dates.start, "business_requirement", "考试开始日期"),
    examEndDate: field(dates.end, "business_requirement", "考试结束日期"),
    serviceExam: field(systemType === "易考" ? "易考" : systemType, "default_rule", "考试服务"),
    servicePersonnel: field(servicePersonnel.value, servicePersonnel.source, "人员服务"),
    estimatedTotalSubjectCount: field(estimatedCount, "business_requirement", "预估总考量"),
    estimatedMaxSubjectCount: field(estimatedCount, "default_rule", "预估单场最大科次数"),
    estimatedCityCount: field(noCentralVenue ? "0" : "", noCentralVenue ? "default_rule" : "manual", "预估城市数"),
    systemType: field(systemType, business.system_type ? "business_requirement" : "default_rule", "系统类型"),
    stationUsage: field(noCentralVenue ? "无需考站" : "", noCentralVenue ? "default_rule" : "manual", "使用考站情况"),
    arrangementService: field(systemType === "易考" ? "其它" : "", systemType === "易考" ? "default_rule" : "manual", "编排服务"),
    onlineSettlementArrangementSource: field(systemType === "易考" ? "其它" : "", systemType === "易考" ? "default_rule" : "manual", "在线结算编排来源"),
    billingBasis: field(business.billing_basis, "business_requirement", "结算依据"),
    remark: field("", "manual", "备注"),
  };
  for (const [key, value] of Object.entries(overrides.fields || {})) {
    if (!fields[key]) continue;
    fields[key] = { ...fields[key], value: text(value), source: "manual" };
  }
  fields.operationTaskSerial.required = true;
  fields.batchName.required = true;
  fields.projectDepartment.required = true;
  fields.servicePersonnel.required = true;
  fields.estimatedTotalSubjectCount.required = true;
  fields.estimatedMaxSubjectCount.required = true;
  fields.estimatedCityCount.required = true;
  fields.systemType.required = true;
  fields.stationUsage.required = true;
  fields.arrangementService.required = true;
  fields.onlineSettlementArrangementSource.required = true;
  fields.billingBasis.required = true;

  return {
    project: {
      taskId: text(task.taskId),
      projectName: text(task.projectName || business.project_name),
      requirementRequestId: text(task.config?.requirementRequestId || task.config?.initialRequirementRequestId),
    },
    fields,
    warnings: buildWarnings(fields),
    createdAt: new Date().toISOString(),
  };
}

export function applyOperationBatchResult(task = {}, result = {}) {
  const code = text(result.operationBatchCode || result.code);
  if (!code) throw new Error("缺少运营批次代码");
  if (!operationBatchCodeIsValid(code)) throw new Error("运营批次代码格式不合法");
  const current = task.config?.operationBatch || {};
  const events = Array.isArray(current.events) ? current.events.slice() : [];
  events.push({
    type: text(result.eventType || "operation_batch_created"),
    code,
    status: text(result.status || "created_unpublished"),
    at: new Date().toISOString(),
  });
  return {
    operationBatchCode: code,
    operationBatch: {
      ...current,
      code,
      batchGuid: text(result.batchGuid),
      detailUrl: text(result.detailUrl),
      status: text(result.status || "created_unpublished"),
      errorCode: "",
      errorMessage: "",
      updatedAt: new Date().toISOString(),
      events,
    },
  };
}

export function resolveOperationBatchResultWrite(task = {}, result = {}) {
  const operationBatchCode = text(result.operationBatchCode || result.code);
  if (!operationBatchCode) throw new Error("缺少运营批次代码");
  if (!operationBatchCodeIsValid(operationBatchCode)) throw new Error("运营批次代码格式不合法");
  const existingCodes = [
    text(task.config?.operationBatchCode),
    text(task.config?.operationBatch?.code),
  ];
  const existingOperationBatchCode = existingCodes.find(operationBatchCodeIsValid)
    || firstNonEmpty(...existingCodes);
  if (operationBatchCodeIsValid(existingOperationBatchCode)) {
    return {
      status: existingOperationBatchCode === operationBatchCode ? "idempotent" : "conflict",
      operationBatchCode,
      existingOperationBatchCode,
    };
  }
  return {
    status: "apply",
    operationBatchCode,
    patch: applyOperationBatchResult(task, result),
  };
}

export function operationBatchCodeIsValid(value) {
  return /^[A-Z]{3}\d{6}$/.test(text(value));
}

export function operationBatchNeedsReconciliation(task = {}) {
  const current = task.config?.operationBatch || {};
  const code = firstNonEmpty(task.config?.operationBatchCode, current.code);
  if (operationBatchCodeIsValid(code)) return false;
  if (code) return true;
  return current.status === "creating"
    || current.status === "reconciliation_required"
    || current.errorCode === OPERATION_BATCH_RECONCILIATION_REQUIRED
    || current.errorMessage === "创建完成，但未能从详情页读取批次代码";
}

export function operationBatchDraftForReconciliation(task = {}) {
  const savedDraft = task.config?.operationBatch?.draft;
  if (savedDraft && typeof savedDraft === "object" && !Array.isArray(savedDraft)) {
    return savedDraft;
  }
  return buildOperationBatchDraft(task);
}

export function operationBatchFailureState(error, externalBatchConfirmed = false) {
  const reconciliationRequired = externalBatchConfirmed
    || error?.code === OPERATION_BATCH_RECONCILIATION_REQUIRED;
  return {
    status: reconciliationRequired ? "reconciliation_required" : "failed",
    errorCode: reconciliationRequired ? OPERATION_BATCH_RECONCILIATION_REQUIRED : "",
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

export function operationBatchDisplayId(task = {}) {
  return firstNonEmpty(task.config?.operationBatchCode, task.config?.operationBatch?.code, task.config?.requirementRequestId, task.config?.initialRequirementRequestId);
}

export function acquireOperationBatchCreation(inFlight, taskId) {
  if (inFlight.has(taskId)) {
    const error = new Error("运营批次正在创建，请勿重复提交");
    error.status = 409;
    throw error;
  }
  inFlight.add(taskId);
}

export function releaseOperationBatchCreation(inFlight, taskId) {
  inFlight.delete(taskId);
}
