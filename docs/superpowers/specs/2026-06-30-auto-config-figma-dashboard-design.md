# 自动化配置平台 Figma 优化稿设计

## Goal

Create a new Figma design file for the 易考自动化配置平台 page, optimized as a balanced operations dashboard.

The design is for review first. It does not change the current web implementation.

## Selected Direction

Use the B2 balanced operations dashboard direction:

- Left workflow rail for the main configuration steps.
- Center work area for task summary, key status metrics, parsed requirement preview, progress, and log summary.
- Right support rail for exceptions, recommended handling actions, and screenshots.

This direction keeps the page efficient for daily operators while still being understandable for teammates who use it less often.

## Target Figma Deliverable

Create a new Figma file named:

```text
易考自动化配置平台优化
```

The file should contain one desktop frame for the main optimized dashboard. A 1440px-wide desktop canvas is sufficient for this first review version.

## Page Structure

### Top Bar

The top bar identifies the page and exposes primary actions.

Content:

- Page title: `易考考试自动配置`
- Current task status, such as `待上传`, `解析完成`, `执行中`, `需人工处理`, or `已完成`
- Primary action button: upload or start configuration depending on state
- Secondary action buttons for retry, stop, or view history when relevant

### Left Workflow Rail

The left rail shows where the task is in the automation flow.

Steps:

1. 上传需求单
2. 解析与确认
3. 后台登录
4. 自动配置
5. 人工检查
6. 创建完成

Each step should support status expression: not started, current, completed, warning, or failed.

### Center Work Area

The center area is the operator's primary workspace.

Sections:

- Task summary: exam name, date range, source account, and final-create mode.
- Key metrics: parsed fields, course count, candidate source, automation progress.
- Requirement preview: grouped fields from the uploaded requirement sheet.
- Execution progress: current step, percent, and concise status text.
- Log summary: latest important logs, not a full terminal dump.

### Right Support Rail

The right rail makes exceptions and review artifacts visible without pushing the operator away from the main flow.

Sections:

- Exception panel: current blocker, severity, and recommended next action.
- Screenshot panel: latest or final screenshot from the automation run.
- Safety note: make clear when the script is stopped at the confirmation page instead of creating the exam directly.

## Visual Style

The design should feel like a restrained internal operations console:

- Light gray app background.
- White functional panels.
- Border radius no larger than 8px.
- Blue as the main action and current-step color.
- Red and orange only for errors and warnings.
- Dense but readable spacing; avoid marketing-style hero composition.
- No decorative gradient blobs, oversized cards, or purely ornamental graphics.

## Interaction States To Represent

The first Figma version should include enough state hints to explain behavior:

- Empty or待上传 state for the upload area.
- Parsed and ready-to-start state for task summary.
- Running state for progress.
- Warning or failed state in the right support rail.
- Final confirmation screenshot state.

These can be represented in one composed dashboard frame rather than separate screens.

## Out Of Scope

- No implementation in the web codebase.
- No changes to backend automation logic.
- No new reusable design system library.
- No mobile layout in the first Figma version.
- No production handoff annotations beyond clear labels and visual hierarchy.

## Success Criteria

- A new Figma file exists with a desktop dashboard frame.
- The frame clearly communicates the B2 balanced operations dashboard direction.
- Operators can identify task status, next action, current step, key parsed data, and exceptions from the first viewport.
- The design stays consistent with an internal SaaS operations tool rather than a landing page.
