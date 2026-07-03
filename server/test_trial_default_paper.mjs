import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TRIAL_COURSE_CODE,
  DEFAULT_TRIAL_COURSE_NAME,
  bindDefaultTrialPaperToSession,
  ensureDefaultTrialCourse,
} from "./trial_default_paper.mjs";

test("creates the default trial course when SKTY is missing", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/tenant/api/courses/SKTY/?apply=form")) {
      const error = new Error("not found");
      error.status = 404;
      throw error;
    }
    return JSON.parse(options.body);
  };

  const course = await ensureDefaultTrialCourse({
    login: {},
    apiBase: "https://eztest.cn",
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.deepEqual(course, { name: DEFAULT_TRIAL_COURSE_NAME, code: DEFAULT_TRIAL_COURSE_CODE });
  assert.deepEqual(calls.map((call) => [call.url, call.options.method]), [
    ["https://eztest.cn/tenant/api/courses/SKTY/?apply=form", "GET"],
    ["https://eztest.cn/tenant/api/course/", "POST"],
  ]);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    name: "试考",
    code: "SKTY",
    form_codes: [],
  });
  assert.ok(logs.includes("[试考默认卷] 未找到默认试考科目 SKTY，开始创建"));
});

test("reuses the default trial course when it already exists", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    return { code: "SKTY", name: "试考", res: [{ code: "491519" }] };
  };

  const course = await ensureDefaultTrialCourse({
    login: {},
    apiBase: "https://eztest.cn",
    requestJson,
    emitLog: () => {},
  });

  assert.deepEqual(course, { name: "试考", code: "SKTY", formCodes: ["491519"] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://eztest.cn/tenant/api/courses/SKTY/?apply=form");
});

test("binds the default trial course paper to a trial session using refreshed form codes", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (options.method === "GET") {
      return { code: "SKTY", name: "试考", res: [{ code: "491519" }] };
    }
    return { __tenantResponse: true, httpStatus: 200, body: { ok: true } };
  };

  const result = await bindDefaultTrialPaperToSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "429044",
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(result.status, "success");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://eztest.cn/tenant/api/courses/SKTY/?apply=form");
  assert.equal(calls[1].url, "https://eztest.cn/tenant/api/course/session/429044/");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    course_code: "SKTY",
    form_codes: ["491519"],
  });
  assert.ok(logs.includes("[试考默认卷] 试考试卷绑定完成"));
});

test("waits for manual paper association when SKTY has no form codes", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    return { code: "SKTY", name: "试考", res: [] };
  };

  const result = await bindDefaultTrialPaperToSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "429044",
    requestJson,
    emitLog: () => {},
  });

  assert.deepEqual(result, { status: "waiting_manual", missingCourseCodes: ["SKTY"] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
});
