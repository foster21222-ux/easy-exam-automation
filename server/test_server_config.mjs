import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = fs.readFileSync(path.join(rootDir, "server", "easy_exam_server.mjs"), "utf8");
const requirementApiSource = fs.readFileSync(path.join(rootDir, "server", "requirement_request_api.mjs"), "utf8");

test("content email reads the same configured requirement database as the requirement API", () => {
  assert.match(requirementApiSource, /process\.env\.REQUIREMENT_DB_PATH \|\| defaultDbPath/);
  assert.match(
    serverSource,
    /const requirementDbPath = path\.resolve\(\s*rootDir,\s*process\.env\.REQUIREMENT_DB_PATH \|\| path\.join\(rootDir, "\.easy_exam_runtime", "requirement_requests\.sqlite3"\),?\s*\);/,
  );
});

test("server wires operation collaboration and content email endpoints", () => {
  assert.match(serverSource, /from "\.\/operation_batch\.mjs"/);
  assert.match(serverSource, /from "\.\/operation_batch_runner\.mjs"/);
  assert.match(serverSource, /from "\.\/operation_console_env\.mjs"/);
  assert.match(serverSource, /from "\.\/content_requirement_email\.mjs"/);
  assert.match(serverSource, /\/api\/email\/settings/);
  assert.match(serverSource, /\/api\/operation-console\/environment/);
  assert.match(serverSource, /operation-batch\\\/create/);
  assert.match(serverSource, /content-requirement-email/);
});

test("server listen host can be configured for LAN deployment", () => {
  assert.ok(serverSource.includes("process.env.HOST"));
  assert.ok(serverSource.includes("server.listen(port, host"));
});

test("server exposes exam request template download endpoint", () => {
  assert.ok(serverSource.includes('path.join(rootDir, "template", "v2易考新建考试需求单.xlsx")'));
  assert.ok(serverSource.includes("async function handleExamRequestTemplate"));
  assert.ok(serverSource.includes('/api/templates/exam-request'));
});

test("server exposes authenticated prebuilt Fanwei helper installer downloads", () => {
  assert.ok(serverSource.includes('path.join(runtimeDir, "fanwei-helper")'));
  assert.ok(serverSource.includes('path.join(rootDir, "dist", "fanwei-helper")'));
  assert.ok(serverSource.includes("async function handleFanweiHelperInstaller"));
  assert.ok(serverSource.includes('/api/fanwei/helper-installer'));
  const requestHandlerBlock = serverSource.slice(serverSource.indexOf("async function requestHandler"));
  assert.ok(requestHandlerBlock.indexOf("!getAuthUserFromRequest(auth, req)") < requestHandlerBlock.indexOf("handleFanweiHelperInstaller(url, res)"));
});

test("EasyExam account settings are stored per console user", () => {
  assert.ok(serverSource.includes('path.join(runtimeDir, "user_settings.json")'));
  assert.ok(serverSource.includes("saveUserLogin(state.userSettings, user"));
  assert.ok(serverSource.includes("currentUserLogin({"));
});

test("Fanwei auto-read status opens dedicated Chrome when no Fanwei tab exists", () => {
  const ensureBlock = serverSource.slice(
    serverSource.indexOf("async function ensureFanweiDevToolsChromeAvailable"),
    serverSource.indexOf("async function readFanweiFromLocalChrome"),
  );
  assert.ok(ensureBlock.includes("status?.fanweiTabFound === false"));
  assert.ok(ensureBlock.includes("launchFanweiChromeForDevTools()"));
  assert.ok(ensureBlock.includes("launchedChrome: true"));

  const statusBlock = serverSource.slice(
    serverSource.indexOf("async function handleFanweiAutoReadStatus"),
    serverSource.indexOf("async function handleFanweiAutoRead(req"),
  );
  assert.ok(statusBlock.includes("available: true"));
  assert.ok(statusBlock.includes("...status"));
});

