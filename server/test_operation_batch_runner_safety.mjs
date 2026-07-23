import assert from "node:assert/strict";
import test from "node:test";

import {
  OPERATION_BATCH_RECONCILIATION_REQUIRED,
  findCreatedBatchFromList,
  openExactOperationBatchCard,
  operationBatchListSnapshot,
  operationBatchListResultFromRows,
  operationBatchTableResponseMatches,
  performOperationBatchTableAction,
  resolveSubmittedOperationBatch,
  runOperationBatchReconciliation,
  runWithOperationBatchContext,
} from "./operation_batch_runner.mjs";

function fakeBatchCardsPage(cards, {
  listCount = 1,
  identityListCount = listCount,
  tableHeaders = [],
  tableRows = [],
} = {}) {
  const events = [];
  let currentUrl = "http://operation/batch/batchList";
  let detailWait;
  const cardLocators = cards.map((card) => ({
    click: async () => {
      events.push(`click:${card.code}`);
      currentUrl = `http://operation/batch/batchDetail?batch_guid=${"a".repeat(32)}`;
      if (detailWait?.predicate(new URL(currentUrl))) detailWait.resolve();
    },
    locator(selector) {
      if (selector === ":scope > div:first-child > div:first-child > span:first-child") {
        return {
          count: async () => card.codeCount ?? 1,
          innerText: async () => card.code,
        };
      }
      if (selector === ".same-batch-title") {
        return {
          count: async () => card.nameCount ?? 1,
          innerText: async () => card.name,
        };
      }
      throw new Error(`unexpected card selector: ${selector}`);
    },
  }));
  return {
    events,
    url: () => currentUrl,
    waitForURL(predicate) {
      events.push("wait:detail");
      return new Promise((resolve) => {
        detailWait = { predicate, resolve };
      });
    },
    waitForFunction: async () => events.push("wait:identity"),
    locator(selector) {
      if (selector === "thead th") {
        return { allInnerTexts: async () => tableHeaders };
      }
      if (selector === "tbody tr") {
        return {
          all: async () => tableRows.map((cells) => ({
            locator: (childSelector) => {
              assert.equal(childSelector, "td");
              return { allInnerTexts: async () => cells };
            },
          })),
        };
      }
      if (selector === ".ant-list") {
        return { count: async () => listCount };
      }
      if (selector === ".ant-list:has(.same-batch-title)") {
        return { count: async () => identityListCount };
      }
      if (selector === ".ant-list:has(.same-batch-title) .ant-list-item") {
        return { all: async () => cardLocators };
      }
      throw new Error(`unexpected selector: ${selector}`);
    },
  };
}

test("batch list snapshot reads the current card layout from dedicated code and name nodes", async () => {
  assert.deepEqual(await operationBatchListSnapshot(fakeBatchCardsPage([
    { code: "EZT260004", name: "目标项目_2026年8月" },
  ], { listCount: 3, identityListCount: 1 })), {
    layout: "cards",
    headers: ["批次代码", "批次名称"],
    rows: [["EZT260004", "目标项目_2026年8月"]],
  });
});

test("batch list snapshot preserves the legacy table layout", async () => {
  assert.deepEqual(await operationBatchListSnapshot(fakeBatchCardsPage([], {
    listCount: 0,
    tableHeaders: ["批次代码", "批次名称"],
    tableRows: [["EZT260004", "目标项目_2026年8月"]],
  })), {
    layout: "table",
    headers: ["批次代码", "批次名称"],
    rows: [["EZT260004", "目标项目_2026年8月"]],
  });
});

test("batch list snapshot blocks ambiguous or malformed card identity", async () => {
  for (const page of [
    fakeBatchCardsPage([{ code: "EZT260004", name: "目标", codeCount: 2 }]),
    fakeBatchCardsPage([{ code: "EZT260004", name: "目标", nameCount: 0 }]),
    fakeBatchCardsPage([{ code: "EZT260004", name: "目标" }], {
      tableHeaders: ["批次代码"],
      tableRows: [["EZT260004"]],
    }),
  ]) {
    await assert.rejects(
      () => operationBatchListSnapshot(page),
      (error) => error?.code === OPERATION_BATCH_RECONCILIATION_REQUIRED,
    );
  }
});

