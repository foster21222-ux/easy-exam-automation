import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(rootDir, "outputs/web_prototype/easy_exam_automation.html"), "utf8");

test("hidden views cannot be overridden by component display styles", () => {
  assert.match(html, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});

test("navigation orders project management, exam list, then auto configuration", () => {
  const nav = html.slice(html.indexOf('<nav class="nav"'), html.indexOf("</nav>"));
  const projectIndex = nav.indexOf('id="projectNavBtn"');
  const examIndex = nav.indexOf('id="examNavBtn"');
  const autoIndex = nav.indexOf('id="autoNavItem"');
  assert.ok(projectIndex >= 0 && examIndex >= 0 && autoIndex >= 0);
  assert.ok(projectIndex < examIndex && examIndex < autoIndex);
});

test("URL page layout replaces shared showView content switching", () => {
  assert.ok(html.includes('import { createRouter } from "/web/router.mjs"'));
  assert.ok(html.includes("ProjectListPage({ root: projectManagementView"));
  assert.ok(html.includes("ExamListPage({ root: examListView"));
  assert.ok(html.includes("RequirementListPage({ root: requirementsView"));
  assert.ok(html.includes("RequirementDetailPage({ root: requirementDetailView"));
  assert.ok(html.includes('staticPage("wechat-collector", wechatCollectorView, loadWechatCollector'));
  assert.equal(html.includes("function showView"), false);
  assert.equal(html.includes("syncActiveNavByScroll"), false);
});

test("requirement center renders list and detail surfaces", () => {
  assert.ok(html.includes('id="requirementsList"'));
  assert.ok(html.includes('id="requirementWorkQueueFilters"'));
  assert.ok(html.includes("需求处理工作台"));
  assert.ok(html.includes("renderRequirementWorkQueueFilters"));
  assert.ok(html.includes("requirementNextAction"));
  assert.ok(html.includes("data-requirement-filter"));
  assert.ok(html.includes("有待处理变更"));
  assert.ok(html.includes("处理变更"));
  assert.ok(html.includes("审核需求"));
  assert.ok(html.includes('id="requirementDetailView"'));
  assert.ok(html.includes('id="requirementNextStep"'));
  assert.ok(html.includes("当前处理建议"));
  assert.ok(html.includes("renderRequirementNextStep"));
  assert.ok(html.includes("优先处理客户变更"));
  assert.ok(html.includes("生成客户补充话术"));
  assert.ok(html.includes("标记客户已确认，可进入执行"));
  assert.ok(html.includes("<details open><summary>2. 当前可执行操作</summary>"));
  assert.ok(html.includes("<details><summary>3. 变更与确认记录</summary>"));
  assert.ok(html.includes("<details><summary>4. 审计记录</summary>"));
  assert.ok(html.includes('id="requirementClarificationBtn"'));
  assert.ok(html.includes('id="requirementClarificationQuestions"'));
  assert.ok(html.includes('id="requirementClarificationPrompt"'));
  assert.ok(html.includes('id="requirementReviewedBtn"'));
  assert.ok(html.includes('id="requirementMarkReadyBtn"'));
  assert.ok(html.includes('id="requirementLinkTaskBtn"'));
  assert.ok(html.includes('id="requirementTimeline"'));
  assert.ok(html.includes('id="requirementVersions"'));
  assert.ok(html.includes('id="requirementChanges"'));
  assert.ok(html.includes('id="requirementAnalysisCandidates"'));
  assert.ok(html.includes('id="requirementSource"'));
  assert.ok(html.includes('id="requirementAuditMessage"'));
  assert.ok(html.includes("ready_for_manual_execution"));
  assert.ok(html.includes("renderRequirementChangeRequests"));
  assert.ok(html.includes('data-change-action="accept"'));
  assert.ok(html.includes('data-change-action="reject"'));
  assert.ok(html.includes("/change-requests/"));
  assert.ok(html.includes("change_request_accepted"));
  assert.ok(html.includes("change_request_rejected"));
  assert.ok(html.includes("formatRequirementChangeFields"));
  assert.ok(html.includes("formatRequirementChangeRecord"));
  assert.ok(html.includes("isDisplayableRequirementChangeField"));
  assert.ok(html.includes('["watermark_enabled", "copy_forbidden"].includes(field)'));
  assert.ok(html.includes("采纳并生成新版本"));
  assert.ok(html.includes("驳回此次变更"));
  assert.ok(html.includes("采纳后会生成新的需求版本；驳回后不会修改当前需求。"));
  assert.ok(html.includes("0. 解析结果确认"));
  assert.ok(html.includes("规则解析和 LLM 候选解析都会在这里展示"));
  assert.ok(html.includes("renderRequirementAnalysisCandidates"));
  assert.ok(html.includes("latestAnalysisCandidateEvent"));
  assert.ok(html.includes("LLM 候选"));
  assert.ok(html.includes("规则与 LLM 冲突"));
  assert.ok(html.includes("发给客户的补充问题"));
  assert.ok(html.includes("1. 核对需求内容"));
  assert.ok(html.includes("先看最新需求、缺失项和原始来源"));
  assert.equal(html.includes("2. 人工审核处理"), false);
  assert.ok(html.includes("微信群模式下，审核动作只处理需求单状态，不会反向操作微信群"));
  assert.ok(html.includes("要求客户补充：信息不完整时生成可复制的话术"));
  assert.ok(html.includes("内部审核通过，待客户确认：内容完整但还需要客户最终确认"));
  assert.ok(html.includes("标记可进入执行：客户确认后交给执行侧创建考试任务"));
  assert.ok(html.includes("关联执行任务编号：记录后续创建出的考试任务，便于从需求追踪到执行结果"));
  assert.ok(html.includes("3. 变更与确认记录"));
  assert.ok(html.includes("4. 审计记录"));
  assert.ok(html.includes("formatRequirementEvent"));
  assert.ok(html.includes("parseRequirementSource"));
  assert.ok(html.includes("微信群"));
  assert.ok(html.includes("采集时间"));
  assert.equal(html.includes("JSON.stringify(item.payload || {})"), false);
  assert.equal(html.includes("JSON.stringify(item.changes || {})"), false);
});

test("WeChat collector page renders config and scheduler status surfaces", () => {
  assert.ok(html.includes('id="wechatCollectorNavBtn"'));
  assert.ok(html.includes('id="systemConfigNavBtn"'));
  assert.ok(html.includes('id="wechatCollectorView"'));
  assert.ok(html.includes('id="systemConfigView"'));
  assert.ok(html.includes('id="wechatCollectorReadiness"'));
  assert.ok(html.includes('id="wechatCollectorGoLive"'));
  assert.ok(html.includes('id="wechatCollectorConfig"'));
  assert.ok(html.includes('id="wechatCollectorConfigBackups"'));
  assert.ok(html.includes('id="wechatCollectorStatus"'));
  assert.ok(html.includes('id="wechatCollectorHistory"'));
  assert.ok(html.includes('id="wechatCollectorPreflight"'));
  assert.ok(html.includes('id="wechatPipelineSmoke"'));
  assert.ok(html.includes('id="wechatCollectorLogs"'));
  assert.ok(html.includes('id="wechatCollectorService"'));
  assert.ok(html.includes('id="wechatCollectorScheduler"'));
  assert.ok(html.includes('id="wechatCollectorRequirementCenter"'));
  assert.ok(html.includes('id="installWechatCollectorServiceBtn"'));
  assert.ok(html.includes('id="uninstallWechatCollectorServiceBtn"'));
  assert.ok(html.includes('id="installWechatCollectorSchedulerBtn"'));
  assert.ok(html.includes('id="uninstallWechatCollectorSchedulerBtn"'));
  assert.ok(html.includes('id="installWechatCollectorAutomationBtn"'));
  assert.ok(html.includes('id="uninstallWechatCollectorAutomationBtn"'));
  assert.ok(html.includes('id="refreshWechatCollectorBtn"'));
  assert.ok(html.includes('id="dryRunWechatCollectorBtn"'));
  assert.ok(html.includes('id="runWechatCollectorOnceBtn"'));
  assert.ok(html.includes('id="runWechatPipelineSmokeBtn"'));
  assert.ok(html.includes('id="addWechatGroupBtn"'));
  assert.equal(html.includes('id="saveWechatCollectorConfigBtn"'), false);
  assert.ok(html.includes('data-wechat-action="remove"'));
  assert.ok(html.includes('data-wechat-action="run-once"'));
  assert.ok(html.includes("renderWechatCollectorReadiness"));
  assert.ok(html.includes("微信群配置"));
  assert.ok(html.includes("1. 配置微信群"));
  assert.ok(html.includes("采集边界：可见群聊 OCR · 需求中心人工确认 · 已下载附件按本群可见文件名关联 · 不自动下载群文件"));
  assert.equal(html.includes("<h2 class=\"panel-title\">当前能力</h2>"), false);
  assert.ok(html.includes("每个微信群独立保存设置"));
  assert.equal(html.includes(">保存微信群配置<"), false);
  assert.ok(html.includes("wechat-group-card"));
  assert.ok(html.includes("wechat-group-summary"));
  assert.ok(html.includes("#wechatCollectorConfig"));
  assert.ok(html.includes("min-height: 0"));
  assert.ok(html.includes("max-height: 720px"));
  assert.ok(html.includes("项目：${safeText(group.project_name || \"未填写项目\")}"));
  assert.ok(html.includes("关联需求单编号"));
  assert.ok(html.includes("可留空。填入后，本群后续采集和变更会归到这张需求单；不填则首次有效采集时新建需求。"));
  assert.ok(html.includes('data-wechat-field="requirement_request_id"'));
  assert.ok(html.includes("保存本群设置"));
  assert.ok(html.includes('data-wechat-action="save-group"'));
  assert.ok(html.includes("群设置操作"));
  assert.equal(html.includes("<details><summary>群设置操作</summary>"), false);
  assert.ok(html.includes("<details><summary>高级：配置备份与恢复</summary>"));
  assert.ok(html.includes("<details><summary>3. 排障日志</summary>"));
  assert.ok(html.includes("最近运行摘要"));
  assert.ok(html.includes("只保留最近摘要，详细排障看群卡片或日志"));
  assert.equal(html.includes("<h2 class=\"panel-title\">配置备份与恢复</h2>"), false);
  assert.ok(html.includes("任务执行状态"));
  assert.ok(html.includes("需求更新记录"));
  assert.ok(html.includes("renderWechatGroupRequirementTimeline"));
  assert.ok(html.includes("renderWechatGroupRequirementUpdates"));
  assert.ok(html.includes("renderWechatGroupRequirementChanges"));
  assert.ok(html.includes("采集运行记录"));
  assert.ok(html.includes("客户变更记录"));
  assert.ok(html.includes("查看需求单详情"));
  assert.ok(html.includes('<h2 class="panel-title">需求更新记录</h2></div><div class="view-actions">${renderWechatRequirementDetailButton(effectiveRequestId)}</div>'));
  assert.equal(html.includes('const actions = `<div class="view-actions" style="margin-top:10px;"><button class="btn" data-wechat-action="open-requirement"'), false);
  assert.ok(html.includes("字段变更"));
  assert.ok(html.includes("本群已关联需求单，可在这里核对最近客户变更。"));
  assert.equal(html.includes("<h2 class=\"panel-title\">关联需求字段变更</h2>"), false);
  assert.ok(html.includes("messageCount"));
  assert.ok(html.includes("changeCount"));
  assert.ok(html.includes("1. 初始化验证"));
  assert.ok(html.includes("环境预检"));
  assert.ok(html.includes("立即采集"));
  assert.ok(html.includes("每个启用群上线前都需要在配置表对应行执行“立即采集本群”"));
  assert.ok(html.includes("识别到新需求或变更时会推送需求中心并更新 checkpoint"));
  assert.ok(html.includes("2. 上线自动采集"));
  assert.ok(html.includes("上线前必须完成"));
  assert.ok(html.includes("3. 高级维护"));
  assert.ok(html.includes("renderWechatCollectorGoLive"));
  assert.ok(html.includes("setWechatCollectorInstallAvailability"));
  assert.ok(html.includes("installWechatCollectorSchedulerBtn.disabled = !available;"));
  assert.ok(html.includes("installWechatCollectorAutomationBtn.disabled = !available;"));
  assert.ok(html.includes('const missingLabels = checks.filter((item) => !item.ok).map((item) => item.label);'));
  assert.ok(html.includes("上线前必须完成"));
  assert.ok(html.includes("配置合法"));
  assert.ok(html.includes("config_valid"));
  assert.ok(html.includes('readinessChecks.find((item) => item.key === "pipeline_smoke")'));
  assert.ok(html.includes("const smokeOk = Boolean(smokeCheck.ok);"));
  assert.equal(html.includes("const smokeOk = Boolean(statusData.pipelineSmoke?.ok);"), false);
  assert.ok(html.includes('readinessChecks.find((item) => item.key === "requirement_push")'));
  assert.ok(html.includes("const realPushOk = Boolean(realPushCheck.ok);"));
  assert.equal(html.includes('latestRunGroups.filter((group) => group.status === "pushed")'), false);
  assert.ok(html.includes("真实微信试跑"));
  assert.ok(html.includes("立即采集本群"));
  assert.ok(html.includes("定时已安装并加载"));
  assert.ok(html.includes("renderWechatCollectorLogs"));
  assert.ok(html.includes("renderWechatCollectorScheduler"));
  assert.ok(html.includes("renderWechatCollectorService"));
  assert.ok(html.includes("手动服务可达"));
  assert.ok(html.includes("LaunchAgent 常驻"));
  assert.ok(html.includes("不自动下载群文件"));
  assert.ok(html.includes("renderWechatCollectorRequirementCenter"));
  assert.ok(html.includes("renderWechatCollectorRunGroups"));
  assert.ok(html.includes("renderWechatCollectorHistory"));
  assert.ok(html.includes('const fallbackStatus = item.status || "unknown";'));
  assert.ok(html.includes('const statusText = groups.length ? groupStatusText : wechatCollectorStatusLabel(fallbackStatus);'));
  assert.ok(html.includes('const failed = fallbackStatus === "failed" || fallbackStatus === "skipped"'));
  assert.ok(html.includes("运行历史"));
  assert.ok(html.includes("taskViewState.wechatGroupStatuses = statusData.groups || []"));
  assert.ok(html.includes("renderWechatCollectorConfig(groups, taskViewState.wechatGroupStatuses, taskViewState.wechatHistory)"));
  assert.ok(html.includes("renderWechatCollectorConfigBackups(statusData.configBackups"));
  assert.ok(html.includes("配置备份与恢复"));
  assert.ok(html.includes('data-wechat-action="restore-config"'));
  assert.ok(html.includes("/api/wechat-collector/config/restore"));
  assert.ok(html.includes("restoreWechatCollectorConfigBackup"));
  assert.ok(html.includes("latestStatus"));
  assert.ok(html.includes("status.latestError ? `错误：${status.latestError}` : \"\""));
  assert.ok(html.includes("checkpointUpdatedAt"));
  assert.ok(html.includes("下次运行"));
  assert.ok(html.includes("renderWechatCollectorPreflight"));
  assert.equal(html.includes("附件扫描排障"), false);
  assert.equal(html.includes("扫描已下载文件"), false);
  assert.ok(html.includes("本群附件"));
  assert.ok(html.includes("本群最近一次采集未关联已下载附件"));
  assert.ok(html.includes('data-wechat-action="show-attachments"'));
  assert.ok(html.includes("系统配置"));
  assert.ok(html.includes("微信采集配置"));
  assert.ok(html.includes('id="wechatCollectorLaunchSummary"'));
  assert.ok(html.includes("微信采集上线状态"));
  assert.ok(html.includes("renderWechatCollectorLaunchSummary"));
  assert.ok(html.includes("上线前检查"));
  assert.ok(html.includes("检查本机采集环境"));
  assert.ok(html.includes("去微信采集页逐群验证"));
  assert.ok(html.includes("批量真实采集所有启用群"));
  assert.ok(html.includes("<details><summary>高级操作：批量真实采集</summary>"));
  assert.ok(html.includes("<details><summary>高级维护：服务与定时任务</summary>"));
  assert.ok(html.includes("一般不用改 Endpoint"));
  assert.ok(html.includes("清空已保存密钥"));
  assert.ok(html.includes("LLM 候选解析"));
  assert.equal(html.includes("cc-connect 新消息采集"), false);
  assert.equal(html.includes("/api/wechat-collector/cc-connect/"), false);
  assert.equal(html.includes("Homebrew"), false);
  assert.equal(html.includes('id="wechatCcConnectStatus"'), false);
  assert.equal(html.includes("renderWechatCcConnectStatus"), false);
  assert.equal(html.includes("copyWechatCcConnectCommand"), false);
  assert.ok(html.includes('id="wechatLlmEnabled"'));
  assert.ok(html.includes('id="wechatLlmProvider"'));
  assert.ok(html.includes('<option value="qwen">千问'));
  assert.ok(html.includes('id="wechatLlmApiKey"'));
  assert.ok(html.includes('id="loadWechatLlmModelsBtn"'));
  assert.ok(html.includes('id="saveWechatLlmConfigBtn"'));
  assert.ok(html.includes("renderWechatLlmConfig"));
  assert.ok(html.includes("renderWechatLlmModelOptions"));
  assert.ok(html.includes("loadWechatLlmModels"));
  assert.ok(html.includes("collectWechatLlmConfig"));
  assert.ok(html.includes('apiKey: wechatLlmApiKey.value.replace(/\\s+/g, "")'));
  assert.ok(html.includes("/api/wechat-collector/llm/models"));
  assert.ok(html.includes("apiKeyConfigured"));
  assert.ok(html.includes("1. 配置微信群"));
  assert.ok(html.includes("2. 运行监控"));
  assert.ok(html.includes("3. 排障日志"));
  assert.ok(html.includes("配置备份与恢复"));
  assert.ok(html.includes("附件只在本群最近一次采集中按可见文件名关联"));
  assert.ok(html.includes("staticPage(\"system-config\", systemConfigView, loadWechatCollector"));
  assert.ok(html.includes("renderWechatPipelineSmoke(statusData.pipelineSmoke || {})"));
  assert.ok(html.includes("const freshnessText = result.ok ? (result.fresh ? \"有效\" : (result.stale ? \"已过期\" : \"待确认\")) : \"未通过\";"));
  assert.ok(html.includes("完成：${formatTaskTime(result.finishedAt)}"));
  assert.ok(html.includes("skipped_interval"));
  assert.ok(html.includes("no_new_messages"));
  assert.ok(html.includes("captureMode"));
  assert.ok(html.includes("screenshotPath"));
  assert.ok(html.includes("captureRect"));
  assert.equal(html.includes('data-wechat-field="incremental_source"'), false);
  assert.equal(html.includes('data-wechat-field="cc_connect_chat_id"'), false);
  assert.equal(html.includes('data-wechat-action="fill-chat-id"'), false);
  assert.equal(html.includes("ccConnectLastMessageId"), false);
  assert.ok(html.includes("采集：OCR 可见窗口"));
  assert.ok(html.includes("采集方式：OCR 当前窗口/定时可见窗口"));
  assert.ok(html.includes("截图区域：${safeText(group.captureRect)}"));
  assert.ok(html.includes("ocrCommand"));
  assert.ok(html.includes("nextRunAt"));
  assert.ok(html.includes("附件候选：${Number(group.attachmentCandidateCount || 0)} · 已关联：${Number(group.attachmentCount || 0)}"));
  assert.ok(html.includes("附件过滤"));
  assert.ok(html.includes("installWechatCollectorService"));
  assert.ok(html.includes("uninstallWechatCollectorService"));
  assert.ok(html.includes("installWechatCollectorAutomation"));
  assert.ok(html.includes("uninstallWechatCollectorAutomation"));
  assert.ok(html.includes("confirmWechatSideEffect"));
  assert.ok(html.includes("会激活微信"));
  assert.ok(html.includes("LaunchAgent"));
  assert.ok(html.includes("runWechatCollectorOnce"));
  assert.ok(html.includes("runWechatCollectorGroupOnce"));
  assert.ok(html.includes("saveWechatCollectorGroup"));
  assert.ok(html.includes("groupName"));
  assert.ok(html.includes("await loadWechatCollector()"));
  assert.ok(html.includes("dryRunWechatCollector"));
  assert.ok(html.includes("showWechatGroupAttachmentStatus"));
  assert.ok(html.includes("runWechatPipelineSmoke"));
  assert.ok(html.includes("/api/wechat-collector/pipeline-smoke-test"));
  assert.ok(html.includes("fetchWechatPipelineSmoke"));
  assert.ok(html.includes("return { httpOk: response.ok, status: response.status, data };"));
  assert.ok(html.includes("renderWechatPipelineSmoke(result.data?.result || { ok: false, error: result.data?.error ||"));
  assert.ok(html.includes("/api/wechat-collector/dry-run"));
  assert.ok(html.includes("installWechatCollectorScheduler"));
  assert.ok(html.includes("uninstallWechatCollectorScheduler"));
  assert.ok(html.includes("collectWechatCollectorConfig"));
  assert.ok(html.includes("validateWechatCollectorConfig"));
  assert.ok(html.includes("wechatIntervalInputValue"));
  assert.equal(html.includes("Number(group.interval_minutes || 15)"), false);
  assert.equal(html.includes('value("interval_minutes") || "15"'), false);
  assert.ok(html.includes("采集间隔必须是大于等于 1 的整数"));
  assert.ok(html.includes("微信群名称重复"));
  assert.ok(html.includes("removeWechatCollectorRow"));
  assert.ok(html.includes("/api/wechat-collector/config"));
  assert.ok(html.includes("/api/wechat-collector/status"));
  assert.ok(html.includes('method: "PUT"'));
  assert.ok(html.includes("result.backupPath"));
  assert.ok(html.includes("已备份上一版配置"));
  assert.ok(html.includes("await loadWechatCollector()"));
  assert.ok(html.includes("${label}已保存，正在刷新状态"));
});

test("auto config page renders customer service scheduler controls", () => {
  assert.ok(html.includes('id="customerServiceSchedulerState"'));
  assert.ok(html.includes('id="customerServiceSchedulerProfiles"'));
  assert.ok(html.includes('id="customerServiceSchedulerRunBtn"'));
  assert.ok(html.includes("/api/customer-service-scheduler"));
  assert.ok(html.includes("/api/customer-service-scheduler/run"));
  assert.ok(html.includes("renderCustomerServiceSchedulerProfiles"));
  assert.ok(html.includes("data-customer-service-action"));
  assert.ok(html.includes("在线客服定时"));
});

test("exam list is task-aggregated and exam detail owns dual session cards", () => {
  assert.ok(
    html.includes(
      'import { aggregateExamSessions, matchesExamTask, resolveCandidateTaskContext } from "/web/exam_task_view_model.mjs"',
    ),
  );
  assert.ok(html.includes('id="taskSessionCards"'));
  assert.ok(html.includes("data-candidate-task-id"));
  assert.equal(html.includes('id="examTypeFilter"'), false);
});

test("requirement center remains present while exam views change", () => {
  assert.ok(html.includes('id="requirementsView"'));
  assert.ok(html.includes('id="requirementDetailView"'));
  assert.ok(html.includes("RequirementListPage({ root: requirementsView"));
  assert.ok(html.includes("RequirementDetailPage({ root: requirementDetailView"));
});

test("candidate page loads and preselects task-scoped sessions", () => {
  assert.ok(html.includes("async function loadCandidateTaskContext()"));
  assert.ok(html.includes("resolveCandidateTaskContext(task, sessionId)"));
  assert.ok(html.includes("loadContext: loadCandidateTaskContext"));
  assert.ok(html.includes("sessionSelect.value = String(candidateUiState.selectedSession.session_id)"));
  assert.ok(html.includes("已带入目标考试场次"));
  assert.ok(html.includes("candidateUiState.taskScoped = Boolean(taskId)"));
  assert.ok(html.includes("renderLoadSessionsAction()"));
  assert.ok(html.includes("loadSessionsAction.hidden = candidateUiState.taskScoped"));
  assert.equal(html.includes("已带入正式考试和试考"), false);
});

test("candidate import route labels the mapping panel as EasyExam field selection", () => {
  const candidatePanel = html.slice(
    html.indexOf('id="candidateImportPanel"'),
    html.indexOf('id="projectDetailView"'),
  );
  assert.ok(candidatePanel.includes("易考字段选择"));
  assert.equal(candidatePanel.includes("<h3 class=\"panel-title\">字段映射</h3>"), false);
});

test("candidate upload card explains raw list import and information item mapping", () => {
  const uploadCard = html.slice(
    html.indexOf('id="candidateDropZone"'),
    html.indexOf('id="candidateFileInput"'),
  );
  assert.ok(uploadCard.includes("上传客户原始名单"));
  assert.ok(uploadCard.includes("支持 .xlsx、.xls、.csv 格式。"));
  assert.ok(uploadCard.includes("上传后，请在下方选择需要导入易考的信息项以及对应字段，导入后自动生成信息项。"));
  assert.ok(uploadCard.includes("客户名单首行必须是基本信息项才可自动读取"));
  assert.equal(uploadCard.includes("固定字段映射后"), false);
  assert.equal(uploadCard.includes("必填字段：准考证号 / 姓名"), false);

  const helpBoxStyle = html.slice(
    html.indexOf(".candidate-help-box {"),
    html.indexOf(".candidate-card-head"),
  );
  assert.ok(helpBoxStyle.includes("display: block"));
  assert.ok(helpBoxStyle.includes("max-width: 100%"));
  assert.ok(helpBoxStyle.includes("overflow-wrap: anywhere"));
  assert.match(html, /\.candidate-upload-box\s*>\s*span\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%[^}]*overflow:\s*hidden/s);
  assert.match(html, /\.candidate-upload-box\s+\.drop-title\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*word-break:\s*break-word/s);
  assert.ok(helpBoxStyle.includes(".candidate-upload-warning"));
  assert.ok(helpBoxStyle.includes("color: #dc2626"));
  assert.equal(helpBoxStyle.includes("border:"), false);
  assert.equal(helpBoxStyle.includes("background:"), false);
  assert.equal(helpBoxStyle.includes("padding:"), false);
});

