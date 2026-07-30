import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFanweiProjectConfig,
  buildOperationArchiveDraft,
  buildPersonnelTaskDraft,
  buildProjectWorkflow,
  normalizeFanweiBusinessRequirement,
} from "./project_workflow.mjs";
import { buildOperationPersonnelTaskDraft, operationPersonnelTaskFingerprint } from "./operation_personnel_task.mjs";

const fanwei = {
  requestid: "1505614",
  fields: {
    "申请人": "张老师",
    "申请人部门": "企业业务部",
    "运控流水号": "R0042182",
    "项目名称": "四川校招项目",
    "项目编码": "F0020795",
    "业务方向": "企业",
    "系统类型": "易考",
    "预估科次": "320",
    "结算依据": "按参考科次结算",
    "是否需要ATA安排人工监考": "需要安排分散人工监考",
    "是否需要ATA安排集中监考场地": "不需要",
    "其他说明": "需要在线巡考",
  },
  serviceConfirmation: { fields: { "单位名称": "四川省公路设计院", "预计人次": "300", "在线巡考": "需要（3个）" } },
  examSceneRows: [{ "考试日期": "2026-07-20", "场次安排说明": "09:30-11:30" }],
  opaRows: [],
};

const model = { requirementFields: { "考试名称": "2026 校园招聘笔试", "考试日期时间": "2026/7/20 09:30-2026/7/20 11:30", "科目信息": "综合能力" } };

test("normalizes Fanwei into the business requirement used by operation tasks", () => {
  const result = normalizeFanweiBusinessRequirement(fanwei, model);
  assert.equal(result.operation_serial_number, "R0042182");
  assert.equal(result.project_code, "F0020795");
  assert.equal(result.customer_name, "四川省公路设计院");
  assert.equal(result.ata_invigilator_arrangement, "需要安排分散人工监考");
  assert.equal(result.online_inspection, "需要（3个）");
  assert.deepEqual(result.exam_schedule, [{ exam_date: "2026-07-20", exam_time: "09:30-11:30", note: "" }]);
});

test("builds versioned Fanwei and EasyExam snapshots for a project card", () => {
  const result = buildFanweiProjectConfig({
    fanwei,
    model,
    parsed: { config: { examName: "2026 校园招聘笔试", customerName: "四川省公路设计院" }, previewRows: [{ item: "考试名称" }] },
    filename: "泛微_R0042182_需求单.xlsx",
    uploadId: "upload-1",
    now: "2026-07-18T02:00:00.000Z",
  });
  assert.equal(result.projectCard.sourceKey, "R0042182");
  assert.equal(result.fanweiSource.raw.requestid, "1505614");
  assert.equal(result.examRequirement.fields["考试名称"], "2026 校园招聘笔试");
  assert.equal(result.examRequirement.uploadId, "upload-1");
  assert.equal(result.examRequirements.length, 1);
  assert.equal(result.examRequirements[0], result.examRequirement);
  assert.equal(result.businessRequirement.project_code, "F0020795");
});

test("initial Fanwei project config generates an automatic business batch name", () => {
  const config = buildFanweiProjectConfig({
    fanwei: {
      fields: {
        "项目名称": "中国邮政集团公司湖北省分公司社会招聘考试",
        "客户名称": "中国邮政集团公司湖北省分公司",
      },
    },
    model: { requirementFields: { "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00" } },
    requirements: [
      { fields: { "考试名称": "社会招聘考试", "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00" } },
      { fields: { "考试名称": "专项能力测试", "考试日期时间": "2026/09/01 09:00 - 2026/09/01 11:00" } },
    ],
  });
  assert.equal(config.businessRequirement.batch_name, "社招_2026年8月");
  assert.equal(config.businessRequirement.batch_name_mode, "auto");
  assert.equal(config.fanweiSource.raw.fields["批次名称"], "社招_2026年8月");
});

