# Dify Requirement Review Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strengthen the requirement center so Dify-collected requirements flow through manual internal review, customer confirmation, change tracking, and manual execution handoff without generating Excel or running platform automation.

**Architecture:** Extend the existing SQLite requirement store and Node requirement API with review-gate statuses and staff actions. Update the existing `/requirements` SPA surfaces to show grouped requirement data, versions, confirmations, change requests, timeline events, and state-aware staff actions. Add Dify integration documentation after the API and UI contract is stable.

**Tech Stack:** Python 3 `sqlite3` and `unittest`, Node.js ESM HTTP handlers and `node:test`, existing vanilla web modules and HTML prototype.

---

## File Structure

- Modify `server/requirement_request_db.py`: add review-gate statuses, allowed transitions, staff review methods, event payloads, and status migration from old names.
- Modify `server/test_requirement_request_db.py`: add store tests for manual review, clarification, confirmation gating, change review, ready/link statuses, and timeline events.
- Modify `server/requirement_request_api.mjs`: expose staff actions `request-clarification` and `mark-reviewed`; update ready/link route behavior through the store.
- Modify `server/test_requirement_request_api.mjs`: add HTTP tests for Dify confirmation not bypassing staff review and staff review-gate routes.
- Modify `outputs/web_prototype/easy_exam_automation.html`: render richer requirement list/detail data and wire new staff actions.
- Modify `server/test_ui_views.mjs`: assert the requirement UI contains review-gate controls and change/timeline sections.
- Create `docs/dify-requirement-api.md`: document Dify HTTP node sequence, payload examples, response handling, and manual-review boundary.
- Keep Excel import and platform execution files unchanged except when shared route tests require harmless assertions.

## Task 1: Requirement Store Review Gate

**Files:**
- Modify: `server/test_requirement_request_db.py`
- Modify: `server/requirement_request_db.py`

- [ ] **Step 1: Add failing store tests for review gate statuses**

Append tests that exercise:

```python
def test_review_gate_requires_staff_review_after_customer_confirmation(self):
    created = self.store.create_or_update_requirement(requirement=complete_requirement())
    request_id = created["requestId"]

    confirmed = self.store.record_customer_confirmation(
        request_id,
        customer_reply="客户确认当前需求",
        conversation_id="conv-100",
    )
    self.assertEqual(confirmed["status"], "customer_confirmed")
    self.assertEqual(confirmed["confirmations"][0]["conversationId"], "conv-100")

    with self.assertRaises(ValueError):
        self.store.link_task(request_id, task_id="task-should-not-link")

    ready = self.store.mark_ready_for_manual_execution(request_id, reviewer="ops-a")
    self.assertEqual(ready["status"], "ready_for_manual_execution")

    linked = self.store.link_task(request_id, task_id="manual-task-001")
    self.assertEqual(linked["status"], "linked_to_execution_task")
    self.assertEqual(linked["linkedTaskId"], "manual-task-001")
```

and:

```python
def test_staff_review_and_change_request_flow_records_timeline(self):
    created = self.store.create_or_update_requirement(requirement=complete_requirement())
    request_id = created["requestId"]

    clarification = self.store.request_customer_clarification(
        request_id,
        reviewer="ops-a",
        message="请补充候选人名单是否需要模板",
    )
    self.assertEqual(clarification["status"], "need_customer_clarification")

    reviewed = self.store.mark_reviewed_waiting_customer_confirmation(
        request_id,
        reviewer="ops-a",
        message="字段已核对，等待客户确认",
    )
    self.assertEqual(reviewed["status"], "reviewed_waiting_customer_confirmation")

    confirmed = self.store.record_customer_confirmation(request_id, "确认执行")
    self.assertEqual(confirmed["status"], "customer_confirmed")

    changed = self.store.create_change_request(
        request_id,
        customer_message="请增加政治科目",
        changes={"subjects": "英语，化学，物理，政治"},
    )
    self.assertEqual(changed["status"], "change_requested")
    self.assertEqual(changed["changeRequests"][0]["changes"]["subjects"], ["英语", "化学", "物理", "政治"])

    reviewed_change = self.store.create_or_update_requirement(
        request_id=request_id,
        requirement=complete_requirement(subjects="英语，化学，物理，政治"),
        source="staff",
    )
    self.assertEqual(reviewed_change["status"], "pending_internal_review")
    self.assertTrue(any(event["eventType"] == "customer_clarification_requested" for event in reviewed_change["events"]))
```

