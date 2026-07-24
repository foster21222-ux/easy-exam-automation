# Operation Batch Name and Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an editable, deterministically generated business-requirement batch name and a confirmed, snapshot-driven workflow that updates only the operation batch name, overview exam dates, and indexed exam schedules.

**Architecture:** Keep abbreviation and managed-snapshot logic in pure Node modules. Persist the business batch-name mode with the Fanwei source, derive a desired managed snapshot from the business and Easy Exam requirements, and compare it with the last operation-console snapshot. Use the existing visible Playwright profile and shared operation-console lock only for preview inspection, confirmed writes, and final readback.

**Tech Stack:** Node.js ESM, `node:test`, plain browser JavaScript in `outputs/web_prototype/easy_exam_automation.html`, Playwright visible-browser automation, existing task-state Python bridge, LaunchAgent runtime on port `8765`.

## Global Constraints

- Default batch-name format is `客户简称考试类型简称_YYYY年M月`; the first separator is intentionally absent.
- Required initial mappings are `中国邮政集团公司湖北省分公司` → `湖北邮政` and `社会招聘考试` → `社招`.
- Unknown customer and exam-type text must be retained; no LLM abbreviation is allowed.
- Project name is read-only and must never be changed in the operation console.
- Managed operation fields are only batch name, overview exam start/end dates, and schedule name/start/end.
- Subject changes must not change the managed snapshot or batch-update status.
- Easy Exam requirement index maps to operation schedule index; schedules may be appended but never deleted.
- With multiple Easy Exam requirements, one incomplete schedule means initial creation creates zero schedules.
- Overview dates are exact calendar dates: earliest schedule start and latest schedule end.
- Operation publish state does not affect editing and must not be changed by this workflow.
- Tests must use fake pages or disposable runtime directories and must never create or modify a real operation batch.
- Existing batches without a managed snapshot must establish their first baseline from a read-only live inspection; local code must not invent a historical operation snapshot.
- Preserve the unrelated untracked file `docs/operation-personnel-task-test-evidence.md`.

---

## File Structure

**Create**

- `server/operation_batch_name.mjs` — deterministic abbreviation, default-name generation, and auto/manual mode resolution.
- `server/test_operation_batch_name.mjs` — batch-name business rules.
- `server/operation_batch_update.mjs` — normalized schedules, managed snapshots, fingerprints, diffs, statuses, preview tokens, and persisted result patches.
- `server/test_operation_batch_update.mjs` — pure snapshot and state-machine tests.
- `server/operation_batch_update_runner.mjs` — visible operation-console inspection, indexed schedule writes, and readback.
- `server/test_operation_batch_update_runner.mjs` — fake-page runner tests.
- `server/operation_batch_update_service.mjs` — preview/update attempt coordination and checkpoint persistence.
- `server/test_operation_batch_update_service.mjs` — service lifecycle, idempotency, and conflict tests.
- `server/operation_batch_creation_flow.mjs` — dependency-injected ordering for create, code persistence, optional schedule initialization, and managed-snapshot persistence.
- `server/test_operation_batch_creation_flow.mjs` — creation ordering and incomplete-schedule tests.
- `server/test_operation_batch_update_routes.mjs` — disposable-server API tests.

**Modify**

- `server/project_workflow.mjs` — normalize and initialize batch-name fields; expose the new batch step states.
- `server/test_project_workflow.mjs` — import, normalization, project-name immutability, and workflow status tests.
- `server/operation_batch.mjs` — use `businessRequirement.batch_name` as the sole creation batch name.
- `server/test_operation_batch.mjs` — creation draft source and missing-name tests.
- `server/operation_batch_runner.mjs` — export the already-tested login, batch navigation, and identity helpers needed by the separate update runner.
- `server/test_operation_batch_runner_safety.mjs` — post-create all-or-none schedule safety tests.
- `server/easy_exam_server.mjs` — source-save behavior, deletion guard, update routes, shared lock, and attempt responses.
- `server/test_operation_batch_routes.mjs` — creation result persistence before schedule initialization.
- `server/test_ui_views.mjs` — source editor, status labels, preview dialog, and polling behavior.
- `server/test_server_config.mjs` — module imports and route markers.
- `outputs/web_prototype/easy_exam_automation.html` — business editor controls and batch-update UI.

---

### Task 1: Deterministic Batch-Name Domain

**Files:**
- Create: `server/operation_batch_name.mjs`
- Create: `server/test_operation_batch_name.mjs`

**Interfaces:**
- Produces: `defaultOperationBatchName({ customerName, projectName, examStart }) -> string`
- Produces: `resolveOperationBatchName({ previousValue, previousMode, generatedValue, submittedValue, restoreAuto }) -> { value, mode, autoValue }`
- Consumes: plain strings only; no task, database, browser, or network dependencies.

- [ ] **Step 1: Write failing abbreviation and formatting tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultOperationBatchName,
  resolveOperationBatchName,
} from "./operation_batch_name.mjs";

test("builds the confirmed no-first-underscore batch name", () => {
  assert.equal(defaultOperationBatchName({
    customerName: "中国邮政集团公司湖北省分公司",
    projectName: "中国邮政集团公司湖北省分公司社会招聘考试",
    examStart: "2026-08-22T09:00:00",
  }), "湖北邮政社招_2026年8月");
});

