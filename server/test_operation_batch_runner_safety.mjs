import assert from "node:assert/strict";
import test from "node:test";

import {
  OPERATION_BATCH_RECONCILIATION_REQUIRED,
  findCreatedBatchFromList,
  operationBatchListResultFromRows,
  operationBatchTableResponseMatches,
  resolveSubmittedOperationBatch,
  runOperationBatchReconciliation,
  runWithOperationBatchContext,
} from "./operation_batch_runner.mjs";

function fakeBatchListPage(pages, {
  advancePage = true,
  initialPageIndex = 0,
  malformedPagination = false,
  paginationCount,
} = {}) {
  const events = [];
  let pageIndex = initialPageIndex;
  const response = {
    url: () => "http://operation/api/batch/list",
    request: () => ({
      resourceType: () => "xhr",
      method: () => "POST",
      url: () => "http://operation/api/batch/list",
      postData: () => JSON.stringify({ batchName: "目标项目_2026年8月" }),
    }),
    ok: () => true,
    async finished() {
      events.push("response:finished");
    },
  };
  const rowLocator = {
    async all() {
      events.push(`rows:${pageIndex + 1}`);
      return pages[pageIndex].map((cells) => ({
        locator(selector) {
          assert.equal(selector, "td");
          return { allInnerTexts: async () => cells };
        },
      }));
    },
  };
  const next = {
    async count() {
      return malformedPagination ? 0 : 1;
    },
    async getAttribute(name) {
      if (name === "class") {
        return pageIndex + 1 < pages.length
          ? "ant-pagination-next"
          : "ant-pagination-next ant-pagination-disabled";
      }
      if (name === "aria-disabled") return pageIndex + 1 < pages.length ? "false" : "true";
      return null;
    },
    locator(selector) {
      assert.equal(selector, "button, a");
      return {
        first() {
          return {
            async count() { return 1; },
            async click() {
              events.push("next:click");
              if (advancePage) pageIndex += 1;
            },
          };
        },
      };
    },
  };
  const page = {
    events,
    async goto() {
      events.push("goto");
    },
    getByRole(role, { name }) {
      assert.equal(role, "button");
      assert.match(String(name), /创建批次/);
      return {
        waitFor: async () => events.push("create:visible"),
        click: async () => events.push("create:click"),
      };
    },
    locator(selector) {
      if (selector === "input[placeholder*=批次代码], input[placeholder*=批次名称]") {
        return {
          first() {
            return {
              async waitFor() { events.push("search:visible"); },
              async fill() { events.push("search:fill"); },
              async press(key) {
                assert.equal(key, "Enter");
                events.push("search:enter");
              },
            };
          },
        };
      }
      if (selector === "tbody tr") return rowLocator;
      if (selector === ".ant-table-wrapper .ant-spin-spinning, .ant-table .ant-spin-spinning") {
        return { first: () => ({ waitFor: async ({ state }) => events.push(`loading:${state}`) }) };
      }
      if (selector === ".ant-pagination") {
        const count = paginationCount ?? (pages.length > 1 || malformedPagination ? 1 : 0);
        return {
          count: async () => count,
          first: () => ({ count: async () => count }),
        };
      }
      if (selector === ".ant-pagination .ant-pagination-next") return { count: () => next.count(), first: () => next };
      if (selector === ".ant-pagination-next") return { first: () => next };
      if (selector === ".ant-pagination-item-active") {
        return {
          count: async () => pages.length > 1 ? 1 : 0,
          first: () => ({
            getAttribute: async (name) => name === "title" ? String(pageIndex + 1) : null,
            innerText: async () => String(pageIndex + 1),
          }),
        };
      }
      throw new Error(`unexpected selector: ${selector}`);
    },
    waitForResponse(predicate) {
      events.push("response:wait");
      assert.equal(predicate({
        ...response,
        url: () => "http://other.example/api/batch/list",
      }), false);
      assert.equal(predicate({
        ...response,
        request: () => ({ resourceType: () => "document" }),
      }), false);
      assert.equal(predicate(response), true);
      return Promise.resolve(response);
    },
    async waitForTimeout() {},
    url() {
      return "http://operation/batch/batchList";
    },
  };
  return page;
}

function fakePageWithCode(url, code = "OLD123456", batchName = "目标项目_2026年8月") {
  return {
    locator() {
      return { innerText: async () => `${code}\n${batchName}` };
    },
    url() {
      return url;
    },
    async waitForFunction() {},
  };
}

