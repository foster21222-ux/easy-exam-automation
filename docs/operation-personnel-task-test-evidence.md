# 运控人员任务单测试证据

## 自动测试

### Node

- 命令：

  ```bash
  /bin/zsh -lc 'for f in server/test_*.mjs; do [ "$f" = "server/test_exam_time_only.mjs" ] && continue; printf "%s\n" "$f"; done | xargs /Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test'
  ```

- 运行位置：`/Users/ata/Documents/easy-exam-automation/.worktrees/operation-personnel-task-send`
- 退出码：`0`
- 原始汇总：

  ```text
  ℹ tests 1126
  ℹ suites 0
  ℹ pass 1126
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 6588.990542
  ```

### Python

- 命令：

  ```bash
  /Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest discover -s server -p 'test_*.py'
  ```

- 运行位置：`/Users/ata/Documents/easy-exam-automation/.worktrees/operation-personnel-task-send`
- 退出码：`0`
- 原始汇总：

  ```text
  ----------------------------------------------------------------------
  Ran 54 tests in 1.401s

  OK
  ```

## 敏感数据边界

- `git diff --check`：退出码 `0`，无输出。
- 固定收件规则扫描：

  ```bash
  rg -n "唐润梅|张乐翔|结算组|拓展二部|演示组" server outputs/web_prototype/easy_exam_automation.html
  ```

  退出码 `0`。命中范围为 `server/operation_personnel_task.mjs`、`server/operation_personnel_task_runner.mjs` 中按 test/production 隔离的固定规则，以及对应测试；`outputs/web_prototype/easy_exam_automation.html` 无固定人员字面量命中。

- 敏感词扫描：

  ```bash
  rg -n "password|cookie|authorization|完整人员目录" server/operation_personnel_task*.mjs
  ```

  退出码 `1`，无输出，即目标文件没有这些敏感词命中。补充的大小写不敏感扫描 `rg -ni` 同样退出码 `1`、无输出。

## 8765 运行时

- 同步日期：`2026-07-27`。
- 当前 LaunchAgent：`com.ata.easy-exam-service`；工作目录为
  `/Users/ata/Library/Application Support/easy-exam-automation/app`。
- 规格中的 `scripts/sync_local_runtime.mjs` 默认指向另一套
  `yikao-auto-config-web` 运行时，因此未对错误目标执行。实际使用本项目既有
  `scripts/deploy_launchd_runtime.mjs`，从当前功能工作树进行原子部署。
- 部署脚本退出码：`0`；原始结果：

  ```json
  {
    "ok": true,
    "sourceDir": "/Users/ata/Documents/easy-exam-automation/.worktrees/operation-personnel-task-send",
    "targetDir": "/Users/ata/Library/Application Support/easy-exam-automation",
    "appDir": "/Users/ata/Library/Application Support/easy-exam-automation/app",
    "runtimeDir": "/Users/ata/Library/Application Support/easy-exam-automation/runtime",
    "copied": [
      "server",
      "scripts",
      "outputs",
      "web",
      "deploy",
      "template",
      "package.json",
      "requirements.txt"
    ],
    "migratedRuntime": []
  }
  ```

- `launchctl kickstart -k gui/501/com.ata.easy-exam-service`：退出码 `0`。
- 重启后 LaunchAgent 状态：`running`；运行次数 `170`；PID `76818`。
- `GET /api/health` 原始响应：

  ```json
  {"ok":true}
  ```

## 2026-07-27 可见页面验证（历史记录）

> 本节记录 2026-07-27 当时的实机观察，不代表 2026-07-28 Task 5 的当前实机验收结论。Task 5 的权威 UI 结论见“2026-07-28 只读配置台检查与限制”：本次预检被可见考试日程门槛阻断，未进入确认页。

- 在本机配置台打开项目 `R0031682` 的人员任务，执行“检查并发送人员任务单”。
- 二次确认页显示：
  - 批次：`EZT260006 · 湖北邮政_2026年8月`
  - 需求版本：`需求单 1：版本 1`
  - 考试日程：明确标记“只读”
  - 可编辑项：共 5 个，分别为人员落实开始日期、人员落实结束日期、人员名单提交日期、监考人数、监考比例
  - 固定收件人：`演练组 / 张乐翔`
