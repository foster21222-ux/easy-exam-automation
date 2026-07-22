# Platform Internal Source Change Auto-Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every project-platform source edit by an administrator or project owner automatically confirmed across all operation-collaboration modules while preserving audit history and external change review.

**Architecture:** Add an explicit `reviewStatus: "auto_confirmed"` marker when the existing `source-snapshot` endpoint records internal edits. Centralize the frontend review predicate so legacy internal records and explicit auto-confirmed records never produce workflow warnings, while `pending_review` and unknown non-empty statuses remain conservative. Keep customer and WeChat change requests on their existing requirement-center review path.

**Tech Stack:** Node.js ESM, single-file HTML/JavaScript UI, `node:test`, SQLite-backed task state, existing atomic LaunchAgent deployment.

## Global Constraints

- Administrators and ordinary project owners receive the same auto-confirmation behavior for edits saved inside the project platform.
- The rule covers batch creation, personnel tasks, content tasks, operation archive, and future operation-collaboration modules that consume the shared predicate.
- Preserve every source-change audit record; do not rewrite or delete historical data.
- Treat legacy records without `reviewStatus` as internal and auto-confirmed.
- Treat `pending_review` and unknown non-empty statuses as requiring review.
- Do not auto-accept customer, WeChat, or other external requirement changes.
- Do not add a confirmation button or API for internal edits.
- Do not change workflow execution status, action availability, or source-to-module mapping.

---

### Task 1: Persist Internal Source Edits as Auto-Confirmed

**Files:**
- Modify: `server/easy_exam_server.mjs:1645-1710`
- Test: `server/test_server_config.mjs:228-255`

**Interfaces:**
- Consumes: `appendProjectSourceChangeHistory(task, record)` and `handleProjectSourceSnapshotUpdate(taskId, req, res)`.
- Produces: new `projectSourceChangeHistory[]` records with `reviewStatus: "auto_confirmed"` for both `source: "fanwei"` and `source: "examRequirement"`.

- [ ] **Step 1: Write the failing server contract test**

Extend `project source snapshots can be edited and rebuild downstream workflow data` so it isolates the handler and requires both internal record writers to persist the explicit status:

```js
const sourceSnapshotHandler = serverSource.slice(
  serverSource.indexOf("async function handleProjectSourceSnapshotUpdate"),
  serverSource.indexOf("async function handleFanweiBridgeToken"),
);
assert.equal(
  (sourceSnapshotHandler.match(/reviewStatus: "auto_confirmed"/g) || []).length,
  2,
);
```

- [ ] **Step 2: Run the focused server test and verify RED**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_server_config.mjs
```

Expected: FAIL because the handler currently writes no `reviewStatus` fields.

- [ ] **Step 3: Add the minimal status to both internal history records**

In the `fanwei` record passed to `appendProjectSourceChangeHistory`:

```js
projectSourceChangeHistory: appendProjectSourceChangeHistory(task, {
  source: "fanwei",
  reviewStatus: "auto_confirmed",
  changedAt: now,
  versionBefore: Number(currentSource.version || 0),
  versionAfter: Number(fanweiSource.version || 0),
  changes,
}),
```

In the `examRequirement` record:

```js
projectSourceChangeHistory: appendProjectSourceChangeHistory(task, {
  source: "examRequirement",
  reviewStatus: "auto_confirmed",
  requirementIndex,
  changedAt: now,
  versionBefore: Number(current.version || 0),
  versionAfter: Number(examRequirement.version || 0),
  changes,
}),
```

- [ ] **Step 4: Run the focused server test and verify GREEN**

Run the same command from Step 2.

Expected: PASS with `fail 0`.

- [ ] **Step 5: Commit the server contract**

```bash
git add server/easy_exam_server.mjs server/test_server_config.mjs
git commit -m "fix: mark internal source edits auto confirmed"
```

---

### Task 2: Apply One Review Predicate Across Operation Collaboration

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html:10050-10080`
- Test: `server/test_ui_views.mjs:2170-2205`

