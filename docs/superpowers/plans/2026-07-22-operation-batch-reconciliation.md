# 运控批次创建结果对账实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 可靠读取并回填已创建的运控批次代码，在结果未确认时阻止重复创建，并通过只读列表对账恢复当前历史项目。

**Architecture:** `operation_batch_runner.mjs` 负责详情页条件等待和按精确批次名称的列表查询；`operation_batch.mjs` 负责待同步状态判定和审计事件；服务器提供独立只读对账路由并与创建流程共用浏览器互斥锁。项目工作流和页面将 `reconciliation_required` 显示为“待同步”，只开放对账与人工补录，不开放再次创建。

**Tech Stack:** Node.js ESM、`node:test`、Playwright、SQLite、单文件 HTML/JavaScript 控制台。

## Global Constraints

- 不通过自动测试或验收再次创建真实运控批次。
- 对账必须精确匹配批次名称所在行；零条、多条或多个不同代码时不得猜测。
- 当前 legacy 错误“创建完成，但未能从详情页读取批次代码”必须被识别为待同步。
- 只有取得合法批次代码后才能写入本地成功状态。
- “有变更请确认”属于来源变更审核，本次不自动清除。
- 不修改自动配置、考试列表、名单导入和泛微读取等受保护流程。

---

### Task 1: 批次结果解析与只读列表对账

**Files:**
- Modify: `server/operation_batch_runner.mjs`
- Test: `server/test_operation_batch.mjs`

**Interfaces:**
- Produces: `operationBatchListResultFromRows(rowTexts, batchName, detailUrl)`，返回唯一批次结果或 `null`，歧义时抛错。
- Produces: `resolveSubmittedOperationBatch(page, options)`，详情代码就绪时返回详情结果，否则原样返回 `findFromList` 的结果。
- Produces: `runOperationBatchReconciliation(draft, options)`，只打开批次列表并查询，不点击创建。
- Produces: `OPERATION_BATCH_RECONCILIATION_REQUIRED` 稳定错误码。

- [ ] **Step 1: 写失败测试覆盖精确行解析**

在 `server/test_operation_batch.mjs` 增加：

```js
test("operation batch list result only reads the exact batch row", () => {
  const result = operationBatchListResultFromRows([
    "QTT260006\n其他项目_2026年8月",
    "QTT260007\n目标项目_2026年8月",
  ], "目标项目_2026年8月", "http://operation/batch/batchList");
  assert.equal(result.operationBatchCode, "QTT260007");
});

test("operation batch list result rejects ambiguous exact matches", () => {
  assert.throws(() => operationBatchListResultFromRows([
    "QTT260007\n目标项目_2026年8月",
    "QTT260008\n目标项目_2026年8月",
  ], "目标项目_2026年8月", "http://operation/batch/batchList"), /多个批次代码/);
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test server/test_operation_batch.mjs`

Expected: 因导出函数不存在而失败。

- [ ] **Step 3: 实现精确行解析并替换整页首个代码扫描**

`operationBatchListResultFromRows` 只接受文本中包含精确 `batchName` 的行，提取唯一非空代码；`findCreatedBatchFromList` 使用表格行文本调用该函数。零条返回 `null`，多个不同代码抛出明确错误。

- [ ] **Step 4: 写失败测试覆盖详情延迟和列表回退**

用最小 fake page 测试 `resolveSubmittedOperationBatch`：

```js
test("submitted batch falls back to list and preserves the lookup result", async () => {
  const expected = {
    operationBatchCode: "QTT260007",
    batchGuid: "",
    detailUrl: "http://operation/batch/batchList",
    status: "created_unpublished",
  };
  const result = await resolveSubmittedOperationBatch(fakeDetailPageWithoutCode(), {
    batchListUrl: expected.detailUrl,
    batchName: "目标项目_2026年8月",
    findFromList: async () => expected,
    detailCodeWaitMs: 1,
  });
  assert.deepEqual(result, expected);
});
```

另加详情代码延迟出现时不调用列表的测试。

- [ ] **Step 5: 运行测试确认 RED**

