import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PROTECTED_BASE_COMMIT,
  PROTECTED_EXACT_FILES,
  PROTECTED_SHARED_REGIONS,
  PROTECTED_SENTINELS,
} from "./pr5_protected_workflows.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

const EXPECTED_EXACT_FILES = [
  "server/fanwei_auto_read.mjs",
  "server/fanwei_bridge.mjs",
  "server/fanwei_local_helper.mjs",
  "server/fanwei_local_helper_cli.mjs",
  "server/fanwei_requirement_mapper.mjs",
  "server/fanwei_requirement_workbook.py",
  "server/candidate_course_assignment.mjs",
  "server/candidate_personal_fields.mjs",
  "server/candidate_tenant_payload.mjs",
  "server/candidate_list_parser.py",
  "server/room_assignment.mjs",
  "web/exam_task_view_model.mjs",
  "web/pages/AutoConfigPage.mjs",
  "web/pages/ExamListPage.mjs",
  "web/pages/ExamDetailPage.mjs",
  "web/pages/CandidateImportPage.mjs",
  "web/components/auto-config/AutoConfigLogs.mjs",
  "web/components/auto-config/AutoConfigProgress.mjs",
  "web/components/auto-config/ConfigPreview.mjs",
  "web/components/auto-config/FinalScreenshot.mjs",
  "web/components/auto-config/RequirementUpload.mjs",
];

const EXPECTED_SENTINELS = {
  "server/easy_exam_server.mjs": [
    "/api/fanwei/requirement-preview",
    "/api/fanwei/auto-read",
    "handleCandidateImport",
    "handleExamList",
    "handleCreateJob",
  ],
  "outputs/web_prototype/easy_exam_automation.html": [
    "autoConfigStack",
    "examListView",
    "candidateImportPanel",
    "fanweiRequirementTable",
  ],
};

