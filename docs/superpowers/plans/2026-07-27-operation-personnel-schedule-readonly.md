# 人员任务日程只读与确认表格 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让建批次和修改批次成为运控考试日程的唯一写入流程，人员任务仅校验和展示日程，并把五个允许调整的人员字段放进中文分组对照表。

**Architecture:** 新增一个小型领域门槛模块，将批次受管状态、当前易考需求和受管快照归一为稳定的“允许继续/阻断”结果；人员任务服务在访问运控前后都使用该结果，执行器把原日程同步 checkpoint 替换为只读验证 checkpoint。前端仅消费业务化的对照 DTO，日程以只读摘要和表格展示，五个允许编辑的字段仍通过现有预览接口重新生成确认内容。

**Tech Stack:** Node.js ESM、`node:test`、原生 HTML/CSS/JavaScript、Playwright 可见页面适配器、macOS LaunchAgent 测试运行时。

## Global Constraints

- 建批次和修改批次是运控考试日程的唯一写入方。
- 人员任务不得创建、修改或删除运控考试日程。
- 每份易考需求单对应一条运控考试日程；科目变化不触发批次日程修改。
- 人员任务发送前必须同时核验批次受管快照、当前易考需求和运控可见日程。
- 批次日程不完整、可修改、修改中、修改失败或冲突时，阻断并提示“请先在建批次环节完成批次信息修改”。
- 历史 `scheduleCodeMap` 只保留读取兼容，不得作为运控日程写入依据。
- 可编辑字段仅为人员落实开始日期、人员落实结束日期、人员名单提交日期、监考人数、监考比例。
- 确认窗口不显示内部字段路径、布尔原值或日程 JSON。
- 测试环境仍允许项目代码和项目名称不一致；批次代码和批次名称仍需精确定位。
- 不执行真实人员任务发送；端到端验证停在二次确认窗口。
- 保留工作树中现有未提交改动，不整理、不覆盖、不提交无关文件。

---

### Task 1: 建立批次日程只读门槛

**Files:**
- Create: `server/operation_personnel_schedule_gate.mjs`
- Create: `server/test_operation_personnel_schedule_gate.mjs`
- Modify: `server/operation_batch_update.mjs:111-260`

**Interfaces:**
- Consumes: `operationBatchUpdateState(task)` 和 `buildDesiredOperationBatchSnapshot(task)`。
- Produces: `operationPersonnelScheduleGate(task) -> { ok, code, status, message, managedSnapshot, schedules }`。
- Produces: `normalizedOperationBatchManagedSnapshot(snapshot) -> { batchName, examStartDate, examEndDate, schedules }`，复用现有受管快照格式校验。

- [ ] **Step 1: 写门槛失败测试**

在 `server/test_operation_personnel_schedule_gate.mjs` 建立最小任务工厂，覆盖下列精确断言：

```js
test("blocks personnel task when batch schedules are incomplete", () => {
  const result = operationPersonnelScheduleGate(taskWith({
    operationBatchStatus: "waiting_schedule",
    managedSnapshot: null,
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "PERSONNEL_BATCH_SCHEDULE_INCOMPLETE");
  assert.match(result.message, /请先在建批次环节完成批次信息修改/);
});

test("blocks personnel task when managed batch update is required", () => {
  const task = taskWithAppliedSnapshot();
  task.config.examRequirements[0].fields["考试日期时间"] =
    "2026/08/22 10:00 - 2026/08/22 12:00";
  const result = operationPersonnelScheduleGate(task);
  assert.equal(result.ok, false);
  assert.equal(result.code, "PERSONNEL_BATCH_UPDATE_REQUIRED");
});

test("blocks historical batch without a managed snapshot", () => {
  const result = operationPersonnelScheduleGate(taskWith({
    operationBatchStatus: "success",
    managedSnapshot: null,
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "PERSONNEL_BATCH_UPDATE_REQUIRED");
});

test("blocks conflicting schedule identity and count", () => {
  const task = taskWithAppliedSnapshot();
  task.config.operationBatch.managedSnapshot.schedules[0].requirementIndex = 1;
  const result = operationPersonnelScheduleGate(task);
  assert.equal(result.ok, false);
  assert.equal(result.code, "PERSONNEL_BATCH_SCHEDULE_CONFLICT");
});

test("returns normalized read-only schedules when batch is synchronized", () => {
  const result = operationPersonnelScheduleGate(taskWithAppliedSnapshot());
  assert.equal(result.ok, true);
  assert.deepEqual(result.schedules, [{
    requirementIndex: 0,
    name: "湖北邮政招聘考试",
    start: "2026-08-22T09:00:00",
    end: "2026-08-22T11:00:00",
  }]);
});
```

