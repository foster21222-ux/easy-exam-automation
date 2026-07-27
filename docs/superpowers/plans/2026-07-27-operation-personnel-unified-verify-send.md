# 人员任务统一校验并发送实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让人员任务确认页集中本地编辑，最终确认时统一重新校验并直接发送，同时只展示运控真实日程代码。

**Architecture:** 初次预览仍通过只读运控检查建立受信快照，并把运控日程代码映射成单独的只读展示 DTO。前端编辑不刷新预览；最终发送请求携带五个编辑值，服务端在任务锁内应用和验证这些值，再由既有运控执行器在一次受锁流程中重新校验并发送。

**Tech Stack:** Node.js、`node:test`、Playwright 可见浏览器执行器、单文件 HTML 配置台、macOS LaunchAgent。

## Global Constraints

- 没有完整且与易考需求一致的运控日程时，不得进入可发送确认状态。
- 日程代码只读取运控可见“日程代码”列，不使用需求单序号、数组索引或历史 `scheduleCodeMap`。
- 编辑五个字段时不得请求预览 API 或打开运控浏览器。
- 最终按钮一次完成确认、重新校验和运控内置发送，不增加第三次确认。
- 校验失败必须发生在不可逆 `submit_send` 检查点之前，并保留前端编辑值。
- 人员任务流程不得创建、修改或删除考试日程。
- 测试环境固定收件人为演练组张乐翔，抄送为空。
- 未经用户单独授权，不执行真实人员任务发送。

---

### Task 1: 建立运控日程代码只读展示 DTO

**Files:**
- Modify: `server/operation_personnel_task_runner.mjs`
- Modify: `server/operation_personnel_task_service.mjs`
- Test: `server/test_operation_personnel_task_runner.mjs`
- Test: `server/test_operation_personnel_task_service.mjs`

**Interfaces:**
- Consumes: `managedSchedules: Array<{requirementIndex,name,start,end}>` 和 `operationSchedules: Array<{scheduleCode,subjectName,start,end}>`。
- Produces: `operationPersonnelDisplaySchedules(managedSchedules, operationSchedules): Array<{scheduleCode,name,start,end}>`。
- Produces: `draft.displaySchedules`，仅供确认页展示，不进入需求单、受管日程或人员任务内容指纹。

- [ ] **Step 1: 写运控代码映射失败测试**

在 `server/test_operation_personnel_task_runner.mjs` 增加：

```js
test("display schedules use exact operation schedule codes", () => {
  assert.deepEqual(operationPersonnelDisplaySchedules(
    [{ requirementIndex: 0, name: "综合能力", start: "2026-08-22 09:00", end: "2026-08-22 11:00" }],
    [{ scheduleCode: 17, subjectName: "综合能力", start: "2026-08-22 09:00", end: "2026-08-22 11:00" }],
  ), [{
    scheduleCode: 17,
    name: "综合能力",
    start: "2026-08-22 09:00",
    end: "2026-08-22 11:00",
  }]);
});

test("display schedules reject missing duplicate or unmatched operation codes", () => {
  const managed = [{ requirementIndex: 0, name: "综合能力", start: "2026-08-22 09:00", end: "2026-08-22 11:00" }];
  assert.throws(() => operationPersonnelDisplaySchedules(managed, []), /日程/);
  assert.throws(() => operationPersonnelDisplaySchedules(managed, [
    { scheduleCode: 17, subjectName: "综合能力", start: "2026-08-22 09:00", end: "2026-08-22 11:00" },
    { scheduleCode: 17, subjectName: "综合能力", start: "2026-08-22 09:00", end: "2026-08-22 11:00" },
  ]), /重复/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_personnel_task_runner.mjs
```

Expected: FAIL，因为 `operationPersonnelDisplaySchedules` 尚未导出。

- [ ] **Step 3: 最小实现精确映射**

在 `server/operation_personnel_task_runner.mjs` 增加纯函数：

