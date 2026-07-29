import assert from "node:assert/strict";
import test from "node:test";

import * as operationPersonnelRunner from "./operation_personnel_task_runner.mjs";
import {
  inspectOperationPersonnelTask,
  matchOperationPersonnelRecipients,
  normalizeOperationPersonnelSnapshot,
  operationPersonnelBatchIdentityFromVisibleRaw,
  operationPersonnelConflicts,
  operationPersonnelDisplaySchedules,
  runOperationPersonnelInspection,
} from "./operation_personnel_task_runner.mjs";

test("display schedules use exact operation schedule codes", () => {
  assert.deepEqual(operationPersonnelDisplaySchedules(
    [{ requirementIndex: 0, name: "综合能力", start: "2026-08-22 09:00", end: "2026-08-22 11:00" }],
    [{ scheduleCode: 17, subjectName: "综合能力", start: "2026-08-22 09:00", end: "2026-08-22 11:00" }],
  ), [{
    scheduleCode: 17,
    name: "综合能力",
    start: "2026-08-22 09:00",
    end: "2026-08-22 11:00",
  }]);
});

test("display schedules reject missing duplicate or unmatched operation codes", () => {
  const managed = [{ requirementIndex: 0, name: "综合能力", start: "2026-08-22 09:00", end: "2026-08-22 11:00" }];
  assert.throws(() => operationPersonnelDisplaySchedules(managed, []), /日程/);
  assert.throws(() => operationPersonnelDisplaySchedules(managed, [
    { scheduleCode: 17, subjectName: "综合能力", start: "2026-08-22 09:00", end: "2026-08-22 11:00" },
    { scheduleCode: 17, subjectName: "综合能力", start: "2026-08-22 09:00", end: "2026-08-22 11:00" },
  ]), /重复/);
});

test("display schedules reject extra operation schedules and duplicate managed schedules", () => {
  const managed = [{ requirementIndex: 0, name: "综合能力", start: "2026-08-22 09:00", end: "2026-08-22 11:00" }];
  const operation = [{ scheduleCode: 17, subjectName: "综合能力", start: "2026-08-22 09:00", end: "2026-08-22 11:00" }];
  assert.throws(() => operationPersonnelDisplaySchedules(managed, [
    ...operation,
    { scheduleCode: 18, subjectName: "专业知识", start: "2026-08-22 14:00", end: "2026-08-22 16:00" },
  ]), /一一对应/);
  assert.throws(() => operationPersonnelDisplaySchedules([
    ...managed,
    { ...managed[0], requirementIndex: 1 },
  ], operation), /一一对应/);
});

test("display schedules compare real minute-only parser output with zero-second managed times", () => {
  const visible = operationPersonnelRunner.operationPersonnelTaskSheetFromVisibleRaw(
    visiblePersonnelTaskSheetRaw({
      scheduleRows: [
        ["1", "17", "2026-08-22 09:00~11:00", "120", "湖北邮政招聘考试", "30"],
      ],
    }),
  );

  assert.deepEqual(operationPersonnelDisplaySchedules(
    [{
      requirementIndex: 0,
      name: "湖北邮政招聘考试",
      start: "2026-08-22T09:00:00",
      end: "2026-08-22T11:00:00",
    }],
    visible.schedules,
  ), [{
    scheduleCode: 17,
    name: "湖北邮政招聘考试",
    start: "2026-08-22T09:00:00",
    end: "2026-08-22T11:00:00",
  }]);
});

test("display schedules block invalid or non-zero-second times", () => {
  for (const time of [
    "2026-02-30T09:00:00",
    "2026-08-22T09:00:01",
    "2026-08-22 09:60",
  ]) {
    assert.throws(
      () => operationPersonnelDisplaySchedules(
        [{ requirementIndex: 0, name: "综合能力", start: time, end: "2026-08-22 11:00" }],
        [{ scheduleCode: 17, subjectName: "综合能力", start: time, end: "2026-08-22 11:00" }],
      ),
      { code: "PERSONNEL_BATCH_SCHEDULE_CONFLICT" },
    );
  }
});

test("current operation detail header maps exact visible batch identity", () => {
  assert.deepEqual(operationPersonnelBatchIdentityFromVisibleRaw({
    titleCount: 1,
    code: "EZT260004",
    batchName: "中国邮政集团公司湖北省分公司招聘考试_2026年8月",
    projectLinkCount: 2,
    projectCode: "4473-26",
    projectName: "第三方评价-黑龙江省善用人力资源有限公司",
    headerInfoCount: 1,
    headerInfoText: [
      "4473-26 | 第三方评价-黑龙江省善用人力资源有限公司 | 业务部归属：业务二部 | 业务负责人：田永军",
      "项目部归属：项目实施五部 | 项目经理：经理 | 考试日期：2026-08-22",
    ].join("\n"),
    statusCount: 1,
    statusTags: ["实施中", "已发布"],
    systemTypeCount: 1,
    systemType: "易考",
  }), {
    batch: {
      code: "EZT260004",
      projectCode: "4473-26",
      projectName: "第三方评价-黑龙江省善用人力资源有限公司",
      batchName: "中国邮政集团公司湖北省分公司招聘考试_2026年8月",
      projectDepartment: "项目实施五部",
      projectManager: "经理",
      systemType: "易考",
      published: true,
    },
    evidence: { present: true, missing: [] },
  });
});

test("current operation detail treats the revoke-publish batch status as unpublished", () => {
  const result = operationPersonnelBatchIdentityFromVisibleRaw({
    titleCount: 1,
    code: "EZT260006",
    batchName: "湖北邮政_2026年8月",
    projectLinkCount: 2,
    projectCode: "F0012393",
    projectName: "宁德时代",
    headerInfoCount: 1,
    headerInfoText: [
      "F0012393 | 宁德时代 | 业务部归属：业务二部 | 业务负责人：陶悦",
      "项目部归属：项目实施五部 | 项目经理：经理 | 考试日期：2026-08-22",
    ].join("\n"),
    statusCount: 1,
    statusTags: ["实施中", "撤销发布"],
    systemTypeCount: 1,
    systemType: "易考",
  });

  assert.equal(result.batch.published, false);
});

test("current operation detail blocks while the publication status tag is still empty", () => {
  const result = operationPersonnelBatchIdentityFromVisibleRaw({
    titleCount: 1,
    code: "EZT260006",
    batchName: "湖北邮政_2026年8月",
    projectLinkCount: 2,
    projectCode: "F0012393",
    projectName: "宁德时代",
    headerInfoCount: 1,
    headerInfoText: "项目部归属：项目实施五部 | 项目经理：经理",
    statusCount: 1,
    statusTags: ["实施中"],
    systemTypeCount: 1,
    systemType: "易考",
  });

  assert.equal(result.evidence.present, false);
  assert.deepEqual(result.evidence.missing, ["发布状态"]);
});

test("current operation detail header never invents ambiguous identity fields", () => {
  const result = operationPersonnelBatchIdentityFromVisibleRaw({
    titleCount: 2,
    code: "EZT260004",
    batchName: "目标批次",
    projectLinkCount: 1,
    projectCode: "4473-26",
    projectName: "",
    headerInfoCount: 1,
    headerInfoText: "项目部归属：项目实施五部",
    statusCount: 0,
    statusTags: [],
    systemTypeCount: 2,
    systemType: "易考",
  });
  assert.equal(result.evidence.present, false);
  assert.deepEqual(result.evidence.missing, [
    "批次代码",
    "批次名称",
    "项目编码",
    "项目名称",
    "项目经理",
    "系统类型",
    "发布状态",
  ]);
});

test("personnel page visible lines map configuration dates and requirements", () => {
  assert.deepEqual(operationPersonnelRunner.operationPersonnelPageFromVisibleRaw({
    lines: [
      "配置项",
      "人员落实日期：",
      "2026-07-24 ~ 2026-08-18",
      "人员落实平台：",
      "悦站",
      "监考类型：",
      "分散监考",
      "人员名单提交日期：",
      "2026-08-19",
      "考务需求",
      "正式考试-最早登录系统时间： 考生可于考试开始前30分钟登录",
      "正式考试-监考人员安排： ATA监考-分散",
      "正式考试-监考人员数量： 3",
      "正式考试-监考人员比例： 1:50",
      "正式考试-监考登录监控： 是",
    ],
  }), {
    personnel: {
      serviceType: "ATA 监考－分散在线监考",
      platform: "悦站",
      loginMonitoring: "是",
      monitorRatio: "1:50",
      candidateBasis: "",
      monitorCount: 3,
      earliestLoginMinutes: 30,
      trialIncluded: false,
    },
    dates: {
      start: "2026-07-24",
      end: "2026-08-18",
      nameListDue: "2026-08-19",
    },
    requirements: [
      {
        name: "正式考试-最早登录系统时间",
        value: "考生可于考试开始前30分钟登录",
      },
      {
        name: "正式考试-监考人员安排",
        value: "ATA监考-分散",
      },
      {
        name: "正式考试-监考人员数量",
        value: "3",
      },
      {
        name: "正式考试-监考人员比例",
        value: "1:50",
      },
      {
        name: "正式考试-监考登录监控",
        value: "是",
      },
    ],
    evidence: {
      personnel: { present: true, missing: [] },
      dates: { present: true, missing: [] },
      requirements: { present: true, missing: [] },
    },
  });
});

test("readonly personnel dates are selected through the exact calendar cell", async () => {
  const events = [];
  const control = (label) => ({
    count: async () => 1,
    click: async () => events.push(label),
    press: async (key) => events.push(`${label}:${key}`),
    waitFor: async (options) => events.push(`${label}:${options.state}`),
  });
  const dialog = {
    locator: (selector) => {
      assert.equal(selector, 'input[placeholder="结束日期"]:visible');
      return control("input");
    },
  };
  const page = {
    keyboard: {
      press: async (key) => events.push(`page:${key}`),
    },
    locator: (selector) => {
      if (selector.includes('[title="2026年8月19日"]')) {
        assert.match(selector, /:not\(\.ant-calendar-last-month-cell\)/);
        assert.match(selector, /:not\(\.ant-calendar-next-month-btn-day\)/);
        return control("cell");
      }
      assert.equal(selector, ".ant-calendar-picker-container:visible");
      return control("calendar");
    },
  };

  await operationPersonnelRunner.selectVisiblePersonnelDate(
    page,
    dialog,
    "结束日期",
    "2026-08-19",
  );

  assert.deepEqual(events, [
    "input",
    "cell",
    "page:Escape",
    "calendar:hidden",
  ]);
});

test("personnel date range selects both endpoints before saving", async () => {
  const events = [];
  const control = (label, count = 1) => ({
    count: async () => count,
    click: async () => events.push(label),
    waitFor: async (options) => events.push(`${label}:${options.state}`),
  });
  const dialog = {
    locator: () => control("input"),
  };
  const page = {
    locator: (selector) => {
      if (selector.includes("2026年7月24日")) {
        assert.match(selector, /:not\(\.ant-calendar-last-month-cell\)/);
        assert.match(selector, /:not\(\.ant-calendar-next-month-btn-day\)/);
        return control("start");
      }
      if (selector.includes("2026年8月19日")) {
        assert.match(selector, /:not\(\.ant-calendar-last-month-cell\)/);
        assert.match(selector, /:not\(\.ant-calendar-next-month-btn-day\)/);
        return control("end");
      }
      return control("calendar", 0);
    },
  };

  await operationPersonnelRunner.selectVisiblePersonnelDateRange(
    page,
    dialog,
    "2026-07-24",
    "2026-08-19",
  );

  assert.deepEqual(events, ["input", "start", "end"]);
});

test("personnel date range waits for the end date after the calendar rerenders", async () => {
  const events = [];
  let endReady = false;
  const control = (label, ready = () => true) => ({
    count: async () => ready() ? 1 : 0,
    click: async () => events.push(label),
    waitFor: async ({ state }) => {
      assert.equal(state, "visible");
      endReady = true;
      events.push(`${label}:visible`);
    },
  });
  const dialog = { locator: () => control("input") };
  const page = {
    locator: (selector) => {
      if (selector.includes("2026年7月24日")) return control("start");
      if (selector.includes("2026年8月19日")) {
        return control("end", () => endReady);
      }
      return control("calendar", () => false);
    },
  };

  await operationPersonnelRunner.selectVisiblePersonnelDateRange(
    page,
    dialog,
    "2026-07-24",
    "2026-08-19",
  );

  assert.deepEqual(events, ["input", "start", "end:visible", "end"]);
});

test("personnel date range uses the real calendar inputs instead of day cells", async () => {
  const events = [];
  const activeInputControl = (label) => ({
    count: async () => 1,
    fill: async (value) => events.push(`${label}:fill:${value}`),
    press: async (key) => events.push(`${label}:press:${key}`),
  });
  const inputControl = (label) => ({
    count: async () => 2,
    first: () => activeInputControl(label),
    last: () => activeInputControl(label),
  });
  const missingInputControl = {
    count: async () => 0,
    waitFor: async () => {},
  };
  const activeCalendar = {
    locator: () => missingInputControl,
    waitFor: async ({ state }) => events.push(`calendar:${state}`),
  };
  const calendar = {
    count: async () => 2,
    first: () => activeCalendar,
    last: () => activeCalendar,
  };
  const dialog = {
    locator: () => ({
      count: async () => 1,
      click: async () => events.push("range:click"),
    }),
  };
  const page = {
    locator: (selector) => {
      if (selector === ".ant-calendar-picker-container:visible") return calendar;
      if (selector === '.ant-calendar-picker-container:visible input[placeholder="开始日期"]:visible') {
        return inputControl("start");
      }
      if (selector === '.ant-calendar-picker-container:visible input[placeholder="结束日期"]:visible') {
        return inputControl("end");
      }
      throw new Error(`day cell must not be used: ${selector}`);
    },
  };

  await operationPersonnelRunner.selectVisiblePersonnelDateRange(
    page,
    dialog,
    "2026-07-29",
    "2026-08-19",
  );

  assert.deepEqual(events, [
    "range:click",
    "start:fill:2026-07-29",
    "start:press:Enter",
    "end:fill:2026-08-19",
    "end:press:Enter",
    "calendar:hidden",
  ]);
});

