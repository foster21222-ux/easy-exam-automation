# Hide Candidate Validation Error Count Log

## Goal

Do not add the summary log entry `[名单校验] 存在 N 个错误` after a candidate file is parsed.

## Scope

- Keep the `[名单校验] 共识别 N 名考生` log entry.
- Keep the candidate page's top-level error state.
- Keep all field-level and row-level validation messages.
- Keep validation behavior and import blocking unchanged.
- Keep the successful `[名单校验] 校验通过` log entry unchanged.

## Implementation

Only call `candidateLog("[名单校验] 校验通过", "success")` when the parsed candidate list has no validation errors. When errors exist, do not append a validation summary log entry.

## Verification

Add a focused UI source test proving that the success log remains and the error-count log is absent. Run the candidate UI test suite, then sync the validated HTML to the local 8765 runtime and verify the deployed file.
