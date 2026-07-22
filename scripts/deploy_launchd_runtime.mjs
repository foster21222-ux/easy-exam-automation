#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
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

function sortedRecord(value) {
  return Object.fromEntries(Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right)));
}

function dependencyDeclaration(pathname) {
  if (!existsSync(pathname)) return null;
  try {
    const packageJson = JSON.parse(readFileSync(pathname, "utf8"));
    return JSON.stringify({
      dependencies: sortedRecord(packageJson.dependencies),
      devDependencies: sortedRecord(packageJson.devDependencies),
      optionalDependencies: sortedRecord(packageJson.optionalDependencies),
      peerDependencies: sortedRecord(packageJson.peerDependencies),
    });
  } catch {
    return readFileSync(pathname, "utf8");
  }
}

function dependencyDeclarationsChanged(sourceDir, appDir) {
  if (dependencyDeclaration(path.join(sourceDir, "package.json"))
    !== dependencyDeclaration(path.join(appDir, "package.json"))) return true;
  const sourceLockPath = path.join(sourceDir, "package-lock.json");
  const appLockPath = path.join(appDir, "package-lock.json");
  return (existsSync(sourceLockPath) ? readFileSync(sourceLockPath, "utf8") : null)
    !== (existsSync(appLockPath) ? readFileSync(appLockPath, "utf8") : null);
}

function restorePreservedEntries(appDir, preservedDir, preservedNames) {
  const remaining = [];
  for (const name of preservedNames) {
    const preservedPath = path.join(preservedDir, name);
    if (!existsSync(preservedPath)) continue;
    try {
      mkdirSync(appDir, { recursive: true });
      rmSync(path.join(appDir, name), { recursive: true, force: true });
      renameSync(preservedPath, path.join(appDir, name));
    } catch {
      remaining.push(name);
    }
  }
  return remaining;
}

const args = parseArgs(process.argv);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(args.source || path.join(scriptDir, ".."));
const targetDir = path.resolve(args.target || path.join(os.homedir(), "Library", "Application Support", "easy-exam-automation"));
const appDir = path.join(targetDir, "app");
const runtimeDir = path.join(targetDir, "runtime");

mkdirSync(targetDir, { recursive: true });
mkdirSync(runtimeDir, { recursive: true });
const sourceNodeModules = path.join(sourceDir, "node_modules");
const appNodeModules = path.join(appDir, "node_modules");
if (!existsSync(sourceNodeModules) && existsSync(appNodeModules) && dependencyDeclarationsChanged(sourceDir, appDir)) {
  throw new Error("Refusing to preserve existing app/node_modules because source dependency declarations changed. Provide source/node_modules or install dependencies before deployment.");
}
const preservedDir = mkdtempSync(path.join(targetDir, ".deploy-preserved-"));
const preservedNames = [];
const copied = [];
let migratedRuntime = [];
let deploymentComplete = false;
try {
  for (const name of [".env", "node_modules"]) {
    const currentPath = path.join(appDir, name);
    if (!existsSync(currentPath)) continue;
    renameSync(currentPath, path.join(preservedDir, name));
    preservedNames.push(name);
  }

  rmSync(appDir, { recursive: true, force: true });
  mkdirSync(appDir, { recursive: true });
  for (const name of ["server", "scripts", "outputs", "web", "deploy", "template", "package.json", "package-lock.json", "requirements.txt", ".env", "node_modules"]) {
    if (copyIfPresent(path.join(sourceDir, name), path.join(appDir, name))) copied.push(name);
  }
  symlinkSync("../runtime", path.join(appDir, ".easy_exam_runtime"), "dir");
  migratedRuntime = args.migrateRuntime
    ? migrateRuntime(path.join(sourceDir, ".easy_exam_runtime"), runtimeDir)
    : [];

  for (const name of preservedNames) {
    const currentPath = path.join(appDir, name);
    if (!existsSync(currentPath)) renameSync(path.join(preservedDir, name), currentPath);
  }
  deploymentComplete = true;
} catch (error) {
  const remaining = restorePreservedEntries(appDir, preservedDir, preservedNames);
  if (remaining.length === 0) {
    rmSync(preservedDir, { recursive: true, force: true });
    throw error;
  }
  throw new Error(`${error instanceof Error ? error.message : String(error)}\nRecovery path: ${preservedDir}\nRemaining preserved entries: ${remaining.join(", ")}`, { cause: error });
} finally {
  if (deploymentComplete) rmSync(preservedDir, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  sourceDir,
  targetDir,
  appDir,
  runtimeDir,
  copied,
  migratedRuntime,
}, null, 2)}\n`);
