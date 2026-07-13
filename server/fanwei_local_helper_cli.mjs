import { once } from "node:events";
import { mkdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createFanweiLocalHelperServer,
  loopbackBaseUrl,
  normalizeAllowedOrigins,
} from "./fanwei_local_helper.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 18765;
const DEFAULT_CHROME_PORT = 19222;
const DEFAULT_SHUTDOWN_GRACE_MS = 2000;

function portFromEnv(value, name, fallback) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  if (!/^\d+$/.test(text)) {
    throw new TypeError(`${name} must be an integer from 1 to 65535`);
  }
  const port = Number(text);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new TypeError(`${name} must be an integer from 1 to 65535`);
  }
  return port;
}

export function helperConfigFromEnv(env = process.env) {
  const host = String(env.YIKAO_HELPER_HOST || DEFAULT_HOST).trim();
  if (host !== DEFAULT_HOST) {
    throw new TypeError("YIKAO_HELPER_HOST must be 127.0.0.1 (loopback-only)");
  }

  const allowedOrigins = normalizeAllowedOrigins(env.YIKAO_CONSOLE_ORIGINS);
  if (!allowedOrigins.length) {
    throw new TypeError("YIKAO_CONSOLE_ORIGINS must contain 至少一个有效 origin");
  }

  const configuredRuntimeDir = String(env.YIKAO_HELPER_RUNTIME_DIR || "").trim();
  return {
    host,
    port: portFromEnv(env.YIKAO_HELPER_PORT, "YIKAO_HELPER_PORT", DEFAULT_PORT),
    chromePort: portFromEnv(
      env.YIKAO_HELPER_CHROME_PORT,
      "YIKAO_HELPER_CHROME_PORT",
      DEFAULT_CHROME_PORT,
    ),
    allowedOrigins,
    runtimeDir: configuredRuntimeDir
      ? path.resolve(configuredRuntimeDir)
      : path.join(os.homedir(), ".yikao-local-helper"),
  };
}

export async function runFanweiLocalHelperCli(env = process.env) {
  const config = helperConfigFromEnv(env);
  const shutdownGraceMs = portFromEnv(
    env.YIKAO_HELPER_SHUTDOWN_GRACE_MS,
    "YIKAO_HELPER_SHUTDOWN_GRACE_MS",
    DEFAULT_SHUTDOWN_GRACE_MS,
  );
  await mkdir(config.runtimeDir, { recursive: true });
  const server = createFanweiLocalHelperServer(config);
  let closing = false;
  let forceTimer = null;

  const shutdown = () => {
    if (closing) {
      console.error("Fanwei local helper forced shutdown after repeated signal.");
      process.exit(1);
    }
    closing = true;
    if (!server.listening) {
      process.exit(0);
      return;
    }
    forceTimer = setTimeout(() => {
      console.error(`Fanwei local helper shutdown exceeded ${shutdownGraceMs}ms; forcing exit.`);
      server.closeAllConnections?.();
      process.exit(1);
    }, shutdownGraceMs);
    forceTimer.unref?.();
    server.close((error) => {
      clearTimeout(forceTimer);
      forceTimer = null;
      if (error) {
        console.error(`Fanwei local helper close failed: ${error.code || "ERROR"}: ${error.message || error}`);
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (!server.listening) await once(server, "listening");
  console.log(
    `Fanwei local helper: ${loopbackBaseUrl(config.host, config.port)}; allowed origins: ${config.allowedOrigins.join(", ")}`,
  );
  return server;
}

async function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    const [entryPath, modulePath] = await Promise.all([
      realpath(path.resolve(process.argv[1])),
      realpath(fileURLToPath(import.meta.url)),
    ]);
    return entryPath === modulePath;
  } catch {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (await isDirectRun()) {
  runFanweiLocalHelperCli().catch((error) => {
    console.error(`Fanwei local helper failed to start: ${error?.code || "ERROR"}: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
