# Operation Personnel Canonical Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep user-confirmed personnel dates, monitor ratio, and monitor count stable across state reads, and allow an operator to adjust those fields and resend even when upstream requirements have not changed.

**Architecture:** `buildOperationPersonnelTaskDraft` remains the single draft builder used by project workflow, personnel state reads, previews, and sends. It will merge a small persisted `confirmedEdits` object over source-derived defaults; historical successful states recover the same fields from the last successful attempt target or persisted draft. The operation snapshot remains a separate verification baseline and never becomes a requirement source.

**Tech Stack:** Node.js ES modules, built-in Node test runner, static HTML/JavaScript UI, SQLite-backed task configuration.

## Global Constraints

- Exam schedules, exam names, and earliest-login values come only from confirmed easy-exam requirements.
- Operation schedules provide schedule codes and readback evidence only.
- User-confirmed fields are limited to personnel start date, end date, name-list due date, monitor ratio, and monitor count.
- Unchanged content must remain blocked from resend.
- Operation-console drift must block; it must not be absorbed into the desired draft.
- Preserve existing initial-send, resend, result-unknown, and read-only recheck safety boundaries.

---

### Task 1: Canonical draft and historical recovery

**Files:**
- Modify: `server/operation_personnel_task.mjs`
- Test: `server/test_operation_personnel_task.mjs`
- Test: `server/test_project_workflow.mjs`

**Interfaces:**
- Produces: `operationPersonnelConfirmedEdits(draft)` returning `{ dates, personnel }`.
- Produces: `buildOperationPersonnelTaskDraft(task, options)` that overlays persisted confirmed edits after generating source-controlled fields.
- Consumes: `task.config.operationPersonnelTask.confirmedEdits`, with fallback to a successful `activeAttempt.target`, then persisted `draft`.

- [ ] **Step 1: Write failing tests**

Add literal-behavior tests proving:

```js
task.config.operationPersonnelTask = {
  status: "sent",
  lastSuccessfulFingerprint: "sent",
  confirmedEdits: {
    dates: { start: "2026-07-30", end: "2026-08-19", nameListDue: "2026-08-19" },
    personnel: { monitorRatio: "1:55", monitorCount: 70 },
  },
};
```

still builds `2026-07-30 / 1:55 / 70` when `options.now` advances to the next day, while an easy-exam schedule change still updates the generated schedule. Add a historical-state test where `confirmedEdits` is absent and the same values are recovered from a successful attempt target. Add a project-workflow test proving its personnel draft uses the same values.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test server/test_operation_personnel_task.mjs server/test_project_workflow.mjs
```

Expected: the new tests fail because the builder currently regenerates the start date, ratio, and count from defaults.

- [ ] **Step 3: Implement the minimal merge**

Add a narrow extractor for the five editable values. Resolve confirmed edits in this order:

1. `operationPersonnelTask.confirmedEdits`
2. successful `operationPersonnelTask.activeAttempt.target`
3. `operationPersonnelTask.draft` when `lastSuccessfulFingerprint` exists
4. no overrides

Generate schedules and other source-controlled fields exactly as before, then overlay only those five editable values. Do not copy schedules or earliest-login values from persisted state or operation snapshots.

- [ ] **Step 4: Run tests and verify GREEN**

Run the two test files again and require zero failures.

- [ ] **Step 5: Commit**

```bash
git add server/operation_personnel_task.mjs server/test_operation_personnel_task.mjs server/test_project_workflow.mjs
git commit -m "fix: preserve confirmed personnel draft fields"
```

---

### Task 2: Persist confirmed edits through send and recheck

**Files:**
- Modify: `server/operation_personnel_task_service.mjs`
- Test: `server/test_operation_personnel_task_service.mjs`
- Test: `server/test_operation_personnel_task_routes.mjs`

**Interfaces:**
- Consumes: `operationPersonnelConfirmedEdits(finalDraft)`.
- Persists: `state.confirmedEdits`.
- Preserves: `lastSuccessfulFingerprint`, `lastOperationSnapshot`, `sendHistory`, and `activeAttempt`.

- [ ] **Step 1: Write failing service tests**

Add tests proving:

1. final confirmation edits are persisted to `confirmedEdits` when the attempt is queued;
2. after a successful send, `get()` returns the same dates, ratio, and count with status `sent`;
3. a later `get()` on the next day remains `sent`;
4. an easy-exam schedule change produces `changes_pending` while retaining the five confirmed fields;
5. a successful result-unknown recheck retains or recovers the confirmed fields.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test server/test_operation_personnel_task_service.mjs server/test_operation_personnel_task_routes.mjs
```

