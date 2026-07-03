import assert from "node:assert/strict";
import test from "node:test";

import {
  decideCustomerServiceAction,
  normalizeTenantSessions,
  runCustomerServiceScheduler,
  runCustomerServiceSchedulerForTargets,
} from "./customer_service_scheduler.mjs";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-07-02T10:00:00.000Z");

function session(overrides = {}) {
  return {
    id: "428516",
    name: "考试 A",
    start: Math.floor((NOW + HOUR) / 1000),
    end: Math.floor((NOW + 3 * HOUR) / 1000),
    config: { customer_service: false },
    ...overrides,
  };
}

test("decides to enable customer service inside the 24 hour pre-exam window", () => {
  const result = decideCustomerServiceAction(session(), NOW);
  assert.equal(result.action, "enable");
  assert.equal(result.desiredEnabled, true);
});

test("decides to disable customer service after exam end", () => {
  const result = decideCustomerServiceAction(
    session({
      start: Math.floor((NOW - 3 * HOUR) / 1000),
      end: Math.floor((NOW - HOUR) / 1000),
      config: { customer_service: true },
    }),
    NOW,
  );
  assert.equal(result.action, "disable");
  assert.equal(result.desiredEnabled, false);
});

test("skips sessions before the 24 hour window", () => {
  const result = decideCustomerServiceAction(
    session({
      start: Math.floor((NOW + DAY + HOUR) / 1000),
      end: Math.floor((NOW + DAY + 3 * HOUR) / 1000),
    }),
    NOW,
  );
  assert.equal(result.action, "skip_before_window");
});

test("skips sessions whose customer service state is already correct", () => {
  const result = decideCustomerServiceAction(session({ config: { customer_service: true } }), NOW);
  assert.equal(result.action, "skip_already_correct");
});

test("skips sessions with invalid times", () => {
  const result = decideCustomerServiceAction(session({ start: "", end: "" }), NOW);
  assert.equal(result.action, "skip_missing_time");
});

test("normalizes list payload variants into sessions", () => {
  assert.deepEqual(normalizeTenantSessions({ results: [session({ id: 1 })] }).map((item) => item.id), ["1"]);
  assert.deepEqual(normalizeTenantSessions({ sessions: [session({ id: 3 })] }).map((item) => item.id), ["3"]);
  assert.deepEqual(
    normalizeTenantSessions({ data: { list: [session({ id: undefined, session_id: 2 })] } }).map((item) => item.id),
    ["2"],
  );
});

test("uses EasyExam open_talk as the customer service switch", () => {
  const result = decideCustomerServiceAction(session({ config: {}, extra: { open_talk: true } }), NOW);
  assert.equal(result.action, "skip_already_correct");
  assert.equal(result.desiredEnabled, true);
});

test("parses EasyExam slash-formatted session times", () => {
  const result = decideCustomerServiceAction(
    session({
      start: "2026/07/03 11:00",
      end: "2026/07/03 13:00",
      config: {},
      extra: { open_talk: false },
    }),
    Date.parse("2026-07-03T10:00:00.000+08:00"),
  );
  assert.equal(result.action, "enable");
  assert.equal(result.desiredEnabled, true);
});