test("submitted batch only trusts a detail page with a batch guid", async () => {
  const expected = {
    operationBatchCode: "QTT260007",
    batchGuid: "",
    detailUrl: "http://operation/batch/batchList",
    status: "created_unpublished",
  };

  for (const url of [
    "http://operation/batch/batchList",
    "http://operation/batch/batchDetail",
  ]) {
    const lookups = [];
    const result = await resolveSubmittedOperationBatch(fakePageWithCode(url), {
      batchListUrl: expected.detailUrl,
      batchName: "目标项目_2026年8月",
      findFromList: async (...args) => {
        lookups.push(args);
        return expected;
      },
      detailCodeWaitMs: 1,
    });

    assert.deepEqual(result, expected);
    assert.deepEqual(lookups, [[expected.detailUrl, "目标项目_2026年8月"]]);
  }
});

test("submitted detail requires the exact batch name and one whole-page batch code", async () => {
  const expected = {
    operationBatchCode: "QTT260007",
    batchGuid: "",
    detailUrl: "http://operation/batch/batchList",
    status: "created_unpublished",
  };
  const detailUrl = "http://operation/batch/batchDetail?batch_guid=guid-1";

  for (const page of [
    fakePageWithCode(detailUrl, "OLD123456", "其他项目_2026年8月"),
    fakePageWithCode(detailUrl, "OLD123456\nQTT260007"),
  ]) {
    let lookups = 0;
    const result = await resolveSubmittedOperationBatch(page, {
      batchListUrl: expected.detailUrl,
      batchName: "目标项目_2026年8月",
      findFromList: async () => {
        lookups += 1;
        return expected;
      },
      detailCodeWaitMs: 1,
    });

    assert.deepEqual(result, expected);
    assert.equal(lookups, 1);
  }

  const direct = await resolveSubmittedOperationBatch(
    fakePageWithCode(detailUrl, "QTT260007"),
    {
      batchListUrl: expected.detailUrl,
      batchName: "目标项目_2026年8月",
      findFromList: async () => { throw new Error("unexpected list lookup"); },
      detailCodeWaitMs: 1,
    },
  );
  assert.equal(direct.operationBatchCode, "QTT260007");
  assert.equal(direct.batchGuid, "guid-1");
});

test("batch rows accept structured cells and tab separated cells", () => {
  const detailUrl = "http://operation/batch/batchList";
  assert.equal(operationBatchListResultFromRows([
    ["QTT260007", "目标项目_2026年8月", "实施中"],
  ], "目标项目_2026年8月", detailUrl).operationBatchCode, "QTT260007");
  assert.equal(operationBatchListResultFromRows([
    "QTT260008\t目标项目_2026年8月\t实施中",
  ], "目标项目_2026年8月", detailUrl).operationBatchCode, "QTT260008");
});

test("batch rows require one exact name cell and one code", () => {
  const detailUrl = "http://operation/batch/batchList";
  assert.throws(
    () => operationBatchListResultFromRows([
      ["QTT260007", "前缀目标项目_2026年8月后缀"],
    ], "目标项目_2026年8月", detailUrl),
    (error) => error?.code === OPERATION_BATCH_RECONCILIATION_REQUIRED,
  );
  assert.throws(
    () => operationBatchListResultFromRows([], "目标项目_2026年8月", detailUrl),
    (error) => error?.code === OPERATION_BATCH_RECONCILIATION_REQUIRED,
  );
  assert.throws(
    () => operationBatchListResultFromRows([
      ["QTT260007", "QTT260008", "目标项目_2026年8月"],
    ], "目标项目_2026年8月", detailUrl),
    (error) => error?.code === OPERATION_BATCH_RECONCILIATION_REQUIRED,
  );
});

test("batch search registers its response wait before Enter and waits for stable rows", async () => {
  const page = fakeBatchListPage([["QTT260007", "目标项目_2026年8月"]].map((row) => [row]));
  const result = await findCreatedBatchFromList(
    page,
    "http://operation/batch/batchList",
    "目标项目_2026年8月",
    { tableStablePollMs: 0 },
  );

  assert.equal(result.operationBatchCode, "QTT260007");
  assert.ok(page.events.indexOf("response:wait") < page.events.indexOf("search:enter"));
  assert.ok(page.events.indexOf("search:enter") < page.events.indexOf("loading:visible"));
  assert.ok(page.events.indexOf("loading:visible") < page.events.indexOf("response:finished"));
  assert.ok(page.events.indexOf("response:finished") < page.events.indexOf("loading:hidden"));
  assert.ok(page.events.filter((event) => event === "rows:1").length >= 2);
});

