import path from "node:path";

function text(value) {
  return String(value ?? "").trim();
}

function compactText(value) {
  return text(value).replace(/\s+/g, "");
}

function draftValue(draft, key) {
  return text(draft?.fields?.[key]?.value);
}

const operationFieldIds = new Map([
  ["业务部归属", "start_department"],
  ["批次名称", "batch_name"],
  ["项目部归属", "project_department"],
  ["考试日期", "exam_datetime"],
  ["预估总考量", "exam_amount"],
  ["预估单场最大科次数", "exam_concurrency"],
  ["预估城市数", "exam_cities"],
  ["系统类型", "system_type"],
  ["使用考站情况", "exam_station"],
  ["编排服务", "arrange_method"],
  ["在线结算编排来源", "arrange_type"],
  ["结算依据", "settlement_subjects"],
  ["备注", "memo"],
]);

export const OPERATION_BATCH_RECONCILIATION_REQUIRED = "OPERATION_BATCH_RECONCILIATION_REQUIRED";

export function operationFieldId(label) {
  return operationFieldIds.get(text(label)) || "";
}

export function operationDateTitle(value) {
  const match = text(value).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return text(value);
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

export function operationServiceButtonLabels(fields = {}) {
  const labels = [];
  if (text(fields.serviceExam)) labels.push("考试");
  const personnel = text(fields.servicePersonnel);
  if (personnel && !personnel.includes("不需要")) labels.push("人员");
  return labels;
}

export function operationConfigServiceSelections(fields = {}) {
  const selections = [];
  const serviceExam = text(fields.serviceExam);
  const servicePersonnel = text(fields.servicePersonnel);
  if (serviceExam) selections.push({ category: "考试", option: serviceExam });
  if (servicePersonnel && !servicePersonnel.includes("不需要")) {
    selections.push({ category: "人员", option: "在线监考" });
  }
  return selections;
}

export function operationSelectedTaskMismatches(draft, selected = {}) {
  const checks = [
    ["projectCode", "项目编码"],
    ["projectName", "项目名称"],
  ];
  return checks
    .map(([key, label]) => ({
      label,
      expected: draftValue(draft, key),
      actual: text(selected[key]),
    }))
    .filter((item) => item.expected && item.actual && item.expected !== item.actual);
}

export function operationSelectedTaskMismatchMessage(mismatches = []) {
  const detail = mismatches
    .map((item) => `${item.label}期望 ${item.expected}，实际 ${item.actual}`)
    .join("；");
  return `运营控制台需求任务单与当前项目不一致：${detail}。请先确认业务需求单流水号或选择正确的运控任务单。`;
}

export function operationTaskMismatchAllowed(options = {}) {
  if (options.allowTaskMismatch === true) return true;
  const env = options.env || process.env;
  return env.OPERATION_CONSOLE_ALLOW_TEST_TASK_MISMATCH === "1";
}

export function operationConsoleNeedsLogin(urlValue = "") {
  const value = text(urlValue).toLowerCase();
  return value.includes("/oauth2/authorize") || value.includes("/loginwaiting") || value.includes("/login");
}

export function operationConsoleLoginMessage(minutes) {
  return `运营控制台需要登录。请在自动化浏览器中完成登录，系统会等待最多 ${minutes} 分钟；登录完成后会继续创建未发布批次。`;
}

export function operationTaskSearchInputSelector() {
  return 'input[placeholder*="流水号"]';
}

export function operationSelectControlSelector() {
  return ".ant-select-selection, .ant-select-selector, [role='combobox']";
}

export function operationDropdownValueCandidates(label, value) {
  const normalizedLabel = text(label);
  const normalizedValue = text(value);
  if (!normalizedValue) return [];
  const aliases = {
    结算依据: {
      按报名科次结算: ["按开考科次结算"],
    },
  };
  return [normalizedValue, ...(aliases[normalizedLabel]?.[normalizedValue] || [])];
}

export function operationBatchCodeFromText(value) {
  return text(value).match(/\b[A-Z]{3}\d{6}\b/)?.[0] || "";
}

export function operationBatchDetailIdentity(urlValue) {
  try {
    const url = new URL(text(urlValue));
    const batchGuid = text(url.searchParams.get("batch_guid"));
    if (!/\/batchDetail\/?$/.test(url.pathname) || !batchGuid) return null;
    return { detailUrl: url.toString(), batchGuid };
  } catch {
    return null;
  }
}

export function operationBatchListResultFromRows(rowTexts, batchName, detailUrl) {
  const normalizedName = text(batchName);
  if (!normalizedName) {
    throw reconciliationRequiredError(new Error("批次名称为空，无法确认唯一批次代码"));
  }
  const matchingRows = (rowTexts || [])
    .map((rowValue) => Array.isArray(rowValue)
      ? rowValue.map((cell) => text(cell))
      : String(rowValue ?? "").split(/\t|\r?\n/).map((cell) => text(cell)))
    .filter((cells) => cells.some((cell) => cell === normalizedName));
  const codes = matchingRows.length === 1
    ? matchingRows[0].flatMap((cell) => cell.match(/\b[A-Z]{3}\d{6}\b/g) || [])
    : [];
  if (matchingRows.length !== 1 || codes.length !== 1) {
    throw reconciliationRequiredError(new Error("批次列表存在零个或多个批次代码或匹配行，无法确认唯一批次代码"));
  }
  return {
    operationBatchCode: codes[0],
    batchGuid: "",
    detailUrl: text(detailUrl),
    status: "created_unpublished",
  };
}

async function clickByText(page, textValue) {
  await page.getByText(textValue, { exact: false }).first().click();
}

async function formItemByLabel(page, label) {
  const labelNode = page.locator(`label[title^="${label}"]`).first();
  await labelNode.waitFor({ state: "visible", timeout: 30000 });
  return labelNode.locator("xpath=ancestor::*[contains(@class,'ant-form-item')][1]");
}

async function fillInputNearLabel(page, label, value) {
  if (!text(value)) return;
  const fieldId = operationFieldId(label);
  const input = fieldId
    ? page.locator(`#${fieldId}, #${fieldId} input, #${fieldId} textarea`).last()
    : (await formItemByLabel(page, label)).locator("input,textarea").first();
  await input.waitFor({ state: "visible", timeout: 30000 });
  await input.fill(text(value));
}

async function inputValueById(page, id) {
  const input = page.locator(`#${id}`).first();
  await input.waitFor({ state: "attached", timeout: 30000 });
  return input.inputValue();
}

async function assertSelectedTaskMatchesDraft(page, draft, options = {}) {
  await page.locator("#project_code").waitFor({ state: "attached", timeout: 30000 });
  await page.waitForFunction(() => document.querySelector("#project_code")?.value || "", null, { timeout: 30000 });
  const selected = {
    projectCode: await inputValueById(page, "project_code"),
    projectName: await inputValueById(page, "project_name"),
  };
  const mismatches = operationSelectedTaskMismatches(draft, selected);
  if (mismatches.length && !operationTaskMismatchAllowed(options)) {
    throw new Error(operationSelectedTaskMismatchMessage(mismatches));
  }
}

async function chooseDropdownValue(page, label, value) {
  if (!text(value)) return;
  const fieldId = operationFieldId(label);
  const container = fieldId ? page.locator(`#${fieldId}`).first() : await formItemByLabel(page, label);
  const candidates = operationDropdownValueCandidates(label, value);
  let lastError;
  for (const candidate of candidates) {
    await container.locator(operationSelectControlSelector()).first().click();
    try {
      await page.getByText(candidate, { exact: true }).last().click({ timeout: 5000 });
      return;
    } catch (error) {
      lastError = error;
      await page.keyboard.press("Escape").catch(() => {});
    }
  }
  throw lastError || new Error(`下拉选项不存在：${label}=${value}`);
}

async function chooseDateRange(page, startDate, endDate) {
  const startTitle = operationDateTitle(startDate);
  const endTitle = operationDateTitle(endDate || startDate);
  if (!startTitle) return;
  await page.locator("#exam_datetime").click();
  const startCell = page.locator(`td[title="${startTitle}"] .ant-calendar-date`).last();
  await startCell.waitFor({ state: "visible", timeout: 30000 });
  await startCell.click();
  const endCell = page.locator(`td[title="${endTitle}"] .ant-calendar-date`).last();
  await endCell.waitFor({ state: "visible", timeout: 30000 });
  await endCell.click();
}

async function clickConfigServiceButton(page, label) {
  if (!text(label)) return;
  const target = compactText(label);
  const formItems = await page.locator(".ant-form-item").all();
  for (const item of formItems) {
    const itemText = compactText(await item.innerText().catch(() => ""));
    if (!itemText.includes("配置服务")) continue;
    const buttons = await item.locator("button").all();
    for (const button of buttons) {
      const value = compactText(await button.innerText());
      if (value === target) {
        await button.click();
        return;
      }
    }
  }
  const container = await formItemByLabel(page, "配置服务");
  const buttons = await container.locator("button").all();
  for (const button of buttons) {
    const value = compactText(await button.innerText());
    if (value === target) {
      await button.click();
      return;
    }
  }
  throw new Error(`配置服务中未找到按钮：${label}`);
}

async function clickVisibleModalButton(page, label) {
  const target = compactText(label);
  const buttons = await page.locator(".ant-modal:visible button").all();
  for (const button of buttons) {
    const value = compactText(await button.innerText().catch(() => ""));
    if (value === target) {
      await button.click();
      return;
    }
  }
  throw new Error(`配置服务选项中未找到按钮：${label}`);
}

async function chooseConfigService(page, selection = {}) {
  if (!text(selection.category) || !text(selection.option)) return;
  await clickConfigServiceButton(page, selection.category);
  await clickVisibleModalButton(page, selection.option);
}

async function selectOperationTask(page, serial) {
  const searchInput = page.locator(operationTaskSearchInputSelector()).last();
  await searchInput.waitFor({ state: "visible", timeout: 30000 });
  await searchInput.fill(serial);
  await searchInput.press("Enter");
  const modal = page.locator(".ant-modal:visible").last();
  await page.waitForFunction((expectedSerial) => {
    const modals = Array.from(document.querySelectorAll(".ant-modal"))
      .filter((node) => node.getClientRects().length > 0);
    const latest = modals.at(-1);
    return latest?.innerText?.includes(expectedSerial);
  }, serial, { timeout: 30000 }).catch(async () => {
    const modalText = await modal.innerText().catch(() => "");
    if (modalText.includes("暂无数据") || modalText.includes("找到0条结果")) {
      throw new Error(`运营控制台未找到考试需求任务单：${serial}`);
    }
    throw new Error(`运营控制台考试需求任务单搜索超时：${serial}`);
  });
  const result = modal.getByText(serial, { exact: false }).first();
  await result.click();
  await modal.getByRole("button", { name: /确\s*定/ }).click();
}

async function ensureBatchListReady(page, batchListUrl, options = {}) {
  const loginWaitMinutes = Number(options.loginWaitMinutes || process.env.OPERATION_CONSOLE_LOGIN_WAIT_MINUTES || 10);
  const waitMs = Math.max(1, loginWaitMinutes) * 60 * 1000;
  const createButton = page.getByRole("button", { name: /创建批次/ });
  try {
    await createButton.waitFor({ state: "visible", timeout: 10000 });
    return;
  } catch {}

  if (!operationConsoleNeedsLogin(page.url())) {
    throw new Error(`未找到“创建批次”按钮，当前页面：${page.url()}`);
  }

  // Keep the headed browser open so the user can finish SSO login manually.
  await page.waitForURL((url) => !operationConsoleNeedsLogin(String(url)), { timeout: waitMs }).catch(() => {
    throw new Error(operationConsoleLoginMessage(loginWaitMinutes));
  });
  await page.goto(batchListUrl, { waitUntil: "domcontentloaded" });
  await createButton.waitFor({ state: "visible", timeout: 30000 });
}

function operationBatchListEndpoint(urlValue, pageUrl) {
  const pathname = new URL(urlValue, pageUrl).pathname
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
  const words = pathname.split(/[^a-z0-9]+/).filter(Boolean);
  return words.includes("batch")
    && words.some((word) => ["list", "query", "search", "page"].includes(word));
}

function operationBatchSearchValues(urlValue, postData, pageUrl) {
  const acceptedFields = new Set(["batchName", "batch_name"]);
  const values = [];
  const url = new URL(urlValue, pageUrl);
  for (const [key, value] of url.searchParams) {
    if (acceptedFields.has(key)) values.push(text(value));
  }
  const body = String(postData ?? "").trim();
  if (!body) return values;
  try {
    const collect = (value) => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (acceptedFields.has(key)) values.push(text(child));
        else if (child && typeof child === "object") collect(child);
      }
    };
    collect(JSON.parse(body));
  } catch {
    for (const [key, value] of new URLSearchParams(body)) {
      if (acceptedFields.has(key)) values.push(text(value));
    }
  }
  return values;
}

