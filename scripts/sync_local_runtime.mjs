#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_LABEL = "com.chen.yikao-auto-config-web";
const DEFAULT_TARGET = path.join(os.homedir(), "Library", "Application Support", "yikao-auto-config-web");

function parseArgs(argv) {
  const args = {
    restart: true,
    healthCheck: true,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--no-restart") {
      args.restart = false;
      args.healthCheck = false;
    } else if (item === "--no-health-check") {
      args.healthCheck = false;
    } else if (item.startsWith("--")) {
      args[item.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function gitTrackedFiles(sourceDir) {
  const output = run("git", [
    "ls-files",
    "-z",
    "--cached",
    "--modified",
    "--others",
    "--exclude-standard",
    "--",
    "server",
    "scripts",
    "outputs",
    "web",
    "deploy",
    "template",
    "package.json",
    "requirements.txt",
    ".env.example",
    "README.md",
    "WORKING_MEMORY.md",
  ], { cwd: sourceDir });
  return output.split("\0").filter(Boolean);
}

function syncTrackedFiles(sourceDir, targetDir, files) {
  const runtimeDir = path.join(targetDir, ".easy_exam_runtime");
  mkdirSync(runtimeDir, { recursive: true });

  for (const entry of ["server", "scripts", "outputs", "web", "deploy", "template"]) {
    rmSync(path.join(targetDir, entry), { recursive: true, force: true });
  }
  for (const entry of ["package.json", "requirements.txt", ".env.example", "README.md", "WORKING_MEMORY.md"]) {
    rmSync(path.join(targetDir, entry), { force: true });
  }

  let copied = 0;
  for (const relativePath of files) {
    if (relativePath === ".env") continue;
    const sourcePath = path.join(sourceDir, relativePath);
    const targetPath = path.join(targetDir, relativePath);
    if (!existsSync(sourcePath)) continue;
    mkdirSync(path.dirname(targetPath), { recursive: true });
    cpSync(sourcePath, targetPath, { recursive: true });
    copied += 1;
  }
  return copied;
}

function restartLaunchd(label, plistPath) {
  const service = `gui/${process.getuid()}/${label}`;
  try {
    run("launchctl", ["kickstart", "-k", service]);
  } catch (error) {
    const stderr = error.stderr || "";
    if (!String(stderr).includes("Could not find service") || !plistPath) {
      throw error;
    }
    run("launchctl", ["bootstrap", `gui/${process.getuid()}`, plistPath]);
    run("launchctl", ["kickstart", "-k", service]);
  }
}

function waitForHealth(url, attempts = 20) {
  let lastError = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return run("curl", ["-fsS", url]).trim();
    } catch (error) {
      lastError = error.stderr || error.message || String(error);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  }
  throw new Error(`Health check failed for ${url}: ${lastError}`);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv);
const sourceDir = path.resolve(args.source || path.join(scriptDir, ".."));
const targetDir = path.resolve(args.target || DEFAULT_TARGET);
const label = args.label || DEFAULT_LABEL;
const plistPath = path.resolve(args.plistPath || path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`));
const healthUrl = args.healthUrl || "http://127.0.0.1:8765/api/health";

mkdirSync(targetDir, { recursive: true });
const files = gitTrackedFiles(sourceDir);
const copied = syncTrackedFiles(sourceDir, targetDir, files);

let health = null;
if (args.restart) {
  restartLaunchd(label, plistPath);
  if (args.healthCheck) {
    health = waitForHealth(healthUrl);
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  sourceDir,
  targetDir,
  copied,
  restarted: args.restart,
  label,
  health,
}, null, 2)}\n`);
