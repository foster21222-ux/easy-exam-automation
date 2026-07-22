import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOperationBatchResult,
  buildOperationBatchDraft,
  operationBatchDisplayId,
} from "./operation_batch.mjs";
import {
  OPERATION_BATCH_RECONCILIATION_REQUIRED,
  operationConsoleNeedsLogin,
  operationConsoleLoginMessage,
  operationBatchCodeFromText,
  operationBatchListResultFromRows,
  operationConfigServiceSelections,
  operationDateTitle,
  operationDropdownValueCandidates,
  operationFieldId,
  operationSelectedTaskMismatchMessage,
  operationSelectedTaskMismatches,
  operationServiceButtonLabels,
  operationTaskMismatchAllowed,
  operationTaskSearchInputSelector,
  operationSelectControlSelector,
  resolveSubmittedOperationBatch,
} from "./operation_batch_runner.mjs";

function fakeDetailPageWithoutCode() {
  return {
    locator() {
      return { innerText: async () => "目标项目_2026年8月" };
    },
    url() {
      return "http://operation/batch/batchDetail?batch_guid=guid-1";
    },
    async waitForFunction() {
      throw new Error("详情批次代码未出现");
    },
  };
}

function fakeDetailPageWithDelayedCode() {
  let codeVisible = false;
  return {
    locator() {
      return {
        innerText: async () => (codeVisible ? "QTT260007\n目标项目_2026年8月" : "目标项目_2026年8月"),
      };
    },
    url() {
      return "http://operation/batch/batchDetail?batch_guid=guid-1";
    },
    async waitForFunction() {
      codeVisible = true;
    },
  };
}

test("operation batch list result only reads the exact batch row", () => {
  const result = operationBatchListResultFromRows([
    "QTT260006\n其他项目_2026年8月",
    "QTT260007\n目标项目_2026年8月",
  ], "目标项目_2026年8月", "http://operation/batch/batchList");
  assert.equal(result.operationBatchCode, "QTT260007");
});

test("operation batch list result rejects ambiguous exact matches", () => {
  assert.throws(() => operationBatchListResultFromRows([
    "QTT260007\n目标项目_2026年8月",
    "QTT260008\n目标项目_2026年8月",
  ], "目标项目_2026年8月", "http://operation/batch/batchList"), /多个批次代码/);
});

test("operation batch list result rejects duplicate matching rows with the same code", () => {
  assert.throws(() => operationBatchListResultFromRows([
    "QTT260007\n目标项目_2026年8月",
    "QTT260007\n目标项目_2026年8月",
  ], "目标项目_2026年8月", "http://operation/batch/batchList"), /无法确认唯一批次代码/);
});

test("operation batch list result rejects a matching row with multiple codes", () => {
  assert.throws(() => operationBatchListResultFromRows([
    "QTT260007\nQTT260008\n目标项目_2026年8月",
  ], "目标项目_2026年8月", "http://operation/batch/batchList"), /无法确认唯一批次代码/);
});

test("submitted batch falls back to list and preserves the lookup result", async () => {
  const expected = {
    operationBatchCode: "QTT260007",
    batchGuid: "",
    detailUrl: "http://operation/batch/batchList",
    status: "created_unpublished",
  };
  const result = await resolveSubmittedOperationBatch(fakeDetailPageWithoutCode(), {
    batchListUrl: expected.detailUrl,
    batchName: "目标项目_2026年8月",
    findFromList: async () => expected,
    detailCodeWaitMs: 1,
  });
  assert.deepEqual(result, expected);
});

test("submitted batch uses the detail code when it appears without list lookup", async () => {
  let listLookups = 0;
  const result = await resolveSubmittedOperationBatch(fakeDetailPageWithDelayedCode(), {
    batchListUrl: "http://operation/batch/batchList",
    batchName: "目标项目_2026年8月",
    findFromList: async () => {
      listLookups += 1;
      return null;
    },
    detailCodeWaitMs: 1,
  });
  assert.equal(result.operationBatchCode, "QTT260007");
  assert.equal(result.batchGuid, "guid-1");
  assert.equal(listLookups, 0);
});

test("submitted batch without detail or list result requires reconciliation", async () => {
  await assert.rejects(
    () => resolveSubmittedOperationBatch(fakeDetailPageWithoutCode(), {
      batchListUrl: "http://operation/batch/batchList",
      batchName: "目标项目_2026年8月",
      findFromList: async () => null,
      detailCodeWaitMs: 1,
    }),
    (error) => error?.code === OPERATION_BATCH_RECONCILIATION_REQUIRED && error?.status === 409,
  );
});