```js
export function operationPersonnelDisplaySchedules(managedSchedules = [], operationSchedules = []) {
  const actual = operationSchedules.map(normalizeSchedule);
  assertScheduleCodes(actual);
  return managedSchedules.map((managed) => {
    const matches = actual.filter((schedule) => (
      text(schedule.subjectName) === text(managed.name)
      && text(schedule.start) === text(managed.start)
      && text(schedule.end) === text(managed.end)
    ));
    if (matches.length !== 1) {
      throw batchScheduleConflict("运控日程代码缺失、重复或不能与易考需求一一对应");
    }
    return {
      scheduleCode: matches[0].scheduleCode,
      name: managed.name,
      start: managed.start,
      end: managed.end,
    };
  });
}
```

不得使用 `requirementIndex` 或 `scheduleCodeMap` 补值。

- [ ] **Step 4: 让未发布预览也读取日程**

修改 `inspectOperationPersonnelTask` 的未发布分支，在返回前读取可见日程：

```js
if (instruction.allowUnpublishedPreview === true && batch.published !== true) {
  const schedules = await read("readSchedules", "schedules", []);
  return normalizeOperationPersonnelSnapshot({
    batch,
    schedules,
    personnel: {},
    dates: {},
    requirements: [],
    taskSheet: {},
    sendRecords: [],
    directoryMatch: { to: [], cc: [] },
  });
}
```

若运控没有日程或代码，规范化和映射必须阻断预览。

- [ ] **Step 5: 服务预览写入只读 DTO**

在 `server/operation_personnel_task_service.mjs` 中，预览获得 `snapshot` 并通过批次门槛后写入：

```js
draft.displaySchedules = operationPersonnelDisplaySchedules(
  draft.managedSchedules,
  snapshot.schedules,
);
```

在 `operationPersonnelTaskFingerprint` 和受管日程指纹中继续忽略 `displaySchedules`。

- [ ] **Step 6: 增加服务回归测试**

在 `server/test_operation_personnel_task_service.mjs` 断言：

```js
assert.deepEqual(preview.state.draft.displaySchedules, [{
  scheduleCode: 17,
  name: "湖北邮政招聘考试",
  start: "2026-08-22T09:00:00",
  end: "2026-08-22T11:00:00",
}]);
assert.equal(Object.hasOwn(preview.state.draft.displaySchedules[0], "requirementIndex"), false);
```

并新增缺失代码时 `preview` 返回 `409`、执行器未进入发送的测试。

- [ ] **Step 7: 运行聚焦测试**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_personnel_task_runner.mjs server/test_operation_personnel_task_service.mjs
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add server/operation_personnel_task_runner.mjs server/operation_personnel_task_service.mjs server/test_operation_personnel_task_runner.mjs server/test_operation_personnel_task_service.mjs
git commit -m "feat: expose verified operation schedule codes"
```

---

### Task 2: 前端编辑改为纯本地状态

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Test: `server/test_ui_views.mjs`

**Interfaces:**
- Consumes: `draft.displaySchedules` 和现有五个 `data-operation-personnel-edit` 输入框。
- Produces: `operationPersonnelSendPayload(preview, changeSummary, edits)`，包含 `previewToken`、`draftVersion`、`changeSummary` 和 `edits`。

- [ ] **Step 1: 写“编辑不请求预览”失败测试**

在 `server/test_ui_views.mjs` 提取人员确认页 `change` 监听器并断言：

```js
assert.match(changeHandler, /collectOperationPersonnelPreviewEdits/);
assert.doesNotMatch(changeHandler, /refreshOperationPersonnelPreviewFromDialog|previewOperationPersonnelTask|fetchJson/);
assert.match(changeHandler, /内容已修改，发送时将统一重新校验/);
```

同时断言旧函数 `refreshOperationPersonnelPreviewFromDialog` 不再存在。

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_ui_views.mjs
```

Expected: FAIL，因为当前 `change` 监听器会调用 `refreshOperationPersonnelPreviewFromDialog()`。

- [ ] **Step 3: 最小修改事件链**

删除 `refreshOperationPersonnelPreviewFromDialog`。把 `change` 监听器改为：

```js
operationPersonnelConfirmContent.addEventListener("change", (event) => {
  if (!event.target.closest("[data-operation-personnel-edit]")) return;
  operationPersonnelProgress.textContent = "内容已修改，发送时将统一重新校验";
});
```

不得调用后端、刷新预览或关闭确认页。

- [ ] **Step 4: 扩展最终发送载荷**

