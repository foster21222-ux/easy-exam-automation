import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SUPPORTED_EXTENSIONS = new Map([
  [".xlsx", "spreadsheet"],
  [".xls", "spreadsheet"],
  [".csv", "text"],
  [".txt", "text"],
  [".pdf", "pdf"],
  [".docx", "document"],
  [".doc", "document"],
  [".png", "image"],
  [".jpg", "image"],
  [".jpeg", "image"],
]);

export function defaultWechatFileRoots(homeDir = os.homedir()) {
  const base = path.join(
    homeDir,
    "Library",
    "Containers",
    "com.tencent.xinWeChat",
    "Data",
    "Documents",
    "xwechat_files",
  );
  return [
    path.join(base, "*", "msg", "file"),
  ];
}

export function scanWechatDownloadedFiles({
  roots = defaultWechatFileRoots(),
  maxFiles = 200,
  previewChars = 1200,
  modifiedSince = "",
  imageOcrCommand = path.join(rootDir, "scripts", "ocr_image.swift"),
} = {}) {
  const scannedAt = new Date().toISOString();
  const resolvedRoots = expandRoots(roots);
  const files = [];
  const seenPaths = new Set();
  const modifiedSinceMs = Date.parse(modifiedSince);
  for (const root of resolvedRoots) {
    if (!root.exists) continue;
    collectFiles(root.path, files, {
      maxFiles,
      previewChars,
      imageOcrCommand,
      seenPaths,
      modifiedSinceMs: Number.isFinite(modifiedSinceMs) ? modifiedSinceMs : 0,
    });
    if (files.length >= maxFiles) break;
  }
  files.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  return {
    scannedAt,
    roots: resolvedRoots,
    files: files.slice(0, maxFiles),
  };
}

function expandRoots(roots) {
  return roots.flatMap((root) => {
    if (!root.includes("*")) {
      return [{ path: root, exists: existsSync(root) }];
    }
    const [prefix, suffix] = root.split("*");
    if (!existsSync(prefix)) return [{ path: root, exists: false }];
    return readdirSync(prefix, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(prefix, entry.name, suffix))
      .map((expanded) => ({ path: expanded, exists: existsSync(expanded) }));
  });
}

function collectFiles(currentPath, files, options) {
  if (files.length >= options.maxFiles) return;
  let entries = [];
  try {
    entries = readdirSync(currentPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (files.length >= options.maxFiles) return;
    const fullPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, files, options);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const kind = SUPPORTED_EXTENSIONS.get(ext);
    if (!kind) continue;
    if (options.seenPaths.has(fullPath)) continue;
    options.seenPaths.add(fullPath);
    const stat = statSync(fullPath);
    if (options.modifiedSinceMs && stat.mtimeMs < options.modifiedSinceMs) continue;
    files.push({
      path: fullPath,
      name: entry.name,
      extension: ext,
      kind,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      preview: readPreviewSafely(fullPath, ext, {
        previewChars: options.previewChars,
        imageOcrCommand: options.imageOcrCommand,
      }),
    });
  }
}

function readPreviewSafely(filePath, ext, options = {}) {
  try {
    return readPreview(filePath, ext, options);
  } catch {
    return "";
  }
}

function readPreview(filePath, ext, { previewChars, imageOcrCommand } = {}) {
  if (ext === ".txt" || ext === ".csv") {
    return readTextPreview(filePath, previewChars);
  }
  if (ext === ".xlsx") {
    return readXlsxPreview(filePath, previewChars);
  }
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg") {
    return readImagePreview(filePath, imageOcrCommand, previewChars);
  }
  return "";
}

function readTextPreview(filePath, previewChars) {
  const byteLimit = Math.max(4096, previewChars * 4);
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(byteLimit);
    const bytesRead = readSync(fd, buffer, 0, byteLimit, 0);
    return limitPreview(decodeTextBuffer(buffer.subarray(0, bytesRead)), previewChars);
  } finally {
    closeSync(fd);
  }
}

function decodeTextBuffer(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("gb18030").decode(buffer);
  }
}

function readXlsxPreview(filePath, previewChars) {
  try {
    const workbookXml = unzipText(filePath, "xl/workbook.xml");
    const relsXml = unzipText(filePath, "xl/_rels/workbook.xml.rels");
    const relationshipTargets = Object.fromEntries(
      [...relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)].map((match) => {
        const attrs = match[1];
        return [attribute(attrs, "Id"), normalizeSheetTarget(attribute(attrs, "Target"))];
      }).filter(([id, target]) => id && target.includes("worksheets/")),
    );
    const sheets = [...workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)].map((match) => {
      const attrs = match[1];
      return {
        name: decodeXml(attribute(attrs, "name")),
        target: relationshipTargets[attribute(attrs, "r:id")],
      };
    }).filter((sheet) => sheet.target);
    const sharedStrings = readSharedStrings(filePath);
    const parts = [];
    for (const sheet of sheets) {
      if (parts.join("\n").length >= previewChars) break;
      if (sheet.name) parts.push(sheet.name);
      const sheetXml = unzipText(filePath, sheet.target);
      parts.push(extractSheetText(sheetXml, sharedStrings));
    }
    return limitPreview(parts.filter(Boolean).join("\n"), previewChars);
  } catch {
    return "";
  }
}

function readImagePreview(filePath, imageOcrCommand, previewChars) {
  const command = buildImageOcrCommand(imageOcrCommand, filePath);
  const text = execFileSync(command[0], command.slice(1), {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return limitPreview(text, previewChars);
}

function buildImageOcrCommand(imageOcrCommand, filePath) {
  const tool = String(imageOcrCommand || "").trim() || path.join(rootDir, "scripts", "ocr_image.swift");
  return tool.endsWith(".swift")
    ? ["swift", tool, filePath]
    : [tool, filePath];
}

function readSharedStrings(filePath) {
  try {
    const xml = unzipText(filePath, "xl/sharedStrings.xml");
    return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => {
      return [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
        .map((textMatch) => decodeXml(textMatch[1]))
        .join("");
    });
  } catch {
    return [];
  }
}

function extractSheetText(sheetXml, sharedStrings) {
  const values = [];
  for (const cellMatch of sheetXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attrs = cellMatch[1];
    const body = cellMatch[2];
    const inline = body.match(/<is\b[^>]*>[\s\S]*?<t\b[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
    if (inline?.[1]) {
      values.push(decodeXml(inline[1]));
      continue;
    }
    const value = body.match(/<v>([\s\S]*?)<\/v>/);
    if (!value?.[1]) continue;
    if (/\bt="s"/.test(attrs)) {
      values.push(sharedStrings[Number(value[1])] || "");
    } else {
      values.push(decodeXml(value[1]));
    }
  }
  return values.filter(Boolean).join("\n");
}

function unzipText(filePath, memberPath) {
  return execFileSync("unzip", ["-p", filePath, memberPath], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function normalizeSheetTarget(target) {
  const clean = target.replace(/^\/+/, "");
  return clean.startsWith("xl/") ? clean : `xl/${clean}`;
}

function attribute(attrs, name) {
  const escaped = name.replace(":", "[:]");
  const match = attrs.match(new RegExp(`\\b${escaped}="([^"]*)"`));
  return match?.[1] || "";
}

function limitPreview(value, previewChars) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().slice(0, previewChars);
}

function decodeXml(value) {
  return String(value || "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
