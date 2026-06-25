const DISPLAY_ENVIRONMENTS = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "array",
  "matrix",
  "pmatrix",
  "bmatrix",
  "cases",
  "split",
  "gather",
  "multline",
]);

function validateRenderability(input) {
  const blockId = String(input?.blockId || "");
  const markdown = String(input?.markdown || "").replace(/\r\n?/g, "\n");
  const errors = [];
  const warnings = [];
  const scan = scanMarkdown(markdown, warnings, errors);

  validateDisplayMathDelimiters(scan.text, markdown, errors);
  validateInlineMathDelimiters(scan.text, markdown, errors);
  validateBracketMathDelimiters(scan.text, markdown, errors);
  validateLatexEnvironments(scan.text, markdown, errors);
  validateMarkdownTables(scan.lines, warnings, errors);
  validateResidualMathpixBlocks(scan.text, markdown, warnings);
  validateLeftRightPairs(scan.text, markdown, errors);
  validateBracePairs(scan.text, markdown, errors);
  validateDanglingScript(scan.text, markdown, "_", "dangling_subscript", errors);
  validateDanglingScript(scan.text, markdown, "^", "dangling_superscript", errors);
  validateFrac(scan.text, markdown, errors);
  validateSqrt(scan.text, markdown, errors);

  const severity = errors.length ? "error" : warnings.length ? "warning" : "ok";
  return {
    blockId,
    ok: errors.length === 0,
    severity,
    errors: uniqueIssues(errors),
    warnings: uniqueIssues(warnings),
  };
}

function scanMarkdown(markdown, warnings, errors) {
  const lines = markdown.split("\n");
  const outsideLines = [];
  let offset = 0;
  let inFence = false;
  let fenceStart = null;
  let fenceStartLine = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^```([A-Za-z0-9_-]*)?/);

    if (fenceMatch) {
      const language = String(fenceMatch[1] || "").toLowerCase();
      if (isMathpixResidualFenceLanguage(language)) {
        warnings.push(issue("mathpix_fence_not_removed", "Mathpix residual code fence was not removed.", offset, index + 1));
      }
      if (!inFence) {
        inFence = true;
        fenceStart = offset;
        fenceStartLine = index + 1;
      } else {
        inFence = false;
        fenceStart = null;
        fenceStartLine = null;
      }
      outsideLines.push({ text: "", offset, line: index + 1 });
    } else {
      if (!inFence && /^`(?:math|latex|tex|mmd|mathpix)\b/i.test(trimmed)) {
        warnings.push(issue("mathpix_fence_not_removed", "Mathpix residual inline fence marker was not removed.", offset, index + 1));
      }
      outsideLines.push({ text: inFence ? "" : line, offset, line: index + 1 });
    }

    offset += line.length + 1;
  }

  if (inFence) {
    errors.push(issue("unclosed_fenced_code_block", "Fenced code block is not closed.", fenceStart, fenceStartLine));
  }

  return {
    lines: outsideLines,
    text: outsideLines.map((line) => line.text).join("\n"),
  };
}

function isMathpixResidualFenceLanguage(language) {
  return ["math", "latex", "tex", "mmd", "mathpix"].includes(language);
}

function validateDisplayMathDelimiters(text, original, errors) {
  const positions = [];
  for (let index = 0; index < text.length - 1; index += 1) {
    if (text[index] === "$" && text[index + 1] === "$" && text[index - 1] !== "\\") {
      positions.push(index);
      index += 1;
    }
  }
  if (positions.length % 2 !== 0) {
    addPositionIssue(errors, "unbalanced_display_math_delimiter", "Display math delimiters are not balanced.", original, positions[positions.length - 1]);
  }
}

function validateInlineMathDelimiters(text, original, errors) {
  const positions = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "$" || text[index - 1] === "\\") {
      continue;
    }
    if (text[index - 1] === "$" || text[index + 1] === "$") {
      continue;
    }
    if (isCurrencyDollar(text, index)) {
      continue;
    }
    positions.push(index);
  }
  if (positions.length % 2 !== 0) {
    addPositionIssue(errors, "unbalanced_inline_math_delimiter", "Inline math delimiters are not balanced.", original, positions[positions.length - 1]);
  }
}