test("stores every copied EasyExam requirement while keeping the first as the legacy snapshot", () => {
  const result = buildFanweiProjectConfig({
    fanwei,
    model,
    filename: "泛微_R0042182_需求单.xlsx",
    uploadId: "upload-1",
    requirements: [
      { fields: { "考试名称": "第一场", "考试日期时间": "2026/7/20 09:30-2026/7/20 11:30" }, config: { examName: "第一场" } },
      { fields: { "考试名称": "第二场", "考试日期时间": "2026/7/21 09:30-2026/7/21 11:30" }, config: { examName: "第二场" } },
    ],
    now: "2026-07-19T02:00:00.000Z",
  });
  assert.equal(result.examRequirements.length, 2);
  assert.equal(result.examRequirements[0].fields["考试名称"], "第一场");
  assert.equal(result.examRequirements[1].fields["考试名称"], "第二场");
  assert.equal(result.examRequirements[1].filename, "泛微_R0042182_需求单_需求单2.xlsx");
  assert.equal(result.examRequirement, result.examRequirements[0]);
});

test("personnel and archive drafts keep their source boundaries", () => {
  const config = buildFanweiProjectConfig({ fanwei, model, parsed: { config: {} } });
  const task = {
    taskId: "task-1",
    projectName: "2026 校园招聘笔试",
    config: { ...config, operationBatchCode: "EZT260003", contentRequirementEmail: { lastSentAt: "2026-07-18" } },
    sessions: [{ session_id: "1001", candidateCount: 300, roomCount: 10 }],
  };
  const personnel = buildPersonnelTaskDraft(task);
  const archive = buildOperationArchiveDraft(task);
  assert.equal(personnel.fields.personnelService.source, "fanwei");
  assert.equal(personnel.fields.batchCode.source, "operation_result");
  assert.equal(archive.fields.actualCandidateCount.value, "300");
  assert.equal(archive.fields.actualCandidateCount.source, "actual_result");
});

test("workflow opens personnel and content after batch and archive after actual execution", () => {
  const config = buildFanweiProjectConfig({
    fanwei,
    model,
    parsed: {
      config: {
        startTimeDisplay: "2026/07/20 09:30",
        endTimeDisplay: "2026/07/20 11:30",
        courses: [{ code: "C001", name: "综合能力" }],
      },
    },
  });
  const waiting = buildProjectWorkflow({ config, sessions: [] }, { warnings: [] });
  assert.equal(waiting.steps.batch.status, "ready");
  assert.equal(waiting.steps.personnel.status, "waiting_batch");
  assert.equal(waiting.steps.content.status, "waiting_batch");
  assert.equal(waiting.steps.archive.status, "waiting_execution");

  const ready = buildProjectWorkflow({ config: { ...config, operationBatchCode: "EZT260003" }, sessions: [{ session_id: "1001" }] }, { warnings: [] });
  assert.equal(ready.steps.personnel.status, "needs_review");
  assert.equal(ready.steps.content.status, "ready");
  assert.equal(ready.steps.archive.status, "ready");
});

test("workflow exposes the stable personnel-task status and actions", () => {
  const config = buildFanweiProjectConfig({
    fanwei,
    model,
    parsed: {
      config: {
        startTimeDisplay: "2026/08/20 09:30",
        endTimeDisplay: "2026/08/20 11:30",
        courses: [{ code: "C001", name: "综合能力" }],
      },
    },
  });
  const task = { config: { ...config, operationBatchCode: "EZT260003" }, sessions: [] };
  const draft = buildOperationPersonnelTaskDraft(task);
  task.config.operationPersonnelTask = { lastSuccessfulFingerprint: operationPersonnelTaskFingerprint(draft) };

  const workflow = buildProjectWorkflow(task, { warnings: [] });

  assert.equal(workflow.steps.personnel.status, "sent");
  assert.deepEqual(workflow.steps.personnel.actions, []);
});

