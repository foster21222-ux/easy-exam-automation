# 运控人员任务单测试环境重发接管实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Do not click the operation-console final send action until the user gives an immediate confirmation for the rendered combined confirmation.

**Goal:** 在服务端测试环境中忽略不可修改的项目编码、项目名称差异，从运控可见页面接管既有首次发送记录，并在真实内容发生变化且变化摘要已确认时，安全执行运控内置“再次发送”流程。

**Architecture:** 保留批次详情页作为批次代码和身份校验源，新增对真实“分散在线监考”任务列表与任务单弹窗的可见 DOM 读取。服务先只读任务单生成真实差异与建议摘要，再以该摘要打开内置邮件流程核对人员目录；只有两次快照一致才签发最终预览令牌。外部首次发送只作为预览基线，不伪造本地成功指纹；新的“再次发送”记录出现后才写入现有成功状态。

**Tech Stack:** Node.js ESM、`node:test`、Playwright 1.54、原生 HTTP 服务、单文件 HTML/CSS/JavaScript、Application Support 运行时。

## 已验证的当前页面事实

- 测试批次代码：`EZT260004`。
- 批次名称：`中国邮政集团公司湖北省分公司招聘考试_2026年8月`。
- 批次详情当前为“已发布”。
- 运控任务列表入口：`/job/decentralizedInvigilate`。
- 列表筛选框：`请输入批次代码、批次名称、项目经理`。
- 主表表头：`批次名称 / 项目部归属 / 项目经理 / 首次发送时间 / 最近一次发送时间 / 操作`。
- 目标行已显示首次发送时间和最近一次发送时间：`2026-07-23 10:09:34`。
- 操作列使用右侧固定表，必须用主表精确批次名称确定行号，再映射到 `.ant-table-fixed-right` 的同一行。
- “发送任务单”打开“分散在线监考落实任务单”预览；预览中的实际日程表头为 `场次 / 日程代码 / 日程 / 时长(分钟) / 科目名称 / 考生提前登录(分钟)`。
- 发送记录表为无 `thead` 的两列表格，首行是 `发送时间 / 变更内容`，当前记录为 `2026-07-23 10:09:34 / 首次发送`。
- 预览内“发送任务单”打开两步内置邮件窗口；第一步输入框 placeholder 为 `请填写任务单变更内容`，按钮为“下一步”。
- 为避免伪造变化，本次只读探查未填写变更内容、未进入收件人步骤、未点击最终确定或发送。

## 全局约束

- 环境只能由服务端 `OPERATION_CONSOLE_ENVIRONMENT` 决定。
- 测试环境仅忽略 `projectCode` 和 `projectName`；批次代码、批次名称、项目部归属、项目经理、系统类型仍严格校验。
- 生产环境继续严格校验全部身份字段。
- 批次详情必须先按 `EZT260004` 精确定位；任务列表再按批次名称精确定位。二者任一不唯一都阻断。
- 外部基线接管必须存在至少一条可见发送记录，且完整任务单快照可读。
- 内容无变化时禁止重发；不得仅凭“存在发送记录”绕过此限制。
- 建议变化摘要必须来自运控基线与平台目标的真实结构化 diff；用户可编辑，但发送时不得为空。
- 目录核对必须通过运控内置邮件窗口的可见界面完成。
- 测试收件人必须精确为“演示组 / 张乐翔”，抄送为 0 人。
- 最终发送按钮只允许点击一次。发送记录两阶段核验失败后进入 `result_unknown`，不得自动重试。
- 本轮只验收重发。首次发送、未发布批次自动发布留待用户创建新测试项目后验收。

---

## Task 1：按服务端环境限定批次身份例外

**Files:**

- Modify: `server/operation_personnel_task_runner.mjs`
- Modify: `server/test_operation_personnel_task_runner.mjs`

### Step 1：先写失败测试

在现有批次身份测试旁增加三个用例：

