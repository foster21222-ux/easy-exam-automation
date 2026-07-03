# WeChat Requirement Collector

当前阶段目标：从微信群中复制或采集一段可见聊天记录，整理成结构化需求草稿。此阶段不自动读取微信数据库，不自动发送消息，不自动生成最终需求单。

## 配置微信群

复制 `config/wechat-requirement-groups.example.json` 为本机配置文件，例如：

```bash
cp config/wechat-requirement-groups.example.json .easy_exam_runtime/wechat-requirement-groups.json
```

配置多个项目群：

```json
{
  "groups": [
    {
      "group_name": "AI赋能运营自动化小组",
      "project_name": "易考自动化需求",
      "customer_name": "内部测试客户",
      "requirement_request_id": "wechat-ai-ops",
      "enabled": true,
      "interval_minutes": 15
    },
    {
      "group_name": "某客户考试项目群",
      "project_name": "某客户校招考试",
      "customer_name": "某客户",
      "requirement_request_id": "customer-campus-2026",
      "enabled": true,
      "interval_minutes": 15
    }
  ]
}
```

`requirement_request_id` 用来把同一个微信群长期绑定到需求中心里的同一条需求。配置后，后续采集到的变更会挂到这条需求下面；不配置时，第一次 `--push` 成功后脚本会把需求中心返回的 `requestId` 写入 `--state` 文件，后续继续复用。

同一份运行时配置里，`group_name` 必须唯一；保存配置时如果微信群名重复，页面和 API 都会提示错误并拒绝写入，避免同一个群映射到多个项目或关联需求单编号。

`interval_minutes` 必须是大于等于 1 的整数。通过页面或 `PUT /api/wechat-collector/config` 保存运行时配置时，系统会拒绝 `0`、小数或非数字间隔，避免定时采集语义不明确。

即使运行时配置文件是手工编辑的，`dry-run`、`run-once`、安装定时任务和安装整套自动采集这些会触发采集脚本或定时运行的入口，也会重新校验 `group_name` 唯一性和 `interval_minutes` 合法性；配置不合法时会直接拒绝，不会启动采集脚本或修改 LaunchAgent。

## 试运行

把微信群可见消息复制到文本文件：

```bash
node scripts/wechat_requirement_collect.mjs \
  --config .easy_exam_runtime/wechat-requirement-groups.json \
  --group AI赋能运营自动化小组 \
  --input /tmp/wechat-chat.txt \
  --state .easy_exam_runtime/wechat-checkpoints.json
```

也可以复制微信群消息到剪贴板后运行：

```bash
node scripts/wechat_requirement_collect.mjs \
  --config .easy_exam_runtime/wechat-requirement-groups.json \
  --group AI赋能运营自动化小组 \
  --clipboard \
  --state .easy_exam_runtime/wechat-checkpoints.json
```

输出内容会包装在 `draft` 字段里；带 `--push --api http://127.0.0.1:8765` 时，还会包含 `push` 结果。`draft` 内容包括：

- `source`：微信群来源和采集时间。
- `project`：群映射到的项目和客户。
- `requirement`：结构化需求草稿。
- `unresolvedQuestions`：仍需确认的问题。
- `changeRecords`：聊天中识别到的需求变更。
- `checkpoint`：本次消息数量、最后一条消息 hash，以及最多 200 条最近消息 hash，后续定时读取会用于去重。

手工文本采集和可见窗口采集共用同一套 checkpoint 语义：如果 `--state` 已经记录过这段消息，重复输入会被过滤为 `skipped: "no_new_messages"`，不会覆盖原 checkpoint，也不会在 `--push` 模式下创建空需求版本。

## 从桌面微信采集当前可见内容

先确保：

- macOS 已登录微信桌面版。
- 系统设置中允许终端或 Codex 使用辅助功能控制微信。
- 采集脚本只会搜索指定群、读取当前可见聊天内容，不会发送消息。

默认推荐使用截图 OCR 模式。脚本通过 `scripts/wechat_window.swift` 从 macOS 窗口服务取得微信窗口 ID 和真实位置，用 CGEvent 点击微信搜索框并打开目标群，再用 `screencapture -l` 按窗口 ID 截取不受其他窗口遮挡的完整微信窗口。脚本先 OCR 完整窗口并确认标题包含配置群名，标题不匹配时立即失败；通过后再排除左侧会话列表、顶部标题栏和底部输入区，只 OCR 聊天正文。这样错误会话、其他应用窗口、会话侧栏预览和输入框内容不会混入当前需求。保留 `--captureMode clipboard` 作为备用模式，用 Cmd+A/C 从微信窗口复制可见文本。

