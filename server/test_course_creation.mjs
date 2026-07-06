import assert from "node:assert/strict";
import test from "node:test";

import {
  assignCourseCodesForExamConfig,
  ensureFormalCoursesCreated,
  generateNextCourseCode,
} from "./course_creation.mjs";

test("generates the next course code by incrementing the exam serial segment", () => {
  assert.equal(generateNextCourseCode("20260629-01-01"), "20260629-02-01");
  assert.equal(generateNextCourseCode("20260629-02-02"), "20260629-03-02");
  assert.equal(generateNextCourseCode("20260629-09-01"), "20260629-10-01");
});

test("rejects invalid or exhausted course codes", () => {
  assert.throws(() => generateNextCourseCode("20260629-99-01"), /科目编号已占满，请手动处理/);
  assert.throws(() => generateNextCourseCode("COURSE-01"), /科目编号格式不正确/);
});

test("assigns date exam serial and subject serial from existing local tasks", () => {
  const config = assignCourseCodesForExamConfig(
    {
      startTimeDisplay: "2026/06/29 13:00",
      courses: [
        { name: "综合能力", code: "20260629-01" },
        { name: "专业知识", code: "20260629-02" },
      ],
    },
    [
      { config: { startTimeDisplay: "2026/06/29 09:00", courses: [{ name: "语文", code: "20260629-01-01" }] } },
    ],
  );

  assert.deepEqual(config.courses.map((course) => course.code), ["20260629-02-01", "20260629-02-02"]);
  assert.deepEqual(config.courses.map((course) => course.form_codes), [["20260629-02-01"], ["20260629-02-02"]]);
});

test("treats empty requirement subjects as completed without tenant course requests", async () => {
  const logs = [];
  let requested = false;

  const courses = await ensureFormalCoursesCreated({
    login: {},
    apiBase: "https://eztest.cn",
    config: { courses: [] },
    requestJson: async () => {
      requested = true;
      return {};
    },
    emitLog: (message, level) => logs.push({ message, level }),
  });

  assert.deepEqual(courses, []);
  assert.equal(requested, false);
  assert.deepEqual(logs, [
    { message: "[API 科目] 需求单科目为空，跳过科目创建，配置流程继续完成。", level: "success" },
  ]);
});

test("creates a course with the next available code when the requested name is new and code is occupied", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (String(url).includes("/tenant/api/courses/")) {
      return { results: [{ name: "体育", code: "20260629-02-01" }] };
    }
    return { name: "美术", code: "20260629-03-01" };
  };

  const courses = await ensureFormalCoursesCreated({
    login: {},
    apiBase: "https://eztest.cn",
    config: { courses: [{ name: "美术", code: "20260629-02-01" }] },
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://eztest.cn/tenant/api/courses/?apply=session");
  assert.equal(calls[1].url, "https://eztest.cn/tenant/api/course/");
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    name: "美术",
    code: "20260629-03-01",
    form_codes: ["20260629-03-01"],
  });
  assert.deepEqual(courses, [{ name: "美术", code: "20260629-03-01", form_codes: ["20260629-03-01"], order: 1 }]);
  assert.ok(logs.some((message) => message.includes("科目名称不存在，准备创建：美术")));
  assert.ok(logs.some((message) => message.includes("科目编号已占用，改用：20260629-03-01")));
});

test("keeps all subjects on the same next exam serial when one tenant course code is occupied", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (String(url).includes("/tenant/api/courses/")) {
      return { results: [{ name: "旧科目", code: "20260629-01-01" }] };
    }
    return JSON.parse(options.body);
  };

  const courses = await ensureFormalCoursesCreated({
    login: {},
    apiBase: "https://eztest.cn",
    config: {
      courses: [
        { name: "综合能力", code: "20260629-01-01" },
        { name: "专业知识", code: "20260629-01-02" },
      ],
    },
    requestJson,
    emitLog: () => {},
  });

  const createBodies = calls
    .filter((call) => call.url === "https://eztest.cn/tenant/api/course/")
    .map((call) => JSON.parse(call.options.body));
  assert.deepEqual(createBodies.map((body) => body.code), ["20260629-02-01", "20260629-02-02"]);
  assert.deepEqual(courses.map((course) => course.code), ["20260629-02-01", "20260629-02-02"]);
});

