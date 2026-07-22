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

- [x] **Step 1: 写失败测试覆盖精确行解析**

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

- [x] **Step 2: 运行测试确认 RED**

Run: `node --test server/test_operation_batch.mjs`

Expected: 因导出函数不存在而失败。

- [x] **Step 3: 实现精确行解析并替换整页首个代码扫描**

`operationBatchListResultFromRows` 只接受文本中包含精确 `batchName` 的行，提取唯一非空代码；`findCreatedBatchFromList` 使用表格行文本调用该函数。零条返回 `null`，多个不同代码抛出明确错误。

- [x] **Step 4: 写失败测试覆盖详情延迟和列表回退**

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

- [x] **Step 5: 运行测试确认 RED**

Run: `node --test server/test_operation_batch.mjs`

Expected: 因结果解析函数不存在而失败。

- [x] **Step 6: 实现提交结果解析和只读对账 runner**

创建流程在点击“完成”前标记提交边界；从该边界开始的异常统一包装成：

```js
error.code = OPERATION_BATCH_RECONCILIATION_REQUIRED;
error.status = 409;
```

详情页先条件等待代码，失败后显式 `return await findCreatedBatchFromList(...)`。只读对账 runner 复用相同持久化浏览器配置、登录检查和精确列表查询，但不调用任何创建按钮。

- [x] **Step 7: 运行 focused 测试确认 GREEN**

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

- [x] **Step 1: 写失败状态测试**

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

- [x] **Step 2: 运行测试确认 RED**

Run: `node --test server/test_operation_batch.mjs`

Expected: 新 helper 不存在或审计事件仍为 `operation_batch_created`。

- [x] **Step 3: 实现状态 helper 和审计事件参数**

`operationBatchNeedsReconciliation` 检查合法代码、稳定状态/错误码及唯一 legacy 错误文案。`applyOperationBatchResult` 使用 `result.eventType || "operation_batch_created"`，已有代码时由路由提前幂等返回，不追加重复事件。

- [x] **Step 4: 写失败的服务器接线测试**

在 `test_server_config.mjs` 断言：

```js
assert.match(serverSource, /runOperationBatchReconciliation/);
assert.match(serverSource, /operation-batch\\\/reconcile/);
assert.ok(createHandler.includes("operationBatchNeedsReconciliation"));
```

在保护工作流测试期望列表中加入精确 reconcile route，确保宽泛路由仍被拒绝。

- [x] **Step 5: 运行服务器测试确认 RED**

Run: `node --test server/test_server_config.mjs server/test_pr5_protected_workflows.mjs`

Expected: 对账 import、handler、route 和 allowlist 不存在。

- [x] **Step 6: 实现服务端创建保护和对账 handler**

- 创建接口检测 `operationBatchNeedsReconciliation(task)` 后返回 `409`，不调用创建 runner。
- 创建和对账使用同一个全局浏览器自动化锁，避免两个项目同时打开同一 persistent profile。
- runner 抛出稳定待同步错误时保存 `status: "reconciliation_required"` 和 `errorCode`；明确创建前失败仍保存 `failed`。
- 对账 handler 允许任何无代码任务调用，查询成功时以 `operation_batch_reconciled` 回填；找不到或歧义时保留待同步。
- 新增精确 POST 路由并扩展 PR 5 allowlist。
- 将已漂移的 `PROTECTED_BASE_COMMIT` 从旧整合点更新为本分支起点 `d4fb619512e5e8227a6c397c7c19b05c2b1daddd`，使保护测试继续约束当前主版本，而不是放宽或删除保护断言。

- [x] **Step 7: 运行服务端 focused 测试确认 GREEN**

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

- [x] **Step 1: 写失败工作流测试**

```js
test("workflow does not mark an unresolved external batch as creatable", () => {
  const workflow = buildProjectWorkflow({
    config: { operationBatch: { status: "reconciliation_required" } },
    sessions: [],
  }, { warnings: [] });
  assert.equal(workflow.steps.batch.status, "reconciliation_required");
});
```

- [x] **Step 2: 写失败 UI 结构测试**

在 `test_ui_views.mjs` 断言：

```js
assert.ok(html.includes('id="operationBatchReconcileBtn"'));
assert.ok(html.includes('reconciliation_required: "待同步"'));
assert.ok(html.includes('/operation-batch/reconcile'));
```

并在 `updateOperationBatchActions` 源码块中断言待同步时创建按钮禁用、对账按钮显示。

