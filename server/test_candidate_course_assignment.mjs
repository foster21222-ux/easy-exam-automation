import assert from "node:assert/strict";
import test from "node:test";

import { prepareCandidatesForCourseImport } from "./candidate_course_assignment.mjs";

test("requires course_code when task has multiple courses", () => {
  const result = prepareCandidatesForCourseImport(
    [{ permit: "P001", full_name: "张三", identity_id: "ID001" }],
    { config: { courses: [{ name: "语文", code: "C-01" }, { name: "数学", code: "C-02" }] } },
  );

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /缺少科目编号/);
});

test("does not require course_code for trial session even when task has multiple formal courses", () => {
  const result = prepareCandidatesForCourseImport(
    [{ permit: "P001", full_name: "张三", identity_id: "ID001" }],
    {
      config: { courses: [{ name: "语文", code: "C-01" }, { name: "数学", code: "C-02" }] },
      sessions: [{ session_id: "T1", sessionType: "trial" }],
    },
    { sessionId: "T1" },
  );

  assert.deepEqual(result.errors, []);
  assert.equal(result.candidates[0].course_code, undefined);
});

test("allows default SKTY course_code for trial session", () => {
  const result = prepareCandidatesForCourseImport(
    [{ permit: "P001", full_name: "张三", identity_id: "ID001", course_code: "SKTY" }],
    {
      config: { courses: [{ name: "语文", code: "C-01" }, { name: "数学", code: "C-02" }] },
      sessions: [{ session_id: "T1", sessionType: "trial" }],
    },
    { sessionId: "T1" },
  );

  assert.deepEqual(result.errors, []);
  assert.equal(result.candidates[0].course_code, "SKTY");
});

test("fills course_code when task has a single course", () => {
  const result = prepareCandidatesForCourseImport(
    [{ permit: "P001", full_name: "张三", identity_id: "ID001" }],
    { config: { courses: [{ name: "语文", code: "C-01" }] } },
  );

  assert.deepEqual(result.errors, []);
  assert.equal(result.candidates[0].course_code, "C-01");
});

test("rejects course_code outside the task courses", () => {
  const result = prepareCandidatesForCourseImport(
    [{ permit: "P001", full_name: "张三", identity_id: "ID001", course_code: "OTHER" }],
    { config: { courses: [{ name: "语文", code: "C-01" }] } },
  );

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /不属于当前考试任务/);
});
