# PR #5 Protected Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an executable guard that prevents the PR #5 integration from changing automatic configuration, exam list/detail, candidate import, or the Fanwei requirement-to-auto-config workflow.

**Architecture:** Compare files wholly owned by protected workflows byte-for-byte with production baseline `e3250c09bfb2666a9787b4d23bdf348634f69ff8`. For the two shared files that must receive new project-management wiring, assert stable protected route, selector, and handler sentinels and continue running their existing focused suites.

**Tech Stack:** Node.js ESM, `node:test`, Git object database, static HTML/JS frontend.

---

### Task 1: Record the production protection manifest

**Files:**
- Create: `server/pr5_protected_workflows.mjs`
- Test: `server/test_pr5_protected_workflows.mjs`

- [ ] **Step 1: Add a failing manifest test**

  Create `server/test_pr5_protected_workflows.mjs` with a test that imports `PROTECTED_BASE_COMMIT`, `PROTECTED_EXACT_FILES`, and `PROTECTED_SENTINELS`. Initially the import must fail because the manifest module does not exist.

  ```js
  import assert from "node:assert/strict";
  import test from "node:test";
  import {
    PROTECTED_BASE_COMMIT,
    PROTECTED_EXACT_FILES,
    PROTECTED_SENTINELS,
  } from "./pr5_protected_workflows.mjs";

  test("PR 5 protection manifest is anchored to the deployed main commit", () => {
    assert.equal(PROTECTED_BASE_COMMIT, "e3250c09bfb2666a9787b4d23bdf348634f69ff8");
    assert.ok(PROTECTED_EXACT_FILES.includes("web/pages/AutoConfigPage.mjs"));
    assert.ok(PROTECTED_EXACT_FILES.includes("web/pages/ExamListPage.mjs"));
    assert.ok(PROTECTED_EXACT_FILES.includes("web/pages/ExamDetailPage.mjs"));
    assert.ok(PROTECTED_EXACT_FILES.includes("web/pages/CandidateImportPage.mjs"));
    assert.ok(PROTECTED_EXACT_FILES.includes("server/fanwei_auto_read.mjs"));
    assert.ok(PROTECTED_SENTINELS["server/easy_exam_server.mjs"].length > 0);
  });
  ```

- [ ] **Step 2: Run the test and verify the expected failure**

  Run:

  ```bash
  node --test server/test_pr5_protected_workflows.mjs
  ```

  Expected: `ERR_MODULE_NOT_FOUND` for `server/pr5_protected_workflows.mjs`.

- [ ] **Step 3: Implement the manifest**

  Add exact-file entries for these protected ownership areas:

  ```js
  export const PROTECTED_BASE_COMMIT = "e3250c09bfb2666a9787b4d23bdf348634f69ff8";

  export const PROTECTED_EXACT_FILES = [
    "server/fanwei_auto_read.mjs",
    "server/fanwei_bridge.mjs",
    "server/fanwei_local_helper.mjs",
    "server/fanwei_local_helper_cli.mjs",
    "server/fanwei_requirement_mapper.mjs",
    "server/fanwei_requirement_workbook.py",
    "server/candidate_course_assignment.mjs",
    "server/candidate_personal_fields.mjs",
    "server/candidate_tenant_payload.mjs",
    "server/candidate_list_parser.py",
    "server/room_assignment.mjs",
    "web/exam_task_view_model.mjs",
    "web/pages/AutoConfigPage.mjs",
    "web/pages/ExamListPage.mjs",
    "web/pages/ExamDetailPage.mjs",
    "web/pages/CandidateImportPage.mjs",
  ];

  export const PROTECTED_SENTINELS = {
    "server/easy_exam_server.mjs": [
      "/api/fanwei/requirement/preview",
      "/api/fanwei/auto-read",
      "handleCandidateImport",
      "handleExamList",
      "handleCreateJob",
    ],
    "outputs/web_prototype/easy_exam_automation.html": [
      "autoConfigView",
      "examListView",
      "candidateImportView",
      "fanweiRequirement",
    ],
  };
  ```

  Before saving, expand `PROTECTED_EXACT_FILES` with every tracked file under `web/components/auto-config/` using `rg --files web/components/auto-config` so that the component set is frozen too.