```js
test("test inspection ignores only project code and project name mismatches", async () => {
  const snapshot = await inspectOperationPersonnelTask(
    {},
    {
      environment: "test",
      batch: {
        code: "EZT260004",
        projectCode: "F0012094",
        projectName: "平台项目",
        batchName: "目标批次",
      },
    },
    inspectionReaders({
      readBatch: async () => ({
        code: "EZT260004",
        projectCode: "4473-26",
        projectName: "测试运控项目",
        batchName: "目标批次",
      }),
    }),
  );
  assert.equal(snapshot.batch.code, "EZT260004");
});

test("test inspection still rejects a batch name mismatch", async () => {
  await assert.rejects(
    () => inspectOperationPersonnelTask(
      {},
      { environment: "test", batch: { code: "EZT260004", batchName: "目标批次" } },
      inspectionReaders({
        readBatch: async () => ({ code: "EZT260004", batchName: "其它批次" }),
      }),
    ),
    /批次详情身份不一致.*batchName/,
  );
});

test("production inspection rejects project identity mismatches", async () => {
  await assert.rejects(
    () => inspectOperationPersonnelTask(
      {},
      {
        environment: "production",
        batch: { code: "EZT260004", projectCode: "F0012094", projectName: "平台项目" },
      },
      inspectionReaders({
        readBatch: async () => ({
          code: "EZT260004",
          projectCode: "4473-26",
          projectName: "测试运控项目",
        }),
      }),
    ),
    /批次详情身份不一致.*projectCode.*projectName/,
  );
});
```

运行：

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_personnel_task_runner.mjs
```

预期：第一个用例先失败，证明测试例外尚未实现。

### Step 2：实现最小环境过滤

将身份校验改为显式接收环境，不读取请求体以外的可变全局：

```js
const TEST_IGNORED_BATCH_IDENTITY_FIELDS = new Set(["projectCode", "projectName"]);

