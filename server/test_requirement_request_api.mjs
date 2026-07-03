import assert from "node:assert/strict";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRequirementRequestHandler } from "./requirement_request_api.mjs";
import {
  buildWechatRequirementDraft,
  loadWechatGroupConfig,
  pushWechatDraftToRequirementCenter,
} from "./wechat_requirement_collector.mjs";

function makeReq(method, pathname, body = null) {
  const req = Readable.from(body ? [JSON.stringify(body)] : []);
  req.method = method;
  req.url = pathname;
  return req;
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    bodyText: "",
    writeHead(code, headers = {}) {
      this.statusCode = code;
      this.headers = headers;
    },
    end(content = "") {
      this.bodyText = String(content);
      this.body = this.bodyText ? JSON.parse(this.bodyText) : null;
    },
  };
}

async function callRequirementHandler(method, pathname, body) {
  const dbPath = path.join(os.tmpdir(), `requirements-${Date.now()}-${Math.random()}.sqlite3`);
  const handler = createRequirementRequestHandler({ dbPath, pythonBin: "python3" });
  const req = makeReq(method, pathname, body);
  const res = makeRes();
  const handled = await handler(req, res, new URL(pathname, "http://127.0.0.1"));
  return { handled, statusCode: res.statusCode, body: res.body };
}

async function callHandler(handler, method, pathname, body) {
  const req = makeReq(method, pathname, body);
  const res = makeRes();
  const handled = await handler(req, res, new URL(pathname, "http://127.0.0.1"));
  return { handled, statusCode: res.statusCode, body: res.body };
}

function fetchFromRequirementHandler(handler) {
  return async (url, options = {}) => {
    const parsed = new URL(url);
    const body = options.body ? JSON.parse(options.body) : null;
    const result = await callHandler(handler, options.method || "GET", parsed.pathname, body);
    return {
      ok: result.statusCode >= 200 && result.statusCode < 300,
      status: result.statusCode,
      text: async () => JSON.stringify(result.body || {}),
    };
  };
}

function completeRequirementPayload() {
  return {
    exam_name: "2026招聘考试",
    formal_exam_time_range: "2026-07-01 09:00 - 2026-07-01 11:00",
    mock_exam_time_range: "2026-06-30 15:00 - 2026-06-30 16:00",
    early_login_minutes: "30分钟",
    late_limit_minutes: "15分钟",
    video_monitor_required: "是",
    video_record_required: "是",
    hawkeye_required: "否",
    exam_client_type: "网页考试",
    leave_limit_count: 8,
    subjects: "英语，化学，物理",
  };
}