test("table action waits through a delayed card list render", async () => {
  const cardPage = fakeBatchCardsPage([
    { code: "EZT260004", name: "目标批次" },
  ], { listCount: 3 });
  let identityReads = 0;
  const responseUrl = "http://operation/api/batch/list";
  const response = {
    url: () => responseUrl,
    request: () => ({
      resourceType: () => "xhr",
      method: () => "POST",
      url: () => responseUrl,
      postData: () => "",
    }),
    ok: () => true,
    finished: async () => null,
  };
  const page = {
    ...cardPage,
    url: () => "http://operation/batch/batchList",
    locator(selector) {
      if (selector === ".ant-list:has(.same-batch-title)") {
        return { count: async () => (++identityReads <= 12 ? 0 : 1) };
      }
      if (selector === ".ant-table-wrapper .ant-spin-spinning, .ant-table .ant-spin-spinning") {
        return { first: () => ({ waitFor: async () => {} }) };
      }
      return cardPage.locator(selector);
    },
    waitForResponse: async () => response,
    waitForTimeout: async () => {},
  };
  assert.deepEqual(await performOperationBatchTableAction(
    page,
    async () => {},
    { tableStablePollMs: 0 },
    { batchListUrl: "http://operation/batch/batchList" },
  ), [["EZT260004", "目标批次"]]);
});

test("card detail opening clicks only one exact dedicated batch code", async () => {
  const page = fakeBatchCardsPage([
    { code: "EZT260040", name: "相似批次" },
    { code: "EZT260004", name: "目标批次" },
  ]);
  await openExactOperationBatchCard(page, "EZT260004");
  assert.deepEqual(page.events, ["wait:detail", "click:EZT260004", "wait:identity"]);
});

test("card detail opening blocks duplicate exact batch codes before clicking", async () => {
  const page = fakeBatchCardsPage([
    { code: "EZT260004", name: "目标批次一" },
    { code: "EZT260004", name: "目标批次二" },
  ]);
  await assert.rejects(
    () => openExactOperationBatchCard(page, "EZT260004"),
    /批次代码 EZT260004 精确匹配到 2 张卡片/,
  );
  assert.deepEqual(page.events, []);
});