test("Fanwei serial miss does not relaunch Chrome when DevTools is already connected", () => {
  const readBlock = serverSource.slice(
    serverSource.indexOf("async function runFanweiDevToolsReadWithAutoLaunch"),
    serverSource.indexOf("async function ensureFanweiDevToolsChromeAvailable"),
  );
  assert.ok(readBlock.includes("return await runChromeDevToolsFanweiRead({ serialNo, timeoutMs });"));
  assert.equal(readBlock.includes("if (fanwei) return fanwei"), false);
  assert.equal(readBlock.includes("const launched = await launchFanweiChromeForDevTools();\n    if (!launched) return fanwei"), false);
});

test("loopback Fanwei read fallback returns raw data without creating an import", () => {
  const localReadBlock = serverSource.slice(
    serverSource.indexOf("async function handleFanweiLocalRead"),
    serverSource.indexOf("async function handleFanweiAutoRead(req"),
  );
  assert.ok(localReadBlock.includes("isLoopbackRequest(req)"));
  assert.ok(localReadBlock.includes("readFanweiFromLocalChrome(serialNo)"));
  assert.ok(localReadBlock.includes("{ ok: true, data: fanwei }"));
  assert.equal(localReadBlock.includes("createFanweiRequirementImportFromPayload"), false);
  assert.equal(localReadBlock.includes("randomUUID"), false);
  assert.equal(localReadBlock.includes("fs.writeFile"), false);
  assert.ok(serverSource.includes('url.pathname === "/api/fanwei/local-read"'));
  assert.ok(serverSource.includes("handleFanweiLocalRead(req, res)"));
});

test("Fanwei preview route validates raw data and has no persistence side effects", () => {
  const previewBlock = serverSource.slice(
    serverSource.indexOf("function buildFanweiRequirementPreviewFromPayload"),
    serverSource.indexOf("async function createFanweiRequirementImportFromPayload"),
  );
  assert.ok(previewBlock.includes("validateFanweiReadPayload"));
  assert.ok(previewBlock.includes("buildFanweiRequirementModel"));
  assert.ok(previewBlock.includes("return { fanwei: model }"));
  assert.equal(previewBlock.includes("randomUUID"), false);
  assert.equal(previewBlock.includes("fs.writeFile"), false);
  assert.equal(previewBlock.includes("runPythonJson"), false);
  assert.equal(previewBlock.includes("createImportFromWorkbook"), false);
  assert.equal(previewBlock.includes("state.imports"), false);
  assert.ok(serverSource.includes('url.pathname === "/api/fanwei/requirement-preview"'));
  assert.ok(serverSource.includes("handleFanweiRequirementPreview(req, res)"));
});

test("Fanwei requirement import validates raw data before any file or task write", () => {
  const importBlock = serverSource.slice(
    serverSource.indexOf("async function createFanweiRequirementImportFromPayload"),
    serverSource.indexOf("async function handleFanweiRequirementImport"),
  );
  assert.ok(importBlock.includes("validateFanweiReadPayload"));
  assert.ok(importBlock.indexOf("validateFanweiReadPayload") < importBlock.indexOf("randomUUID"));
  assert.ok(importBlock.indexOf("validateFanweiReadPayload") < importBlock.indexOf("fs.writeFile"));
  assert.equal(importBlock.includes("sampleFanweiR0042182"), false);
  assert.equal(importBlock.includes('payload.serialNo === "R0042182"'), false);
});

test("deleting a console user removes that user's EasyExam account settings", () => {
  assert.ok(serverSource.includes("delete state.userSettings.users[normalizeEmail(email)]"));
  assert.ok(serverSource.includes("await fs.writeFile(userSettingsPath, JSON.stringify(state.userSettings, null, 2), \"utf8\")"));
});

test("authenticated automation jobs use saved user settings instead of request overrides", () => {
  assert.ok(serverSource.includes("const storedLogin = getYikaoLoginForRequest(req);"));
  assert.ok(serverSource.includes("const login = auth.enabled ? storedLogin : { ...storedLogin, ...(payload.login || {}) };"));
});

test("session creation does not enable bluetooth blocking by default", () => {
  const buildPayloads = serverSource.slice(
    serverSource.indexOf("function buildSessionPayloads"),
    serverSource.indexOf("async function runYikaoApiCreationJob"),
  );
  assert.equal(buildPayloads.includes("check_bluetooth: true"), false);
});