test("candidate import supports optional course code mapping", () => {
  assert.ok(html.includes('id="candidateMapCourseCode"'));
  assert.ok(html.includes('id="candidateMapMobile"'));
  assert.ok(html.includes('id="candidateMapEmail"'));
  assert.ok(html.includes("手机号码（选填）"));
  assert.ok(html.includes("<th>科目编号</th>"));
  assert.ok(html.includes("course_code: data.mapping?.course_code || \"\""));
  assert.ok(html.includes("candidateUiState.candidates.map(({ permit, full_name, identity_id, course_code, mobile, email, custom_fields })"));
});

test("candidate preview and import payload include mapped phone and email", () => {
  const renderResultBody = html.slice(
    html.indexOf("function renderCandidateResult()"),
    html.indexOf("async function parseCandidateFile"),
  );
  assert.ok(renderResultBody.includes("fixedPreviewFields"));
  assert.ok(renderResultBody.includes('key: "mobile"'));
  assert.ok(renderResultBody.includes('key: "email"'));

  const importBody = html.slice(
    html.indexOf("async function importCandidatesToSession()"),
    html.indexOf("async function splitRoomsAutomatically"),
  );
  assert.ok(importBody.includes("candidateUiState.candidates.map(({ permit, full_name, identity_id, course_code, mobile, email, custom_fields })"));
  assert.ok(importBody.includes("mobile,"));
  assert.ok(importBody.includes("email,"));
});

