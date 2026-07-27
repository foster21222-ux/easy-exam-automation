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
  ℹ tests 1114
  ℹ suites 0
  ℹ pass 1114
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 6568.808667
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
  Ran 54 tests in 1.489s

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

## 可见页面验证

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