export function operationBatchTableResponseMatches(response, pageUrl, options = {}) {
  try {
    const request = response.request();
    const resourceType = request.resourceType();
    const pageOrigin = new URL(pageUrl).origin;
    const responseUrl = response.url();
    const requestUrl = request.url?.() || responseUrl;
    const method = text(request.method?.()).toUpperCase();
    if ((resourceType !== "xhr" && resourceType !== "fetch")
      || (method !== "GET" && method !== "POST")
      || new URL(responseUrl, pageUrl).origin !== pageOrigin
      || new URL(requestUrl, pageUrl).origin !== pageOrigin
      || !operationBatchListEndpoint(responseUrl, pageUrl)
      || !operationBatchListEndpoint(requestUrl, pageUrl)) {
      return false;
    }
    const expectedBatchName = text(options.expectedBatchName);
    if (!expectedBatchName) return true;
    return operationBatchSearchValues(requestUrl, request.postData?.(), pageUrl)
      .some((value) => value === expectedBatchName);
  } catch {
    return false;
  }
}

async function operationBatchTableRows(page) {
  const rows = await page.locator("tbody tr").all();
  return Promise.all(rows.map(async (row) => (
    (await row.locator("td").allInnerTexts()).map((cell) => text(cell))
  )));
}

async function waitForStableOperationBatchRows(page, options = {}) {
  const stablePollMs = Math.max(0, Number(options.tableStablePollMs ?? 100));
  const maxChecks = Math.max(2, Number(options.tableStableMaxChecks || 10));
  let previousSignature = "";
  for (let attempt = 0; attempt < maxChecks; attempt += 1) {
    const rows = await operationBatchTableRows(page);
    const signature = JSON.stringify(rows);
    if (attempt > 0 && signature === previousSignature) return rows;
    previousSignature = signature;
    await page.waitForTimeout(stablePollMs);
  }
  throw reconciliationRequiredError(new Error("批次列表在安全等待时间内未稳定，无法确认完整查询结果"));
}

