# PR #5 Selective Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize the approved PR #5 project-management features onto current `main` without replacing any protected current-main code.

**Architecture:** Treat commit `3a7c544cfacdf3fe34a7f7dbc69074f24a9e7d22` as immutable source material. Confirm which PR files already match current `main`, copy only the five missing standalone modules and their three tests, then transplant narrowly identified server and project/system UI wiring. Preserve this synchronization as one auditable feature commit before fixing review findings.

**Tech Stack:** Node.js ESM, Python SQLite helper, static HTML/JS frontend, Playwright automation, GitHub CLI.

**Prerequisite:** Complete `2026-07-13-pr5-protected-workflows.md` and start from its clean commit.

---

### Task 1: Acquire and verify the immutable PR source

**Files:**
- Read only: PR #5 tarball
- Read only: current worktree

- [ ] **Step 1: Download the exact PR head to a temporary directory**

  ```bash
  PR_SHA=3a7c544cfacdf3fe34a7f7dbc69074f24a9e7d22
  PR_TMP=$(mktemp -d /tmp/pr5-selective.XXXXXX)
  gh api "repos/foster21222-ux/easy-exam-automation/tarball/$PR_SHA" > "$PR_TMP/pr.tar.gz"
  mkdir "$PR_TMP/src"
  tar -xzf "$PR_TMP/pr.tar.gz" -C "$PR_TMP/src" --strip-components=1
  ```

- [ ] **Step 2: Verify the source commit through GitHub**

  ```bash
  gh api repos/atachenjun-cm/easy-exam-automation/pulls/5 --jq '.head.sha'
  ```

  Expected: `3a7c544cfacdf3fe34a7f7dbc69074f24a9e7d22`. Stop if it differs; do not silently integrate a moving PR head.

- [ ] **Step 3: Reproduce the file classification**

  Classify every PR file as `IDENTICAL`, `PR_ONLY`, or `DIFFERENT` using `cmp -s`. Verify at minimum:

  - `IDENTICAL`: `server/project_intake.mjs`, `server/requirement_request_api.mjs`, `server/requirement_request_db.py`, all current WeChat modules and three WeChat scripts.
  - `PR_ONLY`: operation batch modules, operation environment, content email, SMTP, and their three test files.
  - `DIFFERENT`: `server/easy_exam_server.mjs`, `outputs/web_prototype/easy_exam_automation.html`, `server/test_server_config.mjs`, and `server/test_ui_views.mjs`.

  Do not copy any `DIFFERENT` file wholesale.

### Task 2: Copy the missing bounded modules and upstream tests

**Files:**
- Create: `server/operation_batch.mjs`
- Create: `server/operation_batch_runner.mjs`
- Create: `server/operation_console_env.mjs`
- Create: `server/content_requirement_email.mjs`
- Create: `server/smtp_mailer.mjs`
- Create: `server/test_operation_batch.mjs`
- Create: `server/test_operation_console_env.mjs`
- Create: `server/test_content_requirement_email.mjs`

- [ ] **Step 1: Copy exact upstream files from `$PR_TMP/src`**

  Use `cp` only for the eight bounded files listed above. This is a mechanical source import; use `apply_patch` for every later manual edit.

- [ ] **Step 2: Verify copied files are byte-identical to PR #5**

  Run `cmp -s` for each copied path and fail the task if any comparison differs.

- [ ] **Step 3: Run the imported unit tests before shared-file wiring**

  ```bash
  node --test \
    server/test_operation_batch.mjs \
    server/test_operation_console_env.mjs \
    server/test_content_requirement_email.mjs
  ```

  Expected: pure module tests pass. No browser is opened, no email is sent, and no external batch is created.

### Task 3: Transplant server wiring without replacing current handlers

**Files:**
- Modify: `server/easy_exam_server.mjs`
- Modify: `server/test_server_config.mjs`

- [ ] **Step 1: Add failing server source assertions**

  Extend `server/test_server_config.mjs` with assertions for imports and route strings:

  ```js
  assert.match(source, /from "\.\/operation_batch\.mjs"/);
  assert.match(source, /from "\.\/operation_batch_runner\.mjs"/);
  assert.match(source, /from "\.\/operation_console_env\.mjs"/);
  assert.match(source, /from "\.\/content_requirement_email\.mjs"/);
  assert.match(source, /\/api\/email\/settings/);
  assert.match(source, /\/api\/operation-console\/environment/);
  assert.match(source, /operation-batch\/create/);
  assert.match(source, /content-requirement-email/);
  ```

- [ ] **Step 2: Run the test and verify failure**

  Run `node --test server/test_server_config.mjs`.

  Expected: new operation/email assertions fail while all pre-existing assertions remain green.

