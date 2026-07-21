import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CandidateImportPage } from "../web/pages/CandidateImportPage.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), "utf8");

const pageFiles = [
  "web/pages/ProjectListPage.mjs",
  "web/pages/ProjectDetailPage.mjs",
  "web/pages/AutoConfigPage.mjs",
  "web/pages/ExamListPage.mjs",
  "web/pages/ExamDetailPage.mjs",
  "web/pages/CandidateImportPage.mjs",
];

const autoComponents = [
  "RequirementUpload",
  "AutoConfigProgress",
  "ConfigPreview",
  "FinalScreenshot",
  "AutoConfigLogs",
];

test("defines every required page component", () => {
  for (const file of pageFiles) {
    assert.equal(fs.existsSync(path.join(rootDir, file)), true, file);
    assert.match(read(file), /export function [A-Z][A-Za-z]+Page/);
  }
});

test("only AutoConfigPage imports auto configuration components", () => {
  const autoPage = read("web/pages/AutoConfigPage.mjs");
  for (const component of autoComponents) assert.ok(autoPage.includes(component), component);

  for (const file of [...pageFiles.filter((file) => !file.endsWith("AutoConfigPage.mjs")), "web/layout.mjs"]) {
    const source = read(file);
    for (const component of autoComponents) {
      assert.equal(source.includes(component), false, `${file} references ${component}`);
    }
  }
});

test("AutoConfigPage owns auto components inside one stable workbench root", () => {
  const autoPage = read("web/pages/AutoConfigPage.mjs");
  for (const component of autoComponents) assert.ok(autoPage.includes(component), component);
  assert.ok(autoPage.includes('documentObject.querySelector("#autoWorkbench")'));
  assert.match(autoPage, /roots:\s*\[[\s\S]*root[\s\S]*\]/);
  assert.equal(autoPage.includes("...components.map((component) => component.element)"), false);
});

test("FinalScreenshot component owns the whole screenshot panel", () => {
  const component = read("web/components/auto-config/FinalScreenshot.mjs");
  assert.ok(component.includes('querySelector("#captureGrid")?.closest(".capture-panel")'));
});

test("CandidateImportPage loads task context when entering the route", async () => {
  let entered = 0;
  const root = {};
  const topbar = {};
  const page = CandidateImportPage({
    root,
    topbar,
    loadContext: async () => {
      entered += 1;
    },
  });

  await page.enter();

  assert.equal(entered, 1);
  assert.deepEqual(page.roots, [topbar, root]);
});
