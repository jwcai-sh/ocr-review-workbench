const { OCR_BLOCK_TYPES } = require("./blockModel");
const { hashBbox, hashBlockText } = require("./blockHasher");

const DISPLAY_ENVIRONMENT_PATTERN = /\\begin\s*\{(?:equation\*?|align\*?|array|matrix|pmatrix|bmatrix|cases)\}/;

function inferBlockType(input) {
  const rawType = String(input?.rawType || "").toLowerCase();
  const text = String(input?.markdown ?? input?.text ?? "");
  const trimmed = text.trim();

  if (rawType.includes("table")) {
    return "table";
  }
  if (rawType.includes("figure") || rawType.includes("image")) {
    return "figure";
  }
  if (rawType.includes("caption")) {
    return "caption";
  }
  if (rawType.includes("code")) {
    return "code";
  }
  if (/^```/.test(trimmed)) {
    return "code";
  }
  if (hasMarkdownTable(text)) {
    return "table";
  }
  if (/^\$\$[\s\S]*\$\$$/.test(trimmed)) {
    return "display_math";
  }
  if (DISPLAY_ENVIRONMENT_PATTERN.test(text)) {
    return "display_math";
  }
  if (hasInlineMath(text)) {
    return "paragraph";
  }
  return trimmed ? "paragraph" : "unknown";
}

function parseMineruPageBlocks(input) {
  const pageNo = Number(input?.pageNo) || 0;
  const rawBlocks = Array.isArray(input?.blocks) ? input.blocks : [];
  const options = input?.options || {};
  const warnings = [];
  const errors = [];
  const blocks = [];

  rawBlocks.forEach((rawBlock, rawIndex) => {
    const blockIndex = rawIndex;
    const rawMarkdown = extractRawMarkdown(rawBlock);
    const bbox = normalizeBbox(rawBlock?.bbox);
    const rawType = String(rawBlock?.type ?? rawBlock?.block_type ?? "");
    const blockType = inferBlockType({
      rawType,
      markdown: rawMarkdown,
      text: rawMarkdown,
    });
    const isEmpty = rawMarkdown.trim() === "";

    if (isEmpty && bbox) {
      warnings.push({
        type: "empty_block_with_bbox",
        message: "MinerU block has a bbox but no extractable text.",
        blockIndex,
      });
    }
    if (!bbox) {
      warnings.push({
        type: "missing_bbox",
        message: "MinerU block is missing bbox information.",
        blockIndex,
      });
    }
    if (blockType === "unknown") {
      warnings.push({
        type: "unknown_block_type",
        message: "MinerU block type could not be inferred.",
        blockIndex,
      });
    }

    if (isEmpty && options.preserveEmptyBlocks !== true) {
      return;
    }

    const oldHash = hashBlockText(rawMarkdown);
    const bboxHash = hashBbox(bbox);
    blocks.push({
      blockId: createStableBlockId({
        bookId: options.bookId || options.pageId || "default",
        pageNo,
        blockIndex,
        blockType,
        rawMarkdown,
        bbox,
      }),
      pageNo,
      blockIndex,
      blockType,
      rawMarkdown,
      oldHash,
      ...(bbox ? { bbox } : {}),
      source: "mineru",
      riskFlags: [],
      metadata: {
        textLength: rawMarkdown.length,
        bboxHash,
        rawType,
        rawIndex,
      },
    });
  });

  return {
    pageNo,
    blocks,
    warnings,
    errors,
  };
}

function createStableBlockId(input) {
  const bookId = sanitizeIdPart(input?.bookId || "default");
  const pageNo = Number(input?.pageNo) || 0;
  const blockIndex = Number(input?.blockIndex) || 0;
  const blockType = OCR_BLOCK_TYPES.has(input?.blockType) ? input.blockType : "unknown";
  const bboxHash = hashBbox(input?.bbox);
  const textHashPrefix = hashBlockText(input?.rawMarkdown || "").slice(0, 12);
  return `blk_${bookId}_p${pageNo}_i${blockIndex}_${blockType}_${bboxHash}_${textHashPrefix}`;
}

function extractRawMarkdown(block) {
  for (const key of ["markdown", "text", "content", "html"]) {
    if (typeof block?.[key] === "string" && block[key].length > 0) {
      return normalizeNewlines(block[key]).trim();
    }
  }
  const spanText = extractSpansText(block?.spans);
  if (spanText) {
    return spanText;
  }
  const lineText = extractLinesText(block?.lines);
  if (lineText) {
    return lineText;
  }
  return "";
}

function extractLinesText(lines) {
  if (!Array.isArray(lines)) {
    return "";
  }
  return lines
    .map((line) => {
      if (typeof line === "string") {
        return line;
      }
      if (typeof line?.text === "string") {
        return line.text;
      }
      if (typeof line?.content === "string") {
        return line.content;
      }
      return extractSpansText(line?.spans);
    })
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

function extractSpansText(spans) {
  if (!Array.isArray(spans)) {
    return "";
  }
  return spans
    .map((span) => {
      if (typeof span === "string") {
        return span;
      }
      if (typeof span?.content === "string") {
        return span.content;
      }
      if (typeof span?.text === "string") {
        return span.text;
      }
      return "";
    })
    .join("")
    .trim();
}

function normalizeBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return undefined;
  }
  const values = bbox.map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) {
    return undefined;
  }
  return values;
}

function hasMarkdownTable(text) {
  return String(text || "")
    .split("\n")
    .some((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith("|") && trimmed.includes("|", 1);
    });
}

function hasInlineMath(text) {
  return /(^|[^$])\$[^$\n]+\$/.test(String(text || ""));
}

function normalizeNewlines(text) {
  return String(text || "").replace(/\r\n?/g, "\n");
}

function sanitizeIdPart(value) {
  return String(value || "default")
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "default";
}

module.exports = {
  createStableBlockId,
  inferBlockType,
  parseMineruPageBlocks,
};