另断言当前任务若仍是 legacy 状态 `failed + 创建完成，但未能从详情页读取批次代码`，无需先刷新服务端工作流也会立即显示对账按钮并禁用创建按钮。

- [x] **Step 3: 运行测试确认 RED**

Run: `node --test server/test_project_workflow.mjs server/test_ui_views.mjs`

Expected: 工作流仍为 `ready`，页面缺少对账控件。

- [x] **Step 4: 实现工作流与 UI 最小改动**

- `buildProjectWorkflow` 在无代码且待同步时返回 `reconciliation_required`。
- 增加对账按钮、状态标签和事件处理函数。
- 待同步时隐藏/禁用创建按钮，保留人工补录。
- 对账成功后刷新当前项目、批次展示和工作流；失败沿用 API 的明确错误信息。
- 创建或对账接口返回 `409` 且响应中带有刚持久化的 `task` 时，立即使用 `error.response.task` 更新当前项目、批次展示和工作流，确保页面当次就进入“待同步”，不得继续显示“可创建”。

- [x] **Step 5: 运行 focused 测试确认 GREEN**

Run: `node --test server/test_project_workflow.mjs server/test_ui_views.mjs`

Expected: 全部通过。

### Task 4: 全量验证、提交和当前项目恢复

**Files:**
- Test only, then managed runtime synchronization.

**Interfaces:**
- Consumes: 完成后的 reconcile API。
- Produces: 当前项目真实批次代码的本地回填证据和 8765 页面“已完成”状态。

- [x] **Step 1: 运行全部 Node 测试**

Run: 自动化套件运行全部 `server/test_*.mjs`，排除显式依赖 `RUN_EXAM_TIME_ONLY=1` 和真实浏览器登录态的手工冒烟文件 `server/test_exam_time_only.mjs`。

Expected: 自动化套件 `fail 0`。手工冒烟文件的静态 Playwright 导入问题作为既有测试入口限制单独记录，不在本次业务修复中改写。

- [x] **Step 2: 运行全部 Python 测试**

Run: `python3 -m unittest discover -s server -p 'test_*.py'`

Expected: `OK`。如项目依赖绑定 runtime Python，使用工作区依赖提供的 Python 路径重跑。

- [x] **Step 3: 检查差异和受保护工作流**

Run: `git diff --check && git status --short && git diff --stat`

Expected: 无空白错误，只有设计范围内文件变化。

- [x] **Step 4: 提交实现**

```bash
git add server outputs/web_prototype/easy_exam_automation.html docs/superpowers/plans/2026-07-22-operation-batch-reconciliation.md
git commit -m "fix: reconcile created operation batches"
```

- [x] **Step 5: 同步并重启 8765 管理运行时**

使用项目现有同步脚本，保留 `runtime/task_state.sqlite3` 和运控浏览器 profile；重启 LaunchAgent 后执行 HTTP 健康检查。

- [ ] **Step 6: 只读对账当前项目**

调用：

```text
POST /api/tasks/ff4a7062-2c29-4e31-97e8-de39b0bb79f2/operation-batch/reconcile
```

该调用只查询运控批次列表。断言响应包含非空、格式合法的 `operationBatchCode`，本地 SQLite 同步保存相同代码，工作流 `steps.batch.status` 为 `success`。

- [ ] **Step 7: 最终运行态核验**

刷新项目页面，确认“建批次”显示“已完成”、人员和内容任务不再显示“等待批次”，同时“有变更请确认”仍按原来源审核规则保留。

> 运行态首次验收记录：自动化 Node `748/748`、Python `54/54` 通过；代码与 8765 同步成功，`.env` 哈希和持久数据 inode 均保持不变。首次对账因部署重建 `app` 后缺少 Playwright 返回 409；恢复依赖后的只读查询未找到唯一匹配，未回填、未调用创建。最终分支审查因此新增以下安全加固任务，完成前 Task 4 不视为验收完成。

### Task 5: Runner 提交边界、详情识别与真实列表查询加固

**Files:**
- Modify: `server/operation_batch_runner.mjs`
- Test: `server/test_operation_batch_runner_safety.mjs`
- Test: `server/test_operation_batch.mjs`（仅在不与并行任务冲突时）