- [ ] **Step 2: 运行门槛测试并确认失败**

Run:

```bash
node --test server/test_operation_personnel_schedule_gate.mjs
```

Expected: FAIL，错误明确指向缺少 `operation_personnel_schedule_gate.mjs` 或导出函数。

- [ ] **Step 3: 暴露受管快照归一函数**

在 `server/operation_batch_update.mjs` 将现有内部函数改为命名导出，不改变校验逻辑：

```js
export function normalizedOperationBatchManagedSnapshot(snapshot) {
  // 保留当前 normalizedManagedSnapshot 的全部日期、序号、数量和范围校验。
}
```

把 `applyOperationBatchManagedResult` 中的调用同步改名，避免复制两套快照规则。

- [ ] **Step 4: 实现稳定门槛结果**

在 `server/operation_personnel_schedule_gate.mjs` 实现：

```js
import {
  buildDesiredOperationBatchSnapshot,
  normalizedOperationBatchManagedSnapshot,
  operationBatchUpdateState,
} from "./operation_batch_update.mjs";

const ACTION = "请先在建批次环节完成批次信息修改";

function blocked(code, status, detail) {
  return {
    ok: false,
    code,
    status,
    message: `${detail}，${ACTION}`,
    managedSnapshot: null,
    schedules: [],
  };
}

export function operationPersonnelScheduleGate(task = {}) {
  const persistedStatus = String(task.config?.operationBatch?.status || "").trim();
  const state = operationBatchUpdateState(task);
  if (persistedStatus === "update_conflict" || state.status === "update_conflict") {
    return blocked("PERSONNEL_BATCH_SCHEDULE_CONFLICT", "conflict", "批次考试日程存在冲突");
  }
  if (persistedStatus === "waiting_schedule" || state.status === "waiting_schedule") {
    return blocked("PERSONNEL_BATCH_SCHEDULE_INCOMPLETE", "incomplete", "批次考试日程尚未补全");
  }
  if (["updating", "update_failed"].includes(persistedStatus)
      || state.status !== "success"
      || state.baselineRequired) {
    return blocked("PERSONNEL_BATCH_UPDATE_REQUIRED", "update_required", "批次信息尚未完成同步");
  }
  try {
    const managedSnapshot = normalizedOperationBatchManagedSnapshot(
      task.config.operationBatch.managedSnapshot,
    );
    const desired = buildDesiredOperationBatchSnapshot(task);
    if (!desired.complete
        || JSON.stringify(managedSnapshot.schedules) !== JSON.stringify(desired.snapshot.schedules)) {
      return blocked("PERSONNEL_BATCH_SCHEDULE_CONFLICT", "conflict", "批次日程与当前易考需求不一致");
    }
    return {
      ok: true,
      code: "",
      status: "ready",
      message: "",
      managedSnapshot,
      schedules: structuredClone(managedSnapshot.schedules),
    };
  } catch {
    return blocked("PERSONNEL_BATCH_SCHEDULE_CONFLICT", "conflict", "批次受管日程快照无效");
  }
}
```

持久化恢复状态固定为项目现有的 `updating`、`update_failed`、`update_conflict`；派生状态固定为 `waiting_schedule`、`update_available`、`update_conflict`、`success`。除 `success` 外均不得继续。

- [ ] **Step 5: 运行领域测试**

Run:

```bash
node --test server/test_operation_batch_update.mjs server/test_operation_personnel_schedule_gate.mjs
```

Expected: PASS，且原批次快照校验测试不回退。

- [ ] **Step 6: 记录该任务变更**

先检查：

```bash
git diff -- server/operation_batch_update.mjs server/operation_personnel_schedule_gate.mjs server/test_operation_personnel_schedule_gate.mjs
```

