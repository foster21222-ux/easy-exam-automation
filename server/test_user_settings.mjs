import assert from "node:assert/strict";
import test from "node:test";

import {
  collectCustomerServiceSchedulerTargets,
  currentUserLogin,
  defaultUserSettings,
  publicApiKeyProfilesForUser,
  recordCustomerServiceSchedulerRun,
  saveUserLogin,
  updateApiKeyProfileForUser,
  userSettingsKey,
} from "./user_settings.mjs";

const legacySettings = {
  login: {
    url: "https://eztest.org/manager/accounts/login",
    username: "legacy-admin",
    password: "legacy-pass",
    tenantApiKey: "legacy-key",
  },
};

test("stores EasyExam login settings separately for each console user", () => {
  const userSettings = defaultUserSettings();
  const alice = { email: "Alice@Example.com", role: "user" };
  const bob = { email: "bob@example.com", role: "user" };

  saveUserLogin(userSettings, alice, {
    url: "https://eztest.org/manager/accounts/login",
    username: "alice-yikao",
    password: "alice-pass",
    tenantApiKey: "alice-key",
  });
  saveUserLogin(userSettings, bob, {
    url: "https://eztest.org/manager/accounts/login",
    username: "bob-yikao",
    password: "bob-pass",
    tenantApiKey: "bob-key",
  });

  assert.equal(currentUserLogin({ user: alice, userSettings }).username, "alice-yikao");
  assert.equal(currentUserLogin({ user: bob, userSettings }).username, "bob-yikao");
  assert.equal(userSettings.users[userSettingsKey(alice)].login.tenantApiKey, "alice-key");
  assert.equal(userSettings.users[userSettingsKey(bob)].login.tenantApiKey, "bob-key");
});

test("coworkers do not see legacy global EasyExam login settings", () => {
  const userSettings = defaultUserSettings();
  const coworker = { email: "coworker@example.com", role: "user" };

  assert.deepEqual(currentUserLogin({ user: coworker, userSettings, legacySettings }), {
    url: "https://eztest.org/manager/accounts/login",
    username: "",
    password: "",
    tenantApiKey: "",
  });
});

test("admin can fall back to legacy global EasyExam login settings before saving personal settings", () => {
  const userSettings = defaultUserSettings();
  const admin = { email: "admin@example.com", role: "admin" };

  assert.deepEqual(currentUserLogin({ user: admin, userSettings, legacySettings }), legacySettings.login);
});

test("auth-disabled local mode keeps using global EasyExam login settings", () => {
  const userSettings = defaultUserSettings();

  assert.deepEqual(currentUserLogin({ user: { email: "" }, userSettings, legacySettings }), legacySettings.login);
});

test("saving a new API key preserves previous enabled scheduler profile", () => {
  const userSettings = defaultUserSettings();
  const alice = { email: "alice@example.com", role: "user" };

  saveUserLogin(userSettings, alice, {
    username: "alice-yikao",
    password: "alice-pass",
    tenantApiKey: "old-key-1234",
  });
  saveUserLogin(userSettings, alice, {
    username: "alice-yikao",
    password: "alice-pass",
    tenantApiKey: "new-key-5678",
  });

  const record = userSettings.users[userSettingsKey(alice)];
  assert.equal(record.apiKeyProfiles.length, 2);
  assert.equal(record.apiKeyProfiles[0].tenantApiKey, "old-key-1234");
  assert.equal(record.apiKeyProfiles[0].customerServiceScheduler.enabled, true);
  assert.equal(record.apiKeyProfiles[1].tenantApiKey, "new-key-5678");
  assert.equal(record.apiKeyProfiles[1].current, true);
  assert.equal(record.apiKeyProfiles[0].current, false);
  assert.equal(currentUserLogin({ user: alice, userSettings }).tenantApiKey, "new-key-5678");
});

test("re-saving an existing API key reuses its profile instead of duplicating it", () => {
  const userSettings = defaultUserSettings();
  const alice = { email: "alice@example.com", role: "user" };

  saveUserLogin(userSettings, alice, { username: "alice", password: "pass", tenantApiKey: "same-key" });
  saveUserLogin(userSettings, alice, { username: "alice", password: "pass", tenantApiKey: "other-key" });
  saveUserLogin(userSettings, alice, { username: "alice", password: "pass", tenantApiKey: "same-key" });

  const record = userSettings.users[userSettingsKey(alice)];
  assert.equal(record.apiKeyProfiles.length, 2);
  assert.equal(record.apiKeyProfiles.filter((profile) => profile.tenantApiKey === "same-key").length, 1);
  assert.equal(record.apiKeyProfiles.find((profile) => profile.tenantApiKey === "same-key").current, true);
});

test("public API key profiles redact secrets", () => {
  const userSettings = defaultUserSettings();
  const alice = { email: "alice@example.com", role: "user" };
  saveUserLogin(userSettings, alice, { username: "alice", password: "pass", tenantApiKey: "secret-key-9999" });

  const profiles = publicApiKeyProfilesForUser({ user: alice, userSettings });

  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].keyHint, "末尾 9999");
  assert.equal("tenantApiKey" in profiles[0], false);
  assert.equal(JSON.stringify(profiles).includes("secret-key-9999"), false);
});

test("scheduler targets include enabled profiles and skip disabled profiles", () => {
  const userSettings = defaultUserSettings();
  const alice = { email: "alice@example.com", role: "user" };
  const bob = { email: "bob@example.com", role: "user" };
  saveUserLogin(userSettings, alice, { username: "alice", password: "pass", tenantApiKey: "alice-key" });
  saveUserLogin(userSettings, bob, { username: "bob", password: "pass", tenantApiKey: "bob-key" });

  const bobProfileId = userSettings.users[userSettingsKey(bob)].apiKeyProfiles[0].id;
  updateApiKeyProfileForUser(userSettings, bob, bobProfileId, {
    customerServiceScheduler: { enabled: false },
  });

  const targets = collectCustomerServiceSchedulerTargets({ userSettings });

  assert.deepEqual(targets.map((target) => target.apiKey), ["alice-key"]);
  assert.equal(targets[0].userId, "alice@example.com");
});

test("records customer service scheduler run summaries without exposing API keys", () => {
  const userSettings = defaultUserSettings();
  const alice = { email: "alice@example.com", role: "user" };
  saveUserLogin(userSettings, alice, { username: "alice", password: "pass", tenantApiKey: "alice-key-1234" });
  const profileId = userSettings.users[userSettingsKey(alice)].apiKeyProfiles[0].id;

  recordCustomerServiceSchedulerRun(userSettings, {
    userId: "alice@example.com",
    profileId,
    summary: { total: 2, planned: 1, updated: 1, failed: 0 },
    runAt: "2026-07-02T10:00:00.000Z",
  });

  const profile = publicApiKeyProfilesForUser({ user: alice, userSettings })[0];
  assert.equal(profile.customerServiceScheduler.lastRunAt, "2026-07-02T10:00:00.000Z");
  assert.deepEqual(profile.customerServiceScheduler.lastSummary, { total: 2, planned: 1, updated: 1, failed: 0 });
  assert.equal(JSON.stringify(profile).includes("alice-key-1234"), false);
});
