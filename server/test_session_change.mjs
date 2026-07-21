import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedSessionChangeFields,
  appendSessionChangeHistory,
  buildSessionChangeDiff,
  editableSessionFieldsFromDetail,
  featureEnabledForRuntime,
  localSessionFieldsForChange,
  mergeSessionChangePayload,
  sessionChangeBasePayloadFromTask,
  sessionChangeHistoryFromStep,
  sessionChangeSummary,
  tenantSessionChangeErrorMessage,
  validateSessionChangeRequest,
} from "./session_change.mjs";

test("feature gate is enabled for test runtime or explicit flag only", () => {
  assert.equal(featureEnabledForRuntime("/app/.easy_exam_runtime", {}), false);
  assert.equal(featureEnabledForRuntime("/app/.easy_exam_runtime_test", {}), true);
  assert.equal(featureEnabledForRuntime("/app/runtime", { SESSION_CHANGE_ENABLED: "1" }), true);
});

test("validation rejects unknown fields and invalid date ranges", () => {
  const unknown = validateSessionChangeRequest({ name: "A", invalid: "x" });
  assert.deepEqual(unknown.errors, ["不支持修改字段：invalid"]);

  const badRange = validateSessionChangeRequest({
    name: "A",
    start: "2026-07-20 11:00:00",
    end: "2026-07-20 09:00:00",
  });
  assert.ok(badRange.errors.includes("结束时间必须晚于开始时间"));
});

