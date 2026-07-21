import { createHash } from "node:crypto";

import { isAdminUser, normalizeEmail } from "./local_auth.mjs";

export const DEFAULT_LOGIN_URL = "https://eztest.org/manager/accounts/login";
export const DEFAULT_TENANT_API_BASE = "https://eztest.cn";

export function defaultLoginSettings() {
  return {
    url: DEFAULT_LOGIN_URL,
    username: "",
    password: "",
    tenantApiKey: "",
  };
}

export function defaultUserSettings() {
  return { users: {} };
}

export function normalizeUserSettings(raw = {}) {
  return {
    users: raw && typeof raw.users === "object" && !Array.isArray(raw.users) ? raw.users : {},
  };
}

export function userSettingsKey(user) {
  return normalizeEmail(user?.email || "");
}

export function sanitizeLoginSettings(login = {}) {
  const defaults = defaultLoginSettings();
  return {
    url: String(login.url || defaults.url).trim(),
    username: String(login.username || "").trim(),
    password: String(login.password || ""),
    tenantApiKey: String(login.tenantApiKey || "").trim(),
  };
}

export function normalizeTenantApiBase(value = DEFAULT_TENANT_API_BASE) {
  return String(value || DEFAULT_TENANT_API_BASE).trim().replace(/\/+$/, "") || DEFAULT_TENANT_API_BASE;
}

export function apiKeyProfileId({ apiBase = DEFAULT_TENANT_API_BASE, tenantApiKey = "" } = {}) {
  const hash = createHash("sha256")
    .update(`${normalizeTenantApiBase(apiBase)}\n${String(tenantApiKey || "").trim()}`)
    .digest("hex")
    .slice(0, 16);
  return `profile_${hash}`;
}

export function apiKeyHint(value = "") {
  const text = String(value || "").trim();
  return text ? `末尾 ${text.slice(-4)}` : "未配置";
}

export function defaultCustomerServiceSchedulerSettings(overrides = {}) {
  return {
    enabled: overrides.enabled !== false,
    intervalMinutes: positiveInteger(overrides.intervalMinutes, 60),
    lastRunAt: String(overrides.lastRunAt || ""),
    lastSummary: overrides.lastSummary || null,
    lastError: String(overrides.lastError || ""),
  };
}

export function normalizeApiKeyProfiles(raw = []) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  return list
    .map((profile) => normalizeApiKeyProfile(profile))
    .filter((profile) => {
      if (!profile || seen.has(profile.id)) return false;
      seen.add(profile.id);
      return true;
    });
}

export function publicApiKeyProfilesForUser({
  user,
  userSettings = defaultUserSettings(),
  legacySettings = {},
} = {}) {
  return publicApiKeyProfiles(apiKeyProfilesForUser({ user, userSettings, legacySettings }));
}

export function apiKeyProfilesForUser({ user, userSettings = defaultUserSettings(), legacySettings = {} } = {}) {
  const key = userSettingsKey(user);
  if (!key) return normalizeApiKeyProfiles(legacySettings.apiKeyProfiles || []);
  return normalizeApiKeyProfiles(userSettings?.users?.[key]?.apiKeyProfiles || []);
}

export function apiKeyProfileCredentialsForUser({
  user,
  userSettings = defaultUserSettings(),
  legacySettings = {},
  profileId = "",
} = {}) {
  const normalizedProfileId = String(profileId || "").trim();
  const profile = apiKeyProfilesForUser({ user, userSettings, legacySettings })
    .find((item) => normalizedProfileId && item.id === normalizedProfileId);
  if (!profile) return null;
  const login = loginSettingsForApiKeyProfile(
    profile,
    currentUserLogin({ user, userSettings, legacySettings }),
  );
  return {
    username: login.username,
    password: login.password,
    tenantApiKey: profile.tenantApiKey,
  };
}

