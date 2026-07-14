import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

function text(value) {
  return String(value ?? "").trim();
}

function commandEnv(env = process.env) {
  return {
    ...env,
    PATH: ["/usr/local/bin", "/opt/homebrew/bin", env.PATH || process.env.PATH || ""].filter(Boolean).join(":"),
  };
}

function commandOutput(fn) {
  try {
    fn();
    return { ok: true, detail: "正常" };
  } catch (error) {
    return {
      ok: false,
      detail: error?.stderr?.toString?.().trim() || error?.message || String(error),
    };
  }
}

export async function checkOperationConsoleAutomationEnvironment(options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const execFileSyncImpl = options.execFileSyncImpl || execFileSync;
  const nodeBin = options.nodeBin || process.execPath;
  const requireFromCwd = createRequire(path.join(cwd, "package.json"));
  const automationEnabled = env.OPERATION_CONSOLE_AUTOMATION_ENABLED === "1";
  const playwright = commandOutput(() => (options.resolvePlaywright || (() => requireFromCwd.resolve("playwright")))());
  const chromium = commandOutput(() => execFileSyncImpl(nodeBin, [
    "-e",
    "import('playwright').then(async({chromium})=>{const b=await chromium.launch({headless:true}); await b.close();}).catch((e)=>{console.error(e.message); process.exit(1);})",
  ], { cwd, env: commandEnv(env), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));

  return {
    ready: automationEnabled && playwright.ok && chromium.ok,
    automationEnabled: {
      ok: automationEnabled,
      detail: automationEnabled ? "OPERATION_CONSOLE_AUTOMATION_ENABLED=1" : "未启用 OPERATION_CONSOLE_AUTOMATION_ENABLED=1",
    },
    playwright: {
      ok: playwright.ok,
      detail: playwright.ok ? "Node 依赖已安装" : playwright.detail,
    },
    chromium: {
      ok: chromium.ok,
      detail: chromium.ok ? "Chromium 可启动" : chromium.detail,
    },
  };
}

export function installOperationConsoleAutomationDeps(options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = commandEnv(options.env || process.env);
  const execFileSyncImpl = options.execFileSyncImpl || execFileSync;
  const npmBin = options.npmBin || "npm";
  const npxBin = options.npxBin || "npx";
  execFileSyncImpl(npmBin, ["install", "--omit=dev"], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  execFileSyncImpl(npxBin, ["playwright", "install", "chromium"], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { installed: true };
}

export function enableOperationConsoleAutomation(options = {}) {
  const envPath = options.envPath || path.join(process.cwd(), ".env");
  let raw = "";
  if (fs.existsSync(envPath)) raw = fs.readFileSync(envPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line, index, all) => index < all.length - 1 || line.trim());
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (/^\s*OPERATION_CONSOLE_AUTOMATION_ENABLED\s*=/.test(line)) {
      replaced = true;
      return "OPERATION_CONSOLE_AUTOMATION_ENABLED=1";
    }
    return line;
  });
  if (!replaced) nextLines.push("OPERATION_CONSOLE_AUTOMATION_ENABLED=1");
  fs.writeFileSync(envPath, `${nextLines.join("\n")}\n`, "utf8");
  process.env.OPERATION_CONSOLE_AUTOMATION_ENABLED = "1";
  return { enabled: true, envPath: text(envPath) };
}