test("current operation batch schedule rows map the visible combined schedule columns", () => {
  const schedules = operationPersonnelRunner.operationPersonnelBatchSchedulesFromVisibleRows([{
    "场次": "1",
    "日程代码": "1",
    "日程": "2026-08-22 15:30~17:30",
    "时长(分钟)": "120",
    "考试名称": "中国邮政集团公司湖北省分公司招聘考试",
    "考生提前登录(分钟)": "0",
  }]);

  assert.deepEqual(schedules, [{
    scheduleEntryId: "",
    scheduleCode: 1,
    subjectCode: "",
    subjectName: "中国邮政集团公司湖北省分公司招聘考试",
    start: "2026-08-22 15:30",
    end: "2026-08-22 17:30",
    durationMinutes: 120,
    earlyLoginMinutes: 0,
  }]);
});

test("legacy operation batch schedule rows keep separate time column compatibility", () => {
  const schedules = operationPersonnelRunner.operationPersonnelBatchSchedulesFromVisibleRows([{
    "日程代码": "17",
    "开始时间": "2026-08-22 09:00",
    "结束时间": "2026-08-22 11:00",
    "时长": "120",
    "科目名称": "综合能力",
    "提前登录分钟数": "30",
  }]);

  assert.deepEqual(schedules, [{
    scheduleEntryId: "",
    scheduleCode: 17,
    subjectCode: "",
    subjectName: "综合能力",
    start: "2026-08-22 09:00",
    end: "2026-08-22 11:00",
    durationMinutes: 120,
    earlyLoginMinutes: 30,
  }]);
});

test("current operation batch schedule rows reject an invalid combined schedule range", () => {
  assert.throws(
    () => operationPersonnelRunner.operationPersonnelBatchSchedulesFromVisibleRows([{
      "日程代码": "1",
      "日程": "2026-08-22 15:30",
      "时长(分钟)": "120",
      "考试名称": "目标考试",
      "考生提前登录(分钟)": "0",
    }]),
    /日程.*格式无效/,
  );
});

function visiblePersonnelTaskSheetRaw(overrides = {}) {
  return {
    conditions: [
      "【易考-考试日程】已设置",
      "【人员-在线监考】配置项已设置",
      "【人员落实时间】已设置且【人员落实时间】未结束",
      "【批次状态】为【已发布】",
    ],
    keyValueRows: [
      ["项目编码", "4473-26"],
      ["项目名称", "测试运控项目"],
      ["批次名称", "目标批次"],
      ["项目部归属", "项目实施五部"],
      ["项目经理", "经理"],
      ["系统类型", "易考"],
      ["人员落实开始日期", "2026-07-24"],
      ["人员落实结束日期", "2026-08-18"],
      ["人员落实平台", "悦站"],
      ["监考类型", "分散监考"],
      ["人员名单提交日期", "2026-08-19"],
      ["正式考试-最早登录系统时间", "考生可于考试开始前30分钟登录"],
      ["正式考试-监考人员安排", "ATA监考-分散"],
      ["正式考试-监考人员数量", "3"],
      ["正式考试-监考人员比例", "1:50"],
      ["正式考试-监考登录监控", "是"],
    ],
    scheduleHeaders: [
      "场次",
      "日程代码",
      "日程",
      "时长(分钟)",
      "科目名称",
      "考生提前登录(分钟)",
    ],
    scheduleRows: [
      ["1", "1", "2026-08-22 13:30~15:30", "120", "目标考试", "30"],
    ],
    sendRecordRows: [
      ["发送时间", "变更内容"],
      ["2026-07-23 10:09:34", "首次发送"],
    ],
    ...overrides,
  };
}

test("current personnel task sheet maps visible tables into a normalized snapshot", () => {
  assert.equal(
    typeof operationPersonnelRunner.operationPersonnelTaskSheetFromVisibleRaw,
    "function",
  );
  const snapshot = operationPersonnelRunner.operationPersonnelTaskSheetFromVisibleRaw(
    visiblePersonnelTaskSheetRaw(),
  );

  assert.deepEqual(snapshot.batch, {
    code: "",
    projectCode: "4473-26",
    projectName: "测试运控项目",
    batchName: "目标批次",
    projectDepartment: "项目实施五部",
    projectManager: "经理",
    systemType: "易考",
    published: true,
  });
  assert.deepEqual(snapshot.schedules, [{
    scheduleEntryId: "",
    scheduleCode: 1,
    subjectCode: "",
    subjectName: "目标考试",
    start: "2026-08-22 13:30",
    end: "2026-08-22 15:30",
    durationMinutes: 120,
    earlyLoginMinutes: 30,
  }]);
  assert.deepEqual(snapshot.personnel, {
    serviceType: "ATA 监考－分散在线监考",
    platform: "悦站",
    loginMonitoring: "是",
    monitorRatio: "1:50",
    candidateBasis: "",
    monitorCount: 3,
    earliestLoginMinutes: 30,
    trialIncluded: false,
  });
  assert.deepEqual(snapshot.dates, {
    start: "2026-07-24",
    end: "2026-08-18",
    nameListDue: "2026-08-19",
  });
  assert.equal(snapshot.taskSheet.type, "分散在线监考");
  assert.equal(snapshot.taskSheet.conditions.length, 4);
  assert.equal(snapshot.taskSheet.conditions.every((item) => item.satisfied), true);
  assert.deepEqual(snapshot.sendRecords, [{
    type: "首次发送",
    sentAt: "2026-07-23 10:09:34",
  }]);
});

test("current personnel task sheet accepts the real 考试名称 schedule header", () => {
  const raw = visiblePersonnelTaskSheetRaw();
  raw.scheduleHeaders = raw.scheduleHeaders.map((header) => (
    header === "科目名称" ? "考试名称" : header
  ));

  const snapshot = operationPersonnelRunner.operationPersonnelTaskSheetFromVisibleRaw(raw);

  assert.equal(snapshot.schedules[0].subjectName, "目标考试");
});

test("current personnel task sheet splits the recorded combined personnel date range", () => {
  const raw = visiblePersonnelTaskSheetRaw();
  raw.keyValueRows = raw.keyValueRows
    .filter(([label]) => !["人员落实开始日期", "人员落实结束日期"].includes(label))
    .concat([["人员落实日期", "2026-07-24 ~ 2026-08-18"]]);

  const snapshot = operationPersonnelRunner.operationPersonnelTaskSheetFromVisibleRaw(raw);

  assert.deepEqual(snapshot.dates, {
    start: "2026-07-24",
    end: "2026-08-18",
    nameListDue: "2026-08-19",
  });
});

test("current personnel task sheet blocks a missing schedule header", () => {
  assert.equal(
    typeof operationPersonnelRunner.operationPersonnelTaskSheetFromVisibleRaw,
    "function",
  );
  assert.throws(
    () => operationPersonnelRunner.operationPersonnelTaskSheetFromVisibleRaw(
      visiblePersonnelTaskSheetRaw({
        scheduleHeaders: ["场次", "日程代码", "日程"],
      }),
    ),
    /任务单日程表头/,
  );
});

test("current personnel task sheet blocks an invalid send record row", () => {
  assert.equal(
    typeof operationPersonnelRunner.operationPersonnelTaskSheetFromVisibleRaw,
    "function",
  );
  assert.throws(
    () => operationPersonnelRunner.operationPersonnelTaskSheetFromVisibleRaw(
      visiblePersonnelTaskSheetRaw({
        sendRecordRows: [
          ["发送时间", "变更内容"],
          ["", "首次发送"],
        ],
      }),
    ),
    /发送记录/,
  );
});

test("current personnel send record table maps its header row and visible records", () => {
  assert.equal(
    typeof operationPersonnelRunner.operationPersonnelSendRecordsFromVisibleRows,
    "function",
  );
  assert.deepEqual(
    operationPersonnelRunner.operationPersonnelSendRecordsFromVisibleRows([
      ["发送时间", "变更内容"],
      ["2026-07-23 10:12:08", "再次发送"],
      ["2026-07-23 10:09:34", "首次发送"],
    ]),
    [
      { type: "再次发送", sentAt: "2026-07-23 10:12:08" },
      { type: "首次发送", sentAt: "2026-07-23 10:09:34" },
    ],
  );
  assert.throws(
    () => operationPersonnelRunner.operationPersonnelSendRecordsFromVisibleRows([
      ["发送类型", "发送时间"],
    ]),
    /发送记录表头无效/,
  );
});

test("current personnel timeline maps a change summary entry as a resend record", () => {
  assert.equal(
    typeof operationPersonnelRunner.operationPersonnelTimelineSendRecordFromVisibleText,
    "function",
  );
  assert.deepEqual(
    operationPersonnelRunner.operationPersonnelTimelineSendRecordFromVisibleText(
      "人员落实结束日期调整为2026-08-19；正式考试监考人数由3人调整为80人（按4000人、1:50计算） 2026-07-24 13:38:39",
    ),
    { type: "再次发送", sentAt: "2026-07-24 13:38:39" },
  );
  assert.deepEqual(
    operationPersonnelRunner.operationPersonnelTimelineSendRecordFromVisibleText(
      "首次发送 2026-07-23 10:09:34",
    ),
    { type: "首次发送", sentAt: "2026-07-23 10:09:34" },
  );
  assert.equal(
    operationPersonnelRunner.operationPersonnelTimelineSendRecordFromVisibleText(
      "没有发送时间",
    ),
    null,
  );
});

test("current personnel directory labels map exact email identities", () => {
  assert.equal(
    typeof operationPersonnelRunner.operationPersonnelDirectoryPeopleFromVisibleTexts,
    "function",
  );
  assert.deepEqual(
    operationPersonnelRunner.operationPersonnelDirectoryPeopleFromVisibleTexts([
      "演练组",
      "zhanglexiang@ata.net.cn (张乐翔)",
      "maomengmeng@ata.net.cn (毛萌萌)",
      "zhanglexiang@ata.net.cn (张乐翔)",
    ]),
    [
      { id: "zhanglexiang@ata.net.cn", name: "张乐翔" },
      { id: "maomengmeng@ata.net.cn", name: "毛萌萌" },
    ],
  );
});

test("selected mail recipients may display the email without repeating the name", () => {
  assert.deepEqual(
    operationPersonnelRunner.operationPersonnelMailPeopleFromVisibleTexts([
      "zhanglexiang@ata.net.cn",
    ]),
    [{ id: "zhanglexiang@ata.net.cn", name: "" }],
  );
});

test("checked inline mail recipients are split between to and cc", () => {
  assert.deepEqual(
    operationPersonnelRunner.operationPersonnelCheckedMailPeopleFromVisibleEntries([
      { section: "to", value: "演练组" },
      { section: "to", value: "zhanglexiang@ata.net.cn (张乐翔)" },
      { section: "cc", value: "jiesuan1@ata.net.cn (结算一)" },
    ]),
    {
      to: [{ id: "zhanglexiang@ata.net.cn", name: "张乐翔" }],
      cc: [{ id: "jiesuan1@ata.net.cn", name: "结算一" }],
    },
  );
});

function fakePersonnelTaskListPage(rows = [], {
  additionalPages = [],
  firstPageRowsAfterReset = null,
  searchInitiallyMissing = false,
  taskSheetTextHasNoExactNode = false,
  withoutBatchCodeColumn = false,
} = {}) {
  const events = [];
  const pages = [rows, ...additionalPages];
  let searchCount = 0;
  let pageIndex = 0;
  let searchReady = !searchInitiallyMissing;
  const mainTable = {
    locator(selector) {
      if (selector === "thead th") {
        return {
          allInnerTexts: async () => [
            ...(withoutBatchCodeColumn ? [] : ["批次代码"]),
            "批次名称",
            "项目部归属",
            "项目经理",
            "首次发送时间",
            "最近一次发送时间",
          ],
        };
      }
      if (selector === "tbody tr") {
        const rowLocators = pages[pageIndex].map((cells, rowIndex) => ({
          locator: (rowSelector) => {
            assert.equal(rowSelector, "td");
            return { allInnerTexts: async () => cells };
          },
          rowIndex,
        }));
        return {
          count: async () => rowLocators.length,
          nth: (index) => rowLocators[index],
        };
      }
      throw new Error(`unexpected main table selector: ${selector}`);
    },
  };
  const fixedTable = {
    locator(selector) {
      if (selector === "thead th") {
        return { allInnerTexts: async () => ["操作"] };
      }
      throw new Error(`unexpected fixed table selector: ${selector}`);
    },
  };
  const tables = {
    count: async () => 2,
    nth: (index) => [mainTable, fixedTable][index],
  };
  const fixedRows = {
    nth: (index) => ({
      getByText: (name, options) => {
        assert.equal(name, "发送任务单");
        assert.equal(options.exact, true);
        return {
          count: async () => 1,
          click: async () => events.push(`click:${index}`),
        };
      },
    }),
  };
  const searchInput = {
    count: async () => searchReady ? 1 : 0,
    waitFor: async ({ state }) => {
      assert.equal(state, "visible");
      events.push("search:visible");
      searchReady = true;
    },
    fill: async (value) => events.push(`fill:${value}`),
    press: async (key) => {
      if (key === "Enter") {
        searchCount += 1;
        pageIndex = 0;
        if (searchCount > 1 && firstPageRowsAfterReset) {
          pages[0] = firstPageRowsAfterReset;
        }
      }
      events.push(`press:${key}`);
    },
  };
  const pagination = {
    count: async () => pages.length > 1 ? 1 : 0,
  };
  const activePage = {
    count: async () => 1,
    first() {
      return this;
    },
    getAttribute: async (name) => name === "title" ? String(pageIndex + 1) : "",
    innerText: async () => String(pageIndex + 1),
  };
  const nextPage = {
    count: async () => pages.length > 1 ? 1 : 0,
    first() {
      return this;
    },
    getAttribute: async (name) => {
      if (name === "class") {
        return pageIndex >= pages.length - 1
          ? "ant-pagination-next ant-pagination-disabled"
          : "ant-pagination-next";
      }
      if (name === "aria-disabled") return pageIndex >= pages.length - 1 ? "true" : "false";
      return "";
    },
    locator: () => ({
      first() {
        return this;
      },
      count: async () => 1,
      click: async () => {
        pageIndex += 1;
        events.push(`next:${pageIndex + 1}`);
      },
    }),
  };
  return {
    events,
    goto: async (url) => events.push(`goto:${url}`),
    locator(selector) {
      if (selector === 'input[placeholder="请输入批次代码、批次名称、项目经理"]:visible') {
        return searchInput;
      }
      if (selector === "table:visible") return tables;
      if (selector === ".ant-table-fixed-right table:visible tbody tr") return fixedRows;
      if (selector === ".ant-pagination:visible") return pagination;
      if (selector === ".ant-pagination-item-active:visible") return activePage;
      if (selector === ".ant-pagination .ant-pagination-next:visible") return nextPage;
      if (selector === ".ant-modal:visible") {
        return {
          filter: ({ hasText }) => {
            assert.equal(hasText, "任务单发送需满足以下条件");
            return {
              count: async () => 1,
              first: () => ({
                waitFor: async () => events.push(`wait:${hasText}`),
              }),
            };
          },
        };
      }
      throw new Error(`unexpected page selector: ${selector}`);
    },
    getByText(name, options) {
      assert.equal(options.exact, true);
      return {
        first() {
          return this;
        },
        waitFor: async () => {
          if (taskSheetTextHasNoExactNode && name === "任务单发送需满足以下条件") {
            throw new Error("exact task-sheet condition text node missing");
          }
          events.push(`wait:${name}`);
        },
      };
    },
  };
}

