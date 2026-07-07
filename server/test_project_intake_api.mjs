import assert from "node:assert/strict";
import test from "node:test";

import {
  businessDraftToCustomer,
  businessDraftToRequirement,
  businessTemplateMarkRegions,
  parseBusinessRequirementOcr,
  parseBusinessRequirementTemplateRegions,
  templateFrameFromTableBounds,
  templateRectToImageRect,
} from "./project_intake.mjs";

test("project intake parses core fields from business requirement OCR text", () => {
  const draft = parseBusinessRequirementOcr(`
项目需求任务单-在线机考
申请人 胡颖 申请人部门 业务二部
申请日期 2026-07-03 运控流水号 R0042212
项目名称 北京农商银行公文大赛 项目编码 F0020592
预估科次 200.00 预计收入 10000.00
结算依据 ◉ 按报名科次结算 ○ 按参考科次结算 ○ 按开考科次结算
是否需要ATA安排集中监考场地 ◉ 不需要 ○ 需要
试题类型 ☑ 客观题 ☑ 主观题 ☐ 操作题 ☐ 听力题
科目数 1 试卷数 1
1 2026-08-22 上午
`);

  assert.equal(draft.applicant, "胡颖");
  assert.equal(draft.applicant_department, "业务二部");
  assert.equal(draft.operation_serial_number, "R0042212");
  assert.equal(draft.project_name, "北京农商银行公文大赛");
  assert.equal(draft.project_code, "F0020592");
  assert.equal(draft.estimated_subject_count, "200.00");
  assert.equal(draft.billing_basis, "按报名科次结算");
  assert.equal(draft.ata_central_venue_required, "不需要");
  assert.equal(draft.question_types, "客观题、主观题");
  assert.equal(draft.subject_count, "1");
  assert.equal(draft.paper_count, "1");
  assert.deepEqual(draft.exam_schedule, [{ exam_date: "2026-08-22", exam_time: "上午", note: "" }]);
});

test("project intake converts confirmed draft to requirement and customer payloads", () => {
  const draft = {
    applicant: "胡颖",
    applicant_department: "业务二部",
    customer_name: "北京农商银行",
    project_name: "北京农商银行公文大赛",
    project_code: "F0020592",
    question_types: "客观题、主观题",
  };

  const requirement = businessDraftToRequirement(draft);
  const customer = businessDraftToCustomer(draft);

  assert.equal(requirement.exam_name, "北京农商银行公文大赛");
  assert.equal(requirement.project_code, "F0020592");
  assert.equal(requirement.question_types, "客观题、主观题");
  assert.deepEqual(customer, {
    name: "北京农商银行",
    applicant: "胡颖",
    applicantDepartment: "业务二部",
  });
});

test("project intake maps bottom exam schedule into formal exam time", () => {
  const requirement = businessDraftToRequirement({
    project_name: "北京外企人力某单位校园招聘项目",
    exam_schedule: [{ exam_date: "2026-07-02", exam_time: "全天", note: "这两天会开展测评，测完统一出报告" }],
  });

  assert.equal(requirement.formal_exam_time_range, "2026-07-02 全天");
  assert.deepEqual(requirement.exam_schedule, [{ exam_date: "2026-07-02", exam_time: "全天", note: "这两天会开展测评，测完统一出报告" }]);
});

test("project intake parses bottom schedule table when OCR splits date time and note into separate lines", () => {
  const draft = parseBusinessRequirementTemplateRegions({
    project_name: "中国人民大学附属中学在线考试项目",
  }, `
考试日期
考试时间
场次安排说明
序号
1
2026-07-14
上午
早培项目初筛活动
附件
`);

  assert.deepEqual(draft.exam_schedule, [{ exam_date: "2026-07-14", exam_time: "上午", note: "早培项目初筛活动" }]);
  const requirement = businessDraftToRequirement(draft);
  assert.equal(requirement.formal_exam_time_range, "2026-07-14 上午");
});

test("project intake repairs requirement3-style fallback name and all-day OCR confusion", () => {
  const draft = parseBusinessRequirementTemplateRegions({
    project_name: "北京外企人力某单位校园招聘项目",
  }, `
标题
申请人
申请日期
项目名称
客户名称（仅供参考）
2026-06-30
北京外企人力某单位校园招聘项目
考试日期
考试时间
场次安排说明
2026-07-02
全大
这两天会开展测评，测完统一出报告
附件
`);

  assert.equal(draft.exam_name, "北京外企人力某单位校园招聘项目");
  assert.deepEqual(draft.exam_schedule, [{
    exam_date: "2026-07-02",
    exam_time: "全天",
    note: "这两天会开展测评，测完统一出报告",
  }]);
  const requirement = businessDraftToRequirement(draft);
  assert.equal(requirement.formal_exam_time_range, "2026-07-02 全天");
});

