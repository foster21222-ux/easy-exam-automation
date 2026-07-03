#!/usr/bin/env node
import {
  defaultWechatFileRoots,
  scanWechatDownloadedFiles,
} from "../server/wechat_attachment_scanner.mjs";

function parseArgs(argv) {
  const args = { roots: [] };
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    if (key === "root") {
      args.roots.push(argv[index + 1]);
      index += 1;
    } else {
      args[key] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const result = scanWechatDownloadedFiles({
    roots: args.roots.length ? args.roots : defaultWechatFileRoots(),
    maxFiles: args.maxFiles ? Number(args.maxFiles) : 200,
    previewChars: args.previewChars ? Number(args.previewChars) : 1200,
    modifiedSince: args.modifiedSince || "",
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
