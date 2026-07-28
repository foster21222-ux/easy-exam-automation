# 运控批次可见日程表兼容修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让人员任务首次检查正确读取运控批次详情页当前真实日程表，同时保留旧表头兼容和严格阻断。

**Architecture:** 在现有运控可见页面适配器中，把 DOM 表格发现与日程字段规范化分开。页面只返回可见表格的行对象，Node 侧纯函数负责处理表头别名和组合时间范围，便于直接回归测试。

**Tech Stack:** Node.js ES modules、`node:test`、Playwright 可见页面适配器。

## Global Constraints

- 只修改运控批次详情页的只读日程解析。
- 不修改人员任务单弹窗、批次写入、发布、收件人选择或发送流程。
- 不完整或歧义日程继续阻断，不猜测数据。

---

### Task 1: 兼容当前和旧版运控日程表

**Files:**
- Modify: `server/operation_personnel_task_runner.mjs:983-1149`
- Test: `server/test_operation_personnel_task_runner.mjs`

**Interfaces:**
- Consumes: 运控可见表格生成的行对象，例如 `{"日程代码":"1","日程":"2026-08-22 15:30~17:30","考试名称":"目标考试"}`。
- Produces: `operationPersonnelBatchSchedulesFromVisibleRows(rows)`，返回现有规范化日程数组。

- [ ] **Step 1: 写入当前真实表头的失败测试**

新增测试，输入截图对应的字段：

```js
const schedules = operationPersonnelBatchSchedulesFromVisibleRows([{
  "场次": "1",
  "日程代码": "1",
  "日程": "2026-08-22 15:30~17:30",
  "时长(分钟)": "120",
  "考试名称": "中国邮政集团公司湖北省分公司招聘考试",
  "考生提前登录(分钟)": "0",
}]);
```

断言开始时间、结束时间、考试名称、时长和提前登录分钟数均规范化正确；另保留一条旧版“开始时间/结束时间”字段测试。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_personnel_task_runner.mjs
```

Expected: FAIL，原因是 `operationPersonnelBatchSchedulesFromVisibleRows` 尚未导出。

- [ ] **Step 3: 实施最小解析兼容**

在 `operation_personnel_task_runner.mjs` 中新增纯函数：

```js
export function operationPersonnelBatchSchedulesFromVisibleRows(rows = []) {
  return rows.map((row) => {
    const combined = text(row["日程"]);
    const range = combined
      ? visibleScheduleRange(combined)
      : { start: text(row["开始时间"]), end: text(row["结束时间"]) };
    return {
      scheduleEntryId: text(row.__scheduleEntryId || row["日程条目ID"] || row["日程稳定ID"]),
      scheduleCode: text(row["日程代码"]),
      subjectCode: text(row["科目代码"]),
      subjectName: text(row["考试名称"] || row["科目名称"]),
      start: range.start,
      end: range.end,
      durationMinutes: text(row["时长(分钟)"] || row["时长"]),
      earlyLoginMinutes: text(row["考生提前登录(分钟)"] || row["提前登录分钟数"]),
    };
  });
}
```

对必需字段增加明确检查；当前表头存在时优先读取组合“日程”，否则读取原有开始、结束列。DOM 读取结果交给该纯函数，不再在浏览器上下文中按旧字段直接映射。

- [ ] **Step 4: 运行相关测试并确认通过**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_personnel_task_runner.mjs
```

Expected: PASS。

- [ ] **Step 5: 运行项目全量验证**

Run:

```bash
for f in server/test_*.mjs; do
  [ "$f" = "server/test_exam_time_only.mjs" ] && continue
  printf '%s\n' "$f"
done | xargs /Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test
```

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest discover -s server -p 'test_*.py'
```

Expected: 全部通过，且 `git diff --check` 无输出。

- [ ] **Step 6: 提交修复**

```bash
git add server/operation_personnel_task_runner.mjs server/test_operation_personnel_task_runner.mjs docs/superpowers/plans/2026-07-28-operation-batch-visible-schedule-compatibility.md
git commit -m "fix: read current operation schedule table"
```

### Task 2: 未发布批次进入考试页签后刷新快照

**Files:**
- Modify: `server/operation_personnel_task_runner.mjs`
- Test: `server/test_operation_personnel_task_runner.mjs`

**Interfaces:**
- Consumes: `openVisibleEztestSchedulePage(page)`，现有批次修改模块的只读“考试 → 易考”导航。
- Produces: 未发布批次首次检查从考试页签重新读取的日程快照。

- [ ] **Step 1: 增加失败测试**

分别返回切换前无日程表、切换后有日程表的两份可见快照；断言检查先打开考试页签、读取两次快照并返回真实日程。

- [ ] **Step 2: 确认旧代码失败**

运行 `server/test_operation_personnel_task_runner.mjs`，预期失败信息为未打开考试页签或仍使用旧快照。

- [ ] **Step 3: 实施最小修复**

未发布预览读取日程前调用 `openVisibleEztestSchedulePage(page)`，随后清除缓存的 `visibleSnapshot`，再执行既有只读日程读取。

- [ ] **Step 4: 验证**

运行人员任务测试、全量 Node 测试、Python 测试、运行时同步和 8765 健康检查。