聊天正文默认裁剪边距为左 `320`、上 `56`、右 `0`、下 `180` 像素。窗口布局不同时可覆盖：

```bash
--chatLeftInset 320 \
--chatTopInset 56 \
--chatRightInset 0 \
--chatBottomInset 180
```

裁剪后的正文区域小于 `320×240` 时脚本会失败并记录错误，不会继续 OCR 或推送。真实运行摘要会记录最终 `captureRect`，预检摘要会记录计划使用的 `captureInsets`，页面“最近一次运行/预检”中也会显示这些信息。

运行单个群：

```bash
node scripts/wechat_visible_collect.mjs \
  --config .easy_exam_runtime/wechat-requirement-groups.json \
  --state .easy_exam_runtime/wechat-checkpoints.json \
  --group AI赋能运营自动化小组 \
  --captureMode ocr
```

运行配置里所有启用的群：

```bash
node scripts/wechat_visible_collect.mjs \
  --config .easy_exam_runtime/wechat-requirement-groups.json \
  --state .easy_exam_runtime/wechat-checkpoints.json \
  --captureMode ocr
```

采集后推送到本机需求中心：

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/wechat_visible_collect.mjs \
  --config .easy_exam_runtime/wechat-requirement-groups.json \
  --state .easy_exam_runtime/wechat-checkpoints.json \
  --group AI赋能运营自动化小组 \
  --push \
  --api http://127.0.0.1:8765 \
  --captureMode ocr \
  --output .easy_exam_runtime/wechat-last-run.json
```

预览将执行的 AppleScript，不操作微信：

```bash
node scripts/wechat_visible_collect.mjs \
  --config .easy_exam_runtime/wechat-requirement-groups.json \
  --group AI赋能运营自动化小组 \
  --captureMode ocr \
  --dry-run
```

如果要回退到复制文本模式：

```bash
node scripts/wechat_visible_collect.mjs \
  --config .easy_exam_runtime/wechat-requirement-groups.json \
  --state .easy_exam_runtime/wechat-checkpoints.json \
  --group AI赋能运营自动化小组 \
  --captureMode clipboard
```

`--state` 文件会记录每个群的 checkpoint。下一次采集时，脚本优先用最后一条消息 hash 定位新增内容；如果微信滚动导致旧末行已经离开可见区，则使用最近 200 条消息 hash 逐行剔除已处理内容，减少重复需求和重复变更单。旧 checkpoint 只有 `lastMessageHash` 时仍按原逻辑工作，下一次成功采集后会自然补齐哈希集合，不需要迁移。

定时采集会按每个群配置的 `interval_minutes` 判断是否到期。未到间隔的群会写入 `status: "skipped_interval"`，不会打开微信窗口。手动验证时可以加 `--force` 强制采集；页面上的“立即试跑”会自动使用强制采集，不受间隔限制。

真实采集返回后会先检查原始可见文本。OCR 原始结果为空时，脚本会写入 `status: "failed"` 和“确认微信窗口可见且屏幕未锁定”的错误，不会进入 checkpoint、附件扫描或需求中心推送，避免锁屏、遮挡或空截图被误判为正常空跑。

OCR 文本非空、目标群标题已验证，但没有解析出任何需求字段或需求变更时，脚本会写入 `status: "no_requirement_signal"`，不会写 checkpoint、扫描附件或推送需求中心；该状态属于正常调度心跳，不会让 launchd 任务以失败退出。包含发送者名称和普通聊天的变更视口会按已识别字段路由为变更单；只要解析出的字段都来自变更记录，就不会先 upsert 一个不完整需求版本。

只有原始可见文本非空、但 checkpoint 过滤后没有新消息时，脚本才会写入 `status: "no_new_messages"`。这时不会调用需求中心推送接口，也不会创建空需求版本；它会被视为一次正常空跑，但不会让“最近推送”就绪项通过，并会保留原 checkpoint。

脚本会使用运行锁避免多个采集任务同时操作微信窗口。默认锁文件是：

```text
.easy_exam_runtime/wechat-visible-collect.lock
```

如果另一个采集任务正在运行，本次运行会写入 `status: "skipped"` 的摘要并退出。可以用 `--lockPath <path>` 指定锁文件位置。

锁文件默认 30 分钟后视为陈旧锁并自动清理，避免异常退出后长期阻塞定时采集。可以用 `--lockMaxAgeMs <毫秒>` 调整陈旧锁阈值。

带 `--push` 时，脚本会先检查 `--api` 指向的需求中心 `/api/requirements` 是否可达；不可达时会把本轮群状态写成 `failed`，不会激活微信窗口，也不会截图或复制聊天内容。检查通过后，脚本会把结构化需求草稿提交到 `POST /api/ai/requirements/dispatch`。不带 `--push` 时只输出 JSON，不写入需求中心。

如果采集内容里识别到“变更、调整、增加、新增”等变更记录，脚本会向同一个 `requestId` 提交一条 `change_request`。当本轮内容只有变更消息时，脚本不会用这段不完整文本覆盖原需求草稿；需求中心会把变更放在人工审核流程中，不会自动进入执行。

默认情况下，微信群文本到需求字段的转换使用本地规则解析，不调用大模型。需要增强语义识别时，可以在“系统配置 → 微信采集配置 → LLM 候选解析”中启用页面配置，选择 OpenAI 或千问，填写模型、Endpoint 和 API Key。API Key 只写入本机运行时配置 `.easy_exam_runtime/wechat-requirement-groups.json`，页面和 API 返回值只显示是否已配置，不回显明文。

页面配置会随 `--config` 指向的运行时配置文件被定时采集脚本读取。CLI 和环境变量仍可用于临时覆盖：

```bash
WECHAT_LLM_PARSE=candidate \
OPENAI_API_KEY=你的密钥 \
node scripts/wechat_visible_collect.mjs --config config/wechat-requirement-groups.example.json --state .easy_exam_runtime/wechat-checkpoints.json --group AI赋能运营自动化小组 --push --llm-parse candidate
```

千问可使用 OpenAI-compatible Chat Completions endpoint，例如 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`，模型可填 `qwen-plus`。

