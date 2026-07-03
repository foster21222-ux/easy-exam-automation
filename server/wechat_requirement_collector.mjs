import crypto from "node:crypto";

const REQUIRED_FIELD_LABELS = {
  exam_name: "考试名称",
  formal_exam_time_range: "正式考试时间",
  mock_exam_time_range: "试考时间",
  early_login_minutes: "提前登录规则",
  late_limit_minutes: "迟到限制",
  video_monitor_required: "视频监控要求",
  video_record_required: "视频录制要求",
  hawkeye_required: "鹰眼要求",
  exam_client_type: "考试端类型",
  leave_limit_count: "允许离开次数",
  subjects: "考试科目",
};

export function loadWechatGroupConfig(input) {
  const raw = typeof input === "string" ? JSON.parse(input) : input || {};
  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  return {
    groups: groups.map((group) => {
      const rawInterval = group.interval_minutes ?? group.intervalMinutes ?? 15;
      return {
        groupName: String(group.group_name || group.groupName || "").trim(),
        projectName: String(group.project_name || group.projectName || "").trim(),
        customerName: String(group.customer_name || group.customerName || "").trim(),
        requirementRequestId: String(group.requirement_request_id || group.requirementRequestId || "").trim(),
        enabled: group.enabled !== false,
        intervalMinutes: Number(rawInterval),
      };
    }).filter((group) => group.groupName),
  };
}

export function validateWechatGroupConfig(config, { requireEnabled = false } = {}) {
  const groups = Array.isArray(config?.groups) ? config.groups : [];
  const seen = new Set();
  let enabledCount = 0;
  for (const group of groups) {
    const name = group.groupName || "";
    if (seen.has(name)) {
      return { ok: false, error: `微信群名称重复：${name}` };
    }
    if (!Number.isInteger(group.intervalMinutes) || group.intervalMinutes < 1) {
      return { ok: false, error: `采集间隔必须是正整数：${name}` };
    }
    if (group.enabled !== false) enabledCount += 1;
    seen.add(name);
  }
  if (requireEnabled && enabledCount === 0) {
    return { ok: false, error: "还没有启用的微信群配置" };
  }
  return { ok: true };
}

export function buildWechatRequirementDraft({ config, groupName, text, checkpoint = null }) {
  const group = findGroup(config, groupName);
  const filtered = filterWechatMessagesByCheckpoint(text, checkpoint);
  const parsed = parseWechatRequirementMessages(filtered.text);
  parsed.checkpoint.seenMessageHashes = unique([
    ...(Array.isArray(checkpoint?.seenMessageHashes) ? checkpoint.seenMessageHashes : []),
    ...parsed.checkpoint.seenMessageHashes,
  ]).slice(-200);
  return {
    source: {
      type: "wechat_group",
      groupName: group.groupName,
      collectedAt: new Date().toISOString(),
      skippedCount: filtered.skippedCount,
    },
    project: {
      projectName: group.projectName || group.groupName,
      customerName: group.customerName || "",
      requirementRequestId: group.requirementRequestId || "",
    },
    ...parsed,
  };
}

export function buildRequirementCenterPayload(draft, { requestId = "", attachments = [] } = {}) {
  const payload = {
    intent: "collecting",
    customer: {
      name: draft.project?.customerName || draft.project?.projectName || "",
    },
    requirement: draft.requirement || {},
    message: withAttachmentContext((draft.messages || []).map((item) => item.text).join("\n"), attachments),
    source: {
      type: "wechat_group",
      groupName: draft.source?.groupName || "",
      projectName: draft.project?.projectName || "",
      collectedAt: draft.source?.collectedAt || "",
      channel: draft.source?.channel || "",
      chatId: draft.source?.chatId || "",
      messageId: draft.source?.messageId || "",
      sender: draft.source?.sender || "",
      attachmentCount: attachments.length,
      attachments: summarizeAttachments(attachments),
    },
  };
  if (draft.analysisCandidates) payload.analysisCandidates = draft.analysisCandidates;
  const stableRequestId = requestId || draft.project?.requirementRequestId || "";
  if (stableRequestId) payload.requestId = stableRequestId;
  return payload;
}

