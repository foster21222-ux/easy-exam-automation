import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadCustomerServiceSchedulerConfig,
  loadCustomerServiceSchedulerTargets,
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
