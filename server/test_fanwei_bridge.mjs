import assert from "node:assert/strict";
import test from "node:test";

import { createFanweiBridgeStore } from "./fanwei_bridge.mjs";

test("Fanwei bridge tokens are one-time and expire quickly", () => {
  let now = 1000;
  const store = createFanweiBridgeStore({ now: () => now });
  const issued = store.issue({ userEmail: "chenjun@ata.net.cn" });

  assert.ok(issued.token);
  assert.equal(store.consume(issued.token)?.userEmail, "chenjun@ata.net.cn");
  assert.equal(store.consume(issued.token), null);

  const expired = store.issue();
  now += 10 * 60 * 1000 + 1;
  assert.equal(store.consume(expired.token), null);
});

test("Fanwei bridge results can be read once", () => {
  const store = createFanweiBridgeStore();
  const issued = store.issue();

  store.saveResult(issued.token, { uploadId: "upload-1" });

  assert.deepEqual(store.takeResult(issued.token), { uploadId: "upload-1" });
  assert.equal(store.takeResult(issued.token), null);
});
