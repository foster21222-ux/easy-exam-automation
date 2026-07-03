import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatflowPath = new URL("../docs/dify-conversation-requirement-chatflow.yml", import.meta.url);

function readChatflow() {
  return readFileSync(chatflowPath, "utf8");
}

test("Dify chatflow uses a customer-facing reply node", () => {
  const yaml = readChatflow();

  assert.match(yaml, /id: compose_customer_reply/);
  assert.match(yaml, /target: compose_customer_reply/);
  assert.match(yaml, /{{#compose_customer_reply\.text#}}/);
});

test("Dify chatflow answer does not expose internal JSON or HTTP diagnostics", () => {
  const yaml = readChatflow();
  const answerBlock = yaml.match(/    - id: answer[\s\S]*?(?=\n    viewport:)/)?.[0] ?? "";

  assert.match(answerBlock, /id: answer/);
  assert.doesNotMatch(answerBlock, /本轮抽取结果/);
  assert.doesNotMatch(answerBlock, /接口状态/);
  assert.doesNotMatch(answerBlock, /需求中心返回/);
  assert.doesNotMatch(answerBlock, /{{#extract_requirement\.text#}}/);
  assert.doesNotMatch(answerBlock, /{{#upsert_requirement\.(status_code|body)#}}/);
});
