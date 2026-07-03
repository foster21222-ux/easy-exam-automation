import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeRuleAndLlmCandidates,
  parseWechatRequirementWithLlm,
  sanitizeLlmRequirementCandidate,
} from "./wechat_llm_requirement_parser.mjs";

test("LLM candidate sanitizer keeps only whitelisted fields with evidence", () => {
  const candidate = sanitizeLlmRequirementCandidate({
    requirementCandidates: {
      subjects: { value: ["数学"], evidence: ["客户：科目增加数学"], confidence: 0.91 },
      watermark_enabled: { value: true, evidence: [], confidence: 0.99 },
      unknown_field: { value: "x", evidence: ["x"], confidence: 0.8 },
    },
    changeCandidates: [
      {
        type: "subject_change",
        message: "客户：科目增加数学",
        changes: { subjects: ["数学"], copy_forbidden: true },
        evidence: ["客户：科目增加数学"],
        confidence: 0.9,
      },
      { type: "bad", changes: { subjects: ["英语"] }, evidence: [], confidence: 0.9 },
    ],
    unresolvedQuestions: [{ field: "formal_exam_time_range", question: "请确认正式考试时间。", reason: "未提到" }],
  });

  assert.deepEqual(Object.keys(candidate.requirementCandidates), ["subjects"]);
  assert.deepEqual(candidate.changeCandidates[0].changes, { subjects: ["数学"] });
  assert.equal(candidate.changeCandidates.length, 1);
  assert.equal(candidate.unresolvedQuestions[0].field, "formal_exam_time_range");
});

test("merge marks consistent LLM fields, LLM-only candidates, and conflicts", () => {
  const merged = mergeRuleAndLlmCandidates(
    { requirement: { subjects: ["数学"], exam_client_type: "网页考试" } },
    {
      requirementCandidates: {
        subjects: { value: ["数学"], evidence: ["科目增加数学"], confidence: 0.9 },
        formal_exam_time_range: { value: "7月1日 10点-12点", evidence: ["考试时间 7月1日"], confidence: 0.86 },
        exam_client_type: { value: "客户端考试", evidence: ["客户端"], confidence: 0.8 },
      },
      changeCandidates: [],
      unresolvedQuestions: [],
    },
  );

  assert.equal(merged.fields.subjects.status, "consistent");
  assert.equal(merged.fields.formal_exam_time_range.status, "llm_only");
  assert.equal(merged.fields.exam_client_type.status, "conflict");
  assert.equal(merged.conflicts.length, 1);
});

test("parseWechatRequirementWithLlm calls OpenAI-compatible endpoint and validates JSON output", async () => {
  const calls = [];
  const result = await parseWechatRequirementWithLlm({
    text: "客户：科目增加数学。",
    ruleResult: { requirement: {}, changeRecords: [] },
    config: { enabled: true, apiKey: "test-key", model: "test-model", endpoint: "https://llm.example/v1/responses" },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          output_text: JSON.stringify({
            requirementCandidates: {
              subjects: { value: ["数学"], evidence: ["客户：科目增加数学。"], confidence: 0.9 },
            },
            changeCandidates: [],
            unresolvedQuestions: [],
          }),
        }),
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://llm.example/v1/responses");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-key");
  assert.deepEqual(result.requirementCandidates.subjects.value, ["数学"]);
  assert.equal(result.merged.fields.subjects.status, "llm_only");
});

test("parseWechatRequirementWithLlm removes whitespace from API key before request", async () => {
  const calls = [];
  await parseWechatRequirementWithLlm({
    text: "客户：科目增加数学。",
    ruleResult: { requirement: {}, changeRecords: [] },
    config: { enabled: true, apiKey: " test-\nkey ", model: "test-model", endpoint: "https://llm.example/v1/responses" },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          output_text: JSON.stringify({
            requirementCandidates: {},
            changeCandidates: [],
            unresolvedQuestions: [],
          }),
        }),
      };
    },
  });

  assert.equal(calls[0].options.headers.Authorization, "Bearer test-key");
});

test("parseWechatRequirementWithLlm supports Qwen OpenAI-compatible chat completions", async () => {
  const calls = [];
  const result = await parseWechatRequirementWithLlm({
    text: "客户：科目增加数学。",
    ruleResult: { requirement: {}, changeRecords: [] },
    config: {
      enabled: true,
      provider: "qwen",
      apiKey: "qwen-key",
      model: "qwen-plus",
      endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                requirementCandidates: {
                  subjects: { value: ["数学"], evidence: ["客户：科目增加数学。"], confidence: 0.9 },
                },
                changeCandidates: [],
                unresolvedQuestions: [],
              }),
            },
          }],
        }),
      };
    },
  });

  assert.equal(calls[0].url, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  assert.ok(Array.isArray(calls[0].body.messages));
  assert.equal(calls[0].body.model, "qwen-plus");
  assert.deepEqual(result.requirementCandidates.subjects.value, ["数学"]);
});

test("parseWechatRequirementWithLlm returns disabled result without network call", async () => {
  const result = await parseWechatRequirementWithLlm({
    text: "客户：科目增加数学。",
    ruleResult: { requirement: {}, changeRecords: [] },
    config: { enabled: false },
    fetchImpl: async () => {
      throw new Error("should not call network");
    },
  });

  assert.equal(result.enabled, false);
});
