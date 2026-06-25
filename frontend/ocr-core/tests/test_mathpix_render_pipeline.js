#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { adaptMathpixToTargetMarkdown } = require("../mathpix/mathpixToTargetMarkdownAdapter");
const { normalizeMathDelimiters } = require("../normalization/mathDelimiterNormalizer");
const { validateRenderability } = require("../validation/renderValidator");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURE_DIR = path.join(ROOT, "frontend", "ocr-core", "fixtures", "pipeline");

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n").trimEnd();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function caseName(inputPath) {
  return path.basename(inputPath).replace(/\.mathpix\.input\.md$/, "");
}

function coreValidation(result) {
  return {
    ok: result.ok,
    severity: result.severity,
    errors: issueTypes(result.errors),
    warnings: issueTypes(result.warnings),
  };
}

function expectedValidation(expected) {
  return {
    ok: expected.ok,
    severity: expected.severity,
    errors: issueTypes(expected.errors || []),
    warnings: issueTypes(expected.warnings || []),
  };
}

function issueTypes(items) {
  return Array.from(new Set((items || []).map((item) => item.type))).sort();
}

function runPipeline(name, rawInput) {
  const adapter = adaptMathpixToTargetMarkdown({
    blockId: name,
    rawText: rawInput,
    source: "mathpix",
    blockType: "unknown",
  });
  const normalized = normalizeMathDelimiters({
    blockId: name,
    blockText: adapter.targetMarkdown,
    blockType: "unknown",
  });
  const validation = validateRenderability({
    blockId: name,
    markdown: normalized.normalizedText,
    blockType: "unknown",
    source: "mathpix",
  });
  return {
    adapterOutput: adapter.targetMarkdown,
    normalizedOutput: normalized.normalizedText,
    validation,
  };
}

function main() {
  const inputFiles = fs
    .readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".mathpix.input.md"))
    .sort()
    .map((name) => path.join(FIXTURE_DIR, name));

  const failures = [];
  let passed = 0;

  for (const inputPath of inputFiles) {
    const name = caseName(inputPath);
    const targetPath = path.join(FIXTURE_DIR, `${name}.target.expected.md`);
    const validationPath = path.join(FIXTURE_DIR, `${name}.validation.expected.json`);
    const rawInput = readText(inputPath);
    const expectedTarget = readText(targetPath);
    const expected = expectedValidation(readJson(validationPath));
    const result = runPipeline(name, rawInput);
    const actualTarget = result.normalizedOutput.trimEnd();
    const actualValidation = coreValidation(result.validation);

    try {
      assert.strictEqual(actualTarget, expectedTarget);
      assert.deepStrictEqual(actualValidation, expected);
      passed += 1;
    } catch {
      failures.push({
        name,
        rawInput,
        adapterOutput: result.adapterOutput,
        normalizedOutput: actualTarget,
        expectedTarget,
        actualValidation,
        expectedValidation: expected,
      });
    }
  }

  if (!failures.length) {
    console.log(`mathpix render pipeline fixtures ok: ${passed}/${inputFiles.length} passed`);
    return;
  }

  console.error(`mathpix render pipeline fixtures failed: ${failures.length}/${inputFiles.length} failed`);
  for (const failure of failures) {
    console.error(`\n[case] ${failure.name}`);
    console.error("--- raw input ---");
    console.error(failure.rawInput);
    console.error("--- adapter output ---");
    console.error(failure.adapterOutput);
    console.error("--- normalized output ---");
    console.error(failure.normalizedOutput);
    console.error("--- expected target ---");
    console.error(failure.expectedTarget);
    console.error("--- actual validation ---");
    console.error(JSON.stringify(failure.actualValidation, null, 2));
    console.error("--- expected validation ---");
    console.error(JSON.stringify(failure.expectedValidation, null, 2));
  }
  console.error(`\npassed: ${passed}/${inputFiles.length}`);
  process.exitCode = 1;
}

main();
