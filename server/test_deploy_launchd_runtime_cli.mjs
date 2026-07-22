import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEPLOY_ROLLBACK_INCOMPLETE,
  releaseDeploymentLockAfterDeployment,
  switchStagedApp,
} from "../scripts/deploy_launchd_runtime.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");

function writeSourceServer(sourceDir, version) {
  writeFileSync(path.join(sourceDir, "server", "app.mjs"), `${version}\n`);
  writeFileSync(path.join(sourceDir, "server", "easy_exam_server.mjs"), "export {};\n");
}

test("launchd runtime deployment rebuilds app code while preserving runtime config, dependencies, and data", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-launchd-runtime-"));
  const sourceDir = path.join(tempDir, "source");
  const targetDir = path.join(tempDir, "target");
  for (const dir of ["server", "scripts", "outputs", "web", "deploy", "template", ".easy_exam_runtime"]) {
    mkdirSync(path.join(sourceDir, dir), { recursive: true });
  }
  writeSourceServer(sourceDir, "version-1");
  writeFileSync(path.join(sourceDir, "scripts", "runner.sh"), "runner\n");
  writeFileSync(path.join(sourceDir, "outputs", "index.html"), "output\n");
  writeFileSync(path.join(sourceDir, "web", "router.mjs"), "router\n");
  writeFileSync(path.join(sourceDir, "deploy", "collector.plist.template"), "plist\n");
  writeFileSync(path.join(sourceDir, "template", "exam.xlsx"), "template\n");
  writeFileSync(path.join(sourceDir, ".easy_exam_runtime", "requirement_requests.sqlite3"), "database-v1\n");
  writeFileSync(path.join(sourceDir, "package.json"), "{}\n");

  const command = [
    path.join(rootDir, "scripts", "deploy_launchd_runtime.mjs"),
    "--source", sourceDir,
    "--target", targetDir,
    "--migrate-runtime",
  ];
  const first = JSON.parse(execFileSync(process.execPath, command, { encoding: "utf8" }));

  assert.equal(first.ok, true);
  assert.equal(readFileSync(path.join(targetDir, "app", "server", "app.mjs"), "utf8"), "version-1\n");
  assert.equal(readFileSync(path.join(targetDir, "runtime", "requirement_requests.sqlite3"), "utf8"), "database-v1\n");
  assert.equal(readFileSync(path.join(targetDir, "app", "deploy", "collector.plist.template"), "utf8"), "plist\n");
  assert.equal(readFileSync(path.join(targetDir, "app", "template", "exam.xlsx"), "utf8"), "template\n");
  assert.equal(lstatSync(path.join(targetDir, "app", ".easy_exam_runtime")).isSymbolicLink(), true);
  assert.equal(existsSync(path.join(targetDir, "app", ".easy_exam_runtime", "requirement_requests.sqlite3")), true);

  writeFileSync(path.join(targetDir, "app", ".env"), "RUNTIME_SECRET=preserve-me\n");
  mkdirSync(path.join(targetDir, "app", "node_modules", "playwright"), { recursive: true });
  writeFileSync(path.join(targetDir, "app", "node_modules", "playwright", "installed.marker"), "installed\n");
  const envInode = statSync(path.join(targetDir, "app", ".env")).ino;
  const nodeMarkerInode = statSync(path.join(targetDir, "app", "node_modules", "playwright", "installed.marker")).ino;
  const runtimeInode = statSync(path.join(targetDir, "runtime", "requirement_requests.sqlite3")).ino;
  writeSourceServer(sourceDir, "version-2");
  writeFileSync(path.join(sourceDir, ".easy_exam_runtime", "requirement_requests.sqlite3"), "database-v2\n");
  execFileSync(process.execPath, command, { encoding: "utf8" });

  assert.equal(readFileSync(path.join(targetDir, "app", "server", "app.mjs"), "utf8"), "version-2\n");
  assert.equal(readFileSync(path.join(targetDir, "app", ".env"), "utf8"), "RUNTIME_SECRET=preserve-me\n");
  assert.equal(readFileSync(path.join(targetDir, "app", "node_modules", "playwright", "installed.marker"), "utf8"), "installed\n");
  assert.equal(readFileSync(path.join(targetDir, "runtime", "requirement_requests.sqlite3"), "utf8"), "database-v1\n");
  assert.equal(statSync(path.join(targetDir, "app", ".env")).ino, envInode);
  assert.equal(statSync(path.join(targetDir, "app", "node_modules", "playwright", "installed.marker")).ino, nodeMarkerInode);
  assert.equal(statSync(path.join(targetDir, "runtime", "requirement_requests.sqlite3")).ino, runtimeInode);
  assert.deepEqual(readdirSync(targetDir).filter((name) => name.startsWith(".deploy-")), []);

  writeFileSync(path.join(sourceDir, ".env"), "SOURCE_CONFIG=use-source\n");
  execFileSync(process.execPath, command, { encoding: "utf8" });

  assert.equal(readFileSync(path.join(targetDir, "app", ".env"), "utf8"), "SOURCE_CONFIG=use-source\n");
  assert.equal(readFileSync(path.join(targetDir, "app", "node_modules", "playwright", "installed.marker"), "utf8"), "installed\n");
  assert.deepEqual(readdirSync(targetDir).filter((name) => name.startsWith(".deploy-")), []);
});

