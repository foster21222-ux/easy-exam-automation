#!/usr/bin/env node
import {
  getWechatCollectorLaunchdStatus,
  installWechatCollectorLaunchd,
  uninstallWechatCollectorLaunchd,
} from "../server/wechat_launchd_manager.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    if (["install", "uninstall", "status", "json"].includes(key)) {
      args[key] = true;
    } else {
      args[key] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function print(payload, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  const status = payload.status || payload;
  process.stdout.write([
    `label: ${status.label}`,
    `plist: ${status.plistPath}`,
    `installed: ${status.installed ? "yes" : "no"}`,
    `loaded: ${status.loaded ? "yes" : "no"}`,
    `detail: ${status.detail || ""}`,
  ].join("\n"));
  process.stdout.write("\n");
}

function optionsFromArgs(args) {
  return {
    templatePath: args.templatePath,
    plistPath: args.plistPath,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const options = optionsFromArgs(args);
  let status;
  let action = "status";
  if (args.install) {
    action = "install";
    status = installWechatCollectorLaunchd(options);
  } else if (args.uninstall) {
    action = "uninstall";
    status = uninstallWechatCollectorLaunchd(options);
  } else {
    status = getWechatCollectorLaunchdStatus(options);
  }
  print({ ok: true, action, status }, args.json);
}

main();
