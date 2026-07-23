# 运控人员任务单配置与发送实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在项目详情“运控协同 → 人员任务”中完成标准 ATA 分散在线监考任务单的检查、统一确认、运控配置、内置发送、变更重发和发送记录对账。

**Architecture:** 新增纯业务模块负责草稿、稳定日程代码、指纹、差异和状态判定；新增 Playwright 可见客户端执行器负责精确读取和操作运控页面；新增协调服务复用现有运控浏览器锁并持久化预览、attempt、checkpoint 和审计。现有单文件 UI 只调用五个最小 API，使用一个确认窗口和一个进度视图。

**Tech Stack:** Node.js ESM、`node:test`、Playwright 1.54、Python SQLite 状态脚本、原生 HTTP 服务、单文件 HTML/CSS/JavaScript。

## Global Constraints

- 第一版只支持标准“ATA 监考－分散在线监考”；其它人员任务类型和高端补充需求必须阻断。
- 必须使用运控内置任务单发送机制；不得使用 Outlook SMTP，不得调用或逆向运控未公开接口。
- 运控页面始终通过现有持久化浏览器资料目录以可见客户端方式操作。
- 建批次和人员任务必须共用 `persistent-profile` 浏览器锁；同一项目只能存在一个人员发送 attempt。
- 正式环境收件人为“拓展二部 / 唐润梅”，抄送“结算组”全部且必须恰好 4 人。
- 测试环境收件人为“演示组 / 张乐翔”，无抄送；不得回退到正式收件人。
- 环境只读取服务端 `OPERATION_CONSOLE_ENVIRONMENT=test|production`；请求体和页面都不能临时切换环境，未知值必须阻断。
- 首次发送时未发布批次要在统一确认中显示并自动发布；重发不重复发布。
- 内容指纹完全一致时前端和服务端都禁止重发。
- 运控和平台值不一致时阻断人工干预；不得自动合并、覆盖或反向同步。
- 用户点击最终发送后不得自动再次点击发送。
- 发送成功只以运控右上角出现符合本次 attempt 的新发送记录为准。
- 第一阶段等待 30 秒；关闭任务单重新进入后第二阶段再等待 30 秒；两次都无记录进入 `result_unknown`。
- `result_unknown` 只能只读重新对账，不能人工标记成功。
- 预览令牌有效期固定 10 分钟；需求版本、草稿版本、运控快照或人员目录变化都会使其失效。
- 已写入运控的 checkpoint 不自动回滚；恢复前必须重新读取并精确校验。
- 项目负责人只能操作自己的项目；管理员可操作所有项目。
- 不保存运控凭据或完整人员目录。
- 不改动项目编码、项目名称、批次名称、项目部归属等批次基础信息。
- 不改动自动配置、候选人导入、内容邮件和微信群采集的既有行为。

---

## File Structure

- Create `server/operation_personnel_task.mjs`: 纯领域模型、规范化、稳定代码、人数/日期、指纹、diff、预览与状态判定。
- Create `server/test_operation_personnel_task.mjs`: 领域模型的表驱动测试。
- Create `server/operation_personnel_task_runner.mjs`: Playwright 可见页面读取、配置、发送与两阶段记录核验。
- Create `server/test_operation_personnel_task_runner.mjs`: 使用 fake page/clock 验证精确匹配、单击发送和 30+30 秒核验。
- Create `server/operation_personnel_task_service.mjs`: 锁、预览令牌、异步 attempt、checkpoint、恢复和持久化协调。
- Create `server/test_operation_personnel_task_service.mjs`: 使用注入式状态仓库和 runner 验证状态机、幂等、恢复与审计。
- Modify `server/operation_batch_runner.mjs`: 仅导出既有 persistent-context 启动函数，供人员 runner 复用。
- Modify `server/operation_batch_coordinator.mjs`: 增加只取得共享浏览器锁的方法，允许人员服务在 checkpoint 持久化期间短暂取得项目锁。
- Modify `server/easy_exam_server.mjs`: 注入服务依赖并接入五个 API。
- Modify `server/project_workflow.mjs`: 人员步骤使用持久化人员状态，不再只依赖 legacy 草稿警告。
- Create `server/test_operation_personnel_task_routes.mjs`: 启动真实本地服务验证 API、权限和禁用自动化边界。
- Modify `outputs/web_prototype/easy_exam_automation.html`: 人员面板、统一确认、进度、倒计时、重发和只读重新核对。
- Modify `server/test_ui_views.mjs`: DOM 结构和内联函数行为测试。
- Modify `server/test_project_workflow.mjs`: 人员状态映射测试。
- Create `docs/operation-personnel-task-test-evidence.md`: 自动测试、测试运控首次发送/重发及 8765 运行时证据。

### Task 1: 纯业务模型与稳定版本

**Files:**
- Create: `server/operation_personnel_task.mjs`
- Create: `server/test_operation_personnel_task.mjs`
- Modify: `server/project_workflow.mjs`
- Modify: `server/test_project_workflow.mjs`

**Interfaces:**
- Produces: `buildOperationPersonnelTaskDraft(task, options)` → `{ schemaVersion, environment, schedules, personnel, dates, recipients, sourceVersion, warnings, scheduleCodeMap }`。
- Produces: `operationPersonnelTaskFingerprint(draft)` → 64 位十六进制 SHA-256。
- Produces: `diffOperationPersonnelTaskDrafts(before, after)` → 结构化差异和中文变化摘要。
- Produces: `buildOperationPersonnelTaskStatus(task, draft)` → 规格中的状态和可用动作。
- Consumes: `task.config.operationPersonnelTask.scheduleCodeMap`、已确认需求、实际场次和候选人数。

- [ ] **Step 1: 写失败测试覆盖日程、稳定代码和删除**

创建 `server/test_operation_personnel_task.mjs`，先覆盖核心稳定性：

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOperationPersonnelTaskDraft,
  diffOperationPersonnelTaskDrafts,
  operationPersonnelTaskFingerprint,
} from "./operation_personnel_task.mjs";

const baseTask = {
  taskId: "task-a",
  projectName: "示例考试",
  config: {
    operationBatchCode: "EZT260003",
    operationBatch: { code: "EZT260003", status: "created_unpublished" },
    businessRequirement: {
      operation_serial_number: "R0042483",
      project_code: "P260001",
      project_name: "示例考试",
      ata_invigilator_arrangement: "需要安排分散人工监考",
    },
    examRequirements: [{
      id: "requirement-1",
      version: 3,
      fields: { "考试名称": "示例考试", "考试日期时间": "2026/08/22 09:00-11:00" },
      config: {
        startTimeDisplay: "2026/08/22 09:00",
        endTimeDisplay: "2026/08/22 11:00",
        earlyLoginMinutes: 30,
        courses: [{ code: "C001", name: "综合能力" }],
      },
    }],
  },
  sessions: [{ sessionType: "formal", requirementIndex: 0, candidateCount: 81 }],
};

