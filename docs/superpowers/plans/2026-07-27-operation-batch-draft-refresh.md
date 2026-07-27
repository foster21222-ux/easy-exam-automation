# Operation Batch Draft Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the operation batch panel keeps the fresh server-generated draft after a business-requirement save.

**Architecture:** Keep the existing server response and rendering pipeline. Remove only the redundant final render that replaces the response `batchDraft` with the persisted historical `operationBatch.draft`.

**Tech Stack:** Node.js, native browser JavaScript, `node:test`, static HTML application.

## Global Constraints

- `businessRequirement.batch_name` remains the authoritative batch name.
- Do not persist or overwrite a historical operation attempt draft as part of this fix.
- Do not modify unrelated operation batch creation or update behavior.

---

### Task 1: Preserve the fresh batch draft after source save

**Files:**
- Modify: `server/test_ui_views.mjs`
- Modify: `outputs/web_prototype/easy_exam_automation.html`

**Interfaces:**
- Consumes: `saveProjectSourceDetail()` response fields `task`, `workflow`, and `batchDraft`.
- Produces: The final `projectOperationBatchDraft` display rendered from `result.batchDraft`.

- [ ] **Step 1: Write the failing behavior test**

Compile the real `saveProjectSourceDetail()` function. Use controlled renderer
dependencies where the project-detail renderer exposes an old persisted draft,
the workflow renderer exposes the new response draft, and the operation-task
renderer exposes the old persisted draft. Assert that the final visible value is
the literal `湖北邮政_2026年8月`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --test-name-pattern="source save keeps the fresh operation batch draft" \
  server/test_ui_views.mjs
```

Expected: FAIL because the final value is
`中国邮政集团公司湖北省分公司招聘考试_2026年8月`.

- [ ] **Step 3: Implement the minimal fix**

In `saveProjectSourceDetail()`, remove only:

```javascript
renderOperationBatchFromTask(result.task);
```

The preceding `renderProjectDetail(result.task)` and
`renderProjectWorkflow(result.task, result.workflow || {}, result.batchDraft || {})`
remain unchanged.

- [ ] **Step 4: Verify GREEN and regressions**

Run the focused test again, then run:

```bash
/bin/zsh -lc 'for f in server/test_*.mjs; do [ "$f" = "server/test_exam_time_only.mjs" ] && continue; printf "%s\n" "$f"; done | xargs /Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test'
```

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  -m unittest discover -s server -p 'test_*.py'
```

- [ ] **Step 5: Deploy and verify**

Deploy the LaunchAgent runtime, restart `com.ata.easy-exam-service`, verify
`http://127.0.0.1:8765/api/health`, and confirm the project `R0031682` shows
`湖北邮政_2026年8月` in the batch panel after a fresh page load.

- [ ] **Step 6: Commit**

Stage only the design, plan, test, and HTML change. Preserve
`docs/operation-personnel-task-test-evidence.md` as an untracked user file.