const EXPECTED_SHARED_REGIONS = {
  "server/easy_exam_server.mjs": [
    { name: "import workbook task creation", kind: "js-block", startAnchor: "async function createImportFromWorkbook({" },
    { name: "auto-config job state", kind: "js-block", startAnchor: "function createJob(importRecord, login) {" },
    { name: "auto-config progress events", kind: "js-block", startAnchor: "function pushEvent(job, evt) {" },
    { name: "Fanwei preview handler", kind: "js-block", startAnchor: "async function handleFanweiRequirementPreview(req, res) {" },
    { name: "Fanwei import task creation", kind: "js-block", startAnchor: "async function createFanweiRequirementImportFromPayload(payload, req, options = {}) {" },
    { name: "Fanwei import handler", kind: "js-block", startAnchor: "async function handleFanweiRequirementImport(req, res) {" },
    { name: "Fanwei auto-read status handler", kind: "js-block", startAnchor: "async function handleFanweiAutoReadStatus(_req, res) {" },
    { name: "Fanwei local-read handler", kind: "js-block", startAnchor: "async function handleFanweiLocalRead(req, res) {" },
    { name: "Fanwei auto-read handler", kind: "js-block", startAnchor: "async function handleFanweiAutoRead(req, res) {" },
    { name: "candidate parse handler", kind: "js-block", startAnchor: "async function handleCandidateParse(req, res) {" },
    { name: "candidate template handler", kind: "js-block", startAnchor: "async function handleCandidateTemplate(req, res) {" },
    { name: "candidate session list handler", kind: "js-block", startAnchor: "async function handleSessions(req, res) {" },
    { name: "candidate import handler", kind: "js-block", startAnchor: "async function handleCandidateImport(req, res) {" },
    { name: "candidate room preview handler", kind: "js-block", startAnchor: "async function handleRoomsPreview(sessionId, req, res) {" },
    { name: "candidate room auto handler", kind: "js-block", startAnchor: "async function handleRoomsAuto(sessionId, req, res) {" },
    { name: "auto-config create handler", kind: "js-block", startAnchor: "async function handleCreateJob(req, res) {" },
    { name: "auto-config progress state handler", kind: "js-block", startAnchor: "function handleJobState(job, res) {" },
    { name: "auto-config events handler", kind: "js-block", startAnchor: "function handleEvents(job, req, res) {" },
    { name: "exam list handler", kind: "js-block", startAnchor: "async function handleExamList(req, res) {" },
    { name: "exam detail handler", kind: "js-block", startAnchor: "async function handleTaskDetail(taskId, req, res) {" },
    { name: "Fanwei preview route", kind: "js-block", startAnchor: "if (req.method === \"POST\" && url.pathname === \"/api/fanwei/requirement-preview\") {" },
    { name: "Fanwei import route", kind: "js-block", startAnchor: "if (req.method === \"POST\" && url.pathname === \"/api/fanwei/requirement-import\") {" },
    { name: "Fanwei status route", kind: "js-block", startAnchor: "if (req.method === \"GET\" && url.pathname === \"/api/fanwei/auto-read/status\") {" },
    { name: "Fanwei local-read route", kind: "js-block", startAnchor: "if (req.method === \"POST\" && url.pathname === \"/api/fanwei/local-read\") {" },
    { name: "Fanwei auto-read route", kind: "js-block", startAnchor: "if (req.method === \"POST\" && url.pathname === \"/api/fanwei/auto-read\") {" },
    { name: "auto-config create route", kind: "js-block", startAnchor: "if (req.method === \"POST\" && url.pathname === \"/api/jobs\") {" },
    { name: "exam list route", kind: "js-block", startAnchor: "if (req.method === \"GET\" && url.pathname === \"/api/exams\") {" },
    { name: "exam detail route", kind: "anchor-range", startAnchor: "const taskDetailMatch = url.pathname.match(", endAnchor: "if (req.method === \"POST\" && url.pathname === \"/api/candidates/parse\") {" },
    { name: "candidate parse route", kind: "js-block", startAnchor: "if (req.method === \"POST\" && url.pathname === \"/api/candidates/parse\") {" },
    { name: "candidate template route", kind: "js-block", startAnchor: "if (req.method === \"POST\" && url.pathname === \"/api/candidates/generate-template\") {" },
    { name: "candidate session list route", kind: "js-block", startAnchor: "if (req.method === \"GET\" && url.pathname === \"/api/sessions\") {" },
    { name: "candidate import route", kind: "js-block", startAnchor: "if (req.method === \"POST\" && url.pathname === \"/api/candidates/import\") {" },
    { name: "candidate room preview route", kind: "anchor-range", startAnchor: "const roomsPreviewMatch = url.pathname.match(", endAnchor: "const monitorAccountsMatch = url.pathname.match(" },
    { name: "candidate room auto route", kind: "anchor-range", startAnchor: "const roomsAutoMatch = url.pathname.match(", endAnchor: "if (req.method === \"GET\" && url.pathname.startsWith(\"/api/jobs/\") && url.pathname.endsWith(\"/events\")) {" },
    { name: "auto-config events route", kind: "js-block", startAnchor: "if (req.method === \"GET\" && url.pathname.startsWith(\"/api/jobs/\") && url.pathname.endsWith(\"/events\")) {" },
    { name: "auto-config state route", kind: "js-block", startAnchor: "if (req.method === \"GET\" && url.pathname.startsWith(\"/api/jobs/\")) {" },
  ],
  "outputs/web_prototype/easy_exam_automation.html": [
    { name: "auto-config view", kind: "html-section", startAnchor: "<section class=\"stack\" id=\"autoConfigStack\" hidden>" },
    { name: "candidate import view", kind: "html-section", startAnchor: "<section class=\"panel candidate-panel\" id=\"candidateImportPanel\" hidden>" },
    { name: "Fanwei view", kind: "html-section", startAnchor: "<section class=\"task-view\" id=\"fanweiTestView\" hidden>" },
    { name: "exam list view", kind: "html-section", startAnchor: "<section class=\"task-view\" id=\"examListView\" hidden>" },
    { name: "exam detail view", kind: "html-section", startAnchor: "<section class=\"task-view\" id=\"taskDetailView\" hidden>" },
    { name: "task progress derivation", kind: "js-block", startAnchor: "function taskConfigurationProgressFromSteps(progressSteps, fallbackProgress = 0) {" },
    { name: "current task progress", kind: "js-block", startAnchor: "function currentTaskProgress(task) {" },
    { name: "exam list render", kind: "js-block", startAnchor: "function renderExamList() {" },
    { name: "exam list load", kind: "js-block", startAnchor: "async function loadExams() {" },
    { name: "exam detail render", kind: "js-block", startAnchor: "function renderTaskDetail(task, options = {}) {" },
    { name: "exam detail load", kind: "js-block", startAnchor: "async function openTaskDetail(taskId) {" },
    { name: "candidate render", kind: "js-block", startAnchor: "function renderCandidateResult() {" },
    { name: "candidate parse", kind: "js-block", startAnchor: "async function parseCandidateFile(file) {" },
    { name: "candidate sessions load", kind: "js-block", startAnchor: "async function loadCandidateSessions() {" },
    { name: "candidate task context", kind: "js-block", startAnchor: "async function loadCandidateTaskContext() {" },
    { name: "candidate room assignment", kind: "js-block", startAnchor: "async function autoAssignRoomsAfterImport() {" },
    { name: "candidate import", kind: "js-block", startAnchor: "async function importCandidatesToSession() {" },
    { name: "auto-config progress display", kind: "js-block", startAnchor: "function setProgress(percent, caption, stageIndex) {" },
    { name: "auto-config import result", kind: "js-block", startAnchor: "function applyImportResult(fileName, data) {" },
    { name: "auto-config workbook import", kind: "js-block", startAnchor: "async function importWorkbook(file) {" },
    { name: "Fanwei preview render", kind: "js-block", startAnchor: "function renderFanweiModel(model = {}) {" },
    { name: "Fanwei enter auto-config", kind: "js-block", startAnchor: "async function enterFanweiAutoConfig(data, serialNo) {" },
    { name: "Fanwei preview read", kind: "js-block", startAnchor: "async function copyFanweiReaderScript() {" },
    { name: "Fanwei auto-read status", kind: "js-block", startAnchor: "async function loadFanweiAutoReadStatus() {" },
    { name: "Fanwei requirement import", kind: "js-block", startAnchor: "async function createFanweiRequirementImport() {" },
    { name: "auto-config progress event wiring", kind: "js-block", startAnchor: "function connectEvents(jobId) {" },
    { name: "protected page registration", kind: "js-array", startAnchor: "const pages = [" },
    { name: "candidate import wiring", kind: "js-call", startAnchor: "candidateImportBtn.addEventListener(\"click\", async () => {" },
    { name: "Fanwei preview wiring", kind: "js-call", startAnchor: "fanweiCopyScriptBtn.addEventListener(\"click\", () => copyFanweiReaderScript().catch((error) => {" },
    { name: "Fanwei import wiring", kind: "js-call", startAnchor: "fanweiImportBtn.addEventListener(\"click\", () => createFanweiRequirementImport().catch((error) => {" },
    { name: "auto-config creation wiring", kind: "js-call", startAnchor: "runBtn.addEventListener(\"click\", async () => {" },
  ],
};

