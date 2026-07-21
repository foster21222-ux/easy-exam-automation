import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadCustomerServiceSchedulerConfig,
  loadCustomerServiceSchedulerTargets,
  parseCustomerServiceSchedulerArgs,
  persistCustomerServiceSchedulerResults,
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

test("CLI target loader reads enabled profiles from user and local settings", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "customer-service-cli-"));
  try {
    const settingsPath = path.join(dir, "settings.json");
    const userSettingsPath = path.join(dir, "user_settings.json");
    await writeFile(
      settingsPath,
      JSON.stringify({
        apiKeyProfiles: [
          {
            id: "local-profile",
            label: "Local",
            apiBase: "https://local.example",
            tenantApiKey: "local-key",
            customerServiceScheduler: { enabled: true },
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      userSettingsPath,
      JSON.stringify({
        users: {
          "alice@example.com": {
            apiKeyProfiles: [
              {
                id: "alice-profile",
                label: "Alice",
                apiBase: "https://alice.example",
                tenantApiKey: "alice-key",
                customerServiceScheduler: { enabled: true },
              },
              {
                id: "paused-profile",
                label: "Paused",
                apiBase: "https://paused.example",
                tenantApiKey: "paused-key",
                customerServiceScheduler: { enabled: false },
              },
            ],
          },
        },
      }),
      "utf8",
    );

    const targets = await loadCustomerServiceSchedulerTargets({
      runtimeSettingsPath: settingsPath,
      userSettingsPath,
      env: {},
    });

    assert.deepEqual(targets.map((target) => target.apiKey), ["alice-key", "local-key"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI pauses a profile after manager login failure so later runs skip it", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "customer-service-cli-"));
  try {
    const settingsPath = path.join(dir, "settings.json");
    const userSettingsPath = path.join(dir, "user_settings.json");
    await writeFile(settingsPath, "{}", "utf8");
    await writeFile(
      userSettingsPath,
      JSON.stringify({
        users: {
          "alice@example.com": {
            apiKeyProfiles: [{
              id: "alice-profile",
              label: "Alice",
              apiBase: "https://eztest.cn",
              tenantApiKey: "alice-key",
              customerServiceScheduler: { enabled: true },
            }],
          },
        },
      }),
      "utf8",
    );

    await persistCustomerServiceSchedulerResults({
      summary: {
        profiles: [{
          userId: "alice@example.com",
          profileId: "alice-profile",
          total: 2,
          planned: 2,
          failed: 1,
          paused: true,
          error: "登录易考后台失败：400",
        }],
      },
      runtimeSettingsPath: settingsPath,
      userSettingsPath,
    });

    const saved = JSON.parse(await readFile(userSettingsPath, "utf8"));
    const scheduler = saved.users["alice@example.com"].apiKeyProfiles[0].customerServiceScheduler;
    assert.equal(scheduler.enabled, false);
    assert.equal(scheduler.lastError, "登录易考后台失败：400");
    const targets = await loadCustomerServiceSchedulerTargets({
      runtimeSettingsPath: settingsPath,
      userSettingsPath,
      env: {},
    });
    assert.deepEqual(targets, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