export function buildChangeRequestPayload(draft, requestId, { attachments = [] } = {}) {
  if (!requestId) throw new Error("requestId is required for WeChat change requests.");
  const payload = {
    intent: "change_request",
    requestId,
    customerMessage: (draft.changeRecords || []).map((record) => record.message).join("\n"),
    changes: {
      changeRecords: draft.changeRecords || [],
      latestRequirement: draft.requirement || {},
      attachments: summarizeAttachments(attachments),
    },
    source: {
      type: "wechat_group",
      groupName: draft.source?.groupName || "",
      projectName: draft.project?.projectName || "",
      collectedAt: draft.source?.collectedAt || "",
      channel: draft.source?.channel || "",
      chatId: draft.source?.chatId || "",
      messageId: draft.source?.messageId || "",
      sender: draft.source?.sender || "",
      attachmentCount: attachments.length,
      attachments: summarizeAttachments(attachments),
    },
  };
  if (draft.analysisCandidates) payload.analysisCandidates = draft.analysisCandidates;
  return payload;
}

export async function pushRequirementCenterPayload(payload, {
  apiBase = "http://127.0.0.1:8765",
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("当前 Node 运行环境不支持 fetch，无法推送需求中心。");
  }
  const endpoint = new URL("/api/ai/requirements/dispatch", ensureTrailingSlash(apiBase)).toString();
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(body.error || `需求中心推送失败：HTTP ${response.status}`);
  }
  return body;
}

export async function pushWechatDraftToRequirementCenter(draft, {
  apiBase = "http://127.0.0.1:8765",
  requestId = "",
  fetchImpl = globalThis.fetch,
  attachments = [],
} = {}) {
  if (!(draft.messages || []).length && !(draft.changeRecords || []).length) {
    return {
      requestId: requestId || draft.project?.requirementRequestId || "",
      skipped: "no_new_messages",
      push: null,
      changePushes: [],
    };
  }
  const changeOnly = isChangeOnlyDraft(draft);
  let push = null;
  let resolvedRequestId = requestId || "";
  if (!changeOnly || !resolvedRequestId) {
    const collectingPayload = buildRequirementCenterPayload(draft, { requestId, attachments });
    push = await pushRequirementCenterPayload(collectingPayload, { apiBase, fetchImpl });
    resolvedRequestId = requestId || push.requirement?.requestId || "";
  }
  const changePushes = [];
  if ((draft.changeRecords || []).length > 0 && resolvedRequestId) {
    const changePayload = buildChangeRequestPayload(draft, resolvedRequestId, { attachments });
    changePushes.push(await pushRequirementCenterPayload(changePayload, { apiBase, fetchImpl }));
  }
  return {
    requestId: resolvedRequestId,
    push,
    changePushes,
  };
}

function summarizeAttachments(attachments) {
  return (attachments || []).map((file) => ({
    name: file.name || "",
    kind: file.kind || "",
    extension: file.extension || "",
    sizeBytes: Number(file.sizeBytes || 0),
    modifiedAt: file.modifiedAt || "",
    preview: file.preview || "",
  }));
}

function withAttachmentContext(message, attachments) {
  const summary = formatAttachmentContext(attachments);
  return [message, summary].filter(Boolean).join("\n\n");
}

function formatAttachmentContext(attachments) {
  const files = summarizeAttachments(attachments);
  if (!files.length) return "";
  const lines = ["微信群已下载附件："];
  for (const file of files) {
    lines.push(`- ${file.name} (${file.kind || file.extension || "file"}, ${file.sizeBytes} bytes, ${file.modifiedAt || "unknown time"})`);
    if (file.preview) lines.push(`  预览：${file.preview}`);
  }
  return lines.join("\n");
}

