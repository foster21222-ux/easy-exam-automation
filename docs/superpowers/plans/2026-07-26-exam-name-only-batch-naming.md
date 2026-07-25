# Exam-Name-Only Batch Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate automatic operation batch names only from EasyExam requirement 1's exam name and formal-exam month.

**Architecture:** Keep `defaultOperationBatchName` as the single deterministic server-side naming function, but narrow its input to `examName` and `examStart`. Every caller passes requirement 1 fields; customer and project fields remain available for their own workflows but never enter automatic batch naming. Existing auto/manual resolution, audit, persistence, and response-only legacy compatibility remain unchanged.

**Tech Stack:** Node.js ES modules, `node:test`, Python-backed SQLite route fixtures, macOS LaunchAgent runtime.

## Global Constraints

- Automatic format is `考试名称简称_YYYY年M月`.
- Only EasyExam requirement 1 supplies the exam name and formal-exam month.
- `社会招聘考试` maps deterministically to `社招`; unknown exam names remain unchanged.
- Customer name and business project name must not be read or concatenated by automatic batch naming.
- Requirement 2 and later never affect the batch name.
- Invalid or missing requirement-1 exam name/date produces no automatic name.
- Existing manual names remain unchanged; existing automatic names follow the new rule when recalculated.
- Do not change batch-update, operation-console, schedule, personnel-task, or audit semantics.

---

### Task 1: Replace customer/project naming with requirement-1 exam naming

**Files:**
- Modify: `server/operation_batch_name.mjs`
- Modify: `server/project_workflow.mjs`
- Modify: `server/easy_exam_server.mjs`
- Test: `server/test_operation_batch_name.mjs`
- Test: `server/test_project_workflow.mjs`
- Test: `server/test_operation_batch_routes.mjs`

**Interfaces:**
- Consumes: `defaultOperationBatchName({ examName, examStart })`.
- Produces: a trimmed string in `考试名称简称_YYYY年M月` format, or `""` when the exam name/date is invalid.
- Preserves: `resolveOperationBatchName(input)` and `withOperationBatchNameEditorDefaults(task)` signatures and mode behavior.

- [ ] **Step 1: Write failing pure-function tests**

Replace the generator expectations in `server/test_operation_batch_name.mjs` with:

```js
test("builds the confirmed exam-name-only batch name", () => {
  assert.equal(defaultOperationBatchName({
    examName: "社会招聘考试",
    examStart: "2026-08-22T09:00:00",
  }), "社招_2026年8月");
});

test("keeps an unknown exam name without customer or project concatenation", () => {
  assert.equal(defaultOperationBatchName({
    examName: "专项能力测试",
    examStart: "2026-09-01 09:00",
    customerName: "不得进入批次名称的客户",
    projectName: "不得进入批次名称的项目",
  }), "专项能力测试_2026年9月");
});

test("does not emit an incomplete name without an exam name", () => {
  assert.equal(defaultOperationBatchName({
    examName: "",
    examStart: "2026-09-01 09:00",
  }), "");
});
```

Update legacy response-default fixtures in the same file so requirement 1 contains
`"考试名称": "社会招聘考试"` and automatic expectations are
`"社招_2026年8月"`. Keep explicit manual-name assertions unchanged.

- [ ] **Step 2: Write failing workflow and route tests**

In `server/test_project_workflow.mjs`, change the automatic-name test to assert:

```js
assert.equal(config.businessRequirement.batch_name, "社招_2026年8月");
assert.equal(config.businessRequirement.batch_name_mode, "auto");
assert.equal(config.fanweiSource.raw.fields["批次名称"], "社招_2026年8月");
```

Add a second requirement with a different exam name and month and assert the batch
name remains based on requirement 1:

```js
requirements: [
  { fields: { "考试名称": "社会招聘考试", "考试日期时间": "2026/08/22 09:00 - 2026/08/22 11:00" } },
  { fields: { "考试名称": "专项能力测试", "考试日期时间": "2026/09/01 09:00 - 2026/09/01 11:00" } },
]
```

In `server/test_operation_batch_routes.mjs`:

- Keep the seeded persisted auto name as `"湖北邮政社招_2026年8月"` to represent
  an existing automatic project.
- Expect detail/workflow responses and unchanged saves to return
  `"社招_2026年8月"` in auto mode.
- Expect a requirement-1 month change to return `"社招_2026年9月"`.
- Expect a manual name to remain unchanged while its `batch_name_auto_value`
  becomes `"社招_2026年9月"`.
- Expect “restore automatic” to return `"社招_2026年9月"`.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
CODEX_PYTHON=/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  server/test_operation_batch_name.mjs \
  server/test_project_workflow.mjs \
  server/test_operation_batch_routes.mjs
