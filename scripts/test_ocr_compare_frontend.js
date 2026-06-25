#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");

const source = fs
  .readFileSync("frontend/ocr-compare.js", "utf8")
  .replace(/\ninitialize\(\);\s*$/, "\n");
const patchBrowserSource = fs.readFileSync("frontend/ocr-core/patch/ocrPatch.browser.js", "utf8");
const ocrCompareHtml = fs.readFileSync("frontend/ocr-compare.html", "utf8");
const ocrCompareCss = fs.readFileSync("frontend/ocr-compare.css", "utf8");
const { hashBlockText: nodeHashBlockText } = require(path.resolve("frontend/ocr-core/patch/blockHasher"));
const { createOcrPatch: nodeCreateOcrPatch } = require(path.resolve("frontend/ocr-core/patch/patchGenerator"));

const context = {
  console,
  window: {
    __UMA_RUNTIME_CONFIG__: {},
    location: { protocol: "http:", port: "8787" },
    setTimeout() {},
  },
  document: {},
  navigator: {},
  Blob: function Blob() {},
  URL: { createObjectURL() { return ""; } },
  require: createRequire(path.resolve("frontend/ocr-compare.js")),
};

vm.createContext(context);
vm.runInContext(source, context);

function call(expression) {
  return vm.runInContext(expression, context);
}

function readStoredZipEntries(bytes) {
  const buffer = Buffer.from(bytes);
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    assert.strictEqual(method, 0, "test zip parser expects stored entries");
    entries.set(name, buffer.subarray(dataStart, dataEnd));
    offset = dataEnd;
  }
  return entries;
}

function createOcrCompareContext(extra = {}) {
  const testContext = {
    console,
    window: {
      __UMA_RUNTIME_CONFIG__: {},
      location: { protocol: "http:", port: "8787" },
      setTimeout() {},
    },
    document: {},
    navigator: {},
    Blob: function Blob() {},
    URL: { createObjectURL() { return ""; } },
    ...extra,
  };
  vm.createContext(testContext);
  return testContext;
}

function runOcrCompareInContext(testContext) {
  vm.runInContext(source, testContext);
  return testContext;
}

{
  assert.strictEqual(call("DEFAULT_PDF_IMAGE_ZOOM"), 1.25);
  assert(ocrCompareCss.includes(".review-navigation-bar"));
  assert(ocrCompareCss.includes(".review-font-nav-group"));
  assert(ocrCompareCss.includes("position: sticky"));
  assert(ocrCompareCss.includes(".control-column-pdf"));
  assert(ocrCompareCss.includes(".upload-button.primary-button"));
  assert(ocrCompareCss.includes(".accepted-top-actions"));
  assert(ocrCompareCss.includes(".accepted-action-button"));
  assert(ocrCompareCss.includes(".upload-icon svg"));
  assert(ocrCompareCss.includes(".right-workbench-card"));
  assert(ocrCompareCss.includes("height: calc(100vh - 52px)"));
  assert(ocrCompareCss.includes("grid-template-rows: auto minmax(0, 1fr);"));
  assert(ocrCompareCss.includes(".review-page-canvas"));
  assert(ocrCompareCss.includes("--review-font-scale"));
  assert(ocrCompareCss.includes(".math-display-equation-tag"));
  assert(ocrCompareCss.includes(".review-page-block.is-selected"));
  assert(ocrCompareCss.includes(".page-block-hotspot"));
  assert(ocrCompareCss.includes(".selected-block-toolbar"));
  assert(ocrCompareCss.includes(".block-step-button"));
  assert(ocrCompareCss.includes(".preview-panel"));
  assert(ocrCompareCss.includes(".page-list"));
  assert(ocrCompareCss.includes("overflow: visible"));
  assert(ocrCompareHtml.includes('id="contentListInput"'));
  assert(ocrCompareHtml.includes('id="pickContentListButton"'));
  assert(ocrCompareHtml.includes('class="control-column control-column-pdf"'));
  assert(ocrCompareHtml.includes("上传 PDF"));
  assert(ocrCompareHtml.includes("上传 middle.json"));
  assert(ocrCompareHtml.includes("上传 content_list (可选)"));
  assert(ocrCompareHtml.includes('id="previewAcceptedBookButton"'));
  assert(/id="previewAcceptedBookButton"[^>]*hidden/.test(ocrCompareHtml), "book preview button should stay hidden while it is not part of the main workflow");
  assert(ocrCompareHtml.includes('id="downloadAcceptedCorrectedButton"'));
  assert(ocrCompareHtml.includes("预览整书 accepted 校正稿"));
  assert(ocrCompareHtml.includes("下载 accepted 校正稿"));
  assert(ocrCompareHtml.includes('class="upload-icon"'));
  assert(ocrCompareHtml.includes('viewBox="0 0 24 24"'));
  assert(!ocrCompareHtml.includes("cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"), "MathJax CDN should be lazy-loaded by ocr-compare.js");
  assert(ocrCompareHtml.includes("<div>校对工作台</div>"));
  assert(!ocrCompareHtml.includes("导出原始 MinerU"));
  assert(!ocrCompareHtml.includes("中栏读取已有 MinerU"));
  assert(!source.includes('document.querySelector(".control-band")'), "upload controls should stay visible when the MinerU preview column is collapsed");
}

{
  const pickerResult = JSON.parse(
    call(`(() => {
      const input = {
        value: "/tmp/book.pdf",
        clickCount: 0,
        click() {
          this.clickCount += 1;
        }
      };
      return JSON.stringify({
        opened: openFilePicker(input),
        value: input.value,
        clickCount: input.clickCount,
        missing: openFilePicker(null)
      });
    })()`),
  );
  assert.strictEqual(pickerResult.opened, true);
  assert.strictEqual(pickerResult.value, "", "file input must reset so selecting the same file fires change again");
  assert.strictEqual(pickerResult.clickCount, 1);
  assert.strictEqual(pickerResult.missing, false);
  assert(source.includes('setStatus("读取 PDF", "busy", file.name);'));
  assert(source.includes('setStatus("渲染 PDF", "busy", file.name);'));
  assert(source.includes('setStatus("读取 MinerU", "busy", file.name);'));
  assert(source.includes('setStatus("读取 content_list", "busy", file.name);'));
}

{
  const mineruUploadSource = source.slice(
    source.indexOf("async function handleMineruChange"),
    source.indexOf("async function handleContentListChange"),
  );
  const contentListUploadSource = source.slice(
    source.indexOf("async function handleContentListChange"),
    source.indexOf("function resetPage"),
  );
  assert(mineruUploadSource.includes("analyzeCurrentMineruRiskPage();"));
  assert(mineruUploadSource.includes("scheduleMineruRiskAnalysis();"));
  assert(!mineruUploadSource.includes("analyzeMineruRiskPages();"), "MinerU upload must not synchronously scan the whole book");
  assert(contentListUploadSource.includes("analyzeCurrentMineruRiskPage();"));
  assert(contentListUploadSource.includes("scheduleMineruRiskAnalysis();"));
  assert(!contentListUploadSource.includes("analyzeMineruRiskPages();"), "content_list upload must not synchronously scan the whole book");
}

{
  const browserPatchContext = createOcrCompareContext();
  vm.runInContext(patchBrowserSource, browserPatchContext);
  assert.strictEqual(typeof browserPatchContext.OcrCorePatch.hashBlockText, "function");
  assert.strictEqual(typeof browserPatchContext.OcrCorePatch.createOcrPatch, "function");
  assert.strictEqual(typeof browserPatchContext.OcrCorePatch.detectPatchConflicts, "function");
  assert.strictEqual(typeof browserPatchContext.OcrCorePatch.mergeAcceptedPatches, "function");
  const sampleText = "Magnitude equation m-M=5log(d/10pc).\r\n中文 OCR";
  const patchInput = {
    blockId: "p2_b4_testhash",
    oldText: sampleText,
    newText: "Magnitude equation $m-M=5\\log_{10}(d/10\\mathrm{pc})$.\n中文 OCR",
    source: "human",
    status: "draft",
    metadata: { pageNo: 2, renderStatusAfter: "ok" },
  };
  assert.strictEqual(
    browserPatchContext.OcrCorePatch.hashBlockText(sampleText),
    nodeHashBlockText(sampleText),
    "browser wrapper hashBlockText should match the pure CommonJS module",
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(browserPatchContext.OcrCorePatch.createOcrPatch(patchInput))),
    nodeCreateOcrPatch(patchInput),
    "browser wrapper createOcrPatch should match the pure CommonJS module",
  );
}

const singleLineDisplay =
  "$$\\widehat {f}(x) = \\left\\{ \\begin{array}{ll}0, & 0 \\leq x < 1, \\\\ 1, & x \\geq 1. \\end{array} \\right.$$";
const singleLineHtml = call(
  `renderMarkdownHtml(normalizeMathMarkdown(${JSON.stringify(singleLineDisplay)}))`,
);
assert(singleLineHtml.includes('class="math-display"'), "single-line display math should render as display math");
assert(!singleLineHtml.includes("<p>$$"), "single-line display math should not render as raw paragraph text");
assert.strictEqual(call("rootHasMathContent({ textContent: 'plain OCR text' })"), false);
assert.strictEqual(call("rootHasMathContent({ textContent: 'formula $E=mc^2$' })"), true);

{
  const result = JSON.parse(
    call(`(() => {
      state.pageCache.clear();
      const cached = cachePreviewPage(1, {
        ok: true,
        pageCount: 12,
        pages: [{ pageNumber: 1, width: 100, height: 120, image: "data:image/png;base64,AAA" }]
      });
      return JSON.stringify({
        cachedResult: cached,
        cached: state.pageCache.has(1),
        cachedImage: state.pageCache.get(1)?.image || ""
      });
    })()`),
  );
  assert.strictEqual(result.cachedResult, true, "preview page cache helper should report success");
  assert.strictEqual(result.cached, true, "first PDF preview page should be cached for renderCurrentPage");
  assert.strictEqual(result.cachedImage, "data:image/png;base64,AAA");
}

{
  const result = JSON.parse(
    call(`(() => {
      const originalDetect = detectRiskCandidatesForPage;
      const calls = [];
      detectRiskCandidatesForPage = (pageNumber) => {
        calls.push(pageNumber);
        return [{ pageNumber, blockIndex: "0", text: "risk", score: 1, reasons: ["math"] }];
      };
      state.currentPage = 3;
      state.mineruInfo = { pdf_info: [{}, {}, {}, {}, {}] };
      state.riskByPage.clear();
      const risks = analyzeCurrentMineruRiskPage();
      const stored = state.riskByPage.has(3);
      detectRiskCandidatesForPage = originalDetect;
      return JSON.stringify({ calls, riskCount: risks.length, stored, riskPageCount: state.riskByPage.size });
    })()`),
  );
  assert.deepStrictEqual(result.calls, [3], "MinerU upload should analyze the current page first instead of scanning the whole book synchronously");
  assert.strictEqual(result.riskCount, 1);
  assert.strictEqual(result.stored, true);
  assert.strictEqual(result.riskPageCount, 1);
}

function prepareMathpix(markdown) {
  return call(`prepareMathpixMarkdown(${JSON.stringify(markdown)})`);
}

const fencedMarkdown = "```markdown\n$$\nE = mc^2\n$$\n```";
assert.strictEqual(
  prepareMathpix(fencedMarkdown),
  "$$\nE = mc^2\n$$",
  "prepareMathpixMarkdown should delegate fenced markdown cleanup to the adapter",
);

const fencedLatexAlign = "```latex\n\\begin{align}\na &= b+c\n\\end{align}\n```";
assert.strictEqual(
  prepareMathpix(fencedLatexAlign),
  `$$
\\begin{align}
a &= b+c
\\end{align}
$$`,
  "prepareMathpixMarkdown should wrap fenced latex align output as display math",
);

assert.strictEqual(
  prepareMathpix("\\[\nF = ma\n\\]"),
  "$$\nF = ma\n$$",
  "prepareMathpixMarkdown should convert bracket display math",
);

assert.strictEqual(
  prepareMathpix("The orbit satisfies \\(e<1\\) for an ellipse."),
  "The orbit satisfies $e<1$ for an ellipse.",
  "prepareMathpixMarkdown should convert paren inline math",
);

const bareArray = "\\begin{array}{cc}\na & b \\\\\nc & d\n\\end{array}";
assert.strictEqual(
  prepareMathpix(bareArray),
  `$$
\\begin{array}{cc}
a & b \\\\
c & d
\\end{array}
$$`,
  "prepareMathpixMarkdown should wrap bare array environments",
);

assert.strictEqual(
  prepareMathpix("$$\n$$\nE = mc^2\n$$\n$$"),
  "$$\nE = mc^2\n$$",
  "prepareMathpixMarkdown should collapse repeated display delimiters through the adapter",
);

const inlineOnly = prepareMathpix("The period is \\(P=2\\pi\\sqrt{a^3/GM}\\).");
assert.strictEqual(inlineOnly, "The period is $P=2\\pi\\sqrt{a^3/GM}$.");
assert(!inlineOnly.includes("$$"), "prepareMathpixMarkdown should not upgrade inline math to display math");

assert.strictEqual(
  prepareMathpix("The replacement CCD cost $100."),
  "The replacement CCD cost $100.",
  "prepareMathpixMarkdown should preserve currency-like dollar signs",
);

const mathpixTable = [
  "| Quantity | Formula |",
  "| --- | --- |",
  "| Einstein radius | \\(r_E=\\sqrt{4GM D/c^2}\\) |",
].join("\n");
const preparedTable = prepareMathpix(mathpixTable);
assert.strictEqual(
  preparedTable,
  [
    "| Quantity | Formula |",
    "| --- | --- |",
    "| Einstein radius | $r_E=\\sqrt{4GM D/c^2}$ |",
  ].join("\n"),
  "prepareMathpixMarkdown should preserve Markdown table structure",
);
assert(preparedTable.split("\n").every((line) => line.split("|").length === 4));

assert.strictEqual(prepareMathpix("   "), "", "prepareMathpixMarkdown should tolerate empty Mathpix output");

const latexTable = "\\begin{tabular}{cc}\na & b \\\\ c & d\n\\end{tabular}";
const bareTableHtml = call(`renderMarkdownHtml(normalizeMathMarkdown(${JSON.stringify(latexTable)}))`);
const wrappedTableHtml = call(`renderMarkdownHtml(normalizeMathMarkdown(${JSON.stringify(`$$\n${latexTable}\n$$`)}))`);
assert(bareTableHtml.includes("latex-table-wrap"), "bare LaTeX table should render as a table");
assert(wrappedTableHtml.includes("latex-table-wrap"), "display-wrapped LaTeX table should render as a table");

const latexArray = "\\begin{array}{cc}\na & b \\\\ c & d\n\\end{array}";
const arrayHtml = call(`renderMarkdownHtml(normalizeMathMarkdown(${JSON.stringify(latexArray)}))`);
assert(arrayHtml.includes('class="math-display"'), "bare array environments should render as display math");
const wrappedArrayHtml = call(`renderMarkdownHtml(normalizeMathMarkdown(${JSON.stringify(`$$\\n${latexArray}\\n$$`)}))`);
assert(wrappedArrayHtml.includes('class="math-display"'), "explicitly wrapped array should render as display math");

const explicitArrayFromBlock = call(`renderBlockContent(${JSON.stringify(`$$\\n\\begin{array}{cc}\\n a & b \\\\ c & d \\n\\end{array}\\n$$`)}, { blockIndex: "0", kind: "text" })`);
assert(explicitArrayFromBlock.includes('class="math-display"'), "array blocks from block content should render in page canvas");

function readFixture(name, kind) {
  return fs
    .readFileSync(`frontend/ocr-core/fixtures/math-delimiter/${name}.${kind}.md`, "utf8")
    .replace(/\r\n?/g, "\n")
    .trimEnd();
}

for (const fixtureName of [
  "extra_double_dollar",
  "missing_opening_dollar",
  "missing_closing_dollar",
  "inline_math_should_remain_inline",
  "markdown_table_with_formula",
  "code_block_should_not_change",
]) {
  const input = readFixture(fixtureName, "input");
  const expected = readFixture(fixtureName, "expected");
  const actual = call(`normalizeMathMarkdown(${JSON.stringify(input)})`).trimEnd();
  assert.strictEqual(actual, expected, `normalizeMathMarkdown wrapper should satisfy ${fixtureName}`);
}

function createDraftPatch(input) {
  return JSON.parse(
    call(`(() => {
      state.ocrPatches = [];
      const result = createAndStoreDraftOcrPatch(${JSON.stringify(input)});
      return JSON.stringify({
        patch: result.patch,
        normalizedText: result.normalizedText,
        renderSeverity: result.renderValidation.severity,
        patchCount: state.ocrPatches.length
      });
    })()`),
  );
}

function assertOcrPatchShape(patch) {
  assert.strictEqual(typeof patch.patchId, "string");
  assert(patch.patchId.startsWith("patch_"));
  assert.strictEqual(typeof patch.blockId, "string");
  assert.strictEqual(typeof patch.oldHash, "string");
  assert.strictEqual(patch.oldHash.length, 64);
  assert.strictEqual(typeof patch.newText, "string");
  assert.strictEqual(typeof patch.source, "string");
  assert.strictEqual(typeof patch.status, "string");
  assert.strictEqual(typeof patch.createdAt, "string");
  assert(patch.metadata && typeof patch.metadata.renderStatusAfter === "string");
}

{
  const oldText = "The OCR line reads E=mc2.";
  const result = createDraftPatch({
    pageNo: 7,
    blockIndex: "3",
    oldText,
    newText: "$$\nE=mc^2\n$$",
    source: "mathpix",
  });
  const contextJson = call(`JSON.stringify(createLegacyBlockPatchContext(7, "3", ${JSON.stringify(oldText)}))`);
  const legacyContext = JSON.parse(contextJson);
  assert.strictEqual(result.patchCount, 1);
  assertOcrPatchShape(result.patch);
  assert.strictEqual(result.patch.source, "mathpix");
  assert.strictEqual(result.patch.status, "draft");
  assert.strictEqual(result.patch.blockId, legacyContext.blockId);
  assert.strictEqual(result.patch.blockId, `p7_b3_${legacyContext.oldHash.slice(0, 8)}`);
  assert.strictEqual(result.patch.metadata.pageNo, 7);
  assert.strictEqual(result.patch.metadata.renderStatusAfter, "ok");
}

{
  const result = createDraftPatch({
    pageNo: 8,
    blockIndex: "2",
    oldText: "Magnitude equation m-M=5log(d/10pc).",
    newText: "Magnitude equation $m-M=5\\log_{10}(d/10\\mathrm{pc})$.",
    source: "human",
  });
  assert.strictEqual(result.patchCount, 1);
  assertOcrPatchShape(result.patch);
  assert.strictEqual(result.patch.source, "human");
  assert.strictEqual(result.patch.status, "draft");
  assert.strictEqual(result.patch.metadata.renderStatusAfter, "ok");
}

{
  const result = createDraftPatch({
    pageNo: 9,
    blockIndex: "1",
    oldText: "$$\nF=ma\n$$",
    newText: "$$\nF=ma\n$$",
    source: "human",
  });
  assert.strictEqual(result.patchCount, 1);
  assertOcrPatchShape(result.patch);
  assert.strictEqual(result.patch.status, "noop");
}

{
  const result = createDraftPatch({
    pageNo: 10,
    blockIndex: "4",
    oldText: "Broken aligned equation.",
    newText: "\\begin{align}\na&=b",
    source: "mathpix",
  });
  assert.strictEqual(result.patchCount, 1);
  assertOcrPatchShape(result.patch);
  assert.strictEqual(result.patch.source, "mathpix");
  assert.strictEqual(result.patch.status, "draft");
  assert.strictEqual(result.patch.metadata.renderStatusAfter, "error");
  assert.strictEqual(result.renderSeverity, "error");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.ocrPatches = [];
      const patchResult = createAndStoreDraftOcrPatch({
        pageNo: 16,
        blockIndex: "1",
        oldText: "The OCR line reads E=mc2.",
        newText: "$$\\nE=mc^2\\n$$",
        source: "mathpix"
      });
      const statusResult = updateOcrPatchStatus(patchResult.patch.patchId, "accepted");
      return JSON.stringify({
        ok: statusResult.ok,
        patch: statusResult.patch,
        storedPatch: state.ocrPatches[0],
        patchCount: state.ocrPatches.length
      });
    })()`),
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.patchCount, 1);
  assert.strictEqual(result.patch.source, "mathpix");
  assert.strictEqual(result.patch.status, "accepted");
  assert.strictEqual(result.storedPatch.status, "accepted");
  assert.strictEqual(typeof result.patch.updatedAt, "string");
  assert(!Number.isNaN(Date.parse(result.patch.updatedAt)), "accepted patch should receive updatedAt");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.ocrPatches = [];
      const first = createAndStoreDraftOcrPatch({
        pageNo: 17,
        blockIndex: "1",
        oldText: "First OCR line.",
        newText: "First corrected line.",
        source: "human"
      }).patch;
      const second = createAndStoreDraftOcrPatch({
        pageNo: 17,
        blockIndex: "2",
        oldText: "Second OCR line.",
        newText: "Second corrected line.",
        source: "human"
      }).patch;
      const statusResult = updateOcrPatchStatus(second.patchId, "rejected");
      return JSON.stringify({
        ok: statusResult.ok,
        first: state.ocrPatches[0],
        second: state.ocrPatches[1],
        firstPatchId: first.patchId,
        secondPatchId: second.patchId
      });
    })()`),
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.first.status, "draft");
  assert.strictEqual(result.second.status, "rejected");
  assert.strictEqual(result.first.patchId, result.firstPatchId);
  assert.strictEqual(result.second.patchId, result.secondPatchId);
  assert.strictEqual(typeof result.second.updatedAt, "string");
  assert.strictEqual(result.first.updatedAt, undefined);
}

