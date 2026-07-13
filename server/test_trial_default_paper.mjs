import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TRIAL_PAPER_NAME,
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

test("binds the fixed default trial paper to SKTY and the trial session when the paper is found", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/tenant/api/courses/SKTY/?apply=form")) {
      return { code: "SKTY", name: "试考", res: [] };
    }
    if (url.includes("/tenant/api/form/list/") && url.includes("name=")) {
      return {
        form_list: [
          { code: "OTHER-FORM", name: "其他试卷" },
          { code: "491519", name: DEFAULT_TRIAL_PAPER_NAME },
        ],
      };
    }
    if (url.endsWith("/tenant/api/session/429044/forms/")) {
      return { results: [{ code: "491519", name: DEFAULT_TRIAL_PAPER_NAME, course_code: "SKTY", course_name: "试考" }] };
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
  assert.equal(calls.length, 5);
  assert.equal(calls[0].url, "https://eztest.cn/tenant/api/courses/SKTY/?apply=form");
  assert.equal(calls[1].url, `https://eztest.cn/tenant/api/form/list/?form_type=form&name=${encodeURIComponent(DEFAULT_TRIAL_PAPER_NAME)}&order_by=-id`);
  assert.equal(calls[2].url, "https://eztest.cn/tenant/api/course/");
  assert.equal(calls[2].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    code: "SKTY",
    name: "试考",
    form_codes: ["491519"],
  });
  assert.equal(calls[3].url, "https://eztest.cn/tenant/api/course/session/429044/");
  assert.deepEqual(JSON.parse(calls[3].options.body), {
    course_code: "SKTY",
    form_codes: ["491519"],
  });
  assert.equal(calls[4].url, "https://eztest.cn/tenant/api/session/429044/forms/");
  assert.deepEqual(result.results[0].paper_names, [DEFAULT_TRIAL_PAPER_NAME]);
  assert.ok(logs.includes("[试考默认卷] 试考试卷绑定完成"));
});

test("does not mark trial paper binding successful when tenant readback has no paper", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/tenant/api/courses/SKTY/?apply=form")) {
      return { code: "SKTY", name: "试考", res: [] };
    }
    if (url.includes("/tenant/api/form/list/") && url.includes("name=")) {
      return { form_list: [{ code: "491519", name: DEFAULT_TRIAL_PAPER_NAME }] };
    }
    if (url.endsWith("/tenant/api/session/429044/forms/")) return { results: [] };
    if (url.endsWith("/tenant/api/session/429044/")) return { courses: [{ code: "SKTY", name: "试考", forms: [] }] };
    return { __tenantResponse: true, httpStatus: 200, body: {} };
  };

  const result = await bindDefaultTrialPaperToSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "429044",
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(result.status, "waiting_manual");
  assert.deepEqual(result.missingCourseCodes, ["SKTY"]);
  assert.ok(logs.some((message) => message.includes("回查未发现固定试考试卷")));
  assert.equal(logs.includes("[试考默认卷] 试考试卷绑定完成"), false);
});

test("matches the fixed trial paper name with normalized punctuation and spacing", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/tenant/api/courses/SKTY/?apply=form")) {
      return { code: "SKTY", name: "试考", res: [] };
    }
    if (url.includes("/tenant/api/form/list/") && url.includes("name=")) {
      return {
        form_list: [
          { code: "491519", name: "试考通用卷 (客观+填空+简答) 1个单元 20241106" },
        ],
      };
    }
    if (url.endsWith("/tenant/api/session/429044/forms/")) {
      return { results: [{ code: "491519", name: "试考通用卷 (客观+填空+简答) 1个单元 20241106", course_code: "SKTY", course_name: "试考" }] };
    }
    return { __tenantResponse: true, httpStatus: 200, body: { ok: true } };
  };

  const result = await bindDefaultTrialPaperToSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "429044",
    requestJson,
    emitLog: () => {},
  });

  assert.equal(result.status, "success");
  assert.equal(calls.length, 5);
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    code: "SKTY",
    name: "试考",
    form_codes: ["491519"],
  });
  assert.deepEqual(JSON.parse(calls[3].options.body), {
    course_code: "SKTY",
    form_codes: ["491519"],
  });
  assert.deepEqual(result.results[0].form_codes, ["491519"]);
  assert.deepEqual(result.results[0].paper_names, ["试考通用卷 (客观+填空+简答) 1个单元 20241106"]);
});

test("waits for manual paper association when the fixed default trial paper name is not found", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (url.includes("/tenant/api/form/list/")) {
      return { form_list: [{ code: "OTHER-FORM", name: "其他试卷" }] };
    }
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
  assert.equal(calls.length, 4);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].url, `https://eztest.cn/tenant/api/form/list/?form_type=form&name=${encodeURIComponent(DEFAULT_TRIAL_PAPER_NAME)}&order_by=-id`);
  assert.equal(calls[2].url, "https://eztest.cn/tenant/api/form/list/?form_type=form&order_by=-id");
  assert.equal(calls[3].url, "https://eztest.cn/tenant/api/course/session/429044/");
  assert.deepEqual(JSON.parse(calls[3].options.body), {
    course_code: "SKTY",
  });
});
