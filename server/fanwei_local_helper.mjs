import { spawn } from "node:child_process";
import { existsSync as fsExistsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import {
  buildWindowsChromeLaunchArgs,
  fetchChromeDevToolsTabs,
  findMacChromeExecutable,
  findWindowsChromeExecutable,
  isAllowedChromeDevToolsWebSocketUrl,
  isFanweiPageUrl,
  isRetryableChromeDevToolsError,
  runChromeDevToolsFanweiRead,
} from "./fanwei_auto_read.mjs";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const KNOWN_PATHS = new Set(["/health", "/chrome/ensure", "/fanwei/read"]);

class HelperError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function normalizeAllowedOrigins(value = "") {
  const candidates = Array.isArray(value)
    ? value
    : String(value || "").split(/[\s,]+/);
  const normalized = [];
  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (!text || text === "*") continue;
    try {
      const url = new URL(text);
      if (!new Set(["http:", "https:"]).has(url.protocol)) continue;
      if (url.username || url.password || url.search || url.hash) continue;
      if (url.pathname !== "/") continue;
      if (!normalized.includes(url.origin)) normalized.push(url.origin);
    } catch {
      // Invalid entries are ignored so one bad environment value cannot widen CORS.
    }
  }
  return normalized;
}

export function isAllowedHelperOrigin(origin = "", allowedOrigins = []) {
  const candidate = String(origin || "").trim();
  return Boolean(candidate) && candidate !== "null" && allowedOrigins.includes(candidate);
}