test("current personnel task list opens the exact fixed action row", async () => {
  assert.equal(
    typeof operationPersonnelRunner.openVisiblePersonnelTaskSheet,
    "function",
  );
  const page = fakePersonnelTaskListPage([
    ["EZT260002", "其它批次", "项目实施五部", "经理", "", ""],
    ["EZT260003", "目标批次", "项目实施五部", "经理", "2026-07-23 10:09:34", "2026-07-23 10:09:34"],
  ]);

  await operationPersonnelRunner.openVisiblePersonnelTaskSheet(
    page,
    { batch: { code: "EZT260003", batchName: "目标批次" } },
    { baseUrl: "http://operation.test/" },
  );

  assert.deepEqual(page.events, [
    "goto:http://operation.test/job/decentralizedInvigilate",
    "fill:EZT260003",
    "press:Enter",
    "wait:EZT260003",
    "click:1",
    "wait:任务单发送需满足以下条件",
  ]);
});

test("current personnel task list uses the batch name when the real table omits batch code", async () => {
  const page = fakePersonnelTaskListPage([
    ["目标批次", "项目实施五部", "经理", "", ""],
  ], { withoutBatchCodeColumn: true });

  await operationPersonnelRunner.openVisiblePersonnelTaskSheet(
    page,
    { batch: { code: "EZT260003", batchName: "目标批次" } },
    { baseUrl: "http://operation.test/" },
  );

  assert.equal(page.events.includes("fill:目标批次"), true);
  assert.equal(page.events.includes("wait:目标批次"), true);
  assert.equal(page.events.includes("click:0"), true);
});

test("current personnel task list waits for its React filter", async () => {
  const page = fakePersonnelTaskListPage([
    ["EZT260003", "目标批次", "项目实施五部", "经理", "", ""],
  ], { searchInitiallyMissing: true });

  await operationPersonnelRunner.openVisiblePersonnelTaskSheet(
    page,
    { batch: { code: "EZT260003", batchName: "目标批次" } },
    { baseUrl: "http://operation.test/" },
  );

  assert.equal(page.events.includes("search:visible"), true);
  assert.equal(page.events.includes("click:0"), true);
});

test("current personnel task list waits for the visible modal instead of an exact text node", async () => {
  const page = fakePersonnelTaskListPage([
    ["EZT260003", "目标批次", "项目实施五部", "经理", "", ""],
  ], { taskSheetTextHasNoExactNode: true });

  await operationPersonnelRunner.openVisiblePersonnelTaskSheet(
    page,
    { batch: { code: "EZT260003", batchName: "目标批次" } },
    { baseUrl: "http://operation.test/" },
  );

  assert.equal(page.events.includes("click:0"), true);
  assert.equal(page.events.includes("wait:任务单发送需满足以下条件"), true);
});

test("current personnel task list binds the action to the exact code and name row", async () => {
  const page = fakePersonnelTaskListPage([
    ["EZT999999", "目标批次", "项目实施五部", "经理", "", ""],
    ["EZT260003", "目标批次", "项目实施五部", "经理", "", ""],
  ]);

  await operationPersonnelRunner.openVisiblePersonnelTaskSheet(
    page,
    { batch: { code: "EZT260003", batchName: "目标批次" } },
    { baseUrl: "http://operation.test" },
  );

  assert.equal(page.events.includes("click:0"), false);
  assert.equal(page.events.includes("click:1"), true);
});

test("current personnel task list finds the exact code and name across result pages", async () => {
  const page = fakePersonnelTaskListPage([
    ["EZT999999", "目标批次", "项目实施五部", "经理", "", ""],
  ], {
    additionalPages: [[
      ["EZT260003", "目标批次", "项目实施五部", "经理", "", ""],
    ]],
  });

  await operationPersonnelRunner.openVisiblePersonnelTaskSheet(
    page,
    { batch: { code: "EZT260003", batchName: "目标批次" } },
    { baseUrl: "http://operation.test" },
  );

  assert.equal(page.events.includes("next:2"), true);
  assert.equal(page.events.includes("click:0"), true);
});

test("current personnel task list returns to the exact row page after proving later pages do not match", async () => {
  const page = fakePersonnelTaskListPage([
    ["EZT260003", "目标批次", "项目实施五部", "经理", "", ""],
  ], {
    additionalPages: [[
      ["EZT999999", "目标批次", "项目实施五部", "经理", "", ""],
    ]],
  });

  await operationPersonnelRunner.openVisiblePersonnelTaskSheet(
    page,
    { batch: { code: "EZT260003", batchName: "目标批次" } },
    { baseUrl: "http://operation.test" },
  );

  assert.equal(page.events.filter((event) => event === "press:Enter").length, 2);
  assert.equal(page.events.includes("click:0"), true);
});

test("current personnel task list re-resolves the exact row after result order changes", async () => {
  const page = fakePersonnelTaskListPage([
    ["EZT260003", "目标批次", "项目实施五部", "经理", "", ""],
    ["EZT888888", "其它批次", "项目实施五部", "经理", "", ""],
  ], {
    additionalPages: [[
      ["EZT999999", "目标批次", "项目实施五部", "经理", "", ""],
    ]],
    firstPageRowsAfterReset: [
      ["EZT888888", "其它批次", "项目实施五部", "经理", "", ""],
      ["EZT260003", "目标批次", "项目实施五部", "经理", "", ""],
    ],
  });

  await operationPersonnelRunner.openVisiblePersonnelTaskSheet(
    page,
    { batch: { code: "EZT260003", batchName: "目标批次" } },
    { baseUrl: "http://operation.test" },
  );

  assert.equal(page.events.includes("click:0"), false);
  assert.equal(page.events.includes("click:1"), true);
});

test("current personnel task list blocks duplicate exact code and name rows", async () => {
  assert.equal(
    typeof operationPersonnelRunner.openVisiblePersonnelTaskSheet,
    "function",
  );
  const page = fakePersonnelTaskListPage([
    ["EZT260003", "目标批次", "项目实施五部", "经理", "", ""],
    ["EZT260003", "目标批次", "项目实施五部", "经理", "", ""],
  ]);

  await assert.rejects(
    () => operationPersonnelRunner.openVisiblePersonnelTaskSheet(
      page,
      { batch: { code: "EZT260003", batchName: "目标批次" } },
      { baseUrl: "http://operation.test" },
    ),
    /EZT260003.*目标批次.*精确匹配到 2 行/,
  );
  assert.equal(page.events.some((event) => event.startsWith("click:")), false);
});

test("current personnel task sheet reader parses the unique visible dialog", async () => {
  assert.equal(
    typeof operationPersonnelRunner.readVisiblePersonnelTaskSheet,
    "function",
  );
  const page = {
    locator: (selector) => {
      assert.equal(selector, ".ant-modal:visible");
      return {
        filter: ({ hasText }) => {
          assert.equal(hasText, "任务单发送需满足以下条件");
          return { count: async () => 1 };
        },
      };
    },
    evaluate: async () => visiblePersonnelTaskSheetRaw(),
  };

  const snapshot = await operationPersonnelRunner.readVisiblePersonnelTaskSheet(page);

  assert.equal(snapshot.batch.batchName, "目标批次");
  assert.equal(snapshot.schedules.length, 1);
  assert.equal(snapshot.sendRecords[0].type, "首次发送");
});

test("current personnel task sheet reader blocks duplicate visible dialogs", async () => {
  assert.equal(
    typeof operationPersonnelRunner.readVisiblePersonnelTaskSheet,
    "function",
  );
  const page = {
    locator: () => ({
      filter: () => ({ count: async () => 2 }),
    }),
  };

  await assert.rejects(
    () => operationPersonnelRunner.readVisiblePersonnelTaskSheet(page),
    /分散在线监考任务单弹窗.*实际 2 个/,
  );
});

test("current top-right send record reader uses the visible task sheet table", async () => {
  assert.equal(
    typeof operationPersonnelRunner.readVisibleTopRightSendRecords,
    "function",
  );
  const page = {
    locator: (selector) => {
      assert.equal(selector, ".ant-modal:visible");
      return {
        filter: ({ hasText }) => {
          assert.equal(hasText, "任务单发送需满足以下条件");
          return { count: async () => 1 };
        },
      };
    },
    evaluate: async () => visiblePersonnelTaskSheetRaw({
      sendRecordRows: [
        ["发送时间", "变更内容"],
        ["2026-07-23 10:12:08", "再次发送"],
        ["2026-07-23 10:09:34", "首次发送"],
      ],
    }),
  };

  assert.deepEqual(
    await operationPersonnelRunner.readVisibleTopRightSendRecords(page),
    [
      { type: "再次发送", sentAt: "2026-07-23 10:12:08" },
      { type: "首次发送", sentAt: "2026-07-23 10:09:34" },
    ],
  );
});

test("current top-right send record reader accepts a visible resend change summary", async () => {
  const page = {
    locator: (selector) => {
      assert.equal(selector, ".ant-modal:visible");
      return {
        filter: ({ hasText }) => {
          assert.equal(hasText, "任务单发送需满足以下条件");
          return { count: async () => 1 };
        },
      };
    },
    evaluate: async () => visiblePersonnelTaskSheetRaw({
      sendRecordRows: null,
      timelineSendTexts: [
        "人员落实结束日期调整为2026-08-19；正式考试监考人数由3人调整为80人（按4000人、1:50计算） 2026-07-24 13:38:39",
        "首次发送 2026-07-23 10:09:34",
      ],
    }),
  };

  assert.deepEqual(
    await operationPersonnelRunner.readVisibleTopRightSendRecords(page),
    [
      { type: "再次发送", sentAt: "2026-07-24 13:38:39" },
      { type: "首次发送", sentAt: "2026-07-23 10:09:34" },
    ],
  );
});

test("directory probe uses its reviewed summary in the built-in resend flow", async () => {
  const events = [];
  const button = (name) => ({
    count: async () => 1,
    click: async () => events.push(`click:${name}`),
  });
  const taskDialog = {
    count: async () => 1,
    getByRole: (role, { name }) => {
      assert.equal(role, "button");
      return button(name);
    },
  };
  const mailDialog = { count: async () => 1 };
  const changeDialog = {
    getByRole: (role, { name }) => {
      assert.equal(role, "button");
      return button(name);
    },
  };
  const page = {
    locator(selector) {
      if (selector === ".ant-modal:visible") {
        return {
          filter: ({ hasText }) => {
            if (hasText === "任务单发送需满足以下条件") return taskDialog;
            assert.equal(hasText, "填写收件人邮箱");
            return mailDialog;
          },
        };
      }
      if (selector.includes('placeholder="请填写任务单变更内容"')) {
        return {
          count: async () => 1,
          fill: async (value) => events.push(`fill:${value}`),
        };
      }
      throw new Error(`unexpected selector: ${selector}`);
    },
    getByRole(role) {
      assert.equal(role, "dialog");
      return {
        count: async () => 1,
        last: () => changeDialog,
      };
    },
  };

  await operationPersonnelRunner.openVisiblePersonnelMailDialog(page, {
    directoryProbeSummary: "人员落实结束日期：2026-08-18 → 2026-08-19",
  });

  assert.deepEqual(events, [
    "click:发送任务单",
    "fill:人员落实结束日期：2026-08-18 → 2026-08-19",
    "click:下一步",
  ]);
});

test("current operation console opens the inline 邮件发送 dialog directly", async () => {
  const taskDialog = {
    count: async () => 1,
    getByRole: () => ({
      count: async () => 1,
      click: async () => {},
    }),
  };
  const mailDialog = { count: async () => 1 };
  const missingDialog = {
    count: async () => 0,
    first() {
      return this;
    },
    waitFor: async () => {
      throw new Error("legacy mail dialog title was not rendered");
    },
  };
  const page = {
    locator(selector) {
      if (selector === ".ant-modal:visible") {
        return {
          filter: ({ hasText }) => {
            if (hasText === "任务单发送需满足以下条件") return taskDialog;
            if (hasText === "邮件发送") return mailDialog;
            if (hasText instanceof RegExp && hasText.test("邮件发送")) return mailDialog;
            return missingDialog;
          },
        };
      }
      if (selector.includes('placeholder="请填写任务单变更内容"')) {
        return { count: async () => 0 };
      }
      throw new Error(`unexpected selector: ${selector}`);
    },
  };

  assert.equal(
    await operationPersonnelRunner.openVisiblePersonnelMailDialog(page),
    mailDialog,
  );
});

test("inline mail directory selects recipients without clicking the final confirm button", async () => {
  const events = [];
  let groupChecked = false;
  const checkbox = (name) => ({
    count: async () => 1,
    click: async () => {
      events.push(`click:${name}`);
      if (name === "演练组") groupChecked = true;
    },
    check: async () => events.push(`check:${name}`),
    isChecked: async () => name === "演练组" && groupChecked,
    uncheck: async () => {
      events.push(`uncheck:${name}`);
      if (name === "演练组") groupChecked = false;
    },
  });
  const mailDialog = {
    getByRole: (role, { name }) => {
      assert.equal(role, "checkbox");
      return checkbox(name);
    },
  };
  const page = {
    getByRole: () => {
      throw new Error("inline directory must not open or confirm a nested dialog");
    },
  };

  await operationPersonnelRunner.selectVisiblePersonnelRecipients(
    page,
    mailDialog,
    {
      to: [{ id: "zhanglexiang@ata.net.cn", name: "张乐翔" }],
      cc: [],
    },
    { toGroup: "演练组", ccGroup: "" },
  );

  assert.deepEqual(events, [
    "click:演练组",
    "check:zhanglexiang@ata.net.cn (张乐翔)",
    "uncheck:演练组",
  ]);
});