test("batch search response requires a list endpoint and an exact accepted search field", () => {
  const response = ({ path = "/api/batch/list", method = "POST", postData = "" } = {}) => {
    const url = new URL(path, "http://operation").toString();
    return {
      url: () => url,
      request: () => ({
        resourceType: () => "xhr",
        method: () => method,
        url: () => url,
        postData: () => postData,
      }),
    };
  };
  const expectedBatchName = "目标项目_2026年8月";
  const options = { expectedBatchName };

  assert.equal(operationBatchTableResponseMatches(
    response({ path: "/api/telemetry", postData: JSON.stringify({ batchName: expectedBatchName }) }),
    "http://operation/batch/batchList",
    options,
  ), false);
  assert.equal(operationBatchTableResponseMatches(
    response({ postData: JSON.stringify({ label: expectedBatchName }) }),
    "http://operation/batch/batchList",
    options,
  ), false);
  assert.equal(operationBatchTableResponseMatches(
    response({ postData: JSON.stringify({ batchName: `${expectedBatchName}_旧` }) }),
    "http://operation/batch/batchList",
    options,
  ), false);
  assert.equal(operationBatchTableResponseMatches(
    response({ method: "PUT", postData: JSON.stringify({ batchName: expectedBatchName }) }),
    "http://operation/batch/batchList",
    options,
  ), false);
  assert.equal(operationBatchTableResponseMatches(
    response({ postData: JSON.stringify({ batchName: expectedBatchName }) }),
    "http://operation/batch/batchList",
    options,
  ), true);
  assert.equal(operationBatchTableResponseMatches(
    response({ path: `/api/batch/search?batchName=${encodeURIComponent(expectedBatchName)}`, method: "GET" }),
    "http://operation/batch/batchList",
    options,
  ), true);
  assert.equal(operationBatchTableResponseMatches(
    response({ path: "/api/batch/query", postData: new URLSearchParams({ batch_name: expectedBatchName }).toString() }),
    "http://operation/batch/batchList",
    options,
  ), true);
  assert.equal(operationBatchTableResponseMatches(
    response({ postData: '{"heartbeat":true}' }),
    "http://operation/batch/batchList",
    options,
  ), false);
});

test("batch lookup collects every Ant pagination page before resolving", async () => {
  const page = fakeBatchListPage([
    [["QTT260007", "目标项目_2026年8月"]],
    [["QTT260008", "其他项目_2026年8月"]],
  ]);
  const result = await findCreatedBatchFromList(
    page,
    "http://operation/batch/batchList",
    "目标项目_2026年8月",
    { tableStablePollMs: 0 },
  );

  assert.equal(result.operationBatchCode, "QTT260007");
  assert.equal(page.events.filter((event) => event === "next:click").length, 1);
  assert.ok(page.events.includes("rows:2"));
});

test("batch lookup rejects duplicate or different matching codes across pages", async () => {
  for (const secondCode of ["QTT260007", "QTT260008"]) {
    const page = fakeBatchListPage([
      [["QTT260007", "目标项目_2026年8月"]],
      [[secondCode, "目标项目_2026年8月"]],
    ]);
    await assert.rejects(
      () => findCreatedBatchFromList(
        page,
        "http://operation/batch/batchList",
        "目标项目_2026年8月",
        { tableStablePollMs: 0 },
      ),
      (error) => error?.code === OPERATION_BATCH_RECONCILIATION_REQUIRED,
    );
  }
});

test("batch lookup requires provable pagination completion and a safe page count", async () => {
  await assert.rejects(
    () => findCreatedBatchFromList(
      fakeBatchListPage([
        [["QTT260007", "目标项目_2026年8月"]],
        [["QTT260008", "其他项目_2026年8月"]],
      ]),
      "http://operation/batch/batchList",
      "目标项目_2026年8月",
      { maxBatchListPages: 1, tableStablePollMs: 0 },
    ),
    (error) => error?.code === OPERATION_BATCH_RECONCILIATION_REQUIRED,
  );
  await assert.rejects(
    () => findCreatedBatchFromList(
      fakeBatchListPage([
        [["QTT260007", "目标项目_2026年8月"]],
        [["QTT260008", "其他项目_2026年8月"]],
      ], { malformedPagination: true }),
      "http://operation/batch/batchList",
      "目标项目_2026年8月",
      { tableStablePollMs: 0 },
    ),
    (error) => error?.code === OPERATION_BATCH_RECONCILIATION_REQUIRED,
  );
  await assert.rejects(
    () => findCreatedBatchFromList(
      fakeBatchListPage([
        [["QTT260007", "目标项目_2026年8月"]],
      ], { paginationCount: 2 }),
      "http://operation/batch/batchList",
      "目标项目_2026年8月",
      { tableStablePollMs: 0 },
    ),
    (error) => error?.code === OPERATION_BATCH_RECONCILIATION_REQUIRED,
  );
});

