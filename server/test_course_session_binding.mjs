import assert from "node:assert/strict";
import test from "node:test";

import {
  bindCoursesToFormalSession,
  createSessionsThenConfigureCourses,
  validateCourseBinding,
} from "./course_session_binding.mjs";

test("creates courses after both formal and trial sessions are created", async () => {
  const order = [];
  const created = await createSessionsThenConfigureCourses({
    sessionPayloads: [{ kind: "main" }, { kind: "mock" }],
    createSession: async (item) => {
      order.push(item.kind);
      return { kind: item.kind, id: item.kind === "main" ? "formal-1" : "trial-1" };
    },
    configureCourses: async (formalSession) => {
      order.push("course");
      assert.equal(formalSession.id, "formal-1");
    },
  });

  assert.deepEqual(order, ["main", "mock", "course"]);
  assert.equal(created.length, 2);
});

test("configures course session binding only with the formal session", async () => {
  const boundSessionIds = [];
  const created = await createSessionsThenConfigureCourses({
    sessionPayloads: [{ kind: "main" }, { kind: "mock" }],
    createSession: async (item) => ({ kind: item.kind, id: item.kind === "main" ? "formal-session" : "trial-session" }),
    configureCourses: async (formalSession) => {
      boundSessionIds.push(formalSession.id);
    },
  });

  assert.deepEqual(created.map((item) => item.id), ["formal-session", "trial-session"]);
  assert.deepEqual(boundSessionIds, ["formal-session"]);
});

test("does not create courses when formal session creation fails", async () => {
  const order = [];
  await assert.rejects(createSessionsThenConfigureCourses({
    sessionPayloads: [{ kind: "main" }, { kind: "mock" }],
    createSession: async (item) => {
      order.push(item.kind);
      if (item.kind === "main") throw new Error("formal failed");
      return { kind: item.kind, id: "trial-1" };
    },
    configureCourses: async () => order.push("course"),
  }), { message: "formal failed" });
  assert.deepEqual(order, ["main"]);
});

test("does not create courses when trial session creation fails", async () => {
  const order = [];
  await assert.rejects(createSessionsThenConfigureCourses({
    sessionPayloads: [{ kind: "main" }, { kind: "mock" }],
    createSession: async (item) => {
      order.push(item.kind);
      if (item.kind === "mock") throw new Error("trial failed");
      return { kind: item.kind, id: "formal-1" };
    },
    configureCourses: async () => order.push("course"),
  }), { message: "trial failed" });
  assert.deepEqual(order, ["main", "mock"]);
});

test("rejects expired trial sessions before creating any session", async () => {
  const order = [];
  await assert.rejects(
    createSessionsThenConfigureCourses({
      now: new Date("2026-07-03T10:12:00+08:00"),
      sessionPayloads: [
        { kind: "main", payload: { name: "正式考试", start: "2026-07-03 10:30", end: "2026-07-03 11:30" } },
        { kind: "mock", payload: { name: "试考", start: "2026-07-02 15:00", end: "2026-07-02 20:00" } },
      ],
      createSession: async (item) => {
        order.push(item.kind);
        return { kind: item.kind, id: `${item.kind}-1` };
      },
      configureCourses: async () => order.push("course"),
    }),
    /试考时间已结束：试考 2026-07-02 15:00 - 2026-07-02 20:00/,
  );
  assert.deepEqual(order, []);
});

test("posts formal course binding with session id and course code only", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    return { ok: true };
  };

  await bindCoursesToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: 426039,
    courses: [{ name: "语文", code: "20260619-01" }],
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://eztest.cn/tenant/api/course/session/426039/");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    course_code: "20260619-01",
  });
  assert.ok(logs.includes("[科目绑定] POST /tenant/api/course/session/426039/"));
  assert.ok(logs.includes('[科目绑定] payload = {"course_code":"20260619-01"}'));
  assert.ok(logs.includes("[科目绑定] httpStatus = 200"));
});