{
  const result = JSON.parse(
    call(`(() => {
      state.ocrPatches = [];
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 18,
        blockIndex: "1",
        oldText: "$$\\nF=ma\\n$$",
        newText: "$$\\nF=ma\\n$$",
        source: "human"
      }).patch;
      const statusResult = updateOcrPatchStatus(patch.patchId, "accepted");
      return JSON.stringify({
        ok: statusResult.ok,
        reason: statusResult.reason,
        patch: state.ocrPatches[0]
      });
    })()`),
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "noop_not_transitionable");
  assert.strictEqual(result.patch.status, "noop");
  assert.strictEqual(result.patch.updatedAt, undefined);
}

{
  const result = JSON.parse(
    call(`(() => {
      state.ocrPatches = [];
      const preserved = createAndStoreDraftOcrPatch({
        pageNo: 21,
        blockIndex: "0",
        oldText: "Note that the transformation equations (2.60) resulted in unit coefficients.",
        newText: "Note that the transformation equations resulted in unit coefficients.",
        source: "human"
      });
      const alreadyPresent = createAndStoreDraftOcrPatch({
        pageNo: 21,
        blockIndex: "1",
        oldText: "The binding-energy expansion is Eq. (2.33).",
        newText: "The binding-energy expansion is Eq. (2.33).",
        source: "mathpix"
      });
      return JSON.stringify({ preserved, alreadyPresent, patches: state.ocrPatches });
    })()`),
  );
  assert(result.preserved.normalizedText.includes("(2.60)"), "missing equation number should be preserved from original block");
  assert.strictEqual((result.alreadyPresent.normalizedText.match(/\(2\.33\)/g) || []).length, 1, "existing equation number should not be duplicated");
  assert(result.patches[0].newText.includes("(2.60)"));
  assert.strictEqual((result.patches[1].newText.match(/\(2\.33\)/g) || []).length, 1);
}

{
  const warnings = [];
  const missingPatchContext = createOcrCompareContext({
    console: {
      warn(...args) {
        warnings.push(args.map(String).join(" "));
      },
    },
    require: createRequire(path.resolve("frontend/ocr-compare.js")),
  });
  runOcrCompareInContext(missingPatchContext);
  const result = JSON.parse(
    vm.runInContext(`JSON.stringify(updateOcrPatchStatus("missing-patch-id", "accepted"))`, missingPatchContext),
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "not_found");
  assert(warnings.some((warning) => warning.includes("missing-patch-id")), "missing patchId should warn without throwing");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.ocrPatches = [];
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            para_blocks: [
              { type: "text", lines: [{ spans: [{ content: "Original Export Line" }] }] }
            ]
          }
        ]
      };
      const beforeExport = buildBookMarkdown(true);
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Original Export Line",
        newText: "Accepted Patch Line",
        source: "mathpix"
      }).patch;
      const statusResult = updateOcrPatchStatus(patch.patchId, "accepted");
      const afterExport = buildBookMarkdown(true);
      return JSON.stringify({
        ok: statusResult.ok,
        beforeExport,
        afterExport,
        patches: state.ocrPatches
      });
    })()`),
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.beforeExport, result.afterExport);
  assert(!result.afterExport.includes("Accepted Patch Line"), "accepted patch should not alter corrected export yet");
  assert.strictEqual(result.patches[0].status, "accepted");
}

{
  const statusHtml = call(`(() => {
    state.ocrPatches = [];
    const patch = createAndStoreDraftOcrPatch({
      pageNo: 19,
      blockIndex: "3",
      oldText: "Flux relation.",
      newText: "$$\\nF=\\\\sigma T^4\\n$$",
      source: "mathpix"
    }).patch;
    const draftHtml = renderReviewItem(
      { blockIndex: "3", markdown: "Flux relation.", kind: "text" },
      { reasons: ["split_formula_tokens"], bbox: [0, 0, 10, 10] },
      "",
      false,
      "",
      patch
    );
    updateOcrPatchStatus(patch.patchId, "accepted");
    const acceptedHtml = renderReviewItem(
      { blockIndex: "3", markdown: "Flux relation.", kind: "text" },
      { reasons: ["split_formula_tokens"], bbox: [0, 0, 10, 10] },
      "",
      false,
      "",
      patch
    );
    const rejectedPatch = createAndStoreDraftOcrPatch({
      pageNo: 19,
      blockIndex: "4",
      oldText: "Rejected relation.",
      newText: "Rejected corrected relation.",
      source: "human"
    }).patch;
    updateOcrPatchStatus(rejectedPatch.patchId, "rejected");
    const noopPatch = createAndStoreDraftOcrPatch({
      pageNo: 19,
      blockIndex: "5",
      oldText: "$$\\nF=ma\\n$$",
      newText: "$$\\nF=ma\\n$$",
      source: "human"
    }).patch;
    return JSON.stringify({
      draftHtml,
      acceptedHtml,
      rejectedHtml: renderOcrPatchStatusControls(rejectedPatch),
      noopHtml: renderOcrPatchStatusControls(noopPatch)
    });
  })()`);
  const parsed = JSON.parse(statusHtml);
  assert(!parsed.draftHtml.includes("Patch：draft"));
  assert(!parsed.draftHtml.includes("data-ocr-patch-status-action=\"accepted\""));
  assert(!parsed.draftHtml.includes(">接受<"));
  assert(!parsed.draftHtml.includes(">拒绝<"));
  assert(parsed.draftHtml.includes("保持修改"), "draft edits should be accepted through the single save action");
  assert(!parsed.draftHtml.includes("确认 MinerU 有误后"));
  assert(!parsed.acceptedHtml.includes("Patch：accepted"));
  assert(!parsed.acceptedHtml.includes("已接受 patch"));
  assert(parsed.acceptedHtml.includes("已接受校正稿"));
  assert(parsed.acceptedHtml.includes("data-mathpix-edit=\"3\""));
  assert(parsed.acceptedHtml.includes("未修改"));
  assert(/data-apply-mathpix-block-edit="3"[^>]*data-disable-when-clean="1"[^>]*disabled/.test(parsed.acceptedHtml));
  assert(parsed.acceptedHtml.includes("F=\\sigma T^4"));
  assert(!parsed.acceptedHtml.includes("确认 MinerU 有误后"));
  assert(!parsed.acceptedHtml.includes("data-ocr-patch-status-action=\"accepted\""));
  assert.strictEqual(parsed.rejectedHtml, "");
  assert(!parsed.rejectedHtml.includes("data-ocr-patch-status-action=\"accepted\""));
  assert.strictEqual(parsed.noopHtml, "");
  assert(!parsed.noopHtml.includes("data-ocr-patch-status-action=\"accepted\""));
  const mathpixButtonSource = source.slice(
    source.indexOf('card.querySelectorAll("[data-risk-mathpix]")'),
    source.indexOf('card.querySelectorAll("[data-review-toggle]")'),
  );
  assert(mathpixButtonSource.includes("event.preventDefault();"), "Mathpix block button should consume the click event");
  assert(mathpixButtonSource.includes("runRiskBlockMathpixFromButton(button)"), "Mathpix block button should use the visible button feedback wrapper");
}

{
  const result = JSON.parse(
    call(`(() => {
      const statusBadge = { textContent: "", className: "", title: "" };
      els.statusBadge = statusBadge;
      state.busy = true;
      recognizeRiskBlockWithMathpix("0");
      const busyStatus = { text: statusBadge.textContent, className: statusBadge.className };
      state.busy = false;
      state.pdfDataUrl = "";
      recognizeRiskBlockWithMathpix("0");
      const missingPdfStatus = { text: statusBadge.textContent, className: statusBadge.className };
      return JSON.stringify({ busyStatus, missingPdfStatus });
    })()`),
  );
  assert.strictEqual(result.busyStatus.text, "正在处理");
  assert(result.busyStatus.className.includes("is-busy"));
  assert.strictEqual(result.missingPdfStatus.text, "先上传 PDF");
  assert(result.missingPdfStatus.className.includes("is-error"));
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression(["Original OCR block text"])}
      state.currentPage = 1;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.riskByPage.set(1, [{
        pageNumber: 1,
        blockIndex: "0",
        bbox: [0, 0, 10, 10],
        text: "Original OCR block text",
        reasons: ["split_formula_tokens"],
        score: 0.5
      }]);
      const oldAccepted = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Original OCR block text",
        newText: "Old accepted correction",
        source: "human"
      }).patch;
      updateOcrPatchStatus(oldAccepted.patchId, "accepted");
      const mathpixDraft = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Original OCR block text",
        newText: "Mathpix draft correction",
        source: "mathpix"
      }).patch;
      getMathpixBlockDrafts(1).set("0", "Mathpix draft correction");
      els.fileMeta = { textContent: "" };
      els.statusBadge = { textContent: "", className: "" };
      renderCurrentPage = async function noopRenderCurrentPage() {};
      const trigger = {
        closest() {
          return {
            querySelector() {
              return { value: "Edited Markdown accepted correction" };
            }
          };
        }
      };
      applyMathpixBlockEdit("0", trigger);
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify({
        patches: state.ocrPatches.map((patch) => ({
          patchId: patch.patchId,
          source: patch.source,
          status: patch.status,
          newText: patch.newText,
          replacedByPatchId: patch.metadata?.replacedByPatchId || ""
        })),
        draftExists: getMathpixBlockDrafts(1, false).has("0"),
        override: getBlockOverrides(1, false).get("0"),
        preview
      });
    })()`),
  );
  const humanAccepted = result.patches.find((patch) => patch.source === "human" && patch.newText === "Edited Markdown accepted correction");
  const oldAccepted = result.patches.find((patch) => patch.newText === "Old accepted correction");
  const mathpixDraft = result.patches.find((patch) => patch.source === "mathpix");
  assert(humanAccepted, "edited Markdown should create a human patch");
  assert.strictEqual(humanAccepted.status, "accepted");
  assert.strictEqual(oldAccepted.status, "rejected");
  assert.strictEqual(oldAccepted.replacedByPatchId, humanAccepted.patchId);
  assert.strictEqual(mathpixDraft.status, "rejected");
  assert.strictEqual(result.draftExists, false);
  assert.strictEqual(result.override, "Edited Markdown accepted correction");
  assert.strictEqual(result.preview.ok, true);
  assert.strictEqual(result.preview.appliedPatchCount, 1);
  assert(result.preview.markdown.includes("Edited Markdown accepted correction"));
  assert(!result.preview.markdown.includes("Old accepted correction"));
  assert(!result.preview.errors.some((error) => error.type === "multiple_accepted_patches_for_block"));
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression(["Original OCR block text"])}
      state.currentPage = 1;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      els.fileMeta = { textContent: "" };
      els.statusBadge = { textContent: "", className: "" };
      renderCurrentPage = async function noopRenderCurrentPage() {};
      const trigger = {
        closest() {
          return {
            querySelector() {
              return { value: "Manual MinerU source edit" };
            }
          };
        }
      };
      applyMineruSourceEdit("0", trigger);
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify({
        patches: state.ocrPatches.map((patch) => ({
          source: patch.source,
          status: patch.status,
          newText: patch.newText
        })),
        override: getBlockOverrides(1, false).get("0"),
        preview
      });
    })()`),
  );
  const humanAccepted = result.patches.find((patch) => patch.source === "human" && patch.newText === "Manual MinerU source edit");
  assert(humanAccepted, "editing MinerU source should create a human patch");
  assert.strictEqual(humanAccepted.status, "accepted");
  assert.strictEqual(result.override, "Manual MinerU source edit");
  assert.strictEqual(result.preview.appliedPatchCount, 1);
  assert(result.preview.markdown.includes("Manual MinerU source edit"));
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.contentListItems = [];
      state.contentListFileName = "";
      state.reviewExpanded.clear();
      state.reviewCorrectionOpen.clear();
      state.reviewNeedsCorrection.clear();
      state.riskByPage.clear();
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            para_blocks: [
              {
                type: "text",
                lines: [
                  { spans: [{ content: "The wavefunctions are" }] },
                  { spans: [{ content: "recombined, and compares that with the acceleration of a nearby" }] },
                  { spans: [{ content: "macroscopic object of" }] },
                  { spans: [{ content: "different composition." }] }
                ]
              }
            ]
          }
        ]
      };
      els.statusBadge = { textContent: "", className: "" };
      renderCurrentPage = async function noopRenderCurrentPage() {};
      const segment = reviewSegmentsForPage(1).find((item) => String(item.blockIndex) === "0");
      const sourceMarkdown = segment?.markdown || "";
      const unwrapped = autoUnwrapMineruLineBreaks(sourceMarkdown);
      const automaticCount = applyAutomaticLocalCorrectionsForPage(1);
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify({
        canAuto: canAutoUnwrapMineruLineBreaks(sourceMarkdown),
        mathBlocked: canAutoUnwrapMineruLineBreaks("Text\\n\\\\begin{aligned}\\nE &= mc^2\\n\\\\end{aligned}"),
        unwrapped,
        automaticCount,
        patches: state.ocrPatches.map((patch) => ({
          source: patch.source,
          status: patch.status,
          newText: patch.newText,
          autoCorrection: patch.metadata?.autoCorrection || ""
        })),
        override: getBlockOverrides(1, false).get("0"),
        preview
      });
    })()`),
  );
  assert.strictEqual(result.canAuto, true, "plain prose with hard line breaks should be eligible for local unwrap");
  assert.strictEqual(result.mathBlocked, false, "blocks with LaTeX environments should not be auto-unwrapped");
  assert.strictEqual(
    result.unwrapped,
    "The wavefunctions are recombined, and compares that with the acceleration of a nearby macroscopic object of different composition.",
    "local unwrap should merge MinerU artificial prose line breaks",
  );
  const humanAccepted = result.patches.find((patch) => patch.source === "human" && patch.status === "accepted");
  assert.strictEqual(result.automaticCount, 1, "automatic local cleanup should patch one eligible prose block");
  assert(humanAccepted, "automatic local cleanup should create an accepted human patch");
  assert.strictEqual(humanAccepted.autoCorrection, "plain_text_cleanup");
  assert.strictEqual(result.override, result.unwrapped);
  assert.strictEqual(result.preview.appliedPatchCount, 1);
  assert(result.preview.markdown.includes(result.unwrapped));
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression(["where$Z$and$A$are the atomic number and mass number, respectively, parameters$\\\\eta^A$by the best tests, where$\\\\delta=1$if$(Z,A)=(odd, even)."])}
      state.currentPage = 1;
      state.ocrPatches = [];
      state.mineruBlockOverrides.clear();
      const automaticCount = applyAutomaticLocalCorrectionsForPage(1);
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify({
        automaticCount,
        corrected: getBlockOverrides(1, false).get("0"),
        displayBlocked: canAutoCorrectPlainMineruMarkdown("Text\\n$$\\nE=mc^2\\n$$")
      });
    })()`),
  );
  assert.strictEqual(result.automaticCount, 1, "automatic cleanup should patch cramped inline math spacing");
  assert(result.corrected.includes("where $Z$ and $A$ are"), "inline math should have surrounding spaces");
  assert(result.corrected.includes("parameters $\\\\eta^A$ by the best tests"), "inline math should be spaced before and after adjacent prose");
  assert(result.corrected.includes("where $\\\\delta=1$ if $(Z,A)=(odd, even)."), "multiple inline math spans should be spaced without changing content");
  assert.strictEqual(result.displayBlocked, false, "display math blocks should not be auto-cleaned");
}

{
  const mixedInlineDisplaySource = "$$\nE=mc^2\n$$\nwhere$\\mathcal { G }$ = 1 and$\\zeta$[see Eq. (10.65)], and\nwhere$\\mathcal { H } = 1 - \\zeta [seeEq. (10.66)], and\n$$\n\\Psi = 2\n$$";
  const result = JSON.parse(
    call(`(() => {
      const source = ${JSON.stringify(mixedInlineDisplaySource)};
      return JSON.stringify({
        normalized: normalizeInlineMathSpacingOutsideDisplayMath(source),
        rendered: renderBlockContent(source, { kind: "text", blockIndex: "mixed-inline-display" })
      });
    })()`),
  );
  assert(result.normalized.includes("where $\\mathcal { G }$ = 1"), "inline math after display math should receive a leading space");
  assert(result.normalized.includes("and $\\zeta$ [see Eq. (10.65)]"), "inline math before bracketed prose should receive surrounding spaces");
  assert(result.normalized.includes("where $\\mathcal { H } = 1 - \\zeta$ [seeEq. (10.66)]"), "unclosed inline math before equation references should be repaired");
  assert(result.rendered.includes('class="math-display"'), "display math should still render as display math");
  assert(!result.rendered.includes("where$"), "rendered mixed blocks should not keep cramped inline math");
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression(["Assuming the$1\\\\sigma$bound of$\\\\eta$<2\\nfrom parameters$\\\\eta^A$by Table 2.1."])}
      state.currentPage = 1;
      state.ocrPatches = [];
      state.mineruBlockOverrides.clear();
      const oldText = reviewSegmentsForPage(1)[0].markdown;
      const oldContext = createLegacyBlockPatchContext(1, "0", oldText);
      const oldCleanup = {
        patchId: "old-auto-cleanup-spacing",
        blockId: oldContext.blockId,
        oldText,
        newText: "Assuming the$1\\\\sigma$bound of$\\\\eta$<2 from parameters$\\\\eta^A$by Table 2.1.",
        source: "human",
        status: "accepted",
        metadata: { pageNo: 1, autoCorrection: "plain_text_cleanup" }
      };
      state.ocrPatches.push(oldCleanup);
      getBlockOverrides(1).set("0", "Assuming the$1\\\\sigma$bound of$\\\\eta$<2 from parameters$\\\\eta^A$by Table 2.1.");
      const automaticCount = applyAutomaticLocalCorrectionsForPage(1);
      return JSON.stringify({
        automaticCount,
        corrected: getBlockOverrides(1, false).get("0"),
        oldPatchStatus: state.ocrPatches.find((patch) => patch.patchId === oldCleanup.patchId)?.status || ""
      });
    })()`),
  );
  assert.strictEqual(result.automaticCount, 1, "old automatic plain cleanup patches should be refreshable by newer spacing rules");
  assert.strictEqual(result.oldPatchStatus, "rejected", "refreshed automatic cleanup should replace the old accepted patch");
  assert(/the \$1\\sigma\$ bound/.test(result.corrected), "refreshed cleanup should add space around sigma inline math");
  assert(/of \$\\eta\$ <2/.test(result.corrected), "refreshed cleanup should add space before inline eta math");
  assert(/parameters \$\\eta\^A\$ by Table/.test(result.corrected), "refreshed cleanup should add space around eta superscript inline math");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.contentListItems = [];
      state.contentListFileName = "";
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            para_blocks: [
              {
                type: "interline_equation",
                bbox: [100, 240, 410, 280],
                lines: [{ spans: [{ content: "$$\\\\nE^S=-15.75A+17.8A^{2/3}\\\\n$$" }] }]
              },
              {
                type: "text",
                bbox: [500, 245, 545, 268],
                lines: [{ spans: [{ content: "(2.8)" }] }]
              }
            ],
            page_size: [600, 800]
          }
        ]
      };
      const automaticCount = applyAutomaticLocalCorrectionsForPage(1);
      const patch = state.ocrPatches.find((item) => item.metadata?.autoCorrection === "equation_number_preservation");
      return JSON.stringify({
        automaticCount,
        corrected: getBlockOverrides(1, false).get("0"),
        patchText: patch?.newText || "",
        preview: buildAcceptedPatchPreviewForPage(1)
      });
    })()`),
  );
  assert.strictEqual(result.automaticCount, 1, "display formula should get an automatic equation-number patch when a nearby number block exists");
  assert(/\\+tag\{2\.8\}/.test(result.corrected), "nearby equation number should be converted to a LaTeX tag");
  assert(/\\+tag\{2\.8\}/.test(result.patchText), "equation-number patch should store the tag");
  assert(/\\+tag\{2\.8\}/.test(result.preview.markdown), "accepted preview should include the preserved equation number tag");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.contentListItems = [];
      state.contentListFileName = "";
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            para_blocks: [
              {
                type: "interline_equation",
                bbox: [150, 300, 405, 340],
                lines: [{ spans: [{ content: "$$\\\\n\\\\frac{E^G}{mc^2} \\\\sim 10^{-39}A^{2/3}.\\\\n$$" }] }]
              },
              {
                type: "text",
                bbox: [40, 100, 200, 120],
                lines: [{ spans: [{ content: "Other prose" }] }]
              },
              {
                type: "text",
                bbox: [520, 307, 555, 330],
                lines: [{ spans: [{ content: "(2.10)" }] }]
              }
            ],
            page_size: [600, 800]
          }
        ]
      };
      const automaticCount = applyAutomaticLocalCorrectionsForPage(1);
      const html = renderPageReviewCanvas(reviewEntriesForCurrentPage());
      return JSON.stringify({
        automaticCount,
        corrected: getBlockOverrides(1, false).get("0"),
        html
      });
    })()`),
  );
  assert.strictEqual(result.automaticCount, 1, "display formula should get equation number from same-row bbox even when block index is not adjacent");
  assert(/\\+tag\{2\.10\}/.test(result.corrected), "same-row bbox equation number should be inserted as a LaTeX tag");
  assert(result.html.includes("(2.10)"), "same-row bbox equation number should render visibly");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.contentListItems = [];
      state.contentListFileName = "";
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            para_blocks: [
              {
                type: "interline_equation",
                bbox: [140, 260, 420, 300],
                lines: [{ spans: [{ content: "$$\\\\nE^{HF}=2.1\\\\times10^{-5}\\\\n$$" }] }]
              },
              {
                type: "text",
                bbox: [525, 267, 565, 290],
                lines: [{ spans: [{ content: "(2.11)" }] }]
              }
            ],
            page_size: [600, 800]
          }
        ]
      };
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: reviewSegmentsForPage(1)[0].markdown,
        newText: "$$\\\\nE^{HF}=2.1\\\\times10^{-5}\\\\n$$",
        source: "human"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify({
        storedPatchText: patch.newText,
        preview
      });
    })()`),
  );
  assert(!/\\+tag\{2\.11\}/.test(result.storedPatchText), "stored legacy accepted patch should remain unchanged");
  assert(/\\+tag\{2\.11\}/.test(result.preview.markdown), "accepted preview/download should preserve nearby equation numbers for legacy accepted patches");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.contentListItems = [];
      state.contentListFileName = "";
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            para_blocks: [
              {
                type: "text",
                bbox: [80, 120, 420, 160],
                lines: [{ spans: [{ content: "Accepted prose source" }] }]
              },
              {
                type: "interline_equation",
                bbox: [120, 260, 420, 310],
                lines: [{ spans: [{ content: "$$\\\\nE^S=-15.75A+17.8A^{2/3}\\\\n$$" }] }]
              },
              {
                type: "text",
                bbox: [525, 270, 565, 292],
                lines: [{ spans: [{ content: "(2.8)" }] }]
              }
            ],
            page_size: [600, 800]
          }
        ]
      };
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Accepted prose source",
        newText: "Accepted prose correction",
        source: "human"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify(preview);
    })()`),
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.appliedPatchCount, 1);
  assert(result.markdown.includes("Accepted prose correction"), "accepted patch should still apply when base formula blocks get numbering fallback");
  assert(/\\+tag\{2\.8\}/.test(result.markdown), "unpatched base formula blocks should preserve nearby original equation numbers in accepted preview/download");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.contentListItems = [
        { page_idx: 0, text: "(2.8)", bbox: [525, 270, 565, 292], page_size: [600, 800], __contentListIndex: 0 }
      ];
      state.contentListFileName = "content_list.json";
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            para_blocks: [
              {
                type: "text",
                bbox: [80, 120, 420, 160],
                lines: [{ spans: [{ content: "Accepted prose source" }] }]
              },
              {
                type: "interline_equation",
                bbox: [120, 260, 420, 310],
                lines: [{ spans: [{ content: "$$\\\\nE^S=-15.75A+17.8A^{2/3}\\\\n$$" }] }]
              }
            ],
            page_size: [600, 800]
          }
        ]
      };
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Accepted prose source",
        newText: "Accepted prose correction",
        source: "human"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify(preview);
    })()`),
  );
  assert.strictEqual(result.ok, true);
  assert(result.markdown.includes("Accepted prose correction"));
  assert(/\\+tag\{2\.8\}/.test(result.markdown), "accepted preview/download should use content_list bbox-only equation numbers");
  assert(!/\\+tag\{1\}/.test(result.markdown), "accepted preview/download should not preserve generated sequential equation numbers");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.contentListItems = [];
      state.contentListFileName = "";
      state.pdfFile = { name: "book.pdf", type: "application/pdf" };
      state.pdfDataUrl = "data:application/pdf;base64,FAKE";
      state.pdfTextPageCache.clear();
      state.pdfTextPageCache.set(1, {
        pageSize: [600, 800],
        textBlocks: [
          { text: "E ^ { \\\\mathrm { S } } = -15.75A + 11.18 \\\\delta / A^{1/2}, (2.8)", bbox: [310, 268, 565, 292] }
        ]
      });
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            para_blocks: [
              {
                type: "text",
                bbox: [80, 120, 420, 160],
                lines: [{ spans: [{ content: "Accepted prose source" }] }]
              },
              {
                type: "interline_equation",
                bbox: [120, 260, 420, 310],
                lines: [{ spans: [{ content: "$$\\\\nE^S=-15.75A+17.8A^{2/3}\\\\n$$" }] }]
              }
            ],
            page_size: [600, 800]
          }
        ]
      };
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Accepted prose source",
        newText: "Accepted prose correction",
        source: "human"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      const downloads = [];
      const originalDownloadTextFile = downloadTextFile;
      downloadTextFile = function captureDownload(filename, text) {
        downloads.push({ filename, text });
      };
      let downloadResult;
      try {
        downloadResult = downloadAcceptedCorrectedMarkdown();
      } finally {
        downloadTextFile = originalDownloadTextFile;
      }
      return JSON.stringify({
        preview: buildAcceptedPatchPreviewForPage(1),
        downloadResult,
        downloads
      });
    })()`),
  );
  assert.strictEqual(result.downloadResult.ok, true);
  assert.strictEqual(result.downloads.length, 1);
  assert(/\\+tag\{2\.8\}/.test(result.preview.markdown), "accepted preview should preserve equation numbers from the PDF text layer");
  assert(/\\+tag\{2\.8\}/.test(result.downloads[0].text), "downloaded accepted markdown should preserve equation numbers from the PDF text layer");
  assert(!/\\+tag\{1\}/.test(result.downloads[0].text), "downloaded accepted markdown should not keep generated sequential tags");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.contentListItems = [];
      state.contentListFileName = "";
      state.pdfTextPageCache.clear();
      state.pdfTextPageCache.set(1, {
        pageSize: [600, 800],
        textBlocks: [
          { text: "\\\\delta ^ A \\\\sim w^\\\\ell \\\\delta_0^A. (2.16)", bbox: [300, 245, 565, 282] }
        ]
      });
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            para_blocks: [
              {
                type: "interline_equation",
                bbox: [100, 240, 410, 280],
                lines: [{ spans: [{ content: "$$\\\\n\\\\delta^A \\\\sim w^\\\\ell \\\\delta^A_0.\\\\n$$" }] }]
              }
            ],
            page_size: [600, 800]
          }
        ]
      };
      const accepted = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: reviewSegmentsForPage(1)[0].markdown,
        newText: "$$\\\\n\\\\delta^A \\\\sim w^\\\\ell \\\\delta^A_0.\\\\n\\\\tag{1}\\\\n$$",
        source: "mathpix"
      }).patch;
      updateOcrPatchStatus(accepted.patchId, "accepted");
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify(preview);
    })()`),
  );
  assert(/\\+tag\{2\.16\}/.test(result.markdown), "generated sequential tags should be replaced by original PDF equation numbers");
  assert(!/\\+tag\{1\}/.test(result.markdown), "generated sequential tags should not remain in accepted preview/download");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.contentListItems = [];
      state.contentListFileName = "";
      state.pdfTextPageCache.clear();
      state.pdfTextPageCache.set(1, {
        pageSize: [600, 800],
        textBlocks: [
          { text: "\\\\delta ^ A \\\\sim w^\\\\ell \\\\delta_0^A. (2.16)", bbox: [300, 245, 565, 282] }
        ]
      });
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            para_blocks: [
              {
                type: "interline_equation",
                bbox: [100, 240, 410, 280],
                lines: [{ spans: [{ content: "$$\\\\n\\\\delta^A \\\\sim w^\\\\ell \\\\delta^A_0.\\\\n$$" }] }]
              }
            ],
            page_size: [600, 800]
          }
        ]
      };
      const accepted = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: reviewSegmentsForPage(1)[0].markdown,
        newText: "$$\\\\n\\\\delta^A \\\\sim w^\\\\ell \\\\delta^A_0.\\\\n$$",
        source: "mathpix"
      }).patch;
      updateOcrPatchStatus(accepted.patchId, "accepted");
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify(preview);
    })()`),
  );
  assert.strictEqual(result.ok, true, "formula accepted patch should not fail dry-run after equation-number fallback");
  assert(!result.errors.some((error) => error.type === "old_hash_mismatch"), "equation-number fallback must run after oldHash merge validation");
  assert(/\\+tag\{2\.16\}/.test(result.markdown), "accepted formula patches should still receive original PDF equation numbers after merge");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.contentListItems = [];
      state.contentListFileName = "";
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            para_blocks: [
              {
                type: "interline_equation",
                bbox: [100, 240, 410, 280],
                lines: [{ spans: [{ content: "$$\\\\n\\\\delta^A \\\\sim w^\\\\ell \\\\delta^A_0.\\\\n$$" }] }]
              },
              {
                type: "text",
                bbox: [500, 245, 545, 268],
                lines: [{ spans: [{ content: "(2.16)" }] }]
              }
            ],
            page_size: [600, 800]
          }
        ]
      };
      const accepted = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: reviewSegmentsForPage(1)[0].markdown,
        newText: "$$\\\\n\\\\delta^A \\\\sim w^\\\\ell \\\\delta^A_0.\\\\n$$",
        source: "mathpix"
      }).patch;
      updateOcrPatchStatus(accepted.patchId, "accepted");
      getBlockOverrides(1).set("0", "$$\\\\n\\\\delta^A \\\\sim w^\\\\ell \\\\delta^A_0.\\\\n$$");
      const automaticCount = applyAutomaticLocalCorrectionsForPage(1);
      const latestPatch = getLatestOcrPatchForBlock(1, "0", reviewSegmentsForPage(1)[0].markdown);
      return JSON.stringify({
        automaticCount,
        override: getBlockOverrides(1, false).get("0"),
        oldPatchStatus: state.ocrPatches.find((patch) => patch.patchId === accepted.patchId)?.status,
        latestPatchText: latestPatch?.newText || "",
        latestPatchSource: latestPatch?.source || "",
        latestPatchAutoCorrection: latestPatch?.metadata?.autoCorrection || "",
        preview: buildAcceptedPatchPreviewForPage(1)
      });
    })()`),
  );
  assert.strictEqual(result.automaticCount, 1, "existing accepted formula patches missing a number should receive a replacement numbering patch");
  assert.strictEqual(result.oldPatchStatus, "rejected", "old accepted formula patch should be rejected when a numbering patch replaces it");
  assert.strictEqual(result.latestPatchSource, "human");
  assert.strictEqual(result.latestPatchAutoCorrection, "equation_number_preservation");
  assert(/\\+tag\{2\.16\}/.test(result.override), "override should include the preserved equation number tag");
  assert(/\\+tag\{2\.16\}/.test(result.latestPatchText), "latest patch should include the preserved equation number tag");
  assert(/\\+tag\{2\.16\}/.test(result.preview.markdown), "accepted preview should include replacement equation number tag");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.contentListItems = [];
      state.contentListFileName = "";
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            para_blocks: [
              {
                type: "interline_equation",
                bbox: [100, 240, 410, 280],
                lines: [{ spans: [{ content: "$$\\\\nE^S=-15.75A+17.8A^{2/3}\\\\n$$" }] }]
              },
              {
                type: "text",
                bbox: [500, 245, 545, 268],
                lines: [{ spans: [{ content: "(2.8)" }] }]
              }
            ],
            page_size: [600, 800]
          }
        ]
      };
      getMathpixBlockDrafts(1).set("0", "$$\\\\nE^S=-15.75A+17.8A^{2/3}\\\\n$$");
      const automaticCount = applyAutomaticLocalCorrectionsForPage(1);
      const latestPatch = getLatestOcrPatchForBlock(1, "0", reviewSegmentsForPage(1)[0].markdown);
      const html = renderPageReviewCanvas(reviewEntriesForCurrentPage());
      return JSON.stringify({
        automaticCount,
        draftStillPresent: getMathpixBlockDrafts(1, false).has("0"),
        override: getBlockOverrides(1, false).get("0"),
        latestPatchStatus: latestPatch?.status || "",
        latestPatchAutoCorrection: latestPatch?.metadata?.autoCorrection || "",
        html
      });
    })()`),
  );
  assert.strictEqual(result.automaticCount, 1, "mathpix drafts missing an equation number should still receive a numbering patch");
  assert.strictEqual(result.latestPatchStatus, "accepted");
  assert.strictEqual(result.latestPatchAutoCorrection, "equation_number_preservation");
  assert(/\\+tag\{2\.8\}/.test(result.override), "mathpix draft numbering patch should include the missing equation number tag");
  assert(result.html.includes("math-display-equation-tag"), "mathpix draft numbering patch should render a visible equation number");
  assert(result.html.includes("(2.8)"), "mathpix draft numbering patch should show the equation number");
}

