(function attachOcrCorePatch(root) {
  "use strict";

  const PATCH_SOURCES = new Set(["mathpix", "human", "auto_normalizer"]);
  const PATCH_STATUSES = new Set(["draft", "accepted", "rejected", "conflict", "noop"]);
  const DEFAULT_CREATED_AT = "1970-01-01T00:00:00.000Z";

  function hashBlockText(text) {
    return sha256Hex(String(text || "").replace(/\r\n?/g, "\n"));
  }

  function createOcrPatch(input) {
    const blockId = String(input && input.blockId || "");
    const oldText = String(input && input.oldText || "").replace(/\r\n?/g, "\n");
    const newText = String(input && input.newText || "").replace(/\r\n?/g, "\n");
    const source = normalizePatchSource(input && input.source);
    const oldHash = hashBlockText(oldText);
    const newHash = hashBlockText(newText);
    const requestedStatus = normalizePatchStatus(input && input.status || "draft");
    const status = oldText === newText ? "noop" : requestedStatus;
    const createdAt = String(input && input.createdAt || DEFAULT_CREATED_AT);
    const patch = {
      patchId: stablePatchId(blockId, source, oldHash, newHash),
      blockId,
      oldHash,
      newText,
      source,
      status,
      createdAt,
    };

    if (input && input.updatedAt) {
      patch.updatedAt = String(input.updatedAt);
    }
    if (input && input.metadata && typeof input.metadata === "object") {
      patch.metadata = { ...input.metadata };
    }

    return patch;
  }

  function detectPatchConflicts(input) {
    const patches = Array.isArray(input && input.patches) ? input.patches : [];
    const conflicts = [];

    for (const status of ["draft", "accepted"]) {
      const groups = groupByBlockId(patches.filter((patch) => patch && patch.status === status));
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

  function mergeAcceptedPatches(input) {
    const blocks = Array.isArray(input && input.blocks) ? input.blocks : [];
    const patches = Array.isArray(input && input.patches) ? input.patches : [];
    const acceptedByBlock = groupAcceptedPatches(patches);
    const errors = [];
    const warnings = [];
    const mergedBlocks = blocks.map((block) => ({
      blockId: String(block && block.blockId || ""),
      text: String(block && block.text || "").replace(/\r\n?/g, "\n"),
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

  function stablePatchId(blockId, source, oldHash, newHash) {
    return `patch_${sanitizePatchIdPart(blockId)}_${source}_${oldHash.slice(0, 12)}_${newHash.slice(0, 12)}`;
  }

  function sanitizePatchIdPart(value) {
    return String(value || "unknown")
      .replace(/[^A-Za-z0-9_.:-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "unknown";
  }

  function groupByBlockId(patches) {
    const groups = new Map();
    for (const patch of patches) {
      const blockId = String(patch && patch.blockId || "");
      if (!groups.has(blockId)) {
        groups.set(blockId, []);
      }
      groups.get(blockId).push(patch);
    }
    return groups;
  }

  function groupAcceptedPatches(patches) {
    const groups = new Map();
    for (const patch of patches) {
      if (!patch || patch.status !== "accepted") {
        continue;
      }
      const blockId = String(patch.blockId || "");
      if (!groups.has(blockId)) {
        groups.set(blockId, []);
      }
      groups.get(blockId).push(patch);
    }
    return groups;
  }

  // Browser-safe mirror of frontend/ocr-core/patch/*.js. The CommonJS modules
  // remain the source of truth for tests; this wrapper keeps direct script
  // loading on the same synchronous patch contract.
  function sha256Hex(text) {
    const bytes = utf8Bytes(text);
    const words = [];
    const bitLength = bytes.length * 8;

    for (let i = 0; i < bytes.length; i += 1) {
      words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    }
    words[bytes.length >> 2] |= 0x80 << (24 - (bytes.length % 4) * 8);
    words[((bytes.length + 8) >> 6 << 4) + 15] = bitLength;

    const constants = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
      0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
      0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
      0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
      0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
      0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;
    const w = new Array(64);

    for (let offset = 0; offset < words.length; offset += 16) {
      for (let i = 0; i < 16; i += 1) {
        w[i] = words[offset + i] || 0;
      }
      for (let i = 16; i < 64; i += 1) {
        const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }

      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;

      for (let i = 0; i < 64; i += 1) {
        const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + s1 + ch + constants[i] + w[i]) | 0;
        const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (s0 + maj) | 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) | 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) | 0;
      }

      h0 = (h0 + a) | 0;
      h1 = (h1 + b) | 0;
      h2 = (h2 + c) | 0;
      h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0;
      h5 = (h5 + f) | 0;
      h6 = (h6 + g) | 0;
      h7 = (h7 + h) | 0;
    }

    return [h0, h1, h2, h3, h4, h5, h6, h7]
      .map((value) => (value >>> 0).toString(16).padStart(8, "0"))
      .join("");
  }

  function rightRotate(value, bits) {
    return (value >>> bits) | (value << (32 - bits));
  }

  function utf8Bytes(text) {
    const bytes = [];
    for (let i = 0; i < text.length; i += 1) {
      let codePoint = text.charCodeAt(i);
      if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < text.length) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
          i += 1;
        }
      }

      if (codePoint < 0x80) {
        bytes.push(codePoint);
      } else if (codePoint < 0x800) {
        bytes.push(0xc0 | (codePoint >> 6));
        bytes.push(0x80 | (codePoint & 0x3f));
      } else if (codePoint < 0x10000) {
        bytes.push(0xe0 | (codePoint >> 12));
        bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
        bytes.push(0x80 | (codePoint & 0x3f));
      } else {
        bytes.push(0xf0 | (codePoint >> 18));
        bytes.push(0x80 | ((codePoint >> 12) & 0x3f));
        bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
        bytes.push(0x80 | (codePoint & 0x3f));
      }
    }
    return bytes;
  }

  root.OcrCorePatch = {
    hashBlockText,
    createOcrPatch,
    detectPatchConflicts,
    mergeAcceptedPatches,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
