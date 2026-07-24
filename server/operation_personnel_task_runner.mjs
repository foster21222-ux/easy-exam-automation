import { createHash } from "node:crypto";
import path from "node:path";
import {
  advanceOperationBatchListPage,
  launchOperationBatchContext,
  openExactOperationBatchCard,
  operationDateTitle,
  runWithOperationBatchContext,
  searchOperationBatchListPages,
  startOperationBatchListSearch,
} from "./operation_batch_runner.mjs";

const RECIPIENT_RULES = Object.freeze({
  test: { toGroup: "演练组", toName: "张乐翔", ccGroup: "", ccCount: 0 },
  production: { toGroup: "拓展二部", toName: "唐润梅", ccGroup: "结算组", ccCount: 4 },
});

function text(value) {
  return String(value ?? "").trim();
}

function numberOrText(value) {
  const normalized = text(value);
  if (!normalized) return "";
  const number = Number(normalized);
  return Number.isFinite(number) ? number : normalized;
}

function normalizeSchedule(raw = {}) {
  return {
    scheduleEntryId: text(raw.scheduleEntryId),
    scheduleCode: numberOrText(raw.scheduleCode),
    subjectCode: text(raw.subjectCode),
    subjectName: text(raw.subjectName),
    start: text(raw.start),
    end: text(raw.end),
    durationMinutes: numberOrText(raw.durationMinutes),
    earlyLoginMinutes: numberOrText(raw.earlyLoginMinutes),
  };
}

function byScheduleCode(left, right) {
  return Number(left.scheduleCode || 0) - Number(right.scheduleCode || 0)
    || text(left.scheduleCode).localeCompare(text(right.scheduleCode));
}

function assertScheduleCodes(schedules = []) {
  const seen = new Set();
  for (const schedule of schedules) {
    const code = text(numberOrText(schedule?.scheduleCode));
    if (!code) throw new Error("考试日程缺少日程代码，不能进行精确比较");
    if (seen.has(code)) throw new Error(`考试日程代码 ${code} 重复，不能进行精确比较`);
    seen.add(code);
  }
}

function normalizePersonnel(raw = {}) {
  return {
    serviceType: text(raw.serviceType),
    platform: text(raw.platform),
    loginMonitoring: text(raw.loginMonitoring),
    monitorRatio: text(raw.monitorRatio),
    candidateBasis: numberOrText(raw.candidateBasis),
    monitorCount: numberOrText(raw.monitorCount),
    earliestLoginMinutes: numberOrText(raw.earliestLoginMinutes),
    trialIncluded: raw.trialIncluded === true,
  };
}

function personnelConfigProjection(raw = {}) {
  const personnel = normalizePersonnel(raw);
  return {
    serviceType: personnel.serviceType,
    platform: personnel.platform,
  };
}

function normalizeDates(raw = {}) {
  return {
    start: text(raw.start),
    end: text(raw.end),
    nameListDue: text(raw.nameListDue),
  };
}

function normalizeRequirements(raw = []) {
  return [...(raw || [])].map((item) => ({
    name: text(item?.name),
    value: text(item?.value),
  }));
}

function normalizeTaskSheet(raw = {}) {
  const condition = (item) => (
    item && typeof item === "object"
      ? { name: text(item.name), satisfied: item.satisfied === true }
      : text(item)
  );
  return {
    type: text(raw.type),
    conditions: [...(raw.conditions || [])].map(condition),
    content: text(raw.content),
  };
}

function normalizeSendRecords(raw = []) {
  return [...(raw || [])].map((item) => ({
    type: text(item?.type),
    sentAt: text(item?.sentAt),
  }));
}

function normalizeDirectoryMatch(raw = {}) {
  const people = (items) => [...(items || [])].map((item) => ({
    group: text(item?.group),
    id: text(item?.id),
    name: text(item?.name),
  }));
  return { to: people(raw.to), cc: people(raw.cc) };
}

export function normalizeOperationPersonnelSnapshot(raw = {}) {
  assertScheduleCodes(raw.schedules || []);
  return {
    batch: {
      code: text(raw.batch?.code),
      projectCode: text(raw.batch?.projectCode),
      projectName: text(raw.batch?.projectName),
      batchName: text(raw.batch?.batchName),
      projectDepartment: text(raw.batch?.projectDepartment),
      projectManager: text(raw.batch?.projectManager),
      systemType: text(raw.batch?.systemType),
      published: raw.batch?.published === true,
    },
    schedules: [...(raw.schedules || [])].map(normalizeSchedule).sort(byScheduleCode),
    personnel: normalizePersonnel(raw.personnel),
    dates: normalizeDates(raw.dates),
    requirements: normalizeRequirements(raw.requirements),
    taskSheet: normalizeTaskSheet(raw.taskSheet),
    sendRecords: normalizeSendRecords(raw.sendRecords),
    directoryMatch: normalizeDirectoryMatch(raw.directoryMatch),
  };
}

function exactGroup(groups, name) {
  const matches = groups.filter((group) => text(group?.name) === name);
  if (matches.length !== 1) {
    throw new Error(`人员目录组“${name}”必须精确匹配 1 个，实际 ${matches.length} 个`);
  }
  return matches[0];
}

function exactPerson(group, name) {
  const matches = [...(group.people || [])].filter((person) => text(person?.name) === name);
  if (matches.length !== 1) {
    throw new Error(`${text(group.name)}中的“${name}”必须精确匹配 1 人，实际 ${matches.length} 人`);
  }
  return matches[0];
}

function recipient(person) {
  return { id: text(person?.id), name: text(person?.name) };
}

export function matchOperationPersonnelRecipients(options = {}) {
  const environment = text(options.environment);
  const rule = RECIPIENT_RULES[environment];
  if (!rule) throw new Error(`未知运控收件环境：${environment || "空"}`);
  const groups = [...(options.groups || [])];
  const toGroup = exactGroup(groups, rule.toGroup);
  const to = [recipient(exactPerson(toGroup, rule.toName))];
  if (!rule.ccGroup) return { to, cc: [] };
  const ccGroup = exactGroup(groups, rule.ccGroup);
  const cc = [...(ccGroup.people || [])].map(recipient);
  if (cc.length !== rule.ccCount) {
    throw new Error(`${rule.ccGroup}必须精确匹配 ${rule.ccCount} 人，实际 ${cc.length} 人`);
  }
  if (new Set(cc.map((item) => item.id)).size !== cc.length
    || new Set(cc.map((item) => item.name)).size !== cc.length) {
    throw new Error(`${rule.ccGroup}存在重复人员，不能精确匹配`);
  }
  return { to, cc };
}

function directoryMatch(environment, matched) {
  const rule = RECIPIENT_RULES[environment];
  return {
    to: matched.to.map((item) => ({ group: rule.toGroup, ...item })),
    cc: matched.cc.map((item) => ({ group: rule.ccGroup, ...item })),
  };
}

function batchCodeColumn(headers = []) {
  const matches = headers
    .map((header, index) => ({ header: text(header), index }))
    .filter((item) => item.header === "批次代码");
  if (matches.length !== 1) {
    throw new Error(`运控人员任务检查阻断：批次列表必须有唯一“批次代码”列，实际 ${matches.length} 列`);
  }
  return matches[0].index;
}

async function readOperationPersonnelBatchPages(page, batchListUrl, batchCode, options = {}) {
  const result = await searchOperationBatchListPages(page, batchListUrl, batchCode, options);
  return {
    headers: result.headers,
    pages: result.pages.map((rows, pageIndex) => rows.map((cells) => ({
      cells: cells.map(text),
      pageNumber: pageIndex + 1,
    }))),
  };
}

function exactBatchRow(result = {}, batchCode) {
  const codeColumn = batchCodeColumn(result.headers);
  const matches = (result.pages || [])
    .flat()
    .filter((row) => text(row?.cells?.[codeColumn]) === batchCode);
  if (!matches.length) throw new Error(`未找到批次代码 ${batchCode}`);
  if (matches.length !== 1) throw new Error(`批次代码 ${batchCode} 精确匹配到 ${matches.length} 行`);
  return { ...matches[0], codeColumn };
}

async function openOperationPersonnelBatchRow(page, row, context = {}) {
  const { batchListUrl, batchCode, options = {} } = context;
  let {
    headers,
    layout,
    rows,
  } = await startOperationBatchListSearch(page, batchListUrl, batchCode, options);
  const codeColumn = batchCodeColumn(headers);
  for (let pageNumber = 1; pageNumber < Number(row.pageNumber || 1); pageNumber += 1) {
    rows = await advanceOperationBatchListPage(
      page,
      pageNumber,
      rows,
      batchListUrl,
      options,
    );
    if (!rows) throw new Error(`未能重新定位批次代码 ${batchCode} 所在的第 ${row.pageNumber} 页`);
  }
  if (layout === "cards") {
    await openExactOperationBatchCard(page, batchCode);
    if (typeof page.waitForLoadState === "function") {
      await page.waitForLoadState("domcontentloaded");
    }
    return;
  }
  const locators = await page.locator("tbody tr").all();
  const exact = [];
  for (const locator of locators) {
    const cells = (await locator.locator("td").allInnerTexts()).map(text);
    if (cells[codeColumn] === batchCode) exact.push(locator);
  }
  if (exact.length !== 1) {
    throw new Error(`重新打开详情前，批次代码 ${batchCode} 精确匹配到 ${exact.length} 行`);
  }
  const codeCell = exact[0].locator("td").nth(codeColumn);
  const detailLink = codeCell.getByRole("link", { name: batchCode, exact: true });
  if (await detailLink.count() !== 1) {
    throw new Error(`批次代码 ${batchCode} 单元格缺少唯一详情链接`);
  }
  await detailLink.click();
  if (typeof page.waitForLoadState === "function") {
    await page.waitForLoadState("domcontentloaded");
  }
}

const BATCH_IDENTITY_FIELDS = [
  "code",
  "projectCode",
  "projectName",
  "batchName",
  "projectDepartment",
  "projectManager",
  "systemType",
];

const TEST_IGNORED_BATCH_IDENTITY_FIELDS = new Set([
  "projectCode",
  "projectName",
]);

function verifyBatchDetailIdentity(expected = {}, actual = {}, environment = "") {
  const conflicts = BATCH_IDENTITY_FIELDS
    .filter((key) => !(
      environment === "test"
      && TEST_IGNORED_BATCH_IDENTITY_FIELDS.has(key)
    ))
    .filter((key) => key === "code" || text(expected[key]))
    .filter((key) => text(expected[key]) !== text(actual[key]))
    .map((key) => `${key} 期望 ${text(expected[key]) || "空"}，实际 ${text(actual[key]) || "空"}`);
  if (conflicts.length) {
    throw new Error(`批次详情身份不一致：${conflicts.join("；")}`);
  }
}