test("inline mail recipient readback rejects checked groups and reports extra people", async () => {
  let raw = {
    checkedGroups: [],
    checkedPeople: [
      "zhanglexiang@ata.net.cn (张乐翔)",
      "maomengmeng@ata.net.cn (毛萌萌)",
    ],
  };
  const mailDialog = {
    evaluate: async (_callback, groupNames) => {
      assert.deepEqual(groupNames, ["演练组", ""]);
      return raw;
    },
  };

  assert.deepEqual(
    await operationPersonnelRunner.readVisibleExpectedMailRecipients(
      mailDialog,
      {
        to: [{ id: "zhanglexiang@ata.net.cn", name: "张乐翔" }],
        cc: [{ id: "jiesuan1@ata.net.cn", name: "结算一" }],
      },
      { toGroup: "演练组", ccGroup: "" },
    ),
    {
      to: [
        { id: "zhanglexiang@ata.net.cn", name: "张乐翔" },
        { id: "maomengmeng@ata.net.cn", name: "毛萌萌" },
      ],
      cc: [],
    },
  );

  raw = {
    checkedGroups: ["演练组"],
    checkedPeople: ["zhanglexiang@ata.net.cn (张乐翔)"],
  };
  await assert.rejects(
    operationPersonnelRunner.readVisibleExpectedMailRecipients(
      mailDialog,
      {
        to: [{ id: "zhanglexiang@ata.net.cn", name: "张乐翔" }],
        cc: [],
      },
      { toGroup: "演练组", ccGroup: "" },
    ),
    /人员目录组“演练组”仍为整组勾选/,
  );
});

test("recorded recipient grid opens from the value column next to its label", async () => {
  const events = [];
  const control = {
    count: async () => 1,
    click: async () => events.push("recipient-value:click"),
  };
  const row = {
    count: async () => 1,
    locator: (selector) => {
      assert.equal(selector, ":scope > .ant-col");
      return { nth: (index) => {
        assert.equal(index, 1);
        return control;
      } };
    },
  };
  const label = {
    count: async () => 1,
    locator(selector) {
      if (selector.includes("ant-form-item")) return { count: async () => 0 };
      if (selector.includes("ant-row")) return row;
      throw new Error(`unexpected label selector: ${selector}`);
    },
  };
  const dialog = {
    getByLabel: () => ({ count: async () => 0 }),
    getByText: (name, { exact }) => {
      assert.equal(name, "收件人");
      assert.equal(exact, true);
      return label;
    },
  };

  await operationPersonnelRunner.openVisibleMailRecipientDirectory(dialog, "收件人");

  assert.deepEqual(events, ["recipient-value:click"]);
});

test("inline recorded directory does not require a nonexistent cancel button", async () => {
  const dialog = {
    getByText: (value) => {
      assert.equal(value, "填写收件人邮箱");
      return { count: async () => 1 };
    },
  };
  const page = {
    getByRole: (role) => {
      assert.equal(role, "dialog");
      return {
        count: async () => 2,
        last: () => dialog,
      };
    },
  };

  await operationPersonnelRunner.cancelVisibleDirectory(page);
});

test("recorded directory waits for its React group checkbox before reading members", async () => {
  const events = [];
  let ready = false;
  let reads = 0;
  const checkbox = {
    count: async () => ready ? 1 : 0,
    waitFor: async ({ state }) => {
      assert.equal(state, "visible");
      ready = true;
      events.push("group:visible");
    },
    click: async () => events.push("group:click"),
  };
  const dialog = {
    getByRole: (role, { name, exact }) => {
      assert.equal(role, "checkbox");
      assert.equal(name, "演练组");
      assert.equal(exact, true);
      return checkbox;
    },
    evaluate: async () => (
      reads++ === 0 ? [] : ["zhanglexiang@ata.net.cn (张乐翔)"]
    ),
  };

  const people = await operationPersonnelRunner.expandVisibleDirectoryGroup(
    dialog,
    "演练组",
  );

  assert.deepEqual(events, ["group:visible", "group:click"]);
  assert.deepEqual(people, [{
    id: "zhanglexiang@ata.net.cn",
    name: "张乐翔",
  }]);
});

test("inline directory inspection reads members without confirming the mail dialog", async () => {
  const events = [];
  let reads = 0;
  const group = {
    count: async () => 1,
    click: async () => events.push("group:click"),
  };
  const mailDialog = {
    getByRole: (role, { name }) => {
      assert.equal(role, "checkbox");
      assert.equal(name, "演练组");
      return group;
    },
    evaluate: async () => (
      reads++ === 0 ? [] : ["zhanglexiang@ata.net.cn (张乐翔)"]
    ),
  };
  const page = {
    getByRole: () => {
      throw new Error("inline inspection must not confirm the mail dialog");
    },
  };

  assert.deepEqual(
    await operationPersonnelRunner.readVisiblePersonnelDirectoryGroups(
      page,
      mailDialog,
      { toGroup: "演练组", ccGroup: "" },
    ),
    [{
      name: "演练组",
      people: [{ id: "zhanglexiang@ata.net.cn", name: "张乐翔" }],
    }],
  );
  assert.deepEqual(events, ["group:click"]);
});

function validInstruction(overrides = {}) {
  const target = {
    batch: {
      code: "EZT260003",
      projectCode: "P001",
      projectName: "项目一",
      batchName: "批次一",
      projectDepartment: "交付一部",
      projectManager: "项目经理",
      systemType: "易考",
      published: true,
    },
    schedules: [{
      scheduleEntryId: "schedule-1",
      scheduleCode: 1,
      subjectCode: "SUB-1",
      subjectName: "湖北邮政招聘考试",
      start: "2026-08-22T09:00:00",
      end: "2026-08-22T11:00:00",
      durationMinutes: 120,
      earlyLoginMinutes: 30,
    }],
    personnel: {
      serviceType: "ATA 监考－分散在线监考",
      platform: "悦站",
      loginMonitoring: "是",
      monitorRatio: "1:50",
      candidateBasis: 60,
      monitorCount: 2,
      earliestLoginMinutes: 30,
      trialIncluded: false,
    },
    dates: {
      start: "2026-07-23",
      end: "2026-08-19",
      nameListDue: "2026-08-19",
    },
    requirements: [{ name: "在线监考", value: "需要" }],
    taskSheet: {
      type: "分散在线监考",
      conditions: [{ name: "人员配置", satisfied: true }],
      content: "任务内容",
    },
    directoryMatch: {
      to: [{ group: "演练组", id: "u1", name: "张乐翔" }],
      cc: [],
    },
  };
  return {
    environment: "test",
    kind: "initial",
    batch: target.batch,
    managedSchedules: [{
      requirementIndex: 0,
      name: "湖北邮政招聘考试",
      start: "2026-08-22T09:00:00",
      end: "2026-08-22T11:00:00",
    }],
    displaySchedules: [{
      scheduleCode: 1,
      name: "湖北邮政招聘考试",
      start: "2026-08-22T09:00:00",
      end: "2026-08-22T11:00:00",
    }],
    target,
    checkpoints: {},
    ...overrides,
  };
}

function fakeOperationPage(overrides = {}) {
  const target = validInstruction().target;
  return {
    events: [],
    state: {
      batch: { ...target.batch, published: overrides.published === true },
      schedules: overrides.schedules ?? structuredClone(target.schedules),
      personnel: {
        ...target.personnel,
        platform: overrides.personnelPlatform ?? "",
      },
      dates: overrides.dates ?? {},
      requirements: overrides.requirements ?? [],
      taskSheet: overrides.taskSheet ?? target.taskSheet,
      sendRecords: overrides.sendRecords ?? [],
      selectedRecipients: { to: [], cc: [] },
    },
    sendRecordsAfterReopen: overrides.sendRecordsAfterReopen,
  };
}

function fakeOperationContext(page = fakeOperationPage()) {
  return {
    pages: () => [page],
    close: async () => page.events.push("context:close"),
  };
}

function simulatedVisibleOperationPage(overrides = {}) {
  const page = fakeOperationPage({
    published: overrides.published,
    sendRecordsAfterReopen: overrides.sendRecordsAfterReopen,
  });
  page.currentLocation = "batch-list";
  page.url = () => "http://172.16.18.198:8020/batch/batchDetail?batch_guid=test";
  let dialogPurpose = "";
  const publishAccessibleName = overrides.publishAccessibleName ?? "发布";
  const confirmAccessibleName = overrides.confirmAccessibleName ?? "确定";
  const nameMatches = (expected, actual) => (
    expected instanceof RegExp ? expected.test(actual) : expected === actual
  );
  const locator = (count, click, nested = {}) => ({
    count: async () => count,
    click: async () => click?.(),
    getByRole: (role, options = {}) => (
      nested[`${role}:${options.name}`] || locator(0)
    ),
    last() {
      return this;
    },
  });
  const confirm = locator(overrides.confirmCount ?? 1, () => {
    if (dialogPurpose === "publish") {
      page.events.push("publish:confirm:visible");
      if (overrides.delayedPublishState) {
        page.pendingPublished = true;
      } else {
        page.state.batch.published = true;
      }
    } else {
      page.events.push("send:confirm:visible");
      page.state.sendRecords = [{
        type: "首次发送",
        sentAt: "2026-07-23T03:00:00.000Z",
      }];
    }
    dialogPurpose = "";
  });
  const dialog = locator(1);
  dialog.getByRole = (role, options = {}) => (
    role === "button" && nameMatches(options.name, confirmAccessibleName)
      ? confirm
      : locator(0)
  );
  const sendRecordLocator = (records) => ({
    count: async () => records.length,
    nth: (index) => ({
      getAttribute: async (name) => (
        name === "data-send-type" ? records[index].type : records[index].sentAt
      ),
    }),
  });
  const sendRecordContainer = {
    count: async () => overrides.sendRecordContainerCount ?? 1,
    locator: () => sendRecordLocator(overrides.visibleSendRecords || []),
  };
  page.getByRole = (role, options = {}) => {
    if (role === "button" && nameMatches(options.name, publishAccessibleName)) {
      const publishCount = overrides.publishCount ?? (
        overrides.publishOnlyOnBatchDetail && page.currentLocation !== "batch-detail"
          ? 0
          : 1
      );
      return locator(publishCount, () => {
        page.events.push("publish:click:visible");
        dialogPurpose = "publish";
      });
    }
    if (role === "dialog") return dialog;
    return locator(0);
  };
  page.locator = (selector) => (
    selector === "[data-operation-send-records]:visible"
      ? sendRecordContainer
      : locator(0)
  );
  page.waitForFunction = async () => {
    page.events.push("publish:wait:visible");
    if (page.pendingPublished) {
      page.state.batch.published = true;
      page.pendingPublished = false;
    }
  };
  page.waitForResponse = async (matches) => {
    page.events.push("publish:response:wait");
    const response = {
      url: () => "http://172.16.18.198:8020/api/batch/save_push_status",
      request: () => ({
        method: () => "POST",
        resourceType: () => "xhr",
      }),
      ok: () => true,
      status: () => 200,
      finished: async () => null,
      json: async () => {
        page.events.push("publish:response:read");
        return { code: 10, message: null, data: null };
      },
    };
    assert.equal(matches(response), true);
    return response;
  };
  return page;
}

function advancingClock(start = Date.parse("2026-07-23T02:00:00.000Z")) {
  let current = start;
  return () => {
    const value = current;
    current += 1000;
    return value;
  };
}

function attemptOptions(page = fakeOperationPage(), overrides = {}) {
  return {
    context: fakeOperationContext(page),
    readBatchPages: async () => exactBatchPages(),
    openBatchRow: async () => page.events.push("batch:open"),
    openEztestSchedulePage: async () => page.events.push("exam-schedule:open"),
    readBatch: async () => ({ ...page.state.batch }),
    readSchedules: async () => page.state.schedules,
    readPersonnel: async () => page.state.personnel,
    readDates: async () => page.state.dates,
    readRequirements: async () => page.state.requirements,
    readTaskSheet: async () => page.state.taskSheet,
    readTaskSheetSchedules: async () => page.state.schedules,
    readSendRecords: async () => page.state.sendRecords,
    readDirectoryGroups: async () => [
      { name: "演练组", people: [{ id: "u1", name: "张乐翔" }] },
    ],
    publishBatch: async () => {
      page.events.push("publish:click");
      page.state.batch.published = true;
    },
    syncExamSchedules: async () => {
      throw new Error("人员任务不得写考试日程");
    },
    findScheduleRows: async () => {
      throw new Error("人员任务不得定位待删除日程");
    },
    deleteSchedule: async () => {
      throw new Error("人员任务不得删除考试日程");
    },
    syncPersonnelConfig: async (_actualPage, personnel) => {
      page.events.push("personnel:fill");
      page.state.personnel = structuredClone(personnel);
    },
    syncPersonnelDates: async (_actualPage, dates) => {
      page.events.push("dates:fill");
      page.state.dates = structuredClone(dates);
    },
    syncExamServiceRequirements: async (_actualPage, requirements) => {
      page.events.push("requirements:fill");
      page.state.requirements = structuredClone(requirements);
    },
    openTaskSheet: async () => page.events.push("task-sheet:open"),
    selectRecipients: async (_actualPage, recipients) => {
      page.events.push("recipients:select");
      page.state.selectedRecipients = structuredClone(recipients);
    },
    readSelectedRecipients: async () => page.state.selectedRecipients,
    confirmSend: async (_actualPage, attempt) => {
      page.events.push("send:confirm");
      if (page.sendRecordsAfterReopen === undefined) {
        page.state.sendRecords.push({
          type: attempt.kind === "resend" ? "再次发送" : "首次发送",
          sentAt: new Date(Date.parse(attempt.startedAt) + 1000).toISOString(),
        });
      }
    },
    closeTaskSheet: async () => page.events.push("task-sheet:close"),
    reopenTaskSheet: async () => {
      page.events.push("task-sheet:reopen");
      if (page.sendRecordsAfterReopen !== undefined) {
        page.state.sendRecords = structuredClone(page.sendRecordsAfterReopen);
      }
    },
    sleep: async () => {},
    now: advancingClock(),
    ...overrides,
  };
}

function exactBatchPages(rows = [{ cells: ["EZT260003"], rowId: "target" }]) {
  return {
    headers: ["批次代码"],
    pages: [rows],
  };
}

