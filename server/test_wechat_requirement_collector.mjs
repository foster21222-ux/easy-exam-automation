import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChangeRequestPayload,
  buildRequirementCenterPayload,
  buildWechatRequirementDraft,
  filterWechatMessagesByCheckpoint,
  loadWechatGroupConfig,
  parseWechatRequirementMessages,
  pushRequirementCenterPayload,
  pushWechatDraftToRequirementCenter,
} from "./wechat_requirement_collector.mjs";

const sampleConfig = {
  groups: [
    {
      group_name: "AI赋能运营自动化小组",
      project_name: "易考自动化需求",
      customer_name: "内部测试客户",
      enabled: true,
      interval_minutes: 15,
    },
    {
      group_name: "某客户考试项目群",
      project_name: "某客户校招考试",
      customer_name: "某客户",
      enabled: true,
      interval_minutes: 15,
    },
  ],
};

const configuredRequestConfig = {
  groups: [
    {
      group_name: "AI赋能运营自动化小组",
      project_name: "易考自动化需求",
      customer_name: "内部测试客户",
      requirement_request_id: "wechat-ai-ops",
      enabled: true,
    },
  ],
};

const sampleChat = `
2026/06/23 09:02 项目经理：
客户启动会确认，考试名称是 2026 校招笔试。

2026/06/23 09:06 客户张：
正式考试 8 月 20 日上午 9 点到 11 点，试考 8 月 19 日下午 3 点到 4 点。

2026/06/23 09:08 客户张：
科目是行测和英语，需要视频监控和录制，不需要鹰眼，网页考试，允许离开 3 次。

2026/06/23 09:15 项目经理：
登录规则先按提前 30 分钟，迟到 15 分钟不能进。

2026/06/23 10:20 客户张：
变更一下，科目增加数学。
`;

test("loads multi-group config and resolves the target group", () => {
  const config = loadWechatGroupConfig(sampleConfig);

  assert.equal(config.groups.length, 2);
  assert.equal(config.groups[0].groupName, "AI赋能运营自动化小组");
  assert.equal(config.groups[0].projectName, "易考自动化需求");
  assert.equal(config.groups[0].intervalMinutes, 15);
});

test("loads stable requirement request id from group config", () => {
  const config = loadWechatGroupConfig(configuredRequestConfig);

  assert.equal(config.groups[0].requirementRequestId, "wechat-ai-ops");
});

test("preserves explicit zero interval from group config for validation", () => {
  const config = loadWechatGroupConfig({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      interval_minutes: 0,
      enabled: true,
    }],
  });

  assert.equal(config.groups[0].intervalMinutes, 0);
});

test("parses visible WeChat messages into a requirement draft", () => {
  const config = loadWechatGroupConfig(sampleConfig);
  const draft = buildWechatRequirementDraft({
    config,
    groupName: "AI赋能运营自动化小组",
    text: sampleChat,
  });

  assert.equal(draft.source.type, "wechat_group");
  assert.equal(draft.source.groupName, "AI赋能运营自动化小组");
  assert.equal(draft.project.projectName, "易考自动化需求");
  assert.equal(draft.project.customerName, "内部测试客户");
  assert.equal(draft.requirement.exam_name, "2026 校招笔试");
  assert.equal(draft.requirement.formal_exam_time_range, "8 月 20 日上午 9 点到 11 点");
  assert.equal(draft.requirement.mock_exam_time_range, "8 月 19 日下午 3 点到 4 点");
  assert.deepEqual(draft.requirement.subjects, ["行测", "英语", "数学"]);
  assert.equal(draft.requirement.video_monitor_required, "是");
  assert.equal(draft.requirement.video_record_required, "是");
  assert.equal(draft.requirement.hawkeye_required, "否");
  assert.equal(draft.requirement.exam_client_type, "网页考试");
  assert.equal(draft.requirement.leave_limit_count, 3);
  assert.equal(draft.requirement.early_login_minutes, "30分钟");
  assert.equal(draft.requirement.late_limit_minutes, "15分钟");
  assert.deepEqual(draft.unresolvedQuestions, []);
  assert.equal(draft.changeRecords.length, 1);
  assert.match(draft.changeRecords[0].message, /科目增加数学/);
  assert.match(draft.checkpoint.lastMessageHash, /^[a-f0-9]{64}$/);
});

