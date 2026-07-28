# 人员任务发布位置恢复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 未发布批次读取考试日程后，重新精确打开当前批次详情并完成发布，再继续人员任务发送流程。

**Architecture:** 复用现有 `locateOperationPersonnelBatch(page, instruction, options)` 作为批次身份恢复入口，不新增模糊选择器。`publishBatch` 在点击发布前重新定位批次详情；既有 `publish_batch` 检查点继续负责发布后状态回读和失败阻断。

**Tech Stack:** Node.js、`node:test`、Playwright 可见浏览器执行器、macOS LaunchAgent。

## Global Constraints

- 重新定位必须按批次代码精确匹配。
- 不扩大“发布”按钮选择器，不使用模糊文字匹配。
- 重新定位或发布状态回读失败时，不得打开人员任务单或发送。
- 已发布批次不得重复执行发布动作。
- 未经用户单独授权，不执行真实人员任务发送。

---

### Task 1: 发布前恢复批次详情位置

**Files:**
- Modify: `server/operation_personnel_task_runner.mjs`
- Test: `server/test_operation_personnel_task_runner.mjs`

**Interfaces:**
- Consumes: `publishBatch(page, instruction)` 和 `instruction.batch.code`。
- Produces: `publishBatch` 在点击发布前调用现有 `locateOperationPersonnelBatch(page, instruction, options)`，随后点击唯一“发布”按钮并确认。

- [ ] **Step 1: 写失败回归测试**

在 `server/test_operation_personnel_task_runner.mjs` 增加一个未发布首次发送测试。测试页在读取日程后标记当前位置为 `exam-schedule`；只有再次调用 `openBatchRow` 才恢复为 `batch-detail`；`publishBatch` 在非详情位置应复现“发布按钮实际 0 个”。

核心断言：

```js
assert.deepEqual(page.events.filter((item) => (
  item === "batch:open"
  || item === "exam-schedule:open"
  || item === "publish:click"
  || item === "task-sheet:open"
)), [
  "batch:open",
  "exam-schedule:open",
  "batch:open",
  "publish:click",
  "task-sheet:open",
]);
```

生产代码中负责让该测试由红转绿的变化是：`publishBatch` 点击前重新运行精确批次定位。

- [ ] **Step 2: 运行聚焦测试确认失败**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-name-pattern="unpublished.*publish" server/test_operation_personnel_task_runner.mjs
```

Expected: FAIL，事件中缺少发布前的第二次 `batch:open`，或发布按钮在考试日程位置不可见。

- [ ] **Step 3: 实现最小修复**

让可见页面适配器接收既有 `options`，并在发布前复用精确定位：

```js
async publishBatch(page, instruction, options = {}) {
  await locateOperationPersonnelBatch(page, instruction, options);
  await clickUniqueVisible(
    page.getByRole("button", { name: "发布", exact: true }),
    "发布按钮",
  );
  await confirmTopVisibleDialog(page);
}
```

在 `runOperationPersonnelAttempt` 调用发布方法时传入当前执行器 `options`。不得增加其他按钮匹配规则。

- [ ] **Step 4: 运行聚焦测试确认通过**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_personnel_task_runner.mjs
```

Expected: PASS，且未发布流程中第二次精确定位发生在 `publish:click` 之前。

- [ ] **Step 5: 运行人员任务相关测试**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_personnel_task_runner.mjs server/test_operation_personnel_task_service.mjs server/test_operation_personnel_task_api.mjs
```

Expected: PASS。

- [ ] **Step 6: 提交代码修复**

```bash
git add server/operation_personnel_task_runner.mjs server/test_operation_personnel_task_runner.mjs
git commit -m "fix: restore batch detail before personnel publish"
```

---

### Task 2: 全量验证并同步本机运行时

**Files:**
- Modify only if test evidence is maintained: `docs/operation-personnel-task-test-evidence.md`

**Interfaces:**
- Consumes: Task 1 的代码提交。
- Produces: 全量测试结果、Application Support 运行时同步结果和 8765 健康检查结果。

- [ ] **Step 1: 运行全量 Node 测试**

Run:

```bash
/bin/zsh -lc 'for f in server/test_*.mjs; do [ "$f" = "server/test_exam_time_only.mjs" ] && continue; printf "%s\n" "$f"; done | xargs /Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test'
```

Expected: exit code `0`。

- [ ] **Step 2: 运行全量 Python 测试**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest discover -s server -p 'test_*.py'
```

Expected: exit code `0`。

- [ ] **Step 3: 部署 Application Support 运行时**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/deploy_launchd_runtime.mjs
```

Expected: JSON 中 `"ok": true`，目标为 `/Users/ata/Library/Application Support/easy-exam-automation/app`。

- [ ] **Step 4: 检查 8765 健康状态**

Run:

```bash
curl -sS --max-time 5 http://127.0.0.1:8765/api/health
```

Expected:

```json
{"ok":true}
```

- [ ] **Step 5: 校验源码与运行时文件一致**

Run:

```bash
shasum -a 256 server/operation_personnel_task_runner.mjs "/Users/ata/Library/Application Support/easy-exam-automation/app/server/operation_personnel_task_runner.mjs"
```

Expected: 两个 SHA-256 完全相同。

- [ ] **Step 6: 记录验证证据并提交**

若项目继续维护测试证据文档，把实际测试数量、部署响应、健康响应和哈希写入 `docs/operation-personnel-task-test-evidence.md`，不得预填未实际获得的数据。

```bash
git add docs/operation-personnel-task-test-evidence.md
git commit -m "docs: record personnel publish recovery verification"
```