function isChangeOnlyDraft(draft) {
  const messages = draft.messages || [];
  const changeRecords = draft.changeRecords || [];
  if (!messages.length || !changeRecords.length) return false;
  const changedFields = new Set(changeRecords.flatMap((record) => Object.keys(record.changes || {})));
  const requirementFields = Object.entries(draft.requirement || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length))
    .map(([field]) => field);
  if (requirementFields.every((field) => changedFields.has(field))) return true;
  return messages.every((message) => isChangeMessage(message.text));
}

function isChangeMessage(text) {
  return /变更|调整|增加|新增|改|不考/.test(text)
    || /(?:考试时间|正式考试时间|正式时间|时间)(?:改到|改为|调整到|调整为)/.test(text)
    || /提前(?:登录|登陆)[、和以及,，\s]*(?:迟到时间|迟到)(?:都是|均为|都为|改为|调整为)\s*[0-9一二三四五六七八九十]+\s*分钟/.test(text);
}

export function filterWechatMessagesByCheckpoint(text, checkpoint = null) {
  const lines = normalizeText(text).split("\n").map((line) => line.trim()).filter(Boolean);
  if (!checkpoint?.lastMessageHash) return { text: lines.join("\n"), skippedCount: 0 };
  const lastSeenIndex = lines.findIndex((line) => sha256(line) === checkpoint.lastMessageHash);
  if (lastSeenIndex < 0) {
    const seenHashes = new Set(Array.isArray(checkpoint.seenMessageHashes) ? checkpoint.seenMessageHashes : []);
    if (!seenHashes.size) return { text: lines.join("\n"), skippedCount: 0 };
    const nextLines = lines.filter((line) => !seenHashes.has(sha256(line)));
    return {
      text: nextLines.join("\n"),
      skippedCount: lines.length - nextLines.length,
    };
  }
  const nextLines = lines.slice(lastSeenIndex + 1);
  return {
    text: nextLines.join("\n"),
    skippedCount: lastSeenIndex + 1,
  };
}

function ensureTrailingSlash(value) {
  const text = String(value || "").trim() || "http://127.0.0.1:8765";
  return text.endsWith("/") ? text : `${text}/`;
}

