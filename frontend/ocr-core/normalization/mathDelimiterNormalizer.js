const { DISPLAY_ENVIRONMENTS, validateMarkdownMathSyntax } = require("../validation/markdownMathSyntaxValidator");

const LOCAL_DISPLAY_ENVIRONMENTS = new Set(["aligned", "aligned*"]);
const DISPLAY_ENVIRONMENT_PATTERN = "(?:equation\\*?|align\\*?|aligned\\*?|array|matrix|pmatrix|bmatrix|cases|split|gather|multline)";

function normalizeMathDelimiters(input) {
  const blockId = String(input?.blockId || "");
  const blockText = String(input?.blockText || "").replace(/\r\n?/g, "\n");
  const blockType = input?.blockType || "unknown";
  const warnings = [];
  const errors = [];

  if (blockType === "code") {
    const validation = validateMarkdownMathSyntax({ blockId, markdown: blockText });
    return result(blockId, blockText, blockText, warnings.concat(validation.warnings), errors);
  }

  const fenceInfo = inspectFencedCode(blockText);
  if (fenceInfo.unclosed) {
    warnings.push({
      type: "unclosed_code_fence",
      message: "Fenced code block is not closed; math delimiters were left unchanged.",
    });
    return result(blockId, blockText, blockText, warnings, errors);
  }
  if (fenceInfo.hasFence) {
    return result(blockId, blockText, blockText, warnings, errors);
  }

  if (blockType === "table" || hasMarkdownTable(blockText)) {
    if (/\\begin\s*\{(?:matrix|pmatrix|bmatrix)\*?\}/.test(blockText)) {
      warnings.push({
        type: "table_cell_math_environment_preserved",
        message: "Matrix-like environment inside a Markdown table was preserved inline.",
      });
    }
    return result(blockId, blockText, blockText, warnings, errors);
  }

  const normalized = normalizeTextLines(blockText, warnings);
  const validation = validateMarkdownMathSyntax({ blockId, markdown: normalized });
  return result(blockId, blockText, normalized, warnings.concat(validation.warnings), validation.errors);
}

function result(blockId, original, normalizedText, warnings, errors) {
  return {
    blockId,
    normalizedText,
    changed: normalizedText !== original,
    warnings,
    errors,
  };
}

function inspectFencedCode(text) {
  const lines = text.split("\n");
  let inFence = false;
  let hasFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      hasFence = true;
      inFence = !inFence;
    }
  }
  return { hasFence, unclosed: inFence };
}

function hasMarkdownTable(text) {
  return text.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("|") && trimmed.includes("|", 1);
  });
}

function normalizeTextLines(text, warnings) {
  const split = splitInlineDisplayEnvironmentDelimiters(text);
  const prepared = hasDisplayMathDelimiter(split) ? split : isolateBareDisplayEnvironmentLines(split);
  const lines = prepared.split("\n");
  const output = [];
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();

    if (trimmed === "$$") {
      const display = collectDisplayBlock(lines, index, warnings);
      output.push(...display.lines);
      index = display.nextIndex;
      continue;
    }

    if (isDisplayEnvironmentStart(trimmed)) {
      const envBlock = collectEnvironmentBlock(lines, index);
      if (envBlock.complete) {
        output.push("$$", ...envBlock.lines, "$$");
        index = envBlock.nextIndex;
        continue;
      }
    }

    if (isLikelyStandaloneDisplayMath(trimmed)) {
      const nextIndex = nextNonEmptyLineIndex(lines, index + 1);
      if (nextIndex >= 0 && lines[nextIndex].trim() === "$$") {
        output.push("$$", lines[index], "$$");
        index = skipDelimiterRun(lines, nextIndex);
        continue;
      }
    }

    output.push(lines[index]);
    index += 1;
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function hasDisplayMathDelimiter(text) {
  return /\$\$|\\\[|\\\]/.test(String(text || ""));
}

function splitInlineDisplayEnvironmentDelimiters(text) {
  return String(text || "")
    .replace(new RegExp(`\\$\\$\\s*(\\\\begin\\s*\\{${DISPLAY_ENVIRONMENT_PATTERN}\\})`, "g"), (_match, begin) => `$$\n${begin}`)
    .replace(new RegExp(`(\\\\end\\s*\\{${DISPLAY_ENVIRONMENT_PATTERN}\\})\\s*\\$\\$`, "g"), (_match, end) => `${end}\n$$`);
}

function isolateBareDisplayEnvironmentLines(text) {
  return String(text || "")
    .replace(new RegExp(`([^\\n])[ \\t]*(\\\\begin\\s*\\{${DISPLAY_ENVIRONMENT_PATTERN}\\})`, "g"), (_match, before, begin) => `${before}\n${begin}`)
    .replace(new RegExp(`(\\\\end\\s*\\{${DISPLAY_ENVIRONMENT_PATTERN}\\})[ \\t]*([^\\n])`, "g"), (_match, end, after) => `${end}\n${after}`);
}

function collectDisplayBlock(lines, startIndex, warnings) {
  let index = skipDelimiterRun(lines, startIndex);

  if (index < lines.length && isDisplayEnvironmentStart(lines[index].trim())) {
    const envBlock = collectEnvironmentBlock(lines, index);
    if (envBlock.complete) {
      index = skipDelimiterRun(lines, envBlock.nextIndex);
      return { lines: ["$$", ...envBlock.lines, "$$"], nextIndex: index };
    }
  }

  const content = [];
  let closed = false;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === "$$") {
      closed = true;
      index = skipDelimiterRun(lines, index);
      break;
    }
    if (!trimmed && content.length > 0) {
      const nextIndex = nextNonEmptyLineIndex(lines, index + 1);
      if (nextIndex >= 0 && !isLikelyMathContinuation(lines[nextIndex].trim())) {
        break;
      }
    }
    content.push(lines[index]);
    index += 1;
  }

  const cleanedContent = trimBlankLines(content);
  if (!cleanedContent.length) {
    warnings.push({
      type: "ambiguous_math_delimiter",
      message: "Display math delimiter had no safe formula content.",
    });
    return { lines: ["$$"], nextIndex: index };
  }
  if (!closed && index >= lines.length) {
    warnings.push({
      type: "possible_cross_block_math_delimiter",
      message: "Opening display delimiter reached the end of the block; inserted closing delimiter.",
    });
  }
  return { lines: ["$$", ...cleanedContent, "$$"], nextIndex: index };
}

