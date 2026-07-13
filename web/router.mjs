export const ROUTES = [
  { name: "login", pattern: /^\/login\/?$/, menuKey: "" },
  { name: "projects", pattern: /^\/projects\/?$/, menuKey: "projects" },
  { name: "project-detail", pattern: /^\/projects\/([^/]+)\/?$/, param: "projectId", menuKey: "projects" },
  { name: "fanwei-test", pattern: /^\/fanwei-test\/?$/, menuKey: "projects" },
  { name: "auto-config", pattern: /^\/auto-config\/?$/, menuKey: "auto-config" },
  { name: "exams", pattern: /^\/exams\/?$/, menuKey: "exams" },
  { name: "exam-detail", pattern: /^\/exams\/([^/]+)\/?$/, param: "examId", menuKey: "exams" },
  { name: "candidate-import", pattern: /^\/candidate-import\/?$/, menuKey: "candidate-import" },
  { name: "requirements", pattern: /^\/requirements\/?$/, menuKey: "requirements" },
  { name: "requirement-detail", pattern: /^\/requirements\/([^/]+)\/?$/, param: "requestId", menuKey: "requirements" },
  { name: "users", pattern: /^\/users\/?$/, menuKey: "users" },
  { name: "wechat-collector", pattern: /^\/wechat-collector\/?$/, menuKey: "wechat-collector" },
  { name: "system-config", pattern: /^\/system-config\/?$/, menuKey: "system-config" },
  { name: "templates", pattern: /^\/templates\/?$/, menuKey: "templates" },
  { name: "logs", pattern: /^\/logs\/?$/, menuKey: "logs" },
];

export function matchRoute(pathname) {
  const normalized = pathname || "/";
  for (const route of ROUTES) {
    const match = normalized.match(route.pattern);
    if (!match) continue;
    return {
      name: route.name,
      menuKey: route.menuKey,
      params: route.param ? { [route.param]: decodeURIComponent(match[1]) } : {},
    };
  }
  return null;
}

export function menuKeyForRoute(route) {
  return route?.menuKey || "";
}

export function createRouter({ windowObject = window, onRoute }) {
  async function render() {
    if (windowObject.location.pathname === "/") {
      windowObject.history.replaceState({}, "", "/projects");
    }
    const route = matchRoute(windowObject.location.pathname);
    await onRoute(route || { name: "not-found", menuKey: "", params: {} });
  }

  async function navigate(href, { replace = false } = {}) {
    const url = new URL(href, windowObject.location.origin);
    windowObject.history[replace ? "replaceState" : "pushState"]({}, "", `${url.pathname}${url.search}`);
    await render();
  }

  windowObject.addEventListener("popstate", render);
  return { navigate, render, start: render };
}