async function performOperationBatchTableAction(page, action, options = {}, responseOptions = {}) {
  const loading = page
    .locator(".ant-table-wrapper .ant-spin-spinning, .ant-table .ant-spin-spinning")
    .first();
  const responseWait = page.waitForResponse(
    (response) => operationBatchTableResponseMatches(response, page.url(), responseOptions),
    { timeout: Number(options.batchListResponseWaitMs || 30000) },
  );
  try {
    await action();
    await loading.waitFor({ state: "visible", timeout: Number(options.batchListLoadingWaitMs || 30000) });
    const response = await responseWait;
    if (typeof response.ok === "function" && !response.ok()) {
      throw new Error(`批次列表查询请求失败：${response.url()}`);
    }
    const responseError = await response.finished();
    if (responseError) throw responseError;
    await loading.waitFor({ state: "hidden", timeout: Number(options.batchListLoadingWaitMs || 30000) });
    return await waitForStableOperationBatchRows(page, options);
  } catch (error) {
    responseWait.catch(() => {});
    throw reconciliationRequiredError(error);
  }
}

async function operationBatchActivePage(page) {
  const activeLocator = page.locator(".ant-pagination-item-active");
  if (await activeLocator.count() !== 1) {
    throw reconciliationRequiredError(new Error("批次列表缺少唯一的 Ant 当前页标记，无法证明分页进度"));
  }
  const active = activeLocator.first();
  const value = text(await active.getAttribute("title")) || text(await active.innerText());
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw reconciliationRequiredError(new Error("批次列表 Ant 当前页无有效页码，无法证明分页进度"));
  }
  return Number(value);
}

