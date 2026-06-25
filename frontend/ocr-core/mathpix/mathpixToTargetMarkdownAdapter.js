const { normalizeMathDelimiters } = require("../normalization/mathDelimiterNormalizer");
const { validateMarkdownMathSyntax } = require("../validation/markdownMathSyntaxValidator");

function adaptMathpixToTargetMarkdown(input) {
  const blockId = String(input?.blockId || "");
  const rawText = String(input?.rawText || "").replace(/\r\n?/g, "\n");
  const blockType = input?.blockType || "unknown";
  const warnings = [];
  const errors = [];

  if (!rawText.trim()) {
    return {
      blockId,
      targetMarkdown: "",
      changed: false,
      warnings: [
        {
          type: "empty_mathpix_output",
          message: "Mathpix output is empty.",
        },
      ],
      errors,
    };
  }

  if (blockType === "code") {
    const validation = validateSafely(blockId, rawText);
    return finish(blockId, rawText, rawText, warnings.concat(validation.warnings), validation.errors);
  }

  const stripped = stripOuterMathpixFence(rawText);
  if (stripped.changed) {
    warnings.push({
      type: "outer_fence_removed",
      message: `Removed outer ${stripped.language || "markdown"} fence from Mathpix output.`,
    });
  }

  const converted = convertMathpixDelimiters(stripped.text, blockType, warnings);
  const normalized = normalizeSafely(blockId, converted, blockType, warnings, errors);
  const validation = validateSafely(blockId, normalized);

  return finish(
    blockId,
    rawText,
    normalized,
    mergeIssues(warnings, validation.warnings),
    mergeIssues(errors, validation.errors)
  );
}

function finish(blockId, original, targetMarkdown, warnings, errors) {
  return {
    blockId,
    targetMarkdown,
    changed: targetMarkdown !== original,
    warnings,
    errors,
  };
}

function stripOuterMathpixFence(text) {
  const match = String(text || "").match(/^\s*```([^\n`]*)\n([\s\S]*?)\n?```\s*$/);
  if (!match) {
    return { text, changed: false, language: "" };
  }
  const language = String(match[1] || "").trim().toLowerCase();
  if (!isMathpixOuterFenceLanguage(language)) {
    return { text, changed: false, language };
  }
  return {
    text: match[2].trim(),
    changed: true,
    language,
  };
}

function isMathpixOuterFenceLanguage(language) {
  return !language || ["markdown", "md", "mmd", "mathpix", "latex", "tex"].includes(language);
}

function convertMathpixDelimiters(text, blockType, warnings) {
  if (blockType === "table" || hasMarkdownTable(text)) {
    return convertTableSafeMathpixDelimiters(text, warnings);
  }

  return transformOutsideFencedCode(text, (segment) =>
    convertInlineParens(convertDisplayBrackets(segment))
  );
}

function convertTableSafeMathpixDelimiters(text, warnings) {
  return transformOutsideFencedCode(text, (segment) =>
    segment
      .split("\n")
      .map((line) => {
        if (!isMarkdownTableLine(line)) {
          return convertInlineParens(convertDisplayBrackets(line));
        }
        return convertInlineParens(
          line.replace(/\\\[\s*([^\n]*?)\s*\\\]/g, (_match, body) => {
            warnings.push({
              type: "display_math_in_table_cell_downgraded_to_inline",
              message: "Display math delimiter inside a Markdown table row was converted to inline math to preserve table columns.",
            });
            return `$${body.trim()}$`;
          })
        );
      })
      .join("\n")
  );
}

function transformOutsideFencedCode(text, transform) {
  const lines = String(text || "").split("\n");
  const output = [];
  let outside = [];
  let inFence = false;

  function flushOutside() {
    if (!outside.length) {
      return;
    }
    output.push(transform(outside.join("\n")));
    outside = [];
  }

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (!inFence) {
        flushOutside();
        inFence = true;
      } else {
        inFence = false;
      }
      output.push(line);
      continue;
    }

    if (inFence) {
      output.push(line);
    } else {
      outside.push(line);
    }
  }

  flushOutside();
  return output.join("\n");
}

function convertDisplayBrackets(text) {
  return String(text || "").replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_match, body) => {
    const formula = trimMathBody(body);
    return formula ? `$$\n${formula}\n$$` : "$$\n$$";
  });
}

function convertInlineParens(text) {
  return String(text || "").replace(/\\\(([\s\S]*?)\\\)/g, (_match, body) => `$${trimMathBody(body)}$`);
}

function trimMathBody(body) {
  return String(body || "").replace(/\r\n?/g, "\n").trim();
}

function normalizeSafely(blockId, blockText, blockType, warnings, errors) {
  try {
    const normalized = normalizeMathDelimiters({
      blockId,
      blockText,
      blockType,
    });
    warnings.push(...normalized.warnings);
    errors.push(...normalized.errors);
    return normalized.normalizedText;
  } catch (error) {
    errors.push({
      type: "normalization_failed",
      message: error?.message || "Math delimiter normalization failed.",
    });
    return blockText;
  }
}

function validateSafely(blockId, markdown) {
  try {
    return validateMarkdownMathSyntax({
      blockId,
      markdown,
    });
  } catch (error) {
    return {
      blockId,
      ok: false,
      warnings: [],
      errors: [
        {
          type: "validation_failed",
          message: error?.message || "Markdown math syntax validation failed.",
        },
      ],
    };
  }
}

function hasMarkdownTable(text) {
  return String(text || "")
    .split("\n")
    .some(isMarkdownTableLine);
}

function isMarkdownTableLine(line) {
  const trimmed = String(line || "").trim();
  return trimmed.startsWith("|") && trimmed.includes("|", 1);
}

function mergeIssues(primary, secondary) {
  const seen = new Set();
  const merged = [];
  for (const issue of primary.concat(secondary)) {
    const key = `${issue?.type || ""}:${issue?.message || ""}:${issue?.position ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(issue);
  }
  return merged;
}

module.exports = {
  adaptMathpixToTargetMarkdown,
};
