(function (globalScope) {
  const DISPLAY_ENVIRONMENTS = new Set([
    "equation",
    "equation*",
    "align",
    "align*",
    "aligned",
    "aligned*",
    "array",
    "matrix",
    "pmatrix",
    "bmatrix",
    "cases",
    "split",
    "gather",
    "multline",
  ]);
  const DISPLAY_ENVIRONMENT_PATTERN = "(?:equation\\*?|align\\*?|aligned\\*?|array|matrix|pmatrix|bmatrix|cases|split|gather|multline)";

  function adaptMathpixToTargetMarkdown(input) {
    const blockId = String((input && input.blockId) || "");
    const rawText = String((input && input.rawText) || "").replace(/\r\n?/g, "\n");
    const blockType = (input && input.blockType) || "unknown";
    const warnings = [];
    const errors = [];

    if (!rawText.trim()) {
      return {
        blockId,
        targetMarkdown: "",
        changed: false,
        warnings: [{ type: "empty_mathpix_output", message: "Mathpix output is empty." }],
        errors,
      };
    }

    if (blockType === "code") {
      const validation = validateMarkdownMathSyntax({ blockId, markdown: rawText });
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
    const validation = validateMarkdownMathSyntax({ blockId, markdown: normalized });
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
    return { text: match[2].trim(), changed: true, language };
  }

  function isMathpixOuterFenceLanguage(language) {
    return !language || ["markdown", "md", "mmd", "mathpix", "latex", "tex"].includes(language);
  }

  function convertMathpixDelimiters(text, blockType, warnings) {
    if (blockType === "table" || hasMarkdownTable(text)) {
      return convertTableSafeMathpixDelimiters(text, warnings);
    }
    return transformOutsideFencedCode(text, (segment) => convertInlineParens(convertDisplayBrackets(segment)));
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
              return `$${trimMathBody(body)}$`;
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
      const normalized = normalizeMathDelimiters({ blockId, blockText, blockType });
      warnings.push(...normalized.warnings);
      errors.push(...normalized.errors);
      return normalized.normalizedText;
    } catch (error) {
      errors.push({
        type: "normalization_failed",
        message: (error && error.message) || "Math delimiter normalization failed.",
      });
      return blockText;
    }
  }

  function normalizeMathDelimiters(input) {
    const blockId = String((input && input.blockId) || "");
    const blockText = String((input && input.blockText) || "").replace(/\r\n?/g, "\n");
    const blockType = (input && input.blockType) || "unknown";
    const warnings = [];
    const errors = [];

    if (blockType === "code") {
      const validation = validateMarkdownMathSyntax({ blockId, markdown: blockText });
      return normalizerResult(blockId, blockText, blockText, warnings.concat(validation.warnings), errors);
    }

    const fenceInfo = inspectFencedCode(blockText);
    if (fenceInfo.unclosed) {
      warnings.push({
        type: "unclosed_code_fence",
        message: "Fenced code block is not closed; math delimiters were left unchanged.",
      });
      return normalizerResult(blockId, blockText, blockText, warnings, errors);
    }
    if (fenceInfo.hasFence) {
      return normalizerResult(blockId, blockText, blockText, warnings, errors);
    }

    if (blockType === "table" || hasMarkdownTable(blockText)) {
      return normalizerResult(blockId, blockText, blockText, warnings, errors);
    }

    const normalized = normalizeTextLines(blockText, warnings);
    const validation = validateMarkdownMathSyntax({ blockId, markdown: normalized });
    return normalizerResult(blockId, blockText, normalized, warnings.concat(validation.warnings), validation.errors);
  }

  function normalizerResult(blockId, original, normalizedText, warnings, errors) {
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
    const env = environmentName(lines[startIndex] || "");
    const collected = [];
    let index = startIndex;
    while (index < lines.length) {
      const trimmed = lines[index].trim();
      if (trimmed !== "$$") {
        collected.push(lines[index]);
      }
      if (env && endEnvironmentPattern(env).test(lines[index])) {
        index += 1;
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
    return new RegExp(`\\\\end\\s*\\{${env.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`);
  }

  function isDisplayEnvironmentStart(trimmed) {
    return DISPLAY_ENVIRONMENTS.has(environmentName(trimmed));
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

  function validateMarkdownMathSyntax(input) {
    const blockId = String((input && input.blockId) || "");
    const markdown = String((input && input.markdown) || "").replace(/\r\n?/g, "\n");
    const errors = [];
    const warnings = [];
    const scan = scanOutsideFences(markdown);

    if (scan.unclosedFence) {
      warnings.push({
        type: "unclosed_code_fence",
        message: "Fenced code block is not closed.",
        position: scan.unclosedFencePosition,
      });
    }

    const displayDelimiters = findDisplayDelimiters(scan.text);
    if (displayDelimiters.length % 2 !== 0) {
      errors.push({
        type: "unbalanced_display_math_delimiter",
        message: "Display math delimiters are not balanced.",
        position: displayDelimiters[displayDelimiters.length - 1],
      });
    }

    const inlineDelimiters = findInlineDollarDelimiters(scan.text);
    if (inlineDelimiters.length % 2 !== 0) {
      errors.push({
        type: "unbalanced_inline_math_delimiter",
        message: "Inline math delimiters are not balanced.",
        position: inlineDelimiters[inlineDelimiters.length - 1],
      });
    }

    errors.push(...validateLatexEnvironments(scan.text));
    warnings.push(...validateMarkdownTables(scan.text));
    return { blockId, ok: errors.length === 0, errors, warnings };
  }

  function scanOutsideFences(markdown) {
    const lines = markdown.split("\n");
    const output = [];
    let offset = 0;
    let inFence = false;
    let unclosedFencePosition = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^```/.test(trimmed)) {
        if (!inFence) {
          inFence = true;
          unclosedFencePosition = offset;
        } else {
          inFence = false;
          unclosedFencePosition = null;
        }
        output.push("");
      } else {
        output.push(inFence ? "" : line);
      }
      offset += line.length + 1;
    }

    return { text: output.join("\n"), unclosedFence: inFence, unclosedFencePosition };
  }

  function findDisplayDelimiters(text) {
    const positions = [];
    for (let index = 0; index < text.length - 1; index += 1) {
      if (text[index] === "$" && text[index + 1] === "$" && text[index - 1] !== "\\") {
        positions.push(index);
        index += 1;
      }
    }
    return positions;
  }

  function findInlineDollarDelimiters(text) {
    const positions = [];
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] !== "$" || text[index - 1] === "$" || text[index + 1] === "$" || text[index - 1] === "\\") {
        continue;
      }
      if (!isCurrencyDollar(text, index)) {
        positions.push(index);
      }
    }
    return positions;
  }

  function isCurrencyDollar(text, index) {
    const after = text.slice(index + 1, index + 8);
    const before = text.slice(Math.max(0, index - 5), index);
    return /^\s*\d/.test(after) || (/(US|HK|SGD)\s*$/i.test(before) && /^\s*\d/.test(after));
  }

  function validateLatexEnvironments(text) {
    const errors = [];
    const stack = [];
    const pattern = /\\(begin|end)\s*\{([^}]+)\}/g;
    let match;
    while ((match = pattern.exec(text))) {
      if (match[1] === "begin") {
        stack.push({ env: match[2], position: match.index });
        continue;
      }
      const latest = stack.pop();
      if (!latest || latest.env !== match[2]) {
        errors.push({
          type: "unbalanced_latex_environment",
          message: `Unexpected \\end{${match[2]}}.`,
          position: match.index,
        });
      }
    }
    for (const item of stack) {
      errors.push({
        type: "unbalanced_latex_environment",
        message: `Missing \\end{${item.env}}.`,
        position: item.position,
      });
    }
    return errors;
  }

  function validateMarkdownTables(text) {
    const warnings = [];
    const lines = text.split("\n");
    let expectedColumns = null;
    let inTable = false;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!isMarkdownTableLine(line)) {
        expectedColumns = null;
        inTable = false;
        continue;
      }
      const columns = splitMarkdownTableRow(line).length;
      if (!inTable) {
        expectedColumns = columns;
        inTable = true;
        continue;
      }
      if (columns !== expectedColumns) {
        warnings.push({
          type: "table_column_mismatch",
          message: "Markdown table row has a different column count.",
        });
      }
    }
    return warnings;
  }

  function splitMarkdownTableRow(line) {
    const body = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells = [];
    let cell = "";
    let mathDelimiter = "";
    for (let index = 0; index < body.length; index += 1) {
      const char = body[index];
      const previous = body[index - 1] || "";
      if (char === "$" && previous !== "\\") {
        const delimiter = body[index + 1] === "$" ? "$$" : "$";
        mathDelimiter = !mathDelimiter ? delimiter : mathDelimiter === delimiter ? "" : mathDelimiter;
        cell += delimiter;
        if (delimiter === "$$") {
          index += 1;
        }
        continue;
      }
      if (char === "|" && !mathDelimiter) {
        cells.push(cell.trim());
        cell = "";
        continue;
      }
      cell += char;
    }
    cells.push(cell.trim());
    return cells;
  }

  function hasMarkdownTable(text) {
    return String(text || "").split("\n").some(isMarkdownTableLine);
  }

  function isMarkdownTableLine(line) {
    const trimmed = String(line || "").trim();
    return trimmed.startsWith("|") && trimmed.includes("|", 1);
  }

  function mergeIssues(primary, secondary) {
    const seen = new Set();
    const merged = [];
    for (const issue of primary.concat(secondary)) {
      const key = `${(issue && issue.type) || ""}:${(issue && issue.message) || ""}:${issue && issue.position !== undefined ? issue.position : ""}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(issue);
    }
    return merged;
  }

  globalScope.OcrCoreMathpixAdapter = {
    adaptMathpixToTargetMarkdown,
  };
})(globalThis);
