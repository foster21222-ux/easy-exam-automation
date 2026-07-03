# WeChat Requirement Center Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, review-gated pipeline from configured WeChat groups to structured requirement drafts and change requests in the existing requirement center.

**Architecture:** Keep WeChat access outside the web app and use the visible-window collector as the source adapter. The collector parses visible group messages into drafts, then optionally posts them to the existing requirement-center API; the requirement center remains the source of truth and staff review gate. Later phases add a small local configuration/status surface, launchd scheduling, and attachment enrichment without reading WeChat databases or auto-sending messages.

**Tech Stack:** Node.js ESM scripts, macOS AppleScript/System Events plus macOS Vision OCR for visible WeChat collection, SQLite-backed requirement center, existing Node HTTP API, launchd plist templates, Node test runner.

---

### Task 1: Push Collected WeChat Drafts Into Requirement Center

**Files:**
- Modify: `server/wechat_requirement_collector.mjs`
- Modify: `scripts/wechat_requirement_collect.mjs`
- Modify: `scripts/wechat_visible_collect.mjs`
- Test: `server/test_wechat_requirement_collector.mjs`

- [x] **Step 1: Add a failing test for requirement-center payload creation**

Add a test that builds a WeChat draft and asserts the payload for `/api/ai/requirements/dispatch` includes:
- `intent: "collecting"` when there are no change records.
- `source.type: "wechat_group"`.
- `customer.name` from group config.
- `requirement` copied from the parsed draft.
- `message` containing the visible source text used for audit.

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_wechat_requirement_collector.mjs
```

Expected before implementation: fail because `buildRequirementCenterPayload` is not exported.

- [x] **Step 2: Implement payload creation**

Add `buildRequirementCenterPayload(draft)` to `server/wechat_requirement_collector.mjs`. It should return:

```js
{
  intent: "collecting",
  customer: { name: draft.project.customerName || draft.project.projectName || "" },
  requirement: draft.requirement,
  message: draft.messages.map((item) => item.text).join("\n"),
  source: {
    type: "wechat_group",
    groupName: draft.source.groupName,
    projectName: draft.project.projectName,
    collectedAt: draft.source.collectedAt,
  },
}
```

If `draft.changeRecords.length > 0`, still upsert the latest requirement first in this phase. Change-specific routing is Task 2.

- [x] **Step 3: Add push options to manual and visible collector CLIs**

Add these CLI flags to both collector scripts:
- `--api http://127.0.0.1:8765`
- `--push`

When `--push` is absent, keep current JSON-only behavior. When present, POST each draft payload to `${api}/api/ai/requirements/dispatch`, include the API response beside the draft in stdout, and write checkpoint only after the push succeeds.

- [x] **Step 4: Run focused verification**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_wechat_requirement_collector.mjs
```

Expected: all WeChat collector tests pass.

### Task 2: Route WeChat Change Records To Requirement Change Requests

**Files:**
- Modify: `server/wechat_requirement_collector.mjs`
- Modify: `scripts/wechat_requirement_collect.mjs`
- Modify: `scripts/wechat_visible_collect.mjs`
- Test: `server/test_wechat_requirement_collector.mjs`
- Test: `server/test_requirement_request_api.mjs`

- [x] **Step 1: Add request identity to group config**

Support optional group config keys:

```json
{
  "group_name": "AI赋能运营自动化小组",
  "project_name": "易考自动化需求",
  "customer_name": "内部测试客户",
  "requirement_request_id": "wechat-ai-ops"
}
```

If `requirement_request_id` exists, use it as `requestId` when posting to the requirement center. If absent, let the requirement center generate an ID and store returned `requestId` in the local checkpoint state.

- [x] **Step 2: Convert parsed change records to change-request payloads**

After a successful upsert, if `draft.changeRecords` is not empty, POST one `/api/ai/requirements/dispatch` payload with:

```js
{
  intent: "change_request",
  requestId,
  customerMessage: draft.changeRecords.map((record) => record.message).join("\n"),
  changes: { changeRecords: draft.changeRecords, latestRequirement: draft.requirement },
  source: draft.source,
}
```

Expected behavior: change requests appear in the requirement detail timeline and do not overwrite a reviewed requirement without staff action.

- [x] **Step 3: Verify API change behavior**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_requirement_request_api.mjs server/test_wechat_requirement_collector.mjs
```

Expected: API tests and WeChat collector tests pass.

### Task 3: Add Scheduler-Safe Runtime Output And Logs

**Files:**
- Modify: `scripts/wechat_visible_collect.mjs`
- Modify: `deploy/com.ata.easy-exam-wechat-collector.plist.template`
- Modify: `docs/wechat-requirement-collector.md`

- [x] **Step 1: Add `--output` and structured run summary**

Add `--output .easy_exam_runtime/wechat-last-run.json`. Each run writes:

```json
{
  "startedAt": "...",
  "finishedAt": "...",
  "groups": [
    {
      "groupName": "...",
      "status": "pushed",
      "requestId": "...",
      "messageCount": 3,
      "changeCount": 1
    }
  ]
}
```

Failures should include `status: "failed"` and `error`.

- [x] **Step 2: Update launchd template**

Keep the 15 minute interval. Add `--push`, `--api http://127.0.0.1:8765`, and `--output /Users/ata/Documents/easy-exam-automation/.easy_exam_runtime/wechat-last-run.json`.

- [x] **Step 3: Document install and rollback**

Document:

```bash
cp deploy/com.ata.easy-exam-wechat-collector.plist.template ~/Library/LaunchAgents/com.ata.easy-exam-wechat-collector.plist
launchctl load ~/Library/LaunchAgents/com.ata.easy-exam-wechat-collector.plist
launchctl unload ~/Library/LaunchAgents/com.ata.easy-exam-wechat-collector.plist
```