- 页面未暴露内部字段路径或 JSON。
- 按授权边界点击“取消”退出，没有点击“确认配置并发送任务单”，没有触发真实发布或发送。

## 尚未验证

- 本次未修改需求日程，因此没有在实机数据上触发“批次待调整”阻断；该场景由 Node 回归测试覆盖。
- 没有执行真实首次发送或再次发送，无法在本次证据中确认运控新增发送记录。

## 最终审查补强

- 后台发送任务取得执行锁后，会重新读取需求日程和批次门槛；排队期间发生日程变化时，阻断执行器启动。
- 人员任务单列表同时按批次代码和批次名称精确匹配唯一行。
- 点击运控最终发送前，再次读取任务单日程和已选收件人；任一变化均阻断发送。
- 异步后台任务附带终止拒绝处理，持久化失败不会形成未处理的 Promise rejection。
- 重发变化摘要使用中文业务字段名，不显示 `personnel.*`、`dates.*` 等内部路径。

## 2026-07-28 全量验收（Task 5，以上旧测试数量及旧 UI 结论均以本节为准）

### 自动测试与工作区

- 相关 Node 测试命令：

  ```bash
  /Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
    server/test_operation_personnel_task.mjs \
    server/test_operation_personnel_schedule_gate.mjs \
    server/test_operation_personnel_task_runner.mjs \
    server/test_operation_personnel_task_service.mjs \
    server/test_operation_personnel_task_routes.mjs \
    server/test_ui_views.mjs
  ```

  最终重跑退出码 `0`：`tests 346`、`pass 346`、`fail 0`、`cancelled 0`、`skipped 0`、耗时 `3128.66525ms`。首次在受限沙箱运行退出码 `1`，其中 `9` 项路由测试均因 `listen EPERM: operation not permitted 127.0.0.1` 失败；获本机回环监听权限后以相同命令重跑，以上为有效结果。

- 全量 Node 测试命令：

  ```bash
  /bin/zsh -lc 'for f in server/test_*.mjs; do [ "$f" = "server/test_exam_time_only.mjs" ] && continue; printf "%s\n" "$f"; done | xargs /Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test'
  ```

  退出码 `0`：`tests 1140`、`pass 1140`、`fail 0`、`cancelled 0`、`skipped 0`、耗时 `13290.834875ms`。此前并发套件中止不构成证据；本次完整运行未在 `server/test_fanwei_helper_packaging.mjs` 或其他文件阻塞。

- 全量 Python 测试命令：

  ```bash
  /Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest discover -s server -p 'test_*.py'
  ```

  退出码 `0`：`Ran 54 tests in 1.377s`，`OK`。

- `git diff --check`：退出码 `0`，无输出；测试完成、更新证据前 `git status --short`：退出码 `0`，无输出。

### 覆盖的关键安全断言

- `personnel confirmation edits stay local until final send` 覆盖五字段本地编辑不触发预览 API。
- `display schedules use exact operation schedule codes` 覆盖日程展示使用真实运控代码。
- `final schedule readback drift blocks before submit and confirm`、`final recipient readback drift blocks before submit and confirm` 覆盖校验失败不进入 `submit_send` / 最终确认。
- 本次没有执行真实人员任务发送；自动测试中的发送路径为隔离测试替身。

### 2026-07-28 运行时同步与一致性

- 部署命令 `node scripts/deploy_launchd_runtime.mjs` 退出码 `0`，返回 `"ok": true`；目标应用目录为 `/Users/ata/Library/Application Support/easy-exam-automation/app`。
- `launchctl kickstart -k gui/$(id -u)/com.ata.easy-exam-service` 退出码 `0`。
- `curl -sS --max-time 5 http://127.0.0.1:8765/api/health` 退出码 `0`，原始响应为 `{"ok":true}`。
- 源码与运行时 SHA-256 逐对一致：

  ```text
  422d0318edb769349dd02e38c9b27d678f6b42e1d4dbc1a10d79ac314526c924  operation_personnel_task_service.mjs（源码/运行时）
  eab8db4e9fff0586592f191c7545192fc5ffaa77794fdb3859f36e3e0043ab7f  operation_personnel_task_runner.mjs（源码/运行时）
  ea5aca650f7c4b43921aaddc61438e69925fb088d93a691663c3eb101b02eb6a  easy_exam_automation.html（源码/运行时）
  ```

### 2026-07-28 只读配置台检查与限制