function inspectionReaders(overrides = {}) {
  return {
    readBatchPages: async () => exactBatchPages(),
    openBatchRow: async () => {},
    readBatch: async () => ({ code: "EZT260003" }),
    readSchedules: async () => [],
    readPersonnel: async () => ({}),
    readDates: async () => ({}),
    readRequirements: async () => [],
    readTaskSheet: async () => ({}),
    readSendRecords: async () => [],
    readDirectoryGroups: async () => [
      { name: "演练组", people: [{ id: "u1", name: "张乐翔" }] },
    ],
    ...overrides,
  };
}

function visibleSnapshot(evidence = {}) {
  return {
    batch: { code: "EZT260003" },
    schedules: [],
    personnel: { platform: "" },
    dates: {},
    requirements: [],
    taskSheet: {},
    sendRecords: [],
    directoryGroups: [
      { name: "演练组", people: [{ id: "u1", name: "张乐翔" }] },
    ],
    evidence: {
      batch: { present: true },
      schedules: { present: true },
      personnel: { present: true },
      dates: { present: true },
      requirements: { present: true },
      taskSheet: { present: true },
      sendRecords: { present: true },
      directoryGroups: { present: true },
      ...evidence,
    },
  };
}

test("attempt applies checkpoints in the approved order", async () => {
  const observed = [];
  await operationPersonnelRunner.runOperationPersonnelAttempt(validInstruction(), attemptOptions(
    fakeOperationPage(),
    { onCheckpoint: async ({ name, status }) => observed.push(`${name}:${status}`) },
  ));
  assert.deepEqual(observed.filter((item) => item.endsWith(":completed")), [
    "inspect_batch:completed",
    "publish_batch:completed",
    "verify_exam_schedules:completed",
    "sync_personnel_config:completed",
    "sync_personnel_dates:completed",
    "sync_exam_service_requirements:completed",
    "verify_task_sheet:completed",
    "select_recipients:completed",
    "submit_send:completed",
    "verify_send_record:completed",
  ]);
});

test("unified attempt verifies once and confirms send directly after final readbacks", async () => {
  const page = fakeOperationPage({
    published: true,
    personnelPlatform: "",
    dates: {},
    requirements: validInstruction().target.requirements,
  });
  const events = [];
  let scheduleReads = 0;
  let taskSheetScheduleReads = 0;
  let recipientReads = 0;
  let runnerPages = 0;
  const context = {
    pages: () => {
      runnerPages += 1;
      return [page];
    },
    close: async () => {},
  };

  await operationPersonnelRunner.runOperationPersonnelAttempt(validInstruction(), attemptOptions(page, {
    context,
    readBatch: async (actualPage) => {
      assert.equal(actualPage, page);
      events.push("read_batch");
      return { ...page.state.batch };
    },
    readSchedules: async (actualPage) => {
      assert.equal(actualPage, page);
      scheduleReads += 1;
      if (scheduleReads === 2) events.push("verify_exam_schedules");
      return page.state.schedules;
    },
    syncPersonnelConfig: async (_actualPage, personnel) => {
      events.push("sync_personnel_config");
      page.state.personnel = structuredClone(personnel);
    },
    syncPersonnelDates: async (_actualPage, dates) => {
      events.push("sync_personnel_dates");
      page.state.dates = structuredClone(dates);
    },
    openTaskSheet: async () => events.push("verify_task_sheet"),
    selectRecipients: async (_actualPage, recipients) => {
      events.push("resolve_recipients");
      page.state.selectedRecipients = structuredClone(recipients);
    },
    readTaskSheetSchedules: async () => {
      taskSheetScheduleReads += 1;
      if (taskSheetScheduleReads === 2) events.push("final_read_schedules");
      return page.state.schedules;
    },
    readSelectedRecipients: async () => {
      recipientReads += 1;
      if (recipientReads === 2) events.push("final_read_recipients");
      return page.state.selectedRecipients;
    },
    onCheckpoint: async ({ name, status }) => {
      if (name === "submit_send" && status === "running") {
        events.push("submit_send_running");
      }
    },
    confirmSend: async (actualPage, attempt) => {
      assert.equal(actualPage, page);
      events.push("confirm_send");
      page.state.sendRecords.push({
        type: attempt.kind === "resend" ? "再次发送" : "首次发送",
        sentAt: new Date(Date.parse(attempt.startedAt) + 1000).toISOString(),
      });
    },
  }));

  assert.deepEqual(events, [
    "read_batch",
    "verify_exam_schedules",
    "sync_personnel_config",
    "sync_personnel_dates",
    "verify_task_sheet",
    "resolve_recipients",
    "final_read_schedules",
    "final_read_recipients",
    "submit_send_running",
    "confirm_send",
  ]);
  assert.equal(runnerPages, 1);
  assert.equal(events.filter((event) => event === "confirm_send").length, 1);
});

test("final schedule readback accepts reordered exact code and content rows", async () => {
  const instruction = validInstruction();
  instruction.managedSchedules.push({
    requirementIndex: 1,
    name: "专业知识",
    start: "2026-08-22T14:00:00",
    end: "2026-08-22T16:00:00",
  });
  instruction.displaySchedules = [
    {
      scheduleCode: 88,
      name: "湖北邮政招聘考试",
      start: "2026-08-22T09:00:00",
      end: "2026-08-22T11:00:00",
    },
    {
      scheduleCode: 17,
      name: "专业知识",
      start: "2026-08-22T14:00:00",
      end: "2026-08-22T16:00:00",
    },
  ];
  instruction.target.schedules = [
    {
      scheduleCode: 88,
      subjectName: "湖北邮政招聘考试",
      start: "2026-08-22T09:00:00",
      end: "2026-08-22T11:00:00",
    },
    {
      scheduleCode: 17,
      subjectName: "专业知识",
      start: "2026-08-22T14:00:00",
      end: "2026-08-22T16:00:00",
    },
  ];
  const page = fakeOperationPage({
    schedules: [...instruction.target.schedules].reverse(),
  });

  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    instruction,
    attemptOptions(page),
  );

  assert.equal(result.status, "sent");
  assert.equal(page.events.filter((item) => item === "send:confirm").length, 1);
});

test("final schedule readback blocks recreated, missing, or duplicate exact codes before submit", async () => {
  for (const scheduleCode of [2, "", 1]) {
    const page = fakeOperationPage();
    const checkpoints = [];
    const options = attemptOptions(page, {
      selectRecipients: async (_actualPage, recipients) => {
        page.state.selectedRecipients = structuredClone(recipients);
        page.state.schedules[0].scheduleCode = scheduleCode;
        if (scheduleCode === 1) {
          page.state.schedules.push({
            ...page.state.schedules[0],
            scheduleEntryId: "schedule-duplicate",
          });
        }
      },
      onCheckpoint: async ({ name, status }) => checkpoints.push(`${name}:${status}`),
    });

    await assert.rejects(
      operationPersonnelRunner.runOperationPersonnelAttempt(validInstruction(), options),
      { code: "PERSONNEL_BATCH_SCHEDULE_CONFLICT" },
    );
    assert.equal(
      checkpoints.some((item) => item.startsWith("submit_send:")),
      false,
    );
    assert.equal(page.events.includes("send:confirm"), false);
  }
});

test("final schedule readback drift blocks before submit and confirm", async () => {
  const page = fakeOperationPage();
  const events = [];
  const options = attemptOptions(page, {
    selectRecipients: async (_actualPage, recipients) => {
      page.state.selectedRecipients = structuredClone(recipients);
      page.state.schedules = [{
        ...page.state.schedules[0],
        end: "2026-08-22T12:00:00",
      }];
    },
    readTaskSheetSchedules: async () => {
      events.push("final_read_schedules");
      return page.state.schedules;
    },
    onCheckpoint: async ({ name, status }) => {
      if (name === "submit_send" && status === "running") {
        events.push("submit_send_running");
      }
    },
    confirmSend: async () => events.push("confirm_send"),
  });

  await assert.rejects(
    operationPersonnelRunner.runOperationPersonnelAttempt(validInstruction(), options),
    { code: "PERSONNEL_BATCH_SCHEDULE_CONFLICT" },
  );
  assert.equal(events.includes("submit_send_running"), false);
  assert.equal(events.includes("confirm_send"), false);
});

test("final recipient readback drift blocks before submit and confirm", async () => {
  const page = fakeOperationPage();
  const events = [];
  let recipientReads = 0;
  const options = attemptOptions(page, {
    readSelectedRecipients: async () => {
      recipientReads += 1;
      if (recipientReads === 1) return page.state.selectedRecipients;
      return { to: [{ id: "other", name: "其他人员" }], cc: [] };
    },
    onCheckpoint: async ({ name, status }) => {
      if (name === "submit_send" && status === "running") {
        events.push("submit_send_running");
      }
    },
    confirmSend: async () => events.push("confirm_send"),
  });

  await assert.rejects(
    operationPersonnelRunner.runOperationPersonnelAttempt(validInstruction(), options),
    { code: "PERSONNEL_OPERATION_CONFLICT" },
  );
  assert.equal(events.includes("submit_send_running"), false);
  assert.equal(events.includes("confirm_send"), false);
});

test("attempt verifies schedules read only and never invokes schedule mutation", async () => {
  const page = fakeOperationPage();
  const observed = [];
  await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page, {
      onCheckpoint: async ({ name, status }) => observed.push(`${name}:${status}`),
    }),
  );
  assert.ok(observed.includes("verify_exam_schedules:completed"));
  assert.equal(observed.some((item) => item.startsWith("sync_exam_schedules:")), false);
  assert.equal(page.events.includes("schedules:fill"), false);
});

test("legacy completed schedule sync is reverified read only", async () => {
  const instruction = validInstruction();
  instruction.checkpoints.sync_exam_schedules = {
    status: "completed",
    targetDigest: "legacy",
  };
  const observed = [];
  await operationPersonnelRunner.runOperationPersonnelAttempt(
    instruction,
    attemptOptions(fakeOperationPage(), {
      onCheckpoint: async ({ name, status }) => observed.push(`${name}:${status}`),
    }),
  );
  assert.ok(observed.includes("verify_exam_schedules:completed"));
});

test("schedule checkpoint reopens the exam page after publication readback navigation", async () => {
  const page = fakeOperationPage({ published: true });
  let scheduleReads = 0;
  let schedulePageReady = false;

  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page, {
      readSchedules: async () => {
        scheduleReads += 1;
        if (scheduleReads > 1 && !schedulePageReady) {
          throw new Error("考试日程页未打开");
        }
        return page.state.schedules;
      },
      openEztestSchedulePage: async () => {
        schedulePageReady = true;
      },
    }),
  );

  assert.equal(result.status, "sent");
  assert.equal(schedulePageReady, true);
});

test("blocks before recipient selection when task-sheet schedules drift behind matching background schedules", async () => {
  const page = fakeOperationPage();
  page.locator = (selector) => {
    assert.equal(selector, ".ant-modal:visible");
    return {
      filter: ({ hasText }) => {
        assert.equal(hasText, "任务单发送需满足以下条件");
        return { count: async () => 1 };
      },
    };
  };
  page.evaluate = async () => visiblePersonnelTaskSheetRaw({
    scheduleRows: [
      ["1", "1", "2026-08-22 09:00~11:00", "120", "错误考试名称", "30"],
    ],
  });

  const options = attemptOptions(page);
  delete options.readTaskSheetSchedules;
  await assert.rejects(
    operationPersonnelRunner.runOperationPersonnelAttempt(validInstruction(), options),
    (error) => error.code === "PERSONNEL_BATCH_SCHEDULE_CONFLICT"
      && /请先在建批次环节完成批次信息修改/.test(error.message),
  );
  assert.equal(page.events.includes("recipients:select"), false);
  assert.equal(page.events.includes("send:confirm"), false);
});

test("blocks before recipient selection when task-sheet schedules are unreadable", async () => {
  const page = fakeOperationPage();
  page.locator = () => ({
    filter: () => ({ count: async () => 0 }),
  });

  const options = attemptOptions(page);
  delete options.readTaskSheetSchedules;
  await assert.rejects(
    operationPersonnelRunner.runOperationPersonnelAttempt(validInstruction(), options),
    /分散在线监考任务单弹窗/,
  );
  assert.equal(page.events.includes("recipients:select"), false);
  assert.equal(page.events.includes("send:confirm"), false);
});

test("blocks before final send when task-sheet schedules drift during recipient selection", async () => {
  const page = fakeOperationPage();
  const checkpoints = [];
  const options = attemptOptions(page, {
    onCheckpoint: async ({ name, status }) => checkpoints.push(`${name}:${status}`),
    selectRecipients: async (_actualPage, recipients) => {
      page.events.push("recipients:select");
      page.state.selectedRecipients = structuredClone(recipients);
      page.state.schedules = [{
        ...page.state.schedules[0],
        subjectName: "收件人选择期间发生变化",
      }];
    },
  });

  await assert.rejects(
    operationPersonnelRunner.runOperationPersonnelAttempt(validInstruction(), options),
    (error) => error.code === "PERSONNEL_BATCH_SCHEDULE_CONFLICT",
  );
  assert.equal(page.events.includes("recipients:select"), true);
  assert.equal(page.events.includes("send:confirm"), false);
  assert.equal(checkpoints.some((item) => item.startsWith("submit_send:")), false);
});

test("blocks before final send when selected recipients drift after checkpoint verification", async () => {
  const page = fakeOperationPage();
  let recipientReads = 0;
  const options = attemptOptions(page, {
    readSelectedRecipients: async () => {
      recipientReads += 1;
      if (recipientReads === 1) return page.state.selectedRecipients;
      return {
        to: [{ id: "unexpected", name: "其他人员" }],
        cc: [],
      };
    },
  });

  await assert.rejects(
    operationPersonnelRunner.runOperationPersonnelAttempt(validInstruction(), options),
    (error) => error.code === "PERSONNEL_OPERATION_CONFLICT"
      && /select_recipients/.test(error.message),
  );
  assert.equal(recipientReads, 2);
  assert.equal(page.events.includes("send:confirm"), false);
});

test("unpublished initial attempt publishes before opening the task sheet and resolving recipients", async () => {
  const page = fakeOperationPage();
  const instruction = validInstruction();
  instruction.target.directoryMatch = { to: [], cc: [] };
  instruction.baseline = structuredClone(instruction.target);
  const options = attemptOptions(page, {
    readDirectoryGroups: async () => {
      page.events.push("directory:read");
      return [{ name: "演练组", people: [{ id: "u1", name: "张乐翔" }] }];
    },
  });

  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    instruction,
    options,
  );

  assert.equal(result.status, "sent");
  assert.ok(page.events.indexOf("publish:click") < page.events.indexOf("task-sheet:open"));
  assert.ok(page.events.indexOf("publish:click") < page.events.indexOf("directory:read"));
  assert.deepEqual(result.operationSnapshot.directoryMatch, {
    to: [{ group: "演练组", id: "u1", name: "张乐翔" }],
    cc: [],
  });
});

