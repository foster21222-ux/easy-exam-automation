import { createHash } from "node:crypto";
import path from "node:path";
import {
  advanceOperationBatchListPage,
  launchOperationBatchContext,
  runWithOperationBatchContext,
  searchOperationBatchListPages,
  startOperationBatchListSearch,
} from "./operation_batch_runner.mjs";

const RECIPIENT_RULES = Object.freeze({
  test: { toGroup: "演示组", toName: "张乐翔", ccGroup: "", ccCount: 0 },
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
  let { headers, rows } = await startOperationBatchListSearch(page, batchListUrl, batchCode, options);
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

function verifyBatchDetailIdentity(expected = {}, actual = {}) {
  const conflicts = BATCH_IDENTITY_FIELDS
    .filter((key) => key === "code" || text(expected[key]))
    .filter((key) => text(expected[key]) !== text(actual[key]))
    .map((key) => `${key} 期望 ${text(expected[key]) || "空"}，实际 ${text(actual[key]) || "空"}`);
  if (conflicts.length) {
    throw new Error(`批次详情身份不一致：${conflicts.join("；")}`);
  }
}

async function readVisibleOperationPersonnelSnapshot(page) {
  if (typeof page.evaluate !== "function") return {};
  return page.evaluate(() => {
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
          rows: [...node.querySelectorAll("tbody tr")].map((row) => Object.fromEntries(
            [...row.querySelectorAll("td")].map((cell, index) => [headers[index], clean(cell.textContent)]),
          )),
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
    return {
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
        conditions: conditionTable.rows.map((row) => row["发送条件"]),
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
  );
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
  const method = options[name] || options.adapter?.[name] || page?.[name];
  if (typeof method !== "function") {
    throw new Error(`运控人员任务执行器缺少 ${name} 方法`);
  }
  return method.bind(options[name] || options.adapter?.[name] ? options.adapter : page);
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

async function personnelCheckpoint(name, targetDigest, action, verify, options) {
  const now = options.now || Date.now;
  await options.onCheckpoint?.({
    name,
    status: "running",
    startedAt: new Date(now()).toISOString(),
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
  instruction,
  options,
}) {
  const targetDigest = checkpointDigest(target);
  const completed = instruction.checkpoints?.[name];
  if (completed?.status === "completed") {
    if (completed.targetDigest !== targetDigest) {
      throw operationConflict(`${name} 的已保存目标摘要与当前目标不一致`);
    }
    return verifyCompleted(completed);
  }
  return personnelCheckpoint(name, targetDigest, action, verify, options);
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
  return normalizeSendRecords(records).find((record) => {
    if (record.type !== expectedType) return false;
    if (attempt.kind !== "resend") return true;
    const sentAt = Date.parse(record.sentAt);
    return Number.isFinite(sentAt) && Number.isFinite(startedAt) && sentAt > startedAt;
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
  return assertReadback("verify_task_sheet", expected, actual);
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
  const sync = async (checkpointName, optionName, readName, key, action) => {
    const readAndVerify = async () => assertReadback(
      checkpointName,
      target[key],
      await readSection(readName, key),
    );
    snapshot[key] = await runPersonnelCheckpoint({
      name: checkpointName,
      target: target[key],
      action: action || (async () => {
        if (!sameData(snapshot[key], target[key])) {
          await operationMethod(page, options, optionName)(page, target[key], snapshot[key], instruction);
        }
      }),
      verify: readAndVerify,
      verifyCompleted: readAndVerify,
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
  await sync(OPERATION_PERSONNEL_CHECKPOINTS[3], "syncPersonnelConfig", "readPersonnel", "personnel");
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
  const attempt = await runPersonnelCheckpoint({
    name: OPERATION_PERSONNEL_CHECKPOINTS[8],
    target: submitTarget,
    action: async () => {
      const startedAt = new Date((options.now || Date.now)()).toISOString();
      const value = { kind, startedAt };
      await operationMethod(page, options, "confirmSend")(page, value, instruction);
      return value;
    },
    verify: async (value) => value,
    verifyCompleted: async (completed) => {
      const value = completed.readback;
      if (!value?.startedAt || value.kind !== kind) {
        throw operationConflict("submit_send 已完成但缺少本次发送开始时间");
      }
      return value;
    },
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