export function loopbackBaseUrl(host = "127.0.0.1", port = 18765) {
  const hostname = String(host).includes(":") ? `[${host}]` : host;
  return `http://${hostname}:${Number(port)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > 64 * 1024) {
      throw new HelperError("body_too_large", "请求内容过大。", 413);
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HelperError("invalid_json", "请求内容不是有效的 JSON。", 400);
  }
}

function hasFanweiTab(tabs, chromePort) {
  return (Array.isArray(tabs) ? tabs : []).some((tab) =>
    isFanweiPageUrl(tab?.url) &&
    isAllowedChromeDevToolsWebSocketUrl(tab?.webSocketDebuggerUrl, chromePort),
  );
}

export function createFanweiLocalHelperServer({
  allowedOrigins,
  host = "127.0.0.1",
  port = 18765,
  chromePort = 19222,
  runtimeDir,
  platform = process.platform,
  fetchImpl = globalThis.fetch,
  webSocketFactory,
  spawnImpl = spawn,
  existsSync = fsExistsSync,
} = {}) {
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new TypeError("Fanwei local helper host must be loopback-only");
  }
  const origins = normalizeAllowedOrigins(allowedOrigins);
  const helperRuntimeDir = runtimeDir || path.join(os.homedir(), ".yikao-local-helper");
  const supportedPlatform = platform === "darwin" || platform === "win32";
  let ensurePromise = null;

  async function chromeStatus() {
    if (typeof fetchImpl !== "function") {
      return { chromeConnected: false, fanweiTabFound: false };
    }
    try {
      const tabs = await fetchChromeDevToolsTabs({
        port: chromePort,
        fetchImpl,
        timeoutMs: 500,
      });
      return { chromeConnected: true, fanweiTabFound: hasFanweiTab(tabs, chromePort) };
    } catch {
      return { chromeConnected: false, fanweiTabFound: false };
    }
  }

  function findChromeExecutable() {
    if (platform === "darwin") return findMacChromeExecutable({ existsSync });
    if (platform === "win32") return findWindowsChromeExecutable({ existsSync });
    return "";
  }

  async function launchChrome() {
    const executable = findChromeExecutable();
    if (!executable) {
      throw new HelperError(
        "chrome_not_found",
        "未找到 Google Chrome，请先安装 Chrome 后重试。",
        503,
      );
    }
    const userDataDir = path.join(helperRuntimeDir, "chrome-fanwei-profile");
    await mkdir(userDataDir, { recursive: true });
    const args = buildWindowsChromeLaunchArgs({
      userDataDir,
      port: chromePort,
      startUrl: "https://oa.ata.net.cn/",
    });
    try {
      const child = spawnImpl(executable, args, { detached: true, stdio: "ignore" });
      if (typeof child?.once === "function") {
        await new Promise((resolve, reject) => {
          child.once("error", reject);
          child.once("spawn", resolve);
        });
      }
      child?.unref?.();
    } catch (error) {
      throw new HelperError(
        "chrome_launch_failed",
        `Chrome 启动失败：${error?.message || String(error)}`,
        503,
      );
    }
  }

  async function ensureChrome() {
    if (!supportedPlatform) {
      throw new HelperError("unsupported_platform", `当前系统 ${platform} 暂不支持泛微自动读取。`, 501);
    }
    const initial = await chromeStatus();
    if (initial.chromeConnected) {
      return { ...initial, launchedChrome: false };
    }
    await launchChrome();
    const deadline = Date.now() + 5000;
    do {
      const status = await chromeStatus();
      if (status.chromeConnected) return { ...status, launchedChrome: true };
      if (Date.now() >= deadline) break;
      await sleep(100);
    } while (true);
    throw new HelperError(
      "chrome_devtools_unavailable",
      "Chrome 已启动，但 5 秒内未能连接调试端口，请稍后重试。",
      503,
    );
  }

  async function ensureChromeOnce() {
    if (!ensurePromise) {
      ensurePromise = ensureChrome().finally(() => {
        ensurePromise = null;
      });
    }
    return await ensurePromise;
  }

  function corsHeaders(origin) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
      "Vary": "Origin",
    };
  }

  function sendJson(res, status, payload, origin = "") {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(origin ? corsHeaders(origin) : {}),
    });
    res.end(JSON.stringify(payload));
  }

  function sendError(res, error, origin) {
    const helperError = error instanceof HelperError
      ? error
      : new HelperError("internal_error", `本机助手处理失败：${error?.message || String(error)}`, 500);
    sendJson(res, helperError.status, {
      ok: false,
      error: { code: helperError.code, message: helperError.message },
    }, origin);
  }

  function fanweiReadError(error) {
    if (error?.code === "fanwei_serial_not_found") {
      return new HelperError(error.code, error.message, 404);
    }
    if (error instanceof SyntaxError) {
      return new HelperError("fanwei_parse_failed", error.message, 502);
    }
    return new HelperError("fanwei_read_failed", error?.message || String(error), 502);
  }

  const server = http.createServer(async (req, res) => {
    const origin = String(req.headers.origin || "");
    if (!isAllowedHelperOrigin(origin, origins)) {
      sendJson(res, 403, {
        ok: false,
        error: { code: "origin_forbidden", message: "请求来源未获授权。" },
      });
      return;
    }

    const url = new URL(req.url || "/", loopbackBaseUrl(host, port));
    if (!KNOWN_PATHS.has(url.pathname)) {
      sendJson(res, 404, {
        ok: false,
        error: { code: "not_found", message: "接口不存在。" },
      }, origin);
      return;
    }

    if (req.method === "OPTIONS") {
      const headers = corsHeaders(origin);
      if (req.headers["access-control-request-private-network"] === "true") {
        headers["Access-Control-Allow-Private-Network"] = "true";
      }
      res.writeHead(204, headers);
      res.end();
      return;
    }

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        const status = supportedPlatform
          ? await chromeStatus()
          : { chromeConnected: false, fanweiTabFound: false };
        sendJson(res, 200, {
          available: supportedPlatform,
          platform,
          ...status,
        }, origin);
        return;
      }

      if (req.method === "POST" && url.pathname === "/chrome/ensure") {
        const status = await ensureChromeOnce();
        sendJson(res, 200, { ok: true, ...status }, origin);
        return;
      }

      if (req.method === "POST" && url.pathname === "/fanwei/read") {
        const payload = await readJsonBody(req);
        const serialNo = String(payload?.serialNo || "").trim();
        if (!serialNo) {
          throw new HelperError("serial_no_required", "请填写泛微流水号。", 400);
        }
        const readFanwei = () => runChromeDevToolsFanweiRead({
          serialNo,
          port: chromePort,
          fetchImpl,
          webSocketFactory,
          distinguishSerialNotFound: true,
        });
        let data;
        try {
          data = await readFanwei();
        } catch (error) {
          if (isRetryableChromeDevToolsError(error)) {
            await ensureChromeOnce();
            try {
              data = await readFanwei();
            } catch (retryError) {
              throw fanweiReadError(retryError);
            }
          } else {
            throw fanweiReadError(error);
          }
        }
        if (!data) {
          throw new HelperError(
            "fanwei_tab_not_found",
            "未找到已打开的泛微需求页面，请在专用 Chrome 窗口中打开后重试。",
            409,
          );
        }
        sendJson(res, 200, { ok: true, data }, origin);
        return;
      }

      sendJson(res, 405, {
        ok: false,
        error: { code: "method_not_allowed", message: "请求方法不受支持。" },
      }, origin);
    } catch (error) {
      sendError(res, error, origin);
    }
  });

  server.listen(port, host);
  return server;
}
