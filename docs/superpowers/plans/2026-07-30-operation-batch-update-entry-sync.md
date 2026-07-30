# 建批次详情修改入口同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“建批次”外层为“可修改”时，详情页立即显示修改入口、当前值与最新需求值，并在打开详情时刷新精确状态。

**Architecture:** 继续以服务端批次修改状态为精确数据源，同时用已加载的项目工作流状态作为详情页即时回退。复用现有 `renderOperationBatchUpdateState` 和 `renderOperationBatchUpdatePreview`，不增加新的状态模型或运控接口。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Node.js `node:test`、现有 8765 本地 LaunchAgent 运行时。

## Global Constraints

- 不增加手工日期编辑框。
- 不用最新需求覆盖运控已应用值。
- 打开详情不得调用 `POST /operation-batch/update-preview`，不得写入运控。
- 只有用户点击“修改批次信息”后才读取运控当前值并进入二次确认。
- 项目切换后必须丢弃旧项目的异步响应。

---

### Task 1: 建批次详情即时状态与主动刷新

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Test: `server/test_ui_views.mjs`

**Interfaces:**
- Consumes: `taskViewState.currentProjectWorkflow.steps.batch.status`、`managedChanges`、`loadOperationBatchUpdateState(task, requestToken)`
- Produces: `operationBatchUpdateStateFromWorkflow(workflow)`，返回可直接传给 `renderOperationBatchUpdateState` 的 `{ pageStatus, state }`

- [ ] **Step 1: Write the failing tests**

在 `server/test_ui_views.mjs` 增加：

```js
test("opening batch detail immediately exposes workflow update state and refreshes exact state", async () => {
  const events = [];
  const state = { hidden: true, disabled: true, textContent: "" };
  // 编译 openOperationDetail，传入 workflow batch.status=update_available。
  // 断言 show 之前或紧随 show 已调用 renderOperationBatchUpdateState，
  // 修改按钮未隐藏，并调用一次 loadOperationBatchUpdateState。
  assert.deepEqual(events, ["render:update_available", "show", "load"]);
  assert.equal(state.hidden, false);
});

test("batch detail keeps its workflow update action when exact state refresh fails", async () => {
  // loadOperationBatchUpdateState 抛出“状态接口暂不可用”。
  // 断言 openOperationDetail 不向外抛错，按钮仍显示，
  // 状态区包含“读取批次修改状态失败”与原始错误。
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-name-pattern "opening batch detail|batch detail keeps" server/test_ui_views.mjs
```

Expected: FAIL，因为 `openOperationDetail("batch")` 当前既不渲染工作流回退状态，也不调用 `loadOperationBatchUpdateState`。

- [ ] **Step 3: Implement the minimum refresh behavior**

在页面脚本中新增：

```js
function operationBatchUpdateStateFromWorkflow(workflow = {}) {
  const batch = workflow.steps?.batch || {};
  return {
    pageStatus: batch.status || "",
    state: {
      status: batch.status || "",
      changes: Array.isArray(batch.managedChanges) ? batch.managedChanges : [],
    },
  };
}
```

修改 `openOperationDetail`：

```js
if (stepKey === "batch") {
  renderOperationBatchUpdateState(
    operationBatchUpdateStateFromWorkflow(taskViewState.currentProjectWorkflow),
  );
}
showProjectDialog(operationDetailModal, trigger);
if (stepKey === "batch") {
  try {
    await loadOperationBatchUpdateState(
      taskViewState.currentProject,
      taskViewState.operationBatchUpdateRequestToken,
    );
  } catch (error) {
    const fallback = operationBatchUpdateStateFromWorkflow(
      taskViewState.currentProjectWorkflow,
    );
    renderOperationBatchUpdateState({
      ...fallback,
      errorMessage: `读取批次修改状态失败：${error?.message || String(error)}`,
    });
  }
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add outputs/web_prototype/easy_exam_automation.html server/test_ui_views.mjs
git commit -m "fix: refresh batch update entry on detail open"
```

