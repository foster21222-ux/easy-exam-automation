import path from "node:path";

import {
  advanceOperationBatchListPage,
  formItemByLabel,
  launchOperationBatchContext,
  openExactOperationBatchCard,
  operationBatchDetailIdentity,
  operationDateTitle,
  operationBatchExactCodeLocation,
  runWithOperationBatchContext,
  searchOperationBatchListPages,
  startOperationBatchListSearch,
} from "./operation_batch_runner.mjs";

const DEFAULT_BASE_URL = "http://172.16.18.198:8020";

function text(value) {
  return String(value ?? "").trim();
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function validDateParts(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year
    && value.getUTCMonth() === month - 1
    && value.getUTCDate() === day;
}

function dateParts(value) {
  const match = text(value).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return validDateParts(...parts) ? parts : null;
}

function dateTimeParts(value) {
  const match = text(value).match(
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return null;
  const parts = match.slice(1).map((part) => Number(part ?? 0));
  const [year, month, day, hour, minute, second] = parts;
  if (!validDateParts(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;
  return parts;
}

function dateString(parts) {
  return parts ? `${parts[0]}-${pad(parts[1])}-${pad(parts[2])}` : "";
}

function dateTimeString(parts) {
  return parts
    ? `${dateString(parts)}T${pad(parts[3])}:${pad(parts[4])}:${pad(parts[5])}`
    : "";
}

function visibleDateTime(value) {
  const parts = dateTimeParts(value);
  return parts
    ? `${dateString(parts)} ${pad(parts[3])}:${pad(parts[4])}`
    : "";
}

function visibleDateValues(value) {
  return [...text(value).matchAll(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g)]
    .map((match) => dateString(dateParts(match[0])))
    .filter(Boolean);
}

function visibleDateTimeValues(value) {
  const source = text(value);
  const matches = [...source.matchAll(
    /\d{4}[/-]\d{1,2}[/-]\d{1,2}[T ]\d{1,2}:\d{2}(?::\d{2})?/g,
  )];
  const values = matches
    .map((match) => visibleDateTime(match[0]))
    .filter(Boolean);
  if (values.length !== 1 || matches.length !== 1) return values;
  const remainder = source.slice(matches[0].index + matches[0][0].length);
  const compactEnd = remainder.match(
    /^\s*(?:~|至|—|–|-)\s*(\d{1,2}:\d{2}(?::\d{2})?)/,
  );
  if (!compactEnd) return values;
  const startParts = dateTimeParts(values[0]);
  const endParts = dateTimeParts(`${dateString(startParts)} ${compactEnd[1]}`);
  const end = visibleDateTime(dateTimeString(endParts));
  return end ? [...values, end] : values;
}

function errorWithCode(message, code, detail = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  Object.assign(error, detail);
  return error;
}

export function operationBatchVisibleOverviewFromRaw(raw = {}) {
  const batchName = text(raw.batchName);
  const examText = text(raw.headerInfo).split(/考试日期[：:]/).at(-1);
  const dates = visibleDateValues(examText);
  if (
    Number(raw.titleCount) !== 1
    || Number(raw.headerInfoCount) !== 1
    || !batchName
    || !text(raw.headerInfo).match(/考试日期[：:]/)
    || dates.length < 1
    || dates.length > 2
  ) {
    throw errorWithCode(
      "运控批次静态概况缺少唯一批次名称或有效考试日期",
      "OPERATION_BATCH_INSPECTION_BLOCKED",
    );
  }
  return {
    batchName,
    examStartDate: dates[0],
    examEndDate: dates[1] || dates[0],
  };
}

export function operationBatchVisibleSchedulesFromRaw(raw = {}) {
  const matching = (raw.tables || []).filter((table) => {
    const headers = (table.headers || []).map(text);
    return ["日程代码", "日程", "考试名称"].every((header) => (
      headers.filter((item) => item === header).length === 1
    ));
  });
  if (matching.length !== 1 || matching[0].hasMore) {
    throw errorWithCode(
      matching[0]?.hasMore
        ? "运控批次考试日程存在未读取的后续分页"
        : `必须找到唯一易考考试日程表，实际 ${matching.length} 个`,
      "OPERATION_BATCH_INSPECTION_BLOCKED",
    );
  }
  const table = matching[0];
  const headers = table.headers.map(text);
  const dateIndex = headers.indexOf("日程");
  const nameIndex = headers.indexOf("考试名称");
  const rows = (table.rows || []).filter((row) => (
    Array.isArray(row)
    && row.length === headers.length
    && !row.every((cell) => !text(cell))
  ));
  return rows.map((row, index) => {
    const values = visibleDateTimeValues(row[dateIndex]);
    const name = text(row[nameIndex]);
    if (values.length !== 2 || !name) {
      throw errorWithCode(
        `运控批次可见日程 ${index + 1} 缺少考试名称或完整起止时间`,
        "OPERATION_BATCH_INSPECTION_BLOCKED",
      );
    }
    return {
      name,
      start: values[0],
      end: values[1],
    };
  });
}

function batchCode(instruction = {}) {
  const code = text(instruction.batch?.code);
  if (!/^[A-Z]{3}\d{6}$/.test(code)) {
    throw errorWithCode("缺少有效的运控批次代码", "OPERATION_BATCH_CODE_REQUIRED");
  }
  return code;
}

function normalizeSnapshot(raw = {}, {
  code = "OPERATION_BATCH_INSPECTION_BLOCKED",
  requireSchedules = false,
} = {}) {
  const batchName = text(raw.batchName);
  const examStartParts = dateParts(raw.examStartDate);
  const examEndParts = dateParts(raw.examEndDate);
  const rawSchedules = Array.isArray(raw.schedules) ? raw.schedules : null;
  if (!batchName || !examStartParts || !examEndParts || !rawSchedules) {
    throw errorWithCode("运营批次受管字段不完整或格式不合法", code);
  }
  if (requireSchedules && !rawSchedules.length) {
    throw errorWithCode("运营批次初始化必须包含至少一条完整日程", code);
  }
  const schedules = rawSchedules.map((schedule, index) => {
    const requirementIndex = Number(schedule?.requirementIndex ?? index);
    const name = text(schedule?.name);
    const startParts = dateTimeParts(schedule?.start);
    const endParts = dateTimeParts(schedule?.end);
    const startValue = startParts ? Date.UTC(
      startParts[0],
      startParts[1] - 1,
      startParts[2],
      startParts[3],
      startParts[4],
      startParts[5],
    ) : Number.NaN;
    const endValue = endParts ? Date.UTC(
      endParts[0],
      endParts[1] - 1,
      endParts[2],
      endParts[3],
      endParts[4],
      endParts[5],
    ) : Number.NaN;
    if (
      requirementIndex !== index
      || !name
      || !startParts
      || !endParts
      || startValue > endValue
    ) {
      throw errorWithCode(`运营批次日程 ${index + 1} 不完整或格式不合法`, code);
    }
    return {
      requirementIndex: index,
      name,
      start: dateTimeString(startParts),
      end: dateTimeString(endParts),
    };
  });
  const examStartDate = dateString(examStartParts);
  const examEndDate = dateString(examEndParts);
  if (examStartDate > examEndDate) {
    throw errorWithCode("运营批次概况考试日期范围不合法", code);
  }
  if (requireSchedules) {
    const scheduleStartDate = [...schedules]
      .sort((left, right) => left.start.localeCompare(right.start))[0].start.slice(0, 10);
    const scheduleEndDate = [...schedules]
      .sort((left, right) => left.end.localeCompare(right.end)).at(-1).end.slice(0, 10);
    if (examStartDate !== scheduleStartDate || examEndDate !== scheduleEndDate) {
      throw errorWithCode("运营批次概况日期与日程范围不一致", code);
    }
  }
  return {
    batchName,
    examStartDate,
    examEndDate,
    schedules,
  };
}

function snapshotsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function batchListUrl(options = {}) {
  const baseUrl = text(
    options.baseUrl
    || process.env.OPERATION_CONSOLE_BASE_URL
    || DEFAULT_BASE_URL,
  );
  return `${baseUrl.replace(/\/$/, "")}/batch/batchList`;
}

export async function openOperationBatchByCode(
  page,
  { batchCode: code, batchListUrl: listUrl, options = {} },
) {
  const searchPages = options.searchBatchListPages || searchOperationBatchListPages;
  const startSearch = options.startBatchListSearch || startOperationBatchListSearch;
  const advancePage = options.advanceBatchListPage || advanceOperationBatchListPage;
  const openCard = options.openExactBatchCard || openExactOperationBatchCard;
  const searchResult = await searchPages(page, listUrl, code, options);
  const location = operationBatchExactCodeLocation(searchResult, code);
  let {
    headers,
    layout,
    rows,
  } = await startSearch(page, listUrl, code, options);
  for (let pageNumber = 1; pageNumber < location.pageNumber; pageNumber += 1) {
    rows = await advancePage(
      page,
      pageNumber,
      rows,
      listUrl,
      options,
    );
    if (!rows) {
      throw errorWithCode(
        `未能重新定位批次代码 ${code} 所在的第 ${location.pageNumber} 页`,
        "OPERATION_BATCH_UPDATE_CONFLICT",
      );
    }
  }
  const reopenedLocation = operationBatchExactCodeLocation({ headers, pages: [rows] }, code);
  if (reopenedLocation.rowNumber !== location.rowNumber) {
    throw errorWithCode(
      `批次代码 ${code} 在重新定位时行顺序发生变化`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }

  if (layout === "cards") {
    await openCard(page, code);
  } else {
    const rowLocators = await page.locator("tbody tr").all();
    const matchingRows = [];
    for (const row of rowLocators) {
      const cells = (await row.locator("td").allInnerTexts()).map(text);
      if (cells[location.codeColumn] === code) matchingRows.push(row);
    }
    if (matchingRows.length !== 1) {
      throw errorWithCode(
        `重新打开详情前，批次代码 ${code} 精确匹配到 ${matchingRows.length} 行`,
        "OPERATION_BATCH_UPDATE_CONFLICT",
      );
    }
    const link = matchingRows[0]
      .locator("td")
      .nth(location.codeColumn)
      .getByRole("link", { name: code, exact: true });
    if (await link.count() !== 1) {
      throw errorWithCode(
        `批次代码 ${code} 单元格缺少唯一详情链接`,
        "OPERATION_BATCH_UPDATE_CONFLICT",
      );
    }
    const detailWait = page.waitForURL(
      (value) => Boolean(operationBatchDetailIdentity(String(value), listUrl)),
      { timeout: 30000 },
    );
    detailWait.catch(() => {});
    await link.click();
    await detailWait;
  }
  if (typeof page.waitForLoadState === "function") {
    await page.waitForLoadState("domcontentloaded");
  }
  const detail = operationBatchDetailIdentity(page.url(), listUrl);
  if (!detail) {
    throw errorWithCode("批次详情地址与批次列表不一致", "OPERATION_BATCH_UPDATE_CONFLICT");
  }
  const titles = page.locator(".header-title");
  if (await titles.count() !== 1) {
    throw errorWithCode(
      `批次详情页身份与批次代码 ${code} 不一致`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  const title = titles.first();
  const codeNodes = title.locator(":scope > span");
  if (await codeNodes.count() !== 1 || text(await codeNodes.innerText()) !== code) {
    throw errorWithCode(
      `批次详情页身份与批次代码 ${code} 不一致`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  return detail.detailUrl;
}

async function managedFormControl(page, label) {
  const item = await formItemByLabel(page, label);
  const controls = item.locator("input:visible,textarea:visible");
  const count = await controls.count();
  if (count !== 1) {
    throw errorWithCode(
      `运控批次字段“${label}”必须有唯一可见输入控件，实际 ${count} 个`,
      "OPERATION_BATCH_INSPECTION_BLOCKED",
    );
  }
  return controls.first();
}

function exactScheduleColumn(headers, candidates, label, code = "OPERATION_BATCH_INSPECTION_BLOCKED") {
  const matches = headers
    .map((header, index) => ({ header: text(header), index }))
    .filter((item) => candidates.includes(item.header));
  if (matches.length !== 1) {
    throw errorWithCode(
      `考试日程表必须有唯一“${label}”列，实际 ${matches.length} 列`,
      code,
    );
  }
  return matches[0].index;
}

async function uniqueControl(locator, label, code = "OPERATION_BATCH_UPDATE_CONFLICT") {
  if (await locator.count() === 0) {
    await locator.waitFor({ state: "visible", timeout: 10000 });
  }
  const count = await locator.count();
  if (count !== 1) {
    throw errorWithCode(
      `${label}必须唯一，实际 ${count} 个`,
      code,
    );
  }
  return locator.first();
}

async function selectVisibleTab(page, name) {
  const tab = await uniqueControl(
    page.getByRole("tab", { name, exact: true }),
    `${name}标签页`,
    "OPERATION_BATCH_INSPECTION_BLOCKED",
  );
  if (text(await tab.getAttribute("aria-selected")) !== "true") {
    await tab.click();
  }
  return tab;
}

function operationEztestScheduleResponseMatches(response) {
  try {
    const request = response.request();
    const pathname = new URL(response.url()).pathname;
    if (
      pathname !== "/api/batch/get_schedule_list"
      || request.method() !== "POST"
    ) {
      return false;
    }
    const body = JSON.parse(request.postData() || "{}");
    return text(body.data_key).toLowerCase() === "eztest";
  } catch {
    return false;
  }
}

export async function openVisibleEztestSchedulePage(page) {
  const examTab = await uniqueControl(
    page.getByRole("tab", { name: "考试", exact: true }),
    "考试标签页",
    "OPERATION_BATCH_INSPECTION_BLOCKED",
  );
  const examSelected = text(await examTab.getAttribute("aria-selected")) === "true";
  let responsePromise;
  if (!examSelected && typeof page.waitForResponse === "function") {
    responsePromise = page.waitForResponse(
      operationEztestScheduleResponseMatches,
      { timeout: 30000 },
    );
    responsePromise.catch(() => {});
  }
  if (!examSelected) await examTab.click();
  const eztestTab = await uniqueControl(
    page.getByRole("tab", { name: "易考", exact: true }),
    "易考标签页",
    "OPERATION_BATCH_INSPECTION_BLOCKED",
  );
  const eztestSelected = text(await eztestTab.getAttribute("aria-selected")) === "true";
  if (!responsePromise && !eztestSelected && typeof page.waitForResponse === "function") {
    responsePromise = page.waitForResponse(
      operationEztestScheduleResponseMatches,
      { timeout: 30000 },
    );
    responsePromise.catch(() => {});
  }
  if (!eztestSelected) await eztestTab.click();
  if (responsePromise) {
    const response = await responsePromise;
    await response.finished();
    const payload = await response.json().catch(() => null);
    if (!response.ok() || Number(payload?.code) !== 10) {
      throw errorWithCode(
        `易考考试日程读取失败：HTTP ${response.status?.() || "?"}，code ${payload?.code ?? "?"}`,
        "OPERATION_BATCH_INSPECTION_BLOCKED",
      );
    }
  }
  await visibleSection(page, "考试日程", "OPERATION_BATCH_INSPECTION_BLOCKED");
}

async function visibleSection(page, title, code = "OPERATION_BATCH_UPDATE_CONFLICT") {
  const exactTitle = page.getByText(title, { exact: true });
  if (await exactTitle.count() === 0) {
    await exactTitle.waitFor({ state: "visible", timeout: 10000 });
  }
  return uniqueControl(
    page.locator(".ant-collapse-item:visible").filter({ has: exactTitle }),
    `${title}区块`,
    code,
  );
}

async function clickSectionEdit(page, title) {
  const section = await visibleSection(page, title);
  await (await uniqueControl(
    section.locator(".anticon-edit:visible"),
    `${title}编辑按钮`,
  )).click();
}

async function visibleModal(page, title) {
  const titleNode = page.getByText(title, { exact: true });
  if (await titleNode.count() === 0) {
    await titleNode.waitFor({ state: "visible", timeout: 10000 });
  }
  return uniqueControl(
    page.locator(".ant-modal:visible").filter({ has: titleNode }),
    `${title}弹窗`,
  );
}

export async function fillOperationBatchOverviewDateRange(page, start, end) {
  const modal = await visibleModal(page, "基本信息");
  const dateControl = await uniqueControl(
    modal.locator("#exam_datetime"),
    "考试日期控件",
  );
  await dateControl.click();
  for (const [label, value] of [["开始日期", start], ["结束日期", end]]) {
    const title = operationDateTitle(value);
    const cell = await uniqueControl(
      page.locator(
        `td[title="${title}"]:not(.ant-calendar-last-month-cell):not(.ant-calendar-next-month-btn-day):visible .ant-calendar-date`,
      ),
      `${label}日期单元格`,
    );
    await cell.click();
  }
  const picker = page.locator(".ant-calendar-picker-container:visible");
  if (await picker.count()) {
    await picker.first().waitFor({ state: "hidden", timeout: 10000 });
  }
  const startInput = await uniqueControl(
    dateControl.locator('input[placeholder="开始日期"]'),
    "开始日期输入框",
  );
  const endInput = await uniqueControl(
    dateControl.locator('input[placeholder="结束日期"]'),
    "结束日期输入框",
  );
  const actualStart = text(await startInput.inputValue());
  const actualEnd = text(await endInput.inputValue());
  if (actualStart !== text(start) || actualEnd !== text(end)) {
    throw errorWithCode(
      `考试日期范围回显不一致：${actualStart} ~ ${actualEnd}`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
}

async function editScheduleTable(page) {
  const modal = await visibleModal(page, "易考——考试日程");
  const matches = [];
  for (const table of await modal.locator("table:visible").all()) {
    const headers = (await table.locator("thead th").allInnerTexts()).map(text);
    try {
      matches.push({
        table,
        columns: {
          scene: exactScheduleColumn(
            headers,
            ["场次"],
            "场次",
            "OPERATION_BATCH_UPDATE_CONFLICT",
          ),
          code: exactScheduleColumn(
            headers,
            ["日程代码"],
            "日程代码",
            "OPERATION_BATCH_UPDATE_CONFLICT",
          ),
          date: exactScheduleColumn(
            headers,
            ["日程"],
            "日程",
            "OPERATION_BATCH_UPDATE_CONFLICT",
          ),
          name: exactScheduleColumn(
            headers,
            ["考试名称"],
            "考试名称",
            "OPERATION_BATCH_UPDATE_CONFLICT",
          ),
        },
      });
    } catch {}
  }
  if (matches.length !== 1) {
    throw errorWithCode(
      `必须找到唯一易考日程编辑表，实际 ${matches.length} 个`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  return matches[0];
}

async function visibleScheduleRows(table) {
  const rows = await table.locator("tbody tr").all();
  const visible = [];
  for (const row of rows) {
    if (
      (typeof row.isVisible !== "function" || await row.isVisible())
      && await row.locator("td").count() > 1
    ) {
      visible.push(row);
    }
  }
  return visible;
}

async function fillSingleScheduleCell(row, column, value, label) {
  const inputs = row.locator("td").nth(column).locator("input:visible,textarea:visible");
  const count = await inputs.count();
  if (count !== 1) {
    throw errorWithCode(
      `${label}单元格必须有唯一输入控件，实际 ${count} 个`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  await inputs.first().fill(text(value));
}

export async function fillRangeInputs(
  page,
  container,
  startPlaceholder,
  endPlaceholder,
  start,
  end,
) {
  const startInput = await uniqueControl(
    container.locator(`input[placeholder="${startPlaceholder}"]:visible`),
    `${startPlaceholder}输入框`,
  );
  const endInput = await uniqueControl(
    container.locator(`input[placeholder="${endPlaceholder}"]:visible`),
    `${endPlaceholder}输入框`,
  );
  const startReadonly = await startInput.getAttribute("readonly") !== null;
  const endReadonly = await endInput.getAttribute("readonly") !== null;
  if (startReadonly !== endReadonly) {
    throw errorWithCode(
      `${startPlaceholder}与${endPlaceholder}输入状态不一致`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  if (startReadonly) {
    await startInput.click();
    const picker = await uniqueControl(
      page.locator(".ant-calendar-picker-container:visible"),
      "日期范围选择器",
    );
    const editors = picker.locator(".ant-calendar-input:visible");
    if (await editors.count() !== 2) {
      throw errorWithCode(
        `日期范围选择器必须有两个可编辑输入框，实际 ${await editors.count()} 个`,
        "OPERATION_BATCH_UPDATE_CONFLICT",
      );
    }
    await editors.nth(0).fill(text(start));
    await editors.nth(0).press("Tab");
    await editors.nth(1).fill(text(end));
    await editors.nth(1).press("Tab");
    await (await uniqueControl(
      picker.locator(".ant-calendar-ok-btn:visible"),
      "日期范围确定控件",
    )).click();
    const actualStart = text(await startInput.inputValue());
    const actualEnd = text(await endInput.inputValue());
    if (actualStart !== text(start) || actualEnd !== text(end)) {
      throw errorWithCode(
        `日期范围回显不一致：${actualStart} ~ ${actualEnd}`,
        "OPERATION_BATCH_UPDATE_CONFLICT",
      );
    }
    return;
  }
  await startInput.fill(text(start));
  await startInput.press("Tab");
  await endInput.fill(text(end));
  await endInput.press("Enter");
}

async function writeVisibleScheduleFields(
  page,
  requirementIndex,
  schedule,
  changed,
  { appended = false } = {},
) {
  const { table, columns } = await editScheduleTable(page);
  const rows = await visibleScheduleRows(table);
  const row = rows[requirementIndex];
  if (!row) {
    throw errorWithCode(
      `未找到按可见顺序排列的日程 ${requirementIndex + 1}`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  if (appended) {
    await fillSingleScheduleCell(row, columns.scene, requirementIndex + 1, "场次");
    await fillSingleScheduleCell(row, columns.code, requirementIndex + 1, "日程代码");
  }
  if (appended || changed.has("name")) {
    await fillSingleScheduleCell(row, columns.name, schedule.name, "考试名称");
  }
  if (appended || changed.has("start") || changed.has("end")) {
    await fillRangeInputs(
      page,
      row.locator("td").nth(columns.date),
      "考试开始时间",
      "考试结束时间",
      visibleDateTime(schedule.start),
      visibleDateTime(schedule.end),
    );
  }
}

async function uniqueButton(root, name, errorLabel) {
  const button = root.getByRole("button", { name });
  const count = await button.count();
  if (count !== 1) {
    throw errorWithCode(
      `${errorLabel}按钮必须唯一，实际 ${count} 个`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  return button;
}

export async function visibleButtonByExactText(root, exactText, errorLabel) {
  const escaped = text(exactText).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const button = root
    .locator("button:visible")
    .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`) });
  const count = await button.count();
  if (count !== 1) {
    throw errorWithCode(
      `${errorLabel}按钮必须唯一，实际 ${count} 个`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  return button.first();
}

const visiblePageAdapter = {
  openBatchByCode: openOperationBatchByCode,
  async readOverview(page) {
    const raw = await page.evaluate(() => {
      const visible = (node) => Boolean(
        node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length),
      );
      const titles = [...document.querySelectorAll(".header-title")].filter(visible);
      const infos = [...document.querySelectorAll(".header-info")].filter(visible);
      return {
        titleCount: titles.length,
        headerInfoCount: infos.length,
        batchName: titles[0]?.querySelector(":scope > label")?.textContent || "",
        headerInfo: infos[0]?.innerText || "",
      };
    });
    return operationBatchVisibleOverviewFromRaw(raw);
  },
  async readSchedules(page) {
    await openVisibleEztestSchedulePage(page);
    const raw = await page.evaluate(() => {
      const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
      const visible = (node) => Boolean(
        node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length),
      );
      return {
        tables: [...document.querySelectorAll("table")].filter(visible).map((table) => {
          const panel = table.closest(".ant-collapse-item") || table.parentElement;
          const next = panel?.querySelector(".ant-pagination-next");
          return {
            headers: [...table.querySelectorAll("thead th")].map((cell) => clean(cell.textContent)),
            rows: [...table.querySelectorAll("tbody tr")].filter(visible).map((row) => (
              [...row.querySelectorAll("td")].map((cell) => clean(cell.textContent))
            )),
            hasMore: Boolean(
              next
              && visible(next)
              && !next.classList.contains("ant-pagination-disabled")
              && next.getAttribute("aria-disabled") !== "true"
            ),
          };
        }),
      };
    });
    return operationBatchVisibleSchedulesFromRaw(raw);
  },
  async beginOverviewEdit(page) {
    await selectVisibleTab(page, "概况");
    await clickSectionEdit(page, "基本信息");
    await visibleModal(page, "基本信息");
  },
  async writeOverviewFields(page, desired, changed) {
    if (changed.has("batchName")) {
      await (await managedFormControl(page, "批次名称")).fill(desired.batchName);
    }
    if (changed.has("examStartDate") || changed.has("examEndDate")) {
      await fillOperationBatchOverviewDateRange(
        page,
        desired.examStartDate,
        desired.examEndDate,
      );
    }
  },
  async saveOverview(page) {
    const modal = await visibleModal(page, "基本信息");
    await (await uniqueButton(modal, /^确\s*定$/, "基本信息确定")).click();
    await modal.waitFor({ state: "hidden", timeout: 10000 });
  },
  async beginScheduleEdit(page) {
    await openVisibleEztestSchedulePage(page);
    await clickSectionEdit(page, "考试日程");
    await visibleModal(page, "易考——考试日程");
  },
  async appendSchedule(page) {
    const modal = await visibleModal(page, "易考——考试日程");
    const { table } = await editScheduleTable(page);
    const before = (await visibleScheduleRows(table)).length;
    await (await visibleButtonByExactText(modal, "新增", "新增日程")).click();
    const after = (await visibleScheduleRows(table)).length;
    if (after !== before + 1) {
      throw errorWithCode(
        `新增日程后可见行数未增加：${before} → ${after}`,
        "OPERATION_BATCH_UPDATE_CONFLICT",
      );
    }
  },
  writeScheduleFields: writeVisibleScheduleFields,
  async saveSchedules(page) {
    const modal = await visibleModal(page, "易考——考试日程");
    await (await uniqueButton(modal, /^确\s*定$/, "易考考试日程确定")).click();
    await modal.waitFor({ state: "hidden", timeout: 10000 });
  },
};

function adapter(options = {}) {
  return options.adapter || visiblePageAdapter;
}

async function readManagedSnapshot(page, pageAdapter) {
  const overview = await pageAdapter.readOverview(page);
  const schedules = await pageAdapter.readSchedules(page);
  return normalizeSnapshot({
    batchName: overview?.batchName,
    examStartDate: overview?.examStartDate,
    examEndDate: overview?.examEndDate,
    schedules: schedules.map((schedule, requirementIndex) => ({
      requirementIndex,
      name: schedule?.name,
      start: schedule?.start,
      end: schedule?.end,
    })),
  });
}

async function inspectOnPage(page, instruction, options = {}) {
  const code = batchCode(instruction);
  const pageAdapter = adapter(options);
  const listUrl = batchListUrl(options);
  const detailUrl = await pageAdapter.openBatchByCode(page, {
    batchCode: code,
    batchListUrl: listUrl,
    options,
  });
  return {
    snapshot: await readManagedSnapshot(page, pageAdapter),
    detailUrl: text(detailUrl),
    pageAdapter,
    listUrl,
  };
}

async function withPage(options, operation) {
  if (options.page) return operation(options.page);
  const userDataDir = text(
    options.userDataDir
    || process.env.OPERATION_CONSOLE_USER_DATA_DIR
    || path.join(process.cwd(), ".easy_exam_runtime", "operation-console-profile"),
  );
  const context = options.context
    || await launchOperationBatchContext(userDataDir, false, options);
  return runWithOperationBatchContext(context, operation);
}

function completeDesiredSnapshot(instruction, initialization = false) {
  try {
    return normalizeSnapshot(instruction?.desiredSnapshot, {
      code: initialization
        ? "OPERATION_BATCH_INITIALIZATION_INCOMPLETE"
        : "OPERATION_BATCH_DESIRED_SNAPSHOT_INVALID",
      requireSchedules: true,
    });
  } catch (error) {
    if (initialization && error?.code !== "OPERATION_BATCH_INITIALIZATION_INCOMPLETE") {
      error.code = "OPERATION_BATCH_INITIALIZATION_INCOMPLETE";
    }
    throw error;
  }
}

function invalidChanges(message) {
  throw errorWithCode(message, "OPERATION_BATCH_CHANGES_INVALID");
}

function assertExactChange(change, {
  before,
  after,
  requirementIndex,
}) {
  if (
    !Object.hasOwn(change, "before")
    || !Object.hasOwn(change, "after")
    || change.before !== before
    || change.after !== after
    || (
      requirementIndex !== undefined
      && change.requirementIndex !== requirementIndex
    )
  ) {
    invalidChanges(`运营批次修改声明与当前或期望快照不一致：${change.path}`);
  }
}

function validatedManagedFields(changes, current, desired) {
  if (!Array.isArray(changes)) {
    invalidChanges("运营批次修改清单格式不合法");
  }
  const changesByPath = new Map();
  for (const change of changes) {
    const changePath = typeof change?.path === "string" ? change.path : "";
    if (!changePath || changesByPath.has(changePath)) {
      invalidChanges(`运营批次修改清单包含空路径或重复路径：${changePath}`);
    }
    changesByPath.set(changePath, change);
  }

  const fields = {
    overview: new Set(),
    schedules: new Map(),
    appended: new Set(),
  };

  for (const [field] of overviewFields) {
    const change = changesByPath.get(field);
    if (current[field] === desired[field]) {
      if (change) invalidChanges(`运营批次修改清单包含未变化字段：${field}`);
    } else {
      if (!change) invalidChanges(`运营批次修改清单缺少字段：${field}`);
      assertExactChange(change, {
        before: current[field],
        after: desired[field],
      });
      fields.overview.add(field);
      changesByPath.delete(field);
    }
  }

  for (let index = 0; index < current.schedules.length; index += 1) {
    const wholePath = `schedules[${index}]`;
    if (changesByPath.has(wholePath)) {
      invalidChanges(`已有运营批次日程不接受整行修改声明：${wholePath}`);
    }
    const changed = new Set();
    for (const [field] of scheduleFields) {
      const changePath = `${wholePath}.${field}`;
      const change = changesByPath.get(changePath);
      if (current.schedules[index][field] === desired.schedules[index][field]) {
        if (change) invalidChanges(`运营批次修改清单包含未变化字段：${changePath}`);
      } else {
        if (!change) invalidChanges(`运营批次修改清单缺少字段：${changePath}`);
        assertExactChange(change, {
          before: current.schedules[index][field],
          after: desired.schedules[index][field],
          requirementIndex: index,
        });
        changed.add(field);
        changesByPath.delete(changePath);
      }
    }
    if (changed.size) fields.schedules.set(index, changed);
  }

  for (let index = current.schedules.length; index < desired.schedules.length; index += 1) {
    const wholePath = `schedules[${index}]`;
    const wholeChange = changesByPath.get(wholePath);
    const fieldChanges = new Map(scheduleFields.map(([field]) => [
      field,
      changesByPath.get(`${wholePath}.${field}`),
    ]));
    const fieldCount = [...fieldChanges.values()].filter(Boolean).length;
    if (wholeChange && fieldCount) {
      invalidChanges(`新增运营批次日程不能混用整行和字段声明：${wholePath}`);
    }
    if (wholeChange) {
      assertExactChange(wholeChange, {
        before: "",
        after: desired.schedules[index].name,
        requirementIndex: index,
      });
      changesByPath.delete(wholePath);
    } else {
      if (fieldCount !== scheduleFields.length) {
        invalidChanges(`新增运营批次日程缺少完整字段声明：${wholePath}`);
      }
      const changed = new Set();
      for (const [field] of scheduleFields) {
        const changePath = `${wholePath}.${field}`;
        const change = fieldChanges.get(field);
        assertExactChange(change, {
          before: "",
          after: desired.schedules[index][field],
          requirementIndex: index,
        });
        changed.add(field);
        changesByPath.delete(changePath);
      }
      fields.schedules.set(index, changed);
    }
    fields.appended.add(index);
  }

  if (changesByPath.size) {
    invalidChanges(
      `运营批次修改清单包含额外或非受管字段：${[...changesByPath.keys()].join("、")}`,
    );
  }
  return fields;
}

const overviewFields = [
  ["batchName", "批次名称"],
  ["examStartDate", "考试开始日期"],
  ["examEndDate", "考试结束日期"],
];

const scheduleFields = [
  ["name", "考试名称"],
  ["start", "开始时间"],
  ["end", "结束时间"],
];

async function writeManagedChanges(
  page,
  pageAdapter,
  current,
  desired,
  fields,
  { initialize = false } = {},
) {
  let writeCount = 0;
  const overviewChanged = new Set(
    overviewFields
      .map(([field]) => field)
      .filter((field) => initialize || fields.overview.has(field)),
  );
  if (overviewChanged.size) {
    if (typeof pageAdapter.beginOverviewEdit === "function") {
      await pageAdapter.beginOverviewEdit(page);
    }
    if (typeof pageAdapter.writeOverviewFields === "function") {
      await pageAdapter.writeOverviewFields(page, desired, overviewChanged);
      writeCount += overviewChanged.size;
    } else {
      for (const [field, label] of overviewFields) {
        if (!overviewChanged.has(field)) continue;
        await pageAdapter.writeOverview(page, field, label, desired[field]);
        writeCount += 1;
      }
    }
    const saveOverview = pageAdapter.saveOverview || pageAdapter.save;
    await saveOverview(page);
  }

  const scheduleChanged = initialize
    || fields.appended.size > 0
    || fields.schedules.size > 0;
  if (!scheduleChanged) return writeCount;
  if (typeof pageAdapter.beginScheduleEdit === "function") {
    await pageAdapter.beginScheduleEdit(page);
  }
  for (let index = 0; index < desired.schedules.length; index += 1) {
    const isNew = index >= current.schedules.length;
    const appended = isNew && (initialize || fields.appended.has(index));
    if (appended) {
      await pageAdapter.appendSchedule(page, index);
      writeCount += 1;
    }
    const changed = fields.schedules.get(index) || new Set();
    const fieldsToWrite = new Set(
      scheduleFields
        .map(([field]) => field)
        .filter((field) => initialize || appended || changed.has(field)),
    );
    if (!fieldsToWrite.size) continue;
    if (typeof pageAdapter.writeScheduleFields === "function") {
      await pageAdapter.writeScheduleFields(
        page,
        index,
        desired.schedules[index],
        fieldsToWrite,
        { appended },
      );
      writeCount += fieldsToWrite.size;
    } else {
      for (const [field, label] of scheduleFields) {
        if (!fieldsToWrite.has(field)) continue;
        const value = field === "name"
          ? desired.schedules[index][field]
          : visibleDateTime(desired.schedules[index][field]);
        await pageAdapter.writeSchedule(page, index, field, label, value);
        writeCount += 1;
      }
    }
  }
  const saveSchedules = pageAdapter.saveSchedules || pageAdapter.save;
  await saveSchedules(page);
  return writeCount;
}

async function verifyReadback(page, instruction, options, expected) {
  const code = batchCode(instruction);
  const pageAdapter = adapter(options);
  const detailUrl = await pageAdapter.openBatchByCode(page, {
    batchCode: code,
    batchListUrl: batchListUrl(options),
    options,
  });
  const actual = await readManagedSnapshot(page, pageAdapter);
  if (!snapshotsEqual(actual, expected)) {
    throw errorWithCode(
      "运营批次保存后回读与期望快照不一致",
      "OPERATION_BATCH_READBACK_MISMATCH",
      { expected, actual, detailUrl: text(detailUrl) },
    );
  }
  return { snapshot: actual, detailUrl: text(detailUrl) };
}

export async function inspectOperationBatchManagedSnapshot(instruction, options = {}) {
  batchCode(instruction);
  return withPage(options, async (page) => (
    await inspectOnPage(page, instruction, options)
  ).snapshot);
}

export async function runOperationBatchManagedUpdate(instruction, options = {}) {
  const code = batchCode(instruction);
  const desired = completeDesiredSnapshot(instruction);
  return withPage(options, async (page) => {
    const inspected = await inspectOnPage(page, instruction, options);
    const current = inspected.snapshot;
    if (desired.schedules.length < current.schedules.length) {
      throw errorWithCode(
        "不允许减少已同步的运营批次日程数量",
        "OPERATION_BATCH_SCHEDULE_COUNT_DECREASE",
        { currentCount: current.schedules.length, desiredCount: desired.schedules.length },
      );
    }
    let expected;
    try {
      expected = normalizeSnapshot(instruction.batch?.expectedAppliedSnapshot, {
        code: "OPERATION_BATCH_UPDATE_CONFLICT",
      });
    } catch (error) {
      if (error?.code !== "OPERATION_BATCH_UPDATE_CONFLICT") {
        error.code = "OPERATION_BATCH_UPDATE_CONFLICT";
      }
      throw error;
    }
    if (!snapshotsEqual(current, expected)) {
      throw errorWithCode(
        `运控批次 ${code} 当前受管字段与已应用快照不一致`,
        "OPERATION_BATCH_UPDATE_CONFLICT",
        { expected, actual: current },
      );
    }
    const fields = validatedManagedFields(instruction.changes, current, desired);
    const writeCount = await writeManagedChanges(
      page,
      inspected.pageAdapter,
      current,
      desired,
      fields,
    );
    const verified = await verifyReadback(page, instruction, options, desired);
    return {
      verified: true,
      snapshot: verified.snapshot,
      detailUrl: verified.detailUrl,
      checkpoints: [
        "opened_exact_batch",
        "expected_snapshot_verified",
        ...(writeCount ? ["managed_fields_saved"] : []),
        "reentered_exact_batch",
        "exact_readback_verified",
      ],
    };
  });
}

export async function runOperationBatchScheduleInitialization(instruction, options = {}) {
  batchCode(instruction);
  const desired = completeDesiredSnapshot(instruction, true);
  return withPage(options, async (page) => {
    const inspected = await inspectOnPage(page, instruction, options);
    if (inspected.snapshot.schedules.length) {
      throw errorWithCode(
        "运营批次日程初始化要求当前日程为空",
        "OPERATION_BATCH_INITIALIZATION_CONFLICT",
        { actual: inspected.snapshot },
      );
    }
    await writeManagedChanges(
      page,
      inspected.pageAdapter,
      inspected.snapshot,
      desired,
      { overview: new Set(), schedules: new Map(), appended: new Set() },
      { initialize: true },
    );
    const verified = await verifyReadback(page, instruction, options, desired);
    return {
      verified: true,
      snapshot: verified.snapshot,
      detailUrl: verified.detailUrl,
      checkpoints: [
        "opened_exact_batch",
        "empty_schedule_set_verified",
        "managed_fields_saved",
        "reentered_exact_batch",
        "exact_readback_verified",
      ],
    };
  });
}
