#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { adaptMathpixToTargetMarkdown } = require("../mathpix/mathpixToTargetMarkdownAdapter");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURE_DIR = path.join(ROOT, "frontend", "ocr-core", "fixtures", "mathpix-adapter");

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n").trimEnd();
}

function fixtureName(inputPath) {
  return path.basename(inputPath).replace(/\.input\.md$/, "");
}

function adapt(rawText, blockType = "unknown") {
  return adaptMathpixToTargetMarkdown({
    blockId: "test-block",
    rawText,
    source: "mathpix",
    blockType,
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
    const expectedPath = inputPath.replace(/\.input\.md$/, ".expected.md");
    const name = fixtureName(inputPath);
    const input = readText(inputPath);
    const expected = readText(expectedPath);
    const result = adaptMathpixToTargetMarkdown({
      blockId: name,
      rawText: input,
      source: "mathpix",
      blockType: inferBlockType(input),
    });
    const actual = result.targetMarkdown.trimEnd();

    try {
      assert.strictEqual(actual, expected);
      if (name === "empty_output") {
        assert(result.warnings.some((item) => item.type === "empty_mathpix_output"));
      }
      passed += 1;
    } catch {
      failures.push({
        name,
        inputPath,
        expectedPath,
        actual,
        expected,
        warnings: result.warnings,
        errors: result.errors,
      });
    }
  }

  if (failures.length) {
    console.error(`mathpix adapter fixtures failed: ${failures.length}/${inputFiles.length} failed`);
    for (const failure of failures) {
      console.error(`\n[fixture] ${failure.name}`);
      console.error(`input: ${path.relative(ROOT, failure.inputPath)}`);
      console.error(`expected: ${path.relative(ROOT, failure.expectedPath)}`);
      console.error("--- actual ---");
      console.error(failure.actual);
      console.error("--- expected ---");
      console.error(failure.expected);
      console.error("--- warnings ---");
      console.error(JSON.stringify(failure.warnings, null, 2));
      console.error("--- errors ---");
      console.error(JSON.stringify(failure.errors, null, 2));
    }
    console.error(`\npassed: ${passed}/${inputFiles.length}`);
    process.exitCode = 1;
    return false;
  }

  console.log(`mathpix adapter fixtures ok: ${passed}/${inputFiles.length} passed`);
  return true;
}

function runDirectUnitTests() {
  {
    const actual = adapt("\\[E=mc^2\\]");
    assert.strictEqual(actual.targetMarkdown, "$$\nE=mc^2\n$$");
  }

  {
    const actual = adapt("The lens equation is \\(\\theta^2-\\beta\\theta-\\theta_E^2=0\\).");
    assert.strictEqual(actual.targetMarkdown, "The lens equation is $\\theta^2-\\beta\\theta-\\theta_E^2=0$.");
  }

  {
    const actual = adapt("```markdown\n$$\nF=ma\n$$\n```");
    assert.strictEqual(actual.targetMarkdown, "$$\nF=ma\n$$");
  }

  {
    const actual = adapt("```latex\n\\begin{align}\na&=b+c\n\\end{align}\n```");
    assert.strictEqual(actual.targetMarkdown, "$$\n\\begin{align}\na&=b+c\n\\end{align}\n$$");
  }

  {
    const actual = adapt("\\begin{array}{cc}\na&b\\\\\nc&d\n\\end{array}");
    assert.strictEqual(actual.targetMarkdown, "$$\n\\begin{array}{cc}\na&b\\\\\nc&d\n\\end{array}\n$$");
  }

  {
    const actual = adapt([
      "For SSS fields, Eq. (2.56) is general enough to encompass all metric theories of gravitation.",
      "\\begin{aligned}",
      "I_G &= -\\sum_a m_{0a}\\int (-g_{\\mu\\nu} v^\\mu v^\\nu)^{1/2}dt",
      "&= -\\int L\\,dt",
      "\\end{aligned}",
      "where g is the determinant of g_{\\mu\\nu}.",
    ].join("\n"));
    assert.strictEqual(
      actual.targetMarkdown,
      [
        "For SSS fields, Eq. (2.56) is general enough to encompass all metric theories of gravitation.",
        "$$",
        "\\begin{aligned}",
        "I_G &= -\\sum_a m_{0a}\\int (-g_{\\mu\\nu} v^\\mu v^\\nu)^{1/2}dt",
        "&= -\\int L\\,dt",
        "\\end{aligned}",
        "$$",
        "where g is the determinant of g_{\\mu\\nu}.",
      ].join("\n"),
    );
  }

  {
    const actual = adapt("\\[\n\\begin{equation}\nE=h\\nu\n\\tag{2.13}\n\\label{eq:energy}\n\\end{equation}\n\\]");
    assert(actual.targetMarkdown.includes("\\tag{2.13}"));
    assert(actual.targetMarkdown.includes("\\label{eq:energy}"));
  }

  {
    const actual = adapt("The pressure term \\(p=w\\rho c^2\\) stays inline.");
    assert.strictEqual(actual.targetMarkdown, "The pressure term $p=w\\rho c^2$ stays inline.");
    assert(!actual.targetMarkdown.includes("$$"));
  }

  {
    const input = [
      "| Parameter | Formula |",
      "| --- | --- |",
      "| density | \\(\\rho=3H^2/8\\pi G\\) |",
    ].join("\n");
    const actual = adapt(input, "table");
    const tableRows = actual.targetMarkdown.split("\n");
    assert.strictEqual(tableRows.length, 3);
    assert(tableRows.every((line) => line.split("|").length === 4));
  }

  {
    const actual = adapt("   ");
    assert.strictEqual(actual.targetMarkdown, "");
    assert(actual.warnings.some((item) => item.type === "empty_mathpix_output"));
  }

  {
    const actual = adapt("\\begin{align}\na&=b+c");
    assert(actual.errors.some((item) => item.type === "unbalanced_latex_environment"));
  }

  console.log("mathpix adapter direct unit tests ok");
}

function inferBlockType(markdown) {
  const text = String(markdown || "");
  if (/^\s*```(?!\s*(?:markdown|md|mmd|mathpix|latex|tex)\b)/i.test(text)) {
    return "code";
  }
  if (text.split("\n").some((line) => line.trim().startsWith("|") && line.trim().includes("|", 1))) {
    return "table";
  }
  return "unknown";
}

if (runFixtureTests()) {
  runDirectUnitTests();
}