把载荷函数调整为：

```js
function operationPersonnelSendPayload(preview = {}, changeSummary = "", edits = {}) {
  return {
    previewToken: preview.previewToken,
    draftVersion: preview.draftVersion,
    changeSummary,
    edits,
  };
}
```

`sendOperationPersonnelTask` 使用：

```js
body: JSON.stringify(operationPersonnelSendPayload(
  preview,
  changeSummary,
  collectOperationPersonnelPreviewEdits(),
)),
```

- [ ] **Step 5: 修改按钮和失败恢复**

按钮文案改为“确认以上内容并校验发送”。点击后提示“正在统一校验运控并发送人员任务单...”。

发送请求失败时：

```js
operationPersonnelConfirmSendBtn.disabled = false;
operationPersonnelProgress.textContent = error.message;
```

不得重新渲染确认内容，以保留用户输入。

- [ ] **Step 6: 日程表只使用真实代码**

确认页表格改为：

```js
const scheduleRows = (draft.displaySchedules || []).map((item) => (
  `<tr><td>${safeText(item.scheduleCode)}</td><td>${safeText(item.name)}</td>`
  + `<td>${safeText(item.start)}</td><td>${safeText(item.end)}</td></tr>`
)).join("");
```

表头改为“日程代码”。不存在 `displaySchedules` 时显示阻断信息，不允许回退到 `requirementIndex`、数组索引或 `scheduleCodeMap`。

- [ ] **Step 7: 增加 UI 载荷和展示断言**

在 `server/test_ui_views.mjs` 断言：

```js
assert.match(rendered, /<th>日程代码<\/th>/);
assert.match(rendered, />17<\/td>/);
assert.doesNotMatch(rendered, /日程序号|requirementIndex|scheduleCodeMap/);
assert.deepEqual(operationPersonnelSendPayload(preview, "日期变化", edits), {
  previewToken: "token-a",
  draftVersion: 7,
  changeSummary: "日期变化",
  edits,
});
```

- [ ] **Step 8: 运行 UI 测试**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_ui_views.mjs
```

Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add outputs/web_prototype/easy_exam_automation.html server/test_ui_views.mjs
git commit -m "feat: keep personnel confirmation edits local"
```

---

### Task 3: 发送时在任务锁内应用最终编辑值

**Files:**
- Modify: `server/operation_personnel_task_service.mjs`
- Test: `server/test_operation_personnel_task_service.mjs`
- Test: `server/test_operation_personnel_task_routes.mjs`

**Interfaces:**
- Consumes: `input.edits = {dates:{start,end,nameListDue},personnel:{monitorCount,monitorRatio}}`。
- Produces: 持久化的最终 `state.draft`、递增后的 `draftVersion` 和绑定最终值的 queued attempt。

- [ ] **Step 1: 写发送时应用编辑的失败测试**

在 `server/test_operation_personnel_task_service.mjs`：

```js
test("send applies final edits once inside the task lock", async () => {
  const preview = await harness.service.preview("task-a", ADMIN);
  const queued = await harness.service.send("task-a", ADMIN, {
    previewToken: preview.previewToken,
    draftVersion: preview.draftVersion,
    changeSummary: "",
    edits: {
      dates: {
        start: "2026-07-28",
        end: "2026-08-19",
        nameListDue: "2026-08-19",
      },
      personnel: { monitorCount: "80", monitorRatio: "1:50" },
    },
  });
  assert.equal(queued.state.activeAttempt.target.dates.start, "2026-07-28");
  assert.equal(queued.state.activeAttempt.target.personnel.monitorCount, 80);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_personnel_task_service.mjs
```

Expected: FAIL，因为 `send` 当前忽略 `input.edits`。

- [ ] **Step 3: 在锁内生成最终草稿**

预览令牌验证通过后调用既有 `editableDraft`：

```js
const edited = editableDraft(state.draft, input.edits || {});
const finalDraft = edited.draft;
if (finalDraft.warnings.length) {
  throw serviceError(
    "PERSONNEL_DRAFT_INCOMPLETE",
    409,
    "人员任务字段无效，请检查日期、监考人数和监考比例",
  );
}
const finalDraftVersion = Number(state.draftVersion || 0) + (edited.changes.length ? 1 : 0);
```