function visibleHeaderField(value, label) {
  const normalized = text(value).replace(/\s+/g, " ");
  const labels = ["业务部归属", "业务负责人", "项目部归属", "项目经理", "考试日期"];
  const otherLabels = labels.filter((item) => item !== label).join("|");
  const match = normalized.match(new RegExp(
    `${label}[：:]\\s*(.*?)(?=\\s*(?:\\||(?:${otherLabels})[：:])|$)`,
  ));
  return text(match?.[1]);
}

export function operationPersonnelBatchIdentityFromVisibleRaw(raw = {}) {
  const titleUnique = Number(raw.titleCount) === 1;
  const projectLinksUnique = Number(raw.projectLinkCount) === 2;
  const headerUnique = Number(raw.headerInfoCount) === 1;
  const statusUnique = Number(raw.statusCount) === 1;
  const systemTypeUnique = Number(raw.systemTypeCount) === 1 && Boolean(text(raw.systemType));
  const projectDepartment = headerUnique
    ? visibleHeaderField(raw.headerInfoText, "项目部归属")
    : "";
  const projectManager = headerUnique
    ? visibleHeaderField(raw.headerInfoText, "项目经理")
    : "";
  const checks = [
    ["批次代码", titleUnique && Boolean(text(raw.code))],
    ["批次名称", titleUnique && Boolean(text(raw.batchName))],
    ["项目编码", projectLinksUnique && Boolean(text(raw.projectCode))],
    ["项目名称", projectLinksUnique && Boolean(text(raw.projectName))],
    ["项目部归属", Boolean(projectDepartment)],
    ["项目经理", Boolean(projectManager)],
    ["系统类型", systemTypeUnique],
    ["发布状态", statusUnique],
  ];
  const missing = checks.filter(([, present]) => !present).map(([label]) => label);
  return {
    batch: {
      code: titleUnique ? text(raw.code) : "",
      projectCode: projectLinksUnique ? text(raw.projectCode) : "",
      projectName: projectLinksUnique ? text(raw.projectName) : "",
      batchName: titleUnique ? text(raw.batchName) : "",
      projectDepartment,
      projectManager,
      systemType: systemTypeUnique ? text(raw.systemType) : "",
      published: statusUnique && [...(raw.statusTags || [])].map(text).includes("已发布"),
    },
    evidence: { present: missing.length === 0, missing },
  };
}

const VISIBLE_PERSONNEL_REQUIREMENT_NAMES = Object.freeze([
  "正式考试-最早登录系统时间",
  "正式考试-监考人员安排",
  "正式考试-监考人员数量",
  "正式考试-监考人员比例",
  "正式考试-监考登录监控",
]);

function visibleLineValue(lines, label) {
  const values = [];
  const prefix = `${label}：`;
  const alternatePrefix = `${label}:`;
  for (let index = 0; index < lines.length; index += 1) {
    const line = text(lines[index]).replace(/\s+/g, " ");
    if (line === label || line === prefix || line === alternatePrefix) {
      const next = text(lines[index + 1]).replace(/\s+/g, " ");
      if (next) values.push(next);
    } else if (line.startsWith(prefix) || line.startsWith(alternatePrefix)) {
      values.push(text(line.slice(
        line.startsWith(prefix) ? prefix.length : alternatePrefix.length,
      )));
    }
  }
  return values.length === 1 ? values[0] : "";
}

export function operationPersonnelPageFromVisibleRaw(raw = {}) {
  const lines = [...(raw.lines || [])].map(text).filter(Boolean);
  const dateRange = visibleLineValue(lines, "人员落实日期");
  const [start = "", end = "", ...extraDates] = dateRange.split("~").map(text);
  const platform = visibleLineValue(lines, "人员落实平台");
  const monitorType = visibleLineValue(lines, "监考类型");
  const nameListDue = visibleLineValue(lines, "人员名单提交日期");
  const requirements = VISIBLE_PERSONNEL_REQUIREMENT_NAMES.map((name) => ({
    name,
    value: visibleLineValue(lines, name),
  }));
  const requirement = (name) => requirements.find((item) => item.name === name)?.value || "";
  const earliestLoginMinutes = requirement("正式考试-最早登录系统时间")
    .match(/前\s*(\d+)\s*分钟/)?.[1] || "";
  const personnelMissing = [
    ["人员落实平台", platform],
    ["监考类型", monitorType === "分散监考"],
    ["正式考试-最早登录系统时间", earliestLoginMinutes],
    ["正式考试-监考人员数量", requirement("正式考试-监考人员数量")],
    ["正式考试-监考人员比例", requirement("正式考试-监考人员比例")],
    ["正式考试-监考登录监控", requirement("正式考试-监考登录监控")],
  ].filter(([, present]) => !present).map(([label]) => label);
  const datesMissing = [
    ["人员落实开始日期", start],
    ["人员落实结束日期", end && extraDates.length === 0],
    ["人员名单提交日期", nameListDue],
  ].filter(([, present]) => !present).map(([label]) => label);
  const requirementsMissing = requirements
    .filter((item) => !item.value)
    .map((item) => item.name);
  return {
    personnel: normalizePersonnel({
      serviceType: monitorType === "分散监考" ? "ATA 监考－分散在线监考" : "",
      platform,
      loginMonitoring: requirement("正式考试-监考登录监控"),
      monitorRatio: requirement("正式考试-监考人员比例"),
      candidateBasis: "",
      monitorCount: requirement("正式考试-监考人员数量"),
      earliestLoginMinutes,
      trialIncluded: false,
    }),
    dates: normalizeDates({ start, end, nameListDue }),
    requirements,
    evidence: {
      personnel: {
        present: personnelMissing.length === 0,
        missing: personnelMissing,
      },
      dates: {
        present: datesMissing.length === 0,
        missing: datesMissing,
      },
      requirements: {
        present: requirementsMissing.length === 0,
        missing: requirementsMissing,
      },
    },
  };
}

function visibleRowMap(rows = []) {
  const output = new Map();
  for (const row of rows) {
    const key = text(row?.[0]);
    if (!key) continue;
    if (output.has(key)) {
      throw new Error(`运控人员任务检查阻断：任务单字段“${key}”重复`);
    }
    output.set(key, text(row?.[1]));
  }
  return output;
}

function requiredHeaderIndex(headers = [], label) {
  const matches = headers
    .map((header, index) => ({ header: text(header), index }))
    .filter((item) => item.header === label);
  if (matches.length !== 1) {
    throw new Error(`运控人员任务检查阻断：任务单日程表头“${label}”必须精确匹配 1 列`);
  }
  return matches[0].index;
}

function visibleScheduleRange(value) {
  const [startValue, endValue, ...extra] = text(value).split("~").map(text);
  if (!startValue || !endValue || extra.length) {
    throw new Error(`运控人员任务检查阻断：任务单日程“${text(value)}”格式无效`);
  }
  const startDate = startValue.match(/^(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}$/)?.[1];
  const end = /^\d{2}:\d{2}$/.test(endValue) && startDate
    ? `${startDate} ${endValue}`
    : endValue;
  return { start: startValue, end };
}

function visibleConditionSatisfied(value) {
  const normalized = text(value);
  if (/未设置|未发布|已结束/.test(normalized)) return false;
  return /已设置|未结束|已发布/.test(normalized);
}

export function operationPersonnelSendRecordsFromVisibleRows(rows = []) {
  const visibleRows = [...rows];
  if (visibleRows.length < 1
    || text(visibleRows[0]?.[0]) !== "发送时间"
    || text(visibleRows[0]?.[1]) !== "变更内容") {
    throw new Error("运控人员任务检查阻断：发送记录表头无效");
  }
  return visibleRows.slice(1).map((row) => {
    const sentAt = text(row?.[0]);
    const type = text(row?.[1]);
    if (!sentAt || !["首次发送", "再次发送"].includes(type)) {
      throw new Error("运控人员任务检查阻断：发送记录行无效");
    }
    return { type, sentAt };
  });
}

export function operationPersonnelDirectoryPeopleFromVisibleTexts(values = []) {
  const seen = new Set();
  return [...values].flatMap((value) => {
    const match = text(value).match(/^([^\s()]+@[^\s()]+)\s+\(([^()]+)\)$/);
    if (!match) return [];
    const id = text(match[1]);
    const name = text(match[2]);
    const key = `${id}\0${name}`;
    if (!id || !name || seen.has(key)) return [];
    seen.add(key);
    return [{ id, name }];
  });
}

export function operationPersonnelTaskSheetFromVisibleRaw(raw = {}) {
  const values = visibleRowMap(raw.keyValueRows);
  if (values.get("监考类型") !== "分散监考"
    || values.get("正式考试-监考人员安排") !== "ATA监考-分散") {
    throw new Error("运控人员任务检查阻断：任务单不是 ATA 分散在线监考");
  }

  const scheduleHeaders = [...(raw.scheduleHeaders || [])].map(text);
  const scheduleIndexes = Object.fromEntries([
    "日程代码",
    "日程",
    "时长(分钟)",
    "科目名称",
    "考生提前登录(分钟)",
  ].map((label) => [label, requiredHeaderIndex(scheduleHeaders, label)]));
  const schedules = [...(raw.scheduleRows || [])].map((row) => {
    const range = visibleScheduleRange(row[scheduleIndexes["日程"]]);
    return {
      scheduleCode: row[scheduleIndexes["日程代码"]],
      subjectName: row[scheduleIndexes["科目名称"]],
      start: range.start,
      end: range.end,
      durationMinutes: row[scheduleIndexes["时长(分钟)"]],
      earlyLoginMinutes: row[scheduleIndexes["考生提前登录(分钟)"]],
    };
  });

  const sendRecords = operationPersonnelSendRecordsFromVisibleRows(
    raw.sendRecordRows,
  );
  const loginMinutes = values.get("正式考试-最早登录系统时间")
    ?.match(/前\s*(\d+)\s*分钟/)?.[1] || "";
  const requirementNames = [
    "正式考试-最早登录系统时间",
    "正式考试-监考人员安排",
    "正式考试-监考人员数量",
    "正式考试-监考人员比例",
    "正式考试-监考登录监控",
  ];
  const conditions = [...(raw.conditions || [])].map((name) => ({
    name: text(name),
    satisfied: visibleConditionSatisfied(name),
  }));
  const [combinedStart = "", combinedEnd = ""] = text(values.get("人员落实日期"))
    .split("~")
    .map(text);

  return normalizeOperationPersonnelSnapshot({
    batch: {
      projectCode: values.get("项目编码"),
      projectName: values.get("项目名称"),
      batchName: values.get("批次名称"),
      projectDepartment: values.get("项目部归属"),
      projectManager: values.get("项目经理"),
      systemType: values.get("系统类型"),
      published: conditions.some((item) => (
        item.satisfied
        && item.name.includes("批次状态")
        && item.name.includes("已发布")
      )),
    },
    schedules,
    personnel: {
      serviceType: "ATA 监考－分散在线监考",
      platform: values.get("人员落实平台"),
      loginMonitoring: values.get("正式考试-监考登录监控"),
      monitorRatio: values.get("正式考试-监考人员比例"),
      monitorCount: values.get("正式考试-监考人员数量"),
      earliestLoginMinutes: loginMinutes,
      trialIncluded: false,
    },
    dates: {
      start: values.get("人员落实开始日期") || combinedStart,
      end: values.get("人员落实结束日期") || combinedEnd,
      nameListDue: values.get("人员名单提交日期"),
    },
    requirements: requirementNames.map((name) => ({
      name,
      value: values.get(name),
    })),
    taskSheet: {
      type: "分散在线监考",
      conditions,
      content: text(raw.content),
    },
    sendRecords,
  });
}

