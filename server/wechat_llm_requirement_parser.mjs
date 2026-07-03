const ALLOWED_REQUIREMENT_FIELDS = new Set([
  "exam_name",
  "formal_exam_time_range",
  "mock_exam_time_range",
  "early_login_minutes",
  "late_limit_minutes",
  "video_monitor_required",
  "video_record_required",
  "hawkeye_required",
  "exam_client_type",
  "leave_limit_count",
  "subjects",
]);

const DEFAULT_FIELDS = new Set(["watermark_enabled", "copy_forbidden"]);

export function sanitizeLlmRequirementCandidate(candidate = {}) {
  const requirementCandidates = {};
  for (const [field, item] of Object.entries(candidate.requirementCandidates || {})) {
    if (!isAllowedField(field)) continue;
    const normalized = normalizeCandidateValue(item);
    if (!normalized) continue;
    requirementCandidates[field] = normalized;
  }

  const changeCandidates = [];
  for (const item of candidate.changeCandidates || []) {
    const evidence = normalizeEvidence(item.evidence);
    if (!evidence.length) continue;
    const changes = {};
    for (const [field, value] of Object.entries(item.changes || {})) {
      if (!isAllowedField(field)) continue;
      changes[field] = value;
    }
    if (!Object.keys(changes).length) continue;
    changeCandidates.push({
      type: String(item.type || "requirement_change"),
      message: String(item.message || evidence[0] || ""),
      changes,
      evidence,
      confidence: normalizeConfidence(item.confidence),
    });
  }

  return {
    requirementCandidates,
    changeCandidates,
    unresolvedQuestions: normalizeUnresolvedQuestions(candidate.unresolvedQuestions || []),
  };
}

export function mergeRuleAndLlmCandidates(ruleResult = {}, llmCandidate = {}) {
  const fields = {};
  const conflicts = [];
  const ruleRequirement = ruleResult.requirement || {};
  for (const [field, item] of Object.entries(llmCandidate.requirementCandidates || {})) {
    const ruleValue = ruleRequirement[field];
    const llmValue = item.value;
    const status = ruleValue === undefined || ruleValue === "" || (Array.isArray(ruleValue) && !ruleValue.length)
      ? "llm_only"
      : (stableJson(ruleValue) === stableJson(llmValue) ? "consistent" : "conflict");
    fields[field] = {
      status,
      ruleValue,
      llmValue,
      evidence: item.evidence || [],
      confidence: item.confidence,
    };
    if (status === "conflict") conflicts.push({ field, ruleValue, llmValue, evidence: item.evidence || [] });
  }
  return {
    fields,
    conflicts,
    changeCandidates: llmCandidate.changeCandidates || [],
    unresolvedQuestions: llmCandidate.unresolvedQuestions || [],
  };
}

export async function parseWechatRequirementWithLlm({
  text,
  ruleResult = {},
  config = {},
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!config.enabled) return { enabled: false };
  if (!config.apiKey) return { enabled: true, error: "LLM API key is not configured" };
  if (typeof fetchImpl !== "function") return { enabled: true, error: "fetch is not available" };

  const endpoint = config.endpoint || "https://api.openai.com/v1/responses";
  const model = config.model || "gpt-4.1-mini";
  const provider = config.provider || "openai";
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${normalizeApiKey(config.apiKey)}`,
      },
      body: JSON.stringify(buildRequestBody({ provider, model, text, ruleResult })),
    });
  } catch (error) {
    return { enabled: true, error: `LLM request failed: ${error instanceof Error ? error.message.replace(/Bearer\s+\S+/g, "Bearer ***") : String(error)}` };
  }
  const rawText = await response.text();
  if (!response.ok) return { enabled: true, error: `LLM request failed: HTTP ${response.status}`, raw: rawText };
  const parsed = parseLlmResponseJson(rawText);
  if (!parsed.ok) return { enabled: true, error: parsed.error, raw: rawText };
  const sanitized = sanitizeLlmRequirementCandidate(parsed.value);
  return {
    enabled: true,
    provider,
    model,
    ...sanitized,
    merged: mergeRuleAndLlmCandidates(ruleResult, sanitized),
  };
}

function normalizeApiKey(value) {
  return String(value || "").replace(/\s+/g, "");
}

function buildRequestBody({ provider, model, text, ruleResult }) {
  const messages = buildPrompt({ text, ruleResult });
  if (provider === "qwen") {
    return {
      model,
      messages,
      temperature: 0,
    };
  }
  return {
    model,
    input: messages,
    temperature: 0,
  };
}

function isAllowedField(field) {
  return ALLOWED_REQUIREMENT_FIELDS.has(field) && !DEFAULT_FIELDS.has(field);
}

function normalizeCandidateValue(item) {
  const evidence = normalizeEvidence(item?.evidence);
  if (!evidence.length) return null;
  if (!Object.prototype.hasOwnProperty.call(item || {}, "value")) return null;
  return {
    value: item.value,
    evidence,
    confidence: normalizeConfidence(item.confidence),
  };
}

function normalizeEvidence(value) {
  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  if (number < 0) return 0;
  if (number > 1) return 1;
  return number;
}

function normalizeUnresolvedQuestions(value) {
  return value.map((item) => ({
    field: ALLOWED_REQUIREMENT_FIELDS.has(item?.field) ? item.field : "",
    question: String(item?.question || "").trim(),
    reason: String(item?.reason || "").trim(),
  })).filter((item) => item.field && item.question);
}

function parseLlmResponseJson(rawText) {
  try {
    const body = JSON.parse(rawText || "{}");
    const outputText = body.output_text || body.choices?.[0]?.message?.content || body.content || "";
    return { ok: true, value: JSON.parse(outputText) };
  } catch (error) {
    return { ok: false, error: `LLM output is not valid JSON: ${error.message}` };
  }
}

function buildPrompt({ text, ruleResult }) {
  return [
    {
      role: "system",
      content: [
        "你是考试服务需求解析器。只输出 JSON。",
        "只能基于原文证据抽取字段；没有证据不能填写。",
        "不要输出 watermark_enabled、copy_forbidden 或其他默认配置。",
        "字段仅限：exam_name, formal_exam_time_range, mock_exam_time_range, early_login_minutes, late_limit_minutes, video_monitor_required, video_record_required, hawkeye_required, exam_client_type, leave_limit_count, subjects。",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        wechatText: text || "",
        ruleResult: ruleResult || {},
        expectedJsonShape: {
          requirementCandidates: {
            subjects: { value: ["数学"], evidence: ["原文"], confidence: 0.9 },
          },
          changeCandidates: [
            { type: "subject_change", message: "原文", changes: { subjects: ["数学"] }, evidence: ["原文"], confidence: 0.9 },
          ],
          unresolvedQuestions: [
            { field: "formal_exam_time_range", question: "请确认正式考试时间。", reason: "原文未明确" },
          ],
        },
      }, null, 2),
    },
  ];
}

function stableJson(value) {
  if (Array.isArray(value)) return JSON.stringify([...value].sort());
  if (value && typeof value === "object") {
    return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
  }
  return JSON.stringify(value);
}
