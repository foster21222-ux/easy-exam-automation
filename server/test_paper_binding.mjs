import assert from "node:assert/strict";
import test from "node:test";

import {
  bindPapersToFormalSession,
  detectSessionPaperBindings,
  validatePaperBinding,
} from "./paper_binding.mjs";

const MISSING_FORM_CODES_MESSAGE = "科目已创建成功，但未获取到有效试卷 code，无法绑定到考试场次";

test("refreshes course form details and posts course_code with res form codes to formal session", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (options.method === "GET") {
      return {
        code: "20260725-04-01",
        name: "总会",
        res: [
          { code: "FORM-A", name: "总会试卷" },
          { code: "FORM-B", name: "总会备用卷" },
        ],
      };
    }
    return { __tenantResponse: true, httpStatus: 200, body: { ok: true } };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "427535",
    courses: [{ name: "总会", code: "20260725-04-01", form_codes: ["OLD-LOCAL"] }],
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(result.status, "success");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://eztest.cn/tenant/api/courses/20260725-04-01/?apply=form");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].url, "https://eztest.cn/tenant/api/course/session/427535/");
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    course_code: "20260725-04-01",
    form_codes: ["FORM-A", "FORM-B"],
  });
  assert.equal(calls.some((call) => call.url.endsWith("/tenant/api/course/") && call.options.method === "PUT"), false);
  assert.ok(logs.includes("[试卷绑定] GET /tenant/api/courses/20260725-04-01/?apply=form"));
  assert.ok(logs.includes("[试卷绑定] 科目=总会，course_code=20260725-04-01，form_codes=[FORM-A, FORM-B]"));
  assert.ok(logs.includes("[试卷绑定] POST /tenant/api/course/session/427535/"));
});

test("reads form codes from nested data res fields", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (options.method === "GET") return { data: { code: "C-01", res: [{ form_code: "F-01" }] } };
    return { ok: true };
  };

  await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-01",
    courses: [{ name: "语文", code: "C-01" }],
    requestJson,
    emitLog: () => {},
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    course_code: "C-01",
    form_codes: ["F-01"],
  });
});

test("selects the one uploaded paper whose name starts with the course code and matches the course paper name", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (options.method === "GET") {
      return {
        code: "20260718-01-02",
        name: "综合二",
        res: [
          { code: "FORM-A", name: "20260718-01-02_Python语言基础+大数据技术" },
          { code: "FORM-B", name: "20260718-01-01_Python语言基础+大数据技术" },
          { code: "FORM-C", name: "20260718-01-02_会计学与财务分析基础" },
        ],
      };
    }
    return { __tenantResponse: true, httpStatus: 200, body: { ok: true } };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-01",
    courses: [{ name: "综合二", code: "20260718-01-02", paper_name: "Python语言基础+大数据技术" }],
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.results[0].paper_names, ["20260718-01-02_Python语言基础+大数据技术"]);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    course_code: "20260718-01-02",
    form_codes: ["FORM-A"],
  });
  assert.ok(logs.some((message) => message.includes("按试卷名称匹配：Python语言基础+大数据技术")));
});

test("waits for manual confirmation when course paper name matches more than one uploaded paper", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    return {
      code: "20260718-01-03",
      name: "综合三",
      res: [
        { code: "FORM-A", name: "20260718-01-03_财务分析案例A卷" },
        { code: "FORM-B", name: "20260718-01-03_财务分析案例B卷" },
      ],
    };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-01",
    courses: [{ name: "综合三", code: "20260718-01-03", paper_name: "财务分析案例" }],
    requestJson,
    emitLog: () => {},
  });

  assert.equal(result.status, "waiting_manual");
  assert.deepEqual(result.missingCourseCodes, ["20260718-01-03"]);
  assert.equal(calls.filter((call) => call.options?.method === "POST").length, 0);
});

test("falls back to tenant form list when course detail has no linked forms", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (String(url).includes("/tenant/api/form/list/")) {
      return {
        form_list: [
          { code: "FORM-PHY", name: "20260707-01-01物理", type: "form" },
          { code: "FORM-CHEM", name: "20260707-01-02化学", type: "form" },
        ],
      };
    }
    if (options.method === "GET") return { code: "20260707-01-01", name: "物理", res: [] };
    return { __tenantResponse: true, httpStatus: 200, body: { ok: true } };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-01",
    courses: [{ name: "物理", code: "20260707-01-01" }],
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.results[0].paper_names, ["20260707-01-01物理"]);
  assert.ok(calls.some((call) => String(call.url).includes("/tenant/api/form/list/")));
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
    course_code: "20260707-01-01",
    form_codes: ["FORM-PHY"],
  });
  assert.ok(logs.some((message) => message.includes("GET /tenant/api/form/list/")));
});