test("scheduler updates mismatched sessions and skips already-correct sessions", async () => {
  const calls = [];
  const sessions = [
    session({ id: "open-me", config: { customer_service: false } }),
    session({ id: "already-open", config: { customer_service: true } }),
    session({
      id: "close-me",
      start: Math.floor((NOW - 3 * HOUR) / 1000),
      end: Math.floor((NOW - HOUR) / 1000),
      config: { customer_service: true },
    }),
  ];
  const fetchImpl = async (url, options = {}) => {
    calls.push({
      url: String(url),
      method: options.method || "GET",
      body: options.body || "",
      cookie: options.headers?.Cookie || options.headers?.cookie || "",
    });
    if (String(url).endsWith("/dapi/login/")) return jsonResponse({ ok: true }, 200, { "set-cookie": "sessionid=abc123; Path=/" });
    if (String(url).endsWith("/tenant/api/session/")) return jsonResponse({ results: sessions });
    if (String(url).includes("/get_session_detail_count/")) return jsonResponse({ data: { entries_num: 0 } });
    const id = String(url).match(/session\/([^/]+)\//)?.[1];
    if (String(url).match(/\/dapi\/schedule\/session\/[^/]+\/$/)) {
      const current = sessions.find((item) => item.id === id)?.config?.customer_service === true;
      return jsonResponse({ data: { session: { config: { customer_service: current } } } });
    }
    return jsonResponse(sessions.find((item) => item.id === id));
  };

  const result = await runCustomerServiceScheduler({
    apiBase: "https://eztest.cn",
    apiKey: "secret",
    login: { username: "admin@example.com", password: "pass" },
    now: NOW,
    fetchImpl,
    logger: () => {},
  });

  assert.equal(result.updated, 2);
  assert.equal(result.skipped, 1);
  assert.deepEqual(
    calls.filter((call) => call.method === "POST" && call.url.includes("/dapi/schedule/session/")).map((call) => ({
      url: call.url,
      body: JSON.parse(call.body),
      cookie: call.cookie,
    })),
    [
      {
        url: "https://eztest.org/dapi/schedule/session/open-me/customer/",
        body: { customer: 1 },
        cookie: "sessionid=abc123",
      },
      {
        url: "https://eztest.org/dapi/schedule/session/close-me/customer/",
        body: { customer: 0 },
        cookie: "sessionid=abc123",
      },
    ],
  );
});

test("scheduler dry-run reports updates without writing", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    return jsonResponse({ results: [session()] });
  };

  const result = await runCustomerServiceScheduler({
    apiBase: "https://eztest.cn",
    apiKey: "secret",
    now: NOW,
    fetchImpl,
    dryRun: true,
    logger: () => {},
  });

  assert.equal(result.planned, 1);
  assert.equal(result.updated, 0);
  assert.equal(calls.some((call) => call.method === "PUT"), false);
});

test("scheduler skips write when manager detail already has the desired customer service state", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    if (String(url).endsWith("/dapi/login/")) return jsonResponse({ ok: true }, 200, { "set-cookie": "sessionid=abc123; Path=/" });
    if (String(url).endsWith("/tenant/api/session/")) return jsonResponse({ results: [session({ config: { customer_service: false } })] });
    if (String(url).includes("/get_session_detail_count/")) return jsonResponse({ data: { entries_num: 0 } });
    if (String(url).match(/\/dapi\/schedule\/session\/[^/]+\/$/)) {
      return jsonResponse({ data: { session: { config: { customer_service: true } } } });
    }
    return jsonResponse({ ok: true });
  };

  const result = await runCustomerServiceScheduler({
    apiBase: "https://eztest.cn",
    apiKey: "secret",
    login: { username: "admin@example.com", password: "pass" },
    now: NOW,
    fetchImpl,
    logger: () => {},
  });

  assert.equal(result.updated, 0);
  assert.equal(result.failed, 0);
  assert.equal(calls.some((call) => call.method === "POST" && call.url.includes("/customer/")), false);
});

test("scheduler closes expired sessions when manager detail is still enabled even if tenant list says disabled", async () => {
  const calls = [];
  const expired = session({
    id: "expired-open",
    start: Math.floor((NOW - 3 * HOUR) / 1000),
    end: Math.floor((NOW - HOUR) / 1000),
    config: { customer_service: false },
    extra: { open_talk: false },
  });
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body || "" });
    if (String(url).endsWith("/dapi/login/")) return jsonResponse({ ok: true }, 200, { "set-cookie": "sessionid=abc123; Path=/" });
    if (String(url).endsWith("/tenant/api/session/")) return jsonResponse({ results: [expired] });
    if (String(url).includes("/get_session_detail_count/")) return jsonResponse({ data: { entries_num: 0 } });
    if (String(url).match(/\/dapi\/schedule\/session\/[^/]+\/$/)) {
      return jsonResponse({ data: { session: { config: { customer_service: true } } } });
    }
    return jsonResponse({ data: { customer_service: false } });
  };

  const result = await runCustomerServiceScheduler({
    apiBase: "https://eztest.cn",
    apiKey: "secret",
    login: { username: "admin@example.com", password: "pass" },
    now: NOW,
    fetchImpl,
    logger: () => {},
  });

  assert.equal(result.updated, 1);
  assert.deepEqual(
    calls.filter((call) => call.method === "POST" && call.url.includes("/customer/")).map((call) => JSON.parse(call.body)),
    [{ customer: 0 }],
  );
});

