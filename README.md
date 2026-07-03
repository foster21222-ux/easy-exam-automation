# 易考 AI 自动化

本项目用于把客户考试需求、微信群沟通记录和考生名单转成可执行的易考后台配置任务，并通过本地 `8765` 控制台完成审核、自动配置、进度追踪和结果下载。

## 功能介绍

- 本地 Web 控制台：默认运行在 `http://127.0.0.1:8765`，提供考试配置、项目管理、需求中心、微信采集、系统配置、用户管理和日志视图。
- Excel 需求单解析：导入易考需求单后解析基础信息、个人信息、考试配置、科目信息，并展示可审核的配置结果。
- 易考后台自动配置：使用 Playwright 接管浏览器，自动创建正式考试、试考、科目、考试提示、承诺书等配置。
- 任务进度追踪：按项目、考试任务和执行步骤保存状态，支持失败重试、人工继续绑定试卷、下载监考账号和成绩反馈单。
- 考生名单整理与导入：自动识别客户名单字段，校验准考证号、姓名、证件号，并通过租户 API 导入指定考试场次。
- 需求中心：支持 Dify 或内部接口写入客户需求，保留审核、客户确认、变更记录和执行任务关联。
- 微信需求采集：按微信群配置采集可见聊天内容和附件线索，生成需求中心记录，支持上线前预检、链路自检和运行历史。
- LLM 候选解析：可选接入 OpenAI 或千问兼容接口，只生成候选结构化结果和证据，由人工审核后进入需求流转。
- 腾讯文档同步：支持把考试配置同步到项目共享表，并保存同步状态与日志。
- 本机部署辅助：提供 launchd 模板、运行目录同步脚本和本地运行时隔离，避免上传文件、数据库、日志进入 Git 仓库。

## 运行环境

- Node.js 18+
- Python 3.10+
- 可访问易考后台的 Chrome 浏览器

## 快速开始

1. 克隆项目

```bash
git clone https://github.com/atachenjun-cm/easy-exam-automation.git
cd easy-exam-automation
```

2. 安装依赖

```bash
npm install
python3 -m pip install -r requirements.txt
```

3. 准备环境变量

```bash
cp .env.example .env
```

按需修改：

- `PORT`：本地服务端口，默认 `8765`
- `CODEX_PYTHON`：Python 3 可执行文件路径
- `YIKAO_API_BASE`：租户 API 地址，默认示例为 `https://eztest.cn`
- `YIKAO_API_KEY`：租户 API Key，只能放在本地 `.env` 中

4. 启动服务

```bash
npm start
```

5. 打开页面

```text
http://127.0.0.1:8765
```

## 使用方式

1. 在网页中配置易考后台登录地址、账号、密码和租户 API 信息。
2. 导入需求单 Excel，或从需求中心、微信群采集记录进入审核。
3. 核对正式考试、试考、科目、考生字段和高级文案配置。
4. 点击执行自动配置，观察项目、考试任务和步骤日志。
5. 在任务详情中继续处理试卷绑定、考生导入、共享表同步、监考账号和成绩反馈单下载。

## 考生名单整理与导入

页面中的“考生名单整理与导入”模块支持上传客户提供的 `.xlsx`、`.xls`、`.csv` 名单，自动识别并整理为租户 API 字段：

```text
permit | full_name | identity_id
```

字段识别规则：

- `full_name`：姓名、考生姓名、full_name、name
- `identity_id`：证件号、身份证号、身份证、证件号码、identity_id、ssn
- `permit`：准考证号、考号、考生编号、permit

导入前会校验：

- `permit`、`full_name`、`identity_id` 不能为空
- `permit` 不能重复
- `identity_id` 不能重复
- 身份证号和准考证号不能是科学计数法

整理完成后可以下载模板，也可以加载未过期考试场次，选择 `session_id - name` 后点击“确认导入到所选场次”。

后端调用租户 API：

```text
GET  /tenant/api/session/
POST /tenant/api/session/[session_id]/entry/
Authorization: Key ${YIKAO_API_KEY}
```

## 项目结构

```text
server/
  easy_exam_server.mjs      本地 Web 服务
  easy_exam_runner.mjs      Playwright 自动化主流程
  exam_request_parser.py    Excel 需求单解析
  candidate_list_parser.py  考生名单解析与模板生成
  fill_subject_template.py  科目导入模板填充
```

## 安全说明

- `.easy_exam_runtime/` 保存本地运行时登录配置、上传文件、截图，不会提交到 GitHub。
- `.env` 不提交到 GitHub，请只在本地使用。
- 请不要把账号密码、Cookie、Token 写入源码或提交到仓库。
- `uploads/`、`temp/`、`generated/`、`*.xlsx`、`*.xls`、`*.csv` 已加入忽略规则，客户名单和生成模板不会提交。
