import path from "node:path";

export function escapeAppleScriptString(value = "") {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\n");
}

export function extractFanweiExamSceneRows(rowCells = []) {
  const rows = Array.isArray(rowCells)
    ? rowCells.map((row) => Array.isArray(row) ? row.map((cell) => String(cell ?? "").replace(/\s+/g, " ").trim()) : [])
    : [];
  const requiredHeaders = ["序号", "考试日期", "考试时间", "场次安排说明"];
  const headerIndex = rows.findIndex((row) => requiredHeaders.every((header) => row.includes(header)));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex];
  const column = Object.fromEntries(headers.map((header, index) => [header, index]));
  return rows.slice(headerIndex + 1).flatMap((row) => {
    const date = row[column["考试日期"]] || "";
    if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(date)) return [];
    return [{
      "序号": row[column["序号"]] || "",
      "考试日期": date,
      "考试时间": row[column["考试时间"]] || "",
      "当天场次数": column["当天场次数"] === undefined ? "" : row[column["当天场次数"]] || "",
      "场次安排说明": row[column["场次安排说明"]] || "",
    }];
  });
}

export function buildFanweiDomExtractorScript({ serialNo = "" } = {}) {
  return `(() => {
  const expectedSerial = ${JSON.stringify(String(serialNo || "").trim())};
  const extractSceneRows = ${extractFanweiExamSceneRows.toString()};
  const clean = (value) => String(value ?? "")
    .replace(/\\u00a0/g, " ")
    .replace(/[ \\t\\r\\n]+/g, " ")
    .replace(/\\s+([；;])/g, "$1")
    .trim();
  const cleanMultiline = (value) => String(value ?? "")
    .replace(/\\u00a0/g, " ")
    .replace(/\\r\\n?/g, "\\n")
    .replace(/[ \\t\\f\\v]+/g, " ")
    .replace(/ *\\n+ */g, "\\n")
    .trim();
  const selectedLabels = (container) => Array.from(container.querySelectorAll("input:checked")).map((input) => {
    const label = input.closest("label") || (input.id ? document.querySelector('label[for="' + input.id + '"]') : null) || input.parentElement;
    return clean(label?.innerText || label?.textContent || input.value || input.getAttribute("title") || input.getAttribute("name"));
  }).filter(Boolean);
  const isVisible = (element) => Boolean(element && element.getClientRects().length);
  const rows = Array.from(document.querySelectorAll("tr")).map((tr) => {
    const elements = Array.from(tr.children);
    const cells = elements.map((td) => clean(td.innerText || td.textContent));
    return { tr, elements, cells };
  }).filter((row) => row.cells.length && isVisible(row.tr));
  const fieldKeys = [
    "标题","申请人","申请人部门","申请日期","运控流水号","项目名称","项目编码","客户名称（仅供参考）","客户及项目属性","业务方向","系统类型","预估科次","预估收入","结算依据","考试服务范围","报名方式","是否需要报名网站","在线报名开始时间","是否需要ATA安排人工监考","是否需要ATA安排集中监考场地","ATA内容制题参与方式","内容来源","试题类型","科目数","试卷数","是否需要封闭制题","是否需要人工阅卷","阅卷安排","EPI测试","性格测试工具","考核内容是否仅性格测试","其他说明","附件","选项项目组长","选择项目经理","项目经理操作"
  ];
  const fieldAliases = {"流水号":"运控流水号","销售项目名称":"项目名称","本批次预估科次":"预估科次"};
  const fields = {};
  const setField = (key, value) => {
    const cleaned = key === "其他说明" ? cleanMultiline(value) : clean(value);
    if (key && cleaned && cleaned !== key) fields[key] = cleaned;
  };
  rows.forEach(({ tr, cells }) => {
    for (let i = 0; i < cells.length; i += 1) {
      const rawKey = clean(cells[i]).replace(/[:：]$/, "");
      const key = fieldAliases[rawKey] || rawKey;
      if (!fieldKeys.includes(key)) continue;
      const valueCell = tr.children[i + 1] || tr.children[i]?.nextElementSibling || tr;
      const checked = selectedLabels(valueCell);
      const next = key === "其他说明"
        ? cleanMultiline(valueCell.innerText || valueCell.textContent)
        : cells[i + 1] || "";
      setField(key, checked.length ? checked.join("；") : next);
    }
  });
  if (expectedSerial && (!fields["运控流水号"] || fields["运控流水号"] !== expectedSerial)) return "";
  const text = clean(document.body?.innerText || "");
  const sceneRows = [];
  const seenScenes = new Set();
  Array.from(document.querySelectorAll("table")).forEach((table) => {
    const matrix = Array.from(table.rows || []).map((row) => Array.from(row.cells || []).map((cell) => clean(cell.innerText || cell.textContent)));
    extractSceneRows(matrix).forEach((scene) => {
      const key = [scene["考试日期"], scene["考试时间"], scene["当天场次数"], scene["场次安排说明"]].join("|");
      if (seenScenes.has(key)) return;
      seenScenes.add(key);
      sceneRows.push(scene);
    });
  });
  const opaRows = [];
  const opaPattern = /(\\d+)\\s+(SHL[-－]OPQ32)\\s+([^\\s]+(?:（[^）]+）)?)\\s+(.+?)\\s+(是|否)\\s+(\\d+)/g;
  let match;
  while ((match = opaPattern.exec(text)) && opaRows.length < 8) {
    if (!/报告/.test(match[4])) continue;
    opaRows.push({
      "序号": match[1],
      "OPA测评工具": match[2],
      "常模类型": match[3],
      "OPA报告类型": clean(match[4]),
      "是否即测即出报告": match[5],
      "时长（分钟）": match[6],
    });
  }
  const requestid = new URLSearchParams(location.hash.split("?")[1] || location.search).get("requestid") || "";
  return JSON.stringify({ requestid, fields, examSceneRows: sceneRows, opaRows });
})()`;
}

