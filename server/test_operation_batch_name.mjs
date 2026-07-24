import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultOperationBatchName,
  resolveOperationBatchName,
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
