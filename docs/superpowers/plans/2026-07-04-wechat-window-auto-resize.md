# WeChat Window Auto Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before OCR collection, keep the WeChat chat area large enough for stable scroll stitching by auto-enlarging only undersized windows and scaling scroll bursts from the current chat capture height.

**Architecture:** The visible collector already reads the WeChat window before screenshots. Add one small planning layer that derives chat capture height, resize necessity, and scroll burst count from the current window. Extend the Swift helper with a focused `resize-window` command used only when the chat area is too small.

**Tech Stack:** Node.js collector scripts, Swift macOS CGWindow/Accessibility helper, Node test runner.

---

### Task 1: Failing behavior tests

**Files:**
- Modify: `server/test_wechat_visible_collect_cli.mjs`

- [ ] Add tests for:
  - default scroll plan keeps `scrollBursts: 4` at baseline chat height `624`;
  - smaller chat height reduces bursts proportionally;
  - larger chat height increases bursts proportionally without shrinking the window;
  - undersized chat height produces a resize plan.

Run: `/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_wechat_visible_collect_cli.mjs`

Expected before implementation: FAIL because the new planning helpers are missing.

### Task 2: Collector planning implementation

**Files:**
- Modify: `scripts/wechat_visible_collect.mjs`

- [ ] Add exported helpers:
  - `resolveWechatWindowAdjustmentPlan(windowInfo, captureInsets, options)`
  - `resolveScrollCapturePlan(..., { captureHeight })`
- [ ] In OCR capture, read window info, resize only when the computed chat capture height is below `480`, then re-read window info.
- [ ] Return runtime summary fields: `wechatWindow`, `chatCaptureSize`, `windowAdjustment`, `scrollBaseHeight`.

Run: targeted Node tests from Task 1.

Expected after implementation: PASS.

### Task 3: Swift helper resize command

**Files:**
- Modify: `scripts/wechat_window.swift`

- [ ] Add `resize-window <width> <height>` command.
- [ ] Use Accessibility APIs to set main WeChat window size and position only when invoked.
- [ ] Keep existing `info`, `open-group`, and `scroll-chat` behavior unchanged.

Run: `swiftc -typecheck scripts/wechat_window.swift`

Expected: exit code 0.

### Task 4: UI/API status exposure

**Files:**
- Modify: `server/wechat_collector_api.mjs`
- Modify: `outputs/web_prototype/easy_exam_automation.html`
- Modify: `docs/wechat-requirement-collector.md`
- Modify tests as needed.

- [ ] Include window and chat capture dimensions in group status.
- [ ] Show whether the window was auto-resized or already OK.
- [ ] Document the baseline and failure behavior.

Run: `/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_wechat_visible_collect_cli.mjs server/test_wechat_collector_api.mjs server/test_ui_views.mjs`

Expected: all selected tests pass.

### Task 5: Runtime verification

**Files:**
- Modify runtime copy via deploy script only.

- [ ] Run `git diff --check`.
- [ ] Deploy using `scripts/deploy_launchd_runtime.mjs`.
- [ ] Restart local service.
- [ ] Run one real OCR collection against `AI赋能运营自动化小组`.
- [ ] Verify result reports `scrollBursts`, `wechatWindow`, `chatCaptureSize`, and `windowAdjustment`.
