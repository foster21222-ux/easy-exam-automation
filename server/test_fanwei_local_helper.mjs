import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, stat, symlink } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import * as localHelper from "./fanwei_local_helper.mjs";
import {
  createFanweiLocalHelperServer,
  isAllowedHelperOrigin,
  normalizeAllowedOrigins,
} from "./fanwei_local_helper.mjs";
import { helperConfigFromEnv } from "./fanwei_local_helper_cli.mjs";

const allowedOrigin = "http://172.16.13.214:8765";

async function unusedLoopbackPort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForHealth(baseUrl, origin, child, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`helper CLI exited before health check (${child.exitCode})`);
    }
    try {
      return await fetch(`${baseUrl}/health`, { headers: { Origin: origin } });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError || new Error("helper CLI health check timed out");
}

async function assertPortReleased(port) {
  const probe = net.createServer();
  probe.listen(port, "127.0.0.1");
  await once(probe, "listening");
  probe.close();
  await once(probe, "close");
}

function spawnHelperCli({
  port,
  chromePort,
  runtimeDir,
  entryPath = path.join(import.meta.dirname, "fanwei_local_helper_cli.mjs"),
  extraEnv = {},
  args = [entryPath],
} = {}) {
  const stdout = [];
  const stderr = [];
  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
      YIKAO_HELPER_HOST: "127.0.0.1",
      YIKAO_HELPER_PORT: String(port),
      YIKAO_HELPER_CHROME_PORT: String(chromePort),
      YIKAO_CONSOLE_ORIGINS: allowedOrigin,
      YIKAO_HELPER_RUNTIME_DIR: runtimeDir,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  return { child, stdout, stderr };
}

