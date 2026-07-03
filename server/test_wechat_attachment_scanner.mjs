import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  defaultWechatFileRoots,
  scanWechatDownloadedFiles,
} from "./wechat_attachment_scanner.mjs";

function makeTempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "wechat-attachments-"));
}

function writeMinimalXlsx(filePath, rows) {
  const root = mkdtempSync(path.join(os.tmpdir(), "xlsx-fixture-"));
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const column = String.fromCharCode("A".charCodeAt(0) + colIndex);
      return `<c r="${column}${rowIndex + 1}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  mkdirSync(path.join(root, "_rels"), { recursive: true });
  mkdirSync(path.join(root, "xl", "_rels"), { recursive: true });
  mkdirSync(path.join(root, "xl", "worksheets"), { recursive: true });
  writeFileSync(path.join(root, "[Content_Types].xml"), `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);
  writeFileSync(path.join(root, "_rels", ".rels"), `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  writeFileSync(path.join(root, "xl", "workbook.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="业务需求单" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
  writeFileSync(path.join(root, "xl", "_rels", "workbook.xml.rels"), `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`);
  writeFileSync(path.join(root, "xl", "worksheets", "sheet1.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRows}</sheetData>
</worksheet>`);
  execFileSync("zip", ["-qr", filePath, "."], { cwd: root });
  rmSync(root, { recursive: true, force: true });
}