test("reports unresolved questions when required fields are missing", () => {
  const messages = parseWechatRequirementMessages("客户：考试叫产品认证考试，科目是语文。");

  assert.equal(messages.requirement.exam_name, "产品认证考试");
  assert.deepEqual(messages.requirement.subjects, ["语文"]);
  assert.ok(messages.unresolvedQuestions.some((question) => question.includes("正式考试时间")));
  assert.ok(messages.unresolvedQuestions.some((question) => question.includes("试考时间")));
});

test("filters copied WeChat text using the previous checkpoint hash", () => {
  const first = parseWechatRequirementMessages("客户：考试叫产品认证考试。\n客户：科目是语文。");
  const copiedAgain = [
    "客户：考试叫产品认证考试。",
    "客户：科目是语文。",
    "客户：正式考试 9 月 1 日上午 9 点到 10 点。",
  ].join("\n");

  const filtered = filterWechatMessagesByCheckpoint(copiedAgain, first.checkpoint);

  assert.equal(filtered.text, "客户：正式考试 9 月 1 日上午 9 点到 10 点。");
  assert.equal(filtered.skippedCount, 2);
});

test("filters already-seen messages when the previous last line has scrolled out of view", () => {
  const first = parseWechatRequirementMessages([
    "客户：考试叫产品认证考试。",
    "客户：科目是语文。",
  ].join("\n"));
  const shiftedViewport = [
    "客户：考试叫产品认证考试。",
    "客户：正式考试 9 月 1 日上午 9 点到 10 点。",
  ].join("\n");

  const filtered = filterWechatMessagesByCheckpoint(shiftedViewport, first.checkpoint);

  assert.equal(filtered.text, "客户：正式考试 9 月 1 日上午 9 点到 10 点。");
  assert.equal(filtered.skippedCount, 1);
  assert.equal(first.checkpoint.seenMessageHashes.length, 2);
});

test("builds requirement-center payload from a WeChat draft", () => {
  const config = loadWechatGroupConfig(sampleConfig);
  const draft = buildWechatRequirementDraft({
    config,
    groupName: "AI赋能运营自动化小组",
    text: sampleChat,
  });

  const payload = buildRequirementCenterPayload(draft, { requestId: "wechat-ai-ops" });

  assert.equal(payload.intent, "collecting");
  assert.equal(payload.requestId, "wechat-ai-ops");
  assert.equal(payload.customer.name, "内部测试客户");
  assert.equal(payload.requirement.exam_name, "2026 校招笔试");
  assert.deepEqual(payload.requirement.subjects, ["行测", "英语", "数学"]);
  assert.equal(payload.source.type, "wechat_group");
  assert.equal(payload.source.groupName, "AI赋能运营自动化小组");
  assert.equal(payload.source.projectName, "易考自动化需求");
  assert.match(payload.message, /正式考试 8 月 20 日上午 9 点到 11 点/);
  assert.match(payload.message, /变更一下，科目增加数学/);
});

test("adds LLM analysis candidates to collecting payload when present", () => {
  const config = loadWechatGroupConfig(sampleConfig);
  const draft = buildWechatRequirementDraft({
    config,
    groupName: "AI赋能运营自动化小组",
    text: sampleChat,
  });
  draft.analysisCandidates = {
    enabled: true,
    merged: { fields: { subjects: { status: "consistent", evidence: ["科目增加数学"] } }, conflicts: [] },
  };

  const payload = buildRequirementCenterPayload(draft);

  assert.equal(payload.analysisCandidates.enabled, true);
  assert.equal(payload.analysisCandidates.merged.fields.subjects.status, "consistent");
});

test("appends downloaded attachment previews to requirement-center audit message", () => {
  const config = loadWechatGroupConfig(sampleConfig);
  const draft = buildWechatRequirementDraft({
    config,
    groupName: "AI赋能运营自动化小组",
    text: sampleChat,
  });

  const payload = buildRequirementCenterPayload(draft, {
    attachments: [
      {
        name: "需求单.xlsx",
        kind: "spreadsheet",
        sizeBytes: 16031,
        modifiedAt: "2026-06-24T08:00:00.000Z",
        preview: "考试名称\n附件中的考试",
      },
    ],
  });

  assert.match(payload.message, /微信群已下载附件/);
  assert.match(payload.message, /需求单\.xlsx/);
  assert.match(payload.message, /考试名称/);
  assert.equal(payload.source.attachmentCount, 1);
  assert.equal(payload.source.attachments[0].name, "需求单.xlsx");
});