export function updateApiKeyProfileForUser(userSettings, user, profileId, updates = {}) {
  const key = userSettingsKey(user);
  if (!key) throw new Error("请先登录后再更新在线客服定时配置。");
  const nextSettings = normalizeUserSettings(userSettings);
  const existing = nextSettings.users[key] || { userId: key };
  const profiles = normalizeApiKeyProfiles(existing.apiKeyProfiles || []);
  const index = profiles.findIndex((profile) => profile.id === profileId);
  if (index < 0) throw new Error("未找到 API Key 配置。");
  const now = new Date().toISOString();
  const currentProfile = profiles[index];
  const nextAccount = normalizeEmail(
    updates.login?.username || updates.label || currentProfile.login?.username || currentProfile.label || "",
  );
  const duplicateAccount = nextAccount && profiles.some((profile, profileIndex) => (
    profileIndex !== index &&
    normalizeEmail(profile.login?.username || profile.label || "") === nextAccount
  ));
  if (duplicateAccount) throw new Error("该账号邮箱已绑定一个 API Key，请编辑原账号。");
  const nextProfile = {
    ...currentProfile,
    label: updates.label === undefined ? currentProfile.label : String(updates.label || "").trim(),
    remark: updates.remark === undefined ? String(currentProfile.remark || "") : String(updates.remark || "").trim(),
    tenantApiKey: String(updates.tenantApiKey || currentProfile.tenantApiKey || "").trim(),
    keyHint: apiKeyHint(updates.tenantApiKey || currentProfile.tenantApiKey),
    login: updates.login && typeof updates.login === "object"
      ? {
          ...(currentProfile.login || {}),
          ...updates.login,
          username: String(updates.login.username || updates.label || currentProfile.login?.username || currentProfile.label || "").trim(),
          password: updates.login.password === undefined
            ? String(currentProfile.login?.password || "")
            : String(updates.login.password || ""),
        }
      : currentProfile.login,
    current: updates.current === undefined ? currentProfile.current : Boolean(updates.current),
    customerServiceScheduler: defaultCustomerServiceSchedulerSettings({
      ...currentProfile.customerServiceScheduler,
      ...(updates.customerServiceScheduler || {}),
    }),
    updatedAt: now,
  };
  if (nextProfile.current) {
    profiles.forEach((profile) => {
      profile.current = false;
    });
    existing.login = loginSettingsForApiKeyProfile(nextProfile, existing.login);
  }
  profiles[index] = nextProfile;
  nextSettings.users[key] = {
    ...existing,
    userId: key,
    apiKeyProfiles: profiles,
    updatedAt: now,
    createdAt: existing.createdAt || now,
  };
  return nextProfile;
}

export function deleteApiKeyProfileForUser(userSettings, user, profileId) {
  const key = userSettingsKey(user);
  if (!key) throw new Error("请先登录后再删除在线客服定时配置。");
  const nextSettings = normalizeUserSettings(userSettings);
  const existing = nextSettings.users[key] || { userId: key };
  const profiles = normalizeApiKeyProfiles(existing.apiKeyProfiles || []);
  const nextProfiles = profiles.filter((profile) => profile.id !== profileId);
  if (nextProfiles.length === profiles.length) throw new Error("未找到 API Key 配置。");
  if (!nextProfiles.some((profile) => profile.current) && nextProfiles.length) {
    nextProfiles[nextProfiles.length - 1].current = true;
  }
  const current = nextProfiles.find((profile) => profile.current);
  const now = new Date().toISOString();
  nextSettings.users[key] = {
    ...existing,
    userId: key,
    apiKeyProfiles: nextProfiles,
    login: current
      ? loginSettingsForApiKeyProfile(current, existing.login)
      : { ...(existing.login || {}), tenantApiKey: "" },
    updatedAt: now,
    createdAt: existing.createdAt || now,
  };
  return nextProfiles;
}

export function collectCustomerServiceSchedulerTargets({
  userSettings = defaultUserSettings(),
  legacySettings = {},
} = {}) {
  const targets = [];
  const normalized = normalizeUserSettings(userSettings);
  for (const [userId, record] of Object.entries(normalized.users || {})) {
    for (const profile of normalizeApiKeyProfiles(record?.apiKeyProfiles || [])) {
      if (profile.customerServiceScheduler.enabled === false) continue;
      targets.push(profileToSchedulerTarget(profile, userId, record?.login));
    }
  }
  for (const profile of normalizeApiKeyProfiles(legacySettings.apiKeyProfiles || [])) {
    if (profile.customerServiceScheduler.enabled === false) continue;
    targets.push(profileToSchedulerTarget(profile, "local", legacySettings.login));
  }
  return targets;
}