test("keeps unknown text instead of guessing abbreviations", () => {
  assert.equal(defaultOperationBatchName({
    customerName: "某某测试中心",
    projectName: "某某测试中心专项能力测试",
    examStart: "2026-09-01 09:00",
  }), "某某测试中心专项能力测试_2026年9月");
});

test("does not emit an incomplete name without a valid date", () => {
  assert.equal(defaultOperationBatchName({
    customerName: "中国邮政集团公司湖北省分公司",
    projectName: "社会招聘考试",
    examStart: "",
  }), "");
});

test("manual mode survives recalculation until restore-auto is requested", () => {
  assert.deepEqual(resolveOperationBatchName({
    previousValue: "人工批次",
    previousMode: "manual",
    generatedValue: "湖北邮政社招_2026年9月",
    submittedValue: "人工批次",
    restoreAuto: false,
  }), { value: "人工批次", mode: "manual", autoValue: "湖北邮政社招_2026年9月" });
  assert.deepEqual(resolveOperationBatchName({
    previousValue: "人工批次",
    previousMode: "manual",
    generatedValue: "湖北邮政社招_2026年9月",
    submittedValue: "人工批次",
    restoreAuto: true,
  }), { value: "湖北邮政社招_2026年9月", mode: "auto", autoValue: "湖北邮政社招_2026年9月" });
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_batch_name.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `operation_batch_name.mjs`.

- [ ] **Step 3: Implement the minimum deterministic rules**

```js
const customerRules = [
  ["中国邮政集团公司湖北省分公司", "湖北邮政"],
];
const examTypeRules = [
  ["社会招聘考试", "社招"],
];

export function defaultOperationBatchName({ customerName, projectName, examStart } = {}) {
  const date = parseLocalDate(examStart);
  if (!date) return "";
  const customer = mappedOrOriginal(customerName, customerRules);
  const examType = matchedExamType(projectName, examTypeRules);
  const base = `${customer}${examType || removeCustomerPrefix(projectName, customerName)}`.trim();
  return base ? `${base}_${date.year}年${date.month}月` : "";
}

export function resolveOperationBatchName(input = {}) {
  const generated = text(input.generatedValue);
  if (input.restoreAuto || text(input.previousMode) !== "manual") {
    const submitted = text(input.submittedValue);
    const edited = submitted && submitted !== text(input.previousValue);
    return edited
      ? { value: submitted, mode: "manual", autoValue: generated }
      : { value: generated, mode: "auto", autoValue: generated };
  }
  return {
    value: text(input.submittedValue || input.previousValue),
    mode: "manual",
    autoValue: generated,
  };
}
```

Implement `text`, `mappedOrOriginal`, `matchedExamType`, `removeCustomerPrefix`, and `parseLocalDate` in the same module. `parseLocalDate` must accept `YYYY-MM-DD`, `YYYY/MM/DD`, and the first date from a saved time range, and must reject rollover dates such as `2026-02-30`.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Task 1 command again.

Expected: all Task 1 tests PASS with exit code `0`.

- [ ] **Step 5: Commit**

```bash
git add server/operation_batch_name.mjs server/test_operation_batch_name.mjs
git commit -m "feat: generate operation batch names"
```

---

### Task 2: Persist and Edit the Business Batch Name

**Files:**
- Modify: `server/project_workflow.mjs`
- Modify: `server/easy_exam_server.mjs`
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Modify: `server/test_project_workflow.mjs`
- Modify: `server/test_ui_views.mjs`

**Interfaces:**
- Consumes: `defaultOperationBatchName` and `resolveOperationBatchName` from Task 1.
- Produces: `businessRequirement.batch_name`, `businessRequirement.batch_name_mode`, and `businessRequirement.batch_name_auto_value`.
- Produces: source-update payload flag `restoreBatchNameAuto: boolean`.

- [ ] **Step 1: Add failing normalization and source-update tests**

Add to `server/test_project_workflow.mjs`:

```js
test("initial Fanwei project config generates an automatic business batch name", () => {
  const config = buildFanweiProjectConfig({
    fanwei: {
      fields: {
        "项目名称": "中国邮政集团公司湖北省分公司社会招聘考试",
        "客户名称": "中国邮政集团公司湖北省分公司",
      },
    },
    model: { requirementFields: { "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00" } },
    requirements: [{ fields: { "考试名称": "社会招聘考试", "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00" } }],
  });
  assert.equal(config.businessRequirement.batch_name, "湖北邮政社招_2026年8月");
  assert.equal(config.businessRequirement.batch_name_mode, "auto");
  assert.equal(config.fanweiSource.raw.fields["批次名称"], "湖北邮政社招_2026年8月");
});
```

Add UI source assertions to `server/test_ui_views.mjs`:

```js
assert.ok(html.includes('data-source-batch-name-mode'));
assert.ok(html.includes('id="sourceBatchNameRestoreAutoBtn"'));
assert.ok(html.includes('data-source-readonly-field="项目名称"'));
assert.ok(html.includes("restoreBatchNameAuto"));
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_project_workflow.mjs server/test_ui_views.mjs
```

Expected: FAIL because the normalized batch-name fields and UI markers do not exist.

- [ ] **Step 3: Implement server persistence**

In `normalizeFanweiBusinessRequirement`, add:

```js
batch_name: text(fields["批次名称"]),
batch_name_mode: text(model.batchNameMode) === "manual" ? "manual" : "auto",
batch_name_auto_value: text(model.batchNameAutoValue),
```

In `buildFanweiProjectConfig`, compute the requirement-1 start, call `defaultOperationBatchName`, resolve the mode against `previousConfig.fanweiSource`, then persist:

```js
fanweiSource: {
  version: fanweiVersion,
  capturedAt: now,
  serialNo,
  requestId: text(fanwei.requestid),
  batchNameMode: batchName.mode,
  batchNameAutoValue: batchName.autoValue,
  raw: {
    ...fanwei,
    fields: { ...(fanwei.fields || {}), "批次名称": batchName.value },
  },
},
businessRequirement: {
  ...businessRequirement,
  batch_name: batchName.value,
  batch_name_mode: batchName.mode,
  batch_name_auto_value: batchName.autoValue,
},
```

In `handleProjectSourceSnapshotUpdate`, pass `payload.restoreBatchNameAuto`, preserve manual mode, recalculate automatic mode from the current requirement-1 date, and include “批次名称” in `projectSourceChangeHistory`.

- [ ] **Step 4: Implement the source editor**

In `sourceFieldControl`, render “项目名称” with `readonly` and `data-source-readonly-field="项目名称"`. Render “批次名称” as a normal input with mode metadata. Add:

```html
<button class="btn" id="sourceBatchNameRestoreAutoBtn" type="button" hidden>
  恢复自动生成
</button>
```

In `collectSourceDetailPayload` include:

```js
restoreBatchNameAuto: sourceDetailModal.dataset.restoreBatchNameAuto === "true",
```

The restore button sets that flag and updates the visible input to the saved automatic value; the server remains authoritative when saving.

- [ ] **Step 5: Verify focused tests**

Run the Task 2 focused command.

Expected: all focused tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/project_workflow.mjs server/easy_exam_server.mjs outputs/web_prototype/easy_exam_automation.html server/test_project_workflow.mjs server/test_ui_views.mjs
git commit -m "feat: edit batch name in business requirements"
```

---

### Task 3: Managed Snapshot and Batch-Update State Machine

**Files:**
- Create: `server/operation_batch_update.mjs`
- Create: `server/test_operation_batch_update.mjs`
- Modify: `server/project_workflow.mjs`
- Modify: `server/test_project_workflow.mjs`

**Interfaces:**
- Produces: `buildDesiredOperationBatchSnapshot(task) -> { complete, missing, snapshot }`
- Produces: `operationBatchManagedDiff(applied, desired) -> Array<ManagedChange>`
- Produces: `operationBatchUpdateState(task) -> { status, baselineRequired, missing, changes }`
- Produces: `applyOperationBatchManagedResult(task, result) -> configPatch`
- `ManagedChange`: `{ path, label, before, after, requirementIndex? }`

- [ ] **Step 1: Write failing snapshot tests**

```js
function taskWithRequirements(items) {
  return {
    taskId: "task-a",
    config: {
      operationBatchCode: "EZT260003",
      businessRequirement: { batch_name: "湖北邮政社招_2026年8月" },
      operationBatch: {},
      examRequirements: items.map((item, index) => ({
        id: `requirement-${index + 1}`,
        fields: {
          "考试名称": item.name,
          "考试日期时间": item.range,
          "科目信息": item.subjects || "",
        },
      })),
    },
  };
}

function taskWithAppliedCount(appliedCount, desiredCount) {
  const task = taskWithRequirements(Array.from(
    { length: desiredCount },
    (_, index) => ({
      name: `日程${index + 1}`,
      range: `2026/08/${String(22 + index).padStart(2, "0")} 09:00 - 2026/08/${String(22 + index).padStart(2, "0")} 11:00`,
    }),
  ));
  task.config.operationBatch.managedSnapshot = {
    batchName: "湖北邮政社招_2026年8月",
    examStartDate: "2026-08-22",
    examEndDate: `2026-08-${String(21 + appliedCount).padStart(2, "0")}`,
    schedules: Array.from({ length: appliedCount }, (_, requirementIndex) => ({
      requirementIndex,
      name: `日程${requirementIndex + 1}`,
      start: `2026-08-${String(22 + requirementIndex).padStart(2, "0")}T09:00:00`,
      end: `2026-08-${String(22 + requirementIndex).padStart(2, "0")}T11:00:00`,
    })),
  };
  return task;
}

test("builds indexed schedules and overview date range", () => {
  const desired = buildDesiredOperationBatchSnapshot(taskWithRequirements([
    { name: "日程二", range: "2026/08/23 09:00 - 2026/08/23 11:00" },
    { name: "日程一", range: "2026/08/22 15:00 - 2026/08/24 01:00" },
  ]));
  assert.equal(desired.complete, true);
  assert.equal(desired.snapshot.examStartDate, "2026-08-22");
  assert.equal(desired.snapshot.examEndDate, "2026-08-24");
  assert.deepEqual(desired.snapshot.schedules.map((item) => item.requirementIndex), [0, 1]);
});

test("one incomplete requirement suppresses the complete schedule set", () => {
  const desired = buildDesiredOperationBatchSnapshot(taskWithRequirements([
    { name: "完整", range: "2026/08/22 09:00 - 2026/08/22 11:00" },
    { name: "缺时间", range: "" },
  ]));
  assert.equal(desired.complete, false);
  assert.deepEqual(desired.snapshot.schedules, []);
  assert.deepEqual(desired.missing, [{ requirementIndex: 1, fields: ["考试日期时间"] }]);
});

test("subject-only changes do not produce managed changes", () => {
  const before = taskWithRequirements([{ name: "考试", range: "2026/08/22 09:00 - 2026/08/22 11:00", subjects: "语文" }]);
  const after = taskWithRequirements([{ name: "考试", range: "2026/08/22 09:00 - 2026/08/22 11:00", subjects: "数学" }]);
  assert.deepEqual(
    buildDesiredOperationBatchSnapshot(before).snapshot,
    buildDesiredOperationBatchSnapshot(after).snapshot,
  );
});

test("schedule count decrease is a conflict and increase is append-only", () => {
  assert.equal(operationBatchUpdateState(taskWithAppliedCount(2, 1)).status, "update_conflict");
  assert.equal(operationBatchUpdateState(taskWithAppliedCount(1, 2)).status, "update_available");
});
```

- [ ] **Step 2: Run Task 3 tests and verify RED**

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_batch_update.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement normalization and exact date handling**

Implement strict parsing of each Easy Exam requirement’s `fields["考试名称"]` and `fields["考试日期时间"]`. Preserve requirement order in `snapshot.schedules`; sort a copy by timestamp only to compute overview dates.

```js
export function buildDesiredOperationBatchSnapshot(task = {}) {
  const requirements = examRequirements(task);
  const parsed = requirements.map((requirement, requirementIndex) =>
    parseManagedSchedule(requirement, requirementIndex));
  const missing = parsed.filter((item) => item.missing.length)
    .map(({ requirementIndex, missing: fields }) => ({ requirementIndex, fields }));
  if (missing.length) return {
    complete: false,
    missing,
    snapshot: { batchName: businessBatchName(task), examStartDate: "", examEndDate: "", schedules: [] },
  };
  return { complete: true, missing: [], snapshot: snapshotFromSchedules(task, parsed) };
}
```

`operationBatchManagedDiff` must compare normalized strings and schedule indices only. It must not read subjects.

- [ ] **Step 4: Implement statuses and workflow integration**

Status priority:

```js
if (!hasBatchCode) return existingCreationStatus;
if (desiredScheduleCount < appliedScheduleCount) return "update_conflict";
if (!desired.complete) return "waiting_schedule";
if (managedDiff.length) return "update_available";
return "success";
```

Expose `workflow.steps.batch.missingSchedules` and `workflow.steps.batch.managedChanges`.

Implement `applyOperationBatchManagedResult` to persist only a normalized, read-back-verified snapshot, increment `managedSnapshotVersion`, set `lastManagedSyncAt`, and append a `managedEvents` entry. When a valid batch code has no managed snapshot, return `baselineRequired: true`; do not synthesize a baseline from the creation draft.

- [ ] **Step 5: Verify Task 3 and project workflow tests**

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_batch_update.mjs server/test_project_workflow.mjs
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/operation_batch_update.mjs server/test_operation_batch_update.mjs server/project_workflow.mjs server/test_project_workflow.mjs
git commit -m "feat: track operation batch update state"
```

---

### Task 4: Reject Requirement Count Decreases After Batch Creation

**Files:**
- Modify: `server/easy_exam_server.mjs`
- Modify: `server/test_operation_batch_routes.mjs`

**Interfaces:**
- Consumes: the existing task matched by Fanwei serial number, its valid `operationBatchCode`, and the previous/new Easy Exam requirement counts.
- Produces: HTTP `409` with error code `OPERATION_BATCH_SCHEDULE_DELETE_FORBIDDEN`.

- [ ] **Step 1: Write a failing Fanwei re-import route test**

Extend the existing disposable-server helper in `server/test_operation_batch_routes.mjs` with `seedTask` and `fanweiImportPayload`, then add:

```js
test("rejects reducing Easy Exam requirements after batch creation", async () => {
  await seedTask({
    taskId,
    config: {
      projectCard: { sourceKey: "R0031682" },
      operationBatchCode: "EZT260003",
      examRequirements: [
        { id: "requirement-1", fields: { "考试名称": "日程1", "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00" } },
        { id: "requirement-2", fields: { "考试名称": "日程2", "考试日期时间": "2026/08/23 09:00 - 2026/08/23 11:00" } },
      ],
    },
  });
  const response = await fetch(`${server.baseUrl}/api/fanwei/requirement-import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fanweiImportPayload({
      serialNo: "R0031682",
      requirementFieldsList: [
        { "考试名称": "日程1", "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00" },
      ],
    })),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).errorCode, "OPERATION_BATCH_SCHEDULE_DELETE_FORBIDDEN");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_batch_routes.mjs
