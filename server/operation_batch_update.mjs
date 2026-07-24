import { operationBatchCodeIsValid, operationBatchNeedsReconciliation } from "./operation_batch.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function examRequirements(task = {}) {
  const config = task.config || {};
  if (Array.isArray(config.examRequirements) && config.examRequirements.length) {
    return config.examRequirements;
  }
  return config.examRequirement?.fields ? [config.examRequirement] : [];
}

function validDateParts(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year
    && value.getUTCMonth() === month - 1
    && value.getUTCDate() === day;
}

function dateParts(value) {
  const match = text(value).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return validDateParts(...parts) ? parts : null;
}

function dateTimeParts(value) {
  const match = text(value).match(
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return null;
  const parts = match.slice(1).map((part) => Number(part ?? 0));
  const [year, month, day, hour, minute, second] = parts;
  if (!validDateParts(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;
  return parts;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateString(parts) {
  if (!parts) return "";
  return `${parts[0]}-${pad(parts[1])}-${pad(parts[2])}`;
}

function dateTimeString(parts) {
  if (!parts) return "";
  return `${dateString(parts)}T${pad(parts[3])}:${pad(parts[4])}:${pad(parts[5])}`;
}

function dateTimeValue(parts) {
  return Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
}

function parseRange(value) {
  const match = text(value).match(
    /^(\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)$/,
  );
  if (!match) return null;
  const startParts = dateTimeParts(match[1]);
  const endParts = dateTimeParts(match[2]);
  if (!startParts || !endParts || dateTimeValue(startParts) > dateTimeValue(endParts)) return null;
  return {
    start: dateTimeString(startParts),
    end: dateTimeString(endParts),
    startValue: dateTimeValue(startParts),
    endValue: dateTimeValue(endParts),
  };
}

function businessBatchName(task = {}) {
  return text(task.config?.businessRequirement?.batch_name);
}

function parseManagedSchedule(requirement = {}, requirementIndex) {
  const name = text(requirement.fields?.["考试名称"]);
  const range = parseRange(requirement.fields?.["考试日期时间"]);
  const missing = [];
  if (!name) missing.push("考试名称");
  if (!range) missing.push("考试日期时间");
  return {
    requirementIndex,
    name,
    start: range?.start || "",
    end: range?.end || "",
    startValue: range?.startValue,
    endValue: range?.endValue,
    missing,
  };
}

function snapshotFromSchedules(task, schedules) {
  const byStart = [...schedules].sort((left, right) => left.startValue - right.startValue);
  const byEnd = [...schedules].sort((left, right) => left.endValue - right.endValue);
  return {
    batchName: businessBatchName(task),
    examStartDate: dateString(dateTimeParts(byStart[0]?.start)),
    examEndDate: dateString(dateTimeParts(byEnd.at(-1)?.end)),
    schedules: schedules.map(({ requirementIndex, name, start, end }) => ({
      requirementIndex,
      name,
      start,
      end,
    })),
  };
}

export function buildDesiredOperationBatchSnapshot(task = {}) {
  const requirements = examRequirements(task);
  const parsed = requirements.map((requirement, requirementIndex) =>
    parseManagedSchedule(requirement, requirementIndex));
  const missing = parsed
    .filter((item) => item.missing.length)
    .map(({ requirementIndex, missing: fields }) => ({ requirementIndex, fields }));
  if (!requirements.length || missing.length) {
    return {
      complete: false,
      missing,
      snapshot: {
        batchName: businessBatchName(task),
        examStartDate: "",
        examEndDate: "",
        schedules: [],
      },
    };
  }
  return {
    complete: true,
    missing: [],
    snapshot: snapshotFromSchedules(task, parsed),
  };
}

function normalizedDate(value) {
  return dateString(dateParts(value)) || text(value);
}

function normalizedDateTime(value) {
  return dateTimeString(dateTimeParts(value)) || text(value);
}

function normalizedSnapshotForDiff(snapshot = {}) {
  const schedules = Array.isArray(snapshot.schedules) ? snapshot.schedules : [];
  return {
    batchName: text(snapshot.batchName),
    examStartDate: normalizedDate(snapshot.examStartDate),
    examEndDate: normalizedDate(snapshot.examEndDate),
    schedules: schedules.map((schedule) => ({
      requirementIndex: Number(schedule?.requirementIndex),
      name: text(schedule?.name),
      start: normalizedDateTime(schedule?.start),
      end: normalizedDateTime(schedule?.end),
    })),
  };
}

function managedChange(path, label, before, after, requirementIndex) {
  return {
    path,
    label,
    before,
    after,
    ...(requirementIndex === undefined ? {} : { requirementIndex }),
  };
}

export function operationBatchManagedDiff(applied = {}, desired = {}) {
  const before = normalizedSnapshotForDiff(applied);
  const after = normalizedSnapshotForDiff(desired);
  const changes = [];
  for (const [path, label] of [
    ["batchName", "批次名称"],
    ["examStartDate", "概况考试开始日期"],
    ["examEndDate", "概况考试结束日期"],
  ]) {
    if (before[path] !== after[path]) {
      changes.push(managedChange(path, label, before[path], after[path]));
    }
  }
  const beforeByIndex = new Map(before.schedules.map((schedule) => [
    schedule.requirementIndex,
    schedule,
  ]));
  for (const schedule of after.schedules) {
    const appliedSchedule = beforeByIndex.get(schedule.requirementIndex) || {};
    for (const [field, label] of [
      ["name", "考试名称"],
      ["start", "开始时间"],
      ["end", "结束时间"],
    ]) {
      const beforeValue = text(appliedSchedule[field]);
      if (beforeValue !== schedule[field]) {
        changes.push(managedChange(
          `schedules[${schedule.requirementIndex}].${field}`,
          `日程${schedule.requirementIndex + 1}${label}`,
          beforeValue,
          schedule[field],
          schedule.requirementIndex,
        ));
      }
    }
  }
  return changes;
}

function appliedScheduleIdentityConflict(snapshot = {}) {
  if (!Array.isArray(snapshot.schedules)) return false;
  return snapshot.schedules.some((schedule, index) =>
    !Number.isInteger(Number(schedule?.requirementIndex))
    || Number(schedule.requirementIndex) !== index);
}

export function operationBatchUpdateState(task = {}) {
  const current = task.config?.operationBatch || {};
  const batchCode = text(task.config?.operationBatchCode || current.code);
  if (!operationBatchCodeIsValid(batchCode)) {
    return {
      status: operationBatchNeedsReconciliation(task) ? "reconciliation_required" : "ready",
      baselineRequired: false,
      missing: [],
      changes: [],
    };
  }

  const desired = buildDesiredOperationBatchSnapshot(task);
  const hasManagedSnapshot = Boolean(
    current.managedSnapshot
    && typeof current.managedSnapshot === "object"
    && !Array.isArray(current.managedSnapshot),
  );
  const applied = hasManagedSnapshot ? current.managedSnapshot : {};
  const desiredScheduleCount = examRequirements(task).length;
  const appliedScheduleCount = Array.isArray(applied.schedules) ? applied.schedules.length : 0;
  const changes = desired.complete ? operationBatchManagedDiff(applied, desired.snapshot) : [];
  let status;
  if (desiredScheduleCount < appliedScheduleCount || appliedScheduleIdentityConflict(applied)) {
    status = "update_conflict";
  } else if (!desired.complete) {
    status = "waiting_schedule";
  } else if (changes.length) {
    status = "update_available";
  } else {
    status = "success";
  }
  return {
    status,
    baselineRequired: !hasManagedSnapshot,
    missing: desired.missing,
    changes,
  };
}

function normalizedManagedSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("缺少运营批次受管快照");
  }
  const batchName = text(snapshot.batchName);
  const examStartParts = dateParts(snapshot.examStartDate);
  const examEndParts = dateParts(snapshot.examEndDate);
  const schedules = Array.isArray(snapshot.schedules) ? snapshot.schedules : null;
  if (
    !batchName
    || !examStartParts
    || !examEndParts
    || Date.UTC(...[examStartParts[0], examStartParts[1] - 1, examStartParts[2]])
      > Date.UTC(...[examEndParts[0], examEndParts[1] - 1, examEndParts[2]])
    || !schedules
  ) {
    throw new Error("运营批次受管快照不完整或格式不合法");
  }
  if (!schedules.length) {
    throw new Error("运营批次受管快照必须包含至少一条完整日程");
  }
  const normalizedSchedules = schedules.map((schedule, index) => {
    const requirementIndex = Number(schedule?.requirementIndex);
    const name = text(schedule?.name);
    const startParts = dateTimeParts(schedule?.start);
    const endParts = dateTimeParts(schedule?.end);
    if (
      !Number.isInteger(requirementIndex)
      || requirementIndex !== index
      || !name
      || !startParts
      || !endParts
      || dateTimeValue(startParts) > dateTimeValue(endParts)
    ) {
      throw new Error("运营批次受管快照不完整或格式不合法");
    }
    return {
      requirementIndex,
      name,
      start: dateTimeString(startParts),
      end: dateTimeString(endParts),
    };
  });
  const examStartDate = dateString(examStartParts);
  const examEndDate = dateString(examEndParts);
  const scheduleStartDate = [...normalizedSchedules]
    .sort((left, right) => left.start.localeCompare(right.start))[0].start.slice(0, 10);
  const scheduleEndDate = [...normalizedSchedules]
    .sort((left, right) => left.end.localeCompare(right.end)).at(-1).end.slice(0, 10);
  if (examStartDate !== scheduleStartDate || examEndDate !== scheduleEndDate) {
    throw new Error("运营批次受管快照概况日期与日程范围不一致");
  }
  return {
    batchName,
    examStartDate,
    examEndDate,
    schedules: normalizedSchedules,
  };
}

export function applyOperationBatchManagedResult(task = {}, result = {}) {
  if (result.verified !== true) {
    throw new Error("运营批次受管结果未通过回读验证");
  }
  const managedSnapshot = normalizedManagedSnapshot(result.snapshot);
  const current = task.config?.operationBatch || {};
  const managedSnapshotVersion = Number(current.managedSnapshotVersion || 0) + 1;
  const lastManagedSyncAt = text(result.syncedAt) || new Date().toISOString();
  const event = {
    type: "operation_batch_managed_sync",
    action: text(result.action) || "sync",
    at: lastManagedSyncAt,
    version: managedSnapshotVersion,
    ...(text(result.detailUrl) ? { detailUrl: text(result.detailUrl) } : {}),
    ...(result.checkpoints === undefined ? {} : {
      checkpoints: Array.isArray(result.checkpoints)
        ? result.checkpoints.slice()
        : { ...result.checkpoints },
    }),
  };
  return {
    operationBatch: {
      ...current,
      managedSnapshot,
      managedSnapshotVersion,
      lastManagedSyncAt,
      managedEvents: [
        ...(Array.isArray(current.managedEvents) ? current.managedEvents : []),
        event,
      ],
    },
  };
}