LLM 解析只输出候选结构化结果和原文证据，候选结果会作为 `analysis_candidate_recorded` 审计事件进入需求详情页的“解析结果确认”区域，不会自动覆盖正式需求，也不会绕过人工审核。模型输出必须通过字段白名单、JSON 结构和 evidence 校验；无证据字段、未知字段以及无原文证据的默认配置字段会被丢弃。LLM 调用失败时，规则解析和采集推送仍按原流程继续。

## 新增消息采集

普通微信群的稳定采集方式仍然是桌面微信可见窗口 OCR：

- 历史补采：运营人员把微信窗口停在包含历史需求的位置，执行“立即采集本群”。如果没有识别到有效需求，不推进 checkpoint。
- 定时采集：上线自动采集后，系统按群配置的采集间隔打开可见微信窗口、截图、OCR、解析需求并推送需求中心。
- 附件处理：只扫描本机已下载且能从可见群消息关联到的附件，不点击下载、不读取聊天数据库。

当前已结构化识别的变更话术包括：

- 科目增加：例如“变更一下，科目增加数学”。
- 科目替换：例如“本次不考英语，改成数学”。
- 正式考试时间调整：例如“考试时间改到 7-1 时间 10点-12点”。
- 提前登录和迟到限制统一调整：例如“提前登录、迟到时间都是 30分钟”。

这些变更会进入 `changeRecords`，并随 `change_request` 写入需求中心的变更单。只有变更内容时，不会新建一个缺字段的需求版本。

需求中心还会对变更请求做最终幂等保护：同一需求下，如果 `customerMessage` 和规范化后的 `changes` 与现有 `pending_internal_review` 变更完全相同，则返回原变更单，不重复插入记录或时间线事件。该变更被接受或驳回后，客户再次提出相同内容会创建新的待审核变更，不会被错误吞掉。

进入需求中心后，变更不会自动覆盖已审核需求。工作人员在 `/requirements/<需求编号>` 的“需求变更记录”里可以：

- 接受变更：把变更内容生成一个新的需求版本，变更单状态改为 `accepted`，需求重新进入内部审核。
- 驳回变更：只把变更单状态改为 `rejected`，不新增需求版本。

`--output` 会写入本次运行摘要，便于定时任务排查：

```json
{
  "startedAt": "2026-06-24T10:00:00.000Z",
  "finishedAt": "2026-06-24T10:00:08.000Z",
  "groups": [
    {
      "groupName": "AI赋能运营自动化小组",
      "status": "pushed",
      "requestId": "wechat-ai-ops",
      "captureMode": "ocr",
      "screenshotPath": ".easy_exam_runtime/wechat-screenshots/AI赋能运营自动化小组-2026-06-24T10-00-00-000Z.png",
      "messageCount": 4,
      "changeCount": 0
    }
  ]
}
```