test("project intake repairs common out-of-order OCR from table screenshots", () => {
  const draft = parseBusinessRequirementOcr(`
标题
申请人
申请日期
项目名称
申请人部门
运控流水号
项目编码
预估科次
结算依据
是否需要ATA安排集中监考场地
试题类型
科目数
项目需求任务单-在线机考
项目需求任务单-在线机考-胡颖
胡颖
2026-07-03
北京农商银行公文大赛
业务二部
R0042212
F0020592
200.00
预估收入
10000.00
◎ 按报名科次结算 • 按参考科次结算 • 按开考科次结算
是台禽麦ATA安邦集中监考 ◎不需要◎需要
v 客观题 主观题 操作题口 听力题口 口语题口 打字题口 其它题型
1
试卷数
1
2026-08-22
上午
`);

  assert.equal(draft.applicant, "胡颖");
  assert.equal(draft.applicant_department, "业务二部");
  assert.equal(draft.project_name, "北京农商银行公文大赛");
  assert.equal(draft.operation_serial_number, "R0042212");
  assert.equal(draft.project_code, "F0020592");
  assert.equal(draft.estimated_subject_count, "200.00");
  assert.equal(draft.expected_revenue, "10000.00");
  assert.equal(draft.billing_basis, "按报名科次结算");
  assert.equal(draft.ata_central_venue_required, "不需要");
  assert.equal(draft.question_types, "客观题、主观题");
});

test("project intake prefers fixed template regions over whole-page OCR order", () => {
  const draft = parseBusinessRequirementTemplateRegions({
    applicant: "胡颖",
    applicant_department: "业务二部",
    application_date: "2026-07-03",
    operation_serial_number: "R0042212",
    project_name: "北京农商银行公文大赛",
    project_code: "F0020592",
    estimated_subject_count: "200.00",
    expected_revenue: "10000.00",
    customer_project_attribute: "○ 新客户新项目 ○ 老客户新项目 ◎ 老客户老项目",
    business_direction: "○ 政府 ◎ 企业 ○ 院校 ○ 人社",
    system_type: "◎ 易考 ○ 易面 ○ 远鉴 ○ MTS ○ 待定 ○ 其它",
    billing_basis: "◎ 按报名科次结算 ○ 按参考科次结算 ○ 按开考科次结算 ○ 其他 ○ 待定",
    ata_central_venue_required: "是否需要ATA安排集中监考场地 ◎ 不需要 ○ 需要",
    question_types: "◎ 客观题 ◎ 主观题 ○ 操作题 ○ 听力题 ○ 口语题 ○ 打字题 ○ 其它题型",
    subject_count: "1",
    paper_count: "1",
  }, "申请人\n申请人部门\n项目名称\n");

  assert.equal(draft.applicant, "胡颖");
  assert.equal(draft.applicant_department, "业务二部");
  assert.equal(draft.project_name, "北京农商银行公文大赛");
  assert.equal(draft.customer_project_attribute, "老客户老项目");
  assert.equal(draft.business_direction, "企业");
  assert.equal(draft.system_type, "易考");
  assert.equal(draft.billing_basis, "按报名科次结算");
  assert.equal(draft.ata_central_venue_required, "不需要");
  assert.equal(draft.question_types, "客观题、主观题");
});

test("project intake lets calibrated mark detection override ambiguous option OCR", () => {
  const draft = parseBusinessRequirementTemplateRegions({
    ata_central_venue_required: "是否需要ATA安排集中监考场地 ◎ 不需要 ◎ 需要",
  }, "", {
    ata_central_venue_required: ["不需要"],
  });

  assert.equal(draft.ata_central_venue_required, "不需要");
});

test("project intake handles fixed option rows from the real business form", () => {
  const draft = parseBusinessRequirementTemplateRegions({
    registration_method: "凶 客户提供报名表\n口 客户提供报名表后在线缴费\n—老牛才线报名\n厂 华休在线报名 口 其它\n口 即报即考\n注意：悦考不要选即报即考",
    content_source: "口 ATA现有内容 口 ATA命制新内容 口 使用ATA历史试卷 客户自命题",
    closed_item_writing_required: "◎ 不需要•需要",
    manual_marking_required: "◎ 不需要•需要",
    epi_test_required: "◎ 不需要（\n• 需要",
    personality_test_tool: "◎ 不需要\n• OPA\n• ATA情绪特质测评",
  });

  assert.equal(draft.registration_method, "客户提供报名表");
  assert.equal(draft.content_source, "客户自命题");
  assert.equal(draft.closed_item_writing_required, "不需要");
  assert.equal(draft.manual_marking_required, "不需要");
  assert.equal(draft.epi_test_required, "不需要");
  assert.equal(draft.personality_test_tool, "不需要");
});