export function buildChromeFanweiAutoReadAppleScript({ serialNo = "" } = {}) {
  const js = escapeAppleScriptString(buildFanweiDomExtractorScript({ serialNo }));
  return `set fanweiResult to ""
set lastFanweiError to ""
set lastFanweiErrorNumber to 0
tell application "Google Chrome"
  repeat with chromeWindow in windows
    repeat with chromeTab in tabs of chromeWindow
      set tabUrl to URL of chromeTab
      if tabUrl is "https://oa.ata.net.cn" or tabUrl starts with "https://oa.ata.net.cn/" or tabUrl is "http://oa.ata.net.cn" or tabUrl starts with "http://oa.ata.net.cn/" then
        try
          tell chromeTab to set jsResult to execute javascript "${js}"
          if jsResult is not missing value and jsResult is not "" then
            set fanweiResult to jsResult
            return fanweiResult
          end if
        on error errMsg number errNo
          set lastFanweiError to errMsg
          set lastFanweiErrorNumber to errNo
        end try
      end if
    end repeat
  end repeat
end tell
if lastFanweiError is not "" then error lastFanweiError number lastFanweiErrorNumber
return fanweiResult`;
}

export function chromeDevToolsListUrl(port = 9222) {
  return `http://127.0.0.1:${Number(port || 9222)}/json`;
}

export function chromeDevToolsWebSocketUrl(url = "") {
  return String(url || "").replace(/^ws:\/\/localhost:/, "ws://127.0.0.1:");
}

export function isAllowedChromeDevToolsWebSocketUrl(value = "", port = 9222) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "ws:" &&
      new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname) &&
      url.port === String(Number(port));
  } catch {
    return false;
  }
}

