import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFanweiRequirementModel,
  buildFanweiRequirementPreview,
  mapFanweiToRequirementFields,
  normalizeFanweiDomPayload,
  validateFanweiReadPayload,
} from "./fanwei_requirement_mapper.mjs";

const fanweiR0042182 = normalizeFanweiDomPayload({
  requestid: "1505614",
  fields: {
    "ATA内容制题参与方式": "需要ATA制题或使用历史项目试卷",
    "EPI测试": "需要",
    "业务方向": "企业",
    "其他说明": "四川省公路规划勘察设计研究院有限公司\n四川省通川工程技术开发有限公司校招笔试",
    "内容来源": "ATA现有内容",
    "客户及项目属性": "老客户新项目",
    "性格测试工具": "OPA",
    "报名方式": "客户提供报名表",
    "是否需要ATA安排人工监考": "需要安排分散人工监考",
    "是否需要ATA安排集中监考场地": "不需要",
    "是否需要人工阅卷": "需要",
    "是否需要封闭制题": "不需要",
    "是否需要报名网站": "",
    "申请人": "王历平",
    "申请人部门": "成都代表处",
    "申请日期": "2026-07-02",
    "科目数": "1",
    "系统类型": "易考",
    "结算依据": "按参考科次结算",
    "考核内容是否仅性格测试": "否",
    "考试服务范围": "全流程服务（如需提供4项及以上的单项服务，请直接选择全流程服务）",
    "试卷数": "1",
    "试题类型": "客观题；主观题",
    "运控流水号": "R0042182",
    "选择项目经理": "陈军",
    "选项项目组长": "司园园",
    "阅卷安排": "客户安排阅卷",
    "附件": "附件2：服务确认单.xlsx",
    "项目名称": "蜀道投资集团有限责任公司招聘笔试",
    "项目经理操作": "处理完毕",
    "项目编码": "F0020795",
    "预估收入": "11.00",
    "预估科次": "11",
  },
  opaRows: [
    {
      "OPA报告类型": "全方位胜任力报告-UCF",
      "OPA测评工具": "SHL-OPQ32",
      "备注": "SHL20项胜任力维度报告",
      "常模类型": "OPQ professional（专业人士）",
      "序号": "1",
      "时长（分钟）": "30",
      "是否即测即出报告": "是",
    },
    {
      "OPA报告类型": "情绪倾向报告（标准）-SHLEmotion",
      "OPA测评工具": "SHL-OPQ32",
      "备注": "OPA界面风格的报告",
      "常模类型": "OPQ professional（专业人士）",
      "序号": "2",
      "时长（分钟）": "30",
      "是否即测即出报告": "是",
    },
  ],
  examSceneRows: [
    {
      "场次安排说明": "9：30-11：30",
      "序号": "1",
      "考试日期": "2026-07-05",
      "考试时间": "上午",
    },
  ],
});

test("validates non-empty Fanwei reads against the requested serial number", () => {
  const normalized = validateFanweiReadPayload({
    fields: { " 运控流水号 ": " R0042182 ", "项目名称": "测试项目" },
  }, "R0042182");

  assert.equal(normalized.fields["运控流水号"], "R0042182");
  assert.equal(normalized.fields["项目名称"], "测试项目");
});

test("rejects empty Fanwei reads and serial-number mismatches", () => {
  assert.throws(
    () => validateFanweiReadPayload({}, "R0042182"),
    /没有返回可用.*字段|字段.*为空/,
  );
  assert.throws(
    () => validateFanweiReadPayload({ fields: {} }, "R0042182"),
    /没有返回可用.*字段|字段.*为空/,
  );
  assert.throws(
    () => validateFanweiReadPayload({ fields: { "项目名称": "测试项目" } }, "R0042182"),
    /运控流水号/,
  );
  assert.throws(
    () => validateFanweiReadPayload({ fields: { "运控流水号": "R0099999" } }, "R0042182"),
    /R0099999.*R0042182|R0042182.*R0099999/,
  );
});