**Interfaces:**
- 详情代码只允许从已确认的 `batchDetail` 页面读取；列表页即使含其他合法代码也必须走目标批次查询。
- 浏览器 `context.close()` 失败不得覆盖已经产生的主结果或主错误；提交边界后的清理失败必须保持 `OPERATION_BATCH_RECONCILIATION_REQUIRED`。
- 列表查询读取结构化单元格而非依赖换行文本，并等待本次筛选完成；如有分页，汇总全部筛选结果后再做唯一性判断。
- context 创建成功后，`pages()` / `newPage()` 及后续动作全部位于清理保护范围内。

- [x] **Step 1: 写 RED 行为测试**

覆盖：非详情页旧代码不得直接回填；`context.close()` 拒绝时主待同步错误不被覆盖；表格单元格以 tab/独立 `td` 分隔时仍能精确匹配；旧表格已含目标名时必须等待新筛选结果；多页重复结果必须拒绝。

- [x] **Step 2: 实现最小 runner 修复**

只增加上述安全门禁和真实 DOM 所需的稳定等待/分页读取，不改创建表单字段映射。

- [x] **Step 3: focused 测试与只读真实列表验证**

运行 runner/operation batch 测试；真实验证只允许打开批次列表、输入批次名称和翻页，不点击创建或编辑。

### Task 6: 批次结果并发、草稿恢复与 UI 冲突控制

**Files:**
- Modify: `server/operation_batch.mjs`
- Modify: `server/easy_exam_server.mjs`
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Test: `server/test_operation_batch.mjs`
- Test: `server/test_server_config.mjs`
- Test: `server/test_ui_views.mjs`

**Interfaces:**
- create、reconcile、手工补录对同一 task 的结果写入互斥；自动流程运行期间 UI 禁用手工补录。
- fresh task 已有合法代码时，同码幂等返回；不同码返回 409 并保留现状，禁止最后写入者覆盖。
- 首次 reconcile 生成的 fallback draft 在失败状态中也必须持久化，后续重试固定复用。
- profile 锁冲突尽量回传当前 task，使页面可立即刷新待同步状态。

- [x] **Step 1: 写 RED 状态与 UI 测试**
- [x] **Step 2: 实现任务级互斥、冲突判定和 draft 持久化**
- [x] **Step 3: focused 测试确认 GREEN**

### Task 7: 运行时同步保留 `.env` 与生产依赖

**Files:**
- Modify: `scripts/deploy_launchd_runtime.mjs`
- Test: `server/test_deploy_launchd_runtime_cli.mjs`

**Interfaces:**
- 重建 `app` 时若源码没有 `.env`，保留目标运行时现有 `.env`。
- 重建 `app` 时保留目标运行时已安装的 `node_modules`，避免每次同步后 Playwright 消失。
- `runtime/`、SQLite、邮件设置和浏览器 profile 继续完全独立保留。

- [x] **Step 1: 写 RED 部署测试覆盖第二次部署后的 `.env` 与依赖目录**
- [x] **Step 2: 实现最小、失败可恢复的保留逻辑**
- [x] **Step 3: 部署 focused 测试确认 GREEN**

### Task 8: 最终复审、重新部署和只读恢复

- [x] **Step 1: 全量 Node/Python、语法、保护范围和 diff 验证**
- [x] **Step 2: 独立最终代码复审无 Critical/Important**
- [x] **Step 3: 安全同步 8765 并确认环境 ready、健康和持久数据不变**
- [ ] **Step 4: 只读 reconcile 当前项目，核对合法代码、SQLite、审计和 workflow**
- [ ] **Step 5: 浏览器刷新项目卡，核对“已完成”、下游解锁和来源变更提示保留**

> 最终代码与部署验收记录：自动化 Node `787/787`、Python `54/54` 通过，最终独立复审为 `FINAL CLEAN`。原子同步和 LaunchAgent 重启成功，8765 健康、运控环境 `ready=true`，源码与运行时关键文件一致；`.env` SHA-256 仍为 `a6b6cc131ad32f3b8d9b4e49f58f4b632da31a05393baa2279990a95c7049047`，`.env`、`node_modules`、SQLite、邮件设置和运控浏览器 profile 的 inode 均与部署前一致，且无 `.deploy-*` 残留。
>
> 当前项目只调用过对账接口，未调用创建接口。对账浏览器停在运控 SSO `loginWaiting`，等待 10 分钟后安全超时；浏览器进程已退出，8765 仍健康，任务恢复为 `reconciliation_required`，`operationBatchCode` 仍为空。Task 4 Step 6–7 与 Task 8 Step 4–5 必须在用户完成运控登录并重新发起只读对账、取得唯一合法代码后再勾选，当前不得宣称完成。
