import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = fs.readFileSync(path.join(rootDir, "server/easy_exam_server.mjs"), "utf8");

test("paper form bind retry does not mark missing form codes as success", () => {
  assert.ok(serverSource.includes('if (bindResult.status === "waiting_manual")'));
  assert.ok(serverSource.includes('updatePaperFormBindState(taskId, "failed"'));
  assert.ok(serverSource.includes("missingCourseCodes"));
});

test("trial paper bind is a retryable task step", () => {
  assert.ok(serverSource.includes('if (stepKey === "trial_paper_bind")'));
  assert.ok(serverSource.includes("bindDefaultTrialPaperToSession"));
  assert.ok(serverSource.includes('updateTaskStep(taskId, stepKey, "waiting_manual"'));
});