每次写入 `--output` 时，脚本还会向同目录的 `wechat-run-history.jsonl` 追加一行 JSONL 历史记录；也可以通过 `--history <path>` 指定历史文件路径。默认保留最近 500 条历史记录，可用 `--historyMaxEntries <数量>` 调整，避免定时长期运行后历史文件无限增长。这个历史文件用于查看连续运行趋势，不影响 checkpoint。

`captureMode`、`screenshotPath` 和 `ocrCommand` 会显示在 `/wechat-collector` 的最近运行区域。OCR 识别异常时，可以用截图路径复核当时微信窗口里实际可见的内容。

## 本机服务与 15 分钟定时

测试阶段建议用 macOS `launchd` 管理两层任务：

- `com.ata.easy-exam-service`：保持 easy-exam 本机服务运行在 `http://127.0.0.1:8765`。
- `com.ata.easy-exam-wechat-collector`：每 15 分钟执行一次 `scripts/wechat_visible_collect.mjs --captureMode ocr`，通过可见微信窗口截图 OCR 采集微信群内容、推送到本机需求中心、更新 checkpoint，并写入最近一次运行摘要。

macOS 会阻止无界面的 LaunchAgent 直接读取 `~/Documents`。安装前先把运行代码部署到 `~/Library/Application Support/easy-exam-automation/app`，把持久数据库、配置、checkpoint 和日志迁移到相邻的 `runtime` 目录：

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/deploy_launchd_runtime.mjs --migrate-runtime
```

`--migrate-runtime` 只复制目标目录里尚不存在的数据。后续代码更新只运行同一命令但不带该参数，应用副本会重建，已有 runtime 数据不会被仓库副本覆盖。

安装本机服务：

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/easy_exam_service_launchd.mjs --install
```

检查本机服务状态：

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/easy_exam_service_launchd.mjs --status
```

停止本机服务：

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/easy_exam_service_launchd.mjs --uninstall
```

安装定时采集模板：

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/wechat_collector_launchd.mjs --install
```

后台采集还需要 macOS“屏幕与系统音频录制”权限。`launchd` 显示 loaded 只证明任务已加载；必须再触发一次采集，并确认 `~/Library/Application Support/easy-exam-automation/runtime/wechat-last-run.json` 出现新的 `finishedAt`，且不是 `could not create image from window`。未授权时应卸载采集 job，避免每 15 分钟激活微信后失败；本机 HTTP 服务可以继续保留。

检查定时任务安装和加载状态：

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/wechat_collector_launchd.mjs --status
```

查看最近一次结构化运行状态：

```bash
cat "$HOME/Library/Application Support/easy-exam-automation/runtime/wechat-last-run.json"
```

查看最近运行历史：

```bash
tail -n 20 "$HOME/Library/Application Support/easy-exam-automation/runtime/wechat-run-history.jsonl"
```

查看最近一次预检状态：

```bash
cat "$HOME/Library/Application Support/easy-exam-automation/runtime/wechat-preflight-run.json"
```