仅暂存这三个文件并提交：

```bash
git add server/operation_batch_update.mjs server/operation_personnel_schedule_gate.mjs server/test_operation_personnel_schedule_gate.mjs
git commit -m "feat: gate personnel tasks on managed schedules"
```

---

### Task 2: 人员任务预览使用批次受管日程并在两次读取间防漂移

**Files:**
- Modify: `server/operation_personnel_task_service.mjs:1-330,522-750`
- Modify: `server/test_operation_personnel_task_service.mjs`

**Interfaces:**
- Consumes: `operationPersonnelScheduleGate(task)`。
- Produces: 预览草稿中的 `managedSchedules`，类型为 `Array<{ requirementIndex, name, start, end }>`。
- Produces: 稳定 HTTP 错误对象，沿用 `serviceError(code, 409, message)`。

- [ ] **Step 1: 写预览阻断和成功测试**

在 `server/test_operation_personnel_task_service.mjs` 添加：

```js
test("preview blocks before operation inspection when batch schedules are incomplete", async () => {
  const harness = serviceHarness({ batchScheduleStatus: "waiting_schedule" });
  await assert.rejects(
    harness.service.preview("task-a", ADMIN),
    (error) => error.code === "PERSONNEL_BATCH_SCHEDULE_INCOMPLETE"
      && /请先在建批次环节完成批次信息修改/.test(error.message),
  );
  assert.equal(harness.inspections.length, 0);
});

test("preview blocks when batch update is available or failed", async () => {
  for (const status of ["update_available", "updating", "update_failed"]) {
    const harness = serviceHarness({ batchScheduleStatus: status });
    await assert.rejects(
      harness.service.preview("task-a", ADMIN),
      (error) => error.code === "PERSONNEL_BATCH_UPDATE_REQUIRED",
    );
  }
});

test("preview exposes managed schedules without schedule write codes", async () => {
  const harness = serviceHarness({ batchScheduleStatus: "success" });
  const preview = await harness.service.preview("task-a", ADMIN);
  assert.deepEqual(preview.state.draft.managedSchedules, [{
    requirementIndex: 0,
    name: "湖北邮政招聘考试",
    start: "2026-08-22T09:00:00",
    end: "2026-08-22T11:00:00",
  }]);
  assert.equal(Object.hasOwn(preview.state.draft.managedSchedules[0], "scheduleCode"), false);
});

test("preview rechecks the batch schedule gate before persisting", async () => {
  const harness = serviceHarness({ changeBatchAfterInspection: "update_available" });
  await assert.rejects(
    harness.service.preview("task-a", ADMIN),
    (error) => error.code === "PERSONNEL_BATCH_UPDATE_REQUIRED",
  );
  assert.equal(harness.persistedStates.length, 0);
});

test("send invalidates a confirmed preview when batch schedules changed", async () => {
  const harness = serviceHarness({ batchScheduleStatus: "success" });
  const preview = await harness.service.preview("task-a", ADMIN);
  harness.setBatchScheduleStatus("update_available");
  await assert.rejects(
    harness.service.send("task-a", ADMIN, {
      previewToken: preview.previewToken,
      draftVersion: preview.draftVersion,
    }),
    (error) => error.code === "PERSONNEL_BATCH_UPDATE_REQUIRED",
  );
  assert.equal(harness.attempts.length, 0);
});
```

- [ ] **Step 2: 运行服务测试并确认失败**

Run:

```bash
node --test server/test_operation_personnel_task_service.mjs
```

Expected: FAIL，因为服务尚未执行批次门槛，也没有 `managedSchedules`。

- [ ] **Step 3: 在预览开始和持久化前各执行一次门槛**

在 `operation_personnel_task_service.mjs` 导入门槛，并增加唯一转换函数：

```js
function requireManagedSchedules(task) {
  const result = operationPersonnelScheduleGate(task);
  if (!result.ok) throw serviceError(result.code, 409, result.message);
  return result;
}
```

在 `preview` 读取 `initialTask` 后、申请浏览器 profile 前调用一次；在 `withTaskLock` 内读取 `freshTask` 后再次调用。第一次结果用于生成 `draft.managedSchedules`，第二次结果必须与第一次 `managedSnapshot` 指纹一致，否则抛出 `PERSONNEL_BATCH_SCHEDULE_CONFLICT`，不得保存过期预览。

