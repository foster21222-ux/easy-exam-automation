import assert from "node:assert/strict";
import test from "node:test";

import { createStagedListLoader } from "../web/staged_list_loader.mjs";

const flushBackgroundWork = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("renders initial list before background details finish", async () => {
  const pendingDetail = deferred();
  const renders = [];
  const load = createStagedListLoader({
    loadInitial: async () => ["summary"],
    getDetailItems: (initial) => initial,
    loadDetail: async () => pendingDetail.promise,
    applyInitial: (initial) => renders.push(["initial", initial]),
    applyDetails: (details) => renders.push(["details", details]),
  });

  await load();
  assert.deepEqual(renders, [["initial", ["summary"]]]);

  pendingDetail.resolve("full");
  await flushBackgroundWork();
  assert.deepEqual(renders, [
    ["initial", ["summary"]],
    ["details", ["full"]],
  ]);
});

test("a newer refresh rejects an older detail completion", async () => {
  const firstDetail = deferred();
  let initialCall = 0;
  const renders = [];
  const load = createStagedListLoader({
    loadInitial: async () => [++initialCall],
    getDetailItems: (initial) => initial,
    loadDetail: async (value) => value === 1 ? firstDetail.promise : `full-${value}`,
    applyInitial: (initial) => renders.push(["initial", initial]),
    applyDetails: (details) => renders.push(["details", details]),
  });

  await load();
  await load();
  await flushBackgroundWork();
  firstDetail.resolve("full-1");
  await flushBackgroundWork();

  assert.deepEqual(renders, [
    ["initial", [1]],
    ["initial", [2]],
    ["details", ["full-2"]],
  ]);
});