test("binds with course code even when no form codes are present", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    return { ok: true };
  };

  const result = await bindCoursesToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "426039",
    courses: [{ code: "20260619-01" }],
    requestJson,
    emitLog: () => {},
  });
  assert.equal(result.status, "success");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://eztest.cn/tenant/api/course/session/426039/");
  assert.deepEqual(JSON.parse(calls[0].options.body), { course_code: "20260619-01" });
});

test("binds multiple course codes to formal session without form lookup", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    return { ok: true };
  };

  await bindCoursesToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "42",
    courses: [{ name: "语文", code: "C-01" }, { name: "数学", code: "C-02" }],
    requestJson,
    emitLog: () => {},
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.url), [
    "https://eztest.cn/tenant/api/course/session/42/",
    "https://eztest.cn/tenant/api/course/session/42/",
  ]);
  assert.deepEqual(calls.map((call) => JSON.parse(call.options.body)), [
    { course_code: "C-01" },
    { course_code: "C-02" },
  ]);
});

test("does not query course details before binding", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    return { ok: true };
  };
  const result = await bindCoursesToFormalSession({
    login: {}, apiBase: "https://eztest.cn", sessionId: "426039",
    courses: [{ code: "20260619-01" }], requestJson, emitLog: () => {},
  });
  assert.equal(result.status, "success");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "POST");
});

test("continues binding each valid course code independently", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    return { ok: true };
  };
  const result = await bindCoursesToFormalSession({
    login: {}, apiBase: "https://eztest.cn", sessionId: "42",
    courses: [{ code: "C-01" }, { code: "C-02" }], requestJson, emitLog: () => {},
  });
  assert.equal(result.status, "success");
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 2);
});

test("strictly rejects empty and non-string binding values", () => {
  assert.throws(() => validateCourseBinding({ sessionId: "", courseCode: "C1" }));
  assert.throws(() => validateCourseBinding({ sessionId: "S1", courseCode: "" }));
});

test("treats empty courses as a completed no-op binding", async () => {
  let requested = false;
  const logs = [];
  const result = await bindCoursesToFormalSession({
    login: {}, apiBase: "https://eztest.cn", sessionId: "S1", courses: [],
    requestJson: async () => { requested = true; }, emitLog: (message, level) => logs.push({ message, level }),
  });

  assert.equal(requested, false);
  assert.deepEqual(result, { status: "success", results: [], skipped: true });
  assert.deepEqual(logs, [
    { message: "[科目绑定] 未读取到可绑定科目，跳过正式场次科目绑定。", level: "success" },
  ]);
});

test("logs response details and translates HTTP 400 binding errors", async () => {
  const logs = [];
  const requestJson = async (_login, _url, options) => {
    const error = new Error("bad request");
    error.status = 400;
    error.detail = { msg: "参数错误" };
    throw error;
  };

  await assert.rejects(
    bindCoursesToFormalSession({
      login: {}, apiBase: "https://eztest.cn", sessionId: "426039",
      courses: [{ code: "20260619-01" }], requestJson,
      emitLog: (message) => logs.push(message),
    }),
    { message: "科目已创建，但绑定参数不合法，请检查 session_id / course_code" },
  );
  assert.ok(logs.includes("[科目绑定] httpStatus = 400"));
  assert.ok(logs.includes('[科目绑定] responseBody = {"msg":"参数错误"}'));
});

test("logs the actual successful binding HTTP status", async () => {
  const logs = [];
  const requestJson = async (_login, _url, options) => {
    return { __tenantResponse: true, httpStatus: 201, body: { created: true } };
  };

  await bindCoursesToFormalSession({
    login: {}, apiBase: "https://eztest.cn", sessionId: "42",
    courses: [{ code: "C-01" }], requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.ok(logs.includes("[科目绑定] httpStatus = 201"));
  assert.ok(logs.includes('[科目绑定] responseBody = {"created":true}'));
});