test("unpublished visible attempt restores the exact batch detail after schedule preview before publishing", async () => {
  const page = simulatedVisibleOperationPage({ publishOnlyOnBatchDetail: true });

  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page, {
      openBatchRow: async () => {
        page.events.push("batch:open");
        page.currentLocation = "batch-detail";
      },
      openEztestSchedulePage: async () => {
        page.events.push("exam-schedule:open");
        page.currentLocation = "exam-schedule";
      },
      publishBatch: undefined,
      confirmSend: undefined,
    }),
  );

  assert.equal(result.status, "sent");
  const schedulePreviewIndex = page.events.indexOf("exam-schedule:open");
  const publishIndex = page.events.indexOf("publish:click:visible");
  assert.ok(schedulePreviewIndex >= 0);
  assert.ok(publishIndex > schedulePreviewIndex);
  assert.ok(
    page.events.slice(schedulePreviewIndex + 1, publishIndex).includes("batch:open"),
    "the exact batch detail must be reopened after schedule preview and before publishing",
  );
});

test("default visible adapter uniquely matches the real spaced publish button name", async () => {
  const page = simulatedVisibleOperationPage({
    publishAccessibleName: "发 布",
    publishOnlyOnBatchDetail: true,
  });

  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page, {
      openBatchRow: async () => {
        page.events.push("batch:open");
        page.currentLocation = "batch-detail";
      },
      openEztestSchedulePage: async () => {
        page.events.push("exam-schedule:open");
        page.currentLocation = "exam-schedule";
      },
      publishBatch: undefined,
      confirmSend: undefined,
    }),
  );

  assert.equal(result.status, "sent");
  assert.equal(page.events.filter((item) => item === "publish:click:visible").length, 1);
});

test("default visible adapter uniquely matches the real spaced confirm button name", async () => {
  const page = simulatedVisibleOperationPage({
    publishAccessibleName: "发 布",
    confirmAccessibleName: "确 定",
    publishOnlyOnBatchDetail: true,
  });

  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page, {
      openBatchRow: async () => {
        page.events.push("batch:open");
        page.currentLocation = "batch-detail";
      },
      openEztestSchedulePage: async () => {
        page.events.push("exam-schedule:open");
        page.currentLocation = "exam-schedule";
      },
      publishBatch: undefined,
      confirmSend: undefined,
    }),
  );

  assert.equal(result.status, "sent");
  assert.equal(page.events.filter((item) => item === "publish:confirm:visible").length, 1);
});

test("default visible adapter waits for the real published state before readback", async () => {
  const page = simulatedVisibleOperationPage({
    publishAccessibleName: "发 布",
    confirmAccessibleName: "确 定",
    publishOnlyOnBatchDetail: true,
    delayedPublishState: true,
  });

  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page, {
      openBatchRow: async () => {
        page.events.push("batch:open");
        page.currentLocation = "batch-detail";
      },
      openEztestSchedulePage: async () => {
        page.events.push("exam-schedule:open");
        page.currentLocation = "exam-schedule";
      },
      publishBatch: undefined,
      confirmSend: undefined,
    }),
  );

  assert.equal(result.status, "sent");
  assert.equal(page.events.filter((item) => item === "publish:wait:visible").length, 1);
});

test("default visible adapter completes the publish response before status readback", async () => {
  const page = simulatedVisibleOperationPage({
    publishAccessibleName: "发 布",
    confirmAccessibleName: "确 定",
    publishOnlyOnBatchDetail: true,
  });

  await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page, {
      openBatchRow: async () => {
        page.events.push("batch:open");
        page.currentLocation = "batch-detail";
      },
      openEztestSchedulePage: async () => {
        page.events.push("exam-schedule:open");
        page.currentLocation = "exam-schedule";
      },
      publishBatch: undefined,
      confirmSend: undefined,
    }),
  );

  assert.ok(
    page.events.indexOf("publish:confirm:visible")
      < page.events.indexOf("publish:response:read"),
  );
  assert.ok(
    page.events.indexOf("publish:response:read")
      < page.events.indexOf("publish:wait:visible"),
  );
});

test("published batches skip the publish click but still complete the checkpoint", async () => {
  const page = fakeOperationPage({ published: true });
  await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page),
  );
  assert.equal(page.events.filter((item) => item === "publish:click").length, 0);
});

test("published inspection evidence survives navigation to the task sheet", async () => {
  const page = fakeOperationPage({ published: true });
  let batchReads = 0;
  await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page, {
      readBatch: async () => {
        batchReads += 1;
        if (batchReads > 1) throw new Error("batch detail is no longer visible");
        return { ...page.state.batch };
      },
    }),
  );
  assert.equal(batchReads, 1);
});

test("schedule verification rereads task-sheet schedules before final send while other sections reuse inspection", async () => {
  const page = fakeOperationPage({
    published: true,
    schedules: validInstruction().target.schedules,
    personnelPlatform: "悦站",
  });
  let scheduleReads = 0;
  let taskSheetScheduleReads = 0;
  let personnelReads = 0;
  await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page, {
      readSchedules: async () => {
        scheduleReads += 1;
        if (scheduleReads > 3) throw new Error("schedule reader should not run again");
        return page.state.schedules;
      },
      readTaskSheetSchedules: async () => {
        taskSheetScheduleReads += 1;
        if (taskSheetScheduleReads > 2) throw new Error("task-sheet schedule reader should not run again");
        return page.state.schedules;
      },
      readPersonnel: async () => {
        personnelReads += 1;
        if (personnelReads > 1) throw new Error("personnel editor is no longer visible");
        return page.state.personnel;
      },
    }),
  );
  assert.equal(scheduleReads, 2);
  assert.equal(taskSheetScheduleReads, 2);
  assert.equal(personnelReads, 1);
});

test("requirement-managed personnel changes do not edit personnel config", async () => {
  const baseline = structuredClone(validInstruction().target);
  baseline.personnel.candidateBasis = "";
  baseline.personnel.monitorCount = 3;
  baseline.requirements = [{
    name: "正式考试-监考人员数量",
    value: "3",
  }];
  const target = structuredClone(baseline);
  target.personnel.candidateBasis = 60;
  target.personnel.monitorCount = 2;
  target.requirements = [{
    name: "正式考试-监考人员数量",
    value: "2",
  }];
  const page = fakeOperationPage({
    published: true,
    schedules: baseline.schedules,
    personnelPlatform: baseline.personnel.platform,
    dates: baseline.dates,
    requirements: baseline.requirements,
    taskSheet: target.taskSheet,
  });
  page.state.personnel = structuredClone(baseline.personnel);

  await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction({
      kind: "resend",
      baseline,
      target,
      changeSummary: "正式考试监考人数调整",
    }),
    attemptOptions(page),
  );

  assert.equal(page.events.includes("personnel:fill"), false);
  assert.equal(page.events.includes("requirements:fill"), true);
});

test("personnel configuration saved with dates does not reopen the same editor", async () => {
  const page = fakeOperationPage({ dates: {} });
  let dateEditorCalls = 0;

  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page, {
      syncPersonnelConfig: async (_actualPage, personnel, _current, instruction) => {
        page.state.personnel = structuredClone(personnel);
        page.state.dates = structuredClone(instruction.target.dates);
      },
      syncPersonnelDates: async () => {
        dateEditorCalls += 1;
      },
    }),
  );

  assert.equal(result.status, "sent");
  assert.equal(dateEditorCalls, 0);
});

test("normal pages use the concrete visible adapter for publish and final confirm", async () => {
  const page = simulatedVisibleOperationPage();
  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page, {
      publishBatch: undefined,
      confirmSend: undefined,
    }),
  );
  assert.equal(result.status, "sent");
  assert.deepEqual(page.events.filter((item) => item.endsWith(":visible")), [
    "publish:click:visible",
    "publish:confirm:visible",
    "publish:wait:visible",
    "send:confirm:visible",
  ]);
});

test("visible schedule adapter reports a structured conflict for duplicate exact rows", async () => {
  const schedule = {
    scheduleEntryId: "schedule-1",
    scheduleCode: 1,
  };
  const row = {
    getAttribute: async () => "schedule-1",
    locator: (selector) => {
      assert.equal(selector, "td");
      return { allInnerTexts: async () => ["1", "schedule-1"] };
    },
  };
  const page = {
    locator: (selector) => {
      assert.equal(selector, "table:visible tbody tr");
      return {
        count: async () => 2,
        nth: () => row,
      };
    },
  };

  await assert.rejects(
    operationPersonnelRunner.editVisibleSchedule(page, schedule, schedule),
    (error) => {
      assert.notEqual(error.name, "ReferenceError");
      assert.equal(error.code, "PERSONNEL_SCHEDULE_NOT_UNIQUE");
      assert.equal(error.status, 409);
      return true;
    },
  );
});

test("default visible adapter blocks missing or ambiguous publish controls before clicking", async () => {
  for (const publishCount of [0, 2]) {
    const page = simulatedVisibleOperationPage({ publishCount });
    await assert.rejects(() => operationPersonnelRunner.runOperationPersonnelAttempt(
      validInstruction(),
      attemptOptions(page, { publishBatch: undefined }),
    ), { code: "PERSONNEL_OPERATION_CONTROL_AMBIGUOUS" });
    assert.equal(page.events.includes("publish:click:visible"), false);
    assert.equal(page.events.includes("send:confirm"), false);
  }
});

test("default visible adapter blocks an ambiguous final confirm before clicking", async () => {
  const page = simulatedVisibleOperationPage({ published: true, confirmCount: 2 });
  await assert.rejects(() => operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page, { confirmSend: undefined }),
  ), { code: "PERSONNEL_OPERATION_CONTROL_AMBIGUOUS" });
  assert.equal(page.events.includes("send:confirm:visible"), false);
});

test("default visible adapter reads top-right send records in visible DOM order", async () => {
  const page = simulatedVisibleOperationPage({
    visibleSendRecords: [
      { type: "首次发送", sentAt: "2026-07-23T02:00:01.000Z" },
      { type: "首次发送", sentAt: "2026-07-23T02:00:02.000Z" },
    ],
  });
  const result = await operationPersonnelRunner.runOperationPersonnelRecheck(
    {
      ...validInstruction(),
      attempt: { kind: "initial", startedAt: "2026-07-23T02:00:00.000Z" },
    },
    attemptOptions(page, { readSendRecords: undefined }),
  );
  assert.equal(result.status, "sent");
  assert.equal(result.sendRecord.sentAt, "2026-07-23T02:00:01.000Z");
});

test("default visible adapter blocks an ambiguous send-record container", async () => {
  const page = simulatedVisibleOperationPage({ sendRecordContainerCount: 2 });
  await assert.rejects(() => operationPersonnelRunner.runOperationPersonnelRecheck(
    {
      ...validInstruction(),
      attempt: { kind: "initial", startedAt: "2026-07-23T02:00:00.000Z" },
    },
    attemptOptions(page, { readSendRecords: undefined }),
  ), { code: "PERSONNEL_OPERATION_CONTROL_AMBIGUOUS" });
});

test("never retries the final send click when the send record is delayed", async () => {
  const page = fakeOperationPage({ sendRecordsAfterReopen: [] });
  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page),
  );
  assert.equal(page.events.filter((item) => item === "send:confirm").length, 1);
  assert.equal(page.events.filter((item) => item === "task-sheet:reopen").length, 1);
  assert.equal(result.status, "result_unknown");
});

test("resend accepts a delayed new record after reopening without clicking send twice", async () => {
  const oldRecord = {
    type: "首次发送",
    sentAt: "2026-07-23T01:59:00.000Z",
  };
  const target = {
    ...validInstruction().target,
    sendRecords: [oldRecord],
  };
  const page = fakeOperationPage({
    published: true,
    schedules: target.schedules,
    personnelPlatform: target.personnel.platform,
    dates: target.dates,
    requirements: target.requirements,
    sendRecords: [oldRecord],
    sendRecordsAfterReopen: [{
      type: "再次发送",
      sentAt: "2026-07-23T02:00:01.000Z",
    }],
  });
  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction({
      kind: "resend",
      baseline: target,
      target,
      changeSummary: "人员落实结束日期调整",
    }),
    attemptOptions(page),
  );

  assert.equal(page.events.filter((item) => item === "send:confirm").length, 1);
  assert.equal(page.events.filter((item) => item === "task-sheet:reopen").length, 1);
  assert.equal(result.status, "sent");
  assert.equal(result.sendRecord.type, "再次发送");
});

test("resend only accepts a record later than attempt start", () => {
  assert.equal(operationPersonnelRunner.findAttemptSendRecord([
    { type: "再次发送", sentAt: "2026-07-23T01:59:59.000Z" },
  ], {
    kind: "resend",
    startedAt: "2026-07-23T02:00:00.000Z",
  }), null);
  assert.equal(operationPersonnelRunner.findAttemptSendRecord([
    { type: "再次发送", sentAt: "2026-07-23T02:00:01.000Z" },
  ], {
    kind: "resend",
    startedAt: "2026-07-23T02:00:00.000Z",
  }).sentAt, "2026-07-23T02:00:01.000Z");
});

test("send record matching only accepts a fresh top-right record for both attempt kinds", () => {
  const startedAt = "2026-07-23T02:00:00.000Z";
  assert.equal(operationPersonnelRunner.findAttemptSendRecord([
    { type: "首次发送", sentAt: "2026-07-23T01:59:59.000Z" },
  ], { kind: "initial", startedAt }), null);
  assert.equal(operationPersonnelRunner.findAttemptSendRecord([
    { type: "其它记录", sentAt: "2026-07-23T02:00:02.000Z" },
    { type: "首次发送", sentAt: "2026-07-23T02:00:01.000Z" },
  ], { kind: "initial", startedAt }).sentAt, "2026-07-23T02:00:01.000Z");
  assert.equal(operationPersonnelRunner.findAttemptSendRecord([
    { type: "首次发送", sentAt: "not-a-time" },
  ], { kind: "initial", startedAt }), null);
  assert.equal(operationPersonnelRunner.findAttemptSendRecord([
    { type: "首次发送", sentAt: "2026-07-23T02:00:01.000Z" },
  ], { kind: "initial", startedAt }).sentAt, "2026-07-23T02:00:01.000Z");
  assert.equal(operationPersonnelRunner.findAttemptSendRecord([
    { type: "首次发送", sentAt: "2026-07-23T01:59:59.000Z" },
    { type: "首次发送", sentAt: "2026-07-23T02:00:02.000Z" },
  ], { kind: "initial", startedAt }).sentAt, "2026-07-23T02:00:02.000Z");
});