test("skips creation and reuses the existing code when a course name already exists", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    return { results: [{ name: "美术", code: "COURSE-EXISTING" }] };
  };

  const courses = await ensureFormalCoursesCreated({
    login: {},
    apiBase: "https://eztest.cn",
    config: { courses: [{ name: "美术", code: "20260629-02-01" }] },
    requestJson,
    emitLog: () => {},
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://eztest.cn/tenant/api/courses/?apply=session");
  assert.deepEqual(courses, [{ name: "美术", code: "COURSE-EXISTING", form_codes: ["20260629-02-01"], order: 1 }]);
});

test("retries course creation with incremented codes when tenant reports code already exists", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (String(url).includes("/tenant/api/courses/")) return { results: [] };
    const payload = JSON.parse(options.body);
    if (payload.code === "20260629-01-01" || payload.code === "20260629-02-01") {
      const error = new Error("bad request");
      error.status = 400;
      error.detail = { message: "科目编号已存在" };
      throw error;
    }
    return { name: payload.name, code: payload.code };
  };

  const courses = await ensureFormalCoursesCreated({
    login: {},
    apiBase: "https://eztest.cn",
    config: { courses: [{ name: "体育", code: "20260629-01-01" }] },
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  const createBodies = calls
    .filter((call) => call.url === "https://eztest.cn/tenant/api/course/")
    .map((call) => JSON.parse(call.options.body));
  assert.deepEqual(createBodies.map((body) => body.code), ["20260629-01-01", "20260629-02-01", "20260629-03-01"]);
  assert.deepEqual(createBodies.map((body) => body.form_codes), [["20260629-01-01"], ["20260629-02-01"], ["20260629-03-01"]]);
  assert.deepEqual(courses, [{ name: "体育", code: "20260629-03-01", form_codes: ["20260629-03-01"], order: 1 }]);
  assert.ok(logs.includes("[API 科目] 准备创建科目：体育 / 20260629-01-01"));
  assert.ok(logs.includes("[API 科目] 科目编号已存在：20260629-01-01，尝试下一个编号：20260629-02-01"));
  assert.ok(logs.includes("[API 科目] 科目编号已存在：20260629-02-01，尝试下一个编号：20260629-03-01"));
  assert.ok(logs.includes("[API 科目] 科目创建成功：体育 / 20260629-03-01"));
});

test("retries to a new unused exam serial when tenant list misses occupied course codes", async () => {
  const calls = [];
  const logs = [];
  const occupiedCodes = new Set(["20260707-01-01", "20260707-02-01"]);
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (String(url).includes("/tenant/api/courses/")) return { results: [] };
    const payload = JSON.parse(options.body);
    if (occupiedCodes.has(payload.code)) {
      const error = new Error("bad request");
      error.status = 400;
      error.detail = { msg: "科目编号已存在" };
      throw error;
    }
    return { name: payload.name, code: payload.code };
  };

  const courses = await ensureFormalCoursesCreated({
    login: {},
    apiBase: "https://eztest.cn",
    config: { courses: [{ name: "天文", code: "20260707-01-01" }] },
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  const createBodies = calls
    .filter((call) => call.url === "https://eztest.cn/tenant/api/course/")
    .map((call) => JSON.parse(call.options.body));
  assert.deepEqual(createBodies.map((body) => body.code), ["20260707-01-01", "20260707-02-01", "20260707-03-01"]);
  assert.deepEqual(courses, [{ name: "天文", code: "20260707-03-01", form_codes: ["20260707-03-01"], order: 1 }]);
  assert.ok(logs.includes("[API 科目] 科目编号已存在：20260707-01-01，尝试下一个编号：20260707-02-01"));
  assert.ok(logs.includes("[API 科目] 科目编号已存在：20260707-02-01，尝试下一个编号：20260707-03-01"));
});

test("does not retry course creation for other tenant errors", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (String(url).includes("/tenant/api/courses/")) return { results: [] };
    const error = new Error("bad request");
    error.status = 400;
    error.detail = { message: "科目名称不能为空" };
    throw error;
  };

  await assert.rejects(
    ensureFormalCoursesCreated({
      login: {},
      apiBase: "https://eztest.cn",
      config: { courses: [{ name: "体育", code: "20260629-01-01" }] },
      requestJson,
      emitLog: () => {},
    }),
    /bad request/,
  );

  assert.equal(calls.filter((call) => call.url === "https://eztest.cn/tenant/api/course/").length, 1);
});