test("maps R0042182 Fanwei form into requirement fields without internal ids", () => {
  const fields = mapFanweiToRequirementFields(fanweiR0042182);

  assert.equal(
    fields["考试名称"],
    "四川省通川工程技术开发有限公司校招笔试",
  );
  assert.equal(fields["考试日期时间"], "2026/7/5 9:30:00-2026/7/5 11:30:00");
  assert.equal(fields["人工判分"], "旧版判分（包含系统判分及悦评对接）");
  assert.equal(
    fields["科目信息"],
    "四川省通川工程技术开发有限公司校招笔试",
  );
  assert.match(fields["特殊配置说明"], /泛微流水号：R0042182/);
  assert.match(fields["特殊配置说明"], /项目编码：F0020795/);
  assert.match(fields["特殊配置说明"], /OPA明细/);
  assert.doesNotMatch(fields["特殊配置说明"], /；\\d+(?:,\\d+)*/);
});

test("keeps an all-day Fanwei exam date visible without inventing a time range", () => {
  const fanwei = {
    fields: {
      "运控流水号": "R0024742",
      "项目名称": "智能财务师FAI考试",
    },
    examSceneRows: [{
      "序号": "1",
      "考试日期": "2024-11-24",
      "考试时间": "全天",
      "当天场次数": "2",
      "场次安排说明": "2",
    }],
  };
  const fields = mapFanweiToRequirementFields(fanwei);
  const model = buildFanweiRequirementModel(fanwei);

  assert.equal(fields["考试日期时间"], "2024/11/24 全天");
  assert.deepEqual(
    model.previewFields.find((row) => row.label === "考试时间"),
    { label: "考试时间", value: "2024/11/24 全天", source: "泛微主表" },
  );
});

test("keeps ambiguous automation-only fields out of certain preview", () => {
  const preview = buildFanweiRequirementPreview(fanweiR0042182);

  assert.equal(
    preview.certain["考试名称"],
    "四川省通川工程技术开发有限公司校招笔试",
  );
  assert.equal(preview.certain["人工判分"], "旧版判分（包含系统判分及悦评对接）");
  assert.ok(!("视频监控" in preview.certain));
  assert.ok(preview.needsReview["特殊配置说明"].includes("人工监考：需要安排分散人工监考"));
});

test("prefers service confirmation attachment for exam name time and room rules", () => {
  const fields = mapFanweiToRequirementFields({
    ...fanweiR0042182,
    serviceConfirmation: {
      fields: {
        "单位名称": "四川川交建设集团有限公司",
        "考试名称": "川交集团社会招聘人员笔试",
        "考试时间": "2026年6月25日19：00-20：30",
        "预计人次": "70",
        "科目数量": "6",
        "考场规则": "提前登录30分钟，迟到时间20分钟；最小答题时间60分钟",
        "ATA人工监考": "不需要（客户场地，客户现场监考）",
        "在线巡考": "不需要",
        "阅卷": "客户阅卷",
      },
    },
  });

  assert.equal(fields["考试名称"], "川交集团社会招聘人员笔试");
  assert.equal(fields["考试日期时间"], "2026/6/25 19:00:00-2026/6/25 20:30:00");
  assert.equal(fields["提前登录时间"], "30分钟");
  assert.equal(fields["限制迟到时间"], "20分钟");
  assert.match(fields["特殊配置说明"], /单位名称：四川川交建设集团有限公司/);
  assert.match(fields["特殊配置说明"], /预计人次：70/);
  assert.match(fields["特殊配置说明"], /科目数量：6/);
  assert.match(fields["特殊配置说明"], /最小答题时间60分钟/);
});

test("derives exam name from collapsed other description lines", () => {
  const fanwei = normalizeFanweiDomPayload({
    fields: {
      ...fanweiR0042182.fields,
      "其他说明": "四川省公路规划勘察设计研究院有限公司 四川省通川工程技术开发有限公司校招笔试",
    },
    examSceneRows: fanweiR0042182.examSceneRows,
  });
  const fields = mapFanweiToRequirementFields(fanwei);

  assert.equal(fields["考试名称"], "四川省通川工程技术开发有限公司校招笔试");
});

