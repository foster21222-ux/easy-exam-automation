# Customer Service Scheduler Design

## Goal

Add a local automation that keeps EasyExam online customer service enabled for all exams from 24 hours before the exam starts until the exam ends, then disables it after the exam ends.

The automation runs hourly. Because it is an hourly reconciliation job, actions may happen up to about 59 minutes after the exact boundary.

## Scope

In scope:

- Scan all EasyExam sessions available through the configured tenant API.
- Open online customer service when `now >= session.start - 24h` and `now < session.end`.
- Close online customer service when `now >= session.end`.
- Skip sessions whose `customer_service` state already matches the desired state.
- Log each attempted change and each failure.
- Provide a CLI entry point for manual dry-runs and LaunchAgent execution.
- Provide a LaunchAgent template that runs once per hour.

Out of scope:

- Per-exam custom schedules.
- UI controls in the local console.
- Browser automation against the EasyExam manager page.
- Changing Udesk account settings.

## Existing Signals

The EasyExam manager frontend reads the current state from:

```js
session.config.customer_service
```

The same frontend toggles the switch by calling an internal manager API with:

```js
{ customer: true }
{ customer: false }
```

The local project already stores EasyExam API base and tenant API credentials in runtime settings and environment variables. Existing tenant API flows use `/tenant/api/session/` to list sessions and `/tenant/api/session/:id/` to read or update session detail data.

## Architecture

Add a small, testable scheduler module plus a CLI wrapper:

- `server/customer_service_scheduler.mjs`
  - Pure time decision helpers.
  - Tenant session listing.
  - Session detail retrieval when an update needs the full payload.
  - Customer-service state reconciliation.
- `scripts/customer_service_scheduler.mjs`
  - CLI entry point.
  - Loads environment and runtime settings.
  - Supports `--dry-run` for verification without writes.
- `deploy/com.ata.easy-exam-customer-service-scheduler.plist.template`
  - LaunchAgent template with `StartInterval` set to `3600`.
  - Runs the CLI from the project root.

If existing shared LaunchAgent helpers are extended, changes stay additive and do not alter WeChat collector behavior.

## Data Flow

1. The hourly job starts from launchd.
2. The CLI loads API base and tenant API key.
3. The scheduler calls `GET /tenant/api/session/`.
4. For each session, it normalizes:
   - session id
   - start timestamp
   - end timestamp
   - current `config.customer_service`
5. The decision helper returns one of:
   - `enable`
   - `disable`
   - `skip_before_window`
   - `skip_already_correct`
   - `skip_missing_time`
6. For `enable` or `disable`, the scheduler updates the session customer-service state.
7. The job continues after per-session failures and exits nonzero only when the whole list operation fails or configuration is missing.

## Update Strategy

The implementation should prefer the narrowest verified EasyExam endpoint for changing online customer service. If that endpoint is confirmed as the manager API endpoint behind the current page switch, use it with `{ "customer": true|false }`.

If only tenant session update is available, preserve the original session payload from `GET /tenant/api/session/:id/`, change only `config.customer_service`, and send the updated payload with `PUT /tenant/api/session/:id/`.

The implementation must not construct a partial session payload unless the API is verified to accept partial updates for this field.

## Time Rules

All comparisons use epoch milliseconds after parsing EasyExam timestamps.

For each session:

- Missing or unparseable `start` or `end`: skip and log.
- `now < start - 24h`: skip.
- `start - 24h <= now < end`: desired state is enabled.
- `now >= end`: desired state is disabled.

If `end <= start`, skip and log because the session time range is invalid.

## Idempotency

The scheduler compares the current state before writing.

- If desired is enabled and `config.customer_service === true`, do nothing.
- If desired is disabled and `config.customer_service === false`, do nothing.
- Only mismatched sessions are updated.

This keeps hourly runs safe and avoids unnecessary API calls.

## Error Handling

- Missing API key or API base: fail fast with a clear message.
- List API failure: fail the run.
- Single session update failure: log the failure and continue scanning later sessions.
- Unexpected session shape: skip that session and include its id or index in the log.
- Dry-run mode: report planned actions without making writes.

## Testing

Add focused Node tests for:

- Enabling customer service inside the 24-hour pre-exam window.
- Disabling customer service after exam end.
- Skipping sessions before the window.
- Skipping sessions whose state is already correct.
- Skipping sessions with missing or invalid time fields.
- Continuing after one update fails.
- Dry-run mode reporting actions without writes.

Add a LaunchAgent template test that verifies the customer-service scheduler plist exists and uses a 3600-second interval.

## Operational Notes

The first production rollout should run:

```sh
node scripts/customer_service_scheduler.mjs --dry-run
```

After the dry-run output looks correct, install or load the LaunchAgent. The hourly job can be checked by inspecting its stdout/stderr log files, matching the pattern already used by other local automation jobs in this repository.