test("session creation forwards requirement exam address selection to tenant API", () => {
  const buildPayloads = serverSource.slice(
    serverSource.indexOf("function buildSessionPayloads"),
    serverSource.indexOf("async function runYikaoApiCreationJob"),
  );
  assert.ok(buildPayloads.includes("unified_exam_address: unifiedExamAddress"));
  assert.ok(buildPayloads.includes("config.unifiedExamAddress"));
  assert.ok(buildPayloads.includes('config.examAddress || config.examUrlType || ""'));
});

test("session creation forwards manual scoring selection to tenant API", () => {
  const buildPayloads = serverSource.slice(
    serverSource.indexOf("function buildSessionPayloads"),
    serverSource.indexOf("async function runYikaoApiCreationJob"),
  );
  assert.ok(buildPayloads.includes("manual_score: boolValue(config.manualScore)"));
  assert.equal(buildPayloads.includes("manual_score: false"), false);
});

test("session creation enables monitor replay and anonymous monitor by default", () => {
  const buildPayloads = serverSource.slice(
    serverSource.indexOf("function buildSessionPayloads"),
    serverSource.indexOf("async function runYikaoApiCreationJob"),
  );
  assert.ok(buildPayloads.includes("monitor_replay: true"));
  assert.ok(buildPayloads.includes("anonymous_monitor: true"));
});

test("trial session disables pledge content by default", () => {
  const buildPayloads = serverSource.slice(
    serverSource.indexOf("function buildSessionPayloads"),
    serverSource.indexOf("async function runYikaoApiCreationJob"),
  );
  const trialBlock = buildPayloads.slice(
    buildPayloads.indexOf("const trial = {"),
    buildPayloads.indexOf('applyTimeRule(trial, "不扣时")'),
  );
  assert.ok(trialBlock.includes("nda: false"));
  assert.ok(trialBlock.includes('nda_notice: ""'));
});

test("web exam session enables lock screen and forwards leave limit", () => {
  const buildPayloads = serverSource.slice(
    serverSource.indexOf("function buildSessionPayloads"),
    serverSource.indexOf("async function runYikaoApiCreationJob"),
  );
  const webMainBlock = buildPayloads.slice(
    buildPayloads.indexOf("} else {\n    Object.assign(main"),
    buildPayloads.indexOf("const payloads ="),
  );
  assert.ok(webMainBlock.includes("client_required: false"));
  assert.ok(webMainBlock.includes("lock_screen: true"));
  assert.ok(webMainBlock.includes("login_times: positiveNumber(config.clientLoginLimit, 10)"));
  assert.ok(webMainBlock.includes("lock_screen_exit_sec: positiveNumber(config.webLeaveSeconds, 5)"));
  assert.ok(webMainBlock.includes("lock_screen_time: positiveNumber(config.leaveLimit, 5)"));

  const webTrialBlock = buildPayloads.slice(
    buildPayloads.indexOf("} else {\n      Object.assign(trial"),
    buildPayloads.indexOf("payloads.push"),
  );
  assert.ok(webTrialBlock.includes("client_required: false"));
  assert.ok(webTrialBlock.includes("lock_screen: true"));
  assert.ok(webTrialBlock.includes("login_times: positiveNumber(config.clientLoginLimit, 10)"));
  assert.ok(webTrialBlock.includes("lock_screen_exit_sec: positiveNumber(config.webLeaveSeconds, 5)"));
  assert.ok(webTrialBlock.includes("lock_screen_time: positiveNumber(config.leaveLimit, 10)"));
});

test("candidate import forwards optional course_code to EasyExam tenant API", () => {
  assert.ok(serverSource.includes("buildTenantCandidateEntries(candidates, customFieldMappings)"));
  assert.ok(serverSource.includes("candidate_tenant_payload.mjs"));
});

