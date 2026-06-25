/**
 * @typedef {"mathpix" | "human" | "auto_normalizer"} OcrPatchSource
 */

/**
 * @typedef {"draft" | "accepted" | "rejected" | "conflict" | "noop"} OcrPatchStatus
 */

/**
 * @typedef {Object} OcrPatch
 * @property {string} patchId
 * @property {string} blockId
 * @property {string} oldHash
 * @property {string} newText
 * @property {OcrPatchSource} source
 * @property {OcrPatchStatus} status
 * @property {string} createdAt
 * @property {string=} updatedAt
 * @property {Object=} metadata
 * @property {number=} metadata.pageNo
 * @property {string=} metadata.reason
 * @property {string=} metadata.mathpixJobId
 * @property {string=} metadata.renderErrorBefore
 * @property {"ok" | "warning" | "error"=} metadata.renderStatusAfter
 */

const PATCH_SOURCES = new Set(["mathpix", "human", "auto_normalizer"]);
const PATCH_STATUSES = new Set(["draft", "accepted", "rejected", "conflict", "noop"]);
const DEFAULT_CREATED_AT = "1970-01-01T00:00:00.000Z";

function normalizePatchSource(source) {
  const value = String(source || "");
  if (!PATCH_SOURCES.has(value)) {
    throw new Error(`Unsupported OCR patch source: ${value || "(empty)"}`);
  }
  return value;
}

function normalizePatchStatus(status) {
  const value = String(status || "draft");
  if (!PATCH_STATUSES.has(value)) {
    throw new Error(`Unsupported OCR patch status: ${value || "(empty)"}`);
  }
  return value;
}

module.exports = {
  DEFAULT_CREATED_AT,
  PATCH_SOURCES,
  PATCH_STATUSES,
  normalizePatchSource,
  normalizePatchStatus,
};
