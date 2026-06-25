#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { validateRenderability } = require("../validation/renderValidator");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURE_DIR = path.join(ROOT, "frontend", "ocr-core", "fixtures", "render-validation");

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n").trimEnd();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fixtureName(inputPath) {
  return path.basename(inputPath).replace(/\.input\.md$/, "");
}

function coreResult(result) {
  return {
    ok: result.ok,
    severity: result.severity,
    errors: issueTypes(result.errors),
    warnings: issueTypes(result.warnings),
  };
}

function coreExpected(expected) {
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

function validate(markdown, blockId = "test-block") {
  return validateRenderability({
    blockId,
    markdown,
    blockType: "unknown",
    source: "unknown",
  });
}

function runFixtureTests() {
  const inputFiles = fs
    .readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".input.md"))
    .sort()
    .map((name) => path.join(FIXTURE_DIR, name));

  const failures = [];
  let passed = 0;

  for (const inputPath of inputFiles) {
    const expectedPath = inputPath.replace(/\.input\.md$/, ".expected.json");
    const name = fixtureName(inputPath);
    const input = readText(inputPath);
    const expected = coreExpected(readJson(expectedPath));
    const result = validate(input, name);
    const actual = coreResult(result);

    try {
      assert.deepStrictEqual(actual, expected);
      passed += 1;
    } catch {
      failures.push({ name, actual, expected });
    }
  }

  if (failures.length) {
    console.error(`render validator fixtures failed: ${failures.length}/${inputFiles.length} failed`);
    for (const failure of failures) {
      console.error(`\n[fixture] ${failure.name}`);
      console.error("--- actual ---");
      console.error(JSON.stringify(failure.actual, null, 2));
      console.error("--- expected ---");
      console.error(JSON.stringify(failure.expected, null, 2));
    }
    console.error(`\npassed: ${passed}/${inputFiles.length}`);
    process.exitCode = 1;
    return false;
  }

  console.log(`render validator fixtures ok: ${passed}/${inputFiles.length} passed`);
  return true;
}

function runDirectUnitTests() {
  {
    const result = validate("\\[\nF=ma");
    assert.strictEqual(result.ok, false);
    assert(result.errors.some((item) => item.type === "unbalanced_bracket_math_delimiter"));
  }

  {
    const result = validate("The inline escape speed is \\(v_{\\rm esc}=\\sqrt{2GM/R}.");
    assert.strictEqual(result.ok, false);
    assert(result.errors.some((item) => item.type === "unbalanced_bracket_math_delimiter"));
  }

  {
    const result = validate("$$\nM_{\\rm gas=4\\pi \\int_0^R \\rho(r) r^2 dr\n$$");
    assert.strictEqual(result.ok, false);
    assert(result.errors.some((item) => item.type === "unbalanced_braces"));
  }

  {
    const result = validate("$$\nL^ = 4\\pi R^2\\sigma T^4\n$$");
    assert.strictEqual(result.ok, false);
    assert(result.errors.some((item) => item.type === "dangling_superscript"));
  }

  {
    const result = validate("\\begin{tabular}{cc}\nStar & Mass\\\\\nA & 1.2M_\\odot\n\\end{tabular}");
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.severity, "warning");
    assert(result.warnings.some((item) => item.type === "ambiguous_render_risk"));
  }

  console.log("render validator direct unit tests ok");
}

if (runFixtureTests()) {
  runDirectUnitTests();
}