test("workflow uses the same confirmed personnel fields as the detail state", () => {
  const config = buildFanweiProjectConfig({
    fanwei,
    model,
    parsed: {
      config: {
        startTimeDisplay: "2026/08/20 09:30",
        endTimeDisplay: "2026/08/20 11:30",
        courses: [{ code: "C001", name: "综合能力" }],
      },
    },
  });
  const task = {
    config: {
      ...config,
      operationBatchCode: "EZT260003",
      operationPersonnelTask: {
        status: "sent",
        confirmedEdits: {
          dates: {
            start: "2026-07-30",
            end: "2026-08-17",
            nameListDue: "2026-08-17",
          },
          personnel: { monitorRatio: "1:55", monitorCount: 70 },
        },
      },
    },
    sessions: [],
  };
  const sentDraft = buildOperationPersonnelTaskDraft(task);
  task.config.operationPersonnelTask.lastSuccessfulFingerprint =
    operationPersonnelTaskFingerprint(sentDraft);

  const workflow = buildProjectWorkflow(task, { warnings: [] });

  assert.deepEqual(workflow.personnelDraft.dates, {
    start: "2026-07-30",
    end: "2026-08-17",
    nameListDue: "2026-08-17",
  });
  assert.equal(workflow.personnelDraft.personnel.monitorRatio, "1:55");
  assert.equal(workflow.personnelDraft.personnel.monitorCount, 70);
  assert.equal(workflow.steps.personnel.status, "sent");
});

test("workflow includes synchronized managed schedules when deciding whether personnel content changed", () => {
  const task = {
    config: {
      operationBatchCode: "EZT260003",
      businessRequirement: {
        batch_name: "湖北邮政_2026年8月",
        ata_invigilator_arrangement: "需要安排分散人工监考",
        estimated_subject_count: "4000",
      },
      operationBatch: {
        estimatedMaxSubjectCount: 4000,
        managedSnapshot: {
          batchName: "湖北邮政_2026年8月",
          examStartDate: "2026-08-22",
          examEndDate: "2026-08-22",
          schedules: [{
            requirementIndex: 0,
            name: "湖北邮政招聘考试",
            start: "2026-08-22T09:00:00",
            end: "2026-08-22T11:00:00",
          }],
        },
      },
      examRequirements: [{
        id: "requirement-1",
        version: 2,
        fields: {
          "考试名称": "湖北邮政招聘考试",
          "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00",
          "科目信息": "综合能力",
        },
        config: {
          startTimeDisplay: "2026/08/22 09:00",
          endTimeDisplay: "2026/08/22 11:00",
          courses: [{ code: "20260822-01-01", name: "湖北邮政招聘考试" }],
        },
      }],
    },
    sessions: [],
  };
  const sentDraft = buildOperationPersonnelTaskDraft(task);
  sentDraft.managedSchedules = structuredClone(
    task.config.operationBatch.managedSnapshot.schedules,
  );
  task.config.operationPersonnelTask = {
    status: "sent",
    lastSuccessfulFingerprint: operationPersonnelTaskFingerprint(sentDraft),
  };

  const workflow = buildProjectWorkflow(task, { warnings: [] });

  assert.deepEqual(workflow.personnelDraft.managedSchedules, sentDraft.managedSchedules);
  assert.equal(
    operationPersonnelTaskFingerprint(workflow.personnelDraft),
    task.config.operationPersonnelTask.lastSuccessfulFingerprint,
  );
  assert.deepEqual(workflow.steps.personnel, { status: "sent", actions: [] });
});

test("workflow keeps no-personnel arrangements skipped", () => {
  const config = buildFanweiProjectConfig({ fanwei, model, parsed: { config: {} } });
  config.businessRequirement.ata_invigilator_arrangement = "不需要安排人工监考";

  const workflow = buildProjectWorkflow({
    config: { ...config, operationBatchCode: "EZT260003" },
    sessions: [],
  }, { warnings: [] });

  assert.deepEqual(workflow.steps.personnel, { status: "skipped", actions: [] });
});

test("workflow does not mark an unresolved external batch as creatable", () => {
  const workflow = buildProjectWorkflow({
    config: { operationBatch: { status: "reconciliation_required" } },
    sessions: [],
  }, { warnings: [] });

  assert.equal(workflow.steps.batch.status, "reconciliation_required");
});