function verifyBatchDetailIdentity(expected = {}, actual = {}, environment = "") {
  const conflicts = BATCH_IDENTITY_FIELDS
    .filter((key) => !(
      environment === "test"
      && TEST_IGNORED_BATCH_IDENTITY_FIELDS.has(key)
    ))
    .filter((key) => key === "code" || text(expected[key]))
    .filter((key) => text(expected[key]) !== text(actual[key]))
    .map((key) => `${key} 期望 ${text(expected[key]) || "空"}，实际 ${text(actual[key]) || "空"}`);
  if (conflicts.length) throw new Error(`批次详情身份不一致：${conflicts.join("；")}`);
}
```

调用处传入已经由服务端固定的 `instruction.environment`：

```js
verifyBatchDetailIdentity(
  { ...(instruction.batch || {}), code: batchCode },
  batch,
  text(instruction.environment),
);
```

### Step 3：验证并提交

运行专项测试和 `git diff --check`，再提交：

```bash
git add server/operation_personnel_task_runner.mjs server/test_operation_personnel_task_runner.mjs
git commit -m "fix: scope test operation identity exceptions"
```

---

## Task 2：读取真实任务列表与任务单快照

**Files:**

- Modify: `server/operation_personnel_task_runner.mjs`
- Modify: `server/test_operation_personnel_task_runner.mjs`

### Step 1：为纯解析器写失败测试

新增并导出纯函数：

```js
operationPersonnelTaskSheetFromVisibleRaw(raw)
```

测试输入使用已验证的真实表格结构，但替换项目名称等业务值：

```js
const raw = {
  conditions: [
    "【易考-考试日程】已设置",
    "【人员-在线监考】配置项已设置",
    "【人员落实时间】已设置且【人员落实时间】未结束",
    "【批次状态】为【已发布】",
  ],
  keyValueRows: [
    ["批次名称", "目标批次"],
    ["项目部归属", "项目实施五部"],
    ["项目经理", "经理"],
    ["系统类型", "易考"],
    ["人员落实开始日期", "2026-07-24"],
    ["人员落实结束日期", "2026-08-18"],
    ["人员落实平台", "悦站"],
    ["人员名单提交日期", "2026-08-19"],
    ["正式考试-最早登录系统时间", "考生可于考试开始前30分钟登录"],
    ["正式考试-监考人员安排", "ATA监考-分散"],
    ["正式考试-监考人员数量", "3"],
    ["正式考试-监考人员比例", "1:50"],
    ["正式考试-监考登录监控", "是"],
  ],
  scheduleHeaders: [
    "场次",
    "日程代码",
    "日程",
    "时长(分钟)",
    "科目名称",
    "考生提前登录(分钟)",
  ],
  scheduleRows: [["1", "1", "2026-08-22 13:30~15:30", "120", "目标考试", "30"]],
  sendRecordRows: [
    ["发送时间", "变更内容"],
    ["2026-07-23 10:09:34", "首次发送"],
  ],
};
```

断言解析结果包含：

- 4 个满足条件；
- 1 条稳定日程；
- 人员平台 `悦站`、人数 `3`、比例 `1:50`；
- 三个日期；
- 一条 `{ type: "首次发送", sentAt: "2026-07-23 10:09:34" }`；
- 任一表头缺失、重复任务行或重复发送记录区都抛出阻断错误。

### Step 2：实现真实入口的精确导航

新增以下内部帮助函数：

```js
openVisibleDistributedMonitoringTaskList(page, options)
findExactVisiblePersonnelTaskRow(page, batchName)
openVisiblePersonnelTaskSheet(page, batchName)
readVisiblePersonnelTaskSheet(page)
```

导航规则：

1. `page.goto(`${baseUrl}/job/decentralizedInvigilate`)`。
2. 等待 placeholder 为 `请输入批次代码、批次名称、项目经理` 的唯一输入框。
3. 输入完整批次名称并等待主表稳定。
4. 在表头含“批次名称”和“操作”的主表中精确匹配一行。
5. 取得该主表行号。
6. 在 `.ant-table-fixed-right table:visible tbody tr` 的同一行中精确匹配“发送任务单”。
7. 打开后要求唯一可见弹窗同时包含：
   - `分散在线监考落实任务单`；
   - `任务单发送需满足以下条件`；
   - 任务单日程表；
   - 发送记录区。

不得仅使用全页第一个“发送任务单”，也不得强制点击不可见的主表副本。

### Step 3：拆分批次身份和任务单读取

`inspectOperationPersonnelTask` 保持先从批次详情读取 `batch` 并校验身份，然后再打开真实任务列表读取：

- `schedules`
- `personnel`
- `dates`
- `requirements`
- `taskSheet`
- `sendRecords`

第一阶段不打开内置邮件目录，返回：

```js
{
  ...snapshot,
  directoryMatch: {},
  evidence: {
    ...snapshot.evidence,
    directoryMatch: { present: false, pending: true },
  },
}
```

只有 `instruction.directoryProbeSummary` 为非空时，才允许：

1. 点击任务单弹窗内唯一“发送任务单”；
2. 在 placeholder `请填写任务单变更内容` 中填写该真实摘要；
3. 点击唯一“下一步”；
4. 读取可见收件人目录；
5. 关闭内置邮件窗口，不点击最终“确定”。

目录读取后调用既有 `matchOperationPersonnelRecipients`，不得把完整目录持久化或返回。

### Step 4：验证并提交

运行：

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_personnel_task_runner.mjs
git diff --check
```

提交：

```bash
git add server/operation_personnel_task_runner.mjs server/test_operation_personnel_task_runner.mjs
git commit -m "fix: read visible personnel task sheets"
```

---

## Task 3：两阶段检查与外部首次发送基线

**Files:**

- Modify: `server/operation_personnel_task_service.mjs`
- Modify: `server/test_operation_personnel_task_service.mjs`

### Step 1：写服务状态机失败测试

扩展 `serviceHarness`，允许第一次检查返回无目录快照，第二次检查根据 `instruction.directoryProbeSummary` 返回精确目录。

新增测试：

