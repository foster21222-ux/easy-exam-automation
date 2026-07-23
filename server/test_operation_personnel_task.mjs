import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOperationPersonnelTaskDraft,
  buildOperationPersonnelTaskStatus,
  diffOperationPersonnelTaskDrafts,
  operationPersonnelTaskFingerprint,
} from "./operation_personnel_task.mjs";

const baseTask = {
  taskId: "task-a",
  projectName: "示例考试",
  config: {
    operationBatchCode: "EZT260003",
    operationBatch: { code: "EZT260003", status: "created_unpublished" },
    businessRequirement: {
      operation_serial_number: "R0042483",
      project_code: "P260001",
      project_name: "示例考试",
      ata_invigilator_arrangement: "需要安排分散人工监考",
    },
    examRequirements: [{
      id: "requirement-1",
      version: 3,
      fields: { "考试名称": "示例考试", "考试日期时间": "2026/08/22 09:00-11:00" },
      config: {
        startTimeDisplay: "2026/08/22 09:00",
        endTimeDisplay: "2026/08/22 11:00",
        earlyLoginMinutes: 30,
        courses: [{ code: "C001", name: "综合能力" }],
      },
    }],
  },
  sessions: [{ sessionType: "formal", requirementIndex: 0, candidateCount: 81 }],
};

test("keeps a schedule code when date and subject name change", () => {
  const first = buildOperationPersonnelTaskDraft(baseTask, {
    environment: "test",
    now: "2026-07-23T02:00:00.000Z",
  });
  assert.equal(first.schedules[0].scheduleCode, 1);

  const changed = structuredClone(baseTask);
  changed.config.examRequirements[0].fields["考试名称"] = "示例考试（调整）";
  changed.config.examRequirements[0].config.startTimeDisplay = "2026/08/23 09:00";
  const second = buildOperationPersonnelTaskDraft(changed, {
    environment: "test",
    now: "2026-07-23T02:01:00.000Z",
    scheduleCodeMap: first.scheduleCodeMap,
  });
  assert.equal(second.schedules[0].scheduleEntryId, first.schedules[0].scheduleEntryId);
  assert.equal(second.schedules[0].scheduleCode, 1);
});

test("appends codes for additions and reports exact deletions", () => {
  const first = buildOperationPersonnelTaskDraft(baseTask, {
    environment: "test",
    now: "2026-07-23T02:00:00.000Z",
  });
  const changed = structuredClone(baseTask);
  changed.config.examRequirements.push({
    id: "requirement-2",
    version: 1,
    fields: { "考试名称": "第二场", "考试日期时间": "2026/08/22 14:00-16:00" },
    config: {
      startTimeDisplay: "2026/08/22 14:00",
      endTimeDisplay: "2026/08/22 16:00",
      earlyLoginMinutes: 20,
      courses: [{ code: "C002", name: "英语" }],
    },
  });
  const second = buildOperationPersonnelTaskDraft(changed, {
    environment: "test",
    now: "2026-07-23T02:01:00.000Z",
    scheduleCodeMap: first.scheduleCodeMap,
  });
  assert.deepEqual(second.schedules.map((item) => item.scheduleCode), [1, 2]);
  assert.deepEqual(
    diffOperationPersonnelTaskDrafts(second, first).schedules.deleted.map((item) => item.scheduleCode),
    [2],
  );
});

test("uses simultaneous actual candidate peak before estimated concurrency", () => {
  const task = structuredClone(baseTask);
  task.sessions = [
    { sessionType: "formal", start: "2026/08/22 09:00", end: "2026/08/22 11:00", candidateCount: 81 },
    { sessionType: "formal", start: "2026/08/22 10:00", end: "2026/08/22 12:00", candidateCount: 30 },
  ];
  const draft = buildOperationPersonnelTaskDraft(task, {
    environment: "test",
    now: "2026-07-23T02:00:00.000Z",
  });
  assert.equal(draft.personnel.candidateBasis, 111);
  assert.equal(draft.personnel.monitorCount, 3);
  assert.equal(draft.personnel.monitorRatio, "1:50");
});

test("uses the persisted operation batch draft estimate when actual candidate counts are unavailable", () => {
  const task = structuredClone(baseTask);
  task.sessions = [];
  task.config.operationBatch.draft = {
    fields: {
      estimatedMaxSubjectCount: { value: "4000" },
    },
  };
  const draft = buildOperationPersonnelTaskDraft(task, {
    environment: "test",
    now: "2026-07-23T02:00:00.000Z",
  });
  assert.equal(draft.personnel.candidateBasis, 4000);
  assert.equal(draft.personnel.monitorCount, 80);
  assert.ok(!draft.warnings.some((item) => item.code === "MONITOR_COUNT_REQUIRED"));
});

test("uses the persisted operation batch name for the personnel task list", () => {
  const task = structuredClone(baseTask);
  task.config.operationBatch.draft = {
    fields: {
      batchName: { value: "示例考试_2026年8月" },
    },
  };
  const draft = buildOperationPersonnelTaskDraft(task, {
    environment: "test",
    now: "2026-07-23T02:00:00.000Z",
  });

  assert.equal(draft.batch.batchName, "示例考试_2026年8月");
});