test("candidate import keeps the right preview rail visible while scrolling", () => {
  assert.match(html, /\.candidate-panel\s*\{[^}]*overflow:\s*visible/s);
  assert.match(html, /\.candidate-right\s*\{[^}]*position:\s*sticky[^}]*top:\s*18px[^}]*max-height:\s*calc\(100vh - 36px\)[^}]*overflow-y:\s*auto/s);
  assert.match(html, /@media\s*\(max-width:\s*1120px\)\s*\{[\s\S]*?\.candidate-right\s*\{[^}]*position:\s*static[^}]*max-height:\s*none[^}]*overflow-y:\s*visible/s);
});

test("candidate import supports custom field selection and local save payload", () => {
  assert.ok(html.includes("客户名单自定义字段"));
  assert.ok(html.includes('id="selectAllCustomFieldsBtn"'));
  assert.ok(html.includes('id="clearCustomFieldsBtn"'));
  assert.equal(html.includes('id="candidateDownloadBtn"'), false);
  assert.equal(html.includes(">下载导入模板</button>"), false);
  assert.ok(html.includes('id="loadSessionsAction"'));
  const candidatePanel = html.slice(
    html.indexOf('id="candidateImportPanel"'),
    html.indexOf('id="projectDetailView"'),
  );
  assert.ok(candidatePanel.indexOf('id="loadSessionsAction"') > candidatePanel.indexOf('id="sessionSelect"'));
  assert.ok(candidatePanel.indexOf('id="loadSessionsAction"') < candidatePanel.indexOf('id="candidateImportBtn"'));
  assert.equal(html.includes('id="addCustomFieldBtn"'), false);
  assert.match(html, /\.custom-field-head\s*\{[^}]*flex-wrap:\s*wrap[^}]*min-width:\s*0/s);
  assert.match(html, /\.custom-field-head\s*>\s*div:first-child\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/s);
  assert.match(html, /\.custom-field-actions\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(96px,\s*max-content\)\)[^}]*max-width:\s*100%/s);
  assert.match(html, /\.custom-field-actions\s+\.btn\s*\{[^}]*max-width:\s*100%[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(html, /\.custom-field-row\s*\{[^}]*grid-template-columns:\s*28px\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)[^}]*max-width:\s*100%[^}]*overflow:\s*hidden/s);
  assert.match(html, /\.custom-field-source,\s*[\r\n\s]*\.custom-field-sample\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/s);
  assert.ok(html.includes("custom_field_candidates"));
  assert.ok(html.includes("selectedCustomFields()"));
  assert.ok(html.includes("custom_fields: buildCustomFieldValues(row)"));
  assert.ok(html.includes("自定义字段已随考生导入请求发送到易考"));
});