- [ ] **Step 3: Transplant only required imports and constants**

  From PR source, manually add:

  - imports from the five new modules;
  - `emailSettingsPath` under the existing configurable `runtimeDir`;
  - operation draft, create, manual result, environment, email settings/test, and content-email handlers.

  Reuse current-main `runTaskState`, `runRequirementState`, `visibleByOwner`, auth, runtime path, and error helpers. Do not import PR deletions or revert current implementations of Fanwei, paper binding, session change, Python resolution, runtime directory selection, CORS, candidate, exam, or automatic configuration.

- [ ] **Step 4: Register the narrow routes in the current router**

  Add these routes adjacent to related current routes:

  ```text
  GET|POST /api/email/settings
  POST     /api/email/test
  GET      /api/operation-console/environment
  POST     /api/operation-console/environment/install
  POST     /api/operation-console/environment/enable
  GET|POST /api/tasks/:taskId/operation-batch/draft
  POST     /api/tasks/:taskId/operation-batch/create
  POST     /api/tasks/:taskId/operation-batch/result
  POST     /api/tasks/:taskId/content-requirement-email
  ```

  At this synchronization commit, preserve PR behavior exactly. Authorization and idempotency fixes belong to the hardening plan and must not be folded into this commit.

- [ ] **Step 5: Run the server and protection tests**

  ```bash
  node --test server/test_server_config.mjs server/test_pr5_protected_workflows.mjs
  ```

  Expected: pass. The exact-file guard proves protected modules were not changed.

### Task 4: Transplant project and system UI wiring

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Modify: `server/test_ui_views.mjs`

- [ ] **Step 1: Add failing UI assertions**

  Add assertions for:

  ```text
  projectOperationBatchState
  operationBatchCreateBtn
  operationBatchRecordBtn
  contentRequirementEmailRecipients
  contentRequirementEmailSendBtn
  emailSettingsPanel
  saveEmailSettingsBtn
  sendEmailTestBtn
  data-requirement-edit-field
  /staff-edit
  ```

  Also assert the existing protected view identifiers remain present.

- [ ] **Step 2: Run the UI test and verify failure**

  Run `node --test server/test_ui_views.mjs`.

  Expected: only the newly added PR feature assertions fail.

- [ ] **Step 3: Add operation collaboration to project detail**

  Transplant the PR operation action grid, draft renderer, create/manual-record functions, content email send function, state loading, and event listeners into the current project detail. Keep the disabled “发送人员任务单” placeholder because PR #5 has no implementation. Do not add a working claim or route for that placeholder.

- [ ] **Step 4: Add SMTP and operation environment controls to system configuration**

  Transplant only the two new configuration panels and their load/save/test/install/enable functions. Preserve all current system settings and WeChat collector controls.

- [ ] **Step 5: Add project-scoped requirement review and edit UI**

  Transplant the project requirement renderer, customer change accept/reject actions, manual edit form, conflict display, and staff-edit event display. Attach them to current project detail without replacing the current requirement-center page.

- [ ] **Step 6: Reuse current WeChat UI and add only missing project-scoped binding**

  Current `main` already contains the richer global WeChat collector page and byte-identical PR backend. Do not replace it with the older PR page. Add only the project-scoped group binding/status block required by the design, reusing current `/api/wechat-collector/*` endpoints.

- [ ] **Step 7: Run UI, server, and protected suites**

  ```bash
  node --test \
    server/test_ui_views.mjs \
    server/test_server_config.mjs \
    server/test_pr5_protected_workflows.mjs \
    server/test_project_intake_api.mjs \
    server/test_requirement_request_api.mjs \
    server/test_wechat_collector_api.mjs
  ```

  Expected: all pass.

### Task 5: Preserve the raw synchronization boundary

**Files:**
- All files added or modified by Tasks 2-4.

- [ ] **Step 1: Audit the diff for forbidden replacements**

  Run:

  ```bash
  git diff --check
  git diff --name-status e3250c09bfb2666a9787b4d23bdf348634f69ff8
  node --test server/test_pr5_protected_workflows.mjs
  ```

  Expected: no exact protected file is modified. Shared server and HTML contain additions only around approved project/system surfaces.

- [ ] **Step 2: Commit the synchronization before debugging**

  ```bash
  git add server outputs/web_prototype/easy_exam_automation.html
  git commit -m "feat: selectively integrate PR 5 project workflows"
  ```

- [ ] **Step 3: Record known review findings without fixing them in this commit**

  Verify the commit still reproduces the already identified issues: global settings authorization gap, no operation create guard, false dirty fields/clear ambiguity, hardcoded test runtime, and email settings permissions. These are the red tests and fixes in the next plans.