test("project intake does not let whole-page OCR labels fill empty fixed template fields", () => {
  const draft = parseBusinessRequirementTemplateRegions({
    registration_method: "口 客户提供报名表 口 客户提供报名表后在线缴费 口 即报即考",
    registration_website_required: "口 标准网站（仅报名） 口 标准网站（报名+缴费） 口 定制门户 口 有接口对接需求",
    online_registration_start_time: "",
    closed_item_writing_required: "",
    manual_marking_required: "",
    epi_test_required: "",
    personality_test_tool: "",
    other_notes: "",
  }, `
标题
报名方式
是否需要报名网站
在线报名开始时间
ATA内容制题参与方式
是否需要封闭制题
EPI测试
其他说明
项目需求任务单-在线机考
`);

  assert.equal(draft.registration_method, undefined);
  assert.equal(draft.registration_website_required, undefined);
  assert.equal(draft.online_registration_start_time, undefined);
  assert.equal(draft.closed_item_writing_required, undefined);
  assert.equal(draft.manual_marking_required, undefined);
  assert.equal(draft.epi_test_required, undefined);
  assert.equal(draft.personality_test_tool, undefined);
  assert.equal(draft.other_notes, undefined);
});

test("project intake uses OCR for checkbox rows and calibrated marks for radio rows", () => {
  const draft = parseBusinessRequirementTemplateRegions({
    registration_method: "v 客户提供报名表 口 客户提供报名表后在线缴费 口 即报即考",
    closed_item_writing_required: "不零要 八零要",
    manual_marking_required: "",
    epi_test_required: "◎ 不到要（）翻要",
    personality_test_tool: "◎ 不需要 （ OPA C） ATA情烤特质测评",
  }, "", {
    closed_item_writing_required: ["不需要"],
    manual_marking_required: ["不需要"],
    epi_test_required: ["不需要"],
    personality_test_tool: ["不需要"],
  });

  assert.equal(draft.registration_method, "客户提供报名表");
  assert.equal(draft.closed_item_writing_required, "不需要");
  assert.equal(draft.manual_marking_required, "不需要");
  assert.equal(draft.epi_test_required, "不需要");
  assert.equal(draft.personality_test_tool, "不需要");
});

test("project intake lets billing mark detection override misread radio OCR", () => {
  const draft = parseBusinessRequirementTemplateRegions({
    billing_basis: "• 按报名科次结算 • 按参考科次结算 • 按开考科次结算 ◎ 其他◎待定",
  }, "", {
    billing_basis: ["按报名科次结算"],
  });

  assert.equal(draft.billing_basis, "按报名科次结算");
});

test("project intake keeps explicit OCR option when weak mark metrics disagree", () => {
  const draft = parseBusinessRequirementTemplateRegions({
    registration_method: "v 客户提供报名表 口 客户提供报名表后在线缴费\n口 考生在线报名 口 集体在线报名 口 其它\n口 即报即考",
  }, "", {
    registration_method: ["集体在线报名"],
  });

  assert.equal(draft.registration_method, "客户提供报名表");
});

test("project intake only uses pixel mark detection for radio-style fields", () => {
  const markFields = new Set(businessTemplateMarkRegions().map((item) => item.field));

  assert.equal(markFields.has("registration_method"), false);
  assert.equal(markFields.has("registration_website_required"), false);
  assert.equal(markFields.has("content_source"), false);
  assert.equal(markFields.has("question_types"), false);
  assert.equal(markFields.has("ata_invigilator_arrangement"), true);
  assert.equal(markFields.has("closed_item_writing_required"), true);
});

test("project intake keeps safe numeric fallback when fixed text OCR is empty", () => {
  const draft = parseBusinessRequirementTemplateRegions({
    subject_count: "",
    paper_count: "",
    online_registration_start_time: "",
    other_notes: "",
  }, `
科目数
1
试卷数
1
在线报名开始时间
ATA内容制题参与方式
其他说明
项目需求任务单-在线机考
`);

  assert.equal(draft.subject_count, "1");
  assert.equal(draft.paper_count, "1");
  assert.equal(draft.online_registration_start_time, undefined);
  assert.equal(draft.other_notes, undefined);
});