test("candidate mapping allows permit from identity or phone while catching missing course code for formal multi-course tasks", () => {
  assert.equal(html.includes("字段映射重复"), false);
  assert.ok(html.includes("当前考试任务包含"));
  assert.ok(html.includes("必须映射“科目编号”"));
  assert.ok(html.includes("candidateUiState.taskCourses"));
});

test("candidate custom fields keep source columns already used by base mappings", () => {
  assert.equal(html.includes(".filter((field) => field.manual || !fixed.has(field.source_column))"), false);
  assert.equal(html.includes("if (!column || fixed.has(column) || existingSources.has(column)) return;"), false);
  assert.ok(html.includes("mappedCandidateSourceColumns"));
  assert.ok(html.includes("!mappedColumns.has(field.source_column)"));
  assert.ok(html.includes("mappedColumns.has(column)"));
  assert.ok(html.includes("固定字段不会重复展示"));
});

test("candidate mapping canonicalizes phone and email aliases in fixed fields", () => {
  assert.ok(html.includes("function canonicalImportFieldName"));
  assert.ok(html.includes('return "手机号码"'));
  assert.ok(html.includes('return "邮箱"'));
  assert.ok(html.includes("candidateMapMobile.value"));
  assert.ok(html.includes("candidateMapEmail.value"));
});

