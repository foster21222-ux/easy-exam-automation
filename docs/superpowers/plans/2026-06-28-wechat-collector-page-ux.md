# WeChat Collector Page UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the WeChat group collection page so operators can follow configuration, validation, and automation steps without changing backend behavior.

**Architecture:** Keep the existing single HTML prototype and JavaScript event handlers. Change static layout, labels, and helper text only; preserve DOM IDs so current handlers keep working.

**Tech Stack:** Static HTML, inline JavaScript, Node.js `node:test`.

---

## File Structure

- Modify `server/test_ui_views.mjs`: add assertions for the new workflow labels and operator-facing explanations.
- Modify `outputs/web_prototype/easy_exam_automation.html`: reorder existing panels and buttons, rename ambiguous headings, and add short explanatory copy.

### Task 1: Add UI Expectations

**Files:**
- Modify: `server/test_ui_views.mjs`

- [ ] **Step 1: Add failing assertions for the WeChat collector workflow**

Add assertions in `test("WeChat collector page renders config and scheduler status surfaces", ...)` for:

```js
  assert.ok(html.includes("1. 配置微信群"));
  assert.ok(html.includes("保存群名、项目、客户、需求编号、启用状态和采集间隔"));
  assert.ok(html.includes("2. 验证采集"));
  assert.ok(html.includes("环境预检"));
  assert.ok(html.includes("微信群试跑"));
  assert.ok(html.includes("每个启用群上线前都需要试跑本群"));
  assert.ok(html.includes("3. 上线自动采集"));
  assert.ok(html.includes("上线前必须完成"));
  assert.ok(html.includes("高级维护"));
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_ui_views.mjs
```

Expected: FAIL because the new labels and helper text are not in the HTML yet.

### Task 2: Reorganize the WeChat Collector Page

**Files:**
- Modify: `outputs/web_prototype/easy_exam_automation.html`

- [ ] **Step 1: Move top-level actions into workflow panels**

Change the WeChat collector section so:

- Top heading keeps only `refreshWechatCollectorBtn`.
- `addWechatGroupBtn` and `saveWechatCollectorConfigBtn` move to the "1. 配置微信群" panel.
- `dryRunWechatCollectorBtn` and `runWechatPipelineSmokeBtn` move to the "环境预检" panel under "2. 验证采集".
- `runWechatCollectorOnceBtn` moves to a lower-priority "批量试跑" area.
- `installWechatCollectorAutomationBtn` and `uninstallWechatCollectorAutomationBtn` move under "3. 上线自动采集".
- service and scheduler install/uninstall controls remain available under "高级维护".

- [ ] **Step 2: Rename status headings and add helper text**

Use:

- "当前运行状态" instead of "就绪检查".
- "上线前必须完成" instead of page-level "上线门槛".
- Helper text that says environment checks are deployment/risk checks, while row-level trial run validates a specific group.

- [ ] **Step 3: Run test to verify it passes**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_ui_views.mjs
```

Expected: PASS.

### Task 3: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Inspect diff**

Run:

```bash
git diff -- outputs/web_prototype/easy_exam_automation.html server/test_ui_views.mjs docs/superpowers/specs/2026-06-28-wechat-collector-page-ux-design.md docs/superpowers/plans/2026-06-28-wechat-collector-page-ux.md
```

Expected: Diff only contains page display/test/spec/plan changes.

- [ ] **Step 2: Report verification**

Report the changed files and exact test command output.
