# Customer Service Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an hourly local scheduler that opens EasyExam online customer service for every exam from 24 hours before start until exam end, then closes it after exam end.

**Architecture:** A focused Node module will normalize EasyExam sessions, decide the desired customer-service state from timestamps, and reconcile mismatches through injectable fetch calls. A small CLI wrapper will load `.env` and runtime settings, run the scheduler, and support dry-run. A LaunchAgent plist template will run the CLI every 3600 seconds.

**Tech Stack:** Node.js ES modules, `node:test`, tenant HTTP API via `fetch`, macOS LaunchAgent plist.

---

## File Structure

- Create `server/customer_service_scheduler.mjs`: pure decision helpers, session normalization, tenant API list/detail/update helpers, and `runCustomerServiceScheduler`.
- Create `server/test_customer_service_scheduler.mjs`: Node tests for time decisions, idempotency, dry-run, failure isolation, and API calls.
- Create `scripts/customer_service_scheduler.mjs`: CLI that loads `.env`, reads runtime settings fallback, parses `--dry-run`, and invokes the scheduler.
- Create `server/test_customer_service_scheduler_cli.mjs`: CLI-focused tests for env/runtime config loading and dry-run invocation behavior where practical.
- Create `deploy/com.ata.easy-exam-customer-service-scheduler.plist.template`: hourly LaunchAgent template.
- Modify `server/test_launchd_templates.mjs`: assert the new plist label, script path, interval, and log paths.

---

### Task 1: Core Scheduler Module

**Files:**
- Create: `server/test_customer_service_scheduler.mjs`
- Create: `server/customer_service_scheduler.mjs`

- [ ] **Step 1: Write failing tests for decisions and reconciliation**

Create `server/test_customer_service_scheduler.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  decideCustomerServiceAction,
  normalizeTenantSessions,
  runCustomerServiceScheduler,
} from "./customer_service_scheduler.mjs";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-07-02T10:00:00.000Z");

function session(overrides = {}) {
  return {
    id: "428516",
    name: "考试 A",
    start: Math.floor((NOW + HOUR) / 1000),
    end: Math.floor((NOW + 3 * HOUR) / 1000),
    config: { customer_service: false },
    ...overrides,
  };
}

test("decides to enable customer service inside the 24 hour pre-exam window", () => {
  const result = decideCustomerServiceAction(session(), NOW);
  assert.equal(result.action, "enable");
  assert.equal(result.desiredEnabled, true);
});

test("decides to disable customer service after exam end", () => {
  const result = decideCustomerServiceAction(
    session({ start: Math.floor((NOW - 3 * HOUR) / 1000), end: Math.floor((NOW - HOUR) / 1000), config: { customer_service: true } }),
    NOW,
  );
  assert.equal(result.action, "disable");
  assert.equal(result.desiredEnabled, false);
});

test("skips sessions before the 24 hour window", () => {
  const result = decideCustomerServiceAction(
    session({ start: Math.floor((NOW + DAY + HOUR) / 1000), end: Math.floor((NOW + DAY + 3 * HOUR) / 1000) }),
    NOW,
  );
  assert.equal(result.action, "skip_before_window");
});

test("skips sessions whose customer service state is already correct", () => {
  const result = decideCustomerServiceAction(session({ config: { customer_service: true } }), NOW);
  assert.equal(result.action, "skip_already_correct");
});

test("skips sessions with invalid times", () => {
  const result = decideCustomerServiceAction(session({ start: "", end: "" }), NOW);
  assert.equal(result.action, "skip_missing_time");
});

test("normalizes list payload variants into sessions", () => {
  assert.deepEqual(normalizeTenantSessions({ results: [session({ id: 1 })] }).map((item) => item.id), ["1"]);
  assert.deepEqual(normalizeTenantSessions({ data: { list: [session({ session_id: 2 })] } }).map((item) => item.id), ["2"]);
});

test("scheduler updates mismatched sessions and skips already-correct sessions", async () => {
  const calls = [];
  const sessions = [
    session({ id: "open-me", config: { customer_service: false } }),
    session({ id: "already-open", config: { customer_service: true } }),
    session({ id: "close-me", start: Math.floor((NOW - 3 * HOUR) / 1000), end: Math.floor((NOW - HOUR) / 1000), config: { customer_service: true } }),
  ];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body || "" });
    if (String(url).endsWith("/tenant/api/session/")) return jsonResponse({ results: sessions });
    const id = String(url).match(/session\/([^/]+)\//)?.[1];
    return jsonResponse(sessions.find((item) => item.id === id));
  };

  const result = await runCustomerServiceScheduler({
    apiBase: "https://eztest.cn",
    apiKey: "secret",
    now: NOW,
    fetchImpl,
    logger: () => {},
  });

  assert.equal(result.updated, 2);
  assert.equal(result.skipped, 1);
  assert.deepEqual(
    calls.filter((call) => call.method === "PUT").map((call) => JSON.parse(call.body).config.customer_service),
    [true, false],
  );
});

test("scheduler dry-run reports updates without writing", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    return jsonResponse({ results: [session()] });
  };

  const result = await runCustomerServiceScheduler({
    apiBase: "https://eztest.cn",
    apiKey: "secret",
    now: NOW,
    fetchImpl,
    dryRun: true,
    logger: () => {},
  });

  assert.equal(result.planned, 1);
  assert.equal(result.updated, 0);
  assert.equal(calls.some((call) => call.method === "PUT"), false);
});

test("scheduler continues after one session update fails", async () => {
  const sessions = [
    session({ id: "bad", config: { customer_service: false } }),
    session({ id: "good", config: { customer_service: false } }),
  ];
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith("/tenant/api/session/")) return jsonResponse({ results: sessions });
    if ((options.method || "GET") === "PUT" && String(url).includes("/bad/")) return jsonResponse({ error: "nope" }, 500);
    const id = String(url).match(/session\/([^/]+)\//)?.[1];
    return jsonResponse(sessions.find((item) => item.id === id));
  };

  const result = await runCustomerServiceScheduler({
    apiBase: "https://eztest.cn",
    apiKey: "secret",
    now: NOW,
    fetchImpl,
    logger: () => {},
  });

  assert.equal(result.updated, 1);
  assert.equal(result.failed, 1);
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    },
  };
}
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
node --test server/test_customer_service_scheduler.mjs
```