test("candidate validation messages use Chinese field labels", () => {
  const validationBlock = html.slice(
    html.indexOf("function validateCandidatesClient"),
    html.indexOf("function calculateCandidateStats"),
  );
  assert.ok(validationBlock.includes("candidateFieldLabel"));
  assert.ok(validationBlock.includes("const missingMappedFields"));
  assert.ok(validationBlock.includes("缺少字段映射：${candidateFieldLabel(field)}"));
  assert.ok(validationBlock.includes("if (!missingMappedFields.has(field)"));
  assert.ok(validationBlock.includes("第 ${rowNum} 行缺少${candidateFieldLabel(field)}"));
  assert.ok(validationBlock.includes('第 ${rowNum} 行${candidateFieldLabel("identity_id")}为科学计数法格式'));
  assert.ok(validationBlock.includes('第 ${rowNum} 行${candidateFieldLabel("permit")}为科学计数法格式'));
  assert.equal(validationBlock.includes("缺少字段映射：${field}"), false);
  assert.equal(validationBlock.includes("行缺少 ${field}"), false);
  assert.equal(validationBlock.includes("行 permit 为科学计数法格式"), false);
  assert.equal(validationBlock.includes("course_code。"), false);
});

test("candidate validation rejects invalid permit and phone-mapped permit formats", () => {
  const validationBlock = html.slice(
    html.indexOf("function validateCandidatesClient"),
    html.indexOf("function candidateStats"),
  );
  assert.ok(html.includes("function isValidCandidatePermit"));
  assert.ok(html.includes("function isValidCandidateMobile"));
  assert.ok(validationBlock.includes("candidatePermitMappedFromMobile"));
  assert.ok(validationBlock.includes("第 ${rowNum} 行准考证号只能包含英文字母和数字"));
  assert.ok(validationBlock.includes("第 ${rowNum} 行${permitMobileError}"));
});

