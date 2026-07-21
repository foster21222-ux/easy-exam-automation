import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChromeFanweiAutoReadAppleScript,
  buildFanweiDomExtractorScript,
  buildWindowsChromeLaunchArgs,
  chromeDevToolsListUrl,
  chromeDevToolsWebSocketUrl,
  escapeAppleScriptString,
  extractFanweiExamSceneRows,
  fanweiAutoReadPlatform,
  fanweiAutoReadUnavailableMessage,
  findMacChromeExecutable,
  findWindowsChromeExecutable,
  isAllowedChromeDevToolsWebSocketUrl,
  parseFanweiAutoReadOutput,
  runChromeDevToolsFanweiRead,
} from "./fanwei_auto_read.mjs";

test("extracts an all-day exam scene row from the real Fanwei grid layout", () => {
  const sceneRows = extractFanweiExamSceneRows([
    ["", "序号", "考试日期", "考试时间", "当天场次数", "场次安排说明"],
    ["", "1", "2024-11-24", "全天", "2", "2"],
  ]);

  assert.deepEqual(sceneRows, [{
    "序号": "1",
    "考试日期": "2024-11-24",
    "考试时间": "全天",
    "当天场次数": "2",
    "场次安排说明": "2",
  }]);
});

test("fanwei auto read AppleScript scans open Chrome tabs and executes DOM extractor", () => {
  const script = buildChromeFanweiAutoReadAppleScript({ serialNo: "R0042182" });

  assert.match(script, /tell application "Google Chrome"/);
  assert.match(script, /repeat with chromeTab in tabs of chromeWindow/);
  assert.doesNotMatch(script, /tabUrl contains "oa\.ata\.net\.cn"/);
  assert.match(script, /tabUrl starts with "https:\/\/oa\.ata\.net\.cn\/"/);
  assert.match(script, /tell chromeTab to set jsResult to execute javascript/);
  assert.match(script, /R0042182/);
  assert.doesNotMatch(script, /api\/fanwei\/bridge\/submit/);
});

test("fanwei DOM extractor returns only the requested serial when present", () => {
  const extractor = buildFanweiDomExtractorScript({ serialNo: "R0042182" });

  assert.match(extractor, /"流水号":"运控流水号"/);
  assert.match(extractor, /"销售项目名称":"项目名称"/);
  assert.match(extractor, /"本批次预估科次":"预估科次"/);
  assert.match(extractor, /fieldAliases\[rawKey\] \|\| rawKey/);
  assert.match(extractor, /fields\["运控流水号"\] !== expectedSerial/);
  assert.match(extractor, /!fields\["运控流水号"\]/);
  assert.match(extractor, /return ""/);
  assert.doesNotMatch(extractor, /fields\["运控流水号"\] = expectedSerial/);
  assert.match(extractor, /JSON\.stringify\(\{ requestid, fields, examSceneRows: sceneRows, opaRows \}\)/);
});

test("fanwei DOM extractor ignores conditionally hidden form rows", () => {
  const extractor = buildFanweiDomExtractorScript();

  assert.match(extractor, /getClientRects\(\)\.length/);
  assert.match(extractor, /row\.cells\.length && isVisible\(row\.tr\)/);
});

test("fanwei DOM extractor preserves line breaks in other description", () => {
  const extractor = buildFanweiDomExtractorScript();

  assert.match(extractor, /const cleanMultiline/);
  assert.match(extractor, /key === "其他说明" \? cleanMultiline\(value\) : clean\(value\)/);
  assert.match(extractor, /cleanMultiline\(valueCell\.innerText \|\| valueCell\.textContent\)/);
});

test("AppleScript strings escape quotes, backslashes and newlines", () => {
  assert.equal(escapeAppleScriptString('a"b\\c\n'), 'a\\"b\\\\c\\n');
});

test("fanwei auto read output parser handles empty and JSON payloads", () => {
  assert.equal(parseFanweiAutoReadOutput(""), null);
  assert.deepEqual(parseFanweiAutoReadOutput('{"fields":{"运控流水号":"R0042182"}}'), {
    fields: { "运控流水号": "R0042182" },
  });
});