- 先用只读 API `GET /api/tasks` 和 `GET /api/tasks/{taskId}/operation-personnel-task` 筛选本机全部 `5` 个项目，而非逐个打开运控。唯一同时报告 `status: ready`、批次代码 `EZT260006`、`1` 条需求日程及 `1` 条受管日程的候选为 `R0031682`（`taskId b8e1af6b-7f2f-4490-926e-c2dda94f1461`）。其余 `4` 个候选分别为 `changes_pending`（1 个）及 `waiting_batch` / `needs_review`（3 个），不满足“受管日程完整且可预览”的筛选条件。
- 在 `http://127.0.0.1:8765` 打开该唯一候选的人员任务详情，展示批次代码 `EZT260006`，其来源标记为“运控结果”。
- 点击非终态的“检查并发送人员任务单”后，页面安全阻断：`运控人员任务检查阻断：无法确认可见页面中的考试日程表`。项目详情同时显示“尚未创建场次”。
- 因唯一静态候选未通过实际可见日程预检，本机没有同时满足“有效批次代码、受管日程完整、可预览”的项目；未进入人员任务确认页。故“日程代码”表头和值、五字段编辑后页面不关闭/不重复打开、以及五字段实机无预览请求均未能在该数据集上验证。
- 最终“确认以上内容并校验发送”按钮未出现且从未点击；未执行真实人员任务发送或考试日程写入。

## 2026-07-28 终审修复后复验（当前权威结果）

整分支终审补齐了严格时间规范化、最终真实日程代码绑定、所有重发的固定收件目录探测、当前重发摘要，以及两项防御性测试覆盖。以下结果取代本节之前的 `1140` 项 Node 数量和旧运行时哈希；只读配置台的数据前置限制保持不变。

### 自动测试

- 全量 Node 命令与上文相同，退出码 `0`：
  - `tests 1147`
  - `pass 1147`
  - `fail 0`
  - `cancelled 0`
  - `skipped 0`
- 全量 Python 命令与上文相同，退出码 `0`：`Ran 54 tests in 1.381s`，`OK`。
- `git diff --check`：退出码 `0`，无输出。

### 最终审查结论

- 4 个 Important finding 和 2 个 deferred minor 均已解决。
- 范围化复审逐项判定为 `ADDRESSED`，未发现新的 Critical、Important 或 Minor breakage。
- 最终回读按真实日程代码与内容做顺序无关的精确双向比较；代码、内容、缺失或重复漂移均在 `submit_send` 前阻断。
- 分钟级可见时间仅与秒为 `00` 的受管时间等价；无效时间、非零秒、时区或不受支持格式继续阻断。
- 所有重发均重新探测固定收件目录，并阻断两次检查之间的非目录漂移；重发摘要只取本次预览。

### 最终运行时同步

- `node scripts/deploy_launchd_runtime.mjs`：退出码 `0`，返回 `"ok": true`。
- `launchctl kickstart -k gui/$(id -u)/com.ata.easy-exam-service`：退出码 `0`。
- 重启后的首次健康请求早于服务监听，返回连接失败；随后单独重查：
  - `curl -sS --max-time 5 http://127.0.0.1:8765/api/health`：退出码 `0`
  - 原始响应：`{"ok":true}`
  - LaunchAgent 状态：`running`
- 最终源码与运行时 SHA-256 逐对一致：

  ```text
  515ed5c845c8cafac7f0b835ace85c7f5bf831d87845190562016cf2a364dca3  operation_personnel_task_service.mjs（源码/运行时）
  d66e6870fad85b08c68e19f32366d1a14b9294188b79936ffc68572bf4cbf867  operation_personnel_task_runner.mjs（源码/运行时）
  a05808f1d8f3c3f0e837e1b8942ee9dadd506fdb8dc0bfee67958898970a5ff9  easy_exam_automation.html（源码/运行时）
  ```

### 实机边界

- 终审修复后未执行真实首次发送、重发或最终确认，也未写入考试日程。
- 本机仍没有同时满足“有效批次代码、运控可见日程完整、可进入确认页”的测试项目，因此确认页的最终实机验收仍需在用户新建完整测试项目后进行。

## 2026-07-28 未发布批次发布位置恢复

### 根因与修复

