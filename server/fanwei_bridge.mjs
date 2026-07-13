import { randomUUID } from "node:crypto";

const TOKEN_TTL_MS = 10 * 60 * 1000;

export function createFanweiBridgeStore({ now = () => Date.now() } = {}) {
  const tokens = new Map();
  const results = new Map();

  function cleanup() {
    const current = now();
    for (const [token, record] of tokens.entries()) {
      if (record.expiresAt <= current || record.used) tokens.delete(token);
    }
    for (const [token, record] of results.entries()) {
      if (record.expiresAt <= current) results.delete(token);
    }
  }

  function issue({ userEmail = "" } = {}) {
    cleanup();
    const token = randomUUID();
    const record = {
      token,
      userEmail,
      createdAt: now(),
      expiresAt: now() + TOKEN_TTL_MS,
      used: false,
    };
    tokens.set(token, record);
    return record;
  }

  function consume(token) {
    cleanup();
    const record = tokens.get(token);
    if (!record || record.used || record.expiresAt <= now()) return null;
    record.used = true;
    tokens.delete(token);
    return record;
  }

  function saveResult(token, data) {
    cleanup();
    results.set(token, {
      data,
      createdAt: now(),
      expiresAt: now() + TOKEN_TTL_MS,
    });
  }

  function takeResult(token) {
    cleanup();
    const record = results.get(token);
    if (!record) return null;
    results.delete(token);
    return record.data;
  }

  return { issue, consume, saveResult, takeResult, cleanup };
}