**Interfaces:**
- Consumes: `projectSourceRequirementChangeHistory(task)` and records with optional `reviewStatus`.
- Produces:
  - `projectSourceChangeNeedsReview(record): boolean`
  - `projectWorkflowSourceChangeNotice(task, stepKey): string`
  - audit copy that distinguishes auto-confirmed internal records from pending records.

- [ ] **Step 1: Write failing functional UI tests for all current modules**

Compile the inline helpers with the existing `compileInlineFunction` utility and assert the shared rule:

```js
test("platform source edits are auto confirmed across operation collaboration", () => {
  const projectSourceRequirementChangeHistory = compileInlineFunction(
    "      function projectSourceRequirementChangeHistory(task = {}) {",
    "\n      function projectSourceChangeNeedsReview(record = {}) {",
  );
  const projectSourceChangeNeedsReview = compileInlineFunction(
    "      function projectSourceChangeNeedsReview(record = {}) {",
    "\n      function projectWorkflowSourceChangeNotice(task = {}, stepKey = \"\") {",
  );
  const projectWorkflowSourceChangeNotice = compileInlineFunction(
    "      function projectWorkflowSourceChangeNotice(task = {}, stepKey = \"\") {",
    "\n      function renderProjectSourceRequirementChangeLog(task = {}) {",
    { projectSourceRequirementChangeHistory, projectSourceChangeNeedsReview },
  );

  for (const stepKey of ["batch", "personnel", "content", "archive"]) {
    assert.equal(projectWorkflowSourceChangeNotice({
      config: { projectSourceChangeHistory: [
        { source: stepKey === "content" ? "examRequirement" : "fanwei", reviewStatus: "auto_confirmed" },
      ] },
    }, stepKey), "");
    assert.equal(projectWorkflowSourceChangeNotice({
      config: { projectSourceChangeHistory: [
        { source: stepKey === "content" ? "examRequirement" : "fanwei" },
      ] },
    }, stepKey), "");
  }
});
```

Add conservative pending assertions:

```js
assert.equal(projectSourceChangeNeedsReview({ reviewStatus: "pending_review" }), true);
assert.equal(projectSourceChangeNeedsReview({ reviewStatus: "future_status" }), true);
assert.equal(projectSourceChangeNeedsReview({ reviewStatus: "auto_confirmed" }), false);
assert.equal(projectSourceChangeNeedsReview({}), false);
```

For source impact mapping, assert `pending_review` Fanwei records warn on `batch`, `personnel`, and `archive`, while `pending_review` EasyExam records warn on `content`.

- [ ] **Step 2: Run the focused UI test and verify RED**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_ui_views.mjs
```

Expected: FAIL because `projectSourceChangeNeedsReview` does not exist and legacy/internal history still triggers the warning.

- [ ] **Step 3: Implement the shared review predicate and filter warnings**

Insert the helper immediately after `projectSourceRequirementChangeHistory`:

```js
function projectSourceChangeNeedsReview(record = {}) {
  const reviewStatus = String(record.reviewStatus || "").trim();
  if (!reviewStatus) return false;
  return reviewStatus !== "auto_confirmed";
}
```

Update the notice function to inspect only records that need review:

```js
function projectWorkflowSourceChangeNotice(task = {}, stepKey = "") {
  const pendingHistory = projectSourceRequirementChangeHistory(task)
    .filter(projectSourceChangeNeedsReview);
  const fanweiChanged = pendingHistory.some((record) => record.source === "fanwei");
  const examRequirementChanged = pendingHistory.some((record) => record.source === "examRequirement" || record.source === "project_requirement_editor");
  if (["batch", "personnel", "archive"].includes(stepKey) && fanweiChanged) return "有变更请确认";
  if (stepKey === "content" && examRequirementChanged) return "有变更请确认";
  return "";
}
```

- [ ] **Step 4: Label internal audit records without adding actions**

Inside `renderProjectSourceRequirementChangeLog`, derive status copy with the shared predicate:

```js
const reviewLabel = projectSourceChangeNeedsReview(record)
  ? "待审核"
  : "平台内部修改 · 已自动确认";