{
  const result = JSON.parse(
    call(`(() => {
      const button = {
        disabled: false,
        textContent: "",
        dataset: {
          disableWhenClean: "1",
          cleanLabel: "已保存",
          dirtyLabel: "保持修改"
        }
      };
      const container = {
        querySelector() {
          return button;
        }
      };
      const editor = {
        value: "Saved markdown",
        defaultValue: "Saved markdown",
        closest() {
          return container;
        }
      };
      const clean = updateReviewEditorActionState(editor);
      const cleanState = { clean, disabled: button.disabled, text: button.textContent };
      editor.value = "Edited markdown";
      const dirty = updateReviewEditorActionState(editor);
      return JSON.stringify({
        cleanState,
        dirtyState: { dirty, disabled: button.disabled, text: button.textContent }
      });
    })()`),
  );
  assert.strictEqual(result.cleanState.clean, false);
  assert.strictEqual(result.cleanState.disabled, true);
  assert.strictEqual(result.cleanState.text, "已保存");
  assert.strictEqual(result.dirtyState.dirty, true);
  assert.strictEqual(result.dirtyState.disabled, false);
  assert.strictEqual(result.dirtyState.text, "保持修改");
}

function setupPreviewPageExpression(blocks) {
  return `
    state.currentPage = 1;
    state.ocrPatches = [];
    state.acceptedPatchPreview = null;
    state.acceptedPatchBookPreview = null;
    state.contentListItems = [];
    state.contentListFileName = "";
    state.mineruOverrides.clear();
    state.mineruBlockOverrides.clear();
    state.mathpixBlockDrafts.clear();
    state.mineruInfo = {
      pdf_info: [
        {
          para_blocks: ${JSON.stringify(blocks)}.map((text) => ({
            type: "text",
            lines: [{ spans: [{ content: text }] }]
          }))
        }
      ]
    };
  `;
}

function setupPreviewBookExpression(pages) {
  return `
    state.currentPage = 1;
    state.ocrPatches = [];
    state.acceptedPatchPreview = null;
    state.acceptedPatchBookPreview = null;
    state.contentListItems = [];
    state.contentListFileName = "";
    state.mineruOverrides.clear();
    state.mineruBlockOverrides.clear();
    state.mathpixBlockDrafts.clear();
    state.mineruInfo = {
      pdf_info: ${JSON.stringify(pages)}.map((blocks) => ({
        para_blocks: blocks.map((text) => ({
          type: "text",
          lines: [{ spans: [{ content: text }] }]
        }))
      }))
    };
  `;
}

