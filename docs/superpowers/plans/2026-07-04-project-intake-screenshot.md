# Project Intake Screenshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first-stage project startup flow: upload a business requirement screenshot, OCR it into a candidate draft, let the user confirm fields, then create a project container and initial requirement record.

**Architecture:** Reuse the existing task store as the first-stage project container and store business requirement fields in `config_json` plus the requirement-center JSON version. Add focused server endpoints for screenshot preview and project creation. Keep WeChat collector backend unchanged; project detail will provide a project-context entry that pre-fills the existing group config.

**Tech Stack:** Node.js server, Python sqlite task/requirement stores, macOS Vision OCR via existing Swift helper, single-file web prototype, node/python tests.

---

### Task 1: Server project intake API

**Files:**
- Modify: `server/easy_exam_server.mjs`
- Test: `server/test_project_intake_api.mjs`

- [ ] Add helpers that run `scripts/ocr_image.swift`, parse visible OCR text into business requirement candidate fields, and build requirement-center payload fields.
- [ ] Add `POST /api/project-intake/business-screenshot?filename=...` to save the image under runtime uploads, OCR it, and return `{ uploadId, filename, imagePath, ocrText, draft }`.
- [ ] Add `POST /api/project-intake/projects` to create a task container and requirement-center initial version from the confirmed draft.
- [ ] Verify API behavior with a server unit test using injected OCR output.

### Task 2: Requirement labels and detail display

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Test: `server/test_ui_views.mjs`

- [ ] Extend requirement field labels for application, project, billing, service, venue, content, question type, and schedule fields.
- [ ] Extend requirement detail overview to show the new business requirement fields alongside existing execution fields.
- [ ] Keep default `watermark_enabled` and `copy_forbidden` hidden in change displays when they are default true.

### Task 3: Project management UI

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Test: `server/test_ui_views.mjs`

- [ ] Change "新建项目" from direct auto-config navigation to a guided inline project intake panel.
- [ ] Add screenshot upload, status feedback, OCR raw text preview, editable confirmation fields, and a "创建项目并生成初始需求单" button.
- [ ] After creation, navigate to the created project detail page.

### Task 4: Project detail WeChat entry

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Test: `server/test_ui_views.mjs`

- [ ] Show initial requirement summary and linked requirement button in project detail.
- [ ] Add a project-context "配置微信群" entry that pre-fills group project/customer/request id into the existing WeChat collector config.
- [ ] Add a placeholder sibling entry "在运控建立批次（后续接入）" with disabled state.

### Task 5: Verification

**Commands:**
- `/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_project_intake_api.mjs server/test_requirement_request_api.mjs server/test_ui_views.mjs`
- `python3 -m unittest server/test_requirement_request_db.py server/test_task_state_db.py -v`

- [ ] Fix any failing tests caused by this change.
- [ ] Report exactly what passed and what could not be verified.