1. 无本地成功指纹且 `sendRecords` 含“首次发送”时，最终预览的 `activePreview.kind === "resend"`。
2. 没有发送记录时仍为 `initial`。
3. 外部基线与目标完全一致时抛出 `PERSONNEL_CONTENT_UNCHANGED`，且第二阶段目录探查不运行。
4. 外部基线存在真实变化时，第二次检查收到由真实 diff 生成的非空 `directoryProbeSummary`。
5. 第二次检查的运控快照相对第一次漂移时抛出 `PERSONNEL_OPERATION_CONFLICT`。
6. `activePreview.baselineSnapshotFingerprint` 被修改时，`send` 抛出 `PERSONNEL_PREVIEW_STALE`。
7. 外部重发摘要为空时抛出 `PERSONNEL_CHANGE_SUMMARY_REQUIRED`。
8. 队列 attempt 的 `kind` 为 `resend`，`baseline` 为预览基线，而 `lastSuccessfulFingerprint` 在 runner 成功前仍为空。
9. runner 返回新的“再次发送”记录后，才写入 `lastSuccessfulFingerprint`、`lastOperationSnapshot` 和 `sendHistory`。

### Step 2：生成真实建议摘要

复用 `operationSnapshotChanges(before, after)`，新增最小格式化函数：

```js
function suggestedChangeSummary(changes = []) {
  return changes
    .map((item) => `${item.path}：${text(item.before) || "空"} → ${text(item.after) || "空"}`)
    .join("；");
}
```

摘要只来自第一次运控快照与平台目标的真实差异。若差异为空，立即阻断，不进行目录探查。

### Step 3：实现两阶段检查

第一阶段：

```js
const baselineSnapshot = normalizeOperationPersonnelSnapshot(
  await runInspection({
    environment,
    batch: draft.batch,
    batchCode: draft.batch.code,
  }),
);
const externalBaseline = !existing.lastSuccessfulFingerprint
  && baselineSnapshot.sendRecords.length > 0;
const kind = existing.lastSuccessfulFingerprint || externalBaseline
  ? "resend"
  : "initial";
```

基线选择：

```js
const baseline = existing.lastSuccessfulFingerprint
  ? normalizeOperationPersonnelSnapshot(existing.lastOperationSnapshot || {})
  : externalBaseline
    ? structuredClone(baselineSnapshot)
    : initialBaselineFrom(target, baselineSnapshot);
```

外部基线模式先计算 `operationSnapshotChanges(baseline, target)`。有变化后用生成摘要执行第二阶段：

```js
const fullSnapshot = normalizeOperationPersonnelSnapshot(
  await runInspection({
    environment,
    batch: draft.batch,
    batchCode: draft.batch.code,
    directoryProbeSummary: suggestedChangeSummary(operationChanges),
  }),
);
```

第二阶段必须：

- 与第一阶段的批次、日程、人员、日期、需求、任务单、发送记录完全一致；
- 只允许补充 `directoryMatch`；
- 精确匹配测试或生产收件规则。

### Step 4：绑定最小预览状态

持久化：

```js
draft.previewOperationSnapshot = structuredClone(fullSnapshot);
draft.previewBaselineSnapshot = structuredClone(baseline);

activePreview = {
  token,
  kind,
  externalBaseline,
  baselineSendRecord: externalBaseline
    ? structuredClone(baseline.sendRecords[0])
    : null,
  baselineSnapshotFingerprint: fingerprint(baseline),
  operationSnapshotFingerprint: fingerprint(fullSnapshot),
  directoryMatchFingerprint: fingerprint(fullSnapshot.directoryMatch),
  requirementVersion,
  draftVersion,
  expiresAt,
};
```

外部接管事件：

```js
{
  type: "operation_personnel_external_send_baseline_adopted",
  actor: text(actor?.email),
  sendRecord: structuredClone(activePreview.baselineSendRecord),
  createdAt,
}
```

不得设置 `lastSuccessfulFingerprint` 或追加 `sendHistory`。

### Step 5：发送时只信任预览模式与基线

将：

```js
const kind = state.lastSuccessfulFingerprint ? "resend" : "initial";
```