后续指纹、目标、重发无变化判断、attempt 和持久化状态全部使用 `finalDraft`。

- [ ] **Step 4: 保持预览绑定与源数据校验**

应用编辑前，继续用原 `state.draft` 校验：

- 预览令牌；
- 需求版本；
- 原始 `draftVersion`；
- `sourceFingerprint`；
- 运控快照；
- 受管日程指纹；
- 固定收件人。

应用编辑后：

```js
const currentFingerprint = operationPersonnelTaskFingerprint(finalDraft);
const target = targetFromDraft(finalDraft, finalDraft.previewOperationSnapshot || {});
```

Queued state 持久化：

```js
draft: finalDraft,
draftVersion: finalDraftVersion,
sourceFingerprint: draftSourceFingerprint(finalDraft),
activePreview: null,
activeAttempt: attempt,
```

- [ ] **Step 5: 增加无效值和竞态测试**

新增断言：

```js
await assert.rejects(sendWith({
  personnel: { monitorCount: "0", monitorRatio: "1:0" },
}), (error) => error.code === "PERSONNEL_DRAFT_INCOMPLETE");
assert.equal(harness.runAttempts.length, 0);
```

并覆盖：

- 编辑期间需求版本变化；
- 批次调整状态变化；
- 受管日程指纹变化；
- 日程代码映射变化；
- 收件人变化。

这些情况均不得创建 queued attempt。

- [ ] **Step 6: 路由接受 edits**

在 `server/test_operation_personnel_task_routes.mjs` 通过真实 HTTP 请求断言五个字段到达 service，且额外只读字段被忽略：

```js
body: JSON.stringify({
  previewToken,
  draftVersion,
  changeSummary: "",
  edits,
  schedules: [{ scheduleCode: "伪造值" }],
  recipients: [{ name: "伪造收件人" }],
})
```

最终 attempt 只能使用服务端读取的日程代码和固定收件人。

- [ ] **Step 7: 运行服务和路由测试**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_personnel_task_service.mjs server/test_operation_personnel_task_routes.mjs
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add server/operation_personnel_task_service.mjs server/test_operation_personnel_task_service.mjs server/test_operation_personnel_task_routes.mjs
git commit -m "feat: apply personnel edits during unified send"
```

---

### Task 4: 证明统一执行只校验一次并直接发送

**Files:**
- Modify: `server/operation_personnel_task_runner.mjs`
- Test: `server/test_operation_personnel_task_runner.mjs`
- Test: `server/test_operation_personnel_task_service.mjs`

**Interfaces:**
- Consumes: Task 3 生成的最终 `attempt.target` 和 `attempt.managedSchedules`。
- Produces: 一次 `runOperationPersonnelAttempt`，在同一浏览器锁内完成重新读取、必要修改、最终回读和 `confirmSend`。

- [ ] **Step 1: 增加统一执行测试**

在 runner 测试记录操作顺序：

```js
assert.deepEqual(events, [
  "read_batch",
  "verify_exam_schedules",
  "sync_personnel_config",
  "sync_personnel_dates",
  "verify_task_sheet",
  "resolve_recipients",
  "final_read_schedules",
  "final_read_recipients",
  "submit_send_running",
  "confirm_send",
]);
```

同时断言 `confirm_send` 仅出现一次。

- [ ] **Step 2: 增加失败不发送测试**

分别让最终日程和收件人回读漂移，断言：

```js
assert.equal(events.includes("submit_send_running"), false);
assert.equal(events.includes("confirm_send"), false);
assert.equal(result.state.status, "failed_resumable");
```

- [ ] **Step 3: 运行测试确认当前覆盖情况**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_personnel_task_runner.mjs server/test_operation_personnel_task_service.mjs
```

Expected: 新增顺序测试可能 FAIL；现有最终漂移测试应继续 PASS。

- [ ] **Step 4: 最小调整执行顺序**

若顺序测试失败，只调整既有 checkpoint 调用位置：

- 所有只读校验在 `submit_send` 之前；
- `submit_send:running` 紧邻 `confirmSend`；
- 不新增第二次 runner 调用；
- 不新增第三次前端确认；
- 不调用 `syncExamSchedules`、`findScheduleRows` 或 `deleteSchedule`。

