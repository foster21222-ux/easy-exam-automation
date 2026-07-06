import assert from "node:assert/strict";
import test from "node:test";

import { buildAutoConfigFromRequirement } from "./requirement_auto_config_adapter.mjs";

test("converts a complete WeChat requirement into the existing auto config shape", () => {
  const result = buildAutoConfigFromRequirement({
    exam_name: "四川省通川工程技术开发有限公司校招考试",
    formal_exam_time_range: "时间：2026-07-05 09:30 到 2026-07-05 11:30",
    mock_exam_time_range: "时间：2026-07-04 10:00 到 2026-07-04 17:00",
    early_login_minutes: "30分钟",
    late_limit_minutes: "15分钟",
    video_monitor_required: "是",
    video_record_required: "是",
    hawkeye_required: "否",
    exam_client_type: "网页考试",
    leave_limit_count: 3,
    subjects: ["综合能力", "专业知识"],
  }, {
    customerName: "四川省通川工程技术开发有限公司",
  });

  assert.deepEqual(result.warnings, []);
  assert.equal(result.config.examName, "四川省通川工程技术开发有限公司校招考试");
  assert.equal(result.config.customerName, "四川省通川工程技术开发有限公司");
  assert.equal(result.config.startTimeDisplay, "2026/07/05 09:30");
  assert.equal(result.config.endTimeDisplay, "2026/07/05 11:30");
  assert.equal(result.config.startTimeIso, "2026-07-05T09:30:00.000");
  assert.equal(result.config.endTimeIso, "2026-07-05T11:30:00.000");
  assert.equal(result.config.mockExamEnabled, true);
  assert.equal(result.config.mockExamName, "四川省通川工程技术开发有限公司校招考试-试考");
  assert.equal(result.config.mockStartTimeDisplay, "2026/07/04 10:00");
  assert.equal(result.config.mockEndTimeDisplay, "2026/07/04 17:00");
  assert.equal(result.config.earlyLoginMinutes, 30);
  assert.equal(result.config.lateLimitMinutes, 15);
  assert.equal(result.config.videoMonitor, true);
  assert.equal(result.config.videoRecord, true);
  assert.equal(result.config.hawkeye, false);
  assert.equal(result.config.examType, "网页考试");
  assert.equal(result.config.webExam, true);
  assert.equal(result.config.clientExam, false);
  assert.equal(result.config.leaveLimit, 3);
  assert.deepEqual(result.config.subjects, ["综合能力", "专业知识"]);
  assert.deepEqual(result.config.courses, [
    { name: "综合能力", code: "20260705-01-01", form_codes: ["20260705-01-01"] },
    { name: "专业知识", code: "20260705-01-02", form_codes: ["20260705-01-02"] },
  ]);
  assert.equal(result.config.confirmOnly, true);
});

test("reports warnings when execution-critical fields cannot be normalized", () => {
  const result = buildAutoConfigFromRequirement({
    exam_name: "缺时间测试",
    formal_exam_time_range: "下周一上午",
    subjects: "语文，数学",
  });

  assert.equal(result.config.examName, "缺时间测试");
  assert.deepEqual(result.config.subjects, ["语文", "数学"]);
  assert.equal(result.config.startTimeDisplay, "");
  assert.equal(result.config.endTimeDisplay, "");
  assert.deepEqual(result.config.courses, []);
  assert.ok(result.warnings.includes("正式考试时间无法解析。"));
  assert.ok(result.warnings.includes("未读取到试考时间，试考自动创建会跳过。"));
  assert.ok(result.warnings.includes("科目信息缺少考试日期，无法按规则生成 code/form_codes。"));
});
