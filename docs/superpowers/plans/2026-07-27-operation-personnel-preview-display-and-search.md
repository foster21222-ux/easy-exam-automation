# 人员任务参数展示与列表查询修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复人员任务详情错误显示“暂无参数”，并确保分散在线监考列表在等待目标批次前实际提交批次名称查询。

**Architecture:** 保留现有人员任务预览、统一确认和首次发送时发布批次的业务顺序。前端增加人员任务草稿专用展示；可见浏览器执行器复用现有精确匹配规则，但在填写筛选框后显式按回车提交查询，再等待唯一目标行。

**Tech Stack:** Node.js、`node:test`、Playwright 可见浏览器执行器、单文件 HTML 控制台。

## Global Constraints

- 不在统一确认前发布批次、修改运控配置或发送任务单。
- 测试环境固定收件人为演练组张乐翔，抄送为空。
- 只修改本次两个已证实缺陷，不重构相邻流程。
- 保留当前工作区已有的批次创建和批次修改未提交内容。

---

### Task 1: 人员任务草稿专用展示

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Test: `server/test_ui_views.mjs`

**Interfaces:**
- Consumes: `workflow.personnelDraft` 的 `batch`、`schedules`、`personnel`、`dates`、`recipients` 和 `warnings`。
- Produces: `renderOperationPersonnelDraft(draft)` 返回非空参数列表；没有有效数据时才返回“暂无参数”。

- [ ] **Step 1: 写失败测试**

新增 UI 行为断言：具有批次、人员配置和固定收件规则的人员草稿必须展示批次代码、人员落实平台和收件人，不得回退为“暂无参数”。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/test_ui_views.mjs`

Expected: FAIL，因为项目详情仍调用只读取 `draft.fields` 的 `renderWorkflowDraft`。

- [ ] **Step 3: 最小实现**

增加 `renderOperationPersonnelDraft`，只映射现有人员草稿字段，不引入新的业务字段；将项目详情人员面板改为调用该函数。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test server/test_ui_views.mjs`

Expected: PASS。

### Task 2: 人员任务列表显式提交查询

**Files:**
- Modify: `server/operation_personnel_task_runner.mjs`
- Test: `server/test_operation_personnel_task_runner.mjs`

**Interfaces:**
- Consumes: 精确批次名称及唯一可见筛选框。
- Produces: `openVisiblePersonnelTaskSheet` 在读取表格前调用一次 `search.press("Enter")`，随后仍按批次名称精确匹配唯一行。

- [ ] **Step 1: 写失败测试**

增加可见执行器测试：筛选框必须记录一次 `Enter`，未提交查询时目标批次不会出现。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test server/test_operation_personnel_task_runner.mjs`

Expected: FAIL，因为当前代码只执行 `fill(batchName)`。

- [ ] **Step 3: 最小实现**

在填写批次名称后显式按回车；不提前发布批次，不修改预览和发送状态机。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test server/test_operation_personnel_task_runner.mjs`

Expected: PASS。

### Task 3: 回归与运行环境

**Files:**
- Verify: `server/test_*.mjs`
- Verify: `server/test_*.py`
- Deploy: `~/Library/Application Support/easy-exam-automation/app`

**Interfaces:**
- Consumes: Task 1、Task 2 的源码状态。
- Produces: 全量测试结果、源代码与运行时同步证据、8765 健康检查结果。

- [ ] **Step 1: 运行人员任务相关测试**

Run: `node --test server/test_operation_personnel_task*.mjs server/test_ui_views.mjs`

- [ ] **Step 2: 运行全量 Node 与 Python 测试**

Run: 项目现有全量 Node 测试命令和 Python unittest 命令。

- [ ] **Step 3: 检查差异**

确认所有改动都能追溯到两个缺陷，且未覆盖当前批次修改工作。

- [ ] **Step 4: 同步 Application Support 运行时并重启**

使用现有 `scripts/deploy_launchd_runtime.mjs`，不迁移或清空运行数据。

- [ ] **Step 5: 验证 8765**

检查监听端口、健康接口和项目详情页面；不在运控执行发布、修改或发送。