在 `send` 的任务锁内、检查预览 token 后、创建 attempt 前第三次调用门槛。把当前受管快照的 fingerprint 与预览时保存的 `managedScheduleFingerprint` 比较；不一致时抛出相应批次错误，清除 active preview，不排队、不发布批次。

- [ ] **Step 4: 将受管日程限定为展示、指纹和变化摘要输入**

保持现有任务单可见日程读取，但将人员任务目标中的批次日程投影限定为：

```js
function managedScheduleProjection(items = []) {
  return items.map(({ requirementIndex, name, start, end }) => ({
    requirementIndex,
    name,
    start,
    end,
  }));
}
```

`targetFromDraft` 不再从 `draft.schedules` 生成待写运控日程；它保留运控可见日程作为只读快照。`managedSchedules` 只存在于草稿、预览绑定和 attempt 顶层，不混入 `normalizeOperationPersonnelSnapshot`，避免把本地受管证据误当成运控页面字段。

预览绑定增加：

```js
managedScheduleFingerprint: fingerprint(draft.managedSchedules),
```

attempt 增加：

```js
managedSchedules: managedScheduleProjection(state.draft.managedSchedules),
```

`runQueuedAttempt` 将其作为 `instruction.managedSchedules` 传给执行器。把 `managedSchedules` 纳入草稿指纹和草稿变化摘要；保留 `draft.schedules` 作为任务单中科目、提前登录等补充展示数据，不把它解释为批次写入目标。

普通重发的“内容是否变化”以 `operationPersonnelTaskFingerprint(state.draft)` 与 `lastSuccessfulFingerprint` 为准，不能再额外要求运控配置 diff 非空。外部历史发送基线因没有本地旧草稿，仍沿用可见运控配置 diff；不猜测历史日程。

- [ ] **Step 5: 保留历史映射读取兼容但切断写入用途**

保留 `normalizedState.scheduleCodeMap` 和历史草稿解析，防止旧状态反序列化失败；新增注释仅说明兼容边界。任何新生成的目标、变化摘要和执行指令不得依赖 `scheduleCodeMap` 决定日程增删改。

- [ ] **Step 6: 运行服务与领域测试**

Run:

```bash
node --test server/test_operation_personnel_schedule_gate.mjs server/test_operation_personnel_task.mjs server/test_operation_personnel_task_service.mjs server/test_operation_personnel_task_routes.mjs
```

Expected: PASS；原“内容完全不变不允许重发”和“日程需求变化允许重发”测试继续通过。

- [ ] **Step 7: 记录该任务变更**

先检查：

```bash
git diff -- server/operation_personnel_task_service.mjs server/test_operation_personnel_task_service.mjs
```

仅暂存并提交：

```bash
git add server/operation_personnel_task_service.mjs server/test_operation_personnel_task_service.mjs
git commit -m "fix: block personnel preview on unsynced schedules"
```

---

### Task 3: 删除人员任务日程写入 checkpoint，改为只读核验

**Files:**
- Modify: `server/operation_personnel_task_runner.mjs:1965-2025,2076-2430`
- Modify: `server/test_operation_personnel_task_runner.mjs:1200-1380`

**Interfaces:**
- Consumes: `instruction.managedSchedules`，类型为 `Array<{ requirementIndex, name, start, end }>`。
- Produces: `verify_exam_schedules` checkpoint，`readback` 为规范化的只读日程。
- Removes from active flow: `syncExamSchedules`、`findScheduleRows`、`deleteSchedule`、`editVisibleSchedule`。

- [ ] **Step 1: 写执行器不写日程的失败测试**

修改 `attemptOptions`，让所有日程写方法立即失败：

```js
syncExamSchedules: async () => {
  throw new Error("人员任务不得写考试日程");
},
findScheduleRows: async () => {
  throw new Error("人员任务不得定位待删除日程");
},
deleteSchedule: async () => {
  throw new Error("人员任务不得删除考试日程");
},
```

同时让 `validInstruction()` 顶层包含与 `fakeOperationPage().state.schedules` 对应的只读受管日程：

