import assert from "node:assert/strict";
import test from "node:test";

import { matchPaperForCourse } from "./paper_name_matcher.mjs";

test("matches each course paper by course code and exact paper name", () => {
  const result = matchPaperForCourse(
    { name: "综合一", code: "20260718-01-01", paper_name: "20260718_01CGFT一级（综合一）会计学与财务分析基础" },
    [
      { course_code: "20260718-01-01", code: "FORM-01", name: "20260718_01CGFT一级（综合一）会计学与财务分析基础" },
      { course_code: "20260718-01-02", code: "FORM-02", name: "20260718_02CGFT一级（综合二）Python语言基础" },
    ],
  );

  assert.equal(result.status, "matched");
  assert.equal(result.formCode, "FORM-01");
});

test("matches when backend paper name keeps a subject prefix before the requested paper body", () => {
  const result = matchPaperForCourse(
    { name: "Python语言基础", code: "20260718-01-02", paper_name: "Python语言基础+大数据技术" },
    [
      { course_code: "20260718-01-02", code: "FORM-02", name: "20260718_02CGFT一级（综合二）Python语言基础+大数据技术" },
    ],
  );

  assert.equal(result.status, "matched");
  assert.equal(result.formCode, "FORM-02");
});

test("does not match papers from another course even when paper names are similar", () => {
  const result = matchPaperForCourse(
    { name: "综合一", code: "20260718-01-01", paper_name: "Python语言基础" },
    [
      { course_code: "20260718-01-02", code: "FORM-02", name: "20260718_02CGFT一级（综合二）Python语言基础" },
    ],
  );

  assert.equal(result.status, "missing");
});

test("reports ambiguous when more than one paper matches the course and name", () => {
  const result = matchPaperForCourse(
    { name: "综合一", code: "20260718-01-01", paper_name: "会计学与财务分析基础" },
    [
      { course_code: "20260718-01-01", code: "FORM-A", name: "20260718_01CGFT一级（综合一）会计学与财务分析基础" },
      { course_code: "20260718-01-01", code: "FORM-B", name: "20260718_01CGFT一级（综合一）会计学与财务分析基础备用卷" },
    ],
  );

  assert.equal(result.status, "ambiguous");
  assert.deepEqual(result.candidates.map((candidate) => candidate.code), ["FORM-A", "FORM-B"]);
});