test("buildOperationBatchDraft maps business requirement fields with explicit sources", () => {
  const task = {
    taskId: "internal-task-id",
    projectName: "浙江省对外服务有限公司社会招聘项目",
    config: {
      requirementRequestId: "internal-request-uuid",
      businessRequirement: {
        operation_serial_number: "R0031682",
        project_code: "F0012393",
        project_name: "浙江省对外服务有限公司社会招聘项目",
        business_direction: "政府",
        applicant_department: "地方业务中心",
        ata_invigilator_arrangement: "不需要",
        system_type: "易考",
        estimated_subject_count: "30",
        billing_basis: "按开考科次结算",
        ata_central_venue_required: "不需要",
        exam_schedule: [{ exam_date: "2026-07-10", exam_time: "全天", note: "" }],
      },
    },
  };

  const draft = buildOperationBatchDraft(task);

  assert.equal(draft.project.taskId, "internal-task-id");
  assert.equal(draft.project.requirementRequestId, "internal-request-uuid");
  assert.equal(draft.fields.operationTaskSerial.value, "R0031682");
  assert.equal(draft.fields.projectCode.value, "F0012393");
  assert.equal(draft.fields.projectName.value, "浙江省对外服务有限公司社会招聘项目");
  assert.equal(draft.fields.businessDirection.value, "政府");
  assert.equal(draft.fields.businessDepartment.value, "地方业务中心");
  assert.equal(draft.fields.estimatedTotalSubjectCount.value, "30");
  assert.equal(draft.fields.estimatedMaxSubjectCount.value, "30");
  assert.equal(draft.fields.estimatedCityCount.value, "0");
  assert.equal(draft.fields.systemType.value, "易考");
  assert.equal(draft.fields.stationUsage.value, "无需考站");
  assert.equal(draft.fields.arrangementService.value, "其它");
  assert.equal(draft.fields.onlineSettlementArrangementSource.value, "其它");
  assert.equal(draft.fields.projectDepartment.value, "项目实施五部");
  assert.equal(draft.fields.servicePersonnel.value, "不需要");
  assert.equal(draft.fields.billingBasis.value, "按开考科次结算");
  assert.equal(draft.fields.examStartDate.value, "2026-07-10");
  assert.equal(draft.fields.examEndDate.value, "2026-07-10");
  assert.equal(draft.fields.batchName.source, "default_rule");
  assert.ok(draft.fields.batchName.value.includes("2026年7月"));
  assert.equal(draft.warnings.some((item) => item.field === "projectDepartment"), false);
});

test("buildOperationBatchDraft normalizes office department and personnel service defaults", () => {
  const task = {
    taskId: "office-task-id",
    config: {
      businessRequirement: {
        operation_serial_number: "R0031683",
        project_name: "某办事处考试项目",
        applicant_department: "杭州办事处",
        ata_invigilator_arrangement: "需要安排分散人工监考",
        estimated_subject_count: "12",
        billing_basis: "按开考科次结算",
        ata_central_venue_required: "不需要",
      },
    },
  };

  const draft = buildOperationBatchDraft(task);

  assert.equal(draft.fields.businessDepartment.value, "地方业务中心");
  assert.equal(draft.fields.businessDepartment.source, "default_rule");
  assert.equal(draft.fields.projectDepartment.value, "项目实施五部");
  assert.equal(draft.fields.projectDepartment.source, "default_rule");
  assert.equal(draft.fields.servicePersonnel.value, "分散人工监考");
  assert.equal(draft.fields.servicePersonnel.source, "business_requirement");
  assert.equal(draft.warnings.some((item) => item.field === "projectDepartment"), false);
  assert.equal(draft.warnings.some((item) => item.field === "servicePersonnel"), false);
});

test("applyOperationBatchResult writes batch code without replacing internal ids", () => {
  const task = {
    taskId: "internal-task-id",
    config: {
      requirementRequestId: "internal-request-uuid",
      initialRequirementRequestId: "internal-request-uuid",
      operationBatch: {
        draft: { fields: { operationTaskSerial: { value: "R0031682" } } },
        errorMessage: "previous failure",
      },
    },
  };

  const patch = applyOperationBatchResult(task, {
    operationBatchCode: "EZT260003",
    batchGuid: "e368050be9e14671892d7ea8c48b33ca",
    status: "created_unpublished",
  });

  assert.equal(patch.operationBatchCode, "EZT260003");
  assert.equal(patch.requirementRequestId, undefined);
  assert.equal(patch.initialRequirementRequestId, undefined);
  assert.equal(patch.operationBatch.code, "EZT260003");
  assert.equal(patch.operationBatch.batchGuid, "e368050be9e14671892d7ea8c48b33ca");
  assert.equal(patch.operationBatch.status, "created_unpublished");
  assert.equal(patch.operationBatch.errorMessage, "");
  assert.equal(patch.operationBatch.draft.fields.operationTaskSerial.value, "R0031682");
  assert.equal(patch.operationBatch.events.length, 1);
  assert.equal(patch.operationBatch.events[0].type, "operation_batch_created");
});

test("operationBatchDisplayId prefers batch code over internal requirement id", () => {
  assert.equal(operationBatchDisplayId({
    config: {
      operationBatchCode: "EZT260003",
      requirementRequestId: "internal-request-uuid",
    },
  }), "EZT260003");
  assert.equal(operationBatchDisplayId({
    config: {
      requirementRequestId: "internal-request-uuid",
    },
  }), "internal-request-uuid");
});

