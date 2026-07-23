import { createHash } from "node:crypto";
import path from "node:path";
import {
  advanceOperationBatchListPage,
  launchOperationBatchContext,
  openExactOperationBatchCard,
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

function verifyBatchDetailIdentity(expected = {}, actual = {}) {
  const conflicts = BATCH_IDENTITY_FIELDS
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
  if (itemCount !== 1) throw operationControlError(`${label}表单项`, itemCount);
  return uniqueVisibleControl(item.locator(selector), label);
}

async function fillVisibleField(page, label, value) {
  const control = await labeledVisibleControl(page, label, "input:visible, textarea:visible");
  await control.fill(text(value));
}

async function chooseVisibleOption(page, label, value) {
  const control = await labeledVisibleControl(
    page,
    label,
    ".ant-select:visible, [role='combobox']:visible",
  );
  await control.click();
  const option = typeof page?.getByRole === "function"
    ? page.getByRole("option", { name: text(value), exact: true })
    : null;
  await clickUniqueVisible(option, `${label}选项 ${text(value)}`);
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

async function syncVisibleRequirements(page, target = [], current = []) {
  const targetNames = new Set(target.map((item) => item.name));
  for (const item of current.filter((candidate) => !targetNames.has(candidate.name))) {
    const rows = await exactVisibleRows(page, item.name);
    if (rows.length !== 1) throw operationControlError(`考务需求 ${item.name} 行`, rows.length);
    await clickUniqueVisible(
      rows[0].getByRole("button", { name: "删除", exact: true }),
      `考务需求 ${item.name} 删除按钮`,
    );
    await confirmTopVisibleDialog(page);
  }
  const currentByName = new Map(current.map((item) => [item.name, item]));
  for (const item of target) {
    const existing = currentByName.get(item.name);
    if (existing && sameData(existing, item)) continue;
    if (existing) {
      const rows = await exactVisibleRows(page, item.name);
      if (rows.length !== 1) throw operationControlError(`考务需求 ${item.name} 行`, rows.length);
      await clickUniqueVisible(
        rows[0].getByRole("button", { name: "编辑", exact: true }),
        `考务需求 ${item.name} 编辑按钮`,
      );
    } else {
      await clickUniqueVisible(
        page.getByRole("button", { name: "新增考务需求", exact: true }),
        "新增考务需求按钮",
      );
    }
    await fillVisibleField(page, "考务需求", item.name);
    await fillVisibleField(page, "需求内容", item.value);
    await confirmTopVisibleDialog(page);
  }
}

function cssAttribute(value) {
  return text(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

async function selectVisiblePeople(dialog, groupName, people) {
  await clickUniqueVisible(
    dialog.getByText(groupName, { exact: true }),
    `人员目录组 ${groupName}`,
  );
  for (const person of people) {
    const candidate = dialog.locator(
      `[data-person-id="${cssAttribute(person.id)}"]:visible`,
    ).filter({ hasText: person.name });
    const exact = await uniqueVisibleControl(candidate, `人员 ${person.id}/${person.name}`);
    const actualName = text(
      await exact.getAttribute("data-person-name") || await exact.innerText(),
    );
    if (actualName !== person.name) throw operationControlError(`人员 ${person.id}/${person.name}`, 0);
    await exact.click();
  }
}

async function readVisibleRecipientChips(page) {
  const read = async (kind) => {
    const chips = page.locator(
      `[data-recipient-kind="${kind}"]:visible [data-person-id]:visible`,
    );
    const count = await chips.count();
    const people = [];
    for (let index = 0; index < count; index += 1) {
      const chip = chips.nth(index);
      people.push({
        id: text(await chip.getAttribute("data-person-id")),
        name: text(await chip.getAttribute("data-person-name") || await chip.innerText()),
      });
    }
    return people;
  };
  return { to: await read("to"), cc: await read("cc") };
}

async function readVisibleTopRightSendRecords(page) {
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
  readPersonnel: (page) => readVisibleSection(page, "personnel"),
  readDates: (page) => readVisibleSection(page, "dates"),
  readRequirements: (page) => readVisibleSection(page, "requirements"),
  readTaskSheet: (page) => readVisibleSection(page, "taskSheet"),
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

  async syncPersonnelConfig(page, personnel = {}) {
    await chooseVisibleOption(page, "人员服务类型", personnel.serviceType);
    await chooseVisibleOption(page, "人员落实平台", personnel.platform);
    await chooseVisibleOption(page, "监考登录监控", personnel.loginMonitoring);
    await chooseVisibleOption(page, "监考比例", personnel.monitorRatio);
    await fillVisibleField(page, "监考人数计算基数", personnel.candidateBasis);
    await fillVisibleField(page, "监考人数", personnel.monitorCount);
    await fillVisibleField(page, "最早登录系统时间", personnel.earliestLoginMinutes);
    await chooseVisibleOption(page, "试考监考", personnel.trialIncluded ? "是" : "否");
    await clickUniqueVisible(
      page.getByRole("button", { name: "保存人员配置", exact: true }),
      "保存人员配置按钮",
    );
  },

  async syncPersonnelDates(page, dates = {}) {
    await fillVisibleField(page, "人员落实开始日期", dates.start);
    await fillVisibleField(page, "人员落实结束日期", dates.end);
    await fillVisibleField(page, "人员名单提交日期", dates.nameListDue);
    await clickUniqueVisible(
      page.getByRole("button", { name: "保存人员日期", exact: true }),
      "保存人员日期按钮",
    );
  },

  syncExamServiceRequirements: (page, target, current) => (
    syncVisibleRequirements(page, target, current)
  ),

  async openTaskSheet(page, instruction = {}) {
    await clickUniqueVisible(
      page.getByRole("tab", { name: "任务单", exact: true }),
      "任务单页签",
    );
    await clickUniqueVisible(
      page.getByText("分散在线监考", { exact: true }),
      "分散在线监考任务单",
    );
    const rows = await exactVisibleRows(page, instruction.batch?.code || instruction.batchCode);
    if (rows.length !== 1) {
      throw operationControlError(`批次 ${instruction.batch?.code || instruction.batchCode} 任务单行`, rows.length);
    }
    await clickUniqueVisible(
      rows[0].getByRole("button", { name: "发送任务单", exact: true }),
      "发送任务单按钮",
    );
  },

  async selectRecipients(page, recipients, instruction = {}) {
    const taskDialog = await topVisibleDialog(page, "任务单弹窗");
    await clickUniqueVisible(
      taskDialog.getByRole("button", { name: "发送", exact: true }),
      "任务单内置发送按钮",
    );
    const directoryDialog = await topVisibleDialog(page, "人员目录弹窗");
    const rule = RECIPIENT_RULES[text(instruction.environment)];
    if (!rule) throw new Error(`未知运控收件环境：${text(instruction.environment) || "空"}`);
    if (recipients.to.length !== 1 || recipients.to[0].name !== rule.toName
      || recipients.cc.length !== rule.ccCount) {
      throw operationControlError("固定收件人与抄送人", 0);
    }
    await clickUniqueVisible(
      directoryDialog.getByRole("tab", { name: "收件人", exact: true }),
      "收件人页签",
    );
    await selectVisiblePeople(directoryDialog, rule.toGroup, recipients.to);
    if (recipients.cc.length) {
      await clickUniqueVisible(
        directoryDialog.getByRole("tab", { name: "抄送人", exact: true }),
        "抄送人页签",
      );
      await selectVisiblePeople(directoryDialog, rule.ccGroup, recipients.cc);
    }
    await clickUniqueVisible(
      directoryDialog.getByRole("button", { name: "确定", exact: true }),
      "人员目录确定按钮",
    );
  },

  readSelectedRecipients: (page) => readVisibleRecipientChips(page),

  async confirmSend(page) {
    await confirmTopVisibleDialog(page);
  },

  async closeTaskSheet(page) {
    const dialog = await topVisibleDialog(page, "任务单弹窗");
    await clickUniqueVisible(
      dialog.getByRole("button", { name: "关闭", exact: true }),
      "任务单关闭按钮",
    );
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
  const record = normalizeSendRecords(records)[0];
  if (!record || record.type !== expectedType) return null;
  const sentAt = Date.parse(record.sentAt);
  if (!Number.isFinite(sentAt) || !Number.isFinite(startedAt) || sentAt <= startedAt) return null;
  return record;
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
