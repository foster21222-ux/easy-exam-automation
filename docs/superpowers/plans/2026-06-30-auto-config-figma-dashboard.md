# 自动化配置平台 Figma 优化稿 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a new Figma design file for the 易考自动化配置平台 B2 balanced operations dashboard.

**Architecture:** The deliverable is one new Figma design file with a 1440px desktop dashboard frame. The work uses Figma MCP tools to create the file, inspect available libraries, build the frame incrementally with auto-layout, and validate the result with a screenshot.

**Tech Stack:** Figma MCP `create_new_file`, `get_libraries`, `search_design_system`, `use_figma`, and `get_screenshot`.

---

## File Structure

- Create Figma file: `易考自动化配置平台优化`
- Create Figma page/frame: `B2 运营驾驶舱 / Desktop 1440`
- No repository source files are modified by this plan.
- This plan documents the Figma production steps only.

## Task 1: Create The Figma File

**Files:**
- Create: Figma design file `易考自动化配置平台优化`

- [ ] **Step 1: Resolve Figma plan**

Run the Figma `whoami` tool. If exactly one plan is available, use its `key`.

Expected: a Figma account response with at least one plan.

- [ ] **Step 2: Create the design file**

Call `create_new_file` with:

```json
{
  "planKey": "Use the exact plan key returned by Step 1",
  "fileName": "易考自动化配置平台优化",
  "editorType": "design"
}
```

Expected: response includes `file_key` and `file_url`.

## Task 2: Discover Design System Options

**Files:**
- Read: new Figma file from Task 1

- [ ] **Step 1: Check libraries**

Call `get_libraries` with the new `fileKey`.

Expected: a list of libraries added to the file and libraries available to add.

- [ ] **Step 2: Search for reusable primitives**

Call `search_design_system` for `button`, `input`, `card`, `tag`, `status`, `table`, `blue`, `gray`, `background`, and `text`.

Expected: component, variable, or style candidates if the connected Figma workspace has a useful library. If no relevant design system is available, build the review draft with local primitives and clear naming.

## Task 3: Build The Dashboard Frame

**Files:**
- Modify: new Figma file from Task 1

- [ ] **Step 1: Create foundation**

Use `use_figma` to create one page section and one 1440px desktop frame named `B2 运营驾驶舱 / Desktop 1440`.

Expected: created node IDs are returned.

- [ ] **Step 2: Build the top bar**

Use `use_figma` to add the page title, task status pill, and primary/secondary action buttons.

Expected: top bar communicates `易考考试自动配置`, current task status, and next action.

- [ ] **Step 3: Build the left workflow rail**

Use `use_figma` to add the six workflow steps:

1. 上传需求单
2. 解析与确认
3. 后台登录
4. 自动配置
5. 人工检查
6. 创建完成

Expected: current, completed, warning, and not-started statuses are visually distinguishable.

- [ ] **Step 4: Build the center work area**

Use `use_figma` to add task summary, key metrics, requirement preview, execution progress, and log summary.

Expected: an operator can identify exam name, date range, source account, final-create mode, parsed field count, course count, candidate source, and automation progress from the first viewport.

- [ ] **Step 5: Build the right support rail**

Use `use_figma` to add exception handling, recommended next action, screenshot preview, and safety note.

Expected: the right rail makes failures and final confirmation review visible without leaving the dashboard.

## Task 4: Validate The Figma Output

**Files:**
- Read: new Figma file from Task 1

- [ ] **Step 1: Capture screenshot**

Call `get_screenshot` or `await node.screenshot()` for the dashboard frame.

Expected: the screenshot is nonblank and contains the top bar, workflow rail, center work area, and support rail.

- [ ] **Step 2: Check design against spec**

Verify the frame meets these criteria:

- 1440px desktop layout.
- B2 balanced operations dashboard structure.
- Restrained internal operations console styling.
- No marketing hero layout or decorative graphics.
- No codebase implementation changes.

Expected: all criteria pass.