export function parseWechatRequirementMessages(text) {
  const normalizedText = normalizeText(text);
  const lines = normalizedText.split("\n").map((line) => line.trim()).filter(Boolean);
  const parsingLines = coalesceSplitChangeLines(lines);
  const parsingText = parsingLines.join("\n");
  const messages = lines.map((line, index) => ({ index: index + 1, text: line }));
  const requirement = {};
  const changeRecords = [];

  requirement.exam_name = firstMatch(parsingText, [
    /考试名称(?:是|为|叫|[:：])\s*([^。\n，,；;]+)/,
    /考试(?:叫|名为)\s*([^。\n，,；;]+)/,
  ]);
  requirement.formal_exam_time_range = firstMatch(parsingText, [
    /正式考试\s*([^。\n，,；;]+)/,
    /正式(?:时间|考试时间)(?:是|为|[:：])?\s*([^。\n，,；;]+)/,
    /(?:考试时间|正式考试时间|正式时间|时间)(?:改到|改为|调整到|调整为)\s*([^。\n，,；;]+)/,
  ]);
  requirement.mock_exam_time_range = firstMatch(parsingText, [
    /试考\s*([^。\n，,；;]+)/,
    /试考时间(?:是|为|[:：])?\s*([^。\n，,；;]+)/,
  ]);

  const subjectText = firstMatch(parsingText, [
    /科目(?:是|为|[:：])\s*([^。\n；;]+)/,
    /考试科目(?:是|为|[:：])\s*([^。\n；;]+)/,
  ]);
  if (subjectText) requirement.subjects = normalizeSubjects(subjectText);

  collectExplicitChangeRecords(parsingLines, changeRecords, requirement);

  const changedSubjects = collectSubjectChanges(parsingLines, changeRecords);
  if (changedSubjects.length) {
    const existing = Array.isArray(requirement.subjects) ? requirement.subjects : [];
    requirement.subjects = existing.length ? unique([...existing, ...changedSubjects]) : changedSubjects;
  }

  if (/不需要鹰眼|不用鹰眼|无需鹰眼/.test(normalizedText)) requirement.hawkeye_required = "否";
  else if (/需要鹰眼|开启鹰眼|鹰眼/.test(normalizedText)) requirement.hawkeye_required = "是";

  if (/需要视频监控|开启视频监控|视频监控/.test(normalizedText)) requirement.video_monitor_required = "是";
  if (/不需要视频监控|不用视频监控|无需视频监控/.test(normalizedText)) requirement.video_monitor_required = "否";
  if (/需要(?:视频)?录制|开启(?:视频)?录制|视频监控和录制|录制/.test(normalizedText)) requirement.video_record_required = "是";
  if (/不需要(?:视频)?录制|不用(?:视频)?录制|无需(?:视频)?录制/.test(normalizedText)) requirement.video_record_required = "否";

  if (/网页考试|浏览器考试/.test(normalizedText)) requirement.exam_client_type = "网页考试";
  else if (/客户端考试|锁定考试/.test(normalizedText)) requirement.exam_client_type = "客户端考试";

  const leaveCount = firstNumberMatch(normalizedText, /允许离开\s*([0-9一二三四五六七八九十]+)\s*次/);
  if (leaveCount !== null) requirement.leave_limit_count = leaveCount;

  const earlyLogin = firstNumberMatch(normalizedText, /提前\s*([0-9一二三四五六七八九十]+)\s*分钟/);
  if (earlyLogin !== null) requirement.early_login_minutes = `${earlyLogin}分钟`;

  const lateLimit = firstNumberMatch(normalizedText, /迟到\s*([0-9一二三四五六七八九十]+)\s*分钟/);
  if (lateLimit !== null) requirement.late_limit_minutes = `${lateLimit}分钟`;

  const sharedLoginLimit = firstNumberMatch(parsingText, /提前(?:登录|登陆)[、和以及,，\s]*(?:迟到时间|迟到)(?:都是|均为|都为|改为|调整为)\s*([0-9一二三四五六七八九十]+)\s*分钟/);
  if (sharedLoginLimit !== null) {
    requirement.early_login_minutes = `${sharedLoginLimit}分钟`;
    requirement.late_limit_minutes = `${sharedLoginLimit}分钟`;
  }

  return {
    requirement,
    unresolvedQuestions: buildUnresolvedQuestions(requirement),
    changeRecords,
    messages,
    checkpoint: {
      messageCount: messages.length,
      lastMessageHash: sha256(lines.at(-1) || normalizedText),
      seenMessageHashes: lines.map((line) => sha256(line)).slice(-200),
    },
  };
}

function findGroup(config, groupName) {
  const groups = config?.groups || [];
  const group = groups.find((item) => item.enabled && item.groupName === groupName);
  if (!group) {
    throw new Error(`未找到已启用的微信群配置：${groupName}`);
  }
  return group;
}

function normalizeText(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function coalesceSplitChangeLines(lines) {
  const result = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1] || "";
    const following = lines[index + 2] || "";
    if (/(?:考试时间|正式考试时间|正式时间)(?:改到|改为|调整到|调整为)/.test(current)
      && /^时间\s*[0-9一二三四五六七八九十]/.test(next)) {
      result.push(`${current} ${next}`);
      index += 1;
    } else if (/(?:考试时间|正式考试时间|正式时间)(?:改到|改为|调整到|调整为)/.test(current)
      && /^时间\s*[0-9一二三四五六七八九十]/.test(following)) {
      result.push(`${current} ${following}`);
      result.push(next);
      index += 2;
    } else {
      result.push(current);
    }
  }
  return result;
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return cleanupValue(match[1]);
  }
  return undefined;
}

