import assert from "node:assert/strict";
import test from "node:test";

import { matchRoute, menuKeyForRoute } from "../web/router.mjs";
import { isFrontendRoute } from "./frontend_routes.mjs";

const routeCases = [
  ["/projects", "projects", {}],
  ["/projects/project-123", "project-detail", { projectId: "project-123" }],
  ["/login", "login", {}],
  ["/auto-config", "auto-config", {}],
  ["/exams", "exams", {}],
  ["/exams/exam-456", "exam-detail", { examId: "exam-456" }],
  ["/candidate-import", "candidate-import", {}],
  ["/requirements", "requirements", {}],
  ["/requirements/req-001", "requirement-detail", { requestId: "req-001" }],
  ["/users", "users", {}],
  ["/wechat-collector", "wechat-collector", {}],
  ["/system-config", "system-config", {}],
  ["/templates", "templates", {}],
  ["/logs", "logs", {}],
];

test("matches every application route and dynamic parameter", () => {
  for (const [pathname, name, params] of routeCases) {
    const match = matchRoute(pathname);
    assert.equal(match.name, name, pathname);
    assert.deepEqual(match.params, params, pathname);
  }
  assert.equal(matchRoute("/missing"), null);
});

test("maps detail routes to exactly one navigation item", () => {
  assert.equal(menuKeyForRoute(matchRoute("/projects/p1")), "projects");
  assert.equal(menuKeyForRoute(matchRoute("/exams/e1")), "exams");
  assert.equal(menuKeyForRoute(matchRoute("/requirements/r1")), "requirements");
  assert.equal(menuKeyForRoute(matchRoute("/wechat-collector")), "wechat-collector");
  assert.equal(menuKeyForRoute(matchRoute("/system-config")), "system-config");
  assert.equal(menuKeyForRoute(matchRoute("/auto-config")), "auto-config");
});

test("server SPA fallback accepts frontend routes but never API or asset paths", () => {
  for (const [pathname] of routeCases) assert.equal(isFrontendRoute(pathname), true, pathname);
  assert.equal(isFrontendRoute("/"), true);
  assert.equal(isFrontendRoute("/api/tasks"), false);
  assert.equal(isFrontendRoute("/web/router.mjs"), false);
  assert.equal(isFrontendRoute("/artifacts/job/file.png"), false);
  assert.equal(isFrontendRoute("/unknown"), false);
});
