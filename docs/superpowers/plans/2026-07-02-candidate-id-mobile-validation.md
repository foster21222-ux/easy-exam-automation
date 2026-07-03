# Candidate ID and Mobile Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add identity number and mobile number pre-import validation to candidate list import.

**Architecture:** Implement matching validation in the Python parser, browser page, and Node import guard. The browser shows errors before import, while the backend rejects invalid direct API calls.

**Tech Stack:** Python `unittest`, Node `node:test`, plain browser JavaScript inside `outputs/web_prototype/easy_exam_automation.html`, existing sync script for the `8765` runtime.

---

### Task 1: Python Parser Validation

**Files:**
- Modify: `server/test_candidate_list_parser.py`
- Modify: `server/candidate_list_parser.py`

- [ ] **Step 1: Write failing Python tests**

Add tests for valid lowercase-X identity normalization, invalid identity format, invalid birth date, invalid checksum, mobile normalization, invalid mobile length, and permit mapped from phone alias requiring a non-empty phone value.

- [ ] **Step 2: Run Python tests and verify RED**

Run:

```bash
python3 -m unittest server/test_candidate_list_parser.py
```

Expected: new tests fail because identity checksum/date validation and normalized mobile handling are not implemented yet.

- [ ] **Step 3: Implement parser helpers**

Add helper functions for `normalize_identity_id`, `validate_identity_id`, `normalize_mobile`, and `validate_mobile` in `server/candidate_list_parser.py`. Use GB 11643 checksum weights and keep all values as strings.

- [ ] **Step 4: Wire parser validation**

Use the helpers in `build_candidates` and `validate_candidates`. Empty identity and optional mobile pass. Phone aliases mapped as permit require non-empty mobile-format permit values.

- [ ] **Step 5: Run Python tests and verify GREEN**

Run:

```bash
python3 -m unittest server/test_candidate_list_parser.py
```

Expected: all tests pass.

### Task 2: Browser Validation

**Files:**
- Modify: `server/test_ui_views.mjs`
- Modify: `outputs/web_prototype/easy_exam_automation.html`

- [ ] **Step 1: Write failing HTML tests**

Add assertions that the HTML includes browser helpers for identity checksum/date validation and mobile normalization, and that the validation block emits the requested Chinese error messages.

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```bash
node --test server/test_ui_views.mjs
```

Expected: new assertions fail because the helper names/messages are absent.

- [ ] **Step 3: Implement browser helpers**

Add `normalizeCandidateIdentityId`, `validateCandidateIdentityId`, `normalizeCandidateMobile`, and `validateCandidateMobile` near existing candidate validation helpers.

- [ ] **Step 4: Wire browser validation**

Normalize identity/mobile values when rebuilding candidates from field mappings, apply the new validation in `validateCandidatesClient`, keep import disabled while errors exist, and preserve existing duplicate/scientific-notation checks.

- [ ] **Step 5: Run UI tests and verify GREEN**

Run:

```bash
node --test server/test_ui_views.mjs
```

Expected: all UI tests pass.

### Task 3: Node Import Guard

**Files:**
- Create or modify: `server/test_candidate_import_validation.mjs`
- Modify: `server/easy_exam_server.mjs`

- [ ] **Step 1: Write failing Node tests**

Add tests for server-side import validation helpers or exported validation behavior: empty optional identity passes, invalid checksum fails, mobile with spaces/hyphens normalizes, invalid mobile fails, and permit mapped from phone alias cannot be empty.

- [ ] **Step 2: Run Node validation tests and verify RED**

Run:

```bash
node --test server/test_candidate_import_validation.mjs
```

Expected: tests fail because the Node import guard lacks the new rules or exports.

- [ ] **Step 3: Implement Node helpers**

Add matching identity/mobile normalization and validation helpers in `server/easy_exam_server.mjs`, and export them only if needed for the tests without changing runtime behavior.

- [ ] **Step 4: Wire Node import validation**

Update `validateCandidatePayload` to use the new helpers. Keep existing permit/name required checks and duplicate checks.

- [ ] **Step 5: Run Node tests and verify GREEN**

Run:

```bash
node --test server/test_candidate_import_validation.mjs
```

Expected: tests pass.

### Task 4: Full Verification and Runtime Sync

**Files:**
- Read: `WORKING_MEMORY.md`
- Run: `scripts/sync_local_runtime.mjs`

- [ ] **Step 1: Run targeted tests**

Run:

```bash
python3 -m unittest server/test_candidate_list_parser.py
node --test server/test_ui_views.mjs
node --test server/test_candidate_import_validation.mjs
```

Expected: all pass.

- [ ] **Step 2: Sync to running runtime**

Run:

```bash
/Users/chen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/sync_local_runtime.mjs
```

Expected: sync succeeds and restarts the service behind `8765`.

- [ ] **Step 3: Verify `8765` page**

Run:

```bash
curl -fsS http://127.0.0.1:8765/ | head
```

Expected: HTML is returned from the running page.