改为：

```js
const kind = preview.kind;
```

过期判定增加：

```js
preview.baselineSnapshotFingerprint
  !== fingerprint(state.draft.previewBaselineSnapshot || {})
```

attempt 基线固定为：

```js
const baseline = structuredClone(state.draft.previewBaselineSnapshot);
```

若 `kind === "resend"`：

- 目标与基线差异必须非空；
- `changeSummary` 必须非空；
- 不得依赖 `lastSuccessfulFingerprint` 判断重发。

### Step 6：验证并提交

运行：

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_personnel_task_service.mjs
git diff --check
```

提交：

```bash
git add server/operation_personnel_task_service.mjs server/test_operation_personnel_task_service.mjs
git commit -m "feat: adopt visible personnel resend baseline"
```

---

## Task 4：统一确认界面识别外部重发

**Files:**

- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Modify: `server/test_ui_views.mjs`

### Step 1：写失败测试

新增 UI 测试，预览状态仅有：

```js
state: {
  lastSuccessfulFingerprint: "",
  activePreview: {
    kind: "resend",
    externalBaseline: true,
    baselineSendRecord: {
      type: "首次发送",
      sentAt: "2026-07-23 10:09:34",
    },
  },
}
```

断言：

- 显示“再次发送”；
- 显示“外部首次发送基线”及可见记录时间；
- 显示变化摘要输入；
- 空摘要不能提交；
- 不显示“本次将发布运控批次”；
- 仍展示固定收件人、抄送人、全部变化和完整任务单内容。

### Step 2：改为使用预览 kind

新增帮助函数：

```js
function operationPersonnelPreviewKind(state = {}) {
  return state.activePreview?.kind
    || (state.lastSuccessfulFingerprint ? "resend" : "initial");
}
```

以下逻辑统一使用该函数：

- `isResend`
- `willPublishBatch`
- 变化摘要显隐
- `operationPersonnelSubmitError`
- 合并确认标题和说明

外部基线只增加一行可核对信息，不新增第二个确认窗口。

### Step 3：验证并提交

运行：

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_ui_views.mjs
git diff --check
```

提交：

```bash
git add outputs/web_prototype/easy_exam_automation.html server/test_ui_views.mjs
git commit -m "fix: render adopted personnel resends"
```

---

## Task 5：适配真实内置重发与发送记录核验

**Files:**

- Modify: `server/operation_personnel_task_runner.mjs`
- Modify: `server/test_operation_personnel_task_runner.mjs`

### Step 1：更新真实发送入口

`openTaskSheet` 复用 Task 2 的真实任务列表导航，不再查找不存在的“任务单”页签。

`selectRecipients` 按真实两步窗口执行：

1. 在任务单弹窗点击唯一“发送任务单”；
2. 在 placeholder `请填写任务单变更内容` 填入 `instruction.changeSummary`；
3. 点击唯一“下一步”；
4. 在第二步按环境规则选择 To 和 CC；
5. 回读已选人员，精确比对姓名和数量；
6. 停在最终确定前。

服务排队 attempt 时必须把 `changeSummary` 放入 runner instruction；请求中的环境、收件人或批次值不得直接驱动页面选择。

### Step 2：按真实发送记录表解析

`readVisibleTopRightSendRecords` 新增任务单弹窗解析：

- 找到唯一标题为“发送记录”的区块；
- 其第一行必须精确为 `发送时间 / 变更内容`；
- 后续每行解析为 `{ sentAt: 第一列, type: 第二列 }`；
- 允许类型为“首次发送”或“再次发送”；
- 时间、类型任一为空都阻断。

现有两阶段 30 秒核验保持不变：

1. 首次等待；
2. 关闭任务单；
3. 重新从 `/job/decentralizedInvigilate` 精确打开同一批次；
4. 第二次等待；
5. 仍无新记录则 `result_unknown`。

### Step 3：测试最终发送只点击一次

fake page 测试必须断言：