{
  const savedItems = new Map();
  const storage = {
    getItem(key) {
      return savedItems.has(key) ? savedItems.get(key) : null;
    },
    setItem(key, value) {
      savedItems.set(key, String(value));
    },
    removeItem(key) {
      savedItems.delete(key);
    },
  };
  const persistContext = runOcrCompareInContext(
    createOcrCompareContext({
      require: createRequire(path.resolve("frontend/ocr-compare.js")),
      localStorage: storage,
    }),
  );
  const result = JSON.parse(
    vm.runInContext(`(() => {
      state.mineruFileName = "persist_middle.json";
      state.pdfPageCount = 2;
      ${setupPreviewBookExpression([["Persistent original block"], ["Persistent second page"]])}
      state.mineruFileName = "persist_middle.json";
      state.pdfPageCount = 2;
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Persistent original block",
        newText: "Persistent accepted correction",
        source: "mathpix"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      getMathpixBlockDrafts(1).set("0", "Persistent Mathpix draft");
      getBlockOverrides(1).set("0", "Persistent block override");
      state.mineruOverrides.set(2, "Persistent whole-page override");
      state.mathpixCache.set(1, {
        markdown: "Persistent Mathpix markdown",
        editText: "Persistent edited Mathpix markdown",
        latencyMs: 88
      });
      const saveOk = saveOcrWorkspaceState();
      const key = ocrWorkspaceStorageKey();
      state.ocrPatches = [];
      state.mathpixBlockDrafts.clear();
      state.mineruBlockOverrides.clear();
      state.mineruOverrides.clear();
      state.mathpixCache.clear();
      const restored = restoreOcrWorkspaceState();
      const output = {
        saveOk,
        key,
        restored,
        patchStatus: state.ocrPatches[0]?.status,
        patchText: state.ocrPatches[0]?.newText,
        draft: getMathpixBlockDrafts(1, false).get("0"),
        blockOverride: getBlockOverrides(1, false).get("0"),
        pageOverride: state.mineruOverrides.get(2),
        mathpixEditText: state.mathpixCache.get(1)?.editText,
        storedPatchCount: state.ocrPatches.length
      };
      const clearOk = clearPersistedOcrWorkspaceState();
      output.clearOk = clearOk;
      return JSON.stringify(output);
    })()`, persistContext),
  );
  assert.strictEqual(result.saveOk, true);
  assert.strictEqual(result.restored, true);
  assert(result.key.includes("persist_middle.json"));
  assert.strictEqual(result.patchStatus, "accepted");
  assert.strictEqual(result.patchText, "Persistent accepted correction");
  assert.strictEqual(result.draft, "Persistent Mathpix draft");
  assert.strictEqual(result.blockOverride, "Persistent block override");
  assert.strictEqual(result.pageOverride, "Persistent whole-page override");
  assert.strictEqual(result.mathpixEditText, "Persistent edited Mathpix markdown");
  assert.strictEqual(result.storedPatchCount, 1);
  assert.strictEqual(result.clearOk, true);
  assert.strictEqual(savedItems.has(result.key), false);
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression([
        "Plain paragraph about the possible occurrence of EEP violations.",
        "$$\\nM_R = M_0 - c^{-2} E_B(X,V)\\n$$",
        "\\\\begin{array}{cc}\\nE_0 & E_1 \\\\\\\\ \\nV_0 & V_1\\n\\\\end{array}",
        "E_B(X,V)=E_B^0+\\\\delta m_P^{jk} U^{jk}(X)-\\\\frac{1}{2}\\\\delta m_I^{jk}V^jV^k"
      ])}
      const risks = detectRiskCandidatesForPage(1);
      return JSON.stringify(risks.map((risk) => ({
        blockIndex: risk.blockIndex,
        score: risk.score,
        reasons: risk.reasons,
        text: risk.text
      })));
    })()`),
  );
  assert(!result.some((risk) => risk.blockIndex === "0"), "plain prose should not be promoted only because nearby blocks have formulas");
  assert(result.some((risk) => risk.blockIndex === "1" && risk.reasons.includes("display_math_block")), "display math must enter third-column risk candidates");
  assert(result.some((risk) => risk.blockIndex === "2" && risk.reasons.includes("latex_math_environment")), "bare LaTeX math environments must enter third-column risk candidates");
  assert(result.some((risk) => risk.blockIndex === "3" && risk.reasons.includes("standalone_equation_line")), "standalone equation lines must enter third-column risk candidates");
}

{
  const result = JSON.parse(
    call(`JSON.stringify(scoreRiskBlock("M_R = M_0 - c^{-2} E_B(X,V),"))`),
  );
  assert(result.score >= 0.25);
  assert(result.reasons.includes("standalone_equation_line"));
  assert.strictEqual(call('riskReasonLabel("display_math_block")'), "独立公式");
  assert.strictEqual(call('riskReasonLabel("latex_math_environment")'), "LaTeX 公式环境");
  assert.strictEqual(call('riskReasonLabel("standalone_equation_line")'), "独立方程行");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.riskByPage.clear();
      state.contentListItems = normalizeContentListItems([
        {
          type: "discarded",
          page_idx: 5,
          bbox: [80, 80, 460, 150],
          text: "of Robert Dicke, we have come to view principles of equivalence, along with experiments"
        }
      ]);
      state.mineruInfo = {
        pdf_info: [
          {
            para_blocks: [
              { type: "title", lines: [{ spans: [{ content: "2.4 Ordinary Formalism" }] }] },
              { type: "title", lines: [{ spans: [{ content: "2.5 The TH#µ Formalism" }] }] }
            ]
          }
        ]
      };
      const risks = detectRiskCandidatesForPage(1);
      return JSON.stringify(risks.map((risk) => ({
        blockIndex: risk.blockIndex,
        reasons: risk.reasons,
        text: risk.text
      })));
    })()`),
  );
  assert(!result.some((risk) => risk.blockIndex === "0"), "ordinary MinerU title should not be promoted");
  assert(result.some((risk) => risk.blockIndex === "1" && risk.reasons.includes("heading_special_symbol")), "MinerU title with OCR-risk symbols should enter third-column candidates");
  assert(result.some((risk) => risk.text.includes("### 2.5 The TH#µ Formalism")));
  assert.strictEqual(call('riskReasonLabel("heading_special_symbol")'), "标题特殊符号");
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression([
        "Schiff’s conjecture is discussed in the surrounding prose without a special scientific glyph.",
        "This viewpoint is part of what has come to be known as the Dicke Framework, to be described in Section 2.1, allowing one to discuss the Eötvös experiment and tensor fields."
      ])}
      const risks = detectRiskCandidatesForPage(1);
      return JSON.stringify(risks.map((risk) => ({
        blockIndex: risk.blockIndex,
        reasons: risk.reasons,
        text: risk.text
      })));
    })()`),
  );
  assert(!result.some((risk) => risk.blockIndex === "0"), "ordinary apostrophes should not promote plain prose");
  assert(result.some((risk) => risk.blockIndex === "1" && risk.reasons.includes("scientific_special_symbol")), "scientific special letters such as Eötvös should enter third-column candidates");
  assert.strictEqual(call('riskReasonLabel("scientific_special_symbol")'), "科学特殊符号");
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression([
        "The principle can then be stated succinctly: for any body,1",
        "1 Although Newton asserted only that m_P and m_I be proportional to each other, they can be made equal by suitable choice of units."
      ])}
      const risks = detectRiskCandidatesForPage(1);
      return JSON.stringify(risks.map((risk) => ({
        blockIndex: risk.blockIndex,
        reasons: risk.reasons,
        text: risk.text
      })));
    })()`),
  );
  assert(result.some((risk) => risk.blockIndex === "0" && risk.reasons.includes("footnote_marker_or_note")), "inline footnote marker should enter third-column candidates");
  assert(result.some((risk) => risk.blockIndex === "1" && risk.reasons.includes("footnote_marker_or_note")), "footnote text should enter third-column candidates");
  assert.strictEqual(call('riskReasonLabel("footnote_marker_or_note")'), "脚注/注释");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.riskByPage.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            para_blocks: [
              {
                type: "text",
                lines: [{ spans: [{ content: "The principle can then be stated succinctly: for any body,1" }] }]
              },
              {
                type: "discarded",
                bbox: [200, 879, 911, 909],
                lines: [{ spans: [{ content: "1 Although Newton asserted only that m_P and m_I be proportional to each other, they can be made equal by suitable choice of units." }] }]
              }
            ]
          }
        ]
      };
      const risks = detectRiskCandidatesForPage(1);
      return JSON.stringify(risks.map((risk) => ({
        blockIndex: risk.blockIndex,
        reasons: risk.reasons,
        text: risk.text
      })));
    })()`),
  );
  assert(result.some((risk) => risk.blockIndex === "1" && risk.reasons.includes("footnote_marker_or_note")), "discarded MinerU footnote should still enter third-column candidates");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 5;
      state.ocrPatches = [];
      state.riskByPage.clear();
      state.contentListItems = normalizeContentListItems([
        {
          type: "text",
          page_idx: 4,
          bbox: [203, 236, 913, 459],
          text: "The Principle of Equivalence has played a central role in the development of gravitation theory."
        },
        {
          type: "discarded",
          page_idx: 4,
          bbox: [200, 879, 911, 909],
          text: "1 Although Newton asserted only that $m _ { \\\\mathrm { P } }$ and $m _ { \\\\mathrm { I } }$ be proportional to each other, they can be made equal by suitable choice of units."
        },
        {
          type: "discarded",
          page_idx: 4,
          bbox: [133, 912, 149, 925],
          text: "11 "
        },
        {
          type: "discarded",
          page_idx: 4,
          bbox: [88, 100, 911, 180],
          text: "2 The Einstein Equivalence Principle "
        }
      ]);
      state.mineruInfo = {
        pdf_info: [
          {}, {}, {}, {},
          {
            page_size: [510, 697],
            para_blocks: [
              { type: "text", bbox: [203, 236, 913, 459], lines: [{ spans: [{ content: "The Principle of Equivalence has played a central role in the development of gravitation theory." }] }] }
            ]
          }
        ]
      };
      const risks = detectRiskCandidatesForPage(5);
      const candidate = risks.find((risk) => risk.blockIndex === "content-list-discarded-5-1");
      let preview = null;
      if (candidate) {
        const patch = createAndStoreDraftOcrPatch({
          pageNo: 5,
          blockIndex: candidate.blockIndex,
          oldText: candidate.text,
          newText: "1 Although Newton asserted only that $m_P$ and $m_I$ are proportional, they can be made equal by suitable choice of units.",
          source: "human"
        }).patch;
        updateOcrPatchStatus(patch.patchId, "accepted");
        preview = buildAcceptedPatchPreviewForPage(5);
      }
      return JSON.stringify({
        risks: risks.map((risk) => ({
          blockIndex: risk.blockIndex,
          reasons: risk.reasons,
          syntheticLabel: risk.syntheticLabel,
          syntheticPlacement: risk.syntheticPlacement,
          text: risk.text
        })),
        candidate,
        preview
      });
    })()`),
  );
  assert(result.candidate, "content_list discarded footnote should become a third-column supplemental candidate");
  assert(result.candidate.reasons.includes("content_list_discarded"));
  assert(result.candidate.reasons.includes("footnote_marker_or_note"));
  assert(result.candidate.reasons.includes("page_bottom_boundary"));
  assert.strictEqual(result.candidate.syntheticLabel, "content_list 脚注候选");
  const titleCandidate = result.risks.find((risk) => risk.blockIndex === "content-list-discarded-5-3");
  assert(titleCandidate, "content_list top discarded title should become a title candidate");
  assert.strictEqual(titleCandidate.syntheticLabel, "content_list 标题候选");
  assert(titleCandidate.reasons.includes("background_heading_missing"));
  assert(!titleCandidate.reasons.includes("footnote_marker_or_note"), "content_list top title should not be mislabeled as a footnote");
  assert(!result.risks.some((risk) => risk.text.trim() === "11"), "content_list page-number-only discarded items should be skipped");
  assert.strictEqual(call('riskReasonLabel("content_list_discarded")'), "content_list 补充");
  assert.strictEqual(result.preview.ok, true);
  assert.strictEqual(result.preview.appliedPatchCount, 1);
  assert(result.preview.markdown.includes("m_P"));
  assert(result.preview.markdown.includes("The Principle of Equivalence"));
  assert(result.preview.markdown.indexOf("The Principle of Equivalence") < result.preview.markdown.indexOf("1 Although Newton asserted"), "page-bottom content_list footnote should remain after body text in accepted preview");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 2;
      state.contentListItems = normalizeContentListItems([
        {
          type: "discarded",
          page_idx: 1,
          bbox: [80, 100, 450, 180],
          text: "that bodies made of different material fall with the same acceleration. The theory must incorporate a complete set of electrodynamic and quantum mechanical laws"
        }
      ]);
      state.mineruInfo = {
        pdf_info: [
          {},
          {
            page_size: [510, 697],
            para_blocks: [
              {
                type: "text",
                bbox: [80, 100, 450, 230],
                lines: [
                  { spans: [{ content: "that bodies made of different material fall with the same acceleration. The theory must incorporate a complete set of electrodynamic and quantum mechanical laws, which can be used to calculate real bodies." }] }
                ]
              }
            ]
          }
        ]
      };
      const candidates = detectContentListRiskCandidatesForPage(2);
      return JSON.stringify({
        redundant: isTextRedundantWithNormalizedSet(
          "that bodies made of different material fall with the same acceleration. The theory must incorporate a complete set of electrodynamic and quantum mechanical laws",
          new Set(originalBlockMarkdownsForPage(2).map((entry) => normalizeTextForComparison(entry.markdown)))
        ),
        candidates
      });
    })()`),
  );
  assert.strictEqual(result.redundant, true);
  assert.strictEqual(result.candidates.length, 0, "content_list text already covered by MinerU should not create a duplicate review block");
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression([
        "The Eotv¨os experiment and the gravitational redshift experiment are used as probes of equivalence principles."
      ])}
      const risks = detectRiskCandidatesForPage(1);
      return JSON.stringify(risks.map((risk) => ({
        blockIndex: risk.blockIndex,
        reasons: risk.reasons,
        text: risk.text
      })));
    })()`),
  );
  assert(result.some((risk) => risk.blockIndex === "0" && risk.reasons.includes("scientific_special_symbol")), "broken diacritic OCR such as Eotv¨os should enter third-column candidates");
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression([
        "The Michelson-Morley (1887) experiment and its many descendants failed to find evidence at X-ray wavelengths.",
        "The Michelson-Morley (1\\\\$\\\\$7) experiment and its many descendents (Shankland et al., 1&55; Champeney et al., 1&6(; Jaseja et al., 1&6); Brillet and Hall, 1&7&; Riis et al., 1&\\\\$\\\\$; Krisher et al., 1&&0b) failed to +nd evidence.",
        "At the other extreme, a 1&6) experiment at CERN timed photons over a ,ight path of (0 meters and later con+rmed the e-ect."
      ])}
      const risks = detectRiskCandidatesForPage(1);
      return JSON.stringify(risks.map((risk) => ({
        blockIndex: risk.blockIndex,
        reasons: risk.reasons,
        text: risk.text
      })));
    })()`),
  );
  assert(!result.some((risk) => risk.blockIndex === "0"), "ordinary years and X-ray prose should not enter OCR-garbled candidates");
  assert(result.some((risk) => risk.blockIndex === "1" && risk.reasons.includes("ocr_garbled_text")), "garbled year-like OCR should enter third-column candidates");
  assert(result.some((risk) => risk.blockIndex === "2" && risk.reasons.includes("ocr_garbled_text")), "garbled prose OCR should enter third-column candidates");
  assert.strictEqual(call('riskReasonLabel("ocr_garbled_text")'), "疑似 OCR 字符乱码");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.riskByPage.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            page_size: [1000, 1200],
            para_blocks: [
              { type: "text", bbox: [120, 305, 900, 430], lines: [{ spans: [{ content: "The Principle of Equivalence has played a central role in the development of gravitation theory." }] }] }
            ]
          }
        ]
      };
      const risks = detectRiskCandidatesForPage(1);
      return JSON.stringify(risks.map((risk) => ({
        blockIndex: risk.blockIndex,
        bbox: risk.bbox,
        syntheticPlacement: risk.syntheticPlacement,
        reasons: risk.reasons,
        text: risk.text
      })));
    })()`),
  );
  const candidate = result.find((risk) => risk.blockIndex === "missing-heading-1");
  assert(candidate, "page with top background heading omitted by MinerU should get a synthetic title crop candidate");
  assert(candidate.reasons.includes("background_heading_missing"));
  assert.strictEqual(candidate.syntheticPlacement, "page_top");
  assert(Array.isArray(candidate.bbox) && candidate.bbox[3] > 0, "synthetic title candidate should include a crop bbox");
  assert.strictEqual(call('riskReasonLabel("background_heading_missing")'), "疑似漏识别标题");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.riskByPage.clear();
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.mineruInfo = {
        pdf_info: [
          {
            page_size: [1000, 1200],
            para_blocks: [
              { type: "text", bbox: [120, 520, 900, 690], lines: [{ spans: [{ content: "Einstein's generalization of the Weak Equivalence Principle may not have been a generalization at all." }] }] }
            ]
          }
        ]
      };
      const risks = detectRiskCandidatesForPage(1);
      const candidate = risks.find((risk) => risk.blockIndex === "missing-page-top-text-1");
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: candidate.blockIndex,
        oldText: candidate.text,
        newText: "of Robert Dicke, we have come to view principles of equivalence, along with experiments such as the Eötvös experiment.",
        source: "mathpix"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify({
        candidate,
        preview
      });
    })()`),
  );
  assert(result.candidate, "page top text gap should get a synthetic current-page OCR candidate");
  assert(result.candidate.reasons.includes("page_top_text_missing"));
  assert.strictEqual(result.candidate.syntheticLabel, "页首正文候选");
  assert.strictEqual(call('riskReasonLabel("page_top_text_missing")'), "疑似漏识别页首正文");
  assert.strictEqual(result.preview.ok, true);
  assert.strictEqual(result.preview.appliedPatchCount, 1);
  assert(result.preview.markdown.includes("of Robert Dicke, we have come to view principles of equivalence"));
  assert(result.preview.markdown.includes("Einstein's generalization of the Weak Equivalence Principle"));
  assert(!result.preview.warnings.some((warning) => warning.type === "patch_block_not_found"));
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.riskByPage.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            page_size: [1000, 1200],
            para_blocks: [
              { type: "title", bbox: [100, 80, 900, 150], lines: [{ spans: [{ content: "2 The Einstein Equivalence Principle" }] }] },
              { type: "text", bbox: [120, 305, 900, 430], lines: [{ spans: [{ content: "The Principle of Equivalence has played a central role in the development of gravitation theory." }] }] }
            ]
          }
        ]
      };
      return JSON.stringify(detectRiskCandidatesForPage(1).map((risk) => risk.blockIndex));
    })()`),
  );
  assert(!result.includes("missing-heading-1"), "existing top title should suppress the synthetic missing-title candidate");
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression([
        "This paragraph explains the qualitative consequences in ordinary prose without formula tokens.",
        "The rest mass $M_R$ is mentioned once in this sentence but the expression is otherwise ordinary.",
        "The possible occurrence of EEP violations arises when we write the rest mass $M_R$ in the form where $M_0$ is the sum of rest masses and $E_B(X,V)$ is the binding energy; the location and velocity dependence in $E_B$ is a result of the external gravitational environment.",
        "where M_R = M_0 - c^{-2}E_B(X,V), and E_B(X,V)=E_B^0+\\\\delta m_P^{jk}U^{jk}(X)-\\\\frac{1}{2}\\\\delta m_I^{jk}V^jV^k"
      ])}
      const risks = detectRiskCandidatesForPage(1);
      return JSON.stringify(risks.map((risk) => ({
        blockIndex: risk.blockIndex,
        reasons: risk.reasons,
        text: risk.text
      })));
    })()`),
  );
  assert(!result.some((risk) => risk.blockIndex === "0"), "ordinary prose should not be promoted by dense math rules");
  assert(!result.some((risk) => risk.blockIndex === "1"), "a single inline variable should not make a block high risk");
  assert(result.some((risk) => risk.blockIndex === "2" && risk.reasons.includes("math_dense_text")), "multiple inline math spans should enter third-column candidates");
  assert(result.some((risk) => risk.blockIndex === "3" && risk.reasons.includes("math_dense_text")), "formula-dense physics text without display delimiters should enter third-column candidates");
  assert.strictEqual(call('riskReasonLabel("math_dense_text")'), "公式密集段落");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 2;
      state.ocrPatches = [];
      state.riskByPage.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            page_size: [1000, 1200],
            para_blocks: [
              { type: "text", bbox: [100, 320, 900, 620], lines: [{ spans: [{ content: "The Eötvös experiment and tensor fields are discussed in the middle of the previous page." }] }] },
              { type: "text", bbox: [100, 1040, 900, 1160], lines: [{ spans: [{ content: "Plain previous page footer without risky notation." }] }] }
            ]
          },
          {
            page_size: [1000, 1200],
            para_blocks: [
              { type: "text", bbox: [100, 120, 900, 260], lines: [{ spans: [{ content: "of Robert Dicke, we have come to view principles of equivalence in this section." }] }] },
              { type: "title", bbox: [100, 870, 900, 930], lines: [{ spans: [{ content: "2.1 The Dicke Framework" }] }] },
              { type: "text", bbox: [100, 940, 900, 1130], lines: [{ spans: [{ content: "The Dicke Framework for analyzing experimental tests of gravitation was spelled out in appendix 4 of Dicke's lectures." }] }] }
            ]
          }
        ]
      };
      const risks = detectRiskCandidatesForPage(2);
      return JSON.stringify(risks.map((risk) => ({
        blockIndex: risk.blockIndex,
        sourceBlockIndex: risk.sourceBlockIndex,
        crossPageSourcePage: risk.crossPageSourcePage,
        crossPageHint: risk.crossPageHint,
        reasons: risk.reasons,
        text: risk.text
      })));
    })()`),
  );
  assert(!result.some((risk) => risk.crossPageSourcePage === 1 || risk.text.includes("middle of the previous page")), "previous-page middle content should not be injected into the current page");
  assert(result.some((risk) => risk.blockIndex === "1" && risk.reasons.includes("page_bottom_boundary")), "current-page bottom heading should enter third-column candidates");
  assert(result.some((risk) => risk.blockIndex === "2" && risk.reasons.includes("page_bottom_boundary")), "current-page bottom paragraph should enter third-column candidates");
  assert.strictEqual(call('riskReasonLabel("page_bottom_boundary")'), "页底待核查");
}