```

Expected: FAIL because the re-import currently accepts fewer requirements.

- [ ] **Step 3: Implement the authoritative import guard**

In `createFanweiRequirementImportFromPayload`, compare the existing task’s persisted requirement count with `requirementFieldsList.length` before workbook generation or config persistence. Apply the guard only when the task has a valid operation batch code. Project-detail editing already edits one requirement at a time and exposes no deletion action, so no speculative UI control is added.

Return:

```js
const error = new Error("批次创建后不允许删除已对应运控日程的易考需求单。");
error.status = 409;
error.errorCode = "OPERATION_BATCH_SCHEDULE_DELETE_FORBIDDEN";
throw error;
```

Make `handleFanweiRequirementImport` preserve `status` and `errorCode` in its JSON response.

- [ ] **Step 4: Verify the focused test and commit**

Run the Task 4 command, then:

```bash
git add server/easy_exam_server.mjs server/test_operation_batch_routes.mjs
git commit -m "feat: prevent deleting synced batch schedules"
```

---

### Task 5: Visible Operation Batch Update Runner

**Files:**
- Create: `server/operation_batch_update_runner.mjs`
- Create: `server/test_operation_batch_update_runner.mjs`
- Modify: `server/operation_batch_runner.mjs`
- Modify: `server/test_operation_batch_runner_safety.mjs`

**Interfaces:**
- Produces: `inspectOperationBatchManagedSnapshot(instruction, options) -> snapshot`
- Produces: `runOperationBatchManagedUpdate(instruction, options) -> { snapshot, detailUrl, checkpoints }`
- Produces: `runOperationBatchScheduleInitialization(instruction, options) -> { snapshot, detailUrl, checkpoints }`
- Consumes instruction:

```js
{
  batch: { code, expectedAppliedSnapshot },
  desiredSnapshot,
  changes,
}
```

- [ ] **Step 1: Write fake-page read and write tests**

Cover exact batch-code navigation, batch overview fields, schedule table order, existing-row editing, append-only creation, and final re-entry/readback.

```js
const instructionWithOneEditAndOneAppend = {
  batch: {
    code: "EZT260003",
    expectedAppliedSnapshot: {
      batchName: "湖北邮政社招_2026年8月",
      examStartDate: "2026-08-22",
      examEndDate: "2026-08-22",
      schedules: [{
        requirementIndex: 0,
        name: "日程一",
        start: "2026-08-22T09:00:00",
        end: "2026-08-22T11:00:00",
      }],
    },
  },
  desiredSnapshot: {
    batchName: "湖北邮政社招_2026年9月",
    examStartDate: "2026-09-02",
    examEndDate: "2026-09-03",
    schedules: [
      { requirementIndex: 0, name: "日程一新名称", start: "2026-09-02T09:00:00", end: "2026-09-02T11:00:00" },
      { requirementIndex: 1, name: "日程二", start: "2026-09-03T09:00:00", end: "2026-09-03T11:00:00" },
    ],
  },
  changes: [
    { path: "batchName", before: "湖北邮政社招_2026年8月", after: "湖北邮政社招_2026年9月" },
    { path: "schedules[0].name", before: "日程一", after: "日程一新名称", requirementIndex: 0 },
    { path: "schedules[1]", before: "", after: "日程二", requirementIndex: 1 },
  ],
};

