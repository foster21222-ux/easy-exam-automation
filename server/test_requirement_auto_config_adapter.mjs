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
    paper_names: ["第一场综合能力卷", "第一场专业知识卷"],
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
    { name: "综合能力", code: "20260705-01-01", form_codes: ["20260705-01-01"], paper_name: "第一场综合能力卷" },
    { name: "专业知识", code: "20260705-01-02", form_codes: ["20260705-01-02"], paper_name: "第一场专业知识卷" },
  ]);
  assert.equal(result.config.confirmOnly, true);
});

test("warns when per-requirement paper names do not align with subjects", () => {
  const result = buildAutoConfigFromRequirement({
    exam_name: "多科目考试",
    formal_exam_time_range: "2026-07-05 09:30 到 2026-07-05 11:30",
    subjects_text: "综合能力、专业知识",
    paper_names_text: "仅一张试卷",
  });

  assert.equal(result.config.courses[0].paper_name, "仅一张试卷");
  assert.equal(result.config.courses[1].paper_name, undefined);
  assert.ok(result.warnings.includes("试卷名称数量与科目数量不一致，请按科目顺序逐项填写。"));
});

test("treats blank rich waiting prompt and pledge HTML as cleared fields", () => {
  const result = buildAutoConfigFromRequirement({
    exam_name: "空富文本测试",
    formal_exam_time_range: "2026-07-05 09:30 到 2026-07-05 11:30",
    subjects: "综合能力",
    pre_login_prompt: "<p><br></p>",
    pledge_content: "<div>&nbsp;</div>",
  });

  assert.equal(result.config.preLoginPrompt, "");
  assert.equal(result.config.pledgeContent, "");
});

test("accepts short and Chinese time range formats", () => {
  const year = new Date().getFullYear();
  const result = buildAutoConfigFromRequirement({
    exam_name: "短时间格式测试",
    formal_exam_time_range: "7-21 15 ：00-16:30",
    mock_exam_time_range: "7-21 15 点-16 点半",
    subjects: "综合能力",
  });

  assert.equal(result.config.startTimeDisplay, `${year}/07/21 15:00`);
  assert.equal(result.config.endTimeDisplay, `${year}/07/21 16:30`);
  assert.equal(result.config.mockStartTimeDisplay, `${year}/07/21 15:00`);
  assert.equal(result.config.mockEndTimeDisplay, `${year}/07/21 16:30`);
  assert.equal(result.warnings.includes("正式考试时间无法解析。"), false);
  assert.equal(result.warnings.includes("试考时间无法解析，试考自动创建会跳过。"), false);
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
