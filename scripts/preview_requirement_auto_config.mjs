#!/usr/bin/env node

import fs from "node:fs/promises";
import process from "node:process";

import { buildAutoConfigFromRequirement } from "../server/requirement_auto_config_adapter.mjs";

async function main() {
  const input = await readInput(process.argv[2]);
  const body = JSON.parse(input || "{}");
  const requirement = body.latest?.requirement || body.requirement || body;
  const customerName = body.customer?.name || body.customerName || "";
  const result = buildAutoConfigFromRequirement(requirement, { customerName });
  console.log(JSON.stringify({
    requirement,
    config: result.config,
    warnings: result.warnings,
  }, null, 2));
}

async function readInput(filePath) {
  if (filePath) return await fs.readFile(filePath, "utf8");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
