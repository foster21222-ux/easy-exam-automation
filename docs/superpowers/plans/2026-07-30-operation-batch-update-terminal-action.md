# 运控批次修改终态按钮实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 批次修改任务完成后将弹窗左侧按钮从“取消”改为“关闭”，新预览时恢复“取消”。

**Architecture:** 在现有批次修改弹窗渲染流程中集中设置左侧按钮文案。预览入口传入未完成状态，进度渲染使用服务端返回的 `completed` 状态，不改变任务提交、轮询或关闭弹窗的行为。

**Tech Stack:** HTML、原生 JavaScript、Node.js `node:test`

## Global Constraints

- 修改预览阶段和执行中显示“取消”。
- 任意 `completed` 终态显示“关闭”。
- 再次生成新预览时恢复“取消”。
- 不修改服务端状态、批次修改执行流程或右侧确认按钮逻辑。

---

### Task 1: 同步批次修改弹窗终态按钮

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Test: `server/test_ui_views.mjs`

**Interfaces:**
- Consumes: `attempt.completed: boolean`
- Produces: `renderOperationBatchUpdateDialogAction(attempt = {})`，根据是否完成更新 `operationBatchUpdateConfirmCancelBtn.textContent`

- [ ] **Step 1: 写失败回归测试**

在 `server/test_ui_views.mjs` 中编译并调用真实的 `renderOperationBatchUpdateDialogAction`：

```js
const operationBatchUpdateConfirmCancelBtn = { textContent: "" };
const renderOperationBatchUpdateDialogAction = compileInlineFunction(
  "      function renderOperationBatchUpdateDialogAction(attempt = {}) {",
  "\n      function renderOperationBatchUpdateAttempt",
  { operationBatchUpdateConfirmCancelBtn },
);

renderOperationBatchUpdateDialogAction({ completed: false });
assert.equal(operationBatchUpdateConfirmCancelBtn.textContent, "取消");
renderOperationBatchUpdateDialogAction({ completed: true });
assert.equal(operationBatchUpdateConfirmCancelBtn.textContent, "关闭");
```

同时验证新预览路径调用 `renderOperationBatchUpdateDialogAction({ completed: false })`。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_ui_views.mjs
```

Expected: FAIL，原因是 `renderOperationBatchUpdateDialogAction` 尚不存在。

- [ ] **Step 3: 写最小实现**

在 `outputs/web_prototype/easy_exam_automation.html` 中增加：

```js
function renderOperationBatchUpdateDialogAction(attempt = {}) {
  operationBatchUpdateConfirmCancelBtn.textContent = attempt.completed ? "关闭" : "取消";
}
```

在新预览渲染时调用：

```js
renderOperationBatchUpdateDialogAction({ completed: false });
```

在修改进度渲染时调用：

```js
renderOperationBatchUpdateDialogAction(attempt);
```

- [ ] **Step 4: 运行相关测试并确认通过**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_ui_views.mjs
```

Expected: PASS。

- [ ] **Step 5: 运行全量验证**

运行项目全量 Node 测试、Python 测试、部署脚本和 8765 健康检查；确认源码与 Application Support 运行时文件哈希一致。

- [ ] **Step 6: 提交实现**

```bash
git add outputs/web_prototype/easy_exam_automation.html server/test_ui_views.mjs docs/superpowers/plans/2026-07-30-operation-batch-update-terminal-action.md
git commit -m "fix: close completed batch update dialog"
```