- [ ] **Step 2: Run store tests to verify RED**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest server/test_requirement_request_db.py -v
```

Expected: FAIL with missing methods or old status names.

- [ ] **Step 3: Implement store statuses and transitions**

In `server/requirement_request_db.py`:

- Add constants for new statuses.
- Add `request_customer_clarification(request_id, reviewer="", message="")`.
- Add `mark_reviewed_waiting_customer_confirmation(request_id, reviewer="", message="")`.
- Rename behavior behind `mark_ready_to_create_task` to call `mark_ready_for_manual_execution`.
- Add `mark_ready_for_manual_execution(request_id, reviewer="")`.
- Make `link_task` require current status `ready_for_manual_execution` and set `linked_to_execution_task`.
- Keep CLI action `mark_ready` for API compatibility, but return the new status.
- Record events `customer_clarification_requested`, `reviewed_waiting_customer_confirmation`, `ready_for_manual_execution`, and `execution_task_linked`.

- [ ] **Step 4: Run store tests to verify GREEN**

Run the same Python unittest command.

Expected: all store tests PASS.

## Task 2: Requirement API Review Gate

**Files:**
- Modify: `server/test_requirement_request_api.mjs`
- Modify: `server/requirement_request_api.mjs`

- [ ] **Step 1: Add failing API tests for staff review actions**

Add a test that:

- Creates a complete Dify requirement.
- Calls `/api/ai/requirements/:id/customer-confirmed`.
- Asserts `/api/requirements/:id/link-task` fails before mark-ready.
- Calls `/api/requirements/:id/mark-ready`.
- Calls `/api/requirements/:id/link-task`.
- Asserts statuses are `customer_confirmed`, `ready_for_manual_execution`, and `linked_to_execution_task`.

Add another test that:

- Calls `/api/requirements/:id/request-clarification`.
- Calls `/api/requirements/:id/mark-reviewed`.
- Asserts statuses `need_customer_clarification` and `reviewed_waiting_customer_confirmation`.

- [ ] **Step 2: Run API tests to verify RED**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_requirement_request_api.mjs
```

Expected: FAIL because new routes or status names are not implemented.

- [ ] **Step 3: Implement API routes**

In `server/requirement_request_api.mjs`:

- Add `POST /api/requirements/:id/request-clarification`.
- Add `POST /api/requirements/:id/mark-reviewed`.
- Keep `POST /api/requirements/:id/mark-ready` but map to the new store behavior.
- Return JSON errors with HTTP 400 for invalid transitions from the Python store.

- [ ] **Step 4: Run API tests to verify GREEN**

Run the same Node test command.

Expected: all API tests PASS.

## Task 3: Requirement UI Review Gate

**Files:**
- Modify: `server/test_ui_views.mjs`
- Modify: `outputs/web_prototype/easy_exam_automation.html`

- [ ] **Step 1: Add failing UI assertions**

Extend `server/test_ui_views.mjs` to assert the HTML contains:

```javascript
assert.ok(html.includes('id="requirementClarificationBtn"'));
assert.ok(html.includes('id="requirementReviewedBtn"'));
assert.ok(html.includes('id="requirementTimeline"'));
assert.ok(html.includes('id="requirementVersions"'));
assert.ok(html.includes('id="requirementChanges"'));
assert.ok(html.includes('ready_for_manual_execution'));
```

