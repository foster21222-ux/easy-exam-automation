import assert from "node:assert/strict";
import test from "node:test";

import {
  apiKeyProfileCredentialsForUser,
  collectCustomerServiceSchedulerTargets,
  currentUserLogin,
  loginForApiKeyProfile,
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

test("saving a different account preserves previous enabled scheduler profile", () => {
  const userSettings = defaultUserSettings();
  const alice = { email: "alice@example.com", role: "user" };

  saveUserLogin(userSettings, alice, {
    username: "alice-yikao",
    password: "alice-pass",
    tenantApiKey: "old-key-1234",
  });
  saveUserLogin(userSettings, alice, {
    username: "bob-yikao",
    password: "bob-pass",
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

test("saving a new API key for the same account updates its existing profile", () => {
  const userSettings = defaultUserSettings();
  const alice = { email: "alice@example.com", role: "user" };

  saveUserLogin(userSettings, alice, {
    username: "same-account@example.com",
    password: "old-pass",
    tenantApiKey: "old-key-1234",
  });
  const originalProfileId = userSettings.users[userSettingsKey(alice)].apiKeyProfiles[0].id;
  saveUserLogin(userSettings, alice, {
    username: "SAME-ACCOUNT@example.com",
    password: "new-pass",
    tenantApiKey: "new-key-5678",
  });

  const record = userSettings.users[userSettingsKey(alice)];
  assert.equal(record.apiKeyProfiles.length, 1);
  assert.equal(record.apiKeyProfiles[0].id, originalProfileId);
  assert.equal(record.apiKeyProfiles[0].tenantApiKey, "new-key-5678");
  assert.equal(record.apiKeyProfiles[0].login.password, "new-pass");
  assert.equal(record.apiKeyProfiles[0].current, true);
});

test("editing a profile cannot reuse an email already bound to another API key", () => {
  const userSettings = defaultUserSettings();
  const alice = { email: "alice@example.com", role: "user" };
  saveUserLogin(userSettings, alice, { username: "first@example.com", password: "first-pass", tenantApiKey: "first-key" });
  saveUserLogin(userSettings, alice, { username: "second@example.com", password: "second-pass", tenantApiKey: "second-key" });
  const secondProfileId = userSettings.users[userSettingsKey(alice)].apiKeyProfiles[1].id;

  assert.throws(
    () => updateApiKeyProfileForUser(userSettings, alice, secondProfileId, {
      label: "FIRST@example.com",
      login: { username: "FIRST@example.com" },
    }),
    /该账号邮箱已绑定一个 API Key/,
  );
  assert.equal(userSettings.users[userSettingsKey(alice)].apiKeyProfiles.length, 2);
});

test("task login resolves a previously configured API key by profile id", () => {
  const userSettings = defaultUserSettings();
  const alice = { email: "alice@example.com", role: "user" };
  saveUserLogin(userSettings, alice, { username: "old-account", password: "old-pass", tenantApiKey: "old-key-1234" });
  const oldProfileId = userSettings.users[userSettingsKey(alice)].apiKeyProfiles[0].id;
  saveUserLogin(userSettings, alice, { username: "new-account", password: "new-pass", tenantApiKey: "new-key-5678" });

  const login = loginForApiKeyProfile({ user: alice, userSettings, profileId: oldProfileId });

  assert.equal(login.username, "old-account");
  assert.equal(login.password, "old-pass");
  assert.equal(login.tenantApiKey, "old-key-1234");
});

test("setting a profile current switches its complete login credentials", () => {
  const userSettings = defaultUserSettings();
  const alice = { email: "alice@example.com", role: "user" };
  saveUserLogin(userSettings, alice, { username: "old-account", password: "old-pass", tenantApiKey: "old-key" });
  const oldProfileId = userSettings.users[userSettingsKey(alice)].apiKeyProfiles[0].id;
  saveUserLogin(userSettings, alice, { username: "new-account", password: "new-pass", tenantApiKey: "new-key" });

  updateApiKeyProfileForUser(userSettings, alice, oldProfileId, { current: true });

  assert.deepEqual(currentUserLogin({ user: alice, userSettings }), {
    url: "https://eztest.org/manager/accounts/login",
    username: "old-account",
    password: "old-pass",
    tenantApiKey: "old-key",
  });
});

test("editing a saved profile updates only that account credentials", () => {
  const userSettings = defaultUserSettings();
  const alice = { email: "alice@example.com", role: "user" };
  saveUserLogin(userSettings, alice, { username: "first-account", password: "first-pass", tenantApiKey: "first-key" });
  const firstProfileId = userSettings.users[userSettingsKey(alice)].apiKeyProfiles[0].id;
  saveUserLogin(userSettings, alice, { username: "second-account", password: "second-pass", tenantApiKey: "second-key" });

  updateApiKeyProfileForUser(userSettings, alice, firstProfileId, {
    label: "first-account-updated",
    login: { username: "first-account-updated", password: "updated-pass" },
  });

  const targets = collectCustomerServiceSchedulerTargets({ userSettings });
  assert.deepEqual(targets.map((target) => [target.login.username, target.login.password]), [
    ["first-account-updated", "updated-pass"],
    ["second-account", "second-pass"],
  ]);
  assert.equal(currentUserLogin({ user: alice, userSettings }).username, "second-account");
});

test("stores and publicly exposes an account remark without exposing credentials", () => {
  const userSettings = defaultUserSettings();
  const alice = { email: "alice@example.com", role: "user" };
  saveUserLogin(userSettings, alice, { username: "alice-account", password: "secret-pass", tenantApiKey: "secret-key" });
  const profileId = userSettings.users[userSettingsKey(alice)].apiKeyProfiles[0].id;

  updateApiKeyProfileForUser(userSettings, alice, profileId, { remark: "华东项目组" });

  const profile = publicApiKeyProfilesForUser({ user: alice, userSettings })[0];
  assert.equal(profile.remark, "华东项目组");
  assert.equal(JSON.stringify(profile).includes("secret-pass"), false);
  assert.equal(JSON.stringify(profile).includes("secret-key"), false);
});

test("legacy task login resolves a previous API key by its source account", () => {
  const userSettings = defaultUserSettings();
  const alice = { email: "alice@example.com", role: "user" };
  saveUserLogin(userSettings, alice, { username: "old-account", password: "pass", tenantApiKey: "old-key-1234" });
  saveUserLogin(userSettings, alice, { username: "new-account", password: "pass", tenantApiKey: "new-key-5678" });

  const login = loginForApiKeyProfile({ user: alice, userSettings, profileLabel: "old-account" });

  assert.equal(login.username, "old-account");
  assert.equal(login.tenantApiKey, "old-key-1234");
});

test("re-saving an existing API key reuses its profile instead of duplicating it", () => {
  const userSettings = defaultUserSettings();
  const alice = { email: "alice@example.com", role: "user" };

  saveUserLogin(userSettings, alice, { username: "alice", password: "pass", tenantApiKey: "same-key" });
  saveUserLogin(userSettings, alice, { username: "bob", password: "pass", tenantApiKey: "other-key" });
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

test("account edit credentials return secrets only from the current user's profile", () => {
  const userSettings = defaultUserSettings();
  const alice = { email: "alice@example.com", role: "user" };
  const bob = { email: "bob@example.com", role: "user" };
  saveUserLogin(userSettings, alice, {
    username: "alice-yikao",
    password: "alice-pass",
    tenantApiKey: "alice-key",
  });
  saveUserLogin(userSettings, bob, {
    username: "bob-yikao",
    password: "bob-pass",
    tenantApiKey: "bob-key",
  });
  const aliceProfileId = userSettings.users[userSettingsKey(alice)].apiKeyProfiles[0].id;
  const bobProfileId = userSettings.users[userSettingsKey(bob)].apiKeyProfiles[0].id;

  assert.deepEqual(apiKeyProfileCredentialsForUser({
    user: alice,
    userSettings,
    profileId: aliceProfileId,
  }), {
    username: "alice-yikao",
    password: "alice-pass",
    tenantApiKey: "alice-key",
  });
  assert.equal(apiKeyProfileCredentialsForUser({
    user: alice,
    userSettings,
    profileId: bobProfileId,
  }), null);
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

test("scheduler targets use credentials stored with each API key profile", () => {
  const userSettings = defaultUserSettings();
  const alice = { email: "alice@example.com", role: "user" };
  saveUserLogin(userSettings, alice, { username: "first-account", password: "first-pass", tenantApiKey: "first-key" });
  saveUserLogin(userSettings, alice, { username: "second-account", password: "second-pass", tenantApiKey: "second-key" });

  const targets = collectCustomerServiceSchedulerTargets({ userSettings });

  assert.deepEqual(targets.map((target) => [target.login.username, target.login.password, target.apiKey]), [
    ["first-account", "first-pass", "first-key"],
    ["second-account", "second-pass", "second-key"],
  ]);
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
