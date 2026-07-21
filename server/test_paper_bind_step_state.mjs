import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { shouldSkipRecentFailedPaperBindCheck } from "./paper_bind_scheduler.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = fs.readFileSync(path.join(rootDir, "server/easy_exam_server.mjs"), "utf8");

test("paper form bind retry does not mark missing form codes as success", () => {
  assert.ok(serverSource.includes('if (bindResult.status === "waiting_manual")'));
  assert.ok(serverSource.includes('updatePaperFormBindState(task.taskId, requirementIndex, "failed"'));
  assert.ok(serverSource.includes("status: 409"));
  assert.ok(serverSource.includes("missingCourseCodes"));
});

test("paper form bind retry checks tenant session detail for manual binding before failing", () => {
  assert.ok(serverSource.includes("detectSessionPaperBindings"));
  assert.ok(serverSource.includes("if (!courses.length)"));
  assert.ok(serverSource.includes('if (manualBindResult.status === "success")'));
  assert.ok(serverSource.includes("detectedManualBinding: true"));
  assert.ok(serverSource.includes("人工绑定回查确认正式场次已有试卷"));
});

test("trial paper bind is a retryable task step", () => {
  assert.ok(serverSource.includes('if (stepKey === "trial_paper_bind")'));
  assert.ok(serverSource.includes("bindDefaultTrialPaperToSession"));
  assert.ok(serverSource.includes('updateTaskStep(taskId, stepKey, "waiting_manual"'));
});

test("paper binding scheduler runs hourly before the formal exam starts", () => {
  assert.ok(serverSource.includes("PAPER_BIND_SCHEDULER_INTERVAL_MS"));
  assert.ok(serverSource.includes("shouldAttemptScheduledPaperBind"));
  assert.ok(serverSource.includes("runScheduledPaperBindingOnce"));
  assert.ok(serverSource.includes("setInterval(runScheduledPaperBindingOnce"));
});

test("paper binding state and execution are isolated by requirement", () => {
  assert.ok(serverSource.includes("function taskRequirementConfig(task = {}, requirementIndex = 0)"));
  assert.ok(serverSource.includes("function taskFormalSession(task = {}, requirementIndex = 0)"));
  assert.ok(serverSource.includes("function paperFormBindState(task = {}, requirementIndex = 0)"));
  assert.ok(serverSource.includes("paperFormBinds[normalizedIndex] = next"));
  assert.ok(serverSource.includes("normalizeCourseRecords(taskRequirementConfig(task, requirementIndex))"));
  assert.ok(serverSource.includes("runPaperFormBindForTask(task, login, { scheduled: true, requirementIndex })"));
});

test("paper binding scheduler skips recently failed automatic checks", () => {
  const now = new Date("2026-07-07T10:20:00Z");
  const state = {
    status: "failed",
    completedAt: "2026-07-07T10:10:00Z",
  };

  assert.equal(shouldSkipRecentFailedPaperBindCheck(state, now), true);
});

test("paper binding scheduler retries failed checks after cooldown", () => {
  const now = new Date("2026-07-07T11:15:00Z");
  const state = {
    status: "failed",
    completedAt: "2026-07-07T10:10:00Z",
  };

  assert.equal(shouldSkipRecentFailedPaperBindCheck(state, now), false);
});

test("paper binding scheduler uses the latest log time when completion time is absent", () => {
  const now = new Date("2026-07-07T10:20:00Z");
  const state = {
    status: "failed",
    logs: [
      { time: "2026-07-07T09:00:00Z", message: "old" },
      { time: "2026-07-07T10:05:00Z", message: "new" },
    ],
  };

  assert.equal(shouldSkipRecentFailedPaperBindCheck(state, now), true);
});

test("paper binding scheduler does not cool down manual pending checks", () => {
  const now = new Date("2026-07-07T10:20:00Z");
  const state = {
    status: "pending",
    completedAt: "2026-07-07T10:10:00Z",
  };

  assert.equal(shouldSkipRecentFailedPaperBindCheck(state, now), false);
});

test("paper binding detail renders bound form codes and manual action", () => {
  assert.ok(serverSource.includes("paperFormBind"));
  const html = fs.readFileSync(path.join(rootDir, "outputs/web_prototype/easy_exam_automation.html"), "utf8");
  assert.ok(html.includes("buildPaperBindFeedback"));
  assert.ok(html.includes("buildCourseBindFeedback"));
  assert.ok(html.includes("已绑定试卷"));
  assert.ok(html.includes("考试科目"));
  assert.ok(html.includes("paper-bind-feedback success"));
  assert.ok(html.includes("course-bind-feedback success"));
  assert.ok(html.includes("paper-bind-label\">试卷名"));
  assert.ok(html.includes("paper-bind-label\">科目编号"));
  assert.equal(html.includes("paper-bind-label\">试卷编号"), false);
  assert.ok(html.includes("course-bind-label\">科目编号"));
  assert.ok(html.includes("data-trigger-step=\"paper_form_bind\""));
});
