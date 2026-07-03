import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const nodeBin = "/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node";

test("WeChat pipeline smoke CLI verifies draft and change push through a temporary requirement center", () => {
  const output = execFileSync(nodeBin, ["scripts/wechat_pipeline_smoke_test.mjs"], {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 5 * 1024 * 1024,
  });
  const result = JSON.parse(output);

  assert.equal(result.ok, true);
  assert.equal(result.requestId, "wechat-smoke-test");
  assert.equal(result.requirement.latest.requirement.exam_name, "2026 校招笔试");
  assert.equal(result.requirement.changeRequests.length, 1);
  assert.equal(result.requirement.changeRequests[0].status, "pending_internal_review");
});