async function waitForChildExit(child, timeoutMs = 3000) {
  let timer;
  try {
    return await Promise.race([
      once(child, "exit"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("helper CLI exit timed out")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function startHelper(options = {}) {
  const generatedRuntimeDir = options.runtimeDir
    ? ""
    : path.join(os.tmpdir(), `fanwei-helper-${Date.now()}-${Math.random()}`);
  const server = createFanweiLocalHelperServer({
    allowedOrigins: [allowedOrigin],
    port: 0,
    runtimeDir: options.runtimeDir || generatedRuntimeDir,
    platform: "darwin",
    ...options,
  });
  server.testRuntimeDir = generatedRuntimeDir;
  if (!server.listening) await once(server, "listening");
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopHelper(server) {
  if (server.listening) {
    server.close();
    await once(server, "close");
  }
  if (server.testRuntimeDir) {
    await rm(server.testRuntimeDir, { recursive: true, force: true });
  }
}

async function helperFetch(baseUrl, pathname, {
  method = "GET",
  origin = allowedOrigin,
  headers = {},
  body,
} = {}) {
  return await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(origin === null ? {} : { Origin: origin }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("helperConfigFromEnv applies safe local defaults and requires configured origins", () => {
  assert.deepEqual(helperConfigFromEnv({
    YIKAO_CONSOLE_ORIGINS: allowedOrigin,
  }), {
    host: "127.0.0.1",
    port: 18765,
    chromePort: 19222,
    allowedOrigins: [allowedOrigin],
    runtimeDir: path.join(os.homedir(), ".yikao-local-helper"),
  });

  assert.throws(
    () => helperConfigFromEnv({}),
    /YIKAO_CONSOLE_ORIGINS.*至少一个有效 origin/i,
  );
});

test("helperConfigFromEnv trims and normalizes explicit settings", () => {
  const runtimeDir = path.resolve("relative-helper-runtime");
  assert.deepEqual(helperConfigFromEnv({
    YIKAO_HELPER_HOST: " 127.0.0.1 ",
    YIKAO_HELPER_PORT: " 28765 ",
    YIKAO_HELPER_CHROME_PORT: " 29222 ",
    YIKAO_CONSOLE_ORIGINS: ` ${allowedOrigin}/, https://console.example.com\n${allowedOrigin}`,
    YIKAO_HELPER_RUNTIME_DIR: " relative-helper-runtime ",
  }), {
    host: "127.0.0.1",
    port: 28765,
    chromePort: 29222,
    allowedOrigins: [allowedOrigin, "https://console.example.com"],
    runtimeDir,
  });
});

test("helperConfigFromEnv rejects non-127.0.0.1 hosts, invalid ports, and invalid origins", () => {
  const baseEnv = { YIKAO_CONSOLE_ORIGINS: allowedOrigin };
  for (const host of ["localhost", "::1", "0.0.0.0", "127.0.0.2"]) {
    assert.throws(
      () => helperConfigFromEnv({ ...baseEnv, YIKAO_HELPER_HOST: host }),
      /YIKAO_HELPER_HOST.*127\.0\.0\.1/,
    );
  }
  for (const [name, value] of [
    ["YIKAO_HELPER_PORT", "0"],
    ["YIKAO_HELPER_PORT", "65536"],
    ["YIKAO_HELPER_PORT", "12.5"],
    ["YIKAO_HELPER_CHROME_PORT", "not-a-port"],
  ]) {
    assert.throws(
      () => helperConfigFromEnv({ ...baseEnv, [name]: value }),
      new RegExp(`${name}.*1.*65535`),
    );
  }
  assert.throws(
    () => helperConfigFromEnv({ YIKAO_CONSOLE_ORIGINS: "*, not-a-url, https://example.com/path" }),
    /YIKAO_CONSOLE_ORIGINS.*至少一个有效 origin/i,
  );
});

test("production helper CLI serves health and releases its port after SIGTERM", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "fanwei-helper-cli-"));
  const runtimeDir = path.join(tempRoot, "installed-runtime");
  const port = await unusedLoopbackPort();
  const chromePort = await unusedLoopbackPort();
  const { child, stdout, stderr } = spawnHelperCli({
    port,
    chromePort,
    runtimeDir,
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const response = await waitForHealth(baseUrl, allowedOrigin, child);
  assert.equal(response.status, 200);
  await waitFor(() => stdout.length > 0);
  assert.equal((await stat(runtimeDir)).isDirectory(), true);
  const logOutput = Buffer.concat(stdout).toString("utf8");
  assert.match(logOutput, new RegExp(baseUrl.replaceAll(".", "\\.")));
  assert.match(logOutput, new RegExp(allowedOrigin.replaceAll(".", "\\.")));
  assert.doesNotMatch(logOutput, new RegExp(runtimeDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(logOutput, new RegExp(String(chromePort)));
  assert.equal(Buffer.concat(stderr).toString("utf8"), "");

  const exitPromise = once(child, "exit");
  assert.equal(child.kill("SIGTERM"), true);
  const [code, signal] = await exitPromise;
  assert.equal(code, 0);
  assert.equal(signal, null);
  await assertPortReleased(port);
});

test("helper CLI forces blocked half-open requests closed after its shutdown grace period", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "fanwei-helper-cli-grace-"));
  const port = await unusedLoopbackPort();
  const chromePort = await unusedLoopbackPort();
  const { child } = spawnHelperCli({
    port,
    chromePort,
    runtimeDir: path.join(tempRoot, "runtime"),
    extraEnv: { YIKAO_HELPER_SHUTDOWN_GRACE_MS: "100" },
  });
  let socket;
  t.after(async () => {
    socket?.destroy();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  await waitForHealth(`http://127.0.0.1:${port}`, allowedOrigin, child);
  socket = net.createConnection({ host: "127.0.0.1", port });
  socket.on("error", () => {});
  if (socket.connecting) await once(socket, "connect");
  socket.write(`GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: ${allowedOrigin}\r\n`);

  const startedAt = Date.now();
  assert.equal(child.kill("SIGTERM"), true);
  const [code, signal] = await waitForChildExit(child, 1500);

  assert.equal(code, 1);
  assert.equal(signal, null);
  assert.ok(Date.now() - startedAt < 1000, "graceful shutdown exceeded its configured deadline");
  await assertPortReleased(port);
});

test("helper CLI forces immediate exit on a second termination signal", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "fanwei-helper-cli-second-signal-"));
  const port = await unusedLoopbackPort();
  const chromePort = await unusedLoopbackPort();
  const { child } = spawnHelperCli({
    port,
    chromePort,
    runtimeDir: path.join(tempRoot, "runtime"),
    extraEnv: { YIKAO_HELPER_SHUTDOWN_GRACE_MS: "5000" },
  });
  let socket;
  t.after(async () => {
    socket?.destroy();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  await waitForHealth(`http://127.0.0.1:${port}`, allowedOrigin, child);
  socket = net.createConnection({ host: "127.0.0.1", port });
  socket.on("error", () => {});
  if (socket.connecting) await once(socket, "connect");
  socket.write(`GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: ${allowedOrigin}\r\n`);

  assert.equal(child.kill("SIGTERM"), true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const startedAt = Date.now();
  assert.equal(child.kill("SIGINT"), true);
  const [code, signal] = await waitForChildExit(child, 1000);

  assert.equal(code, 1);
  assert.equal(signal, null);
  assert.ok(Date.now() - startedAt < 750, "second signal did not force immediate exit");
});

test("helper CLI starts when invoked through a symbolic link", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "fanwei-helper-cli-symlink-"));
  const entryPath = path.join(tempRoot, "fanwei-helper");
  await symlink(path.join(import.meta.dirname, "fanwei_local_helper_cli.mjs"), entryPath, "file");
  const port = await unusedLoopbackPort();
  const chromePort = await unusedLoopbackPort();
  const { child } = spawnHelperCli({
    port,
    chromePort,
    runtimeDir: path.join(tempRoot, "runtime"),
    entryPath,
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  const response = await waitForHealth(`http://127.0.0.1:${port}`, allowedOrigin, child, 1500);
  assert.equal(response.status, 200);
  child.kill("SIGTERM");
  assert.deepEqual(await waitForChildExit(child), [0, null]);
});

test("helper CLI startup failures log the error code and occupied port", async (t) => {
  const blocker = net.createServer();
  blocker.listen(0, "127.0.0.1");
  await once(blocker, "listening");
  const port = blocker.address().port;
  const chromePort = await unusedLoopbackPort();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "fanwei-helper-cli-start-error-"));
  const { child, stderr } = spawnHelperCli({
    port,
    chromePort,
    runtimeDir: path.join(tempRoot, "runtime"),
  });
  t.after(async () => {
    blocker.close();
    if (blocker.listening) await once(blocker, "close");
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  const [code, signal] = await waitForChildExit(child);
  const output = Buffer.concat(stderr).toString("utf8");

  assert.equal(code, 1);
  assert.equal(signal, null);
  assert.match(output, /EADDRINUSE/);
  assert.match(output, new RegExp(String(port)));
});

test("helper CLI logs the reason when graceful server close fails", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "fanwei-helper-cli-close-error-"));
  const port = await unusedLoopbackPort();
  const chromePort = await unusedLoopbackPort();
  const moduleUrl = pathToFileURL(path.join(import.meta.dirname, "fanwei_local_helper_cli.mjs")).href;
  const source = [
    `const { runFanweiLocalHelperCli } = await import(${JSON.stringify(moduleUrl)});`,
    "const server = await runFanweiLocalHelperCli(process.env);",
    "server.close = (callback) => callback(Object.assign(new Error('synthetic close failure'), { code: 'ECLOSETEST' }));",
  ].join("\n");
  const { child, stderr } = spawnHelperCli({
    port,
    chromePort,
    runtimeDir: path.join(tempRoot, "runtime"),
    args: ["--input-type=module", "--eval", source],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  await waitForHealth(`http://127.0.0.1:${port}`, allowedOrigin, child);
  child.kill("SIGTERM");
  const [code, signal] = await waitForChildExit(child);
  const output = Buffer.concat(stderr).toString("utf8");

  assert.equal(code, 1);
  assert.equal(signal, null);
  assert.match(output, /ECLOSETEST/);
  assert.match(output, /synthetic close failure/);
});

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("normalizeAllowedOrigins trims, canonicalizes, deduplicates, and drops invalid origins", () => {
  assert.deepEqual(normalizeAllowedOrigins([
    ` ${allowedOrigin}/ `,
    "https://console.example.com",
    allowedOrigin,
    "https://console.example.com/path",
    "*",
    "not-a-url",
  ]), [allowedOrigin, "https://console.example.com"]);
  assert.deepEqual(
    normalizeAllowedOrigins(`${allowedOrigin}, https://console.example.com\n${allowedOrigin}`),
    [allowedOrigin, "https://console.example.com"],
  );
});

test("isAllowedHelperOrigin requires an exact configured browser origin", () => {
  const origins = normalizeAllowedOrigins(`${allowedOrigin},https://console.example.com`);
  assert.equal(isAllowedHelperOrigin(allowedOrigin, origins), true);
  assert.equal(isAllowedHelperOrigin(`${allowedOrigin}.evil.test`, origins), false);
  assert.equal(isAllowedHelperOrigin("", origins), false);
  assert.equal(isAllowedHelperOrigin("null", origins), false);
});

test("createFanweiLocalHelperServer refuses non-loopback bind hosts", () => {
  assert.throws(
    () => createFanweiLocalHelperServer({ host: "0.0.0.0", port: 0 }),
    /loopback/i,
  );
});

test("loopbackBaseUrl brackets IPv6 hosts", () => {
  assert.equal(localHelper.loopbackBaseUrl("::1", 18765), "http://[::1]:18765");
  assert.equal(localHelper.loopbackBaseUrl("127.0.0.1", 18765), "http://127.0.0.1:18765");
});

test("GET /health reports platform and Chrome/Fanwei status with strict CORS", async (t) => {
  const { server, baseUrl } = await startHelper({
    fetchImpl: async () => jsonResponse([
      { url: "https://oa.ata.net.cn/spa/workflow", webSocketDebuggerUrl: "ws://localhost:19222/devtools/page/1" },
    ]),
  });
  t.after(() => stopHelper(server));

  const response = await helperFetch(baseUrl, "/health");

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    available: true,
    platform: "darwin",
    chromeConnected: true,
    fanweiTabFound: true,
  });
});

test("GET /health aborts a stalled Chrome DevTools request", async (t) => {
  let requestSignal;
  const { server, baseUrl } = await startHelper({
    fetchImpl: async (_url, options = {}) => {
      requestSignal = options.signal;
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("late DevTools response")), 800);
        options.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(options.signal.reason || new Error("aborted"));
        }, { once: true });
      });
    },
  });
  t.after(() => stopHelper(server));

  const startedAt = Date.now();
  const response = await helperFetch(baseUrl, "/health");
  const elapsedMs = Date.now() - startedAt;

  assert.equal(response.status, 200);
  assert.equal(requestSignal?.aborted, true);
  assert.ok(elapsedMs < 700, `health took ${elapsedMs}ms`);
  assert.equal((await response.json()).chromeConnected, false);
});

