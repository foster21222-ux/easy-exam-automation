import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const rootDir = path.resolve(import.meta.dirname, "..");

test("launchd runtime deployment rebuilds app code while preserving runtime config, dependencies, and data", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-launchd-runtime-"));
  const sourceDir = path.join(tempDir, "source");
  const targetDir = path.join(tempDir, "target");
  for (const dir of ["server", "scripts", "outputs", "web", "deploy", "template", ".easy_exam_runtime"]) {
    mkdirSync(path.join(sourceDir, dir), { recursive: true });
  }
  writeFileSync(path.join(sourceDir, "server", "app.mjs"), "version-1\n");
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
  writeFileSync(path.join(sourceDir, "server", "app.mjs"), "version-2\n");
  writeFileSync(path.join(sourceDir, ".easy_exam_runtime", "requirement_requests.sqlite3"), "database-v2\n");
  execFileSync(process.execPath, command, { encoding: "utf8" });

  assert.equal(readFileSync(path.join(targetDir, "app", "server", "app.mjs"), "utf8"), "version-2\n");
  assert.equal(readFileSync(path.join(targetDir, "app", ".env"), "utf8"), "RUNTIME_SECRET=preserve-me\n");
  assert.equal(readFileSync(path.join(targetDir, "app", "node_modules", "playwright", "installed.marker"), "utf8"), "installed\n");
  assert.equal(readFileSync(path.join(targetDir, "runtime", "requirement_requests.sqlite3"), "utf8"), "database-v1\n");
  assert.deepEqual(readdirSync(targetDir).filter((name) => name.startsWith(".deploy-preserved-")), []);

  writeFileSync(path.join(sourceDir, ".env"), "SOURCE_CONFIG=use-source\n");
  execFileSync(process.execPath, command, { encoding: "utf8" });

  assert.equal(readFileSync(path.join(targetDir, "app", ".env"), "utf8"), "SOURCE_CONFIG=use-source\n");
  assert.equal(readFileSync(path.join(targetDir, "app", "node_modules", "playwright", "installed.marker"), "utf8"), "installed\n");
  assert.deepEqual(readdirSync(targetDir).filter((name) => name.startsWith(".deploy-preserved-")), []);
});

test("launchd runtime deployment prefers source dependencies and copies its lockfile", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-launchd-runtime-source-deps-"));
  const sourceDir = path.join(tempDir, "source");
  const targetDir = path.join(tempDir, "target");
  for (const dir of ["server", "scripts", "outputs", "web", "deploy", "template"]) {
    mkdirSync(path.join(sourceDir, dir), { recursive: true });
  }
  writeFileSync(path.join(sourceDir, "server", "app.mjs"), "version-1\n");
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
  writeFileSync(path.join(sourceDir, "server", "app.mjs"), "version-1\n");
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
  assert.deepEqual(readdirSync(targetDir).filter((name) => name.startsWith(".deploy-preserved-")), []);
});

test("launchd runtime deployment refuses changed dependency declarations without source dependencies", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-launchd-runtime-dependency-guard-"));
  const sourceDir = path.join(tempDir, "source");
  const targetDir = path.join(tempDir, "target");
  for (const dir of ["server", "scripts", "outputs", "web", "deploy", "template"]) {
    mkdirSync(path.join(sourceDir, dir), { recursive: true });
  }
  writeFileSync(path.join(sourceDir, "server", "app.mjs"), "version-1\n");
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
  writeFileSync(path.join(sourceDir, "server", "app.mjs"), "version-2\n");
  writeFileSync(path.join(sourceDir, "package.json"), '{"dependencies":{"new-package":"1.0.0"}}\n');

  assert.throws(
    () => execFileSync(process.execPath, command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => /node_modules.*dependency declarations/i.test(String(error.stderr || error.message)),
  );

  assert.equal(readFileSync(path.join(targetDir, "app", ".env"), "utf8"), "RUNTIME_CONFIG=old\n");
  assert.equal(readFileSync(path.join(targetDir, "app", "node_modules", "playwright", "installed.marker"), "utf8"), "old\n");
  assert.equal(readFileSync(path.join(targetDir, "app", "server", "app.mjs"), "utf8"), "version-1\n");
  assert.deepEqual(readdirSync(targetDir).filter((name) => name.startsWith(".deploy-preserved-")), []);
});