test("project intake repairs common title OCR confusion for fixed template", () => {
  const draft = parseBusinessRequirementTemplateRegions({
    title: "页目需求任务单-在线机考-高晓枫",
  });

  assert.equal(draft.title, "项目需求任务单-在线机考-高晓枫");
});

test("project intake maps template coordinates through detected screenshot frame", () => {
  const rect = templateRectToImageRect([0.166, 0.505, 0.012, 0.014], {
    x: 0,
    y: 0,
    width: 986 / 1049,
    height: 1030 / 1041,
  });

  assert.ok(Math.abs(rect[0] - 0.156) < 0.002);
  assert.ok(Math.abs(rect[1] - 0.500) < 0.002);
  assert.ok(Math.abs(rect[2] - 0.0113) < 0.001);
  assert.ok(Math.abs(rect[3] - 0.0139) < 0.001);
});

test("project intake derives full template frame from table borders with surrounding blank space", () => {
  const frame = templateFrameFromTableBounds({
    tableX: 79 / 1192,
    tableY: 91 / 1244,
    tableWidth: 981 / 1192,
    tableHeight: 1145 / 1244,
    detected: true,
  });
  const titleRect = templateRectToImageRect([0.158, 0.031, 0.83, 0.03], frame);
  const applicantRect = templateRectToImageRect([0.158, 0.061, 0.34, 0.03], frame);

  assert.ok(frame.y > 0.035);
  assert.ok(frame.y < 0.045);
  assert.ok(titleRect[1] < 91 / 1244);
  assert.ok(applicantRect[1] > 91 / 1244);
});

test("project intake maps bordered template columns to actual cell starts", () => {
  const frame = templateFrameFromTableBounds({
    tableX: 79 / 1192,
    tableY: 91 / 1244,
    tableWidth: 981 / 1192,
    tableHeight: 1145 / 1244,
    detected: true,
  });
  const leftCell = templateRectToImageRect([0.158, 0.061, 0.34, 0.03], frame);
  const rightCell = templateRectToImageRect([0.649, 0.061, 0.34, 0.03], frame);

  assert.ok(Math.abs(leftCell[0] - (228 / 1192)) < 0.004);
  assert.ok(Math.abs(rightCell[0] - (724 / 1192)) < 0.006);
});

test("project intake does not stretch fixed template rows when table has extra lower sections", () => {
  const frame = templateFrameFromTableBounds({
    tableX: 79 / 1192,
    tableY: 91 / 1244,
    tableWidth: 981 / 1192,
    tableHeight: 1145 / 1244,
    imageWidth: 1192,
    imageHeight: 1244,
    detected: true,
  });
  const customerNameRect = templateRectToImageRect([0.158, 0.148, 0.83, 0.03], frame);

  assert.ok(frame.height < 0.85);
  assert.ok(customerNameRect[1] < 220 / 1244);
});

test("project intake handles checkbox OCR without explicit check marks after precise table detection", () => {
  const draft = parseBusinessRequirementTemplateRegions({
    system_type: "易考\n口 易面 口 远鉴\n囗 MTS\n口待定 口其它",
    billing_basis: "• 按报名科次结算 ◎ 按参考科次结算 • 按开考科次结算 • 其他◎待定",
    registration_method: "客户提供报名表 口 客户提供报名表后在线缴费 口 即报即考\n老牛在线奶夕 厂 你休左线奶夕\n囗甘它\n注意：悦考不要选即报即考",
    content_source: "囚 ATA现有内容 口 ATA命制新内容 使用ATA历史试卷 口 客户自命题",
    question_types: "网 客观题口 主观题厂 操作题口 听力题口 口语颗口 打字题口 其它题型",
    paper_count: "",
    other_notes: "◎否\n◎是",
  }, `
试卷数
是否需要人工阅卷
时长（分钟）
40
其他说明
客户可能还需要同步出心理体检报告
`);

  assert.equal(draft.system_type, "易考");
  assert.equal(draft.billing_basis, "按参考科次结算");
  assert.equal(draft.registration_method, "客户提供报名表");
  assert.equal(draft.content_source, "ATA现有内容、使用ATA历史试卷");
  assert.equal(draft.question_types, "客观题");
  assert.equal(draft.paper_count, undefined);
  assert.equal(draft.other_notes, undefined);
});

test("project intake extracts numeric value when paper count OCR includes the label", () => {
  const draft = parseBusinessRequirementTemplateRegions({
    paper_count: "试卷数\n1",
  });

  assert.equal(draft.paper_count, "1");
});