export function isFanweiPageUrl(value = "") {
  try {
    const url = new URL(String(value || ""));
    return (url.protocol === "https:" || url.protocol === "http:") &&
      (url.hostname === "oa.ata.net.cn" || url.hostname.endsWith(".oa.ata.net.cn"));
  } catch {
    return false;
  }
}

export function isRetryableChromeDevToolsError(error) {
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();
  if (["ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"].includes(code)) {
    return true;
  }
  const message = error?.message || String(error || "");
  return /fetch failed|Chrome DevTools 自动读取超时|无法连接 Chrome DevTools/.test(message);
}

export async function fetchChromeDevToolsTabs({
  port = 9222,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("当前 Node 运行环境不支持 fetch，无法连接 Chrome DevTools。");
  }
  const controller = new AbortController();
  const timeoutError = new Error("Chrome DevTools 自动读取超时，请确认泛微单页已经打开。");
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  try {
    const response = await fetchImpl(chromeDevToolsListUrl(port), { signal: controller.signal });
    if (!response?.ok) {
      throw new Error("无法连接 Chrome DevTools 调试端口，请用测试平台提供的启动方式打开 Chrome。");
    }
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function fanweiAutoReadPlatform(platform = process.platform) {
  if (platform === "darwin") return "chrome_devtools";
  if (platform === "win32") return "windows_devtools";
  return "unsupported";
}

export function fanweiAutoReadUnavailableMessage(reason, platform = process.platform) {
  if (reason === "chrome_applescript_javascript_disabled") {
    return "Chrome 尚未允许 Apple 事件中的 JavaScript。平台已尝试自动打开本机开关；如仍不可用，请重启 Chrome 后再试。";
  }
  if (reason === "chrome_devtools_unavailable") {
    return "Windows 自动读取需要一个测试平台专用 Chrome 窗口。平台会自动打开该窗口；首次使用请在打开的窗口登录泛微，之后点击读取即可。";
  }
  if (reason === "unsupported_platform") {
    return `当前系统 ${platform} 暂不支持泛微自动读取。`;
  }
  return "泛微自动读取环境不可用。";
}

function windowsPathJoin(...parts) {
  return parts
    .filter((part) => String(part || ""))
    .map((part, index) => String(part).replace(index === 0 ? /[\\\/]+$/g : /^[\\\/]+|[\\\/]+$/g, ""))
    .join("\\");
}

export function findWindowsChromeExecutable({
  env = process.env,
  existsSync,
} = {}) {
  const candidates = [
    windowsPathJoin(env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    windowsPathJoin(env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    windowsPathJoin(env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
  if (typeof existsSync === "function") {
    return candidates.find((candidate) => existsSync(candidate)) || "";
  }
  return candidates[0] || "chrome.exe";
}

export function findMacChromeExecutable({
  existsSync,
} = {}) {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    path.join(process.env.HOME || "", "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
  ].filter(Boolean);
  if (typeof existsSync === "function") {
    return candidates.find((candidate) => existsSync(candidate)) || "";
  }
  return candidates[0] || "";
}

export function buildWindowsChromeLaunchArgs({
  userDataDir,
  port = 9222,
  startUrl = "https://oa.ata.net.cn/",
} = {}) {
  return [
    `--remote-debugging-port=${Number(port || 9222)}`,
    `--remote-allow-origins=http://127.0.0.1:${Number(port || 9222)}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    startUrl,
  ];
}

function makeWebSocketFactory() {
  return (url) => new WebSocket(url);
}

async function evaluateChromeDevToolsTab({
  tab,
  expression,
  webSocketFactory,
  timeoutMs,
} = {}) {
  const socketUrl = chromeDevToolsWebSocketUrl(tab.webSocketDebuggerUrl);
  return await new Promise((resolve, reject) => {
    const socket = webSocketFactory(socketUrl);
    const removeListeners = [];
    let settled = false;
    let timer;
    const finish = (fn, value, { closeSocket = true } = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const removeListener of removeListeners.splice(0)) {
        try { removeListener(); } catch {}
      }
      if (closeSocket) {
        try { socket.close?.(); } catch {}
      }
      fn(value);
    };
    const onSocketEvent = (event, handler) => {
      if (typeof socket.on === "function") {
        socket.on(event, handler);
        removeListeners.push(() => {
          if (typeof socket.off === "function") socket.off(event, handler);
          else socket.removeListener?.(event, handler);
        });
        return;
      }
      if (typeof socket.addEventListener === "function") {
        socket.addEventListener(event, handler);
        removeListeners.push(() => socket.removeEventListener?.(event, handler));
        return;
      }
      const property = `on${event}`;
      const previous = socket[property];
      socket[property] = handler;
      removeListeners.push(() => {
        if (socket[property] === handler) socket[property] = previous ?? null;
      });
    };
    onSocketEvent("open", () => {
      try {
        socket.send(JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression,
            awaitPromise: true,
            returnByValue: true,
          },
        }));
      } catch (error) {
        finish(reject, error);
      }
    });
    onSocketEvent("message", (message) => {
      let parsed = {};
      try {
        parsed = JSON.parse(String(message?.data ?? message));
      } catch (error) {
        return finish(reject, error);
      }
      if (parsed.id !== 1) return;
      if (parsed.error) return finish(reject, new Error(parsed.error.message || "Chrome DevTools 执行失败"));
      if (parsed.result?.exceptionDetails) {
        const details = parsed.result.exceptionDetails;
        const description = details.exception?.description || details.text || "页面脚本执行异常";
        return finish(reject, new Error(`Chrome DevTools 执行失败：${description}`));
      }
      try {
        return finish(resolve, parseFanweiAutoReadOutput(parsed.result?.result?.value || ""));
      } catch (error) {
        return finish(reject, error);
      }
    });
    onSocketEvent("error", (error) => finish(reject, error?.error || error));
    onSocketEvent("close", () => finish(
      reject,
      new Error("Chrome DevTools WebSocket 在返回读取结果前已关闭。"),
      { closeSocket: false },
    ));
    timer = setTimeout(() => finish(
      reject,
      new Error("Chrome DevTools 自动读取超时，请确认泛微单页已经打开。"),
    ), timeoutMs);
  });
}

export async function runChromeDevToolsFanweiRead({
  serialNo = "",
  port = 9222,
  fetchImpl = globalThis.fetch,
  webSocketFactory = makeWebSocketFactory(),
  timeoutMs = 15000,
  requireFanweiTab = true,
  distinguishSerialNotFound = false,
} = {}) {
  const tabs = await fetchChromeDevToolsTabs({ port, fetchImpl, timeoutMs });
  const fanweiTabs = (Array.isArray(tabs) ? tabs : []).filter((tab) =>
    isFanweiPageUrl(tab?.url) &&
    isAllowedChromeDevToolsWebSocketUrl(tab?.webSocketDebuggerUrl, port),
  );
  if (!fanweiTabs.length) {
    if (!requireFanweiTab) return { connected: true, fanweiTabFound: false };
    return null;
  }
  const expression = buildFanweiDomExtractorScript({ serialNo });
  const tabErrors = [];
  for (const tab of fanweiTabs) {
    try {
      const result = await evaluateChromeDevToolsTab({ tab, expression, webSocketFactory, timeoutMs });
      if (result) return result;
    } catch (error) {
      tabErrors.push(error);
    }
  }
  if (tabErrors.length) throw tabErrors[0];
  if (distinguishSerialNotFound && serialNo) {
    const error = new Error(`未找到对应需求单 ${serialNo}。`);
    error.code = "fanwei_serial_not_found";
    throw error;
  }
  return null;
}

export function parseFanweiAutoReadOutput(output = "") {
  const text = String(output || "").trim();
  if (!text) return null;
  return JSON.parse(text);
}
