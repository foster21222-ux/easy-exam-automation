#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  buildWechatRequirementDraft,
  loadWechatGroupConfig,
  pushWechatDraftToRequirementCenter,
  validateWechatGroupConfig,
} from "../server/wechat_requirement_collector.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    if (key === "clipboard") {
      args.clipboard = true;
    } else if (key === "push") {
      args.push = true;
    } else {
      args[key] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function readInput(args) {
  if (args.input) return readFileSync(args.input, "utf8");
  if (args.clipboard) return execFileSync("pbpaste", { encoding: "utf8" });
  return readStdin();
}

function readState(statePath) {
  if (!statePath || !existsSync(statePath)) return {};
  return JSON.parse(readFileSync(statePath, "utf8"));
}

function writeState(statePath, groupName, values) {
  if (!statePath) return;
  const state = readState(statePath);
  state.groups = state.groups || {};
  state.groups[groupName] = {
    ...state.groups[groupName],
    ...values,
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.config || !args.group) {
    throw new Error(
      "用法：node scripts/wechat_requirement_collect.mjs --config config/wechat-requirement-groups.example.json --group AI赋能运营自动化小组 --input /path/chat.txt",
    );
  }

  const config = loadWechatGroupConfig(readFileSync(args.config, "utf8"));
  const validation = validateWechatGroupConfig(config, { requireEnabled: true });
  if (!validation.ok) throw new Error(validation.error);
  const group = config.groups.find((item) => item.groupName === args.group);
  if (!group) throw new Error(`未配置微信群：${args.group}`);
  if (group.enabled === false) throw new Error(`微信群已停用：${args.group}`);
  const text = readInput(args);
  if (!text.trim()) throw new Error("没有读取到微信群聊天文本。请提供 --input、--clipboard 或 stdin。");
  const state = readState(args.state);
  const checkpoint = state.groups?.[args.group]?.checkpoint || null;
  const requestId = group?.requirementRequestId || state.groups?.[args.group]?.requestId || "";

  const draft = buildWechatRequirementDraft({
    config,
    groupName: args.group,
    text,
    checkpoint,
  });
  const result = { draft };
  if (args.push) {
    result.push = await pushWechatDraftToRequirementCenter(draft, {
      apiBase: args.api,
      requestId,
    });
  }
  if ((draft.messages || []).length || (draft.changeRecords || []).length) {
    writeState(args.state, args.group, {
      checkpoint: draft.checkpoint,
      requestId: result.push?.requestId || requestId || undefined,
    });
  } else {
    result.skipped = "no_new_messages";
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
