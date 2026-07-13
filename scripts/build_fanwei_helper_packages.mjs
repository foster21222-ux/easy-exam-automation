import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supportedPlatforms = new Set(["win-x64", "darwin-x64", "darwin-arm64"]);

function parseArgs(argv) {
  const result = {};
  for (const value of argv) {
    const match = String(value).match(/^--([^=]+)=(.*)$/s);
    if (!match) throw new Error(`参数格式错误：${value}`);
    result[match[1]] = match[2];
  }
  return result;
}

function validateOrigin(value) {
  const url = new URL(String(value || ""));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("--console-origin 必须是 HTTP(S) origin，不可包含路径、查询或凭据");
  }
  return url.origin;
}

function findFile(root, name) {
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return candidate;
      if (entry.isDirectory()) queue.push(candidate);
    }
  }
  return "";
}

function runtimeExecutable(runtimePath, platform, tempDir) {
  const stat = fs.statSync(runtimePath);
  const runtimeName = platform === "win-x64" ? "node.exe" : "node";
  if (stat.isFile() && !/\.(zip|tgz|tar\.gz)$/i.test(runtimePath)) return runtimePath;

  const extracted = path.join(tempDir, "runtime");
  fs.mkdirSync(extracted, { recursive: true });
  if (/\.zip$/i.test(runtimePath)) {
    execFileSync("unzip", ["-q", runtimePath, "-d", extracted], { stdio: "pipe" });
  } else if (/\.(tgz|tar\.gz)$/i.test(runtimePath)) {
    execFileSync("tar", ["-xzf", runtimePath, "-C", extracted], { stdio: "pipe" });
  } else if (stat.isDirectory()) {
    return findFile(runtimePath, runtimeName);
  } else {
    throw new Error("--node-runtime 必须是 Node 可执行文件、目录、zip 或 tar.gz");
  }
  return findFile(extracted, runtimeName);
}

function copyFile(source, destination, mode) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  if (mode !== undefined) fs.chmodSync(destination, mode);
}

function writePackage({ platform, runtimePath, origin, packageDir }) {
  const deployDir = path.join(rootDir, "deploy", "fanwei-helper");
  const runtimeName = platform === "win-x64" ? "node.exe" : "node";
  copyFile(runtimePath, path.join(packageDir, runtimeName), platform === "win-x64" ? undefined : 0o755);

  for (const moduleName of [
    "fanwei_local_helper_cli.mjs",
    "fanwei_local_helper.mjs",
    "fanwei_auto_read.mjs",
  ]) {
    copyFile(path.join(rootDir, "server", moduleName), path.join(packageDir, "server", moduleName));
  }

  if (platform === "win-x64") {
    copyFile(path.join(deployDir, "install-windows.bat"), path.join(packageDir, "install-windows.bat"));
    copyFile(path.join(deployDir, "start-windows.bat"), path.join(packageDir, "start-windows.bat"));
  } else {
    copyFile(path.join(deployDir, "install-macos.command"), path.join(packageDir, "install-macos.command"), 0o755);
    copyFile(
      path.join(deployDir, "com.ata.yikao-fanwei-helper.plist.template"),
      path.join(packageDir, "com.ata.yikao-fanwei-helper.plist.template"),
    );
  }

  fs.writeFileSync(path.join(packageDir, "config.env"), [
    "YIKAO_HELPER_HOST=127.0.0.1",
    "YIKAO_HELPER_PORT=18765",
    "YIKAO_HELPER_CHROME_PORT=19222",
    `YIKAO_CONSOLE_ORIGINS=${origin}`,
    "",
  ].join("\n"), { mode: 0o600 });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const platform = String(args.platform || "");
  if (!supportedPlatforms.has(platform)) {
    throw new Error("--platform 必须是 win-x64、darwin-x64 或 darwin-arm64");
  }
  if (!args["node-runtime"]) throw new Error("缺少 --node-runtime");
  if (!args["console-origin"]) throw new Error("缺少 --console-origin");
  if (!args.output) throw new Error("缺少 --output");

  const nodeRuntime = path.resolve(args["node-runtime"]);
  if (!fs.existsSync(nodeRuntime)) throw new Error(`Node runtime 不存在：${nodeRuntime}`);
  const origin = validateOrigin(args["console-origin"]);
  const outputDir = path.resolve(args.output);
  const packageName = `yikao-fanwei-helper-${platform}`;
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fanwei-helper-build-"));

  try {
    const runtimePath = runtimeExecutable(nodeRuntime, platform, stagingRoot);
    if (!runtimePath || !fs.existsSync(runtimePath)) {
      throw new Error(`Node runtime 中未找到 ${platform === "win-x64" ? "node.exe" : "node"}`);
    }
    const stagedPackage = path.join(stagingRoot, packageName);
    fs.mkdirSync(stagedPackage, { recursive: true });
    writePackage({ platform, runtimePath, origin, packageDir: stagedPackage });

    fs.mkdirSync(outputDir, { recursive: true });
    const finalPackage = path.join(outputDir, packageName);
    const finalZip = path.join(outputDir, `${packageName}.zip`);
    fs.rmSync(finalPackage, { recursive: true, force: true });
    fs.rmSync(finalZip, { force: true });
    fs.renameSync(stagedPackage, finalPackage);
    execFileSync("zip", ["-qry", finalZip, packageName], { cwd: outputDir, stdio: "pipe" });
    console.log(finalZip);
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`泛微本机助手打包失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
