#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { hashBbox, hashBlockText } = require("../block/blockHasher");
const { createStableBlockId, inferBlockType, parseMineruPageBlocks } = require("../block/blockParser");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURE_DIR = path.join(ROOT, "frontend", "ocr-core", "fixtures", "block-parser");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function caseName(inputPath) {
  return path.basename(inputPath).replace(/\.input\.json$/, "");
}

function issueTypes(items) {
  return Array.from(new Set((items || []).map((item) => item.type))).sort();
}

function coreResult(result) {
  return {
    pageNo: result.pageNo,
    blocks: result.blocks.map((block) => ({
      blockIndex: block.blockIndex,
      blockType: block.blockType,
      rawMarkdown: block.rawMarkdown,
      oldHash: block.oldHash,
      blockId: block.blockId,
    })),
    warnings: issueTypes(result.warnings),
    errors: issueTypes(result.errors),
  };
}

function runFixtureTests() {
  const inputFiles = fs
    .readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".input.json"))
    .sort()
    .map((name) => path.join(FIXTURE_DIR, name));

  const failures = [];
  let passed = 0;

  for (const inputPath of inputFiles) {
    const name = caseName(inputPath);
    const expectedPath = inputPath.replace(/\.input\.json$/, ".expected.json");
    const input = readJson(inputPath);
    const expected = readJson(expectedPath);
    const actual = coreResult(parseMineruPageBlocks(input));

    try {
      assert.deepStrictEqual(actual, expected);
      passed += 1;
    } catch {
      failures.push({ name, actual, expected });
    }
  }

  if (failures.length) {
    console.error(`block parser fixtures failed: ${failures.length}/${inputFiles.length} failed`);
    for (const failure of failures) {
      console.error(`\n[case] ${failure.name}`);
      console.error("--- actual ---");
      console.error(JSON.stringify(failure.actual, null, 2));
      console.error("--- expected ---");
      console.error(JSON.stringify(failure.expected, null, 2));
    }
    console.error(`\npassed: ${passed}/${inputFiles.length}`);
    process.exitCode = 1;
    return false;
  }

  console.log(`block parser fixtures ok: ${passed}/${inputFiles.length} passed`);
  return true;
}

function runDirectUnitTests() {
  {
    assert.strictEqual(hashBlockText("same block"), hashBlockText("same block"));
  }

  {
    assert.strictEqual(hashBbox([10.001, 20.002, 30.003, 40.004]), hashBbox([10.004, 20.003, 30.002, 40.001]));
  }

  {
    const input = {
      bookId: "book one",
      pageNo: 1,
      blockIndex: 2,
      blockType: "paragraph",
      rawMarkdown: "Stable ID text.",
      bbox: [1, 2, 3, 4],
    };
    assert.strictEqual(createStableBlockId(input), createStableBlockId(input));
  }

  {
    const base = {
      bookId: "book one",
      pageNo: 1,
      blockIndex: 2,
      blockType: "paragraph",
      rawMarkdown: "Stable ID text.",
      bbox: [1, 2, 3, 4],
    };
    assert.notStrictEqual(createStableBlockId(base), createStableBlockId({ ...base, rawMarkdown: "Changed stable ID text." }));
  }

  {
    const base = {
      bookId: "book one",
      pageNo: 1,
      blockIndex: 2,
      blockType: "paragraph",
      rawMarkdown: "Stable ID text.",
      bbox: [1, 2, 3, 4],
    };
    assert.notStrictEqual(createStableBlockId(base), createStableBlockId({ ...base, bbox: [1, 2, 3, 5] }));
  }

  {
    assert.strictEqual(inferBlockType({ markdown: "$$\nF=ma\n$$" }), "display_math");
    assert.strictEqual(inferBlockType({ markdown: "| A | B |\n| --- | --- |" }), "table");
    assert.strictEqual(inferBlockType({ markdown: "```js\nconst x = 1;\n```" }), "code");
    assert.strictEqual(inferBlockType({ rawType: "page_figure" }), "figure");
    assert.strictEqual(inferBlockType({ rawType: "caption_text" }), "caption");
  }

  {
    const result = parseMineruPageBlocks({
      pageNo: 1,
      blocks: [{ type: "text", text: "", bbox: [1, 2, 3, 4] }],
    });
    assert.strictEqual(result.blocks.length, 0);
    assert(result.warnings.some((item) => item.type === "empty_block_with_bbox"));
  }

  {
    const result = parseMineruPageBlocks({
      pageNo: 1,
      blocks: [{ type: "text", text: "", bbox: [1, 2, 3, 4] }],
      options: { preserveEmptyBlocks: true },
    });
    assert.strictEqual(result.blocks.length, 1);
    assert.strictEqual(result.blocks[0].rawMarkdown, "");
    assert.strictEqual(result.blocks[0].blockType, "unknown");
  }

  console.log("block parser direct unit tests ok");
}

if (runFixtureTests()) {
  runDirectUnitTests();
}