test("waits for manual confirmation when tenant form list has duplicate paper names", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (String(url).includes("/tenant/api/form/list/")) {
      return {
        form_list: [
          { code: "FORM-LATEST", name: "20260707-02-01项目", type: "form" },
          { code: "FORM-OLD", name: "20260707-02-01项目", type: "form" },
          { code: "FORM-BIZ", name: "20260707-02-02 业务", type: "form" },
        ],
      };
    }
    if (options.method === "GET") return { code: "20260707-02-01", name: "项目", res: [] };
    return { __tenantResponse: true, httpStatus: 200, body: { ok: true } };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-01",
    courses: [{ name: "项目", code: "20260707-02-01" }],
    requestJson,
    emitLog: () => {},
  });

  assert.equal(result.status, "waiting_manual");
  assert.deepEqual(result.missingCourseCodes, ["20260707-02-01"]);
  assert.deepEqual(result.duplicatePaperMatches, [
    {
      course_code: "20260707-02-01",
      course_name: "项目",
      paper_name: "项目",
      candidates: [
        { code: "FORM-LATEST", name: "20260707-02-01项目" },
        { code: "FORM-OLD", name: "20260707-02-01项目" },
      ],
    },
  ]);
  assert.equal(calls.some((call) => call.options.method === "PUT" || call.options.method === "POST"), false);
});

test("updates the course with matched paper before binding the course to the session", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (String(url).includes("/tenant/api/form/list/")) {
      return {
        form_list: [
          { code: "FORM-PHY", name: "20260707-01-01物理", type: "form" },
          { code: "FORM-CHEM", name: "20260707-01-02化学", type: "form" },
        ],
      };
    }
    if (options.method === "GET") return { code: "20260707-01-01", name: "物理", res: [] };
    return { __tenantResponse: true, httpStatus: 200, body: { ok: true } };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-01",
    courses: [{ name: "物理", code: "20260707-01-01" }],
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(result.status, "success");
  assert.deepEqual(calls.map((call) => [call.options.method, call.url]), [
    ["GET", "https://eztest.cn/tenant/api/courses/20260707-01-01/?apply=form"],
    ["GET", "https://eztest.cn/tenant/api/form/list/?form_type=form&order_by=-id"],
    ["PUT", "https://eztest.cn/tenant/api/course/"],
    ["POST", "https://eztest.cn/tenant/api/course/session/S-01/"],
  ]);
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    code: "20260707-01-01",
    name: "物理",
    form_codes: ["FORM-PHY"],
  });
  assert.deepEqual(JSON.parse(calls[3].options.body), {
    course_code: "20260707-01-01",
    form_codes: ["FORM-PHY"],
  });
  assert.ok(logs.some((message) => message.includes("PUT /tenant/api/course/")));
});

test("rejects paper binding when apply=form returns no form codes", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    return { code: "20260725-04-01", res: [] };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "427535",
    courses: [{ name: "总会", code: "20260725-04-01" }],
    requestJson,
    emitLog: () => {},
  });

  assert.deepEqual(result, { status: "waiting_manual", missingCourseCodes: ["20260725-04-01"] });
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 0);
  assert.equal(calls[0].options.method, "GET");
});

test("detects manually bound paper from tenant session detail", async () => {
  const calls = [];
  const logs = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    return {
      id: "429102",
      name: "四川省通川工程技术开发有限公司校招笔试",
      courses: [
        {
          code: "20260705-01-01",
          name: "四川通川工程",
          forms: [{ code: "FORM-01", name: "20260705_蜀道投资集团有限责任公司招聘笔试（四川通川工程）" }],
        },
      ],
    };
  };

  const result = await detectSessionPaperBindings({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "429102",
    courses: [{ name: "四川通川工程", code: "20260705-01-01" }],
    requestJson,
    emitLog: (message) => logs.push(message),
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.results, [
    {
      session_id: "429102",
      course_name: "四川通川工程",
      course_code: "20260705-01-01",
      form_codes: ["FORM-01"],
      paper_names: ["20260705_蜀道投资集团有限责任公司招聘笔试（四川通川工程）"],
      source: "session_detail",
    },
  ]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://eztest.cn/tenant/api/session/429102/forms/");
  assert.equal(calls[1].url, "https://eztest.cn/tenant/api/session/429102/");
  assert.equal(calls[1].options.method, "GET");
  assert.ok(logs.includes("[试卷绑定] 人工绑定回查 GET /tenant/api/session/429102/forms/"));
  assert.ok(logs.includes("[试卷绑定] 人工绑定回查 GET /tenant/api/session/429102/"));
});

test("detects manually bound paper from tenant session forms endpoint first", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url: String(url), options });
    return {
      results: [
        { code: "FORM-SESSION", name: "场次已绑定试卷", course_code: "C-01", course_name: "单科目" },
      ],
    };
  };

  const result = await detectSessionPaperBindings({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "429514",
    courses: [],
    requestJson,
    emitLog: () => {},
  });

  assert.equal(result.status, "success");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://eztest.cn/tenant/api/session/429514/forms/");
  assert.deepEqual(result.results, [
    {
      session_id: "429514",
      course_name: "单科目",
      course_code: "C-01",
      form_codes: ["FORM-SESSION"],
      paper_names: ["场次已绑定试卷"],
      source: "session_forms",
    },
  ]);
});