test("GET /health rejects deceptive Fanwei hostnames", async (t) => {
  const { server, baseUrl } = await startHelper({
    fetchImpl: async () => jsonResponse([
      {
        url: "https://oa.ata.net.cn.evil.example/workflow",
        webSocketDebuggerUrl: "ws://localhost:19222/devtools/page/evil",
      },
    ]),
  });
  t.after(() => stopHelper(server));

  const response = await helperFetch(baseUrl, "/health");

  assert.equal(response.status, 200);
  assert.equal((await response.json()).fanweiTabFound, false);
});

test("GET /health rejects unsafe Chrome DevTools WebSocket URLs", async (t) => {
  const { server, baseUrl } = await startHelper({
    chromePort: 19222,
    fetchImpl: async () => jsonResponse([
      {
        url: "https://oa.ata.net.cn/workflow/external",
        webSocketDebuggerUrl: "ws://attacker.example:19222/devtools/page/external",
      },
      {
        url: "https://oa.ata.net.cn/workflow/wrong-port",
        webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/page/wrong-port",
      },
    ]),
  });
  t.after(() => stopHelper(server));

  const response = await helperFetch(baseUrl, "/health");

  assert.equal(response.status, 200);
  assert.equal((await response.json()).fanweiTabFound, false);
});

test("missing and unknown origins are forbidden before Chrome dependencies run", async (t) => {
  let fetchCalls = 0;
  let spawnCalls = 0;
  const { server, baseUrl } = await startHelper({
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("must not run");
    },
    spawnImpl: () => {
      spawnCalls += 1;
      throw new Error("must not run");
    },
  });
  t.after(() => stopHelper(server));

  const missing = await helperFetch(baseUrl, "/health", { origin: null });
  const unknown = await helperFetch(baseUrl, "/chrome/ensure", {
    method: "POST",
    origin: "http://attacker.example",
    body: { command: "open" },
  });

  assert.equal(missing.status, 403);
  assert.equal(unknown.status, 403);
  assert.equal(missing.headers.get("cache-control"), "no-store");
  assert.equal(unknown.headers.get("access-control-allow-origin"), null);
  assert.equal(fetchCalls, 0);
  assert.equal(spawnCalls, 0);
});

