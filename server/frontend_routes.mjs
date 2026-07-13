const FRONTEND_ROUTE_PATTERNS = [
  /^\/$/,
  /^\/login\/?$/,
  /^\/projects\/?$/,
  /^\/projects\/[^/]+\/?$/,
  /^\/fanwei-test\/?$/,
  /^\/auto-config\/?$/,
  /^\/exams\/?$/,
  /^\/exams\/[^/]+\/?$/,
  /^\/candidate-import\/?$/,
  /^\/requirements\/?$/,
  /^\/requirements\/[^/]+\/?$/,
  /^\/users\/?$/,
  /^\/wechat-collector\/?$/,
  /^\/system-config\/?$/,
  /^\/templates\/?$/,
  /^\/logs\/?$/,
];

export function isFrontendRoute(pathname) {
  return FRONTEND_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

export function webContentType(filePath) {
  if (filePath.endsWith(".mjs") || filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}