- `kind: "resend"` 时预期记录类型为“再次发送”；
- `confirmSend` 只被调用一次；
- 第一阶段无记录、第二阶段出现新记录时成功；
- 两阶段都无记录时不再次调用 `confirmSend`；
- 旧“首次发送”记录不能被误判为本次成功；
- 新记录时间必须晚于 attempt start。

### Step 4：验证并提交

运行：

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_personnel_task_runner.mjs
git diff --check
```

提交：

```bash
git add server/operation_personnel_task_runner.mjs server/test_operation_personnel_task_runner.mjs
git commit -m "fix: use visible operation personnel resend flow"
```

---

## Task 6：全量验证、运行时同步和只读实测

**Files:**

- Modify after evidence exists: `docs/operation-personnel-task-test-evidence.md`

### Step 1：自动测试

运行全部 Node 测试：

```bash
/bin/zsh -lc 'for f in server/test_*.mjs; do [ "$f" = "server/test_exam_time_only.mjs" ] && continue; printf "%s\n" "$f"; done | xargs /Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test'
```

运行 Python 测试：

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest discover -s server -p 'test_*.py'
```

再运行：

```bash
git diff --check
git status --short
```

必须记录测试总数、通过数、失败数和退出码，不得沿用旧的 904/904 或 54/54 数字。

### Step 2：从精确提交同步 Application Support

提交全部源代码后，从该提交的 `git archive` 构建运行时源，使用项目既有部署脚本同步到：

- 代码：`/Users/ata/Library/Application Support/easy-exam-automation/app`
- 数据：`/Users/ata/Library/Application Support/easy-exam-automation/runtime`

保持现有 `.env` 和 `OPERATION_CONSOLE_ENVIRONMENT=test`，不得迁移或覆盖运行数据。

重启 8765 后验证：

```bash
curl -sS --max-time 5 http://127.0.0.1:8765/api/health
```

并对本次修改文件逐一比较源提交与运行时 SHA-256。

### Step 3：当前批次只读预览

对任务 `ff4a7062-2c29-4e31-97e8-de39b0bb79f2` 执行“检查”：

- 允许项目编码 `F0012094` 对 `4473-26`；
- 允许项目名称不一致；
- 批次代码、批次名称、项目部归属、项目经理、系统类型必须一致；
- 读取现有“首次发送 / 2026-07-23 10:09:34”；
- 预览标记为外部基线重发；
- 展示真实变化、建议摘要、测试收件人和无抄送；
- 不点击最终发送。

若内容无变化，预览必须阻断并提示先产生真实需求修改，不得为了测试制造变化。

### Step 4：用户即时确认后才执行一次重发

只有页面显示完整合并确认且用户再次明确确认后，才允许：

1. 同步修改运控相应配置；
2. 使用内置邮件流程；
3. 选择“演示组 / 张乐翔”，无 CC；
4. 点击最终发送一次；
5. 等待新的“再次发送”记录；
6. 更新成功状态与证据文档。

若收件人第二步的真实 DOM 与录制流程不一致，停在最终发送前并用人工兜底流程核对，不猜测选择器。

### Step 5：记录尚未验收范围

证据文档必须明确：

- 本批次只验证重发；
- 没有验证首次发送；
- 没有验证未发布批次自动发布；
- 新测试项目由用户后续创建后再完成全流程验收。

---

## 完成标准

- 测试环境只忽略项目编码、项目名称，生产环境无放宽。
- 外部可见首次发送记录可以建立重发预览，但不会伪造本地成功状态。
- 内容无变化无法重发。
- 变化摘要来自真实 diff，最终可由用户编辑并必须非空。
- 真实任务列表、任务单、发送记录和内置邮件入口均通过可见 DOM 操作。
- 收件人和抄送人在同一个最终确认中展示。
- 最终发送只点击一次；成功只以新的“再次发送”记录为准。
- 自动测试、8765 健康检查、运行时文件哈希和 git 状态均有新证据。
- 首次发送/自动发布保持明确待验收，不把本次重发结果扩大解释为全流程通过。