test("candidate payload validation messages use Chinese field labels", () => {
  const validationBlock = serverSource.slice(
    serverSource.indexOf("function validateCandidatePayload"),
    serverSource.indexOf("const baseImportFieldDefinitions"),
  );
  assert.ok(validationBlock.includes("candidateFieldLabel"));
  assert.ok(validationBlock.includes('`第 ${row} 行缺少${candidateFieldLabel("permit")}`'));
  assert.ok(validationBlock.includes('`第 ${row} 行缺少${candidateFieldLabel("full_name")}`'));
  assert.ok(validationBlock.includes('`第 ${row} 行${candidateFieldLabel("identity_id")}为科学计数法格式，请修正原始文件后再导入`'));
  assert.ok(validationBlock.includes('`第 ${row} 行${candidateFieldLabel("permit")}为科学计数法格式，请修正原始文件后再导入`'));
  assert.equal(validationBlock.includes("缺少 permit"), false);
  assert.equal(validationBlock.includes("缺少 full_name"), false);
  assert.equal(validationBlock.includes("identity_id 为科学计数法格式"), false);
  assert.equal(validationBlock.includes("permit 为科学计数法格式"), false);
});

test("candidate payload validation rejects invalid permit and phone-mapped permit formats", () => {
  const validationBlock = serverSource.slice(
    serverSource.indexOf("function validateCandidatePayload"),
    serverSource.indexOf("const baseImportFieldDefinitions"),
  );
  assert.ok(validationBlock.includes("isValidCandidatePermit"));
  assert.ok(validationBlock.includes("candidatePermitMappedFromMobile"));
  assert.ok(validationBlock.includes('`第 ${row} 行准考证号只能包含英文字母和数字`'));
  assert.ok(validationBlock.includes("validateCandidateMobile(permit, { required: true })"));
  assert.ok(validationBlock.includes('`第 ${row} 行${permitMobileError}`'));
});

test("candidate payload validation checks mainland identity and mobile numbers before tenant import", () => {
  const validationBlock = serverSource.slice(
    serverSource.indexOf("function validateCandidatePayload"),
    serverSource.indexOf("const baseImportFieldDefinitions"),
  );
  assert.ok(serverSource.includes("function normalizeCandidateIdentityId"));
  assert.ok(serverSource.includes("function validateCandidateIdentityId"));
  assert.ok(serverSource.includes("function candidateIdentityChecksum"));
  assert.ok(serverSource.includes("function normalizeCandidateMobile"));
  assert.ok(serverSource.includes("function validateCandidateMobile"));
  assert.ok(serverSource.includes("身份证号格式不正确"));
  assert.ok(serverSource.includes("身份证号出生日期不合法"));
  assert.ok(serverSource.includes("身份证号校验码错误"));
  assert.ok(serverSource.includes("手机号不能为空"));
  assert.ok(serverSource.includes("手机号格式不正确"));
  assert.ok(serverSource.includes("手机号必须为 11 位数字"));
  assert.ok(validationBlock.includes("validateCandidateIdentityId(identityId)"));
  assert.ok(validationBlock.includes("validateCandidateMobile(mobile)"));
});

test("candidate import and auto rooms write back task detail state", () => {
  assert.ok(serverSource.includes("async function syncTaskDetailSessionState"));
  const importHandler = serverSource.slice(
    serverSource.indexOf("async function handleCandidateImport"),
    serverSource.indexOf("async function handleRoomsPreview"),
  );
  assert.ok(importHandler.includes("updateTaskSessionProgress(task, sessionId"));
  assert.ok(importHandler.includes("taskSessionImportStepKey(session.sessionType)"));

  const roomsHandler = serverSource.slice(
    serverSource.indexOf("async function handleRoomsAuto"),
    serverSource.indexOf("async function handleCreateJob"),
  );
  assert.ok(roomsHandler.includes("updateTaskSessionProgress(task, sessionId"));
  assert.ok(roomsHandler.includes("sessions_auto_rooms"));
  assert.ok(roomsHandler.includes("sessions_invigilator_export"));

  const detailHandler = serverSource.slice(
    serverSource.indexOf("async function handleTaskDetail"),
    serverSource.indexOf("async function handleTaskHide"),
  );
  assert.ok(detailHandler.includes("syncTaskDetailSessionState(req, task)"));
});