{
  const html = call(`(() => {
    state.currentPage = 2;
    state.pdfPageCount = 4;
    const risk = {
      blockIndex: "cross-previous_tail-1-1",
      sourceBlockIndex: "1",
      crossPageSourcePage: 1,
      crossPageHint: "previous_tail",
      crossPageLabel: "上一页候选 · 第 1 页",
      bbox: null,
      reasons: ["cross_page_previous_tail", "scientific_special_symbol"]
    };
    const segment = {
      blockIndex: risk.blockIndex,
      markdown: "The Eötvös experiment appears on the previous OCR page.",
      kind: "text"
    };
    return renderReviewItem(segment, risk, "", false, "", null);
  })()`);
  assert(html.includes("跨页候选"));
  assert(html.includes('data-cross-page-jump-page="1"'));
  assert(html.includes('data-cross-page-jump-block="1"'));
  assert(!html.includes("data-risk-mathpix"));
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 6;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.riskByPage.clear();
      state.mineruInfo = {
        pdf_info: [
          {}, {}, {}, {},
          {
            page_size: [510, 697],
            para_blocks: [
              {
                type: "text",
                bbox: [104, 577, 465, 602],
                lines: [
                  { bbox: [114, 576, 467, 590], spans: [{ bbox: [114, 576, 467, 590], content: "Yet, it was only in the 1960s that we gained a deeper understanding of the significance of" }] },
                  { bbox: [103, 589, 466, 603], spans: [{ bbox: [103, 589, 466, 603], content: "these principles of equivalence for gravitation and experiment. Largely through the work" }] },
                  { bbox: [104, 62, 466, 75], spans: [{ bbox: [104, 62, 466, 75], content: "of Robert Dicke, we have come to view principles of equivalence, along with experiments", cross_page: true }] },
                  { bbox: [105, 75, 467, 87], spans: [{ bbox: [105, 75, 467, 87], content: "such as the Eotv¨ os experiment and the gravitational redshift experiment, as probes more of", cross_page: true }] }
                ]
              }
            ]
          },
          {
            page_size: [510, 697],
            para_blocks: [
              { type: "text", bbox: [104, 62, 466, 216], lines: [], lines_deleted: true },
              { type: "text", bbox: [105, 218, 466, 333], lines: [{ spans: [{ content: "Einstein's generalization of the Weak Equivalence Principle may not have been a generalization at all." }] }] }
            ]
          }
        ]
      };
      const page5Review = reviewSegmentsForPage(5);
      const page5Original = pageSegmentsForPage(5);
      const page6Risks = detectRiskCandidatesForPage(6);
      const continuation = page6Risks.find((risk) => risk.blockIndex === "cross-page-continuation-6-0");
      const pageTopMissing = page6Risks.find((risk) => risk.blockIndex === "missing-page-top-text-6");
      const page6Entries = buildReviewEntriesForPage(page6Risks, reviewSegmentsForPage(6), 6);
      const patch5 = createAndStoreDraftOcrPatch({
        pageNo: 5,
        blockIndex: "0",
        oldText: page5Review[0].markdown,
        newText: "Yet, it was only in the 1960s that we gained a deeper understanding of these principles.",
        source: "human"
      }).patch;
      updateOcrPatchStatus(patch5.patchId, "accepted");
      const patch6 = createAndStoreDraftOcrPatch({
        pageNo: 6,
        blockIndex: continuation.blockIndex,
        oldText: continuation.text,
        newText: "of Robert Dicke, we have come to view principles of equivalence, along with experiments such as the Eotvos experiment.",
        source: "human"
      }).patch;
      updateOcrPatchStatus(patch6.patchId, "accepted");
      const preview5 = buildAcceptedPatchPreviewForPage(5);
      const preview6 = buildAcceptedPatchPreviewForPage(6);
      return JSON.stringify({
        page5ReviewMarkdown: page5Review[0].markdown,
        page5OriginalMarkdown: page5Original[0].markdown,
        continuation,
        pageTopMissing,
        page6EntryKeys: page6Entries.map((entry) => entry.key),
        page6DisplayIndexes: page6Entries.map((entry) => [entry.key, entry.displayIndex]),
        preview5,
        preview6,
        label: riskReasonLabel("cross_page_continuation")
      });
    })()`),
  );
  assert(result.page5OriginalMarkdown.includes("of Robert Dicke"), "raw MinerU block should still expose cross-page merged text");
  assert(!result.page5ReviewMarkdown.includes("of Robert Dicke"), "third-column page 5 Markdown should exclude next-page continuation lines");
  assert(result.page5ReviewMarkdown.includes("Largely through the work"));
  assert(result.continuation, "page 6 should recover previous-page cross_page lines as a top candidate");
  assert.strictEqual(result.continuation.syntheticLabel, "跨页续段候选");
  assert(result.continuation.reasons.includes("cross_page_continuation"));
  assert(result.continuation.text.includes("of Robert Dicke"));
  assert.deepStrictEqual(result.continuation.bbox, [104, 62, 467, 87]);
  assert.strictEqual(result.pageTopMissing, undefined, "real cross-page continuation should suppress generic missing-page-top candidate");
      assert(result.page6EntryKeys.includes("cross-page-continuation-6-0"), "third column should show recovered cross-page continuation");
      assert(!result.page6EntryKeys.some((key) => String(key).startsWith("content-list-discarded-6")), "page-top content_list candidate should not duplicate a real cross-page continuation");
      assert(result.page6EntryKeys.includes("1"), "third column should also show normal current-page text blocks");
  assert(!result.page6EntryKeys.includes("0"), "empty MinerU placeholders should not show as blank review cards");
      assert.deepStrictEqual(result.page6DisplayIndexes.map((entry) => entry[1]), [1, 2]);
  assert.strictEqual(result.page6DisplayIndexes.find((entry) => entry[0] === "cross-page-continuation-6-0")[1], 1);
  assert(result.page6DisplayIndexes.some((entry) => entry[0] === "1"), "normal current-page text should keep its sparse source id internally");
  assert.strictEqual(result.label, "跨页续段");
  assert.strictEqual(result.preview5.ok, true);
  assert(result.preview5.markdown.includes("these principles."));
  assert(!result.preview5.markdown.includes("of Robert Dicke"));
  assert.strictEqual(result.preview6.ok, true);
  assert(result.preview6.markdown.includes("of Robert Dicke"));
  assert(result.preview6.markdown.indexOf("of Robert Dicke") < result.preview6.markdown.indexOf("Einstein's generalization"));
}

{
  const navHtml = call(`(() => {
    state.currentPage = 2;
    state.pdfPageCount = 4;
    state.reviewFontScale = 1.2;
    state.riskByPage = new Map([[2, [{ blockIndex: "1", reasons: ["math"] }]]]);
    return renderReviewNavigationBar([
      { key: "1", displayIndex: 1, segment: { markdown: "Block source" }, risk: { blockIndex: "1", reasons: ["math"] } }
    ]);
  })()`);
  assert(navHtml.includes('data-page-nav="review-workbench"'));
  assert(navHtml.includes("review-font-nav-group"));
  assert(navHtml.includes('data-review-font-scale="out"'));
  assert(navHtml.includes('data-review-font-scale="in"'));
  assert(navHtml.includes("review-page-nav-group"));
  assert(navHtml.includes("块 1 / 1"));
  assert(!navHtml.includes("下一高风险页"));
  assert(!navHtml.includes("data-next-risk-page"));
}

{
  const result = JSON.parse(
    call(`(() => {
      state.reviewFontScale = 1;
      setReviewFontScale("in");
      const scaledHtml = renderPageReviewCanvas([
        { key: "0", displayIndex: 1, segment: { blockIndex: "0", markdown: "Scaled source", kind: "text" }, risk: { blockIndex: "0", reviewOnly: true } }
      ]);
      setReviewFontScale("out");
      const resetScale = currentReviewFontScale();
      return JSON.stringify({ scaledHtml, resetScale });
    })()`),
  );
  assert(result.scaledHtml.includes("--review-font-scale: 1.1"), "review page canvas should carry the current font scale");
  assert.strictEqual(result.resetScale, 1, "review font scale controls should step back down");
}

{
  const navHtml = call(`(() => {
    state.currentPage = 2;
    state.pdfPageCount = 4;
    return renderPageNavigator("review-workbench");
  })()`);
  assert(navHtml.includes('data-page-nav="review-workbench"'));
  assert(navHtml.includes('data-page-jump="first"'));
  assert(navHtml.includes('data-page-jump="prev"'));
  assert(navHtml.includes('data-page-jump="next"'));
  assert(navHtml.includes('data-page-jump="last"'));
  assert(navHtml.includes("⏮"));
  assert(navHtml.includes("⏭"));
}

{
  const result = JSON.parse(
    call(`(() => {
      const listeners = [];
      document = {
        createElement() {
          return {
            className: "",
            innerHTML: "",
            querySelectorAll() {
              return [
                {
                  dataset: { imageZoom: "out" },
                  addEventListener(type) {
                    listeners.push(type);
                  }
                },
                {
                  dataset: { imageZoom: "in" },
                  addEventListener(type) {
                    listeners.push(type);
                  }
                }
              ];
            },
            querySelector() {
              return {
                addEventListener(type) {
                  listeners.push(type);
                }
              };
            }
          };
        }
      };
      state.currentPage = 6;
      state.riskByPage.clear();
      state.mineruInfo = null;
      state.pdfImageZoom = 1;
      const normal = renderImageCard({ pageNumber: 6, image: "data:image/png;base64,abc", width: 919, height: 1256 });
      state.pdfImageZoom = 1.75;
      const zoomed = renderImageCard({ pageNumber: 6, image: "data:image/png;base64,abc", width: 919, height: 1256 });
      return JSON.stringify({
        normalClass: normal.className,
        zoomedClass: zoomed.className,
        normalHtml: normal.innerHTML,
        zoomedHtml: zoomed.innerHTML,
        listeners
      });
    })()`),
  );
  assert(result.normalHtml.includes('data-image-zoom="in"'));
  assert(result.normalHtml.includes('data-image-zoom="out"'));
  assert(!result.normalHtml.includes('data-page-nav="source-page"'));
  assert(!result.normalHtml.includes('data-page-jump="prev"'));
  assert(!result.normalHtml.includes('data-page-jump="next"'));
  assert(result.normalHtml.includes("image-zoom-glyph"));
  assert(result.normalHtml.includes("page-image-surface"));
  assert(result.normalHtml.includes("data-page-image-focus"));
  assert(!result.normalHtml.includes("image-zoom-label"));
  assert(!result.normalHtml.includes("125%"));
  assert(result.zoomedHtml.includes("--pdf-image-zoom: 1.75"));
  assert(!result.normalClass.includes("is-zoomed"));
  assert(result.zoomedClass.includes("is-zoomed"));
  assert(result.listeners.includes("click"));
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 6;
      state.reviewExpanded = new Set(["6:block-a"]);
      state.riskByPage = new Map([
        [6, [
          { blockIndex: "block-a", bbox: [100, 200, 300, 260], pageSize: [500, 1000] },
          { blockIndex: "block-b", bbox: [0, 0, 10, 10], pageSize: [500, 1000] }
        ]]
      ]);
      return JSON.stringify({
        percent: pdfFocusPercentForRisk(activeExpandedRiskForPage(6)),
        metrics: pdfFocusMetricsForRisk(activeExpandedRiskForPage(6), 1000, 2000),
        missing: pdfFocusMetricsForRisk({ bbox: null, pageSize: [500, 1000] }, 1000, 2000)
      });
    })()`),
  );
  assert.deepStrictEqual(result.percent, { left: 20, top: 20, width: 40, height: 6 });
  assert.deepStrictEqual(result.metrics, { left: 200, top: 400, width: 400, height: 120 });
  assert.strictEqual(result.missing, null);
}

{
  const result = JSON.parse(
    call(`(() => {
      const wrap = {
        clientHeight: 400,
        clientWidth: 600,
        scrollHeight: 1700,
        scrollWidth: 1250,
        scrollTo(options) {
          this.scrolled = options;
        }
      };
      const image = { clientWidth: 1250, clientHeight: 1700 };
      const focus = { hidden: true, style: {} };
      const ok = applyPdfFocusBox(wrap, image, focus, { bbox: [100, 200, 300, 260], pageSize: [500, 1000] });
      return JSON.stringify({ ok, hidden: focus.hidden, style: focus.style, scrolled: wrap.scrolled });
    })()`),
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.hidden, false);
  assert.strictEqual(result.style.left, "250px");
  assert.strictEqual(result.style.top, "340px");
  assert.strictEqual(result.style.width, "500px");
  assert.strictEqual(result.style.height, "102px");
  assert.strictEqual(result.scrolled.top, 191);
  assert.strictEqual(result.scrolled.left, 200);
}

{
  const result = JSON.parse(
    call(`(() => {
      const oldCanvas = {
        scrollTop: 100,
        scrollLeft: 7,
        getBoundingClientRect() {
          return { top: 10, bottom: 510 };
        }
      };
      const oldAnchor = {
        dataset: { reviewPageBlock: "5:3" },
        getBoundingClientRect() {
          return { top: 260, bottom: 300 };
        }
      };
      const current = {
        querySelector(selector) {
          return selector === ".review-page-canvas" ? oldCanvas : null;
        },
        querySelectorAll(selector) {
          return selector === "[data-review-page-block]" ? [oldAnchor] : [];
        }
      };
      const newCanvas = {
        scrollTop: 0,
        scrollLeft: 0,
        getBoundingClientRect() {
          return { top: 20, bottom: 520 };
        }
      };
      const newAnchor = {
        dataset: { reviewPageBlock: "5:3" },
        getBoundingClientRect() {
          return { top: 340, bottom: 380 };
        }
      };
      const next = {
        querySelector(selector) {
          return selector === ".review-page-canvas" ? newCanvas : null;
        },
        querySelectorAll(selector) {
          return selector === "[data-review-page-block]" ? [newAnchor] : [];
        }
      };
      const scrollState = captureRightWorkbenchScrollState(current, "5:3");
      const restored = restoreRightWorkbenchScrollState(next, scrollState);
      return JSON.stringify({ restored, scrollTop: newCanvas.scrollTop, scrollLeft: newCanvas.scrollLeft, anchorTop: scrollState.anchorTop });
    })()`),
  );
  assert.strictEqual(result.restored, true);
  assert.strictEqual(result.anchorTop, 250);
  assert.strictEqual(result.scrollTop, 170, "right workbench refresh should preserve the selected block visual offset");
  assert.strictEqual(result.scrollLeft, 7);
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 6;
      state.reviewExpanded = new Set(["6:0"]);
      state.riskByPage = new Map();
      state.mineruInfo = {
        pdf_info: [
          {}, {}, {}, {}, {},
          {
            page_size: [500, 1000],
            para_blocks: [
              {
                type: "text",
                bbox: [50, 100, 250, 200],
                lines: [
                  { bbox: [50, 100, 250, 200], spans: [{ bbox: [50, 100, 250, 200], content: "Normal paragraph for full-page review." }] }
                ]
              }
            ]
          }
        ]
      };
      const risk = activeExpandedRiskForPage(6);
      return JSON.stringify({
        risk,
        percent: pdfFocusPercentForRisk(risk)
      });
    })()`),
  );
  assert.strictEqual(result.risk.reviewOnly, true);
  assert(result.risk.text.includes("Normal paragraph"));
  assert.deepStrictEqual(result.percent, { left: 10, top: 10, width: 40, height: 10 });
}

{
  const result = JSON.parse(
    call(`JSON.stringify({
      numeric: normalizeCropPadding(10),
      axis: normalizeCropPadding({ horizontal: 4, vertical: 1 }),
      explicit: normalizeCropPadding({ left: 3, right: 5, top: 0, bottom: 2 })
    })`),
  );
  assert.deepStrictEqual(result.numeric, { left: 10, right: 10, top: 10, bottom: 10 });
  assert.deepStrictEqual(result.axis, { left: 4, right: 4, top: 1, bottom: 1 });
  assert.deepStrictEqual(result.explicit, { left: 3, right: 5, top: 0, bottom: 2 });
}

{
  const result = JSON.parse(
    call(`(() => {
      const entries = buildReviewEntriesForPage(
        [{ blockIndex: "7", bbox: [0, 0, 10, 10], text: "Risk 7", reasons: ["math_dense_text"] }],
        [
          { blockIndex: "3", markdown: "Visible block 3", bbox: [0, 0, 10, 10], pageSize: [100, 100] },
          { blockIndex: "4", markdown: "Visible block 4", bbox: [0, 10, 10, 20], pageSize: [100, 100] },
          { blockIndex: "7", markdown: "Visible block 7", bbox: [0, 20, 10, 30], pageSize: [100, 100] }
        ],
        1
      );
      const html = renderReviewItem(
        entries[2].segment,
        entries[2].risk,
        "",
        false,
        "",
        null,
        { displayIndex: entries[2].displayIndex }
      );
      return JSON.stringify({
        indexes: entries.map((entry) => [entry.key, entry.displayIndex]),
        html
      });
    })()`),
  );
  assert.deepStrictEqual(result.indexes, [["3", 1], ["4", 2], ["7", 3]]);
  assert(result.html.includes(">Block 3</strong>"), "visible review block numbering should be continuous");
  assert(result.html.includes('data-source-block-id="7"'), "source block id should remain available for patch traceability");
  assert(!result.html.includes(">Block 7</strong>"), "raw sparse MinerU block index should not be used as the visible title");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.reviewExpanded = new Set(["1:7"]);
      state.ocrPatches = [];
      const entries = buildReviewEntriesForPage(
        [{ blockIndex: "7", bbox: [0, 20, 10, 30], text: "Risk 7", reasons: ["math_dense_text"] }],
        [
          { blockIndex: "3", markdown: "Visible block 3", bbox: [0, 0, 10, 10], pageSize: [100, 100] },
          { blockIndex: "7", markdown: "Visible block 7 after local edit", bbox: [0, 20, 10, 30], pageSize: [100, 100] }
        ],
        1
      );
      createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "7",
        oldText: "Visible block 7",
        newText: "Corrected block 7",
        source: "mathpix"
      });
      const html = renderReviewNavigationBar(entries);
      return JSON.stringify({ html });
    })()`),
  );
  assert(result.html.includes("2 / 2"));
  assert(!result.html.includes("review-block-nav-patch"));
  assert(!result.html.includes('data-ocr-patch-status-action="accepted"'));
  assert(!result.html.includes('data-ocr-patch-status-action="rejected"'));
  assert(result.html.includes('data-review-block-step="prev"'));
  assert(result.html.includes("block-step-button"));
  assert(result.html.includes('data-review-block-select'));
  assert(result.html.includes('value="7" selected'));
  assert(result.html.includes("Block 2"));
}

{
  const mineruCardHtml = call(`(() => {
    ${setupPreviewPageExpression(["MinerU preview source"])}
    state.mineruFileName = "Theory and Experiment in Gravitational Physics long middle file name.json";
    document = {
      createElement() {
        return {
          className: "",
          innerHTML: "",
          querySelector() {
            return { addEventListener() {} };
          }
        };
      }
    };
    const card = renderMineruCard();
    return card.innerHTML;
  })()`);
  assert(!mineruCardHtml.includes("Theory and Experiment in Gravitational Physics long middle file name.json"));
  assert(mineruCardHtml.includes("当前 MinerU 识别结果"));
  assert(mineruCardHtml.includes('data-middle-column-toggle="collapse"'));
  assert(mineruCardHtml.includes("折叠中栏"));
}

{
  const result = JSON.parse(
    call(`(() => {
      let clicked = false;
      document = {
        querySelector() {
          return {
            classList: {
              toggle(className, enabled) {
                return { className, enabled };
              }
            }
          };
        },
        createElement() {
          return {
            className: "",
            type: "",
            dataset: {},
            attributes: {},
            innerHTML: "",
            setAttribute(key, value) {
              this.attributes[key] = value;
            },
            addEventListener(type, handler) {
              if (type === "click") {
                clicked = typeof handler === "function";
              }
            }
          };
        }
      };
      const rail = renderMiddleColumnRestoreRail();
      return JSON.stringify({
        className: rail.className,
        toggle: rail.dataset.middleColumnToggle,
        aria: rail.attributes["aria-label"],
        html: rail.innerHTML,
        clicked
      });
    })()`),
  );
  assert.strictEqual(result.className, "middle-column-restore");
  assert.strictEqual(result.toggle, "expand");
  assert.strictEqual(result.aria, "展开 MinerU 原始识别栏");
  assert(result.html.includes("MinerU"));
  assert(result.html.includes("展开"));
  assert.strictEqual(result.clicked, true);
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression(["Original spectrum line", "Original orbit line"])}
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify(preview);
    })()`),
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.appliedPatchCount, 0);
  assert(result.markdown.includes("Original spectrum line"));
  assert(result.warnings.some((warning) => warning.type === "no_accepted_patch"));
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression(["Original spectrum line", "Original orbit line"])}
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Original spectrum line",
        newText: "Accepted spectrum correction",
        source: "human"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify(preview);
    })()`),
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.appliedPatchCount, 1);
  assert(result.markdown.includes("Accepted spectrum correction"));
  assert(result.markdown.includes("Original orbit line"));
  assert(!result.markdown.includes("Original spectrum line"));
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression(["Draft base", "Rejected base", "Noop base"])}
      createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Draft base",
        newText: "Draft correction should not preview",
        source: "mathpix"
      });
      const rejected = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "1",
        oldText: "Rejected base",
        newText: "Rejected correction should not preview",
        source: "human"
      }).patch;
      updateOcrPatchStatus(rejected.patchId, "rejected");
      createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "2",
        oldText: "Noop base",
        newText: "Noop base",
        source: "human"
      });
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify(preview);
    })()`),
  );
  assert.strictEqual(result.appliedPatchCount, 0);
  assert(result.markdown.includes("Draft base"));
  assert(result.markdown.includes("Rejected base"));
  assert(result.markdown.includes("Noop base"));
  assert(!result.markdown.includes("Draft correction should not preview"));
  assert(!result.markdown.includes("Rejected correction should not preview"));
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression(["Hash guarded source"])}
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Hash guarded source",
        newText: "Should not overwrite on mismatch",
        source: "mathpix"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      patch.oldHash = "0".repeat(64);
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify(preview);
    })()`),
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.appliedPatchCount, 0);
  assert(result.errors.some((error) => error.type === "old_hash_mismatch"));
  assert(result.markdown.includes("Hash guarded source"));
  assert(!result.markdown.includes("Should not overwrite on mismatch"));
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["Current source text"]])}
      state.ocrPatches = [];
      const stale = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Old source text",
        newText: "Stale accepted correction",
        source: "human"
      }).patch;
      updateOcrPatchStatus(stale.patchId, "accepted");
      const current = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Current source text",
        newText: "Current accepted correction",
        source: "human"
      }).patch;
      updateOcrPatchStatus(current.patchId, "accepted");
      const preview = buildAcceptedPatchPreviewForBook();
      return JSON.stringify({
        preview,
        staleStatus: state.ocrPatches.find((patch) => patch.patchId === stale.patchId)?.status || ""
      });
    })()`),
  );
  assert.strictEqual(result.staleStatus, "accepted", "legacy workspaces may still contain stale accepted patches");
  assert.strictEqual(result.preview.ok, true);
  assert.strictEqual(result.preview.appliedPatchCount, 1);
  assert(!result.preview.errors.some((error) => error.type === "old_hash_mismatch"), "book preview should ignore stale same-block accepted patches");
  assert(result.preview.markdown.includes("Current accepted correction"));
  assert(!result.preview.markdown.includes("Stale accepted correction"));
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression(["Only existing block"])}
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "99",
        oldText: "Missing block",
        newText: "Missing block correction",
        source: "mathpix"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify(preview);
    })()`),
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.appliedPatchCount, 0);
  assert(result.warnings.some((warning) => warning.type === "patch_block_not_found"));
  assert(result.markdown.includes("Only existing block"));
  assert(!result.markdown.includes("Missing block correction"));
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression(["State source"])}
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "State source",
        newText: "State preview correction",
        source: "human"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      getBlockOverrides(1).set("0", "Existing override stays");
      const beforePatches = JSON.stringify(state.ocrPatches);
      const beforeOverrides = JSON.stringify(Array.from(getBlockOverrides(1).entries()));
      const preview = buildAcceptedPatchPreviewForPage(1);
      const afterPatches = JSON.stringify(state.ocrPatches);
      const afterOverrides = JSON.stringify(Array.from(getBlockOverrides(1).entries()));
      return JSON.stringify({ preview, beforePatches, afterPatches, beforeOverrides, afterOverrides });
    })()`),
  );
  assert.strictEqual(result.preview.appliedPatchCount, 1);
  assert.strictEqual(result.beforePatches, result.afterPatches);
  assert.strictEqual(result.beforeOverrides, result.afterOverrides);
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression(["Export guard source"])}
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Export guard source",
        newText: "Dry run only correction",
        source: "human"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      const originalBuildBookMarkdown = buildBookMarkdown;
      let buildCalled = 0;
      buildBookMarkdown = function buildBookMarkdownProbe() {
        buildCalled += 1;
        throw new Error("formal export should not be called by dry-run preview");
      };
      let preview;
      try {
        preview = buildAcceptedPatchPreviewForPage(1);
      } finally {
        buildBookMarkdown = originalBuildBookMarkdown;
      }
      return JSON.stringify({ preview, buildCalled });
    })()`),
  );
  assert.strictEqual(result.buildCalled, 0);
  assert.strictEqual(result.preview.appliedPatchCount, 1);
  assert(result.preview.markdown.includes("Dry run only correction"));
}