test("OPTIONS /fanwei/read returns CORS and private-network preflight headers", async (t) => {
  const { server, baseUrl } = await startHelper();
  t.after(() => stopHelper(server));

  const response = await helperFetch(baseUrl, "/fanwei/read", {
    method: "OPTIONS",
    headers: {
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Private-Network": "true",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.equal(response.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  assert.equal(response.headers.get("access-control-allow-headers"), "Content-Type");
  assert.equal(response.headers.get("access-control-allow-private-network"), "true");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("POST /chrome/ensure launches a dedicated-profile Chrome once and condition-polls DevTools", async (t) => {
  let fetchCalls = 0;
  const spawns = [];
  const child = { unrefCalled: false, unref() { this.unrefCalled = true; } };
  const { server, baseUrl } = await startHelper({
    chromePort: 19222,
    fetchImpl: async (url) => {
      fetchCalls += 1;
      assert.equal(url, "http://127.0.0.1:19222/json");
      if (fetchCalls <= 1) throw new Error("fetch failed");
      return jsonResponse([]);
    },
    existsSync: (candidate) => candidate === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    spawnImpl: (command, args, options) => {
      spawns.push({ command, args, options });
      return child;
    },
  });
  t.after(() => stopHelper(server));

  const response = await helperFetch(baseUrl, "/chrome/ensure", { method: "POST", body: {} });
  const second = await helperFetch(baseUrl, "/chrome/ensure", { method: "POST", body: {} });

  assert.equal(response.status, 200);
  assert.equal(second.status, 200);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].command, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  assert.ok(spawns[0].args.includes("--remote-debugging-port=19222"));
  assert.ok(spawns[0].args.some((arg) => arg.includes("chrome-fanwei-profile")));
  assert.deepEqual(spawns[0].options, { detached: true, stdio: "ignore" });
  assert.equal(child.unrefCalled, true);
  assert.deepEqual(await response.json(), {
    ok: true,
    chromeConnected: true,
    fanweiTabFound: false,
    launchedChrome: true,
  });
});

test("POST /chrome/ensure returns a structured Chinese error when Chrome is missing", async (t) => {
  const { server, baseUrl } = await startHelper({
    fetchImpl: async () => { throw new Error("fetch failed"); },
    existsSync: () => false,
  });
  t.after(() => stopHelper(server));

  const response = await helperFetch(baseUrl, "/chrome/ensure", { method: "POST", body: {} });
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "chrome_not_found");
  assert.match(payload.error.message, /未找到.*Chrome/);
});

test("POST /chrome/ensure retries discovery after Chrome was missing", async (t) => {
  let statusChecks = 0;
  let existsChecks = 0;
  let chromeInstalled = false;
  let spawnCalls = 0;
  const { server, baseUrl } = await startHelper({
    fetchImpl: async () => {
      statusChecks += 1;
      if (statusChecks >= 3) return jsonResponse([]);
      throw new Error("fetch failed");
    },
    existsSync: () => {
      existsChecks += 1;
      return chromeInstalled;
    },
    spawnImpl: () => {
      spawnCalls += 1;
      return { unref() {} };
    },
  });
  t.after(() => stopHelper(server));

  const first = await helperFetch(baseUrl, "/chrome/ensure", { method: "POST", body: {} });
  const firstPayload = await first.json();
  chromeInstalled = true;
  const second = await helperFetch(baseUrl, "/chrome/ensure", { method: "POST", body: {} });

  assert.equal(first.status, 503);
  assert.equal(firstPayload.error.code, "chrome_not_found");
  assert.match(firstPayload.error.message, /未找到.*Chrome/);
  assert.equal(second.status, 200);
  assert.equal(existsChecks, 3);
  assert.equal(spawnCalls, 1);
});

test("POST /chrome/ensure retries spawn after launch failure and preserves its error", async (t) => {
  let statusChecks = 0;
  let spawnCalls = 0;
  const { server, baseUrl } = await startHelper({
    fetchImpl: async () => {
      statusChecks += 1;
      if (statusChecks >= 3) return jsonResponse([]);
      throw new Error("fetch failed");
    },
    existsSync: (candidate) => candidate === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    spawnImpl: () => {
      spawnCalls += 1;
      if (spawnCalls === 1) throw new Error("spawn EACCES");
      return { unref() {} };
    },
  });
  t.after(() => stopHelper(server));

  const first = await helperFetch(baseUrl, "/chrome/ensure", { method: "POST", body: {} });
  const firstPayload = await first.json();
  const second = await helperFetch(baseUrl, "/chrome/ensure", { method: "POST", body: {} });

  assert.equal(first.status, 503);
  assert.equal(firstPayload.error.code, "chrome_launch_failed");
  assert.match(firstPayload.error.message, /spawn EACCES/);
  assert.equal(second.status, 200);
  assert.equal(spawnCalls, 2);
});

test("POST /chrome/ensure handles asynchronous spawn errors", async (t) => {
  let statusChecks = 0;
  const registeredEvents = [];
  const { server, baseUrl } = await startHelper({
    fetchImpl: async () => {
      statusChecks += 1;
      if (statusChecks >= 2) return jsonResponse([]);
      throw new Error("fetch failed");
    },
    existsSync: (candidate) => candidate === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    spawnImpl: () => ({
      once(event, handler) {
        registeredEvents.push(event);
        if (event === "error") {
          queueMicrotask(() => handler(Object.assign(new Error("spawn EACCES"), { code: "EACCES" })));
        }
        return this;
      },
      unref() {},
    }),
  });
  t.after(() => stopHelper(server));

  const response = await helperFetch(baseUrl, "/chrome/ensure", { method: "POST", body: {} });
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.equal(payload.error.code, "chrome_launch_failed");
  assert.match(payload.error.message, /spawn EACCES/);
  assert.ok(registeredEvents.includes("error"));
});

test("POST /chrome/ensure is idempotent while connected and relaunches after Chrome exits", async (t) => {
  let chromeRunning = false;
  let offlineChecks = 0;
  let spawnCalls = 0;
  const { server, baseUrl } = await startHelper({
    fetchImpl: async () => {
      if (!chromeRunning) {
        offlineChecks += 1;
        if (offlineChecks >= 2) chromeRunning = true;
      }
      return chromeRunning
        ? jsonResponse([])
        : jsonResponse({}, { ok: false, status: 503 });
    },
    existsSync: (candidate) => candidate === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    spawnImpl: () => {
      spawnCalls += 1;
      chromeRunning = true;
      return { unref() {} };
    },
  });
  t.after(() => stopHelper(server));

  const launched = await helperFetch(baseUrl, "/chrome/ensure", { method: "POST", body: {} });
  const connected = await helperFetch(baseUrl, "/chrome/ensure", { method: "POST", body: {} });
  chromeRunning = false;
  offlineChecks = 0;
  const relaunched = await helperFetch(baseUrl, "/chrome/ensure", { method: "POST", body: {} });

  assert.equal(launched.status, 200);
  assert.equal(connected.status, 200);
  assert.equal((await connected.json()).launchedChrome, false);
  assert.equal(relaunched.status, 200);
  assert.equal((await relaunched.json()).launchedChrome, true);
  assert.equal(spawnCalls, 2);
});

test("concurrent POST /chrome/ensure requests share one launch", async (t) => {
  let fetchCalls = 0;
  let releaseInitialStatus;
  let spawnCalls = 0;
  const initialStatus = new Promise((resolve) => {
    releaseInitialStatus = resolve;
  });
  const { server, baseUrl } = await startHelper({
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) return await initialStatus;
      return jsonResponse([]);
    },
    existsSync: (candidate) => candidate === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    spawnImpl: () => {
      spawnCalls += 1;
      return { unref() {} };
    },
  });
  t.after(() => stopHelper(server));

  const firstPromise = helperFetch(baseUrl, "/chrome/ensure", { method: "POST", body: {} });
  await waitFor(() => fetchCalls === 1);
  const secondPromise = helperFetch(baseUrl, "/chrome/ensure", { method: "POST", body: {} });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fetchCalls, 1);
  releaseInitialStatus(jsonResponse({}, { ok: false, status: 503 }));

  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(spawnCalls, 1);
});