停止定时采集：

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/wechat_collector_launchd.mjs --uninstall
```

## 本地配置与状态页面

启动本机服务后，可以打开：

```text
http://127.0.0.1:8765/wechat-collector
```

左侧导航里的“微信采集”就是这套能力的操作页面。当前实现的页面入口和配置位置如下：

- “采集边界”：在页面顶部用一行提示展示当前边界，只采集可见群聊 OCR，把结果推送到需求中心等待人工确认；附件只扫描本群可见文件名关联到的本机已下载文件，不会自动下载群文件。
- “项目微信群配置”：维护微信群到项目、客户、关联需求单编号的映射；保存后写入 `.easy_exam_runtime/wechat-requirement-groups.json`。关联需求单编号可留空；填入后，本群后续采集和变更会归到这张需求单；不填则首次有效采集时新建需求。
- “预检脚本”：检查配置、微信窗口坐标、截图裁剪区域和 OCR 命令；不会切换群、截图、OCR 或推送。
- “立即试跑”/“试跑本群”：人工确认后激活微信、打开目标群、截图 OCR 当前可见聊天内容，并推送到需求中心。
- “链路自检”：不操作真实微信，用临时服务和临时 sqlite 验证需求推送和变更单进入人工审核。
- “配置微信群”的群卡片：常显微信群名、项目名称、客户、关联需求单编号、最近采集状态和本群附件状态；展开后展示群配置、任务执行状态和详细需求更新记录。页面不提供全局遍历所有群附件的主操作入口。
- “本机服务”：区分当前页面 HTTP 服务是否可达，以及 `com.ata.easy-exam-service` LaunchAgent 是否已安装并加载。
- “定时任务”：查看或安装 `com.ata.easy-exam-wechat-collector` LaunchAgent；安装前必须通过配置、链路自检和逐群真实试跑门槛。
- “需求单记录”和“需求详情”：查看微信采集进入需求中心后的需求单、版本、原始消息、附件摘要和变更单审核状态。

页面会读取：

- `GET /api/wechat-collector/config`：当前 `.easy_exam_runtime/wechat-requirement-groups.json` 的微信群配置。
- `GET /api/wechat-collector/status`：当前 `.easy_exam_runtime/wechat-last-run.json` 的最近一次正式运行状态、`.easy_exam_runtime/wechat-preflight-run.json` 的最近一次预检状态、`.easy_exam_runtime/wechat-run-history.jsonl` 的最近运行历史，并返回本机 easy-exam 服务、需求中心服务、`launchd` 定时采集任务的状态；同时把运行时配置、最近运行和 `.easy_exam_runtime/wechat-checkpoints.json` 合并成每个微信群的 `groups` 汇总。
- `POST /api/wechat-collector/service/install`：复制并加载本机 easy-exam 服务 `launchd` 任务。
- `POST /api/wechat-collector/service/uninstall`：卸载并删除本机 easy-exam 服务 `launchd` 任务。
- `PUT /api/wechat-collector/config`：保存运行时微信群配置，写入 `.easy_exam_runtime/wechat-requirement-groups.json`，不会改动仓库里的示例配置。
- `POST /api/wechat-collector/scheduler/install`：复制并加载本机 `launchd` 定时采集任务；运行前至少需要一个已启用的微信群配置、最近 24 小时内链路自检通过，并且每个已启用群都在最近 24 小时内通过真实微信试跑成功推送到需求中心，否则会列出尚未验证的群并拒绝安装，不会写入或加载 LaunchAgent。
- `POST /api/wechat-collector/scheduler/uninstall`：卸载并删除本机 `launchd` 定时采集任务。
- `POST /api/wechat-collector/automation/install`：先安装本机 easy-exam 服务，再安装微信群采集定时任务；运行前至少需要一个已启用的微信群配置、最近 24 小时内链路自检通过，并且每个已启用群都在最近 24 小时内通过真实微信试跑成功推送到需求中心，否则会列出尚未验证的群并拒绝安装，不会安装服务或定时任务。如果本机服务已安装但采集定时任务安装失败，API 会尝试卸载本机服务并返回回滚结果，避免半安装状态。
- `POST /api/wechat-collector/automation/uninstall`：先卸载微信群采集定时任务，再卸载本机 easy-exam 服务。
- `POST /api/wechat-collector/dry-run`：按当前运行时配置做采集脚本预检，写入 `.easy_exam_runtime/wechat-preflight-run.json`；运行前至少需要一个已启用且合法的微信群配置，否则会被拒绝，不会启动预检脚本；不会激活微信、不会截图、不会推送需求中心，也不会覆盖正式的 `.easy_exam_runtime/wechat-last-run.json`。
- `POST /api/wechat-collector/run-once`：按当前运行时配置立即执行一次可见微信采集，并推送到本机需求中心；运行前至少需要一个已启用的微信群配置，并且需求中心 HTTP 服务可达，否则会被拒绝，不会激活微信窗口。body 可传 `{ "groupName": "微信群名称" }` 只试跑单个群。传入 `groupName` 时，API 会先确认该群存在于运行时配置且处于启用状态；未知群、停用群或需求中心不可用时会被拒绝，不会激活微信窗口。
- `GET /api/wechat-collector/attachments/scan`：只读扫描本机已下载的微信文件，返回目录状态、文件名、类型、大小、修改时间和轻量预览；可带 `root=<目录>` 指定只读扫描目录，`modifiedSince=<ISO时间>` 只看最近修改文件，`maxFiles=<数量>` 限制返回文件数，`previewChars=<字数>` 控制文本预览长度；`maxFiles` 必须是 1–500 的整数，`previewChars` 必须是 0–5000 的整数，非法值会在扫描前返回 400；不传 `root` 时会展开默认微信文件目录通配符，并在摘要里记录展开后的目录数和可读取目录数；不会点击下载，不会读取聊天数据库。
- `POST /api/wechat-collector/pipeline-smoke-test`：运行临时服务和临时 sqlite 的链路自检，验证微信群文本需求和变更能推送进需求中心，并把结果写入 `.easy_exam_runtime/wechat-pipeline-smoke.json`；不会操作微信，也不会写正式需求库。自检失败时返回 HTTP 500，响应体和状态文件都会保留失败原因。通过结果会写入 `finishedAt`，超过 24 小时后不再计入就绪检查，需要重新运行。

页面上的“新增群”“删除”和每个群卡片里的“保存本群设置”会写入运行时配置文件。保存后，launchd 下一次运行会使用这份配置进行微信群采集和需求中心推送，并且页面会自动刷新就绪检查、逐群状态和上线门槛。群卡片会保留手工坏配置里的非法间隔值，例如 `0` 会显示为 `0` 而不是被改成默认值，便于直接修正。群卡片常显项目名称、客户、关联需求单编号、最近采集状态和本群附件状态；展开后会展示最近运行时间、最近错误原因、checkpoint 更新时间、下次运行时间、本群附件候选数、按当前群可见文件名成功关联的附件数、附件时间过滤线，以及该群最近运行中的消息数、变更数和错误信息。这些信息来自 `GET /api/wechat-collector/status` 的 `groups` 与 `history` 汇总，便于逐群排查。群卡片里的“查看附件状态”只展示该群最近一次采集结果，不会触发全局附件扫描。

保存配置前，如果旧的运行时配置文件已经存在，API 会先把旧配置备份到 `.easy_exam_runtime/wechat-config-backups/`，再覆盖 `.easy_exam_runtime/wechat-requirement-groups.json`。页面保存成功后会显示本次备份路径。需要恢复时，可以把对应备份文件内容复制回 `.easy_exam_runtime/wechat-requirement-groups.json`，再刷新“微信采集”页面确认群映射。

“最近配置备份”区域会从 `.easy_exam_runtime/wechat-config-backups/` 读取最近的备份文件，便于确认是否存在可恢复点。点击某个备份的“恢复”会先弹出确认；确认后 API 只允许按备份文件名从该目录恢复，不能传入任意路径，并会在覆盖当前配置前再次备份当前配置。

“就绪检查”区域会汇总以下条件：

- 运行时微信群配置合法，包括群名不重复、采集间隔是正整数。
- 至少有一个已启用的微信群配置。
- 本机 easy-exam 服务 LaunchAgent 已加载。
- 需求中心 HTTP 服务可达。
- 截图 OCR helper 和 Swift 运行环境可用。
- 微信采集定时 LaunchAgent 已加载。
- 采集心跳正常：仅当定时 LaunchAgent 已加载时检查，最近一份正式运行摘要必须在 60 分钟内；超过阈值会提示定时任务可能因 Mac 休眠、未触发或异常退出而中断。
- 当前没有未过期的采集锁。
- 最近一次采集运行成功。
- 每个已启用群都在最近 24 小时内通过真实微信试跑成功推送到需求中心；页面会列出尚未验证或验证已过期的群。
- 最近一次链路自检通过，且自检完成时间在 24 小时内。

“上线门槛”区域会把正式启用前必须确认的动作单独列出来：

- 配置合法：运行时微信群配置已通过校验。
- 链路自检通过：只使用临时服务和临时 sqlite，证明需求推送和变更单流程可用；超过 24 小时的旧通过记录会显示为待处理。
- 真实微信试跑通过：需要人工点击“立即试跑”或逐行点击“试跑本群”并确认，脚本会激活微信、OCR 当前可见群聊并推送到需求中心；每个已启用群都要通过，超过 24 小时后需要重新试跑。逐群成功记录会从 `.easy_exam_runtime/wechat-run-history.jsonl` 合并计算，不要求一次性采集所有群。
- 本机服务已加载：`com.ata.easy-exam-service` LaunchAgent 已安装并加载。
- 定时已安装并加载：`com.ata.easy-exam-wechat-collector` LaunchAgent 已安装并加载，会按配置间隔运行。

“安装定时”和“安装整套自动采集”按钮默认禁用。页面只在运行时配置合法、最近 24 小时链路自检有效、每个已启用群最近 24 小时真实试跑成功这三项同时满足后启用按钮；悬停提示会列出尚未完成的条件。即使绕过页面直接调用 API，后端仍会执行同样的安装闸门校验。

页面上的“预检脚本”会调用 `scripts/wechat_visible_collect.mjs --dry-run --check-window --captureMode ocr`，用于安装定时任务前检查当前微信群配置、CGEvent 搜索脚本、截图路径、OCR 命令，并通过 macOS 窗口服务只读获取微信窗口 ID 和大小以计算窗口内部的聊天正文 `captureRect`。这个动作要求运行时配置里至少有一个已启用且合法的微信群；配置不合法、微信未运行、窗口不可读或裁剪后区域过小时，API 会返回失败并保留原因。这个动作不会激活微信、不会切换群聊、不会截图、不会执行 OCR、不会推送需求中心。

预检结果会显示在“最近一次预检”区域，并持久读取 `.easy_exam_runtime/wechat-preflight-run.json`；其中会显示实际窗口计算出的 `captureRect` 和裁剪边距，但对应的截图路径只是下一次真实采集的计划路径，预检不会创建该文件。预检不会覆盖“最近一次运行”的正式采集摘要，也不会让“就绪检查”里的“最近运行”通过。只有实际采集、实际推送或因间隔未到而跳过的定时采集运行才算正式采集运行。“最近一次运行”会分别显示本轮附件候选数、按当前群可见文件名成功关联的附件数和附件时间过滤线，便于确认文件消息是否被带入本轮需求上下文。

“运行历史”区域会读取 `.easy_exam_runtime/wechat-run-history.jsonl` 最近记录，展示每次运行完成时间、涉及群数和状态分布，用于观察定时任务是否连续失败或稳定推送。

“采集心跳”和“最近运行”是两个独立判断：“最近运行”检查最后一轮每个群的结果是否为成功、间隔跳过或正常无新消息；“采集心跳”检查已加载的定时任务是否仍持续产出运行摘要。默认心跳阈值为 60 分钟，因此即使最后一次结果成功，长时间没有新运行也会在页面标记为待处理。

页面上的“运行链路自检”会调用 `POST /api/wechat-collector/pipeline-smoke-test`。它会用临时端口启动 easy-exam 服务、使用临时 sqlite 库、通过正式文本采集 CLI 推送一条初始需求和一条变更，再验证变更单进入人工审核；结果会保存在 `.easy_exam_runtime/wechat-pipeline-smoke.json`，刷新页面后仍会显示最近一次自检结果。链路自检面板会展示完成时间和有效/过期状态；自检失败时页面会显示失败原因，并保持“上线门槛”的链路自检项为待处理。自检通过超过 24 小时后，页面会要求重新运行自检。这个动作不会激活微信、不会安装定时任务、不会污染正式需求库。

底层仍保留 `GET /api/wechat-collector/attachments/scan` 只读扫描接口，供脚本和排障调用；主页面不再暴露“扫描已下载文件”按钮，避免用户误以为系统会按页面操作遍历所有微信群附件。真实采集时，`scripts/wechat_visible_collect.mjs` 会先扫描已下载候选附件，再用当前群 OCR/可见文本中的文件名做关联；未匹配当前群文件名的附件不会进入该群需求。

页面上的“立即试跑”会先弹出确认，再调用 `scripts/wechat_visible_collect.mjs --push --captureMode ocr`，用于安装定时任务前验证当前微信群配置、微信窗口采集权限、截图 OCR 和需求中心推送是否可用。这个动作要求运行时配置里至少有一个已启用群，并要求需求中心 HTTP 服务可达；如果没有启用群或需求中心不可用，API 会直接拒绝，不会启动采集脚本，也不会激活微信。试跑会激活微信并切换到配置中的群，但不会发送消息。群卡片里的“立即采集本群”会向同一个接口传入 `groupName`，只打开并采集该卡片对应的微信群，适合多群逐个上线验证；如果该群未保存到运行时配置、已经停用，或需求中心不可用，API 会直接拒绝，不会启动采集脚本。试跑完成后页面会自动刷新群卡片状态、运行历史、就绪检查和上线门槛。

页面上的“安装服务”和“卸载服务”会先弹出确认，再修改本机 `com.ata.easy-exam-service` LaunchAgent，用于让需求中心常驻运行。

页面上的“安装定时”和“卸载定时”会先弹出确认，确认后才会修改本机 `LaunchAgents`；不会在保存微信群配置时自动安装定时任务。安装定时前，API 会确认运行时配置里至少有一个已启用群，并要求最近 24 小时内链路自检通过、每个已启用群都在最近 24 小时内真实微信试跑成功推送；任一条件缺失或过期时会列出对应群并直接拒绝，不会写入或加载采集 LaunchAgent。

页面上的“安装整套自动采集”和“卸载整套自动采集”也会先弹出确认。“安装整套自动采集”会按顺序安装本机服务和采集定时任务；如果没有启用群、最近 24 小时内没有通过链路自检，或任一已启用群缺少最近 24 小时内的真实微信成功推送记录，API 会直接拒绝，不会安装服务或定时任务；如果采集定时安装失败，会尝试回滚已安装的本机服务。“卸载整套自动采集”会先卸载采集定时任务，再卸载本机服务。这两个动作不会立即采集微信，也不会发送群消息。

“需求中心服务”区域会检查 `http://127.0.0.1:8765/api/requirements` 是否可达。定时任务带 `--push` 运行时依赖这个本机服务；如果这里显示不可用，定时任务会在激活微信前失败并写入最近一次运行状态，不会打开微信窗口采集内容。