test("completed checkpoint persistence failure after the click resumes without another click", async () => {
  const page = fakeOperationPage();
  let durableSubmit;
  await assert.rejects(() => operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page, {
      onCheckpoint: async (update) => {
        if (update.name !== "submit_send") return;
        if (update.status === "running") durableSubmit = structuredClone(update);
        if (update.status === "completed") throw new Error("checkpoint persistence failed");
      },
    }),
  ), /checkpoint persistence failed/);
  assert.equal(page.events.filter((item) => item === "send:confirm").length, 1);
  assert.equal(durableSubmit.status, "running");
  assert.equal(durableSubmit.readback.kind, "initial");
  assert.match(durableSubmit.readback.startedAt, /^2026-07-23T/);

  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction({ checkpoints: { submit_send: durableSubmit } }),
    attemptOptions(page),
  );
  assert.equal(page.events.filter((item) => item === "send:confirm").length, 1);
  assert.equal(result.status, "sent");
});

test("a durable running submit checkpoint never clicks during resume", async () => {
  const page = fakeOperationPage({ sendRecordsAfterReopen: [] });
  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction({
      checkpoints: {
        submit_send: {
          name: "submit_send",
          status: "running",
          readback: {
            kind: "initial",
            startedAt: "2026-07-23T02:00:00.000Z",
          },
        },
      },
    }),
    attemptOptions(page),
  );
  assert.equal(page.events.includes("send:confirm"), false);
  assert.equal(result.status, "result_unknown");
});

test("recheck is read-only", async () => {
  const page = fakeOperationPage({ sendRecords: [] });
  await operationPersonnelRunner.runOperationPersonnelRecheck(
    {
      ...validInstruction(),
      attempt: { kind: "initial", startedAt: "2026-07-23T02:00:00.000Z" },
    },
    attemptOptions(page),
  );
  assert.equal(page.events.some((item) => (
    /publish|fill|delete|send:confirm|recipients:select/.test(item)
  )), false);
  assert.equal(page.events.filter((item) => item === "task-sheet:open").length, 1);
});

test("resume skips a verified checkpoint and blocks drift before continuing", async () => {
  const captured = {};
  await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(fakeOperationPage(), {
      onCheckpoint: async (update) => {
        if (update.status === "completed") captured[update.name] = update;
      },
    }),
  );

  const matching = fakeOperationPage({ personnelPlatform: "悦站" });
  await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction({
      checkpoints: { sync_personnel_config: captured.sync_personnel_config },
    }),
    attemptOptions(matching),
  );
  assert.equal(matching.events.includes("personnel:fill"), false);

  const drifted = fakeOperationPage({ personnelPlatform: "其他平台" });
  await assert.rejects(() => operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction({
      checkpoints: { sync_personnel_config: captured.sync_personnel_config },
    }),
    attemptOptions(drifted),
  ), { code: "PERSONNEL_OPERATION_CONFLICT" });
});

test("resume republishes when the current batch status invalidates a completed publish checkpoint", async () => {
  const captured = {};
  await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(fakeOperationPage(), {
      onCheckpoint: async (update) => {
        if (update.status === "completed") captured[update.name] = update;
      },
    }),
  );

  const page = fakeOperationPage({ published: false });
  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction({
      checkpoints: { publish_batch: captured.publish_batch },
    }),
    attemptOptions(page),
  );

  assert.equal(result.status, "sent");
  assert.equal(page.events.filter((item) => item === "publish:click").length, 1);
});

test("resume after submit never clicks final confirmation again", async () => {
  const captured = {};
  await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(fakeOperationPage(), {
      onCheckpoint: async (update) => {
        if (update.status === "completed") captured[update.name] = update;
      },
    }),
  );
  const resumedRecordAt = new Date(
    Date.parse(captured.submit_send.readback.startedAt) + 1000,
  ).toISOString();
  const page = fakeOperationPage({
    published: true,
    sendRecords: [{ type: "首次发送", sentAt: resumedRecordAt }],
  });
  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction({
      checkpoints: { submit_send: captured.submit_send },
    }),
    attemptOptions(page),
  );
  assert.equal(page.events.includes("send:confirm"), false);
  assert.equal(result.status, "sent");
});

test("managed schedule mismatch blocks before personnel mutation", async () => {
  const instruction = validInstruction();
  const page = fakeOperationPage({
    published: true,
    schedules: [],
    personnelPlatform: "悦站",
    dates: instruction.target.dates,
    requirements: instruction.target.requirements,
  });
  await assert.rejects(() => operationPersonnelRunner.runOperationPersonnelAttempt(
    instruction,
    attemptOptions(page),
  ), { code: "PERSONNEL_BATCH_SCHEDULE_CONFLICT" });
  assert.equal(page.events.includes("personnel:fill"), false);
  assert.equal(page.events.includes("send:confirm"), false);
});

test("task sheet conditions must all be satisfied before recipients are selected", async () => {
  const page = fakeOperationPage({
    taskSheet: {
      ...validInstruction().target.taskSheet,
      conditions: [{ name: "人员配置", satisfied: false }],
    },
  });
  await assert.rejects(() => operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page),
  ), { code: "PERSONNEL_TASK_SHEET_BLOCKED" });
  assert.equal(page.events.includes("recipients:select"), false);
});

test("task sheet content may change after verified operation settings are saved", async () => {
  const page = fakeOperationPage({
    taskSheet: {
      ...validInstruction().target.taskSheet,
      content: "运控按最新配置重新生成的任务内容",
    },
  });
  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page),
  );
  assert.equal(result.status, "sent");
  assert.equal(page.events.includes("recipients:select"), true);
});

test("recipient matching requires the exact environment directory result", () => {
  assert.deepEqual(matchOperationPersonnelRecipients({
    environment: "test",
    groups: [{ name: "演练组", people: [{ id: "u1", name: "张乐翔" }] }],
  }), {
    to: [{ id: "u1", name: "张乐翔" }],
    cc: [],
  });
  assert.throws(() => matchOperationPersonnelRecipients({
    environment: "production",
    groups: [
      { name: "拓展二部", people: [{ id: "u1", name: "唐润梅" }] },
      { name: "结算组", people: [{ id: "u2", name: "甲" }] },
    ],
  }), /结算组必须精确匹配 4 人/);
});

test("snapshot normalization is stable and keeps only matched directory people", () => {
  assert.deepEqual(normalizeOperationPersonnelSnapshot({
    batch: {
      code: " EZT260003 ",
      projectCode: " P001 ",
      published: true,
    },
    schedules: [
      { scheduleCode: "2", subjectName: " 科目二 ", start: " 2026-08-22 12:00 " },
      { scheduleCode: 1, subjectName: " 科目一 ", start: " 2026-08-22 10:00 " },
    ],
    personnel: { platform: " 悦站 ", monitorCount: "2" },
    directoryMatch: {
      to: [{ group: " 演练组 ", id: " u1 ", name: " 张乐翔 ", email: "secret@example.com" }],
      cc: [],
      groups: [{ name: "不应保存", people: [{ id: "secret" }] }],
    },
  }), {
    batch: {
      code: "EZT260003",
      projectCode: "P001",
      projectName: "",
      batchName: "",
      projectDepartment: "",
      projectManager: "",
      systemType: "",
      published: true,
    },
    schedules: [
      {
        scheduleEntryId: "",
        scheduleCode: 1,
        subjectCode: "",
        subjectName: "科目一",
        start: "2026-08-22 10:00",
        end: "",
        durationMinutes: "",
        earlyLoginMinutes: "",
      },
      {
        scheduleEntryId: "",
        scheduleCode: 2,
        subjectCode: "",
        subjectName: "科目二",
        start: "2026-08-22 12:00",
        end: "",
        durationMinutes: "",
        earlyLoginMinutes: "",
      },
    ],
    personnel: {
      serviceType: "",
      platform: "悦站",
      loginMonitoring: "",
      monitorRatio: "",
      candidateBasis: "",
      monitorCount: 2,
      earliestLoginMinutes: "",
      trialIncluded: false,
    },
    dates: { start: "", end: "", nameListDue: "" },
    requirements: [],
    taskSheet: { type: "", conditions: [], content: "" },
    sendRecords: [],
    directoryMatch: {
      to: [{ group: "演练组", id: "u1", name: "张乐翔" }],
      cc: [],
    },
  });
});

test("inspection opens only the exact batch code and returns a read-only snapshot", async () => {
  const opened = [];
  const page = { marker: "page" };
  const instruction = { environment: "test", batch: { code: "EZT260003" } };
  const snapshot = await inspectOperationPersonnelTask(page, instruction, {
    readBatchPages: async () => ({
      headers: ["关联代码", "批次代码"],
      pages: [
        [{ cells: ["EZT260003", "EZT260030"], rowId: "wrong-column-token" }],
        [{ cells: ["other", "EZT260003"], rowId: "target" }],
      ],
    }),
    openBatchRow: async (actualPage, row) => {
      assert.strictEqual(actualPage, page);
      opened.push(row.rowId);
    },
    readBatch: async () => ({ code: "EZT260003", projectCode: "P001", published: false }),
    readSchedules: async () => [{ scheduleCode: 1, start: "2026-08-22 10:00" }],
    readPersonnel: async () => ({ platform: "悦站" }),
    readDates: async () => ({ start: "2026-07-23" }),
    readRequirements: async () => [{ name: "在线监考", value: "需要" }],
    readTaskSheet: async () => ({ type: "分散在线监考", content: "任务内容" }),
    readSendRecords: async () => [{ type: "首次发送", sentAt: "2026-07-23 11:00" }],
    readDirectoryGroups: async () => [
      { name: "演练组", people: [{ id: "u1", name: "张乐翔", email: "hidden@example.com" }] },
      { name: "其它组", people: [{ id: "u9", name: "不应返回" }] },
    ],
  });

  assert.deepEqual(opened, ["target"]);
  assert.deepEqual(snapshot.directoryMatch, {
    to: [{ group: "演练组", id: "u1", name: "张乐翔" }],
    cc: [],
  });
  assert.equal(JSON.stringify(snapshot).includes("hidden@example.com"), false);
  assert.equal(JSON.stringify(snapshot).includes("不应返回"), false);
});

test("inspection reads current task sheet sections after verifying the batch detail", async () => {
  const opened = [];
  let directoryReads = 0;
  const taskSheetSnapshot = operationPersonnelRunner.operationPersonnelTaskSheetFromVisibleRaw(
    visiblePersonnelTaskSheetRaw(),
  );
  const snapshot = await inspectOperationPersonnelTask(
    {},
    {
      environment: "test",
      batch: {
        code: "EZT260003",
        batchName: "目标批次",
        projectDepartment: "项目实施五部",
        projectManager: "经理",
        systemType: "易考",
      },
    },
    {
      readBatchPages: async () => exactBatchPages(),
      openBatchRow: async () => opened.push("batch"),
      readBatch: async () => ({
        code: "EZT260003",
        projectCode: "4473-26",
        projectName: "测试运控项目",
        batchName: "目标批次",
        projectDepartment: "项目实施五部",
        projectManager: "经理",
        systemType: "易考",
        published: true,
      }),
      openPersonnelTaskSheet: async () => opened.push("task-sheet"),
      readPersonnelTaskSheetSnapshot: async () => taskSheetSnapshot,
      readDirectoryGroups: async () => {
        directoryReads += 1;
        return [];
      },
    },
  );

  assert.deepEqual(opened, ["batch", "task-sheet"]);
  assert.equal(directoryReads, 0);
  assert.equal(snapshot.batch.code, "EZT260003");
  assert.equal(snapshot.schedules.length, 1);
  assert.equal(snapshot.personnel.platform, "悦站");
  assert.equal(snapshot.sendRecords[0].type, "首次发送");
  assert.deepEqual(snapshot.directoryMatch, { to: [], cc: [] });
});

test("unpublished initial preview reads schedules without opening a task sheet", async () => {
  const opened = [];
  const snapshot = await inspectOperationPersonnelTask(
    {},
    {
      environment: "test",
      allowUnpublishedPreview: true,
      batch: { code: "EZT260003", batchName: "目标批次" },
    },
    {
      readBatchPages: async () => exactBatchPages(),
      openBatchRow: async () => opened.push("batch"),
      openEztestSchedulePage: async () => opened.push("exam-schedule"),
      readBatch: async () => ({
        code: "EZT260003",
        batchName: "目标批次",
        published: false,
      }),
      readSchedules: async () => [{
        scheduleCode: 17,
        subjectName: "综合能力",
        start: "2026-08-22 09:00",
        end: "2026-08-22 11:00",
      }],
      readPersonnel: async () => {
        throw new Error("未发布预览不应读取人员配置");
      },
      readDates: async () => {
        throw new Error("未发布预览不应读取人员日期");
      },
      readRequirements: async () => {
        throw new Error("未发布预览不应读取考务需求");
      },
      openPersonnelTaskSheet: async () => opened.push("task-sheet"),
      readTaskSheet: async () => {
        throw new Error("未发布预览不应读取任务单");
      },
      readSendRecords: async () => {
        throw new Error("未发布预览不应读取发送记录");
      },
      readDirectoryGroups: async () => {
        throw new Error("未发布预览不应读取人员目录");
      },
    },
  );

  assert.deepEqual(opened, ["batch", "exam-schedule"]);
  assert.equal(snapshot.batch.published, false);
  assert.deepEqual(snapshot.schedules, [{
    scheduleEntryId: "",
    scheduleCode: 17,
    subjectCode: "",
    subjectName: "综合能力",
    start: "2026-08-22 09:00",
    end: "2026-08-22 11:00",
    durationMinutes: "",
    earlyLoginMinutes: "",
  }]);
  assert.equal(snapshot.personnel.platform, "");
  assert.deepEqual(snapshot.taskSheet, { type: "", conditions: [], content: "" });
  assert.deepEqual(snapshot.sendRecords, []);
  assert.deepEqual(snapshot.directoryMatch, { to: [], cc: [] });
});