test("POST /fanwei/read validates serialNo and reads through Chrome DevTools", async (t) => {
  const fanweiPayload = {
    requestid: "1505614",
    fields: { "运控流水号": "R0042377" },
    examSceneRows: [],
    opaRows: [],
  };
  const { server, baseUrl } = await startHelper({
    fetchImpl: async () => jsonResponse([
      {
        url: "https://oa.ata.net.cn/spa/workflow/static4form/index.html#/main/workflow/req?requestid=1505614",
        webSocketDebuggerUrl: "ws://localhost:19222/devtools/page/fanwei",
      },
    ]),
    webSocketFactory: (url) => {
      assert.equal(url, "ws://127.0.0.1:19222/devtools/page/fanwei");
      return {
        send(message) {
          const parsed = JSON.parse(message);
          assert.equal(parsed.method, "Runtime.evaluate");
          assert.match(parsed.params.expression, /R0042377/);
        },
        close() {},
        on(event, handler) {
          if (event === "open") queueMicrotask(handler);
          if (event === "message") queueMicrotask(() => handler(JSON.stringify({
            id: 1,
            result: { result: { value: JSON.stringify(fanweiPayload) } },
          })));
        },
      };
    },
  });
  t.after(() => stopHelper(server));

  const empty = await helperFetch(baseUrl, "/fanwei/read", { method: "POST", body: { serialNo: "  " } });
  const response = await helperFetch(baseUrl, "/fanwei/read", {
    method: "POST",
    body: { serialNo: "R0042377", command: "rm -rf /" },
  });

  assert.equal(empty.status, 400);
  assert.match((await empty.json()).error.message, /流水号/);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: fanweiPayload });
});