test("launchd runtime deployment prefers source dependencies and copies its lockfile", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-launchd-runtime-source-deps-"));
  const sourceDir = path.join(tempDir, "source");
  const targetDir = path.join(tempDir, "target");
  for (const dir of ["server", "scripts", "outputs", "web", "deploy", "template"]) {
    mkdirSync(path.join(sourceDir, dir), { recursive: true });
  }
  writeSourceServer(sourceDir, "version-1");
  writeFileSync(path.join(sourceDir, "package.json"), "{}\n");
  const command = [
    path.join(rootDir, "scripts", "deploy_launchd_runtime.mjs"),
    "--source", sourceDir,
    "--target", targetDir,
  ];
  execFileSync(process.execPath, command, { encoding: "utf8" });

  writeFileSync(path.join(targetDir, "app", ".env"), "RUNTIME_CONFIG=old\n");
  mkdirSync(path.join(targetDir, "app", "node_modules", "playwright"), { recursive: true });
  writeFileSync(path.join(targetDir, "app", "node_modules", "playwright", "installed.marker"), "old\n");
  writeSourceServer(sourceDir, "version-2");
  writeFileSync(path.join(sourceDir, ".env"), "SOURCE_CONFIG=new\n");
  mkdirSync(path.join(sourceDir, "node_modules", "playwright"), { recursive: true });
  writeFileSync(path.join(sourceDir, "node_modules", "playwright", "installed.marker"), "source\n");
  writeFileSync(path.join(sourceDir, "package-lock.json"), '{"lockfileVersion":3}\n');

  execFileSync(process.execPath, command, { encoding: "utf8" });

  assert.equal(readFileSync(path.join(targetDir, "app", ".env"), "utf8"), "SOURCE_CONFIG=new\n");
  assert.equal(readFileSync(path.join(targetDir, "app", "node_modules", "playwright", "installed.marker"), "utf8"), "source\n");
  assert.equal(readFileSync(path.join(targetDir, "app", "package-lock.json"), "utf8"), '{"lockfileVersion":3}\n');
  assert.deepEqual(readdirSync(targetDir).filter((name) => name.startsWith(".deploy-preserved-")), []);
});