function findUniqueAnchor(source, anchor, relativePath, regionName) {
  const index = source.indexOf(anchor);
  assert.notEqual(
    index,
    -1,
    `${relativePath} protected region "${regionName}" is missing anchor ${JSON.stringify(anchor)}`,
  );
  assert.equal(
    source.indexOf(anchor, index + 1),
    -1,
    `${relativePath} protected region "${regionName}" anchor is not unique`,
  );
  return index;
}

function findBalancedEnd(source, openIndex, openToken, closeToken, relativePath, regionName) {
  let depth = 0;
  let state = "code";
  let escaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      if (char === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }
    if (state !== "code") {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === state) {
        state = "code";
      }
      continue;
    }

    if (char === "/" && next === "/") {
      state = "line-comment";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      state = "block-comment";
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      state = char;
      continue;
    }
    if (char === openToken) depth += 1;
    if (char === closeToken) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }

  assert.fail(`${relativePath} protected region "${regionName}" has an unbalanced ${openToken}${closeToken} block`);
}

function findFunctionBodyOpen(source, startIndex, relativePath, regionName) {
  const parameterOpen = source.indexOf("(", startIndex);
  assert.notEqual(parameterOpen, -1, `${relativePath} protected function "${regionName}" has no parameter list`);
  const parameterEnd = findBalancedEnd(
    source,
    parameterOpen,
    "(",
    ")",
    relativePath,
    regionName,
  );
  const bodyOpen = source.indexOf("{", parameterEnd);
  assert.notEqual(bodyOpen, -1, `${relativePath} protected function "${regionName}" has no body`);
  return bodyOpen;
}