test("POST /fanwei/read returns a structured Chinese error when no Fanwei tab is open", async (t) => {
  const { server, baseUrl } = await startHelper({
    fetchImpl: async () => jsonResponse([
      { url: "https://example.com", webSocketDebuggerUrl: "ws://localhost:19222/devtools/page/other" },
    ]),
  });
  t.after(() => stopHelper(server));

  const response = await helperFetch(baseUrl, "/fanwei/read", {
    method: "POST",
    body: { serialNo: "R0042377" },
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, "fanwei_tab_not_found");
  assert.match(payload.error.message, /泛微.*页面/);
});

test("POST /fanwei/read distinguishes Fanwei tabs with no matching serial", async (t) => {
  const { server, baseUrl } = await startHelper({
    fetchImpl: async () => jsonResponse([
      {
        url: "https://oa.ata.net.cn/workflow/other",
        webSocketDebuggerUrl: "ws://localhost:19222/devtools/page/other",
      },
    ]),
    webSocketFactory: () => ({
      send() {},
      close() {},
      on(event, handler) {
        if (event === "open") queueMicrotask(handler);
        if (event === "message") queueMicrotask(() => handler(JSON.stringify({
          id: 1,
          result: { result: { value: "" } },
        })));
      },
    }),
  });
  t.after(() => stopHelper(server));

  const response = await helperFetch(baseUrl, "/fanwei/read", {
    method: "POST",
    body: { serialNo: "R0042377" },
  });
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.error.code, "fanwei_serial_not_found");
  assert.match(payload.error.message, /R0042377/);
  assert.match(payload.error.message, /未找到对应需求单/);
});