test("Dify upsert route stores a requirement and returns missing fields", async () => {
  const result = await callRequirementHandler("POST", "/api/ai/requirements/upsert", {
    customer: { name: "ATA客户" },
    requirement: { exam_name: "2026招聘考试", exam_client_type: "网页考试" },
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.requirement.status, "collecting");
  assert.ok(result.body.requirement.latest.missingFields.includes("formal_exam_time_range"));
  assert.ok(result.body.requirement.latest.missingFields.includes("leave_limit_count"));
});

test("dispatch route stores object source metadata as text", async () => {
  const result = await callRequirementHandler("POST", "/api/ai/requirements/dispatch", {
    intent: "collecting",
    customer: { name: "内部测试客户" },
    requirement: completeRequirementPayload(),
    message: "微信群可见消息",
    source: {
      type: "wechat_group",
      groupName: "AI赋能运营自动化小组",
      projectName: "易考自动化需求",
    },
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.requirement.latest.source, JSON.stringify({
    type: "wechat_group",
    groupName: "AI赋能运营自动化小组",
    projectName: "易考自动化需求",
  }));
});

test("dispatch route stores analysis candidates as an audit event", async () => {
  const dbPath = path.join(os.tmpdir(), `requirements-${Date.now()}-${Math.random()}.sqlite3`);
  const handler = createRequirementRequestHandler({ dbPath, pythonBin: "python3" });
  const analysisCandidates = {
    enabled: true,
    merged: {
      fields: {
        subjects: { status: "llm_only", llmValue: ["数学"], evidence: ["客户：科目增加数学"], confidence: 0.91 },
      },
      conflicts: [],
    },
  };

  const created = await callHandler(handler, "POST", "/api/ai/requirements/dispatch", {
    intent: "collecting",
    requestId: "analysis-candidate-test",
    customer: { name: "内部测试客户" },
    requirement: completeRequirementPayload(),
    message: "客户：科目增加数学",
    source: { type: "wechat_group", groupName: "AI赋能运营自动化小组" },
    analysisCandidates,
  });
  const fetched = await callHandler(handler, "GET", "/api/requirements/analysis-candidate-test");

  assert.equal(created.statusCode, 200);
  const event = fetched.body.events.find((item) => item.eventType === "analysis_candidate_recorded");
  assert.ok(event);
  assert.equal(event.payload.analysisCandidates.merged.fields.subjects.status, "llm_only");
});

test("staff routes can mark a confirmed requirement ready and link a task", async () => {
  const dbPath = path.join(os.tmpdir(), `requirements-${Date.now()}-${Math.random()}.sqlite3`);
  const handler = createRequirementRequestHandler({ dbPath, pythonBin: "python3" });

  async function call(method, pathname, body) {
    const req = makeReq(method, pathname, body);
    const res = makeRes();
    const handled = await handler(req, res, new URL(pathname, "http://127.0.0.1"));
    return { handled, statusCode: res.statusCode, body: res.body };
  }

  const created = await call("POST", "/api/ai/requirements/upsert", {
    requirement: completeRequirementPayload(),
  });
  const requestId = created.body.requirement.requestId;
  await call("POST", `/api/ai/requirements/${requestId}/customer-confirmed`, {
    customerReply: "确认",
  });
  const ready = await call("POST", `/api/requirements/${requestId}/mark-ready`, {
    reviewer: "admin-op",
  });
  const linked = await call("POST", `/api/requirements/${requestId}/link-task`, {
    taskId: "task-10001",
  });

  assert.equal(ready.body.requirement.status, "ready_for_manual_execution");
  assert.equal(linked.body.requirement.status, "linked_to_execution_task");
  assert.equal(linked.body.requirement.linkedTaskId, "task-10001");
});

test("customer confirmation does not bypass manual execution readiness", async () => {
  const dbPath = path.join(os.tmpdir(), `requirements-${Date.now()}-${Math.random()}.sqlite3`);
  const handler = createRequirementRequestHandler({ dbPath, pythonBin: "python3" });

  async function call(method, pathname, body) {
    const req = makeReq(method, pathname, body);
    const res = makeRes();
    const handled = await handler(req, res, new URL(pathname, "http://127.0.0.1"));
    return { handled, statusCode: res.statusCode, body: res.body };
  }

  const created = await call("POST", "/api/ai/requirements/upsert", {
    requirement: completeRequirementPayload(),
  });
  const requestId = created.body.requirement.requestId;

  const confirmed = await call("POST", `/api/ai/requirements/${requestId}/customer-confirmed`, {
    customerReply: "客户确认",
    conversationId: "conv-200",
  });
  const rejectedLink = await call("POST", `/api/requirements/${requestId}/link-task`, {
    taskId: "manual-task-001",
  });
  const ready = await call("POST", `/api/requirements/${requestId}/mark-ready`, {
    reviewer: "ops-a",
  });
  const linked = await call("POST", `/api/requirements/${requestId}/link-task`, {
    taskId: "manual-task-001",
  });

  assert.equal(confirmed.body.requirement.status, "customer_confirmed");
  assert.equal(rejectedLink.statusCode, 400);
  assert.match(rejectedLink.body.error, /ready for manual execution/);
  assert.equal(ready.body.requirement.status, "ready_for_manual_execution");
  assert.equal(linked.body.requirement.status, "linked_to_execution_task");
});

test("staff routes can request clarification and mark reviewed", async () => {
  const dbPath = path.join(os.tmpdir(), `requirements-${Date.now()}-${Math.random()}.sqlite3`);
  const handler = createRequirementRequestHandler({ dbPath, pythonBin: "python3" });

  async function call(method, pathname, body) {
    const req = makeReq(method, pathname, body);
    const res = makeRes();
    const handled = await handler(req, res, new URL(pathname, "http://127.0.0.1"));
    return { handled, statusCode: res.statusCode, body: res.body };
  }

  const created = await call("POST", "/api/ai/requirements/upsert", {
    requirement: completeRequirementPayload(),
  });
  const requestId = created.body.requirement.requestId;

  const clarification = await call("POST", `/api/requirements/${requestId}/request-clarification`, {
    reviewer: "ops-a",
    message: "请补充考生名单模板要求",
    questions: ["是否需要我们提供考生名单模板？", "考生名单预计什么时候确认？"],
    missingFields: ["candidate_template_required"],
  });
  const reviewed = await call("POST", `/api/requirements/${requestId}/mark-reviewed`, {
    reviewer: "ops-a",
    message: "字段已核对，等待客户确认",
  });

  assert.equal(clarification.statusCode, 200);
  assert.equal(clarification.body.requirement.status, "need_customer_clarification");
  const clarificationEvent = clarification.body.requirement.events.find(
    (event) => event.eventType === "customer_clarification_requested",
  );
  assert.ok(clarificationEvent);
  assert.deepEqual(clarificationEvent.payload.questions, [
    "是否需要我们提供考生名单模板？",
    "考生名单预计什么时候确认？",
  ]);
  assert.deepEqual(clarificationEvent.payload.missingFields, ["candidate_template_required"]);
  assert.match(clarificationEvent.payload.customerPrompt, new RegExp(requestId));
  assert.match(clarificationEvent.payload.customerPrompt, /请补充以下信息/);
  assert.match(clarificationEvent.payload.customerPrompt, /是否需要我们提供考生名单模板/);
  assert.equal(reviewed.statusCode, 200);
  assert.equal(reviewed.body.requirement.status, "reviewed_waiting_customer_confirmation");
});

test("Dify dispatch route records customer confirmation intent", async () => {
  const dbPath = path.join(os.tmpdir(), `requirements-${Date.now()}-${Math.random()}.sqlite3`);
  const handler = createRequirementRequestHandler({ dbPath, pythonBin: "python3" });

  async function call(method, pathname, body) {
    const req = makeReq(method, pathname, body);
    const res = makeRes();
    const handled = await handler(req, res, new URL(pathname, "http://127.0.0.1"));
    return { handled, statusCode: res.statusCode, body: res.body };
  }

  const created = await call("POST", "/api/ai/requirements/upsert", {
    requirement: completeRequirementPayload(),
  });
  const requestId = created.body.requirement.requestId;

  const confirmed = await call("POST", "/api/ai/requirements/dispatch", {
    intent: "customer_confirmed",
    requestId,
    customer_summary: "考试名称：2026招聘考试；客户确认无误。",
    customerReply: "确认无误",
    conversationId: "conv-dispatch-1",
  });

  assert.equal(confirmed.handled, true);
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.body.ok, true);
  assert.equal(confirmed.body.action, "customer_confirmed");
  assert.equal(confirmed.body.requirement.status, "customer_confirmed");
  assert.equal(confirmed.body.requirement.confirmations[0].conversationId, "conv-dispatch-1");
});

test("Dify dispatch route records change request intent", async () => {
  const dbPath = path.join(os.tmpdir(), `requirements-${Date.now()}-${Math.random()}.sqlite3`);
  const handler = createRequirementRequestHandler({ dbPath, pythonBin: "python3" });

  async function call(method, pathname, body) {
    const req = makeReq(method, pathname, body);
    const res = makeRes();
    const handled = await handler(req, res, new URL(pathname, "http://127.0.0.1"));
    return { handled, statusCode: res.statusCode, body: res.body };
  }

  const created = await call("POST", "/api/ai/requirements/upsert", {
    requirement: completeRequirementPayload(),
  });
  const requestId = created.body.requirement.requestId;
  await call("POST", `/api/ai/requirements/${requestId}/customer-confirmed`, {
    customerReply: "确认",
  });

  const changed = await call("POST", "/api/ai/requirements/dispatch", {
    intent: "change_request",
    requestId,
    customerMessage: "请增加数学科目",
    changes: {
      subjects: "英语，化学，物理，数学",
    },
  });

  assert.equal(changed.handled, true);
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.body.ok, true);
  assert.equal(changed.body.action, "change_request");
  assert.equal(changed.body.requirement.status, "change_requested");
  assert.equal(changed.body.requirement.changeRequests[0].changes.subjects.join("，"), "英语，化学，物理，数学");
});

