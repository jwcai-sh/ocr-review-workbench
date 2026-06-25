#!/usr/bin/env node
const assert = require("assert");
const { normalizeMathDelimiters } = require("../normalization/mathDelimiterNormalizer");
const { validateMarkdownMathSyntax } = require("../validation/markdownMathSyntaxValidator");

function normalize(blockText, blockType = "unknown") {
  return normalizeMathDelimiters({ blockId: "test-block", blockText, blockType });
}

{
  const input = "$$\n$$\nE = mc^2\n$$\n$$";
  const actual = normalize(input);
  assert.strictEqual(actual.normalizedText, "$$\nE = mc^2\n$$");
  assert.strictEqual(actual.changed, true);
}

{
  const input = "```js\nconst price = '$100';\n```";
  const actual = normalize(input);
  assert.strictEqual(actual.normalizedText, input);
  assert.strictEqual(actual.changed, false);
}

{
  const input = "$$\nE = mc^2";
  const actual = normalize(input);
  assert.strictEqual(actual.normalizedText, "$$\nE = mc^2\n$$");
  assert.strictEqual(actual.errors.length, 0);
}

{
  const input = [
    "For SSS fields, Eq. (2.56) is general enough to encompass metric theories.",
    "\\begin{aligned}",
    "I_G &= -\\sum_a m_{0a}\\int (-g_{\\mu\\nu} v^\\mu v^\\nu)^{1/2}dt",
    "&= -\\int L\\,dt",
    "\\end{aligned}",
    "where g is the determinant of g_{\\mu\\nu}.",
  ].join("\n");
  const actual = normalize(input);
  assert.strictEqual(
    actual.normalizedText,
    [
      "For SSS fields, Eq. (2.56) is general enough to encompass metric theories.",
      "$$",
      "\\begin{aligned}",
      "I_G &= -\\sum_a m_{0a}\\int (-g_{\\mu\\nu} v^\\mu v^\\nu)^{1/2}dt",
      "&= -\\int L\\,dt",
      "\\end{aligned}",
      "$$",
      "where g is the determinant of g_{\\mu\\nu}.",
    ].join("\n"),
  );
  assert.strictEqual(actual.errors.length, 0);
}

{
  const input = "Metric action is \\begin{aligned}\nI_G&=-\\int Ldt\n\\end{aligned} where g is the determinant.";
  const actual = normalize(input);
  assert.strictEqual(
    actual.normalizedText,
    "Metric action is\n$$\n\\begin{aligned}\nI_G&=-\\int Ldt\n\\end{aligned}\n$$\nwhere g is the determinant.",
  );
  assert.strictEqual(actual.errors.length, 0);
}

{
  const input = "Weak interaction result\n\\begin{aligned}\nE_W &= 2.2\\times10^{-8}\n\\end{aligned}\n\\tag{2.12}";
  const actual = normalize(input);
  assert.strictEqual(
    actual.normalizedText,
    "Weak interaction result\n$$\n\\begin{aligned}\nE_W &= 2.2\\times10^{-8}\n\\end{aligned}\n\\tag{2.12}\n$$",
  );
  assert.strictEqual(actual.errors.length, 0);
}

{
  const input = "The camera cost $100 and the guide scope cost HK$ 450.";
  const actual = normalize(input);
  assert.strictEqual(actual.normalizedText, input);
  assert.strictEqual(actual.changed, false);
}

{
  const validation = validateMarkdownMathSyntax({
    blockId: "bad-env",
    markdown: "$$\n\\begin{align}\na &= b\n$$",
  });
  assert.strictEqual(validation.ok, false);
  assert(validation.errors.some((item) => item.type === "unbalanced_latex_environment"));
}

{
  const validation = validateMarkdownMathSyntax({
    blockId: "bad-fence",
    markdown: "```python\nx = '$$'",
  });
  assert.strictEqual(validation.ok, true);
  assert(validation.warnings.some((item) => item.type === "unclosed_code_fence"));
}

console.log("math delimiter normalizer unit tests ok");