export async function openVisiblePersonnelTaskSheet(page, instruction = {}, options = {}) {
  const batchName = text(instruction.batch?.batchName || instruction.batchName);
  if (!batchName) throw new Error("缺少运控批次名称");
  const baseUrl = text(
    options.baseUrl
    || process.env.OPERATION_CONSOLE_BASE_URL
    || "http://172.16.18.198:8020",
  );
  await page.goto(`${baseUrl.replace(/\/$/, "")}/job/decentralizedInvigilate`, {
    waitUntil: "domcontentloaded",
  });
  const search = page.locator(
    'input[placeholder="请输入批次代码、批次名称、项目经理"]:visible',
  );
  if (await search.count() === 0) {
    await search.waitFor({ state: "visible", timeout: 10_000 });
  }
  if (await search.count() !== 1) {
    throw operationControlError("分散在线监考任务筛选框", await search.count());
  }
  await search.fill(batchName);
  await page.getByText(batchName, { exact: true }).first().waitFor({
    state: "visible",
    timeout: 10_000,
  });

  const tables = page.locator("table:visible");
  const matches = [];
  for (let index = 0; index < await tables.count(); index += 1) {
    const table = tables.nth(index);
    const headers = (await table.locator("thead th").allInnerTexts()).map(text);
    if (headers.includes("批次名称")) {
      matches.push({ table, headers });
    }
  }
  if (matches.length !== 1) {
    throw operationControlError("分散在线监考任务主表", matches.length);
  }
  const { table, headers } = matches[0];
  const batchNameIndex = headers.indexOf("批次名称");
  const rows = table.locator("tbody tr");
  const exactRows = [];
  for (let index = 0; index < await rows.count(); index += 1) {
    const cells = (await rows.nth(index).locator("td").allInnerTexts()).map(text);
    if (cells[batchNameIndex] === batchName) exactRows.push(index);
  }
  if (exactRows.length !== 1) {
    throw new Error(`运控批次名称 ${batchName} 精确匹配到 ${exactRows.length} 行`);
  }
  const action = page.locator(".ant-table-fixed-right table:visible tbody tr")
    .nth(exactRows[0])
    .getByText("发送任务单", { exact: true });
  await clickUniqueVisible(action, "分散在线监考发送任务单入口");
  const taskSheet = page.locator(".ant-modal:visible").filter({
    hasText: "任务单发送需满足以下条件",
  });
  await taskSheet.first().waitFor({
    state: "visible",
    timeout: 10_000,
  });
  if (await taskSheet.count() !== 1) {
    throw operationControlError("分散在线监考任务单弹窗", await taskSheet.count());
  }
}

export async function readVisiblePersonnelTaskSheet(page) {
  const dialogs = page.locator(".ant-modal:visible").filter({
    hasText: "任务单发送需满足以下条件",
  });
  const dialogCount = await dialogs.count();
  if (dialogCount !== 1) {
    throw operationControlError("分散在线监考任务单弹窗", dialogCount);
  }
  if (typeof page.waitForFunction === "function") {
    await page.waitForFunction(() => {
      const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
      const visible = (node) => Boolean(
        node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length),
      );
      const modal = [...document.querySelectorAll(".ant-modal")].find((node) => (
        visible(node)
        && clean(node.innerText).includes("任务单发送需满足以下条件")
      ));
      if (!modal) return false;
      const rowValue = (label) => {
        for (const row of modal.querySelectorAll(".order-item, .m_bottom.ant-row")) {
          if (!visible(row)) continue;
          const title = row.querySelector(":scope > .order-title-1");
          if (clean(title?.textContent).replace(/[：:]\s*$/, "") !== label) continue;
          const value = [...row.children]
            .filter((node) => node !== title)
            .map((node) => clean(node.textContent))
            .find(Boolean);
          return value || "";
        }
        return "";
      };
      const schedule = [...modal.querySelectorAll("table")].find((table) => {
        const headers = [...table.querySelectorAll("thead th")].map((cell) => clean(cell.textContent));
        return visible(table) && headers.includes("日程代码") && headers.includes("科目名称");
      });
      return Boolean(
        rowValue("批次名称")
        && rowValue("批次名称") !== "—"
        && rowValue("正式考试-监考人员安排")
        && rowValue("正式考试-监考人员安排") !== "—"
        && schedule,
      );
    }, undefined, { timeout: 10_000 });
  }
  const raw = await page.evaluate(() => {
    const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
    const visible = (node) => Boolean(
      node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length),
    );
    const modals = [...document.querySelectorAll(".ant-modal")].filter((node) => (
      visible(node)
      && clean(node.innerText).includes("任务单发送需满足以下条件")
    ));
    const modal = modals[0];
    const tables = [...modal.querySelectorAll("table")].filter(visible);
    const cells = (row) => [...row.querySelectorAll("th, td")].map((cell) => clean(cell.textContent));
    const tableRows = (table) => [...table.querySelectorAll("tr")].filter(visible).map(cells);
    const sendTable = tables.find((table) => {
      const first = tableRows(table)[0] || [];
      return first[0] === "发送时间" && first[1] === "变更内容";
    });
    const scheduleTable = tables.find((table) => {
      const headers = [...table.querySelectorAll("thead th")].map((cell) => clean(cell.textContent));
      return headers.includes("日程代码")
        && headers.includes("日程")
        && headers.includes("科目名称");
    });
    const tableKeyValueRows = tables
      .filter((table) => table !== sendTable && table !== scheduleTable)
      .flatMap(tableRows)
      .filter((row) => row.length === 2);
    const layoutKeyValueRows = [...modal.querySelectorAll(".order-item, .m_bottom.ant-row")]
      .filter(visible)
      .flatMap((row) => {
        const title = row.querySelector(":scope > .order-title-1");
        const label = clean(title?.textContent).replace(/[：:]\s*$/, "");
        if (!label) return [];
        const value = [...row.children]
          .filter((node) => node !== title)
          .map((node) => clean(node.textContent))
          .find(Boolean) || "";
        return [[label, value]];
      });
    const keyValueRows = layoutKeyValueRows.length
      ? layoutKeyValueRows
      : tableKeyValueRows;
    const scheduleHeaders = scheduleTable
      ? [...scheduleTable.querySelectorAll("thead th")].map((cell) => clean(cell.textContent))
      : [];
    const scheduleRows = scheduleTable
      ? [...scheduleTable.querySelectorAll("tbody tr")].filter(visible).map(cells)
      : [];
    const timelineSendRows = [...modal.querySelectorAll(".ant-timeline-item-content")]
      .filter(visible)
      .flatMap((node) => {
        const match = clean(node.textContent).match(
          /^(首次发送|再次发送)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})$/,
        );
        return match ? [[match[2], match[1]]] : [];
      });
    const sendRecordRows = sendTable
      ? tableRows(sendTable)
      : [["发送时间", "变更内容"], ...timelineSendRows];
    const modalText = String(modal.innerText ?? "");
    const conditions = [...modalText.matchAll(
      /\d+、\s*(.*?)(?=\s*\d+、|基本信息)/gs,
    )].map((match) => clean(match[1])).filter(Boolean);
    return {
      conditions,
      keyValueRows,
      scheduleHeaders,
      scheduleRows,
      sendRecordRows,
      content: JSON.stringify({
        conditions,
        keyValueRows,
        scheduleHeaders,
        scheduleRows,
      }),
    };
  });
  return operationPersonnelTaskSheetFromVisibleRaw(raw);
}