test("validation normalizes allowed fields and permits clearing early/later", () => {
  const result = validateSessionChangeRequest({
    name: "  新场次  ",
    start: "2026-07-20 09:00",
    end: "2026-07-20 11:00",
    early: "",
    later: null,
    message: "",
    notice: " 请提前登录 ",
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.changes, {
    name: "新场次",
    start: "2026-07-20 09:00",
    end: "2026-07-20 11:00",
    early: null,
    later: null,
    message: "",
    notice: "请提前登录",
  });
});

test("merge keeps only editable session change fields and removes cleared minute fields", () => {
  const original = {
    id: "10001",
    name: "旧场次",
    start: "2026-07-20 08:00",
    end: "2026-07-20 10:00",
    early: 15,
    later: 20,
    forms: ["F001"],
    monitor: true,
    personal: { full_name: { label: "姓名" } },
    url: "https://example.com",
    extra: { readonly: true },
  };

  const merged = mergeSessionChangePayload(original, {
    name: "新场次",
    start: "2026-07-20 09:00",
    end: "2026-07-20 11:00",
    early: null,
    later: null,
    message: "欢迎",
  });

  assert.equal(merged.name, "新场次");
  assert.equal(merged.start, "2026-07-20 09:00");
  assert.equal(merged.end, "2026-07-20 11:00");
  assert.deepEqual(merged.forms, ["F001"]);
  assert.equal(merged.monitor, true);
  assert.deepEqual(merged.personal, { full_name: { label: "姓名" } });
  assert.equal(Object.hasOwn(merged, "id"), false);
  assert.equal(Object.hasOwn(merged, "url"), false);
  assert.equal(Object.hasOwn(merged, "extra"), false);
  assert.equal(Object.hasOwn(merged, "early"), false);
  assert.equal(Object.hasOwn(merged, "later"), false);
});

test("diff includes only changed fields with labels", () => {
  const diff = buildSessionChangeDiff(
    { name: "旧场次", start: "2026-07-20 08:00", message: "" },
    { name: "新场次", start: "2026-07-20 08:00", message: "欢迎" },
  );

  assert.deepEqual(diff, [
    { field: "name", label: "场次名称", before: "旧场次", after: "新场次" },
    { field: "message", label: "欢迎语", before: "", after: "欢迎" },
  ]);
});

test("editable fields expose the safe subset from tenant detail", () => {
  assert.deepEqual(allowedSessionChangeFields, ["name", "start", "end", "early", "later", "message", "notice"]);
  assert.deepEqual(editableSessionFieldsFromDetail({ name: "A", monitor: true, early: 30 }), {
    name: "A",
    start: "",
    end: "",
    early: 30,
    later: "",
    message: "",
    notice: "",
  });
});

test("local session fallback exposes basic editable fields", () => {
  assert.deepEqual(localSessionFieldsForChange({
    name: "本地场次",
    start: "2026-07-09 16:20",
    end: "2026-07-09 17:20",
    early: 30,
    later: 20,
  }), {
    name: "本地场次",
    start: "2026-07-09 16:20",
    end: "2026-07-09 17:20",
    early: 30,
    later: 20,
    message: "",
    notice: "",
  });
});

test("task fallback payload avoids overwriting tenant-only prompts when detail lookup fails", () => {
  const payload = sessionChangeBasePayloadFromTask(
    { config: { welcomeText: "欢迎", preLoginPrompt: "请提前登录", personal: { full_name: { required: true } } } },
    { name: "本地场次", start: "2026-07-09 16:20", end: "2026-07-09 17:20", early: 30 },
  );

  assert.deepEqual(payload, {
    name: "本地场次",
    start: "2026-07-09 16:20",
    end: "2026-07-09 17:20",
    personal: { full_name: { required: true } },
    early: 30,
  });
});

test("task fallback payload preserves explicit local prompts when available", () => {
  const payload = sessionChangeBasePayloadFromTask(
    { config: { welcomeText: "默认欢迎", preLoginPrompt: "默认提示", personal: { full_name: { required: true } } } },
    {
      name: "本地场次",
      start: "2026-07-09 16:20",
      end: "2026-07-09 17:20",
      message: "易考已有欢迎语",
      notice: "易考已有登录提示",
    },
  );

  assert.equal(payload.message, "易考已有欢迎语");
  assert.equal(payload.notice, "易考已有登录提示");
});

test("safe summary omits full tenant body", () => {
  assert.deepEqual(sessionChangeSummary({ status: 0, info: "success", data: { secret: "x" } }), {
    status: 0,
    info: "success",
  });
  assert.deepEqual(sessionChangeSummary("ok"), { bodyType: "string", body: "ok" });
});

test("tenant session change errors use operator friendly messages", () => {
  assert.equal(tenantSessionChangeErrorMessage({ status: 401 }), "租户 API 返回 401，请检查租户 API Key。");
  assert.equal(tenantSessionChangeErrorMessage({ status: 403 }), "租户 API 返回 403，场次不存在、不属于当前租户，或当前 Key 无权限修改。");
  assert.equal(tenantSessionChangeErrorMessage({ status: 429 }), "租户 API 返回 429，请稍后重试。");
  assert.equal(tenantSessionChangeErrorMessage({ status: 500 }), "租户 API 修改场次失败：500");
});

test("session change history appends newest record without losing older records", () => {
  const existing = [{ id: "old", sessionId: "10001", changedAt: "2026-07-08T09:00:00.000Z" }];
  const history = appendSessionChangeHistory(existing, {
    id: "new",
    changedAt: "2026-07-09T10:00:00.000Z",
    operator: "chenjun@ata.net.cn",
    sessionId: "429937",
    sessionType: "formal",
    apiBase: "https://eztest.cn",
    status: "success",
    tenantStatus: 200,
    verifyStatus: 200,
    diff: [{ field: "name", label: "场次名称", before: "旧场次", after: "新场次" }],
    verifiedSession: { name: "新场次", start: "2026/07/17 10:30", end: "2026/07/17 11:30" },
  });

  assert.equal(history.length, 2);
  assert.equal(history[0].id, "new");
  assert.equal(history[0].operator, "chenjun@ata.net.cn");
  assert.equal(history[0].sessionLabel, "正式考试");
  assert.deepEqual(history[0].diff, [{ field: "name", label: "场次名称", before: "旧场次", after: "新场次" }]);
  assert.deepEqual(history[0].verifiedSession, { name: "新场次", start: "2026/07/17 10:30", end: "2026/07/17 11:30" });
  assert.equal(history[1], existing[0]);
});

test("legacy session change step diff can be displayed as history", () => {
  const history = sessionChangeHistoryFromStep({
    status: "success",
    completedAt: "2026-07-08T09:34:23+00:00",
    result: {
      sessionId: "429937",
      sessionType: "formal",
      apiBase: "https://eztest.cn",
      diff: [{ field: "start", label: "开始时间", before: "2026-07-18 10:30", after: "2026-07-17 10:30" }],
      tenantResponseSummary: {},
    },
  });

  assert.equal(history.length, 1);
  assert.equal(history[0].id, "429937-legacy");
  assert.equal(history[0].sessionLabel, "正式考试");
  assert.equal(history[0].tenantStatus, 200);
  assert.deepEqual(history[0].diff, [{ field: "start", label: "开始时间", before: "2026-07-18 10:30", after: "2026-07-17 10:30" }]);
});