```

Expected: failures show the current generator still emits customer/project-based
names and callers do not pass requirement-1 exam names.

- [ ] **Step 4: Implement the minimal generator**

In `server/operation_batch_name.mjs`, replace customer/project composition with:

```js
export function defaultOperationBatchName({ examName, examStart } = {}) {
  const date = parseLocalDate(examStart);
  const sourceName = text(examName);
  if (!date || !sourceName) return "";
  const abbreviatedName = matchedExamType(sourceName, examTypeRules) || sourceName;
  return `${abbreviatedName}_${date.year}年${date.month}月`;
}
```

Delete `customerRules`, `mappedOrOriginal`, and `removeCustomerPrefix` because this
task makes them unused. Do not change `resolveOperationBatchName`, date parsing, or
manual-mode logic.

- [ ] **Step 5: Pass requirement-1 fields at every caller**

Use these exact arguments:

```js
defaultOperationBatchName({
  examName: requirementFields["考试名称"],
  examStart: requirementFields["考试日期时间"],
})
```

in the Fanwei source-save branch of `server/easy_exam_server.mjs`.

Use:

```js
defaultOperationBatchName({
  examName: examRequirements[0]?.fields?.["考试名称"],
  examStart: examRequirements[0]?.fields?.["考试日期时间"],
})
```

in the EasyExam requirement-save branch.

Use:

```js
defaultOperationBatchName({
  examName: examRequirement?.fields?.["考试名称"],
  examStart: examRequirement?.fields?.["考试日期时间"],
})
```

in `buildFanweiProjectConfig` within `server/project_workflow.mjs`.

Use requirement 1 from the existing `requirements` array in
`withOperationBatchNameEditorDefaults`:

```js
defaultOperationBatchName({
  examName: requirements[0]?.fields?.["考试名称"],
  examStart: requirements[0]?.fields?.["考试日期时间"],
})
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 3 command.

Expected: all focused tests pass, including real loopback route tests.

- [ ] **Step 7: Run protected-workflow and adjacent regressions**

Run:

```bash
CODEX_PYTHON=/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  server/test_operation_batch_name.mjs \
  server/test_project_workflow.mjs \
  server/test_operation_batch_routes.mjs \
  server/test_server_config.mjs \
  server/test_pr5_protected_workflows.mjs \
  server/test_operation_batch_update.mjs \
  server/test_operation_batch_update_routes.mjs
```

Expected: all tests pass and PR 5 protected regions remain accepted without a new
allowlist exception.

- [ ] **Step 8: Review and commit**

Run:

```bash
git diff --check
git diff -- server/operation_batch_name.mjs server/project_workflow.mjs server/easy_exam_server.mjs server/test_operation_batch_name.mjs server/test_project_workflow.mjs server/test_operation_batch_routes.mjs
```

Verify every changed production line traces to the confirmed naming rule. Then:

```bash
git add \
  server/operation_batch_name.mjs \
  server/project_workflow.mjs \
  server/easy_exam_server.mjs \
  server/test_operation_batch_name.mjs \
  server/test_project_workflow.mjs \
  server/test_operation_batch_routes.mjs
git commit -m "fix: derive batch names from exam names"
```

### Task 2: Full verification and local 8765 acceptance

**Files:**
- No source changes.
- Runtime target: `/Users/ata/Library/Application Support/easy-exam-automation`
- Read-only acceptance record: task `b8e1af6b-7f2f-4490-926e-c2dda94f1461`
  (`R0031682`)

**Interfaces:**
- Consumes: committed Task 1 source state.
- Produces: verified local runtime with no historical task write during UI acceptance.

- [ ] **Step 1: Run the full Node suite**

Run:

```bash
/bin/zsh -lc 'for f in server/test_*.mjs; do [ "$f" = "server/test_exam_time_only.mjs" ] && continue; printf "%s\n" "$f"; done | xargs /Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test'
```

Expected: zero failures; record the actual test count.

- [ ] **Step 2: Run the full Python suite**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  -m unittest discover -s server -p 'test_*.py'
```

Expected: zero failures; record the actual test count.

- [ ] **Step 3: Deploy and restart the local runtime**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/deploy_launchd_runtime.mjs
launchctl kickstart -k gui/501/com.ata.easy-exam-service
curl -sS --max-time 10 http://127.0.0.1:8765/api/health
```

Expected deploy response: `"ok": true`. Expected health response: `{"ok":true}`.

- [ ] **Step 4: Perform read-only legacy-project UI acceptance**

Before opening the editor, query the persisted row and record `updated_at`,
`batch_name`, and `batch_name_mode`. In the 8765 project page:

1. Open project `R0031682`.
2. Wait for project workflow panels to finish loading.
3. Open “查看和修改泛微业务需求”.
4. Confirm exactly one visible “批次名称” textbox.
5. Confirm its response-only automatic value is
   `中国邮政集团公司湖北省分公司招聘考试V2_2026年8月`, derived from requirement 1's
   current exam name and month without a separately concatenated customer name.
6. Click “取消”; do not click “保存修改”.

Re-query SQLite and verify `updated_at`, persisted batch-name property, and mode are
unchanged. Finish with a host-environment health check returning `{"ok":true}`.

