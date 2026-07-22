const DEFAULT_SCORE_STAMP_WORKFLOW_BASE =
  "https://oa.ata.net.cn/spa/workflow/static4form/index.html";
const DEFAULT_SCORE_STAMP_WORKFLOW_HASH =
  "#/main/workflow/req?iscreate=1&workflowid=105021&isagent=0&beagenter=0&f_weaver_belongto_userid=&f_weaver_belongto_usertype=0&menuIds=1,12&menuPathIds=1,12";

function text(value) {
  return String(value ?? "").trim();
}

function first(...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return "";
}

function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function csv(value, fallback = []) {
  const items = text(value).split(/[;,，；]/).map((item) => item.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

function unique(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const normalized = text(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function compactBatchText(value = "") {
  return text(value)
    .replace(/\s+/g, "")
    .replace(/[（）()【】\[\]《》“”"'：:、，,。._\-—/\\|]+/g, "");
}

function stripBatchDateWords(value = "") {
  return compactBatchText(value)
    .replace(/\d{4}年度?/g, "")
    .replace(/\d{4}年\d{1,2}月(?:\d{1,2}日)?/g, "")
    .replace(/\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?/g, "")
    .replace(/\d{1,2}月(?:\d{1,2}日)?/g, "")
    .replace(/第[一二三四五六七八九十\d]+批/g, "");
}

function stripGenericExamWords(value = "") {
  const genericWords = [
    "校园招聘",
    "社会招聘",
    "内部选聘",
    "线上笔试",
    "线下笔试",
    "在线笔试",
    "在线机考",
    "补录笔试",
    "考试服务",
    "招聘考试",
    "资格考试",
    "能力考试",
    "校招",
    "社招",
    "补招",
    "补录",
    "招聘",
    "考试",
    "笔试",
    "面试",
    "测评",
    "机考",
    "线上",
    "线下",
    "在线",
    "服务",
    "项目",
    "年度",
    "专场",
  ];
  let result = stripBatchDateWords(value);
  for (const word of genericWords) {
    result = result.replaceAll(word, "");
  }
  return result;
}

function trimOrganizationSuffix(value = "") {
  return compactBatchText(value).replace(/(集团有限责任公司|股份有限公司|有限责任公司|集团公司|有限公司|集团|公司)$/g, "");
}

function compressedOrganizationExamName(value = "") {
  const compact = compactBatchText(value);
  const organizationMatch = compact.match(/^(.+?集团)(?:有限责任公司|股份有限公司|有限责任公司|有限公司|公司)?/);
  if (!organizationMatch) return "";
  const organization = organizationMatch[1];
  const rest = compact
    .slice(organizationMatch[0].length)
    .replace(/^.*(?:分公司|子公司|事业部|项目部|部门|中心|分院|分行|支行|办事处)/, "");
  const tail = rest.match(/([A-Za-z0-9]+[\u4e00-\u9fa5A-Za-z0-9]{0,30}?(?:管理岗|岗位|岗).*?(?:笔试|考试|测评|机考|面试)?)$/)?.[1] ||
    rest.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,30}?(?:笔试|考试|测评|机考|面试))$/)?.[1] ||
    "";
  return organization && tail ? `${organization}${tail}` : "";
}

export function buildScoreStampBatchSearchTerms(...values) {
  const terms = [];
  for (const value of values.map(text).filter(Boolean)) {
    const compact = compactBatchText(value);
    const withoutDate = stripBatchDateWords(value);
    const simplified = stripGenericExamWords(value);
    const compressed = compressedOrganizationExamName(value);
    terms.push(value, compact, withoutDate, compressed, simplified, trimOrganizationSuffix(simplified), trimOrganizationSuffix(withoutDate));
    for (const part of value.split(/[;,，；/_\-—|（）()【】\[\]\s]+/).map(text).filter(Boolean)) {
      terms.push(part, stripGenericExamWords(part), trimOrganizationSuffix(stripGenericExamWords(part)));
    }
    const core = trimOrganizationSuffix(simplified) || simplified || withoutDate || compact;
    if (core.length >= 4) {
      terms.push(core.slice(0, 4), core.slice(0, 6), core.slice(0, 8));
    }
  }
  return unique(terms)
    .filter((item) => item.length >= 4 || /^[A-Za-z]\d{4,}$/.test(item) || /^R\d{4,}$/i.test(item))
    .slice(0, 14);
}

export function scoreStampWorkflowUrl(env = process.env) {
  return text(env.SCORE_STAMP_WORKFLOW_URL) ||
    `${DEFAULT_SCORE_STAMP_WORKFLOW_BASE}?_rdm=${Date.now()}${DEFAULT_SCORE_STAMP_WORKFLOW_HASH}`;
}

export function buildScoreStampApplicationPayload({
  task = {},
  scoreResult = {},
  user = {},
  now = new Date(),
  env = process.env,
} = {}) {
  const config = task.config || {};
  const business = config.businessRequirement || {};
  const date = shanghaiDate(now);
  const applicant = first(env.SCORE_STAMP_APPLICANT_NAME, user.name, business.applicant, user.email);
  const projectName = first(task.projectName, business.project_name, scoreResult.examName);
  const fallbackBatchKeyword = first(
    config.operationBatchCode,
    config.operationBatch?.code,
    config.requirementRequestId,
    config.initialRequirementRequestId,
    business.operation_serial_number,
    config.projectCode,
    task.taskId,
  );
  const batchSearchTerms = buildScoreStampBatchSearchTerms(
    projectName,
    business.project_name,
    config.projectCode,
    business.project_code,
    config.operationBatchCode,
    config.operationBatch?.code,
    fallbackBatchKeyword,
  );
  const batchSearchKeyword = first(
    env.SCORE_STAMP_BATCH_KEYWORD,
    ...batchSearchTerms,
    projectName,
    business.project_name,
    fallbackBatchKeyword,
  );
  const pdfFileName = first(scoreResult.pdfFileName, scoreResult.fileName && String(scoreResult.fileName).replace(/\.xlsx$/i, ".pdf"));
  const archiveFileName = first(scoreResult.stampArchiveFileName, pdfFileName && `${pdfFileName.replace(/\.pdf$/i, "")}.zip`);
  const archivePassword = first(scoreResult.stampArchivePassword, "1234");
  return {
    workflowUrl: scoreStampWorkflowUrl(env),
    title: first(env.SCORE_STAMP_TITLE, `成绩专用章使用申请-${applicant || "申请人"}-${date}`),
    applicant,
    applicantDepartment: first(env.SCORE_STAMP_APPLICANT_DEPARTMENT, business.applicant_department),
    applicationDate: date,
    batchKeyword: batchSearchKeyword || fallbackBatchKeyword,
    batchSearchKeyword,
    batchSearchQueries: unique([batchSearchKeyword, ...batchSearchTerms, fallbackBatchKeyword]).slice(0, 12),
    batchMatchKeywords: unique([
      projectName,
      business.project_name,
      ...batchSearchTerms,
      config.projectCode,
      business.project_code,
      config.operationBatchCode,
      config.operationBatch?.code,
      fallbackBatchKeyword,
    ]),
    reason: first(
      env.SCORE_STAMP_REASON,
      "成绩盖章",
    ),
    stampTypes: csv(env.SCORE_STAMP_TYPES, ["电子章"]),
    materialTypes: csv(env.SCORE_STAMP_MATERIAL_TYPES, ["正式发布的考试成绩单、成绩册"]),
    specialDeclarations: csv(env.SCORE_STAMP_SPECIAL_DECLARATIONS, ["无特殊申报"]),
    sealPositions: csv(env.SCORE_STAMP_SEAL_POSITIONS, ["落款章"]),
    supplement: first(
      env.SCORE_STAMP_SUPPLEMENT,
      "",
    ),
    pdfFileName,
    archiveFileName,
    archiveFilePath: text(scoreResult.stampArchivePath),
    archivePassword,
    pdfFilePath: text(scoreResult.pdfFilePath),
    taskId: text(task.taskId),
  };
}

export function buildScoreStampApplicationFillScript(payload = {}) {
  return `(async () => {
  const filled = [];
  const warnings = [];
  try {
  const payload = ${JSON.stringify(payload)};
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const clean = (value) => String(value ?? "").replace(/\\u00a0/g, " ").replace(/[\\t\\r\\n ]+/g, " ").replace(/[：:]$/, "").trim();
  const isVisible = (element) => Boolean(element && element.getClientRects && element.getClientRects().length);
  const dispatch = (element) => {
    for (const eventName of ["input", "change", "blur"]) {
      element.dispatchEvent(new Event(eventName, { bubbles: true }));
    }
  };
  const valueSetter = (element, value) => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
  };
  const rows = () => Array.from(document.querySelectorAll("tr")).filter(isVisible);
  const rowText = (row) => clean(row.innerText || row.textContent);
  const findRow = (labels) => rows().find((row) => labels.some((label) => rowText(row).includes(label)));
  const labelCellIndex = (row, labels) => {
    const cells = Array.from(row?.children || []);
    return cells.findIndex((cell) => labels.some((label) => clean(cell.innerText || cell.textContent).includes(label)));
  };
  const valueContainers = (labels) => {
    const row = findRow(labels);
    if (!row) return [];
    const cells = Array.from(row.children || []);
    const index = labelCellIndex(row, labels);
    return index >= 0 ? cells.slice(index + 1) : cells;
  };
  const setControlValue = (control, value) => {
    if (!control || control.disabled || control.readOnly) return false;
    control.focus?.();
    valueSetter(control, value);
    dispatch(control);
    return true;
  };
  const setText = (labels, value, name) => {
    const normalized = clean(value);
    if (!normalized) return true;
    const control = valueContainers(labels)
      .flatMap((container) => Array.from(container.querySelectorAll("textarea,input:not([type=hidden]),[contenteditable=true]")))
      .find((element) => isVisible(element) && !["checkbox", "radio", "file"].includes(String(element.type || "").toLowerCase()));
    if (!control) {
      warnings.push(\`\${name}未找到可填写控件\`);
      return false;
    }
    if (control.isContentEditable) {
      control.focus?.();
      control.textContent = normalized;
      dispatch(control);
    } else if (!setControlValue(control, normalized)) {
      warnings.push(\`\${name}不可编辑\`);
      return false;
    }
    filled.push(name);
    return true;
  };
  const checkOptions = (labels, options, name) => {
    const targets = (Array.isArray(options) ? options : []).map(clean).filter(Boolean);
    if (!targets.length) return true;
    const containers = valueContainers(labels);
    if (!containers.length) {
      warnings.push(\`\${name}未找到选项区域\`);
      return false;
    }
    let matched = 0;
    for (const target of targets) {
      const label = containers.flatMap((container) => Array.from(container.querySelectorAll("label"))).find((item) => clean(item.innerText || item.textContent).includes(target));
      const input = label?.querySelector("input[type=checkbox],input[type=radio]") ||
        containers.flatMap((container) => Array.from(container.querySelectorAll("input[type=checkbox],input[type=radio]"))).find((item) => clean(item.parentElement?.innerText || item.value).includes(target));
      if (!input) {
        warnings.push(\`\${name}未找到选项：\${target}\`);
        continue;
      }
      if (!input.checked) input.click();
      dispatch(input);
      matched += 1;
    }
    if (matched) filled.push(name);
    return matched === targets.length;
  };
  const clickElement = (element) => {
    if (!element) return false;
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    element.click();
    return true;
  };
  const visibleModal = () => Array.from(document.querySelectorAll(".ant-modal")).reverse().find(isVisible);
  const batchKeywords = () => [...new Set([
    payload.batchSearchKeyword,
    ...(Array.isArray(payload.batchMatchKeywords) ? payload.batchMatchKeywords : []),
    payload.batchKeyword,
  ].map(clean).filter(Boolean))];
  const batchSearchQueries = (keywords) => [...new Set([
    ...(Array.isArray(payload.batchSearchQueries) ? payload.batchSearchQueries : []),
    payload.batchSearchKeyword,
    ...keywords,
  ].map(clean).filter(Boolean))];
  const selectedBatchText = (root) => clean(Array.from(root.querySelectorAll(".ant-select-selection__choice__content,a[title]"))
    .map((element) => element.getAttribute("title") || element.innerText || element.textContent)
    .filter(Boolean)
    .join(" ") || root.innerText || root.textContent);
  const batchMatches = (value, keywords) => {
    const normalized = clean(value);
    return Boolean(normalized) && keywords.some((keyword) => normalized.includes(keyword) || keyword.includes(normalized));
  };
  const rowMatchScore = (row, keywords) => {
    const cells = Array.from(row.querySelectorAll("td")).map((cell) => clean(cell.getAttribute("stsdata") || cell.innerText || cell.textContent));
    const rowText = clean(cells.join(" ") || row.innerText || row.textContent);
    let score = 0;
    keywords.forEach((keyword, index) => {
      if (!keyword) return;
      const rank = Math.max(1, 20 - index);
      if (cells[0]?.includes(keyword)) score = Math.max(score, 100 + rank);
      if (cells[2]?.includes(keyword)) score = Math.max(score, 80 + rank);
      if (cells[3] === keyword) score = Math.max(score, 70 + rank);
      if (rowText.includes(keyword)) score = Math.max(score, 40 + rank);
    });
    return score;
  };
  const selectBatchByExamName = async () => {
    const keywords = batchKeywords();
    if (!keywords.length) return true;
    const queries = batchSearchQueries(keywords);
    const root = document.querySelector('[data-fieldmark="field499948"], .field499948_swapDiv') ||
      findRow(["选择批次"])?.querySelector("td:nth-child(2)");
    if (!root) {
      warnings.push("选择批次未找到控件");
      return false;
    }
    const hiddenInput = root.querySelector('input[type="hidden"][name], input[type="hidden"]');
    if (hiddenInput?.value && batchMatches(selectedBatchText(root), keywords)) {
      filled.push("选择批次");
      return true;
    }
    if (hiddenInput?.value && !batchMatches(selectedBatchText(root), keywords)) {
      clickElement(root.querySelector(".ant-select-selection__choice__remove"));
      await sleep(300);
    }
    const button = root.querySelector("button.ant-btn-icon-only") ||
      root.closest("td")?.querySelector("button.ant-btn-icon-only") ||
      findRow(["选择批次"])?.querySelector("button.ant-btn-icon-only");
    if (!button) {
      warnings.push("选择批次未找到搜索按钮");
      return false;
    }
    clickElement(button);
    let modal = null;
    for (let i = 0; i < 30; i += 1) {
      await sleep(300);
      modal = visibleModal();
      if (modal && /批次/.test(clean(modal.innerText || modal.textContent))) break;
    }
    if (!modal) {
      warnings.push("选择批次搜索弹窗未打开");
      return false;
    }
    const searchInput = Array.from(modal.querySelectorAll('.wea-input-focus input.ant-input[type="text"], input.ant-input[type="text"]')).find(isVisible);
    if (!searchInput) {
      warnings.push("选择批次搜索框未找到");
      return false;
    }
    const searchButton = Array.from(modal.querySelectorAll("button.wea-input-focus-btn, button"))
      .find((item) => isVisible(item) && (item.className || "").includes("wea-input-focus-btn")) ||
      searchInput.closest(".wea-input-focus")?.querySelector("button") ||
      Array.from(modal.querySelectorAll("button")).find((item) => isVisible(item) && item.querySelector(".anticon-search"));

    let bestRow = null;
    let bestScore = 0;
    let searchedQuery = "";
    for (const query of queries) {
      searchedQuery = query;
      setControlValue(searchInput, query);
      if (searchButton) clickElement(searchButton);
      else searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      bestRow = null;
      bestScore = 0;
      for (let i = 0; i < 18; i += 1) {
        await sleep(500);
        const rows = Array.from(modal.querySelectorAll(".ant-table-row, tbody tr"))
          .filter(isVisible)
          .filter((row) => Array.from(row.querySelectorAll("td")).length);
        for (const row of rows) {
          const score = rowMatchScore(row, keywords);
          if (score > bestScore) {
            bestScore = score;
            bestRow = row;
          }
        }
        if (bestRow && bestScore >= 100) break;
      }
      if (bestRow && bestScore >= 100) break;
    }
    if (!bestRow || bestScore <= 0) {
      warnings.push("选择批次未按考试名称或缩写找到匹配结果：" + (searchedQuery || keywords[0]));
      return false;
    }
    clickElement(bestRow);
    for (let i = 0; i < 30; i += 1) {
      await sleep(500);
      if (hiddenInput?.value && batchMatches(selectedBatchText(root), keywords)) {
        filled.push("选择批次");
        return true;
      }
      if (!visibleModal() && hiddenInput?.value) {
        filled.push("选择批次");
        return true;
      }
    }
    if (hiddenInput?.value) {
      filled.push("选择批次");
      return true;
    }
    warnings.push("选择批次匹配结果已点击，但 OA 未回填批次");
    return false;
  };
  const waitUntilReady = async () => {
    for (let i = 0; i < 60; i += 1) {
      const body = clean(document.body?.innerText || "");
      const requiredNodesReady = [
        '[data-fieldmark="field499948"], .field499948_swapDiv',
        '#field500446, [data-fieldmark="field500446"], .field500446_swapDiv',
        '[data-fieldmark="field500447"], .field500447_swapDiv',
        '[data-fieldmark="field500451"], .field500451_swapDiv',
        '[data-fieldmark="field500449"], .field500449_swapDiv',
        '[data-fieldmark="field500452"], .field500452_swapDiv',
      ].every((selector) => document.querySelector(selector));
      const requiredTextReady = ["成绩专用章使用申请表", "选择批次", "用印事由", "印章类型", "材料类型", "特殊情况申报", "盖章位置"]
        .every((label) => body.includes(label));
      if (requiredNodesReady && requiredTextReady) return true;
      await sleep(500);
    }
    return false;
  };
  const waitUntilAttachmentReady = async () => {
    for (let i = 0; i < 40; i += 1) {
      if (document.querySelector('[data-fieldmark="field500455"], .field500455_swapDiv, #field500455')) return true;
      await sleep(500);
    }
    warnings.push("电子章附件上传控件未在选中电子章后出现");
    return false;
  };
  const ready = await waitUntilReady();
  if (!ready) {
    return JSON.stringify({ ok: false, filled, warnings: ["OA 申请页面未在预期时间内加载完成"], url: location.href });
  }
  const batchSelected = await selectBatchByExamName();
  const reasonFilled = setText(["用印事由"], payload.reason, "用印事由");
  const stampTypesChecked = checkOptions(["印章类型"], payload.stampTypes, "印章类型");
  const attachmentReady = await waitUntilAttachmentReady();
  const requiredResults = [
    batchSelected,
    reasonFilled,
    stampTypesChecked,
    checkOptions(["材料类型"], payload.materialTypes, "材料类型"),
    checkOptions(["特殊情况申报"], payload.specialDeclarations, "特殊情况申报"),
    checkOptions(["盖章位置"], payload.sealPositions, "盖章位置"),
    attachmentReady,
  ];
  setText(["补充盖章要求"], payload.supplement, "补充盖章要求");
  if (payload.archiveFileName) warnings.push(\`将自动上传加密压缩包附件：\${payload.archiveFileName}，解压密码：\${payload.archivePassword || "1234"}\`);
  else if (payload.pdfFileName) warnings.push(\`请先将成绩单 PDF 加密压缩后上传附件：\${payload.pdfFileName}\`);
  let notice = document.querySelector("#codexScoreStampNotice");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "codexScoreStampNotice";
    notice.style.cssText = "position:fixed;z-index:2147483647;right:24px;bottom:24px;max-width:420px;padding:12px 14px;border-radius:8px;background:#0f766e;color:#fff;font-size:13px;line-height:1.5;box-shadow:0 12px 30px rgba(15,23,42,.22);";
    document.body.appendChild(notice);
  }
  notice.textContent = \`已自动填写成绩盖章申请，正在准备上传加密压缩包附件；请核对后再提交。\`;
  return JSON.stringify({ ok: requiredResults.every(Boolean), filled, warnings, url: location.href });
  } catch (error) {
    warnings.push(error?.message || String(error || "未知错误"));
    return JSON.stringify({ ok: false, filled, warnings, url: location.href, errorMessage: error?.stack || error?.message || String(error || "") });
  }
})()`;
}

export function buildScoreStampAttachmentPrepareScript() {
  return `new Promise(async (resolve) => {
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const clean = (value) => String(value ?? "").replace(/\\u00a0/g, " ").replace(/[\\t\\r\\n ]+/g, " ").trim();
  const visible = (element) => Boolean(element && element.getClientRects && element.getClientRects().length);
  const tagInput = () => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((input) => !input.disabled);
    const visibleInput = inputs.find(visible) || inputs[0];
    if (!visibleInput) return { inputCount: 0, tagged: false };
    inputs.forEach((input) => input.removeAttribute("data-codex-score-stamp-upload"));
    visibleInput.setAttribute("data-codex-score-stamp-upload", "1");
    return { inputCount: inputs.length, tagged: true };
  };
  let result = tagInput();
  let clicked = "";
  if (!result.tagged) {
    const candidates = Array.from(document.querySelectorAll("button,a,input,span,div"))
      .filter(visible)
      .filter((element) => /附件|上传|选择文件|添加文件|文件上传/.test(clean(element.innerText || element.value || element.title || element.getAttribute("aria-label"))));
    const target = candidates.find((element) => /附件|上传|选择文件|添加文件|文件上传/.test(clean(element.innerText || element.value || element.title || element.getAttribute("aria-label"))));
    if (target) {
      clicked = clean(target.innerText || target.value || target.title || target.getAttribute("aria-label"));
      (target.closest("button,a") || target).click();
      await sleep(1200);
      result = tagInput();
    }
  }
  resolve(JSON.stringify({
    ok: result.tagged,
    inputCount: result.inputCount,
    clicked,
    selector: 'input[type="file"][data-codex-score-stamp-upload="1"]',
  }));
})`;
}

export function buildScoreStampApplicationSaveScript() {
  return `(async () => {
  const warnings = [];
  try {
    const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
    const clean = (value) => String(value ?? "").replace(/\\u00a0/g, " ").replace(/[\\t\\r\\n ]+/g, " ").trim();
    const visible = (element) => Boolean(element && element.getClientRects && element.getClientRects().length);
    const clickElement = (element) => {
      if (!element) return false;
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      element.click();
      return true;
    };
    const controls = Array.from(document.querySelectorAll("button,a,input[type=button],input[type=submit],span,div"))
      .filter(visible)
      .map((element) => {
        const text = clean(element.innerText || element.value || element.title || element.getAttribute("aria-label"));
        const clickable = element.closest("button,a") || element;
        return { element, clickable, text };
      })
      .filter(({ clickable, text }) => text === "保存" && !clickable.disabled && clickable.getAttribute("aria-disabled") !== "true");
    const target = controls.find(({ clickable }) => clickable.tagName === "BUTTON") || controls[0];
    if (!target) {
      return JSON.stringify({ ok: false, saved: false, warnings: ["未找到可点击的保存按钮"], url: location.href });
    }
    clickElement(target.clickable);
    await sleep(1800);
    const notice = document.querySelector("#codexScoreStampNotice");
    if (notice) notice.textContent = "已自动填写成绩盖章申请，并已上传加密压缩包附件和点击保存；请核对后再提交。";
    return JSON.stringify({
      ok: true,
      saved: true,
      buttonText: target.text,
      warnings,
      url: location.href,
    });
  } catch (error) {
    warnings.push(error?.message || String(error || "未知错误"));
    return JSON.stringify({ ok: false, saved: false, warnings, url: location.href, errorMessage: error?.stack || error?.message || String(error || "") });
  }
})()`;
}