- [ ] **Step 4: Re-run the manifest test**

  Run `node --test server/test_pr5_protected_workflows.mjs`.

  Expected: the manifest test passes.

### Task 2: Enforce exact-file and shared-file protection

**Files:**
- Modify: `server/test_pr5_protected_workflows.mjs`

- [ ] **Step 1: Add the exact comparison test**

  For each path in `PROTECTED_EXACT_FILES`, read the current worktree file and the baseline blob returned by:

  ```js
  execFileSync("git", ["show", `${PROTECTED_BASE_COMMIT}:${relativePath}`], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  ```

  Assert strict equality and include the relative path in the assertion message.

- [ ] **Step 2: Add the shared-file sentinel test**

  Read each shared file and assert that all registered sentinels occur. This test allows narrow operation, email, requirement, and WeChat additions while rejecting deletion of protected entry points.

- [ ] **Step 3: Prove the guard catches a protected edit**

  Temporarily append one space to `web/pages/ExamListPage.mjs`, run:

  ```bash
  node --test server/test_pr5_protected_workflows.mjs
  ```

  Expected: failure names `web/pages/ExamListPage.mjs`.

  Immediately remove only that temporary space with `apply_patch` and re-run the same command.

  Expected: pass.

### Task 3: Run the existing protected suites

**Files:**
- Test only; do not modify production files.

- [ ] **Step 1: Run the shared route and UI tests**

  ```bash
  node --test \
    server/test_app_router.mjs \
    server/test_server_config.mjs \
    server/test_ui_views.mjs \
    server/test_exam_task_view_model.mjs
  ```

  Expected: all tests pass.

- [ ] **Step 2: Run the Fanwei suites**

  ```bash
  node --test \
    server/test_fanwei_auto_read.mjs \
    server/test_fanwei_bridge.mjs \
    server/test_fanwei_local_helper.mjs \
    server/test_fanwei_requirement_mapper.mjs
  ```

  Expected: all tests pass without changing any Fanwei source.

- [ ] **Step 3: Run candidate and exam suites discovered in the repository**

  ```bash
  node --test \
    server/test_candidate_course_assignment.mjs \
    server/test_candidate_personal_fields.mjs \
    server/test_candidate_tenant_payload.mjs \
    server/test_room_assignment.mjs
  ```

  If a listed filename is absent, use `rg --files server | rg 'test_(candidate|room|exam)'` and run the corresponding existing file; do not invent or skip an existing suite.

- [ ] **Step 4: Run Python protected tests with the bundled runtime**

  If this worktree has no tracked `template/`, temporarily link the source checkout templates:

  ```bash
  ln -s "/Users/chen/Desktop/ai 易考/template" template
  /Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest discover -s server -p 'test_*.py'
  rm template
  ```

  Expected: 44 tests pass. The temporary link is absent afterward.

### Task 4: Commit the protection gate

**Files:**
- Create: `server/pr5_protected_workflows.mjs`
- Create: `server/test_pr5_protected_workflows.mjs`

- [ ] **Step 1: Verify only the protection files changed**

  Run `git status --short` and `git diff --check`.

  Expected: only the two files above are new; no protected production file is modified.

- [ ] **Step 2: Commit**

  ```bash
  git add server/pr5_protected_workflows.mjs server/test_pr5_protected_workflows.mjs
  git commit -m "test: protect existing production workflows"
  ```

- [ ] **Step 3: Re-run the protection test from the commit**

  Run `node --test server/test_pr5_protected_workflows.mjs`.

  Expected: pass on a clean worktree.
