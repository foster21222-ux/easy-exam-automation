# 易考自动配置工作记忆

## 本地页面验收约定（2026-07-02）

- 用户明确要求：每一次向用户确认“已更新/已修复/可以了”之前，必须保证用户正在看的 `127.0.0.1:8765` 服务已经更新，而不是只更新桌面工作区源码。
- 项目下所有代码修改，最后效果都要能在本地页面 `http://127.0.0.1:8765/` 内看到。
- `8765` 常驻服务由 macOS LaunchAgent `com.chen.yikao-auto-config-web` 从 `/Users/chen/Library/Application Support/yikao-auto-config-web` 运行；不要假设它会直接读取桌面项目源码。
- 后续改动完成前，先运行同步脚本把当前项目文件同步到运行目录并重启服务：

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/sync_local_runtime.mjs
```

- 同步脚本成功后，再通过 `http://127.0.0.1:8765/` 的实际 HTTP 响应、Chrome 当前页面刷新后的 DOM/截图，或同等运行服务证据做效果检查；未完成这一步不得对用户说“已更新到页面/已修好”。

## 需求中心保护范围（2026-06-22）

- GitHub 合并提交 `6532369` 引入的需求中心由同事维护，后续改动不得修改该功能的页面、路由、API、数据库及测试。
- 保护文件包括 `server/requirement_request_api.mjs`、`server/requirement_request_db.py`、`server/test_requirement_request_*.{mjs,py}`、`web/pages/RequirementListPage.mjs`、`web/pages/RequirementDetailPage.mjs`。
- 对共享文件 `server/easy_exam_server.mjs`、`server/frontend_routes.mjs`、`web/router.mjs` 和 `outputs/web_prototype/easy_exam_automation.html` 做后续修改时，必须保留需求中心相关导入、路由、页面、事件和 API 分发逻辑。
- 后续功能修改仅限原有考试配置、考试列表、考试详情及其既有配套流程，不扩展或重构需求中心。

## 当前基准脚本

- 需求单生成/更新脚本：`/Users/chen/Desktop/ai 易考/update_exam_request_config_xlsx.mjs`
- 需求单输出文件：`/Users/chen/Desktop/ai 易考/outputs/exam_request/易考新建考试需求单.xlsx`
- 本地可执行网页服务：`/Users/chen/Desktop/ai 易考/server/easy_exam_server.mjs`
- Excel 解析器：`/Users/chen/Desktop/ai 易考/server/exam_request_parser.py`
- 浏览器自动化执行器：`/Users/chen/Desktop/ai 易考/server/easy_exam_runner.mjs`
- Node 运行时：`/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`
- 依赖：工作目录的 `node_modules` 已链接到 Codex primary runtime 依赖目录。

运行命令：

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node update_exam_request_config_xlsx.mjs

/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server/easy_exam_server.mjs
```

## 易考接口文档（2026-06-30）

- 租户内部 API 文档：`https://api-doc.eztest.cn/tenant-api/internal/#/`
- 后续涉及租户 API 路径、字段、鉴权、请求体或响应结构时，优先参考该文档。
- 不要把 API Key、Token、Cookie、账号密码等敏感信息写入源码、文档或项目记忆。

## 需求单结构

Excel 包含 3 个工作表：

- `业务需求单`：脚本读取和业务填写的主表。
- `填写示例`：字段示例。
- `脚本读取说明`：解析规则说明。

主表列结构：

| 列 | 含义 |
| --- | --- |
| A | 阶段 |
| B | 序号 |
| C | 配置项 |
| D | 需业务确认 |
| E | 填写内容 |
| F | 可选值/填写示例 |
| G | 脚本配置说明 |

## 当前已确认配置

基础信息：

| 配置项 | 当前值 |
| --- | --- |
| 考试名称 | 测试 |
| 考试开始时间 | 2026-06-01 09:00 |
| 考试结束时间 | 2026-06-02 10:00 |
| 提前登录时间 | 30 |
| 限制迟到时间 | 30 |
| 试卷扣时规则 | 迟到及离开扣时 |
| 场次类型 | 考试 |
| 考试地址 | 独立考试地址 |
| 交卷后跳转 | 不跳转 |
| 欢迎语 | 考生你好 |

选择试卷：

| 配置项 | 当前值 |
| --- | --- |
| 是否跳过试卷设置 | 是 |
| 试卷名称 | 空 |

个人信息：

| 配置项 | 当前值 |
| --- | --- |
| 允许编辑字段 | 无 |
| 考生可见字段 | 姓名,身份证号 |
| 必填字段 | 无 |
| 新增个人信息字段 | 不新增 |

注意：尝试新增“准考证号”时，页面提示“系统字段不可添加”。如后续页面出现内置“准考证号”可见项，再改为勾选内置项。

考试配置：

| 配置项 | 当前值 |
| --- | --- |
| 考试承诺书 | 是 |
| 考试承诺书内容 | 测试考试 |
| 视频监控 | 是 |
| 视频录制 | 是 |
| 鹰眼监控 | 是 |
| 锁定考试-限制登录次数 | 是 |
| 允许登录次数 | 5 |
| 客户端考试 | 是 |
| 允许客户端版本 | 电脑端 |
| 独占网络 | 是 |
| 禁用蓝牙 | 否 |
| 禁用智能输入法 | 否 |
| 答题水印 | 是 |
| 禁止复制 | 是 |
| 显示分值 | 否 |

完成：

| 配置项 | 当前值 |
| --- | --- |
| 是否允许脚本最终创建考试 | 否，停在确认页人工检查 |

## 页面操作注意事项

- 最终创建考试是副作用操作。除非用户明确要求“创建/提交/完成创建”，默认停在确认页人工检查。
- 基本信息页时间输入规则：考试开始/结束时间必须点击日期时间控件选择，打开面板后选择日期和时间并点击确认；不要用纯键盘直填时间。最后在确认页回读时间是否等于需求单。
- 提前登录和限制迟到输入优化：先勾选启用，再点击数字框、全选、直接输入分钟数，例如 `30`。不要用步进器按钮逐次增减。
- 当前页面曾出现确认页时间与需求单时间不一致的问题：需求单为 `2026-06-01 09:00` 到 `2026-06-02 10:00`，确认页曾显示为 `2026/06/02 00:00 - 2026/06/03 01:00`。最终提交前必须重新核对并修正时间。
- 用户习惯是“说一个配一个”。每次配置后应简短确认，并继续停留在当前配置页，除非用户要求下一步。
- 配置页面中“客户端考试”开启后，当前已勾选 `电脑端（Windows版/Mac版）`，未勾选移动端。
- 当前脚本已经把最近页面配置回写到 Excel，后续可以基于 `业务需求单` 的 E 列做自动配置。

## 最近一次回读核对结果

已确认 Excel 中以下字段写入成功：

```text
考试承诺书 = 是
考试承诺书内容 = 测试考试
视频监控 = 是
视频录制 = 是
鹰眼监控 = 是
锁定考试-限制登录次数 = 是
允许登录次数 = 5
客户端考试 = 是
允许客户端版本 = 电脑端
独占网络 = 是
答题水印 = 是
禁止复制 = 是
```