test("Chrome DevTools helpers use the local debugging endpoint", () => {
  assert.equal(chromeDevToolsListUrl(9222), "http://127.0.0.1:9222/json");
  assert.equal(
    chromeDevToolsWebSocketUrl("ws://127.0.0.1:9222/devtools/page/abc"),
    "ws://127.0.0.1:9222/devtools/page/abc",
  );
  assert.equal(
    chromeDevToolsWebSocketUrl("ws://localhost:9222/devtools/page/abc"),
    "ws://127.0.0.1:9222/devtools/page/abc",
  );
});

test("Chrome DevTools WebSocket URLs must stay on the configured loopback port", () => {
  assert.equal(isAllowedChromeDevToolsWebSocketUrl("ws://127.0.0.1:9222/devtools/page/abc", 9222), true);
  assert.equal(isAllowedChromeDevToolsWebSocketUrl("ws://localhost:9222/devtools/page/abc", 9222), true);
  assert.equal(isAllowedChromeDevToolsWebSocketUrl("ws://[::1]:9222/devtools/page/abc", 9222), true);
  assert.equal(isAllowedChromeDevToolsWebSocketUrl("wss://127.0.0.1:9222/devtools/page/abc", 9222), false);
  assert.equal(isAllowedChromeDevToolsWebSocketUrl("ws://attacker.example:9222/devtools/page/abc", 9222), false);
  assert.equal(isAllowedChromeDevToolsWebSocketUrl("ws://127.0.0.1:9333/devtools/page/abc", 9222), false);
});

test("auto read platform detection supports macOS and Windows", () => {
  assert.equal(fanweiAutoReadPlatform("darwin"), "chrome_devtools");
  assert.equal(fanweiAutoReadPlatform("win32"), "windows_devtools");
  assert.equal(fanweiAutoReadPlatform("linux"), "unsupported");
});

test("auto read unavailable messages are platform specific", () => {
  assert.match(fanweiAutoReadUnavailableMessage("chrome_applescript_javascript_disabled"), /允许 Apple 事件中的 JavaScript/);
  assert.match(fanweiAutoReadUnavailableMessage("chrome_devtools_unavailable"), /Windows/);
  assert.match(fanweiAutoReadUnavailableMessage("unsupported_platform", "linux"), /linux/);
});

test("Windows Chrome DevTools reader evaluates extractor in matching Fanwei tab", async () => {
  const calls = [];
  const fanweiPayload = { requestid: "1505614", fields: { "运控流水号": "R0042182" }, examSceneRows: [], opaRows: [] };
  const result = await runChromeDevToolsFanweiRead({
    serialNo: "R0042182",
    fetchImpl: async (url) => {
      calls.push(url);
      assert.equal(url, "http://127.0.0.1:9222/json");
      return {
        ok: true,
        status: 200,
        json: async () => [
          { url: "https://example.com", webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/ignore" },
          { url: "https://oa.ata.net.cn/spa/workflow/static4form/index.html#/main/workflow/req?requestid=1505614", webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/fanwei" },
        ],
      };
    },
    webSocketFactory: (url) => {
      assert.equal(url, "ws://127.0.0.1:9222/devtools/page/fanwei");
      return {
        send: (message) => {
          const parsed = JSON.parse(message);
          assert.equal(parsed.method, "Runtime.evaluate");
          assert.match(parsed.params.expression, /R0042182/);
        },
        close: () => {},
        on: (event, handler) => {
          if (event === "open") queueMicrotask(handler);
          if (event === "message") queueMicrotask(() => handler(JSON.stringify({
            id: 1,
            result: { result: { value: JSON.stringify(fanweiPayload) } },
          })));
        },
      };
    },
  });

  assert.deepEqual(result, fanweiPayload);
  assert.deepEqual(calls, ["http://127.0.0.1:9222/json"]);
});

test("Chrome DevTools reader rejects Runtime.evaluate exception details", async () => {
  await assert.rejects(
    runChromeDevToolsFanweiRead({
      serialNo: "R0042377",
      fetchImpl: async () => ({
        ok: true,
        json: async () => [{
          url: "https://oa.ata.net.cn/workflow",
          webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/fanwei",
        }],
      }),
      webSocketFactory: () => ({
        send() {},
        close() {},
        on(event, handler) {
          if (event === "open") queueMicrotask(handler);
          if (event === "message") queueMicrotask(() => handler(JSON.stringify({
            id: 1,
            result: {
              result: { subtype: "error" },
              exceptionDetails: {
                text: "Uncaught",
                exception: { description: "ReferenceError: extractor failed" },
              },
            },
          })));
        },
      }),
    }),
    /Chrome DevTools 执行失败.*ReferenceError: extractor failed/,
  );
});

test("Chrome DevTools reader aborts a stalled tab-list request", async () => {
  let requestSignal;
  const read = runChromeDevToolsFanweiRead({
    timeoutMs: 10,
    fetchImpl: async (_url, options = {}) => {
      requestSignal = options.signal;
      return await new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          reject(options.signal.reason || new Error("aborted"));
        }, { once: true });
      });
    },
  });

  await assert.rejects(read, /Chrome DevTools 自动读取超时/);
  assert.equal(requestSignal?.aborted, true);
});

