import fs from "node:fs/promises";
import path from "node:path";

import { sendSmtpMail } from "./smtp_mailer.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function firstValue(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value;
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return "";
}

function display(value) {
  return text(value) || "—";
}

function emailAddress(value) {
  const email = text(value);
  if (!/^[^\s@<>(),;:\\"\[\]]+@[^\s@<>(),;:\\"\[\]]+\.[^\s@<>(),;:\\"\[\]]+$/.test(email)) {
    throw new Error(`邮箱地址格式不正确：${email || "空地址"}`);
  }
  return email;
}

function draftField(task = {}, key) {
  return text(task.config?.operationBatch?.draft?.fields?.[key]?.value);
}

function dateFromText(value) {
  const match = text(value).match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function scheduleDates(business = {}, formalExamTime = "") {
  const formalMatches = [...text(formalExamTime).matchAll(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g)]
    .map((item) => dateFromText(item[0]))
    .filter(Boolean);
  if (formalMatches.length) {
    return {
      start: formalMatches[0],
      end: formalMatches[formalMatches.length - 1] || formalMatches[0],
    };
  }
  const dates = Array.isArray(business.exam_schedule)
    ? business.exam_schedule.map((item) => dateFromText(item?.exam_date)).filter(Boolean)
    : [];
  if (dates.length) return { start: dates[0], end: dates[dates.length - 1] };
  const matches = [...text(business.formal_exam_time_range).matchAll(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g)]
    .map((item) => dateFromText(item[0]))
    .filter(Boolean);
  return { start: matches[0] || "", end: matches[matches.length - 1] || matches[0] || "" };
}

function subjectRows(value) {
  const subjects = Array.isArray(value) ? value : (text(value) ? [value] : []);
  return subjects.map((item) => {
    if (typeof item === "object" && item !== null) {
      return {
        name: text(item.name || item.subjectName || item.courseName || item.subject || item.value),
        duration: text(item.durationMinutes || item.duration || item.examDuration || item.minutes || item["时长（分钟）"]),
        remark: text(item.remark || item.note || item["备注"]),
      };
    }
    return { name: text(item), duration: "", remark: "" };
  }).filter((item) => item.name);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInfoRows(rows) {
  return rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(display(value))}</td></tr>`).join("");
}

export function normalizeEmailSettings(input = {}, existing = {}) {
  const password = input.clearPassword === true
    ? ""
    : text(input.password) || text(existing.password);
  return {
    host: text(input.host) || text(existing.host) || "smtp.office365.com",
    port: Number(input.port || existing.port || 587),
    secure: input.secure === true,
    fromEmail: text(input.fromEmail) || text(existing.fromEmail),
    fromName: text(input.fromName) || text(existing.fromName),
    username: text(input.username) || text(existing.username),
    password,
  };
}

export function redactEmailSettings(settings = {}) {
  return {
    host: text(settings.host) || "smtp.office365.com",
    port: Number(settings.port || 587),
    secure: settings.secure === true,
    fromEmail: text(settings.fromEmail),
    fromName: text(settings.fromName),
    username: text(settings.username),
    passwordConfigured: Boolean(text(settings.password)),
  };
}

export function parseEmailRecipients(value) {
  return String(value || "")
    .split(/[;,\n，；]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map(emailAddress);
}

export async function writeEmailSettingsFile(filePath, settings) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(tempPath, filePath);
    await fs.chmod(filePath, 0o600);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

export function buildContentRequirementEmail({ task = {}, requirement = {} } = {}) {
  const business = task.config?.businessRequirement || {};
  const examRequirement = task.config?.examRequirement || {};
  const requirementConfig = examRequirement.config || {};
  const requirementFields = examRequirement.fields || {};
  const supplements = examRequirement.supplements || {};
  const strictSnapshot = Boolean(Object.keys(examRequirement).length);
  const legacyBusiness = strictSnapshot ? {} : business;
  const latest = requirement.latest?.requirement || {};
  const projectName = firstValue(latest.exam_name, latest.examName, latest.projectName, requirementConfig.examName, requirementFields["考试名称"], task.projectName);
  const customerName = firstValue(latest.customerName, requirement.customer?.name, requirementConfig.customerName, task.config?.customerName, legacyBusiness.customer_name);
  const projectCode = firstValue(business.project_code, task.config?.projectCode);
  const batchCode = firstValue(task.config?.operationBatchCode, task.config?.operationBatch?.code);
  const formalExamTime = firstValue(
    latest.formal_exam_time_range,
    latest.formalExamTime,
    latest.examTime,
    latest.startTimeDisplay,
    requirementFields["考试日期时间"],
    requirementConfig.startTimeDisplay && requirementConfig.endTimeDisplay
      ? `${requirementConfig.startTimeDisplay}-${requirementConfig.endTimeDisplay}`
      : "",
    legacyBusiness.formal_exam_time,
    legacyBusiness.exam_time,
  );
  const trialExamTime = firstValue(
    latest.mock_exam_time_range,
    latest.trialExamTime,
    latest.mockStartTimeDisplay,
    requirementFields["试考日期时间"],
    requirementConfig.mockStartTimeDisplay && requirementConfig.mockEndTimeDisplay
      ? `${requirementConfig.mockStartTimeDisplay}-${requirementConfig.mockEndTimeDisplay}`
      : "",
    legacyBusiness.trial_exam_time,
  );
  const dates = scheduleDates(legacyBusiness, formalExamTime);
  const batchName = firstValue(draftField(task, "batchName"), task.config?.operationBatch?.batchName);
  const examStartDate = firstValue(draftField(task, "examStartDate"), dates.start);
  const examEndDate = firstValue(draftField(task, "examEndDate"), dates.end);
  const systemType = firstValue(supplements.systemType, latest.systemType, strictSnapshot ? "易考" : draftField(task, "systemType"), legacyBusiness.system_type);
  const maxSubjectCount = firstValue(supplements.estimatedMaxSubjectCount, latest.estimatedMaxSubjectCount, strictSnapshot ? "" : draftField(task, "estimatedMaxSubjectCount"), legacyBusiness.estimated_subject_count);
  const projectManager = firstValue(latest.projectManager, latest.project_manager, requirementConfig.projectManager, supplements.projectManager, strictSnapshot ? "" : legacyBusiness.project_manager, task.config?.projectManager);
  const interfaceBackground = firstValue(latest.interfaceBackground, latest.interface_background, supplements.interfaceBackground, task.config?.interfaceBackground);
  const loginMethod = firstValue(latest.loginMethod, latest.login_method, supplements.loginMethod, task.config?.loginMethod);
  const paperLanguage = firstValue(latest.paperLanguage, latest.paper_language, supplements.paperLanguage, task.config?.paperLanguage);
  const systemLanguage = firstValue(latest.systemLanguage, latest.system_language, supplements.systemLanguage, task.config?.systemLanguage);
  const tenantName = firstValue(latest.tenantName, latest.tenant_name, supplements.tenantName, task.config?.tenantName);
  const tenantId = firstValue(latest.tenantId, latest.tenant_id, supplements.tenantId, task.config?.tenantId);
  const requirementVersion = firstValue(requirement.latest?.version, examRequirement.version);
  const subjects = subjectRows(firstValue(latest.subjects, latest.examSubjects, requirementConfig.courses, requirementConfig.subjects, requirementFields["科目信息"], legacyBusiness.subjects));
  const sendCount = Array.isArray(task.config?.contentRequirementEmail?.history)
    ? task.config.contentRequirementEmail.history.length
    : 0;
  const title = `${projectManager ? `${projectManager}_` : ""}${batchName || projectName || task.taskId || "未命名项目"}、内容任务单`;
  const basicInfo = [
    ["项目编码", projectCode],
    ["项目名称", projectName],
    ["需求版本", requirementVersion],
    ["批次代码", batchCode],
    ["批次名称", batchName],
    ["系统类型", systemType],
    ["考试开始日期", examStartDate],
    ["考试结束日期", examEndDate],
    ["考试名称", projectName],
    ["界面背景", interfaceBackground],
    ["登录方式", loginMethod],
    ["单科最大科次", maxSubjectCount],
    ["试卷使用语言", paperLanguage],
    ["操作系统语言", systemLanguage],
    ["封场或试考开始时间", trialExamTime],
    ["封场或试考结束时间", trialExamTime],
    ["租户名称", tenantName],
    ["租户ID", tenantId],
  ];
  const subjectText = subjects.length
    ? subjects.map((item) => `${display(item.name)}  ${display(item.duration)}  ${display(item.remark)}`).join("\n")
    : "—  —  —";
  const lines = [
    "内容任务单",
    "",
    `发送记录：${sendCount ? "再次发送" : "首次发送"}`,
    `客户名称：${display(customerName)}`,
    `项目经理：${display(projectManager)}`,
    "",
    "基本信息",
    ...basicInfo.map(([label, value]) => `${label}：${display(value)}`),
    "",
    "科目信息",
    "科目名称  时长（分钟）  备注",
    subjectText,
    "",
    "系统自动发送，请勿回复本邮件，有问题请联系项目经理。",
  ];
  const subjectHtml = subjects.length
    ? subjects.map((item) => `<tr><td>${escapeHtml(display(item.name))}</td><td>${escapeHtml(display(item.duration))}</td><td>${escapeHtml(display(item.remark))}</td></tr>`).join("")
    : "<tr><td>—</td><td>—</td><td>—</td></tr>";
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#f5f7fb;color:#1f2937;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}.mail{max-width:760px;margin:0 auto;background:#fff;border:1px solid #d9e2ef}.head{padding:22px 28px;background:#1867b7;color:#fff}.head h1{margin:0;font-size:22px}.section{padding:20px 28px 0}.section h2{margin:0 0 10px;font-size:17px;color:#1d3656}table{width:100%;border-collapse:collapse}th,td{padding:9px 10px;border:1px solid #d9e2ef;text-align:left;vertical-align:top}th{width:34%;background:#f3f7fc;font-weight:600}.subject th{width:auto}.foot{margin-top:20px;padding:16px 28px;background:#f3f7fc;color:#607086;font-size:12px}</style></head><body><main class="mail"><header class="head"><h1>内容任务单</h1></header><section class="section"><p>发送记录：${sendCount ? "再次发送" : "首次发送"}</p><p>客户名称：${escapeHtml(display(customerName))}<br>项目经理：${escapeHtml(display(projectManager))}</p><h2>基本信息</h2><table>${renderInfoRows(basicInfo)}</table></section><section class="section"><h2>科目信息</h2><table class="subject"><thead><tr><th>科目名称</th><th>时长（分钟）</th><th>备注</th></tr></thead><tbody>${subjectHtml}</tbody></table></section><footer class="foot">系统自动发送，请勿回复本邮件，有问题请联系项目经理。</footer></main></body></html>`;
  return {
    subject: title,
    text: lines.join("\n"),
    html,
  };
}

export async function sendContentRequirementEmail({
  task = {},
  requirement = {},
  recipients,
  emailSettings,
  sendMail = sendSmtpMail,
} = {}) {
  const to = parseEmailRecipients(recipients);
  if (!to.length) throw new Error("请填写收件人");
  const settings = normalizeEmailSettings(emailSettings);
  if (!settings.fromEmail) throw new Error("请先配置发件邮箱");
  if (!settings.username) throw new Error("请先配置 SMTP 用户名");
  if (!settings.password) throw new Error("请先配置 SMTP 密码或应用密码");
  const message = buildContentRequirementEmail({ task, requirement });
  const sent = await sendMail({
    settings,
    from: { email: settings.fromEmail, name: settings.fromName },
    to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return {
    sentAt: new Date().toISOString(),
    recipients: to,
    subject: message.subject,
    messageId: sent?.messageId || "",
  };
}
