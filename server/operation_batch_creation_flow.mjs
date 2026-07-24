import { operationBatchCodeIsValid } from "./operation_batch.mjs";

function taskFromPersistence(result) {
  return result?.task || result;
}

export async function runOperationBatchCreationFlow({
  taskId,
  task,
  desired,
  createBatch,
  persistBatch,
  initializeSchedules,
  persistManaged,
  persistFailure,
}) {
  const creationDesired = {
    ...desired,
    snapshot: {
      ...(desired?.snapshot || {}),
      schedules: [],
    },
  };
  const created = await createBatch({ taskId, task, desired: creationDesired });
  if (!operationBatchCodeIsValid(created?.operationBatchCode)) {
    throw new Error("运营批次代码格式不合法");
  }

  const operationBatchCode = created.operationBatchCode;
  const persistedBatch = await persistBatch(created);
  if (!desired?.complete) {
    return {
      status: "waiting_schedule",
      operationBatchCode,
      task: taskFromPersistence(persistedBatch),
    };
  }

  try {
    const managedResult = await initializeSchedules({
      batch: { code: operationBatchCode },
      desiredSnapshot: desired.snapshot,
    });
    if (managedResult?.verified !== true) {
      throw new Error("运营批次日程初始化结果未通过回读验证");
    }
    const persistedManaged = await persistManaged(managedResult);
    return {
      status: "success",
      operationBatchCode,
      task: taskFromPersistence(persistedManaged),
      managedResult,
    };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    const persistedFailure = await persistFailure(failure, {
      operationBatchCode,
      persistedBatch,
    });
    failure.operationBatchCode = operationBatchCode;
    failure.operationBatchStatus = "update_failed";
    failure.task = taskFromPersistence(persistedFailure);
    throw failure;
  }
}
