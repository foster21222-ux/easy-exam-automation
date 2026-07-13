import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeBin = process.execPath;
const builderPath = path.join(rootDir, "scripts", "build_fanwei_helper_packages.mjs");
const deployDir = path.join(rootDir, "deploy", "fanwei-helper");
const consoleOrigin = "http://172.16.13.214:8765";

function readDeploy(name) {
  return fs.readFileSync(path.join(deployDir, name), "utf8");
}

function writeFixtureRuntime(dir, platform) {
  const fileName = platform === "win-x64" ? "node.exe" : "node";
  const runtimePath = path.join(dir, `${platform}-${fileName}`);
  fs.writeFileSync(runtimePath, "fixture runtime\n", { mode: 0o755 });
  return runtimePath;
}

function buildFixturePackage(platform) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fanwei-helper-package-"));
  const outputDir = path.join(tempDir, "output");
  const runtimePath = writeFixtureRuntime(tempDir, platform);
  const output = execFileSync(nodeBin, [
    builderPath,
    `--platform=${platform}`,
    `--node-runtime=${runtimePath}`,
    `--console-origin=${consoleOrigin}`,
    `--output=${outputDir}`,
  ], { cwd: rootDir, encoding: "utf8" });
  return { tempDir, outputDir, output };
}

test("Windows installer uses the current user profile, autostarts, records a PID, and opens the shared console", () => {
  const install = readDeploy("install-windows.bat");
  const start = readDeploy("start-windows.bat");

  assert.match(install, /%LOCALAPPDATA%\\YikaoFanweiHelper/i);
  assert.match(install, /%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup/i);
  assert.match(install, /YIKAO_CONSOLE_ORIGINS=http:\/\/172\.16\.13\.214:8765/i);
  assert.match(install, /start-windows\.bat/i);
  assert.match(install, /http:\/\/172\.16\.13\.214:8765\/fanwei-test/i);
  assert.match(start, /helper\.pid/i);
  assert.match(start, /fanwei_local_helper_cli\.mjs/i);
});

test("macOS installer uses Application Support and bootstraps its own LaunchAgent", () => {
  const install = readDeploy("install-macos.command");
  const plist = readDeploy("com.ata.yikao-fanwei-helper.plist.template");

  assert.match(install, /Library\/Application Support\/YikaoFanweiHelper/);
  assert.match(install, /Library\/LaunchAgents\/com\.ata\.yikao-fanwei-helper\.plist/);
  assert.match(install, /launchctl bootstrap "gui\/\$UID"/);
  assert.match(install, /launchctl kickstart -k "gui\/\$UID\/com\.ata\.yikao-fanwei-helper"/);
  assert.match(install, /http:\/\/172\.16\.13\.214:8765\/fanwei-test/);
  assert.match(plist, /com\.ata\.yikao-fanwei-helper/);
  assert.match(plist, /__HELPER_DIR__/);
});

for (const platform of ["win-x64", "darwin-x64", "darwin-arm64"]) {
  test(`package builder creates a complete ${platform} folder and zip`, () => {
    const { tempDir, outputDir, output } = buildFixturePackage(platform);
    try {
      const packageName = `yikao-fanwei-helper-${platform}`;
      const packageDir = path.join(outputDir, packageName);
      const runtimeName = platform === "win-x64" ? "node.exe" : "node";
      const installerName = platform === "win-x64" ? "install-windows.bat" : "install-macos.command";
      const expectedFiles = [
        "config.env",
        installerName,
        runtimeName,
        "server/fanwei_auto_read.mjs",
        "server/fanwei_local_helper.mjs",
        "server/fanwei_local_helper_cli.mjs",
      ];
      for (const relative of expectedFiles) {
        assert.equal(fs.existsSync(path.join(packageDir, relative)), true, `${relative} is missing`);
      }
      assert.equal(fs.existsSync(path.join(outputDir, `${packageName}.zip`)), true);
      assert.match(fs.readFileSync(path.join(packageDir, "config.env"), "utf8"), new RegExp(consoleOrigin.replaceAll(".", "\\.")));
      assert.match(output, new RegExp(`${packageName}\\.zip`));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
}

test("package builder rejects missing inputs without leaving a partial package", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fanwei-helper-invalid-"));
  const outputDir = path.join(tempDir, "output");
  try {
    assert.throws(() => execFileSync(nodeBin, [
      builderPath,
      "--platform=win-x64",
      `--output=${outputDir}`,
    ], { cwd: rootDir, encoding: "utf8", stdio: "pipe" }));
    assert.equal(fs.existsSync(outputDir), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("authenticated server downloads a prebuilt helper zip and validates platform errors", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fanwei-helper-download-"));
  const runtimeDir = path.join(tempDir, "runtime");
  const packagesDir = path.join(runtimeDir, "fanwei-helper");
  fs.mkdirSync(packagesDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, "auth.json"), JSON.stringify({
    email: "tester@example.com",
    password: "secret",
  }));
  const zipBytes = Buffer.from("PK\u0003\u0004fixture-zip");
  fs.writeFileSync(path.join(packagesDir, "yikao-fanwei-helper-win-x64.zip"), zipBytes);

  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(nodeBin, [path.join(rootDir, "server", "easy_exam_server.mjs")], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      EASY_EXAM_RUNTIME_DIR: runtimeDir,
      EASY_EXAM_FANWEI_HELPER_PACKAGES_DIR: path.join(tempDir, "empty-packages"),
      PAPER_BIND_SCHEDULER_DISABLED: "1",
      APP_LOGIN_EMAIL: "",
      APP_LOGIN_PASSWORD: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const base = `http://127.0.0.1:${port}`;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server startup timed out")), 10000);
      child.stdout.on("data", (chunk) => {
        if (String(chunk).includes("Easy Exam server running")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", (code) => reject(new Error(`server exited early: ${code}`)));
    });

    const unauthenticated = await fetch(`${base}/api/fanwei/helper-installer?platform=windows`, { redirect: "manual" });
    assert.equal(unauthenticated.status, 401);

    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "tester@example.com", password: "secret" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0] || "";
    assert.ok(cookie);

    const download = await fetch(`${base}/api/fanwei/helper-installer?platform=windows`, {
      headers: { Cookie: cookie },
    });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/zip");
    assert.match(download.headers.get("content-disposition") || "", /yikao-fanwei-helper-win-x64\.zip/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), zipBytes);

    const unknown = await fetch(`${base}/api/fanwei/helper-installer?platform=linux`, {
      headers: { Cookie: cookie },
    });
    assert.equal(unknown.status, 400);
    assert.match((await unknown.json()).error, /不支持/);

    const missing = await fetch(`${base}/api/fanwei/helper-installer?platform=macos`, {
      headers: { Cookie: cookie },
    });
    assert.equal(missing.status, 503);
    assert.match((await missing.json()).error, /安装包.*尚未生成/);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
