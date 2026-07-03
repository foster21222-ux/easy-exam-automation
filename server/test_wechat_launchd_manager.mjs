import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getEasyExamServiceLaunchdStatus,
  getWechatCollectorLaunchdStatus,
  installEasyExamServiceLaunchd,
  installWechatCollectorLaunchd,
  uninstallEasyExamServiceLaunchd,
  uninstallWechatCollectorLaunchd,
} from "./wechat_launchd_manager.mjs";

function tmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), "wechat-launchd-"));
}

test("reports launchd collector installed and loaded status", () => {
  const dir = tmpDir();
  const plistPath = path.join(dir, "com.ata.easy-exam-wechat-collector.plist");
  writeFileSync(plistPath, "<plist></plist>");

  const status = getWechatCollectorLaunchdStatus({
    plistPath,
    execFileSyncImpl: () => "123\t0\tcom.ata.easy-exam-wechat-collector\n",
  });

  assert.equal(status.label, "com.ata.easy-exam-wechat-collector");
  assert.equal(status.plistPath, plistPath);
  assert.equal(status.installed, true);
  assert.equal(status.loaded, true);
});

test("installs launchd collector plist and loads it", () => {
  const dir = tmpDir();
  const templatePath = path.join(dir, "template.plist");
  const plistPath = path.join(dir, "LaunchAgents", "com.ata.easy-exam-wechat-collector.plist");
  writeFileSync(templatePath, "<plist><dict></dict></plist>");
  const calls = [];

  const result = installWechatCollectorLaunchd({
    templatePath,
    plistPath,
    execFileSyncImpl: (command, args) => {
      calls.push([command, args]);
      return "";
    },
  });

  assert.equal(result.installed, true);
  assert.equal(readFileSync(plistPath, "utf8"), "<plist><dict></dict></plist>");
  assert.deepEqual(calls, [
    ["plutil", ["-lint", plistPath]],
    ["launchctl", ["load", plistPath]],
    ["launchctl", ["list"]],
  ]);
});

test("uninstalls launchd collector plist and unloads it when present", () => {
  const dir = tmpDir();
  const plistPath = path.join(dir, "LaunchAgents", "com.ata.easy-exam-wechat-collector.plist");
  mkdirSync(path.dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, "<plist></plist>");
  const calls = [];

  const result = uninstallWechatCollectorLaunchd({
    plistPath,
    execFileSyncImpl: (command, args) => {
      calls.push([command, args]);
      return "";
    },
  });

  assert.equal(result.installed, false);
  assert.equal(existsSync(plistPath), false);
  assert.deepEqual(calls, [
    ["launchctl", ["unload", plistPath]],
    ["launchctl", ["list"]],
  ]);
});

test("reports easy exam service launchd installed and loaded status", () => {
  const dir = tmpDir();
  const plistPath = path.join(dir, "com.ata.easy-exam-service.plist");
  writeFileSync(plistPath, "<plist></plist>");

  const status = getEasyExamServiceLaunchdStatus({
    plistPath,
    execFileSyncImpl: () => "321\t0\tcom.ata.easy-exam-service\n",
  });

  assert.equal(status.label, "com.ata.easy-exam-service");
  assert.equal(status.plistPath, plistPath);
  assert.equal(status.installed, true);
  assert.equal(status.loaded, true);
});

test("installs easy exam service plist and loads it", () => {
  const dir = tmpDir();
  const templatePath = path.join(dir, "service-template.plist");
  const plistPath = path.join(dir, "LaunchAgents", "com.ata.easy-exam-service.plist");
  writeFileSync(templatePath, "<plist><dict><key>Label</key></dict></plist>");
  const calls = [];

  const result = installEasyExamServiceLaunchd({
    templatePath,
    plistPath,
    execFileSyncImpl: (command, args) => {
      calls.push([command, args]);
      return "";
    },
  });

  assert.equal(result.installed, true);
  assert.equal(readFileSync(plistPath, "utf8"), "<plist><dict><key>Label</key></dict></plist>");
  assert.deepEqual(calls, [
    ["plutil", ["-lint", plistPath]],
    ["launchctl", ["load", plistPath]],
    ["launchctl", ["list"]],
  ]);
});

test("uninstalls easy exam service plist and unloads it when present", () => {
  const dir = tmpDir();
  const plistPath = path.join(dir, "LaunchAgents", "com.ata.easy-exam-service.plist");
  mkdirSync(path.dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, "<plist></plist>");
  const calls = [];

  const result = uninstallEasyExamServiceLaunchd({
    plistPath,
    execFileSyncImpl: (command, args) => {
      calls.push([command, args]);
      return "";
    },
  });

  assert.equal(result.installed, false);
  assert.equal(existsSync(plistPath), false);
  assert.deepEqual(calls, [
    ["launchctl", ["unload", plistPath]],
    ["launchctl", ["list"]],
  ]);
});