test("candidate validation checks mainland identity and mobile numbers before import", () => {
  const validationBlock = html.slice(
    html.indexOf("function validateCandidatesClient"),
    html.indexOf("function candidateStats"),
  );
  assert.ok(html.includes("function normalizeCandidateIdentityId"));
  assert.ok(html.includes("function validateCandidateIdentityId"));
  assert.ok(html.includes("function candidateIdentityChecksum"));
  assert.ok(html.includes("function normalizeCandidateMobile"));
  assert.ok(html.includes("function validateCandidateMobile"));
  assert.ok(html.includes("身份证号格式不正确"));
  assert.ok(html.includes("身份证号出生日期不合法"));
  assert.ok(html.includes("身份证号校验码错误"));
  assert.ok(html.includes("手机号不能为空"));
  assert.ok(html.includes("手机号格式不正确"));
  assert.ok(html.includes("手机号必须为 11 位数字"));
  assert.ok(validationBlock.includes("validateCandidateIdentityId(candidate.identity_id)"));
  assert.ok(validationBlock.includes("validateCandidateMobile(candidate.mobile)"));
  assert.ok(html.includes("identity_id: normalizeCandidateIdentityId"));
  assert.ok(html.includes("mobile: normalizeCandidateMobile"));
});

test("local login page and logout controls are present", () => {
  assert.ok(html.includes('id="loginView"'));
  assert.equal(html.includes('id="loginView" hidden'), false);
  assert.ok(html.includes('id="appShell" hidden'));
  assert.ok(html.includes('id="authLoginEmailInput"'));
  assert.ok(html.includes('id="authLoginPasswordInput"'));
  assert.ok(html.includes('id="logoutBtn"'));
  assert.ok(html.includes("请通过服务网址打开"));
  assert.ok(html.includes("AuthController"));
});

test("login page script does not redeclare backend settings variables", () => {
  assert.equal((html.match(/const loginPasswordInput/g) || []).length, 0);
  assert.ok(html.includes("const authLoginPasswordInput"));
  assert.ok(html.includes("const backendLoginPasswordInput"));
  assert.equal((html.match(/id="loginPasswordInput"/g) || []).length, 1);
});

test("auto config uses fixed EasyExam login URL without showing a URL input", () => {
  assert.equal(html.includes('id="loginUrlInput"'), false);
  assert.equal(html.includes("<span class=\"field-label\">登录网址</span>"), false);
  assert.ok(html.includes('url: "https://eztest.org/manager/accounts/login"'));
  assert.ok(html.includes("请完整填写账号和密码。"));
  assert.equal(html.includes("请完整填写登录网址、账号和密码。"), false);
});