function isCurrencyDollar(text, index) {
  const after = text.slice(index + 1, index + 8);
  const before = text.slice(Math.max(0, index - 5), index);
  return /^\s*\d/.test(after) || (/(US|HK|SGD)\s*$/i.test(before) && /^\s*\d/.test(after));
}

function validateBracketMathDelimiters(text, original, errors) {
  const stack = [];
  const pattern = /\\([\[\]\(\)])/g;
  let match;
  while ((match = pattern.exec(text))) {
    const token = match[1];
    if (token === "[" || token === "(") {
      stack.push({ token, position: match.index });
      continue;
    }
    const expected = token === "]" ? "[" : "(";
    const latest = stack.pop();
    if (!latest || latest.token !== expected) {
      addPositionIssue(errors, "unbalanced_bracket_math_delimiter", "Bracket math delimiters are not balanced.", original, match.index);
    }
  }
  for (const item of stack) {
    addPositionIssue(errors, "unbalanced_bracket_math_delimiter", "Bracket math delimiters are not balanced.", original, item.position);
  }
}

function validateLatexEnvironments(text, original, errors) {
  const stack = [];
  const pattern = /\\(begin|end)\s*\{([^}]+)\}/g;
  let match;
  while ((match = pattern.exec(text))) {
    const kind = match[1];
    const env = match[2];
    if (kind === "begin") {
      stack.push({ env, position: match.index });
      continue;
    }
    const latest = stack.pop();
    if (!latest || latest.env !== env) {
      addPositionIssue(errors, "unbalanced_latex_environment", `Unexpected \\end{${env}}.`, original, match.index);
    }
  }
  for (const item of stack) {
    addPositionIssue(errors, "unbalanced_latex_environment", `Missing \\end{${item.env}}.`, original, item.position);
  }
}

function validateMarkdownTables(lines, warnings, errors) {
  let expectedColumns = null;
  let inTable = false;

  for (const lineInfo of lines) {
    const line = lineInfo.text;
    const trimmed = line.trim();
    const isTableLine = isMarkdownTableLine(line);

    if (isTableLine && /\$\$/.test(line)) {
      errors.push(issue("display_math_inside_table", "Display math delimiter appears inside a Markdown table row.", lineInfo.offset, lineInfo.line));
    }
    if (inTable && !isTableLine && trimmed === "$$") {
      errors.push(issue("display_math_inside_table", "Display math delimiter interrupts a Markdown table.", lineInfo.offset, lineInfo.line));
    }

    if (!isTableLine) {
      if (trimmed) {
        expectedColumns = null;
        inTable = false;
      }
      continue;
    }

    const columns = splitMarkdownTableRow(line).length;
    if (!inTable) {
      expectedColumns = columns;
      inTable = true;
      continue;
    }
    if (columns !== expectedColumns) {
      warnings.push(issue("table_column_mismatch", "Markdown table row has a different column count.", lineInfo.offset, lineInfo.line));
    }
  }
}

function validateResidualMathpixBlocks(text, original, warnings) {
  const pattern = /\\begin\s*\{tabular\*?\}/g;
  let match;
  while ((match = pattern.exec(text))) {
    addPositionIssue(warnings, "ambiguous_render_risk", "LaTeX tabular block remains in Markdown and may not render as intended.", original, match.index);
  }
}

function isMarkdownTableLine(line) {
  const trimmed = String(line || "").trim();
  return trimmed.startsWith("|") && trimmed.includes("|", 1);
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
      if (!mathDelimiter) {
        mathDelimiter = delimiter;
      } else if (mathDelimiter === delimiter) {
        mathDelimiter = "";
      }
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

function validateLeftRightPairs(text, original, errors) {
  const stack = [];
  const pattern = /\\(left|right)\b/g;
  let match;
  while ((match = pattern.exec(text))) {
    if (match[1] === "left") {
      stack.push(match.index);
      continue;
    }
    if (!stack.length) {
      addPositionIssue(errors, "unbalanced_left_right", "\\right appears without a matching \\left.", original, match.index);
    } else {
      stack.pop();
    }
  }
  for (const position of stack) {
    addPositionIssue(errors, "unbalanced_left_right", "\\left appears without a matching \\right.", original, position);
  }
}

function validateBracePairs(text, original, errors) {
  const stack = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if ((char === "{" || char === "}") && text[index - 1] === "\\") {
      continue;
    }
    if (char === "{") {
      stack.push(index);
    } else if (char === "}") {
      if (!stack.length) {
        addPositionIssue(errors, "unbalanced_braces", "Closing brace appears without a matching opening brace.", original, index);
      } else {
        stack.pop();
      }
    }
  }
  for (const position of stack) {
    addPositionIssue(errors, "unbalanced_braces", "Opening brace appears without a matching closing brace.", original, position);
  }
}