async function readVisibleOperationPersonnelSnapshot(page) {
  if (typeof page.evaluate !== "function") return {};
  const snapshot = await page.evaluate(() => {
    const clean = (value) => String(value ?? "").trim();
    const visible = (node) => Boolean(node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length));
    const field = (label) => {
      const labels = [...document.querySelectorAll("label, .ant-form-item-label")];
      const node = labels.find((item) => visible(item) && clean(item.textContent).replace(/[：:]\s*$/, "") === label);
      const container = node?.closest(".ant-form-item") || node?.parentElement;
      const control = container?.querySelector("input, textarea, .ant-select-selection-selected-value, .ant-select-selection-item");
      return {
        present: Boolean(node && control && visible(control)),
        value: clean(control?.value ?? control?.textContent ?? ""),
      };
    };
    const table = (requiredHeaders) => {
      for (const node of document.querySelectorAll("table")) {
        if (!visible(node)) continue;
        const headers = [...node.querySelectorAll("thead th")].map((item) => clean(item.textContent));
        if (!requiredHeaders.every((header) => headers.includes(header))) continue;
        return {
          present: true,
          rows: [...node.querySelectorAll("tbody tr")].map((row) => ({
            ...Object.fromEntries(
              [...row.querySelectorAll("td")].map((cell, index) => [headers[index], clean(cell.textContent)]),
            ),
            __scheduleEntryId: clean(row.getAttribute("data-schedule-entry-id")),
          })),
        };
      }
      return { present: false, rows: [] };
    };
    const labels = {
      batch: ["批次代码", "项目编码", "项目名称", "批次名称", "项目部归属", "项目经理", "系统类型", "发布状态"],
      personnel: ["人员服务类型", "人员落实平台", "监考登录监控", "监考比例", "监考人数计算基数", "监考人数", "最早登录系统时间", "试考监考"],
      dates: ["人员落实开始日期", "人员落实结束日期", "人员名单提交日期"],
      taskSheet: ["任务单类型", "任务单内容"],
    };
    const fields = Object.fromEntries(
      Object.values(labels).flat().map((label) => [label, field(label)]),
    );
    const evidenceForFields = (section) => {
      const missing = labels[section].filter((label) => !fields[label].present);
      return { present: missing.length === 0, missing };
    };
    const scheduleTable = table(["日程代码", "开始时间"]);
    const requirementTable = table(["考务需求"]);
    const conditionTable = table(["发送条件"]);
    const sendRecordTable = table(["发送类型", "发送时间"]);
    const schedules = scheduleTable.rows.map((row) => ({
      scheduleEntryId: row.__scheduleEntryId || row["日程条目ID"] || row["日程稳定ID"],
      scheduleCode: row["日程代码"],
      subjectCode: row["科目代码"],
      subjectName: row["科目名称"],
      start: row["开始时间"],
      end: row["结束时间"],
      durationMinutes: row["时长"],
      earlyLoginMinutes: row["提前登录分钟数"],
    }));
    const requirements = requirementTable.rows.map((row) => ({
      name: row["考务需求"],
      value: row["需求内容"] || row["配置"],
    }));
    const sendRecords = sendRecordTable.rows.map((row) => ({
      type: row["发送类型"],
      sentAt: row["发送时间"],
    }));
    const groupNodes = [...document.querySelectorAll("[data-directory-group]")].filter(visible);
    const groups = groupNodes.map((group) => ({
      name: clean(group.getAttribute("data-directory-group")),
      people: [...group.querySelectorAll("[data-person-id]")].filter(visible).map((person) => ({
        id: clean(person.getAttribute("data-person-id")),
        name: clean(person.getAttribute("data-person-name") || person.textContent),
      })),
    }));
    const currentTitles = [...document.querySelectorAll(".header-title")].filter(visible);
    const currentTitle = currentTitles.length === 1 ? currentTitles[0] : null;
    const currentHeaderInfos = [...document.querySelectorAll(".header-info")].filter(visible);
    const currentHeaderInfo = currentHeaderInfos.length === 1 ? currentHeaderInfos[0] : null;
    const projectLinks = currentHeaderInfo
      ? [...currentHeaderInfo.querySelectorAll(".hover-link")].filter(visible)
      : [];
    const currentHeaderRoot = currentTitle?.parentElement?.parentElement;
    const statusNodes = currentHeaderRoot
      ? [...currentHeaderRoot.querySelectorAll(".right p")].filter(
        (node) => visible(node) && clean(node.textContent).startsWith("批次状态"),
      )
      : [];
    const systemTypeNodes = [...document.querySelectorAll(".basic-item")].filter((node) => {
      const label = node.querySelector(".basic-title-1");
      return visible(node) && clean(label?.textContent).replace(/[：:]\s*$/, "") === "系统类型";
    });
    const currentBatchRaw = {
      titleCount: currentTitles.length,
      code: clean(currentTitle?.querySelector(":scope > span")?.textContent),
      batchName: clean(currentTitle?.querySelector(":scope > label")?.textContent),
      projectLinkCount: projectLinks.length,
      projectCode: clean(projectLinks[0]?.textContent),
      projectName: clean(projectLinks[1]?.textContent),
      headerInfoCount: currentHeaderInfos.length,
      headerInfoText: clean(currentHeaderInfo?.textContent),
      statusCount: statusNodes.length,
      statusTags: statusNodes.length === 1
        ? [...statusNodes[0].querySelectorAll(".ant-tag")].map((node) => clean(node.textContent))
        : [],
      systemTypeCount: systemTypeNodes.length,
      systemType: systemTypeNodes.length === 1
        ? clean(systemTypeNodes[0].querySelector("label")?.textContent)
        : "",
    };
    return {
      __currentBatchRaw: currentBatchRaw,
      batch: {
        code: fields["批次代码"].value,
        projectCode: fields["项目编码"].value,
        projectName: fields["项目名称"].value,
        batchName: fields["批次名称"].value,
        projectDepartment: fields["项目部归属"].value,
        projectManager: fields["项目经理"].value,
        systemType: fields["系统类型"].value,
        published: fields["发布状态"].value === "已发布",
      },
      schedules,
      personnel: {
        serviceType: fields["人员服务类型"].value,
        platform: fields["人员落实平台"].value,
        loginMonitoring: fields["监考登录监控"].value,
        monitorRatio: fields["监考比例"].value,
        candidateBasis: fields["监考人数计算基数"].value,
        monitorCount: fields["监考人数"].value,
        earliestLoginMinutes: fields["最早登录系统时间"].value,
        trialIncluded: fields["试考监考"].value === "是",
      },
      dates: {
        start: fields["人员落实开始日期"].value,
        end: fields["人员落实结束日期"].value,
        nameListDue: fields["人员名单提交日期"].value,
      },
      requirements,
      taskSheet: {
        type: fields["任务单类型"].value,
        conditions: conditionTable.rows.map((row) => ({
          name: row["发送条件"],
          satisfied: ["已满足", "已完成", "通过", "是"].includes(
            row["状态"] || row["是否满足"] || row["结果"],
          ),
        })),
        content: fields["任务单内容"].value,
      },
      sendRecords,
      directoryGroups: groups,
      evidence: {
        batch: evidenceForFields("batch"),
        schedules: {
          present: scheduleTable.present,
          missing: scheduleTable.present ? [] : ["考试日程表"],
        },
        personnel: evidenceForFields("personnel"),
        dates: evidenceForFields("dates"),
        requirements: {
          present: requirementTable.present,
          missing: requirementTable.present ? [] : ["考务需求表"],
        },
        taskSheet: {
          present: evidenceForFields("taskSheet").present && conditionTable.present,
          missing: [
            ...evidenceForFields("taskSheet").missing,
            ...(conditionTable.present ? [] : ["分散在线监考任务单"]),
          ],
        },
        sendRecords: {
          present: sendRecordTable.present,
          missing: sendRecordTable.present ? [] : ["发送记录表"],
        },
        directoryGroups: {
          present: groupNodes.length > 0,
          missing: groupNodes.length > 0 ? [] : ["人员目录"],
        },
      },
    };
  });
  if (Object.values(snapshot.__currentBatchRaw || {}).some((value) => (
    Array.isArray(value) ? value.length > 0 : Boolean(value)
  ))) {
    const current = operationPersonnelBatchIdentityFromVisibleRaw(snapshot.__currentBatchRaw);
    snapshot.batch = current.batch;
    snapshot.evidence.batch = current.evidence;
  }
  delete snapshot.__currentBatchRaw;
  return snapshot;
}

function assertVisibleSection(snapshot, key) {
  const evidence = snapshot?.evidence?.[key];
  if (evidence?.present === true) return;
  const missing = (evidence?.missing || [key]).map(text).filter(Boolean).join("、");
  const error = new Error(`运控人员任务检查阻断：无法确认可见页面中的${missing}`);
  error.code = "OPERATION_PERSONNEL_INSPECTION_BLOCKED";
  error.status = 409;
  throw error;
}

async function locateOperationPersonnelBatch(page, instruction = {}, options = {}) {
  const batchCode = text(instruction.batch?.code || instruction.batchCode);
  if (!batchCode) throw new Error("缺少运控批次代码");
  const baseUrl = text(options.baseUrl || process.env.OPERATION_CONSOLE_BASE_URL || "http://172.16.18.198:8020");
  const batchListUrl = `${baseUrl.replace(/\/$/, "")}/batch/batchList`;
  const batchPages = await (
    options.readBatchPages
    || ((actualPage) => readOperationPersonnelBatchPages(actualPage, batchListUrl, batchCode, options))
  )(page, instruction);
  const selectedRow = exactBatchRow(batchPages, batchCode);
  await (options.openBatchRow || openOperationPersonnelBatchRow)(page, selectedRow, {
    batchListUrl,
    batchCode,
    options,
  });
  return { batchCode };
}

export async function inspectOperationPersonnelTask(page, instruction = {}, options = {}) {
  const { batchCode } = await locateOperationPersonnelBatch(page, instruction, options);

  let visibleSnapshot;
  const visible = async () => {
    visibleSnapshot ||= await (
      options.readVisibleSnapshot || readVisibleOperationPersonnelSnapshot
    )(page, instruction);
    return visibleSnapshot;
  };
  const read = async (optionName, key, fallback) => {
    if (typeof options[optionName] === "function") {
      return options[optionName](page, instruction);
    }
    const snapshot = await visible();
    assertVisibleSection(snapshot, key);
    return snapshot[key] ?? fallback;
  };
  const batch = await read("readBatch", "batch", {});
  verifyBatchDetailIdentity(
    { ...(instruction.batch || {}), code: batchCode },
    batch,
    text(instruction.environment),
  );
  const legacySectionReaders = [
    "readSchedules",
    "readPersonnel",
    "readDates",
    "readRequirements",
    "readTaskSheet",
    "readSendRecords",
  ].some((name) => typeof options[name] === "function")
    || typeof options.readVisibleSnapshot === "function";
  if (!legacySectionReaders) {
    await (
      options.openPersonnelTaskSheet
      || ((actualPage, actualInstruction) => (
        openVisiblePersonnelTaskSheet(actualPage, actualInstruction, options)
      ))
    )(page, instruction);
    const taskSnapshot = normalizeOperationPersonnelSnapshot(await (
      options.readPersonnelTaskSheetSnapshot || readVisiblePersonnelTaskSheet
    )(page, instruction));
    const directoryProbeSummary = text(
      instruction.directoryProbeSummary || instruction.changeSummary,
    );
    let matched = { to: [], cc: [] };
    if (directoryProbeSummary) {
      let groups;
      if (options.openPersonnelDirectory || options.readDirectoryGroups) {
        await options.openPersonnelDirectory?.(page, instruction);
        groups = await (
          options.readDirectoryGroups
          || ((actualPage, actualInstruction) => (
            VISIBLE_OPERATION_PERSONNEL_ADAPTER.readDirectoryGroups(
              actualPage,
              actualInstruction,
            )
          ))
        )(page, instruction);
      } else {
        groups = await inspectVisiblePersonnelDirectory(page, instruction);
      }
      matched = matchOperationPersonnelRecipients({
        environment: text(instruction.environment),
        groups,
      });
    }
    return normalizeOperationPersonnelSnapshot({
      ...taskSnapshot,
      batch: {
        ...taskSnapshot.batch,
        ...batch,
        published: taskSnapshot.batch.published === true || batch.published === true,
      },
      directoryMatch: directoryProbeSummary
        ? directoryMatch(text(instruction.environment), matched)
        : { to: [], cc: [] },
    });
  }
  const groups = await read("readDirectoryGroups", "directoryGroups", []);
  const environment = text(instruction.environment);
  const matched = matchOperationPersonnelRecipients({ environment, groups });
  return normalizeOperationPersonnelSnapshot({
    batch,
    schedules: await read("readSchedules", "schedules", []),
    personnel: await read("readPersonnel", "personnel", {}),
    dates: await read("readDates", "dates", {}),
    requirements: await read("readRequirements", "requirements", []),
    taskSheet: await read("readTaskSheet", "taskSheet", {}),
    sendRecords: await read("readSendRecords", "sendRecords", []),
    directoryMatch: directoryMatch(environment, matched),
  });
}

function flatten(value, prefix = "", output = new Map()) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const key = prefix === "schedules" && item && typeof item === "object"
        ? text(item.scheduleCode)
        : String(index);
      flatten(item, prefix ? `${prefix}.${key}` : key, output);
    });
  } else if (value && typeof value === "object") {
    Object.keys(value).sort().forEach((key) => {
      if (prefix === "schedules" && key === "scheduleCode") return;
      flatten(value[key], prefix ? `${prefix}.${key}` : key, output);
    });
  } else if (prefix) {
    output.set(prefix, value);
  }
  return output;
}

function sameValue(left, right) {
  return Object.is(left, right);
}

