import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkOperationConsoleAutomationEnvironment,
  enableOperationConsoleAutomation,
  installOperationConsoleAutomationDeps,
} from "./operation_console_env.mjs";

test("checkOperationConsoleAutomationEnvironment reports only local browser automation prerequisites", async () => {
  const calls = [];
  const status = await checkOperationConsoleAutomationEnvironment({
    env: { OPERATION_CONSOLE_AUTOMATION_ENABLED: "1" },
    cwd: "/tmp/runtime-app",
    resolvePlaywright: () => "/tmp/runtime-app/node_modules/playwright/index.js",
    execFileSyncImpl: (command, args) => {
      calls.push([command, args]);
      return "";
    },
  });

  assert.equal(status.automationEnabled.ok, true);
  assert.equal(status.playwright.ok, true);
  assert.equal(status.chromium.ok, true);
  assert.equal(status.ready, true);
  assert.equal(Object.hasOwn(status, "login"), false);
  assert.equal(Object.hasOwn(status, "network"), false);
  assert.equal(calls.length, 1);
});

test("installOperationConsoleAutomationDeps runs fixed npm and playwright install commands", () => {
  const calls = [];

  installOperationConsoleAutomationDeps({
    cwd: "/tmp/runtime-app",
    execFileSyncImpl: (command, args) => {
      calls.push([command, args]);
      return "";
    },
  });

  assert.deepEqual(calls.map(([command, args]) => [path.basename(command), args]), [
    ["npm", ["install", "--omit=dev"]],
    ["npx", ["playwright", "install", "chromium"]],
  ]);
});

test("enableOperationConsoleAutomation updates env file without dropping existing values", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "easy-exam-env-"));
  const envPath = path.join(dir, ".env");
  fs.writeFileSync(envPath, "EXISTING_FLAG=yes\nOPERATION_CONSOLE_AUTOMATION_ENABLED=0\n", "utf8");

  const result = enableOperationConsoleAutomation({ envPath });

  assert.equal(result.enabled, true);
  assert.equal(fs.readFileSync(envPath, "utf8"), "EXISTING_FLAG=yes\nOPERATION_CONSOLE_AUTOMATION_ENABLED=1\n");
});
