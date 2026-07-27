import {
  buildDesiredOperationBatchSnapshot,
  normalizedOperationBatchManagedSnapshot,
  operationBatchUpdateState,
} from "./operation_batch_update.mjs";

const ACTION = "请先在建批次环节完成批次信息修改";

function blocked(code, status, detail) {
  return {
    ok: false,
    code,
    status,
    message: `${detail}，${ACTION}`,
    managedSnapshot: null,
    schedules: [],
  };
}

export function operationPersonnelScheduleGate(task = {}) {
  const persistedStatus = String(task.config?.operationBatch?.status || "").trim();
  const state = operationBatchUpdateState(task);
  if (persistedStatus === "update_conflict" || state.status === "update_conflict") {
    return blocked("PERSONNEL_BATCH_SCHEDULE_CONFLICT", "conflict", "批次考试日程存在冲突");
  }
  if (persistedStatus === "waiting_schedule" || state.status === "waiting_schedule") {
    return blocked("PERSONNEL_BATCH_SCHEDULE_INCOMPLETE", "incomplete", "批次考试日程尚未补全");
  }
  if (["updating", "update_failed"].includes(persistedStatus)
      || state.status !== "success"
      || state.baselineRequired) {
    return blocked("PERSONNEL_BATCH_UPDATE_REQUIRED", "update_required", "批次信息尚未完成同步");
  }
  try {
    const managedSnapshot = normalizedOperationBatchManagedSnapshot(
      task.config.operationBatch.managedSnapshot,
    );
    const desired = buildDesiredOperationBatchSnapshot(task);
    if (!desired.complete
        || JSON.stringify(managedSnapshot.schedules) !== JSON.stringify(desired.snapshot.schedules)) {
      return blocked("PERSONNEL_BATCH_SCHEDULE_CONFLICT", "conflict", "批次日程与当前易考需求不一致");
    }
    return {
      ok: true,
      code: "",
      status: "ready",
      message: "",
      managedSnapshot,
      schedules: structuredClone(managedSnapshot.schedules),
    };
  } catch {
    return blocked("PERSONNEL_BATCH_SCHEDULE_CONFLICT", "conflict", "批次受管日程快照无效");
  }
}