Run: `node --test server/test_operation_batch.mjs`

Expected: 因结果解析函数不存在而失败。

- [ ] **Step 6: 实现提交结果解析和只读对账 runner**

创建流程在点击“完成”前标记提交边界；从该边界开始的异常统一包装成：

```js
error.code = OPERATION_BATCH_RECONCILIATION_REQUIRED;
error.status = 409;
```

详情页先条件等待代码，失败后显式 `return await findCreatedBatchFromList(...)`。只读对账 runner 复用相同持久化浏览器配置、登录检查和精确列表查询，但不调用任何创建按钮。

- [ ] **Step 7: 运行 focused 测试确认 GREEN**

Run: `node --test server/test_operation_batch.mjs`

Expected: 全部通过。

### Task 2: 待同步状态、审计与服务端路由

**Files:**
- Modify: `server/operation_batch.mjs`
- Modify: `server/easy_exam_server.mjs`
- Modify: `server/pr5_protected_workflows.mjs`
- Test: `server/test_operation_batch.mjs`
- Test: `server/test_server_config.mjs`
- Test: `server/test_pr5_protected_workflows.mjs`

**Interfaces:**
- Consumes: `runOperationBatchReconciliation` 和 `OPERATION_BATCH_RECONCILIATION_REQUIRED`。
- Produces: `operationBatchNeedsReconciliation(task)`。
- Produces: `POST /api/tasks/:taskId/operation-batch/reconcile`。

- [ ] **Step 1: 写失败状态测试**

```js
test("operation batch reconciliation state includes legacy submitted errors", () => {
  assert.equal(operationBatchNeedsReconciliation({
    config: { operationBatch: { status: "failed", errorMessage: "创建完成，但未能从详情页读取批次代码" } },
  }), true);
  assert.equal(operationBatchNeedsReconciliation({
    config: { operationBatch: { status: "failed", errorMessage: "登录失败" } },
  }), false);
});
```