test("monitor account export uses monitor session URL instead of exam URL", () => {
  assert.ok(serverSource.includes("function monitorSessionUrl"));
  assert.ok(serverSource.includes("https://eztest.org/monitor/session/"));
  assert.equal(serverSource.includes("/exam/session/"), false);
});

test("exam detail monitor download can fall back to cached generated monitor accounts", () => {
  assert.ok(serverSource.includes("async function findCachedMonitorAccounts"));
  const handler = serverSource.slice(
    serverSource.indexOf("async function handleSessionMonitorAccounts"),
    serverSource.indexOf("function normalizeTenantList"),
  );
  assert.ok(handler.includes("findCachedMonitorAccounts(sessionId)"));
  assert.ok(handler.includes("tenantRooms"));
  assert.ok(handler.includes("cachedRooms"));
  assert.ok(serverSource.includes("num: room.num || cached.num || \"\""));
});

test("score processing exposes task endpoint and uses template exporter", () => {
  assert.ok(serverSource.includes("scoreFeedbackExporterScript"));
  assert.ok(serverSource.includes("async function handleScoreProcess"));
  assert.ok(serverSource.includes("scoreProcessMatch"));
  assert.ok(serverSource.includes("scoreDownloadMatch"));
  assert.ok(serverSource.includes("score_process"));
  assert.ok(serverSource.includes("成绩处理"));
  assert.ok(serverSource.includes("processedDate"));
});

test("score processing fetches paged entry and score data before exporting", () => {
  assert.ok(serverSource.includes("async function fetchAllSessionEntries"));
  assert.ok(serverSource.includes("async function fetchAllSessionScores"));
  assert.ok(serverSource.includes("async function fetchSingleEntryStatus"));
  assert.ok(serverSource.includes("async function fetchSingleEntryScore"));
  assert.ok(serverSource.includes("/entry/${encodeURIComponent(page)}/${encodeURIComponent(perPage)}/"));
  assert.ok(serverSource.includes("/score/${encodeURIComponent(page)}/${encodeURIComponent(perPage)}/"));
  assert.ok(serverSource.includes("/entry/${encodeURIComponent(permit)}/score/"));
  assert.ok(serverSource.includes("mergeEntryAndScoreRows"));
  const handler = serverSource.slice(
    serverSource.indexOf("async function handleScoreProcess"),
    serverSource.indexOf("async function handleScoreDownload"),
  );
  assert.ok(handler.includes("fetchAllSessionEntries(login, formalSession.session_id"));
  assert.ok(handler.includes("fetchAllSessionScores(login, formalSession.session_id"));
  assert.ok(handler.includes("mergeEntryAndScoreRows"));
  assert.ok(handler.includes("attachCourseNamesToCandidates"));
});

test("completed API creation jobs do not automatically sync Tencent Docs", () => {
  assert.ok(serverSource.includes('from "./tencent_docs_sync.mjs"'));
  const creationJob = serverSource.slice(
    serverSource.indexOf("async function runYikaoApiCreationJob"),
    serverSource.indexOf("async function runPythonJson"),
  );
  assert.equal(creationJob.includes("syncExamConfigToTencentDocs"), false);
  assert.equal(creationJob.includes("tencentDocsSettingsFromEnv(process.env)"), false);
  assert.ok(creationJob.includes("项目共享大表未自动填写"));
});

test("project shared sheet trigger persists status and syncs formal plus optional trial sessions", () => {
  assert.ok(serverSource.includes("async function handleProjectSharedSheetFill(taskId, req, res)"));
  const handler = serverSource.slice(
    serverSource.indexOf("async function handleProjectSharedSheetFill"),
    serverSource.indexOf("function scoreFeedbackFileName"),
  );
  assert.ok(handler.includes('updateTaskStep(taskId, "project_shared_sheet", "running"'));
  assert.ok(handler.includes('session.sessionType === "formal"'));
  assert.ok(handler.includes('session.sessionType === "trial"'));
  assert.ok(handler.includes("tencentDocsSettingsFromEnv(process.env)"));
  assert.ok(handler.includes("syncExamConfigToTencentDocs"));
  assert.ok(handler.includes('updateTaskStep(taskId, "project_shared_sheet", "success"'));
  assert.ok(handler.includes('updateTaskStep(taskId, "project_shared_sheet", "failed"'));
  assert.ok(serverSource.includes("shared-sheet\\/fill$/"));
  assert.ok(serverSource.includes("handleProjectSharedSheetFill(decodeURIComponent(sharedSheetFillMatch[1]), req, res)"));
});

