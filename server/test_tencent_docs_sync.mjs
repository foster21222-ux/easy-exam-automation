import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBatchUpdateRequests,
  buildTencentDocRows,
  syncExamConfigToTencentDocs,
} from "./tencent_docs_sync.mjs";

const config = {
  examName: "项目招聘考试",
  startTimeDisplay: "2026-07-01 09:00",
  endTimeDisplay: "2026-07-01 11:00",
  mockStartTimeDisplay: "2026-06-30 15:00",
  mockEndTimeDisplay: "2026-06-30 17:00",
  earlyLoginMinutes: 30,
  lateLimitMinutes: 20,
  examType: "客户端考试",
  clientExam: true,
  videoMonitor: true,
  hawkeye: true,
  loginVerifyMode: "考后公安验证",
  timeRule: "迟到扣时",
};

const created = [
  { kind: "main", id: "428572", name: "项目招聘考试", start: "2026-07-01 09:00", end: "2026-07-01 11:00", candidate_count: 81, url: "https://eztest.cn/exam/107910/uniform/login/" },
  { kind: "mock", id: "428573", name: "项目招聘考试-试考", start: "2026-06-30 15:00", end: "2026-06-30 17:00", candidate_count: 62, url: "https://eztest.cn/exam/107910/uniform/login/" },
];

test("builds Tencent Docs rows through AD with configured defaults", () => {
  const rows = buildTencentDocRows({ config, created });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, 30);
  assert.equal(rows[0][0], "项目招聘考试");
  assert.equal(rows[0][1], "F0020795");
  assert.equal(rows[0][2], "");
  assert.equal(rows[0][3], "正式");
  assert.equal(rows[0][4], "蜀道集团");
  assert.equal(rows[0][5], "81");
  assert.equal(rows[0][6], "2026/07/01");
  assert.equal(rows[0][7], "2026/07/01");
  assert.equal(rows[0][8], "提前30分钟登录，允许迟到20分钟");
  assert.equal(rows[0][9], "2026/07/01 09:00-2026/07/01 11:00");
  assert.equal(rows[0][10], "120分钟");
  assert.equal(rows[0][11], "客户端，10次");
  assert.equal(rows[0][12], "是，作答60分钟可交卷");
  assert.equal(rows[0][13], "一个单元，60-120分钟");
  assert.equal(rows[0][14], "准考证号");
  assert.equal(rows[0][15], "统一入口：E107910\n考试口令：428572");
  assert.equal(rows[0][16], "准点收卷，迟到及离开扣时");
  assert.equal(rows[0][17], "双监控");
  assert.equal(rows[0][18], "考中侦测");
  assert.equal(rows[0][19], "不需要");
  assert.equal(rows[0][20], "ATA短信");
  assert.equal(rows[0][21], "已通知");
  assert.equal(rows[0][22], "纸质草稿纸");
  assert.equal(rows[0][23], "客户端");
  assert.equal(rows[0][24], "仅在线客服");
  assert.equal(rows[0][25], "不允许");
  assert.equal(rows[0][26], "鹰眼");
  assert.equal(rows[0][28], "声音监控");
  assert.match(rows[0][29], /考生您好！项目招聘考试将于北京时间2026年7月1日\(周三\)09:00-11:00举行。/);
  assert.match(rows[0][29], /试考时间为2026年6月30日15:00-6月30日17:00/);
  assert.match(rows[0][29], /客户端下载地址：https:\/\/eztest\.org\/exam\/session\/428572\/client\/download/);
  assert.match(rows[0][29], /考试口令统一为：E107910/);

  assert.equal(rows[1][3], "试考-分散模式");
  assert.equal(rows[1][5], "62");
  assert.equal(rows[1][6], "2026/06/30");
  assert.equal(rows[1][7], "2026/06/30");
  assert.equal(rows[1][8], "不允许提前登录，无迟到限制");
  assert.equal(rows[1][10], "90分钟");
  assert.equal(rows[1][12], "是，作答10分钟可交卷");
  assert.equal(rows[1][13], "一个单元，10-90分钟");
  assert.equal(rows[1][15], "统一入口：E107910\n考试口令：428573");
  assert.equal(rows[1][16], "不准点收卷，无迟到扣时");
  assert.equal(rows[1][17], "双监控");
  assert.equal(rows[1][18], "不需要");
  assert.equal(rows[1][20], "ATA短信");
  assert.equal(rows[1][21], "已通知");
});

test("leaves AI cloud monitoring blank when hawkeye is disabled", () => {
  const rows = buildTencentDocRows({ config: { ...config, hawkeye: false }, created: [created[0]] });
  assert.equal(rows[0][26], "");
});

test("client exam L column uses client login limit instead of web leave limit", () => {
  const [row] = buildTencentDocRows({
    config: {
      ...config,
      clientExam: true,
      examType: "客户端考试",
      clientLoginLimit: 20,
      leaveLimit: 10,
    },
    created: [created[0]],
  });

  assert.equal(row[11], "客户端，20次");
});