export function recordCustomerServiceSchedulerRun(userSettings, {
  userId,
  profileId,
  summary = null,
  error = "",
  runAt = new Date().toISOString(),
} = {}) {
  const key = normalizeEmail(userId || "");
  if (!key || !profileId) return false;
  const nextSettings = normalizeUserSettings(userSettings);
  const record = nextSettings.users?.[key];
  if (!record) return false;
  const profiles = normalizeApiKeyProfiles(record.apiKeyProfiles || []);
  const index = profiles.findIndex((profile) => profile.id === profileId);
  if (index < 0) return false;
  profiles[index] = {
    ...profiles[index],
    customerServiceScheduler: defaultCustomerServiceSchedulerSettings({
      ...profiles[index].customerServiceScheduler,
      lastRunAt: runAt,
      lastSummary: summary,
      lastError: error,
    }),
    updatedAt: runAt,
  };
  record.apiKeyProfiles = profiles;
  record.updatedAt = runAt;
  return true;
}

export function currentUserLogin({ user, userSettings = defaultUserSettings(), legacySettings = {} } = {}) {
  const key = userSettingsKey(user);
  if (!key) return sanitizeLoginSettings(legacySettings.login || {});

  const scopedLogin = userSettings?.users?.[key]?.login;
  if (scopedLogin) return sanitizeLoginSettings(scopedLogin);

  if (isAdminUser(user)) return sanitizeLoginSettings(legacySettings.login || {});
  return defaultLoginSettings();
}

export function loginForApiKeyProfile({
  user,
  userSettings = defaultUserSettings(),
  legacySettings = {},
  profileId = "",
  profileLabel = "",
} = {}) {
  const login = currentUserLogin({ user, userSettings, legacySettings });
  const profiles = apiKeyProfilesForUser({ user, userSettings, legacySettings });
  const normalizedProfileId = String(profileId || "").trim();
  const normalizedProfileLabel = normalizeEmail(profileLabel || "");
  const profile =
    profiles.find((item) => normalizedProfileId && item.id === normalizedProfileId) ||
    profiles.find((item) => normalizedProfileLabel && normalizeEmail(item.label || "") === normalizedProfileLabel);
  if (!profile) return login;
  return loginSettingsForApiKeyProfile(profile, login);
}

export function saveUserLogin(userSettings, user, login) {
  const key = userSettingsKey(user);
  if (!key) throw new Error("请先登录后再保存易考账号配置。");
  const nextSettings = normalizeUserSettings(userSettings);
  const now = new Date().toISOString();
  const existing = nextSettings.users[key] || {};
  const record = {
    ...existing,
    userId: key,
    login: sanitizeLoginSettings(login),
    updatedAt: now,
    createdAt: existing.createdAt || now,
  };
  if (record.login.tenantApiKey) {
    upsertApiKeyProfileInRecord(record, {
      apiBase: login.apiBase || DEFAULT_TENANT_API_BASE,
      tenantApiKey: record.login.tenantApiKey,
      label: login.profileLabel || record.login.username || record.login.tenantApiKey,
      login: record.login,
    }, { now, current: true });
  }
  nextSettings.users[key] = record;
  return record;
}

