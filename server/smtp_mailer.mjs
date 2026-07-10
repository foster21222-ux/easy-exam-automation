import net from "node:net";
import tls from "node:tls";

function text(value) {
  return String(value ?? "").trim();
}

function b64(value) {
  return Buffer.from(String(value), "utf8").toString("base64");
}

function dotStuff(value) {
  return String(value).replace(/^\./gm, "..");
}

function formatAddress(address) {
  const email = text(address?.email || address);
  const name = text(address?.name);
  if (!name) return `<${email}>`;
  return `${JSON.stringify(name)} <${email}>`;
}

export function createSmtpMessage({ from, to = [], subject, text: body, html }) {
  const messageId = `<${Date.now()}.${Math.random().toString(16).slice(2)}@easy-exam-automation.local>`;
  const boundary = `easy-exam-${Math.random().toString(16).slice(2)}`;
  const hasHtml = Boolean(text(html));
  const headers = [
    `From: ${formatAddress(from)}`,
    `To: ${to.join(", ")}`,
    `Subject: ${text(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
  ];
  const bodyParts = hasHtml
    ? [
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      text(body),
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      text(html),
      `--${boundary}--`,
    ]
    : [
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      text(body),
    ];
  return {
    messageId,
    raw: `${dotStuff(headers.concat(bodyParts).join("\r\n"))}\r\n.`,
  };
}

export function friendlySmtpErrorMessage(response) {
  const raw = text(response);
  if (/535\s+5\.7\.3/i.test(raw) || /Authentication unsuccessful/i.test(raw)) {
    return `Outlook 公司邮箱认证失败。请确认 SMTP 用户名是完整公司邮箱，密码使用邮箱密码或应用密码；如果账号启用了 MFA、条件访问或企业禁用了 SMTP AUTH，需要管理员为该邮箱启用 SMTP AUTH，或改用 Microsoft Graph/OAuth 发信。原始返回：${raw}`;
  }
  return `SMTP 命令失败：${raw}`;
}

function connectSocket(settings) {
  const port = Number(settings.port || 587);
  const host = text(settings.host);
  if (settings.secure === true) {
    return tls.connect({ host, port, servername: host });
  }
  return net.connect({ host, port });
}

function smtpSession(socket) {
  let buffer = "";
  const pending = [];
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      const lines = buffer.split(/\r?\n/);
      if (!lines.length) return;
      const completeIndex = lines.findIndex((line) => /^\d{3} /.test(line));
      if (completeIndex === -1) return;
      const responseLines = lines.slice(0, completeIndex + 1).filter(Boolean);
      buffer = lines.slice(completeIndex + 1).join("\n");
      const current = pending.shift();
      if (current) current(responseLines.join("\n"));
    }
  });
  function read() {
    return new Promise((resolve, reject) => {
      pending.push(resolve);
      socket.once("error", reject);
    });
  }
  async function command(line, expected = /^2|^3/) {
    if (line) socket.write(`${line}\r\n`);
    const response = await read();
    if (!expected.test(response)) throw new Error(friendlySmtpErrorMessage(response));
    return response;
  }
  return { command };
}

export async function sendSmtpMail({ settings = {}, from, to = [], subject, text: body, html } = {}) {
  const socket = connectSocket(settings);
  const session = smtpSession(socket);
  try {
    await session.command("", /^220/);
    await session.command("EHLO easy-exam-automation.local");
    let activeSocket = socket;
    let activeSession = session;
    if (settings.secure !== true) {
      await activeSession.command("STARTTLS", /^220/);
      activeSocket = tls.connect({ socket, servername: text(settings.host) });
      activeSession = smtpSession(activeSocket);
      await activeSession.command("EHLO easy-exam-automation.local");
    }
    await activeSession.command("AUTH LOGIN", /^334/);
    await activeSession.command(b64(settings.username), /^334/);
    await activeSession.command(b64(settings.password), /^235/);
    await activeSession.command(`MAIL FROM:<${text(from?.email || from)}>`);
    for (const recipient of to) {
      await activeSession.command(`RCPT TO:<${recipient}>`);
    }
    await activeSession.command("DATA", /^354/);
    const message = createSmtpMessage({ from, to, subject, text: body, html });
    await activeSession.command(message.raw);
    await activeSession.command("QUIT", /^221|^2/);
    activeSocket.end();
    return { messageId: message.messageId };
  } catch (error) {
    socket.destroy();
    throw error;
  }
}