- 未发布批次预检切换到“考试 → 易考”读取日程后，`publish_batch` 检查点仍在当前页面直接定位“发布”按钮，实际匹配为 `0`。
- 修复后，首次发送发现批次未发布时，先按批次代码重新精确打开批次详情，再点击唯一“发布”按钮并回读“已发布”状态。
- 已发布批次继续跳过发布动作；未扩大按钮选择器，也没有使用模糊文字匹配。

### 红绿回归证据

- 新增测试 `unpublished visible attempt restores the exact batch detail after schedule preview before publishing`。
- 修复前单独运行该测试：`tests 1`、`pass 0`、`fail 1`，失败原文为：

  ```text
  运控可见页面控件“发布按钮”必须精确匹配 1 个，实际 0 个
  ```

- 修复后单独运行该测试：`tests 1`、`pass 1`、`fail 0`。
- 人员任务执行器测试：`tests 103`、`pass 103`、`fail 0`。
- 人员任务执行器、服务和接口相关测试：`tests 169`、`pass 169`、`fail 0`。

### 全量测试

- 全量 Node 测试退出码 `0`：
  - `tests 1152`
  - `pass 1152`
  - `fail 0`
  - `cancelled 0`
  - `skipped 0`
  - 耗时 `7516.226125ms`
- 全量 Python 测试退出码 `0`：`Ran 54 tests in 2.772s`，`OK`。

### 本机运行时

- `node scripts/deploy_launchd_runtime.mjs` 退出码 `0`，返回 `"ok": true`，目标为 `/Users/ata/Library/Application Support/easy-exam-automation/app`。
- `launchctl kickstart -k gui/501/com.ata.easy-exam-service` 退出码 `0`；重启后的 LaunchAgent PID 为 `22704`。
- 重启后的沙箱内健康请求无法连接；用相同命令在沙箱外复核，退出码 `0`，原始响应为 `{"ok":true}`。
- 部署运行时中的人员任务执行器测试：`tests 103`、`pass 103`、`fail 0`。
- 源码与运行时 `operation_personnel_task_runner.mjs` SHA-256 一致：

  ```text
  5659a755dca150969bbd330dedf0966a7d03b9764bcfd852c09961851f5223f3
  ```

### 实机边界

- 本次没有点击最终确认按钮，没有执行真实人员任务首次发送或再次发送。
- 自动测试已验证重新定位、发布、状态回读和后续任务单顺序；实际运控页面的最终验证由用户使用测试项目再次发送时完成。

## 2026-07-28 发布按钮字间空格兼容

### 实机根因

- 只读打开测试运控批次 `EZT260006` 后，页面 URL 为 `/batch/batchDetail?batch_guid=db910e963d9b4e929c13122b7c0b7701`。
- 页面存在唯一、可点击且未禁用的 `button`，其可访问名称为“发 布”；原选择器使用精确字符串“发布”，因此匹配数为 `0`，发布动作从未执行。
- 修复仅把按钮名称约束调整为锚定规则 `^发\s*布$`；`button` 角色和唯一匹配约束保持不变，零个或多个匹配仍阻断。

### 红绿回归证据

- 新增测试 `default visible adapter uniquely matches the real spaced publish button name`。
- 修复前单独运行：`tests 1`、`pass 0`、`fail 1`，错误为“发布按钮实际 0 个”。
- 修复后单独运行：`tests 1`、`pass 1`、`fail 0`。
- 人员任务执行器测试：`tests 104`、`pass 104`、`fail 0`。

### 全量测试与运行时

- 全量 Node：`tests 1154`、`pass 1154`、`fail 0`。
- 全量 Python：`Ran 54 tests in 1.410s`，`OK`。
- 运行时人员任务执行器：`tests 104`、`pass 104`、`fail 0`。
- 部署返回 `"ok": true`；LaunchAgent 经明确 `kickstart -k` 后从当前 Application Support `app` 目录启动。
- 沙箱外健康检查原始响应为 `{"ok":true}`。
- 源码与运行时 `operation_personnel_task_runner.mjs` SHA-256 一致：

  ```text
  0e1606056fc4610727a20fbcf7891daa89ad8003d532989279f6fdcc25fd6950
  ```

### 实机边界

- 本轮只读检查了真实按钮结构，没有点击发布、确认弹窗或人员任务发送。
- 用户下次在配置台确认发送时，系统才会按既有二次确认流程执行真实发布并回读“已发布”状态。
