# PR #5 Selective Integration Design

## Context

GitHub `main` at commit `e3250c0` is byte-for-byte aligned with the managed application files currently running on port 8765. PR #5 (`3a7c544`) is based on an older `main`, is currently marked `mergeable=false / dirty`, and mixes desired project-management features with changes to shared server, UI, WeChat, OCR, and requirement-center code.

The integration must preserve the current production behavior while selectively bringing the approved PR features into an isolated branch. No integration commit is allowed to update GitHub `main` or the live 8765 runtime until the complete verification gate passes and the user explicitly approves deployment.

## Goals

1. Integrate the project-management features from PR #5:
   - operation-console batch creation and manual batch-code recording;
   - content requirement email generation and sending;
   - project-scoped WeChat collection configuration and global collector monitoring;
   - requirement database incremental merge, manual edit, and customer-change review;
   - screenshot-based project intake contained within project management.
2. Preserve the existing Fanwei requirement reader and generated auto-configuration workflow without behavioral changes.
3. Preserve automatic configuration, exam list/detail, and candidate import without behavioral or visual changes.
4. Keep the PR synchronization and subsequent debugging as separate commits so the imported surface is auditable.
5. Preserve the monitoring/personnel-task placeholder during PR synchronization, then treat the real workflow as the next independently specified sub-project. PR #5 contains no implementation to extract.

## Protected Behavior

The following behavior is frozen throughout the integration:

- automatic configuration routes, API jobs, progress flow, components, and generated configuration payloads;
- exam list and exam detail routes, aggregation, cards, progress state, and actions;
- candidate parsing, mapping, validation, import, room assignment, and monitor-account export;
- Fanwei local-helper installation, Chrome reading, bridge tokens, preview, workbook generation, import, and task creation.

Shared files may receive narrowly scoped imports, route registrations, and project/system configuration UI sections, but existing protected functions and UI blocks must not be replaced or rewritten.

## Approaches Considered

### 1. Selective transplant into current main (selected)

Copy standalone PR modules and transplant only the required hunks into the current shared files. This has the lowest risk of regressing the protected workflows and keeps the existing 8765 code as the source of truth.

### 2. Merge PR and restore protected files

Rejected because the shared HTML and server files contain both desired and protected behavior. Restoring whole files would discard desired wiring, while resolving conflicts manually after a full merge makes accidental regression difficult to detect.

### 3. Separate service for all new features

Rejected for this phase because it would require new authentication, deployment, state synchronization, and process supervision. The isolation benefit does not justify the operational complexity for the current local application.

## Integration Architecture

### Standalone modules

The following PR modules can be imported as bounded units after review:

- `server/operation_batch.mjs`
- `server/operation_batch_runner.mjs`
- `server/operation_console_env.mjs`
- `server/content_requirement_email.mjs`
- `server/smtp_mailer.mjs`
- `server/project_intake.mjs`
- `server/wechat_project_cleanup.mjs`

The PR versions of the following existing modules require semantic reconciliation against current `main`, not file replacement:

- `server/requirement_request_db.py`
- `server/requirement_request_api.mjs`
- `server/wechat_collector_api.mjs`
- `server/wechat_attachment_scanner.mjs`
- `server/wechat_requirement_collector.mjs`
- `scripts/wechat_visible_collect.mjs`
- `scripts/wechat_window.swift`
- `scripts/ocr_image.swift`

### Shared server wiring

`server/easy_exam_server.mjs` remains the current-main file. Integration is limited to:

- importing the approved new modules;
- registering project-intake, operation-batch, content-email, and required WeChat routes;
- adding runtime paths for requirement, email, WeChat, and operation state;
- adding admin authorization for global SMTP and operation-environment mutations;
- adding an atomic per-task guard for operation-batch creation;
- preserving every existing Fanwei, auto-config, exam, and candidate handler.

### Shared UI wiring

`outputs/web_prototype/easy_exam_automation.html` remains the current-main file. New UI is added only to:

- project creation and project configuration;
- project-scoped WeChat configuration;
- operation collaboration inside project detail;
- system configuration for global WeChat, SMTP, and operation environment status.

Existing auto-configuration, exam, candidate-import, and Fanwei views are not replaced, reordered, or restyled.

## Data Flow

### Project intake

1. An authenticated user uploads a business-requirement screenshot from project management.
2. OCR produces an editable project draft.
3. User confirmation creates the requirement record and project task.
4. No Fanwei parser or Fanwei workbook path is invoked or modified.