async function collectOperationBatchListRows(page, initialRows, options = {}) {
  const maxPages = Math.max(1, Number(options.maxBatchListPages || 100));
  const allRows = [...initialRows];
  let previousPageRows = initialRows;
  for (let pageNumber = 1; ; pageNumber += 1) {
    const pagination = page.locator(".ant-pagination");
    const paginationCount = await pagination.count();
    if (paginationCount === 0) return allRows;
    if (paginationCount !== 1) {
      throw reconciliationRequiredError(new Error("批次列表存在多个 Ant 分页控件，无法证明结果完整"));
    }
    const nextLocator = page.locator(".ant-pagination .ant-pagination-next");
    if (await nextLocator.count() !== 1) {
      throw reconciliationRequiredError(new Error("批次列表分页缺少唯一的 Ant 下一页控件，无法证明结果完整"));
    }
    const next = nextLocator.first();
    const activePage = await operationBatchActivePage(page);
    if (activePage !== pageNumber) {
      throw reconciliationRequiredError(new Error(`批次列表当前页 ${activePage} 与预期页 ${pageNumber} 不一致，无法证明分页连续`));
    }
    const classes = text(await next.getAttribute("class"));
    const ariaDisabled = text(await next.getAttribute("aria-disabled"));
    if (classes.split(/\s+/).includes("ant-pagination-disabled") || ariaDisabled === "true") return allRows;
    if (pageNumber >= maxPages) {
      throw reconciliationRequiredError(new Error(`批次列表超过安全分页上限 ${maxPages}，无法确认完整结果`));
    }
    const control = next.locator("button, a").first();
    if (await control.count() !== 1) {
      throw reconciliationRequiredError(new Error("批次列表下一页控件不可操作，无法证明结果完整"));
    }
    const rows = await performOperationBatchTableAction(page, () => control.click(), options);
    const nextActivePage = await operationBatchActivePage(page);
    if (nextActivePage !== activePage + 1) {
      throw reconciliationRequiredError(new Error(`批次列表点击下一页后未推进：仍为第 ${nextActivePage} 页`));
    }
    if (JSON.stringify(rows) === JSON.stringify(previousPageRows)) {
      throw reconciliationRequiredError(new Error("批次列表点击下一页后行数据未变化，无法证明已读取新页"));
    }
    allRows.push(...rows);
    previousPageRows = rows;
  }
}

