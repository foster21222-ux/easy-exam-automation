# PR #5 Operation, Email, and Release Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden operation-batch and content-email features, verify the complete selective integration, and prepare an approval-gated deployment without changing `main` or port 8765 automatically.

**Architecture:** Add route-level admin authorization tests for global settings, a process-local per-task operation creation guard backed by persisted task state checks, credential file permissions, and UI in-flight locking. Run all unit, protected, and browser checks in the isolated worktree against a disposable runtime directory. Stop after producing evidence; merge and 8765 deployment require explicit user approval.

**Tech Stack:** Node.js ESM, `node:test`, Playwright, SMTP client, local HTTP server, Git.

**Prerequisite:** Complete `2026-07-13-pr5-requirement-wechat-hardening.md`.

---

### Task 1: Require administrators for global operation and SMTP settings

**Files:**
- Modify: `server/easy_exam_server.mjs`
- Modify: `server/test_server_config.mjs`
- Create: `server/test_operation_email_routes.mjs`

- [ ] **Step 1: Add failing route authorization tests**

  Start the server handler with injected auth/session state for a regular user and an administrator. Assert:

  - regular user receives `403` for `POST /api/email/settings`;
  - regular user receives `403` for `POST /api/email/test`;
  - regular user receives `403` for operation environment install/enable;
  - administrator may use those routes;
  - project owners may still send a project content email through the project route when SMTP is already configured;
  - no API response contains the saved password.

- [ ] **Step 2: Run the route test and verify failure**

  ```bash
  node --test server/test_operation_email_routes.mjs
  ```

  Expected: regular-user global mutations are currently accepted and the test fails.

- [ ] **Step 3: Apply `requireAdmin` at route boundaries**

  Require admin for:

  ```text
  POST /api/email/settings
  POST /api/email/test
  POST /api/operation-console/environment/install
  POST /api/operation-console/environment/enable
  ```

  Also require admin for `GET /api/email/settings` because it exposes global SMTP metadata. `GET /api/operation-console/environment` may remain authenticated read-only if it returns no secret; document this in its test.

- [ ] **Step 4: Re-run route and server tests**

  ```bash
  node --test server/test_operation_email_routes.mjs server/test_server_config.mjs
  ```

  Expected: pass.

### Task 2: Make operation-batch creation idempotent per task

**Files:**
- Modify: `server/easy_exam_server.mjs`
- Modify: `server/test_operation_batch.mjs`
- Modify: `server/test_operation_email_routes.mjs`
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Modify: `server/test_ui_views.mjs`

- [ ] **Step 1: Add a failing concurrent-create test**

  Inject a deferred `runOperationBatchCreation` implementation, issue two `POST /api/tasks/:id/operation-batch/create` requests before resolving the first, and assert:

  - the automation runner is called once;
  - the second request returns `409` with a clear “正在创建” message;
  - after the first succeeds, a later request returns the existing batch code and does not rerun automation;
  - after a failure, a later retry is allowed.

- [ ] **Step 2: Run the test and verify failure**

  Run `node --test server/test_operation_email_routes.mjs server/test_operation_batch.mjs`.

- [ ] **Step 3: Implement the per-task guard**

  Add a module-level `Map` or `Set` keyed by `taskId`. In `handleOperationBatchCreate`:

  1. load the current task and return its persisted code if one exists;
  2. reject when the key is already in flight;
  3. acquire before invoking browser automation;
  4. persist success or retryable failure as already designed;
  5. release in `finally`.

  The guard must not fabricate a batch code and must not prevent retry after failure.

- [ ] **Step 4: Add UI in-flight locking**

  In `createProjectOperationBatch`, disable `operationBatchCreateBtn` before the request, show “正在创建…”, and restore it in `finally` unless a batch code now exists. Add a UI test assertion for the `try/finally` lock.

- [ ] **Step 5: Re-run operation, route, and UI tests**

  Expected: all pass.

### Task 3: Protect SMTP credentials on disk and over APIs

**Files:**
- Modify: `server/easy_exam_server.mjs`
- Modify: `server/test_content_requirement_email.mjs`
- Modify: `server/test_operation_email_routes.mjs`

- [ ] **Step 1: Add a failing file-mode test**

  Write email settings in a temporary runtime directory, stat the resulting file, and assert `(mode & 0o777) === 0o600`.

- [ ] **Step 2: Add password retention and clearing tests**

  Assert:

  - saving with an empty password retains the existing password;
  - `clearPassword: true` removes it;
  - GET/settings and POST/settings responses expose only `passwordConfigured`;
  - SMTP host changes do not expose the retained password in logs or responses.

- [ ] **Step 3: Run tests and verify failure**

  ```bash
  node --test server/test_content_requirement_email.mjs server/test_operation_email_routes.mjs
  ```

- [ ] **Step 4: Write settings atomically with owner-only mode**

  Create the runtime directory with restrictive permissions, write a temporary file with mode `0o600`, rename it over `email_settings.json`, and enforce `chmod(..., 0o600)` for an existing file. Keep all API output routed through `redactEmailSettings`.

