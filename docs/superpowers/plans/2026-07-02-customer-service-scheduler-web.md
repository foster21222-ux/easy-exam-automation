# Customer Service Scheduler Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a website-managed online customer service scheduler that every login user can use, while preserving previously saved API keys as enabled scheduled profiles.

**Architecture:** User settings store API Key profiles per console user. The hourly scheduler gathers all enabled profiles and runs the existing EasyExam customer-service toggle logic independently for each profile. The auto-config page exposes profile state and actions without returning full API keys.

**Tech Stack:** Node.js ESM, `node:test`, static HTML/JS frontend, EasyExam tenant REST API.

---

### Task 1: API Key Profile Model

**Files:**
- Modify: `server/user_settings.mjs`
- Test: `server/test_user_settings.mjs`

- [ ] **Step 1: Write failing tests** for saving a second API Key, re-saving an existing API Key, public redaction, and enabled scheduler targets.
- [ ] **Step 2: Run `node --test server/test_user_settings.mjs`** and verify missing exports fail.
- [ ] **Step 3: Implement profile helpers**: deterministic profile ids, default enabled scheduler settings, public profile redaction, profile upsert/update/delete, and target collection.
- [ ] **Step 4: Re-run `node --test server/test_user_settings.mjs`** and verify pass.

### Task 2: Multi-Profile Scheduler Runner

**Files:**
- Modify: `server/customer_service_scheduler.mjs`
- Test: `server/test_customer_service_scheduler.mjs`

- [ ] **Step 1: Write failing tests** proving enabled profiles all run and one failed profile does not stop another.
- [ ] **Step 2: Run `node --test server/test_customer_service_scheduler.mjs`** and verify missing export fails.
- [ ] **Step 3: Implement `runCustomerServiceSchedulerForTargets`** around the existing single-key scheduler.
- [ ] **Step 4: Re-run scheduler tests** and verify pass.

### Task 3: Website API

**Files:**
- Modify: `server/easy_exam_server.mjs`
- Test: existing focused tests plus manual endpoint smoke through local server if needed.

- [ ] **Step 1: Add scheduler profile route handlers** for GET, PATCH, DELETE, and dry-run POST.
- [ ] **Step 2: Ensure `/api/settings` save also upserts the current API Key profile** through `saveUserLogin`.
- [ ] **Step 3: Persist authenticated profiles in `user_settings.json` and auth-disabled profiles in `settings.json`.
- [ ] **Step 4: Return only public profile fields to the browser.**

### Task 4: Frontend Controls

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Test: `server/test_ui_views.mjs`

- [ ] **Step 1: Write failing UI fixture assertions** for scheduler controls and API endpoints.
- [ ] **Step 2: Add the "在线客服定时" section** under backend connection.
- [ ] **Step 3: Add JS load/render/action functions** for profile list, enable/pause, set current, delete, and dry-run.
- [ ] **Step 4: Re-run `node --test server/test_ui_views.mjs`** and verify pass.

### Task 5: Hourly CLI Integration

**Files:**
- Modify: `scripts/customer_service_scheduler.mjs`
- Test: `server/test_customer_service_scheduler_cli.mjs`

- [ ] **Step 1: Write failing CLI tests** for multi-profile target loading.
- [ ] **Step 2: Implement target loading from `user_settings.json` and `settings.json`** with env/single-key fallback.
- [ ] **Step 3: Run all customer-service focused tests** and verify pass.

### Task 6: Verification

**Commands:**
- `node --test server/test_user_settings.mjs server/test_customer_service_scheduler.mjs server/test_customer_service_scheduler_cli.mjs server/test_ui_views.mjs`
- `node scripts/customer_service_scheduler.mjs --dry-run`

**Expected:** Focused tests pass; dry-run prints a JSON summary and does not write EasyExam sessions.
