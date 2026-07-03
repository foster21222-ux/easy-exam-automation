# WeChat Collector Page UX Design

## Goal

Make the WeChat group collection page match the operator's normal workflow without changing backend behavior, API contracts, scheduler logic, or go-live checks.

## Scope

- Reorganize existing page controls into user-facing workflow sections.
- Clarify which actions are normal configuration, which are environment validation, which are per-group real trial runs, and which are automation/maintenance actions.
- Rename ambiguous status panels so operators can understand the next action.
- Keep all existing DOM IDs and event handlers needed by the current JavaScript.

## Confirmed Decisions

- Move "新增群" and "保存微信群配置" into the WeChat group configuration module.
- Keep the top heading action area minimal; only "刷新" remains there.
- Treat "预检脚本" and "链路自检" as environment/deployment validation actions, not per-group requirements.
- Treat row-level "试跑本群" as the primary path for validating each newly enabled WeChat group.
- Keep the global "立即试跑" action, but place it under a lower-priority batch/advanced operation area.
- Move service/scheduler install and uninstall controls into an automation/advanced maintenance area.

## Proposed Page Flow

1. "1. 配置微信群"
   - Shows group mapping rows.
   - Includes "新增群" and "保存微信群配置".
   - Explains that saving persists group name, project, customer, requirement ID, enabled state, and interval.

2. "2. 验证采集"
   - Shows environment validation actions: "预检脚本" and "运行链路自检".
   - Explains that these validate the local Mac and requirement pipeline, not each group.
   - Shows "最近一次预检", "最近一次运行", and "运行历史".

3. "3. 上线自动采集"
   - Shows "上线前必须完成" status.
   - Shows install/uninstall automation controls.
   - Keeps service and scheduler controls as advanced maintenance.

4. "运行与排障"
   - Shows current runtime status, requirement center/service/scheduler details, attachment scan, backups, and logs.

## Verification

- Add UI tests that assert the new workflow labels and explanatory text exist.
- Run the relevant Node UI test file.