function collectEnvironmentBlock(lines, startIndex) {
  const first = lines[startIndex] || "";
  const env = environmentName(first);
  const collected = [];
  let index = startIndex;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed !== "$$") {
      collected.push(lines[index]);
    }
    if (env && endEnvironmentPattern(env).test(lines[index])) {
      index += 1;
      const tagIndex = nextNonEmptyLineIndex(lines, index);
      if (tagIndex >= 0 && /^\\tag\{[^}]+\}\s*$/.test(lines[tagIndex].trim())) {
        collected.push(lines[tagIndex]);
        index = tagIndex + 1;
      }
      return { complete: true, lines: trimBlankLines(collected), nextIndex: index };
    }
    index += 1;
  }
  return { complete: false, lines: trimBlankLines(collected), nextIndex: index };
}

function environmentName(line) {
  const match = String(line || "").match(/\\begin\s*\{([^}]+)\}/);
  return match ? match[1] : "";
}

function endEnvironmentPattern(env) {
  const escaped = env.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\\\end\\s*\\{${escaped}\\}`);
}

function isDisplayEnvironmentStart(trimmed) {
  const env = environmentName(trimmed);
  return DISPLAY_ENVIRONMENTS.has(env) || LOCAL_DISPLAY_ENVIRONMENTS.has(env);
}

function isLikelyStandaloneDisplayMath(trimmed) {
  if (!trimmed || trimmed.includes("$$") || trimmed.includes("|") || isCurrencyLine(trimmed)) {
    return false;
  }
  if (/^\$[^$].*\$$/.test(trimmed) || /\\\(.+\\\)/.test(trimmed)) {
    return false;
  }
  if (/\\begin\s*\{/.test(trimmed)) {
    return isDisplayEnvironmentStart(trimmed);
  }
  if (!/[=<>^_]|\\(?:frac|sqrt|sum|int|Omega|Lambda|Delta|lambda|nu|alpha|beta|gamma|omega|leq|geq)/.test(trimmed)) {
    return false;
  }
  if (/[。！？!?]$/.test(trimmed)) {
    return false;
  }
  return /^[A-Za-z0-9\\{}()[\]\s+\-*/^_=,.;:'<>|]+$/.test(trimmed);
}

function isLikelyMathContinuation(trimmed) {
  if (!trimmed) {
    return true;
  }
  return (
    trimmed === "$$" ||
    isDisplayEnvironmentStart(trimmed) ||
    /^\\end\s*\{/.test(trimmed) ||
    isLikelyStandaloneDisplayMath(trimmed) ||
    /^(&|\\\\|=|\+|-)/.test(trimmed)
  );
}

function isCurrencyLine(text) {
  return /(?:^|\s)(?:US|HK|SGD)?\s*\$\s*\d/.test(text);
}

function skipDelimiterRun(lines, startIndex) {
  let index = startIndex;
  while (index < lines.length && lines[index].trim() === "$$") {
    index += 1;
  }
  return index;
}

function nextNonEmptyLineIndex(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (String(lines[index] || "").trim()) {
      return index;
    }
  }
  return -1;
}

function trimBlankLines(lines) {
  const output = lines.slice();
  while (output.length && !String(output[0] || "").trim()) {
    output.shift();
  }
  while (output.length && !String(output[output.length - 1] || "").trim()) {
    output.pop();
  }
  return output;
}

module.exports = {
  normalizeMathDelimiters,
};
