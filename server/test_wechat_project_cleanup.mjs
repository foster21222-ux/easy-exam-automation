import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { disableWechatGroupsForDeletedTask } from "./wechat_project_cleanup.mjs";

test("disables WeChat groups linked to a deleted project requirement", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wechat-project-cleanup-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  await writeFile(configPath, JSON.stringify({
    groups: [
      {
        group_name: "AI赋能运营自动化小组",
        project_name: "北京农商银行公文大赛",
        customer_name: "北京农商银行",
        requirement_request_id: "deleted-request",
        enabled: true,
        interval_minutes: 30,
      },
      {
        group_name: "其它项目群",
        project_name: "其它项目",
        requirement_request_id: "other-request",
        enabled: true,
        interval_minutes: 15,
      },
    ],
    llm_parse: { enabled: false },
  }), "utf8");

  const result = await disableWechatGroupsForDeletedTask({
    configPath,
    task: {
      projectName: "北京农商银行公文大赛",
      config: { requirementRequestId: "deleted-request" },
    },
  });

  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(result.disabledCount, 1);
  assert.equal(saved.groups[0].enabled, false);
  assert.equal(saved.groups[1].enabled, true);
  assert.deepEqual(saved.llm_parse, { enabled: false });
});

test("disables WeChat groups linked to a deleted project task id", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wechat-project-cleanup-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  await writeFile(configPath, JSON.stringify({
    groups: [
      {
        group_name: "项目群",
        task_id: "deleted-task",
        project_name: "改名前项目",
        requirement_request_id: "",
        enabled: true,
        interval_minutes: 30,
      },
    ],
  }), "utf8");

  const result = await disableWechatGroupsForDeletedTask({
    configPath,
    task: {
      taskId: "deleted-task",
      projectName: "改名后项目",
      config: { requirementRequestId: "new-request" },
    },
  });

  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(result.disabledCount, 1);
  assert.equal(saved.groups[0].enabled, false);
});

test("does not disable same-name groups when requirement and project do not match", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wechat-project-cleanup-"));
  const configPath = path.join(dir, "wechat-requirement-groups.json");
  await writeFile(configPath, JSON.stringify({
    groups: [
      {
        group_name: "AI赋能运营自动化小组",
        project_name: "新项目",
        requirement_request_id: "new-request",
        enabled: true,
        interval_minutes: 30,
      },
    ],
  }), "utf8");

  const result = await disableWechatGroupsForDeletedTask({
    configPath,
    task: {
      projectName: "旧项目",
      config: { requirementRequestId: "old-request" },
    },
  });

  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(result.disabledCount, 0);
  assert.equal(saved.groups[0].enabled, true);
});