```js
managedSchedules: [{
  requirementIndex: 0,
  name: "湖北邮政招聘考试",
  start: "2026-08-22T09:00:00",
  end: "2026-08-22T11:00:00",
}],
```

新增：

```js
test("attempt verifies schedules read only and never invokes schedule mutation", async () => {
  const page = fakeOperationPage();
  const observed = [];
  await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page, {
      onCheckpoint: async ({ name, status }) => observed.push(`${name}:${status}`),
    }),
  );
  assert.ok(observed.includes("verify_exam_schedules:completed"));
  assert.equal(observed.some((item) => item.startsWith("sync_exam_schedules:")), false);
  assert.equal(page.events.includes("schedules:fill"), false);
});
```

- [ ] **Step 2: 运行执行器测试并确认失败**

Run:

```bash
node --test server/test_operation_personnel_task_runner.mjs
```

Expected: FAIL，旧流程调用 `syncExamSchedules` 或仍产生 `sync_exam_schedules`。

- [ ] **Step 3: 替换 checkpoint 顺序**

先为执行器增加受管日程规范化：

```js
function normalizeManagedSchedule(raw = {}) {
  return {
    requirementIndex: Number(raw.requirementIndex),
    name: text(raw.name),
    start: text(raw.start),
    end: text(raw.end),
  };
}
```

`runOperationPersonnelAttemptOnPage` 开始时执行：

```js
const managedSchedules = [...(instruction.managedSchedules || [])]
  .map(normalizeManagedSchedule)
  .sort((left, right) => left.requirementIndex - right.requirementIndex);
```

再将 checkpoint 常量改为：

```js
const OPERATION_PERSONNEL_CHECKPOINTS = Object.freeze([
  "inspect_batch",
  "publish_batch",
  "verify_exam_schedules",
  "sync_personnel_config",
  "sync_personnel_dates",
  "sync_exam_service_requirements",
  "verify_task_sheet",
  "select_recipients",
  "submit_send",
  "verify_send_record",
]);
```

`verify_exam_schedules` 的 `action` 为空操作，`verify` 和 `verifyCompleted` 都只调用 `readSchedules`。将可见行按 `scheduleCode` 排序后投影为 `{ requirementIndex: index, name: subjectName, start, end }`，再与 `managedSchedules` 精确比较。比较仅包含日程序号/名称/开始/结束；科目代码、提前登录分钟数、时长等任务单补充字段不参与批次日程判断。

- [ ] **Step 4: 删除 active flow 的日程增删改分支**

从 `runOperationPersonnelAttemptOnPage` 删除：

```js
operationMethod(page, options, "syncExamSchedules")
operationMethod(page, options, "findScheduleRows")
operationMethod(page, options, "deleteSchedule")
```

不要求此任务删除可见页面适配器中的底层函数，因为批次流程可能复用页面能力；验收以人员任务执行路径不可到达这些函数为准。

- [ ] **Step 5: 处理旧 checkpoint 的恢复兼容**

恢复旧 attempt 时：

- 忽略历史 `sync_exam_schedules` 的完成状态，不把它当作当前只读验证证据；
- 始终执行新的 `verify_exam_schedules` 回读；
- 若新的目标摘要与当前页面不一致，抛出 `PERSONNEL_BATCH_SCHEDULE_CONFLICT`；
- 已进入 `submit_send` 的不可逆恢复逻辑保持原样。

添加精确测试：

```js
test("legacy completed schedule sync is reverified read only", async () => {
  const instruction = validInstruction();
  instruction.checkpoints.sync_exam_schedules = {
    status: "completed",
    targetDigest: "legacy",
  };
  const observed = [];
  await operationPersonnelRunner.runOperationPersonnelAttempt(
    instruction,
    attemptOptions(fakeOperationPage(), {
      onCheckpoint: async ({ name, status }) => observed.push(`${name}:${status}`),
    }),
  );
  assert.ok(observed.includes("verify_exam_schedules:completed"));
});
```

- [ ] **Step 6: 运行执行器测试**

Run:

```bash
node --test server/test_operation_personnel_task_runner.mjs
```

Expected: PASS，完成顺序包含 `verify_exam_schedules`，不包含 `sync_exam_schedules`。