test("client exam L column allows session-level login limit overrides", () => {
  const [row] = buildTencentDocRows({
    config: {
      ...config,
      clientExam: true,
      examType: "客户端考试",
      clientLoginLimit: 10,
    },
    created: [{ ...created[1], clientLoginLimit: 20 }],
  });

  assert.equal(row[11], "客户端，20次");
});

test("client trial exam L column defaults to 20 login attempts", () => {
  const [row] = buildTencentDocRows({
    config: {
      ...config,
      clientExam: true,
      examType: "客户端考试",
      clientLoginLimit: 10,
    },
    created: [{ ...created[1], kind: "mock", sessionType: "trial" }],
  });

  assert.equal(row[11], "客户端，20次");
});

test("SMS uses unified exam code for unified address and session id for independent address", () => {
  const [row] = buildTencentDocRows({
    config,
    created: [
      {
        kind: "main",
        id: "428572",
        name: "新模板测试",
        start: "2026-07-03 09:00",
        end: "2026-07-03 10:30",
        url: "https://eztest.cn/exam/107910/uniform/login/",
      },
    ],
  });
  assert.match(row[29], /客户端下载地址：https:\/\/eztest\.org\/exam\/session\/428572\/client\/download/);
  assert.match(row[29], /考试口令统一为：E107910/);

  const [independentRow] = buildTencentDocRows({
    config,
    created: [{ kind: "main", id: "428572", name: "新模板测试", start: "2026-07-03 09:00", end: "2026-07-03 10:30" }],
  });
  assert.match(independentRow[29], /考试口令统一为：428572/);
  assert.doesNotMatch(independentRow[29], /考试口令统一为：【考试口令】/);
});

test("SMS uses the exam name directly before the scheduled time", () => {
  const [row] = buildTencentDocRows({
    config: { ...config, examName: "客户招聘笔试" },
    created: [
      {
        kind: "main",
        id: "428572",
        name: "客户招聘笔试",
        start: "2026-07-03 09:00",
        end: "2026-07-03 10:30",
      },
    ],
  });

  assert.match(row[29], /考生您好！客户招聘笔试将于北京时间/);
  assert.doesNotMatch(row[29], /笔试笔试/);

  const [plainNameRow] = buildTencentDocRows({
    config: { ...config, examName: "客户招聘考试" },
    created: [
      {
        kind: "main",
        id: "428572",
        name: "客户招聘考试",
        start: "2026-07-03 09:00",
        end: "2026-07-03 10:30",
      },
    ],
  });
  assert.match(plainNameRow[29], /考生您好！客户招聘考试将于北京时间/);
  assert.doesNotMatch(plainNameRow[29], /客户招聘考试笔试将于/);
});

test("P column includes both unified entry code and exam password for unified address", () => {
  const [unifiedRow] = buildTencentDocRows({
    config,
    created: [
      {
        kind: "main",
        id: "428572",
        name: "统一地址考试",
        start: "2026-07-03 09:00",
        end: "2026-07-03 10:30",
        url: "https://eztest.cn/exam/107910/uniform/login/",
      },
    ],
  });
  assert.equal(unifiedRow[15], "统一入口：E107910\n考试口令：428572");

  const [independentRow] = buildTencentDocRows({
    config: { ...config, unifiedExamAddress: false, examAddress: "独立考试地址" },
    created: [
      {
        kind: "main",
        id: "428572",
        name: "独立地址考试",
        start: "2026-07-03 09:00",
        end: "2026-07-03 10:30",
      },
    ],
  });
  assert.equal(independentRow[15], "428572");
});

test("explicit independent exam address keeps P column on the session password", () => {
  const [row] = buildTencentDocRows({
    config: { ...config, unifiedExamAddress: false, examAddress: "独立考试地址" },
    created: [
      {
        kind: "main",
        id: "428572",
        name: "独立地址考试",
        start: "2026-07-03 09:00",
        end: "2026-07-03 10:30",
        url: "https://eztest.cn/exam/107910/uniform/login/",
      },
    ],
  });

  assert.equal(row[15], "428572");
});

test("unified address P column keeps explicit exam password next to the E-prefixed code", () => {
  const [row] = buildTencentDocRows({
    config: {
      ...config,
      unifiedExamAddress: true,
      examCode: "428572",
    },
    created: [
      {
        kind: "main",
        id: "428572",
        name: "统一地址考试",
        start: "2026-07-03 09:00",
        end: "2026-07-03 10:30",
        url: "https://eztest.cn/exam/107910/uniform/login/",
      },
    ],
  });

  assert.equal(row[15], "统一入口：E107910\n考试口令：428572");
});

test("trial R column follows the formal exam monitor rule", () => {
  const rows = buildTencentDocRows({ config, created });

  assert.equal(rows[0][17], "双监控");
  assert.equal(rows[1][17], "双监控");
});

