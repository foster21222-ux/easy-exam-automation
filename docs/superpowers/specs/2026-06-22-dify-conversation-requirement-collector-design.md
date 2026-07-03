# Dify Conversation Requirement Collector Design

## Goal

Create a second Dify intake path named `易考需求对话收集` that collects exam-service requirements through natural conversation, converts the conversation into the same structured requirement payload already accepted by `easy-exam-automation`, and keeps the existing form-based Chatflow as a stable fallback.

## Product Boundary

In scope:

- Customer can describe requirements in free text.
- Dify acts as a requirement consultant and asks follow-up questions for missing required fields.
- Dify extracts a normalized JSON draft after every customer message.
- Dify writes the draft to `POST /api/ai/requirements/upsert`.
- Dify uses the API response to decide whether to keep asking questions or show a customer confirmation summary.
- Customer confirmation is recorded with `POST /api/ai/requirements/:requestId/customer-confirmed`.
- The requirement still lands in the `/requirements` manual review queue.
- The current structured form Chatflow remains available for customers with clear, ready-to-enter requirements.

Out of scope:

- Replacing the existing form Chatflow immediately.
- Replacing Excel import in the main version.
- Creating exams, sessions, papers, candidates, rooms, or monitor accounts.
- Calling staff-only APIs from Dify.
- Letting customer confirmation bypass internal review.

## Intake Modes

The Dify workspace should contain two separate apps during the pilot:

- `易考需求收集`: structured form intake, already created.
- `易考需求对话收集`: conversational intake, added by this design.

The two apps call the same requirement-center API. This lets operations compare the quality of form intake and conversation intake without losing the known-good form path.

## Conversation Behavior

The conversational app should behave like an exam implementation consultant:

1. Let the customer describe the requirement naturally.
2. Extract any fields that are already clear.
3. Never ask for customer basic information in this phase.
4. Treat mock exam as always required; ask only for `mock_exam_time_range`.
5. Do not ask about watermark or copy protection. The requirement center defaults both to enabled.
6. Ask one concise follow-up question at a time when required fields are missing.
7. Do not invent values. Unknown values must be omitted from the JSON draft.
8. Reuse the same `requestId` after the first successful upsert. The model must copy the exact `requestId` from the latest requirement-center response in the conversation history.
9. When required fields are complete, show a concise confirmation summary.
10. Only after the customer explicitly confirms, call the customer-confirmed API.

## Required Structured Fields

The conversational app should work toward this payload:

```json
{
  "customer": {},
  "requirement": {
    "exam_name": "2026招聘考试",
    "formal_exam_time_range": "2026-07-01 09:00 - 2026-07-01 11:00",
    "mock_exam_time_range": "2026-06-30 15:00 - 2026-06-30 16:00",
    "early_login_minutes": "30分钟",
    "late_limit_minutes": "15分钟",
    "video_monitor_required": "是",
    "video_record_required": "是",
    "hawkeye_required": "否",
    "exam_client_type": "网页考试",
    "leave_limit_count": 8,
    "subjects": "英语，化学，物理",
    "candidate_template_required": "是",
    "notes": "客户补充说明"
  },
  "message": "Dify 对话抽取",
  "source": "dify"
}
```

Optional fields such as `waiting_notice`, `paper_time_rule`, `welcome_message`, and `commitment_text` may be included when the customer provides them clearly, but the first conversation MVP should not force the customer through these optional fields.

## Prompt Contract

The extraction prompt should require the model to return JSON only:

```json
{
  "intent": "collecting | ready_for_confirmation | customer_confirmed | change_request",
  "requestId": "",
  "requirement": {},
  "next_question": "",
  "customer_summary": ""
}
```

Rules:

- `intent=collecting` when required fields are still missing.
- `intent=ready_for_confirmation` when required fields appear complete and the customer has not yet confirmed.
- `intent=customer_confirmed` only when the customer explicitly says the summarized requirement is correct.
- `intent=change_request` when the customer changes a previously confirmed requirement.
- `next_question` should ask only one missing item.
- `customer_summary` should be human-readable Chinese and contain only known facts.
- The model must omit unknown fields instead of using placeholders.
- After the first API response contains a `requestId`, every later upsert in the same conversation must include that exact `requestId`.

## API Flow

The first Dify implementation can use a simple flow:

```text
Start
-> LLM extract normalized draft
-> HTTP upsert requirement
-> Answer with API status, missing fields, next question, and confirmation summary
```

This first flow may still require a later Dify iteration to branch automatically between upsert, confirmation, and change request. The important first milestone is that free-text customer messages become normalized requirement records through the existing API.

The second Dify iteration should add branching:

```text
LLM intent
-> POST /api/ai/requirements/dispatch
-> collecting/ready_for_confirmation: backend upserts the requirement draft
-> customer_confirmed: backend records customer confirmation
-> change_request: backend records a change request
```

The backend dispatch endpoint keeps the Dify graph simple and avoids fragile JSON parsing or dynamic URL composition inside Dify. Dify remains responsible for deciding intent and producing the normalized JSON payload.

## Manual Review Boundary

The app must tell customers that their confirmed requirement will be submitted for internal review. It must not promise that the platform configuration is created automatically.

The `/requirements` page remains the operational review gate. Staff decide whether a requirement needs clarification, is ready for customer confirmation, or is ready for manual execution handoff.

## Verification

Pilot verification should cover:

- A customer can provide a partial natural-language requirement and receive one follow-up question.
- A second customer message updates the same `requestId` instead of creating a new requirement.
- A customer can provide a complete natural-language requirement and get a confirmation summary.
- The requirement center receives a normalized record with `customer: {}`.
- `mock_exam_time_range` is required and asked for when missing.
- `watermark_enabled` and `copy_forbidden` are not asked in Dify and remain defaulted by the backend.
- The form-based app still exists and is not overwritten.
- No Dify path calls staff APIs or platform execution APIs.
