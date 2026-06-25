#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { normalizeMathDelimiters } = require("../frontend/ocr-core/normalization/mathDelimiterNormalizer");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE_DIR = path.join(ROOT, "frontend", "ocr-core", "fixtures", "math-delimiter");

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n").trimEnd();
}

function fixtureName(inputPath) {
  return path.basename(inputPath).replace(/\.input\.md$/, "");
}

function main() {
  const inputFiles = fs
    .readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".input.md"))
    .sort()
    .map((name) => path.join(FIXTURE_DIR, name));

  const failures = [];
  let passed = 0;

  for (const inputPath of inputFiles) {
    const expectedPath = inputPath.replace(/\.input\.md$/, ".expected.md");
    const name = fixtureName(inputPath);
    const input = readText(inputPath);
    const expected = readText(expectedPath);
    const normalized = normalizeMathDelimiters({
      blockId: name,
      blockText: input,
      blockType: inferBlockType(input),
    });
    const actual = normalized.normalizedText.trimEnd();

    try {
      assert.strictEqual(actual, expected);
      passed += 1;
    } catch {
      failures.push({ name, inputPath, expectedPath, actual, expected });
    }
  }

  if (!failures.length) {
    console.log(`ocr-core math-delimiter fixtures ok: ${passed}/${inputFiles.length} passed`);
    return;
  }

  console.error(`ocr-core math-delimiter fixtures failed: ${failures.length}/${inputFiles.length} failed`);
  for (const failure of failures) {
    console.error(`\n[fixture] ${failure.name}`);
    console.error(`input: ${path.relative(ROOT, failure.inputPath)}`);
    console.error(`expected: ${path.relative(ROOT, failure.expectedPath)}`);
    console.error("--- actual ---");
    console.error(failure.actual);
    console.error("--- expected ---");
    console.error(failure.expected);
  }
  console.error(`\npassed: ${passed}/${inputFiles.length}`);
  process.exitCode = 1;
}

function inferBlockType(markdown) {
  const text = String(markdown || "");
  if (/^\s*```/.test(text)) {
    return "code";
  }
  if (text.split("\n").some((line) => line.trim().startsWith("|") && line.trim().includes("|", 1))) {
    return "table";
  }
  return "unknown";
}

main();
