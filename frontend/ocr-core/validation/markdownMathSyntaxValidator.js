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

function validateMarkdownMathSyntax(input) {
  const blockId = String(input?.blockId || "");
  const markdown = String(input?.markdown || "").replace(/\r\n?/g, "\n");
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

  const environmentErrors = validateLatexEnvironments(scan.text);
  errors.push(...environmentErrors);
  warnings.push(...validateMarkdownTables(scan.text));

  return {
    blockId,
    ok: errors.length === 0,
    errors,
    warnings,
  };
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

  return {
    text: output.join("\n"),
    unclosedFence: inFence,
    unclosedFencePosition,
  };
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
    if (text[index] !== "$" || text[index - 1] === "\\") {
      continue;
    }
    if (text[index + 1] === "$" || text[index - 1] === "$") {
      continue;
    }
    if (isCurrencyDollar(text, index)) {
      continue;
    }
    positions.push(index);
  }
  return positions;
}

function isCurrencyDollar(text, index) {
  const after = text.slice(index + 1, index + 8);
  const before = text.slice(Math.max(0, index - 5), index);
  if (/^\s*\d/.test(after)) {
    return true;
  }
  return /(US|HK|SGD)\s*$/i.test(before) && /^\s*\d/.test(after);
}

function validateLatexEnvironments(text) {
  const errors = [];
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
      errors.push({
        type: "unbalanced_latex_environment",
        message: `Unexpected \\end{${env}}.`,
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
    const isTableLine = isMarkdownTableLine(line);
    if (!isTableLine) {
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
        position: lineOffset(lines, index),
      });
    }
  }
  return warnings;
}

function isMarkdownTableLine(line) {
  const trimmed = String(line || "").trim();
  return trimmed.startsWith("|") && trimmed.includes("|", 1);
}

function splitMarkdownTableRow(line) {
  const trimmed = String(line || "").trim();
  const body = trimmed.replace(/^\|/, "").replace(/\|$/, "");
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

function lineOffset(lines, lineIndex) {
  let offset = 0;
  for (let index = 0; index < lineIndex; index += 1) {
    offset += lines[index].length + 1;
  }
  return offset;
}

module.exports = {
  DISPLAY_ENVIRONMENTS,
  validateMarkdownMathSyntax,
};