“定时任务”区域会检查：

- `~/Library/LaunchAgents/com.ata.easy-exam-wechat-collector.plist` 是否存在。
- `launchctl list` 里是否已经加载 `com.ata.easy-exam-wechat-collector`。

“运行日志”区域会只读展示以下日志文件尾部，便于排查服务启动、微信采集和推送失败：

- `.easy_exam_runtime/logs/service.stdout.log`
- `.easy_exam_runtime/logs/service.stderr.log`
- `.easy_exam_runtime/wechat-collector.log`
- `.easy_exam_runtime/wechat-collector.err.log`

推送到需求中心后，打开 `/requirements/<需求编号>` 可以在“来源与原始消息”中看到微信群名、项目名、采集时间和本次可见聊天原文；版本历史会把微信群来源显示成可读文本。

## 端到端冒烟验证

不操作真实微信、不安装定时任务时，可以用临时服务和临时 sqlite 库复查核心链路：

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/wechat_pipeline_smoke_test.mjs
```

这个脚本会：

- 随机选择一个本机临时端口启动 easy-exam 服务。
- 使用临时 `REQUIREMENT_DB_PATH`，不污染正式需求库。
- 通过 `scripts/wechat_requirement_collect.mjs --push` 推送一段初始微信群需求文本。
- 再推送一段变更文本。
- 读取 `/api/requirements/<需求编号>`，验证初始需求已落库、后续变更进入 `pending_internal_review` 变更单。

## 只读扫描已下载群文件

桌面微信已下载的群文件通常会落在本机微信沙盒目录下。当前只读扫描脚本只会枚举这些已存在文件并提取轻量预览，不会点击下载按钮、不读取微信聊天数据库、不发送消息。

扫描默认微信附件目录：

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/wechat_attachment_scan.mjs
```