function empty(value) {
  return value === undefined || value === null || value === "";
}

const INITIAL_TARGET_ROOTS = new Set(["schedules", "personnel", "dates", "requirements"]);

function pathRoot(fieldPath) {
  return text(fieldPath).split(".")[0];
}

function configured(value) {
  return !empty(value) && value !== false;
}

function membershipMap(root, value = {}) {
  if (root === "schedules") {
    return new Map((value.schedules || []).map((item) => [
      text(numberOrText(item.scheduleCode)),
      item,
    ]));
  }
  return new Map((value.requirements || []).map((item, index) => [String(index), item]));
}

function membershipConflicts(expected, actual, mode) {
  const conflicts = [];
  for (const root of ["schedules", "requirements"]) {
    const expectedItems = membershipMap(root, expected);
    const actualItems = membershipMap(root, actual);
    const keys = mode === "initial"
      ? [...actualItems.keys()].filter((key) => !expectedItems.has(key))
      : [...new Set([...expectedItems.keys(), ...actualItems.keys()])]
        .filter((key) => !expectedItems.has(key) || !actualItems.has(key));
    for (const key of keys) {
      conflicts.push({
        path: `${root}.${key}`,
        expected: expectedItems.get(key) ?? "",
        actual: actualItems.get(key) ?? "",
      });
    }
  }
  return conflicts;
}

export function operationPersonnelConflicts(expected = {}, actual = {}, mode = "initial") {
  if (!["initial", "resend"].includes(mode)) throw new Error(`未知人员任务冲突模式：${mode}`);
  assertScheduleCodes(expected.schedules || []);
  assertScheduleCodes(actual.schedules || []);
  const expectedFields = flatten(expected);
  const actualFields = flatten(actual);
  const memberships = membershipConflicts(expected, actual, mode);
  const membershipPaths = new Set(memberships.map((item) => item.path));
  const hidesMembershipChild = (fieldPath) => [...membershipPaths]
    .some((membershipPath) => fieldPath.startsWith(`${membershipPath}.`));
  const paths = mode === "initial"
    ? [...new Set([
      ...[...expectedFields.keys()].filter((fieldPath) => (
        pathRoot(fieldPath) === "batch" || INITIAL_TARGET_ROOTS.has(pathRoot(fieldPath))
      )),
      ...[...actualFields].filter(([fieldPath, value]) => (
        INITIAL_TARGET_ROOTS.has(pathRoot(fieldPath)) && configured(value)
      )).map(([fieldPath]) => fieldPath),
    ])].filter((fieldPath) => !hidesMembershipChild(fieldPath)).sort()
    : [...new Set([...expectedFields.keys(), ...actualFields.keys()])]
      .filter((fieldPath) => !hidesMembershipChild(fieldPath))
      .sort();
  const fieldConflicts = paths.flatMap((fieldPath) => {
    const expectedValue = expectedFields.get(fieldPath);
    const actualValue = actualFields.get(fieldPath);
    if (sameValue(expectedValue, actualValue)) return [];
    const batchIdentity = fieldPath.startsWith("batch.");
    if (mode === "initial" && !batchIdentity && empty(actualValue)) return [];
    return [{ path: fieldPath, expected: expectedValue ?? "", actual: actualValue ?? "" }];
  });
  return [...memberships, ...fieldConflicts].sort((left, right) => left.path.localeCompare(right.path));
}

export async function runOperationPersonnelInspection(instruction, options = {}) {
  const userDataDir = text(options.userDataDir || process.env.OPERATION_CONSOLE_USER_DATA_DIR
    || path.join(process.cwd(), ".easy_exam_runtime", "operation-console-profile"));
  const context = await launchOperationBatchContext(userDataDir, false, options);
  return runWithOperationBatchContext(
    context,
    (page) => inspectOperationPersonnelTask(page, instruction, options),
  );
}

function operationControlError(label, count) {
  const error = new Error(`运控可见页面控件“${label}”必须精确匹配 1 个，实际 ${count} 个`);
  error.code = "PERSONNEL_OPERATION_CONTROL_AMBIGUOUS";
  error.status = 409;
  return error;
}

async function uniqueVisibleControl(locator, label) {
  const count = typeof locator?.count === "function" ? await locator.count() : 0;
  if (count !== 1) throw operationControlError(label, count);
  return locator;
}

async function clickUniqueVisible(locator, label) {
  const control = await uniqueVisibleControl(locator, label);
  await control.click();
  return control;
}

async function topVisibleDialog(page, label) {
  const dialogs = typeof page?.getByRole === "function"
    ? page.getByRole("dialog")
    : null;
  const count = typeof dialogs?.count === "function" ? await dialogs.count() : 0;
  if (count < 1) throw operationControlError(label, count);
  return dialogs.last();
}

async function uniqueVisibleModalWithText(page, value, label) {
  const visibleModals = page.locator(".ant-modal:visible");
  if (typeof visibleModals?.filter !== "function") {
    return topVisibleDialog(page, label);
  }
  const modals = visibleModals.filter({ hasText: value });
  return uniqueVisibleControl(modals, label);
}

async function clickUniqueNamedButton(container, names, label) {
  const matches = [];
  for (const name of names) {
    const button = container.getByRole("button", { name, exact: true });
    if (await button.count() === 1) matches.push(button);
  }
  if (matches.length !== 1) throw operationControlError(label, matches.length);
  await matches[0].click();
}

async function exactVisibleRows(page, value) {
  if (typeof page?.locator !== "function") return [];
  const rows = page.locator("table:visible tbody tr");
  const count = await rows.count();
  const exact = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const cells = (await row.locator("td").allInnerTexts()).map(text);
    if (cells.includes(text(value))) exact.push(row);
  }
  return exact;
}

async function exactScheduleRows(page, schedule = {}) {
  const code = text(numberOrText(schedule.scheduleCode));
  const entryId = text(schedule.scheduleEntryId);
  if (!code || !entryId) return [];
  const rows = await exactVisibleRows(page, code);
  const exact = [];
  for (const row of rows) {
    const actualEntryId = text(await row.getAttribute("data-schedule-entry-id"));
    const cells = (await row.locator("td").allInnerTexts()).map(text);
    if (actualEntryId === entryId || cells.includes(entryId)) exact.push(row);
  }
  return exact;
}

async function labeledVisibleControl(page, label, selector) {
  const direct = typeof page?.getByLabel === "function"
    ? page.getByLabel(label, { exact: true })
    : null;
  const directCount = typeof direct?.count === "function" ? await direct.count() : 0;
  if (directCount > 1) throw operationControlError(label, directCount);
  if (directCount === 1) return direct;
  const labels = typeof page?.getByText === "function"
    ? page.getByText(label, { exact: true })
    : null;
  const labelNode = await uniqueVisibleControl(labels, `${label}标签`);
  const item = labelNode.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' ant-form-item ')][1]",
  );
  const itemCount = await item.count();
  if (itemCount > 1) throw operationControlError(`${label}表单项`, itemCount);
  if (itemCount === 1) return uniqueVisibleControl(item.locator(selector), label);
  const row = labelNode.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' ant-row ')][1]",
  );
  if (await row.count() !== 1) throw operationControlError(`${label}表单行`, await row.count());
  return uniqueVisibleControl(row.locator(":scope > .ant-col").nth(1), label);
}

async function fillVisibleField(page, label, value) {
  const control = await labeledVisibleControl(page, label, "input:visible, textarea:visible");
  await control.fill(text(value));
}

async function confirmTopVisibleDialog(page, buttonName = "确定") {
  const dialog = await topVisibleDialog(page, "运控弹窗");
  const button = dialog.getByRole("button", { name: buttonName, exact: true });
  await clickUniqueVisible(button, `运控弹窗${buttonName}按钮`);
}

async function readVisibleSection(page, key) {
  const snapshot = await readVisibleOperationPersonnelSnapshot(page);
  assertVisibleSection(snapshot, key);
  return snapshot[key];
}

async function ensureVisiblePersonnelPage(page, instruction = {}) {
  await locateOperationPersonnelBatch(page, instruction);
  await clickUniqueVisible(
    page.getByRole("tab", { name: "人员", exact: true }),
    "批次详情人员页签",
  );
  await clickUniqueVisible(
    page.getByRole("tab", { name: "在线监考", exact: true }),
    "人员在线监考页签",
  );
  const config = page.getByText("配置项", { exact: true });
  if (await config.count() === 0) {
    await config.waitFor({ state: "visible", timeout: 10_000 });
  }
  await uniqueVisibleControl(config, "在线监考配置项");
}

async function readVisiblePersonnelPage(page) {
  if (typeof page.waitForFunction === "function") {
    await page.waitForFunction(() => {
      const value = String(document.body?.innerText ?? "");
      return value.includes("人员落实日期")
        && value.includes("人员落实平台")
        && value.includes("正式考试-监考人员数量");
    }, undefined, { timeout: 10_000 });
  }
  const raw = await page.evaluate(() => ({
    lines: String(document.body?.innerText ?? "")
      .split(/\n+/)
      .map((value) => value.trim().replace(/\s+/g, " "))
      .filter(Boolean),
  }));
  return operationPersonnelPageFromVisibleRaw(raw);
}

async function readVisiblePersonnelPageSection(page, key) {
  const snapshot = await readVisiblePersonnelPage(page);
  assertVisibleSection(snapshot, key);
  return snapshot[key];
}

async function openVisiblePersonnelSectionEditor(page, label) {
  const title = await uniqueVisibleControl(
    page.getByText(label, { exact: true }),
    `在线监考${label}标题`,
  );
  let header = title.locator("xpath=ancestor::*[@role='button'][1]");
  if (await header.count() !== 1) {
    header = title.locator(
      "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' ant-collapse-header ')][1]",
    );
  }
  if (await header.count() !== 1) {
    throw operationControlError(`在线监考${label}区块`, await header.count());
  }
  await clickUniqueVisible(
    header.locator(".anticon-edit:visible"),
    `在线监考${label}编辑按钮`,
  );
}

async function visiblePersonnelConfigDialog(page) {
  const startInput = page.locator('input[placeholder="开始日期"]:visible');
  if (await startInput.count() === 0) {
    await startInput.waitFor({ state: "visible", timeout: 10_000 });
  }
  const dialogs = page.locator(".ant-modal:visible").filter({ has: startInput });
  return uniqueVisibleControl(dialogs, "在线监考配置项弹窗");
}

export async function selectVisiblePersonnelDate(page, dialog, placeholder, value) {
  const input = await uniqueVisibleControl(
    dialog.locator(`input[placeholder="${placeholder}"]:visible`),
    `${placeholder}输入框`,
  );
  await input.click();
  await clickUniqueVisible(
    page.locator(`[title="${operationDateTitle(value)}"]:visible`),
    `${text(value)}日期单元格`,
  );
  const calendars = page.locator(".ant-calendar-picker-container:visible");
  const calendarCount = await calendars.count();
  if (calendarCount > 1) {
    throw operationControlError("人员日期选择浮层", calendarCount);
  }
  if (calendarCount === 1) {
    await input.press("Escape");
    await calendars.waitFor({ state: "hidden", timeout: 10_000 });
  }
}