test("workflow keeps an interrupted reconciliation pending until a valid batch code is saved", () => {
  const workflow = buildProjectWorkflow({
    config: { operationBatch: { status: "reconciling" } },
    sessions: [],
  }, { warnings: [] });

  assert.equal(workflow.steps.batch.status, "reconciliation_required");
  assert.equal(workflow.steps.personnel.status, "waiting_batch");
  assert.equal(workflow.steps.content.status, "waiting_batch");
});

test("workflow keeps malformed non-empty batch codes pending and downstream steps locked", () => {
  const workflow = buildProjectWorkflow({
    config: {
      operationBatchCode: "foo",
      operationBatch: { status: "created_unpublished" },
    },
    sessions: [{ session_id: "1001" }],
  }, { warnings: [] });

  assert.equal(workflow.steps.batch.status, "reconciliation_required");
  assert.equal(workflow.steps.personnel.status, "waiting_batch");
  assert.equal(workflow.steps.content.status, "waiting_batch");
  assert.equal(workflow.steps.archive.status, "waiting_execution");
});

test("workflow exposes managed batch update state without treating subjects as managed", () => {
  const task = {
    config: {
      operationBatchCode: "EZT260003",
      businessRequirement: {
        batch_name: "湖北邮政社招_2026年8月",
        ata_invigilator_arrangement: "不需要安排人工监考",
      },
      operationBatch: {
        managedSnapshot: {
          batchName: "湖北邮政社招_2026年8月",
          examStartDate: "2026-08-22",
          examEndDate: "2026-08-22",
          schedules: [{
            requirementIndex: 0,
            name: "笔试",
            start: "2026-08-22T09:00:00",
            end: "2026-08-22T11:00:00",
          }],
        },
      },
      examRequirements: [{
        fields: {
          "考试名称": "笔试",
          "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00",
          "科目信息": "新科目",
        },
      }],
    },
    sessions: [],
  };

  const workflow = buildProjectWorkflow(task, { warnings: [] });

  assert.equal(workflow.steps.batch.status, "success");
  assert.equal(workflow.steps.batch.baselineRequired, false);
  assert.deepEqual(workflow.steps.batch.missingSchedules, []);
  assert.deepEqual(workflow.steps.batch.managedChanges, []);
});

test("workflow prioritizes persisted in-flight and failure states over a computed update", () => {
  for (const status of ["updating", "update_failed", "update_conflict"]) {
    const workflow = buildProjectWorkflow({
      config: {
        operationBatchCode: "EZT260003",
        businessRequirement: { batch_name: "批次" },
        operationBatch: {
          status,
          managedSnapshot: {
            batchName: "批次",
            examStartDate: "2026-08-22",
            examEndDate: "2026-08-22",
            schedules: [{
              requirementIndex: 0,
              name: "旧日程",
              start: "2026-08-22T09:00:00",
              end: "2026-08-22T11:00:00",
            }],
          },
        },
        examRequirements: [{
          fields: {
            "考试名称": "新日程",
            "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00",
          },
        }],
      },
      sessions: [],
    }, { warnings: [] });

    assert.equal(workflow.steps.batch.status, status);
    assert.equal(workflow.steps.batch.managedChanges[0].path, "schedules[0].name");
  }
});

test("workflow exposes incomplete managed schedules for an existing batch", () => {
  const workflow = buildProjectWorkflow({
    config: {
      operationBatchCode: "EZT260003",
      businessRequirement: { batch_name: "批次" },
      operationBatch: {},
      examRequirements: [
        { fields: { "考试名称": "第一场", "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00" } },
        { fields: { "考试名称": "第二场", "考试日期时间": "" } },
      ],
    },
    sessions: [],
  }, { warnings: [] });

  assert.equal(workflow.steps.batch.status, "waiting_schedule");
  assert.equal(workflow.steps.batch.baselineRequired, true);
  assert.deepEqual(workflow.steps.batch.missingSchedules, [{
    requirementIndex: 1,
    fields: ["考试日期时间"],
  }]);
  assert.deepEqual(workflow.steps.batch.managedChanges, []);
});