test("Chrome DevTools reader rejects deceptive Fanwei hostnames", async () => {
  let webSocketCalls = 0;
  const result = await runChromeDevToolsFanweiRead({
    fetchImpl: async () => ({
      ok: true,
      json: async () => [{
        url: "https://oa.ata.net.cn.evil.example/workflow",
        webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/evil",
      }],
    }),
    webSocketFactory: () => {
      webSocketCalls += 1;
      throw new Error("must not connect");
    },
  });

  assert.equal(result, null);
  assert.equal(webSocketCalls, 0);
});

test("Chrome DevTools reader checks Fanwei tabs in order until the serial matches", async () => {
  const openedSockets = [];
  const expected = { fields: { "运控流水号": "R0042377" } };
  const result = await runChromeDevToolsFanweiRead({
    serialNo: "R0042377",
    fetchImpl: async () => ({
      ok: true,
      json: async () => [
        { url: "https://oa.ata.net.cn/workflow/first", webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/first" },
        { url: "https://oa.ata.net.cn/workflow/second", webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/second" },
      ],
    }),
    webSocketFactory: (url) => {
      openedSockets.push(url);
      const value = url.endsWith("/first") ? "" : JSON.stringify(expected);
      return {
        send() {},
        close() {},
        on(event, handler) {
          if (event === "open") queueMicrotask(handler);
          if (event === "message") queueMicrotask(() => handler(JSON.stringify({
            id: 1,
            result: { result: { value } },
          })));
        },
      };
    },
  });

  assert.deepEqual(result, expected);
  assert.deepEqual(openedSockets, [
    "ws://127.0.0.1:9222/devtools/page/first",
    "ws://127.0.0.1:9222/devtools/page/second",
  ]);
});

test("Chrome DevTools reader skips a stale Fanwei target and reads the next tab", async () => {
  const openedSockets = [];
  const expected = { fields: { "运控流水号": "R0042377" } };
  const result = await runChromeDevToolsFanweiRead({
    serialNo: "R0042377",
    fetchImpl: async () => ({
      ok: true,
      json: async () => [
        { url: "https://oa.ata.net.cn/workflow/stale", webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/stale" },
        { url: "https://oa.ata.net.cn/workflow/live", webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/live" },
      ],
    }),
    webSocketFactory: (url) => {
      openedSockets.push(url);
      return {
        send() {},
        close() {},
        on(event, handler) {
          if (event === "open") queueMicrotask(handler);
          if (url.endsWith("/stale") && event === "close") queueMicrotask(handler);
          if (url.endsWith("/live") && event === "message") queueMicrotask(() => handler(JSON.stringify({
            id: 1,
            result: { result: { value: JSON.stringify(expected) } },
          })));
        },
      };
    },
  });

  assert.deepEqual(result, expected);
  assert.deepEqual(openedSockets, [
    "ws://127.0.0.1:9222/devtools/page/stale",
    "ws://127.0.0.1:9222/devtools/page/live",
  ]);
});

test("Chrome DevTools reader rejects unsafe debugger WebSocket URLs without connecting", async () => {
  let webSocketCalls = 0;
  const result = await runChromeDevToolsFanweiRead({
    port: 9222,
    fetchImpl: async () => ({
      ok: true,
      json: async () => [
        { url: "https://oa.ata.net.cn/a", webSocketDebuggerUrl: "ws://attacker.example:9222/devtools/page/a" },
        { url: "https://oa.ata.net.cn/b", webSocketDebuggerUrl: "wss://127.0.0.1:9222/devtools/page/b" },
        { url: "https://oa.ata.net.cn/c", webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/page/c" },
      ],
    }),
    webSocketFactory: () => {
      webSocketCalls += 1;
      throw new Error("must not connect");
    },
  });

  assert.equal(result, null);
  assert.equal(webSocketCalls, 0);
});

test("Chrome DevTools reader rejects a synchronous socket send failure", async () => {
  await assert.rejects(
    runChromeDevToolsFanweiRead({
      timeoutMs: 20,
      fetchImpl: async () => ({
        ok: true,
        json: async () => [{
          url: "https://oa.ata.net.cn/workflow",
          webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/fanwei",
        }],
      }),
      webSocketFactory: () => ({
        send() { throw new Error("socket send failed"); },
        close() {},
        on(event, handler) {
          if (event === "open") queueMicrotask(handler);
        },
      }),
    }),
    /socket send failed/,
  );
});

test("Chrome DevTools reader settles once and removes socket listeners", async () => {
  const handlers = new Map();
  const removed = [];
  let closeCalls = 0;
  const socket = {
    send() {},
    close() {
      closeCalls += 1;
      handlers.get("close")?.();
    },
    on(event, handler) {
      handlers.set(event, handler);
      if (event === "open") queueMicrotask(handler);
      if (event === "message") queueMicrotask(() => handler(JSON.stringify({
        id: 1,
        result: { result: { value: JSON.stringify({ fields: { "运控流水号": "R0042377" } }) } },
      })));
    },
    off(event, handler) {
      if (handlers.get(event) === handler) handlers.delete(event);
      removed.push(event);
    },
  };

  const result = await runChromeDevToolsFanweiRead({
    serialNo: "R0042377",
    fetchImpl: async () => ({
      ok: true,
      json: async () => [{
        url: "https://oa.ata.net.cn/workflow",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/fanwei",
      }],
    }),
    webSocketFactory: () => socket,
  });

  assert.equal(result.fields["运控流水号"], "R0042377");
  assert.equal(closeCalls, 1);
  assert.deepEqual([...new Set(removed)].sort(), ["close", "error", "message", "open"]);
  assert.equal(handlers.size, 0);
});

test("Chrome DevTools reader rejects when the socket closes before a result", async () => {
  await assert.rejects(
    runChromeDevToolsFanweiRead({
      timeoutMs: 20,
      fetchImpl: async () => ({
        ok: true,
        json: async () => [{
          url: "https://oa.ata.net.cn/workflow",
          webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/fanwei",
        }],
      }),
      webSocketFactory: () => ({
        send() {},
        close() {},
        on(event, handler) {
          if (event === "open") queueMicrotask(handler);
          if (event === "close") queueMicrotask(handler);
        },
        off() {},
      }),
    }),
    /WebSocket.*关闭/,
  );
});

test("Windows Chrome launcher uses a dedicated profile and debugging port", () => {
  const args = buildWindowsChromeLaunchArgs({
    userDataDir: "C:\\Users\\coworker\\AppData\\Local\\EasyExam\\chrome-fanwei",
    port: 9222,
    startUrl: "https://oa.ata.net.cn/",
  });

  assert.ok(args.includes("--remote-debugging-port=9222"));
  assert.ok(args.includes("--remote-allow-origins=http://127.0.0.1:9222"));
  assert.ok(args.includes("--user-data-dir=C:\\Users\\coworker\\AppData\\Local\\EasyExam\\chrome-fanwei"));
  assert.ok(args.includes("--no-first-run"));
  assert.equal(args.at(-1), "https://oa.ata.net.cn/");
});

test("Windows Chrome executable discovery checks common install locations", () => {
  const existingPath = findWindowsChromeExecutable({
    env: {
      PROGRAMFILES: "C:\\Program Files",
      "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
      LOCALAPPDATA: "C:\\Users\\coworker\\AppData\\Local",
    },
    existsSync: (candidate) => candidate === "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });

  assert.equal(existingPath, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
});

test("macOS Chrome executable discovery checks the app bundle", () => {
  const existingPath = findMacChromeExecutable({
    existsSync: (candidate) => candidate === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });

  assert.equal(existingPath, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
});
