# Dify 需求收集 API 接入说明

本文档用于配置 Dify Chatflow 的 HTTP Request 节点，把客户对话中收集到的考试服务需求写入 `easy-exam-automation` 的需求中心。

## 接入边界

Dify 负责：

- 通过多轮对话收集客户需求。
- 抽取结构化字段。
- 调用需求中心 API 创建或更新需求记录。
- 记录客户确认和客户变更请求。

需求中心负责：

- 持久化结构化需求。
- 展示缺失字段和校验问题。
- 展示版本、确认、变更和时间线。
- 让运营人员人工审核并决定是否进入人工执行交接。

本阶段 Dify 不负责创建考试、创建场次、绑定试卷、导入考生、导出监考账号，也不绕过人工审核。

## 推荐 Chatflow 顺序

1. 暂不收集客户基础信息；后续需要时再补客户名称、联系人、联系方式。
2. 收集考试基础信息：考试名称、正式考试时间、试考时间。试考默认都需要，只确认试考时间。
3. 收集登录和迟到规则：提前登录分钟数、迟到限制分钟数。
4. 收集监控与客户端要求：视频监控、视频录制、鹰眼、考试类型。
5. 收集网页考试控制项：允许离开次数。水印和禁止复制不向客户确认，需求中心默认开启。
6. 收集科目和考生名单要求。
7. 调用 `POST /api/ai/requirements/upsert` 写入或更新需求。
8. 如果返回 `missingFields` 非空，继续追问缺失项，并带同一个 `requestId` 再次 upsert。
9. 当客户确认内容无误，调用 `POST /api/ai/requirements/:requestId/customer-confirmed`。
10. 如果客户后续变更，调用 `POST /api/ai/requirements/:requestId/change-request`。

## Base URL

本地开发默认：

```text
http://127.0.0.1:8765
```

部署后改成实际服务地址。

## 创建或更新需求

```text
POST /api/ai/requirements/upsert
Content-Type: application/json
```

首次写入时可以不传 `requestId`。接口会返回 `requirement.requestId`，Dify 后续节点必须保存并复用它。

完整需求示例：

```json
{
  "customer": {},
  "requirement": {
    "exam_name": "2026招聘考试",
    "formal_exam_time_range": "2026-07-01 09:00 - 2026-07-01 11:00",
    "mock_exam_time_range": "2026-06-30 15:00 - 2026-06-30 16:00",
    "early_login_minutes": "30分钟",
    "late_limit_minutes": "15分钟",
    "waiting_notice": "请提前完成设备检测",
    "paper_time_rule": "进入考试后开始扣时",
    "welcome_message": "欢迎参加考试",
    "commitment_text": "本人承诺独立作答",
    "video_monitor_required": "是",
    "video_record_required": "是",
    "hawkeye_required": "否",
    "exam_client_type": "网页考试",
    "leave_limit_count": 8,
    "subjects": "英语，化学，物理",
    "candidate_template_required": "是",
    "notes": "客户补充说明"
  },
  "message": "Dify 第一次完整收集",
  "source": "dify"
}
```

`watermark_enabled` 和 `copy_forbidden` 不需要 Dify 收集；需求中心会默认写为 `true`。客户基础信息前期也可以为空对象。

响应示例：

```json
{
  "ok": true,
  "requirement": {
    "requestId": "REQ-ID",
    "status": "pending_internal_review",
    "latest": {
      "version": 1,
      "missingFields": [],
      "validationErrors": []
    }
  }
}
```

如果字段不完整，状态会是 `collecting`：

```json
{
  "ok": true,
  "requirement": {
    "requestId": "REQ-ID",
    "status": "collecting",
    "latest": {
      "missingFields": [
        "formal_exam_time_range",
        "mock_exam_time_range",
        "subjects"
      ],
      "validationErrors": []
    }
  }
}
```

Dify 应继续追问 `missingFields` 对应内容，然后再次调用 upsert：

```json
{
  "requestId": "REQ-ID",
  "customer": {},
  "requirement": {
    "exam_name": "2026招聘考试",
    "formal_exam_time_range": "2026-07-01 09:00 - 2026-07-01 11:00",
    "mock_exam_time_range": "2026-06-30 15:00 - 2026-06-30 16:00",
    "subjects": "英语，化学，物理"
  },
  "message": "补充正式考试时间、试考时间和科目",
  "source": "dify"
}
```