test("keeps a leading year when deriving an exam name from other description", () => {
  const fields = mapFanweiToRequirementFields({
    fields: {
      "运控流水号": "R0041106",
      "项目名称": "蜀道投资集团有限责任公司招聘笔试",
      "其他说明": "四川蜀道装备科技股份有限公司\n2026年第4次招聘（校招）-法律事务管理岗/出纳及融资实施岗线上笔试",
    },
  });

  assert.equal(
    fields["考试名称"],
    "2026年第4次招聘（校招）-法律事务管理岗/出纳及融资实施岗线上笔试",
  );
});

test("uses the second other-description line as the internal selection exam name", () => {
  const fields = mapFanweiToRequirementFields({
    fields: {
      "运控流水号": "R0042290",
      "项目名称": "蜀道投资集团有限责任公司招聘笔试",
      "其他说明": "四川省川瑞发展投资有限公司 2026年度一般管理岗位内部选聘",
    },
  });

  assert.equal(
    fields["考试名称"],
    "2026年度一般管理岗位内部选聘",
  );
});

test("uses the second other-description line after a branch company name", () => {
  const fields = mapFanweiToRequirementFields({
    fields: {
      "运控流水号": "R0041832",
      "项目名称": "蜀道投资集团有限责任公司招聘笔试",
      "其他说明": "四川路桥集团勘察设计分公司 四川路桥集团勘察设计分公司心理测评",
    },
  });

  assert.equal(
    fields["考试名称"],
    "四川路桥集团勘察设计分公司心理测评",
  );
});

test("uses the second collapsed line when it contains the complete recruitment name", () => {
  const fields = mapFanweiToRequirementFields({
    fields: {
      "运控流水号": "R0042377",
      "项目名称": "蜀道投资集团有限责任公司招聘笔试",
      "其他说明": "四川省交通建设集团有限责任公司 四川省交通建设集团有限责任公司2026年社会招聘",
    },
  });

  assert.equal(
    fields["考试名称"],
    "四川省交通建设集团有限责任公司2026年社会招聘",
  );
});

test("labels a derived exam name as coming from the Fanwei main form", () => {
  const model = buildFanweiRequirementModel({
    fields: {
      "运控流水号": "R0042290",
      "项目名称": "蜀道投资集团有限责任公司招聘笔试",
      "其他说明": "四川省川瑞发展投资有限公司 2026年度一般管理岗位内部选聘",
    },
  });

  assert.equal(
    model.previewFields.find((item) => item.label === "考试名称")?.source,
    "泛微主表",
  );
});

test("builds Fanwei requirement model for R0042182 with hidden fields removed", () => {
  const model = buildFanweiRequirementModel({
    ...fanweiR0042182,
    serviceConfirmation: {
      fields: {
        "单位名称": "四川省公路规划勘察设计研究院有限公司",
        "考试名称": "四川省通川工程技术开发有限公司校招笔试",
        "考试时间": "2026年7月5日9：30-11：30",
        "预计人次": "11",
        "科目数量": "1",
        "考场规则": "提前登录30分钟，迟到时间20分钟；最小答题时间60分钟",
        "ATA人工监考": "需要",
        "在线巡考": "需要（3个）",
      },
    },
  });

  assert.equal(model.fields["考试名称"], "四川省通川工程技术开发有限公司校招笔试");
  assert.equal(model.fields["单位名称"], "四川省公路规划勘察设计研究院有限公司");
  assert.equal(model.fields["考试日期时间"], "2026/7/5 9:30:00-2026/7/5 11:30:00");
  assert.equal(model.fields["试考日期时间"], "2026/7/4 10:00:00-2026/7/4 17:00:00");
  assert.equal(model.fields["科目信息"], "四川省通川工程技术开发有限公司校招笔试");
  assert.equal(model.fields["科目数量"], "1");
  assert.equal(model.fields["试卷数量"], "1");
  assert.equal(model.fields["人工监考"], "需要安排分散人工监考");
  assert.equal(model.requirementFields["人工判分"], "旧版判分（包含系统判分及悦评对接）");
  assert.ok(!model.previewFields.some((item) => item.label === "泛微 requestid"));
  assert.ok(!model.previewFields.some((item) => item.label === "预估人次"));
  assert.ok(!model.previewFields.some((item) => item.label === "预估收入"));
  assert.ok(!model.previewFields.some((item) => item.label === "在线巡考"));
  assert.ok(!model.previewFields.some((item) => item.label === "即报即考是否需要开通"));
});