export async function findCreatedBatchFromList(page, batchListUrl, batchName, options = {}) {
  const normalizedName = text(batchName);
  if (!normalizedName) {
    throw reconciliationRequiredError(new Error("批次名称为空，无法查询运营批次"));
  }
  await page.goto(batchListUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /创建批次/ }).waitFor({ state: "visible", timeout: 30000 });
  const searchInput = page.locator("input[placeholder*=批次代码], input[placeholder*=批次名称]").first();
  await searchInput.waitFor({ state: "visible", timeout: 30000 });
  await searchInput.fill(normalizedName);
  const firstPageRows = await performOperationBatchTableAction(
    page,
    () => searchInput.press("Enter"),
    options,
    { expectedBatchName: normalizedName },
  );
  const allRows = await collectOperationBatchListRows(page, firstPageRows, options);
  return operationBatchListResultFromRows(allRows, normalizedName, page.url());
}

export async function resolveSubmittedOperationBatch(page, options = {}) {
  const detailCodeWaitMs = Number(options.detailCodeWaitMs || 60000);
  const detail = operationBatchDetailIdentity(page.url());
  if (detail) {
    try {
      await page.waitForFunction(
        () => /\b[A-Z]{3}\d{6}\b/.test(document.body?.innerText || ""),
        null,
        { timeout: detailCodeWaitMs },
      );
      const bodyText = await page.locator("body").innerText();
      const hasExactBatchName = String(bodyText ?? "")
        .split(/\r?\n/)
        .some((line) => text(line) === text(options.batchName));
      const codes = String(bodyText ?? "").match(/\b[A-Z]{3}\d{6}\b/g) || [];
      if (hasExactBatchName && codes.length === 1) {
        return {
          operationBatchCode: codes[0],
          batchGuid: detail.batchGuid,
          detailUrl: detail.detailUrl,
          status: "created_unpublished",
        };
      }
    } catch {}
  }
  const findFromList = options.findFromList || ((batchListUrl, batchName) => findCreatedBatchFromList(page, batchListUrl, batchName, options));
  const result = await findFromList(options.batchListUrl, options.batchName);
  if (!result) {
    throw reconciliationRequiredError(new Error("创建已提交，但详情页和批次列表均未找到批次代码"));
  }
  return result;
}

