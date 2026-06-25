const { hashBlockText } = require("./blockHasher");

function mergeAcceptedPatches(input) {
  const blocks = Array.isArray(input?.blocks) ? input.blocks : [];
  const patches = Array.isArray(input?.patches) ? input.patches : [];
  const acceptedByBlock = groupAcceptedPatches(patches);
  const errors = [];
  const warnings = [];
  const mergedBlocks = blocks.map((block) => ({
    blockId: String(block?.blockId || ""),
    text: String(block?.text || "").replace(/\r\n?/g, "\n"),
  }));
  const blockIndex = new Map(mergedBlocks.map((block, index) => [block.blockId, index]));

  for (const [blockId, blockPatches] of acceptedByBlock.entries()) {
    if (!blockIndex.has(blockId)) {
      warnings.push({
        blockId,
        type: "patch_block_not_found",
        message: "Accepted OCR patch points to a block that does not exist.",
      });
      continue;
    }

    if (blockPatches.length > 1) {
      errors.push({
        blockId,
        type: "multiple_accepted_patches_for_block",
        message: "Multiple accepted OCR patches target the same block.",
      });
      continue;
    }

    const patch = blockPatches[0];
    const target = mergedBlocks[blockIndex.get(blockId)];
    const currentHash = hashBlockText(target.text);
    if (currentHash !== patch.oldHash) {
      errors.push({
        blockId,
        type: "old_hash_mismatch",
        message: "Accepted OCR patch oldHash does not match the current block text.",
      });
      continue;
    }

    target.text = String(patch.newText || "").replace(/\r\n?/g, "\n");
  }

  return {
    mergedBlocks,
    errors,
    warnings,
  };
}

function groupAcceptedPatches(patches) {
  const groups = new Map();
  for (const patch of patches) {
    if (patch?.status !== "accepted") {
      continue;
    }
    const blockId = String(patch?.blockId || "");
    if (!groups.has(blockId)) {
      groups.set(blockId, []);
    }
    groups.get(blockId).push(patch);
  }
  return groups;
}

module.exports = {
  mergeAcceptedPatches,
};