function cleanupValue(value) {
  return String(value || "").replace(/\s+/g, " ").replace(/[。；;，,]$/g, "").trim();
}

function normalizeSubjects(value) {
  const subjectOnly = String(value || "").split(/，需要|,需要|，不需要|,不需要|，网页|,网页|，客户端|,客户端/)[0];
  return unique(subjectOnly.split(/和|、|,|，|;|；|\s+/)
    .map((item) => item.trim().replace(/[了吧呢呀啊]+$/g, ""))
    .filter(Boolean));
}

function collectExplicitChangeRecords(lines, changeRecords, requirement) {
  for (const line of lines) {
    if (/变更|调整|增加|新增|改|不考/.test(line)) {
      const timeMatch = line.match(/(?:考试时间|正式考试时间|正式时间|时间)(?:改到|改为|调整到|调整为)\s*([^。\n，,；;]+)/);
      if (timeMatch?.[1]) {
        const value = cleanupValue(timeMatch[1]);
        requirement.formal_exam_time_range = value;
        changeRecords.push({
          type: "formal_exam_time_change",
          message: line,
          changes: { formal_exam_time_range: value },
        });
      }
    }
    const sharedLoginLimit = firstNumberMatch(line, /提前(?:登录|登陆)[、和以及,，\s]*(?:迟到时间|迟到)(?:都是|均为|都为|改为|调整为)\s*([0-9一二三四五六七八九十]+)\s*分钟/);
    if (sharedLoginLimit !== null) {
      const value = `${sharedLoginLimit}分钟`;
      requirement.early_login_minutes = value;
      requirement.late_limit_minutes = value;
      changeRecords.push({
        type: "login_window_change",
        message: line,
        changes: {
          early_login_minutes: value,
          late_limit_minutes: value,
        },
      });
    }
  }
}

function collectSubjectChanges(lines, changeRecords) {
  const subjects = [];
  for (const line of lines) {
    if (!/变更|调整|增加|新增|加|改|不考/.test(line)) continue;
    const replacement = line.match(/不考\s*([^。\n，,；;]+?)[，,\s]*(?:改成|改为|换成)\s*([^。\n，,；;]+)/);
    if (replacement?.[2]) {
      const removedSubjects = normalizeSubjects(replacement[1]);
      const added = normalizeSubjects(replacement[2]);
      if (!added.length) continue;
      subjects.push(...added);
      changeRecords.push({
        type: "subject_change",
        message: line,
        changes: { removedSubjects, subjects: added },
      });
      continue;
    }
    const match = line.match(/科目(?:增加|新增|加|调整为|改为)?\s*([^。\n，,；;]+)/);
    if (!match?.[1]) continue;
    const added = normalizeSubjects(match[1].replace(/^增加|^新增|^加|^改为|^调整为/, ""));
    if (!added.length) continue;
    subjects.push(...added);
    changeRecords.push({
      type: "subject_change",
      message: line,
      changes: { subjects: added },
    });
  }
  return subjects;
}

function buildUnresolvedQuestions(requirement) {
  return Object.entries(REQUIRED_FIELD_LABELS)
    .filter(([field]) => {
      const value = requirement[field];
      return value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
    })
    .map(([, label]) => `请确认${label}。`);
}

function firstNumberMatch(text, pattern) {
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  return parseChineseNumber(match[1]);
}

function parseChineseNumber(value) {
  if (/^\d+$/.test(String(value))) return Number(value);
  const map = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const text = String(value);
  if (text === "十") return 10;
  if (text.includes("十")) {
    const [tens, ones] = text.split("十");
    return (map[tens] || 1) * 10 + (map[ones] || 0);
  }
  return map[text] ?? Number(value);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