function extractHtmlSection(source, startIndex, relativePath, regionName) {
  const opening = source.slice(startIndex).match(/^<([a-z][a-z0-9-]*)\b[^>]*>/i);
  assert.ok(opening, `${relativePath} protected region "${regionName}" has no opening HTML element`);
  const tagName = opening[1];
  const tagPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = startIndex;
  let depth = 0;
  let match;
  while ((match = tagPattern.exec(source))) {
    const isClosing = match[0].startsWith("</");
    const isSelfClosing = /\/>$/.test(match[0]);
    if (isClosing) depth -= 1;
    else if (!isSelfClosing) depth += 1;
    if (depth === 0) return source.slice(startIndex, tagPattern.lastIndex);
  }
  assert.fail(`${relativePath} protected region "${regionName}" has an unbalanced <${tagName}> element`);
}

function extractProtectedRegion(source, relativePath, region) {
  const startIndex = findUniqueAnchor(source, region.startAnchor, relativePath, region.name);
  if (region.kind === "anchor-range") {
    const endIndex = findUniqueAnchor(source, region.endAnchor, relativePath, region.name);
    assert.ok(endIndex > startIndex, `${relativePath} protected region "${region.name}" anchors are reversed`);
    return source.slice(startIndex, endIndex);
  }
  if (region.kind === "html-section") {
    return extractHtmlSection(source, startIndex, relativePath, region.name);
  }

  const tokens = region.kind === "js-array"
    ? ["[", "]"]
    : region.kind === "js-call"
      ? ["(", ")"]
      : ["{", "}"];
  const openIndex = region.kind === "js-block" && /(?:async )?function /.test(region.startAnchor)
    ? findFunctionBodyOpen(source, startIndex, relativePath, region.name)
    : source.indexOf(tokens[0], startIndex);
  assert.notEqual(openIndex, -1, `${relativePath} protected region "${region.name}" has no ${tokens[0]}`);
  const endIndex = findBalancedEnd(
    source,
    openIndex,
    tokens[0],
    tokens[1],
    relativePath,
    region.name,
  );
  return source.slice(startIndex, endIndex);
}

function assertBaselineCommitAvailable() {
  try {
    execFileSync("git", ["cat-file", "-e", `${PROTECTED_BASE_COMMIT}^{commit}`], {
      cwd: repoRoot,
      stdio: "pipe",
    });
  } catch {
    assert.fail(
      `Protected baseline commit ${PROTECTED_BASE_COMMIT} is unavailable. Fetch full repository history before running this guard.`,
    );
  }
}

function baselineFile(relativePath) {
  return execFileSync(
    "git",
    ["show", `${PROTECTED_BASE_COMMIT}:${relativePath}`],
    { cwd: repoRoot },
  );
}