async function chooseVisibleRadio(dialog, name) {
  await clickUniqueVisible(
    dialog.getByRole("radio", { name: text(name), exact: true }),
    `${text(name)}单选项`,
  );
}

async function confirmVisiblePersonnelConfig(page, dialog) {
  await clickUniqueNamedButton(
    dialog,
    ["确 定", "确定"],
    "在线监考配置项确定按钮",
  );
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  await readVisiblePersonnelPage(page);
}

async function visiblePersonnelRequirementsDrawer(page) {
  const title = page.getByText("在线监考——考务需求", { exact: true });
  if (await title.count() === 0) {
    await title.waitFor({ state: "visible", timeout: 10_000 });
  }
  const drawers = page.locator(".ant-drawer:visible").filter({
    hasText: "在线监考——考务需求",
  });
  return uniqueVisibleControl(drawers, "在线监考考务需求抽屉");
}

async function exactVisibleRequirementRow(drawer, name) {
  const rows = drawer.locator("tbody tr:visible");
  const matches = [];
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    const firstCell = text(await row.locator("td").first().innerText());
    if (firstCell === text(name)) matches.push(row);
  }
  if (matches.length !== 1) {
    throw operationControlError(`考务需求 ${text(name)} 行`, matches.length);
  }
  return matches[0];
}

async function editVisibleSchedule(page, schedule, existing) {
  if (existing) {
    const rows = await exactScheduleRows(page, schedule);
    if (rows.length !== 1) throw scheduleNotUnique(schedule, rows.length);
    await clickUniqueVisible(
      rows[0].getByRole("button", { name: "编辑", exact: true }),
      `日程 ${schedule.scheduleCode} 编辑按钮`,
    );
  } else {
    await clickUniqueVisible(
      page.getByRole("button", { name: "新增考试日程", exact: true }),
      "新增考试日程按钮",
    );
  }
  await fillVisibleField(page, "日程代码", schedule.scheduleCode);
  await fillVisibleField(page, "科目代码", schedule.subjectCode);
  await fillVisibleField(page, "科目名称", schedule.subjectName);
  await fillVisibleField(page, "开始时间", schedule.start);
  await fillVisibleField(page, "结束时间", schedule.end);
  await fillVisibleField(page, "时长", schedule.durationMinutes);
  await fillVisibleField(page, "提前登录分钟数", schedule.earlyLoginMinutes);
  await confirmTopVisibleDialog(page);
}

async function selectVisiblePeople(dialog, groupName, people) {
  const group = dialog.getByRole("checkbox", { name: groupName, exact: true });
  await clickUniqueVisible(group, `人员目录组 ${groupName}`);
  for (const person of people) {
    const label = `${person.id} (${person.name})`;
    const candidate = dialog.getByRole("checkbox", { name: label, exact: true });
    const exact = await uniqueVisibleControl(candidate, `人员 ${person.id}/${person.name}`);
    await exact.check();
  }
}

async function visibleDirectoryPeople(dialog) {
  const values = await dialog.evaluate((node) => {
    const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
    const visible = (element) => Boolean(
      element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length),
    );
    return [...node.querySelectorAll("*")]
      .filter(visible)
      .filter((element) => element.children.length === 0)
      .map((element) => clean(element.textContent))
      .filter((value) => /^[^\s()]+@[^\s()]+\s+\([^()]+\)$/.test(value));
  });
  return operationPersonnelDirectoryPeopleFromVisibleTexts(values);
}

export async function expandVisibleDirectoryGroup(dialog, groupName) {
  const before = await visibleDirectoryPeople(dialog);
  const group = dialog.getByRole("checkbox", { name: groupName, exact: true });
  if (await group.count() === 0) {
    await group.waitFor({ state: "visible", timeout: 10_000 });
  }
  await clickUniqueVisible(
    group,
    `人员目录组 ${groupName}`,
  );
  const after = await visibleDirectoryPeople(dialog);
  const existing = new Set(before.map((person) => `${person.id}\0${person.name}`));
  const members = after.filter((person) => !existing.has(`${person.id}\0${person.name}`));
  if (!members.length) {
    throw operationControlError(`人员目录组 ${groupName} 成员`, 0);
  }
  return members;
}

export async function openVisibleMailRecipientDirectory(mailDialog, label) {
  const control = await labeledVisibleControl(
    mailDialog,
    label,
    "input:visible, textarea:visible, .ant-select:visible",
  );
  await control.click();
}

async function confirmVisibleDirectory(page) {
  const dialog = await topVisibleDialog(page, "人员目录弹窗");
  await clickUniqueNamedButton(
    dialog,
    ["确 定", "确定"],
    "人员目录确定按钮",
  );
}

export async function cancelVisibleDirectory(page) {
  const dialog = await topVisibleDialog(page, "人员目录弹窗");
  const inlineDirectory = typeof dialog?.getByText === "function"
    ? dialog.getByText("填写收件人邮箱", { exact: false })
    : null;
  if (typeof inlineDirectory?.count === "function" && await inlineDirectory.count() > 0) {
    return;
  }
  await clickUniqueNamedButton(
    dialog,
    ["取 消", "取消"],
    "人员目录取消按钮",
  );
}

async function closeVisibleMailDialog(page) {
  const mailDialog = await uniqueVisibleModalWithText(
    page,
    "填写收件人邮箱",
    "邮件发送弹窗",
  );
  const close = mailDialog.locator(".ant-modal-close:visible");
  const closeCount = await close.count();
  if (closeCount === 1) {
    await close.click();
    return;
  }
  await clickUniqueVisible(
    mailDialog.getByRole("button", { name: "取 消", exact: true }),
    "邮件发送取消按钮",
  );
}

export async function openVisiblePersonnelMailDialog(page, instruction = {}) {
  const taskDialog = await uniqueVisibleModalWithText(
    page,
    "任务单发送需满足以下条件",
    "分散在线监考任务单弹窗",
  );
  await clickUniqueVisible(
    taskDialog.getByRole("button", { name: "发送任务单", exact: true }),
    "任务单内置发送按钮",
  );

  const summary = page.locator(
    'textarea[placeholder="请填写任务单变更内容"]:visible, input[placeholder="请填写任务单变更内容"]:visible',
  );
  const summaryCount = await summary.count();
  if (summaryCount > 1) throw operationControlError("任务单变更内容", summaryCount);
  if (summaryCount === 1) {
    const changeSummary = text(
      instruction.changeSummary || instruction.directoryProbeSummary,
    );
    if (!changeSummary) throw new Error("重新发送人员任务必须填写变化摘要");
    await summary.fill(changeSummary);
    const dialog = await topVisibleDialog(page, "任务单变更内容弹窗");
    await clickUniqueVisible(
      dialog.getByRole("button", { name: "下一步", exact: true }),
      "任务单变更内容下一步按钮",
    );
  }

  return uniqueVisibleModalWithText(page, "填写收件人邮箱", "邮件发送弹窗");
}

async function readVisibleMailRecipients(page) {
  const raw = await page.evaluate(() => {
    const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
    const visible = (element) => Boolean(
      element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length),
    );
    const modals = [...document.querySelectorAll(".ant-modal")].filter((element) => (
      visible(element) && clean(element.innerText).includes("填写收件人邮箱")
    ));
    if (modals.length !== 1) return { modalCount: modals.length, to: [], cc: [] };
    const modal = modals[0];
    const read = (label) => {
      const labels = [...modal.querySelectorAll("*")].filter((element) => (
        visible(element)
        && element.children.length === 0
        && clean(element.textContent) === label
      ));
      if (labels.length !== 1) return [];
      const field = labels[0].closest(".ant-form-item") || labels[0].parentElement;
      const values = [
        clean(field?.innerText),
        ...[...(field?.querySelectorAll("input, textarea") || [])].map((input) => clean(input.value)),
      ].join(" ");
      return [...values.matchAll(/([^\s(),;]+@[^\s(),;]+)\s+\(([^()]+)\)/g)]
        .map((match) => `${match[1]} (${match[2]})`);
    };
    return {
      modalCount: 1,
      to: read("收件人"),
      cc: read("抄送（C）"),
    };
  });
  if (raw.modalCount !== 1) throw operationControlError("邮件发送弹窗", raw.modalCount);
  return {
    to: operationPersonnelDirectoryPeopleFromVisibleTexts(raw.to),
    cc: operationPersonnelDirectoryPeopleFromVisibleTexts(raw.cc),
  };
}

export async function inspectVisiblePersonnelDirectory(page, instruction = {}) {
  const mailDialog = await openVisiblePersonnelMailDialog(page, instruction);
  const rule = RECIPIENT_RULES[text(instruction.environment)];
  if (!rule) throw new Error(`未知运控收件环境：${text(instruction.environment) || "空"}`);
  const groups = [];
  for (const groupName of [...new Set([rule.toGroup, rule.ccGroup].filter(Boolean))]) {
    await openVisibleMailRecipientDirectory(
      mailDialog,
      groupName === rule.toGroup ? "收件人" : "抄送（C）",
    );
    const dialog = await topVisibleDialog(page, "人员目录弹窗");
    groups.push({
      name: groupName,
      people: await expandVisibleDirectoryGroup(dialog, groupName),
    });
    await cancelVisibleDirectory(page);
  }
  await closeVisibleMailDialog(page);
  return groups;
}

export async function readVisibleTopRightSendRecords(page) {
  const visibleDialogs = page.locator(".ant-modal:visible");
  if (typeof visibleDialogs?.filter === "function") {
    const taskDialogs = visibleDialogs.filter({
      hasText: "任务单发送需满足以下条件",
    });
    const taskDialogCount = await taskDialogs.count();
    if (taskDialogCount > 1) {
      throw operationControlError("分散在线监考任务单弹窗", taskDialogCount);
    }
    if (taskDialogCount === 1) {
      return (await readVisiblePersonnelTaskSheet(page)).sendRecords;
    }
  }

  const marked = page.locator("[data-operation-send-records]:visible");
  const markedCount = await marked.count();
  if (markedCount > 1) throw operationControlError("任务单右上角发送记录区", markedCount);
  if (markedCount === 1) {
    const records = marked.locator("[data-operation-send-record]:visible");
    const count = await records.count();
    const output = [];
    for (let index = 0; index < count; index += 1) {
      const record = records.nth(index);
      output.push({
        type: text(await record.getAttribute("data-send-type")),
        sentAt: text(await record.getAttribute("data-sent-at")),
      });
    }
    return output;
  }

  const tables = page.locator("table:visible");
  const tableCount = await tables.count();
  const matches = [];
  for (let tableIndex = 0; tableIndex < tableCount; tableIndex += 1) {
    const table = tables.nth(tableIndex);
    const headers = (await table.locator("thead th").allInnerTexts()).map(text);
    const typeIndex = headers.indexOf("发送类型");
    const timeIndex = headers.indexOf("发送时间");
    if (typeIndex >= 0 && timeIndex >= 0) matches.push({ table, typeIndex, timeIndex });
  }
  if (matches.length !== 1) {
    throw operationControlError("任务单右上角发送记录表", matches.length);
  }
  const { table, typeIndex, timeIndex } = matches[0];
  const rows = table.locator("tbody tr");
  const rowCount = await rows.count();
  const output = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const cells = (await rows.nth(rowIndex).locator("td").allInnerTexts()).map(text);
    output.push({ type: cells[typeIndex], sentAt: cells[timeIndex] });
  }
  return output;
}

