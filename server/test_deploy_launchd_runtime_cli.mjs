import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const rootDir = path.resolve(import.meta.dirname, "..");

test("launchd runtime deployment rebuilds app code and preserves migrated data", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-launchd-runtime-"));
  const sourceDir = path.join(tempDir, "source");
  const targetDir = path.join(tempDir, "target");
  for (const dir of ["server", "scripts", "outputs", "web", "deploy", ".easy_exam_runtime"]) {
    mkdirSync(path.join(sourceDir, dir), { recursive: true });
  }
  writeFileSync(path.join(sourceDir, "server", "app.mjs"), "version-1\n");
  writeFileSync(path.join(sourceDir, "scripts", "runner.sh"), "runner\n");
  writeFileSync(path.join(sourceDir, "outputs", "index.html"), "output\n");
  writeFileSync(path.join(sourceDir, "web", "router.mjs"), "router\n");
  writeFileSync(path.join(sourceDir, "deploy", "collector.plist.template"), "plist\n");
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
  assert.equal(lstatSync(path.join(targetDir, "app", ".easy_exam_runtime")).isSymbolicLink(), true);
  assert.equal(existsSync(path.join(targetDir, "app", ".easy_exam_runtime", "requirement_requests.sqlite3")), true);

  writeFileSync(path.join(sourceDir, "server", "app.mjs"), "version-2\n");
  writeFileSync(path.join(sourceDir, ".easy_exam_runtime", "requirement_requests.sqlite3"), "database-v2\n");
  execFileSync(process.execPath, command, { encoding: "utf8" });

  assert.equal(readFileSync(path.join(targetDir, "app", "server", "app.mjs"), "utf8"), "version-2\n");
  assert.equal(readFileSync(path.join(targetDir, "runtime", "requirement_requests.sqlite3"), "utf8"), "database-v1\n");
});