- [ ] **Step 5: Re-run tests**

  Expected: pass.

### Task 4: Verify content email without sending externally

**Files:**
- Modify: `server/test_content_requirement_email.mjs`
- Modify only if required: `server/content_requirement_email.mjs`
- Modify only if required: `server/smtp_mailer.mjs`

- [ ] **Step 1: Expand rendering coverage**

  Assert the message uses current project name, project code, operation batch code/name, latest requirement version, subject names/durations, formal exam time, and explicit em dashes only for truly missing fields.

- [ ] **Step 2: Expand recipient and SMTP error coverage**

  Assert malformed recipient addresses are rejected, recipient lists are not persisted as defaults, multipart text/HTML is produced, and Outlook authentication errors remain actionable.

- [ ] **Step 3: Run the suite with an injected `sendMail` function**

  ```bash
  node --test server/test_content_requirement_email.mjs
  ```

  Expected: pass; no network connection and no real email.

### Task 5: Commit the operation and email hardening boundary

**Files:**
- All files changed in Tasks 1-4.

- [ ] **Step 1: Run focused tests and protection guard**

  ```bash
  node --test \
    server/test_operation_batch.mjs \
    server/test_operation_console_env.mjs \
    server/test_content_requirement_email.mjs \
    server/test_operation_email_routes.mjs \
    server/test_ui_views.mjs \
    server/test_server_config.mjs \
    server/test_pr5_protected_workflows.mjs
  ```

  Expected: all pass.

- [ ] **Step 2: Commit**

  ```bash
  git add server outputs/web_prototype/easy_exam_automation.html
  git commit -m "fix: harden integrated project workflows"
  ```

### Task 6: Run complete automated verification

**Files:**
- Test only.

- [ ] **Step 1: Run every Node test with the current runtime**

  ```bash
  node --test server/test_*.mjs
  ```

  Expected: all tests pass. Do not ignore failures caused by machine-specific paths; fix the test portability issue and rerun.

- [ ] **Step 2: Run every Python test with the bundled runtime**

  If needed, temporarily link `/Users/chen/Desktop/ai 易考/template` as described in the protection plan, then run:

  ```bash
  /Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest discover -s server -p 'test_*.py'
  ```

  Expected: all tests pass and temporary links are removed.

- [ ] **Step 3: Run repository sync dry-run**

  ```bash
  node scripts/sync_local_runtime.mjs --dry-run
  ```

  Expected: command reports intended managed-file changes only. Do not perform a real sync.

- [ ] **Step 4: Confirm branch cleanliness and commit sequence**

  ```bash
  git status --short
  git log --oneline e3250c09bfb2666a9787b4d23bdf348634f69ff8..HEAD
  ```

  Expected: clean worktree with separate design, protection, selective synchronization, requirement/WeChat hardening, and operation/email hardening commits.

### Task 7: Perform disposable browser verification

**Files:**
- No production writes.
- Temporary runtime directory only.

- [ ] **Step 1: Start the isolated server on a free non-8765 port**

  Set `EASY_EXAM_RUNTIME_DIR` to a temporary directory and use a port such as `8876`. Never point this test at the managed 8765 runtime database.

- [ ] **Step 2: Verify desktop views with Playwright**

  At 1440x900, verify:

  - project detail shows operation batch, content email, project requirement, and project WeChat controls;
  - system config shows admin-only SMTP and operation environment panels;
  - automatic configuration, exam list/detail, candidate import, and Fanwei controls match the production baseline screenshots and remain usable;
  - no controls overlap and long Chinese labels remain inside their containers.

- [ ] **Step 3: Verify mobile layout**

  At 390x844, verify project and system panels wrap without overlap and protected views retain their existing responsive behavior.

- [ ] **Step 4: Verify no external side effects**

  Do not click real operation create, real email send, dependency install, WeChat collection, or Fanwei auto-read. Use mocked API responses or the unit-test injection paths for those actions.

- [ ] **Step 5: Stop the disposable server**

  Confirm no process remains on the temporary port.

### Task 8: Prepare deployment evidence and stop for approval

**Files:**
- Read only: Git state, managed runtime state, GitHub state.

- [ ] **Step 1: Reconfirm live production has not changed**

  Verify port 8765 still runs from `/Users/chen/Library/Application Support/yikao-auto-config-web`, its health endpoint succeeds, and its managed files still match GitHub `main` at `e3250c0` unless the user separately changed them.

- [ ] **Step 2: Summarize evidence for the user**

  Report:

  - branch and final commit;
  - test totals and browser viewport results;
  - protected-workflow guard result;
  - files/features integrated;
  - known boundary that personnel/monitoring task is still a disabled placeholder;
  - confirmation that `main` and 8765 were not modified.

- [ ] **Step 3: Stop and request explicit merge/deployment approval**

  Do not merge, push to `main`, update GitHub `main`, sync the managed runtime, restart port 8765, send real email, or create a real operation batch in this plan. Those actions require a new explicit user approval after reviewing the evidence.