Expected: FAIL with module not found for `server/customer_service_scheduler.mjs`.

- [ ] **Step 3: Implement minimal scheduler module**

Create `server/customer_service_scheduler.mjs`:

```js
const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeApiBase(value = "https://eztest.cn") {
  return String(value || "https://eztest.cn").replace(/\/+$/, "");
}

export function normalizeTenantSessions(payload) {
  const candidates = [
    payload?.results,
    payload?.data?.results,
    payload?.data?.list,
    payload?.list,
    payload?.data,
    payload,
  ];
  const list = candidates.find((item) => Array.isArray(item)) || [];
  return list
    .map((item) => normalizeTenantSession(item))
    .filter((item) => item.id);
}

export function normalizeTenantSession(item = {}) {
  const id = String(item.id ?? item.session_id ?? item.sessionId ?? "").trim();
  return {
    ...item,
    id,
    start: item.start ?? item.start_time ?? item.startTime,
    end: item.end ?? item.end_time ?? item.endTime,
    config: item.config && typeof item.config === "object" && !Array.isArray(item.config) ? item.config : {},
  };
}

export function parseSessionTime(value) {
  if (value === null || value === undefined || value === "") return NaN;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return parseSessionTime(Number(text));
  const parsed = Date.parse(text.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function decideCustomerServiceAction(session, now = Date.now()) {
  const startMs = parseSessionTime(session?.start);
  const endMs = parseSessionTime(session?.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { action: "skip_missing_time", desiredEnabled: null };
  }
  if (now < startMs - DAY_MS) return { action: "skip_before_window", desiredEnabled: null };
  const currentEnabled = session?.config?.customer_service === true;
  const desiredEnabled = now < endMs;
  if (currentEnabled === desiredEnabled) return { action: "skip_already_correct", desiredEnabled };
  return { action: desiredEnabled ? "enable" : "disable", desiredEnabled };
}

export async function runCustomerServiceScheduler({
  apiBase = "https://eztest.cn",
  apiKey,
  now = Date.now(),
  fetchImpl = fetch,
  dryRun = false,
  logger = console.log,
} = {}) {
  if (!apiKey) throw new Error("YIKAO_API_KEY or tenant API key is required");
  const summary = { total: 0, planned: 0, updated: 0, skipped: 0, failed: 0 };
  const sessions = await listTenantSessions({ apiBase, apiKey, fetchImpl });
  summary.total = sessions.length;

  for (const item of sessions) {
    const decision = decideCustomerServiceAction(item, now);
    if (!["enable", "disable"].includes(decision.action)) {
      summary.skipped += 1;
      logger(`[客服定时] 跳过 ${item.id}: ${decision.action}`);
      continue;
    }
    summary.planned += 1;
    logger(`[客服定时] ${dryRun ? "计划" : "执行"} ${decision.action} ${item.id}`);
    if (dryRun) continue;
    try {
      await updateTenantSessionCustomerService({ apiBase, apiKey, session: item, enabled: decision.desiredEnabled, fetchImpl });
      summary.updated += 1;
    } catch (error) {
      summary.failed += 1;
      logger(`[客服定时] 更新失败 ${item.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return summary;
}

