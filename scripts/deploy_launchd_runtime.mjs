#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--migrate-runtime") {
      args.migrateRuntime = true;
    } else if (item.startsWith("--")) {
      args[item.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function copyIfPresent(sourcePath, targetPath) {
  if (!existsSync(sourcePath)) return false;
  cpSync(sourcePath, targetPath, { recursive: true });
  return true;
}

function migrateRuntime(sourceDir, runtimeDir) {
  if (!existsSync(sourceDir)) return [];
  const copied = [];
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const targetPath = path.join(runtimeDir, entry.name);
    if (existsSync(targetPath)) continue;
    cpSync(path.join(sourceDir, entry.name), targetPath, { recursive: true });
    copied.push(entry.name);
  }
  return copied;
}

const args = parseArgs(process.argv);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(args.source || path.join(scriptDir, ".."));
const targetDir = path.resolve(args.target || path.join(os.homedir(), "Library", "Application Support", "easy-exam-automation"));
const appDir = path.join(targetDir, "app");
const runtimeDir = path.join(targetDir, "runtime");

mkdirSync(targetDir, { recursive: true });
mkdirSync(runtimeDir, { recursive: true });
rmSync(appDir, { recursive: true, force: true });
mkdirSync(appDir, { recursive: true });

const copied = [];
for (const name of ["server", "scripts", "outputs", "web", "deploy", "package.json", "requirements.txt", ".env"]) {
  if (copyIfPresent(path.join(sourceDir, name), path.join(appDir, name))) copied.push(name);
}
symlinkSync("../runtime", path.join(appDir, ".easy_exam_runtime"), "dir");
const migratedRuntime = args.migrateRuntime
  ? migrateRuntime(path.join(sourceDir, ".easy_exam_runtime"), runtimeDir)
  : [];

process.stdout.write(`${JSON.stringify({
  ok: true,
  sourceDir,
  targetDir,
  appDir,
  runtimeDir,
  copied,
  migratedRuntime,
}, null, 2)}\n`);