test("updates only managed overview and schedule fields", async () => {
  const page = fakeOperationBatchPage({ schedules: [existingSchedule] });
  const result = await runOperationBatchManagedUpdate(instructionWithOneEditAndOneAppend, { page });
  assert.deepEqual(page.writes, [
    ["批次名称", "湖北邮政社招_2026年9月"],
    ["考试开始日期", "2026-09-02"],
    ["考试结束日期", "2026-09-03"],
    ["日程1.考试名称", "日程一新名称"],
    ["日程1.开始时间", "2026-09-02 09:00"],
    ["日程1.结束时间", "2026-09-02 11:00"],
    ["新增日程2", true],
    ["日程2.考试名称", "日程二"],
    ["日程2.开始时间", "2026-09-03 09:00"],
    ["日程2.结束时间", "2026-09-03 11:00"],
  ]);
  assert.equal(page.actions.includes("删除日程"), false);
  assert.equal(page.actions.includes("取消发布"), false);
  assert.deepEqual(result.snapshot, instructionWithOneEditAndOneAppend.desiredSnapshot);
});
```

- [ ] **Step 2: Run runner tests and verify RED**

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_batch_update_runner.mjs server/test_operation_batch_runner_safety.mjs
```

Expected: FAIL because the update runner exports do not exist.

