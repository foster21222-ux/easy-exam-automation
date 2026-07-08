# Test Console Session Change Design

## Goal

Add the first manual "change modification" capability for already-created EasyExam tasks: update basic session information from a separate local test console, without changing the current `8765` console or its runtime state.

The feature must call the real EasyExam tenant API. It is not a mock workflow. Isolation is local-platform isolation: a separate port and runtime directory are used for testing.

## Scope

First phase supports only session information changes.

Editable fields:

- Session name: `name`
- Start time: `start`
- End time: `end`
- Early login minutes: `early`
- Late limit minutes: `later`
- Welcome message: `message`
- Login notice: `notice`

Out of scope for this phase:

- Paper content editing or paper rebinding
- Candidate create, update, delete, list diff, or re-rooming
- Requirement-center change request execution
- Deleting sessions
- Changing arbitrary session IDs not attached to the selected task

## Local Isolation

The existing daily console at `http://127.0.0.1:8765` must not be modified or used for this test flow.

The implementation will support a test console launched with a separate port and runtime directory:

```bash
PORT=8876 EASY_EXAM_RUNTIME_DIR=.easy_exam_runtime_test npm start
```

Default behavior remains unchanged:

- If `EASY_EXAM_RUNTIME_DIR` is not set, the app still uses `.easy_exam_runtime`.
- Existing launchd templates and `npm start` behavior for port `8765` remain compatible.
- Test console state, uploaded files, auth sessions, and task database live under `.easy_exam_runtime_test`.

The session change UI appears only when the server is running in test runtime mode or an explicit feature flag enables it. This prevents operators from finding the new write action in the current `8765` console during the first phase.

## Tenant API Behavior

The EasyExam document defines session update as:

```text
PUT /tenant/api/session/[session_id]/
```

Request body is the same shape as creating a session. To avoid dropping required or unknown fields, the local server will:

1. Verify the requested `taskId` is visible to the current user.
2. Verify `sessionId` belongs to that task.
3. Fetch the full current session detail from the tenant API.
4. Merge only allowed field changes into the fetched detail payload.
5. Send the merged payload with `PUT /tenant/api/session/[session_id]/`.
6. Fetch or trust the returned result enough to update local task state for name/start/end.

The feature intentionally calls the real configured EasyExam API base. The confirmation UI must show the API base and session ID before execution so the operator understands the target.

API keys and passwords are never written to logs.

## Local APIs

Add a local preview endpoint:

```text
GET /api/tasks/:taskId/sessions/:sessionId/change-preview
```

Response includes:

- `taskId`
- `sessionId`
- `sessionType`
- `apiBase`
- `editable`
- `current`
- `featureEnabled`

Add a local execution endpoint:

```text
POST /api/tasks/:taskId/sessions/:sessionId/change
```

Request body:

```json
{
  "changes": {
    "name": "2026 Mock Exam",
    "start": "2026-07-20 09:00:00",
    "end": "2026-07-20 11:00:00",
    "early": 30,
    "later": 30,
    "message": "考生你好",
    "notice": "请提前完成设备检查"
  },
  "confirm": true
}
```

Server validation:

- Reject when feature is not enabled for the current server mode.
- Reject when `confirm` is not `true`.
- Reject unknown fields.
- Reject empty `name`, invalid dates, `end <= start`, and negative minute values.
- Permit blank `message` and `notice`.
- Permit clearing `early` and `later` by sending empty string or `null`, which removes those keys from the tenant PUT payload.

Response includes:

- `ok`
- `task`
- `session`
- `apiBase`
- `diff`
- `tenantStatus`
- `tenantResponseSummary`
- `logs`

## UI

In the task detail session table, each session row gets a "修改场次" action when the feature is enabled.

Clicking it opens an in-page panel or modal with:

- Task name and session type
- Session ID
- Current API base
- Editable fields
- A difference preview before submit
- A required confirmation checkbox or second confirm button

After success:

- The task detail refreshes.
- The session row shows the updated name/start/end.
- The project log shows a session change record.

After failure:

- No local task state is changed.
- The UI shows the tenant API error message and any safe detail returned by the local endpoint.

## Task State And Audit Log

On success, update the local task session record through `upsert_session`:

- Keep existing `sessionType`, `candidateCount`, `roomCount`, `status`, and `url`.
- Update `name`, `start`, and `end` when changed.

Record a new task step key:

```text
session_change
```

The step log includes:

- session type
- session ID
- changed field names
- old and new values for non-sensitive fields
- API base
- timestamp

Do not log API Key, account password, cookies, or full tenant payload.

## Error Handling

Tenant API failures map to user-facing messages:

- `401`: API Key is invalid or missing.
- `403`: Session does not exist, does not belong to this tenant, or the Key has no permission.
- `429`: Tenant API rate limit, retry later.
- Other non-2xx: show status and safe response summary.

If fetching tenant detail fails, do not attempt PUT.

If PUT succeeds but local state update fails, return a warning that the EasyExam update succeeded but local task sync needs refresh or repair.

## Testing

Use test-first implementation.

Server tests:

- Feature disabled outside test runtime mode.
- Preview rejects a session ID not attached to the task.
- Change rejects unknown fields and invalid time ranges.
- Change fetches tenant detail and sends PUT with unknown original fields preserved.
- Empty `early` or `later` removes that key from the PUT payload.
- Successful change writes `session_change` and updates local session name/start/end.
- Tenant PUT failure leaves local task state unchanged.

UI/static tests:

- HTML includes the session change panel and action only behind the feature gate.
- Client-side diff preview renders old and new values.
- Submit body contains only allowed fields and `confirm: true`.

Manual verification:

1. Start the test console on port `8876` with `.easy_exam_runtime_test`.
2. Configure the real EasyExam tenant API credentials in that test console.
3. Load or create a test task with a real session.
4. Change session name or time.
5. Confirm the PUT succeeds in EasyExam.
6. Confirm the existing `8765` console and `.easy_exam_runtime` were not touched.

## Future Phases

Candidate changes will reuse this change framework:

- `candidate_change` for add, update, delete
- diff preview for uploaded lists
- optional re-rooming after candidate changes

Paper changes will add a separate `paper_change` flow after the session-change foundation is stable.