Expected: persistence and next-read assertions fail because `confirmedEdits` is not stored and `get()` currently returns regenerated defaults.

- [ ] **Step 3: Implement persistence**

When `send()` accepts final edits, store:

```js
confirmedEdits: operationPersonnelConfirmedEdits(finalDraft)
```

on the same locked state update that stores the queued attempt. Keep it through success, failure, resume, and recheck. Do not modify the operation snapshot or source requirements.

- [ ] **Step 4: Verify service behavior**

Run the two test files and require zero failures.

- [ ] **Step 5: Commit**

```bash
git add server/operation_personnel_task_service.mjs server/test_operation_personnel_task_service.mjs server/test_operation_personnel_task_routes.mjs
git commit -m "fix: persist confirmed personnel edits"
```

---

### Task 3: Allow deliberate adjustment from sent state

**Files:**
- Modify: `server/operation_personnel_task.mjs`
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Test: `server/test_operation_personnel_task.mjs`
- Test: `server/test_ui_views.mjs`

**Interfaces:**
- Produces: sent workflow status with an adjustment action.
- UI action: opens the existing preview flow; it does not create a second send endpoint.
- Final send: continues using the existing fingerprint equality guard.

- [ ] **Step 1: Write failing tests**

Add tests proving:

```js
buildOperationPersonnelTaskStatus(task, draft)
```

returns `status: "sent"` with an action labelled `调整人员任务并重新发送`. Add UI behavior tests proving sent state enables the main button with that label, while submitting without any field change remains rejected by the existing `PERSONNEL_CONTENT_UNCHANGED` service test.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test server/test_operation_personnel_task.mjs server/test_ui_views.mjs
```

Expected: the sent action and enabled-button assertions fail.

- [ ] **Step 3: Implement the UI entry**

Return an adjustment action for sent state. Change `operationPersonnelActionState` so sent state is enabled, and change its label to `调整人员任务并重新发送`. Reuse `previewOperationPersonnelTask()` and the existing confirmation dialog. Do not make schedules or earliest-login fields editable.

- [ ] **Step 4: Run tests and verify GREEN**

Run the two test files and require zero failures.

- [ ] **Step 5: Commit**

```bash
git add server/operation_personnel_task.mjs outputs/web_prototype/easy_exam_automation.html server/test_operation_personnel_task.mjs server/test_ui_views.mjs
git commit -m "feat: allow deliberate personnel task adjustments"
```

---

### Task 4: Full verification and runtime deployment

**Files:**
- Verify all changed files.
- Deploy to: `/Users/ata/Library/Application Support/easy-exam-automation/app`

**Interfaces:**
- Confirms project tests, runtime parity, health, and real persisted-state projection.

- [ ] **Step 1: Run focused personnel tests**

```bash
node --test server/test_operation_personnel_task.mjs server/test_operation_personnel_task_service.mjs server/test_operation_personnel_task_routes.mjs server/test_project_workflow.mjs server/test_ui_views.mjs
```

- [ ] **Step 2: Run the full Node and Python suites**

Run the established project-wide Node suite excluding only `server/test_exam_time_only.mjs`, then:

```bash
python3 -m unittest discover -s server -p 'test_*.py'
git diff --check
```

- [ ] **Step 3: Deploy and restart**

Run `scripts/deploy_launchd_runtime.mjs`, restart `com.ata.easy-exam-service`, and verify `GET http://127.0.0.1:8765/api/health`.

- [ ] **Step 4: Verify the affected real project read-only**

Read task `b8e1af6b-7f2f-4490-926e-c2dda94f1461` through the personnel-task state endpoint. Require:

- displayed start date `2026-07-30`;
- displayed monitor ratio `1:55`;
- displayed monitor count `70`;
- active successful attempt has no error;
- no send or recheck endpoint is called.

- [ ] **Step 5: Commit any final test-only corrections**

Commit only if verification required a source or test correction; otherwise leave the branch clean.