扩展 `applyOperationBatchResult` 测试，传入 `eventType: "operation_batch_reconciled"` 后断言审计事件类型准确。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test server/test_operation_batch.mjs`

Expected: 新 helper 不存在或审计事件仍为 `operation_batch_created`。

- [ ] **Step 3: 实现状态 helper 和审计事件参数**

`operationBatchNeedsReconciliation` 检查合法代码、稳定状态/错误码及唯一 legacy 错误文案。`applyOperationBatchResult` 使用 `result.eventType || "operation_batch_created"`，已有代码时由路由提前幂等返回，不追加重复事件。

- [ ] **Step 4: 写失败的服务器接线测试**

在 `test_server_config.mjs` 断言：

```js
assert.match(serverSource, /runOperationBatchReconciliation/);
assert.match(serverSource, /operation-batch\\\/reconcile/);
assert.ok(createHandler.includes("operationBatchNeedsReconciliation"));
```

在保护工作流测试期望列表中加入精确 reconcile route，确保宽泛路由仍被拒绝。

- [ ] **Step 5: 运行服务器测试确认 RED**

Run: `node --test server/test_server_config.mjs server/test_pr5_protected_workflows.mjs`

Expected: 对账 import、handler、route 和 allowlist 不存在。

- [ ] **Step 6: 实现服务端创建保护和对账 handler**

- 创建接口检测 `operationBatchNeedsReconciliation(task)` 后返回 `409`，不调用创建 runner。
- 创建和对账使用同一个全局浏览器自动化锁，避免两个项目同时打开同一 persistent profile。
- runner 抛出稳定待同步错误时保存 `status: "reconciliation_required"` 和 `errorCode`；明确创建前失败仍保存 `failed`。
- 对账 handler 允许任何无代码任务调用，查询成功时以 `operation_batch_reconciled` 回填；找不到或歧义时保留待同步。
- 新增精确 POST 路由并扩展 PR 5 allowlist。

- [ ] **Step 7: 运行服务端 focused 测试确认 GREEN**

Run: `node --test server/test_operation_batch.mjs server/test_server_config.mjs server/test_pr5_protected_workflows.mjs`

Expected: 全部通过。

### Task 3: 工作流与项目页面待同步体验

**Files:**
- Modify: `server/project_workflow.mjs`
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Test: `server/test_project_workflow.mjs`
- Test: `server/test_ui_views.mjs`

**Interfaces:**
- Consumes: `operationBatchNeedsReconciliation(task)` 和 reconcile API。
- Produces: 工作流状态 `reconciliation_required`，页面文案“待同步”和按钮“查询并同步已有批次”。

- [ ] **Step 1: 写失败工作流测试**

```js
test("workflow does not mark an unresolved external batch as creatable", () => {
  const workflow = buildProjectWorkflow({
    config: { operationBatch: { status: "reconciliation_required" } },
    sessions: [],
  }, { warnings: [] });
  assert.equal(workflow.steps.batch.status, "reconciliation_required");
});
```

- [ ] **Step 2: 写失败 UI 结构测试**

在 `test_ui_views.mjs` 断言：

```js
assert.ok(html.includes('id="operationBatchReconcileBtn"'));
assert.ok(html.includes('reconciliation_required: "待同步"'));
assert.ok(html.includes('/operation-batch/reconcile'));
```

并在 `updateOperationBatchActions` 源码块中断言待同步时创建按钮禁用、对账按钮显示。

- [ ] **Step 3: 运行测试确认 RED**

Run: `node --test server/test_project_workflow.mjs server/test_ui_views.mjs`

Expected: 工作流仍为 `ready`，页面缺少对账控件。

- [ ] **Step 4: 实现工作流与 UI 最小改动**

- `buildProjectWorkflow` 在无代码且待同步时返回 `reconciliation_required`。
- 增加对账按钮、状态标签和事件处理函数。
- 待同步时隐藏/禁用创建按钮，保留人工补录。
- 对账成功后刷新当前项目、批次展示和工作流；失败沿用 API 的明确错误信息。

- [ ] **Step 5: 运行 focused 测试确认 GREEN**

Run: `node --test server/test_project_workflow.mjs server/test_ui_views.mjs`

Expected: 全部通过。

### Task 4: 全量验证、提交和当前项目恢复

**Files:**
- Test only, then managed runtime synchronization.

**Interfaces:**
- Consumes: 完成后的 reconcile API。
- Produces: 当前项目真实批次代码的本地回填证据和 8765 页面“已完成”状态。

- [ ] **Step 1: 运行全部 Node 测试**

Run: `node --test server/test_*.mjs`

Expected: `fail 0`。

- [ ] **Step 2: 运行全部 Python 测试**

Run: `python3 -m unittest discover -s server -p 'test_*.py'`

Expected: `OK`。如项目依赖绑定 runtime Python，使用工作区依赖提供的 Python 路径重跑。

- [ ] **Step 3: 检查差异和受保护工作流**

Run: `git diff --check && git status --short && git diff --stat`

Expected: 无空白错误，只有设计范围内文件变化。

- [ ] **Step 4: 提交实现**

```bash
git add server outputs/web_prototype/easy_exam_automation.html docs/superpowers/plans/2026-07-22-operation-batch-reconciliation.md
git commit -m "fix: reconcile created operation batches"
```

- [ ] **Step 5: 同步并重启 8765 管理运行时**

使用项目现有同步脚本，保留 `runtime/task_state.sqlite3` 和运控浏览器 profile；重启 LaunchAgent 后执行 HTTP 健康检查。

- [ ] **Step 6: 只读对账当前项目**

调用：

```text
POST /api/tasks/ff4a7062-2c29-4e31-97e8-de39b0bb79f2/operation-batch/reconcile
```

该调用只查询运控批次列表。断言响应包含非空、格式合法的 `operationBatchCode`，本地 SQLite 同步保存相同代码，工作流 `steps.batch.status` 为 `success`。

- [ ] **Step 7: 最终运行态核验**

刷新项目页面，确认“建批次”显示“已完成”、人员和内容任务不再显示“等待批次”，同时“有变更请确认”仍按原来源审核规则保留。
