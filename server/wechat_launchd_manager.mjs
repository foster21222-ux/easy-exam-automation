import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

export const WECHAT_COLLECTOR_LAUNCHD_LABEL = "com.ata.easy-exam-wechat-collector";
export const EASY_EXAM_SERVICE_LAUNCHD_LABEL = "com.ata.easy-exam-service";

export function defaultWechatCollectorLaunchdPaths(homeDir = os.homedir()) {
  return {
    templatePath: path.join(rootDir, "deploy", `${WECHAT_COLLECTOR_LAUNCHD_LABEL}.plist.template`),
    plistPath: path.join(homeDir, "Library", "LaunchAgents", `${WECHAT_COLLECTOR_LAUNCHD_LABEL}.plist`),
  };
}

export function defaultEasyExamServiceLaunchdPaths(homeDir = os.homedir()) {
  return {
    templatePath: path.join(rootDir, "deploy", `${EASY_EXAM_SERVICE_LAUNCHD_LABEL}.plist.template`),
    plistPath: path.join(homeDir, "Library", "LaunchAgents", `${EASY_EXAM_SERVICE_LAUNCHD_LABEL}.plist`),
  };
}

function getLaunchdStatus({
  label,
  plistPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  const installed = existsSync(plistPath);
  let loaded = false;
  let detail = installed ? "LaunchAgent plist exists but is not loaded" : "LaunchAgent plist is not installed";
  try {
    const list = execFileSyncImpl("launchctl", ["list"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    loaded = String(list || "").includes(label);
    if (loaded) detail = "launchd job is loaded";
  } catch (error) {
    detail = error instanceof Error ? error.message : String(error);
  }
  return {
    label,
    plistPath,
    installed,
    loaded,
    detail,
  };
}

function installLaunchdJob({
  label,
  templatePath,
  plistPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  mkdirSync(path.dirname(plistPath), { recursive: true });
  copyFileSync(templatePath, plistPath);
  execFileSyncImpl("plutil", ["-lint", plistPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  execFileSyncImpl("launchctl", ["load", plistPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return getLaunchdStatus({ label, plistPath, execFileSyncImpl });
}

function uninstallLaunchdJob({
  label,
  plistPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  if (existsSync(plistPath)) {
    try {
      execFileSyncImpl("launchctl", ["unload", plistPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      // Removing the plist is still useful if launchd no longer has it loaded.
    }
    rmSync(plistPath, { force: true });
  }
  return getLaunchdStatus({ label, plistPath, execFileSyncImpl });
}

export function getWechatCollectorLaunchdStatus({
  plistPath = defaultWechatCollectorLaunchdPaths().plistPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  return getLaunchdStatus({ label: WECHAT_COLLECTOR_LAUNCHD_LABEL, plistPath, execFileSyncImpl });
}

export function installWechatCollectorLaunchd({
  templatePath = defaultWechatCollectorLaunchdPaths().templatePath,
  plistPath = defaultWechatCollectorLaunchdPaths().plistPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  return installLaunchdJob({ label: WECHAT_COLLECTOR_LAUNCHD_LABEL, templatePath, plistPath, execFileSyncImpl });
}

export function uninstallWechatCollectorLaunchd({
  plistPath = defaultWechatCollectorLaunchdPaths().plistPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  return uninstallLaunchdJob({ label: WECHAT_COLLECTOR_LAUNCHD_LABEL, plistPath, execFileSyncImpl });
}

export function getEasyExamServiceLaunchdStatus({
  plistPath = defaultEasyExamServiceLaunchdPaths().plistPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  return getLaunchdStatus({ label: EASY_EXAM_SERVICE_LAUNCHD_LABEL, plistPath, execFileSyncImpl });
}

export function installEasyExamServiceLaunchd({
  templatePath = defaultEasyExamServiceLaunchdPaths().templatePath,
  plistPath = defaultEasyExamServiceLaunchdPaths().plistPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  return installLaunchdJob({ label: EASY_EXAM_SERVICE_LAUNCHD_LABEL, templatePath, plistPath, execFileSyncImpl });
}

export function uninstallEasyExamServiceLaunchd({
  plistPath = defaultEasyExamServiceLaunchdPaths().plistPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  return uninstallLaunchdJob({ label: EASY_EXAM_SERVICE_LAUNCHD_LABEL, plistPath, execFileSyncImpl });
}
