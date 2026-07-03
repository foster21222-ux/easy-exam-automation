import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("easy exam service launchd template points at the Application Support runtime", () => {
  const plist = fs.readFileSync(path.join(rootDir, "deploy", "com.ata.easy-exam-service.plist.template"), "utf8");
  assert.match(plist, /<string>com\.ata\.easy-exam-service<\/string>/);
  assert.match(plist, /\/Users\/ata\/Library\/Application Support\/easy-exam-automation\/app\/scripts\/run_local_service\.sh/);
  assert.doesNotMatch(plist, /\/Users\/ata\/Documents\/easy-exam-automation/);
  assert.equal(plist.includes("/Users/chen"), false);
});

test("chen local web launchd template points at the synced runtime", () => {
  const plist = fs.readFileSync(path.join(rootDir, "deploy", "com.chen.yikao-auto-config-web.plist.template"), "utf8");
  assert.match(plist, /<string>com\.chen\.yikao-auto-config-web<\/string>/);
  assert.match(plist, /\/Users\/chen\/Library\/Application Support\/yikao-auto-config-web\/scripts\/run_local_service\.sh/);
  assert.match(plist, /<string>\/Users\/chen\/Library\/Application Support\/yikao-auto-config-web<\/string>/);
  assert.doesNotMatch(plist, /\/Users\/chen\/Desktop\/ai/);
});

test("local service runner uses current bundled runtimes", () => {
  const script = fs.readFileSync(path.join(rootDir, "scripts", "run_local_service.sh"), "utf8");
  assert.match(script, /DEFAULT_CODEX_RUNTIME="\$HOME\/\.cache\/codex-runtimes\/codex-primary-runtime\/dependencies"/);
  assert.match(script, /DEFAULT_CODEX_NODE="\$DEFAULT_CODEX_RUNTIME\/node\/bin\/node"/);
  assert.match(script, /CODEX_NODE="\$DEFAULT_CODEX_NODE"/);
  assert.match(script, /CODEX_PYTHON:=\$DEFAULT_CODEX_RUNTIME\/python\/bin\/python3/);
  assert.equal(script.includes("/Users/chen"), false);
});

test("wechat collector launchd template uses OCR capture mode", () => {
  const plist = fs.readFileSync(path.join(rootDir, "deploy", "com.ata.easy-exam-wechat-collector.plist.template"), "utf8");
  assert.match(plist, /<string>--captureMode<\/string>\s*<string>ocr<\/string>/);
  assert.match(plist, /\/Users\/ata\/Library\/Application Support\/easy-exam-automation\/app\/scripts\/wechat_visible_collect\.mjs/);
  assert.match(plist, /\/Users\/ata\/Library\/Application Support\/easy-exam-automation\/runtime\/wechat-requirement-groups\.json/);
  assert.doesNotMatch(plist, /\/Users\/ata\/Documents\/easy-exam-automation/);
});

test("customer service scheduler LaunchAgent runs hourly", () => {
  const plist = fs.readFileSync(path.join(rootDir, "deploy", "com.ata.easy-exam-customer-service-scheduler.plist.template"), "utf8");
  assert.match(plist, /com\.ata\.easy-exam-customer-service-scheduler/);
  assert.match(plist, /customer_service_scheduler\.mjs/);
  assert.match(plist, /<key>StartInterval<\/key>\s*<integer>3600<\/integer>/);
  assert.match(plist, /customer-service-scheduler\.log/);
  assert.match(plist, /customer-service-scheduler\.err\.log/);
});
