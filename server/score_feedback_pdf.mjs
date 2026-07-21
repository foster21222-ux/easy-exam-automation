import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fontConfigPath = path.join(__dirname, "libreoffice-fontconfig.conf");

export function resolveSofficePath(env = process.env) {
  const candidates = [env.SCORE_FEEDBACK_SOFFICE];
  if (env.CODEX_PYTHON) {
    const dependenciesDir = path.resolve(path.dirname(env.CODEX_PYTHON), "..", "..");
    candidates.push(path.join(dependenciesDir, "bin", "override", "soffice"));
  }
  if (env.HOME) {
    candidates.push(path.join(
      env.HOME,
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "bin",
      "override",
      "soffice",
    ));
  }
  candidates.push("/Applications/LibreOffice.app/Contents/MacOS/soffice");
  return candidates.find((candidate) => candidate && existsSync(candidate)) || "soffice";
}

function runSoffice(sofficePath, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(sofficePath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `LibreOffice PDF 转换失败，退出码 ${code}`));
    });
  });
}

export async function convertScoreFeedbackToPdf({
  inputPath,
  outputPath,
  sofficePath = resolveSofficePath(),
}) {
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);
  const outputDir = path.dirname(resolvedOutput);
  const profileDir = path.join(outputDir, `.libreoffice-${randomUUID()}`);
  const convertedPath = path.join(outputDir, `${path.parse(resolvedInput).name}.pdf`);
  const cacheDir = path.join(outputDir, ".fontconfig-cache");
  await mkdir(profileDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  try {
    await runSoffice(sofficePath, [
      "--headless",
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      "--convert-to",
      "pdf",
      "--outdir",
      outputDir,
      resolvedInput,
    ], {
      ...process.env,
      FONTCONFIG_FILE: fontConfigPath,
      XDG_CACHE_HOME: cacheDir,
    });
    await access(convertedPath);
    if (convertedPath !== resolvedOutput) await rename(convertedPath, resolvedOutput);
    return { outputPath: resolvedOutput };
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
}