test("launchd runtime deployment restores old config and dependencies after a post-copy failure", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-launchd-runtime-restore-"));
  const sourceDir = path.join(tempDir, "source");
  const targetDir = path.join(tempDir, "target");
  for (const dir of ["server", "scripts", "outputs", "web", "deploy", "template", ".easy_exam_runtime"]) {
    mkdirSync(path.join(sourceDir, dir), { recursive: true });
  }
  writeSourceServer(sourceDir, "version-1");
  writeFileSync(path.join(sourceDir, "package.json"), "{}\n");
  writeFileSync(path.join(sourceDir, ".easy_exam_runtime", "state.json"), "initial\n");
  const command = [
    path.join(rootDir, "scripts", "deploy_launchd_runtime.mjs"),
    "--source", sourceDir,
    "--target", targetDir,
    "--migrate-runtime",
  ];
  execFileSync(process.execPath, command, { encoding: "utf8" });

  writeFileSync(path.join(targetDir, "app", ".env"), "RUNTIME_CONFIG=old\n");
  mkdirSync(path.join(targetDir, "app", "node_modules", "playwright"), { recursive: true });
  writeFileSync(path.join(targetDir, "app", "node_modules", "playwright", "installed.marker"), "old\n");
  writeSourceServer(sourceDir, "version-2");
  writeFileSync(path.join(sourceDir, ".env"), "SOURCE_CONFIG=new\n");
  mkdirSync(path.join(sourceDir, "node_modules", "playwright"), { recursive: true });
  writeFileSync(path.join(sourceDir, "node_modules", "playwright", "installed.marker"), "source\n");
  rmSync(path.join(sourceDir, ".easy_exam_runtime"), { recursive: true, force: true });
  writeFileSync(path.join(sourceDir, ".easy_exam_runtime"), "not a directory\n");

  assert.throws(
    () => execFileSync(process.execPath, command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => /ENOTDIR/.test(String(error.stderr || error.message)),
  );

  assert.equal(readFileSync(path.join(targetDir, "app", ".env"), "utf8"), "RUNTIME_CONFIG=old\n");
  assert.equal(readFileSync(path.join(targetDir, "app", "node_modules", "playwright", "installed.marker"), "utf8"), "old\n");
  assert.equal(readFileSync(path.join(targetDir, "app", "server", "app.mjs"), "utf8"), "version-1\n");
  assert.deepEqual(readdirSync(targetDir).filter((name) => name.startsWith(".deploy-")), []);

  rmSync(path.join(sourceDir, ".easy_exam_runtime"), { force: true });
  mkdirSync(path.join(sourceDir, ".easy_exam_runtime"));
  writeFileSync(path.join(sourceDir, ".easy_exam_runtime", "state.json"), "retry\n");
  execFileSync(process.execPath, command, { encoding: "utf8" });
  assert.equal(readFileSync(path.join(targetDir, "app", "server", "app.mjs"), "utf8"), "version-2\n");
  assert.equal(readFileSync(path.join(targetDir, "app", ".env"), "utf8"), "SOURCE_CONFIG=new\n");
  assert.equal(readFileSync(path.join(targetDir, "app", "node_modules", "playwright", "installed.marker"), "utf8"), "source\n");
});

test("launchd runtime deployment refuses changed dependency declarations without source dependencies", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-launchd-runtime-dependency-guard-"));
  const sourceDir = path.join(tempDir, "source");
  const targetDir = path.join(tempDir, "target");
  for (const dir of ["server", "scripts", "outputs", "web", "deploy", "template"]) {
    mkdirSync(path.join(sourceDir, dir), { recursive: true });
  }
  writeSourceServer(sourceDir, "version-1");
  writeFileSync(path.join(sourceDir, "package.json"), "{}\n");
  const command = [
    path.join(rootDir, "scripts", "deploy_launchd_runtime.mjs"),
    "--source", sourceDir,
    "--target", targetDir,
  ];
  execFileSync(process.execPath, command, { encoding: "utf8" });

  writeFileSync(path.join(targetDir, "app", ".env"), "RUNTIME_CONFIG=old\n");
  mkdirSync(path.join(targetDir, "app", "node_modules", "playwright"), { recursive: true });
  writeFileSync(path.join(targetDir, "app", "node_modules", "playwright", "installed.marker"), "old\n");
  writeSourceServer(sourceDir, "version-2");
  writeFileSync(path.join(sourceDir, "package.json"), '{"dependencies":{"new-package":"1.0.0"}}\n');

  assert.throws(
    () => execFileSync(process.execPath, command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => /node_modules.*dependency declarations/i.test(String(error.stderr || error.message)),
  );

  assert.equal(readFileSync(path.join(targetDir, "app", ".env"), "utf8"), "RUNTIME_CONFIG=old\n");
  assert.equal(readFileSync(path.join(targetDir, "app", "node_modules", "playwright", "installed.marker"), "utf8"), "old\n");
  assert.equal(readFileSync(path.join(targetDir, "app", "server", "app.mjs"), "utf8"), "version-1\n");
  assert.deepEqual(readdirSync(targetDir).filter((name) => name.startsWith(".deploy-")), []);
});