- [ ] **Step 7: 记录该任务变更**

先检查：

```bash
git diff -- server/operation_personnel_task_runner.mjs server/test_operation_personnel_task_runner.mjs
```

仅暂存并提交：

```bash
git add server/operation_personnel_task_runner.mjs server/test_operation_personnel_task_runner.mjs
git commit -m "fix: make personnel schedule verification read only"
```

---

### Task 4: 任务单打开后再次核验日程，阻断漂移

**Files:**
- Modify: `server/operation_personnel_task_runner.mjs:2430-2540`
- Modify: `server/test_operation_personnel_task_runner.mjs`

**Interfaces:**
- Consumes: Task 3 的受管日程投影、`readTaskSheet` 和 `readSchedules`。
- Produces: `verify_task_sheet` readback，其中日程不一致时错误代码为 `PERSONNEL_BATCH_SCHEDULE_CONFLICT`。

- [ ] **Step 1: 写任务单内日程漂移测试**

```js
test("blocks before recipient selection when task sheet schedules drift", async () => {
  const page = fakeOperationPage();
  const options = attemptOptions(page, {
    readSchedules: async () => (
      page.events.includes("task-sheet:open")
        ? page.state.schedules.map((item) => ({
          ...item,
          subjectName: "错误考试名称",
        }))
        : page.state.schedules
    ),
  });
  await assert.rejects(
    operationPersonnelRunner.runOperationPersonnelAttempt(validInstruction(), options),
    (error) => error.code === "PERSONNEL_BATCH_SCHEDULE_CONFLICT",
  );
  assert.equal(page.events.includes("recipients:select"), false);
  assert.equal(page.events.includes("send:confirm"), false);
});
```

- [ ] **Step 2: 运行单测并确认失败**

Run:

```bash
node --test server/test_operation_personnel_task_runner.mjs
```

Expected: FAIL，因为当前任务单打开后不会再次回读并核验日程。

- [ ] **Step 3: 扩展只读任务单核验**

保留 `assertTaskSheetReady` 的发送条件和类型校验；在 `openTaskSheet` 之后、`selectRecipients` 之前增加一次独立的任务单日程回读，并复用 Task 3 的只读投影比较函数：

```js
const taskSheetSchedules = await readSection("readSchedules", "schedules");
assertManagedSchedules(managedSchedules, taskSheetSchedules);
```

`assertManagedSchedules` 不一致时抛出 `code=PERSONNEL_BATCH_SCHEDULE_CONFLICT`、`status=409`，message 包含“请先在建批次环节完成批次信息修改”。该步骤不新增任何填写或点击动作。

- [ ] **Step 4: 验证阻断发生在收件人选择之前**

Run:

```bash
node --test server/test_operation_personnel_task_runner.mjs
```

Expected: PASS，漂移测试确认既不选择收件人也不点击发送。

- [ ] **Step 5: 记录该任务变更**

先检查：

```bash
git diff -- server/operation_personnel_task_runner.mjs server/test_operation_personnel_task_runner.mjs
```

仅暂存并提交：

```bash
git add server/operation_personnel_task_runner.mjs server/test_operation_personnel_task_runner.mjs
git commit -m "fix: verify task sheet schedules before sending"
```

---