test("requirement center deduplicates identical pending change requests", async () => {
  const dbPath = path.join(os.tmpdir(), `requirements-${Date.now()}-${Math.random()}.sqlite3`);
  const handler = createRequirementRequestHandler({ dbPath, pythonBin: "python3" });

  async function call(method, pathname, body) {
    const req = makeReq(method, pathname, body);
    const res = makeRes();
    const handled = await handler(req, res, new URL(pathname, "http://127.0.0.1"));
    return { handled, statusCode: res.statusCode, body: res.body };
  }

  const created = await call("POST", "/api/ai/requirements/upsert", {
    requirement: completeRequirementPayload(),
  });
  const requestId = created.body.requirement.requestId;
  const changePayload = {
    intent: "change_request",
    requestId,
    customerMessage: "考试时间改到 7 月 1 日 10 点到 12 点",
    changes: { formal_exam_time_range: "7 月 1 日 10 点到 12 点" },
  };

  const first = await call("POST", "/api/ai/requirements/dispatch", changePayload);
  const duplicate = await call("POST", "/api/ai/requirements/dispatch", changePayload);

  assert.equal(first.statusCode, 200);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.body.requirement.changeRequests.length, 1);
  assert.equal(duplicate.body.requirement.changeRequests[0].changeId, first.body.requirement.changeRequests[0].changeId);
  assert.equal(duplicate.body.requirement.events.filter((event) => event.eventType === "change_requested").length, 1);

  await call(
    "POST",
    `/api/requirements/${requestId}/change-requests/${first.body.requirement.changeRequests[0].changeId}/accept`,
    { reviewer: "admin-op" },
  );
  const repeatedAfterDecision = await call("POST", "/api/ai/requirements/dispatch", changePayload);

  assert.equal(repeatedAfterDecision.body.requirement.changeRequests.length, 2);
  assert.deepEqual(
    repeatedAfterDecision.body.requirement.changeRequests.map((item) => item.status).sort(),
    ["accepted", "pending_internal_review"],
  );
});