{
  const unavailableContext = createOcrCompareContext();
  runOcrCompareInContext(unavailableContext);
  const result = JSON.parse(
    vm.runInContext(`(() => {
      state.currentPage = 1;
      state.mineruInfo = {
        pdf_info: [
          { para_blocks: [{ type: "text", lines: [{ spans: [{ content: "Fallback source" }] }] }] }
        ]
      };
      return JSON.stringify(buildAcceptedPatchPreviewForPage(1));
    })()`, unavailableContext),
  );
  assert.strictEqual(result.ok, false);
  assert(result.warnings.some((warning) => warning.type === "patch_tool_unavailable"));
  assert(result.markdown.includes("Fallback source"));
}

{
  const unavailableContext = createOcrCompareContext();
  runOcrCompareInContext(unavailableContext);
  const result = JSON.parse(
    vm.runInContext(`(() => {
      state.currentPage = 1;
      state.mineruInfo = {
        pdf_info: [
          { para_blocks: [{ type: "text", lines: [{ spans: [{ content: "Book fallback page 1" }] }] }] },
          { para_blocks: [{ type: "text", lines: [{ spans: [{ content: "Book fallback page 2" }] }] }] }
        ]
      };
      return JSON.stringify(buildAcceptedPatchPreviewForBook());
    })()`, unavailableContext),
  );
  assert.strictEqual(result.ok, false);
  assert(result.warnings.some((warning) => warning.type === "patch_tool_unavailable"));
  assert(result.markdown.includes("Book fallback page 1"));
  assert(result.markdown.includes("Book fallback page 2"));
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["Book page 1 source"], ["Book page 2 source"]])}
      const preview = buildAcceptedPatchPreviewForBook();
      return JSON.stringify(preview);
    })()`),
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.acceptedPatchCount, 0);
  assert.strictEqual(result.appliedPatchCount, 0);
  assert.strictEqual(result.skippedPatchCount, 0);
  assert(result.markdown.includes("Book page 1 source"));
  assert(result.markdown.includes("Book page 2 source"));
  assert(result.warnings.some((warning) => warning.type === "no_accepted_patch"));
  assert.strictEqual(result.pageSummaries.length, 2);
  assert.deepStrictEqual(
    result.pageSummaries.map((page) => [page.pageNo, page.appliedPatchCount, page.warningCount, page.errorCount]),
    [[1, 0, 0, 0], [2, 0, 0, 0]],
  );
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["Single accepted source"], ["Untouched second page"]])}
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Single accepted source",
        newText: "Single accepted correction",
        source: "mathpix"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      const preview = buildAcceptedPatchPreviewForBook();
      return JSON.stringify(preview);
    })()`),
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.acceptedPatchCount, 1);
  assert.strictEqual(result.appliedPatchCount, 1);
  assert.strictEqual(result.skippedPatchCount, 0);
  assert(result.markdown.includes("Single accepted correction"));
  assert(result.markdown.includes("Untouched second page"));
  assert(!result.markdown.includes("Single accepted source"));
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["First page source"], ["Second page source"]])}
      const firstPatch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "First page source",
        newText: "First page accepted correction",
        source: "human"
      }).patch;
      const secondPatch = createAndStoreDraftOcrPatch({
        pageNo: 2,
        blockIndex: "0",
        oldText: "Second page source",
        newText: "Second page accepted correction",
        source: "mathpix"
      }).patch;
      updateOcrPatchStatus(firstPatch.patchId, "accepted");
      updateOcrPatchStatus(secondPatch.patchId, "accepted");
      const preview = buildAcceptedPatchPreviewForBook();
      return JSON.stringify(preview);
    })()`),
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.acceptedPatchCount, 2);
  assert.strictEqual(result.appliedPatchCount, 2);
  assert.strictEqual(result.skippedPatchCount, 0);
  assert(result.markdown.includes("First page accepted correction"));
  assert(result.markdown.includes("Second page accepted correction"));
  assert.deepStrictEqual(
    result.pageSummaries.map((page) => page.appliedPatchCount),
    [1, 1],
  );
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["Book draft base"], ["Book rejected base"], ["Book noop base"]])}
      createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Book draft base",
        newText: "Book draft correction should not preview",
        source: "mathpix"
      });
      const rejected = createAndStoreDraftOcrPatch({
        pageNo: 2,
        blockIndex: "0",
        oldText: "Book rejected base",
        newText: "Book rejected correction should not preview",
        source: "human"
      }).patch;
      updateOcrPatchStatus(rejected.patchId, "rejected");
      createAndStoreDraftOcrPatch({
        pageNo: 3,
        blockIndex: "0",
        oldText: "Book noop base",
        newText: "Book noop base",
        source: "human"
      });
      const preview = buildAcceptedPatchPreviewForBook();
      return JSON.stringify(preview);
    })()`),
  );
  assert.strictEqual(result.acceptedPatchCount, 0);
  assert.strictEqual(result.appliedPatchCount, 0);
  assert(result.markdown.includes("Book draft base"));
  assert(result.markdown.includes("Book rejected base"));
  assert(result.markdown.includes("Book noop base"));
  assert(!result.markdown.includes("Book draft correction should not preview"));
  assert(!result.markdown.includes("Book rejected correction should not preview"));
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["Mismatch page source"], ["Missing target host"]])}
      const mismatch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Mismatch page source",
        newText: "Mismatch correction should not apply",
        source: "mathpix"
      }).patch;
      updateOcrPatchStatus(mismatch.patchId, "accepted");
      mismatch.oldHash = "0".repeat(64);
      const missing = createAndStoreDraftOcrPatch({
        pageNo: 2,
        blockIndex: "99",
        oldText: "Missing target source",
        newText: "Missing target correction should not apply",
        source: "human"
      }).patch;
      updateOcrPatchStatus(missing.patchId, "accepted");
      const preview = buildAcceptedPatchPreviewForBook();
      return JSON.stringify(preview);
    })()`),
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.acceptedPatchCount, 2);
  assert.strictEqual(result.appliedPatchCount, 0);
  assert.strictEqual(result.skippedPatchCount, 2);
  assert(result.errors.some((error) => error.type === "old_hash_mismatch" && error.pageNo === 1));
  assert(result.warnings.some((warning) => warning.type === "patch_block_not_found" && warning.pageNo === 2));
  assert(result.markdown.includes("Mismatch page source"));
  assert(result.markdown.includes("Missing target host"));
  assert(!result.markdown.includes("Mismatch correction should not apply"));
  assert(!result.markdown.includes("Missing target correction should not apply"));
  assert.deepStrictEqual(
    result.pageSummaries.map((page) => [page.pageNo, page.appliedPatchCount, page.warningCount, page.errorCount]),
    [[1, 0, 0, 1], [2, 0, 1, 0]],
  );
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["State book source"], ["State book second page"]])}
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "State book source",
        newText: "State book correction",
        source: "human"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      getBlockOverrides(1).set("0", "Existing book override stays");
      const beforePatches = JSON.stringify(state.ocrPatches);
      const beforeOverrides = JSON.stringify(Array.from(getBlockOverrides(1).entries()));
      const originalBuildBookMarkdown = buildBookMarkdown;
      let buildCalled = 0;
      buildBookMarkdown = function buildBookMarkdownProbe() {
        buildCalled += 1;
        throw new Error("formal export should not be called by book dry-run preview");
      };
      let preview;
      try {
        preview = buildAcceptedPatchPreviewForBook();
      } finally {
        buildBookMarkdown = originalBuildBookMarkdown;
      }
      const afterPatches = JSON.stringify(state.ocrPatches);
      const afterOverrides = JSON.stringify(Array.from(getBlockOverrides(1).entries()));
      return JSON.stringify({ preview, beforePatches, afterPatches, beforeOverrides, afterOverrides, buildCalled });
    })()`),
  );
  assert.strictEqual(result.preview.appliedPatchCount, 1);
  assert.strictEqual(result.beforePatches, result.afterPatches);
  assert.strictEqual(result.beforeOverrides, result.afterOverrides);
  assert.strictEqual(result.buildCalled, 0);
  assert(result.preview.markdown.includes("State book correction"));
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["Top controls source"]])}
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Top controls source",
        newText: "Top controls correction",
        source: "human"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      let statusCalled = 0;
      const originalGetStatus = getAcceptedCorrectedDownloadStatus;
      getAcceptedCorrectedDownloadStatus = function getAcceptedCorrectedDownloadStatusProbe() {
        statusCalled += 1;
        return originalGetStatus();
      };
      els.previewAcceptedBookButton = { disabled: true, textContent: "" };
      els.downloadAcceptedCorrectedButton = { disabled: true, title: "" };
      try {
        updateAcceptedPatchTopControls();
      } finally {
        getAcceptedCorrectedDownloadStatus = originalGetStatus;
      }
      return JSON.stringify({
        statusCalled,
        previewDisabled: els.previewAcceptedBookButton.disabled,
        downloadDisabled: els.downloadAcceptedCorrectedButton.disabled,
        downloadTitle: els.downloadAcceptedCorrectedButton.title
      });
    })()`),
  );
  assert.strictEqual(result.statusCalled, 0, "top control refresh should not run the expensive accepted book preview");
  assert.strictEqual(result.previewDisabled, false);
  assert.strictEqual(result.downloadDisabled, false);
  assert(result.downloadTitle.includes("dry-run"));
}

{
  const status = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["Empty status source"]])}
      return JSON.stringify(getAcceptedCorrectedDownloadStatus());
    })()`),
  );
  assert.strictEqual(status.status, "empty");
  assert.strictEqual(status.canDownload, false);
  assert.strictEqual(status.acceptedPatchCount, 0);
  assert(status.message.includes("当前没有 accepted patch"));
}

{
  const status = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["Ready status source"], ["Ready untouched page"]])}
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Ready status source",
        newText: "Ready status correction",
        source: "human"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      return JSON.stringify(getAcceptedCorrectedDownloadStatus());
    })()`),
  );
  assert.strictEqual(status.status, "ready");
  assert.strictEqual(status.canDownload, true);
  assert.strictEqual(status.acceptedPatchCount, 1);
  assert.strictEqual(status.appliedPatchCount, 1);
  assert.strictEqual(status.warningCount, 0);
  assert.strictEqual(status.errorCount, 0);
}

{
  const status = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["Warning status source"], ["Warning status host"]])}
      const valid = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Warning status source",
        newText: "Warning status correction",
        source: "human"
      }).patch;
      updateOcrPatchStatus(valid.patchId, "accepted");
      const missing = createAndStoreDraftOcrPatch({
        pageNo: 2,
        blockIndex: "99",
        oldText: "Warning status missing source",
        newText: "Warning status missing correction",
        source: "mathpix"
      }).patch;
      updateOcrPatchStatus(missing.patchId, "accepted");
      return JSON.stringify(getAcceptedCorrectedDownloadStatus());
    })()`),
  );
  assert.strictEqual(status.status, "warning-only");
  assert.strictEqual(status.canDownload, true);
  assert.strictEqual(status.acceptedPatchCount, 2);
  assert.strictEqual(status.appliedPatchCount, 1);
  assert.strictEqual(status.errorCount, 0);
  assert.strictEqual(status.firstWarningType, "patch_block_not_found");
  assert(status.message.includes("warning"));
}

