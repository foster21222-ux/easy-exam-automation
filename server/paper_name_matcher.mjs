function text(value) {
  return String(value || "").trim();
}

function compactName(value) {
  return text(value)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[，、；;:：|｜-]/g, "");
}

function stripLeadingPaperPrefix(value) {
  return text(value)
    .replace(/^\d{8}[-_]\d{1,2}[-_]\d{1,2}[_\- ]*/, "")
    .replace(/^\d{8}[_\-]\d{1,2}[A-Za-z0-9]*[^一-龥A-Za-z0-9]*/, "")
    .replace(/^\d{8}[_\-]\d{1,2}[A-Za-z0-9]*/, "")
    .replace(/^\d{1,2}[A-Za-z0-9]*[^一-龥A-Za-z0-9]*/, "")
    .trim();
}

function paperNameMatches(expected, actual) {
  const expectedName = compactName(expected);
  const actualName = compactName(actual);
  if (!expectedName || !actualName) return false;
  if (expectedName === actualName) return true;

  const expectedBody = compactName(stripLeadingPaperPrefix(expected));
  const actualBody = compactName(stripLeadingPaperPrefix(actual));
  if (expectedBody && actualBody && expectedBody === actualBody) return true;
  if (expectedBody && actualName.includes(expectedBody)) return true;
  if (actualBody && expectedName.includes(actualBody)) return true;
  if (expectedName.length >= 6 && actualName.includes(expectedName)) return true;
  if (actualName.length >= 6 && expectedName.includes(actualName)) return true;
  return false;
}

function paperCourseCode(paper) {
  return text(paper?.course_code || paper?.courseCode || paper?.course || paper?.subject_code || paper?.subjectCode);
}

function paperCode(paper) {
  return text(paper?.code || paper?.form_code || paper?.formCode || paper?.id);
}

function paperName(paper) {
  return text(paper?.name || paper?.paper_name || paper?.paperName || paper?.title);
}

function normalizePaperCandidate(paper) {
  return {
    ...paper,
    code: paperCode(paper),
    name: paperName(paper),
    course_code: paperCourseCode(paper),
  };
}

function matchPaperForCourse(course, papers) {
  const courseCode = text(course?.code || course?.course_code);
  const expectedPaperName = text(course?.paper_name || course?.paperName || course?.form_name || course?.formName);
  const candidates = (Array.isArray(papers) ? papers : [])
    .map(normalizePaperCandidate)
    .filter((paper) => paper.code && (!paper.course_code || paper.course_code === courseCode));

  if (!expectedPaperName) {
    return candidates.length === 1
      ? { status: "matched", formCode: candidates[0].code, paper: candidates[0], candidates }
      : { status: candidates.length ? "ambiguous" : "missing", candidates };
  }

  const matches = candidates.filter((paper) => paperNameMatches(expectedPaperName, paper.name));
  if (matches.length === 1) return { status: "matched", formCode: matches[0].code, paper: matches[0], candidates: matches };
  if (matches.length > 1) return { status: "ambiguous", candidates: matches };
  return { status: "missing", candidates };
}

function matchPapersForCourses(courses, papers) {
  return (Array.isArray(courses) ? courses : []).map((course) => ({
    course,
    ...matchPaperForCourse(course, papers),
  }));
}

export {
  compactName,
  matchPaperForCourse,
  matchPapersForCourses,
  paperNameMatches,
  stripLeadingPaperPrefix,
};
