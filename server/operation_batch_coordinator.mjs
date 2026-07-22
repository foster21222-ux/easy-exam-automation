export function createOperationBatchCoordinator(options = {}) {
  const {
    acquireLock,
    releaseLock,
    profileInFlight,
    taskInFlight,
    profileKey = "persistent-profile",
  } = options;

  function once(release) {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  }

  function acquireTask(taskId) {
    acquireLock(taskInFlight, taskId);
    return once(() => releaseLock(taskInFlight, taskId));
  }

  function acquireAutomation(taskId) {
    acquireLock(profileInFlight, profileKey);
    let releaseTask;
    try {
      releaseTask = acquireTask(taskId);
    } catch (error) {
      releaseLock(profileInFlight, profileKey);
      throw error;
    }
    return once(() => {
      releaseTask();
      releaseLock(profileInFlight, profileKey);
    });
  }

  return { acquireAutomation, acquireTask };
}

export async function withFreshOperationBatchTask(options = {}) {
  const {
    acquire,
    readTask,
    run,
    onAcquireError = (error) => { throw error; },
    onMissing = () => null,
  } = options;
  let release;
  try {
    release = acquire();
  } catch (error) {
    return await onAcquireError(error);
  }
  try {
    const task = await readTask();
    if (!task) return await onMissing();
    return await run(task);
  } finally {
    release();
  }
}

export async function readFreshOperationBatchTask(readTask, fallbackTask) {
  try {
    return await readTask();
  } catch {
    return fallbackTask;
  }
}

export function operationBatchCreationFailureResponse(options = {}) {
  const {
    error,
    externalBatchConfirmed = false,
    failure = {},
    task,
    reconciliationErrorCode = "OPERATION_BATCH_RECONCILIATION_REQUIRED",
  } = options;
  const reconciliationRequired = externalBatchConfirmed
    || failure.status === "reconciliation_required";
  const body = {
    error: error instanceof Error ? error.message : String(error),
    ...(reconciliationRequired ? { errorCode: reconciliationErrorCode } : {}),
    ...(task === undefined ? {} : { task }),
  };
  return {
    statusCode: reconciliationRequired ? 409 : (error?.status || 500),
    body,
  };
}