{
  const status = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["Blocked status source"]])}
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Blocked status source",
        newText: "Blocked status correction",
        source: "mathpix"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      patch.oldHash = "0".repeat(64);
      return JSON.stringify(getAcceptedCorrectedDownloadStatus());
    })()`),
  );
  assert.strictEqual(status.status, "blocked");
  assert.strictEqual(status.canDownload, false);
  assert.strictEqual(status.errorCount, 1);
  assert.strictEqual(status.firstErrorType, "old_hash_mismatch");
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["Status mutation source"]])}
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Status mutation source",
        newText: "Status mutation correction",
        source: "human"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      getBlockOverrides(1).set("0", "Status override stays");
      const beforePatches = JSON.stringify(state.ocrPatches);
      const beforeOverrides = JSON.stringify(Array.from(getBlockOverrides(1).entries()));
      const originalExportMineruMarkdown = exportMineruMarkdown;
      const originalBuildBookMarkdown = buildBookMarkdown;
      let exportCalled = 0;
      let buildCalled = 0;
      exportMineruMarkdown = function exportProbe() {
        exportCalled += 1;
        throw new Error("download status should not call formal export");
      };
      buildBookMarkdown = function buildProbe() {
        buildCalled += 1;
        throw new Error("download status should not call formal buildBookMarkdown");
      };
      let status;
      try {
        status = getAcceptedCorrectedDownloadStatus();
      } finally {
        exportMineruMarkdown = originalExportMineruMarkdown;
        buildBookMarkdown = originalBuildBookMarkdown;
      }
      const afterPatches = JSON.stringify(state.ocrPatches);
      const afterOverrides = JSON.stringify(Array.from(getBlockOverrides(1).entries()));
      return JSON.stringify({ status, beforePatches, afterPatches, beforeOverrides, afterOverrides, exportCalled, buildCalled });
    })()`),
  );
  assert.strictEqual(result.status.status, "ready");
  assert.strictEqual(result.beforePatches, result.afterPatches);
  assert.strictEqual(result.beforeOverrides, result.afterOverrides);
  assert.strictEqual(result.exportCalled, 0);
  assert.strictEqual(result.buildCalled, 0);
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["No accepted download source"]])}
      const downloads = [];
      const originalDownloadTextFile = downloadTextFile;
      downloadTextFile = function captureDownload(filename, text) {
        downloads.push({ filename, text });
      };
      let downloadResult;
      try {
        downloadResult = downloadAcceptedCorrectedMarkdown();
      } finally {
        downloadTextFile = originalDownloadTextFile;
      }
      return JSON.stringify({ downloadResult, downloads, preview: state.acceptedPatchBookPreview });
    })()`),
  );
  assert.strictEqual(result.downloadResult.ok, false);
  assert.strictEqual(result.downloadResult.reason, "no_accepted_patch");
  assert.strictEqual(result.downloadResult.status.status, "empty");
  assert.strictEqual(result.downloadResult.status.canDownload, false);
  assert.strictEqual(result.downloads.length, 0);
  assert(result.downloadResult.preview.warnings.some((warning) => warning.type === "no_accepted_patch"));
  assert.strictEqual(result.preview, null, "download should not leave a raw accepted preview panel in UI state");
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["Download accepted source"], ["Download untouched page"]])}
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Download accepted source",
        newText: "Download accepted correction",
        source: "human"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      const downloads = [];
      const originalDownloadTextFile = downloadTextFile;
      downloadTextFile = function captureDownload(filename, text) {
        downloads.push({ filename, text });
      };
      let downloadResult;
      try {
        downloadResult = downloadAcceptedCorrectedMarkdown();
      } finally {
        downloadTextFile = originalDownloadTextFile;
      }
      return JSON.stringify({ downloadResult, downloads });
    })()`),
  );
  assert.strictEqual(result.downloadResult.ok, true);
  assert.strictEqual(result.downloadResult.status.status, "ready");
  assert.strictEqual(result.downloadResult.status.canDownload, true);
  assert.strictEqual(result.downloads.length, 1);
  assert(result.downloads[0].filename.endsWith("-accepted-corrected.md"));
  assert(result.downloads[0].text.includes("Generated by OCR accepted patch dry-run export."));
  assert(result.downloads[0].text.includes("Only accepted OcrPatch entries are applied."));
  assert(result.downloads[0].text.includes("Download accepted correction"));
  assert(result.downloads[0].text.includes("Download untouched page"));
  assert(!result.downloads[0].text.includes("Download accepted source"));
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["Download image source"], ["Download image untouched page"]])}
      state.mineruFileName = "image_book_middle.json";
      const imageDataUrl = "data:image/png;base64,iVBORw0KGgo=";
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Download image source",
        newText: "![plot](" + imageDataUrl + ")\\\\n\\\\nFig. packed",
        source: "human"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      const textDownloads = [];
      const zipDownloads = [];
      const originalDownloadTextFile = downloadTextFile;
      const originalDownloadBinaryFile = downloadBinaryFile;
      downloadTextFile = function captureTextDownload(filename, text) {
        textDownloads.push({ filename, text });
      };
      downloadBinaryFile = function captureBinaryDownload(filename, bytes, mimeType) {
        zipDownloads.push({ filename, bytes: Array.from(bytes), mimeType });
      };
      let downloadResult;
      try {
        downloadResult = downloadAcceptedCorrectedMarkdown();
      } finally {
        downloadTextFile = originalDownloadTextFile;
        downloadBinaryFile = originalDownloadBinaryFile;
      }
      return JSON.stringify({ downloadResult, textDownloads, zipDownloads });
    })()`),
  );
  assert.strictEqual(result.downloadResult.ok, true);
  assert.strictEqual(result.downloadResult.format, "zip");
  assert.strictEqual(result.downloadResult.imageCount, 1);
  assert.strictEqual(result.textDownloads.length, 0);
  assert.strictEqual(result.zipDownloads.length, 1);
  assert(result.zipDownloads[0].filename.endsWith("-accepted-corrected.zip"));
  assert.strictEqual(result.zipDownloads[0].mimeType, "application/zip");
  const zipEntries = readStoredZipEntries(result.zipDownloads[0].bytes);
  assert(zipEntries.has("image_book_middle-accepted-corrected.md"), "zip should contain the accepted markdown at the root");
  assert(zipEntries.has("images/image-1.png"), "zip should place accepted images under images/");
  const packagedMarkdown = zipEntries.get("image_book_middle-accepted-corrected.md").toString("utf8");
  assert(packagedMarkdown.includes("Generated by OCR accepted patch dry-run export."));
  assert(packagedMarkdown.includes("![plot](images/image-1.png)"), "packaged markdown should point to the bundled images folder");
  assert.strictEqual(zipEntries.get("images/image-1.png").length, 8);
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["Download draft base"], ["Download rejected base"], ["Download noop base"], ["Download accepted base"]])}
      createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Download draft base",
        newText: "Download draft correction should not appear",
        source: "mathpix"
      });
      const rejected = createAndStoreDraftOcrPatch({
        pageNo: 2,
        blockIndex: "0",
        oldText: "Download rejected base",
        newText: "Download rejected correction should not appear",
        source: "human"
      }).patch;
      updateOcrPatchStatus(rejected.patchId, "rejected");
      createAndStoreDraftOcrPatch({
        pageNo: 3,
        blockIndex: "0",
        oldText: "Download noop base",
        newText: "Download noop base",
        source: "human"
      });
      const accepted = createAndStoreDraftOcrPatch({
        pageNo: 4,
        blockIndex: "0",
        oldText: "Download accepted base",
        newText: "Download accepted included",
        source: "human"
      }).patch;
      updateOcrPatchStatus(accepted.patchId, "accepted");
      const downloads = [];
      const originalDownloadTextFile = downloadTextFile;
      downloadTextFile = function captureDownload(filename, text) {
        downloads.push({ filename, text });
      };
      let downloadResult;
      try {
        downloadResult = downloadAcceptedCorrectedMarkdown();
      } finally {
        downloadTextFile = originalDownloadTextFile;
      }
      return JSON.stringify({ downloadResult, downloads });
    })()`),
  );
  assert.strictEqual(result.downloadResult.ok, true);
  assert.strictEqual(result.downloads.length, 1);
  assert(result.downloads[0].text.includes("Download accepted included"));
  assert(result.downloads[0].text.includes("Download draft base"));
  assert(result.downloads[0].text.includes("Download rejected base"));
  assert(result.downloads[0].text.includes("Download noop base"));
  assert(!result.downloads[0].text.includes("Download draft correction should not appear"));
  assert(!result.downloads[0].text.includes("Download rejected correction should not appear"));
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["Mismatch download source"]])}
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Mismatch download source",
        newText: "Mismatch download correction",
        source: "mathpix"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      patch.oldHash = "0".repeat(64);
      const downloads = [];
      const originalDownloadTextFile = downloadTextFile;
      downloadTextFile = function captureDownload(filename, text) {
        downloads.push({ filename, text });
      };
      let downloadResult;
      try {
        downloadResult = downloadAcceptedCorrectedMarkdown();
      } finally {
        downloadTextFile = originalDownloadTextFile;
      }
      return JSON.stringify({ downloadResult, downloads });
    })()`),
  );
  assert.strictEqual(result.downloadResult.ok, false);
  assert.strictEqual(result.downloadResult.reason, "preview_not_ok");
  assert.strictEqual(result.downloadResult.status.status, "blocked");
  assert.strictEqual(result.downloadResult.status.canDownload, false);
  assert.strictEqual(result.downloads.length, 0);
  assert(result.downloadResult.preview.errors.some((error) => error.type === "old_hash_mismatch"));
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["Warning valid source"], ["Warning host source"]])}
      const valid = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Warning valid source",
        newText: "Warning valid correction",
        source: "human"
      }).patch;
      updateOcrPatchStatus(valid.patchId, "accepted");
      const missing = createAndStoreDraftOcrPatch({
        pageNo: 2,
        blockIndex: "99",
        oldText: "Warning missing source",
        newText: "Warning missing correction should not appear",
        source: "mathpix"
      }).patch;
      updateOcrPatchStatus(missing.patchId, "accepted");
      const downloads = [];
      const originalDownloadTextFile = downloadTextFile;
      downloadTextFile = function captureDownload(filename, text) {
        downloads.push({ filename, text });
      };
      let downloadResult;
      try {
        downloadResult = downloadAcceptedCorrectedMarkdown();
      } finally {
        downloadTextFile = originalDownloadTextFile;
      }
      return JSON.stringify({ downloadResult, downloads });
    })()`),
  );
  assert.strictEqual(result.downloadResult.ok, true);
  assert.strictEqual(result.downloadResult.status.status, "warning-only");
  assert.strictEqual(result.downloadResult.status.canDownload, true);
  assert.strictEqual(result.downloadResult.status.firstWarningType, "patch_block_not_found");
  assert.strictEqual(result.downloads.length, 1);
  assert.strictEqual(result.downloadResult.preview.appliedPatchCount, 1);
  assert.strictEqual(result.downloadResult.preview.skippedPatchCount, 1);
  assert(result.downloadResult.preview.warnings.some((warning) => warning.type === "patch_block_not_found"));
  assert(result.downloads[0].text.includes("Warning valid correction"));
  assert(!result.downloads[0].text.includes("Warning missing correction should not appear"));
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["Formal export guard source"]])}
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Formal export guard source",
        newText: "Accepted download without formal export",
        source: "human"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      let exportCalled = 0;
      let buildCalled = 0;
      const originalExportMineruMarkdown = exportMineruMarkdown;
      const originalBuildBookMarkdown = buildBookMarkdown;
      const originalDownloadTextFile = downloadTextFile;
      exportMineruMarkdown = function exportProbe() {
        exportCalled += 1;
        throw new Error("accepted download should not call formal export");
      };
      buildBookMarkdown = function buildProbe() {
        buildCalled += 1;
        throw new Error("accepted download should not call formal buildBookMarkdown");
      };
      downloadTextFile = function captureDownload() {};
      let downloadResult;
      try {
        downloadResult = downloadAcceptedCorrectedMarkdown();
      } finally {
        exportMineruMarkdown = originalExportMineruMarkdown;
        buildBookMarkdown = originalBuildBookMarkdown;
        downloadTextFile = originalDownloadTextFile;
      }
      return JSON.stringify({ downloadResult, exportCalled, buildCalled });
    })()`),
  );
  assert.strictEqual(result.downloadResult.ok, true);
  assert.strictEqual(result.exportCalled, 0);
  assert.strictEqual(result.buildCalled, 0);
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewBookExpression([["Formal export source"]])}
      getBlockOverrides(1).set("0", "Formal export override");
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Formal export source",
        newText: "Accepted patch should not alter formal export",
        source: "human"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      const formalBefore = buildBookMarkdown(true);
      const downloads = [];
      const originalDownloadTextFile = downloadTextFile;
      els.statusBadge = { textContent: "", className: "" };
      downloadTextFile = function captureDownload(filename, text) {
        downloads.push({ filename, text });
      };
      try {
        exportMineruMarkdown(true);
      } finally {
        downloadTextFile = originalDownloadTextFile;
      }
      const formalAfter = buildBookMarkdown(true);
      return JSON.stringify({ formalBefore, formalAfter, downloads });
    })()`),
  );
  assert.strictEqual(result.formalBefore, result.formalAfter);
  assert.strictEqual(result.downloads.length, 1);
  assert(result.downloads[0].text.includes("Formal export override"));
  assert(!result.downloads[0].text.includes("Accepted patch should not alter formal export"));
}

{
  const uiHtml = call(`(() => {
    ${setupPreviewPageExpression(["UI source"])}
    function fakeCard() {
      return {
        className: "",
        innerHTML: "",
        querySelectorAll() { return []; },
        querySelector() { return null; }
      };
    }
    document = {
      createElement() { return fakeCard(); }
    };
    state.riskByPage.clear();
    const emptyCard = renderReviewCard();
    const patch = createAndStoreDraftOcrPatch({
      pageNo: 1,
      blockIndex: "0",
      oldText: "UI source",
      newText: "UI accepted correction",
      source: "human"
    }).patch;
    updateOcrPatchStatus(patch.patchId, "accepted");
    const acceptedCard = renderReviewCard();
    state.acceptedPatchPreview = {
      ok: true,
      pageNo: 1,
      markdown: "Preview correction text",
      appliedPatchCount: 1,
      errors: [],
      warnings: []
    };
    state.acceptedPatchBookPreview = {
      ok: true,
      markdown: "Book preview correction text",
      pageSummaries: [{ pageNo: 1, appliedPatchCount: 1, warningCount: 0, errorCount: 0 }],
      appliedPatchCount: 1,
      acceptedPatchCount: 1,
      skippedPatchCount: 0,
      errors: [],
      warnings: []
    };
    const bookPanel = renderAcceptedPatchBookPreviewPanel();
    return JSON.stringify({ emptyHtml: emptyCard.innerHTML, acceptedHtml: acceptedCard.innerHTML, bookPanel });
  })()`);
  const parsed = JSON.parse(uiHtml);
  assert(!parsed.emptyHtml.includes("个页面块"));
  assert(!parsed.emptyHtml.includes("高风险/候选"));
  assert(parsed.emptyHtml.includes("UI source"));
  assert(parsed.emptyHtml.includes("review-page-canvas"));
  assert(parsed.emptyHtml.includes("review-page-paper"));
  assert(parsed.emptyHtml.includes('data-review-item-state="normal"'));
  assert(!parsed.emptyHtml.includes("普通段落"));
  assert(!parsed.emptyHtml.includes("预览 accepted 校正稿"));
  assert(!parsed.emptyHtml.includes("data-preview-accepted-patches"));
  assert(!parsed.emptyHtml.includes("下载 accepted 校正稿"));
  assert(!parsed.emptyHtml.includes("data-accepted-download-status"));
  assert(!parsed.acceptedHtml.includes("导出前检查"));
  assert(!parsed.acceptedHtml.includes("下载状态："));
  assert(!parsed.acceptedHtml.includes("data-accepted-download-status"));
  assert(!parsed.acceptedHtml.includes("data-accepted-patch-export-section"));
  assert.strictEqual(parsed.bookPanel, "", "accepted book preview should not render raw markdown below the workbench");
  assert(!parsed.acceptedHtml.includes("Book preview correction text"));
  assert(!parsed.acceptedHtml.includes("data-close-accepted-book-preview"));
  assert(!parsed.acceptedHtml.includes("ocr-patch-book-render"));
}

{
  const canvasResult = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.reviewExpanded.clear();
      state.riskByPage.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.ocrPatches = [];
      const entries = [
        {
          key: "0",
          displayIndex: 1,
          segment: { blockIndex: "0", markdown: "Plain paragraph", kind: "text", bbox: [10, 20, 110, 80], pageSize: [200, 300] },
          risk: { pageNumber: 1, blockIndex: "0", bbox: [10, 20, 110, 80], pageSize: [200, 300], text: "Plain paragraph", reasons: [], reviewOnly: true }
        },
        {
          key: "1",
          displayIndex: 2,
          segment: { blockIndex: "1", markdown: "$$\\\\nE=mc^2\\\\n$$", kind: "text", bbox: [20, 90, 160, 140], pageSize: [200, 300] },
          risk: { pageNumber: 1, blockIndex: "1", bbox: [20, 90, 160, 140], pageSize: [200, 300], text: "$$\\\\nE=mc^2\\\\n$$", reasons: ["display_math_block"] }
        },
        {
          key: "2",
          displayIndex: 3,
          segment: { blockIndex: "2", markdown: "![image](fig.jpg)\\\\n\\\\nFig. 1", kind: "image", bbox: null, pageSize: [200, 300] },
          risk: { pageNumber: 1, blockIndex: "2", bbox: null, pageSize: [200, 300], text: "![image](fig.jpg)\\\\n\\\\nFig. 1", reasons: [], reviewOnly: true }
        }
      ];
      expandOnlyReviewBlock(1, "1");
      const canvas = renderPageReviewCanvas(entries);
      state.reviewNeedsCorrection.clear();
      state.reviewNeedsCorrection.add("1:1");
      const markedCanvas = renderPageReviewCanvas(entries);
      state.reviewActionsOpen.clear();
      state.reviewActionsOpen.add("1:1");
      const actionsCanvas = renderPageReviewCanvas(entries);
      state.reviewCorrectionOpen.clear();
      state.reviewCorrectionOpen.add("1:1");
      const correctionCanvas = renderPageReviewCanvas(entries);
      const hotspots = renderPdfBlockHotspots(entries);
      return JSON.stringify({
        canvas,
        markedCanvas,
        actionsCanvas,
        correctionCanvas,
        hotspots,
        selected: Array.from(state.reviewExpanded)
      });
    })()`),
  );
  assert(canvasResult.canvas.includes('class="review-list review-page-canvas markdown-body"'), "v2 review should render a page canvas");
  assert(canvasResult.canvas.includes('data-review-page-block="1:0"'), "plain paragraph block should be present in the full-page canvas");
  assert(canvasResult.canvas.includes('data-review-page-block="1:1"'), "formula block should be present in the full-page canvas");
  assert(canvasResult.canvas.includes('data-review-page-block="1:2"'), "image block without bbox should still be present in the full-page canvas");
  assert(canvasResult.canvas.includes('class="math-display"'), "formula block should render as display math inside the page canvas");
  assert(canvasResult.canvas.includes("is-selected"), "selected block should keep a visible selection state");
  assert(!canvasResult.canvas.includes("selected-block-toolbar"), "selected block should not render the old correction toolbar in page-comparison mode");
  assert(!canvasResult.canvas.includes('data-risk-mathpix="1"'), "selected block should not show Mathpix correction during block comparison");
  assert(!canvasResult.canvas.includes("查看/编辑 MinerU 源码"), "selected block should not show source editing by default");
  assert(!canvasResult.canvas.includes("MinerU 渲染"), "selected block should not show the MinerU render pane by default");
  assert(!canvasResult.canvas.includes("已接受校正稿"), "selected block should not show the accepted render pane by default");
  assert(!canvasResult.canvas.includes("Mathpix 识别稿"), "selected block should not show the Mathpix render pane by default");
  assert(!canvasResult.canvas.includes('data-review-needs-correction-toggle="1:1"'), "selected block should hide correction buttons until the block is clicked again");
  assert(canvasResult.actionsCanvas.includes('data-review-needs-correction-toggle="1:1"'), "second click should expose a needs-extra-correction marker");
  assert(canvasResult.markedCanvas.includes("needs-extra-correction"), "marked review block should have a visible marker class");
  assert(canvasResult.actionsCanvas.includes('aria-pressed="true"'), "marked review block button should expose pressed state when actions are visible");
  assert(canvasResult.correctionCanvas.includes("selected-block-toolbar"), "correction panel should restore the original block correction UI on demand");
  assert(canvasResult.correctionCanvas.includes('data-risk-mathpix="1"'), "correction panel should expose the Mathpix block action");
  assert(canvasResult.correctionCanvas.includes("查看/编辑 MinerU 源码"), "correction panel should expose source editing");
  assert(canvasResult.correctionCanvas.includes('aria-label="收起校正面板"'), "correction panel should expose an explicit collapse action");
  assert(canvasResult.hotspots.includes('data-review-left-hotspot="1:0"'), "block with bbox should render a left-column hotspot");
  assert(canvasResult.hotspots.includes('data-review-left-hotspot="1:1"'), "formula block with bbox should render a left-column hotspot");
  assert(!canvasResult.hotspots.includes('data-review-left-hotspot="1:2"'), "block without bbox should not render a left-column hotspot");
  assert.deepStrictEqual(canvasResult.selected, ["1:1"], "selected block should be stored as a single page:block key");
}

{
  const sourceChoice = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression(["Original paragraph text"])}
      state.currentPage = 1;
      state.reviewExpanded.clear();
      state.reviewCorrectionOpen.clear();
      state.ocrPatches = [];
      state.mathpixBlockDrafts.clear();
      const patch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Original paragraph text",
        newText: "Accepted corrected paragraph",
        source: "human"
      }).patch;
      updateOcrPatchStatus(patch.patchId, "accepted");
      expandOnlyReviewBlock(1, "0");
      state.reviewCorrectionOpen.add("1:0");
      const acceptedCanvas = renderPageReviewCanvas(reviewEntriesForCurrentPage());
      state.ocrPatches = [];
      state.reviewExpanded.clear();
      state.reviewCorrectionOpen.clear();
      expandOnlyReviewBlock(1, "0");
      state.reviewCorrectionOpen.add("1:0");
      const mineruCanvas = renderPageReviewCanvas(reviewEntriesForCurrentPage());
      return JSON.stringify({ acceptedCanvas, mineruCanvas });
    })()`),
  );
  assert(sourceChoice.acceptedCanvas.includes("查看/编辑 Mathpix draft / accepted Markdown"), "accepted blocks should expose the corrected markdown editor");
  assert(!sourceChoice.acceptedCanvas.includes("查看/编辑 MinerU 源码"), "accepted blocks should not show a second MinerU source editor");
  assert(sourceChoice.mineruCanvas.includes("查看/编辑 MinerU 源码"), "uncorrected blocks should still expose the MinerU source editor");
  assert(!sourceChoice.mineruCanvas.includes("查看/编辑 Mathpix draft / accepted Markdown"), "uncorrected blocks should not show an empty corrected markdown editor");
}

{
  const localActions = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.reviewExpanded.clear();
      state.reviewCorrectionOpen.clear();
      state.reviewNeedsCorrection.clear();
      state.riskByPage.clear();
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            para_blocks: [
              {
                type: "text",
                lines: [{ spans: [{ content: "Selected tests of the Weak Equivalence Principle, showing bounds on the Eotvos ratio eta. The light grey region represents many experiments." }] }]
              },
              {
                type: "text",
                lines: [{ spans: [{ content: "The current upper limits on eta are summarized in Figure 2.2." }] }]
              },
              {
                type: "text",
                lines: [
                  { spans: [{ content: "an atom such as Cesium by studying the interference pattern when" }] },
                  { spans: [{ content: "the wavefunctions are" }] },
                  { spans: [{ content: "recombined, and compares that with the acceleration of a nearby" }] }
                ]
              }
            ]
          }
        ]
      };
      const entries = reviewEntriesForCurrentPage();
      const html = renderPageReviewCanvas(entries);
      state.reviewActionsOpen.clear();
      state.reviewActionsOpen.add("1:0");
      const actionHtml = renderPageReviewCanvas(entries);
      const label = inferMissingFigureLabelForBlock(1, "0", reviewSegmentsForPage(1)[0].markdown);
      const labeled = label ? \`\${label} \${reviewSegmentsForPage(1)[0].markdown}\` : "";
      const falsePositiveLabel = inferMissingFigureLabelForBlock(1, "2", reviewSegmentsForPage(1)[2].markdown);
      return JSON.stringify({ html, actionHtml, label, labeled, falsePositiveLabel });
    })()`),
  );
  assert.strictEqual(localActions.label, "Fig. 2.2", "figure captions should infer a missing nearby figure label");
  assert(localActions.labeled.startsWith("Fig. 2.2 Selected tests"), "inferred figure label should be prepended to the caption");
  assert(!localActions.html.includes('data-auto-add-figure-label="0"'), "caption block should hide local figure-label action until actions are opened");
  assert(localActions.actionHtml.includes('data-auto-add-figure-label="0"'), "caption block should expose a local figure-label action when actions are opened");
  assert.strictEqual(localActions.falsePositiveLabel, "", "ordinary prose near a Figure reference should not infer a missing figure label");
  assert(!localActions.html.includes('data-auto-add-figure-label="2"'), "ordinary prose should not expose the figure-label action");
  assert(!localActions.html.includes('data-auto-unwrap-linebreaks="2"'), "plain prose cleanup should be automatic rather than exposed as a manual button");
}

{
  const sameA = JSON.parse(call(`JSON.stringify(createLegacyBlockPatchContext(11, "5", "same OCR text"))`));
  const sameB = JSON.parse(call(`JSON.stringify(createLegacyBlockPatchContext(11, "5", "same OCR text"))`));
  const changed = JSON.parse(call(`JSON.stringify(createLegacyBlockPatchContext(11, "5", "changed OCR text"))`));
  assert.strictEqual(sameA.blockId, sameB.blockId, "provisional blockId should be stable for identical page/block/text");
  assert.notStrictEqual(sameA.blockId, changed.blockId, "provisional blockId should change when oldText changes");
  assert.strictEqual(sameA.blockId, `p11_b5_${sameA.oldHash.slice(0, 8)}`);
}

{
  const browserContext = createOcrCompareContext();
  vm.runInContext(patchBrowserSource, browserContext);
  runOcrCompareInContext(browserContext);
  const result = JSON.parse(
    vm.runInContext(`(() => {
      state.ocrPatches = [];
      const patchResult = createAndStoreDraftOcrPatch({
        pageNo: 12,
        blockIndex: "6",
        oldText: "The OCR line reads L=4piR2sigmaT4.",
        newText: "$$\\nL=4\\\\pi R^2\\\\sigma T^4\\n$$",
        source: "mathpix"
      });
      return JSON.stringify({
        patch: patchResult.patch,
        patchCount: state.ocrPatches.length,
        expectedOldHash: OcrCorePatch.hashBlockText("The OCR line reads L=4piR2sigmaT4.")
      });
    })()`, browserContext),
  );
  assert.strictEqual(result.patchCount, 1);
  assertOcrPatchShape(result.patch);
  assert.strictEqual(result.patch.source, "mathpix");
  assert.strictEqual(result.patch.status, "draft");
  assert.strictEqual(result.patch.oldHash, result.expectedOldHash);
  assert.strictEqual(result.patch.metadata.renderStatusAfter, "warning");
}