test("adds attachment metadata to change-request payload without changing customer message", () => {
  const config = loadWechatGroupConfig(configuredRequestConfig);
  const draft = buildWechatRequirementDraft({
    config,
    groupName: "AI赋能运营自动化小组",
    text: "客户：变更一下，科目增加数学。",
  });

  const payload = buildChangeRequestPayload(draft, "wechat-ai-ops", {
    attachments: [{ name: "变更说明.txt", kind: "text", sizeBytes: 20, modifiedAt: "2026-06-24T08:00:00.000Z", preview: "改为数学" }],
  });

  assert.equal(payload.customerMessage, "客户：变更一下，科目增加数学。");
  assert.equal(payload.source.attachmentCount, 1);
  assert.equal(payload.changes.attachments[0].name, "变更说明.txt");
});

test("builds change-request payload from WeChat change records", () => {
  const config = loadWechatGroupConfig(configuredRequestConfig);
  const draft = buildWechatRequirementDraft({
    config,
    groupName: "AI赋能运营自动化小组",
    text: sampleChat,
  });

  const payload = buildChangeRequestPayload(draft, "wechat-ai-ops");

  assert.equal(payload.intent, "change_request");
  assert.equal(payload.requestId, "wechat-ai-ops");
  assert.match(payload.customerMessage, /科目增加数学/);
  assert.equal(payload.source.type, "wechat_group");
  assert.equal(payload.source.groupName, "AI赋能运营自动化小组");
  assert.equal(payload.changes.changeRecords[0].type, "subject_change");
  assert.deepEqual(payload.changes.latestRequirement.subjects, ["行测", "英语", "数学"]);
});

test("adds LLM analysis candidates to change-request payload when present", () => {
  const config = loadWechatGroupConfig(configuredRequestConfig);
  const draft = buildWechatRequirementDraft({
    config,
    groupName: "AI赋能运营自动化小组",
    text: "客户：变更一下，科目增加数学。",
  });
  draft.analysisCandidates = {
    enabled: true,
    merged: { fields: { subjects: { status: "llm_only", evidence: ["科目增加数学"] } }, conflicts: [] },
  };

  const payload = buildChangeRequestPayload(draft, "wechat-ai-ops");

  assert.equal(payload.analysisCandidates.enabled, true);
  assert.equal(payload.analysisCandidates.merged.fields.subjects.status, "llm_only");
});

test("parses real WeChat change wording for time subjects and login limits", () => {
  const config = loadWechatGroupConfig(configuredRequestConfig);
  const draft = buildWechatRequirementDraft({
    config,
    groupName: "AI赋能运营自动化小组",
    text: [
      "客户：考试时间改到 7-1 时间 10点-12点。",
      "客户：提前登录、迟到时间都是 30分钟。",
      "客户：本次不考英语，改成数学。",
    ].join("\n"),
  });

  assert.equal(draft.requirement.formal_exam_time_range, "7-1 时间 10点-12点");
  assert.equal(draft.requirement.early_login_minutes, "30分钟");
  assert.equal(draft.requirement.late_limit_minutes, "30分钟");
  assert.deepEqual(draft.requirement.subjects, ["数学"]);
  assert.deepEqual(
    draft.changeRecords.map((record) => record.type),
    ["formal_exam_time_change", "login_window_change", "subject_change"],
  );
  assert.deepEqual(draft.changeRecords[0].changes, { formal_exam_time_range: "7-1 时间 10点-12点" });
  assert.deepEqual(draft.changeRecords[1].changes, {
    early_login_minutes: "30分钟",
    late_limit_minutes: "30分钟",
  });
  assert.deepEqual(draft.changeRecords[2].changes, {
    removedSubjects: ["英语"],
    subjects: ["数学"],
  });
});

test("parses the real OCR change messages split across chat bubbles", () => {
  const config = loadWechatGroupConfig(configuredRequestConfig);
  const draft = buildWechatRequirementDraft({
    config,
    groupName: "AI赋能运营自动化小组",
    text: [
      "考试时间改到7-1号",
      "Leo",
      "时间10点~12点",
      "提前登陆，迟到时间都是30分钟",
      "本次不考英语了，改成数学吧",
    ].join("\n"),
  });

  assert.equal(draft.requirement.formal_exam_time_range, "7-1号 时间10点~12点");
  assert.equal(draft.requirement.early_login_minutes, "30分钟");
  assert.equal(draft.requirement.late_limit_minutes, "30分钟");
  assert.deepEqual(draft.requirement.subjects, ["数学"]);
  assert.deepEqual(draft.changeRecords.map((record) => record.type), [
    "formal_exam_time_change",
    "login_window_change",
    "subject_change",
  ]);
  assert.deepEqual(draft.changeRecords[2].changes, {
    removedSubjects: ["英语"],
    subjects: ["数学"],
  });
});