test("WeChat draft push stores a requirement and later change request in the real requirement center", async () => {
  const dbPath = path.join(os.tmpdir(), `requirements-${Date.now()}-${Math.random()}.sqlite3`);
  const handler = createRequirementRequestHandler({ dbPath, pythonBin: "python3" });
  const fetchImpl = fetchFromRequirementHandler(handler);
  const config = loadWechatGroupConfig({
    groups: [
      {
        group_name: "AI赋能运营自动化小组",
        project_name: "易考自动化需求",
        customer_name: "内部测试客户",
        requirement_request_id: "wechat-ai-ops",
        enabled: true,
      },
    ],
  });
  const initialDraft = buildWechatRequirementDraft({
    config,
    groupName: "AI赋能运营自动化小组",
    text: [
      "客户：考试名称是 2026 校招笔试。",
      "客户：正式考试 8 月 20 日上午 9 点到 11 点。",
      "客户：试考 8 月 19 日下午 3 点到 4 点。",
      "客户：科目是行测和英语，需要视频监控和录制，不需要鹰眼，网页考试，允许离开 3 次。",
      "客户：登录规则提前 30 分钟，迟到 15 分钟不能进。",
    ].join("\n"),
  });

  const created = await pushWechatDraftToRequirementCenter(initialDraft, {
    apiBase: "http://127.0.0.1:8765",
    requestId: "wechat-ai-ops",
    fetchImpl,
  });
  const changeDraft = buildWechatRequirementDraft({
    config,
    groupName: "AI赋能运营自动化小组",
    text: [
      "客户：考试时间改到 7-1 时间 10点-12点。",
      "客户：提前登录、迟到时间都是 30分钟。",
      "客户：本次不考英语，改成数学。",
    ].join("\n"),
  });
  const changed = await pushWechatDraftToRequirementCenter(changeDraft, {
    apiBase: "http://127.0.0.1:8765",
    requestId: created.requestId,
    fetchImpl,
  });
  const stored = await callHandler(handler, "GET", "/api/requirements/wechat-ai-ops");

  assert.equal(created.requestId, "wechat-ai-ops");
  assert.equal(created.push.action, "upsert");
  assert.equal(changed.push, null);
  assert.equal(changed.changePushes.length, 1);
  assert.equal(stored.statusCode, 200);
  assert.equal(stored.body.requestId, "wechat-ai-ops");
  assert.equal(stored.body.status, "change_requested");
  assert.equal(stored.body.customer.name, "内部测试客户");
  assert.equal(stored.body.latest.requirement.exam_name, "2026 校招笔试");
  assert.deepEqual(stored.body.latest.requirement.subjects, ["行测", "英语"]);
  assert.equal(stored.body.versions.length, 1);
  assert.equal(stored.body.changeRequests.length, 1);
  assert.match(stored.body.changeRequests[0].customerMessage, /考试时间改到/);
  assert.equal(stored.body.changeRequests[0].changes.changeRecords.length, 3);
  assert.equal(stored.body.changeRequests[0].changes.changeRecords[0].type, "formal_exam_time_change");
  assert.deepEqual(stored.body.changeRequests[0].changes.latestRequirement.subjects, ["数学"]);
  assert.equal(JSON.parse(stored.body.latest.source).type, "wechat_group");
  assert.equal(JSON.parse(stored.body.latest.source).groupName, "AI赋能运营自动化小组");
});