async function listTenantSessions({ apiBase, apiKey, fetchImpl }) {
  const response = await fetchImpl(`${normalizeApiBase(apiBase)}/tenant/api/session/`, {
    headers: tenantHeaders(apiKey),
  });
  const payload = await readJsonResponse(response, "获取场次列表");
  return normalizeTenantSessions(payload);
}

async function updateTenantSessionCustomerService({ apiBase, apiKey, session, enabled, fetchImpl }) {
  const base = normalizeApiBase(apiBase);
  const detailUrl = `${base}/tenant/api/session/${encodeURIComponent(session.id)}/`;
  const detailResponse = await fetchImpl(detailUrl, { headers: tenantHeaders(apiKey) });
  const detail = normalizeTenantSession(await readJsonResponse(detailResponse, "获取场次详情"));
  const payload = {
    ...detail,
    config: {
      ...(detail.config || {}),
      customer_service: enabled,
    },
  };
  const updateResponse = await fetchImpl(detailUrl, {
    method: "PUT",
    headers: tenantHeaders(apiKey, true),
    body: JSON.stringify(payload),
  });
  await readJsonResponse(updateResponse, "更新在线客服");
}

function tenantHeaders(apiKey, json = false) {
  return {
    Authorization: `Key ${apiKey}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function readJsonResponse(response, action) {
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const error = new Error(`${action}失败：${response.status}`);
    error.status = response.status;
    error.detail = payload;
    throw error;
  }
  return payload;
}
```

- [ ] **Step 4: Run the core test to verify GREEN**

Run:

```bash
node --test server/test_customer_service_scheduler.mjs
```

Expected: PASS.

---

### Task 2: CLI Wrapper

**Files:**
- Create: `scripts/customer_service_scheduler.mjs`
- Create: `server/test_customer_service_scheduler_cli.mjs`

- [ ] **Step 1: Write failing CLI tests**

Create `server/test_customer_service_scheduler_cli.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadCustomerServiceSchedulerConfig,
  parseCustomerServiceSchedulerArgs,
} from "../scripts/customer_service_scheduler.mjs";

test("CLI parser recognizes dry-run flag", () => {
  assert.deepEqual(parseCustomerServiceSchedulerArgs(["--dry-run"]), { dryRun: true });
  assert.deepEqual(parseCustomerServiceSchedulerArgs([]), { dryRun: false });
});

test("CLI config loads .env values and runtime settings fallback", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "customer-service-cli-"));
  try {
    await writeFile(path.join(dir, ".env"), "YIKAO_API_BASE=https://env.example\n", "utf8");
    await writeFile(
      path.join(dir, ".easy_exam_runtime_settings.json"),
      JSON.stringify({ login: { tenantApiKey: "runtime-key", apiBase: "https://runtime.example" } }),
      "utf8",
    );
    const config = await loadCustomerServiceSchedulerConfig({
      rootDir: dir,
      runtimeSettingsPath: path.join(dir, ".easy_exam_runtime_settings.json"),
      env: {},
    });
    assert.equal(config.apiBase, "https://env.example");
    assert.equal(config.apiKey, "runtime-key");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run CLI test to verify RED**

Run:

```bash
node --test server/test_customer_service_scheduler_cli.mjs
```

Expected: FAIL because `scripts/customer_service_scheduler.mjs` does not exist.

- [ ] **Step 3: Implement CLI wrapper**

Create `scripts/customer_service_scheduler.mjs`:

```js
#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCustomerServiceScheduler } from "../server/customer_service_scheduler.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(__dirname, "..");

export function parseCustomerServiceSchedulerArgs(argv = []) {
  return {
    dryRun: argv.includes("--dry-run"),
  };
}

export async function loadCustomerServiceSchedulerConfig({
  rootDir = defaultRootDir,
  runtimeSettingsPath = path.join(rootDir, ".easy_exam_runtime", "settings.json"),
  env = process.env,
} = {}) {
  const fileEnv = await readEnvFile(path.join(rootDir, ".env"));
  const mergedEnv = { ...fileEnv, ...env };
  const settings = await readJsonFile(runtimeSettingsPath);
  const login = settings?.login || {};
  return {
    apiBase: mergedEnv.YIKAO_API_BASE || login.apiBase || "https://eztest.cn",
    apiKey: mergedEnv.YIKAO_API_KEY || login.tenantApiKey || "",
  };
}

async function readEnvFile(envPath) {
  try {
    const raw = await fs.readFile(envPath, "utf8");
    const result = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[match[1]] = value;
    }
    return result;
  } catch {
    return {};
  }
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

async function main() {
  const args = parseCustomerServiceSchedulerArgs(process.argv.slice(2));
  const config = await loadCustomerServiceSchedulerConfig();
  const summary = await runCustomerServiceScheduler({
    ...config,
    dryRun: args.dryRun,
    logger: (message) => console.log(message),
  });
  console.log(JSON.stringify({ ok: summary.failed === 0, summary }, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Run CLI test to verify GREEN**

Run:

```bash
node --test server/test_customer_service_scheduler_cli.mjs
```

Expected: PASS.

---

### Task 3: LaunchAgent Template

**Files:**
- Create: `deploy/com.ata.easy-exam-customer-service-scheduler.plist.template`
- Modify: `server/test_launchd_templates.mjs`

- [ ] **Step 1: Add failing LaunchAgent template test**

Append to `server/test_launchd_templates.mjs`:

```js
test("customer service scheduler LaunchAgent runs hourly", () => {
  const plist = fs.readFileSync(path.join(rootDir, "deploy", "com.ata.easy-exam-customer-service-scheduler.plist.template"), "utf8");
  assert.match(plist, /com\.ata\.easy-exam-customer-service-scheduler/);
  assert.match(plist, /customer_service_scheduler\.mjs/);
  assert.match(plist, /<key>StartInterval<\/key>\s*<integer>3600<\/integer>/);
  assert.match(plist, /customer-service-scheduler\.log/);
  assert.match(plist, /customer-service-scheduler\.err\.log/);
});
```

- [ ] **Step 2: Run LaunchAgent test to verify RED**

Run:

```bash
node --test server/test_launchd_templates.mjs
```

Expected: FAIL because the customer-service scheduler plist does not exist.

- [ ] **Step 3: Add LaunchAgent template**

Create `deploy/com.ata.easy-exam-customer-service-scheduler.plist.template`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ata.easy-exam-customer-service-scheduler</string>

  <key>ProgramArguments</key>
  <array>
    <string>/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node</string>
    <string>/Users/ata/Library/Application Support/easy-exam-automation/app/scripts/customer_service_scheduler.mjs</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/Users/ata/Library/Application Support/easy-exam-automation/app</string>

  <key>StartInterval</key>
  <integer>3600</integer>

  <key>StandardOutPath</key>
  <string>/Users/ata/Library/Application Support/easy-exam-automation/runtime/customer-service-scheduler.log</string>

  <key>StandardErrorPath</key>
  <string>/Users/ata/Library/Application Support/easy-exam-automation/runtime/customer-service-scheduler.err.log</string>
</dict>
</plist>
```

- [ ] **Step 4: Run LaunchAgent test to verify GREEN**

Run:

```bash
node --test server/test_launchd_templates.mjs
```

Expected: PASS.

---

### Task 4: Final Verification

**Files:**
- Verify all files changed by Tasks 1-3.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test server/test_customer_service_scheduler.mjs server/test_customer_service_scheduler_cli.mjs server/test_launchd_templates.mjs
```

Expected: PASS.

- [ ] **Step 2: Run dry-run command**

Run:

```bash
node scripts/customer_service_scheduler.mjs --dry-run
```

Expected: Either a JSON summary if API credentials are configured, or a clear missing-key error if local credentials are unavailable in the current environment.

- [ ] **Step 3: Review diff**

Run:

```bash
git diff -- server/customer_service_scheduler.mjs server/test_customer_service_scheduler.mjs scripts/customer_service_scheduler.mjs server/test_customer_service_scheduler_cli.mjs deploy/com.ata.easy-exam-customer-service-scheduler.plist.template server/test_launchd_templates.mjs docs/superpowers/specs/2026-07-02-customer-service-scheduler-design.md docs/superpowers/plans/2026-07-02-customer-service-scheduler.md
```

Expected: Diff only contains the scheduler feature, tests, design, and plan.