test("does not prefill invalid past personnel dates", () => {
  const draft = buildOperationPersonnelTaskDraft(baseTask, {
    environment: "test",
    now: "2026-08-21T02:00:00.000Z",
  });
  assert.equal(draft.dates.start, "2026-08-21");
  assert.equal(draft.dates.end, "");
  assert.equal(draft.dates.nameListDue, "");
  assert.ok(draft.warnings.some((item) => item.code === "PERSONNEL_DATES_REQUIRED"));
});

test("uses isolated fixed recipient rules", () => {
  const testDraft = buildOperationPersonnelTaskDraft(baseTask, {
    environment: "test",
    now: "2026-07-23T02:00:00.000Z",
  });
  const productionDraft = buildOperationPersonnelTaskDraft(baseTask, {
    environment: "production",
    now: "2026-07-23T02:00:00.000Z",
  });
  assert.deepEqual(testDraft.recipients.toNames, ["张乐翔"]);
  assert.equal(testDraft.recipients.ccCount, 0);
  assert.deepEqual(productionDraft.recipients.toNames, ["唐润梅"]);
  assert.equal(productionDraft.recipients.ccCount, 4);
});

test("fingerprints stable task material and summarizes a changed deadline", () => {
  const before = buildOperationPersonnelTaskDraft(baseTask, { environment: "test", now: "2026-07-23T02:00:00.000Z" });
  const after = structuredClone(before);
  after.dates.end = "2026-08-20";
  assert.match(operationPersonnelTaskFingerprint(before), /^[a-f0-9]{64}$/);
  assert.deepEqual(diffOperationPersonnelTaskDrafts(before, after).fields, [{
    path: "dates.end", before: "2026-08-19", after: "2026-08-20",
  }]);
  assert.equal(diffOperationPersonnelTaskDrafts(before, after).summary, "人员落实结束日期：2026-08-19 → 2026-08-20");
});

test("does not expose a resend action for the current successful fingerprint", () => {
  const draft = buildOperationPersonnelTaskDraft(baseTask, { environment: "test", now: "2026-07-23T02:00:00.000Z" });
  const task = structuredClone(baseTask);
  task.config.operationPersonnelTask = { lastSuccessfulFingerprint: operationPersonnelTaskFingerprint(draft) };
  assert.deepEqual(buildOperationPersonnelTaskStatus(task, draft), { status: "sent", actions: [] });
});

test("uses the persisted changes-pending state before deriving a new ready state", () => {
  const draft = buildOperationPersonnelTaskDraft(baseTask, { environment: "test", now: "2026-07-23T02:00:00.000Z" });
  const task = structuredClone(baseTask);
  task.config.operationPersonnelTask = { status: "changes_pending" };
  assert.deepEqual(buildOperationPersonnelTaskStatus(task, draft), {
    status: "changes_pending",
    actions: [{ id: "preview_resend", label: "检查变更并重新发送" }],
  });
});

test("keeps an explicitly persisted sent status non-repeatable", () => {
  const draft = buildOperationPersonnelTaskDraft(baseTask, { environment: "test", now: "2026-07-23T02:00:00.000Z" });
  const task = structuredClone(baseTask);
  task.config.operationPersonnelTask = { status: "sent" };
  assert.deepEqual(buildOperationPersonnelTaskStatus(task, draft), { status: "sent", actions: [] });
});

test("blocks every confirmed high-end supplement indication", () => {
  for (const field of ["highEndSupplementRequired", "high_end_supplement_required"]) {
    for (const value of [true, "是", "需要", "true", "1"]) {
      const task = structuredClone(baseTask);
      task.config.businessRequirement[field] = value;
      const draft = buildOperationPersonnelTaskDraft(task, { environment: "test", now: "2026-07-23T02:00:00.000Z" });
      assert.ok(draft.warnings.some((item) => item.code === "UNSUPPORTED_PERSONNEL_TASK"), `${field}=${value}`);
      assert.deepEqual(buildOperationPersonnelTaskStatus(task, draft), { status: "unsupported", actions: [] }, `${field}=${value}`);
    }
  }
});

test("fingerprint separates trusted environments but excludes source versions", () => {
  const testDraft = buildOperationPersonnelTaskDraft(baseTask, { environment: "test", now: "2026-07-23T02:00:00.000Z" });
  const productionDraft = buildOperationPersonnelTaskDraft(baseTask, { environment: "production", now: "2026-07-23T02:00:00.000Z" });
  const changedSourceVersion = structuredClone(testDraft);
  changedSourceVersion.sourceVersion.requirements[0].version += 1;
  assert.notEqual(operationPersonnelTaskFingerprint(testDraft), operationPersonnelTaskFingerprint(productionDraft));
  assert.equal(operationPersonnelTaskFingerprint(testDraft), operationPersonnelTaskFingerprint(changedSourceVersion));
});

test("unknown trusted environment blocks without a preview action", () => {
  const draft = buildOperationPersonnelTaskDraft(baseTask, { environment: "preview", now: "2026-07-23T02:00:00.000Z" });
  assert.ok(draft.warnings.some((item) => item.code === "INVALID_RECIPIENT_ENVIRONMENT"));
  assert.deepEqual(buildOperationPersonnelTaskStatus(baseTask, draft), { status: "unsupported", actions: [] });
});