- [ ] **Step 3: Implement read-only inspection first**

Reuse existing login, batch-code search, detail identity checks, and page-safety helpers from `operation_batch_runner.mjs`. If a reusable helper is currently private, export it without changing its behavior and retain its existing tests.

Inspection must return:

```js
{
  batchName,
  examStartDate,
  examEndDate,
  schedules: [{ requirementIndex: 0, name, start, end }],
}
```

Do not infer schedule identity from subject or name; use visible row order.

- [ ] **Step 4: Implement narrow writes and readback**

Update only fields present in `changes`. Add schedule rows only when `desired.schedules.length > current.schedules.length`. Reject count decreases before any write.

After saving, close/re-enter the batch detail, inspect again, and compare exact normalized values. Return success only when every managed field matches.

- [ ] **Step 5: Add a separate initial-create all-or-none initializer**

Implement `runOperationBatchScheduleInitialization` as a separate entry point that reopens the already-created batch by its persisted batch code. It must accept only a complete desired snapshot and must reject an empty or incomplete schedule set before launching the browser. Task 6 calls this entry point only after the batch code has been persisted; `runOperationBatchCreation` itself remains responsible only for creating and identifying the batch.

- [ ] **Step 6: Verify runner tests and commit**

Run the Task 5 command, then:

```bash
git add server/operation_batch_update_runner.mjs server/test_operation_batch_update_runner.mjs server/operation_batch_runner.mjs server/test_operation_batch_runner_safety.mjs
git commit -m "feat: update operation batch schedules"
```

