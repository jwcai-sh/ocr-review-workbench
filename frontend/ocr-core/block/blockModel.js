/**
 * @typedef {"paragraph" | "display_math" | "inline_math" | "table" | "figure" | "caption" | "code" | "unknown"} OcrBlockType
 */

/**
 * @typedef {Object} OcrBlock
 * @property {string} blockId
 * @property {number} pageNo
 * @property {number} blockIndex
 * @property {OcrBlockType} blockType
 * @property {string} rawMarkdown
 * @property {string} oldHash
 * @property {[number, number, number, number]=} bbox
 * @property {"mineru"} source
 * @property {string[]} riskFlags
 * @property {Object=} metadata
 * @property {number=} metadata.textLength
 * @property {string=} metadata.bboxHash
 * @property {string=} metadata.rawType
 * @property {number=} metadata.rawIndex
 */

const OCR_BLOCK_TYPES = new Set([
  "paragraph",
  "display_math",
  "inline_math",
  "table",
  "figure",
  "caption",
  "code",
  "unknown",
]);

module.exports = {
  OCR_BLOCK_TYPES,
};