扫描指定目录：

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/wechat_attachment_scan.mjs \
  --root "$HOME/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files" \
  --maxFiles 50 \
  --previewChars 1200 \
  --modifiedSince 2026-06-24T00:00:00.000Z
```

支持范围：

- `.xlsx`：读取工作表名称和单元格文本预览。
- `.txt`、`.csv`：读取文件开头文本预览，先按 UTF-8 严格解码，失败时自动用 GB18030 兜底，避免客户通过微信发来的 GBK/GB18030 中文文本乱码。
- `.png`、`.jpg`、`.jpeg`：使用 macOS Vision OCR 读取图片中的文字预览。
- `.xls`、`.pdf`、`.docx`、`.doc`：当前只列出文件名、路径、大小、修改时间；内容解析放到后续阶段按需接入。

单个附件因权限或解析问题无法读取时，扫描会保留可确认的文件元数据、将该文件预览置空，并继续处理其他附件，不会用猜测内容补全预览。

`scripts/wechat_visible_collect.mjs` 在实际采集时会先只读扫描最近的已下载附件，再用当前群 OCR/可见文本中的文件名做关联。文件名会进行 Unicode 规范化并忽略大小写和空白；只有文件名出现在当前群可见文本中的候选附件，才会把名称、类型、大小、修改时间和可用预览追加到推送给需求中心的原始消息上下文中。扫描页仍可展示全部已下载候选，但未匹配当前群文件名的附件不会进入该群需求，避免多个项目群之间串入附件。默认最多扫描 5 个候选附件、每个预览 500 字符；可以通过以下参数调整：

```bash
--attachmentRoot "$HOME/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files" \
--attachmentMaxFiles 10 \
--attachmentPreviewChars 800 \
--attachmentModifiedSince 2026-06-24T00:00:00.000Z
```

如果没有显式传 `--attachmentModifiedSince`，可见采集会优先使用该微信群上次成功写入 checkpoint 的 `updatedAt` 作为附件过滤线。这样 15 分钟定时任务不会反复把更早的历史附件带入新一轮需求上下文；首次运行没有历史 checkpoint 时不做时间过滤。

## 当前边界

当前链路已经可以从微信群聊天正文裁剪区域识别可见消息，把按当前群文件名匹配的已下载附件摘要推送到 easy-exam 需求中心，并在 `/wechat-collector` 页面显示配置和最近一次运行结果。需求单或变更单进入需求中心后仍然停留在人工确认流程，不会自动创建或执行考试任务。

暂不做的事情：

- 不读取微信聊天数据库。
- 不自动点击下载群文件。
- 不自动发送群消息。
- 不绕过微信权限或解密本地数据库。
