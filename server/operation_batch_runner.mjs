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

export function operationBatchListResultFromRows(rowTexts, batchName, detailUrl) {
  const normalizedName = text(batchName);
  if (!normalizedName) return null;
  const codes = [...new Set((rowTexts || [])
    .filter((rowText) => String(rowText ?? "").split(/\r?\n/).some((line) => text(line) === normalizedName))
    .map(operationBatchCodeFromText)
    .filter(Boolean))];
  if (codes.length === 0) return null;
  if (codes.length > 1) {
    throw new Error(`批次列表中找到多个批次代码：${codes.join("、")}`);
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

async function findCreatedBatchFromList(page, batchListUrl, batchName) {
  const normalizedName = text(batchName);
  if (!normalizedName) return null;
  await page.goto(batchListUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /创建批次/ }).waitFor({ state: "visible", timeout: 30000 });
  const searchInput = page.locator("input[placeholder*=批次代码], input[placeholder*=批次名称]").first();
  await searchInput.waitFor({ state: "visible", timeout: 30000 });
  await searchInput.fill(normalizedName);
  await searchInput.press("Enter");
  await page.waitForFunction((expectedName) => document.body?.innerText?.includes(expectedName), normalizedName, { timeout: 30000 });
  const rowTexts = await page.locator("tbody tr").allInnerTexts();
  return operationBatchListResultFromRows(rowTexts, normalizedName, page.url());
}

export async function resolveSubmittedOperationBatch(page, options = {}) {
  const detailCodeWaitMs = Number(options.detailCodeWaitMs || 60000);
  try {
    await page.waitForFunction(
      () => /\b[A-Z]{3}\d{6}\b/.test(document.body?.innerText || ""),
      null,
      { timeout: detailCodeWaitMs },
    );
    const code = operationBatchCodeFromText(await page.locator("body").innerText());
    if (code) {
      const detailUrl = page.url();
      return {
        operationBatchCode: code,
        batchGuid: new URL(detailUrl).searchParams.get("batch_guid") || "",
        detailUrl,
        status: "created_unpublished",
      };
    }
  } catch {}
  const findFromList = options.findFromList || ((batchListUrl, batchName) => findCreatedBatchFromList(page, batchListUrl, batchName));
  return await findFromList(options.batchListUrl, options.batchName);
}

function reconciliationRequiredError(error) {
  const wrapped = error instanceof Error ? error : new Error(String(error));
  wrapped.code = OPERATION_BATCH_RECONCILIATION_REQUIRED;
  wrapped.status = 409;
  return wrapped;
}

export async function runOperationBatchCreation(draft, options = {}) {
  const { chromium } = await import("playwright").catch((error) => {
    const message = error?.code === "ERR_MODULE_NOT_FOUND"
      ? "未安装 Playwright，不能启动运营控制台浏览器自动化。请先执行 npm install。"
      : (error instanceof Error ? error.message : String(error));
    throw new Error(message);
  });
  const baseUrl = text(options.baseUrl || process.env.OPERATION_CONSOLE_BASE_URL || "http://172.16.18.198:8020");
  const userDataDir = text(options.userDataDir || process.env.OPERATION_CONSOLE_USER_DATA_DIR || path.join(process.cwd(), ".easy_exam_runtime", "operation-console-profile"));
  const headless = options.headless ?? process.env.OPERATION_CONSOLE_HEADLESS === "1";
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: null,
  });
  const page = context.pages()[0] || await context.newPage();
  let submissionStarted = false;
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
  } finally {
    await context.close();
  }
}

export async function runOperationBatchReconciliation(draft, options = {}) {
  const { chromium } = await import("playwright").catch((error) => {
    const message = error?.code === "ERR_MODULE_NOT_FOUND"
      ? "未安装 Playwright，不能启动运营控制台浏览器自动化。请先执行 npm install。"
      : (error instanceof Error ? error.message : String(error));
    throw new Error(message);
  });
  const baseUrl = text(options.baseUrl || process.env.OPERATION_CONSOLE_BASE_URL || "http://172.16.18.198:8020");
  const userDataDir = text(options.userDataDir || process.env.OPERATION_CONSOLE_USER_DATA_DIR || path.join(process.cwd(), ".easy_exam_runtime", "operation-console-profile"));
  const headless = options.headless ?? process.env.OPERATION_CONSOLE_HEADLESS === "1";
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: null,
  });
  const page = context.pages()[0] || await context.newPage();
  try {
    const batchListUrl = `${baseUrl.replace(/\/$/, "")}/batch/batchList`;
    await page.goto(batchListUrl, { waitUntil: "domcontentloaded" });
    await ensureBatchListReady(page, batchListUrl, options);
    return await findCreatedBatchFromList(page, batchListUrl, draftValue(draft, "batchName"));
  } finally {
    await context.close();
  }
}
