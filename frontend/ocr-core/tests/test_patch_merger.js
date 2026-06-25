#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { detectPatchConflicts } = require("../patch/conflictDetector");
const { mergeAcceptedPatches } = require("../patch/patchMerger");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURE_DIR = path.join(ROOT, "frontend", "ocr-core", "fixtures", "patch-merge");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function caseName(inputPath) {
  return path.basename(inputPath).replace(/\.blocks\.input\.json$/, "");
}

function issueTypes(items) {
  return Array.from(new Set((items || []).map((item) => item.type))).sort();
}

function conflictReasons(items) {
  return Array.from(new Set((items || []).map((item) => item.reason))).sort();
}

function coreResult(result, conflicts) {
  return {
    mergedBlocks: result.mergedBlocks,
    errors: issueTypes(result.errors),
    warnings: issueTypes(result.warnings),
    conflicts: conflictReasons(conflicts),
  };
}

function coreExpected(expected) {
  return {
    mergedBlocks: expected.mergedBlocks,
    errors: (expected.errors || []).slice().sort(),
    warnings: (expected.warnings || []).slice().sort(),
    conflicts: (expected.conflicts || []).slice().sort(),
  };
}

function main() {
  const blockFiles = fs
    .readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".blocks.input.json"))
    .sort()
    .map((name) => path.join(FIXTURE_DIR, name));

  const failures = [];
  let passed = 0;

  for (const blocksPath of blockFiles) {
    const name = caseName(blocksPath);
    const patchesPath = path.join(FIXTURE_DIR, `${name}.patches.input.json`);
    const expectedPath = path.join(FIXTURE_DIR, `${name}.merged.expected.json`);
    const blocks = readJson(blocksPath);
    const patches = readJson(patchesPath);
    const expected = coreExpected(readJson(expectedPath));
    const mergeResult = mergeAcceptedPatches({ blocks, patches });
    const conflictResult = detectPatchConflicts({ patches });
    const actual = coreResult(mergeResult, conflictResult.conflicts);

    try {
      assert.deepStrictEqual(actual, expected);
      passed += 1;
    } catch {
      failures.push({ name, actual, expected });
    }
  }

  if (!failures.length) {
    console.log(`ocr patch merger fixtures ok: ${passed}/${blockFiles.length} passed`);
    return;
  }

  console.error(`ocr patch merger fixtures failed: ${failures.length}/${blockFiles.length} failed`);
  for (const failure of failures) {
    console.error(`\n[case] ${failure.name}`);
    console.error("--- actual ---");
    console.error(JSON.stringify(failure.actual, null, 2));
    console.error("--- expected ---");
    console.error(JSON.stringify(failure.expected, null, 2));
  }
  console.error(`\npassed: ${passed}/${blockFiles.length}`);
  process.exitCode = 1;
}

main();