const VISIBLE_OPERATION_PERSONNEL_ADAPTER = Object.freeze({
  readBatch: (page) => readVisibleSection(page, "batch"),
  readSchedules: (page) => readVisibleSection(page, "schedules"),
  readPersonnel: (page) => readVisiblePersonnelPageSection(page, "personnel"),
  readDates: (page) => readVisiblePersonnelPageSection(page, "dates"),
  readRequirements: (page) => readVisiblePersonnelPageSection(page, "requirements"),
  readTaskSheet: async (page) => (await readVisiblePersonnelTaskSheet(page)).taskSheet,
  readSendRecords: (page) => readVisibleTopRightSendRecords(page),
  readDirectoryGroups: (page) => readVisibleSection(page, "directoryGroups"),

  async publishBatch(page) {
    await clickUniqueVisible(
      page.getByRole("button", { name: "发布", exact: true }),
      "发布按钮",
    );
    await confirmTopVisibleDialog(page);
  },

  async syncExamSchedules(page, target = [], current = []) {
    const currentByCode = new Map(current.map((item) => [text(item.scheduleCode), item]));
    for (const schedule of target) {
      const existing = currentByCode.get(text(schedule.scheduleCode));
      if (existing && sameData(existing, schedule)) continue;
      await editVisibleSchedule(page, schedule, existing);
    }
  },

  findScheduleRows: (page, schedule) => exactScheduleRows(page, schedule),

  async deleteSchedule(_page, schedule, row) {
    if (!row) throw scheduleNotUnique(schedule, 0);
    await clickUniqueVisible(
      row.getByRole("button", { name: "删除", exact: true }),
      `日程 ${schedule.scheduleEntryId}/${schedule.scheduleCode} 删除按钮`,
    );
    await confirmTopVisibleDialog(_page);
  },

  async syncPersonnelConfig(page, personnel = {}, _current = {}, instruction = {}) {
    if (text(personnel.serviceType) !== "ATA 监考－分散在线监考") {
      throw operationConflict("人员服务类型不是 ATA 分散在线监考");
    }
    await ensureVisiblePersonnelPage(page, instruction);
    await openVisiblePersonnelSectionEditor(page, "配置项");
    const dialog = await visiblePersonnelConfigDialog(page);
    await chooseVisibleRadio(dialog, personnel.platform);
    await chooseVisibleRadio(dialog, "分散监考");
    await confirmVisiblePersonnelConfig(page, dialog);
  },

  async syncPersonnelDates(page, dates = {}, current = {}, instruction = {}) {
    await ensureVisiblePersonnelPage(page, instruction);
    await openVisiblePersonnelSectionEditor(page, "配置项");
    const dialog = await visiblePersonnelConfigDialog(page);
    if (text(current.start) !== text(dates.start)) {
      await selectVisiblePersonnelDate(page, dialog, "开始日期", dates.start);
    }
    if (text(current.end) !== text(dates.end)) {
      await selectVisiblePersonnelDate(page, dialog, "结束日期", dates.end);
    }
    if (text(current.nameListDue) !== text(dates.nameListDue)) {
      await selectVisiblePersonnelDate(page, dialog, "请选择日期", dates.nameListDue);
    }
    await confirmVisiblePersonnelConfig(page, dialog);
  },

  async syncExamServiceRequirements(page, target = [], current = [], instruction = {}) {
    await ensureVisiblePersonnelPage(page, instruction);
    await openVisiblePersonnelSectionEditor(page, "考务需求");
    const drawer = await visiblePersonnelRequirementsDrawer(page);
    const currentByName = new Map(current.map((item) => [text(item.name), text(item.value)]));
    for (const item of target) {
      if (currentByName.get(text(item.name)) === text(item.value)) continue;
      const row = await exactVisibleRequirementRow(drawer, item.name);
      const input = await uniqueVisibleControl(
        row.locator("textarea:visible"),
        `考务需求 ${text(item.name)} 描述`,
      );
      await input.fill(text(item.value));
    }
    await clickUniqueNamedButton(
      drawer,
      ["确 定", "确定"],
      "在线监考考务需求确定按钮",
    );
    await drawer.waitFor({ state: "hidden", timeout: 10_000 });
    await readVisiblePersonnelPage(page);
  },

  openTaskSheet: (page, instruction = {}) => (
    openVisiblePersonnelTaskSheet(page, instruction)
  ),

  async selectRecipients(page, recipients, instruction = {}) {
    const mailDialog = await openVisiblePersonnelMailDialog(page, instruction);
    const rule = RECIPIENT_RULES[text(instruction.environment)];
    if (!rule) throw new Error(`未知运控收件环境：${text(instruction.environment) || "空"}`);
    if (recipients.to.length !== 1 || recipients.to[0].name !== rule.toName
      || recipients.cc.length !== rule.ccCount) {
      throw operationControlError("固定收件人与抄送人", 0);
    }
    await openVisibleMailRecipientDirectory(mailDialog, "收件人");
    let directoryDialog = await topVisibleDialog(page, "人员目录弹窗");
    await selectVisiblePeople(directoryDialog, rule.toGroup, recipients.to);
    await confirmVisibleDirectory(page);
    if (recipients.cc.length) {
      await openVisibleMailRecipientDirectory(mailDialog, "抄送（C）");
      directoryDialog = await topVisibleDialog(page, "人员目录弹窗");
      await selectVisiblePeople(directoryDialog, rule.ccGroup, recipients.cc);
      await confirmVisibleDirectory(page);
    }
  },

  readSelectedRecipients: (page) => readVisibleMailRecipients(page),

  async confirmSend(page) {
    const mailDialog = await uniqueVisibleModalWithText(
      page,
      "填写收件人邮箱",
      "邮件发送弹窗",
    );
    await clickUniqueNamedButton(
      mailDialog,
      ["确 定", "确定"],
      "邮件发送最终确定按钮",
    );
  },

  async closeTaskSheet(page) {
    const dialog = await uniqueVisibleModalWithText(
      page,
      "任务单发送需满足以下条件",
      "分散在线监考任务单弹窗",
    );
    await clickUniqueVisible(dialog.locator(".ant-modal-close:visible"), "任务单关闭按钮");
  },

  reopenTaskSheet: (page, instruction) => (
    VISIBLE_OPERATION_PERSONNEL_ADAPTER.openTaskSheet(page, instruction)
  ),
});

const OPERATION_PERSONNEL_CHECKPOINTS = Object.freeze([
  "inspect_batch",
  "publish_batch",
  "sync_exam_schedules",
  "sync_personnel_config",
  "sync_personnel_dates",
  "sync_exam_service_requirements",
  "verify_task_sheet",
  "select_recipients",
  "submit_send",
  "verify_send_record",
]);

function operationMethod(page, options, name) {
  const owner = options[name]
    ? options
    : (options.adapter?.[name] ? options.adapter : VISIBLE_OPERATION_PERSONNEL_ADAPTER);
  const method = options[name] || options.adapter?.[name] || VISIBLE_OPERATION_PERSONNEL_ADAPTER[name];
  if (typeof method !== "function") {
    throw new Error(`运控人员任务执行器缺少 ${name} 方法`);
  }
  return method.bind(owner);
}