function assertFileRegionsMatch(relativePath, regions, currentSource, deployedSource) {
  for (const region of regions) {
    assert.equal(
      extractProtectedRegion(currentSource, relativePath, region),
      extractProtectedRegion(deployedSource, relativePath, region),
      `${relativePath} protected region "${region.name}" differs from deployed main commit ${PROTECTED_BASE_COMMIT}`,
    );
  }
}

function assertPolicyShape({ exactFiles, sentinels, sharedRegions }) {
  assert.equal(exactFiles.length, 21, "exact-file policy must contain 21 entries");
  assert.equal(
    new Set(exactFiles).size,
    exactFiles.length,
    "exact-file policy entries must be unique",
  );
  assert.deepEqual(exactFiles, EXPECTED_EXACT_FILES, "exact-file policy is incomplete");

  assert.equal(Object.keys(sentinels).length, 2, "sentinel policy must contain 2 files");
  assert.deepEqual(sentinels, EXPECTED_SENTINELS, "sentinel policy is incomplete");
  for (const [relativePath, values] of Object.entries(sentinels)) {
    assert.equal(
      new Set(values).size,
      values.length,
      `${relativePath} sentinel entries must be unique`,
    );
  }

  assert.equal(Object.keys(sharedRegions).length, 2, "shared-region policy must contain 2 files");
  assert.equal(
    sharedRegions["server/easy_exam_server.mjs"].length,
    36,
    "server shared-region policy must contain 36 entries",
  );
  assert.equal(
    sharedRegions["outputs/web_prototype/easy_exam_automation.html"].length,
    31,
    "HTML shared-region policy must contain 31 entries",
  );
  assert.deepEqual(sharedRegions, EXPECTED_SHARED_REGIONS, "shared-region policy is incomplete");
  for (const [relativePath, regions] of Object.entries(sharedRegions)) {
    const names = regions.map((region) => region.name);
    assert.equal(
      new Set(names).size,
      names.length,
      `${relativePath} shared-region names must be unique`,
    );
  }
}

test("PR 5 protection manifest defines the complete unique policy", () => {
  assert.equal(
    PROTECTED_BASE_COMMIT,
    "e3250c09bfb2666a9787b4d23bdf348634f69ff8",
  );
  assertPolicyShape({
    exactFiles: PROTECTED_EXACT_FILES,
    sentinels: PROTECTED_SENTINELS,
    sharedRegions: PROTECTED_SHARED_REGIONS,
  });
});

test("PR 5 policy shape rejects a removed exact-file entry", () => {
  assert.throws(
    () => assertPolicyShape({
      exactFiles: PROTECTED_EXACT_FILES.filter(
        (relativePath) => relativePath !== "server/room_assignment.mjs",
      ),
      sentinels: PROTECTED_SENTINELS,
      sharedRegions: PROTECTED_SHARED_REGIONS,
    }),
    /exact-file policy must contain 21 entries/,
  );
});

test("PR 5 policy shape rejects a removed shared-file sentinel entry", () => {
  const { ["outputs/web_prototype/easy_exam_automation.html"]: _removed, ...sentinels } =
    PROTECTED_SENTINELS;
  assert.throws(
    () => assertPolicyShape({
      exactFiles: PROTECTED_EXACT_FILES,
      sentinels,
      sharedRegions: PROTECTED_SHARED_REGIONS,
    }),
    /sentinel policy must contain 2 files/,
  );
});

test("PR 5 policy shape rejects a removed shared-region entry", () => {
  const sharedRegions = {
    ...PROTECTED_SHARED_REGIONS,
    "server/easy_exam_server.mjs": PROTECTED_SHARED_REGIONS[
      "server/easy_exam_server.mjs"
    ].filter((region) => region.name !== "exam list handler"),
  };
  assert.throws(
    () => assertPolicyShape({
      exactFiles: PROTECTED_EXACT_FILES,
      sentinels: PROTECTED_SENTINELS,
      sharedRegions,
    }),
    /server shared-region policy must contain 36 entries/,
  );
});