test("launchd runtime deployment leaves the old app untouched when staged app validation fails", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-launchd-runtime-stage-"));
  const sourceDir = path.join(tempDir, "source");
  const targetDir = path.join(tempDir, "target");
  for (const dir of ["server", "scripts", "outputs", "web", "deploy", "template"]) {
    mkdirSync(path.join(sourceDir, dir), { recursive: true });
  }
  writeSourceServer(sourceDir, "version-1");
  writeFileSync(path.join(sourceDir, "package.json"), "{}\n");
  const command = [
    path.join(rootDir, "scripts", "deploy_launchd_runtime.mjs"),
    "--source", sourceDir,
    "--target", targetDir,
  ];
  execFileSync(process.execPath, command, { encoding: "utf8" });
  writeFileSync(path.join(targetDir, "app", ".env"), "RUNTIME_CONFIG=old\n");
  mkdirSync(path.join(targetDir, "app", "node_modules", "playwright"), { recursive: true });
  writeFileSync(path.join(targetDir, "app", "node_modules", "playwright", "installed.marker"), "old\n");

  rmSync(path.join(sourceDir, "server"), { recursive: true, force: true });
  writeFileSync(path.join(sourceDir, "server"), "not a directory\n");
  assert.throws(
    () => execFileSync(process.execPath, command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => /server.*directory/i.test(String(error.stderr || error.message)),
  );
  assert.equal(readFileSync(path.join(targetDir, "app", "server", "app.mjs"), "utf8"), "version-1\n");
  assert.equal(readFileSync(path.join(targetDir, "app", ".env"), "utf8"), "RUNTIME_CONFIG=old\n");
  assert.equal(readFileSync(path.join(targetDir, "app", "node_modules", "playwright", "installed.marker"), "utf8"), "old\n");
  assert.deepEqual(readdirSync(targetDir).filter((name) => name.startsWith(".deploy-")), []);

  rmSync(path.join(sourceDir, "server"), { force: true });
  mkdirSync(path.join(sourceDir, "server"));
  writeFileSync(path.join(sourceDir, "server", "app.mjs"), "version-2\n");
  assert.throws(
    () => execFileSync(process.execPath, command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => /server entry/i.test(String(error.stderr || error.message)),
  );
  assert.equal(readFileSync(path.join(targetDir, "app", "server", "app.mjs"), "utf8"), "version-1\n");
  assert.deepEqual(readdirSync(targetDir).filter((name) => name.startsWith(".deploy-")), []);

  writeSourceServer(sourceDir, "version-2");
  execFileSync(process.execPath, command, { encoding: "utf8" });
  assert.equal(readFileSync(path.join(targetDir, "app", "server", "app.mjs"), "utf8"), "version-2\n");
  assert.equal(readFileSync(path.join(targetDir, "app", ".env"), "utf8"), "RUNTIME_CONFIG=old\n");
  assert.equal(readFileSync(path.join(targetDir, "app", "node_modules", "playwright", "installed.marker"), "utf8"), "old\n");
});

test("incomplete app-switch rollback keeps stage backup and lock recovery paths", () => {
  const targetDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-deploy-rollback-"));
  const appDir = path.join(targetDir, "app");
  const stagedAppDir = path.join(targetDir, ".deploy-stage-test");
  const lockDir = path.join(targetDir, ".deploy-lock");
  mkdirSync(path.join(appDir, "node_modules"), { recursive: true });
  mkdirSync(stagedAppDir);
  mkdirSync(lockDir);
  writeFileSync(path.join(appDir, ".env"), "old-env\n");
  writeFileSync(path.join(appDir, "node_modules", "marker"), "old-node\n");
  writeFileSync(path.join(stagedAppDir, "server.mjs"), "new-app\n");

  let error;
  assert.throws(
    () => switchStagedApp(appDir, stagedAppDir, targetDir, {
      lockPath: lockDir,
      renameSyncImpl(from, to) {
        if (from === stagedAppDir && to === appDir) throw new Error("activation failed");
        if (from === path.join(stagedAppDir, "node_modules")) throw new Error("rollback node move failed");
        return renameSync(from, to);
      },
    }),
    (caughtError) => {
      error = caughtError;
      return true;
    },
  );

  assert.equal(error.code, DEPLOY_ROLLBACK_INCOMPLETE);
  assert.equal(error.recoveryPaths.stage, stagedAppDir);
  assert.equal(error.recoveryPaths.app, appDir);
  assert.equal(error.recoveryPaths.lock, lockDir);
  assert.ok(error.recoveryPaths.backup.startsWith(targetDir));
  assert.equal(existsSync(stagedAppDir), true);
  assert.equal(existsSync(error.recoveryPaths.backup), true);
  assert.equal(existsSync(lockDir), true);
  assert.equal(existsSync(path.join(error.recoveryPaths.backup, "app", ".env")), true);
  assert.equal(existsSync(path.join(stagedAppDir, "node_modules", "marker")), true);
  assert.equal(releaseDeploymentLockAfterDeployment(lockDir, error), false);
  assert.equal(existsSync(lockDir), true);
  rmSync(targetDir, { recursive: true, force: true });
});

test("double rename failure keeps staged app until old app recovery succeeds", () => {
  const targetDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-deploy-double-rollback-"));
  const appDir = path.join(targetDir, "app");
  const stagedAppDir = path.join(targetDir, ".deploy-stage-test");
  const lockDir = path.join(targetDir, ".deploy-lock");
  mkdirSync(path.join(appDir, "node_modules"), { recursive: true });
  mkdirSync(stagedAppDir);
  mkdirSync(lockDir);
  writeFileSync(path.join(appDir, ".env"), "old-env\n");
  writeFileSync(path.join(appDir, "node_modules", "marker"), "old-node\n");
  writeFileSync(path.join(stagedAppDir, "server.mjs"), "new-app\n");

  let error;
  assert.throws(
    () => switchStagedApp(appDir, stagedAppDir, targetDir, {
      lockPath: lockDir,
      renameSyncImpl(from, to) {
        if (from === stagedAppDir && to === appDir) throw new Error("activation failed");
        if (to === appDir) throw new Error("old app recovery failed");
        return renameSync(from, to);
      },
    }),
    (caughtError) => {
      error = caughtError;
      return true;
    },
  );

  assert.equal(error.code, DEPLOY_ROLLBACK_INCOMPLETE);
  assert.equal(existsSync(error.recoveryPaths.stage), true);
  assert.equal(existsSync(error.recoveryPaths.backup), true);
  assert.equal(existsSync(error.recoveryPaths.lock), true);
  assert.equal(existsSync(error.recoveryPaths.app), false);
  assert.match(error.recoveryPaths.appState, /absent/i);
  assert.equal(releaseDeploymentLockAfterDeployment(lockDir, error), false);
  rmSync(targetDir, { recursive: true, force: true });
});