function writeMinimalDocx(filePath, paragraphs) {
  const root = mkdtempSync(path.join(os.tmpdir(), "docx-fixture-"));
  mkdirSync(path.join(root, "_rels"), { recursive: true });
  mkdirSync(path.join(root, "word"), { recursive: true });
  writeFileSync(path.join(root, "[Content_Types].xml"), `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  writeFileSync(path.join(root, "_rels", ".rels"), `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  writeFileSync(path.join(root, "word", "document.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphs.map((paragraph) => `<w:p><w:r><w:t>${escapeXml(paragraph)}</w:t></w:r></w:p>`).join("")}</w:body>
</w:document>`);
  execFileSync("zip", ["-qr", filePath, "."], { cwd: root });
  rmSync(root, { recursive: true, force: true });
}

function writeMinimalPdf(filePath, lines) {
  const python = "/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
  execFileSync(python, ["-c", `
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
import sys

pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
c = canvas.Canvas(sys.argv[1])
c.setFont("STSong-Light", 12)
y = 800
for line in sys.argv[2:]:
    c.drawString(72, y, line)
    y -= 22
c.save()
`, filePath, ...lines]);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

test("resolves existing WeChat downloaded file roots without requiring the directory to exist", () => {
  const roots = defaultWechatFileRoots("/Users/example");

  assert.ok(roots.every((root) => root.includes("xwechat_files")));
  assert.ok(roots.every((root) => root.includes("msg/file")));
});

test("extracts previews for text, CSV, XLSX, and image attachments", () => {
  const root = makeTempDir();
  const monthDir = path.join(root, "zhanglexiang_0a18", "msg", "file", "2026-06");
  mkdirSync(monthDir, { recursive: true });
  writeFileSync(path.join(monthDir, "客户说明.txt"), "正式考试 7 月 1 日 10 点到 12 点\n本次不考英语，改成数学\n");
  writeFileSync(path.join(monthDir, "名单.csv"), "姓名,手机号\n张三,13800000000\n");
  writeFileSync(path.join(monthDir, "ignore.tmp"), "ignore me");
  writeMinimalDocx(path.join(monthDir, "客户需求.docx"), [
    "考试名称：AI 运营认证考试",
    "正式考试时间：7 月 1 日 10 点到 12 点",
    "本次不考英语，改成数学",
  ]);
  writeMinimalPdf(path.join(monthDir, "考试方案.pdf"), [
    "考试名称：PDF 认证考试",
    "正式考试时间：7 月 2 日 10 点到 12 点",
    "科目增加数学",
  ]);
  writeMinimalXlsx(path.join(monthDir, "需求单.xlsx"), [
    ["配置项", "填写内容"],
    ["考试名称", "AI 运营考试"],
    ["提前登录时间", "30分钟"],
  ]);
  writeFileSync(path.join(monthDir, "客户截图.png"), "not a real image; test OCR command ignores content");
  const fakeOcr = path.join(root, "fake-ocr.sh");
  writeFileSync(fakeOcr, "#!/bin/sh\nprintf '截图需求：考试时间 7 月 3 日 10 点到 12 点\\n科目：数学\\n'\n");
  chmodSync(fakeOcr, 0o700);

  const result = scanWechatDownloadedFiles({ roots: [root], maxFiles: 10, imageOcrCommand: fakeOcr });

  assert.match(result.scannedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.roots[0].exists, true);
  assert.deepEqual(result.files.map((file) => file.name).sort(), ["名单.csv", "客户截图.png", "客户说明.txt", "客户需求.docx", "考试方案.pdf", "需求单.xlsx"]);
  assert.equal(result.files.find((file) => file.name === "客户说明.txt").kind, "text");
  assert.equal(result.files.find((file) => file.name === "客户需求.docx").kind, "document");
  assert.equal(result.files.find((file) => file.name === "客户截图.png").kind, "image");
  assert.match(result.files.find((file) => file.name === "客户说明.txt").preview, /正式考试 7 月 1 日/);
  assert.match(result.files.find((file) => file.name === "名单.csv").preview, /姓名,手机号/);
  assert.match(result.files.find((file) => file.name === "客户截图.png").preview, /截图需求：考试时间 7 月 3 日/);
  assert.equal(result.files.find((file) => file.name === "客户需求.docx").preview, "");
  assert.equal(result.files.find((file) => file.name === "考试方案.pdf").preview, "");
  assert.match(result.files.find((file) => file.name === "需求单.xlsx").preview, /业务需求单/);
  assert.match(result.files.find((file) => file.name === "需求单.xlsx").preview, /AI 运营考试/);
});

test("scans only recently modified downloaded attachments when a cutoff is provided", () => {
  const root = makeTempDir();
  const monthDir = path.join(root, "zhanglexiang_0a18", "msg", "file", "2026-06");
  mkdirSync(monthDir, { recursive: true });
  const oldFile = path.join(monthDir, "旧需求.txt");
  const newFile = path.join(monthDir, "新需求.txt");
  writeFileSync(oldFile, "旧项目需求，不应该进入本次采集\n");
  writeFileSync(newFile, "新项目需求，考试时间改到 7-1\n");
  const oldDate = new Date("2026-06-20T08:00:00.000Z");
  const newDate = new Date("2026-06-25T08:00:00.000Z");
  utimesSync(oldFile, oldDate, oldDate);
  utimesSync(newFile, newDate, newDate);

  const result = scanWechatDownloadedFiles({
    roots: [root],
    maxFiles: 10,
    modifiedSince: "2026-06-24T00:00:00.000Z",
  });

  assert.deepEqual(result.files.map((file) => file.name), ["新需求.txt"]);
  assert.match(result.files[0].preview, /考试时间改到 7-1/);
});

test("decodes GB18030 text attachments when UTF-8 would be garbled", () => {
  const root = makeTempDir();
  const monthDir = path.join(root, "zhanglexiang_0a18", "msg", "file", "2026-06");
  mkdirSync(monthDir, { recursive: true });
  writeFileSync(
    path.join(monthDir, "平台参数.txt"),
    Buffer.from("c9ccbba7415049b5d8d6b7a3ba68747470733a2f2f6d65726368616e746170692e6578616d2d73702e636f6d2f6f70656e2d617069732f0ad3a6d3c34944a3ba6162633132330abfbccad4cab1bce4b8c4b5bd20372d310a", "hex"),
  );

  const result = scanWechatDownloadedFiles({ roots: [root], maxFiles: 10 });

  assert.match(result.files[0].preview, /商户API地址/);
  assert.match(result.files[0].preview, /应用ID：abc123/);
  assert.match(result.files[0].preview, /考试时间改到 7-1/);
});

test("keeps scanning when one downloaded text attachment cannot be read", () => {
  const root = makeTempDir();
  const monthDir = path.join(root, "zhanglexiang_0a18", "msg", "file", "2026-06");
  mkdirSync(monthDir, { recursive: true });
  const unreadableFile = path.join(monthDir, "不可读附件.txt");
  writeFileSync(path.join(monthDir, "正常附件.txt"), "考试时间改到 7-1\n");
  writeFileSync(unreadableFile, "不应中断扫描\n");
  chmodSync(unreadableFile, 0o000);

  try {
    const result = scanWechatDownloadedFiles({ roots: [root], maxFiles: 10 });

    assert.deepEqual(result.files.map((file) => file.name).sort(), ["不可读附件.txt", "正常附件.txt"]);
    assert.equal(result.files.find((file) => file.name === "不可读附件.txt").preview, "");
    assert.match(result.files.find((file) => file.name === "正常附件.txt").preview, /考试时间改到 7-1/);
  } finally {
    chmodSync(unreadableFile, 0o600);
  }
});
