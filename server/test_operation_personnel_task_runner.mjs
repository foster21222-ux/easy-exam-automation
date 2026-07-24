import assert from "node:assert/strict";
import test from "node:test";

import * as operationPersonnelRunner from "./operation_personnel_task_runner.mjs";
import {
  inspectOperationPersonnelTask,
  matchOperationPersonnelRecipients,
  normalizeOperationPersonnelSnapshot,
  operationPersonnelBatchIdentityFromVisibleRaw,
  operationPersonnelConflicts,
  runOperationPersonnelInspection,
} from "./operation_personnel_task_runner.mjs";

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
    published: false,
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

function fakePersonnelTaskListPage(rows = [], {
  searchInitiallyMissing = false,
  taskSheetTextHasNoExactNode = false,
} = {}) {
  const events = [];
  let searchReady = !searchInitiallyMissing;
  const rowLocators = rows.map((cells, rowIndex) => ({
    locator: (selector) => {
      assert.equal(selector, "td");
      return { allInnerTexts: async () => cells };
    },
    rowIndex,
  }));
  const mainTable = {
    locator(selector) {
      if (selector === "thead th") {
        return {
          allInnerTexts: async () => [
            "批次名称",
            "项目部归属",
            "项目经理",
            "首次发送时间",
            "最近一次发送时间",
          ],
        };
      }
      if (selector === "tbody tr") {
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
    ["其它批次", "项目实施五部", "经理", "", ""],
    ["目标批次", "项目实施五部", "经理", "2026-07-23 10:09:34", "2026-07-23 10:09:34"],
  ]);

  await operationPersonnelRunner.openVisiblePersonnelTaskSheet(
    page,
    { batch: { batchName: "目标批次" } },
    { baseUrl: "http://operation.test/" },
  );

  assert.deepEqual(page.events, [
    "goto:http://operation.test/job/decentralizedInvigilate",
    "fill:目标批次",
    "wait:目标批次",
    "click:1",
    "wait:任务单发送需满足以下条件",
  ]);
});

test("current personnel task list waits for its React filter", async () => {
  const page = fakePersonnelTaskListPage([
    ["目标批次", "项目实施五部", "经理", "", ""],
  ], { searchInitiallyMissing: true });

  await operationPersonnelRunner.openVisiblePersonnelTaskSheet(
    page,
    { batch: { batchName: "目标批次" } },
    { baseUrl: "http://operation.test/" },
  );

  assert.equal(page.events.includes("search:visible"), true);
  assert.equal(page.events.includes("click:0"), true);
});

test("current personnel task list waits for the visible modal instead of an exact text node", async () => {
  const page = fakePersonnelTaskListPage([
    ["目标批次", "项目实施五部", "经理", "", ""],
  ], { taskSheetTextHasNoExactNode: true });

  await operationPersonnelRunner.openVisiblePersonnelTaskSheet(
    page,
    { batch: { batchName: "目标批次" } },
    { baseUrl: "http://operation.test/" },
  );

  assert.equal(page.events.includes("click:0"), true);
  assert.equal(page.events.includes("wait:任务单发送需满足以下条件"), true);
});

test("current personnel task list blocks duplicate exact batch names", async () => {
  assert.equal(
    typeof operationPersonnelRunner.openVisiblePersonnelTaskSheet,
    "function",
  );
  const page = fakePersonnelTaskListPage([
    ["目标批次", "项目实施五部", "经理", "", ""],
    ["目标批次", "项目实施五部", "经理", "", ""],
  ]);

  await assert.rejects(
    () => operationPersonnelRunner.openVisiblePersonnelTaskSheet(
      page,
      { batch: { batchName: "目标批次" } },
      { baseUrl: "http://operation.test" },
    ),
    /目标批次.*精确匹配到 2 行/,
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
      subjectName: "科目一",
      start: "2026-08-22 10:00",
      end: "2026-08-22 11:00",
      durationMinutes: 60,
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
      schedules: overrides.schedules ?? [],
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
  let dialogPurpose = "";
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
      page.state.batch.published = true;
    } else {
      page.events.push("send:confirm:visible");
      page.state.sendRecords = [{
        type: "首次发送",
        sentAt: "2026-07-23T03:00:00.000Z",
      }];
    }
    dialogPurpose = "";
  });
  const dialog = locator(1, undefined, { "button:确定": confirm });
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
    if (role === "button" && options.name === "发布") {
      return locator(overrides.publishCount ?? 1, () => {
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
    readBatch: async () => ({ ...page.state.batch }),
    readSchedules: async () => page.state.schedules,
    readPersonnel: async () => page.state.personnel,
    readDates: async () => page.state.dates,
    readRequirements: async () => page.state.requirements,
    readTaskSheet: async () => page.state.taskSheet,
    readSendRecords: async () => page.state.sendRecords,
    readDirectoryGroups: async () => [
      { name: "演练组", people: [{ id: "u1", name: "张乐翔" }] },
    ],
    publishBatch: async () => {
      page.events.push("publish:click");
      page.state.batch.published = true;
    },
    syncExamSchedules: async (_actualPage, schedules) => {
      page.events.push("schedules:fill");
      page.state.schedules = structuredClone(schedules);
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
    "sync_exam_schedules:completed",
    "sync_personnel_config:completed",
    "sync_personnel_dates:completed",
    "sync_exam_service_requirements:completed",
    "verify_task_sheet:completed",
    "select_recipients:completed",
    "submit_send:completed",
    "verify_send_record:completed",
  ]);
});

test("published batches skip the publish click but still complete the checkpoint", async () => {
  const page = fakeOperationPage({ published: true });
  await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page),
  );
  assert.equal(page.events.filter((item) => item === "publish:click").length, 0);
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
    "send:confirm:visible",
  ]);
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

test("schedule deletion requires one exact schedule entry id and code row", async () => {
  const baseline = validInstruction().target;
  const target = { ...structuredClone(baseline), schedules: [] };
  const page = fakeOperationPage({
    published: true,
    schedules: baseline.schedules,
    personnelPlatform: "悦站",
    dates: baseline.dates,
    requirements: baseline.requirements,
  });
  await assert.rejects(() => operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction({ kind: "resend", baseline, target }),
    attemptOptions(page, {
      findScheduleRows: async () => [{ id: "row-a" }, { id: "row-b" }],
      deleteSchedule: async () => page.events.push("schedule:delete"),
    }),
  ), { code: "PERSONNEL_SCHEDULE_NOT_UNIQUE" });
  assert.equal(page.events.includes("schedule:delete"), false);
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
