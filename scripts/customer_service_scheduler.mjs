#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runCustomerServiceScheduler,
  runCustomerServiceSchedulerForTargets,
} from "../server/customer_service_scheduler.mjs";
import {
  collectCustomerServiceSchedulerTargets,
  normalizeUserSettings,
  recordCustomerServiceSchedulerRun,
} from "../server/user_settings.mjs";

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

export async function loadCustomerServiceSchedulerTargets({
  rootDir = defaultRootDir,
  runtimeSettingsPath = path.join(rootDir, ".easy_exam_runtime", "settings.json"),
  userSettingsPath = path.join(rootDir, ".easy_exam_runtime", "user_settings.json"),
  env = process.env,
} = {}) {
  const settings = await readJsonFile(runtimeSettingsPath);
  const userSettings = normalizeUserSettings(await readJsonFile(userSettingsPath));
  const targets = collectCustomerServiceSchedulerTargets({
    userSettings,
    legacySettings: settings,
  });
  if (targets.length) return targets;

  const config = await loadCustomerServiceSchedulerConfig({ rootDir, runtimeSettingsPath, env });
  return config.apiKey
    ? [
        {
          userId: "legacy",
          profileId: "legacy",
          label: "legacy",
          apiBase: config.apiBase,
          apiKey: config.apiKey,
          keyHint: config.apiKey ? `末尾 ${config.apiKey.slice(-4)}` : "",
        },
      ]
    : [];
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

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function recordLocalCustomerServiceSchedulerRun(settings, {
  profileId,
  summary = null,
  error = "",
  paused = false,
  runAt = new Date().toISOString(),
} = {}) {
  const profiles = Array.isArray(settings.apiKeyProfiles) ? settings.apiKeyProfiles : [];
  const profile = profiles.find((item) => item.id === profileId);
  if (!profile) return false;
  profile.customerServiceScheduler = {
    ...(profile.customerServiceScheduler || {}),
    enabled: paused ? false : profile.customerServiceScheduler?.enabled !== false,
    intervalMinutes: profile.customerServiceScheduler?.intervalMinutes || 60,
    lastRunAt: runAt,
    lastSummary: summary,
    lastError: error,
  };
  profile.updatedAt = runAt;
  return true;
}

export async function persistCustomerServiceSchedulerResults({
  summary,
  runtimeSettingsPath = path.join(defaultRootDir, ".easy_exam_runtime", "settings.json"),
  userSettingsPath = path.join(defaultRootDir, ".easy_exam_runtime", "user_settings.json"),
} = {}) {
  const settings = await readJsonFile(runtimeSettingsPath);
  const userSettings = normalizeUserSettings(await readJsonFile(userSettingsPath));
  const runAt = new Date().toISOString();
  let changedUserSettings = false;
  let changedSettings = false;
  for (const item of summary?.profiles || []) {
    const profileSummary = {
      total: item.total || 0,
      planned: item.planned || 0,
      updated: item.updated || 0,
      skipped: item.skipped || 0,
      failed: item.failed || 0,
    };
    if (item.userId === "local") {
      changedSettings = recordLocalCustomerServiceSchedulerRun(settings, {
        profileId: item.profileId,
        summary: profileSummary,
        error: item.error || "",
        paused: item.paused === true,
        runAt,
      }) || changedSettings;
    } else {
      changedUserSettings = recordCustomerServiceSchedulerRun(userSettings, {
        userId: item.userId,
        profileId: item.profileId,
        summary: profileSummary,
        error: item.error || "",
        runAt,
      }) || changedUserSettings;
      if (item.paused === true) {
        changedUserSettings = pauseUserCustomerServiceScheduler(userSettings, {
          userId: item.userId,
          profileId: item.profileId,
        }) || changedUserSettings;
      }
    }
  }
  if (changedSettings) await writeJsonFile(runtimeSettingsPath, settings);
  if (changedUserSettings) await writeJsonFile(userSettingsPath, userSettings);
}

function pauseUserCustomerServiceScheduler(userSettings, { userId, profileId } = {}) {
  const key = String(userId || "").trim().toLowerCase();
  const profile = userSettings?.users?.[key]?.apiKeyProfiles?.find((item) => item.id === profileId);
  if (!profile) return false;
  profile.customerServiceScheduler = {
    ...(profile.customerServiceScheduler || {}),
    enabled: false,
  };
  return true;
}

async function main() {
  const args = parseCustomerServiceSchedulerArgs(process.argv.slice(2));
  const runtimeSettingsPath = path.join(defaultRootDir, ".easy_exam_runtime", "settings.json");
  const userSettingsPath = path.join(defaultRootDir, ".easy_exam_runtime", "user_settings.json");
  const targets = await loadCustomerServiceSchedulerTargets({ runtimeSettingsPath, userSettingsPath });
  let summary;
  if (targets.length > 1 || targets[0]?.profileId !== "legacy") {
    summary = await runCustomerServiceSchedulerForTargets({
      targets,
      dryRun: args.dryRun,
      logger: (message) => console.log(message),
    });
    if (!args.dryRun) await persistCustomerServiceSchedulerResults({ summary, runtimeSettingsPath, userSettingsPath });
    console.log(JSON.stringify({ ok: summary.failedProfiles === 0, summary }, null, 2));
    if (summary.failedProfiles > 0) process.exitCode = 1;
    return;
  }

  const target = targets[0];
  summary = await runCustomerServiceScheduler({
    apiBase: target?.apiBase,
    apiKey: target?.apiKey,
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