- [ ] **Step 5: 运行聚焦测试**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_personnel_task_runner.mjs server/test_operation_personnel_task_service.mjs
```

Expected: PASS。

- [ ] **Step 6: 静态检查只读边界**

Run:

```bash
rg -n "syncExamSchedules|findScheduleRows|deleteSchedule" server/operation_personnel_task_runner.mjs server/operation_personnel_task_service.mjs
```

Expected: 仅允许未被人员发送路径调用的适配器定义；活动人员 attempt 流程无命中。

- [ ] **Step 7: 提交**

```bash
git add server/operation_personnel_task_runner.mjs server/test_operation_personnel_task_runner.mjs server/test_operation_personnel_task_service.mjs
git commit -m "test: prove unified personnel verification and send"
```

---

### Task 5: 全量验证、运行时同步与安全实机检查

**Files:**
- Modify: `docs/operation-personnel-task-test-evidence.md`
- Verify: `server/test_*.mjs`
- Verify: `server/test_*.py`
- Deploy: `/Users/ata/Library/Application Support/easy-exam-automation/app`

**Interfaces:**
- Consumes: Tasks 1–4 的已提交代码。
- Produces: 全量测试结果、运行时一致性证据和不触发真实发送的配置台验收记录。

- [ ] **Step 1: 运行相关 Node 测试**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  server/test_operation_personnel_task.mjs \
  server/test_operation_personnel_schedule_gate.mjs \
  server/test_operation_personnel_task_runner.mjs \
  server/test_operation_personnel_task_service.mjs \
  server/test_operation_personnel_task_routes.mjs \
  server/test_ui_views.mjs
```

Expected: PASS。

- [ ] **Step 2: 运行全量 Node 测试**

Run:

```bash
/bin/zsh -lc 'for f in server/test_*.mjs; do [ "$f" = "server/test_exam_time_only.mjs" ] && continue; printf "%s\n" "$f"; done | xargs /Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test'
```

Expected: 全部 PASS，失败数为 `0`。

- [ ] **Step 3: 运行全量 Python 测试**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest discover -s server -p 'test_*.py'
```

Expected: 全部 PASS。

- [ ] **Step 4: 检查差异与工作区**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` 无输出；除本任务证据文件外无未提交内容。

- [ ] **Step 5: 更新测试证据**

在 `docs/operation-personnel-task-test-evidence.md` 记录：

- Node 和 Python 测试数量、退出码；
- 五字段编辑未触发预览 API；
- 日程表展示真实运控代码；
- 校验失败没有进入 `submit_send`；
- 未执行真实发送。

- [ ] **Step 6: 部署运行时并重启**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/deploy_launchd_runtime.mjs
launchctl kickstart -k gui/$(id -u)/com.ata.easy-exam-service
curl -sS --max-time 5 http://127.0.0.1:8765/api/health
```

Expected: 部署返回 `"ok": true`；健康接口返回 `{"ok":true}`。

- [ ] **Step 7: 配置台安全实机检查**

在 `http://127.0.0.1:8765`：

1. 打开已有测试项目人员任务确认页；
2. 验证表头为“日程代码”且值来自运控；
3. 修改多个字段，确认浏览器不重复打开、页面不关闭；
4. 不点击“确认以上内容并校验发送”，避免真实发送。

- [ ] **Step 8: 比对源码与运行时**

Run:

```bash
shasum -a 256 \
  server/operation_personnel_task_service.mjs \
  "/Users/ata/Library/Application Support/easy-exam-automation/app/server/operation_personnel_task_service.mjs" \
  server/operation_personnel_task_runner.mjs \
  "/Users/ata/Library/Application Support/easy-exam-automation/app/server/operation_personnel_task_runner.mjs" \
  outputs/web_prototype/easy_exam_automation.html \
  "/Users/ata/Library/Application Support/easy-exam-automation/app/outputs/web_prototype/easy_exam_automation.html"
```

Expected: 每对文件 SHA-256 相同。

- [ ] **Step 9: 提交证据**

```bash
git add docs/operation-personnel-task-test-evidence.md
git commit -m "docs: verify unified personnel send flow"
```