---

### Task 6: Persist Batch Code Before Schedule Initialization

**Files:**
- Create: `server/operation_batch_creation_flow.mjs`
- Create: `server/test_operation_batch_creation_flow.mjs`
- Modify: `server/easy_exam_server.mjs`
- Modify: `server/operation_batch.mjs`
- Modify: `server/test_operation_batch_routes.mjs`
- Modify: `server/test_operation_batch.mjs`

**Interfaces:**
- Consumes: desired snapshot builder from Task 3 and initializer from Task 5.
- Produces: `runOperationBatchCreationFlow({ taskId, task, desired, createBatch, persistBatch, initializeSchedules, persistManaged, persistFailure })`.
- Produces: a valid batch code even when schedule initialization later fails.
- Produces: `waiting_schedule`, `update_failed`, or applied managed snapshot after creation.

- [ ] **Step 1: Write failing dependency-injected ordering tests**

```js
const completeTask = {
  taskId: "task-a",
  config: { businessRequirement: { batch_name: "湖北邮政社招_2026年8月" } },
};
const completeDesired = {
  complete: true,
  missing: [],
  snapshot: {
    batchName: "湖北邮政社招_2026年8月",
    examStartDate: "2026-08-22",
    examEndDate: "2026-08-22",
    schedules: [{
      requirementIndex: 0,
      name: "日程1",
      start: "2026-08-22T09:00:00",
      end: "2026-08-22T11:00:00",
    }],
  },
};
const incompleteTask = {
  taskId: "task-incomplete",
  config: { businessRequirement: { batch_name: "湖北邮政社招_2026年8月" } },
};

test("persists created batch code before schedule initialization fails", async () => {
  const calls = [];
  await assert.rejects(runOperationBatchCreationFlow({
    taskId: "task-a",
    task: completeTask,
    desired: completeDesired,
    createBatch: async () => ({ operationBatchCode: "EZT260003", detailUrl: "/batch/1" }),
    persistBatch: async (result) => { calls.push(["persistBatch", result.operationBatchCode]); },
    initializeSchedules: async () => { calls.push(["initialize"]); throw new Error("日程保存后回读不一致"); },
    persistManaged: async () => { calls.push(["persistManaged"]); },
    persistFailure: async (error) => { calls.push(["persistFailure", error.message]); },
  }), /日程保存后回读不一致/);
  assert.deepEqual(calls, [
    ["persistBatch", "EZT260003"],
    ["initialize"],
    ["persistFailure", "日程保存后回读不一致"],
  ]);
});

test("creates no schedules when any requirement is incomplete", async () => {
  const calls = [];
  const result = await runOperationBatchCreationFlow({
    taskId: "task-incomplete",
    task: incompleteTask,
    desired: { complete: false, missing: [{ requirementIndex: 1, fields: ["考试日期时间"] }], snapshot: { schedules: [] } },
    createBatch: async () => ({ operationBatchCode: "EZT260003", detailUrl: "/batch/1" }),
    persistBatch: async () => { calls.push("persistBatch"); },
    initializeSchedules: async () => { calls.push("initialize"); },
    persistManaged: async () => { calls.push("persistManaged"); },
    persistFailure: async () => { calls.push("persistFailure"); },
  });
  assert.deepEqual(calls, ["persistBatch"]);
  assert.equal(result.status, "waiting_schedule");
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_batch_creation_flow.mjs server/test_operation_batch_routes.mjs server/test_operation_batch.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `operation_batch_creation_flow.mjs`.

- [ ] **Step 3: Implement the creation flow and wire the route**

Split the external operation into:

1. Create batch and discover code.
2. Persist code with `persistOperationBatchResult`.
3. If all schedules complete, initialize overview dates and schedules.
4. Persist readback snapshot or update failure.

`buildOperationBatchDraft` must use:

```js
batchName: field(business.batch_name, "business_requirement", "批次名称"),
```

Remove the fallback that regenerates the creation batch name from project name. A missing `business.batch_name` must remain a required warning.

- [ ] **Step 4: Verify focused tests and commit**

Run the Task 6 command, then:

```bash
git add server/operation_batch_creation_flow.mjs server/test_operation_batch_creation_flow.mjs server/easy_exam_server.mjs server/operation_batch.mjs server/test_operation_batch_routes.mjs server/test_operation_batch.mjs
git commit -m "feat: persist batch before schedule setup"
```

---

### Task 7: Preview, Update Service, Routes, and Attempts

**Files:**
- Create: `server/operation_batch_update_service.mjs`
- Create: `server/test_operation_batch_update_service.mjs`
- Create: `server/test_operation_batch_update_routes.mjs`
- Modify: `server/easy_exam_server.mjs`
- Modify: `server/test_server_config.mjs`

**Interfaces:**
- Produces the four routes from the approved spec:
  - `GET /api/tasks/:taskId/operation-batch/update-state`
  - `POST /api/tasks/:taskId/operation-batch/update-preview`
  - `POST /api/tasks/:taskId/operation-batch/update`
  - `GET /api/tasks/:taskId/operation-batch/update-attempts/:attemptId`
- Uses the existing operation-console automation lock and a per-project update lock.

- [ ] **Step 1: Write failing service tests**

Test:

- preview blocks when operation current snapshot differs from applied snapshot;
- an existing batch without an applied snapshot uses its first live inspection as the token-bound baseline;
- a baseline-free preview with no live/desired difference saves the inspected baseline and returns no write action;
- preview token binds task ID, task version, desired fingerprint, and current inspected fingerprint;
- unchanged desired state rejects update;
- old token rejects update;
- update persists checkpoints;
- readback equal to desired reconciles success;
- readback equal to applied permits a safe retry;
- partial readback becomes conflict.

```js
test("rejects a stale preview token after requirement change", async () => {
  const preview = await service.preview(taskId, actor);
  harness.task.config.examRequirements[0].fields["考试日期时间"] =
    "2026/09/02 10:00 - 2026/09/02 12:00";
  await assert.rejects(
    service.start(taskId, { previewToken: preview.previewToken }, actor),
    /预览已过期/,
  );
});
```

- [ ] **Step 2: Run service tests and verify RED**

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_batch_update_service.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement service state**

Keep attempts under `operationBatch.updateAttempts`, with:

```js
{
  attemptId,
  status: "pending" | "running" | "succeeded" | "conflict" | "failed",
  checkpoint,
  desiredSnapshot,
  inspectedBefore,
  inspectedAfter,
  changes,
  actor,
  createdAt,
  completedAt,
  error,
}
```

Use a cryptographically random preview token stored server-side with an expiry and exact fingerprints. Do not trust a client-submitted diff.

- [ ] **Step 4: Add routes and response shaping**

Return the current fresh task and workflow with every terminal response. A `409` conflict must include stable `errorCode`, `task`, and the inspected differing fields.

- [ ] **Step 5: Run service and route tests**

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_batch_update_service.mjs server/test_operation_batch_update_routes.mjs server/test_server_config.mjs
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/operation_batch_update_service.mjs server/test_operation_batch_update_service.mjs server/test_operation_batch_update_routes.mjs server/easy_exam_server.mjs server/test_server_config.mjs
git commit -m "feat: coordinate operation batch updates"
```

