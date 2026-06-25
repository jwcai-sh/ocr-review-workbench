function detectPatchConflicts(input) {
  const patches = Array.isArray(input?.patches) ? input.patches : [];
  const conflicts = [];

  for (const status of ["draft", "accepted"]) {
    const groups = groupByBlockId(patches.filter((patch) => patch?.status === status));
    for (const [blockId, blockPatches] of groups.entries()) {
      if (blockPatches.length <= 1) {
        continue;
      }
      conflicts.push({
        blockId,
        patches: blockPatches.slice(),
        reason: status === "draft" ? "multiple_draft_patches_for_block" : "multiple_accepted_patches_for_block",
      });
    }
  }

  return { conflicts };
}

function groupByBlockId(patches) {
  const groups = new Map();
  for (const patch of patches) {
    const blockId = String(patch?.blockId || "");
    if (!groups.has(blockId)) {
      groups.set(blockId, []);
    }
    groups.get(blockId).push(patch);
  }
  return groups;
}

module.exports = {
  detectPatchConflicts,
};