test("detects manually bound single-subject paper even when task has no configured courses", async () => {
  const requestJson = async (_login, url) => {
    if (String(url).endsWith("/forms/")) return [];
    return {
    id: "429514",
    name: "考试状态同步最新版本测试",
    courses: [
      {
        code: "MANUAL-01",
        name: "单科目",
        forms: [{ code: "FORM-MANUAL", name: "考试状态同步最新版本测试-人工绑定卷" }],
      },
    ],
    };
  };

  const result = await detectSessionPaperBindings({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "429514",
    courses: [],
    requestJson,
    emitLog: () => {},
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.results, [
    {
      session_id: "429514",
      course_name: "单科目",
      course_code: "MANUAL-01",
      form_codes: ["FORM-MANUAL"],
      paper_names: ["考试状态同步最新版本测试-人工绑定卷"],
      source: "session_detail",
    },
  ]);
});

test("falls back to tenant session list when session detail lookup fails during manual detection", async () => {
  const calls = [];
  const requestJson = async (_login, url) => {
    calls.push(String(url));
    if (String(url).endsWith("/forms/")) return [];
    if (String(url).includes("/tenant/api/session/429514/")) {
      const error = new Error("租户 API 回查正式场次试卷 429514失败：500");
      error.status = 500;
      throw error;
    }
    return {
      results: [
        {
          id: "429514",
          name: "考试状态同步最新版本测试",
          courses: [
            {
              code: "MANUAL-01",
              name: "单科目",
              forms: [{ code: "FORM-MANUAL", name: "考试状态同步最新版本测试-人工绑定卷" }],
            },
          ],
        },
      ],
    };
  };

  const result = await detectSessionPaperBindings({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "429514",
    courses: [],
    requestJson,
    emitLog: () => {},
  });

  assert.equal(result.status, "success");
  assert.equal(calls[0], "https://eztest.cn/tenant/api/session/429514/forms/");
  assert.equal(calls[1], "https://eztest.cn/tenant/api/session/429514/");
  assert.equal(calls[2], "https://eztest.cn/tenant/api/session/?session_ids=429514");
  assert.deepEqual(result.results[0].form_codes, ["FORM-MANUAL"]);
});

test("manual binding detection waits when a course still has no paper in session detail", async () => {
  const requestJson = async (_login, url) => {
    if (String(url).endsWith("/forms/")) return [];
    return {
    data: {
      id: "S-01",
      courses: [
        { code: "C-01", name: "语文", forms: [{ form_code: "F-01", paper_name: "语文卷" }] },
        { code: "C-02", name: "数学", forms: [] },
      ],
    },
    };
  };

  const result = await detectSessionPaperBindings({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-01",
    courses: [{ code: "C-01", name: "语文" }, { code: "C-02", name: "数学" }],
    requestJson,
    emitLog: () => {},
  });

  assert.deepEqual(result, { status: "waiting_manual", missingCourseCodes: ["C-02"] });
});

test("does not partially bind when any course has no form codes", async () => {
  const calls = [];
  const requestJson = async (_login, url, options) => {
    calls.push({ url, options });
    if (url.includes("C-01")) return { code: "C-01", res: [{ code: "F-01" }] };
    return { code: "C-02", res: [] };
  };

  const result = await bindPapersToFormalSession({
    login: {},
    apiBase: "https://eztest.cn",
    sessionId: "S-01",
    courses: [{ name: "语文", code: "C-01" }, { name: "数学", code: "C-02" }],
    requestJson,
    emitLog: () => {},
  });

  assert.deepEqual(result, { status: "waiting_manual", missingCourseCodes: ["C-02"] });
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 0);
});

test("validates paper binding inputs", () => {
  assert.throws(() => validatePaperBinding({ sessionId: "", courseCode: "C1", formCodes: ["F1"] }));
  assert.throws(() => validatePaperBinding({ sessionId: "S1", courseCode: "", formCodes: ["F1"] }));
  assert.throws(() => validatePaperBinding({ sessionId: "S1", courseCode: "C1", formCodes: [] }), {
    message: MISSING_FORM_CODES_MESSAGE,
  });
});
