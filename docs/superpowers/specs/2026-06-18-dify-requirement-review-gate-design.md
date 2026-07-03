# Dify Requirement Review Gate Design

## Goal

Build the next requirement-center phase around Dify-collected customer requirements, manual internal review, customer confirmation records, and auditable requirement changes.

This phase intentionally does not generate Excel requirement sheets and does not execute platform automation. The existing main-version Excel import flow remains available while the Dify flow matures.

## Product Boundary

In scope:

- Dify writes structured customer requirements into `easy-exam-automation`.
- Staff review Dify-collected requirements in `/requirements`.
- Staff can mark a requirement as needing customer clarification, reviewed and waiting for customer confirmation, customer confirmed, or ready for manual execution handoff.
- Customer confirmations and change requests are kept as first-class records.
- Requirement versions and timeline events make every important change auditable.
- Staff may record a weak link to a later execution task, but this phase does not create or run that task.

Out of scope:

- Generating `.xlsx` requirement sheets from Dify records.
- Replacing the current Excel import path.
- Automatically creating exams, sessions, subjects, papers, candidates, rooms, or monitor-account exports.
- Auto-approving Dify requirements without staff review.
- Building a custom customer chat UI outside Dify.

## Operating Model

Dify is the customer-facing collector. It asks questions, extracts fields, and calls stable HTTP APIs in this repository.

`easy-exam-automation` is the operational source of truth for collected requirements. It stores the normalized requirement, missing fields, review state, confirmations, change requests, and timeline events.

Internal staff are the approval gate during the early phase. Even when Dify marks a customer as having confirmed the requirement, staff must still review the record before it is allowed to move to manual execution handoff.

## Status Flow

The initial state flow is:

```text
collecting
-> pending_internal_review
-> need_customer_clarification
-> reviewed_waiting_customer_confirmation
-> customer_confirmed
-> ready_for_manual_execution
-> linked_to_execution_task
```

Change flow:

```text
customer_confirmed
-> change_requested
-> pending_internal_review
```

Status meanings:

- `collecting`: Dify has not supplied all required fields or validation errors remain.
- `pending_internal_review`: Dify supplied a complete normalized requirement; staff must review it.
- `need_customer_clarification`: staff found missing or ambiguous information and Dify/customer should supplement it.
- `reviewed_waiting_customer_confirmation`: staff reviewed the requirement and it can be sent back through Dify for customer confirmation.
- `customer_confirmed`: customer confirmation has been recorded, but execution is still not automatic.
- `ready_for_manual_execution`: staff explicitly approved the confirmed requirement for downstream manual handling.
- `linked_to_execution_task`: staff recorded a reference to a downstream execution task created by the main version or another process.
- `change_requested`: customer requested a change after confirmation; staff must review the new change before it can proceed again.

## Data Model Changes

The existing requirement store already has:

- `requirement_requests`
- `requirement_versions`
- `requirement_confirmations`
- `requirement_change_requests`
- `requirement_events`

This phase extends behavior around those tables before adding new tables.

`requirement_requests.status` should support the new status names. The old `ready_to_create_task` maps to `ready_for_manual_execution`; the old `task_created` maps to `linked_to_execution_task`.

Requirement events should be recorded for:

- Dify upserted requirement
- internal review started or completed
- staff requested customer clarification
- staff marked reviewed and waiting for customer confirmation
- customer confirmation received
- customer change requested
- staff marked ready for manual execution
- staff linked downstream execution task

Each event payload should include only small JSON-safe metadata, such as reviewer name, conversation id, message summary, version number, missing fields, or linked task id.

## Dify-Facing API

Dify integration should happen after the backend state model and `/requirements` review UI are stable.

The first Dify integration step is not a separate application. It is a small integration guide and stable HTTP contract in this repository.

Dify should call:

```text
POST /api/ai/requirements/upsert
GET  /api/ai/requirements/:requestId
POST /api/ai/requirements/:requestId/customer-confirmed
POST /api/ai/requirements/:requestId/change-request
```

`POST /api/ai/requirements/upsert` remains the main collection endpoint. Dify can call it multiple times during a conversation. Each call creates a new version.

`POST /api/ai/requirements/:requestId/customer-confirmed` records the customer's confirmation text and conversation id. It should not bypass staff review.

`POST /api/ai/requirements/:requestId/change-request` records a customer change request separately from the currently approved requirement version. It should not overwrite the latest reviewed requirement directly.

## Staff API

The staff UI should use:

```text
GET  /api/requirements
GET  /api/requirements/:requestId
POST /api/requirements/:requestId/request-clarification
POST /api/requirements/:requestId/mark-reviewed
POST /api/requirements/:requestId/mark-ready
POST /api/requirements/:requestId/link-task
```

`mark-ready` should set `ready_for_manual_execution`, not create an execution task.

`link-task` should only store a reference to a downstream task id. It should set `linked_to_execution_task`.

## Staff UI

The `/requirements` list should show:

- Requirement title
- Customer name/contact
- Current status
- Missing-field count
- Latest version
- Last updated time

The `/requirements/:requestId` detail page should show:

- Current status and next allowed staff actions
- Customer information
- Normalized requirement fields grouped by business area
- Missing fields and validation errors
- Latest requirement version
- Version history
- Customer confirmation records
- Change request records
- Timeline events
- Linked downstream task id, when present

Staff action buttons should be state-aware:

- `need_customer_clarification`: available from `pending_internal_review` or `change_requested`
- `reviewed_waiting_customer_confirmation`: available from `pending_internal_review` or `change_requested`
- `ready_for_manual_execution`: available only after `customer_confirmed`
- `linked_to_execution_task`: available only after `ready_for_manual_execution`

## Dify Collection Timing

Dify requirement collection should be implemented in this order:

1. Stabilize backend statuses, events, and staff APIs.
2. Stabilize `/requirements` list/detail UI for manual review.
3. Add Dify integration documentation with request examples, required fields, and response handling.
4. Configure the Dify Chatflow HTTP nodes against the stable local or deployed endpoint.
5. Run pilot conversations and compare Dify-collected records against manually reviewed expectations.

This avoids building Dify prompts against an unstable API surface.

## Compatibility With Main Version

The main version keeps Excel import and platform execution. This phase does not remove any existing Excel import code or execution code.

The Dify route gradually becomes the preferred intake path only after:

- Staff can reliably review Dify-created requirements.
- Change requests and customer confirmations are auditable.
- Pilot conversations produce complete requirements with low correction rates.
- The team explicitly decides to reduce or retire Excel intake.

## Verification

Backend tests should prove:

- Complete Dify upserts move to `pending_internal_review`.
- Incomplete Dify upserts stay in `collecting`.
- Customer confirmations do not bypass staff review.
- Change requests create separate records and move status to `change_requested`.
- Staff review actions move only through allowed statuses.
- Ready/link actions use `ready_for_manual_execution` and `linked_to_execution_task`.

Frontend tests should prove:

- `/requirements` renders Dify-created records.
- Detail page shows latest fields, missing fields, versions, confirmations, change requests, and events.
- Action controls appear only for valid statuses.

Integration verification should prove:

- Dify-style `upsert`, `customer-confirmed`, and `change-request` calls work through the Node API.
- Staff can complete the manual review path without generating Excel or invoking execution automation.

## Open Later

These are explicitly later-phase decisions:

- Whether some trusted customers can auto-advance after Dify confirmation.
- Whether Dify should generate customer-facing confirmation text itself or request it from the platform.
- Whether the Dify flow should eventually export Excel for compatibility during migration.
- Whether requirement records should directly create execution tasks after the manual review phase is proven stable.
