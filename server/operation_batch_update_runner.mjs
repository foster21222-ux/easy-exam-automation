import path from "node:path";

import {
  advanceOperationBatchListPage,
  formItemByLabel,
  launchOperationBatchContext,
  openExactOperationBatchCard,
  operationBatchDetailIdentity,
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

function errorWithCode(message, code, detail = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  Object.assign(error, detail);
  return error;
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
  const controls = item.locator("input,textarea");
  const count = await controls.count();
  if (count !== 1) {
    throw errorWithCode(
      `运控批次字段“${label}”必须有唯一可见输入控件，实际 ${count} 个`,
      "OPERATION_BATCH_INSPECTION_BLOCKED",
    );
  }
  return controls.first();
}

function exactScheduleColumn(headers, candidates, label) {
  const matches = headers
    .map((header, index) => ({ header: text(header), index }))
    .filter((item) => candidates.includes(item.header));
  if (matches.length !== 1) {
    throw errorWithCode(
      `考试日程表必须有唯一“${label}”列，实际 ${matches.length} 列`,
      "OPERATION_BATCH_INSPECTION_BLOCKED",
    );
  }
  return matches[0].index;
}

async function scheduleTable(page) {
  const matches = [];
  for (const table of await page.locator("table").all()) {
    const headers = (await table.locator("thead th").allInnerTexts()).map(text);
    try {
      matches.push({
        table,
        columns: {
          name: exactScheduleColumn(headers, ["考试名称"], "考试名称"),
          start: exactScheduleColumn(headers, ["开始时间", "考试开始时间"], "开始时间"),
          end: exactScheduleColumn(headers, ["结束时间", "考试结束时间"], "结束时间"),
        },
      });
    } catch {}
  }
  if (matches.length !== 1) {
    throw errorWithCode(
      `必须找到唯一考试日程表，实际 ${matches.length} 个`,
      "OPERATION_BATCH_INSPECTION_BLOCKED",
    );
  }
  return matches[0];
}

async function visibleScheduleRows(table) {
  const rows = await table.locator("tbody tr").all();
  const visible = [];
  for (const row of rows) {
    if (typeof row.isVisible !== "function" || await row.isVisible()) visible.push(row);
  }
  return visible;
}

async function scheduleCellValue(row, column) {
  const cell = row.locator("td").nth(column);
  const inputs = cell.locator("input,textarea");
  const inputCount = await inputs.count();
  if (inputCount > 1) {
    throw errorWithCode(
      "考试日程单元格存在多个输入控件",
      "OPERATION_BATCH_INSPECTION_BLOCKED",
    );
  }
  return inputCount === 1
    ? inputs.first().inputValue()
    : cell.innerText();
}

async function writeScheduleCell(page, requirementIndex, field, value) {
  const { table, columns } = await scheduleTable(page);
  const rows = await visibleScheduleRows(table);
  const row = rows[requirementIndex];
  if (!row) {
    throw errorWithCode(
      `未找到按可见顺序排列的日程 ${requirementIndex + 1}`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  const inputs = row.locator("td").nth(columns[field]).locator("input,textarea");
  if (await inputs.count() !== 1) {
    throw errorWithCode(
      `日程 ${requirementIndex + 1} 的${field}字段缺少唯一输入控件`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  await inputs.first().fill(value);
}

async function uniqueButton(page, name, errorLabel) {
  const button = page.getByRole("button", { name });
  const count = await button.count();
  if (count !== 1) {
    throw errorWithCode(
      `${errorLabel}按钮必须唯一，实际 ${count} 个`,
      "OPERATION_BATCH_UPDATE_CONFLICT",
    );
  }
  return button;
}

const visiblePageAdapter = {
  openBatchByCode: openOperationBatchByCode,
  async readOverview(page) {
    return {
      batchName: await (await managedFormControl(page, "批次名称")).inputValue(),
      examStartDate: await (await managedFormControl(page, "考试开始日期")).inputValue(),
      examEndDate: await (await managedFormControl(page, "考试结束日期")).inputValue(),
    };
  },
  async readSchedules(page) {
    const { table, columns } = await scheduleTable(page);
    const rows = await visibleScheduleRows(table);
    return Promise.all(rows.map(async (row) => ({
      name: await scheduleCellValue(row, columns.name),
      start: await scheduleCellValue(row, columns.start),
      end: await scheduleCellValue(row, columns.end),
    })));
  },
  async writeOverview(page, _field, label, value) {
    await (await managedFormControl(page, label)).fill(value);
  },
  async writeSchedule(page, requirementIndex, field, _label, value) {
    await writeScheduleCell(page, requirementIndex, field, value);
  },
  async appendSchedule(page) {
    await (await uniqueButton(page, /新增日程|添加日程/, "新增日程")).click();
  },
  async save(page) {
    await (await uniqueButton(page, /^保\s*存$/, "保存")).click();
  },
};

function adapter(options = {}) {
  return { ...visiblePageAdapter, ...(options.adapter || {}) };
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

function changedManagedFields(changes = []) {
  if (!Array.isArray(changes)) {
    throw errorWithCode("运营批次修改清单格式不合法", "OPERATION_BATCH_CHANGES_INVALID");
  }
  const fields = {
    overview: new Set(),
    schedules: new Map(),
    appended: new Set(),
  };
  for (const change of changes) {
    const changePath = text(change?.path);
    if (["batchName", "examStartDate", "examEndDate"].includes(changePath)) {
      fields.overview.add(changePath);
      continue;
    }
    const parentMatch = changePath.match(/^schedules\[(\d+)]$/);
    if (parentMatch) {
      fields.appended.add(Number(parentMatch[1]));
      continue;
    }
    const fieldMatch = changePath.match(/^schedules\[(\d+)]\.(name|start|end)$/);
    if (!fieldMatch) {
      throw errorWithCode(
        `运营批次修改清单包含非受管字段：${changePath}`,
        "OPERATION_BATCH_CHANGES_INVALID",
      );
    }
    const index = Number(fieldMatch[1]);
    const names = fields.schedules.get(index) || new Set();
    names.add(fieldMatch[2]);
    fields.schedules.set(index, names);
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
  for (const [field, label] of overviewFields) {
    if (initialize || fields.overview.has(field)) {
      await pageAdapter.writeOverview(page, field, label, desired[field]);
      writeCount += 1;
    }
  }
  for (let index = 0; index < desired.schedules.length; index += 1) {
    const isNew = index >= current.schedules.length;
    if (isNew) {
      await pageAdapter.appendSchedule(page, index);
      writeCount += 1;
    }
    const changed = fields.schedules.get(index) || new Set();
    for (const [field, label] of scheduleFields) {
      if (initialize || isNew || fields.appended.has(index) || changed.has(field)) {
        const value = field === "name"
          ? desired.schedules[index][field]
          : visibleDateTime(desired.schedules[index][field]);
        await pageAdapter.writeSchedule(page, index, field, label, value);
        writeCount += 1;
      }
    }
  }
  if (writeCount) await pageAdapter.save(page);
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
  const fields = changedManagedFields(instruction.changes);
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