test("task detail includes stored candidates for SMS notification review", () => {
  const handler = serverSource.slice(
    serverSource.indexOf("async function handleTaskDetail"),
    serverSource.indexOf("async function handleProjectSharedSheetFill"),
  );
  assert.ok(handler.includes('runTaskState("list_candidates"'));
  assert.ok(handler.includes("syncedTask.candidates"));
});

test("project shared sheet fill refreshes session login limits from tenant detail", () => {
  const helperBlock = serverSource.slice(
    serverSource.indexOf("function sharedSheetSessionFieldsFromDetail"),
    serverSource.indexOf("async function handleProjectSharedSheetFill"),
  );
  assert.ok(helperBlock.includes("getTenantSessionDetail(login, sessionId)"));
  assert.ok(helperBlock.includes("clientLoginLimit"));
  assert.ok(helperBlock.includes("login_times"));
  assert.ok(helperBlock.includes("lock_screen_time"));
  assert.ok(helperBlock.includes("无法保证 L 列与考试配置一致"));

  const handler = serverSource.slice(
    serverSource.indexOf("async function handleProjectSharedSheetFill"),
    serverSource.indexOf("function scoreFeedbackFileName"),
  );
  assert.ok(handler.includes("const login = getYikaoLoginForRequest(req);"));
  assert.ok(handler.includes("await enrichSharedSheetSessions(login, sessions, logs)"));
  assert.ok(handler.indexOf("await enrichSharedSheetSessions(login, sessions, logs)") < handler.indexOf("syncExamConfigToTencentDocs"));
});

test("candidate import configures selected import fields as visible personal fields before importing", () => {
  assert.ok(serverSource.includes("const {"));
  assert.ok(serverSource.includes("selectedImportFields"));
  assert.ok(serverSource.includes("buildSelectedImportFields(payload?.field_mapping || {}, payload?.custom_fields || [])"));
  assert.ok(serverSource.includes("excludedPersonalSyncBaseKeys"));
  assert.ok(serverSource.includes("ensureSessionCustomPersonalFields(login, sessionId, selectedImportFields)"));
  assert.ok(serverSource.includes("syncImportPersonalFields"));
  const importHandler = serverSource.slice(serverSource.indexOf("async function handleCandidateImport"));
  assert.ok(importHandler.indexOf("ensureSessionCustomPersonalFields(login, sessionId, selectedImportFields)") < importHandler.indexOf("postCandidatesToTenant("));
  assert.ok(importHandler.indexOf("customFieldMappings") < importHandler.indexOf("postCandidatesToTenant("));
});

test("candidate personal field setup reads original session config and updates by PUT", () => {
  const setupFn = serverSource.slice(
    serverSource.indexOf("async function getTenantSessionDetail"),
    serverSource.indexOf("async function handleCandidateTemplate"),
  );
  assert.ok(setupFn.includes("getTenantSessionDetail(login, sessionId)"));
  assert.ok(setupFn.includes("获取原场次配置"));
  assert.ok(setupFn.includes("buildSessionPersonalPutPayload"));
  assert.ok(setupFn.includes('method: "PUT"'));
  assert.ok(setupFn.includes("场次信息项同步失败"));
});

test("candidate personal field setup builds PUT payload after merging personal fields", () => {
  const setupFn = serverSource.slice(
    serverSource.indexOf("async function ensureSessionCustomPersonalFields"),
    serverSource.indexOf("async function getSessionImportState"),
  );
  assert.ok(setupFn.indexOf("syncImportPersonalFields") < setupFn.indexOf("buildSessionPersonalPutPayload"));
  assert.ok(setupFn.indexOf("buildSessionPersonalPutPayload") < setupFn.indexOf('method: "PUT"'));
  assert.ok(setupFn.includes('method: "PUT"'));
  assert.ok(setupFn.includes("场次信息项同步失败"));
});
