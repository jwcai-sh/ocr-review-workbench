#!/usr/bin/env node
const assert = require("assert");
const { hashBlockText } = require("../patch/blockHasher");
const { createOcrPatch } = require("../patch/patchGenerator");
const { detectPatchConflicts } = require("../patch/conflictDetector");

const CREATED_AT = "2026-06-19T00:00:00.000Z";

{
  assert.strictEqual(hashBlockText("same text"), hashBlockText("same text"));
}

{
  assert.notStrictEqual(hashBlockText("first text"), hashBlockText("second text"));
}

{
  const patch = createOcrPatch({
    blockId: "model:b0",
    oldText: "Mass relation E=mc2",
    newText: "Mass relation $E=mc^2$",
    source: "mathpix",
    createdAt: CREATED_AT,
  });
  assert.strictEqual(patch.status, "draft");
  assert.strictEqual(patch.oldHash, hashBlockText("Mass relation E=mc2"));
  assert.strictEqual(patch.createdAt, CREATED_AT);
}

{
  const patch = createOcrPatch({
    blockId: "model:b1",
    oldText: "Already valid $F=ma$",
    newText: "Already valid $F=ma$",
    source: "auto_normalizer",
    status: "accepted",
    createdAt: CREATED_AT,
  });
  assert.strictEqual(patch.status, "noop");
}

{
  const input = {
    blockId: "model:b2",
    oldText: "The distance modulus is m-M.",
    newText: "The distance modulus is $m-M$.",
    source: "human",
    status: "accepted",
    createdAt: CREATED_AT,
  };
  const first = createOcrPatch(input);
  const second = createOcrPatch(input);
  assert.strictEqual(first.patchId, second.patchId);
  assert.strictEqual(first.patchId, "patch_model:b2_human_ff179c84e957_a5eb6e05befe");
}

{
  const patches = [
    createOcrPatch({
      blockId: "conflict:draft",
      oldText: "z = lambda/lambda0 - 1",
      newText: "$z=\\lambda/\\lambda_0-1$",
      source: "mathpix",
      status: "draft",
      createdAt: CREATED_AT,
    }),
    createOcrPatch({
      blockId: "conflict:draft",
      oldText: "z = lambda/lambda0 - 1",
      newText: "$z=\\lambda_{obs}/\\lambda_0-1$",
      source: "human",
      status: "draft",
      createdAt: CREATED_AT,
    }),
  ];
  const result = detectPatchConflicts({ patches });
  assert.strictEqual(result.conflicts.length, 1);
  assert.strictEqual(result.conflicts[0].reason, "multiple_draft_patches_for_block");
}

{
  const patches = [
    createOcrPatch({
      blockId: "conflict:accepted",
      oldText: "rho = 3H2/8piG",
      newText: "$\\rho=3H^2/8\\pi G$",
      source: "mathpix",
      status: "accepted",
      createdAt: CREATED_AT,
    }),
    createOcrPatch({
      blockId: "conflict:accepted",
      oldText: "rho = 3H2/8piG",
      newText: "$\\rho_c=3H^2/(8\\pi G)$",
      source: "human",
      status: "accepted",
      createdAt: CREATED_AT,
    }),
  ];
  const result = detectPatchConflicts({ patches });
  assert.strictEqual(result.conflicts.length, 1);
  assert.strictEqual(result.conflicts[0].reason, "multiple_accepted_patches_for_block");
}

{
  const patches = [
    createOcrPatch({
      blockId: "conflict:ignored",
      oldText: "unchanged",
      newText: "rejected edit",
      source: "human",
      status: "rejected",
      createdAt: CREATED_AT,
    }),
    createOcrPatch({
      blockId: "conflict:ignored",
      oldText: "unchanged",
      newText: "unchanged",
      source: "auto_normalizer",
      status: "accepted",
      createdAt: CREATED_AT,
    }),
  ];
  const result = detectPatchConflicts({ patches });
  assert.strictEqual(result.conflicts.length, 0);
}

console.log("ocr patch model tests ok");
