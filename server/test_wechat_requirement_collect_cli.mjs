import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const nodeBin = "/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node";
const repoRoot = path.resolve(import.meta.dirname, "..");

test("manual WeChat text collector keeps checkpoint when repeated input has no new messages", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wechat-manual-cli-"));
  const configPath = path.join(tempDir, "groups.json");
  const inputPath = path.join(tempDir, "chat.txt");
  const statePath = path.join(tempDir, "state.json");
  writeFileSync(configPath, JSON.stringify({
    groups: [{
      group_name: "AI赋能运营自动化小组",
      project_name: "易考自动化需求",
      customer_name: "内部测试客户",
      requirement_request_id: "wechat-ai-ops",
      enabled: true,
    }],
  }));
  writeFileSync(inputPath, [
    "客户：考试名称是 2026 校招笔试。",
    "客户：正式考试 7 月 1 日 10点-12点。",
    "客户：科目是数学。",
  ].join("\n"));

  const args = [
    "scripts/wechat_requirement_collect.mjs",
    "--config", configPath,
    "--group", "AI赋能运营自动化小组",
    "--input", inputPath,
    "--state", statePath,
  ];
  execFileSync(nodeBin, args, { cwd: repoRoot, encoding: "utf8" });
  const firstState = JSON.parse(readFileSync(statePath, "utf8"));
  const firstCheckpoint = firstState.groups["AI赋能运营自动化小组"].checkpoint;

  execFileSync(nodeBin, args, { cwd: repoRoot, encoding: "utf8" });
  const secondState = JSON.parse(readFileSync(statePath, "utf8"));
  const secondCheckpoint = secondState.groups["AI赋能运营自动化小组"].checkpoint;

  assert.deepEqual(secondCheckpoint, firstCheckpoint);
});

test("manual WeChat text collector rejects a disabled target group before reading clipboard", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wechat-manual-cli-"));
  const binDir = path.join(tempDir, "bin");
  const configPath = path.join(tempDir, "groups.json");
  const clipboardMarker = path.join(tempDir, "pbpaste-called");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    groups: [
      { group_name: "AI赋能运营自动化小组", enabled: false, interval_minutes: 15 },
      { group_name: "其他已启用群", enabled: true, interval_minutes: 15 },
    ],
  }));
  writeFileSync(path.join(binDir, "pbpaste"), [
    "#!/bin/sh",
    `printf called > "${clipboardMarker}"`,
    "printf '客户：考试名称是 2026 校招笔试。\\n'",
    "",
  ].join("\n"), { mode: 0o755 });

  assert.throws(() => execFileSync(nodeBin, [
    "scripts/wechat_requirement_collect.mjs",
    "--config", configPath,
    "--group", "AI赋能运营自动化小组",
    "--clipboard",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
  }), /微信群已停用/);
  assert.equal(existsSync(clipboardMarker), false);
});

test("manual WeChat text collector rejects an unknown target group before reading clipboard", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wechat-manual-cli-"));
  const binDir = path.join(tempDir, "bin");
  const configPath = path.join(tempDir, "groups.json");
  const clipboardMarker = path.join(tempDir, "pbpaste-called");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    groups: [{ group_name: "其他已启用群", enabled: true, interval_minutes: 15 }],
  }));
  writeFileSync(path.join(binDir, "pbpaste"), [
    "#!/bin/sh",
    `printf called > "${clipboardMarker}"`,
    "printf '客户：考试名称是 2026 校招笔试。\\n'",
    "",
  ].join("\n"), { mode: 0o755 });

  assert.throws(() => execFileSync(nodeBin, [
    "scripts/wechat_requirement_collect.mjs",
    "--config", configPath,
    "--group", "AI赋能运营自动化小组",
    "--clipboard",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
  }), /未配置微信群/);
  assert.equal(existsSync(clipboardMarker), false);
});