test("PR 5 deployed baseline commit is available", () => {
  assertBaselineCommitAvailable();
});

test("PR 5 exact protected files match the deployed main commit byte-for-byte", () => {
  assertBaselineCommitAvailable();
  for (const relativePath of PROTECTED_EXACT_FILES) {
    const currentFile = readFileSync(new URL(`../${relativePath}`, import.meta.url));
    const deployedFile = baselineFile(relativePath);

    assert.equal(
      Buffer.compare(currentFile, deployedFile),
      0,
      `${relativePath} differs from deployed main commit ${PROTECTED_BASE_COMMIT}`,
    );
  }
});

test("PR 5 protected regions in shared files match the deployed main commit", () => {
  assertBaselineCommitAvailable();
  for (const [relativePath, regions] of Object.entries(PROTECTED_SHARED_REGIONS)) {
    const currentSource = readFileSync(
      new URL(`../${relativePath}`, import.meta.url),
      "utf8",
    );
    const deployedSource = baselineFile(relativePath).toString("utf8");
    assertFileRegionsMatch(relativePath, regions, currentSource, deployedSource);
  }
});

test("PR 5 shared-region guard rejects an immediate return in handleExamList", () => {
  const relativePath = "server/easy_exam_server.mjs";
  const currentSource = readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
  const handlerAnchor = "async function handleExamList(req, res) {\n";
  const mutatedSource = currentSource.replace(
    handlerAnchor,
    `${handlerAnchor}  return json(res, 200, { sessions: [] });\n`,
  );
  assert.notEqual(mutatedSource, currentSource, "handleExamList mutation was not applied");
  const examListRegion = PROTECTED_SHARED_REGIONS[relativePath].filter(
    (region) => region.name === "exam list handler",
  );
  assert.throws(
    () => assertFileRegionsMatch(
      relativePath,
      examListRegion,
      mutatedSource,
      baselineFile(relativePath).toString("utf8"),
    ),
    /protected region "exam list handler" differs/,
  );
});

for (const mutation of [
  {
    name: "candidate template handler",
    anchor: "async function handleCandidateTemplate(req, res) {\n",
    insertion: "  return json(res, 200, { candidates: [] });\n",
  },
  {
    name: "candidate template route",
    anchor: "if (req.method === \"POST\" && url.pathname === \"/api/candidates/generate-template\") {\n",
    insertion: "      return json(res, 200, { candidates: [] });\n",
  },
  {
    name: "candidate session list route",
    anchor: "if (req.method === \"GET\" && url.pathname === \"/api/sessions\") {\n",
    insertion: "      return json(res, 200, { sessions: [] });\n",
  },
]) {
  test(`PR 5 shared-region guard rejects a mutation in ${mutation.name}`, () => {
    const relativePath = "server/easy_exam_server.mjs";
    const currentSource = readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
    const mutatedSource = currentSource.replace(
      mutation.anchor,
      `${mutation.anchor}${mutation.insertion}`,
    );
    assert.notEqual(mutatedSource, currentSource, `${mutation.name} mutation was not applied`);
    const protectedRegion = PROTECTED_SHARED_REGIONS[relativePath].filter(
      (region) => region.name === mutation.name,
    );
    assert.throws(
      () => assertFileRegionsMatch(
        relativePath,
        protectedRegion,
        mutatedSource,
        baselineFile(relativePath).toString("utf8"),
      ),
      new RegExp(`protected region "${mutation.name}" differs`),
    );
  });
}

test("PR 5 shared files retain every protected workflow sentinel", () => {
  for (const [relativePath, sentinels] of Object.entries(PROTECTED_SENTINELS)) {
    const currentFile = readFileSync(
      new URL(`../${relativePath}`, import.meta.url),
      "utf8",
    );

    for (const sentinel of sentinels) {
      assert.ok(
        currentFile.includes(sentinel),
        `${relativePath} is missing protected sentinel ${JSON.stringify(sentinel)}`,
      );
    }
  }
});
