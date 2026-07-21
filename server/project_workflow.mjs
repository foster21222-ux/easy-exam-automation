function text(value) {
  return String(value ?? "").trim();
}

function first(...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return "";
}

function sourceField(value, source, label, required = false) {
  return { value: text(value), source, label, required };
}

function mapExamSchedule(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    exam_date: text(row?.["考试日期"] || row?.exam_date),
    exam_time: text(row?.["场次安排说明"] || row?.["考试时间"] || row?.exam_time),
    note: text(row?.["备注"] || row?.note),
  })).filter((row) => row.exam_date || row.exam_time);
}

export function normalizeFanweiBusinessRequirement(fanwei = {}, model = {}) {
  const fields = fanwei.fields || {};
  const confirmation = fanwei.serviceConfirmation?.fields || {};
  const requirementFields = model.requirementFields || {};
  return {
    title: text(fields["标题"]),
    applicant: text(fields["申请人"]),
    applicant_department: text(fields["申请人部门"]),
    application_date: text(fields["申请日期"]),
    operation_serial_number: text(fields["运控流水号"]),
    project_name: first(fields["项目名称"], requirementFields["考试名称"]),
    project_code: text(fields["项目编码"]),
    customer_name: first(fields["客户名称（仅供参考）"], fields["客户名称"], confirmation["单位名称"]),
    customer_project_attribute: text(fields["客户及项目属性"]),
    business_direction: text(fields["业务方向"]),
    system_type: text(fields["系统类型"]),
    estimated_subject_count: first(fields["预估科次"], confirmation["预计人次"]),
    expected_revenue: first(fields["预估收入"], fields["预计收入"]),
    billing_basis: text(fields["结算依据"]),
    exam_service_scope: text(fields["考试服务范围"]),
    registration_method: text(fields["报名方式"]),
    registration_website_required: text(fields["是否需要报名网站"]),
    online_registration_start_time: text(fields["在线报名开始时间"]),
    ata_invigilator_arrangement: first(fields["是否需要ATA安排人工监考"], confirmation["ATA人工监考"]),
    ata_central_venue_required: text(fields["是否需要ATA安排集中监考场地"]),
    ata_content_participation: first(fields["ATA内容制题参与方式"], fields["ATA内容制作参与方式"]),
    content_source: text(fields["内容来源"]),
    question_types: text(fields["试题类型"]),
    subject_count: first(fields["科目数"], confirmation["科目数量"]),
    paper_count: text(fields["试卷数"]),
    closed_item_writing_required: text(fields["是否需要封闭制题"]),
    manual_marking_required: text(fields["是否需要人工阅卷"]),
    marking_arrangement: text(fields["阅卷安排"]),
    epi_test_required: text(fields["EPI测试"]),
    personality_test_tool: text(fields["性格测试工具"]),
    other_notes: text(fields["其他说明"]),
    project_manager: first(fields["选择项目经理"], fields["项目经理"]),
    formal_exam_time_range: first(requirementFields["考试日期时间"], confirmation["考试时间"]),
    mock_exam_time_range: text(requirementFields["试考日期时间"]),
    candidate_count: text(confirmation["预计人次"]),
    online_inspection: text(confirmation["在线巡考"]),
    service_confirmation: { ...confirmation },
    exam_schedule: mapExamSchedule(fanwei.examSceneRows),
    opa_rows: Array.isArray(fanwei.opaRows) ? fanwei.opaRows : [],
  };
}

function projectExamRequirements(config = {}) {
  if (Array.isArray(config.examRequirements) && config.examRequirements.length) return config.examRequirements;
  return config.examRequirement?.fields ? [config.examRequirement] : [];
}

function indexedRequirementFilename(filename, index) {
  const normalized = text(filename);
  if (index === 0 || !normalized) return normalized;
  const dot = normalized.lastIndexOf(".");
  return dot > 0
    ? `${normalized.slice(0, dot)}_需求单${index + 1}${normalized.slice(dot)}`
    : `${normalized}_需求单${index + 1}`;
}

