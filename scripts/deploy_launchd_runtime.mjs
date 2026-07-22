#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEPLOY_ROLLBACK_INCOMPLETE = "DEPLOY_ROLLBACK_INCOMPLETE";

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
    const stagingDir = mkdtempSync(path.join(runtimeDir, ".deploy-runtime-"));
    const stagedPath = path.join(stagingDir, entry.name);
    try {
      cpSync(path.join(sourceDir, entry.name), stagedPath, { recursive: true });
      if (!existsSync(targetPath)) {
        renameSync(stagedPath, targetPath);
        copied.push(entry.name);
      }
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
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

const APP_COPY_NAMES = [
  "server", "scripts", "outputs", "web", "deploy", "template",
  "package.json", "package-lock.json", "requirements.txt", ".env", "node_modules",
];
const APP_DIRECTORY_NAMES = ["server", "scripts", "outputs", "web", "deploy", "template"];
const PRESERVED_APP_NAMES = [".env", "node_modules"];

function buildStagedApp(sourceDir, stagedAppDir) {
  const copied = [];
  for (const name of APP_COPY_NAMES) {
    if (copyIfPresent(path.join(sourceDir, name), path.join(stagedAppDir, name))) copied.push(name);
  }
  symlinkSync("../runtime", path.join(stagedAppDir, ".easy_exam_runtime"), "dir");
  const stagedServerDir = path.join(stagedAppDir, "server");
  const stagedPackageJson = path.join(stagedAppDir, "package.json");
  const stagedEntry = path.join(stagedServerDir, "easy_exam_server.mjs");
  if (!existsSync(stagedServerDir) || !lstatSync(stagedServerDir).isDirectory()) {
    throw new Error("Staged app server must be a directory");
  }
  if (!existsSync(stagedPackageJson) || !lstatSync(stagedPackageJson).isFile()) {
    throw new Error("Staged app package.json is missing");
  }
  if (!existsSync(stagedEntry) || !lstatSync(stagedEntry).isFile()) {
    throw new Error("Staged app server entry is missing");
  }
  for (const name of APP_DIRECTORY_NAMES) {
    if (existsSync(path.join(sourceDir, name)) && !lstatSync(path.join(stagedAppDir, name)).isDirectory()) {
      throw new Error(`Staged app ${name} must be a directory`);
    }
  }
  const runtimeLink = path.join(stagedAppDir, ".easy_exam_runtime");
  if (!lstatSync(runtimeLink).isSymbolicLink() || readlinkSync(runtimeLink) !== "../runtime") {
    throw new Error("Staged app runtime symlink is invalid");
  }
  return copied;
}

function rollbackIncompleteError(originalError, rollbackError, recoveryPaths) {
  const originalMessage = originalError instanceof Error ? originalError.message : String(originalError);
  const appState = existsSync(recoveryPaths.app)
    ? "present"
    : "absent; restore the old app from backup/app before removing stage";
  const error = new Error(
    `${originalMessage}\nRollback incomplete.\nRecovery paths:\nbackup: ${recoveryPaths.backup}\nstage: ${recoveryPaths.stage}\napp: ${recoveryPaths.app} (${appState})\nlock: ${recoveryPaths.lock}`,
    { cause: rollbackError },
  );
  error.code = DEPLOY_ROLLBACK_INCOMPLETE;
  error.recoveryPaths = { ...recoveryPaths, appState };
  return error;
}

function rollbackAppSwitch({ appDir, stagedAppDir, backupAppDir, backupRootDir, movedNames, appBackedUp, stagedActivated, originalError, renameSyncImpl, recoveryPaths }) {
  let rollbackError;
  try {
    if (appBackedUp && existsSync(backupAppDir)) {
      const activeAppDir = stagedActivated ? appDir : stagedAppDir;
      for (const name of movedNames) {
        const activePath = path.join(activeAppDir, name);
        if (existsSync(activePath)) renameSyncImpl(activePath, path.join(backupAppDir, name));
      }
      if (stagedActivated) rmSync(activeAppDir, { recursive: true, force: true });
      renameSyncImpl(backupAppDir, appDir);
      if (!stagedActivated) rmSync(stagedAppDir, { recursive: true, force: true });
    } else if (!appBackedUp) {
      rmSync(stagedAppDir, { recursive: true, force: true });
    } else {
      throw new Error("Backup app is missing during rollback");
    }
    rmSync(backupRootDir, { recursive: true, force: true });
  } catch (error) {
    rollbackError = error;
  }
  if (rollbackError) {
    throw rollbackIncompleteError(originalError, rollbackError, recoveryPaths);
  }
  throw originalError;
}

export function switchStagedApp(appDir, stagedAppDir, targetDir, { lockPath = path.join(targetDir, ".deploy-lock"), renameSyncImpl = renameSync } = {}) {
  const backupRootDir = mkdtempSync(path.join(targetDir, ".deploy-backup-"));
  const backupAppDir = path.join(backupRootDir, "app");
  const recoveryPaths = {
    backup: backupRootDir,
    stage: stagedAppDir,
    app: appDir,
    lock: lockPath,
  };
  const hasExistingApp = existsSync(appDir);
  const movedNames = [];
  let appBackedUp = false;
  let stagedActivated = false;
  try {
    if (hasExistingApp) {
      renameSyncImpl(appDir, backupAppDir);
      appBackedUp = true;
    }
    if (hasExistingApp) {
      for (const name of PRESERVED_APP_NAMES) {
        const stagedPath = path.join(stagedAppDir, name);
        const backupPath = path.join(backupAppDir, name);
        if (!existsSync(stagedPath) && existsSync(backupPath)) {
          renameSyncImpl(backupPath, stagedPath);
          movedNames.push(name);
        }
      }
    }
    renameSyncImpl(stagedAppDir, appDir);
    stagedActivated = true;
  } catch (error) {
    rollbackAppSwitch({
      appDir,
      stagedAppDir,
      backupAppDir,
      backupRootDir,
      movedNames,
      appBackedUp,
      stagedActivated,
      originalError: error,
      renameSyncImpl,
      recoveryPaths,
    });
  }
  try {
    rmSync(backupRootDir, { recursive: true, force: true });
    return { backupPath: "" };
  } catch {
    return { backupPath: backupRootDir };
  }
}

function acquireDeploymentLock(targetDir) {
  const lockDir = path.join(targetDir, ".deploy-lock");
  try {
    mkdirSync(lockDir);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Deployment already in progress or needs recovery: ${lockDir}`);
    }
    throw error;
  }
  return lockDir;
}

export function releaseDeploymentLockAfterDeployment(lockDir, deploymentError) {
  if (deploymentError?.code === DEPLOY_ROLLBACK_INCOMPLETE) return false;
  rmSync(lockDir, { recursive: true, force: true });
  return true;
}

function main() {
  const args = parseArgs(process.argv);
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const sourceDir = path.resolve(args.source || path.join(scriptDir, ".."));
  const targetDir = path.resolve(args.target || path.join(os.homedir(), "Library", "Application Support", "easy-exam-automation"));
  const appDir = path.join(targetDir, "app");
  const runtimeDir = path.join(targetDir, "runtime");

  mkdirSync(targetDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  const lockDir = acquireDeploymentLock(targetDir);
  const sourceNodeModules = path.join(sourceDir, "node_modules");
  const appNodeModules = path.join(appDir, "node_modules");
  let deploymentError;
  let stagedAppDir = "";
  try {
    if (!existsSync(sourceNodeModules) && existsSync(appNodeModules) && dependencyDeclarationsChanged(sourceDir, appDir)) {
      throw new Error("Refusing to preserve existing app/node_modules because source dependency declarations changed. Provide source/node_modules or install dependencies before deployment.");
    }
    stagedAppDir = mkdtempSync(path.join(targetDir, ".deploy-stage-"));
    const copied = buildStagedApp(sourceDir, stagedAppDir);
    const migratedRuntime = args.migrateRuntime
      ? migrateRuntime(path.join(sourceDir, ".easy_exam_runtime"), runtimeDir)
      : [];
    const { backupPath } = switchStagedApp(appDir, stagedAppDir, targetDir, { lockPath: lockDir });

    process.stdout.write(`${JSON.stringify({
      ok: true,
      sourceDir,
      targetDir,
      appDir,
      runtimeDir,
      copied,
      migratedRuntime,
      ...(backupPath ? { backupPath, warning: "New app is active but the previous app backup could not be cleaned" } : {}),
    }, null, 2)}\n`);
  } catch (error) {
    deploymentError = error;
    if (stagedAppDir && error?.code !== DEPLOY_ROLLBACK_INCOMPLETE) {
      rmSync(stagedAppDir, { recursive: true, force: true });
    }
    throw error;
  } finally {
    releaseDeploymentLockAfterDeployment(lockDir, deploymentError);
  }
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) main();
