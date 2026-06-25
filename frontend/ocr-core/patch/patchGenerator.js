const { hashBlockText } = require("./blockHasher");
const { DEFAULT_CREATED_AT, normalizePatchSource, normalizePatchStatus } = require("./patchModel");

function createOcrPatch(input) {
  const blockId = String(input?.blockId || "");
  const oldText = String(input?.oldText || "").replace(/\r\n?/g, "\n");
  const newText = String(input?.newText || "").replace(/\r\n?/g, "\n");
  const source = normalizePatchSource(input?.source);
  const oldHash = hashBlockText(oldText);
  const newHash = hashBlockText(newText);
  const requestedStatus = normalizePatchStatus(input?.status || "draft");
  const status = oldText === newText ? "noop" : requestedStatus;
  const createdAt = String(input?.createdAt || DEFAULT_CREATED_AT);
  const patch = {
    patchId: stablePatchId(blockId, source, oldHash, newHash),
    blockId,
    oldHash,
    newText,
    source,
    status,
    createdAt,
  };

  if (input?.updatedAt) {
    patch.updatedAt = String(input.updatedAt);
  }
  if (input?.metadata && typeof input.metadata === "object") {
    patch.metadata = { ...input.metadata };
  }

  return patch;
}

function stablePatchId(blockId, source, oldHash, newHash) {
  return `patch_${sanitizePatchIdPart(blockId)}_${source}_${oldHash.slice(0, 12)}_${newHash.slice(0, 12)}`;
}

function sanitizePatchIdPart(value) {
  return String(value || "unknown")
    .replace(/[^A-Za-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

module.exports = {
  createOcrPatch,
};