export function buildFanweiProjectConfig({ fanwei = {}, model = {}, parsed = {}, filename = "", uploadId = "", requirements = [], previousConfig = {}, now = new Date().toISOString() } = {}) {
  const businessRequirement = normalizeFanweiBusinessRequirement(fanwei, model);
  const serialNo = businessRequirement.operation_serial_number;
  const fanweiVersion = Number(previousConfig.fanweiSource?.version || 0) + 1;
  const previousRequirements = projectExamRequirements(previousConfig);
  const inputRequirements = Array.isArray(requirements) && requirements.length
    ? requirements
    : [{ fields: model.requirementFields || {}, config: parsed.config || {}, previewRows: parsed.previewRows || [], filename, uploadId }];
  const examRequirements = inputRequirements.map((requirement, index) => {
    const previous = previousRequirements[index] || {};
    return {
      id: text(requirement.id || previous.id || `requirement-${index + 1}`),
      order: index + 1,
      version: Number(previous.version || 0) + 1,
      confirmedAt: now,
      fields: { ...(requirement.fields || {}) },
      config: { ...(requirement.config || {}) },
      previewRows: Array.isArray(requirement.previewRows) ? requirement.previewRows : [],
      warnings: Array.isArray(requirement.warnings) ? requirement.warnings : [],
      metrics: requirement.metrics && typeof requirement.metrics === "object" ? { ...requirement.metrics } : {},
      filename: text(requirement.filename || indexedRequirementFilename(filename, index)),
      uploadId: text(requirement.uploadId || (index === 0 ? uploadId : "")),
      supplements: { ...(previous.supplements || {}), ...(requirement.supplements || {}) },
    };
  });
  const examRequirement = examRequirements[0];
  return {
    projectCard: {
      createdAt: previousConfig.projectCard?.createdAt || now,
      updatedAt: now,
      status: "ready_for_config",
      sourceType: "fanwei",
      sourceKey: serialNo,
    },
    fanweiSource: {
      version: fanweiVersion,
      capturedAt: now,
      serialNo,
      requestId: text(fanwei.requestid),
      raw: fanwei,
    },
    businessRequirement,
    examRequirements,
    examRequirement,
    customerName: first(parsed.config?.customerName, businessRequirement.customer_name),
    projectCode: businessRequirement.project_code,
  };
}

function scheduleRange(business = {}) {
  const rows = Array.isArray(business.exam_schedule) ? business.exam_schedule : [];
  const dates = rows.map((row) => text(row?.exam_date)).filter(Boolean);
  if (dates.length) return { start: dates[0], end: dates[dates.length - 1] };
  const matches = [...text(business.formal_exam_time_range).matchAll(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g)]
    .map((match) => match[0].replaceAll("/", "-"));
  return { start: matches[0] || "", end: matches[matches.length - 1] || matches[0] || "" };
}

function workflowWarnings(fields = {}) {
  return Object.entries(fields)
    .filter(([, item]) => item.required && !text(item.value))
    .map(([field, item]) => ({ field, message: `${item.label}缺失，需要人工补充` }));
}

export function buildPersonnelTaskDraft(task = {}) {
  const business = task.config?.businessRequirement || {};
  const batchCode = first(task.config?.operationBatchCode, task.config?.operationBatch?.code);
  const dates = scheduleRange(business);
  const fields = {
    batchCode: sourceField(batchCode, "operation_result", "运营批次代码", true),
    operationTaskSerial: sourceField(business.operation_serial_number, "fanwei", "考试需求任务单", true),
    projectCode: sourceField(business.project_code, "fanwei", "项目编码", true),
    projectName: sourceField(first(business.project_name, task.projectName), "fanwei", "项目名称", true),
    customerName: sourceField(business.customer_name, "fanwei", "客户名称"),
    businessOwner: sourceField(business.applicant, "fanwei", "业务负责人"),
    examStartDate: sourceField(dates.start, "fanwei", "考试开始日期", true),
    examEndDate: sourceField(dates.end, "fanwei", "考试结束日期", true),
    expectedCandidateCount: sourceField(first(business.candidate_count, business.estimated_subject_count), "fanwei", "预计人次"),
    personnelService: sourceField(business.ata_invigilator_arrangement, "fanwei", "人员服务", true),
    centralVenue: sourceField(business.ata_central_venue_required, "fanwei", "集中监考场地"),
    onlineInspection: sourceField(business.online_inspection, "fanwei", "在线巡考"),
    notes: sourceField(business.other_notes, "fanwei", "其他说明"),
  };
  return { fields, warnings: workflowWarnings(fields), createdAt: new Date().toISOString() };
}