## 对话式分流入口

对话版 Chatflow 推荐调用统一分流入口，避免在 Dify 图里拆 JSON、拼动态 URL：

```text
POST /api/ai/requirements/dispatch
Content-Type: application/json
```

`intent=collecting` 或 `intent=ready_for_confirmation` 时，后端按 upsert 处理：

```json
{
  "intent": "ready_for_confirmation",
  "requestId": "REQ-ID",
  "customer": {},
  "requirement": {
    "exam_name": "校园招聘考试",
    "formal_exam_time_range": "2026-08-08 09:00 - 2026-08-08 11:00",
    "mock_exam_time_range": "2026-08-07 15:00 - 2026-08-07 16:00",
    "early_login_minutes": "30分钟",
    "late_limit_minutes": "15分钟",
    "video_monitor_required": "是",
    "video_record_required": "是",
    "hawkeye_required": "否",
    "exam_client_type": "网页考试",
    "leave_limit_count": 6,
    "subjects": "英语，数学"
  },
  "message": "Dify 对话抽取",
  "source": "dify"
}
```

`intent=customer_confirmed` 时，后端记录客户确认：

```json
{
  "intent": "customer_confirmed",
  "requestId": "REQ-ID",
  "customerReply": "确认无误",
  "conversationId": "dify-conversation-id"
}
```

`intent=change_request` 时，后端记录变更请求，不直接覆盖已确认版本：

```json
{
  "intent": "change_request",
  "requestId": "REQ-ID",
  "customerMessage": "请增加数学科目",
  "changes": {
    "subjects": "英语，化学，物理，数学"
  }
}
```

响应会包含 `action`，取值为 `upsert`、`customer_confirmed` 或 `change_request`。

## 查询需求

```text
GET /api/ai/requirements/:requestId
```

Dify 可以在后续节点里查询当前状态、缺失项和最新版本。

## 记录客户确认

```text
POST /api/ai/requirements/:requestId/customer-confirmed
Content-Type: application/json
```

请求：

```json
{
  "customerReply": "客户确认以上需求无误",
  "conversationId": "dify-conversation-id"
}
```

响应状态会变成：

```text
customer_confirmed
```

注意：客户确认不等于自动进入执行。运营人员仍需在 `/requirements` 页面人工审核，并手动标记为 `ready_for_manual_execution`。

## 记录客户变更

```text
POST /api/ai/requirements/:requestId/change-request
Content-Type: application/json
```

请求：

```json
{
  "customerMessage": "请增加政治科目",
  "changes": {
    "subjects": "英语，化学，物理，政治"
  }
}
```

响应状态会变成：

```text
change_requested
```

变更请求会单独记录，不直接覆盖已经确认的版本。运营人员审核后，再通过 staff 页面或 staff API 写入新的正式版本。

## 人工审核边界

运营人员在 `/requirements` 中处理以下动作：

- `need_customer_clarification`：需求需要客户补充。
- `reviewed_waiting_customer_confirmation`：人工审核通过，等待客户确认。
- `ready_for_manual_execution`：客户确认后，人工标记可进入后续人工执行交接。
- `linked_to_execution_task`：记录主版本或其他流程中创建的执行任务编号。

Dify 不应直接调用 staff API。

当运营人员标记 `need_customer_clarification` 时，应填写要发给客户的补充问题：

```json
{
  "reviewer": "admin-op",
  "message": "人工审核后需客户补充信息",
  "questions": [
    "请确认正式考试是否分批次。",
    "请确认考生名单预计何时提供。"
  ],
  "missingFields": [
    "formal_batch_rule",
    "candidate_list_time"
  ]
}
```

时间线事件会记录 `questions`、`missingFields` 和面向客户的 `customerPrompt`。`customerPrompt` 会包含 `需求编号`，这是跨 Dify 对话关联同一张需求单的锚点。管理页会展示这段补充话术，客户在 Dify 中继续回复这些问题时，应带上这段话术或需求编号，再由 Dify 合并到同一个需求草稿。

## 试运行检查清单

每轮试运行至少检查：

- Dify 是否复用了同一个 `requestId`。
- 缺失字段是否能被继续追问并补齐。
- 客户确认后是否没有绕过人工审核。
- 客户变更是否出现在变更记录里，而不是静默覆盖旧版本。
- `/requirements/:requestId` 是否能看到最新字段、版本历史、确认记录、变更记录和时间线。
