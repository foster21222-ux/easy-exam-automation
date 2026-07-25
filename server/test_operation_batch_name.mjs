import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultOperationBatchName,
  resolveOperationBatchName,
  withOperationBatchNameEditorDefaults,
} from "./operation_batch_name.mjs";

test("builds the confirmed no-first-underscore batch name", () => {
  assert.equal(defaultOperationBatchName({
    customerName: "中国邮政集团公司湖北省分公司",
    projectName: "中国邮政集团公司湖北省分公司社会招聘考试",
    examStart: "2026-08-22T09:00:00",
  }), "湖北邮政社招_2026年8月");
});

test("keeps unknown text instead of guessing abbreviations", () => {
  assert.equal(defaultOperationBatchName({
    customerName: "某某测试中心",
    projectName: "某某测试中心专项能力测试",
    examStart: "2026-09-01 09:00",
  }), "某某测试中心专项能力测试_2026年9月");
});

test("does not emit an incomplete name without a valid date", () => {
  assert.equal(defaultOperationBatchName({
    customerName: "中国邮政集团公司湖北省分公司",
    projectName: "社会招聘考试",
    examStart: "",
  }), "");
});

test("manual mode survives recalculation until restore-auto is requested", () => {
  assert.deepEqual(resolveOperationBatchName({
    previousValue: "人工批次",
    previousMode: "manual",
    generatedValue: "湖北邮政社招_2026年9月",
    submittedValue: "人工批次",
    restoreAuto: false,
  }), { value: "人工批次", mode: "manual", autoValue: "湖北邮政社招_2026年9月" });
  assert.deepEqual(resolveOperationBatchName({
    previousValue: "人工批次",
    previousMode: "manual",
    generatedValue: "湖北邮政社招_2026年9月",
    submittedValue: "人工批次",
    restoreAuto: true,
  }), { value: "湖北邮政社招_2026年9月", mode: "auto", autoValue: "湖北邮政社招_2026年9月" });
});

test("keeps a first unchanged generated submission in automatic mode", () => {
  assert.deepEqual(resolveOperationBatchName({
    previousValue: "",
    previousMode: "",
    generatedValue: "湖北邮政社招_2026年8月",
    submittedValue: "湖北邮政社招_2026年8月",
  }), {
    value: "湖北邮政社招_2026年8月",
    mode: "auto",
    autoValue: "湖北邮政社招_2026年8月",
  });
});

test("keeps an unchanged saved custom name manual when mode metadata is absent", () => {
  assert.deepEqual(resolveOperationBatchName({
    previousValue: "历史人工名称",
    previousMode: "",
    generatedValue: "湖北邮政社招_2026年8月",
    submittedValue: "历史人工名称",
  }), {
    value: "历史人工名称",
    mode: "manual",
    autoValue: "湖北邮政社招_2026年8月",
  });
});

test("adds response-only automatic batch-name editor defaults for legacy Fanwei tasks", () => {
  const task = {
    id: "R0031682",
    config: {
      fanweiSource: {
        raw: {
          fields: {
            "客户名称": "中国邮政集团公司湖北省分公司",
            "项目名称": "中国邮政集团公司湖北省分公司社会招聘考试",
          },
        },
      },
      businessRequirement: {
        customer_name: "中国邮政集团公司湖北省分公司",
        project_name: "中国邮政集团公司湖北省分公司社会招聘考试",
      },
      examRequirements: [{ fields: { "考试日期时间": "2026-08-22 09:00" } }],
    },
  };
  const original = structuredClone(task);

  const enriched = withOperationBatchNameEditorDefaults(task);

  assert.equal(enriched.config.fanweiSource.raw.fields["批次名称"], "湖北邮政社招_2026年8月");
  assert.equal(enriched.config.fanweiSource.batchNameMode, "auto");
  assert.equal(enriched.config.fanweiSource.batchNameAutoValue, "湖北邮政社招_2026年8月");
  assert.deepEqual(task, original);
});

test("preserves an existing manual batch name and mode for legacy Fanwei tasks", () => {
  const task = {
    config: {
      fanweiSource: {
        batchNameMode: "manual",
        raw: { fields: {} },
      },
      businessRequirement: {
        customer_name: "中国邮政集团公司湖北省分公司",
        project_name: "中国邮政集团公司湖北省分公司社会招聘考试",
        batch_name: "客户指定批次",
        batch_name_mode: "manual",
      },
      examRequirement: { fields: { "考试日期时间": "2026-08-22 09:00" } },
    },
  };

  const enriched = withOperationBatchNameEditorDefaults(task);

  assert.equal(enriched.config.fanweiSource.raw.fields["批次名称"], "客户指定批次");
  assert.equal(enriched.config.fanweiSource.batchNameMode, "manual");
});

test("preserves a saved raw legacy batch name when mode metadata is absent", () => {
  const task = {
    config: {
      fanweiSource: {
        raw: {
          fields: {
            "客户名称": "中国邮政集团公司湖北省分公司",
            "项目名称": "中国邮政集团公司湖北省分公司社会招聘考试",
            "批次名称": "历史人工名称",
          },
        },
      },
      businessRequirement: {
        customer_name: "中国邮政集团公司湖北省分公司",
        project_name: "中国邮政集团公司湖北省分公司社会招聘考试",
      },
      examRequirement: { fields: { "考试日期时间": "2026-08-22 09:00" } },
    },
  };

  const enriched = withOperationBatchNameEditorDefaults(task);

  assert.equal(enriched.config.fanweiSource.raw.fields["批次名称"], "历史人工名称");
  assert.equal(enriched.config.fanweiSource.batchNameMode, "manual");
  assert.equal(enriched.config.fanweiSource.batchNameAutoValue, "湖北邮政社招_2026年8月");
});

test("preserves a saved business legacy batch name when raw fields lack it", () => {
  const task = {
    config: {
      fanweiSource: {
        raw: {
          fields: {
            "客户名称": "中国邮政集团公司湖北省分公司",
            "项目名称": "中国邮政集团公司湖北省分公司社会招聘考试",
          },
        },
      },
      businessRequirement: {
        customer_name: "中国邮政集团公司湖北省分公司",
        project_name: "中国邮政集团公司湖北省分公司社会招聘考试",
        batch_name: "历史业务名称",
      },
      examRequirement: { fields: { "考试日期时间": "2026-08-22 09:00" } },
    },
  };

  const enriched = withOperationBatchNameEditorDefaults(task);

  assert.equal(enriched.config.fanweiSource.raw.fields["批次名称"], "历史业务名称");
  assert.equal(enriched.config.fanweiSource.batchNameMode, "manual");
  assert.equal(enriched.config.fanweiSource.batchNameAutoValue, "湖北邮政社招_2026年8月");
});

test("keeps non-Fanwei tasks unchanged", () => {
  const task = { config: { businessRequirement: { batch_name: "不应补全" } } };

  assert.equal(withOperationBatchNameEditorDefaults(task), task);
});

test("adds an empty batch-name editor field when a legacy Fanwei task has no usable date", () => {
  const task = {
    config: {
      fanweiSource: { raw: { fields: {} } },
      businessRequirement: { customer_name: "客户", project_name: "项目" },
      examRequirement: { fields: { "考试日期时间": "" } },
    },
  };

  const enriched = withOperationBatchNameEditorDefaults(task);

  assert.equal(enriched.config.fanweiSource.raw.fields["批次名称"], "");
  assert.equal(enriched.config.fanweiSource.batchNameMode, "auto");
  assert.equal(enriched.config.fanweiSource.batchNameAutoValue, "");
});
