import { DEFAULT_TRIAL_COURSE_CODE } from "./trial_default_paper.mjs";

function normalizeCourseRecords(courses = []) {
  return (Array.isArray(courses) ? courses : [])
    .map((course) => ({
      name: String(course?.name || course?.course_name || "").trim(),
      code: String(course?.code || course?.course_code || "").trim(),
    }))
    .filter((course) => course.name && course.code);
}

function resolveSessionType(task, sessionId = "") {
  const expected = String(sessionId || "").trim();
  if (!expected) return "";
  const session = (Array.isArray(task?.sessions) ? task.sessions : []).find(
    (item) => String(item?.session_id || item?.id || "").trim() === expected,
  );
  return String(session?.sessionType || session?.session_type || "").trim();
}

export function prepareCandidatesForCourseImport(candidates = [], task = null, options = {}) {
  const courses = normalizeCourseRecords(task?.config?.courses || []);
  if (!courses.length) return { candidates, errors: [] };

  const validCodes = new Set(courses.map((course) => course.code));
  const nextCandidates = candidates.map((candidate) => ({ ...candidate }));
  const errors = [];
  const sessionType = options.sessionType || resolveSessionType(task, options.sessionId);
  const isTrialSession = sessionType === "trial";
  if (isTrialSession) validCodes.add(DEFAULT_TRIAL_COURSE_CODE);

  if (courses.length === 1) {
    for (const candidate of nextCandidates) {
      if (!String(candidate.course_code || "").trim()) candidate.course_code = courses[0].code;
    }
  }

  nextCandidates.forEach((candidate, index) => {
    const courseCode = String(candidate.course_code || "").trim();
    const rowLabel = candidate.__row ? `第 ${candidate.__row} 行` : `第 ${index + 1} 条`;
    if (!courseCode) {
      if (isTrialSession) return;
      errors.push(`${rowLabel} 缺少科目编号；当前场次包含多个科目，请在名单中填写 科目编号。`);
      return;
    }
    if (!validCodes.has(courseCode)) {
      errors.push(`${rowLabel} 科目编号 ${courseCode} 不属于当前考试任务。`);
    }
  });

  return { candidates: nextCandidates, errors };
}
