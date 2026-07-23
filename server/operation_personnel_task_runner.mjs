import path from "node:path";
import {
  launchOperationBatchContext,
  runWithOperationBatchContext,
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
  return {
    type: text(raw.type),
    conditions: [...(raw.conditions || [])].map(text),
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

function batchCodeFromRow(row = {}) {
  return text(row.code || row.batchCode);
}

async function readBatchRows(page) {
  const rows = await page.locator("tbody tr").all();
  return Promise.all(rows.map(async (row) => {
    const cells = (await row.locator("td").allInnerTexts()).map(text);
    const codes = cells.flatMap((cell) => cell.match(/\b[A-Z]{3}\d{6}\b/g) || []);
    return { code: codes.length === 1 ? codes[0] : "", row };
  }));
}

async function openBatchRow(page, row) {
  const target = row.row?.getByText(row.code, { exact: true }).first();
  if (!target) throw new Error(`批次代码 ${row.code} 的页面行不可打开`);
  await target.click();
  if (typeof page.waitForLoadState === "function") {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
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
      return clean(control?.value ?? control?.textContent ?? "");
    };
    const table = (requiredHeaders) => {
      for (const node of document.querySelectorAll("table")) {
        if (!visible(node)) continue;
        const headers = [...node.querySelectorAll("thead th")].map((item) => clean(item.textContent));
        if (!requiredHeaders.every((header) => headers.includes(header))) continue;
        return [...node.querySelectorAll("tbody tr")].map((row) => Object.fromEntries(
          [...row.querySelectorAll("td")].map((cell, index) => [headers[index], clean(cell.textContent)]),
        ));
      }
      return [];
    };
    const schedules = table(["日程代码", "开始时间"]).map((row) => ({
      scheduleCode: row["日程代码"],
      subjectCode: row["科目代码"],
      subjectName: row["科目名称"],
      start: row["开始时间"],
      end: row["结束时间"],
      durationMinutes: row["时长"],
      earlyLoginMinutes: row["提前登录分钟数"],
    }));
    const requirements = table(["考务需求"]).map((row) => ({
      name: row["考务需求"],
      value: row["需求内容"] || row["配置"],
    }));
    const sendRecords = table(["发送类型", "发送时间"]).map((row) => ({
      type: row["发送类型"],
      sentAt: row["发送时间"],
    }));
    const groups = [...document.querySelectorAll("[data-directory-group]")].filter(visible).map((group) => ({
      name: clean(group.getAttribute("data-directory-group")),
      people: [...group.querySelectorAll("[data-person-id]")].filter(visible).map((person) => ({
        id: clean(person.getAttribute("data-person-id")),
        name: clean(person.getAttribute("data-person-name") || person.textContent),
      })),
    }));
    return {
      batch: {
        code: field("批次代码"),
        projectCode: field("项目编码"),
        projectName: field("项目名称"),
        batchName: field("批次名称"),
        projectDepartment: field("项目部归属"),
        projectManager: field("项目经理"),
        systemType: field("系统类型"),
        published: field("发布状态") === "已发布",
      },
      schedules,
      personnel: {
        serviceType: field("人员服务类型"),
        platform: field("人员落实平台"),
        loginMonitoring: field("监考登录监控"),
        monitorRatio: field("监考比例"),
        candidateBasis: field("监考人数计算基数"),
        monitorCount: field("监考人数"),
        earliestLoginMinutes: field("最早登录系统时间"),
        trialIncluded: field("试考监考") === "是",
      },
      dates: {
        start: field("人员落实开始日期"),
        end: field("人员落实结束日期"),
        nameListDue: field("人员名单提交日期"),
      },
      requirements,
      taskSheet: {
        type: field("任务单类型"),
        conditions: table(["发送条件"]).map((row) => row["发送条件"]),
        content: field("任务单内容"),
      },
      sendRecords,
      directoryGroups: groups,
    };
  });
}

export async function inspectOperationPersonnelTask(page, instruction = {}, options = {}) {
  const batchCode = text(instruction.batch?.code || instruction.batchCode);
  if (!batchCode) throw new Error("缺少运控批次代码");
  const baseUrl = text(options.baseUrl || process.env.OPERATION_CONSOLE_BASE_URL || "http://172.16.18.198:8020");
  if (typeof page.goto === "function") {
    await page.goto(`${baseUrl.replace(/\/$/, "")}/batch/batchList`, { waitUntil: "domcontentloaded" });
  }
  const rows = await (options.readBatchRows || readBatchRows)(page);
  const matches = rows.filter((row) => batchCodeFromRow(row) === batchCode);
  if (!matches.length) throw new Error(`未找到批次代码 ${batchCode}`);
  if (matches.length !== 1) throw new Error(`批次代码 ${batchCode} 精确匹配到 ${matches.length} 行`);
  await (options.openBatchRow || openBatchRow)(page, matches[0]);

  let visibleSnapshot;
  const visible = async () => {
    visibleSnapshot ||= await readVisibleOperationPersonnelSnapshot(page);
    return visibleSnapshot;
  };
  const read = async (optionName, key, fallback) => typeof options[optionName] === "function"
    ? options[optionName](page, instruction)
    : ((await visible())[key] ?? fallback);
  const groups = await read("readDirectoryGroups", "directoryGroups", []);
  const environment = text(instruction.environment);
  const matched = matchOperationPersonnelRecipients({ environment, groups });
  return normalizeOperationPersonnelSnapshot({
    batch: await read("readBatch", "batch", {}),
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

export function operationPersonnelConflicts(expected = {}, actual = {}, mode = "initial") {
  if (!["initial", "resend"].includes(mode)) throw new Error(`未知人员任务冲突模式：${mode}`);
  const expectedFields = flatten(expected);
  const actualFields = flatten(actual);
  const paths = [...new Set([...expectedFields.keys(), ...actualFields.keys()])].sort();
  return paths.flatMap((fieldPath) => {
    const expectedValue = expectedFields.get(fieldPath);
    const actualValue = actualFields.get(fieldPath);
    if (sameValue(expectedValue, actualValue)) return [];
    const batchIdentity = fieldPath.startsWith("batch.");
    if (mode === "initial" && !batchIdentity && empty(actualValue)) return [];
    return [{ path: fieldPath, expected: expectedValue ?? "", actual: actualValue ?? "" }];
  });
}

export async function runOperationPersonnelInspection(instruction, options = {}) {
  const userDataDir = text(options.userDataDir || process.env.OPERATION_CONSOLE_USER_DATA_DIR
    || path.join(process.cwd(), ".easy_exam_runtime", "operation-console-profile"));
  const headless = options.headless ?? process.env.OPERATION_CONSOLE_HEADLESS === "1";
  const context = await launchOperationBatchContext(userDataDir, headless, options);
  return runWithOperationBatchContext(
    context,
    (page) => inspectOperationPersonnelTask(page, instruction, options),
    { preserveResultOnCloseFailure: true },
  );
}