{
  const browserContext = createOcrCompareContext();
  vm.runInContext(patchBrowserSource, browserContext);
  runOcrCompareInContext(browserContext);
  const result = JSON.parse(
    vm.runInContext(`(() => {
      state.ocrPatches = [];
      const patchResult = createAndStoreDraftOcrPatch({
        pageNo: 13,
        blockIndex: "1",
        oldText: "Magnitude equation m-M=5log(d/10pc).",
        newText: "Magnitude equation $m-M=5\\\\log_{10}(d/10\\\\mathrm{pc})$.",
        source: "human"
      });
      return JSON.stringify({
        patch: patchResult.patch,
        patchCount: state.ocrPatches.length
      });
    })()`, browserContext),
  );
  assert.strictEqual(result.patchCount, 1);
  assertOcrPatchShape(result.patch);
  assert.strictEqual(result.patch.source, "human");
  assert.strictEqual(result.patch.status, "draft");
}

{
  const browserContext = createOcrCompareContext();
  vm.runInContext(patchBrowserSource, browserContext);
  runOcrCompareInContext(browserContext);
  const result = JSON.parse(
    vm.runInContext(`(() => {
      state.ocrPatches = [];
      const patchResult = createAndStoreDraftOcrPatch({
        pageNo: 14,
        blockIndex: "1",
        oldText: "$$\\nF=ma\\n$$",
        newText: "$$\\nF=ma\\n$$",
        source: "human"
      });
      return JSON.stringify({
        patch: patchResult.patch,
        patchCount: state.ocrPatches.length
      });
    })()`, browserContext),
  );
  assert.strictEqual(result.patchCount, 1);
  assertOcrPatchShape(result.patch);
  assert.strictEqual(result.patch.status, "noop");
}

{
  const warnings = [];
  const fallbackContext = createOcrCompareContext({
    console: {
      warn(...args) {
        warnings.push(args.map(String).join(" "));
      },
    },
  });
  runOcrCompareInContext(fallbackContext);
  const result = JSON.parse(
    vm.runInContext(`(() => {
      state.ocrPatches = [];
      const patchResult = createAndStoreDraftOcrPatch({
        pageNo: 15,
        blockIndex: "1",
        oldText: "Original OCR text.",
        newText: "Edited OCR text.",
        source: "human"
      });
      return JSON.stringify({
        patch: patchResult.patch,
        normalizedText: patchResult.normalizedText,
        patchCount: state.ocrPatches.length
      });
    })()`, fallbackContext),
  );
  assert.strictEqual(result.patch, null);
  assert.strictEqual(result.patchCount, 0);
  assert.strictEqual(result.normalizedText, "Edited OCR text.");
  assert(warnings.some((warning) => warning.includes("OCR draft patch")), "missing patch tools should emit a warning");
}

{
  const appended = [];
  const loaderContext = createOcrCompareContext({
    document: {
      createElement(tagName) {
        return {
          tagName,
          dataset: {},
          addEventListener() {},
          async: true,
          src: "",
        };
      },
      head: {
        appendChild(node) {
          appended.push(node);
        },
      },
    },
  });
  runOcrCompareInContext(loaderContext);
  assert(
    appended.some((node) => node.src === "./ocr-core/patch/ocrPatch.browser.js" && node.dataset.ocrCore === "ocr-patch"),
    "ocr compare should request the patch browser wrapper during browser initialization",
  );
}

call(`
  state.currentPage = 3;
  state.reviewExpanded.clear();
  state.reviewInitializedPages.clear();
  ensureDefaultReviewExpansion([{ blockIndex: "a" }, { blockIndex: "b" }]);
`);
assert(call('state.reviewExpanded.has("3:a")'), "first risk block should expand on first page render");
call(`ensureDefaultReviewExpansion([{ blockIndex: "b" }]);`);
assert(call('state.reviewExpanded.has("3:b")'), "default expansion should repair stale active selection when the current page entries change");
const reviewToggleResult = JSON.parse(
  call(`(() => {
    const originalRenderCurrentPage = renderCurrentPage;
    renderCurrentPage = async function renderCurrentPageStub() {};
    try {
      state.reviewExpanded.clear();
      state.reviewExpanded.add("3:a");
      state.reviewExpanded.add("3:c");
      toggleReviewBlock("3:b");
      const afterOpen = Array.from(state.reviewExpanded);
      toggleReviewBlock("3:b");
      const afterClose = Array.from(state.reviewExpanded);
      return JSON.stringify({ afterOpen, afterClose });
    } finally {
      renderCurrentPage = originalRenderCurrentPage;
    }
  })()`),
);
assert.strictEqual(
  JSON.stringify(reviewToggleResult.afterOpen),
  JSON.stringify(["3:b"]),
  "opening a review block should close previously expanded blocks",
);
assert.strictEqual(
  JSON.stringify(reviewToggleResult.afterClose),
  JSON.stringify([]),
  "clicking the open review block should collapse it",
);
call(`expandOnlyReviewBlock(3, "b");`);
assert.strictEqual(
  call("JSON.stringify(Array.from(state.reviewExpanded))"),
  JSON.stringify(["3:b"]),
  "applied block should be the only expanded block",
);

call(`
  state.mineruInfo = {
    pdf_info: [
      {
        para_blocks: [
          { type: "text", lines: [{ spans: [{ content: "MinerU source" }] }] },
          { type: "text", lines: [{ spans: [{ content: "Second block" }] }] }
        ]
      }
    ]
  };
  getMathpixBlockDrafts(1).set("0", "Mathpix draft only");
`);
const draftOnlyExport = call("buildBookMarkdown(true)");
assert(draftOnlyExport.includes("MinerU source"), "draft-only Mathpix text should not enter corrected export");
assert(!draftOnlyExport.includes("Mathpix draft only"), "unapplied Mathpix draft should not be exportable");
call(`getBlockOverrides(1).set("0", "Applied correction");`);
const appliedExport = call("buildBookMarkdown(true)");
assert(appliedExport.includes("Applied correction"), "applied correction should enter corrected export");

const reviewHtml = call(`
  state.currentPage = 1;
  renderReviewItem(
    { blockIndex: "0", markdown: "MinerU source", kind: "text" },
    { reasons: ["split_formula_tokens"], bbox: [0, 0, 10, 10] },
    "Old applied correction",
    true,
    "New Mathpix draft"
  )
`);
assert(reviewHtml.includes('data-review-item-state="mathpix-draft"'), "new Mathpix draft should be marked as the active state");
assert(!reviewHtml.includes('class="review-item-state"'), "new Mathpix draft should not add noisy state badges in the toolbar");
assert(!reviewHtml.includes("待核查"), "review item title should avoid noisy pending copy");
assert(!reviewHtml.includes("公式被拆散"), "review item title should avoid long risk reason chains");
assert(reviewHtml.includes("保持修改"), "editing Mathpix Markdown should use the streamlined save action");
assert(!reviewHtml.includes("应用到校正稿"), "old apply wording should not be shown in block edit UI");
assert(reviewHtml.includes("New Mathpix draft"), "pending Mathpix draft should be previewed");
assert(!reviewHtml.includes("Old applied correction</div>"), "old applied correction should not be the visible pending preview");

const imageRenderHtml = call(`renderMarkdownHtml("![image](fig-2-2.jpg)\\n\\nFig. 2.2 Caption")`);
assert(imageRenderHtml.includes("markdown-image-reference"), "standalone markdown image should render as image reference");
assert(imageRenderHtml.includes('src="fig-2-2.jpg"'), "image source should be preserved in rendered html");
assert(imageRenderHtml.includes("Fig. 2.2"), "caption text should remain visible after image rendering");

const inlineImageRenderHtml = call(`renderMarkdownHtml("See ![image](fig-2-2.jpg) for Fig. 2.2 Caption")`);
assert(inlineImageRenderHtml.includes("markdown-image-reference"), "inline markdown image should render as image reference");
assert(!inlineImageRenderHtml.includes("![image]"), "inline markdown image token should not render literally");
assert(inlineImageRenderHtml.includes("See for Fig. 2.2 Caption"), "inline image surrounding text should remain visible");

const mixedAlignedRenderHtml = call(`renderBlockContent(${JSON.stringify(
  "For weak interactions, the result is\n\\begin{aligned}\nE &= 2.2 \\\\times 10^{-8} \\\\\\\\\ng &= 0.295\n\\end{aligned}\nwhere N=A-Z.",
)}, { kind: "text", blockIndex: "last" })`);
assert(mixedAlignedRenderHtml.includes('class="math-display"'), "bare aligned environment inside a text block should render as display math");
assert(!mixedAlignedRenderHtml.includes("<p>For weak interactions, the result is<br>\\\\begin{aligned}"), "aligned source must not remain inside the prose paragraph");

const algorithmTaggedMathRenderHtml = call(`renderBlockContent(${JSON.stringify(
  "For weak interactions, while the parity nonconserving part is negligible\n\\begin{aligned}\n\\frac{E^{\\mathrm{W}}}{mc^2} &= 2.2 \\times 10^{-8} g(N,Z) \\\\\\\\\ng(N,Z) &= 0.295 \\left[ \\frac{(N-Z)^2}{2NZ} \\right]\n\\end{aligned}\nwhere N=A-Z.",
)}, { kind: "algorithm", blockIndex: "weak" })`);
assert(algorithmTaggedMathRenderHtml.includes('class="math-display"'), "algorithm-tagged OCR blocks containing LaTeX environments should still render as math");
assert(!algorithmTaggedMathRenderHtml.includes("algorithm-block"), "algorithm-tagged math prose should not render as an algorithm code block");

const danglingDollarMathRenderHtml = call(`renderBlockContent(${JSON.stringify(
  "For weak interactions, the result is\n$\n\\begin{aligned}\nE &= mc^2\n\\end{aligned}\nwhere N=A-Z.",
)}, { kind: "text", blockIndex: "dangling-dollar" })`);
assert(danglingDollarMathRenderHtml.includes('class="math-display"'), "formula blocks with a dangling single-dollar line should still render as math");
assert(!danglingDollarMathRenderHtml.includes("<p>$</p>"), "dangling single-dollar lines should not render before display math");
assert(!/>\\s*\\$\\s*</.test(danglingDollarMathRenderHtml), "dangling dollar delimiters should not remain as visible text nodes");

const escapedDanglingDollarMathRenderHtml = call(`renderBlockContent(${JSON.stringify(
  "For weak interactions, the result is\n\\$\n$$\n\\begin{aligned}\nE &= mc^2\n\\end{aligned}\n$$\nwhere N=A-Z.",
)}, { kind: "text", blockIndex: "escaped-dangling-dollar" })`);
assert(escapedDanglingDollarMathRenderHtml.includes('class="math-display"'), "escaped dangling dollar lines before display math should still render as math");
assert(!/>\\s*\\$\\s*</.test(escapedDanglingDollarMathRenderHtml), "escaped dangling dollar delimiters should not remain as visible text nodes");

const compactedMathpixSource = call(`cleanMathpixEditableMarkdown(${JSON.stringify(
  "$$\n\\begin{array} { r l r } { { \\frac { d P _ { \\mathrm { T } } ^ { 0 } } { d t } = - \\operatorname* { l i m } _ { R \\to \\infty } \\int \\tilde { \\tau } ^ { 0 } d ^ { 2 } S _ { j } } } \\\\ & \\end{array}\n$$",
)})`);
assert(compactedMathpixSource.includes("\\begin{array}{rlr}"), "editable Mathpix source should compact spaced array column specs");
assert(compactedMathpixSource.includes("\\frac{d P_{\\mathrm{T}}^{0}}{d t}"), "editable Mathpix source should compact command/braces/subscript spacing");
assert(compactedMathpixSource.includes("\\operatorname*{lim}_{R \\to \\infty}"), "editable Mathpix source should compact spaced operator names");
assert(!compactedMathpixSource.includes("\\frac {"), "editable Mathpix source should not keep spaced command braces");
assert(!compactedMathpixSource.includes("\\mathrm {"), "editable Mathpix source should not keep spaced roman command braces");

const numberedAlignedPatch = JSON.parse(
  call(`(() => {
    state.ocrPatches = [];
    const result = createAndStoreDraftOcrPatch({
      pageNo: 35,
      blockIndex: "formula",
      oldText: "Original formula (2.12)",
      newText: "For weak interactions\\n\\\\begin{aligned}\\nE &= mc^2\\n\\\\end{aligned}",
      source: "mathpix"
    });
    return JSON.stringify(result);
  })()`),
);
assert(numberedAlignedPatch.normalizedText.includes("\\tag{2.12}"), "missing original equation number should be inserted as a LaTeX tag");
assert(!numberedAlignedPatch.normalizedText.trimEnd().endsWith("(2.12)"), "equation number should not be appended as prose");

const visibleNumberedAlignedPatch = call(`normalizeVisibleEquationNumberAsLatexTag("For weak interactions\\n\\\\begin{aligned}\\nE &= mc^2\\n\\\\end{aligned}\\n(2.12)")`);
assert(visibleNumberedAlignedPatch.includes("\\tag{2.12}"), "Mathpix visible equation number should be normalized into a LaTeX tag");
assert(!visibleNumberedAlignedPatch.trimEnd().endsWith("(2.12)"), "normalized visible equation number should be removed from trailing prose");

const numberedDollarDisplayPatch = call(`insertEquationNumberIntoDisplayMath("$$\\nE^S=-15.75A\\n$$", "(2.8)")`);
assert(numberedDollarDisplayPatch.includes("\\tag{2.8}"), "display math without an explicit environment should receive a LaTeX tag");
assert(!numberedDollarDisplayPatch.trimEnd().endsWith("(2.8)"), "display math numbers should not be appended as prose");

const renderedNumberedDollarDisplay = call(`renderBlockContent("$$\\nE^S=-15.75A\\n\\\\tag{2.8}\\n$$", { kind: "interline_equation", blockIndex: "0" })`);
assert(renderedNumberedDollarDisplay.includes("math-display-equation-tag"), "rendered display math should expose a visible equation-number tag");
assert(renderedNumberedDollarDisplay.includes("(2.8)"), "rendered display math should show the equation number");
assert(!renderedNumberedDollarDisplay.includes("\\\\tag{2.8}"), "rendered display math should not rely on raw LaTeX tag visibility");

const renderedNumberedAlignedDisplay = call(`renderBlockContent("\\\\begin{aligned}\\nE &= mc^2\\n\\\\tag{2.12}\\n\\\\end{aligned}", { kind: "text", blockIndex: "aligned-numbered" })`);
assert(renderedNumberedAlignedDisplay.includes("math-display-equation-tag"), "rendered aligned math should expose a visible equation-number tag");
assert(renderedNumberedAlignedDisplay.includes("(2.12)"), "rendered aligned math should show the equation number");

const preservedFromPriorPatch = JSON.parse(
  call(`(() => {
    state.ocrPatches = [];
    const figure = createAndStoreDraftOcrPatch({
      pageNo: 21,
      blockIndex: "caption",
      oldText: "Selected tests of the Weak Equivalence Principle.",
      preserveText: "Fig. 2.2 Selected tests of the Weak Equivalence Principle.",
      newText: "Selected tests of the Weak Equivalence Principle.",
      source: "mathpix"
    });
    const formula = createAndStoreDraftOcrPatch({
      pageNo: 35,
      blockIndex: "formula",
      oldText: "\\\\begin{aligned}\\nE &= mc^2\\n\\\\end{aligned}",
      preserveText: "Previously accepted formula (2.12)",
      newText: "\\\\begin{aligned}\\nE &= mc^2\\n\\\\end{aligned}",
      source: "mathpix"
    });
    return JSON.stringify({ figure: figure.normalizedText, formula: formula.normalizedText });
  })()`),
);
assert(preservedFromPriorPatch.figure.includes("Fig. 2.2"), "Mathpix patch should preserve figure labels from prior accepted/context text");
assert(preservedFromPriorPatch.formula.includes("\\tag{2.12}"), "Mathpix patch should preserve equation numbers from prior accepted/context text");

const preservedCompleteProse = JSON.parse(
  call(`(() => {
    state.ocrPatches = [];
    const result = createAndStoreDraftOcrPatch({
      pageNo: 42,
      blockIndex: "footnote",
      oldText: "The claim by Muller et al. (2010) that these experiments test the gravitational redshift was subsequently shown to be incorrect (Wolf et al., 2011).",
      newText: "The claim by Müller et al. (2010) that these experiments test the gravitational redshift was subsequently shown",
      source: "mathpix"
    });
    return JSON.stringify(result);
  })()`),
);
assert(preservedCompleteProse.normalizedText.includes("Müller"), "Mathpix prose correction should keep useful corrected text");
assert(preservedCompleteProse.normalizedText.includes("incorrect (Wolf et al., 2011)."), "Mathpix prose correction should preserve missing original tail text");

const preservedFigurePatch = JSON.parse(
  call(`(() => {
    state.ocrPatches = [];
    const oldText = "![image](fig-2-2.jpg)\\n\\nFig. 2.2 Selected tests (2.60) \\\\tag{2.60}";
    const result = createAndStoreDraftOcrPatch({
      pageNo: 21,
      blockIndex: "1",
      oldText,
      newText: "Selected tests of the Weak Equivalence Principle.",
      source: "human"
    });
    return JSON.stringify({ normalizedText: result.normalizedText, patchText: result.patch.newText });
  })()`),
);
assert(preservedFigurePatch.normalizedText.includes("![image](fig-2-2.jpg)"), "human patch should preserve original image reference");
assert(preservedFigurePatch.normalizedText.includes("Fig. 2.2"), "human patch should preserve original figure label");
assert(preservedFigurePatch.normalizedText.includes("\\tag{2.60}"), "human patch should preserve original latex tag");
assert.strictEqual((preservedFigurePatch.normalizedText.match(/Fig\. 2\.2/g) || []).length, 1);

const imagePadding = JSON.parse(
  call(`JSON.stringify(cropPaddingForRiskBlock({ text: "![image](fig.jpg)", pageSize: [1000, 1200], reasons: [] }))`),
);
assert(imagePadding.left >= 120, "image block crop should expand left enough to include side figure labels");
assert(imagePadding.bottom >= 40, "image block crop should expand bottom enough to include captions");

const formulaPadding = JSON.parse(
  call(`JSON.stringify(cropPaddingForRiskBlock({ text: "$$\\\\nE=mc^2\\\\n$$", pageSize: [1000, 1200], reasons: ["display_math_block"] }))`),
);
assert(formulaPadding.right >= 180, "formula crop should expand right enough to include equation numbers");

const imagePreviewHtml = call(`(() => {
  state.currentPage = 21;
  state.pageCache.set(21, { image: "data:image/png;base64,AAA" });
  return renderBlockContent("![image](fig.jpg)\\n\\nFig. 2.2 Caption", {
    blockIndex: "1",
    markdown: "![image](fig.jpg)\\n\\nFig. 2.2 Caption",
    kind: "image",
    bbox: [100, 100, 300, 300],
    pageSize: [1000, 1200]
  });
})()`);
assert(imagePreviewHtml.includes("review-image-preview"), "image block should render a page-crop preview when page image exists");
assert(!imagePreviewHtml.includes("![image]"), "literal markdown image token should be hidden when preview is rendered");
assert(imagePreviewHtml.includes("Fig. 2.2 Caption"), "figure caption should remain visible beside image preview");

const inlineImagePreviewHtml = call(`(() => {
  state.currentPage = 21;
  state.pageCache.set(21, { image: "data:image/png;base64,AAA" });
  return renderBlockContent("See ![image](fig.jpg) for Fig. 2.2 Caption", {
    blockIndex: "1",
    markdown: "See ![image](fig.jpg) for Fig. 2.2 Caption",
    kind: "image",
    bbox: [100, 100, 300, 300],
    pageSize: [1000, 1200]
  });
})()`);
assert(inlineImagePreviewHtml.includes("review-image-preview"), "inline image block should render a page-crop preview when page image exists");
assert(!inlineImagePreviewHtml.includes("![image]"), "inline image token should be hidden when preview is rendered");
assert(inlineImagePreviewHtml.includes("See for Fig. 2.2 Caption"), "inline image caption text should remain visible beside preview");

console.log("ocr compare frontend regressions ok");
