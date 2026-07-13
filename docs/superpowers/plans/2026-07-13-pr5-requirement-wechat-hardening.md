# PR #5 Requirement and WeChat Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify and correct the imported requirement database and WeChat collection behavior while preserving the protected Fanwei-to-auto-config workflow.

**Architecture:** Keep the PR backend modules that already match current `main`, add regression tests for partial updates, explicit clears, real dirty-field tracking, conflicts, queue/checkpoints, and project deletion cleanup, then make the smallest DB/API/UI changes required. Replace machine-specific test executables with runtime discovery so the suite runs on this checkout and CI.

**Tech Stack:** Python 3 SQLite, Node.js ESM, `node:test`, macOS Swift helper scripts, static HTML/JS frontend.

**Prerequisite:** Complete `2026-07-13-pr5-selective-sync.md` and start from the raw synchronization commit.

---

### Task 1: Fix requirement manual-edit semantics

**Files:**
- Modify: `server/test_requirement_request_api.mjs`
- Modify: `server/requirement_request_db.py`
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Modify: `server/test_ui_views.mjs`

- [ ] **Step 1: Add a failing no-op edit test**

  Create a requirement, capture its latest version, then send `staff-edit` with values equal to the stored values. Assert the API rejects an empty effective change and does not add a `requirement_staff_edited` event or version.

- [ ] **Step 2: Add a failing explicit-clear test**

  Seed non-empty optional fields, then send a payload with an explicit `fields` map containing `project_manager: ""` and `subjects: []`. Assert both fields are cleared, the new version is created, and the event lists exactly those fields.

- [ ] **Step 3: Add a failing dirty-field UI test**

  Extend `server/test_ui_views.mjs` to require original-value tracking or a dirty marker on `[data-requirement-edit-field]` and a payload builder that submits only dirty fields. Assert the UI distinguishes “unchanged” from an intentional empty value.

- [ ] **Step 4: Run the focused tests and verify failure**

  ```bash
  node --test server/test_requirement_request_api.mjs server/test_ui_views.mjs
  ```

  Expected: the new no-op, explicit-clear, and dirty-field assertions fail.

- [ ] **Step 5: Implement effective-field merging in Python**

  Change `merge_staff_requirement_fields` so it:

  - considers only keys explicitly present in the incoming `fields` map;
  - records a field only when its normalized new value differs from the stored value;
  - accepts empty string, empty list, `false`, and `0` as intentional replacement values;
  - returns no edited fields for an effective no-op.

  Keep existing versioning, event recording, and conflict queries intact.

- [ ] **Step 6: Implement real dirty tracking in the project UI**

  Store the original serialized value on every edit control. Mark a field dirty on `input`/`change`; build `{ fields: { ... } }` from dirty controls only. An empty dirty control must be included as `""` or `[]`; an untouched prefilled control must be omitted.

- [ ] **Step 7: Re-run focused tests**

  Expected: all requirement and UI tests pass.

### Task 2: Verify conflict behavior after clears and replacements

**Files:**
- Modify: `server/test_requirement_request_api.mjs`
- Modify only if required: `server/requirement_request_db.py`

- [ ] **Step 1: Add conflict tests**

  Cover these cases:

  - a customer change to a different field is accepted without override;
  - a customer change to a manually cleared field returns the exact conflict field;
  - `overrideManualEdit: true` accepts that change and records `overrodeManualEditFields`;
  - a rejected change never modifies the latest requirement.

- [ ] **Step 2: Run `node --test server/test_requirement_request_api.mjs`**

  Expected: pass after Task 1; if a case fails, fix only the conflict-field calculation and rerun.

### Task 3: Make WeChat tests portable

**Files:**
- Modify: `server/test_wechat_visible_collect_cli.mjs`
- Search and modify: any test containing `/Users/ata/`

- [ ] **Step 1: Add runtime discovery helper in the test**

  Replace the hardcoded Node path with:

  ```js
  const nodeBin = process.execPath;
  ```

  Search all tracked tests:

  ```bash
  rg -n '/Users/ata/|/Users/atachenjun/' server scripts
  ```

  Replace any test-only hardcoded Python executable with `process.env.CODEX_PYTHON || process.env.PYTHON || "python3"`, or inject it from the caller. Do not change production runtime discovery that already works on current `main`.

- [ ] **Step 2: Run the previously failing visible collector suite**

  ```bash
  node --test server/test_wechat_visible_collect_cli.mjs
  ```

  Expected: all tests pass on `/Users/chen` without creating a fake `/Users/ata` directory.

### Task 4: Verify queue, checkpoint, attachment, and deletion behavior

**Files:**
- Modify: `server/test_wechat_collector_api.mjs`
- Modify: `server/test_wechat_requirement_collector.mjs`
- Modify: `server/test_wechat_attachment_scanner.mjs`
- Modify: `server/test_wechat_project_cleanup.mjs`
- Modify production modules only when a new regression test fails.

- [ ] **Step 1: Add or confirm serialized queue coverage**

  Submit two collection requests concurrently and assert the collector starts the second only after the first completes. A failed first job must release the queue for the second.

- [ ] **Step 2: Add or confirm checkpoint coverage**

  Assert a failed parse/push does not advance the checkpoint, a successful push does, and retrying the same visible content does not create a duplicate change.

- [ ] **Step 3: Add or confirm attachment coverage**

  Assert only recently downloaded files whose names appear in visible chat text are associated with the current collection.

- [ ] **Step 4: Add or confirm project deletion coverage**

  Assert deleting a project disables only groups matching its `task_id` or `requirement_request_id`; unrelated groups remain enabled.

- [ ] **Step 5: Run the complete focused group**

  ```bash
  node --test \
    server/test_wechat_collector_api.mjs \
    server/test_wechat_requirement_collector.mjs \
    server/test_wechat_attachment_scanner.mjs \
    server/test_wechat_project_cleanup.mjs \
    server/test_wechat_visible_collect_cli.mjs \
    server/test_requirement_request_api.mjs
  ```

  Expected: all pass without launching WeChat or taking a real screenshot.

### Task 5: Verify screenshot intake is isolated from Fanwei

**Files:**
- Modify: `server/test_project_intake_api.mjs`
- Modify only if required: `server/easy_exam_server.mjs`

- [ ] **Step 1: Add an isolation assertion**

  Exercise the screenshot-intake parse/create handlers with injected OCR output. Assert the result uses the requirement store and project task creation path and does not invoke Fanwei bridge, Fanwei Chrome read, Fanwei workbook generation, or automatic job execution.

- [ ] **Step 2: Run intake and protected tests together**

  ```bash
  node --test \
    server/test_project_intake_api.mjs \
    server/test_pr5_protected_workflows.mjs \
    server/test_fanwei_auto_read.mjs \
    server/test_fanwei_bridge.mjs \
    server/test_fanwei_requirement_mapper.mjs
  ```

  Expected: all pass.

### Task 6: Commit requirement and WeChat hardening

**Files:**
- All files changed in Tasks 1-5.

- [ ] **Step 1: Run `git diff --check` and inspect `git diff --stat`**

  Expected: no protected exact file changed. Any shared-file edit is limited to project intake or requirement/WeChat UI wiring.

- [ ] **Step 2: Run the focused group plus protection gate one final time**

  Expected: all pass.

- [ ] **Step 3: Commit**

  ```bash
  git add server outputs/web_prototype/easy_exam_automation.html
  git commit -m "fix: harden requirement and WeChat workflows"
  ```