---

### Task 8: Configuration-Console Preview and Confirmation

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Modify: `server/test_ui_views.mjs`

**Interfaces:**
- Consumes Task 7 routes.
- Produces one configuration-console confirmation dialog and polling UI.
- Must not add confirmation controls to the operation-console page.

- [ ] **Step 1: Write failing HTML and compiled-function tests**

Assert the status labels and controls:

```js
assert.ok(html.includes('waiting_schedule: "等待补全日程"'));
assert.ok(html.includes('update_available: "可修改"'));
assert.ok(html.includes('id="operationBatchUpdateBtn"'));
assert.ok(html.includes('id="operationBatchUpdateConfirmDialog"'));
assert.ok(html.includes("/operation-batch/update-preview"));
assert.ok(html.includes("/operation-batch/update-attempts/"));
```

Compile and test the diff renderer with:

```js
{
  changes: [
    { path: "batchName", label: "批次名称", before: "旧批次", after: "新批次" },
    { path: "examStartDate", label: "考试开始日期", before: "2026-08-22", after: "2026-08-23" },
    { path: "schedules[0].name", label: "日程 1 · 考试名称", before: "旧考试", after: "新考试", requirementIndex: 0 },
    { path: "schedules[1]", label: "新增日程 2", before: "", after: "新考试 2026-08-24 09:00–11:00", requirementIndex: 1 },
  ],
}
```

- [ ] **Step 2: Run UI tests and verify RED**

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_ui_views.mjs
```

Expected: FAIL because update controls and labels are absent.

- [ ] **Step 3: Implement batch step states**

Keep create and reconcile actions unchanged for pre-creation states. For a valid batch code:

- `waiting_schedule`: show missing requirements and no update button until all complete.
- `update_available`: enable “修改批次信息”.
- `updating`: disable actions and show checkpoint/countdown.
- `update_conflict` / `update_failed`: show the exact recovery message and a read-only recheck/preview action.

- [ ] **Step 4: Implement preview and one confirmation**

The preview button calls `update-preview`, renders server-provided changes, and opens a modal with exactly one final button:

```html
<button class="btn primary" id="operationBatchUpdateConfirmBtn" type="button">
  确认按以上内容修改批次