---

### Task 2: 在详情状态区展示受管字段差异

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Test: `server/test_ui_views.mjs`

**Interfaces:**
- Consumes: `state.state.changes` 或 `state.changes`
- Produces: `renderOperationBatchUpdateState` 在 `update_available` 时复用 `renderOperationBatchUpdatePreview({ changes })`

- [ ] **Step 1: Write the failing test**

在 `server/test_ui_views.mjs` 的批次状态渲染测试中加入：

```js
renderOperationBatchUpdateState({
  pageStatus: "update_available",
  state: {
    status: "update_available",
    changes: [
      {
        path: "examStartDate",
        label: "概况考试开始日期",
        before: "2026-08-22",
        after: "2026-08-23",
      },
    ],
  },
});
assert.match(operationBatchUpdateStateText.innerHTML, /2026-08-22 → 2026-08-23/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-name-pattern "operation batch update state helpers" server/test_ui_views.mjs
```

Expected: FAIL，因为当前状态区只显示“可修改”，不显示 `changes`。

- [ ] **Step 3: Implement escaped difference display**

在 `renderOperationBatchUpdateState` 中读取变化并复用既有安全渲染器：

```js
const changes = Array.isArray(state.changes)
  ? state.changes
  : Array.isArray(state.state?.changes) ? state.state.changes : [];
const changesHtml = status === "update_available" && changes.length
  ? `<div class="operation-batch-update-differences">${renderOperationBatchUpdatePreview({ changes })}</div>`
  : "";
```

将 `changesHtml` 合并到状态详情，不改变冲突差异和错误提示。

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command.

Expected: PASS，且转义测试继续通过。

- [ ] **Step 5: Commit**

```bash
git add outputs/web_prototype/easy_exam_automation.html server/test_ui_views.mjs
git commit -m "fix: show pending batch changes in detail"
```

---

### Task 3: 全量验证与本地运行时同步

**Files:**
- Verify: `outputs/web_prototype/easy_exam_automation.html`
- Verify: `server/test_ui_views.mjs`
- Runtime target: `/Users/ata/Library/Application Support/easy-exam-automation/app`

**Interfaces:**
- Consumes: Task 1、Task 2 的提交
- Produces: 8765 上可实际复验的建批次详情

- [ ] **Step 1: Run relevant batch and UI tests**

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_batch_update.mjs server/test_operation_batch_update_routes.mjs server/test_operation_batch_update_service.mjs server/test_ui_views.mjs
```

Expected: 全部 PASS。

- [ ] **Step 2: Run full Node and Python tests**

```bash
for f in server/test_*.mjs; do
  [ "$f" = "server/test_exam_time_only.mjs" ] && continue
  printf '%s\n' "$f"
done | xargs /Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test

/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest discover -s server -p 'test_*.py'
```

Expected: 全部 PASS。

- [ ] **Step 3: Deploy and restart the local runtime**

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/deploy_launchd_runtime.mjs
launchctl kickstart -k gui/501/com.ata.easy-exam-service
curl -sS --max-time 10 http://127.0.0.1:8765/api/health
```

Expected: health 返回 `{"ok":true}`。

- [ ] **Step 4: Verify the actual UI without an operation write**

在 8765 打开项目 `b8e1af6b-7f2f-4490-926e-c2dda94f1461`：

1. 外层“建批次”显示“可修改”。
2. 打开详情后立即看到“修改批次信息”。
3. 详情显示 2026-08-22 → 2026-08-23。
4. 点击按钮能进入二次确认窗。
5. 点击“取消”，不得点击“确认按以上内容修改批次”。

- [ ] **Step 5: Record final repository evidence**

```bash
git status --short
git log -3 --oneline
```

Expected: 工作树干净，最新提交只包含本计划范围内的前端、测试和文档变化。