function sameData(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function operationConflict(detail) {
  const error = new Error(`运控人员任务状态冲突：${detail}`);
  error.code = "PERSONNEL_OPERATION_CONFLICT";
  error.status = 409;
  return error;
}

function checkpointDigest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function personnelCheckpoint(
  name,
  targetDigest,
  action,
  verify,
  options,
  runningReadback,
) {
  const now = options.now || Date.now;
  await options.onCheckpoint?.({
    name,
    status: "running",
    startedAt: new Date(now()).toISOString(),
    targetDigest,
    ...(runningReadback === undefined ? {} : { readback: runningReadback }),
  });
  const output = await action();
  const readback = await verify(output);
  await options.onCheckpoint?.({
    name,
    status: "completed",
    completedAt: new Date(now()).toISOString(),
    targetDigest,
    readback,
  });
  return readback;
}

async function runPersonnelCheckpoint({
  name,
  target,
  action,
  verify,
  verifyCompleted,
  actionStartedIsIrreversible = false,
  runningReadback,
  instruction,
  options,
}) {
  const targetDigest = checkpointDigest(target);
  const saved = instruction.checkpoints?.[name];
  const actionStarted = actionStartedIsIrreversible
    && ["running", "submission_started", "completed"].includes(saved?.status);
  if (saved?.status === "completed" || actionStarted) {
    if (saved.targetDigest && saved.targetDigest !== targetDigest) {
      throw operationConflict(`${name} 的已保存目标摘要与当前目标不一致`);
    }
    if (saved.status === "completed" && !saved.targetDigest) {
      throw operationConflict(`${name} 的已保存目标摘要缺失`);
    }
    return verifyCompleted(saved);
  }
  return personnelCheckpoint(
    name,
    targetDigest,
    action,
    verify,
    options,
    runningReadback,
  );
}

function targetRecipients(target = {}) {
  const people = (items) => [...(items || [])].map((item) => ({
    id: text(item?.id),
    name: text(item?.name),
  }));
  return {
    to: people(target.directoryMatch?.to),
    cc: people(target.directoryMatch?.cc),
  };
}

function assertReadback(name, expected, actual) {
  if (!sameData(expected, actual)) {
    throw operationConflict(`${name} 回读结果与已确认目标不一致`);
  }
  return actual;
}

export function findAttemptSendRecord(records = [], attempt = {}) {
  const expectedType = attempt.kind === "resend" ? "再次发送" : "首次发送";
  const startedAt = Date.parse(attempt.startedAt);
  if (!Number.isFinite(startedAt)) return null;
  return normalizeSendRecords(records).find((record) => {
    if (record.type !== expectedType) return false;
    const sentAt = Date.parse(record.sentAt);
    return Number.isFinite(sentAt) && sentAt > startedAt;
  }) || null;
}

async function waitForNewSendRecord(readRecords, attempt, options = {}) {
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now || Date.now;
  const deadline = now() + 30_000;
  await options.onVerification?.({
    phase: options.phase,
    deadlineAt: new Date(deadline).toISOString(),
  });
  while (now() < deadline) {
    const match = findAttemptSendRecord(await readRecords(), attempt);
    if (match) return match;
    await sleep(Math.min(1000, Math.max(0, deadline - now())));
  }
  return null;
}

function taskSheetBlocked(detail) {
  const error = new Error(`运控任务单发送条件阻断：${detail}`);
  error.code = "PERSONNEL_TASK_SHEET_BLOCKED";
  error.status = 409;
  return error;
}

function assertTaskSheetReady(expected, actual) {
  if (!actual.conditions.length || actual.conditions.some((condition) => (
    !condition || typeof condition !== "object" || condition.satisfied !== true
  ))) {
    throw taskSheetBlocked("页面发送条件未全部满足");
  }
  if (text(expected.type) && text(expected.type) !== text(actual.type)) {
    throw operationConflict("verify_task_sheet 任务单类型与已确认目标不一致");
  }
  return actual;
}

function scheduleNotUnique(schedule, count) {
  const error = new Error(
    `考试日程 ${schedule.scheduleEntryId || "缺少稳定 ID"}/${schedule.scheduleCode || "缺少代码"}`
    + ` 必须精确匹配 1 行，实际 ${count} 行`,
  );
  error.code = "PERSONNEL_SCHEDULE_NOT_UNIQUE";
  error.status = 409;
  return error;
}

async function runOperationPersonnelAttemptOnPage(page, instruction, options) {
  const target = normalizeOperationPersonnelSnapshot(instruction.target || {});
  const baseline = normalizeOperationPersonnelSnapshot(instruction.baseline || instruction.target || {});
  const kind = instruction.kind === "resend" ? "resend" : "initial";
  const inspect = async () => {
    const actual = await inspectOperationPersonnelTask(page, instruction, options);
    const expected = structuredClone(baseline);
    if (kind === "initial") {
      expected.batch.published = actual.batch.published;
    }
    const conflicts = operationPersonnelConflicts(expected, actual, kind);
    if (conflicts.length) {
      throw operationConflict(conflicts.map((item) => item.path).join("、"));
    }
    return actual;
  };
  let snapshot = await runPersonnelCheckpoint({
    name: OPERATION_PERSONNEL_CHECKPOINTS[0],
    target: { kind, baseline },
    action: inspect,
    verify: async (actual) => actual,
    verifyCompleted: inspect,
    instruction,
    options,
  });

  const readPublishedBatch = async () => {
    if (snapshot.batch.published) return snapshot.batch;
    const batch = normalizeOperationPersonnelSnapshot({
      batch: await operationMethod(page, options, "readBatch")(page, instruction),
    }).batch;
    if (!batch.published) throw operationConflict("批次发布后回读仍为未发布");
    return batch;
  };
  snapshot.batch = await runPersonnelCheckpoint({
    name: OPERATION_PERSONNEL_CHECKPOINTS[1],
    target: { ...target.batch, published: true },
    action: async () => {
      if (kind === "initial" && !snapshot.batch.published) {
        await operationMethod(page, options, "publishBatch")(page, instruction);
      }
    },
    verify: readPublishedBatch,
    verifyCompleted: readPublishedBatch,
    instruction,
    options,
  });

  const readSection = async (readName, key) => {
    const raw = await operationMethod(page, options, readName)(page, instruction);
    return normalizeOperationPersonnelSnapshot({ [key]: raw })[key];
  };
  const sync = async (
    checkpointName,
    optionName,
    readName,
    key,
    action,
    project = (value) => value,
  ) => {
    const inspectedRaw = snapshot[key];
    const inspected = project(inspectedRaw);
    const desired = project(target[key]);
    const unchanged = sameData(inspected, desired);
    const readAndVerify = async () => assertReadback(
      checkpointName,
      desired,
      project(await readSection(readName, key)),
    );
    snapshot[key] = await runPersonnelCheckpoint({
      name: checkpointName,
      target: desired,
      action: action || (async () => {
        if (!unchanged) {
          await operationMethod(page, options, optionName)(
            page,
            target[key],
            inspectedRaw,
            instruction,
          );
        }
      }),
      verify: unchanged ? async () => inspected : readAndVerify,
      verifyCompleted: unchanged ? async () => inspected : readAndVerify,
      instruction,
      options,
    });
  };

  await sync(
    OPERATION_PERSONNEL_CHECKPOINTS[2],
    "syncExamSchedules",
    "readSchedules",
    "schedules",
    async () => {
      const targetCodes = new Set(target.schedules.map((item) => text(item.scheduleCode)));
      const deletions = snapshot.schedules.filter(
        (item) => !targetCodes.has(text(item.scheduleCode)),
      );
      for (const schedule of deletions) {
        if (!schedule.scheduleEntryId || !text(schedule.scheduleCode)) {
          throw scheduleNotUnique(schedule, 0);
        }
        const rows = await operationMethod(page, options, "findScheduleRows")(
          page,
          {
            scheduleEntryId: schedule.scheduleEntryId,
            scheduleCode: schedule.scheduleCode,
          },
          instruction,
        );
        const count = Array.isArray(rows) ? rows.length : Number(rows);
        if (count !== 1) throw scheduleNotUnique(schedule, Number.isFinite(count) ? count : 0);
        await operationMethod(page, options, "deleteSchedule")(
          page,
          schedule,
          Array.isArray(rows) ? rows[0] : undefined,
          instruction,
        );
      }
      if (!sameData(snapshot.schedules, target.schedules)) {
        await operationMethod(page, options, "syncExamSchedules")(
          page,
          target.schedules,
          snapshot.schedules,
          instruction,
        );
      }
    },
  );
  await sync(
    OPERATION_PERSONNEL_CHECKPOINTS[3],
    "syncPersonnelConfig",
    "readPersonnel",
    "personnel",
    undefined,
    personnelConfigProjection,
  );
  await sync(OPERATION_PERSONNEL_CHECKPOINTS[4], "syncPersonnelDates", "readDates", "dates");
  await sync(
    OPERATION_PERSONNEL_CHECKPOINTS[5],
    "syncExamServiceRequirements",
    "readRequirements",
    "requirements",
  );

  const readAndVerifyTaskSheet = async () => assertTaskSheetReady(
    target.taskSheet,
    normalizeTaskSheet(await operationMethod(page, options, "readTaskSheet")(page, instruction)),
  );
  await runPersonnelCheckpoint({
    name: OPERATION_PERSONNEL_CHECKPOINTS[6],
    target: target.taskSheet,
    action: () => operationMethod(page, options, "openTaskSheet")(page, instruction),
    verify: readAndVerifyTaskSheet,
    verifyCompleted: async () => {
      await operationMethod(page, options, "openTaskSheet")(page, instruction);
      return readAndVerifyTaskSheet();
    },
    instruction,
    options,
  });

  const recipients = targetRecipients(target);
  const readAndVerifyRecipients = async () => {
    const actual = targetRecipients({
      directoryMatch: await operationMethod(page, options, "readSelectedRecipients")(page, instruction),
    });
    return assertReadback("select_recipients", recipients, actual);
  };
  await runPersonnelCheckpoint({
    name: OPERATION_PERSONNEL_CHECKPOINTS[7],
    target: recipients,
    action: () => operationMethod(page, options, "selectRecipients")(page, recipients, instruction),
    verify: readAndVerifyRecipients,
    verifyCompleted: readAndVerifyRecipients,
    instruction,
    options,
  });

  const submitTarget = { kind, recipients };
  const pendingAttempt = {
    kind,
    startedAt: new Date((options.now || Date.now)()).toISOString(),
  };
  const attempt = await runPersonnelCheckpoint({
    name: OPERATION_PERSONNEL_CHECKPOINTS[8],
    target: submitTarget,
    action: async () => {
      await operationMethod(page, options, "confirmSend")(page, pendingAttempt, instruction);
      return pendingAttempt;
    },
    verify: async (value) => value,
    verifyCompleted: async (completed) => {
      const value = completed.readback;
      if (!value?.startedAt || value.kind !== kind) {
        throw operationConflict("submit_send 已完成但缺少本次发送开始时间");
      }
      return value;
    },
    actionStartedIsIrreversible: true,
    runningReadback: pendingAttempt,
    instruction,
    options,
  });

  const readRecords = () => operationMethod(page, options, "readSendRecords")(page, instruction);
  const verifyRecord = async () => {
    const record = findAttemptSendRecord(await readRecords(), attempt);
    if (!record) throw operationConflict("verify_send_record 已完成但发送记录无法回读");
    return record;
  };
  const sendRecord = await runPersonnelCheckpoint({
    name: OPERATION_PERSONNEL_CHECKPOINTS[9],
    target: attempt,
    action: async () => {
      const first = await waitForNewSendRecord(readRecords, attempt, {
        ...options,
        phase: "initial",
      });
      if (first) return first;
      await operationMethod(page, options, "closeTaskSheet")(page, instruction);
      await operationMethod(page, options, "reopenTaskSheet")(page, instruction);
      return waitForNewSendRecord(readRecords, attempt, {
        ...options,
        phase: "reopened",
      });
    },
    verify: async (record) => record,
    verifyCompleted: verifyRecord,
    instruction,
    options,
  });

  const finalRecords = normalizeSendRecords(await readRecords());
  return {
    status: sendRecord ? "sent" : "result_unknown",
    sendRecord,
    attemptStartedAt: attempt.startedAt,
    completedAt: new Date((options.now || Date.now)()).toISOString(),
    operationSnapshot: normalizeOperationPersonnelSnapshot({
      ...target,
      batch: snapshot.batch,
      sendRecords: finalRecords,
    }),
  };
}

export async function runOperationPersonnelAttempt(instruction, options = {}) {
  const userDataDir = text(options.userDataDir || process.env.OPERATION_CONSOLE_USER_DATA_DIR
    || path.join(process.cwd(), ".easy_exam_runtime", "operation-console-profile"));
  const context = options.context || await launchOperationBatchContext(userDataDir, false, options);
  return runWithOperationBatchContext(
    context,
    (page) => runOperationPersonnelAttemptOnPage(page, instruction, options),
  );
}

export async function runOperationPersonnelRecheck(instruction, options = {}) {
  const userDataDir = text(options.userDataDir || process.env.OPERATION_CONSOLE_USER_DATA_DIR
    || path.join(process.cwd(), ".easy_exam_runtime", "operation-console-profile"));
  const context = options.context || await launchOperationBatchContext(userDataDir, false, options);
  return runWithOperationBatchContext(context, async (page) => {
    await locateOperationPersonnelBatch(page, instruction, options);
    await operationMethod(page, options, "openTaskSheet")(page, instruction);
    const records = normalizeSendRecords(
      await operationMethod(page, options, "readSendRecords")(page, instruction),
    );
    const attempt = instruction.attempt || {
      kind: instruction.kind === "resend" ? "resend" : "initial",
      startedAt: instruction.attemptStartedAt,
    };
    const sendRecord = findAttemptSendRecord(records, attempt);
    return {
      status: sendRecord ? "sent" : "result_unknown",
      sendRecord,
      sendRecords: records,
    };
  });
}