</button>
```

No client-side free-form field edits are allowed in this modal. Users edit source requirements first, then preview again.

- [ ] **Step 5: Implement polling and terminal refresh**

Poll once per second while running. Render the checkpoint and remaining seconds when provided. On completion, reload the fresh task/workflow. On conflict or failure, preserve the server error and exact field differences.

- [ ] **Step 6: Verify UI tests and commit**

Run the Task 8 command, then:

```bash
git add outputs/web_prototype/easy_exam_automation.html server/test_ui_views.mjs
git commit -m "feat: confirm operation batch modifications"
```

---

### Task 9: Full Regression, Runtime Sync, and Safe Acceptance

**Files:**
- Modify only if verification finds a feature regression.
- Do not edit `docs/operation-personnel-task-test-evidence.md`.

**Interfaces:**
- Produces fresh automated-test evidence, runtime sync evidence, HTTP health evidence, and UI evidence.
- Does not perform a real operation-console write without the user’s action-time confirmation in the configuration console.

- [ ] **Step 1: Run all operation-batch and workflow tests**

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  server/test_operation_batch_name.mjs \
  server/test_operation_batch_update.mjs \
  server/test_operation_batch_update_runner.mjs \
  server/test_operation_batch_update_service.mjs \
  server/test_operation_batch_update_routes.mjs \
  server/test_operation_batch_creation_flow.mjs \
  server/test_operation_batch.mjs \
  server/test_operation_batch_routes.mjs \
  server/test_operation_batch_runner_safety.mjs \
  server/test_project_workflow.mjs \
  server/test_ui_views.mjs \
  server/test_server_config.mjs
```

Expected: exit code `0`, zero failed tests, no unhandled rejection.

- [ ] **Step 2: Run the full Node suite**

```bash
/bin/zsh -lc 'for f in server/test_*.mjs; do [ "$f" = "server/test_exam_time_only.mjs" ] && continue; printf "%s\n" "$f"; done | xargs /Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test'
```

Expected: exit code `0`, all discovered tests PASS.

- [ ] **Step 3: Inspect the final diff and worktree**

```bash
git diff --check
git status --short
git diff --stat HEAD~8..HEAD
```

Expected: no whitespace errors; only feature files and the pre-existing unrelated untracked evidence file remain.

- [ ] **Step 4: Commit any final test-only correction**

If Step 1 or 2 required a correction, rerun both suites and commit only that correction:

```bash
git add \
  server/operation_batch_name.mjs \
  server/test_operation_batch_name.mjs \
  server/operation_batch_update.mjs \
  server/test_operation_batch_update.mjs \
  server/operation_batch_update_runner.mjs \
  server/test_operation_batch_update_runner.mjs \
  server/operation_batch_update_service.mjs \
  server/test_operation_batch_update_service.mjs \
  server/test_operation_batch_update_routes.mjs \
  server/operation_batch_creation_flow.mjs \
  server/test_operation_batch_creation_flow.mjs \
  server/project_workflow.mjs \
  server/test_project_workflow.mjs \
  server/operation_batch.mjs \
  server/test_operation_batch.mjs \
  server/operation_batch_runner.mjs \
  server/test_operation_batch_runner_safety.mjs \
  server/easy_exam_server.mjs \
  server/test_operation_batch_routes.mjs \
  server/test_server_config.mjs \
  server/test_ui_views.mjs \
  outputs/web_prototype/easy_exam_automation.html
git commit -m "test: cover operation batch update flow"
```

If no correction was required, do not create an empty commit.

- [ ] **Step 5: Record runtime safety baselines**

Before deployment, record hashes/inodes for:

- `/Users/ata/Library/Application Support/easy-exam-automation/.env`
- runtime SQLite files
- `node_modules`
- operation-console browser profile

Use the existing deployment evidence procedure from `docs/superpowers/plans/2026-07-23-operation-personnel-test-resend-adoption.md`; do not print secret contents.

- [ ] **Step 6: Atomically sync and restart the 8765 runtime**

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/deploy_launchd_runtime.mjs
```

Expected: atomic application sync succeeds, LaunchAgent restarts, preserved runtime assets retain their baseline identities, and no `.deploy-*` directories remain.

- [ ] **Step 7: Verify health and deployed source markers**

```bash
curl -sS --max-time 5 http://127.0.0.1:8765/api/health
rg -n "operationBatchUpdateBtn|sourceBatchNameRestoreAutoBtn|update_available" \
  "/Users/ata/Library/Application Support/easy-exam-automation/app/outputs/web_prototype/easy_exam_automation.html"
```

Expected: health response is `{"ok":true}` and all three deployed UI markers are present.

- [ ] **Step 8: Perform safe local UI acceptance**

Using a disposable or user-designated test project:

1. Open the business requirement and confirm project name is read-only.
2. Confirm the example auto-name is `湖北邮政社招_2026年8月`.
3. Edit the batch name, save, reload, and verify manual mode persists.
4. Restore automatic mode and verify regeneration.
5. Change subjects only and verify the batch step does not become “可修改”.
6. Make one requirement schedule incomplete and verify “等待补全日程”.
7. Complete all schedules and verify “可修改”.
8. Open the update preview and verify batch name, overview dates, and indexed schedule diffs.

Stop before the final “确认按以上内容修改批次” button unless the user explicitly confirms that external write at action time.

- [ ] **Step 9: Final closure check**

Report:

- exact focused and full test counts;
- 8765 health response;
- runtime preservation checks;
- current branch and commit IDs;
- whether real operation write verification remains pending;
- `git status --short`, including the preserved unrelated evidence file.