- [ ] **Step 2: Run UI tests to verify RED**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_ui_views.mjs
```

Expected: FAIL on missing controls or sections.

- [ ] **Step 3: Implement detail sections and staff actions**

In the requirement detail section of `outputs/web_prototype/easy_exam_automation.html`:

- Add buttons for requesting clarification and marking reviewed.
- Add sections for latest fields, version history, change requests, confirmations, and timeline.
- Update `renderRequirementDetail` to display the new status names and events.
- Add click handlers that call `/request-clarification`, `/mark-reviewed`, `/mark-ready`, and `/link-task`.
- Keep copy focused on operations; do not mention Excel generation.

- [ ] **Step 4: Run UI tests to verify GREEN**

Run the same UI test command.

Expected: all UI tests PASS.

## Task 4: Dify Integration Guide

**Files:**
- Create: `docs/dify-requirement-api.md`

- [ ] **Step 1: Write the guide**

Document:

- Dify HTTP node order.
- `upsert`, `get`, `customer-confirmed`, and `change-request` endpoints.
- JSON examples for complete and incomplete requirements.
- How to reuse `requestId` across a Dify conversation.
- Manual review boundary: Dify confirmation does not create execution tasks.
- Pilot checklist for comparing Dify records against staff expectations.

- [ ] **Step 2: Review guide for scope**

Run:

```bash
rg -n "生成 Excel|创建考试|自动执行|auto-approve|自动放行" docs/dify-requirement-api.md
```

Expected: no matches that describe in-scope behavior.

## Task 5: Full Verification and Handoff

**Files:**
- All files changed above.

- [ ] **Step 1: Run Python store tests**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest server/test_requirement_request_db.py -v
```

Expected: PASS.

- [ ] **Step 2: Run Node API/UI/router tests**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_requirement_request_api.mjs server/test_app_router.mjs server/test_ui_views.mjs
```

Expected: PASS.

- [ ] **Step 3: Run server smoke test**

Start:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server/easy_exam_server.mjs
```

Then call:

```bash
curl -sS http://127.0.0.1:8765/api/health
curl -sS -X POST http://127.0.0.1:8765/api/ai/requirements/upsert -H 'Content-Type: application/json' --data '{"customer":{},"requirement":{"exam_name":"2026招聘考试","formal_exam_time_range":"2026-07-01 09:00 - 2026-07-01 11:00","mock_exam_time_range":"2026-06-30 15:00 - 2026-06-30 16:00","early_login_minutes":"30分钟","late_limit_minutes":"15分钟","video_monitor_required":"是","video_record_required":"是","hawkeye_required":"否","exam_client_type":"网页考试","leave_limit_count":8,"subjects":"英语，化学，物理"}}'
curl -sS -o /tmp/easy-exam-requirements.html -w '%{http_code} %{content_type}\n' http://127.0.0.1:8765/requirements
```

Expected: health OK, upsert status `pending_internal_review`, and `/requirements` returns `200 text/html`.

- [ ] **Step 4: Review diff**

Run:

```bash
git status --short && git diff --stat
```

Expected: changes are limited to requirement-center tests, store/API/UI, Dify guide, and this plan.

- [ ] **Step 5: Commit and push**

Run:

```bash
git add docs server outputs
git commit -m "feat: add dify requirement review gate"
git push origin codex/dify-requirement-review-gate
```

Expected: branch is pushed to the user fork for PR creation.

## Self-Review

- Spec coverage: backend status flow, staff review gate, customer confirmations, change requests, timeline, UI review sections, Dify guide, and no-Excel/no-execution boundary are covered.
- Placeholder scan: no `TBD`, `TODO`, `implement later`, or undefined method names remain.
- Type consistency: status names match the design document: `need_customer_clarification`, `reviewed_waiting_customer_confirmation`, `ready_for_manual_execution`, and `linked_to_execution_task`.