test("keeps a schedule code when date and subject name change", () => {
  const first = buildOperationPersonnelTaskDraft(baseTask, {
    environment: "test",
    now: "2026-07-23T02:00:00.000Z",
  });
  assert.equal(first.schedules[0].scheduleCode, 1);

  const changed = structuredClone(baseTask);
  changed.config.examRequirements[0].fields["考试名称"] = "示例考试（调整）";
  changed.config.examRequirements[0].config.startTimeDisplay = "2026/08/23 09:00";
  const second = buildOperationPersonnelTaskDraft(changed, {
    environment: "test",
    now: "2026-07-23T02:01:00.000Z",
    scheduleCodeMap: first.scheduleCodeMap,
  });
  assert.equal(second.schedules[0].scheduleEntryId, first.schedules[0].scheduleEntryId);
  assert.equal(second.schedules[0].scheduleCode, 1);
});

test("appends codes for additions and reports exact deletions", () => {
  const first = buildOperationPersonnelTaskDraft(baseTask, {
    environment: "test",
    now: "2026-07-23T02:00:00.000Z",
  });
  const changed = structuredClone(baseTask);
  changed.config.examRequirements.push({
    id: "requirement-2",
    version: 1,
    fields: { "考试名称": "第二场", "考试日期时间": "2026/08/22 14:00-16:00" },
    config: {
      startTimeDisplay: "2026/08/22 14:00",
      endTimeDisplay: "2026/08/22 16:00",
      earlyLoginMinutes: 20,
      courses: [{ code: "C002", name: "英语" }],
    },
  });
  const second = buildOperationPersonnelTaskDraft(changed, {
    environment: "test",
    now: "2026-07-23T02:01:00.000Z",
    scheduleCodeMap: first.scheduleCodeMap,
  });
  assert.deepEqual(second.schedules.map((item) => item.scheduleCode), [1, 2]);
  assert.deepEqual(
    diffOperationPersonnelTaskDrafts(second, first).schedules.deleted.map((item) => item.scheduleCode),
    [2],
  );
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test server/test_operation_personnel_task.mjs`

Expected: `ERR_MODULE_NOT_FOUND`，因为领域模块尚未创建。

- [ ] **Step 3: 实现规范化日程和持久化代码映射**

在 `server/operation_personnel_task.mjs` 实现并导出以下稳定接口：

```js
import { createHash, randomUUID } from "node:crypto";

const SCHEMA_VERSION = 1;
const RECIPIENT_RULES = Object.freeze({
  test: { toGroup: "演示组", toNames: ["张乐翔"], ccGroup: "", ccCount: 0 },
  production: { toGroup: "拓展二部", toNames: ["唐润梅"], ccGroup: "结算组", ccCount: 4 },
});

function text(value) {
  return String(value ?? "").trim();
}

function taskRequirements(task) {
  const items = task.config?.examRequirements;
  return Array.isArray(items) && items.length
    ? items
    : (task.config?.examRequirement?.fields ? [task.config.examRequirement] : []);
}

function subjectStableKey(course, existing = {}, makeId = randomUUID) {
  const code = text(course?.code || course?.course_code);
  if (code) return `course:${code}`;
  const seed = text(course?.personnelSubjectKey || existing.subjectKey);
  return seed || `subject:${makeId()}`;
}

function assignScheduleCodes(entries, previousMap = {}) {
  const used = Object.values(previousMap).map((item) => Number(item.scheduleCode || 0));
  let nextCode = Math.max(0, ...used) + 1;
  const scheduleCodeMap = { ...previousMap };
  const schedules = entries.map((entry) => {
    const previous = scheduleCodeMap[entry.scheduleEntryId];
    const scheduleCode = Number(previous?.scheduleCode || nextCode++);
    scheduleCodeMap[entry.scheduleEntryId] = {
      scheduleEntryId: entry.scheduleEntryId,
      scheduleCode,
      subjectKey: entry.subjectKey,
    };
    return { ...entry, scheduleCode };
  });
  return { schedules, scheduleCodeMap };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function operationPersonnelTaskFingerprint(draft) {
  const material = {
    batch: draft.batch,
    schedules: draft.schedules,
    personnel: draft.personnel,
    dates: draft.dates,
    recipientsRuleVersion: draft.recipients.ruleVersion,
  };
  return createHash("sha256").update(stableJson(material)).digest("hex");
}
```

`buildOperationPersonnelTaskDraft` 必须按 `requirement.id + formal/trial + subjectStableKey` 生成 `scheduleEntryId`，按开始时间排序后调用 `assignScheduleCodes`。无课程代码的 subject key 通过注入的 `makeId` 生成，并随 `scheduleCodeMap` 一起返回供服务持久化。日程结束时间必须晚于开始时间，否则在 `warnings` 中产生稳定错误码 `INVALID_SCHEDULE_RANGE`。

- [ ] **Step 4: 写失败测试覆盖人数、日期、试考和收件规则**

继续增加：

```js
test("uses simultaneous actual candidate peak before estimated concurrency", () => {
  const task = structuredClone(baseTask);
  task.sessions = [
    { sessionType: "formal", start: "2026/08/22 09:00", end: "2026/08/22 11:00", candidateCount: 81 },
    { sessionType: "formal", start: "2026/08/22 10:00", end: "2026/08/22 12:00", candidateCount: 30 },
  ];
  const draft = buildOperationPersonnelTaskDraft(task, {
    environment: "test",
    now: "2026-07-23T02:00:00.000Z",
  });
  assert.equal(draft.personnel.candidateBasis, 111);
  assert.equal(draft.personnel.monitorCount, 3);
  assert.equal(draft.personnel.monitorRatio, "1:50");
});

test("does not prefill invalid past personnel dates", () => {
  const draft = buildOperationPersonnelTaskDraft(baseTask, {
    environment: "test",
    now: "2026-08-21T02:00:00.000Z",
  });
  assert.equal(draft.dates.start, "2026-08-21");
  assert.equal(draft.dates.end, "");
  assert.equal(draft.dates.nameListDue, "");
  assert.ok(draft.warnings.some((item) => item.code === "PERSONNEL_DATES_REQUIRED"));
});

test("uses isolated fixed recipient rules", () => {
  const testDraft = buildOperationPersonnelTaskDraft(baseTask, {
    environment: "test",
    now: "2026-07-23T02:00:00.000Z",
  });
  const productionDraft = buildOperationPersonnelTaskDraft(baseTask, {
    environment: "production",
    now: "2026-07-23T02:00:00.000Z",
  });
  assert.deepEqual(testDraft.recipients.toNames, ["张乐翔"]);
  assert.equal(testDraft.recipients.ccCount, 0);
  assert.deepEqual(productionDraft.recipients.toNames, ["唐润梅"]);
  assert.equal(productionDraft.recipients.ccCount, 4);
});
```

- [ ] **Step 5: 实现人数、日期、试考和 unsupported 判定**

实现 sweep-line 峰值，结束事件在同一时刻排在开始事件前，避免相邻场次被误算为重叠：

```js
function simultaneousCandidatePeak(sessions) {
  const events = sessions.flatMap((session) => {
    const start = Date.parse(text(session.start));
    const end = Date.parse(text(session.end));
    const count = Number(session.candidateCount || session.candidate_count || 0);
    return Number.isFinite(start) && Number.isFinite(end) && end > start && count > 0
      ? [{ at: start, delta: count }, { at: end, delta: -count }]
      : [];
  }).sort((left, right) => left.at - right.at || left.delta - right.delta);
  let current = 0;
  let peak = 0;
  for (const event of events) {
    current += event.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}
```

若实际峰值为 0，则使用批次草稿 `estimatedMaxSubjectCount`；两者均无值时 `monitorCount` 留空并产生 `MONITOR_COUNT_REQUIRED`。人数公式固定为 `Math.max(1, Math.ceil(basis / 50))`。人员平台固定 `悦站`，登录监控固定 `是`，最早登录分钟取正式场次最大值。

日期以 Asia/Shanghai 的日历日期计算：开始为发送日，结束和名单提交为最早正式考试日前 3 天；已过期或区间无效时留空。试考只有明确的 `trialMonitoringRequired === true` 或已确认字段等价值才纳入。人员服务不是分散人工监考或存在高端补充标志时返回 `unsupported` warning。

- [ ] **Step 6: 实现 fingerprint、diff、重复发送和工作流状态**

`diffOperationPersonnelTaskDrafts` 必须用 `scheduleEntryId` 对齐日程，并返回：

```js
{
  schedules: { added: [], changed: [], deleted: [] },
  fields: [{ path: "dates.end", before: "2026-08-19", after: "2026-08-20" }],
  summary: "考试日程：新增 1 项；人员落实结束日期：2026-08-19 → 2026-08-20",
}
```

`buildOperationPersonnelTaskStatus` 使用持久化状态优先映射 `sent`、`changes_pending`、`failed_resumable`、`result_unknown` 和 `operation_conflict`。首次指纹与 `lastSuccessfulFingerprint` 相等时返回 `sent`，不得返回可重发动作。

修改 `buildProjectWorkflow`：

```js
const personnelState = task.config?.operationPersonnelTask || {};
const personnelStatus = buildOperationPersonnelTaskStatus(task, personnelDraft);
// steps.personnel.status = personnelStatus.status
// steps.personnel.actions = personnelStatus.actions
```

- [ ] **Step 7: 运行领域和工作流测试确认 GREEN**

Run: `node --test server/test_operation_personnel_task.mjs server/test_project_workflow.mjs`

Expected: 两个文件全部通过，退出码 0。

- [ ] **Step 8: 提交领域模型**

```bash
git add server/operation_personnel_task.mjs server/test_operation_personnel_task.mjs server/project_workflow.mjs server/test_project_workflow.mjs
git commit -m "feat: model operation personnel tasks"
```

### Task 2: 运控可见页面读取与精确冲突检测

**Files:**
- Modify: `server/operation_batch_runner.mjs`
- Modify: `server/operation_batch_coordinator.mjs`
- Create: `server/operation_personnel_task_runner.mjs`
- Create: `server/test_operation_personnel_task_runner.mjs`
- Modify: `server/test_operation_batch_coordinator.mjs`

**Interfaces:**
- Consumes: `launchOperationBatchContext(userDataDir, headless, options)` 和 `runWithOperationBatchContext`。
- Produces: `inspectOperationPersonnelTask(page, instruction, options)` → 运控批次、日程、人员配置、任务单和目录匹配快照。
- Produces: `operationPersonnelConflicts(expected, actual, mode)` → 精确字段冲突。
- Produces: `runOperationPersonnelInspection(instruction, options)` → 只读预览快照。
- Produces: `acquireProfile()` → 只取得共享浏览器锁。

- [ ] **Step 1: 写失败测试覆盖共享锁和精确目录匹配**

在 `server/test_operation_batch_coordinator.mjs` 增加：

```js
test("profile-only lock excludes batch and personnel browser sessions", () => {
  const events = [];
  const { value } = coordinator(events);
  const release = value.acquireProfile();
  assert.deepEqual(events, ["acquire:persistent-profile"]);
  assert.throws(() => value.acquireAutomation("task-a"), /正在执行/);
  release();
  assert.deepEqual(events, ["acquire:persistent-profile", "release:persistent-profile"]);
});
```

在 runner 测试中增加：

```js
test("recipient matching requires the exact environment directory result", () => {
  assert.deepEqual(matchOperationPersonnelRecipients({
    environment: "test",
    groups: [{ name: "演示组", people: [{ id: "u1", name: "张乐翔" }] }],
  }), {
    to: [{ id: "u1", name: "张乐翔" }],
    cc: [],
  });
  assert.throws(() => matchOperationPersonnelRecipients({
    environment: "production",
    groups: [
      { name: "拓展二部", people: [{ id: "u1", name: "唐润梅" }] },
      { name: "结算组", people: [{ id: "u2", name: "甲" }] },
    ],
  }), /结算组必须精确匹配 4 人/);
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test server/test_operation_batch_coordinator.mjs server/test_operation_personnel_task_runner.mjs`

Expected: 新方法和新模块不存在。

- [ ] **Step 3: 最小扩展共享浏览器基础设施**

将 `operation_batch_runner.mjs` 中既有私有函数改为具名导出，不改变函数体：

```js
export async function launchOperationBatchContext(userDataDir, headless, options = {}) {
  if (typeof options.launchPersistentContext === "function") {
    return options.launchPersistentContext(userDataDir, { headless, viewport: null });
  }
  const { chromium } = await import("playwright").catch((error) => {
    const message = error?.code === "ERR_MODULE_NOT_FOUND"
      ? "未安装 Playwright，不能启动运营控制台浏览器自动化。请先执行 npm install。"
      : (error instanceof Error ? error.message : String(error));
    throw new Error(message);
  });
  return chromium.launchPersistentContext(userDataDir, { headless, viewport: null });
}
```

在协调器中增加：

```js
function acquireProfile() {
  acquireLock(profileInFlight, profileKey);
  return once(() => releaseLock(profileInFlight, profileKey));
}

return { acquireAutomation, acquireProfile, acquireTask };
```

人员 preview 先取 profile 锁读取运控，保存 preview 时再短暂取 task 锁；attempt 运行期间取 profile 锁，每个 checkpoint 持久化时取 task 锁。这样不会在长达 60 秒的记录核验期间阻止项目只读页面加载，同时仍禁止两个浏览器共用同一资料目录。

- [ ] **Step 4: 实现批次身份、配置和目录只读快照**

创建 `server/operation_personnel_task_runner.mjs`，定义稳定快照：

```js
export function normalizeOperationPersonnelSnapshot(raw = {}) {
  return {
    batch: {
      code: text(raw.batch?.code),
      projectCode: text(raw.batch?.projectCode),
      projectName: text(raw.batch?.projectName),
      batchName: text(raw.batch?.batchName),
      projectDepartment: text(raw.batch?.projectDepartment),
      projectManager: text(raw.batch?.projectManager),
      systemType: text(raw.batch?.systemType),
      published: raw.batch?.published === true,
    },
    schedules: [...(raw.schedules || [])].map(normalizeSchedule).sort(byScheduleCode),
    personnel: normalizePersonnel(raw.personnel),
    dates: normalizeDates(raw.dates),
    requirements: normalizeRequirements(raw.requirements),
    taskSheet: normalizeTaskSheet(raw.taskSheet),
    sendRecords: normalizeSendRecords(raw.sendRecords),
    directoryMatch: normalizeDirectoryMatch(raw.directoryMatch),
  };
}
```

`inspectOperationPersonnelTask` 必须从批次列表按批次代码精确定位一行，再进入详情。批次基础字段逐一读取；日程按页面代码读取；人员、日期、考务需求和任务单内容分别读取。目录只保存本次匹配结果 `{ group, id, name }`，不得把完整目录返回或持久化。

首次发送冲突规则：运控目标字段为空可补齐，非空且不同则冲突。重发冲突规则：运控目标快照必须与 `lastOperationSnapshot` 完全相等。基础字段在两种模式下只比较、不修改。

- [ ] **Step 5: 写失败测试覆盖空值补齐、外部修改和基础字段阻断**

```js
test("first send may fill empty operation fields but never overwrite values", () => {
  assert.deepEqual(operationPersonnelConflicts(
    { personnel: { platform: "悦站" } },
    { personnel: { platform: "" } },
    "initial",
  ), []);
  assert.deepEqual(operationPersonnelConflicts(
    { personnel: { platform: "悦站" } },
    { personnel: { platform: "其他平台" } },
    "initial",
  ).map((item) => item.path), ["personnel.platform"]);
});

test("resend blocks any drift from the last successful operation snapshot", () => {
  const conflicts = operationPersonnelConflicts(
    { schedules: [{ scheduleCode: 1, start: "2026-08-22 10:00" }] },
    { schedules: [{ scheduleCode: 1, start: "2026-08-22 09:00" }] },
    "resend",
  );
  assert.equal(conflicts[0].path, "schedules.1.start");
});
```

- [ ] **Step 6: 运行 focused 测试确认 GREEN**

Run: `node --test server/test_operation_batch_coordinator.mjs server/test_operation_personnel_task_runner.mjs`

Expected: 全部通过，退出码 0。

- [ ] **Step 7: 提交读取执行器**

```bash
git add server/operation_batch_runner.mjs server/operation_batch_coordinator.mjs server/operation_personnel_task_runner.mjs server/test_operation_batch_coordinator.mjs server/test_operation_personnel_task_runner.mjs
git commit -m "feat: inspect operation personnel task sheets"
```

### Task 3: Checkpoint 配置、内置发送与两阶段记录核验

**Files:**
- Modify: `server/operation_personnel_task_runner.mjs`
- Modify: `server/test_operation_personnel_task_runner.mjs`

**Interfaces:**
- Produces: `runOperationPersonnelAttempt(instruction, options)`。
- Produces: `runOperationPersonnelRecheck(instruction, options)`。
- Calls: `options.onCheckpoint(update)` 和 `options.onVerification(update)`，供服务持久化和 UI 倒计时。
- Guarantees: `submit_send` 最终确认最多点击一次。

- [ ] **Step 1: 写失败测试覆盖固定 checkpoint 顺序和发布幂等**

```js
test("attempt applies checkpoints in the approved order", async () => {
  const observed = [];
  await runOperationPersonnelAttempt(validInstruction(), {
    context: fakeOperationContext(),
    onCheckpoint: async ({ name, status }) => observed.push(`${name}:${status}`),
    sleep: async () => {},
    now: advancingClock(),
  });
  assert.deepEqual(observed.filter((item) => item.endsWith(":completed")), [
    "inspect_batch:completed",
    "publish_batch:completed",
    "sync_exam_schedules:completed",
    "sync_personnel_config:completed",
    "sync_personnel_dates:completed",
    "sync_exam_service_requirements:completed",
    "verify_task_sheet:completed",
    "select_recipients:completed",
    "submit_send:completed",
    "verify_send_record:completed",
  ]);
});

test("published batches skip the publish click but still complete the checkpoint", async () => {
  const page = fakeOperationPage({ published: true });
  await runOperationPersonnelAttempt(validInstruction(), {
    context: fakeOperationContext(page),
    sleep: async () => {},
    now: advancingClock(),
  });
  assert.equal(page.events.filter((item) => item === "publish:click").length, 0);
});
```

- [ ] **Step 2: 实现发布、配置、回读和任务单核对**

每个 checkpoint 统一采用：

```js
async function checkpoint(name, action, verify, onCheckpoint) {
  await onCheckpoint({ name, status: "running", startedAt: new Date().toISOString() });
  const output = await action();
  const readback = await verify(output);
  await onCheckpoint({
    name,
    status: "completed",
    completedAt: new Date().toISOString(),
    readback,
  });
  return readback;
}
```

`publish_batch` 只在首次发送且快照为未发布时点击，并立即回读“已发布”。日程删除必须用 `scheduleEntryId + scheduleCode` 对应的唯一页面行；零行或多行阻断。每项配置写入后立即读取并比较规范化值。进入任务单后，页面发送条件必须全部满足，任务单字段必须与草稿一致，才能进入人员目录。

恢复执行时，runner 先读取当前运控快照。持久化为 completed 的 checkpoint 只有在回读仍等于该 checkpoint 的目标摘要时才幂等跳过；不一致立即返回 `operation_conflict`。未完成 checkpoint 从固定顺序中的第一项继续，不能重做 `submit_send`。

- [ ] **Step 3: 写失败测试证明最终发送只点击一次**

```js
test("never retries the final send click when the send record is delayed", async () => {
  const page = fakeOperationPage({ sendRecordsAfterReopen: [] });
  const result = await runOperationPersonnelAttempt(validInstruction(), {
    context: fakeOperationContext(page),
    sleep: async () => {},
    now: advancingClock(),
  });
  assert.equal(page.events.filter((item) => item === "send:confirm").length, 1);
  assert.equal(result.status, "result_unknown");
});
```

- [ ] **Step 4: 实现内置发送和两阶段 30 秒核验**

在点击最终确认前保存 `attemptStartedAt`。选择人员后再次核对实际 chips 与预览中的 ID/姓名完全一致，再执行一次最终点击。

验证循环使用注入时钟：

```js
async function waitForNewSendRecord(readRecords, attempt, options) {
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now || (() => Date.now());
  const deadline = now() + 30_000;
  await options.onVerification?.({ phase: options.phase, deadlineAt: new Date(deadline).toISOString() });
  while (now() < deadline) {
    const match = findAttemptSendRecord(await readRecords(), attempt);
    if (match) return match;
    await sleep(Math.min(1000, deadline - now()));
  }
  return null;
}
```

第一阶段无记录时关闭任务单弹窗并重新进入同一批次发送页面，再执行第二阶段。两阶段均无记录返回 `{ status: "result_unknown" }`。`runOperationPersonnelRecheck` 只执行打开页面和读取记录，不调用任何配置或发送方法。

- [ ] **Step 5: 写失败测试覆盖首次记录、重发新记录和只读 recheck**

```js
test("resend only accepts a record later than attempt start", () => {
  assert.equal(findAttemptSendRecord([
    { type: "再次发送", sentAt: "2026-07-23T01:59:59.000Z" },
  ], { kind: "resend", startedAt: "2026-07-23T02:00:00.000Z" }), null);
  assert.equal(findAttemptSendRecord([
    { type: "再次发送", sentAt: "2026-07-23T02:00:01.000Z" },
  ], { kind: "resend", startedAt: "2026-07-23T02:00:00.000Z" }).sentAt, "2026-07-23T02:00:01.000Z");
});

test("recheck is read-only", async () => {
  const page = fakeOperationPage({ sendRecords: [] });
  await runOperationPersonnelRecheck(validInstruction(), {
    context: fakeOperationContext(page),
  });
  assert.equal(page.events.some((item) => /publish|fill|delete|send:confirm/.test(item)), false);
});

test("resume skips a verified checkpoint and blocks drift before continuing", async () => {
  const matching = fakeOperationPage({ personnelPlatform: "悦站" });
  await runOperationPersonnelAttempt(validInstruction({
    checkpoints: { sync_personnel_config: { status: "completed", targetDigest: "matching" } },
  }), {
    context: fakeOperationContext(matching),
    sleep: async () => {},
    now: advancingClock(),
  });
  assert.equal(matching.events.includes("personnel:fill"), false);

  const drifted = fakeOperationPage({ personnelPlatform: "其他平台" });
  await assert.rejects(() => runOperationPersonnelAttempt(validInstruction({
    checkpoints: { sync_personnel_config: { status: "completed", targetDigest: "matching" } },
  }), {
    context: fakeOperationContext(drifted),
  }), { code: "PERSONNEL_OPERATION_CONFLICT" });
});
```

- [ ] **Step 6: 运行 runner 测试确认 GREEN**

Run: `node --test server/test_operation_personnel_task_runner.mjs`

Expected: 全部通过，最终点击次数断言为 1，只读 recheck 无写事件。

- [ ] **Step 7: 提交发送执行器**

```bash
git add server/operation_personnel_task_runner.mjs server/test_operation_personnel_task_runner.mjs
git commit -m "feat: send operation personnel task sheets"
```

### Task 4: 协调服务、预览令牌、异步 attempt 与恢复

**Files:**
- Create: `server/operation_personnel_task_service.mjs`
- Create: `server/test_operation_personnel_task_service.mjs`

**Interfaces:**
- Produces: `createOperationPersonnelTaskService(dependencies)`。
- Produces methods: `get(taskId, actor)`、`preview(taskId, actor, input)`、`send(taskId, actor, input)`、`attempt(taskId, actor, attemptId)`、`recheck(taskId, actor)`。
- Consumes: `runTaskState`、`runRequirementState`、共享 coordinator、domain functions、runner functions。

- [ ] **Step 1: 写失败测试覆盖预览令牌和同内容重发**

```js
test("preview token binds requirement, draft, operation snapshot and directory", async () => {
  const harness = serviceHarness();
  const preview = await harness.service.preview("task-a", owner(), {});
  harness.task.config.examRequirement.version += 1;
  await assert.rejects(
    harness.service.send("task-a", owner(), {
      previewToken: preview.previewToken,
      draftVersion: preview.draftVersion,
      changeSummary: "",
    }),
    { code: "PERSONNEL_PREVIEW_STALE", status: 409 },
  );
});

test("identical successful fingerprint cannot be resent", async () => {
  const harness = serviceHarness({ alreadySent: true });
  const preview = await harness.service.preview("task-a", owner(), {});
  await assert.rejects(
    harness.service.send("task-a", owner(), {
      previewToken: preview.previewToken,
      draftVersion: preview.draftVersion,
      changeSummary: "",
    }),
    { code: "PERSONNEL_CONTENT_UNCHANGED", status: 409 },
  );
});
```

- [ ] **Step 2: 实现持久化状态和 10 分钟令牌**

人员状态固定为：

```js
{
  schemaVersion: 1,
  environment: "test",
  status: "ready",
  draft: {},
  draftVersion: 1,
  sourceFingerprint: "",
  lastSuccessfulFingerprint: "",
  scheduleCodeMap: {},
  lastOperationSnapshot: null,
  checkpoints: {},
  activePreview: {
    token: "opaque-random-token",
    expiresAt: "2026-07-23T02:10:00.000Z",
    requirementVersion: 3,
    draftVersion: 1,
    operationSnapshotFingerprint: "",
    directoryMatchFingerprint: "",
  },
  activeAttempt: null,
  sendHistory: [],
  changeSummary: "",
  events: [],
}
```

`preview` 顺序固定为：权限 → 最新 task → requirement center 待审核变更 → 生成草稿 → 取得 profile 锁 → 只读运控 → conflict/目录校验 → 短暂取得 task 锁 → 再读 task → 持久化 preview。用户修改人数、比例或日期时，递增 `draftVersion` 并追加：

```js
{
  type: "operation_personnel_draft_auto_confirmed",
  actor: actor.email,
  changes: [{ path: "dates.end", before: "", after: "2026-08-19" }],
  createdAt: now,
}
```

不保存完整目录，只保存本次 To/CC 精确匹配。

`environment` 只从 service dependency 读取；构造 service 时若不是 `test` 或 `production`，`get` 返回阻断状态，`preview` 返回 `PERSONNEL_ENVIRONMENT_INVALID`。请求体中的同名字段必须忽略，测试需证明不能用请求把测试环境切为正式环境。

- [ ] **Step 3: 写失败测试覆盖待审核变更、权限、异步返回和 checkpoint**

```js
test("pending external requirement change blocks preview", async () => {
  const harness = serviceHarness({
    requirement: { changeRequests: [{ status: "pending_internal_review" }] },
  });
  await assert.rejects(
    harness.service.preview("task-a", owner(), {}),
    { code: "PERSONNEL_PENDING_REQUIREMENT_CHANGE", status: 409 },
  );
});

test("send persists queued attempt and returns before the runner completes", async () => {
  const deferred = Promise.withResolvers();
  const harness = serviceHarness({ runnerResult: deferred.promise });
  const preview = await harness.service.preview("task-a", owner(), {});
  const accepted = await harness.service.send("task-a", owner(), {
    previewToken: preview.previewToken,
    draftVersion: preview.draftVersion,
    changeSummary: "",
  });
  assert.equal(accepted.statusCode, 202);
  assert.equal(harness.task.config.operationPersonnelTask.activeAttempt.status, "queued");
  deferred.resolve(successfulAttemptResult());
});

test("resend requires a non-empty reviewed change summary", async () => {
  const harness = serviceHarness({ changedAfterSend: true });
  const preview = await harness.service.preview("task-a", owner(), {});
  await assert.rejects(
    harness.service.send("task-a", owner(), {
      previewToken: preview.previewToken,
      draftVersion: preview.draftVersion,
      changeSummary: " ",
    }),
    { code: "PERSONNEL_CHANGE_SUMMARY_REQUIRED", status: 400 },
  );
});

test("preview token is consumed once and double submit cannot create two attempts", async () => {
  const harness = serviceHarness();
  const preview = await harness.service.preview("task-a", owner(), {});
  const payload = {
    previewToken: preview.previewToken,
    draftVersion: preview.draftVersion,
    changeSummary: "",
  };
  const first = await harness.service.send("task-a", owner(), payload);
  assert.equal(first.statusCode, 202);
  await assert.rejects(
    harness.service.send("task-a", owner(), payload),
    { code: "PERSONNEL_ATTEMPT_IN_PROGRESS", status: 409 },
  );
  assert.equal(harness.runnerCalls.filter((item) => item === "attempt").length, 1);
});
```

- [ ] **Step 4: 实现异步 attempt、checkpoint 持久化和成功写入**

`send` 在项目锁内重新读取并验证 token、环境、版本、指纹和变化摘要。若已有 queued/running attempt 则返回 `PERSONNEL_ATTEMPT_IN_PROGRESS`。保存 `queued` attempt 的同一次配置写入必须清除 `activePreview`，使 token 一次性消费；随后返回 `{ statusCode: 202, attemptId }`，再通过注入的 `defer` 启动后台流程。后台流程取得共享 profile 锁；每个 checkpoint 回调短暂取得项目锁、重读 task、合并当前 checkpoint 并追加事件。

成功时原子保存：

```js
{
  status: "sent",
  lastSuccessfulFingerprint: attempt.fingerprint,
  lastOperationSnapshot: result.operationSnapshot,
  activeAttempt: { ...attempt, status: "sent", completedAt: result.completedAt },
  sendHistory: [...history, {
    attemptId: attempt.attemptId,
    kind: attempt.kind,
    operator: attempt.operator,
    environment: attempt.environment,
    requirementVersion: attempt.requirementVersion,
    draftVersion: attempt.draftVersion,
    fingerprint: attempt.fingerprint,
    recipients: attempt.recipients,
    operationRecord: result.sendRecord,
    operationSnapshot: result.operationSnapshot,
    changeSummary: attempt.changeSummary,
    createdAt: attempt.createdAt,
    completedAt: result.completedAt,
  }],
}
```

失败前若 `submit_send` 未完成，状态为 `failed_resumable`；最终发送已点击但没有记录时固定为 `result_unknown`。

- [ ] **Step 5: 写失败测试覆盖重启恢复和只读 recheck**

```js
test("restart recovery distinguishes pre-send failure from unknown send result", async () => {
  const beforeSend = serviceHarness({ orphanedAttemptCheckpoint: "sync_personnel_dates" });
  assert.equal((await beforeSend.service.get("task-a", owner())).state.status, "failed_resumable");

  const afterSend = serviceHarness({ orphanedAttemptCheckpoint: "verify_send_record" });
  assert.equal((await afterSend.service.get("task-a", owner())).state.status, "result_unknown");
});

test("recheck only runs for result_unknown and never invokes send", async () => {
  const harness = serviceHarness({ resultUnknown: true });
  await harness.service.recheck("task-a", owner());
  assert.deepEqual(harness.runnerCalls, ["recheck"]);
});

test("recheck reconciles a newly visible record without another send", async () => {
  const harness = serviceHarness({
    resultUnknown: true,
    recheckResult: {
      sendRecord: { type: "首次发送", sentAt: "2026-07-23T02:00:20.000Z" },
      operationSnapshot: { batch: { published: true } },
    },
  });
  const result = await harness.service.recheck("task-a", owner());
  assert.equal(result.state.status, "sent");
  assert.equal(result.state.sendHistory.length, 1);
  assert.deepEqual(harness.runnerCalls, ["recheck"]);
});
```

若 recheck 找到符合原 attempt 开始时间和发送类型的新记录，service 使用原 attempt 的 fingerprint、收件人和变化摘要补齐同一条 send history 并转为 `sent`；未找到则保持 `result_unknown`。不得创建新 attempt ID。

- [ ] **Step 6: 运行 service 测试确认 GREEN**

Run: `node --test server/test_operation_personnel_task_service.mjs`

Expected: 状态机、权限、令牌、幂等、checkpoint、恢复和审计全部通过。

- [ ] **Step 7: 提交协调服务**

```bash
git add server/operation_personnel_task_service.mjs server/test_operation_personnel_task_service.mjs
git commit -m "feat: coordinate personnel task attempts"
```

### Task 5: 五个 API 与真实状态仓库接线

**Files:**
- Modify: `server/easy_exam_server.mjs`
- Create: `server/test_operation_personnel_task_routes.mjs`
- Modify: `server/test_server_config.mjs`
- Modify: `server/pr5_protected_workflows.mjs`
- Modify: `server/test_pr5_protected_workflows.mjs`

**Interfaces:**
- Produces: `GET /api/tasks/:taskId/operation-personnel-task`。
- Produces: `POST /api/tasks/:taskId/operation-personnel-task/preview`。
- Produces: `POST /api/tasks/:taskId/operation-personnel-task/send`。
- Produces: `GET /api/tasks/:taskId/operation-personnel-task/attempts/:attemptId`。
- Produces: `POST /api/tasks/:taskId/operation-personnel-task/recheck`。

- [ ] **Step 1: 写失败的真实服务器路由测试**

复用 `server/test_operation_batch_routes.mjs` 的内核分配端口和临时 SQLite 模式，创建 `server/test_operation_personnel_task_routes.mjs`：

```js
test("personnel task state is owner-visible and preview blocks when automation is disabled", async () => {
  const runtime = await startPersonnelRouteServer({
    task: visiblePersonnelTask(),
    env: {
      OPERATION_CONSOLE_AUTOMATION_ENABLED: "0",
      OPERATION_CONSOLE_ENVIRONMENT: "test",
    },
  });
  try {
    const state = await fetch(`${runtime.baseUrl}/api/tasks/task-a/operation-personnel-task`);
    assert.equal(state.status, 200);

    const preview = await fetch(`${runtime.baseUrl}/api/tasks/task-a/operation-personnel-task/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(preview.status, 409);
    assert.match((await preview.json()).error, /浏览器自动化未启用/);
  } finally {
    await runtime.close();
  }
});
```

再覆盖未知环境 409、请求体伪造 `environment: "production"` 仍使用 test、不可见项目 404、过期 token 409、合法 send 返回 202、attempt ID 不属于项目时 404。

- [ ] **Step 2: 运行 route 测试确认 RED**

Run: `node --test server/test_operation_personnel_task_routes.mjs`

Expected: 五个路由均为 404。

- [ ] **Step 3: 注入服务和统一错误响应**

在 `easy_exam_server.mjs` 创建一次 service：

```js
const operationPersonnelTaskActiveAttempts = new Set();
const operationPersonnelTaskService = createOperationPersonnelTaskService({
  readTask: (taskId) => runTaskState("get", { taskId }),
  updateTaskConfig: (taskId, config) => runTaskState("update_config", { taskId, config }),
  readRequirement: (requestId) => requestId ? runRequirementState("get", { requestId }) : null,
  coordinator: operationBatchCoordinator,
  activeAttemptIds: operationPersonnelTaskActiveAttempts,
  runInspection: runOperationPersonnelInspection,
  runAttempt: runOperationPersonnelAttempt,
  runRecheck: runOperationPersonnelRecheck,
  environment: process.env.OPERATION_CONSOLE_ENVIRONMENT || "",
});
```

handler 通过 `visibleByOwner` 取得 actor；auth 未启用时 actor 视为管理员。领域/服务错误保留稳定 `status` 和 `code`：

```js
function operationPersonnelError(res, error) {
  return json(res, Number(error?.status || 500), {
    error: error instanceof Error ? error.message : String(error),
    ...(error?.code ? { errorCode: error.code } : {}),
  });
}
```

`send` 必须返回 HTTP 202。attempt GET 只返回当前 checkpoint、verification phase、服务器基于 `deadlineAt - Date.now()` 计算的 `remainingSeconds`、完成状态和错误，不向前端暴露完整运控快照。

- [ ] **Step 4: 接入精确路由并更新受保护路由清单**

路由顺序放在既有 operation-batch 路由之后、content email 之前。使用精确正则，不增加宽泛 catch-all：

```js
const personnelStateMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-personnel-task$/);
const personnelPreviewMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-personnel-task\/preview$/);
const personnelSendMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-personnel-task\/send$/);
const personnelAttemptMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-personnel-task\/attempts\/([^/]+)$/);
const personnelRecheckMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/operation-personnel-task\/recheck$/);
```

在 `pr5_protected_workflows.mjs` 只加入这五个精确路径，保留其它受保护流程的哈希/边界检查。

- [ ] **Step 5: 运行服务器 focused 测试确认 GREEN**

Run: `node --test server/test_operation_personnel_task_routes.mjs server/test_server_config.mjs server/test_pr5_protected_workflows.mjs`

Expected: 全部通过，退出码 0。

- [ ] **Step 6: 提交 API 接线**

```bash
git add server/easy_exam_server.mjs server/test_operation_personnel_task_routes.mjs server/test_server_config.mjs server/pr5_protected_workflows.mjs server/test_pr5_protected_workflows.mjs
git commit -m "feat: expose personnel task send APIs"
```

### Task 6: 项目详情统一确认、进度与倒计时

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Modify: `server/test_ui_views.mjs`

**Interfaces:**
- Consumes: Task 5 的五个 API。
- Produces DOM IDs: `operationPersonnelTaskState`、`operationPersonnelTaskActionBtn`、`operationPersonnelTaskRecheckBtn`、`operationPersonnelConfirmDialog`、`operationPersonnelProgress`。
- Guarantees: 当前项目切换后旧异步响应不得覆盖新项目。

- [ ] **Step 1: 写失败 UI 结构测试**

在 `server/test_ui_views.mjs` 增加：

```js
test("personnel operation panel exposes one confirmation and recovery controls", () => {
  assert.ok(html.includes('id="operationPersonnelTaskActionBtn"'));
  assert.ok(html.includes('id="operationPersonnelTaskRecheckBtn"'));
  assert.ok(html.includes('id="operationPersonnelConfirmDialog"'));
  assert.ok(html.includes('id="operationPersonnelProgress"'));
  assert.equal(html.includes("人员任务接口待接入"), false);
});
```

并编译内联 helper 测试：

```js
assert.equal(operationPersonnelActionLabel({ status: "sent", canResend: false }), "内容未变化，不允许重复发送");
assert.equal(operationPersonnelActionLabel({ status: "changes_pending" }), "检查变更并重新发送");
assert.equal(operationPersonnelRemainingSeconds("2026-07-23T02:00:30.000Z", Date.parse("2026-07-23T02:00:05.100Z")), 25);
```

- [ ] **Step 2: 运行 UI 测试确认 RED**

Run: `node --test server/test_ui_views.mjs`

Expected: 人员按钮、dialog、倒计时 helper 不存在。

- [ ] **Step 3: 替换禁用占位并实现人员状态卡**

人员面板保留现有 `projectPersonnelTaskDraft`，增加：

```html
<div id="operationPersonnelTaskState" class="task-meta">正在读取人员任务状态。</div>
<div class="view-actions">
  <button class="btn primary" id="operationPersonnelTaskActionBtn" type="button">检查并发送人员任务单</button>
  <button class="btn" id="operationPersonnelTaskRecheckBtn" type="button" hidden>重新核对发送记录</button>
</div>
```

状态卡显示版本、上次成功时间、变更、阻断原因和当前 checkpoint。`sent + fingerprint unchanged` 时主按钮禁用并显示“内容未变化，不允许重复发送”。`result_unknown` 只显示 recheck。

- [ ] **Step 4: 实现一个统一确认窗口**

dialog 固定包含：

- 环境、项目、批次、需求版本。
- 阻断项和发送条件。
- `willPublishBatch` 提示。
- 运控修改前后 diff。
- 完整日程表。
- 人员日期、人数、比例、计算依据；只允许编辑规格批准的字段。
- 固定 To/CC 实际匹配；全部只读。
- 重发变化摘要 textarea；首次发送隐藏。
- 唯一按钮“确认配置并发送任务单”。

环境从 API 状态中读取并只读展示，页面没有环境切换控件。字段改变后重新调用 preview，禁止在前端自行计算新 token。提交只发送服务端返回的 `previewToken`、`draftVersion` 和变化摘要。

- [ ] **Step 5: 实现 attempt polling、进度和可见倒计时**

在 `taskViewState` 增加：

```js
operationPersonnelRequestToken: 0,
operationPersonnelAttemptId: "",
operationPersonnelPollTimer: null,
```

每次项目切换递增 request token 并清理 timer。所有 response 在渲染前同时检查 `taskId` 和 token。polling 使用服务端 `remainingSeconds`，页面显示：

```text
正在等待运控发送记录（第一阶段），剩余 24 秒
正在重新进入任务单核对发送记录（第二阶段），剩余 17 秒
```

完成后刷新人员状态和整个 workflow；`failed_resumable` 显示“继续未完成流程”；`result_unknown` 只开放“重新核对发送记录”。

- [ ] **Step 6: 写行为测试覆盖项目切换和重复发送禁用**

使用现有 `compileInlineFunction` 模式验证：

```js
test("stale personnel attempt response cannot render into a newly selected project", async () => {
  const first = Promise.withResolvers();
  const harness = personnelUiHarness({ fetchAttempt: () => first.promise });
  harness.state.currentProjectId = "project-a";
  const pending = harness.poll("project-a", "attempt-a");
  harness.state.currentProjectId = "project-b";
  first.resolve({ status: "sent" });
  await pending;
  assert.deepEqual(harness.renders, []);
});
```

再断言相同指纹的 `sent` 状态禁用 action button，recheck 不会调用 send API，正式收件人字段没有可编辑 input。

- [ ] **Step 7: 运行 UI 与工作流测试确认 GREEN**

Run: `node --test server/test_ui_views.mjs server/test_project_workflow.mjs`

Expected: 全部通过，退出码 0。

- [ ] **Step 8: 提交 UI**

```bash
git add outputs/web_prototype/easy_exam_automation.html server/test_ui_views.mjs
git commit -m "feat: add personnel task confirmation UI"
```

### Task 7: 全量回归、8765 同步和测试运控首次发送

**Files:**
- Create: `docs/operation-personnel-task-test-evidence.md`
- Runtime synchronization only after automated tests pass.

**Interfaces:**
- Consumes: 完整领域、runner、service、API 和 UI。
- Produces: 自动测试证据、8765 健康证据、测试环境首次发送记录。

- [ ] **Step 1: 运行全部 Node 自动测试**

Run:

```bash
for f in server/test_*.mjs; do
  [ "$f" = "server/test_exam_time_only.mjs" ] && continue
  printf '%s\n' "$f"
done | xargs /Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test
```

Expected: 退出码 0，汇总 `fail 0`。记录实际 tests/pass 数，不预填数量。

- [ ] **Step 2: 运行全部 Python 自动测试**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest discover -s server -p 'test_*.py'
```

Expected: 退出码 0，汇总 `OK`。记录实际测试数。

- [ ] **Step 3: 检查差异和敏感数据边界**

Run:

```bash
git diff --check
git status --short
rg -n "唐润梅|张乐翔|结算组|拓展二部|演示组" server outputs/web_prototype/easy_exam_automation.html
rg -n "password|cookie|authorization|完整人员目录" server/operation_personnel_task*.mjs
```

Expected:

- `git diff --check` 无输出。
- 固定人员仅出现在环境规则、UI 只读显示和测试中。
- 人员状态不持久化密码、cookie、authorization 或完整目录。

- [ ] **Step 4: 原子同步并重启 8765 管理运行时**

先记录持久数据和配置的 inode/hash，再运行项目既有同步脚本：

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/sync_local_runtime.mjs
curl -sS --max-time 10 http://127.0.0.1:8765/api/health
curl -sS --max-time 10 http://127.0.0.1:8765/api/operation-console/environment
```

Expected:

- 同步脚本退出码 0 且自带 health check 成功。
- `/api/health` 精确返回健康 JSON。
- 运控环境 `ready=true`。
- `.env`、SQLite、邮件设置、`node_modules` 和运控 profile 的 inode/hash 与同步前一致。
- 源码关键文件与 Application Support 运行时副本内容一致。

- [ ] **Step 5: 在测试运控执行一次首次发送**

只选择明确标记为测试的项目，并在统一确认中核对：

- 环境为 test。
- To 为“演示组 / 张乐翔”。
- CC 为空。
- 若批次未发布，确认窗口明确显示本次将发布。
- 日程、日期、监考人数、比例、平台和登录监控均与测试项目一致。

用户在最终统一确认后允许真实发送。记录 attempt ID、开始时间、checkpoint 完成情况和右上角“首次发送”记录时间。不得把录屏中的历史示例时间当作本次证据。

- [ ] **Step 6: 验证同内容不能重发**

刷新页面和服务端状态，确认：

- 主按钮显示“内容未变化，不允许重复发送”并禁用。
- 直接调用 send API 返回 409 `PERSONNEL_CONTENT_UNCHANGED`。
- 运控发送记录没有新增。

- [ ] **Step 7: 写入测试证据并提交**

`docs/operation-personnel-task-test-evidence.md` 只记录工具实际输出：

```markdown
# 运控人员任务单测试证据

## 自动测试

- Node：命令、退出码、tests/pass/fail。
- Python：命令、退出码、Ran/OK。

## 8765 运行时

- 同步时间与脚本退出码。
- `/api/health` 原始响应。
- `/api/operation-console/environment` 原始响应。
- 持久文件保护检查。

## 测试运控首次发送

- 项目和批次代码。
- attempt ID 与开始时间。
- 实际 To/CC 匹配。
- 运控发送记录类型与时间。
- 同内容重发阻断结果。
```

Run:

```bash
git add docs/operation-personnel-task-test-evidence.md
git commit -m "test: record personnel task initial send"
```

### Task 8: 已确认需求变更、运控同步和重发验收

**Files:**
- Modify: `docs/operation-personnel-task-test-evidence.md`

**Interfaces:**
- Consumes: 测试运控首次发送成功状态和一条已确认、影响任务单的需求变更。
- Produces: 新指纹、自动变化摘要、运控精确修改和新的重发记录证据。

- [ ] **Step 1: 在测试项目创建一条可逆的已确认需求变化**

只修改一个能从配置平台和运控清晰核对的人员任务字段，例如人员名单提交日期。该修改通过现有平台人工编辑入口保存，必须产生 `reviewStatus: "auto_confirmed"` 的版本审计。不得直接改 SQLite。

- [ ] **Step 2: 生成重发预览并核对变化摘要**

Expected:

- 状态为 `changes_pending`。
- 新指纹不同于 `lastSuccessfulFingerprint`。
- 运控当前快照仍等于上次成功快照。
- 自动摘要明确列出字段 before/after。
- 用户可补充摘要，但清空后服务端拒绝重发。
- 统一确认中显示运控将修改的同一字段。

- [ ] **Step 3: 确认后同步运控并重发**

使用测试收件规则“演示组 / 张乐翔”，无抄送。确认后检查相应配置 checkpoint 回读为新值；最终发送只能点击一次。

- [ ] **Step 4: 验证新的重发记录**

成功标准：

- 运控右上角出现类型为重发/再次发送的记录。
- 记录时间严格晚于本次 attempt 开始时间。
- `sendHistory` 新增一条且包含变化摘要和新指纹。
- 页面重新进入后仍显示成功状态。
- 再次点击时因内容未变化而被禁用。

- [ ] **Step 5: 验证外部冲突阻断后恢复**

在测试运控把同一可逆字段临时改为与平台不同：

- preview 返回 `operation_conflict`。
- 自动化不覆盖运控、不打开最终发送、不新增发送记录。
- 人工把两边改回一致后重新检查，冲突消失。

若该测试会影响其他真实使用者，跳过实际写入并在证据文档中记录“未执行及负责人”，不得把模拟测试当作真实验收。

- [ ] **Step 6: 更新证据、最终回归并提交**

把真实重发记录、冲突检查结果和未解决项写入证据文档，再运行 Task 7 Step 1–4 的完整自动测试与运行时同步。最后：

```bash
git add docs/operation-personnel-task-test-evidence.md
git commit -m "test: verify personnel task resend"
git status --short --branch
```

Expected: 自动测试退出码 0，8765 健康，工作树干净；所有未执行的真实环境检查都有明确原因、负责人和下一步。

## Completion Gate

在宣称完成前逐项核对：

1. 规格中的业务模型、固定收件规则、发布时机、指纹、重发摘要、冲突阻断和 unsupported 条件都有测试。
2. runner 的最终发送只点击一次，`result_unknown` 只读 recheck 有测试证据。
3. 五个 API 的权限、锁、预览过期、异步 attempt 和重启恢复有测试。
4. UI 统一确认、只读收件人、两段倒计时、项目切换隔离和重复发送禁用有测试。
5. Node、Python 全量测试通过。
6. 8765 已原子同步且持久数据、配置、依赖和 profile 未被替换。
7. 测试运控首次发送和变更重发均有真实右上角记录。
8. 正式环境没有进行自动发送测试。
9. 文档、git 提交和未解决事项与实际状态一致。
