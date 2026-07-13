import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "easy_exam_session";
export const SESSION_MAX_AGE_SECONDS = 31536000;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;

export function buildAuthContext({ env = process.env, localConfig = {} } = {}) {
  const email = String(localConfig.email || env.APP_LOGIN_EMAIL || "").trim();
  const password = String(localConfig.password || env.APP_LOGIN_PASSWORD || "");
  return {
    enabled: Boolean(email && password),
    email,
    password,
    users: Array.isArray(localConfig.users) ? localConfig.users : [],
    sessions: new Map(),
    cookieName: SESSION_COOKIE,
  };
}

export function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashPassword(password, salt = randomBytes(16).toString("base64url")) {
  const hash = pbkdf2Sync(String(password || ""), salt, 120000, 32, "sha256").toString("base64url");
  return { passwordSalt: salt, passwordHash: hash };
}

export async function verifyPasswordHash(password, salt, hash) {
  if (!salt || !hash) return false;
  const computed = hashPassword(password, salt).passwordHash;
  return safeEqual(computed, hash);
}

export async function verifyLogin(auth, email, password) {
  if (!auth?.enabled) return false;
  const normalizedEmail = normalizeEmail(email);
  if (safeEqual(normalizedEmail, normalizeEmail(auth.email)) && safeEqual(String(password || ""), auth.password)) {
    return { email: auth.email, role: "admin" };
  }

  const user = (auth.users || []).find((item) => normalizeEmail(item.email) === normalizedEmail);
  if (!user || user.disabled) return null;
  if (!(await verifyPasswordHash(password, user.passwordSalt, user.passwordHash))) return null;
  return { email: user.email, role: user.role || "user" };
}

export function createSession(auth, user = { email: auth.email, role: "admin" }, now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  auth.sessions.set(token, { user, createdAt: now, expiresAt: now + SESSION_MAX_AGE_MS });
  return { token, user };
}

export function getSessionUser(auth, token, now = Date.now()) {
  if (!auth?.enabled || !token) return null;
  const session = auth.sessions.get(token);
  if (!session) return null;
  if (session.expiresAt && session.expiresAt <= now) {
    auth.sessions.delete(token);
    return null;
  }
  return session.user || null;
}

export function deleteSession(auth, token) {
  if (!auth?.enabled || !token) return false;
  return auth.sessions.delete(token);
}

export function deleteSessionsForEmail(auth, email) {
  const normalizedEmail = normalizeEmail(email);
  for (const [token, session] of auth.sessions.entries()) {
    if (normalizeEmail(session.user?.email) === normalizedEmail) auth.sessions.delete(token);
  }
}

export function serializeSessions(auth, now = Date.now()) {
  if (!auth?.enabled) return [];
  return [...auth.sessions.entries()]
    .filter(([, session]) => !session.expiresAt || session.expiresAt > now)
    .map(([token, session]) => ({
      token,
      user: session.user,
      createdAt: session.createdAt || now,
      expiresAt: session.expiresAt || now + SESSION_MAX_AGE_MS,
    }));
}

export function restoreSessions(auth, sessions = [], now = Date.now()) {
  if (!auth?.enabled) return auth;
  auth.sessions = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const token = String(session?.token || "").trim();
    if (!token || !session?.user) continue;
    const expiresAt = Number(session.expiresAt || 0);
    if (expiresAt && expiresAt <= now) continue;
    auth.sessions.set(token, {
      user: session.user,
      createdAt: Number(session.createdAt || now),
      expiresAt: expiresAt || now + SESSION_MAX_AGE_MS,
    });
  }
  return auth;
}

export function isAdminUser(user) {
  return user?.role === "admin";
}

export function canViewOwner(user, ownerEmail = "") {
  if (!user?.role) return true;
  if (isAdminUser(user)) return true;
  const owner = normalizeEmail(ownerEmail);
  return Boolean(owner) && normalizeEmail(user.email) === owner;
}

export function sanitizeUsers(users = []) {
  return users.map(({ passwordHash, passwordSalt, ...user }) => ({ ...user }));
}

export function upsertLocalUser(auth, { email, password }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error("请输入同事邮箱。");
  if (!String(password || "")) throw new Error("请输入临时密码。");
  if (normalizedEmail === normalizeEmail(auth.email)) throw new Error("管理员账号不需要重复添加。");

  const now = new Date().toISOString();
  const existingIndex = (auth.users || []).findIndex((user) => normalizeEmail(user.email) === normalizedEmail);
  const existing = existingIndex >= 0 ? auth.users[existingIndex] : {};
  const next = {
    ...existing,
    email: normalizedEmail,
    ...hashPassword(password),
    role: "user",
    disabled: false,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
  if (existingIndex >= 0) auth.users[existingIndex] = next;
  else auth.users.push(next);
  return next;
}

export function updateLocalUser(auth, email, patch = {}) {
  const normalizedEmail = normalizeEmail(email);
  const user = (auth.users || []).find((item) => normalizeEmail(item.email) === normalizedEmail);
  if (!user) return null;
  if (patch.disabled !== undefined) user.disabled = Boolean(patch.disabled);
  if (patch.password) Object.assign(user, hashPassword(patch.password));
  user.updatedAt = new Date().toISOString();
  return user;
}

export function deleteLocalUser(auth, email) {
  const normalizedEmail = normalizeEmail(email);
  const before = auth.users.length;
  auth.users = auth.users.filter((user) => normalizeEmail(user.email) !== normalizedEmail);
  return auth.users.length !== before;
}

export function parseCookies(header = "") {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function cookieBase(auth, value, options = "") {
  const encoded = encodeURIComponent(value);
  return `${auth.cookieName || SESSION_COOKIE}=${encoded}; Path=/; HttpOnly; SameSite=Lax${options}`;
}

export function buildLoginCookie(auth, token) {
  return cookieBase(auth, token, `; Max-Age=${SESSION_MAX_AGE_SECONDS}`);
}

export function buildLogoutCookie(auth) {
  return cookieBase(auth, "", "; Max-Age=0");
}

export function shouldAllowWithoutAuth(method = "GET", pathname = "") {
  if (pathname === "/login") return method === "GET";
  if (pathname.startsWith("/web/")) return method === "GET";
  if (pathname === "/api/health") return method === "GET";
  if (pathname === "/api/auth/login") return method === "POST";
  if (pathname === "/api/auth/me") return method === "GET";
  if (pathname === "/api/auth/logout") return method === "POST";
  if (pathname === "/api/fanwei/bridge/submit") return method === "POST" || method === "OPTIONS";
  return false;
}