### Task 5: 将运控修改前后改为中文分组对照表

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html:9870-9960` 及相邻样式区
- Modify: `server/test_ui_views.mjs:1230-1395`

**Interfaces:**
- Consumes: `preview.operationChanges`、`state.draft.managedSchedules`、`state.draft.personnel`、`state.draft.dates`。
- Produces: 单一 `.operation-change-table`，列为“业务项目 / 修改前 / 修改后 / 来源”。
- Preserves: `collectOperationPersonnelPreviewEdits() -> { dates, personnel }`。

- [ ] **Step 1: 写中文表格和编辑边界测试**

更新 `server/test_ui_views.mjs`，验证渲染结果：

```js
assert.match(html, /人员落实开始日期/);
assert.match(html, /人员落实结束日期/);
assert.match(html, /人员名单提交日期/);
assert.match(html, /监考人数/);
assert.match(html, /监考比例/);
assert.match(html, /批次发布状态/);
assert.match(html, /考试日程/);
assert.match(html, /只读/);
assert.match(html, /来源：易考需求单/);
assert.equal((html.match(/data-operation-personnel-edit=/g) || []).length, 5);
assert.doesNotMatch(html, /dates\.start|dates\.end|personnel\.monitorCount|batch\.published/);
assert.doesNotMatch(html, /\[\{"scheduleEntryId"|&quot;scheduleEntryId&quot;/);
assert.equal((html.match(/<h4>人员配置<\/h4>/g) || []).length, 0);
```

再以 `operationChanges` 包含 `schedules` 对象数组的 DTO 渲染，验证只出现“新增 1 个考试日程”或“修改 1 个考试日程”，不输出 JSON。

- [ ] **Step 2: 运行界面测试并确认失败**

Run:

```bash
node --test server/test_ui_views.mjs
```

Expected: FAIL，当前实现仍显示技术路径列表和独立“人员配置”区域。

- [ ] **Step 3: 增加前端业务字段映射与安全显示函数**

在渲染函数相邻位置增加局部常量和函数：

```js
const operationPersonnelFieldMeta = {
  "batch.published": { group: "批次状态", label: "批次发布状态", source: "运控", readonly: true },
  "dates.start": { group: "人员日期", label: "人员落实开始日期", source: "系统规则", edit: "start", type: "date" },
  "dates.end": { group: "人员日期", label: "人员落实结束日期", source: "易考需求单", edit: "end", type: "date" },
  "dates.nameListDue": { group: "人员日期", label: "人员名单提交日期", source: "易考需求单", edit: "nameListDue", type: "date" },
  "personnel.monitorCount": { group: "人员配置", label: "监考人数", source: "易考需求单", edit: "monitorCount", type: "number" },
  "personnel.monitorRatio": { group: "人员配置", label: "监考比例", source: "系统规则", edit: "monitorRatio", type: "text" },
  "personnel.platform": { group: "人员配置", label: "人员落实平台", source: "固定规则", readonly: true },
  "personnel.serviceType": { group: "人员配置", label: "人员服务类型", source: "固定规则", readonly: true },
  "personnel.loginMonitoring": { group: "人员配置", label: "监考登录监控", source: "固定规则", readonly: true },
  "personnel.earliestLoginMinutes": { group: "人员配置", label: "最早登录系统时间", source: "易考需求单", readonly: true },
};
```

布尔值转为“未发布/已发布”，空值转为“未设置”，对象和数组不进入通用值渲染。

- [ ] **Step 4: 渲染统一表格**

表格结构固定为：

```html
<table class="operation-change-table">
  <thead>
    <tr><th>业务项目</th><th>修改前</th><th>修改后</th><th>来源</th></tr>
  </thead>
  <tbody>
    <!-- 每个分组先输出 group row，再输出 field row -->
  </tbody>
</table>
```

五个可编辑字段在“修改后”单元格渲染现有 `data-operation-personnel-edit` 输入框；其它字段渲染值和“只读”标记。删除原独立 `<h4>人员配置</h4>` 区域，但不改变 `collectOperationPersonnelPreviewEdits` 的字段名。

- [ ] **Step 5: 将日程变化改为摘要加只读表格**

日程摘要只显示：

```text
新增 1 个考试日程
修改 1 个考试日程
考试日程无变化
```

完整表格列改为“日程序号 / 考试名称 / 开始时间 / 结束时间”，优先读取 `draft.managedSchedules`。科目和提前登录分钟数如继续展示，只能放在单独的“任务单补充信息”只读区域，不能进入编辑框。

- [ ] **Step 6: 增加浅色和深色样式**

为以下类增加与现有 CSS 变量一致的样式：

```css
.operation-change-table
.operation-change-group
.operation-change-before
.operation-change-after
.operation-change-source
.operation-readonly-badge
.operation-change-table .field-input
```

浅色主题保证表头、分组行、输入框边界对比清晰；在项目现有深色主题选择器中覆盖背景、边框和文字颜色，不新增主题系统。

- [ ] **Step 7: 运行界面测试**

Run:

```bash
node --test server/test_ui_views.mjs
```

Expected: PASS；渲染结果只有五个可编辑输入框，不出现内部路径和日程 JSON。

- [ ] **Step 8: 记录该任务变更**

先检查：

```bash
git diff -- outputs/web_prototype/easy_exam_automation.html server/test_ui_views.mjs
```

仅暂存并提交：

```bash
git add outputs/web_prototype/easy_exam_automation.html server/test_ui_views.mjs
git commit -m "feat: show personnel changes in grouped table"
```

---

### Task 6: 全量回归、运行时同步和只读实测

**Files:**
- Modify only if evidence changes: `docs/operation-personnel-task-test-evidence.md`

**Interfaces:**
- Consumes: Tasks 1-5 的所有测试和当前 `8765` LaunchAgent 配置。
- Produces: 测试结果、运行时健康检查、实际预览截图或明确阻断证据。

- [ ] **Step 1: 运行人员任务和批次相关回归**

Run:

```bash
node --test \
  server/test_operation_batch_update.mjs \
  server/test_operation_batch_creation_flow.mjs \
  server/test_operation_personnel_schedule_gate.mjs \
  server/test_operation_personnel_task.mjs \
  server/test_operation_personnel_task_service.mjs \
  server/test_operation_personnel_task_runner.mjs \
  server/test_operation_personnel_task_routes.mjs \
  server/test_ui_views.mjs
```

Expected: 全部 PASS。

- [ ] **Step 2: 运行项目全量 Node 测试**

Run:

```bash
/bin/zsh -lc 'for f in server/test_*.mjs; do [ "$f" = "server/test_exam_time_only.mjs" ] && continue; printf "%s\n" "$f"; done | xargs /Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test'
```

Expected: exit code `0`，无失败测试。

- [ ] **Step 3: 运行 Python 回归**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest discover -s server -p 'test_*.py'
```

Expected: exit code `0`。

- [ ] **Step 4: 审查人员任务执行路径没有日程写调用**

Run:

```bash
rg -n "sync_exam_schedules|syncExamSchedules|findScheduleRows|deleteSchedule" server/operation_personnel_task_runner.mjs
```

Expected: `runOperationPersonnelAttemptOnPage` 和 `OPERATION_PERSONNEL_CHECKPOINTS` 中没有日程写入调用；若底层适配器方法仍存在，搜索结果只能落在不可由人员任务 active flow 到达的定义处。

- [ ] **Step 5: 同步并重启 8765 测试运行时**

Run:

```bash
node scripts/deploy_launchd_runtime.mjs
```

按项目现有 LaunchAgent 方式重启服务，然后验证：

```bash
curl -sS --max-time 10 http://127.0.0.1:8765/api/health
```

Expected: HTTP 成功并返回健康状态。若服务未启动，读取 LaunchAgent 标准输出和错误日志尾部，先修复明确问题再继续。

- [ ] **Step 6: 在本地界面执行只读端到端验证**

使用当前测试项目打开“发送人员任务单”预览：

- 批次状态一致时，确认窗口展示中文分组表格和只读日程；
- 五个允许字段可编辑，修改后重新预览仍保留输入；
- 页面不显示内部路径或 JSON；
- 不点击最终“确认配置并发送任务单”；
- 若批次处于等待补全、可修改或冲突状态，验证页面显示“请先在建批次环节完成批次信息修改”，且运控批次未被发布、未选择收件人、未发送。

- [ ] **Step 7: 更新验证证据并检查最终工作树**

只把本次真实运行得到的测试数量、健康响应和预览结果写入 `docs/operation-personnel-task-test-evidence.md`；未执行的真实发送明确写“未执行”，不得推断成功。

Run:

```bash
git status --short --branch
git diff --stat
git log --oneline -6
```

Expected: 本次文件可追溯到 Tasks 1-5 的提交；原有无关未提交文件保持不变。

- [ ] **Step 8: 提交验证证据**

仅在证据文件确有本次新增内容时执行：

```bash
git add docs/operation-personnel-task-test-evidence.md
git commit -m "docs: record read-only personnel schedule verification"
```

完成后报告：

- 相关测试与全量测试的准确通过数量；
- `8765` 健康检查原始结果；
- 实际预览通过或阻断的具体状态；
- 未执行真实发送；
- 仍未提交或需要用户后续验证的事项。
