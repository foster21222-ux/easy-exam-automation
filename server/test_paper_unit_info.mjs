import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchPaperUnitInfo,
  normalizePaperUnitInfo,
} from "./paper_unit_info.mjs";

test("normalizes paper sections and section time labels", () => {
  const result = normalizePaperUnitInfo({
    form: {
      sections: [
        { name: "选择题", timer: { time_min_limit: 300, time_limit: 3600 } },
        { name: "主观题", timer: { time_min_limit: 300, time_limit: 1800 } },
      ],
    },
  });

  assert.deepEqual(result, {
    unit_count: 2,
    unit_label: "2个单元",
    sections: [
      { name: "选择题", time_label: "5.0-60.0分钟" },
      { name: "主观题", time_label: "5.0-30.0分钟" },
    ],
  });
});

test("fetches paper unit info without mutating paper binding data", async () => {
  const calls = [];
  const requestJson = async (_login, url, options, action) => {
    calls.push({ url, options, action });
    return {
      form: {
        sections: [
          { name: "试考", timer: { time_min_limit: 600, time_limit: 5400 } },
        ],
      },
    };
  };

  const result = await fetchPaperUnitInfo({
    login: {},
    apiBase: "https://eztest.cn",
    formCode: "FORM-01",
    requestJson,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://eztest.cn/tenant/api/form/FORM-01/get/");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].action, "读取试卷单元 FORM-01");
  assert.deepEqual(result, {
    unit_count: 1,
    unit_label: "1个单元",
    sections: [
      { name: "试考", time_label: "10.0-90.0分钟" },
    ],
  });
});