test("pushes requirement-center payload to the dispatch API", async () => {
  const calls = [];
  const payload = {
    intent: "collecting",
    customer: { name: "内部测试客户" },
    requirement: { exam_name: "2026 校招笔试" },
    message: "客户：考试名称是 2026 校招笔试。",
    source: { type: "wechat_group", groupName: "AI赋能运营自动化小组" },
  };

  const result = await pushRequirementCenterPayload(payload, {
    apiBase: "http://127.0.0.1:8765/",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, requirement: { requestId: "req-001" } }),
      };
    },
  });

  assert.equal(calls[0].url, "http://127.0.0.1:8765/api/ai/requirements/dispatch");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].options.body), payload);
  assert.equal(result.requirement.requestId, "req-001");
});

test("pushes a WeChat draft and then routes parsed changes to the same request", async () => {
  const calls = [];
  const config = loadWechatGroupConfig(configuredRequestConfig);
  const draft = buildWechatRequirementDraft({
    config,
    groupName: "AI赋能运营自动化小组",
    text: sampleChat,
  });

  const result = await pushWechatDraftToRequirementCenter(draft, {
    apiBase: "http://127.0.0.1:8765",
    requestId: "wechat-ai-ops",
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, requirement: { requestId: "wechat-ai-ops" } }),
      };
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.intent, "collecting");
  assert.equal(calls[0].body.requestId, "wechat-ai-ops");
  assert.equal(calls[1].body.intent, "change_request");
  assert.equal(calls[1].body.requestId, "wechat-ai-ops");
  assert.match(calls[1].body.customerMessage, /科目增加数学/);
  assert.equal(result.requestId, "wechat-ai-ops");
  assert.equal(result.changePushes.length, 1);
});

test("pushes only a change request when the WeChat draft contains only change messages", async () => {
  const calls = [];
  const config = loadWechatGroupConfig(configuredRequestConfig);
  const draft = buildWechatRequirementDraft({
    config,
    groupName: "AI赋能运营自动化小组",
    text: "客户：变更一下，科目增加数学。",
  });

  const result = await pushWechatDraftToRequirementCenter(draft, {
    apiBase: "http://127.0.0.1:8765",
    requestId: "wechat-ai-ops",
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, action: "change_request", requirement: { requestId: "wechat-ai-ops" } }),
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.intent, "change_request");
  assert.equal(calls[0].body.requestId, "wechat-ai-ops");
  assert.match(calls[0].body.customerMessage, /科目增加数学/);
  assert.equal(result.requestId, "wechat-ai-ops");
  assert.equal(result.push, null);
  assert.equal(result.changePushes.length, 1);
});

test("routes OCR change fields without overwriting the requirement when sender labels are present", async () => {
  const calls = [];
  const config = loadWechatGroupConfig(configuredRequestConfig);
  const draft = buildWechatRequirementDraft({
    config,
    groupName: "AI赋能运营自动化小组",
    text: [
      "Leo",
      "考试时间改到7-1号",
      "时间10点~12点",
      "提前登陆，迟到时间都是30分钟",
      "vousmevoyez",
      "本次不考英语了，改成数学吧",
      "以上收到",
    ].join("\n"),
  });

  const result = await pushWechatDraftToRequirementCenter(draft, {
    requestId: "wechat-ai-ops",
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, action: "change_request", requirement: { requestId: "wechat-ai-ops" } }),
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.intent, "change_request");
  assert.equal(result.push, null);
  assert.equal(result.changePushes.length, 1);
});

test("does not push an empty WeChat draft after checkpoint filtering", async () => {
  let fetchCalled = false;
  const config = loadWechatGroupConfig(configuredRequestConfig);
  const draft = buildWechatRequirementDraft({
    config,
    groupName: "AI赋能运营自动化小组",
    text: "",
  });

  const result = await pushWechatDraftToRequirementCenter(draft, {
    apiBase: "http://127.0.0.1:8765",
    requestId: "wechat-ai-ops",
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("fetch should not be called for empty drafts");
    },
  });

  assert.equal(fetchCalled, false);
  assert.equal(result.skipped, "no_new_messages");
  assert.equal(result.requestId, "wechat-ai-ops");
  assert.equal(result.push, null);
  assert.equal(result.changePushes.length, 0);
});