test("initial preview reads schedules when the published batch has not generated a task sheet", async () => {
  const page = fakeOperationPage({ published: true });
  page.evaluate = async () => ({
    batch: { ...page.state.batch },
    __scheduleRows: [{
      "日程代码": "1",
      "日程": "2026-08-22 09:00~11:00",
      "时长(分钟)": "120",
      "考试名称": "湖北邮政招聘考试",
      "考生提前登录(分钟)": "30",
    }],
    evidence: {
      batch: { present: true, missing: [] },
      schedules: { present: true, missing: [] },
    },
  });
  let schedulePageOpens = 0;

  const snapshot = await operationPersonnelRunner.inspectOperationPersonnelTask(
    page,
    {
      ...validInstruction(),
      allowUnpublishedPreview: true,
    },
    {
      readBatchPages: async () => exactBatchPages(),
      openBatchRow: async () => {},
      openPersonnelTaskSheet: async () => {
        const error = new Error("任务单尚未生成");
        error.code = "PERSONNEL_TASK_SHEET_NOT_READY";
        throw error;
      },
      openEztestSchedulePage: async () => {
        schedulePageOpens += 1;
      },
    },
  );

  assert.equal(schedulePageOpens, 1);
  assert.equal(snapshot.schedules.length, 1);
  assert.equal(snapshot.schedules[0].scheduleCode, 1);
  assert.equal(snapshot.schedules[0].subjectName, "湖北邮政招聘考试");
  assert.equal(snapshot.schedules[0].start, "2026-08-22 09:00");
  assert.equal(snapshot.schedules[0].end, "2026-08-22 11:00");
  assert.deepEqual(snapshot.personnel, {
    serviceType: "",
    platform: "",
    loginMonitoring: "",
    monitorRatio: "",
    candidateBasis: "",
    monitorCount: "",
    earliestLoginMinutes: "",
    trialIncluded: false,
  });
});

test("unpublished visible preview opens the exam schedule tab and refreshes its cached snapshot", async () => {
  const opened = [];
  let snapshotReads = 0;
  const snapshot = await inspectOperationPersonnelTask(
    {},
    {
      environment: "test",
      allowUnpublishedPreview: true,
      batch: { code: "EZT260003", batchName: "目标批次" },
    },
    {
      readBatchPages: async () => exactBatchPages(),
      openBatchRow: async () => opened.push("batch"),
      openEztestSchedulePage: async () => opened.push("exam-schedule"),
      readVisibleSnapshot: async () => {
        snapshotReads += 1;
        const current = visibleSnapshot(snapshotReads === 1 ? {
          schedules: { present: false, missing: ["考试日程表"] },
        } : {});
        current.batch = {
          code: "EZT260003",
          batchName: "目标批次",
          published: false,
        };
        if (snapshotReads === 2) {
          current.schedules = [{
            scheduleCode: 17,
            subjectName: "综合能力",
            start: "2026-08-22 09:00",
            end: "2026-08-22 11:00",
          }];
        }
        return current;
      },
    },
  );

  assert.deepEqual(opened, ["batch", "exam-schedule"]);
  assert.equal(snapshotReads, 2);
  assert.equal(snapshot.schedules[0].scheduleCode, 17);
});

test("inspection resolves the exact directory only with a real probe summary", async () => {
  let directoryReads = 0;
  const taskSheetSnapshot = operationPersonnelRunner.operationPersonnelTaskSheetFromVisibleRaw(
    visiblePersonnelTaskSheetRaw(),
  );
  const snapshot = await inspectOperationPersonnelTask(
    {},
    {
      environment: "test",
      directoryProbeSummary: "dates.end：2026-08-18 → 2026-08-19",
      batch: { code: "EZT260003", batchName: "目标批次" },
    },
    {
      readBatchPages: async () => exactBatchPages(),
      openBatchRow: async () => {},
      readBatch: async () => ({
        code: "EZT260003",
        batchName: "目标批次",
        published: false,
      }),
      openPersonnelTaskSheet: async () => {},
      readPersonnelTaskSheetSnapshot: async () => taskSheetSnapshot,
      readDirectoryGroups: async () => {
        directoryReads += 1;
        return [{
          name: "演练组",
          people: [{ id: "u1", name: "张乐翔" }],
        }];
      },
    },
  );

  assert.equal(directoryReads, 1);
  assert.equal(snapshot.batch.published, true);
  assert.deepEqual(snapshot.directoryMatch, {
    to: [{ group: "演练组", id: "u1", name: "张乐翔" }],
    cc: [],
  });
});

test("attempt change summary rechecks the exact directory before applying changes", async () => {
  let directoryReads = 0;
  const taskSheetSnapshot = operationPersonnelRunner.operationPersonnelTaskSheetFromVisibleRaw(
    visiblePersonnelTaskSheetRaw(),
  );
  const snapshot = await inspectOperationPersonnelTask(
    {},
    {
      environment: "test",
      changeSummary: "人员落实结束日期调整",
      batch: { code: "EZT260003", batchName: "目标批次" },
    },
    {
      readBatchPages: async () => exactBatchPages(),
      openBatchRow: async () => {},
      readBatch: async () => ({ code: "EZT260003", batchName: "目标批次" }),
      openPersonnelTaskSheet: async () => {},
      readPersonnelTaskSheetSnapshot: async () => taskSheetSnapshot,
      readDirectoryGroups: async () => {
        directoryReads += 1;
        return [{
          name: "演练组",
          people: [{ id: "u1", name: "张乐翔" }],
        }];
      },
    },
  );

  assert.equal(directoryReads, 1);
  assert.equal(snapshot.directoryMatch.to[0].name, "张乐翔");
});

test("inspection rejects missing and duplicate exact batch rows", async () => {
  const instruction = { environment: "test", batch: { code: "EZT260003" } };
  await assert.rejects(() => inspectOperationPersonnelTask({}, instruction, {
    readBatchPages: async () => exactBatchPages([{ cells: ["EZT260030"] }]),
  }), /未找到批次代码 EZT260003/);
  await assert.rejects(() => inspectOperationPersonnelTask({}, instruction, {
    readBatchPages: async () => ({
      headers: ["批次代码"],
      pages: [
        [{ cells: ["EZT260003"] }],
        [{ cells: ["EZT260003"] }],
      ],
    }),
  }), /批次代码 EZT260003 精确匹配到 2 行/);
});

test("inspection rejects a detail identity that differs from the selected batch", async () => {
  await assert.rejects(() => inspectOperationPersonnelTask(
    {},
    { environment: "test", batch: { code: "EZT260003", projectCode: "P001" } },
    inspectionReaders({
      readBatch: async () => ({ code: "EZT260004", projectCode: "P001" }),
    }),
  ), /批次详情身份不一致.*EZT260003.*EZT260004/);
});

test("test inspection ignores only project code and project name mismatches", async () => {
  const snapshot = await inspectOperationPersonnelTask(
    {},
    {
      environment: "test",
      batch: {
        code: "EZT260003",
        projectCode: "F0012094",
        projectName: "平台项目",
        batchName: "目标批次",
      },
    },
    inspectionReaders({
      readBatch: async () => ({
        code: "EZT260003",
        projectCode: "4473-26",
        projectName: "测试运控项目",
        batchName: "目标批次",
      }),
    }),
  );

  assert.equal(snapshot.batch.code, "EZT260003");
  assert.equal(snapshot.batch.projectCode, "4473-26");
  assert.equal(snapshot.batch.projectName, "测试运控项目");
});

test("test inspection still rejects a batch name mismatch", async () => {
  await assert.rejects(
    () => inspectOperationPersonnelTask(
      {},
      {
        environment: "test",
        batch: { code: "EZT260003", batchName: "目标批次" },
      },
      inspectionReaders({
        readBatch: async () => ({
          code: "EZT260003",
          batchName: "其它批次",
        }),
      }),
    ),
    /批次详情身份不一致.*batchName/,
  );
});

test("production inspection rejects project identity mismatches", async () => {
  await assert.rejects(
    () => inspectOperationPersonnelTask(
      {},
      {
        environment: "production",
        batch: {
          code: "EZT260003",
          projectCode: "F0012094",
          projectName: "平台项目",
        },
      },
      inspectionReaders({
        readBatch: async () => ({
          code: "EZT260003",
          projectCode: "4473-26",
          projectName: "测试运控项目",
        }),
      }),
    ),
    /批次详情身份不一致.*projectCode.*projectName/,
  );
});

test("missing DOM controls, tables, and task sections block inspection", async () => {
  const instruction = { environment: "test", batch: { code: "EZT260003" } };
  for (const [section, missing] of [
    ["personnel", "人员落实平台"],
    ["schedules", "考试日程表"],
    ["taskSheet", "分散在线监考任务单"],
  ]) {
    await assert.rejects(() => inspectOperationPersonnelTask({}, instruction, {
      readBatchPages: async () => exactBatchPages(),
      openBatchRow: async () => {},
      readVisibleSnapshot: async () => visibleSnapshot({
        [section]: { present: false, missing: [missing] },
      }),
    }), new RegExp(`运控人员任务检查阻断.*${missing}`));
  }
});

test("a present operation control with an empty value remains fillable", async () => {
  const snapshot = await inspectOperationPersonnelTask(
    {},
    { environment: "test", batch: { code: "EZT260003" } },
    {
      readBatchPages: async () => exactBatchPages(),
      openBatchRow: async () => {},
      readVisibleSnapshot: async () => visibleSnapshot(),
    },
  );
  assert.equal(snapshot.personnel.platform, "");
  assert.deepEqual(operationPersonnelConflicts(
    { personnel: { platform: "悦站" } },
    snapshot,
    "initial",
  ), []);
});

test("first send may fill empty operation fields but never overwrite values", () => {
  assert.deepEqual(operationPersonnelConflicts(
    { personnel: { platform: "悦站" } },
    { personnel: { platform: "" } },
    "initial",
  ), []);
  assert.deepEqual(operationPersonnelConflicts(
    { personnel: { platform: "悦站" } },
    { personnel: { platform: "其他平台" } },
    "initial",
  ).map((item) => item.path), ["personnel.platform"]);
});

test("batch identity mismatches always block initial send", () => {
  assert.deepEqual(operationPersonnelConflicts(
    { batch: { projectCode: "P001" } },
    { batch: { projectCode: "" } },
    "initial",
  ).map((item) => item.path), ["batch.projectCode"]);
});

test("initial conflicts project only expected fields from a normalized actual snapshot", () => {
  const actual = normalizeOperationPersonnelSnapshot({
    batch: { code: "EZT260003", projectCode: "P001" },
    personnel: { platform: "" },
  });
  assert.deepEqual(operationPersonnelConflicts(
    { personnel: { platform: "悦站" } },
    actual,
    "initial",
  ), []);
});

test("initial conflicts reject an extra actual schedule by stable code membership", () => {
  const conflicts = operationPersonnelConflicts(
    { schedules: [{ scheduleCode: 1, start: "2026-08-22 10:00" }] },
    {
      schedules: [
        { scheduleCode: 1, start: "2026-08-22 10:00" },
        { scheduleCode: 2, start: "2026-08-23 10:00" },
      ],
    },
    "initial",
  );
  assert.deepEqual(conflicts.map((item) => item.path), ["schedules.2"]);
});

test("initial conflicts reject actual-only non-empty target configuration", () => {
  assert.deepEqual(operationPersonnelConflicts(
    { personnel: {} },
    { personnel: { platform: "其他平台", trialIncluded: false } },
    "initial",
  ).map((item) => item.path), ["personnel.platform"]);
  assert.deepEqual(operationPersonnelConflicts(
    { dates: {} },
    { dates: { start: "2026-07-23" } },
    "initial",
  ).map((item) => item.path), ["dates.start"]);
  assert.deepEqual(operationPersonnelConflicts(
    { requirements: [] },
    { requirements: [{ name: "在线监考", value: "需要" }] },
    "initial",
  ).map((item) => item.path), ["requirements.0"]);
});

test("initial conflicts ignore observational actual-only records and unrelated batch fields", () => {
  const actual = normalizeOperationPersonnelSnapshot({
    batch: {
      code: "EZT260003",
      projectCode: "P001",
      projectName: "不参与本次局部比较",
    },
    sendRecords: [{ type: "首次发送", sentAt: "2026-07-23 11:00" }],
  });
  assert.deepEqual(operationPersonnelConflicts(
    { batch: { projectCode: "P001" } },
    actual,
    "initial",
  ), []);
});

test("resend blocks any drift from the last successful operation snapshot", () => {
  const conflicts = operationPersonnelConflicts(
    { schedules: [{ scheduleCode: 1, start: "2026-08-22 10:00" }] },
    { schedules: [{ scheduleCode: 1, start: "2026-08-22 09:00" }] },
    "resend",
  );
  assert.equal(conflicts[0].path, "schedules.1.start");
});

test("missing or duplicate schedule codes are rejected before comparison", () => {
  assert.throws(() => normalizeOperationPersonnelSnapshot({
    schedules: [{ start: "2026-08-22 10:00" }],
  }), /考试日程缺少日程代码/);
  assert.throws(() => operationPersonnelConflicts(
    { schedules: [{ scheduleCode: 1, start: "2026-08-22 10:00" }] },
    {
      schedules: [
        { scheduleCode: 1, start: "2026-08-22 10:00" },
        { scheduleCode: 1, start: "2026-08-22 09:00" },
      ],
    },
    "resend",
  ), /考试日程代码 1 重复/);
});

test("run inspection always launches visibly and closes the shared operation context", async () => {
  const events = [];
  const page = {};
  const context = {
    pages: () => [page],
    close: async () => events.push("close"),
  };
  const result = await runOperationPersonnelInspection({
    environment: "test",
    batch: { code: "EZT260003" },
  }, {
    userDataDir: "/tmp/operation-personnel-profile",
    headless: true,
    env: { OPERATION_CONSOLE_HEADLESS: "1" },
    launchPersistentContext: async (userDataDir, launchOptions) => {
      events.push(["launch", userDataDir, launchOptions]);
      return context;
    },
    ...inspectionReaders({ openBatchRow: async () => events.push("open") }),
  });

  assert.equal(result.batch.code, "EZT260003");
  assert.deepEqual(events, [
    ["launch", "/tmp/operation-personnel-profile", { headless: false, viewport: null }],
    "open",
    "close",
  ]);
});

test("run inspection propagates context close failures", async () => {
  const closeError = new Error("inspection close failed");
  await assert.rejects(() => runOperationPersonnelInspection({
    environment: "test",
    batch: { code: "EZT260003" },
  }, {
    launchPersistentContext: async () => ({
      pages: () => [{}],
      close: async () => { throw closeError; },
    }),
    ...inspectionReaders(),
  }), (error) => error === closeError);
});
