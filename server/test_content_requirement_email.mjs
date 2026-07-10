import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContentRequirementEmail,
  normalizeEmailSettings,
  redactEmailSettings,
  sendContentRequirementEmail,
} from "./content_requirement_email.mjs";
import { createSmtpMessage, friendlySmtpErrorMessage } from "./smtp_mailer.mjs";

test("email settings use Outlook SMTP defaults and do not store default recipients", () => {
  const settings = normalizeEmailSettings({
    fromEmail: "ops@example.com",
    fromName: "运营自动化",
    username: "ops@example.com",
    password: "secret",
    defaultRecipients: "customer@example.com",
  });

  assert.equal(settings.host, "smtp.office365.com");
  assert.equal(settings.port, 587);
  assert.equal(settings.secure, false);
  assert.equal(settings.fromEmail, "ops@example.com");
  assert.equal(settings.fromName, "运营自动化");
  assert.equal(settings.username, "ops@example.com");
  assert.equal(settings.password, "secret");
  assert.equal(settings.defaultRecipients, undefined);

  const redacted = redactEmailSettings(settings);
  assert.equal(redacted.password, undefined);
  assert.equal(redacted.passwordConfigured, true);
  assert.equal(redacted.defaultRecipients, undefined);
});

test("content task email renders the approved template and preserves missing fields", async () => {
  const task = {
    taskId: "task-1",
    projectName: "北京农商银行公文大赛",
    config: {
      operationBatchCode: "QTT260007",
      operationBatch: {
        draft: {
          fields: {
            batchName: { value: "北京农商银行公文大赛_2026年7月" },
            examStartDate: { value: "2026-07-10" },
            examEndDate: { value: "2026-07-10" },
            systemType: { value: "易考" },
            estimatedMaxSubjectCount: { value: "2" },
          },
        },
      },
      businessRequirement: {
        customer_name: "北京农商银行",
        project_code: "F0020592",
      },
    },
  };
  const requirement = {
    latest: {
      requirement: {
        examName: "北京农商银行公文大赛",
        subjects: [{ name: "英语", durationMinutes: 60 }, "数学"],
        formalExamTime: "2026/7/10 10:00-12:00",
      },
    },
  };
  const message = buildContentRequirementEmail({ task, requirement });
  assert.equal(message.subject, "北京农商银行公文大赛_2026年7月、内容任务单");
  assert.match(message.text, /内容任务单/);
  assert.match(message.text, /项目编码：F0020592/);
  assert.match(message.text, /批次名称：北京农商银行公文大赛_2026年7月/);
  assert.match(message.text, /英语\s+60/);
  assert.match(message.text, /项目经理：—/);
  assert.match(message.html, /<table/);
  assert.match(message.html, /项目编码/);
  assert.match(message.html, /F0020592/);
  assert.match(message.html, /科目信息/);
  assert.match(message.html, /英语/);
  assert.match(message.html, /60/);
  assert.match(message.html, /系统自动发送，请勿回复本邮件/);
});

test("content task email requires explicit recipients and sends text plus HTML", async () => {
  const task = {
    taskId: "task-1",
    projectName: "北京农商银行公文大赛",
    config: {
      operationBatchCode: "QTT260007",
      businessRequirement: {
        customer_name: "北京农商银行",
        project_code: "F0020592",
      },
    },
  };
  const requirement = {
    latest: {
      requirement: {
        examName: "北京农商银行公文大赛",
        subjects: ["英语", "数学"],
        formalExamTime: "2026/7/10 10:00-12:00",
      },
    },
  };

  await assert.rejects(
    () => sendContentRequirementEmail({
      task,
      requirement,
      recipients: "",
      emailSettings: normalizeEmailSettings({
        fromEmail: "ops@example.com",
        username: "ops@example.com",
        password: "secret",
      }),
      sendMail: async () => ({}),
    }),
    /请填写收件人/,
  );

  const sent = [];
  const result = await sendContentRequirementEmail({
    task,
    requirement,
    recipients: "customer@example.com; owner@example.com",
    emailSettings: normalizeEmailSettings({
      fromEmail: "ops@example.com",
      fromName: "运营自动化",
      username: "ops@example.com",
      password: "secret",
    }),
    sendMail: async (payload) => {
      sent.push(payload);
      return { messageId: "test-message-id" };
    },
  });

  assert.deepEqual(result.recipients, ["customer@example.com", "owner@example.com"]);
  assert.equal(result.messageId, "test-message-id");
  assert.equal(sent[0].from.email, "ops@example.com");
  assert.deepEqual(sent[0].to, ["customer@example.com", "owner@example.com"]);
  assert.match(sent[0].text, /客户名称：北京农商银行/);
  assert.match(sent[0].html, /北京农商银行/);
});

test("SMTP message uses multipart alternative when HTML content is provided", () => {
  const message = createSmtpMessage({
    from: { email: "ops@example.com", name: "运营自动化" },
    to: ["customer@example.com"],
    subject: "内容任务单",
    text: "纯文本内容",
    html: "<p>HTML 内容</p>",
  });

  assert.match(message.raw, /Content-Type: multipart\/alternative; boundary=/);
  assert.match(message.raw, /Content-Type: text\/plain; charset=utf-8/);
  assert.match(message.raw, /Content-Type: text\/html; charset=utf-8/);
  assert.match(message.raw, /纯文本内容/);
  assert.match(message.raw, /<p>HTML 内容<\/p>/);
});

test("SMTP auth failures are translated to actionable Outlook guidance", () => {
  const message = friendlySmtpErrorMessage("535 5.7.3 Authentication unsuccessful");

  assert.match(message, /Outlook 公司邮箱认证失败/);
  assert.match(message, /SMTP AUTH/);
  assert.match(message, /应用密码/);
});