export function buildOperationArchiveDraft(task = {}) {
  const business = task.config?.businessRequirement || {};
  const sessions = Array.isArray(task.sessions) ? task.sessions : [];
  const actualCandidates = sessions.reduce((sum, session) => sum + Number(session.candidateCount || 0), 0);
  const actualRooms = sessions.reduce((sum, session) => sum + Number(session.roomCount || 0), 0);
  const fields = {
    batchCode: sourceField(first(task.config?.operationBatchCode, task.config?.operationBatch?.code), "operation_result", "运营批次代码", true),
    operationTaskSerial: sourceField(business.operation_serial_number, "fanwei", "考试需求任务单", true),
    projectCode: sourceField(business.project_code, "fanwei", "项目编码", true),
    projectName: sourceField(first(business.project_name, task.projectName), "fanwei", "项目名称", true),
    billingBasis: sourceField(business.billing_basis, "fanwei", "结算依据"),
    plannedSubjectCount: sourceField(business.estimated_subject_count, "fanwei", "预估科次"),
    actualSessionCount: sourceField(sessions.filter((session) => text(session.session_id)).length, "actual_result", "实际场次数"),
    actualCandidateCount: sourceField(actualCandidates, "actual_result", "实际考生数"),
    actualRoomCount: sourceField(actualRooms, "actual_result", "实际班级数"),
    personnelTaskStatus: sourceField(task.config?.personnelTask?.status, "operation_result", "人员任务状态"),
    contentTaskStatus: sourceField(task.config?.contentRequirementEmail?.lastSentAt ? "已发送" : "", "operation_result", "内容任务状态"),
  };
  return { fields, warnings: workflowWarnings(fields), createdAt: new Date().toISOString() };
}

export function buildProjectWorkflow(task = {}, batchDraft = null) {
  const business = task.config?.businessRequirement || {};
  const examRequirements = projectExamRequirements(task.config || {});
  const examRequirement = examRequirements[0] || {};
  const batchCode = first(task.config?.operationBatchCode, task.config?.operationBatch?.code);
  const personnelDraft = buildPersonnelTaskDraft(task);
  const archiveDraft = buildOperationArchiveDraft(task);
  const personnelNotRequired = text(business.ata_invigilator_arrangement).includes("不需要");
  const contentReady = examRequirements.length > 0 && examRequirements.every((requirement) => Boolean(requirement.fields?.["考试名称"] && requirement.fields?.["考试日期时间"]));
  const hasActualSession = (task.sessions || []).some((session) => text(session.session_id));
  return {
    sources: {
      fanwei: { ready: Boolean(business.operation_serial_number && business.project_code), version: task.config?.fanweiSource?.version || 0 },
      examRequirement: { ready: contentReady, version: Math.max(...examRequirements.map((requirement) => Number(requirement.version || 0)), Number(examRequirement.version || 0)), count: examRequirements.length },
      actualResult: { ready: hasActualSession },
    },
    steps: {
      batch: { status: batchCode ? "success" : (batchDraft?.warnings?.length ? "needs_review" : "ready"), code: batchCode },
      personnel: { status: personnelNotRequired ? "skipped" : (batchCode ? (personnelDraft.warnings.length ? "needs_review" : "ready") : "waiting_batch") },
      content: { status: batchCode ? (contentReady ? "ready" : "needs_review") : "waiting_batch" },
      archive: { status: batchCode && hasActualSession ? (archiveDraft.warnings.length ? "needs_review" : "ready") : "waiting_execution" },
    },
    personnelDraft,
    archiveDraft,
  };
}
