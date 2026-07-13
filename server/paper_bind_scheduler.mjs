const DEFAULT_PAPER_BIND_FAILURE_COOLDOWN_MS = 60 * 60 * 1000;

function parseTimeMs(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function latestPaperBindCheckTimeMs(state = {}) {
  const times = [
    parseTimeMs(state.completedAt),
    parseTimeMs(state.startedAt),
    ...(Array.isArray(state.logs) ? state.logs.map((log) => parseTimeMs(log?.time)) : []),
  ];
  return Math.max(0, ...times);
}

function shouldSkipRecentFailedPaperBindCheck(
  state = {},
  now = new Date(),
  cooldownMs = DEFAULT_PAPER_BIND_FAILURE_COOLDOWN_MS,
) {
  if (state.status !== "failed") return false;
  const cooldown = Number(cooldownMs);
  if (!Number.isFinite(cooldown) || cooldown <= 0) return false;
  const lastCheckTime = latestPaperBindCheckTimeMs(state);
  if (!lastCheckTime) return false;
  return now.getTime() - lastCheckTime < cooldown;
}

export {
  DEFAULT_PAPER_BIND_FAILURE_COOLDOWN_MS,
  latestPaperBindCheckTimeMs,
  shouldSkipRecentFailedPaperBindCheck,
};