### Task 4: Surface WeChat Source Metadata In Requirement Center

**Files:**
- Modify: `web/index.html` or current frontend shell file containing requirement views
- Modify: `server/test_ui_views.mjs`
- Modify: `docs/wechat-requirement-collector.md`

- [x] **Step 1: Show source metadata on requirement detail**

In the existing requirement detail view, show source type, group name, collected time, latest version source, missing fields, confirmations, change requests, and timeline entries.

- [x] **Step 2: Keep staff review gate unchanged**

The page must continue to require staff actions:
- request clarification
- mark reviewed
- mark ready
- link task

No WeChat-collected request may automatically create or link an execution task.

### Task 5: Add Local Configuration And Status Page

**Files:**
- Create or modify: a web page for WeChat group configuration/status.
- Add API handlers for reading/writing `.easy_exam_runtime/wechat-requirement-groups.json`.
- Test: API and UI tests matching existing route patterns.

- [x] **Step 1: Add route**

Add a staff-only local route such as `/wechat-collector` with:
- group list
- project/customer mapping
- enabled switch
- interval display
- last run status from `.easy_exam_runtime/wechat-last-run.json`

- [x] **Step 2: Add safe config API**

Expose local-only APIs:
- `GET /api/wechat-collector/config`
- `PUT /api/wechat-collector/config`
- `GET /api/wechat-collector/status`

The API writes only runtime config files under `.easy_exam_runtime`, not tracked example config.

### Task 6: Attach Downloaded Files To Requirement Draft Context

**Files:**
- Modify: `server/wechat_attachment_scanner.mjs`
- Modify: `server/wechat_requirement_collector.mjs`
- Modify: `scripts/wechat_visible_collect.mjs`
- Test: `server/test_wechat_attachment_scanner.mjs`

- [x] **Step 1: Associate recent downloaded files with the run**

Scan only `*/msg/file`, then include a recently modified attachment only when its normalized filename appears in the current group's visible text. Do not auto-click or download, and do not attach unrelated files from other groups.

- [x] **Step 2: Include attachment previews in the audit message**

Append lightweight previews for `.xlsx`, `.txt`, and `.csv` to the message sent to the requirement center. Keep `.pdf`, `.docx`, and images as metadata until content extraction is explicitly added.

### Verification Checklist

- [x] Automated handler-level verification proves a WeChat-style draft can push one demand into the requirement center and persist it in sqlite.
- [x] Automated handler-level verification proves later WeChat-style change wording creates a pending change request linked to the same requirement without overwriting the original demand version.
- [x] UI/static route tests prove `/requirements`, `/requirements/:requestId`, and `/wechat-collector` render the staff review and collector surfaces.
- [x] Static template checks prove the launchd template invokes the push-capable collector on the 15 minute interval.
- [x] The default scheduled collector and page-triggered run-once path use `--captureMode ocr`, which opens the configured group, screenshots the visible WeChat window region, and extracts text through macOS Vision OCR.
- [x] Automated tests cover the safety boundary: local runtime config writes only, read-only downloaded attachment scanning, no WeChat database reads, no auto-download path, and no automatic execution-task creation.
- [x] Attachment association requires the downloaded filename to appear in the current group's visible text, preventing recent files from unrelated project groups entering the demand context.
- [x] OCR capture crops the WeChat window to the chat transcript region with configurable insets, excluding the conversation sidebar and message input area from requirement parsing.
- [x] Installation buttons stay disabled until valid configuration, a fresh pipeline smoke test, and fresh per-group real pushes all pass; backend validation remains authoritative.
- [x] Dry-run preflight performs a read-only WeChat window geometry check and validates the computed chat capture rectangle without activating WeChat, taking a screenshot, running OCR, or pushing data.
- [x] A blank raw OCR/clipboard capture fails before checkpoint filtering, attachment scanning, or pushing, while a nonblank capture with no post-checkpoint messages remains a normal `no_new_messages` run.
- [x] When the scheduler is loaded, readiness includes a separate 60-minute collector heartbeat so an old successful result cannot hide a stopped scheduled job.
- [x] Checkpoints retain up to 200 recent message hashes, allowing overlap deduplication when the previous last line has scrolled out of the visible WeChat viewport while remaining backward-compatible with old checkpoints.
- [x] The requirement center deduplicates identical pending change requests by customer message and normalized changes, while allowing the same request to be raised again after an earlier change is accepted or rejected.
- [x] Live manual text collector push into a running local service was verified on a temporary port with a temporary sqlite DB: the initial draft appeared in `/api/requirements`, and a later change-only message created a pending change request on the same `requestId`.
- [x] The `/wechat-collector` page exposes a separate go-live gate showing which checks are automated and which require explicit operator action before the Mac is allowed to control WeChat on a schedule.
- [x] Scheduler and full-automation install APIs reject installation unless both the pipeline smoke test and a real WeChat push succeeded within the previous 24 hours.
- [x] Multi-group installation requires every enabled group to have a successful push within 24 hours, accumulating per-group trials from run history and naming any missing groups.
- [x] Live visible WeChat collector push verified against `AI赋能运营自动化小组`: window-ID capture confirmed the target title, OCR parsed the visible time/login/subject changes, and the requirement center created a pending change request without adding a requirement version.
- [x] Actual launchd service and 15-minute collector jobs are installed from the Application Support deployment, loaded, and background-run verified with fresh heartbeat, window capture, title validation, OCR, checkpoint safety, and exit code 0.