test("POST /fanwei/read preserves serial-not-found after reconnecting DevTools", async (t) => {
  let fetchCalls = 0;
  const { server, baseUrl } = await startHelper({
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) throw new Error("fetch failed");
      if (fetchCalls === 2) return jsonResponse([]);
      return jsonResponse([
        {
          url: "https://oa.ata.net.cn/workflow/other",
          webSocketDebuggerUrl: "ws://localhost:19222/devtools/page/other",
        },
      ]);
    },
    webSocketFactory: () => ({
      send() {},
      close() {},
      on(event, handler) {
        if (event === "open") queueMicrotask(handler);
        if (event === "message") queueMicrotask(() => handler(JSON.stringify({
          id: 1,
          result: { result: { value: "" } },
        })));
      },
    }),
  });
  t.after(() => stopHelper(server));

  const response = await helperFetch(baseUrl, "/fanwei/read", {
    method: "POST",
    body: { serialNo: "R0042377" },
  });
  const payload = await response.json();

  assert.equal(fetchCalls, 3);
  assert.equal(response.status, 404);
  assert.equal(payload.error.code, "fanwei_serial_not_found");
  assert.match(payload.error.message, /R0042377.*未找到对应需求单|未找到对应需求单.*R0042377/);
});

test("POST /fanwei/read rejects deceptive Fanwei hostnames without opening a WebSocket", async (t) => {
  let webSocketCalls = 0;
  const { server, baseUrl } = await startHelper({
    fetchImpl: async () => jsonResponse([
      {
        url: "https://oa.ata.net.cn.evil.example/workflow",
        webSocketDebuggerUrl: "ws://localhost:19222/devtools/page/evil",
      },
    ]),
    webSocketFactory: () => {
      webSocketCalls += 1;
      return {
        send() {},
        close() {},
        on(event, handler) {
          if (event === "open") queueMicrotask(handler);
          if (event === "message") queueMicrotask(() => handler(JSON.stringify({
            id: 1,
            result: { result: { value: "{}" } },
          })));
        },
      };
    },
  });
  t.after(() => stopHelper(server));

  const response = await helperFetch(baseUrl, "/fanwei/read", {
    method: "POST",
    body: { serialNo: "R0042377" },
  });

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "fanwei_tab_not_found");
  assert.equal(webSocketCalls, 0);
});