function validateDanglingScript(text, original, marker, type, errors) {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== marker || text[index - 1] === "\\") {
      continue;
    }
    if (marker === "_" && isMarkdownWordUnderscore(text, index)) {
      continue;
    }
    const nextIndex = nextNonSpaceIndex(text, index + 1);
    if (nextIndex < 0 || isInvalidScriptTarget(text[nextIndex])) {
      addPositionIssue(errors, type, `${marker} appears without a valid script target.`, original, index);
    }
  }
}

function isMarkdownWordUnderscore(text, index) {
  return /[A-Za-z0-9]/.test(text[index - 1] || "") && /[A-Za-z0-9]/.test(text[index + 1] || "");
}

function nextNonSpaceIndex(text, startIndex) {
  for (let index = startIndex; index < text.length; index += 1) {
    if (!/\s/.test(text[index])) {
      return index;
    }
    if (text[index] === "\n") {
      return -1;
    }
  }
  return -1;
}

function isInvalidScriptTarget(char) {
  return !char || "$&|,.;:!?)]}+-=<>".includes(char);
}

function validateFrac(text, original, errors) {
  const pattern = /\\frac\b/g;
  let match;
  while ((match = pattern.exec(text))) {
    const first = readBracedGroup(text, match.index + match[0].length);
    if (!first) {
      addPositionIssue(errors, "malformed_frac", "\\frac is missing its numerator group.", original, match.index);
      continue;
    }
    const second = readBracedGroup(text, first.nextIndex);
    if (!second) {
      addPositionIssue(errors, "malformed_frac", "\\frac is missing its denominator group.", original, match.index);
    }
  }
}

function validateSqrt(text, original, errors) {
  const pattern = /\\sqrt\b/g;
  let match;
  while ((match = pattern.exec(text))) {
    let index = skipSpaces(text, match.index + match[0].length);
    if (text[index] === "[") {
      index = skipOptionalBracket(text, index);
    }
    index = skipSpaces(text, index);
    if (index >= text.length || "$&|,.;:!?)]}\n".includes(text[index])) {
      addPositionIssue(errors, "malformed_sqrt", "\\sqrt is missing a radicand.", original, match.index);
    }
  }
}

function readBracedGroup(text, startIndex) {
  let index = skipSpaces(text, startIndex);
  if (text[index] !== "{") {
    return null;
  }
  let depth = 0;
  for (; index < text.length; index += 1) {
    if (text[index] === "{" && text[index - 1] !== "\\") {
      depth += 1;
    } else if (text[index] === "}" && text[index - 1] !== "\\") {
      depth -= 1;
      if (depth === 0) {
        return { nextIndex: index + 1 };
      }
    }
  }
  return null;
}

function skipOptionalBracket(text, startIndex) {
  let depth = 0;
  for (let index = startIndex; index < text.length; index += 1) {
    if (text[index] === "[" && text[index - 1] !== "\\") {
      depth += 1;
    } else if (text[index] === "]" && text[index - 1] !== "\\") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return text.length;
}

function skipSpaces(text, startIndex) {
  let index = startIndex;
  while (index < text.length && /[ \t]/.test(text[index])) {
    index += 1;
  }
  return index;
}

function addPositionIssue(collection, type, message, original, position) {
  collection.push(issue(type, message, position, lineNumber(original, position)));
}

function issue(type, message, position, line) {
  const item = { type, message };
  if (typeof position === "number") {
    item.position = position;
  }
  if (typeof line === "number") {
    item.line = line;
  }
  return item;
}

function lineNumber(text, position) {
  if (typeof position !== "number" || position < 0) {
    return undefined;
  }
  return String(text || "").slice(0, position).split("\n").length;
}

function uniqueIssues(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = `${item.type}:${item.position ?? ""}:${item.line ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(item);
  }
  return output;
}

module.exports = {
  validateRenderability,
};