```

Render it next to the existing version line:

```js
<div class="task-meta">版本 ${Number(record.versionBefore || 0)} → ${Number(record.versionAfter || 0)} · ${safeText(reviewLabel)}</div>
```

Do not render a button or mutate the record from this view.

- [ ] **Step 5: Add audit-rendering assertions**

Compile `renderProjectSourceRequirementChangeLog` with `safeText`, `formatTaskTime`, `projectSourceRequirementChangeHistory`, and `projectSourceChangeNeedsReview`. Assert:

```js
assert.match(autoConfirmedHtml, /平台内部修改 · 已自动确认/);
assert.match(autoConfirmedHtml, /字段甲/);
assert.match(pendingHtml, /待审核/);
assert.doesNotMatch(autoConfirmedHtml, /button/);
```

- [ ] **Step 6: Run focused UI tests and verify GREEN**

Run the command from Step 2.

Expected: PASS with `fail 0`.

- [ ] **Step 7: Commit the shared UI behavior**

```bash
git add outputs/web_prototype/easy_exam_automation.html server/test_ui_views.mjs
git commit -m "fix: auto confirm platform source changes"
```

---

### Task 3: Full Verification and 8765 Runtime Acceptance

**Files:**
- Test only, then update this plan's checkboxes and verification note.
- Modify after verification: `docs/superpowers/plans/2026-07-22-platform-source-change-auto-confirm.md`

**Interfaces:**
- Consumes: explicit server status and shared UI predicate from Tasks 1-2.
- Produces: clean source commits plus a synchronized, healthy local 8765 runtime.

- [ ] **Step 1: Run syntax and focused tests**

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check server/easy_exam_server.mjs
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_server_config.mjs server/test_ui_views.mjs
git diff --check
```

Expected: all commands exit `0` and Node reports `fail 0`.

- [ ] **Step 2: Run the complete automated Node suite**

Exclude only the existing manually gated browser smoke file:

```bash
/bin/zsh -lc 'for f in server/test_*.mjs; do [ "$f" = "server/test_exam_time_only.mjs" ] && continue; printf "%s\n" "$f"; done | xargs /Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test'
```

Expected: `fail 0`.

- [ ] **Step 3: Run all Python tests**

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest discover -s server -p 'test_*.py'
```

Expected: `OK`.

- [ ] **Step 4: Review the exact diff and protected boundaries**

```bash
git diff --check
git status --short
git diff --stat HEAD~2..HEAD
```

Confirm that external `changeRequests`, accept/reject APIs, workflow execution status, and source-to-module mapping are unchanged.

- [ ] **Step 5: Record deployment preservation baselines**

Before deployment, record the SHA-256/inode of runtime `.env`, inode of `node_modules`, task SQLite, email settings, and operation-console profile. Confirm `/api/health` and `/api/operation-console/environment` are healthy.

- [ ] **Step 6: Atomically synchronize and restart 8765**

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/deploy_launchd_runtime.mjs
launchctl kickstart -k gui/501/com.ata.easy-exam-service
```

Do not pass `--migrate-runtime`.

- [ ] **Step 7: Verify runtime integrity and behavior**

Confirm:

- `GET http://127.0.0.1:8765/api/health` returns `{ "ok": true }`.
- `GET /api/operation-console/environment` reports `ready: true`.
- source and runtime copies of the edited server/UI files match.
- recorded runtime hashes/inodes are unchanged and no `.deploy-*` path remains.
- the current project's batch, personnel, content, and archive cards do not show “有变更请确认” for legacy or explicit internal history.
- the project requirement change log still displays the field differences and “平台内部修改 · 已自动确认”.

- [ ] **Step 8: Update and commit the verification record**

Check completed steps in this file, append exact Node/Python counts and runtime evidence, then:

```bash
git add docs/superpowers/plans/2026-07-22-platform-source-change-auto-confirm.md
git commit -m "docs: record source change auto confirmation verification"
```
