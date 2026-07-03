import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("easy exam service launchd CLI prints service status as JSON", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "easy-exam-service-launchd-cli-"));
  const plistPath = path.join(dir, "com.ata.easy-exam-service.plist");
  writeFileSync(plistPath, "<plist></plist>");

  const output = execFileSync(process.execPath, [
    path.join(rootDir, "scripts", "easy_exam_service_launchd.mjs"),
    "--status",
    "--plistPath",
    plistPath,
    "--json",
  ], { encoding: "utf8" });
  const body = JSON.parse(output);

  assert.equal(body.status.label, "com.ata.easy-exam-service");
  assert.equal(body.status.plistPath, plistPath);
  assert.equal(body.status.installed, true);
});
