function formatTimerMinutes(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  return (seconds / 60).toFixed(1);
}

function sectionTimeLabel(section = {}) {
  const timer = section?.timer || {};
  const min = formatTimerMinutes(timer.time_min_limit ?? timer.timeMinLimit);
  const max = formatTimerMinutes(timer.time_limit ?? timer.timeLimit);
  if (min && max) return `${min}-${max}分钟`;
  if (max) return `${max}分钟`;
  return "";
}

function extractFormPayload(payload = {}) {
  return payload?.form ||
    payload?.content ||
    payload?.data?.form ||
    payload?.data?.content ||
    payload?.result?.form ||
    payload?.result?.content ||
    {};
}

function normalizePaperUnitInfo(payload = {}) {
  const form = extractFormPayload(payload);
  const sections = Array.isArray(form?.sections) ? form.sections : [];
  return {
    unit_count: sections.length,
    unit_label: `${sections.length}个单元`,
    sections: sections.map((section) => ({
      name: String(section?.name || "").trim(),
      time_label: sectionTimeLabel(section),
    })),
  };
}

async function fetchPaperUnitInfo({ login, apiBase, formCode, requestJson }) {
  const code = String(formCode || "").trim();
  if (!code) throw new Error("缺少试卷 code，无法查询单元信息");
  const path = `/tenant/api/form/${encodeURIComponent(code)}/get/`;
  const payload = await requestJson(login, `${apiBase}${path}`, { method: "GET" }, `读取试卷单元 ${code}`);
  return normalizePaperUnitInfo(payload);
}

export {
  fetchPaperUnitInfo,
  normalizePaperUnitInfo,
};
