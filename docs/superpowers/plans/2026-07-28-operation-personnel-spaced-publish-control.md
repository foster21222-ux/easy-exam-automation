# Spaced Publish Control Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the personnel-task workflow to uniquely identify the operation-console publish button whose accessible name is `发 布`, without broadening the match to non-button or unrelated controls.

**Architecture:** Keep the existing visible Playwright adapter and exact batch-location recovery unchanged. Replace only the publish button name matcher with an anchored whitespace-tolerant regular expression while retaining the `button` role and the existing unique-control guard.

**Tech Stack:** Node.js, Playwright locators, `node:test`.

## Global Constraints

- Match only a visible `button` role whose complete accessible name is `发`, optional whitespace, then `布`.
- Continue requiring exactly one match; zero or multiple matches must block before any click.
- Do not use CSS class selectors, contains-text matching, hidden APIs, or automatic real-console publication during verification.
- Do not modify schedule, personnel, recipient, send-confirmation, or send-record behavior.

---

### Task 1: Match the real spaced publish button

**Files:**
- Modify: `server/test_operation_personnel_task_runner.mjs`
- Modify: `server/operation_personnel_task_runner.mjs:2163-2170`

**Interfaces:**
- Consumes: `page.getByRole("button", { name })` and the existing `clickUniqueVisible(locator, label)` uniqueness guard.
- Produces: `VISIBLE_OPERATION_PERSONNEL_ADAPTER.publishBatch(page, instruction, options)` that accepts accessible names `发布` and `发 布` but no additional text.

- [x] **Step 1: Write the failing regression test**

Update `simulatedVisibleOperationPage` so its publish control has a configurable accessible name and applies string or regular-expression matching like Playwright:

```js
const publishAccessibleName = overrides.publishAccessibleName ?? "发布";
const nameMatches = (expected, actual) => (
  expected instanceof RegExp ? expected.test(actual) : expected === actual
);

if (role === "button" && nameMatches(options.name, publishAccessibleName)) {
  // Return the existing simulated publish locator.
}
```

Add this regression test:

```js
test("default visible adapter uniquely matches the real spaced publish button name", async () => {
  const page = simulatedVisibleOperationPage({
    publishAccessibleName: "发 布",
    publishOnlyOnBatchDetail: true,
  });

  const result = await operationPersonnelRunner.runOperationPersonnelAttempt(
    validInstruction(),
    attemptOptions(page, {
      openBatchRow: async () => {
        page.events.push("batch:open");
        page.currentLocation = "batch-detail";
      },
      openEztestSchedulePage: async () => {
        page.events.push("exam-schedule:open");
        page.currentLocation = "exam-schedule";
      },
      publishBatch: undefined,
      confirmSend: undefined,
    }),
  );

  assert.equal(result.status, "sent");
  assert.equal(page.events.filter((item) => item === "publish:click:visible").length, 1);
});
```

- [x] **Step 2: Run the regression test and verify RED**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --test-name-pattern="real spaced publish button name" \
  server/test_operation_personnel_task_runner.mjs
```

Expected: FAIL with `PERSONNEL_OPERATION_CONTROL_AMBIGUOUS` and a publish-button count of `0`, proving the production selector still rejects `发 布`.

- [x] **Step 3: Implement the minimal production change**

Change only the accessible-name matcher:

```js
page.getByRole("button", { name: /^发\s*布$/ }),
```

Keep `clickUniqueVisible(..., "发布按钮")` and the confirmation flow unchanged.

- [x] **Step 4: Run focused verification and verify GREEN**

Run:

```bash
/Users/ata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test server/test_operation_personnel_task_runner.mjs
```

Expected: all personnel runner tests PASS, including the new spaced-name regression and existing zero/multiple control blocking tests.

- [x] **Step 5: Run project verification**

Run the repository's complete Node test suite and Python test suite using the same commands recorded for this branch, then run `git diff --check`.

Expected: all tests PASS and `git diff --check` returns no output.

- [x] **Step 6: Commit the source fix**

```bash
git add server/test_operation_personnel_task_runner.mjs \
  server/operation_personnel_task_runner.mjs
git commit -m "fix: match spaced operation publish button"
```

- [x] **Step 7: Deploy and verify the local test runtime**

Synchronize the committed source state to `/Users/ata/Library/Application Support/easy-exam-automation/app`, restart the local service on port `8765`, and run the runtime test suites plus the HTTP health check.

Expected: runtime tests PASS and `http://127.0.0.1:8765/api/health` reports a healthy service. Do not trigger a real publish or personnel-task send.
