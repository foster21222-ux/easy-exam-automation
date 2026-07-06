# WeChat Collector Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure WeChat collection jobs run one group at a time with visible queue status, and prevent search-page false positives from being treated as opened group chats.

**Architecture:** Keep the existing CLI collector and launchd model. Add a small in-process FIFO queue to the WeChat collector API for page-triggered runs, keep the existing script lock for cross-process protection, and harden the OCR title check so a WeChat search page fails fast before requirement parsing.

**Tech Stack:** Node.js HTTP handler, macOS WeChat OCR scripts, existing Node test runner.

---

### Task 1: Red tests

**Files:**
- Modify: `server/test_wechat_collector_api.mjs`
- Modify: `server/test_wechat_visible_collect_cli.mjs`

- [ ] Add an API test proving two simultaneous `run-once` requests start serially, not concurrently.
- [ ] Add a script test proving OCR text from WeChat search/Sou-sou pages is rejected even when it contains the target group name.
- [ ] Run both tests and verify they fail for the expected reasons.

### Task 2: Minimal implementation

**Files:**
- Modify: `server/wechat_collector_api.mjs`
- Modify: `scripts/wechat_visible_collect.mjs`
- Modify: `scripts/wechat_window.swift`

- [ ] Add a per-handler FIFO queue around real collection and preflight collection requests.
- [ ] Include queue state in `/api/wechat-collector/status`.
- [ ] Reject OCR title checks when the full-window OCR text shows WeChat search-page markers.
- [ ] Before opening a group, send Escape and re-click/clear the search box to reduce state carryover.

### Task 3: UI and verification

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Modify: `docs/wechat-requirement-collector.md`

- [ ] Render current queue state in the WeChat collector running status area.
- [ ] Document that page-triggered collection is queued, while direct CLI/launchd still relies on the process lock and sequential group handling.
- [ ] Run the targeted WeChat collector tests.
- [ ] Run the full server test suite used for this project.