test("staff can accept a pending change request into a new reviewed requirement version", async () => {
  const dbPath = path.join(os.tmpdir(), `requirements-${Date.now()}-${Math.random()}.sqlite3`);
  const handler = createRequirementRequestHandler({ dbPath, pythonBin: "python3" });

  const created = await callHandler(handler, "POST", "/api/ai/requirements/upsert", {
    requestId: "req-change-accept",
    customer: { name: "ATA客户" },
    requirement: completeRequirementPayload(),
    source: { type: "manual" },
    message: "初始需求",
  });
  const changed = await callHandler(handler, "POST", "/api/ai/requirements/dispatch", {
    intent: "change_request",
    requestId: created.body.requirement.requestId,
    customerMessage: "客户要求增加数学并改为 30 分钟迟到限制",
    changes: {
      latestRequirement: {
        ...completeRequirementPayload(),
        late_limit_minutes: "30分钟",
        subjects: ["英语", "化学", "物理", "数学"],
      },
    },
  });
  const changeId = changed.body.requirement.changeRequests[0].changeId;

  const accepted = await callHandler(
    handler,
    "POST",
    `/api/requirements/req-change-accept/change-requests/${changeId}/accept`,
    { reviewer: "ops-a", message: "变更内容已核对" },
  );

  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.requirement.status, "pending_internal_review");
  assert.equal(accepted.body.requirement.versions.length, 2);
  assert.equal(accepted.body.requirement.latest.version, 2);
  assert.equal(accepted.body.requirement.latest.requirement.late_limit_minutes, 30);
  assert.deepEqual(accepted.body.requirement.latest.requirement.subjects, ["英语", "化学", "物理", "数学"]);
  assert.equal(accepted.body.requirement.changeRequests[0].status, "accepted");
  assert.ok(accepted.body.requirement.events.some((event) => event.eventType === "change_request_accepted"));
});

test("staff can reject a pending change request without creating a new version", async () => {
  const dbPath = path.join(os.tmpdir(), `requirements-${Date.now()}-${Math.random()}.sqlite3`);
  const handler = createRequirementRequestHandler({ dbPath, pythonBin: "python3" });

  const created = await callHandler(handler, "POST", "/api/ai/requirements/upsert", {
    requestId: "req-change-reject",
    customer: { name: "ATA客户" },
    requirement: completeRequirementPayload(),
    source: { type: "manual" },
    message: "初始需求",
  });
  const changed = await callHandler(handler, "POST", "/api/ai/requirements/dispatch", {
    intent: "change_request",
    requestId: created.body.requirement.requestId,
    customerMessage: "客户误发的变更",
    changes: { subjects: ["数学"] },
  });
  const changeId = changed.body.requirement.changeRequests[0].changeId;

  const rejected = await callHandler(
    handler,
    "POST",
    `/api/requirements/req-change-reject/change-requests/${changeId}/reject`,
    { reviewer: "ops-b", reason: "客户确认误发" },
  );

  assert.equal(rejected.statusCode, 200);
  assert.equal(rejected.body.requirement.status, "pending_internal_review");
  assert.equal(rejected.body.requirement.versions.length, 1);
  assert.equal(rejected.body.requirement.changeRequests[0].status, "rejected");
  assert.ok(rejected.body.requirement.events.some((event) => event.eventType === "change_request_rejected"));
});