test("operation batch creation guard rejects overlap and allows retry after release", async () => {
  const module = await import("./operation_batch.mjs");
  assert.equal(typeof module.acquireOperationBatchCreation, "function");
  assert.equal(typeof module.releaseOperationBatchCreation, "function");
  const inFlight = new Set();

  module.acquireOperationBatchCreation(inFlight, "task-1");
  assert.throws(
    () => module.acquireOperationBatchCreation(inFlight, "task-1"),
    (error) => error?.status === 409 && /正在创建/.test(error.message),
  );
  module.releaseOperationBatchCreation(inFlight, "task-1");
  assert.doesNotThrow(() => module.acquireOperationBatchCreation(inFlight, "task-1"));
});

test("operation batch runner identifies operation console login redirect", () => {
  assert.equal(operationConsoleNeedsLogin("http://172.16.21.201:9004/loginWaiting?response_type=code"), true);
  assert.equal(operationConsoleNeedsLogin("http://172.16.21.201:9003/OAuth2/authorize?redirect_uri=http%3A%2F%2F172.16.18.198%3A8020%2Fuser%2Flogin"), true);
  assert.equal(operationConsoleNeedsLogin("http://172.16.18.198:8020/batch/batchList"), false);
  assert.match(operationConsoleLoginMessage(10), /10 分钟/);
});

test("operation batch runner extracts operation batch code from batch list text", () => {
  const text = "找到 1 条结果\nQTT260007\n实施中\n北京农商银行公文大赛_2026年8月";
  assert.equal(operationBatchCodeFromText(text), "QTT260007");
});

test("operation batch runner uses the task serial search input in selection modal", () => {
  assert.equal(operationTaskSearchInputSelector(), 'input[placeholder*="流水号"]');
});

test("operation batch runner supports ant design select controls in recorded console", () => {
  assert.ok(operationSelectControlSelector().includes(".ant-select-selection"));
  assert.ok(operationSelectControlSelector().includes(".ant-select-selector"));
});

test("operation batch runner maps recorded form labels to stable control ids", () => {
  assert.equal(operationFieldId("业务部归属"), "start_department");
  assert.equal(operationFieldId("项目部归属"), "project_department");
  assert.equal(operationFieldId("系统类型"), "system_type");
});

test("operation batch runner maps requirement terms to operation console dropdown aliases", () => {
  assert.deepEqual(operationDropdownValueCandidates("结算依据", "按报名科次结算"), ["按报名科次结算", "按开考科次结算"]);
  assert.deepEqual(operationDropdownValueCandidates("系统类型", "易考"), ["易考"]);
});

test("operation batch runner formats ant calendar date titles", () => {
  assert.equal(operationDateTitle("2026-08-22"), "2026年8月22日");
  assert.equal(operationDateTitle("2026/08/02"), "2026年8月2日");
});

test("operation batch runner maps service fields to recorded config service buttons", () => {
  assert.deepEqual(operationServiceButtonLabels({ serviceExam: "易考", servicePersonnel: "在线监考" }), ["考试", "人员"]);
  assert.deepEqual(operationServiceButtonLabels({ serviceExam: "易考", servicePersonnel: "" }), ["考试"]);
});

test("operation batch runner selects service category and concrete service options", () => {
  assert.deepEqual(operationConfigServiceSelections({ serviceExam: "易考", servicePersonnel: "在线监考" }), [
    { category: "考试", option: "易考" },
    { category: "人员", option: "在线监考" },
  ]);
  assert.deepEqual(operationConfigServiceSelections({ serviceExam: "易考", servicePersonnel: "分散人工监考" }), [
    { category: "考试", option: "易考" },
    { category: "人员", option: "在线监考" },
  ]);
});

test("operation batch runner blocks mismatched selected operation tasks", () => {
  const draft = {
    fields: {
      projectCode: { value: "F0020592" },
      projectName: { value: "北京农商银行公文大赛" },
    },
  };
  const mismatches = operationSelectedTaskMismatches(draft, {
    projectCode: "F0012393",
    projectName: "宁德时代",
  });
  assert.deepEqual(mismatches, [
    { label: "项目编码", expected: "F0020592", actual: "F0012393" },
    { label: "项目名称", expected: "北京农商银行公文大赛", actual: "宁德时代" },
  ]);
  assert.match(operationSelectedTaskMismatchMessage(mismatches), /需求任务单与当前项目不一致/);
});

test("operation batch runner allows selected task mismatch only with explicit test switch", () => {
  assert.equal(operationTaskMismatchAllowed({}), false);
  assert.equal(operationTaskMismatchAllowed({ allowTaskMismatch: true }), true);
  assert.equal(operationTaskMismatchAllowed({ env: { OPERATION_CONSOLE_ALLOW_TEST_TASK_MISMATCH: "1" } }), true);
  assert.equal(operationTaskMismatchAllowed({ env: { OPERATION_CONSOLE_ALLOW_TEST_TASK_MISMATCH: "0" } }), false);
});