test("auto config renders operations dashboard structure without changing controls", () => {
  assert.ok(html.includes('class="auto-workbench" id="autoWorkbench" hidden'));
  assert.equal(html.includes('class="workflow-rail"'), false);
  assert.ok(html.includes('class="workflow-inline"'));
  assert.ok(html.includes('class="workbench-main"'));
  assert.ok(html.includes('class="support-rail"'));
  assert.equal(html.includes('data-workbench-resizer="workflow"'), false);
  assert.ok(html.includes('data-workbench-resizer="support"'));
  assert.ok(html.includes('role="separator" aria-orientation="vertical"'));
  assert.ok(html.includes("easyExam:autoWorkbenchSplit:v3"));
  assert.ok(html.includes("installWorkbenchResizeControls"));
  assert.ok(html.includes('id="loginUsernameInput"'));
  assert.ok(html.includes('id="loginPasswordInput"'));
  assert.ok(html.includes('id="tenantApiKeyInput"'));
  assert.ok(html.includes('id="saveLoginBtn"'));
  assert.ok(html.includes('id="dropZone"'));
  assert.ok(html.includes('id="progressNumber"'));
  assert.ok(
    html.indexOf('id="dropZone"') < html.indexOf('class="workflow-inline"'),
    "upload area should render before the inline workflow panel",
  );
  assert.ok(
    html.indexOf('id="stepList"') < html.indexOf('id="progressNumber"'),
    "workflow steps should render before the right-side progress summary",
  );
  assert.ok(html.includes('class="workflow-steps"'));
  assert.ok(html.includes('class="workflow-summary"'));
  assert.ok(html.includes('id="previewRows"'));
  assert.ok(html.includes('id="captureGrid"'));
  assert.ok(html.includes('id="logList"'));
  assert.ok(html.includes('class="progress-circle" id="progressCircle"'));
  assert.ok(html.includes('class="progress-ring"'));
  assert.ok(html.includes('class="progress-ring-track"'));
  assert.ok(html.includes('class="progress-ring-value" id="progressRingValue"'));
  assert.match(html, /class="progress-circle"[\s\S]*id="progressNumber"/);
  assert.match(html, /\.workflow-summary\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(html, /\.workflow-summary\s+\.subtitle\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(html, /\.progress-ring-value\s*\{[^}]*stroke-dasharray:\s*var\(--progress-circumference\)[^}]*stroke-dashoffset:\s*var\(--progress-offset\)/s);
  assert.match(html, /progressCircle\.style\.setProperty\("--progress-offset",\s*String\(progressOffset\)\)/);
  assert.match(html, /progressCircle\.setAttribute\("aria-label",\s*`配置进度 \$\{normalizedPercent\}%`\)/);
  assert.equal(html.includes("conic-gradient(var(--blue)"), false);
  assert.equal(html.includes('class="bar"'), false);
  assert.equal(html.includes('class="bar-fill"'), false);
  assert.equal(html.includes('id="barFill"'), false);
  assert.equal(html.includes("barFill.style.width"), false);
  assert.equal(html.includes('id="modeTag"'), false);
  assert.equal(html.includes('class="review-strip"'), false);
  assert.equal(html.includes("最终创建前会停在易考确认页"), false);
  assert.equal(html.includes('class="mock-window"'), false);
  assert.equal(html.includes("installLocalZoomGuard"), false);
  assert.equal(html.includes("zoom-compensated"), false);
  assert.equal(html.includes("zoom-notice"), false);
  assert.equal(html.includes("transform: scale(var(--local-zoom-scale"), false);
  assert.equal(html.includes("document.body.style.zoom"), false);
  assert.equal(html.includes("document.documentElement.style.zoom"), false);
  assert.equal(html.includes("--local-zoom-factor"), false);
  assert.equal(html.includes("--local-zoom-scale"), false);
  assert.match(html, /\.app-shell\s*\{[^}]*display:\s*flex[^}]*width:\s*100%[^}]*min-width:\s*0/s);
  assert.match(html, /\.main\s*\{[^}]*flex:\s*1\s+1\s+auto[^}]*min-width:\s*0[^}]*width:\s*100%/s);
  assert.match(html, /\.auto-workbench\s*\{[^}]*--workbench-left-width:\s*calc\(\(100% - 28px\) \/ 2\)[^}]*--workbench-right-width:\s*calc\(\(100% - 28px\) \/ 2\)[^}]*display:\s*grid[^}]*grid-template-columns:[^}]*minmax\(0,\s*var\(--workbench-left-width\)\)[^}]*minmax\(0,\s*var\(--workbench-right-width\)\)[^}]*width:\s*100%[^}]*min-width:\s*0/s);
  assert.equal(html.includes("--support-rail-width"), false);
  assert.equal(html.includes("--workbench-main-min-width"), false);
  assert.match(html, /\.support-rail\s*\{[^}]*width:\s*100%/s);
  assert.match(html, /\.support-rail\s*>\s*\.panel\s*\{[^}]*width:\s*100%/s);
  assert.match(html, /\.support-rail\s+\.panel-body\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(html, /\.support-rail\s+table\s*\{[^}]*min-width:\s*360px/s);
  assert.match(html, /\.workflow-inline\s*\{[^}]*border:\s*1px solid var\(--line\)[^}]*border-radius:\s*8px/s);
  assert.match(html, /const defaultSplit = \{ leftPercent: 50, rightPercent: 50 \}/);
  assert.match(html, /const defaultWidths = \(\) => splitToWidths\(defaultSplit\)/);
  assert.match(html, /const workbenchWidth = \(\) => \{[\s\S]*autoWorkbench\.parentElement\?\.getBoundingClientRect\(\)\.width/s);
  assert.equal(html.includes("|| 1280"), false);
  assert.match(html, /const resetWidths = \(\) => \{[\s\S]*removeProperty\("--workbench-left-width"\)[\s\S]*removeProperty\("--workbench-right-width"\)/);
  assert.match(html, /const readSavedSplit = \(\) => \{[\s\S]*localStorage\.getItem\(storageKey\)[\s\S]*return null/s);
  assert.match(html, /const savedSplit = readSavedSplit\(\);\s*if \(savedSplit\) applyWidths\(splitToWidths\(savedSplit\)\);\s*else resetWidths\(\);/);
  assert.match(html, /autoWorkbench\.style\.setProperty\("--workbench-left-width", `\$\{Math\.round\(widths\.left\)\}px`\)/);
  assert.match(html, /autoWorkbench\.style\.setProperty\("--workbench-right-width", `\$\{Math\.round\(widths\.right\)\}px`\)/);
  assert.match(html, /leftPercent:\s*Math\.round\(leftPercent\)/);
  assert.match(html, /rightPercent:\s*Math\.round\(rightPercent\)/);
  assert.match(html, /support:\s*\{ minPercent: 25, maxPercent: 50 \}/);
  assert.ok(html.includes('aria-valuemin="25"'));
  assert.ok(html.includes('aria-valuemax="50"'));
  assert.equal(html.includes('aria-valuemax="75"'), false);
  assert.match(html, /\.workbench-main\s*\{[^}]*position:\s*sticky/s);
  assert.doesNotMatch(html, /\.workbench-main\s*\{[^}]*max-height:/s);
  assert.doesNotMatch(html, /\.workbench-main\s*\{[^}]*overflow-y:\s*auto/s);
  assert.equal(html.includes("@media (max-width: 1360px)"), false);
  assert.equal(html.includes("@media (max-width: 1180px)"), false);
  assert.match(html, /@media\s*\(max-width:\s*900px\)[\s\S]*\.auto-workbench\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test("capture preview renders as a large inline image without a detail modal", () => {
  assert.ok(html.includes('class="capture-image"'));
  assert.match(html, /\.capture-thumb\s*\{[^}]*aspect-ratio:\s*1544\s*\/\s*528/s);
  assert.match(html, /\.capture-thumb\s*\{[^}]*min-height:\s*220px/s);
  assert.match(html, /\.capture-card\s*\{[^}]*cursor:\s*default/s);
  assert.equal(html.includes("点击查看完整截图"), false);
  assert.equal(html.includes('id="shotModal"'), false);
  assert.equal(html.includes("function openShot"), false);
  assert.equal(html.includes("[data-shot]"), false);
  assert.equal(html.includes('class="shot-frame"'), false);
  assert.equal(html.includes('class="shot-image"'), false);
});

test("user management page is present for admin account provisioning", () => {
  assert.ok(html.includes('id="usersNavBtn"'));
  assert.ok(html.includes('id="userManagementView"'));
  assert.ok(html.includes('id="userEmailInput"'));
  assert.ok(html.includes('id="userPasswordInput"'));
  assert.ok(html.includes('id="userRows"'));
  assert.ok(html.includes("UserManagementPage"));
});

test("project management supports deleting projects", () => {
  assert.ok(html.includes('data-action="delete"'));
  assert.ok(html.includes("同步删除易考中的正式考试/试考场次"));
  assert.ok(html.includes('method: "DELETE"'));
  assert.ok(html.includes("/api/tasks/"));
});

test("project card actions use a bounded two-column grid", () => {
  assert.match(html, /\.project-card\s*\{[^}]*overflow:\s*hidden[^}]*box-sizing:\s*border-box/s);
  assert.match(html, /\.card-actions\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*max-width:\s*100%/s);
  assert.match(html, /\.card-actions\s+button\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*text-overflow:\s*ellipsis/s);
  assert.ok(html.includes('class="card-actions"'));
});

test("exam detail progress cards include paper binding and grouped candidate flows", () => {
  assert.ok(html.includes("buildTaskDisplaySteps(task)"));
  assert.ok(html.includes("试卷绑定"));
  assert.ok(html.includes("试考试卷绑定"));
  assert.ok(html.includes('stepMap.has("trial_paper_bind")'));
  assert.ok(html.includes("试考考生导入 & 自动分班"));
  assert.ok(html.includes("正式考试考生导入 & 自动分班"));
  assert.ok(html.includes("成绩处理"));
  assert.ok(html.includes("data-score-process"));
  assert.ok(html.includes("data-score-download"));
  assert.ok(html.includes("data-monitor-download"));
  assert.ok(html.includes("下载监考账号"));
  assert.ok(html.includes("试卷绑定"));
  assert.equal(html.includes("触发试卷绑定"), false);
  assert.ok(html.includes('data-trigger-step="paper_form_bind"'));
  assert.ok(html.includes("function shouldShowRetryStepAction(step)"));
  assert.ok(html.includes("function shouldShowInlineRetryStepAction(step)"));
  assert.ok(html.includes("function retryStepActionHtml(step)"));
  assert.ok(html.includes('step.stepKey === "trial_paper_bind" && step.status === "pending"'));
  assert.ok(html.includes("${shouldShowInlineRetryStepAction(step) ? retryStepActionHtml(step) : \"\"}"));
  assert.ok(html.includes("${step.extraDetail ? `<div>${safeText(step.extraDetail)}</div>` : \"\"}"));
  assert.equal(html.includes("!step.hideLogs ? `<div style=\"margin-top:8px;\">${safeText(logs)}</div>` : \"\""), false);
  assert.ok(html.includes("继续绑定试考试卷"));
  assert.ok(html.includes("paperFormBind"));
  assert.ok(html.includes('stepName: "试卷绑定"'));
  assert.ok(html.includes("/steps/paper_form_bind/retry"));
});

test("exam detail shows project shared sheet before score processing with a manual trigger", () => {
  assert.ok(html.includes("项目共享大表"));
  assert.ok(html.includes("短信通知"));
  assert.ok(html.includes("buildNotificationMessage"));
  assert.ok(html.includes("考生您好！"));
  assert.ok(html.includes("正式考试和试考时，打开考试客户端输入口令和您的准考证号即可登录参加考试"));
  assert.ok(html.includes("data-shared-sheet-fill"));
  assert.ok(html.includes("打开在线表"));
  assert.ok(html.includes("https://docs.qq.com/sheet/DR3NiT296WmtpWXVM?tab=BB08J2"));
  assert.ok(html.includes("填写"));
  assert.equal(html.includes("触发填写"), false);
  assert.ok(html.includes("重新填写"));
  assert.ok(html.includes("/shared-sheet/fill"));
  const displaySteps = html.slice(
    html.indexOf("function buildTaskDisplaySteps(task)"),
    html.indexOf("function renderTaskDetail(task)"),
  );
  const sharedSheetStep = displaySteps.slice(
    displaySteps.indexOf('stepKey: "project_shared_sheet"'),
    displaySteps.indexOf('const notificationMessage = buildNotificationMessage(task)'),
  );
  assert.ok(sharedSheetStep.includes("buildSharedSheetDetail"));
  assert.ok(html.includes('return `填写完成：${formatTaskTime(sharedSheetStep.completedAt)}`'));
  assert.equal(html.includes('填写中 - 填写完成'), false);
  assert.ok(sharedSheetStep.includes("hideLogs: true"));
  assert.ok(displaySteps.indexOf('stepKey: "project_shared_sheet"') < displaySteps.indexOf('stepKey: "score_process"'));
  assert.ok(displaySteps.indexOf('stepKey: "project_shared_sheet"') < displaySteps.indexOf('stepKey: "sms_notification"'));
  assert.ok(displaySteps.indexOf('stepKey: "sms_notification"') < displaySteps.indexOf('stepKey: "score_process"'));
  const smsStep = displaySteps.slice(
    displaySteps.indexOf('stepKey: "sms_notification"'),
    displaySteps.indexOf('const scoreStep = stepMap.get("score_process")'),
  );
  assert.equal(smsStep.includes("triggerActionHtml"), false);
  assert.equal(smsStep.includes("extraDetail: notificationMessage"), false);
  assert.ok(smsStep.includes("hideDetail: true"));
  assert.ok(smsStep.includes("extraHtml"));
  assert.ok(smsStep.includes("data-copy-sms"));
  assert.ok(smsStep.includes("sms-action-row"));
  assert.ok(smsStep.includes("https://home.danmi.com/#/login"));
  assert.ok(smsStep.includes("旦米"));
  assert.ok(html.includes("sms-platform-link"));
  assert.ok(smsStep.includes("buildSmsCandidateTable(task.candidates || [])"));
  assert.ok(smsStep.includes('type="button">复制短信</button>${buildSmsCandidateTable(task.candidates || [])}<a class="sms-platform-link"'));
  assert.ok(smsStep.includes('<div class="sms-message-text">${safeText(notificationMessage)}</div>'));
  assert.ok(smsStep.includes('data-sms-toggle="message"'));
  assert.ok(smsStep.includes('aria-expanded="false"'));
  assert.ok(smsStep.includes("展开全部"));
  assert.ok(html.includes(".sms-notification-preview.is-expanded .sms-message-text"));
  assert.ok(html.includes(".sms-expand-button"));
  assert.ok(html.includes('event.target.closest("[data-sms-toggle]")'));
  assert.ok(html.includes('smsPreview.classList.toggle("is-expanded", expanded)'));
  assert.ok(html.includes('smsToggle.setAttribute("aria-expanded", expanded ? "true" : "false")'));
  assert.equal(html.includes("sms-candidate-table"), false);
  assert.ok(html.includes("sms-candidate-download"));
  assert.ok(html.includes("data-download-sms-candidates"));
  assert.ok(html.includes("downloadSmsCandidatesCsv"));
  assert.ok(html.includes("考生姓名"));
  assert.ok(html.includes("手机号码"));
  assert.ok(html.includes('type="button">考生手机号下载</button>'));
  assert.equal(html.includes("<small>Download</small>"), false);
  assert.equal(html.includes(">复制</button>"), false);
  assert.ok(html.includes(">复制短信</button>"));
  assert.ok(html.includes("smsCandidateRows"));
  assert.ok(html.includes("考生手机号.csv"));
  assert.ok(html.includes("sms-copy-button"));
  assert.ok(html.includes("overflow-wrap: anywhere"));
  assert.ok(html.includes("function copyTextToClipboard"));
  assert.ok(html.includes("navigator.clipboard.writeText"));
  assert.ok(html.includes('document.execCommand("copy")'));
  assert.ok(html.includes('await copyTextToClipboard(smsCopy.dataset.copySms || "")'));
  assert.ok(html.includes("!step.hideDetail"));
  assert.equal(html.includes("!step.hideLogs"), false);
});

test("auto config page exposes exam request template download instead of demo import", () => {
  assert.ok(html.includes("导入模板下载"));
  assert.ok(html.includes("/api/templates/exam-request"));
  assert.equal(html.includes("模拟导入"), false);
  assert.equal(html.includes("applyImportResult(demoData.filename, demoData)"), false);
});

test("monitor account preview uses monitor session URL", () => {
  assert.ok(html.includes("function monitorSessionUrl"));
  assert.ok(html.includes("https://eztest.org/monitor/session/"));
  const buildMonitorAccounts = html.slice(html.indexOf("function buildMonitorAccounts"));
  assert.ok(buildMonitorAccounts.includes("monitor_url: sessionUrl"));
});

test("candidate monitor account preview hides monitor address but keeps it in download payload", () => {
  const previewMarkup = html.slice(html.indexOf('id="monitorAccountCard"'), html.indexOf('async function downloadMonitorAccountsExcel'));
  assert.equal(previewMarkup.includes("<th>监考地址</th>"), false);
  assert.equal(previewMarkup.includes("row.monitor_url"), false);
  assert.ok(previewMarkup.includes('colspan="6"'));
  const downloadFn = html.slice(html.indexOf("async function downloadMonitorAccountsExcel"));
  assert.ok(downloadFn.includes("monitor_url: row.monitor_url || \"\""));
});