test("batch lookup rejects immediately when the Ant active page does not advance", async () => {
  const page = fakeBatchListPage([
    [["QTT260007", "目标项目_2026年8月"]],
    [["QTT260008", "其他项目_2026年8月"]],
  ], { advancePage: false });
  await assert.rejects(
    () => findCreatedBatchFromList(
      page,
      "http://operation/batch/batchList",
      "目标项目_2026年8月",
      { tableStablePollMs: 0 },
    ),
    (error) => error?.code === OPERATION_BATCH_RECONCILIATION_REQUIRED && /未推进/.test(error.message),
  );
  assert.equal(page.events.filter((event) => event === "next:click").length, 1);
});

test("batch lookup rejects a terminal active page other than page one", async () => {
  const page = fakeBatchListPage([
    [["QTT260008", "其他项目_2026年8月"]],
    [["QTT260007", "目标项目_2026年8月"]],
  ], { initialPageIndex: 1 });
  await assert.rejects(
    () => findCreatedBatchFromList(
      page,
      "http://operation/batch/batchList",
      "目标项目_2026年8月",
      { tableStablePollMs: 0 },
    ),
    (error) => error?.code === OPERATION_BATCH_RECONCILIATION_REQUIRED && /预期页/.test(error.message),
  );
  assert.equal(page.events.filter((event) => event === "next:click").length, 0);
});

test("operation context closes when page acquisition fails", async () => {
  const primary = new Error("pages failed");
  const events = [];
  const context = {
    pages() {
      events.push("pages");
      throw primary;
    },
    async close() {
      events.push("close");
    },
  };

  await assert.rejects(
    () => runWithOperationBatchContext(context, async () => null),
    (error) => error === primary,
  );
  assert.deepEqual(events, ["pages", "close"]);
});

test("operation context closes when new page acquisition fails", async () => {
  const primary = new Error("new page failed");
  const events = [];
  const context = {
    pages() {
      events.push("pages");
      return [];
    },
    async newPage() {
      events.push("newPage");
      throw primary;
    },
    async close() {
      events.push("close");
    },
  };

  await assert.rejects(
    () => runWithOperationBatchContext(context, async () => null),
    (error) => error === primary,
  );
  assert.deepEqual(events, ["pages", "newPage", "close"]);
});

test("operation context close failure never replaces its primary error", async () => {
  const primary = new Error("primary");
  const context = {
    pages: () => [{}],
    async close() {
      throw new Error("close failed");
    },
  };

  await assert.rejects(
    () => runWithOperationBatchContext(context, async () => { throw primary; }),
    (error) => error === primary,
  );
});

test("operation context maps a post-submit close failure to reconciliation required", async () => {
  const context = {
    pages: () => [{}],
    async close() {
      throw new Error("close failed");
    },
  };

  await assert.rejects(
    () => runWithOperationBatchContext(context, async () => ({ operationBatchCode: "QTT260007" }), {
      closeFailureRequiresReconciliation: () => true,
    }),
    (error) => error?.code === OPERATION_BATCH_RECONCILIATION_REQUIRED && /close failed/.test(error.message),
  );
});

test("reconciliation runner queries the list without clicking create and preserves its result on close failure", async () => {
  const page = fakeBatchListPage([[["QTT260007", "目标项目_2026年8月"]]]);
  const context = {
    pages: () => [page],
    async close() {
      page.events.push("close");
      throw new Error("close failed");
    },
  };
  const result = await runOperationBatchReconciliation({
    fields: { batchName: { value: "目标项目_2026年8月" } },
  }, {
    baseUrl: "http://operation",
    launchPersistentContext: async () => context,
    tableStablePollMs: 0,
  });

  assert.equal(result.operationBatchCode, "QTT260007");
  assert.equal(page.events.includes("create:click"), false);
  assert.equal(page.events.at(-1), "close");
});
