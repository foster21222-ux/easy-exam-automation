# Candidate ID and Mobile Validation Design

## Goal

Add pre-import validation for candidate identity numbers and mobile numbers in the candidate list import flow. All behavior must be visible and verifiable in the running `http://127.0.0.1:8765/` page after syncing the local runtime.

## Scope

- Validate uploaded candidate rows after parsing and after every field mapping change.
- Block import while any row has validation errors.
- Keep identity number and mobile number values as strings throughout parsing, validation, preview, and import payload building.
- Keep existing required field, duplicate, scientific notation, custom field, and course-code validation behavior.

## Identity Number Rules

The identity number field is optional. Empty values pass.

When present, validation trims leading and trailing whitespace, normalizes a trailing lowercase `x` to `X`, and validates:

- exactly 18 characters
- first 17 characters are digits
- last character is a digit or `X`
- birth date in positions 7-14 is a real calendar date
- final checksum matches the GB 11643 weighting rule

Invalid rows are shown as errors before import. Error messages use these forms:

- `第 N 行身份证号格式不正确`
- `第 N 行身份证号出生日期不合法`
- `第 N 行身份证号校验码错误`

## Mobile Number Rules

The mobile field is optional unless it is also mapped as the permit field. Validation trims leading and trailing whitespace and removes spaces and hyphens inside the value.

When present, validation requires a mainland China mobile number:

- 11 digits
- starts with `1`
- second digit is `3-9`

If the permit field is mapped from `手机号` / `手机号码` / `联系电话` / related phone aliases, the same source column acts as the permit value and must be non-empty and valid as a mobile number.

Invalid rows are shown as errors before import. Error messages use these forms:

- `第 N 行手机号不能为空`
- `第 N 行手机号格式不正确`
- `第 N 行手机号必须为 11 位数字`

## Architecture

Validation lives in both the browser page and server-side import paths. The browser gives immediate feedback and controls the import button. The Python parser validates initial uploads, and the Node import handler repeats the same checks as a server-side guard before calling EasyExam tenant APIs.

The implementation keeps the existing single-page HTML pattern and mirrors small validation helpers across Python, browser JavaScript, and Node. This avoids a larger module split while keeping the behavior explicit in the existing files.

## Testing

Tests cover:

- Python parser identity checksum, birth date, optional empty identity, mobile normalization, and permit-from-mobile required behavior.
- Node import guard for invalid identity/mobile data.
- HTML/browser validation helper presence and error-message wiring.

Verification must include:

- targeted Python tests
- targeted Node tests
- local runtime sync
- `8765` page availability check
