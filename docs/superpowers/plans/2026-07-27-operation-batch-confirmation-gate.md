# Operation Batch Confirmation Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a batch attempt from being classified as submitted until the operation console's final confirmation dialog is provably visible, then finish the already-created `EZT260006` batch without creating it again.

**Architecture:** Add one focused confirmation-page helper to the existing Playwright runner. The helper verifies one visible Ant modal containing the exact operation serial, exact batch name, and one visible `完成` button; only after that proof may the runner enter the uncertain-submit state. Keep the independently proven post-submit list retry, deploy both protections, and use the existing update preview/start/readback APIs to append the desired schedule to `EZT260006`.

**Tech Stack:** Node.js ESM, Playwright locators, `node:test`, existing operation-batch HTTP APIs, macOS LaunchAgent runtime.

## Global Constraints

- Do not click `创建批次` again for task `b8e1af6b-7f2f-4490-926e-c2dda94f1461`.
- Treat only exact serial `R0031682`, exact batch name `湖北邮政_2026年8月`, and exact code `EZT260006` as valid identities.
- A failure before the final confirmation dialog is verified is retryable and must not become `reconciliation_required`.
- External schedule writes require a successful read-only preview and exact post-write readback.
- Preserve the unrelated untracked file `docs/operation-personnel-task-test-evidence.md`.

---

### Task 1: Final confirmation page gate

**Files:**
- Modify: `server/operation_batch_runner.mjs`
- Test: `server/test_operation_batch_runner_safety.mjs`

**Interfaces:**
- Consumes: existing operation-batch draft fields and Playwright `page`.
- Produces: `waitForOperationBatchConfirmation(page, draft, options) -> Locator`.

- [ ] **Step 1: Write the failing test**

Add tests proving the helper waits for the exact serial and batch name inside one visible modal, returns the unique `完成` button, and rejects a non-unique final modal.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test server/test_operation_batch_runner_safety.mjs
```

Expected: FAIL because `waitForOperationBatchConfirmation` is not exported.

- [ ] **Step 3: Write minimal implementation**

Implement the helper with existing `.ant-modal:visible` and Playwright role/text locators. Call it after the second `下一步`; set `submissionStarted = true` only after the helper succeeds and immediately before clicking the returned button.

- [ ] **Step 4: Run targeted and full verification**

Run the targeted test, then all Node and Python tests. Expected: zero failures.

### Task 2: Deploy and complete the existing batch

**Files:**
- Deploy source through: `scripts/deploy_launchd_runtime.mjs`
- Persisted runtime state only: `~/Library/Application Support/easy-exam-automation/runtime`

**Interfaces:**
- Consumes: `GET update-state`, `POST update-preview`, `POST update`, and `GET update-attempts/:attemptId`.
- Produces: exact verified managed snapshot for existing batch `EZT260006`.

- [ ] **Step 1: Deploy and restart**

Atomically deploy to Application Support, restart `com.ata.easy-exam-service`, verify `/api/health`, and verify the deployed runner checksum matches the worktree.

- [ ] **Step 2: Read-only update preview**

Request `POST /api/tasks/b8e1af6b-7f2f-4490-926e-c2dda94f1461/operation-batch/update-preview`. Require code `EZT260006`, no conflict, and a server-issued preview token.

- [ ] **Step 3: Apply only the previewed schedule changes**

Start the update using only the server-issued token. Do not send client-authored changes.

- [ ] **Step 4: Verify terminal readback**

Poll the returned attempt until terminal. Require `succeeded`, `checkpoint=completed`, task batch status `success`, and exact batch/schedule readback. Recheck the project workflow and health endpoint.