function fakeBatchListPage(pages, {
  advancePage = true,
  initialPageIndex = 0,
  loadingVisible = true,
  malformedPagination = false,
  pageUrl = "http://operation/batch/batchList",
  paginationCount,
  responseUrl = "http://operation/api/batch/list",
} = {}) {
  const events = [];
  let pageIndex = initialPageIndex;
  const response = {
    url: () => responseUrl,
    request: () => ({
      resourceType: () => "xhr",
      method: () => "POST",
      url: () => responseUrl,
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
      if (selector === "thead th") {
        return { allInnerTexts: async () => ["批次代码", "批次名称"] };
      }
      if (selector === ".ant-list") return { count: async () => 0 };
      if (selector === ".ant-list .ant-list-item") return { all: async () => [] };
      if (selector === ".ant-list:has(.same-batch-title)") return { count: async () => 0 };
      if (selector === ".ant-list:has(.same-batch-title) .ant-list-item") return { all: async () => [] };
      if (selector === ".ant-table-wrapper .ant-spin-spinning, .ant-table .ant-spin-spinning") {
        return {
          first: () => ({
            waitFor: async ({ state }) => {
              events.push(`loading:${state}`);
              if (state === "visible" && !loadingVisible) throw new Error("loading spinner was not visible");
            },
          }),
        };
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
      return pageUrl;
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

test("table action handles a response timeout before a slower action completes", async () => {
  const page = {
    url: () => "http://operation/batch/batchList",
    waitForResponse: () => Promise.reject(new Error("response timeout")),
    locator(selector) {
      assert.equal(selector, ".ant-table-wrapper .ant-spin-spinning, .ant-table .ant-spin-spinning");
      return {
        first: () => ({
          waitFor: () => new Promise((resolve) => setTimeout(resolve, 20)),
        }),
      };
    },
  };
  await assert.rejects(
    performOperationBatchTableAction(
      page,
      () => new Promise((resolve) => setTimeout(resolve, 20)),
      {},
      { batchListUrl: "http://operation/batch/batchList" },
    ),
    (error) => error.code === OPERATION_BATCH_RECONCILIATION_REQUIRED
      && error.message === "response timeout",
  );
});

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

test("submitted detail requires the exact batch path on the batch-list origin", async () => {
  const expected = {
    operationBatchCode: "QTT260007",
    batchGuid: "",
    detailUrl: "http://operation/batch/batchList",
    status: "created_unpublished",
  };

  for (const detailUrl of [
    "http://other.example/batch/batchDetail?batch_guid=guid-1",
    "http://operation:8080/batch/batchDetail?batch_guid=guid-1",
    "https://operation/batch/batchDetail?batch_guid=guid-1",
    "http://operation/other/batchDetail?batch_guid=guid-1",
    "http://operation/batch/batchDetail/?batch_guid=guid-1",
  ]) {
    let lookups = 0;
    const result = await resolveSubmittedOperationBatch(fakePageWithCode(detailUrl, "OLD123456"), {
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
    fakePageWithCode("http://operation/batch/batchDetail?batch_guid=guid-1", "QTT260007"),
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
  assert.ok(page.events.indexOf("search:enter") < page.events.indexOf("response:finished"));
  assert.ok(page.events.indexOf("response:finished") < page.events.indexOf("loading:hidden"));
  assert.ok(page.events.filter((event) => event === "rows:1").length >= 2);
});

test("batch search accepts a completed exact response when the loading spinner is too fast to appear", async () => {
  const page = fakeBatchListPage(
    [[["QTT260007", "目标项目_2026年8月"]]],
    { loadingVisible: false },
  );
  const result = await findCreatedBatchFromList(
    page,
    "http://operation/batch/batchList",
    "目标项目_2026年8月",
    { tableStablePollMs: 0 },
  );
  assert.equal(result.operationBatchCode, "QTT260007");
  assert.ok(page.events.includes("response:finished"));
  assert.ok(page.events.includes("loading:hidden"));
});

test("batch lookup rejects redirects outside the configured list origin or path", async () => {
  for (const urls of [
    {
      pageUrl: "http://foreign.example/batch/batchList",
      responseUrl: "http://foreign.example/api/batch/list",
    },
    {
      pageUrl: "http://operation/other/batchList",
      responseUrl: "http://operation/api/batch/list",
    },
  ]) {
    const page = fakeBatchListPage([
      [["OLD123456", "目标项目_2026年8月"]],
    ], urls);

    await assert.rejects(
      () => findCreatedBatchFromList(
        page,
        "http://operation/batch/batchList",
        "目标项目_2026年8月",
        { tableStablePollMs: 0 },
      ),
      (error) => error?.code === OPERATION_BATCH_RECONCILIATION_REQUIRED,
    );
    assert.equal(page.events.includes("search:enter"), false);
  }
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
    response({
      path: "http://foreign.example/api/batch/list",
      postData: JSON.stringify({ batchName: expectedBatchName }),
    }),
    "http://operation/batch/batchList",
    options,
  ), false);
  assert.equal(operationBatchTableResponseMatches(
    response({ path: "/api/telemetry", postData: JSON.stringify({ batchName: expectedBatchName }) }),
    "http://operation/batch/batchList",
    options,
  ), false);
  for (const path of [
    "/api/telemetry/batch/list",
    "/proxy/api/batch/list",
    "/api/batch/list/error",
    "/api/batch/list/v2",
  ]) {
    assert.equal(operationBatchTableResponseMatches(
      response({ path, postData: JSON.stringify({ batchName: expectedBatchName }) }),
      "http://operation/batch/batchList",
      options,
    ), false);
  }
  assert.equal(operationBatchTableResponseMatches(
    response({ postData: JSON.stringify({ label: expectedBatchName }) }),
    "http://operation/batch/batchList",
    options,
  ), false);
  assert.equal(operationBatchTableResponseMatches(
    response({ postData: JSON.stringify({ error: { batchName: expectedBatchName } }) }),
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
  for (const path of [
    "/batch/page",
    "/api/batch/getBatchList",
    "/api/batch/queryBatchList",
    "/batch/batchList",
  ]) {
    assert.equal(operationBatchTableResponseMatches(
      response({ path, postData: JSON.stringify({ batchName: expectedBatchName }) }),
      "http://operation/batch/batchList",
      options,
    ), true);
  }
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
    response({ path: "/api/batch/getBatchList", postData: JSON.stringify({ condition: expectedBatchName }) }),
    "http://operation/batch/batchList",
    options,
  ), true);
  assert.equal(operationBatchTableResponseMatches(
    response({ path: "/api/batch/get_batch_list", postData: JSON.stringify({ condition: expectedBatchName }) }),
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