### WeChat collection and requirement center

1. A project stores its WeChat group binding with task ID and requirement request ID.
2. The collector serializes group work through one queue, reads only the visible conversation, associates matching local attachments, and maintains checkpoints.
3. New requirements are incrementally merged; customer changes remain pending until staff acceptance.
4. Manual edits create audited versions, and true same-field conflicts require explicit override.
5. Deleting a project disables only groups bound to that task or requirement.

### Operation batch

1. Project data generates a reviewed operation-batch draft.
2. The server acquires a per-task creation guard before opening browser automation.
3. Browser automation creates one unpublished batch and verifies the selected operation task belongs to the current project.
4. Batch code, detail URL, status, and event history are written back to the project.
5. Manual batch-code recording remains available as an explicit fallback.

### Content requirement email

1. An administrator configures global SMTP credentials; the password is stored with owner-only permissions.
2. A project owner supplies recipients for the current send only.
3. The message is rendered from the current project, operation batch, and latest requirement version.
4. The send result is appended to project history without persisting default recipients.

### Monitoring/personnel task boundary

PR #5 contains no implementation. This integration preserves the disabled placeholder but does not present it as a completed feature. After synchronization, the manual operation-console workflow must be observed and documented in a separate design before code is written. The expected direction for that later sub-project is:

1. create the monitoring/personnel task for the current project and operation batch;
2. verify the selected project and batch before submission;
3. persist the external task identifier and status in the project;
4. determine from the verified manual workflow whether a personnel-task email is required.

The later sub-project will have its own design, implementation plan, tests, and deployment approval.

## Error Handling and Security

- Global SMTP configuration and operation-environment install/enable endpoints require the administrator role.
- SMTP credentials are never returned by APIs and the runtime settings file is written with mode `0600`.
- Operation-batch creation uses a per-task idempotency guard; concurrent requests return a conflict or the existing result.
- Browser automation failures persist a retryable failed state without fabricating an external identifier.
- Requirement manual edits distinguish unchanged values, explicit clears, and replacements.
- WeChat queue failures preserve checkpoints and pending confirmations so a retry cannot silently skip messages.
- The integration does not install dependencies, restart services, send email, activate WeChat, or create external operation tasks during unit tests.

## Commit Sequence

1. `docs: define selective PR 5 integration` - this design only.
2. `test: protect existing production workflows` - regression tests for all frozen behavior.
3. `feat: selectively integrate PR 5 project workflows` - PR feature synchronization without deployment.
4. `fix: harden integrated project workflows` - authorization, idempotency, requirement-edit correctness, portable tests, and credential permissions.

The separation satisfies the requested sequence of synchronizing the PR first and debugging afterward while ensuring unverified code never reaches `main` or 8765.

## Verification Gates

### Protected regression gate

- Existing Fanwei preview/import/helper tests pass unchanged.
- Existing automatic-configuration route, component, UI, and payload tests pass unchanged.
- Existing exam list/detail aggregation and UI tests pass unchanged.
- Existing candidate parsing, mapping, validation, room, and import tests pass unchanged.
- Browser smoke checks confirm the four protected views retain their current controls and navigation.

### Integrated feature gate

- Operation-batch draft, project validation, idempotency, failure, result, and manual fallback tests pass.
- Content-email rendering, authorization, settings redaction, credential permissions, SMTP failure, and send-history tests pass.
- WeChat project binding, queue, checkpoints, attachment matching, pending confirmation, backup/restore, and deletion cleanup tests pass.
- Requirement partial merge, explicit clear, real dirty-field tracking, change acceptance, and conflict override tests pass.
- Project screenshot intake tests pass without invoking the Fanwei workflow.

Monitoring-task tests are intentionally outside this integration gate and will be defined in the follow-up monitoring-task design.

### Deployment gate

Before updating `main` or 8765:

1. the isolated branch must be clean and all required tests must pass;
2. the integrated page must be visually checked at desktop and mobile sizes;
3. the live runtime database and configuration files must be backed up;
4. the user must explicitly approve merge and deployment;
5. after deployment, GitHub `main`, source, and managed runtime files must again compare with zero mismatches.

## Rollback

The current `main` commit `e3250c0` remains the rollback point until deployment is approved. The live runtime is not modified during integration. If post-deployment verification fails, restore the backed-up runtime state and redeploy `e3250c0` through the repository sync script.
