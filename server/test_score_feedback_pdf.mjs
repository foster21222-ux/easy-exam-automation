import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { convertScoreFeedbackToPdf, resolveSofficePath } from "./score_feedback_pdf.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("converts the generated score workbook to a PDF beside it", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "score-feedback-pdf-"));
  try {
    const inputPath = path.join(tempDir, "成绩反馈单.xlsx");
    const outputPath = path.join(tempDir, "成绩反馈单.pdf");
    await copyFile(path.join(rootDir, "template", "成绩单模板.xlsx"), inputPath);

    const result = await convertScoreFeedbackToPdf({
      inputPath,
      outputPath,
      sofficePath: resolveSofficePath({ CODEX_PYTHON: process.env.CODEX_PYTHON }),
    });

    const bytes = await readFile(outputPath);
    assert.equal(result.outputPath, outputPath);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "%PDF");
    assert.ok(bytes.length > 1_000);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
