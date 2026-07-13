import fs from "node:fs/promises";

function taskRequirementIds(task = {}) {
  return [
    task.config?.requirementRequestId,
    task.config?.initialRequirementRequestId,
    task.config?.businessRequirement?.requirementRequestId,
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function groupMatchesDeletedTask(group = {}, task = {}) {
  const taskId = String(task.taskId || task.task_id || "").trim();
  const groupTaskId = String(group.task_id || group.taskId || "").trim();
  if (taskId && groupTaskId && taskId === groupTaskId) return true;

  const requestIds = new Set(taskRequirementIds(task));
  const groupRequestId = String(group.requirement_request_id || group.requirementRequestId || "").trim();
  if (groupRequestId && requestIds.has(groupRequestId)) return true;

  const taskProjectName = String(task.projectName || task.config?.projectName || task.config?.businessRequirement?.project_name || "").trim();
  const groupProjectName = String(group.project_name || group.projectName || "").trim();
  if (taskProjectName && groupProjectName && taskProjectName === groupProjectName) return true;

  return false;
}

export async function disableWechatGroupsForDeletedTask({ configPath, task }) {
  let raw = "";
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { disabledCount: 0, disabledGroups: [] };
    throw error;
  }
  const config = JSON.parse(raw || "{}");
  const groups = Array.isArray(config.groups) ? config.groups : [];
  const disabledGroups = [];
  const nextGroups = groups.map((group) => {
    if (!groupMatchesDeletedTask(group, task)) return group;
    if (group.enabled === false) return group;
    disabledGroups.push(String(group.group_name || group.groupName || "").trim());
    return { ...group, enabled: false };
  });
  if (!disabledGroups.length) return { disabledCount: 0, disabledGroups: [] };
  await fs.writeFile(configPath, `${JSON.stringify({ ...config, groups: nextGroups }, null, 2)}\n`, "utf8");
  return { disabledCount: disabledGroups.length, disabledGroups };
}