export function upsertApiKeyProfileInRecord(record, input = {}, { now = new Date().toISOString(), current = true } = {}) {
  const tenantApiKey = String(input.tenantApiKey || input.apiKey || "").trim();
  if (!tenantApiKey) return null;
  const apiBase = normalizeTenantApiBase(input.apiBase || DEFAULT_TENANT_API_BASE);
  const requestedId = input.id || apiKeyProfileId({ apiBase, tenantApiKey });
  const profiles = normalizeApiKeyProfiles(record.apiKeyProfiles || []);
  const submittedLogin = input.login && typeof input.login === "object" ? input.login : {};
  const submittedAccount = normalizeEmail(submittedLogin.username || input.label || "");
  const idIndex = profiles.findIndex((profile) => profile.id === requestedId);
  const accountIndex = submittedAccount
    ? profiles.findIndex((profile) => normalizeEmail(profile.login?.username || profile.label || "") === submittedAccount)
    : -1;
  const index = idIndex >= 0 ? idIndex : accountIndex;
  const existing = index >= 0 ? profiles[index] : {};
  const id = existing.id || requestedId;
  const fallbackLogin = sanitizeLoginSettings(record.login || {});
  const existingProfileLogin = existing.login && typeof existing.login === "object" ? existing.login : {};
  if (current) {
    profiles.forEach((profile) => {
      profile.current = false;
    });
  }
  const profile = {
    ...existing,
    id,
    apiBase,
    tenantApiKey,
    keyHint: apiKeyHint(tenantApiKey),
    label: String(input.label || existing.label || apiKeyHint(tenantApiKey)).trim(),
    remark: String(input.remark || existing.remark || "").trim(),
    login: {
      url: String(submittedLogin.url || existingProfileLogin.url || fallbackLogin.url || DEFAULT_LOGIN_URL).trim(),
      username: String(submittedLogin.username || existingProfileLogin.username || input.label || existing.label || fallbackLogin.username || "").trim(),
      password: submittedLogin.password !== undefined
        ? String(submittedLogin.password || "")
        : String(existingProfileLogin.password || fallbackLogin.password || ""),
    },
    current: current ? true : Boolean(existing.current),
    customerServiceScheduler: defaultCustomerServiceSchedulerSettings(existing.customerServiceScheduler || {}),
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
  if (index >= 0) profiles[index] = profile;
  else profiles.push(profile);
  record.apiKeyProfiles = profiles;
  return profile;
}

export function publicApiKeyProfiles(profiles = []) {
  return normalizeApiKeyProfiles(profiles).map((profile) => ({
    id: profile.id,
    label: profile.label,
    remark: profile.remark,
    apiBase: profile.apiBase,
    keyHint: profile.keyHint,
    current: profile.current,
    customerServiceScheduler: profile.customerServiceScheduler,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }));
}

function normalizeApiKeyProfile(profile = {}) {
  const tenantApiKey = String(profile.tenantApiKey || profile.apiKey || "").trim();
  if (!tenantApiKey) return null;
  const apiBase = normalizeTenantApiBase(profile.apiBase || DEFAULT_TENANT_API_BASE);
  return {
    id: String(profile.id || apiKeyProfileId({ apiBase, tenantApiKey })),
    label: String(profile.label || profile.name || apiKeyHint(tenantApiKey)).trim(),
    remark: String(profile.remark || "").trim(),
    apiBase,
    tenantApiKey,
    keyHint: apiKeyHint(tenantApiKey),
    login: normalizeProfileLogin(profile.login),
    current: Boolean(profile.current),
    customerServiceScheduler: defaultCustomerServiceSchedulerSettings(profile.customerServiceScheduler || {}),
    createdAt: String(profile.createdAt || ""),
    updatedAt: String(profile.updatedAt || ""),
  };
}

function profileToSchedulerTarget(profile, userId, login = {}) {
  const sanitizedLogin = loginSettingsForApiKeyProfile(profile, login);
  return {
    userId,
    profileId: profile.id,
    label: profile.label,
    apiBase: profile.apiBase,
    apiKey: profile.tenantApiKey,
    keyHint: profile.keyHint,
    login: {
      url: sanitizedLogin.url,
      username: sanitizedLogin.username,
      password: sanitizedLogin.password,
    },
  };
}

function normalizeProfileLogin(login) {
  if (!login || typeof login !== "object" || Array.isArray(login)) return null;
  return {
    url: String(login.url || DEFAULT_LOGIN_URL).trim(),
    username: String(login.username || "").trim(),
    password: String(login.password || ""),
  };
}

function loginSettingsForApiKeyProfile(profile = {}, fallback = {}) {
  const base = sanitizeLoginSettings(fallback || {});
  const profileLogin = normalizeProfileLogin(profile.login) || {};
  return sanitizeLoginSettings({
    ...base,
    url: profileLogin.url || base.url,
    username: profileLogin.username || profile.label || base.username,
    password: profileLogin.password || base.password,
    tenantApiKey: profile.tenantApiKey || base.tenantApiKey,
  });
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