test("scheduler continues after one session update fails", async () => {
  const sessions = [
    session({ id: "bad", config: { customer_service: false } }),
    session({ id: "good", config: { customer_service: false } }),
  ];
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith("/dapi/login/")) return jsonResponse({ ok: true }, 200, { "set-cookie": "sessionid=abc123; Path=/" });
    if (String(url).endsWith("/tenant/api/session/")) return jsonResponse({ results: sessions });
    if (String(url).includes("/get_session_detail_count/")) return jsonResponse({ data: { entries_num: 0 } });
    if (String(url).match(/\/dapi\/schedule\/session\/[^/]+\/$/)) {
      return jsonResponse({ data: { session: { config: { customer_service: false } } } });
    }
    if ((options.method || "GET") === "POST" && String(url).includes("/bad/")) return jsonResponse({ error: "nope" }, 500);
    const id = String(url).match(/session\/([^/]+)\//)?.[1];
    return jsonResponse(sessions.find((item) => item.id === id));
  };

  const result = await runCustomerServiceScheduler({
    apiBase: "https://eztest.cn",
    apiKey: "secret",
    login: { username: "admin@example.com", password: "pass" },
    now: NOW,
    fetchImpl,
    logger: () => {},
  });

  assert.equal(result.updated, 1);
  assert.equal(result.failed, 1);
});

test("profile scheduler runs all enabled targets", async () => {
  const apiKeys = [];
  const fetchImpl = async (url, options = {}) => {
    apiKeys.push(String(options.headers?.Authorization || ""));
    if (String(url).endsWith("/dapi/login/")) return jsonResponse({ ok: true }, 200, { "set-cookie": "sessionid=abc123; Path=/" });
    if (String(url).endsWith("/tenant/api/session/")) return jsonResponse({ results: [session()] });
    if (String(url).includes("/get_session_detail_count/")) return jsonResponse({ data: { entries_num: 0 } });
    if (String(url).match(/\/dapi\/schedule\/session\/[^/]+\/$/)) {
      return jsonResponse({ data: { session: { config: { customer_service: false } } } });
    }
    const id = String(url).match(/session\/([^/]+)\//)?.[1];
    return jsonResponse(session({ id }));
  };

  const result = await runCustomerServiceSchedulerForTargets({
    targets: [
      {
        userId: "alice@example.com",
        profileId: "p1",
        label: "Alice",
        apiBase: "https://eztest.cn",
        apiKey: "alice-key",
        login: { username: "alice@example.com", password: "pass" },
      },
      {
        userId: "bob@example.com",
        profileId: "p2",
        label: "Bob",
        apiBase: "https://eztest.cn",
        apiKey: "bob-key",
        login: { username: "bob@example.com", password: "pass" },
      },
    ],
    now: NOW,
    fetchImpl,
    logger: () => {},
  });

  assert.equal(result.failedProfiles, 0);
  assert.deepEqual(result.profiles.map((profile) => profile.updated), [1, 1]);
  assert.ok(apiKeys.includes("Key alice-key"));
  assert.ok(apiKeys.includes("Key bob-key"));
});

test("profile scheduler continues when one target fails", async () => {
  const fetchImpl = async (url, options = {}) => {
    if (String(options.headers?.Authorization || "").includes("bad-key")) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
    if (String(url).endsWith("/dapi/login/")) return jsonResponse({ ok: true }, 200, { "set-cookie": "sessionid=abc123; Path=/" });
    if (String(url).endsWith("/tenant/api/session/")) return jsonResponse({ results: [session()] });
    if (String(url).includes("/get_session_detail_count/")) return jsonResponse({ data: { entries_num: 0 } });
    if (String(url).match(/\/dapi\/schedule\/session\/[^/]+\/$/)) {
      return jsonResponse({ data: { session: { config: { customer_service: false } } } });
    }
    const id = String(url).match(/session\/([^/]+)\//)?.[1];
    return jsonResponse(session({ id }));
  };

  const result = await runCustomerServiceSchedulerForTargets({
    targets: [
      { userId: "bad@example.com", profileId: "bad", label: "Bad", apiBase: "https://eztest.cn", apiKey: "bad-key" },
      {
        userId: "good@example.com",
        profileId: "good",
        label: "Good",
        apiBase: "https://eztest.cn",
        apiKey: "good-key",
        login: { username: "good@example.com", password: "pass" },
      },
    ],
    now: NOW,
    fetchImpl,
    logger: () => {},
  });

  assert.equal(result.totalProfiles, 2);
  assert.equal(result.failedProfiles, 1);
  assert.equal(result.profiles.find((profile) => profile.profileId === "good").updated, 1);
  assert.match(result.profiles.find((profile) => profile.profileId === "bad").error, /获取场次列表失败/);
});

function jsonResponse(payload, status = 200, headers = {}) {
  return jsonResponseWithHeaders(payload, status, headers);
}

function jsonResponseWithHeaders(payload, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] || headers[name] || "";
      },
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}