test("POST /fanwei/read maps Runtime.evaluate exception details to 502 without retrying", async (t) => {
  let webSocketCalls = 0;
  let spawnCalls = 0;
  const { server, baseUrl } = await startHelper({
    fetchImpl: async () => jsonResponse([
      {
        url: "https://oa.ata.net.cn/workflow",
        webSocketDebuggerUrl: "ws://localhost:19222/devtools/page/fanwei",
      },
    ]),
    webSocketFactory: () => {
      webSocketCalls += 1;
      return {
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
      };
    },
    spawnImpl: () => {
      spawnCalls += 1;
      return { unref() {} };
    },
  });
  t.after(() => stopHelper(server));

  const response = await helperFetch(baseUrl, "/fanwei/read", {
    method: "POST",
    body: { serialNo: "R0042377" },
  });
  const payload = await response.json();

  assert.equal(response.status, 502);
  assert.equal(payload.error.code, "fanwei_read_failed");
  assert.match(payload.error.message, /Chrome DevTools 执行失败.*ReferenceError: extractor failed/);
  assert.equal(webSocketCalls, 1);
  assert.equal(spawnCalls, 0);
});

test("POST /fanwei/read does not retry malformed extractor output", async (t) => {
  let webSocketCalls = 0;
  const { server, baseUrl } = await startHelper({
    fetchImpl: async () => jsonResponse([
      {
        url: "https://oa.ata.net.cn/workflow",
        webSocketDebuggerUrl: "ws://localhost:19222/devtools/page/fanwei",
      },
    ]),
    webSocketFactory: () => {
      webSocketCalls += 1;
      return {
        send() {},
        close() {},
        on(event, handler) {
          if (event === "open") queueMicrotask(handler);
          if (event === "message") queueMicrotask(() => handler(JSON.stringify({
            id: 1,
            result: { result: { value: "not-json" } },
          })));
        },
      };
    },
  });
  t.after(() => stopHelper(server));

  const response = await helperFetch(baseUrl, "/fanwei/read", {
    method: "POST",
    body: { serialNo: "R0042377" },
  });
  const payload = await response.json();

  assert.equal(response.status, 502);
  assert.equal(payload.error.code, "fanwei_parse_failed");
  assert.match(payload.error.message, /JSON|Unexpected token/);
  assert.equal(webSocketCalls, 1);
});

test("unknown routes and methods cannot execute commands", async (t) => {
  let spawnCalls = 0;
  const { server, baseUrl } = await startHelper({
    spawnImpl: () => { spawnCalls += 1; },
  });
  t.after(() => stopHelper(server));

  const response = await helperFetch(baseUrl, "/command", {
    method: "POST",
    body: { command: "open -a Calculator" },
  });

  assert.equal(response.status, 404);
  assert.equal(spawnCalls, 0);
});