test("copies Tencent Docs example rows before overriding task-specific fields", () => {
  const remoteRows = [
    ["考试名称"],
    ["示例-试考", "F0020795", "司园园", "试考-分散模式", "蜀道集团", "138", "2026/6/24", "2026/6/25", "不允许提前登录，无迟到限制", "示例时间", "90分钟", "客户端，10次", "是，作答10分钟可交卷", "一个单元，10-90分钟", "手机号码", "427183", "", "", "", "", "ATA短信", "已通知", "", "客户端", "", "不允许", "鹰眼", "", "", "模板短信"],
    ["示例-正式", "F0020795", "司园园", "正式", "蜀道集团", "138", "2026/6/25", "2026/6/25", "提前30分钟登录，允许迟到20分钟", "示例时间", "120分钟", "客户端，10次", "是，作答60分钟可交卷", "第一单元 60-90分钟\n第二单元 0-30分钟", "手机号码", "427182", "", "", "", "", "ATA短信", "已通知", "", "客户端", "", "不允许", "鹰眼", "", "", "模板短信"],
  ];

  const rows = buildTencentDocRows({ config, created, remoteRows });

  assert.equal(rows[0][0], "项目招聘考试");
  assert.equal(rows[0][1], "F0020795");
  assert.equal(rows[0][2], "");
  assert.equal(rows[0][4], "蜀道集团");
  assert.equal(rows[0][5], "81");
  assert.equal(rows[0][12], "是，作答60分钟可交卷");
  assert.equal(rows[0][13], "一个单元，60-120分钟");
  assert.equal(rows[0][15], "统一入口：E107910\n考试口令：428572");
  assert.equal(rows[0][20], "ATA短信");
  assert.equal(rows[0][21], "已通知");
  assert.equal(rows[0][22], "纸质草稿纸");
  assert.notEqual(rows[0][29], "模板短信");
  assert.match(rows[0][29], /考试口令统一为：E107910/);
  assert.equal(rows[1][1], "F0020795");
  assert.equal(rows[1][3], "试考-分散模式");
  assert.equal(rows[1][5], "62");
  assert.equal(rows[1][12], "是，作答10分钟可交卷");
  assert.equal(rows[1][13], "一个单元，10-90分钟");
  assert.equal(rows[1][15], "统一入口：E107910\n考试口令：428573");
});

test("appends to blank rows and writes font plus centered alignment", () => {
  const requests = buildBatchUpdateRequests({
    sheetId: "BB08J2",
    remoteRows: [
      ["考试名称"],
      Array.from({ length: 30 }, (_, index) => index === 15 ? "428572" : index === 0 ? "已有考试" : ""),
      Array(30).fill(""),
      Array(30).fill(""),
    ],
    rows: buildTencentDocRows({ config, created }),
  });

  assert.deepEqual(requests.map((item) => item.updateRangeRequest.gridData.startRow), [2, 3]);
  assert.equal(requests[0].updateRangeRequest.sheetId, "BB08J2");
  assert.equal(requests[0].updateRangeRequest.gridData.rows[0].values[15].cellValue.text, "统一入口：E107910\n考试口令：428572");
  assert.equal(requests[1].updateRangeRequest.gridData.rows[0].values[15].cellValue.text, "统一入口：E107910\n考试口令：428573");

  for (const request of requests) {
    const rowValues = request.updateRangeRequest.gridData.rows[0].values;
    assert.equal(rowValues.length, 30);
    assert.equal(rowValues[15].cellFormat.textFormat.fontSize, 10);
    assert.equal(rowValues[15].cellFormat.horizontalAlignment, "CENTER");
    assert.equal(rowValues[15].cellFormat.verticalAlignment, "MIDDLE");
    assert.equal(rowValues[29].cellFormat.textFormat.fontSize, 10);
    assert.equal(rowValues[29].cellFormat.horizontalAlignment, "CENTER");
    assert.equal(rowValues[29].cellFormat.verticalAlignment, "MIDDLE");
  }
});

test("sync reads the sheet through AD before submitting a batch update", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (!options.method || options.method === "GET") {
      if (String(url).endsWith("/A1:AD200")) {
        return new Response(JSON.stringify({
          gridData: {
            rows: [
              { values: [{ cellValue: { text: "考试名称" } }] },
              { values: Array.from({ length: 16 }, (_, index) => ({ cellValue: { text: index === 15 ? "428572" : "" } })) },
            ],
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(url).endsWith("/A201:AD400")) {
        return new Response(JSON.stringify({
          code: 400001,
          message: "invalid param error: 'range' invalid",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`unexpected read range: ${url}`);
    }
    return new Response(JSON.stringify({ responses: [{ updateRangeResponse: {} }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await syncExamConfigToTencentDocs({
    config,
    created: [created[0]],
    settings: {
      clientId: "client",
      accessToken: "token",
      openId: "open",
      fileId: "file",
      sheetId: "BB08J2",
    },
    fetchImpl,
  });

  assert.equal(result.updatedRows, 1);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.headers["Access-Token"], "token");
  assert.ok(calls[0].url.endsWith("/A1:AD200"));
  assert.ok(calls[1].url.endsWith("/A201:AD400"));
  assert.equal(calls[2].options.method, "POST");
  assert.equal(JSON.parse(calls[2].options.body).requests.length, 1);
});
