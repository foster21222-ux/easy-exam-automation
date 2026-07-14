# Project and Exam List Fast Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render authorized project cards and exam rows from local list data before per-project detail synchronization finishes.

**Architecture:** Add one small reusable staged-list loader that renders initial data immediately, starts detail loading without blocking the first render, and discards stale completions after a newer refresh. Keep existing project and exam renderers, APIs, ownership filtering, and background detail synchronization unchanged.

**Tech Stack:** Native ES modules, browser Fetch API, Node.js `node:test`.

---

## File Structure

- Create `web/staged_list_loader.mjs`: generic two-stage loading and refresh-generation guard.
- Create `server/test_staged_list_loader.mjs`: behavioral unit tests for early rendering and stale-result rejection.
- Modify `outputs/web_prototype/easy_exam_automation.html`: connect project and exam loading to the staged loader without changing their renderers or actions.
- Modify `server/test_ui_views.mjs`: integration contract proving both list pages use staged rendering and retain detail refresh.

### Task 1: Staged List Loader

**Files:**
- Create: `server/test_staged_list_loader.mjs`
- Create: `web/staged_list_loader.mjs`

- [ ] **Step 1: Write the failing early-render and stale-result tests**

```js
import assert from "node:assert/strict";
import test from "node:test";

import { createStagedListLoader } from "../web/staged_list_loader.mjs";

const flushBackgroundWork = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("renders initial list before background details finish", async () => {
  const pendingDetail = deferred();
  const renders = [];
  const load = createStagedListLoader({
    loadInitial: async () => ["summary"],
    getDetailItems: (initial) => initial,
    loadDetail: async () => pendingDetail.promise,
    applyInitial: (initial) => renders.push(["initial", initial]),
    applyDetails: (details) => renders.push(["details", details]),
  });

  await load();
  assert.deepEqual(renders, [["initial", ["summary"]]]);

  pendingDetail.resolve("full");
  await flushBackgroundWork();
  assert.deepEqual(renders, [
    ["initial", ["summary"]],
    ["details", ["full"]],
  ]);
});

test("a newer refresh rejects an older detail completion", async () => {
  const firstDetail = deferred();
  let initialCall = 0;
  const renders = [];
  const load = createStagedListLoader({
    loadInitial: async () => [++initialCall],
    getDetailItems: (initial) => initial,
    loadDetail: async (value) => value === 1 ? firstDetail.promise : `full-${value}`,
    applyInitial: (initial) => renders.push(["initial", initial]),
    applyDetails: (details) => renders.push(["details", details]),
  });

  await load();
  await load();
  await flushBackgroundWork();
  firstDetail.resolve("full-1");
  await flushBackgroundWork();

  assert.deepEqual(renders, [
    ["initial", [1]],
    ["initial", [2]],
    ["details", ["full-2"]],
  ]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_staged_list_loader.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `web/staged_list_loader.mjs`.

- [ ] **Step 3: Implement the minimal staged loader**

```js
export function createStagedListLoader({
  loadInitial,
  getDetailItems,
  loadDetail,
  applyInitial,
  applyDetails,
}) {
  let generation = 0;

  return async function loadList() {
    const currentGeneration = ++generation;
    const initial = await loadInitial();
    if (currentGeneration !== generation) return;

    applyInitial(initial);
    const detailItems = getDetailItems(initial);
    void Promise.all(detailItems.map((item) => loadDetail(item))).then(
      (details) => {
        if (currentGeneration !== generation) return;
        applyDetails(details, initial);
      },
      () => {},
    );
  };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_staged_list_loader.mjs
```

Expected: 2 tests pass.

### Task 2: Project List Staged Rendering

**Files:**
- Modify: `server/test_ui_views.mjs`
- Modify: `outputs/web_prototype/easy_exam_automation.html`

- [ ] **Step 1: Add a failing project-list integration contract**

Add a test that extracts the project loader source and asserts all of these literals are present:

```js
test("project management renders local cards before detail synchronization", () => {
  assert.ok(html.includes('import { createStagedListLoader } from "/web/staged_list_loader.mjs"'));
  const source = sourceBetween(
    "const runProjectListLoad = createStagedListLoader({",
    "async function deleteProjectCard",
  );
  assert.ok(source.includes("Promise.all(["));
  assert.ok(source.includes("fetchJson(`/api/tasks?_=${Date.now()}`)"));
  assert.ok(source.includes("fetchJson(`/api/exams?_=${Date.now()}`)"));
  assert.ok(source.includes("applyInitial:"));
  assert.ok(source.includes("renderProjectList();"));
  assert.ok(source.includes("loadDetail:"));
  assert.ok(source.includes("applyDetails:"));
});
```

- [ ] **Step 2: Run the integration test and verify RED**

Run:

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_ui_views.mjs
```

Expected: FAIL because the staged-loader import and project loader are absent.

- [ ] **Step 3: Connect `loadProjects` to the staged loader**

Import the loader with the existing page-module imports:

```js
import { createStagedListLoader } from "/web/staged_list_loader.mjs";
```

Replace the current blocking `loadProjects` body with a `runProjectListLoad` instance that:

```js
const runProjectListLoad = createStagedListLoader({
  loadInitial: async () => {
    const [taskData, examData] = await Promise.all([
      fetchJson(`/api/tasks?_=${Date.now()}`),
      fetchJson(`/api/exams?_=${Date.now()}`),
    ]);
    return {
      summaries: taskData.tasks || [],
      sessions: examData.sessions || [],
    };
  },
  getDetailItems: ({ summaries }) => summaries,
  loadDetail: async (task) => {
    try { return await fetchJson(`/api/tasks/${encodeURIComponent(task.taskId)}?_=${Date.now()}`); }
    catch { return task; }
  },
  applyInitial: ({ summaries, sessions }) => {
    const sessionsByTask = new Map();
    for (const session of sessions) {
      const taskSessions = sessionsByTask.get(session.taskId) || [];
      taskSessions.push(session);
      sessionsByTask.set(session.taskId, taskSessions);
    }
    taskViewState.tasks = summaries.map((task) => ({
      ...task,
      sessions: sessionsByTask.get(task.taskId) || [],
    }));
    renderProjectList();
  },
  applyDetails: (details) => {
    taskViewState.tasks = details;
    renderProjectList();
  },
});

async function loadProjects() {
  return runProjectListLoad();
}
```

- [ ] **Step 4: Run UI and loader tests and verify GREEN**

Run:

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_staged_list_loader.mjs server/test_ui_views.mjs
```

Expected: all focused tests pass.

### Task 3: Exam List Staged Rendering

**Files:**
- Modify: `server/test_ui_views.mjs`
- Modify: `outputs/web_prototype/easy_exam_automation.html`

- [ ] **Step 1: Add a failing exam-list integration contract**

```js
test("exam list renders session rows before detail synchronization", () => {
  const source = sourceBetween(
    "const runExamListLoad = createStagedListLoader({",
    "function cloneTaskStep",
  );
  assert.ok(source.includes("fetchJson(`/api/exams?_=${Date.now()}`)"));
  assert.ok(source.includes("applyInitial:"));
  assert.ok(source.includes("taskViewState.sessions = sessions;"));
  assert.ok(source.includes("renderExamList();"));
  assert.ok(source.includes("loadDetail:"));
  assert.ok(source.includes("applyDetails:"));
});
```

- [ ] **Step 2: Run the integration test and verify RED**

Run:

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_ui_views.mjs
```

Expected: FAIL because `runExamListLoad` is absent.

- [ ] **Step 3: Connect `loadExams` to the staged loader**

```js
const runExamListLoad = createStagedListLoader({
  loadInitial: async () => {
    const data = await fetchJson(`/api/exams?_=${Date.now()}`);
    return data.sessions || [];
  },
  getDetailItems: (sessions) => [...new Set(sessions.map((session) => session.taskId).filter(Boolean))],
  loadDetail: async (taskId) => {
    try {
      return [taskId, await fetchJson(`/api/tasks/${encodeURIComponent(taskId)}?_=${Date.now()}`)];
    } catch {
      return [taskId, null];
    }
  },
  applyInitial: (sessions) => {
    taskViewState.sessions = sessions;
    taskViewState.examTaskDetails = {};
    renderExamList();
  },
  applyDetails: (detailEntries) => {
    taskViewState.examTaskDetails = Object.fromEntries(detailEntries.filter(([, task]) => task));
    renderExamList();
  },
});

async function loadExams() {
  return runExamListLoad();
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_staged_list_loader.mjs server/test_ui_views.mjs server/test_page_boundaries.mjs server/test_app_router.mjs
```

Expected: all focused tests pass.

### Task 4: Regression and Live Runtime Verification

**Files:**
- Verify: `outputs/web_prototype/easy_exam_automation.html`
- Verify: `web/staged_list_loader.mjs`
- Verify: `server/test_staged_list_loader.mjs`
- Deploy with: `scripts/sync_local_runtime.mjs`

- [ ] **Step 1: Run syntax and relevant regression tests**

Run:

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check web/staged_list_loader.mjs
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_staged_list_loader.mjs server/test_ui_views.mjs server/test_page_boundaries.mjs server/test_app_router.mjs server/test_server_config.mjs server/test_local_auth.mjs
```

Expected: syntax check exits 0 and all selected tests pass.

- [ ] **Step 2: Sync the tracked runtime files to port 8765**

Run:

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/sync_local_runtime.mjs
```

Expected: the sync reports `outputs/web_prototype/easy_exam_automation.html`, `web/staged_list_loader.mjs`, and relevant tracked runtime files copied, then restarts `com.chen.yikao-auto-config-web`.

- [ ] **Step 3: Verify deployed routes, module, and authorization**

Use an existing valid local session without printing its token. Verify:

```text
GET /projects -> 200
GET /exams -> 200
GET /web/staged_list_loader.mjs -> 200
GET /api/tasks -> only the signed-in user's authorized projects
GET /api/exams -> only the signed-in user's authorized exam sessions
```

Expected: admin and colleague ownership filtering matches the pre-change API results because the server handlers are unchanged.

- [ ] **Step 4: Measure first render and background completion in a real browser**

Instrument browser requests and DOM changes without modifying production code. Record navigation start, first `.project-card` or `.exam-list-row`, and completion of `/api/tasks/:id` requests.

Expected:

```text
first project card < project detail batch completion
first exam row < exam detail batch completion
```

Verify search, status filters, current/ended exam toggle, refresh buttons, project card actions, and detail links still work.

## Dirty Worktree Handling

The HTML and `server/test_ui_views.mjs` already contain unrelated user changes. Do not stage or commit those files as a whole. Keep edits narrowly scoped, inspect the final diff around each changed block, and leave implementation changes uncommitted unless a safe patch-only staging method is explicitly requested.