function reconciliationRequiredError(error) {
  const wrapped = error instanceof Error ? error : new Error(String(error));
  wrapped.code = OPERATION_BATCH_RECONCILIATION_REQUIRED;
  wrapped.status = 409;
  return wrapped;
}

async function launchOperationBatchContext(userDataDir, headless, options = {}) {
  if (typeof options.launchPersistentContext === "function") {
    return options.launchPersistentContext(userDataDir, { headless, viewport: null });
  }
  const { chromium } = await import("playwright").catch((error) => {
    const message = error?.code === "ERR_MODULE_NOT_FOUND"
      ? "未安装 Playwright，不能启动运营控制台浏览器自动化。请先执行 npm install。"
      : (error instanceof Error ? error.message : String(error));
    throw new Error(message);
  });
  return chromium.launchPersistentContext(userDataDir, { headless, viewport: null });
}

export async function runWithOperationBatchContext(context, operation, options = {}) {
  let result;
  let primaryError;
  try {
    const page = context.pages()[0] || await context.newPage();
    result = await operation(page);
  } catch (error) {
    primaryError = error;
  }
  let closeError;
  try {
    await context.close();
  } catch (error) {
    closeError = error;
  }
  if (primaryError) throw primaryError;
  if (closeError) {
    if (options.closeFailureRequiresReconciliation?.()) {
      throw reconciliationRequiredError(closeError);
    }
    if (!options.preserveResultOnCloseFailure) throw closeError;
  }
  return result;
}

