import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("./easy_exam_server.mjs", import.meta.url), "utf8");
const normalizationSource = serverSource.slice(
  serverSource.indexOf("function normalizeScoreFieldName"),
  serverSource.indexOf("function scoreRowKey"),
);
const loadNormalizer = new Function(`${normalizationSource}\nreturn { normalizeScoreRow, attachCourseNamesToCandidates, scoreCourseFallback };`);
const { normalizeScoreRow, attachCourseNamesToCandidates, scoreCourseFallback } = loadNormalizer();

test("reads phone and email from required custom-field labels", () => {
  const row = normalizeScoreRow({
    permit: "13208164907",
    custom_fields: {
      "手机号（必填）": "13208164907",
      "邮箱（必填）": "candidate@example.com",
    },
  });

  assert.equal(row.mobile, "13208164907");
  assert.equal(row.email, "candidate@example.com");
});

test("reads phone and email from array-based EasyExam information items", () => {
  const row = normalizeScoreRow({
    permit: "13208164907",
    personal_fields: [
      { name: "手机号码", value: "13208164907" },
      { name: "邮箱", value: "candidate@example.com" },
    ],
  });

  assert.equal(row.mobile, "13208164907");
  assert.equal(row.email, "candidate@example.com");
});

test("normalizes EasyExam valid status to not-started for absence handling", () => {
  const row = normalizeScoreRow({ permit: "13208164907", status: "valid", score: "" });

  assert.equal(row.exam_status, "未开考");
});

test("maps each local candidate course code to the final course name", () => {
  const candidates = attachCourseNamesToCandidates(
    [
      { permit: "P001", course_code: "20260625-05-01" },
      { permit: "P002", course_code: "20260625-05-03" },
    ],
    [
      { code: "20260625-05-01", name: "项目管理类" },
      { code: "20260625-05-03", name: "工程技术类" },
    ],
  );

  assert.equal(candidates[0].course_name, "项目管理类");
  assert.equal(candidates[1].course_name, "工程技术类");
});

test("uses the configured course for a single-course score export", () => {
  assert.equal(
    scoreCourseFallback([{ code: "C001", name: "社会招聘" }], "社会招聘笔试"),
    "社会招聘",
  );
});

test("uses the exam name when a single-course requirement has no course name", () => {
  assert.equal(scoreCourseFallback([{ code: "C001", name: "" }], "社会招聘笔试"), "社会招聘笔试");
});

test("does not use one configured course as the fallback for a multi-course score export", () => {
  assert.equal(
    scoreCourseFallback(
      [
        { code: "C001", name: "项目管理类" },
        { code: "C002", name: "工程技术类" },
      ],
      "综合招聘笔试",
    ),
    "综合招聘笔试",
  );
});