export async function runOperationBatchCreation(draft, options = {}) {
  const baseUrl = text(options.baseUrl || process.env.OPERATION_CONSOLE_BASE_URL || "http://172.16.18.198:8020");
  const userDataDir = text(options.userDataDir || process.env.OPERATION_CONSOLE_USER_DATA_DIR || path.join(process.cwd(), ".easy_exam_runtime", "operation-console-profile"));
  const headless = options.headless ?? process.env.OPERATION_CONSOLE_HEADLESS === "1";
  const context = await launchOperationBatchContext(userDataDir, headless, options);
  let submissionStarted = false;
  return runWithOperationBatchContext(context, async (page) => {
    try {
      const batchListUrl = `${baseUrl.replace(/\/$/, "")}/batch/batchList`;
      await page.goto(batchListUrl, { waitUntil: "domcontentloaded" });
      await ensureBatchListReady(page, batchListUrl, options);
      await page.getByRole("button", { name: /创建批次/ }).click();
      await page.getByRole("button", { name: /选\s*择/ }).click();
      const serial = draftValue(draft, "operationTaskSerial");
      if (!serial) throw new Error("缺少考试需求任务单流水号");
      await selectOperationTask(page, serial);
      await assertSelectedTaskMatchesDraft(page, draft, options);

      await chooseDropdownValue(page, "业务部归属", draftValue(draft, "businessDepartment"));
      await fillInputNearLabel(page, "批次名称", draftValue(draft, "batchName"));
      await chooseDropdownValue(page, "项目部归属", draftValue(draft, "projectDepartment"));
      await chooseDateRange(page, draftValue(draft, "examStartDate"), draftValue(draft, "examEndDate"));
      for (const selection of operationConfigServiceSelections({
        serviceExam: draftValue(draft, "serviceExam"),
        servicePersonnel: draftValue(draft, "servicePersonnel"),
      })) {
        await chooseConfigService(page, selection);
      }
      await page.getByRole("button", { name: /下一步/ }).click();

      await fillInputNearLabel(page, "预估总考量", draftValue(draft, "estimatedTotalSubjectCount"));
      await fillInputNearLabel(page, "预估单场最大科次数", draftValue(draft, "estimatedMaxSubjectCount"));
      await fillInputNearLabel(page, "预估城市数", draftValue(draft, "estimatedCityCount"));
      await chooseDropdownValue(page, "系统类型", draftValue(draft, "systemType"));
      await chooseDropdownValue(page, "使用考站情况", draftValue(draft, "stationUsage"));
      await chooseDropdownValue(page, "编排服务", draftValue(draft, "arrangementService"));
      await chooseDropdownValue(page, "在线结算编排来源", draftValue(draft, "onlineSettlementArrangementSource"));
      await chooseDropdownValue(page, "结算依据", draftValue(draft, "billingBasis"));
      await fillInputNearLabel(page, "备注", draftValue(draft, "remark"));
      await page.getByRole("button", { name: /下一步/ }).click();
      submissionStarted = true;
      await page.getByRole("button", { name: /完\s*成/ }).click();
      return await resolveSubmittedOperationBatch(page, {
        ...options,
        batchListUrl,
        batchName: draftValue(draft, "batchName"),
      });
    } catch (error) {
      if (submissionStarted) throw reconciliationRequiredError(error);
      throw error;
    }
  }, {
    closeFailureRequiresReconciliation: () => submissionStarted,
  });
}

export async function runOperationBatchReconciliation(draft, options = {}) {
  const baseUrl = text(options.baseUrl || process.env.OPERATION_CONSOLE_BASE_URL || "http://172.16.18.198:8020");
  const userDataDir = text(options.userDataDir || process.env.OPERATION_CONSOLE_USER_DATA_DIR || path.join(process.cwd(), ".easy_exam_runtime", "operation-console-profile"));
  const headless = options.headless ?? process.env.OPERATION_CONSOLE_HEADLESS === "1";
  const context = await launchOperationBatchContext(userDataDir, headless, options);
  return runWithOperationBatchContext(context, async (page) => {
    const batchListUrl = `${baseUrl.replace(/\/$/, "")}/batch/batchList`;
    await page.goto(batchListUrl, { waitUntil: "domcontentloaded" });
    await ensureBatchListReady(page, batchListUrl, options);
    return await findCreatedBatchFromList(page, batchListUrl, draftValue(draft, "batchName"), options);
  }, { preserveResultOnCloseFailure: true });
}
