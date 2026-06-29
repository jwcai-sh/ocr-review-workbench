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
  assert(ocrCompareCss.includes(".upload-all-button"));
  assert(!/\.hidden-input\s*\{[^}]*display:\s*none/.test(ocrCompareCss), "file inputs must stay label-activatable, not display:none");
  assert(/\.hidden-input\s*\{[^}]*opacity:\s*0/.test(ocrCompareCss), "file inputs should be visually hidden while remaining activatable by labels");
  assert(ocrCompareCss.includes('label[role="button"]'));
  assert(ocrCompareCss.includes(".upload-button:focus-visible"));
  assert(ocrCompareCss.includes("font-size: calc(17px * var(--review-font-scale, 1));"));
  assert(ocrCompareCss.includes("font-size: calc(13px * var(--review-font-scale, 1));"));
  assert(ocrCompareCss.includes(".accepted-top-actions"));
  assert(ocrCompareCss.includes(".accepted-action-button"));
  assert(ocrCompareCss.includes(".upload-icon svg"));
  assert(ocrCompareCss.includes(".right-workbench-card"));
  assert(ocrCompareCss.includes("height: calc(100vh - 52px)"));
  assert(ocrCompareCss.includes("grid-template-rows: auto minmax(0, 1fr);"));
  assert(ocrCompareCss.includes(".review-page-canvas"));
  assert(ocrCompareCss.includes("--review-font-scale"));
  assert(/\.review-card\.is-fit-page\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/.test(ocrCompareCss), "fit-page review card should reserve height for a single page canvas");
  assert(/\.review-card\.is-fit-page\s+\.review-page-canvas\s*\{[^}]*display:\s*grid/.test(ocrCompareCss), "fit-page review canvas should use a stable single-page grid");
  assert(/\.review-card\.is-fit-page\s+\.review-page-canvas\s*\{[^}]*overflow:\s*auto/.test(ocrCompareCss), "right-column fit mode should allow vertical access to every review block");
  assert(/\.review-card\.is-fit-page\s+\.review-page-paper\s*\{[^}]*width:\s*min\(100%,\s*920px\)/.test(ocrCompareCss), "right-column fit mode should fit the review paper to readable column width");
  assert(/\.review-card\.is-fit-page\s+\.review-page-paper\s*\{[^}]*overflow:\s*visible/.test(ocrCompareCss), "right-column fit mode should not clip later blocks");
  assert(!/\.review-card\.is-fit-page\s+\.review-page-paper\s*\{[^}]*aspect-ratio:/.test(ocrCompareCss), "right-column fit mode should not force a PDF aspect ratio onto reflowed Markdown");
  assert(ocrCompareCss.includes(".review-needs-correction-nav-group"));
  assert(ocrCompareCss.includes(".review-needs-correction-link"));
  assert(ocrCompareCss.includes(".math-display-equation-tag"));
  assert(/\.math-display\s*\{[^}]*position:\s*relative/.test(ocrCompareCss));
  assert(/\.math-display\s*\{[^}]*padding-right:\s*clamp/.test(ocrCompareCss), "display equation labels should reserve inline room without creating a separate row");
  assert(/\.math-display-equation-tag\s*\{[^}]*position:\s*absolute/.test(ocrCompareCss), "display equation labels should be positioned inside the formula block");
  assert(/\.math-display\.is-multiline\s+\.math-display-equation-tag\s*\{[^}]*bottom:\s*1\.45em/.test(ocrCompareCss), "multiline display equation labels should be lifted onto the final formula row");
  assert(ocrCompareCss.includes('.math-display-formula mjx-container[display="true"]'));
  assert(ocrCompareCss.includes(".review-page-block.is-selected"));
  assert(ocrCompareCss.includes(".page-block-hotspot"));
  assert(ocrCompareCss.includes(".page-block-hotspot:hover"));
  assert(!/\.page-block-hotspot:hover,[\s\S]*?background:\s*rgba\(37,\s*99,\s*235,\s*0\.06\)/.test(ocrCompareCss), "left PDF hover hotspots should not draw an inaccurate bbox preview");
  assert(!/\.page-block-hotspot:hover,[^{]*\{[^}]*outline:\s*2px/.test(ocrCompareCss), "left PDF hover hotspots should not draw an outline bbox preview");
  assert(/\.page-block-hotspot:hover,[^{]*\{[^}]*outline:\s*none/.test(ocrCompareCss), "left PDF hover hotspots should suppress visible hover outlines");
  assert(/\.page-block-hotspot:hover,[^{]*\{[^}]*box-shadow:\s*none/.test(ocrCompareCss), "left PDF hover hotspots should suppress visible hover shadows");
  assert(ocrCompareCss.includes(".selected-block-toolbar"));
  assert(ocrCompareCss.includes(".block-step-button"));
  assert(ocrCompareCss.includes(".preview-panel"));
  assert(ocrCompareCss.includes(".page-list"));
  assert(ocrCompareCss.includes("overflow: visible"));
  assert(ocrCompareHtml.includes('id="contentListInput"'));
  assert(ocrCompareHtml.includes('id="requiredFilesInput"'));
  assert(ocrCompareHtml.includes('id="pickContentListButton"'));
  assert(ocrCompareHtml.includes('id="pickRequiredFilesButton"'));
  assert(ocrCompareHtml.includes('class="control-column control-column-pdf"'));
  assert(ocrCompareHtml.includes("<div>原文</div>"));
  assert(!ocrCompareHtml.includes("每页 OCR 截图"));
  assert(ocrCompareHtml.includes("上传 PDF"));
  assert(ocrCompareHtml.includes("上传 middle.json"));
  assert(ocrCompareHtml.includes("上传 content_list"));
  assert(ocrCompareHtml.includes("一键上传所需文件"));
  assert(!ocrCompareHtml.includes("上传 content_list (可选)"));
  assert(!ocrCompareHtml.includes("OCR Preview Lab"));
  assert(ocrCompareHtml.includes('id="previewAcceptedBookButton"'));
  assert(/id="previewAcceptedBookButton"[^>]*hidden/.test(ocrCompareHtml), "book preview button should stay hidden while it is not part of the main workflow");
  assert(ocrCompareHtml.includes('id="downloadAcceptedCorrectedButton"'));
  assert(ocrCompareHtml.includes("预览整书 accepted 校正稿"));
  assert(ocrCompareHtml.includes("下载 accepted 校正稿"));
  assert(ocrCompareHtml.includes('class="upload-icon"'));
  assert(ocrCompareHtml.includes('viewBox="0 0 24 24"'));
  assert(!ocrCompareHtml.includes("cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"), "MathJax CDN should be lazy-loaded by ocr-compare.js");
  assert(ocrCompareHtml.includes('load: ["[tex]/boldsymbol"]'), "MathJax should load boldsymbol for vector formulas converted from pmb");
  assert(ocrCompareHtml.includes('packages: { "[+]": ["boldsymbol"] }'), "MathJax should enable the boldsymbol TeX package");
  assert(ocrCompareHtml.includes("ocr-compare.js?v=20260628-upload-label-mathjax"));
  assert(ocrCompareHtml.includes("ocr-compare.css?v=20260628-upload-label-mathjax"));
  assert(source.includes('OCR_COMPARE_BUILD_ID = "20260628-upload-label-mathjax"'));
  assert(source.includes('data-ocr-compare-build-id", OCR_COMPARE_BUILD_ID'));
  assert(source.includes('LOCAL_API_BASE_CANDIDATES = ["http://127.0.0.1:8790", "http://127.0.0.1:8787"]'));
  assert(source.includes("async function fetchApi(path, options = {})"));
  assert(source.includes("ensureMathJaxLoaded().catch((error) => reportMathJaxError(error));"));
  assert(source.includes("MATHJAX_SCRIPT_URLS"), "MathJax should have fallback script sources");
  assert(source.includes("MATHJAX_LOAD_TIMEOUT_MS"), "MathJax loading should time out instead of leaving raw TeX forever");
  assert(source.includes("loadMathJaxScriptFromFallbacks"), "MathJax loader should try fallback CDNs");
  assert(ocrCompareHtml.includes("<div>校对工作台</div>"));
  assert(!ocrCompareHtml.includes("导出原始 MinerU"));
  assert(!ocrCompareHtml.includes("中栏读取已有 MinerU"));
  assert(!source.includes('document.querySelector(".control-band")'), "upload controls should stay visible when the MinerU preview column is collapsed");
}

{
  assert.strictEqual(call("apiUrl('/api/health')"), "/api/health", "HTTP-served workbench should use the current origin for API requests");

  const http8790Context = runOcrCompareInContext(
    createOcrCompareContext({
      window: {
        __UMA_RUNTIME_CONFIG__: {},
        location: { protocol: "http:", port: "8790" },
        setTimeout() {},
      },
    }),
  );
  assert.strictEqual(
    vm.runInContext("apiUrl('/api/health')", http8790Context),
    "/api/health",
    "HTTP 8790 should not accidentally post to 8787",
  );

  const fileContext = runOcrCompareInContext(
    createOcrCompareContext({
      window: {
        __UMA_RUNTIME_CONFIG__: {},
        location: { protocol: "file:", port: "" },
        setTimeout() {},
      },
    }),
  );
  assert.strictEqual(
    vm.runInContext("apiUrl('/api/health')", fileContext),
    "http://127.0.0.1:8790/api/health",
    "file:// workbench should default to the active local 8790 backend",
  );
  assert.deepStrictEqual(
    JSON.parse(vm.runInContext("JSON.stringify(localApiBaseFallbacks())", fileContext)),
    ["http://127.0.0.1:8790", "http://127.0.0.1:8787"],
    "file:// workbench should retain 8787 as a fallback local backend",
  );

  const fileRuntimeOriginContext = runOcrCompareInContext(
    createOcrCompareContext({
      window: {
        __UMA_RUNTIME_CONFIG__: { apiBaseUrl: "file://", backendUrl: "file://" },
        location: { protocol: "file:", port: "", origin: "file://" },
        setTimeout() {},
      },
    }),
  );
  assert.strictEqual(
    vm.runInContext("apiUrl('/api/health')", fileRuntimeOriginContext),
    "http://127.0.0.1:8790/api/health",
    "file:// runtime-config origin should be ignored and fall back to local backend",
  );
  assert.deepStrictEqual(
    JSON.parse(vm.runInContext("JSON.stringify(localApiBaseFallbacks())", fileRuntimeOriginContext)),
    ["http://127.0.0.1:8790", "http://127.0.0.1:8787"],
    "invalid file:// runtime config should not suppress local backend fallbacks",
  );

  const configuredContext = runOcrCompareInContext(
    createOcrCompareContext({
      window: {
        __UMA_RUNTIME_CONFIG__: { apiBaseUrl: "http://127.0.0.1:8801/" },
        location: { protocol: "file:", port: "" },
        setTimeout() {},
      },
    }),
  );
  assert.strictEqual(
    vm.runInContext("apiUrl('/api/health')", configuredContext),
    "http://127.0.0.1:8801/api/health",
    "explicit runtime API base should override local defaults",
  );
}

{
  const result = JSON.parse(
    call(`(() => {
      const paragraph = { textContent: "inline $x$" };
      const displayFormula = { textContent: "$$\\\\Psi = 1$$" };
      const plain = { textContent: "plain text" };
      const root = {
        textContent: "plain text inline $x$ $$\\\\Psi = 1$$",
        querySelectorAll() {
          return [paragraph, plain, displayFormula, paragraph];
        }
      };
      const targets = mathTypesetTargetsForRoots([root, paragraph]);
      return JSON.stringify({
        count: targets.length,
        includesParagraph: targets.includes(paragraph),
        includesDisplay: targets.includes(displayFormula),
        includesPlain: targets.includes(plain)
      });
    })()`),
  );
  assert.strictEqual(result.count, 2, "MathJax targets should be isolated to unique math-bearing nodes");
  assert(result.includesParagraph, "inline math paragraph should be a MathJax target");
  assert(result.includesDisplay, "display math formula should be a MathJax target");
  assert(!result.includesPlain, "plain text nodes should not be MathJax targets");
}

{
  const pickerResult = JSON.parse(
    call(`(() => {
      const input = {
        value: "/tmp/book.pdf",
        dataset: { fileInputKey: "pdfInput" }
      };
      return JSON.stringify({
        opened: prepareFilePickerInput(input),
        value: input.value,
        missing: prepareFilePickerInput(null)
      });
    })()`),
  );
  assert.strictEqual(pickerResult.opened, true);
  assert.strictEqual(pickerResult.value, "", "file input must reset so selecting the same file fires change again");
  assert.strictEqual(pickerResult.missing, false);
  assert(ocrCompareHtml.includes('for="pdfInput"'), "PDF upload should use native label activation instead of JS-only click");
  assert(ocrCompareHtml.includes('for="requiredFilesInput"'), "one-click upload should use native label activation instead of JS-only click");
  assert(source.includes("bindNativeFilePickerLabel"), "file picker labels should prepare state without relying on JS click for mouse users");
  assert(source.includes('setStatus("上传 PDF", "busy"'));
  assert(source.includes('setStatus("渲染 PDF", "busy", file.name);'));
  assert(source.includes('setStatus("读取 MinerU", "busy", file.name);'));
  assert(source.includes('setStatus("读取 content_list", "busy", file.name);'));
}

{
  const batchUpload = JSON.parse(
    call(`(() => {
      const files = [
        { name: "book_content_list.json", type: "application/json" },
        { name: "origin.pdf", type: "application/pdf" },
        { name: "book_middle.json", type: "application/json" },
      ];
      const picked = identifyRequiredUploadFiles(files);
      const missing = identifyRequiredUploadFiles([{ name: "origin.pdf", type: "application/pdf" }]);
      return JSON.stringify({
        pdf: picked.pdf && picked.pdf.name,
        mineru: picked.mineru && picked.mineru.name,
        contentList: picked.contentList && picked.contentList.name,
        missingMineru: missing.mineru === null,
        missingContentList: missing.contentList === null,
      });
    })()`),
  );
  assert.strictEqual(batchUpload.pdf, "origin.pdf");
  assert.strictEqual(batchUpload.mineru, "book_middle.json");
  assert.strictEqual(batchUpload.contentList, "book_content_list.json");
  assert.strictEqual(batchUpload.missingMineru, true);
  assert.strictEqual(batchUpload.missingContentList, true);
}

{
  const mineruUploadSource = source.slice(
    source.indexOf("async function loadMineruFile"),
    source.indexOf("async function loadContentListFile"),
  );
  const contentListUploadSource = source.slice(
    source.indexOf("async function loadContentListFile"),
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
assert(singleLineHtml.includes('class="math-display'), "single-line display math should render as display math");
assert(!singleLineHtml.includes("<p>$$"), "single-line display math should not render as raw paragraph text");
assert.strictEqual(call("rootHasMathContent({ textContent: 'plain OCR text' })"), false);
assert.strictEqual(call("rootHasMathContent({ textContent: 'formula $E=mc^2$' })"), true);

{
  const userCorrectedMathBlock = `For a compact binary system, the waveforms $\\tilde{h}^{j k}$ and $\\Psi$ are given to the required orders (Lang, 2014, 2015) by
$$\\tilde{h}^{j k} = 4 ( 1 - \\zeta ) \\frac{\\eta m}{R} \\left( v^{j} v^{k} - \\frac{\\mathcal{G} m}{r} n^{j} n^{k} \\right),\\tag{11.115} $$
where $\\mathcal{G} = 1 - \\zeta + \\zeta \\left( 1 -2 s_{1} \\right) \\left( 1 -2 s_{2} \\right)$ [see Eq. (10.65)], and
$$\\Psi = 2 \\mathcal{G}^{1 / 2} \\frac{\\zeta \\eta m}{R} \\left[ \\Psi_{-0.5 \\mathrm{PN}} + \\Psi_{0 \\mathrm{PN}} + \\Psi_{+0.5 \\mathrm{PN}} \\right],\\tag{11.116}$$
where
$$
\\begin{aligned}
\\Psi_{-0.5 \\mathrm{PN}} = & 2 \\mathcal{S}_{-} \\boldsymbol{N} \\cdot \\boldsymbol{v} \\\\
\\Psi_{0 \\mathrm{PN}} = & - \\left( \\mathcal{S}_{+} + \\Delta \\mathcal{S}_{-} \\right) \\left[ \\frac{1}{2} v^{2} - ( \\boldsymbol{N} \\cdot \\boldsymbol{v} )^{2} + \\frac{\\mathcal{G} m}{r} ( \\boldsymbol{N} \\cdot \\boldsymbol{n} )^{2} \\right] \\\\
& -2 \\frac{\\mathcal{G} m}{r} \\left[ \\mathcal{S}_{+} - \\frac{4}{\\bar{\\gamma}} \\left( \\mathcal{S}_{+} \\bar{\\beta}_{+} + \\mathcal{S}_{-} \\bar{\\beta}_{-} \\right) \\right]
\\end{aligned}
$$`;
  const cleaned = call(`cleanMathpixEditableMarkdown(${JSON.stringify(userCorrectedMathBlock)})`);
  const html = call(`renderBlockContent(${JSON.stringify(userCorrectedMathBlock)}, { kind: "text", blockIndex: "user-corrected-math" })`);
  assert(
    cleaned.includes(
      "where $\\mathcal{G} = 1 - \\zeta + \\zeta \\left(1 -2 s_{1} \\right) \\left(1 -2 s_{2} \\right)$ [see Eq. (10.65)], and",
    ),
    "manual corrected inline math sentence should keep prose spacing outside $...$",
  );
  assert(html.includes("For a compact binary system, the waveforms"), "manual corrected math block should preserve first-line prose spacing");
  assert(html.includes("<p>where $\\mathcal{G}"), "inline where sentence should render as a paragraph, not a display equation");
  assert(html.includes("where $\\mathcal{G}"), "manual corrected math block should keep a space before inline math");
  assert(html.includes("$ [see Eq. (10.65)], and"), "manual corrected math block should keep a space before equation references");
  assert(html.includes('class="math-display'), "manual corrected math block should render display formulas as display blocks");
  assert(html.includes("math-display-equation-tag"), "manual corrected math block should expose equation-number labels outside LaTeX");
  assert(html.includes("(11.115)") && html.includes("(11.116)"), "manual corrected math block should show both equation labels");
  assert(!html.includes("\\\\tag{11.115}") && !html.includes("\\\\tag{11.116}"), "manual corrected math block should strip raw LaTeX tags from visible math source");
  assert(!html.includes("Foracompactbinarysystem"), "manual corrected math block should not show stale collapsed prose");
  assert(!html.includes("where$"), "manual corrected math block should not collapse text into inline math delimiters");
  assert(!html.includes("$[seeEq."), "manual corrected math block should not collapse equation reference spacing");
  assert(!html.includes(")],and"), "manual corrected math block should not collapse punctuation and prose after inline math");
  assert(!html.includes('<div class="math-display-formula">$$\nwhere $'), "inline where sentence should not be collected into the following display math");
  assert(!html.includes("<p>$$"), "manual corrected math block should not render display delimiters as paragraph text");
}

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
  assert(source.includes("pdfDocumentId"), "frontend should keep a server-side PDF document id after the first preview request");
  assert(source.includes("payload.documentId = state.pdfDocumentId"), "page preview requests should reuse documentId instead of reposting the PDF");
  assert(source.includes("rememberPdfDocumentId(response)"), "preview responses should refresh the cached PDF document id");
  assert(source.includes("waitForNextPaint()"), "one-click upload should paint busy status before slow remote upload work starts");
  assert(source.includes("PDF_UPLOAD_CHUNK_SIZE"), "remote PDF upload should be chunked instead of sending one large JSON dataUrl");
  assert(source.includes("/api/ocr/upload-document-chunk"), "frontend should upload the PDF document before requesting rendered pages");
  assert(source.includes("state.pdfDataUrl = \"\";"), "chunk upload path should not keep the full PDF base64 in browser state");
  assert(source.includes("hasPdfSource()"), "PDF-dependent controls should work with either documentId or legacy dataUrl");
  assert(source.includes('input.addEventListener("input", run);'), "file inputs should handle browsers that fire input instead of change");
  assert(source.includes("shouldSkipDuplicateFileInputEvent"), "input/change duplicate events should not double-upload files");
  assert(source.includes("等待选择所需文件"), "one-click upload should show a visible waiting state before the picker returns");
  assert(source.includes('setStatus("已选择文件", "busy"'), "one-click upload should show selected file names immediately after selection");
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

const mathpixScientificTable = prepareMathpix([
  "| Constant | Limit |",
  "| --- | --- |",
  "| Weak interaction constant | <1 × 10-11 |",
  "| Re decay | <3.4 × 10^ -16 yr^ -1 |",
  "| Fine structure | <1.2 × 10 -16 |",
].join("\n"));
assert(mathpixScientificTable.includes("× 10^{-11}"), "Mathpix table cleanup should normalize compact negative powers");
assert(mathpixScientificTable.includes("× 10^{-16}"), "Mathpix table cleanup should normalize spaced caret powers");
assert(mathpixScientificTable.includes("yr^{-1}"), "Mathpix table cleanup should normalize inverse year units");

const proseWithDanglingMathpixTag = prepareMathpix(
  "Return to the terms in I_NG, in Eq. (2.62), that depend on the first-order displacements. The resulting restricted proof was first formulated by Lightman and Lee (1973).\\tga{2.62}"
);
assert(!proseWithDanglingMathpixTag.includes("\\tga{2.62}"), "Mathpix prose cleanup should drop typo dangling equation tags");
assert(!proseWithDanglingMathpixTag.includes("\\tag{2.62}"), "Mathpix prose cleanup should drop dangling equation tags outside display math");
const editableProseWithDanglingTag = call(`cleanMathpixEditableMarkdown(${JSON.stringify(
  "Return to the terms in I_NG, in Eq. (2.62), that depend on the first-order displacements.\\tag{2.62}",
)})`);
assert(!editableProseWithDanglingTag.includes("\\tag{2.62}"), "editable Mathpix prose cleanup should drop dangling equation tags");
const displayMathTagPreserved = prepareMathpix("$$\nE = mc^2\\tag{2.62}\n$$");
assert(displayMathTagPreserved.includes("\\tag{2.62}"), "Mathpix cleanup should preserve legitimate display math tags");

assert.strictEqual(prepareMathpix("   "), "", "prepareMathpixMarkdown should tolerate empty Mathpix output");

const latexTable = "\\begin{tabular}{cc}\na & b \\\\ c & d\n\\end{tabular}";
const bareTableHtml = call(`renderMarkdownHtml(normalizeMathMarkdown(${JSON.stringify(latexTable)}))`);
const wrappedTableHtml = call(`renderMarkdownHtml(normalizeMathMarkdown(${JSON.stringify(`$$\n${latexTable}\n$$`)}))`);
assert(bareTableHtml.includes("latex-table-wrap"), "bare LaTeX table should render as a table");
assert(wrappedTableHtml.includes("latex-table-wrap"), "display-wrapped LaTeX table should render as a table");

{
  const htmlTableWithAttributeText = '<table><tr><th><span data-content="Star"></span></th><th><img alt="a (a.u)"></th></tr><tr><td>S2</td><td><span aria-label="1020 ± 8"></span></td></tr></table>';
  const markdown = call(`htmlTableToMarkdown(${JSON.stringify(htmlTableWithAttributeText)})`);
  assert(markdown.includes("| Star | a (a.u) |"), "HTML table conversion should preserve cell text stored in data-content/alt attributes");
  assert(markdown.includes("| S2 | 1020 ± 8 |"), "HTML table conversion should preserve cell text stored in aria-label attributes");
}

{
  const tableWithTrailingText = {
    type: "table",
    lines: [
      {
        spans: [
          {
            html: "<table><tr><th>Star</th><th>a</th></tr><tr><td>S2</td><td>1020</td></tr></table>"
          }
        ]
      },
      {
        spans: [
          {
            content: "rather to provide the first test of the black hole no-hair theorem."
          }
        ]
      }
    ]
  };
  const markdown = call(`blockToMarkdown(${JSON.stringify(tableWithTrailingText)})`);
  assert(markdown.includes("| Star | a |"), "table markdown should preserve the table body");
  assert(markdown.includes("rather to provide the first test"), "table markdown should preserve prose after the table");
}

{
  const tableWithOuterCaption = {
    type: "table",
    lines: [
      {
        spans: [
          {
            html: '<div>Table 12.3 Orbital parameters of selected stars orbiting the galactic center black hole SgrA*. Data taken from Gillessen et al. (2009) and Meyer et al. (2012).</div><table><tr><th>Star</th><th>a (a.u)</th></tr><tr><td>S2</td><td>1020 ± 8</td></tr></table>'
          }
        ]
      }
    ]
  };
  const markdown = call(`blockToMarkdown(${JSON.stringify(tableWithOuterCaption)})`);
  assert(markdown.includes("Table 12.3 Orbital parameters"), "table markdown should preserve text next to the table title");
  assert(markdown.includes("| Star | a (a.u) |"), "table markdown should still preserve the table body after keeping caption text");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.contentListItems = [
        {
          page_idx: 0,
          type: "table",
          bbox: [40, 90, 860, 230],
          table_caption: "Table 12.3 Orbital parameters of selected stars orbiting the galactic center black hole Sgr A*. Data taken from Gillessen et al. (2009) and Meyer et al. (2012)."
        }
      ];
      state.mineruInfo = {
        pdf_info: [
          {
            page_size: [900, 1200],
            para_blocks: [
              {
                type: "text",
                bbox: [70, 540, 830, 700],
                lines: [{ bbox: [70, 540, 830, 560], spans: [{ content: "To see how such a test might be carried out, we work in the post-Newtonian limit." }] }]
              },
              {
                type: "table",
                bbox: [45, 100, 850, 250],
                lines: [
                  { bbox: [45, 100, 850, 120], spans: [{ content: "Table12.3" }] },
                  { bbox: [45, 130, 850, 250], spans: [{ html: "<table><tr><th>Star</th><th>a</th></tr><tr><td>S2</td><td>1020</td></tr></table>" }] }
                ]
              },
              {
                type: "text",
                bbox: [70, 300, 830, 395],
                lines: [{ bbox: [70, 300, 830, 330], spans: [{ content: "rather to provide the first test of the black hole no-hair uniqueness theorems of general relativity." }] }]
              }
            ]
          }
        ]
      };
      const entries = reviewBlockMarkdownsForPage(1);
      return JSON.stringify(entries.map((entry) => entry.markdown));
    })()`),
  );
  assert(result[0].includes("Table 12.3 Orbital parameters"), "review table blocks should recover long same-label captions from content_list");
  assert(result[1].startsWith("rather to provide the first test"), "review blocks should follow visual bbox order instead of raw MinerU block order");
  assert(result[2].startsWith("To see how such a test"), "lower text should stay after the visually higher table-following paragraph");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.contentListItems = [];
      state.mineruInfo = {
        pdf_info: [
          {
            page_size: [900, 1200],
            para_blocks: [
              {
                type: "text",
                bbox: [70, 18, 830, 175],
                lines: [{ bbox: [70, 18, 830, 175], spans: [{ content: "In a similar manner, reanalyses gave the bound. The current best bounds are summarized in Table 2.2." }] }]
              },
              {
                type: "table",
                bbox: [45, 42, 850, 255],
                lines: [
                  { bbox: [45, 42, 850, 60], spans: [{ content: "Table 2.2 Bounds on variation of constants" }] },
                  { bbox: [45, 80, 850, 255], spans: [{ html: "<table><tr><th>Constant</th><th>Limit</th></tr><tr><td>Weak interaction</td><td>&lt;1 × 10-11</td></tr></table>" }] }
                ]
              }
            ]
          }
        ]
      };
      return JSON.stringify(reviewBlockMarkdownsForPage(1).map((entry) => entry.markdown));
    })()`),
  );
  assert(result[0].includes("Table 2.2"), "a page-top table should stay before a prose block that references the same table when OCR bbox is wrong");
  assert(result[1].startsWith("In a similar manner"), "table-following prose should not be promoted ahead of the page-top table");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.contentListItems = [];
      state.mineruInfo = {
        pdf_info: [
          {
            page_size: [900, 1200],
            para_blocks: [
              {
                type: "text",
                bbox: [70, 12, 830, 175],
                lines: [{ bbox: [70, 12, 830, 175], spans: [{ content: "In a similar manner, reanalyses gave the bound. The current best bounds are summarized in Table 2.2." }] }]
              },
              {
                type: "table",
                bbox: [45, 42, 850, 255],
                lines: [
                  { bbox: [45, 80, 850, 255], spans: [{ html: "<table><tr><th>Constant</th><th>Limit</th></tr><tr><td>Weak interaction</td><td>&lt;1 × 10-11</td></tr></table>" }] }
                ]
              }
            ]
          }
        ]
      };
      return JSON.stringify(reviewBlockMarkdownsForPage(1).map((entry) => entry.markdown));
    })()`),
  );
  assert(result[0].includes("| Constant | Limit |"), "a page-top table without recovered caption should still stay before prose that references a table");
  assert(result[1].startsWith("In a similar manner"), "captionless page-top table should not be displaced by table-referencing prose");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.contentListItems = [
        {
          page_idx: 0,
          type: "discarded",
          bbox: [110, 28, 290, 52],
          text: "2.$ The TH#μ Formalism"
        },
        {
          page_idx: 0,
          type: "discarded",
          bbox: [70, 820, 830, 910],
          text: "Table 2.2 In a similar manner, reanalyses of decay rates gave the bound on variation of constants."
        }
      ];
      state.mineruInfo = {
        pdf_info: [
          {
            page_size: [900, 1200],
            para_blocks: [
              {
                type: "title",
                bbox: [70, 260, 650, 310],
                lines: [{ bbox: [70, 260, 650, 310], spans: [{ content: "2.5 The THεμ Formalism" }] }]
              },
              {
                type: "table",
                bbox: [45, 100, 850, 250],
                lines: [
                  { bbox: [45, 100, 850, 120], spans: [{ content: "Table 2.2 Bounds on variation of constants" }] },
                  { bbox: [45, 130, 850, 250], spans: [{ html: "<table><tr><th>Constant</th><th>Limit</th></tr><tr><td>alpha</td><td>10</td></tr></table>" }] }
                ]
              }
            ]
          }
        ]
      };
      return JSON.stringify(detectContentListRiskCandidatesForPage(1).map((risk) => risk.text));
    })()`),
  );
  assert(!result.some((text) => text.includes("TH#μ Formalism")), "content_list page header/footer noise should not enter review blocks");
  assert(result.some((text) => text.includes("reanalyses of decay rates")), "content_list useful supplemental prose should remain available");
}

const latexArray = "\\begin{array}{cc}\na & b \\\\ c & d\n\\end{array}";
const arrayHtml = call(`renderMarkdownHtml(normalizeMathMarkdown(${JSON.stringify(latexArray)}))`);
assert(arrayHtml.includes('class="math-display'), "bare array environments should render as display math");
const wrappedArrayHtml = call(`renderMarkdownHtml(normalizeMathMarkdown(${JSON.stringify(`$$\\n${latexArray}\\n$$`)}))`);
assert(wrappedArrayHtml.includes('class="math-display'), "explicitly wrapped array should render as display math");

const explicitArrayFromBlock = call(`renderBlockContent(${JSON.stringify(`$$\\n\\begin{array}{cc}\\n a & b \\\\ c & d \\n\\end{array}\\n$$`)}, { blockIndex: "0", kind: "text" })`);
assert(explicitArrayFromBlock.includes('class="math-display'), "array blocks from block content should render in page canvas");

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
      state.liveReviewDrafts.clear();
      state.reviewNeedsCorrection.clear();
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
  assert(parsed.draftHtml.includes('data-revert-mathpix-block-edit="3"'), "Mathpix draft edits should expose an explicit undo action");
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
  assert(source.includes("Mathpix 未配置：请设置 MATHPIX_APP_ID/MATHPIX_APP_KEY 后重启服务。"));
  assert(ocrCompareCss.includes(".review-block-error"));
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
      const statusBadge = { textContent: "", className: "", title: "" };
      els.statusBadge = statusBadge;
      state.currentPage = 1;
      state.busy = false;
      state.mathpixConfigured = false;
      state.mathpixConfigError = "";
      state.pdfDataUrl = "";
      state.mineruInfo = null;
      state.mathpixBlockErrors.clear();
      recognizeRiskBlockWithMathpix("0");
      const risk = {
        blockIndex: "0",
        bbox: [0, 0, 100, 50],
        pageSize: [100, 100],
        reasons: ["display_math_block"],
      };
      const segment = { blockIndex: "0", markdown: "$$\\\\nE=mc^2\\\\n$$", kind: "interline_equation" };
      const html = renderReviewItem(segment, risk, "", false, "", null, { mathpixError: getMathpixBlockError(1, "0") });
      const payload = {
        statusText: statusBadge.textContent,
        statusTitle: statusBadge.title,
        error: getMathpixBlockError(1, "0"),
        html,
      };
      state.mathpixConfigError = "MATHPIX_APP_ID/MATHPIX_APP_KEY 仍是占位符，请替换为真实 Mathpix 凭据。";
      recognizeRiskBlockWithMathpix("1");
      const invalidConfigRisk = {
        blockIndex: "1",
        bbox: [0, 0, 100, 50],
        pageSize: [100, 100],
        reasons: ["display_math_block"],
      };
      const invalidConfigHtml = renderReviewItem(
        { blockIndex: "1", markdown: "$$\\\\na=b\\\\n$$", kind: "interline_equation" },
        invalidConfigRisk,
        "",
        false,
        "",
        null,
        { mathpixError: getMathpixBlockError(1, "1") },
      );
      const invalidConfigError = getMathpixBlockError(1, "1");
      state.mathpixConfigured = null;
      state.mathpixConfigError = "";
      state.mathpixBlockErrors.clear();
      return JSON.stringify({ ...payload, invalidConfigHtml, invalidConfigError });
    })()`),
  );
  assert.strictEqual(result.statusText, "Mathpix 未配置");
  assert(result.statusTitle.includes("MATHPIX_APP_ID"));
  assert(result.error.includes("MATHPIX_APP_ID"));
  assert(result.html.includes("Mathpix 未配置"));
  assert(result.html.includes("review-block-error"));
  assert(result.invalidConfigError.includes("占位符"));
  assert(result.invalidConfigHtml.includes("Mathpix 配置无效"));
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
      state.reviewNeedsCorrection.clear();
      state.reviewNeedsCorrection.add("1:0");
      applyMathpixBlockEdit("0", trigger);
      const preview = buildAcceptedPatchPreviewForPage(1);
      const needsNav = renderReviewNavigationBar(reviewEntriesForCurrentPage());
      return JSON.stringify({
        patches: state.ocrPatches.map((patch) => ({
          patchId: patch.patchId,
          source: patch.source,
          status: patch.status,
          newText: patch.newText,
          replacedByPatchId: patch.metadata?.replacedByPatchId || ""
        })),
        draftExists: getMathpixBlockDrafts(1, false).has("0"),
        needsRemaining: Array.from(state.reviewNeedsCorrection),
        needsNav,
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
  assert.deepStrictEqual(result.needsRemaining, [], "saving an accepted edit should clear the extra-correction marker");
  assert(result.needsNav.includes("待校正 0"), "needs-correction nav count should decrement after saving an accepted edit");
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
      state.liveReviewDrafts.clear();
      state.reviewNeedsCorrection.clear();
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
      state.currentPage = 1;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            page_size: [919, 1256],
            para_blocks: [
              {
                type: "text",
                bbox: [40, 100, 840, 360],
                lines: [
                  { bbox: [44, 100, 835, 126], spans: [{ bbox: [44, 100, 835, 126], content: "For the quadrupole precessions to be observable, it is clear that the black hole must have" }] },
                  { bbox: [44, 128, 835, 154], spans: [{ bbox: [44, 128, 835, 154], content: "a decent angular momentum and that the star must be in a short-period high-" }] },
                  { bbox: [44, 156, 835, 182], spans: [{ bbox: [44, 156, 835, 182], content: "eccentricity orbit. For example, the three amplitudes listed in Eq. (12.71) have" }] },
                  { bbox: [44, 184, 835, 210], spans: [{ bbox: [44, 184, 835, 210], content: "the values 5200, 195 and 8 microseconds per year, respectively." }] },
                  { bbox: [82, 228, 835, 254], spans: [{ bbox: [82, 228, 835, 254], content: "Although the pericenter advance is the largest relativistic orbital effect, it is not the most" }] },
                  { bbox: [44, 256, 835, 282], spans: [{ bbox: [44, 256, 835, 282], content: "suitable effect for testing the no-hair theorems." }] }
                ]
              }
            ]
          }
        ]
      };
      const directSourceMarkdown = blockToMarkdown(state.mineruInfo.pdf_info[0].para_blocks[0]);
      const correctedMarkdown = autoCorrectPlainMineruMarkdown(directSourceMarkdown);
      const automaticCount = applyAutomaticLocalCorrectionsForPage(1);
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify({
        directSourceMarkdown,
        correctedMarkdown,
        automaticCount,
        patches: state.ocrPatches.map((patch) => ({ status: patch.status, newText: patch.newText, autoCorrection: patch.metadata?.autoCorrection || "" })),
        preview
      });
    })()`),
  );
  assert(result.directSourceMarkdown.includes("respectively.\n\nAlthough"), "visual indentation should become a markdown paragraph break before cleanup");
  assert(result.correctedMarkdown.includes("respectively.\n\nAlthough"), "plain text cleanup should preserve visual paragraph boundaries");
  assert.strictEqual(result.automaticCount, 1, "visual paragraph boundary cleanup should create one accepted patch");
  assert(result.patches.some((patch) => patch.status === "accepted" && patch.newText.includes("respectively.\n\nAlthough")), "accepted patch should keep the paragraph break");
  assert(result.preview.markdown.includes("respectively.\n\nAlthough"), "accepted preview/download source should keep the paragraph break");
}

{
  const continuousBlock = {
    type: "text",
    bbox: [40, 100, 840, 240],
    lines: [
      { bbox: [44, 100, 835, 126], spans: [{ bbox: [44, 100, 835, 126], content: "This paragraph uses ordinary wrapped lines that should remain part of the" }] },
      { bbox: [44, 128, 835, 154], spans: [{ bbox: [44, 128, 835, 154], content: "same paragraph even though the previous line did not end the idea." }] }
    ]
  };
  const markdown = call(`blockToMarkdown(${JSON.stringify(continuousBlock)})`);
  assert(!markdown.includes("\n\n"), "ordinary wrapped prose should not receive a paragraph break");
}

{
  const misclassifiedCodeBlock = {
    type: "code",
    bbox: [120, 140, 780, 720],
    lines: [
      { spans: [{ content: "For example, the gravitational redshift of spectra of the stars S2 and S102 will be detectable" }] },
      { spans: [{ content: "during their next pericenter passages. In general relativity, the leading contribution to the" }] },
      { spans: [{ content: "pericenter advance rate is given by" }] },
      { spans: [{ content: "\\dot{\\omega}_{\\mathrm{proj}} = 98.3 \\, \\mu \\mathrm{as} \\, \\mathrm{yr}^{-1} \\left( \\frac{1 \\mathrm{yr}}{P_b} \\right) \\frac{\\cos \\iota}{1 \\mp e}," }] },
      { spans: [{ content: "where the minus sign now corresponds to a measurement at apocenter. For S2 and S102, the rates are potentially observable." }] }
    ]
  };
  const markdown = call(`blockToMarkdown(${JSON.stringify(misclassifiedCodeBlock)})`);
  assert(!markdown.includes("```"), "science prose misclassified as code should render as Markdown, not a fenced code block");
  assert(markdown.includes("\\dot{\\omega}_{\\mathrm{proj}}"), "misclassified prose should keep the LaTeX formula source");
  const html = call(`renderBlockContent(${JSON.stringify(markdown)}, { kind: "text", blockIndex: "misclassified-code" })`);
  assert(!html.includes("<pre><code"), "science prose misclassified as code should not render as a code block");
  assert(html.includes('class="math-display'), "the formula line in misclassified prose should render as display math");
}

{
  const realCodeBlock = {
    type: "code",
    lines: [
      { spans: [{ content: "function add(a, b) {" }] },
      { spans: [{ content: "  return a + b;" }] },
      { spans: [{ content: "}" }] }
    ]
  };
  const markdown = call(`blockToMarkdown(${JSON.stringify(realCodeBlock)})`);
  assert(markdown.startsWith("```"), "real code blocks should still be fenced");
}

{
  const codeFencedProse = [
    "```",
    "For detailed reviews of strong-field tests of GR involving neutron stars and black holes",
    "using electromagnetic observations, see Psaltis (2008) and Johannsen (2016).",
    "### 12.4 Cosmological Tests",
    "From a few seconds after the Big Bang until the present, the underlying physics of",
    "the universe is well understood in terms of a standard model of a nearly spatially flat",
    "universe, 13.6 billion years old, dominated by cold dark matter and dark energy.",
    "```"
  ].join("\n");
  const result = JSON.parse(
    call(`(() => {
      const converted = convertCodeLikeMarkdownToPlainMarkdown(${JSON.stringify(codeFencedProse)});
      const canConvert = canConvertCodeLikeMarkdownToPlainMarkdown(${JSON.stringify(codeFencedProse)}, { kind: "code" });
      state.currentPage = 1;
      state.reviewActionsOpen.clear();
      const closedHtml = renderPageReviewCanvas([
        {
          key: "0",
          displayIndex: 1,
          segment: { blockIndex: "0", markdown: ${JSON.stringify(codeFencedProse)}, kind: "code", bbox: [10, 20, 180, 220], pageSize: [200, 300] },
          risk: { pageNumber: 1, blockIndex: "0", bbox: [10, 20, 180, 220], pageSize: [200, 300], text: ${JSON.stringify(codeFencedProse)}, reasons: [], reviewOnly: true }
        }
      ]);
      state.reviewActionsOpen.add("1:0");
      const openHtml = renderPageReviewCanvas([
        {
          key: "0",
          displayIndex: 1,
          segment: { blockIndex: "0", markdown: ${JSON.stringify(codeFencedProse)}, kind: "code", bbox: [10, 20, 180, 220], pageSize: [200, 300] },
          risk: { pageNumber: 1, blockIndex: "0", bbox: [10, 20, 180, 220], pageSize: [200, 300], text: ${JSON.stringify(codeFencedProse)}, reasons: [], reviewOnly: true }
        }
      ]);
      return JSON.stringify({ converted, canConvert, closedHtml, openHtml });
    })()`),
  );
  assert.strictEqual(result.canConvert, true, "natural-language fenced code should be eligible for one-click conversion");
  assert(!result.converted.includes("```"), "conversion should remove fenced code markers");
  assert(result.converted.includes("For detailed reviews"), "conversion should preserve prose content");
  assert(result.converted.includes("### 12.4 Cosmological Tests"), "conversion should preserve markdown headings");
  assert(!result.closedHtml.includes('data-convert-code-block="0"'), "conversion action should stay hidden until block actions are opened");
  assert(result.openHtml.includes('data-convert-code-block="0"'), "opened block actions should expose a code-to-text conversion button");
  assert.strictEqual(call(`canConvertCodeLikeMarkdownToPlainMarkdown(${JSON.stringify("```\nfunction add(a, b) {\n  return a + b;\n}\n```")}, { kind: "code" })`), false, "real executable code should not expose the prose conversion action");
}

{
  const algorithmProse = [
    "For the quadrupole precessions to be observable, it is clear that the black hole must have",
    "a decent angular momentum and that the star must be in a short-period high-eccentricity orbit.",
    "Although the pericenter advance is the largest relativistic orbital effect, it is not the most",
    "suitable effect for testing the no-hair theorems."
  ].join("\n");
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.reviewActionsOpen.clear();
      const entry = {
        key: "algo-9-10",
        displayIndex: 9,
        segment: { blockIndex: "algo-9-10", markdown: ${JSON.stringify(algorithmProse)}, kind: "algorithm", bbox: [10, 20, 180, 220], pageSize: [200, 300] },
        risk: { pageNumber: 1, blockIndex: "algo-9-10", bbox: [10, 20, 180, 220], pageSize: [200, 300], text: ${JSON.stringify(algorithmProse)}, reasons: [], reviewOnly: true }
      };
      const closedHtml = renderPageReviewCanvas([entry]);
      state.reviewActionsOpen.add("1:algo-9-10");
      const openHtml = renderPageReviewCanvas([entry]);
      const converted = convertCodeLikeMarkdownToPlainMarkdown(${JSON.stringify(algorithmProse)});
      return JSON.stringify({ closedHtml, openHtml, converted, rendered: renderBlockContent(${JSON.stringify(algorithmProse)}, entry.segment) });
    })()`),
  );
  assert(result.openHtml.includes('data-convert-code-block="algo-9-10"'), "natural-language algorithm blocks should expose the conversion button");
  assert(!result.closedHtml.includes('data-convert-code-block="algo-9-10"'), "algorithm conversion action should stay hidden until actions are opened");
  assert(!result.rendered.includes("algorithm-block"), "natural-language algorithm blocks should render as prose, not programming-style blocks");
  assert(result.converted.includes("black hole must have a decent angular momentum"), "algorithm prose conversion should merge OCR hard line breaks");
}

{
  const result = JSON.parse(
    call(`(() => {
      const entries = [
        {
          block: { type: "text" },
          blockIndex: 9,
          bbox: [40, 200, 820, 260],
          markdown: "For the quadrupole precessions to be observable, it is clear that the black hole must have a decent angular momentum."
        },
        {
          block: { type: "text" },
          blockIndex: 10,
          bbox: [40, 270, 820, 330],
          markdown: "Although the pericenter advance is the largest relativistic orbital effect, it is not the most suitable effect."
        }
      ];
      const segments = segmentEntries(entries);
      return JSON.stringify({
        start: isAlgorithmStartEntry(entries[0]),
        kinds: segments.map((segment) => segment.kind),
        blockIndexes: segments.map((segment) => segment.blockIndex)
      });
    })()`),
  );
  assert.strictEqual(result.start, false, "ordinary prose beginning with 'For the' should not start an algorithm block");
  assert.deepStrictEqual(result.kinds, ["text", "text"], "ordinary prose should remain normal text segments");
  assert.deepStrictEqual(result.blockIndexes, ["9", "10"], "ordinary prose blocks should not be merged into an algo-* segment");
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
  const hardWrappedProse = [
    "companion that were considered early on were a helium main-sequence star, a white dwarf,",
    "a neutron star and a black hole. Any of these would be consistent with the evolutionary",
    "models for binary systems of two massive stars that were popular at the time. In these",
    "models, one massive star evolves more rapidly, undergoing a supernova explosion and",
    "leaving a neutron star remnant."
  ].join("\n");
  const result = JSON.parse(
    call(`(() => {
      const source = ${JSON.stringify(hardWrappedProse)};
      return JSON.stringify({
        cleaned: cleanMathpixEditableMarkdown(source),
        rendered: renderBlockContent(source, { kind: "text", blockIndex: "hard-wrapped-prose" })
      });
    })()`),
  );
  assert(result.cleaned.includes("white dwarf, a neutron star"), "editable cleanup should merge artificial OCR prose line breaks");
  assert(result.cleaned.includes("evolutionary models for binary systems"), "editable cleanup should keep continuous prose on one line");
  assert(!result.cleaned.includes("white dwarf,\\na neutron"), "editable cleanup should remove hard OCR line breaks inside one paragraph");
  assert(!result.rendered.includes("<br>"), "rendered prose should not preserve artificial OCR line breaks");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.liveReviewDrafts.clear();
      state.reviewNeedsCorrection.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            page_size: [900, 1200],
            para_blocks: [
              {
                type: "text",
                bbox: [70, 650, 830, 676],
                lines: [{ bbox: [70, 650, 830, 676], spans: [{ bbox: [70, 650, 830, 676], content: "where $\\\\Phi_c$ is a constant. Thus we have an accurate prediction" }] }]
              },
              {
                type: "text",
                bbox: [70, 678, 830, 704],
                lines: [{ bbox: [70, 678, 830, 704], spans: [{ bbox: [70, 678, 830, 704], content: "(under the chosen" }] }]
              },
              {
                type: "text",
                bbox: [70, 706, 830, 732],
                lines: [{ bbox: [70, 706, 830, 732], spans: [{ bbox: [70, 706, 830, 732], content: "assumptions) for the gravitational-wave signal at the detector." }] }]
              },
              {
                type: "text",
                bbox: [92, 770, 830, 796],
                lines: [{ bbox: [92, 770, 830, 796], spans: [{ bbox: [92, 770, 830, 796], content: "This indented sentence starts a new visual paragraph." }] }]
              }
            ]
          }
        ]
      };
      els.statusBadge = { textContent: "", className: "" };
      const segmentsBeforePatch = reviewSegmentsForPage(1);
      const mergedSegment = segmentsBeforePatch[0];
      const rendered = renderBlockContent(mergedSegment.markdown, mergedSegment);
      const automaticCount = applyAutomaticLocalCorrectionsForPage(1);
      const segmentsAfterPatch = reviewSegmentsForPage(1);
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify({
        blockIndexes: segmentsBeforePatch.map((segment) => segment.blockIndex),
        mergedMarkdown: mergedSegment.markdown,
        rendered,
        automaticCount,
        patches: state.ocrPatches.map((patch) => ({
          blockId: patch.blockId,
          status: patch.status,
          newText: patch.newText,
          autoCorrection: patch.metadata?.autoCorrection || ""
        })),
        override: getBlockOverrides(1, false).get("merged-0-2"),
        blockIndexesAfterPatch: segmentsAfterPatch.map((segment) => segment.blockIndex),
        previewMarkdown: preview.markdown
      });
    })()`),
  );
  assert.deepStrictEqual(result.blockIndexes, ["merged-0-2", "3"], "visually adjacent prose fragments should become one review segment while a new indented paragraph stays separate");
  assert(result.mergedMarkdown.includes("prediction\n(under the chosen\nassumptions)"), "merged prose segment should keep source block boundaries for patch generation");
  assert(!result.rendered.includes("<br>"), "merged prose render should not expose artificial block-boundary line breaks");
  assert(result.rendered.includes("(under the chosen assumptions)"), "merged prose render should read as a continuous paragraph");
  assert.strictEqual(result.automaticCount, 1, "merged prose should still be corrected through an accepted OcrPatch");
  assert(result.patches.some((patch) => patch.blockId.includes("_bmerged-0-2_") && patch.status === "accepted" && patch.autoCorrection === "plain_text_cleanup"), "merged prose cleanup should create an accepted patch for the merged review block");
  assert(result.override.includes("(under the chosen assumptions)"), "merged prose accepted override should be unwrapped");
  assert.deepStrictEqual(result.blockIndexesAfterPatch, ["merged-0-2", "3"], "accepted merged prose patch should not break review segmentation");
  assert(result.previewMarkdown.includes("where $\\Phi_c$ is a constant. Thus we have an accurate prediction (under the chosen assumptions)"), "accepted preview should use the unwrapped merged prose patch");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.liveReviewDrafts.clear();
      state.reviewNeedsCorrection.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            page_size: [900, 1200],
            para_blocks: [
              {
                type: "text",
                bbox: [70, 650, 830, 676],
                lines: [{ bbox: [70, 650, 830, 676], spans: [{ bbox: [70, 650, 830, 676], content: "to show that the equation takes the form □Ψ = -8πζρ*(1 - 2s), where the sensitivity" }] }]
              },
              {
                type: "text",
                bbox: [70, 678, 830, 704],
                lines: [{ bbox: [70, 678, 830, 704], spans: [{ bbox: [70, 678, 830, 704], content: "arises from the derivative ∂T/∂ϕ." }] }]
              }
            ]
          }
        ]
      };
      const originalSegment = reviewSegmentsForPage(1)[0];
      const patchResult = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: originalSegment.markdown,
        newText: "to show that the equation takes the form $\\\\Box\\\\Psi = -8\\\\pi\\\\zeta\\\\rho^*(1 - 2s)$, where the sensitivity",
        source: "human"
      });
      updateOcrPatchStatus(patchResult.patch.patchId, "accepted");
      getBlockOverrides(1).set("0", patchResult.normalizedText);
      const segments = reviewSegmentsForPage(1);
      const entries = buildReviewEntriesForPage([], segments, 1);
      const html = renderPageReviewCanvas(entries);
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify({
        blockIndexes: segments.map((segment) => segment.blockIndex),
        html,
        previewMarkdown: preview.markdown
      });
    })()`),
  );
  assert.deepStrictEqual(result.blockIndexes, ["0", "1"], "blocks with existing accepted human edits must not be merged into a new block key");
  assert(result.html.includes("$\\Box\\Psi"), "existing accepted human edit should remain visible in the review page");
  assert(!result.html.includes("form □Ψ"), "review page must not fall back to the uncorrected MinerU text when an accepted edit exists");
  assert(result.previewMarkdown.includes("$\\Box\\Psi"), "accepted preview should preserve the existing human edit");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.liveReviewDrafts.clear();
      state.reviewNeedsCorrection.clear();
      const source0 = "to show that the equation takes the form □Ψ = -8πζρ*(1 - 2s), where the sensitivity";
      const source1 = "arises from the derivative ∂T/∂ϕ.";
      const patchResult = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: source0,
        newText: "to show that the equation takes the form $\\\\Box\\\\Psi = -8\\\\pi\\\\zeta\\\\rho^{*}(1 - 2s)$, where the sensitivity",
        source: "human"
      });
      updateOcrPatchStatus(patchResult.patch.patchId, "accepted");
      getBlockOverrides(1).set("0", patchResult.normalizedText);
      const mergedEntry = {
        key: "merged-0-1",
        displayIndex: 1,
        segment: {
          blockIndex: "merged-0-1",
          blockIndexes: ["0", "1"],
          componentEntries: [
            { blockIndex: "0", markdown: source0, bbox: [70, 650, 830, 676], pageSize: [900, 1200] },
            { blockIndex: "1", markdown: source1, bbox: [70, 678, 830, 704], pageSize: [900, 1200] }
          ],
          markdown: source0 + "\\n" + source1,
          kind: "text",
          bbox: [70, 650, 830, 704],
          pageSize: [900, 1200],
          mergedPlainProse: true
        },
        risk: { pageNumber: 1, blockIndex: "merged-0-1", text: source0 + "\\n" + source1, reviewOnly: true }
      };
      const html = renderPageReviewCanvas([mergedEntry]);
      return JSON.stringify({ html });
    })()`),
  );
  assert(result.html.includes("$\\Box\\Psi"), "a stale merged block must render saved component-level accepted edits first");
  assert(!result.html.includes("form □Ψ"), "a stale merged block must not cover saved component edits with MinerU source text");
}

{
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression(["Assuming the 1σ bound of |η| < 2 × 10^{-13} from Eöt-Wash experiments"])}
      state.currentPage = 1;
      state.ocrPatches = [];
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.liveReviewDrafts.clear();
      const patchResult = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: "Assuming the 1σ bound of |η| < 2 × 10^{-13} from Eöt-Wash experiments",
        newText: "Assuming the 1σ bound of |η| < 2 × 10^{-13} from Eöt-Wash experiments (Wagner et al., 2012)",
        source: "human"
      });
      updateOcrPatchStatus(patchResult.patch.patchId, "accepted");
      getMathpixBlockDrafts(1).set("0", "Stale Mathpix draft should not own the color state");
      const html = renderPageReviewCanvas(reviewEntriesForCurrentPage());
      return JSON.stringify({ html });
    })()`),
  );
  assert(result.html.includes('data-review-item-state="corrected"'), "accepted corrections should own the review block color state");
  assert(result.html.includes("is-corrected"), "accepted corrections should render with corrected block styling");
  assert(!result.html.includes("Stale Mathpix draft should not own the color state"), "stale drafts should not replace accepted human edits");
}

{
  const sourceTable = "Table 2.1 Bounds on nA l parameters fromthe Eot-Wash experiments.\\n\\n| Energy type | Be-Ti | Be-A1 |\\n| --- | --- | --- |\\n| Strong | 4.9 ×10-11 | 6.5 ×10-11 |";
  const acceptedTable = "Table 2.1 Bounds on η^A parameters from the Eöt-Wash experiments.\\n\\n| Energy type | Be-Ti | Be-Al |\\n| --- | --- | --- |\\n| Strong | $4.9 \\\\times 10^{-11}$ | $6.5 \\\\times 10^{-11}$ |";
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression([sourceTable])}
      state.currentPage = 1;
      state.ocrPatches = [];
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.liveReviewDrafts.clear();
      const sourceTable = ${JSON.stringify(sourceTable)};
      const acceptedTable = ${JSON.stringify(acceptedTable)};
      const accepted = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: sourceTable,
        newText: acceptedTable,
        source: "human"
      }).patch;
      updateOcrPatchStatus(accepted.patchId, "accepted");
      const rejected = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: sourceTable,
        newText: "Rejected stale Mathpix table",
        source: "mathpix"
      }).patch;
      updateOcrPatchStatus(rejected.patchId, "rejected");
      state.reviewCorrectionOpen.add(reviewBlockKey(1, "0"));
      const latest = getLatestOcrPatchForBlock(1, "0", sourceTable);
      const html = renderPageReviewCanvas(reviewEntriesForCurrentPage());
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify({
        latestStatus: latest?.status || "",
        latestText: latest?.newText || "",
        html,
        previewMarkdown: preview.markdown
      });
    })()`),
  );
  assert.strictEqual(result.latestStatus, "accepted", "rejected Mathpix attempts must not hide the latest accepted table edit");
  assert(result.latestText.includes("$4.9 \\\\times 10^{-11}$"), "latest visible patch should keep the manually wrapped table value");
  assert(result.html.includes("4.9") && result.html.includes("times 10^{-11}"), "review source editor should load the accepted table Markdown after a rejected stale patch");
  assert(result.previewMarkdown.includes("$4.9 \\\\times 10^{-11}$"), "accepted preview should keep the manually wrapped table value");
  assert(!result.html.includes("Rejected stale Mathpix table"), "rejected Mathpix table text must not be visible");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.liveReviewDrafts.clear();
      state.reviewNeedsCorrection.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            page_size: [900, 1200],
            para_blocks: [
              {
                type: "text",
                bbox: [70, 650, 830, 676],
                lines: [{ bbox: [70, 650, 830, 676], spans: [{ bbox: [70, 650, 830, 676], content: "to show that the equation takes the form □Ψ = -8πζρ*(1 - 2s), where the sensitivity" }] }]
              },
              {
                type: "text",
                bbox: [70, 678, 830, 704],
                lines: [{ bbox: [70, 678, 830, 704], spans: [{ bbox: [70, 678, 830, 704], content: "arises from the derivative ∂T/∂ϕ." }] }]
              }
            ]
          }
        ]
      };
      els.statusBadge = { textContent: "", className: "" };
      const segments = reviewSegmentsForPage(1);
      const automaticCount = applyAutomaticLocalCorrectionsForPage(1);
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify({
        blockIndexes: segments.map((segment) => segment.blockIndex),
        canAuto: canAutoCorrectPlainMineruMarkdown(segments.map((segment) => segment.markdown).join("\\n")),
        automaticCount,
        patches: state.ocrPatches.map((patch) => ({ status: patch.status, source: patch.source, newText: patch.newText, autoCorrection: patch.metadata?.autoCorrection || "" })),
        previewMarkdown: preview.markdown
      });
    })()`),
  );
  assert.deepStrictEqual(result.blockIndexes, ["0", "1"], "plain-prose merge must not combine blocks that contain unwrapped scientific math symbols");
  assert.strictEqual(result.canAuto, false, "unwrapped scientific math symbols should not be treated as safe plain-text cleanup");
  assert.strictEqual(result.automaticCount, 1, "known scalar-wave Box OCR should create one automatic accepted cleanup patch");
  assert.strictEqual(result.patches.length, 1);
  assert.strictEqual(result.patches[0].status, "accepted");
  assert.strictEqual(result.patches[0].autoCorrection, "known_equation_ocr_cleanup");
  assert(result.previewMarkdown.includes("$\\Box\\Psi = -8\\pi\\zeta\\rho^{*}(1 - 2s)$"), "known Box correction should appear in accepted preview");
  assert(!result.previewMarkdown.includes("form □Ψ"), "known Box correction should not fall back to raw OCR");
}

{
  const correctedSqcup = call(`(() => {
    const text = ${JSON.stringify("to show that the equation takes the form $\\sqcup \\Psi = -8 \\pi \\zeta \\rho^{*} (1 -2 s)$, where the sensitivity $s$ arises from the derivative $\\partial T / \\partial \\phi$.")};
    return autoCorrectKnownEquationOcrMarkdown(text);
  })()`);
  assert(correctedSqcup.includes("$\\Box\\Psi = -8\\pi\\zeta\\rho^{*}(1 - 2s)$"), "known scalar-wave equation should repair sqcup to Box inside inline math");
  assert(!correctedSqcup.includes("\\sqcup"), "known scalar-wave equation should not keep sqcup");
}

{
  const ordinaryRiskyProse = call(`(() => {
    const text = "The parameter μ appears in this paragraph, but it is not the scalar wave Box equation.";
    return autoCorrectKnownEquationOcrMarkdown(text);
  })()`);
  assert.strictEqual(ordinaryRiskyProse, "The parameter μ appears in this paragraph, but it is not the scalar wave Box equation.");
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
      state.liveReviewDrafts.clear();
      state.reviewNeedsCorrection.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            page_size: [600, 800],
            para_blocks: [
              {
                type: "interline_equation",
                bbox: [120, 240, 420, 290],
                lines: [{ spans: [{ content: "$$\\\\n\\\\Psi = \\\\frac{2\\\\zeta}{R}\\\\sum_a m_a(1-2s_a)(1+\\\\mathcal{N}\\\\cdot v_a+\\\\ldots)\\\\n$$" }] }]
              },
              {
                type: "text",
                bbox: [525, 250, 565, 272],
                lines: [{ spans: [{ content: "(11.113)" }] }]
              },
              {
                type: "interline_equation",
                bbox: [120, 340, 420, 390],
                lines: [{ spans: [{ content: "$$\\\\n\\\\Psi = \\\\frac{4\\\\zeta}{R}\\\\eta m(s_2-s_1)\\\\mathcal N\\\\cdot v\\\\n$$" }] }]
              },
              {
                type: "text",
                bbox: [525, 350, 565, 372],
                lines: [{ spans: [{ content: "(11.114)" }] }]
              }
            ]
          }
        ]
      };
      const automaticCount = applyAutomaticLocalCorrectionsForPage(1);
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify({
        automaticCount,
        patches: state.ocrPatches.map((patch) => ({ blockId: patch.blockId, status: patch.status, newText: patch.newText, autoCorrection: patch.metadata?.autoCorrection || "" })),
        previewMarkdown: preview.markdown
      });
    })()`),
  );
  assert.strictEqual(result.automaticCount, 2, "11.113 and 11.114 should receive automatic known-equation OCR cleanup patches");
  assert(result.patches.every((patch) => patch.status === "accepted"), "known equation cleanup patches should be accepted");
  assert(result.patches.some((patch) => patch.autoCorrection === "equation_number_preservation"), "known equation cleanup should compose with equation-number preservation");
  assert(!result.previewMarkdown.includes("\\mathcal{N}"), "accepted preview should not keep mathcal N in equation 11.113");
  assert(!result.previewMarkdown.includes("\\mathcal N"), "accepted preview should not keep mathcal N in equation 11.114");
  assert(result.previewMarkdown.includes("(1+N\\cdot v_a+\\ldots)"), "equation 11.113 should use ordinary N");
  assert(result.previewMarkdown.includes("(s_2-s_1)N\\cdot v"), "equation 11.114 should use ordinary N");
}

{
  const correctedUntaggedN = call(`(() => {
    const text = ${JSON.stringify("$$\n\\Psi = \\frac{4\\zeta}{R}\\eta m(s_2-s_1)\\mathcal N\\cdot v\n$$")};
    return autoCorrectKnownEquationOcrMarkdown(text);
  })()`);
  assert(correctedUntaggedN.includes("(s_2-s_1)N\\cdot v"), "untagged equation 11.114 form should still repair mathcal N");
  assert(!correctedUntaggedN.includes("\\mathcal N"), "untagged equation 11.114 form should not keep mathcal N");

  const correctedOldStyleCalN = call(`(() => {
    const text = ${JSON.stringify("$$\n\\Psi = \\frac{2\\zeta}{R}\\sum_a m_a(1-2s_a)\\left(1+{\\cal N}\\cdot \\boldsymbol{\\nu}_{a}+\\ldots\\right)\\tag{11.113}\n$$")};
    return autoCorrectKnownEquationOcrMarkdown(text);
  })()`);
  assert(correctedOldStyleCalN.includes("\\left(1+N\\cdot \\boldsymbol{\\nu}_{a}+\\ldots\\right)"), "old-style {\\cal N} should be repaired to ordinary N");
  assert(!correctedOldStyleCalN.includes("\\cal N"), "old-style {\\cal N} should not survive cleanup");

  const unicodeNSource = "$$\n\\Psi = \\frac{4\\zeta}{R}\\eta m(s_2-s_1)" + String.fromCodePoint(0x1d4a9) + "\\cdot v\n$$";
  const correctedUnicodeN = call(`(() => {
    const text = ${JSON.stringify(unicodeNSource)};
    return autoCorrectKnownEquationOcrMarkdown(text);
  })()`);
  assert(correctedUnicodeN.includes("(s_2-s_1)N\\cdot v"), "known equation cleanup should repair Unicode calligraphic N");

  const correctedMathscrN = call(`(() => {
    const text = ${JSON.stringify("$$\n\\Psi = \\frac{2\\zeta}{R}\\sum_a m_a(1-2s_a)(1+\\mathscr{N}\\cdot v_a+\\ldots)\n$$")};
    return autoCorrectKnownEquationOcrMarkdown(text);
  })()`);
  assert(correctedMathscrN.includes("(1+N\\cdot v_a+\\ldots)"), "known equation cleanup should repair script N commands");
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
      state.liveReviewDrafts.clear();
      state.reviewNeedsCorrection.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            page_size: [600, 800],
            para_blocks: [
              {
                type: "interline_equation",
                bbox: [120, 340, 420, 390],
                lines: [{ spans: [{ content: "$$\\\\n\\\\Psi = \\\\frac{4\\\\zeta}{R}\\\\eta m(s_2-s_1)\\\\mathcal N\\\\cdot v\\\\n$$" }] }]
              }
            ]
          }
        ]
      };
      const source = reviewSegmentsForPage(1)[0].markdown;
      saveAutomaticAcceptedBlockPatch(
        1,
        "0",
        source,
        "$$\\\\n\\\\Psi = \\\\frac{4\\\\zeta}{R}\\\\eta m(s_2-s_1)\\\\mathcal N\\\\cdot v\\\\n$$",
        "equation_number_preservation"
      );
      const automaticCount = applyAutomaticLocalCorrectionsForPage(1);
      const preview = buildAcceptedPatchPreviewForPage(1);
      const latest = getLatestOcrPatchForBlock(1, "0", source);
      return JSON.stringify({
        automaticCount,
        latestText: latest?.newText || "",
        latestAutoCorrection: latest?.metadata?.autoCorrection || "",
        previewMarkdown: preview.markdown,
        patches: state.ocrPatches.map((patch) => ({ status: patch.status, autoCorrection: patch.metadata?.autoCorrection || "", newText: patch.newText }))
      });
    })()`),
  );
  assert.strictEqual(result.automaticCount, 1, "stale automatic accepted equation patch should be refreshed by known-equation cleanup");
  assert.strictEqual(result.latestAutoCorrection, "known_equation_ocr_cleanup");
  assert(result.latestText.includes("(s_2-s_1)N\\cdot v"), "latest accepted patch should use ordinary N");
  assert(!result.previewMarkdown.includes("\\mathcal N"), "accepted preview should not keep stale mathcal N from old automatic patch");
  assert(result.patches.some((patch) => patch.status === "rejected" && patch.autoCorrection === "equation_number_preservation"), "stale automatic patch should be rejected when refreshed");
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
      state.liveReviewDrafts.clear();
      state.reviewNeedsCorrection.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            page_size: [600, 800],
            para_blocks: [
              {
                type: "interline_equation",
                bbox: [120, 240, 420, 290],
                lines: [{ spans: [{ content: "$$\\\\n\\\\Psi = \\\\frac{2\\\\zeta}{R}\\\\sum_a m_a(1-2s_a)(1+\\\\mathcal{N}\\\\cdot v_a+\\\\ldots)\\\\n$$" }] }]
              }
            ]
          }
        ]
      };
      const source = reviewSegmentsForPage(1)[0].markdown;
      const manual = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: source,
        newText: "$$\\\\n\\\\Psi = \\\\frac{2\\\\zeta}{R}\\\\sum_a m_a(1-2s_a)(1+\\\\mathcal{N}\\\\cdot v_a+\\\\ldots)\\\\n$$\\\\n\\\\nmanual note kept",
        source: "human"
      }).patch;
      updateOcrPatchStatus(manual.patchId, "accepted");
      const automaticCount = applyAutomaticLocalCorrectionsForPage(1);
      const latest = getLatestOcrPatchForBlock(1, "0", source);
      const preview = buildAcceptedPatchPreviewForPage(1);
      return JSON.stringify({
        automaticCount,
        patchCount: state.ocrPatches.length,
        manualStatus: state.ocrPatches.find((patch) => patch.patchId === manual.patchId)?.status || "",
        latestText: latest?.newText || "",
        latestAutoCorrection: latest?.metadata?.autoCorrection || "",
        previewMarkdown: preview.markdown
      });
    })()`),
  );
  assert.strictEqual(result.automaticCount, 1, "stale manual accepted known equation should be refreshed by deterministic cleanup");
  assert.strictEqual(result.patchCount, 2, "refresh should preserve patch history instead of mutating the old accepted patch in place");
  assert.strictEqual(result.manualStatus, "rejected", "stale manual accepted patch should be superseded by the cleaned patch");
  assert.strictEqual(result.latestAutoCorrection, "known_equation_ocr_cleanup");
  assert(result.latestText.includes("(1+N\\cdot v_a+\\ldots)"), "refreshed manual patch should use ordinary N");
  assert(result.latestText.includes("manual note kept"), "refreshed manual patch should preserve other manual edits");
  assert(!result.previewMarkdown.includes("\\mathcal{N}"), "accepted preview should not keep stale mathcal N from manual patch");
}

{
  const result = JSON.parse(
    call(`(() => {
      const markdown = ${JSON.stringify("$$\n\\Psi = \\frac{2\\zeta}{R}\\sum_a m_a(1-2s_a)(1+\\mathcal{N}\\cdot v_a+\\ldots)\n$$")};
      const html = renderBlockContent(markdown, { type: "interline_equation", blockIndex: "0" });
      const editable = normalizedReviewMarkdownForActiveCorrection(markdown);
      const liveView = buildReviewCorrectionViewModel({
        liveDraft: {
          markdown: ${JSON.stringify("$$\n\\Psi = \\frac{2\\zeta}{R}\\sum_a m_a(1-2s_a)\\left(1+{\\cal N}\\cdot \\boldsymbol{\\nu}_{a}+\\ldots\\right)\\tag{11.113}\n$$")},
        },
      });
      return JSON.stringify({ html, editable, liveDisplay: liveView.displayMarkdown, liveEditable: liveView.editableMarkdown });
    })()`),
  );
  assert(!result.html.includes("\\mathcal"), "right-column render path should not pass stale mathcal N into MathJax");
  assert(result.html.includes("N\\cdot v_a"), "right-column render path should pass ordinary N into MathJax");
  assert(!result.editable.includes("\\mathcal"), "source editor path should not keep stale mathcal N");
  assert(result.editable.includes("N\\cdot v_a"), "source editor path should expose ordinary N");
  assert(!result.liveEditable.includes("\\cal N"), "live draft editor path should not keep old-style cal N");
  assert(result.liveEditable.includes("\\left(1+N\\cdot \\boldsymbol{\\nu}_{a}+\\ldots\\right)"), "live draft editor path should repair old-style cal N");
}

{
  const inlineMathWrappedProse = [
    "where $\\\\Phi_c$ is a constant. Thus we have an accurate prediction",
    "(under the chosen",
    "assumptions) for the gravitational-wave signal at the detector. This is essential for",
    "confirming a detection and for the measurement of the source",
    "parameters (Cutler et al.,",
    "1993), which include distance, position in the sky, orientation of",
    "the orbital plane, and the masses and spins of the companions.",
    "The theoretical signal is expressed as a function of an abstract",
    "vector $\\\\theta$, which collectively represents the source parameters."
  ].join("\n");
  const result = JSON.parse(
    call(`(() => {
      const source = ${JSON.stringify(inlineMathWrappedProse)};
      const rendered = renderBlockContent(source, { kind: "text", blockIndex: "inline-math-hard-wrapped-prose" });
      const explicitBreak = renderMarkdownHtml("first line  \\nsecond line");
      return JSON.stringify({ rendered, explicitBreak });
    })()`),
  );
  assert(!result.rendered.includes("<br>"), "rendered inline-math prose should not preserve OCR hard line breaks");
  assert(result.rendered.includes("(under the chosen assumptions)"), "renderer should merge parenthetical OCR line splits");
  assert(result.rendered.includes("parameters (Cutler et al., 1993)"), "renderer should merge citation year line splits");
  assert(result.rendered.includes("vector $\\\\theta$, which"), "renderer should keep inline math source while unwrapping prose");
  assert(result.explicitBreak.includes("<br>"), "explicit markdown hard breaks should still render as line breaks");
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
  assert(result.normalized.includes("where $\\mathcal { H } = 1 - \\zeta$ [see Eq. (10.66)]"), "unclosed inline math before equation references should be repaired and reference spacing normalized");
  assert(!result.normalized.includes("$["), "inline math should not be glued to bracketed references");
  assert(!result.normalized.includes("seeEq."), "equation references should keep a space between see and Eq.");
  assert(result.rendered.includes('class="math-display'), "display math should still render as display math");
  assert(!result.rendered.includes("where$"), "rendered mixed blocks should not keep cramped inline math");
}

{
  const referenceListBlock = {
    type: "list",
    lines: [
      { spans: [{ content: "Adelberger, E. G., Heckel, B. R., Hoedl, S., Hoyle, C. D., et al. 2007. Particle-physics" }] },
      { spans: [{ content: "implications of a recent test of the gravitational inverse-square law. Phys. Rev. Lett., 98," }] },
      { spans: [{ content: "131104, ArXiv e-prints hep-ph/0611223." }] },
      { spans: [{ content: "Agathos, M., Del Pozzo, W., Li, T. G. F., Van Den Broeck, C., et al. 2014. TIGER: A" }] },
      { spans: [{ content: "data analysis pipeline for testing the strong-field dynamics of general relativity." }] },
    ],
  };
  const result = call(`blockToMarkdown(${JSON.stringify(referenceListBlock)})`);
  assert(!result.includes("- implications"), "reference continuation lines should not become separate bullets");
  assert(result.includes("Particle-physics implications"), "reference continuation lines should be joined into the same entry");
  assert(result.includes("\n\nAgathos"), "new reference entries should remain separated");
}

{
  const collapsedReferences =
    "325 References Kapner, D. J., Cook, T. S., Adelberger, E. G., Gundlach, J. H., et al. 2007. Tests of the gravitational inverse-square law below the dark-energy length scale. Phys. Rev. Lett., 98, 021101, ArXiv e-prints hep-ph/0611184. Kates, R. E. 1980. Motion of a small body through an external field in general relativity calculated by matched asymptotic expansions. Phys. Rev. D, 22, 1853-1870. Katz, J. I. 1999. Comment on Indication, from Pioneer 10/11, Galileo, and Ulysses data, of an apparent anomalous, weak, long-range acceleration. Phys. Rev. Lett., 83, 1892, ArXiv e-prints gr-qc/9809070.";
  const result = call(`formatBibliographyText(${JSON.stringify(collapsedReferences)})`);
  assert(!result.includes("325 References"), "bibliography formatter should remove leading page/reference noise");
  assert(result.includes("Kapner, D. J."));
  assert(result.includes("\n\nKates, R. E. 1980."), "collapsed bibliography entries should split at author-year starts");
  assert(result.includes("\n\nKatz, J. I. 1999."), "multiple collapsed bibliography entries should remain readable");
}

{
  const latePageReferences =
    "prints astro-ph/0210426. Schutz, B. F. 2009. A First Course in General Relativity. Cambridge: Cambridge Univer- sity Press. Schwarzschild, K. 1916. Uber das Gravitationsfeld eines Massenpunktes nach der Einsteinschen Theorie. Sitzungsberichte der Koniglich Preussischen Akademie der Wissenschaften (Berlin), 1916, Seite 189-196. Sennett, N., Marsat, S., and Buonanno, A. 2016. Gravitational waveforms in scalar-tensor gravity at 2PN relative order. Phys. Rev. D, 94, 084003, ArXiv e-prints 1607.01420.";
  const result = call(`formatBibliographyText(${JSON.stringify(latePageReferences)})`);
  assert(result.includes("prints astro-ph/0210426."), "bibliography formatter should keep a carry-over reference tail");
  assert(result.includes("\n\nSchutz, B. F. 2009."), "bibliography formatter should split a new entry after a carried-over tail");
  assert(result.includes("\n\nSchwarzschild, K. 1916."), "bibliography formatter should split collapsed adjacent entries");
  assert(result.includes("\n\nSennett, N., Marsat, S., and Buonanno, A. 2016."), "bibliography formatter should split multi-author collapsed entries");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 43;
      state.contentListItems = [];
      state.pdfTextPageCache.clear();
      state.mineruInfo = {
        pdf_info: Array.from({ length: 43 }, (_unused, index) => index === 42
          ? {
              page_size: [612, 792],
              para_blocks: [
                { type: "title", bbox: [250, 96, 360, 120], lines: [{ spans: [{ content: "References" }] }] }
              ]
            }
          : { page_size: [612, 792], para_blocks: [] })
      };
      state.pdfTextPageCache.set(43, {
        pageSize: [612, 792],
        textBlocks: [
          { text: "References", bbox: [250, 96, 360, 120] },
          { text: "Anninos, P., Hobill, D., Seidel, E., Smarr, L., and Suen, W.-M. 1993. Collision of two black holes. Phys. Rev. Lett., 71, 2851-2854, ArXiv e-prints gr-qc/9309016.", bbox: [80, 160, 540, 205] },
          { text: "Antia, H. M., Chitre, S. M., and Gough, D. O. 2008. Temporal variations in the Sun's rotational kinetic energy. Astron. Astrophys., 477, 657-663, ArXiv e-prints 0711.0799.", bbox: [80, 214, 540, 260] }
        ]
      });
      const risks = detectRiskCandidatesForPage(43);
      return JSON.stringify(risks.map((risk) => ({
        blockIndex: risk.blockIndex,
        text: risk.text,
        reasons: risk.reasons,
        syntheticLabel: risk.syntheticLabel
      })));
    })()`),
  );
  const pdfReferenceCandidate = result.find((risk) => risk.blockIndex === "pdf-reference-text-43");
  assert(pdfReferenceCandidate, "PDF text layer reference entries should become a supplemental review candidate when middle only has the heading");
  assert(pdfReferenceCandidate.reasons.includes("pdf_text_reference_supplemental"));
  assert.strictEqual(pdfReferenceCandidate.syntheticLabel, "PDF 参考文献候选");
  assert(pdfReferenceCandidate.text.includes("Anninos"));
  assert(pdfReferenceCandidate.text.includes("\n\nAntia"), "PDF reference entries should remain separated by entry");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 58;
      state.contentListItems = [];
      state.pdfTextPageCache.clear();
      state.mineruInfo = {
        pdf_info: Array.from({ length: 58 }, (_unused, index) => index === 57
          ? {
              page_size: [612, 792],
              para_blocks: [
                { type: "title", bbox: [250, 96, 360, 120], lines: [{ spans: [{ content: "References" }] }] }
              ]
            }
          : { page_size: [612, 792], para_blocks: [] })
      };
      state.pdfTextPageCache.set(58, {
        pageSize: [612, 792],
        textBlocks: [
          { text: "References", bbox: [250, 96, 360, 120] },
          { text: "325 References Kapner, D. J., Cook, T. S., Adelberger, E. G., Gundlach, J. H., et al. 2007. Tests of the gravitational inverse-square law below the dark-energy length scale. Phys. Rev. Lett., 98, 021101, ArXiv e-prints hep-ph/0611184. Kates, R. E. 1980. Motion of a small body through an external field in general relativity calculated by matched asymptotic expansions. Phys. Rev. D, 22, 1853-1870. Katz, J. I. 1999. Comment on Indication, from Pioneer 10/11, Galileo, and Ulysses data, of an apparent anomalous, weak, long-range acceleration. Phys. Rev. Lett., 83, 1892, ArXiv e-prints gr-qc/9809070.", bbox: [80, 160, 540, 300] }
        ]
      });
      const risks = detectRiskCandidatesForPage(58);
      return JSON.stringify(risks.map((risk) => ({
        blockIndex: risk.blockIndex,
        text: risk.text,
        reasons: risk.reasons,
        syntheticLabel: risk.syntheticLabel
      })));
    })()`),
  );
  const pdfReferenceCandidate = result.find((risk) => risk.blockIndex === "pdf-reference-text-58");
  assert(pdfReferenceCandidate, "PDF text layer collapsed reference page should become a supplemental review candidate");
  assert(pdfReferenceCandidate.text.includes("\n\nKates"), "collapsed PDF reference text should split entries");
  assert(pdfReferenceCandidate.text.includes("\n\nKatz"), "collapsed PDF reference text should expose later entries");
}

{
  const result = JSON.parse(
    call(`(() => {
      const referenceBody = "Adelberger, E. G., Heckel, B. R., Hoedl, S., Hoyle, C. D., et al. 2007. Particle-physics implications of a recent test of the gravitational inverse-square law. Phys. Rev. Lett., 98, 131104, ArXiv e-prints hep-ph/0611223.\\nAgathos, M., Del Pozzo, W., Li, T. G. F., Van Den Broeck, C., et al. 2014. TIGER: A data analysis pipeline for testing the strong-field dynamics of general relativity. Phys. Rev. D, 89, 082001, ArXiv e-prints 1311.0420.";
      state.currentPage = 43;
      state.pdfTextPageCache.clear();
      state.contentListItems = [
        { type: "discarded", page_idx: 42, text: referenceBody + " Alexander, S., and Yunes, N. 2009. Chern-Simons modified general relativity. Phys. Rep., 480, 1-55, ArXiv e-prints 0907.2562.", bbox: [80, 140, 760, 940], __contentListIndex: 0 },
        { type: "discarded", page_idx: 42, text: "References", bbox: [390, 1010, 530, 1035], __contentListIndex: 1 }
      ];
      state.mineruInfo = {
        pdf_info: Array.from({ length: 43 }, (_unused, index) => index === 42
          ? {
              page_size: [919, 1256],
              para_blocks: [
                { type: "list", bbox: [90, 150, 780, 620], lines: referenceBody.split("\\n").map((content) => ({ spans: [{ content }] })) },
                { type: "title", bbox: [390, 1010, 530, 1035], lines: [{ spans: [{ content: "References" }] }] }
              ]
            }
          : { page_size: [919, 1256], para_blocks: [] })
      };
      state.pdfTextPageCache.set(43, {
        pageSize: [919, 1256],
        textBlocks: [
          { text: "References", bbox: [430, 70, 520, 95] },
          { text: referenceBody + " Alexander, S., and Yunes, N. 2009. Chern-Simons modified general relativity. Phys. Rep., 480, 1-55, ArXiv e-prints 0907.2562.", bbox: [80, 140, 760, 940] }
        ]
      });
      const risks = detectRiskCandidatesForPage(43);
      return JSON.stringify({
        risks: risks.map((risk) => ({ blockIndex: risk.blockIndex, text: risk.text, syntheticLabel: risk.syntheticLabel })),
        review: reviewSegmentsForPage(43).map((entry) => entry.markdown)
      });
    })()`),
  );
  assert(!result.risks.some((risk) => risk.blockIndex === "pdf-reference-text-43"), "PDF reference supplement should not duplicate an existing MinerU bibliography block");
  assert(!result.risks.some((risk) => String(risk.blockIndex).startsWith("content-list-discarded-43")), "content_list reference supplement should not duplicate an existing MinerU bibliography block");
  assert(!result.review.some((text) => /^###\\s+References\\s*$/i.test(text.trim()) || /^References\\s*$/i.test(text.trim())), "standalone References headings should be hidden even when bbox is not page-top");
  assert(result.review.some((text) => text.includes("Adelberger, E. G.")), "the real reference body should remain");
}

{
  const collapsedMathpixSource = "Foracompactbinarysystem,thewaveforms$\\tilde{h}^{j k}$and$\\Psi$aregivento therequiredorders\nwhere$\\mathcal{G}=1-\\zeta$[seeEq. (10.65)], and";
  const result = JSON.parse(
    call(`(() => {
      const source = ${JSON.stringify(collapsedMathpixSource)};
      return JSON.stringify({
        cleaned: cleanMathpixEditableMarkdown(source),
        rendered: renderBlockContent(source, { kind: "text", blockIndex: "collapsed-mathpix" })
      });
    })()`),
  );
  assert(result.cleaned.includes("For a compact binary system, the waveforms $\\tilde{h}^{j k}$ and $\\Psi$ are given to the required orders"));
  assert(result.cleaned.includes("where $\\mathcal{G}=1-\\zeta$ [see Eq. (10.65)], and"));
  assert(!result.rendered.includes("Foracompactbinarysystem"), "rendered stale Mathpix text should not keep collapsed prose");
  assert(!result.rendered.includes("seeEq."), "rendered stale Mathpix text should normalize reference spacing");
}

{
  const collapsedMathpixDraft = "Foracompactbinarysystem, thewaveforms$\\tilde{h}^{j k}$and$\\Psi$aregivento therequiredorders (Lang, 2014, 2015) by\n$$\\tilde{h}^{j k} = 4 ( 1 - \\zeta ) \\frac{\\eta m}{R} \\left( v^{j} v^{k} - \\frac{\\mathcal{G} m}{r} n^{j} n^{k} \\right), \\tag{11.115} $$\nwhere$\\mathcal{G} = 1 - \\zeta + \\zeta \\left( 1 - 2 s_{1} \\right) \\left( 1 - 2 s_{2} \\right)$[seeEq. (10.65)], and\n$$\\Psi = 2 \\mathcal{G}^{1 / 2} \\frac{\\zeta \\eta m}{R} \\left[ \\Psi_{-0.5 \\mathrm{PN}} + \\Psi_{0 \\mathrm{PN}} + \\Psi_{+0.5 \\mathrm{PN}} \\right], \\tag{11.116} $$";
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression(["Original source block"])}
      state.reviewCorrectionOpen.add(reviewBlockKey(1, "0"));
      getMathpixBlockDrafts(1).set("0", ${JSON.stringify(collapsedMathpixDraft)});
      const view = buildReviewCorrectionViewModel({
        mathpixDraftMarkdown: ${JSON.stringify(collapsedMathpixDraft)},
        fallbackMarkdown: "Original source block"
      });
      const html = renderPageReviewCanvas(reviewEntriesForCurrentPage());
      state.reviewCorrectionOpen.clear();
      return JSON.stringify({ html, displayMarkdown: view.displayMarkdown, editableMarkdown: view.editableMarkdown });
    })()`),
  );
  assert.strictEqual(result.displayMarkdown, result.editableMarkdown, "page render and editor should share one cleaned correction markdown");
  assert(result.editableMarkdown.includes("For a compact binary system, the waveforms"), "shared correction view should expose cleaned first line");
  assert(result.html.includes("For a compact binary system, the waveforms"), "page block render should use the same cleaned Mathpix markdown as the editor");
  assert(result.html.includes('class="math-display'), "cleaned Mathpix draft should still render display equations");
  assert(!result.html.includes("Foracompactbinarysystem"), "raw collapsed Mathpix draft should not leak into block render or editor");
  assert(!result.html.includes("thewaveforms"), "raw collapsed prose tokens should not leak into block render or editor");
  assert(!result.html.includes("where$"), "raw inline math boundaries should not leak into block render or editor");
  assert(!result.html.includes("seeEq."), "raw equation reference spacing should not leak into block render or editor");
}

{
  const noisyLatexSource = "$$\n{\\cos} f {=} \\frac{\\cos u - e}{1 - e \\cos u}, ~ {\\sin} f {=} \\frac{\\sqrt{1 - e^{2}} \\sin u}{1 - e \\cos u}.\\tag{12.2}\n$$";
  const result = call(`cleanMathpixEditableMarkdown(${JSON.stringify(noisyLatexSource)})`);
  assert(result.includes("\\cos f = \\frac{\\cos u - e}{1 - e \\cos u}, \\sin f = \\frac{\\sqrt{1 - e^{2}} \\sin u}{1 - e \\cos u}.\\tag{12.2}"), "display math cleanup should remove redundant command/operator braces and noisy spacing");
  assert(!result.includes("{\\cos}"), "display math cleanup should not keep redundant command braces");
  assert(!result.includes("{=}"), "display math cleanup should not keep redundant operator braces");
  assert(!result.includes("~ {\\sin}"), "display math cleanup should remove noisy tilde spacing");
}

{
  const compressedArrayFormula = "$$ \\begin{array}{l} {\\displaystyle \\frac{d \\pmb\\nu}{d t}= \\frac{m \\pmb n}{r^{2}} \\left[1 + \\nu^{2} - \\frac{4 m}{r}\\right] \\ {\\displaystyle - \\frac{2 J}{r^{3}} \\left[5 \\pmb n - \\pmb n\\right]} \\end{array} \\tag{12.67} $$";
  const cleaned = call(`cleanMathpixEditableMarkdown(${JSON.stringify(compressedArrayFormula)})`);
  assert(cleaned.includes("\\begin{array}{l}\n{\\displaystyle"), "compressed array formulas should put array begin on its own editable line");
  assert(cleaned.includes("\\\\\n{\\displaystyle -"), "lost array row separators before displaystyle groups should become explicit row breaks");
  assert(cleaned.includes("\\boldsymbol{\\nu}"), "bold vector commands should use MathJax-compatible boldsymbol wrappers");
  assert(cleaned.includes("\\boldsymbol{n}"), "bold vector symbols should use MathJax-compatible boldsymbol wrappers");
  assert(cleaned.includes("\\tag{12.67}"), "formula numbering should be preserved during array cleanup");
  assert(!cleaned.includes("\\pmb"), "compressed array cleanup should remove unstable pmb command syntax");
  const screenshotFormula = "$$ \\begin{array}{l}{\\displaystyle \\frac{d \\pmb{\\nu}}{d t}=-\\frac{m {\\pmb{n}}}{r^{2}}\\left[1+\\nu^{2}-\\frac{4 m}{r}\\right]+\\frac{4 m \\nu \\dot{r}}{r^{2}}}\\\\ {\\displaystyle -\\frac{2 J}{r^{3}}\\left[2 \\pmb{\\nu}\\times \\pmb{e}-3 \\dot{r}{\\pmb{n}}\\times \\pmb{e}-3 r^{-1}{\\pmb{n}}({\\pmb{h}}\\cdot{\\pmb{e}})\\right]}\\\\ {\\displaystyle -\\frac{3}{2}\\frac{Q_{2}}{r^{4}}\\left[5 {\\pmb{n}}({\\pmb{n}}\\cdot{\\pmb{e}})^{2}-2 {\\pmb{e}}({\\pmb{n}}\\cdot{\\pmb{e}})-{\\pmb{n}}\\right]}\\end{array}\\tag{12.67} $$";
  const rendered = call(`renderBlockContent(${JSON.stringify(screenshotFormula)}, { kind: "interline_equation", blockIndex: "12.67" })`);
  assert(rendered.includes('class="math-display'), "compressed screenshot-style array formulas should render as display math");
  assert(rendered.includes("math-display-equation-tag"), "compressed screenshot-style array formulas should expose equation labels outside raw TeX");
  assert(rendered.includes("(12.67)"), "compressed screenshot-style array formulas should show the equation number");
  assert(rendered.includes("\\boldsymbol{\\nu}"), "compressed screenshot-style array formulas should be converted to MathJax-compatible boldsymbol syntax");
  assert(!rendered.includes("\\pmb"), "compressed screenshot-style array formulas should not leave pmb syntax for MathJax");
  assert(!rendered.includes("<p>$$"), "compressed screenshot-style array formulas should not render display delimiters as paragraph text");
  const brokenPersistedArrayFormula = "$$\n\\begin{array}}{l}\n{\\displaystyle \\frac{d \\boldsymbol{\\nu}}{d t} = - \\frac{m {\\boldsymbol{n}}}{r^{2}} \\left[1 + \\nu^{2} - \\frac{4 m}{r} \\right] + \\frac{4 m \\nu \\dot{r}}{r^{2}} \\} \\\\\n{\\displaystyle - \\frac{2 J}{r^{3}} \\left[2 \\boldsymbol{\\nu} \\times \\boldsymbol{e} -3 \\dot{r}{\\boldsymbol{n}} \\times \\boldsymbol{e} -3 r^{-1}{\\boldsymbol{n}} ({\\boldsymbol{h}} \\cdot{\\boldsymbol{e}}) \\right]} \\\\\n{\\displaystyle - \\frac{3}{2} \\frac{Q_{2}}{r^{4}} \\left[5 {\\boldsymbol{n}} ({\\boldsymbol{n}} \\cdot{\\boldsymbol{e}})^{2} -2 {\\boldsymbol{e}} ({\\boldsymbol{n}} \\cdot{\\boldsymbol{e}}) - {\\boldsymbol{n}} \\right],}\n\\end{array}\\tag{12.67}\n$$";
  const repairedPersisted = call(`cleanMathpixEditableMarkdown(${JSON.stringify(brokenPersistedArrayFormula)})`);
  assert(repairedPersisted.includes("\\begin{array}{l}\n{\\displaystyle"), "persisted broken array begin arguments should be repaired before editing");
  assert(!repairedPersisted.includes("\\begin{array}}\{l}"), "persisted broken array begin should not keep an extra closing brace");
  assert(!repairedPersisted.includes("\\begin{array}\n}{l}"), "persisted broken array begin should not be split into an invalid argument line");
  assert(!/\\\}\s*\\\\/.test(repairedPersisted), "escaped displaystyle row closers should become real group closers before row breaks");
  const repairedRendered = call(`renderBlockContent(${JSON.stringify(brokenPersistedArrayFormula)}, { kind: "interline_equation", blockIndex: "12.67" })`);
  assert(repairedRendered.includes("\\begin{array}{l}"), "render path should repair invalid persisted array begin arguments");
  assert(!repairedRendered.includes("\\begin{array}\n}{l}"), "render path should not leak split invalid array arguments");
  assert(!repairedRendered.includes("\\begin{array}}{l}"), "render path should not leak single-line invalid array arguments");
  assert(!repairedRendered.includes("<p>$$"), "repaired persisted array formulas should not render display delimiters as paragraph text");
}

{
  const staleMathpixDraft = "Foracompactbinarysystem,thewaveforms$\\tilde{h}^{j k}$and$\\Psi$aregivento therequiredorders";
  const cleanManualMarkdown = "For a compact binary system, the waveforms $\\tilde{h}^{j k}$ and $\\Psi$ are given to the required orders (Lang, 2014, 2015) by\n$$\\tilde{h}^{j k} = 4 ( 1 - \\zeta ) \\frac{\\eta m}{R} \\left( v^{j} v^{k} - \\frac{\\mathcal{G} m}{r} n^{j} n^{k} \\right),\\tag{11.115} $$\nwhere $\\mathcal{G} = 1 - \\zeta + \\zeta \\left( 1 -2 s_{1} \\right) \\left( 1 -2 s_{2} \\right)$ [see Eq. (10.65)], and";
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression(["Original source block"])}
      state.reviewCorrectionOpen.add(reviewBlockKey(1, "0"));
      getMathpixBlockDrafts(1).set("0", ${JSON.stringify(staleMathpixDraft)});
      const renderTarget = { innerHTML: "", textContent: "", isConnected: true };
      const block = {
        querySelector(selector) {
          return selector === ".review-page-block-render" ? renderTarget : null;
        }
      };
      const editor = {
        value: ${JSON.stringify(cleanManualMarkdown)},
        dataset: { mathpixEdit: "0" },
        closest(selector) {
          return selector === "[data-review-page-block]" ? block : null;
        }
      };
      const ok = updateLiveReviewPreviewForEditor(editor);
      const liveDraft = getLiveReviewDrafts(1, false).get("0");
      const rerendered = renderPageReviewCanvas(reviewEntriesForCurrentPage());
      state.reviewCorrectionOpen.clear();
      return JSON.stringify({ ok, html: renderTarget.innerHTML, liveDraft, rerendered });
    })()`),
  );
  assert.strictEqual(result.ok, true, "manual Mathpix editor input should update the current block preview");
  assert(result.liveDraft.markdown.includes("For a compact binary system, the waveforms"), "manual editor input should be stored as the live draft for rerenders");
  assert(result.html.includes("For a compact binary system, the waveforms"), "live preview should use the textarea markdown, not stale draft state");
  assert(result.rerendered.includes("For a compact binary system, the waveforms"), "rerendered page canvas should prefer live editor draft over stale Mathpix draft");
  assert(result.html.includes("class=\"math-display"), "live preview should keep display math rendering wrappers");
  assert(!result.html.includes("Foracompactbinarysystem"), "live preview should not keep stale collapsed first-line text");
  assert(!result.rerendered.includes("Foracompactbinarysystem"), "rerendered page canvas should not restore stale collapsed text");
  assert(!result.html.includes("thewaveforms"), "live preview should not keep stale collapsed waveforms text");
  assert(!result.html.includes("where$"), "live preview should not keep stale inline math boundaries");
}

{
  const staleMathpixDraft = "Foracompactbinarysystem,thewaveforms$\\tilde{h}^{j k}$and$\\Psi$aregivento therequiredorders";
  const cleanVisibleEditorMarkdown = "For a compact binary system, the waveforms $\\tilde{h}^{j k}$ and $\\Psi$ are given to the required orders (Lang, 2014, 2015) by\n$$\\tilde{h}^{j k} = 4 ( 1 - \\zeta ) \\frac{\\eta m}{R} \\left( v^{j} v^{k} - \\frac{\\mathcal{G} m}{r} n^{j} n^{k} \\right),\\tag{11.115} $$";
  const result = JSON.parse(
    call(`(() => {
      ${setupPreviewPageExpression(["Original source block"])}
      state.reviewCorrectionOpen.add(reviewBlockKey(1, "0"));
      getMathpixBlockDrafts(1).set("0", ${JSON.stringify(staleMathpixDraft)});
      const editor = {
        value: ${JSON.stringify(cleanVisibleEditorMarkdown)},
        dataset: { mathpixEdit: "0" }
      };
      const currentWorkbench = {
        querySelectorAll(selector) {
          return selector === "[data-mathpix-edit], [data-mineru-source-edit]" ? [editor] : [];
        }
      };
      const count = syncLiveReviewDraftsFromEditors(currentWorkbench);
      const liveDraft = getLiveReviewDrafts(1, false).get("0");
      const rerendered = renderPageReviewCanvas(reviewEntriesForCurrentPage());
      state.reviewCorrectionOpen.clear();
      return JSON.stringify({ count, liveDraft, rerendered });
    })()`),
  );
  assert.strictEqual(result.count, 1, "right workbench refresh should sync visible editor values before rerendering");
  assert(result.liveDraft.markdown.includes("For a compact binary system, the waveforms"), "visible editor sync should store the current textarea markdown");
  assert(result.rerendered.includes("For a compact binary system, the waveforms"), "rerender should prefer the visible textarea markdown over stale Mathpix draft state");
  assert(result.rerendered.includes("math-display-equation-tag"), "rerendered visible editor markdown should keep display equation labels");
  assert(!result.rerendered.includes("Foracompactbinarysystem"), "stale Mathpix draft should not return after refresh-time sync");
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
      state.liveReviewDrafts.clear();
      state.reviewNeedsCorrection.clear();
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
            page_size: [600, 800],
            para_blocks: [
              {
                type: "text",
                bbox: [80, 120, 520, 165],
                lines: [{ spans: [{ content: "to show that the equation takes the form □Ψ = -8πζρ*(1 - 2s)." }] }]
              },
              {
                type: "interline_equation",
                bbox: [120, 240, 420, 290],
                lines: [{ spans: [{ content: "$$\\\\n\\\\Psi = \\\\frac{2\\\\zeta}{R}\\\\sum_a m_a(1-2s_a)(1+\\\\mathcal{N}\\\\cdot v_a+\\\\ldots)\\\\n$$" }] }]
              },
              {
                type: "text",
                bbox: [525, 250, 565, 272],
                lines: [{ spans: [{ content: "(11.113)" }] }]
              }
            ]
          }
        ]
      };
      const textSource = reviewSegmentsForPage(1)[0].markdown;
      const formulaSource = reviewSegmentsForPage(1)[1].markdown;
      const textPatch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "0",
        oldText: textSource,
        newText: "to show that the equation takes the form $\\\\Box\\\\Psi = -8\\\\pi\\\\zeta\\\\rho^{*}(1 - 2s)$.",
        source: "human"
      }).patch;
      updateOcrPatchStatus(textPatch.patchId, "accepted");
      const formulaPatch = createAndStoreDraftOcrPatch({
        pageNo: 1,
        blockIndex: "1",
        oldText: formulaSource,
        newText: "$$\\\\n\\\\Psi = \\\\frac{2\\\\zeta}{R}\\\\sum_a m_a(1-2s_a)(1+\\\\boldsymbol{N}\\\\cdot v_a+\\\\ldots)\\\\n$$",
        source: "human"
      }).patch;
      updateOcrPatchStatus(formulaPatch.patchId, "accepted");
      const automaticCount = applyAutomaticLocalCorrectionsForPage(1);
      const latestText = getLatestOcrPatchForBlock(1, "0", textSource);
      const latestFormula = getLatestOcrPatchForBlock(1, "1", formulaSource);
      return JSON.stringify({
        automaticCount,
        patchCount: state.ocrPatches.length,
        textStatus: latestText?.status || "",
        formulaStatus: latestFormula?.status || "",
        text: latestText?.newText || "",
        formula: latestFormula?.newText || ""
      });
    })()`),
  );
  assert.strictEqual(result.automaticCount, 0, "automatic local corrections should not overwrite manual accepted patches");
  assert.strictEqual(result.patchCount, 2, "manual accepted patches should not be replaced by automatic patches");
  assert.strictEqual(result.textStatus, "accepted");
  assert.strictEqual(result.formulaStatus, "accepted");
  assert(result.text.includes("\\Box\\Psi"), "manual accepted prose should preserve the Box correction");
  assert(result.formula.includes("\\boldsymbol{N}"), "manual accepted formula should preserve the vector N correction");
  assert(!result.formula.includes("\\mathcal{N}"), "manual accepted formula should not fall back to the old mathcal N OCR");
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
      state.liveReviewDrafts.clear();
      state.reviewNeedsCorrection.clear();
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
      state.liveReviewDrafts.clear();
      state.reviewNeedsCorrection.clear();
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

{
  const result = JSON.parse(
    call(`(() => {
      const editor = { value: "edited", defaultValue: "original" };
      const pageBlock = {
        querySelector(selector) {
          return selector === "[data-mathpix-edit]" ? editor : null;
        }
      };
      const trigger = {
        closest(selector) {
          return selector.includes(".block-source-detail") ? null : pageBlock;
        }
      };
      return JSON.stringify({ found: findReviewEditorForTrigger(trigger, "[data-mathpix-edit]") === editor });
    })()`),
  );
  assert.strictEqual(result.found, true, "save actions inside page blocks should find their Markdown editor");
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
    state.liveReviewDrafts.clear();
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
  const headingHtml = call(`renderMarkdownHtml(${JSON.stringify("### 2.5 The TH $\\epsilon \\mu$ Formalism")})`);
  assert(headingHtml.includes("<h3>"), "markdown title blocks should render as heading tags");
  assert(headingHtml.includes("$\\epsilon \\mu$"), "heading inline math source should remain available for MathJax");
  const targetCount = call(`mathTypesetTargetsForRoot({
    textContent: "2.5 The TH $\\\\epsilon \\\\mu$ Formalism",
    querySelectorAll() {
      return [{ textContent: "$\\\\epsilon \\\\mu$" }];
    }
  }).length`);
  assert.strictEqual(targetCount, 1, "heading nodes with inline math should be included in MathJax typeset targets");
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
  assert(titleCandidate.text.startsWith("### "), "content_list top title candidates should render at the same heading level as MinerU title blocks");
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
      state.currentPage = 2;
      state.contentListItems = normalizeContentListItems([
        {
          type: "discarded",
          page_idx: 1,
          bbox: [80, 80, 470, 185],
          text: "In a similar manner, reanalyses of decay rates of 187Rhenium in ancient meteorites gave the bound on any variation of the weak interaction coupling constant. The current best bounds are summarized in Table 2.2."
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
                bbox: [80, 430, 470, 560],
                lines: [
                  { spans: [{ content: "In a similar manner, reanalyses of decay rates of 187Rhenium in ancient meteorites gave the bound on any variation of the weak interaction coupling constant. The current best bounds are summarized in Table 2.2." }] }
                ]
              },
              {
                type: "table",
                bbox: [80, 225, 470, 410],
                table_body: "<table><tr><th>Constant k</th><th>Limit on k/k</th></tr><tr><td>Fine structure</td><td><1.3 × 10-16</td></tr></table>"
              }
            ]
          }
        ]
      };
      const risks = detectRiskCandidatesForPage(2);
      const segments = reviewSegmentsForPage(2);
      const entries = buildReviewEntriesForPage(risks, segments, 2);
      return JSON.stringify({
        candidates: detectContentListRiskCandidatesForPage(2),
        segments: segments.map((segment) => ({ key: String(segment.blockIndex), type: segment.block?.type || segment.kind, markdown: segment.markdown })),
        entries: entries.map((entry) => ({ key: entry.key, markdown: entry.segment.markdown }))
      });
    })()`),
  );
  assert.strictEqual(result.candidates.length, 0, "content_list copy of a Table-referencing prose block should not duplicate MinerU text");
  assert.strictEqual(result.segments[0].type, "table", "captionless page-top table should remain before prose that references Table 2.2");
  assert(result.segments[1].markdown.includes("summarized in Table 2.2"));
  assert.strictEqual(result.entries.filter((entry) => entry.markdown.includes("summarized in Table 2.2")).length, 1, "Table-referencing prose should appear once after the table");
  assert(!result.entries.some((entry) => String(entry.key).startsWith("content-list-discarded-2")), "duplicate content_list prose should not be rendered as a third-column block");
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
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 18;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.riskByPage.clear();
      state.mineruInfo = {
        pdf_info: Array.from({ length: 18 }, (_unused, index) => {
          if (index === 16) {
            return {
              page_size: [919, 1256],
              para_blocks: [
                {
                  type: "text",
                  lines: [
                    { bbox: [195, 510, 850, 860], spans: [{ bbox: [195, 510, 850, 860], content: "(see Table 12.2). In Figure 12.3, the line labeled R is that mass ratio.", cross_page: true }] }
                  ]
                }
              ]
            };
          }
          if (index === 17) {
            return {
              page_size: [919, 1256],
              para_blocks: [
                {
                  type: "image",
                  bbox: [190, 58, 850, 470],
                  lines: [{ bbox: [190, 58, 850, 470], spans: [{ bbox: [190, 58, 850, 470], image_path: "fig-12-3.jpg" }] }]
                }
              ]
            };
          }
          return { page_size: [919, 1256], para_blocks: [] };
        })
      };
      const risks = detectRiskCandidatesForPage(18);
      const entries = buildReviewEntriesForPage(risks, reviewSegmentsForPage(18), 18);
      return JSON.stringify(entries.map((entry) => ({
        key: entry.key,
        markdown: entry.segment.markdown,
        label: entry.risk?.syntheticLabel || ""
      })));
    })()`),
  );
  assert.strictEqual(result[0].key, "0", "top figure block should remain before lower cross-page continuation text");
  assert(result[0].markdown.includes("fig-12-3.jpg"), "first review entry should be the figure");
  assert.strictEqual(result[1].key, "cross-page-continuation-18-0", "lower cross-page continuation should follow the figure by visual order");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 18;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.riskByPage.clear();
      state.contentListItems = [
        {
          type: "discarded",
          page_idx: 17,
          page_size: [919, 1256],
          bbox: [190, 225, 850, 330],
          text: "Fig. 12.2 Although the uncertainties in the measured post-Keplerian parameter continue to decrease."
        }
      ];
      state.mineruInfo = {
        pdf_info: Array.from({ length: 18 }, (_unused, index) => index === 17
          ? {
              page_size: [919, 1256],
              para_blocks: [
                {
                  type: "text",
                  bbox: [190, 145, 850, 210],
                  lines: [{ bbox: [190, 145, 850, 210], spans: [{ bbox: [190, 145, 850, 210], content: "two constraints, we obtain the values for the individual masses shown in Figure 12.2." }] }]
                }
              ]
            }
          : { page_size: [919, 1256], para_blocks: [] })
      };
      const risks = detectRiskCandidatesForPage(18);
      const entries = buildReviewEntriesForPage(risks, reviewSegmentsForPage(18), 18);
      const continuation = risks.find((risk) => risk.blockIndex === "content-list-discarded-18-0");
      const figureLabel = inferMissingFigureLabelForBlock(18, "content-list-discarded-18-0", continuation?.text || "");
      return JSON.stringify({
        continuation,
        figureLabel,
        entries: entries.map((entry) => ({ key: entry.key, text: entry.segment.markdown }))
      });
    })()`),
  );
  assert.strictEqual(result.entries[0].key, "0", "current-page body text should remain before figure narrative continuation candidates");
  assert.strictEqual(result.entries[1].key, "content-list-discarded-18-0", "figure narrative continuation should be anchored after the paragraph that references it");
  assert.strictEqual(result.continuation.syntheticPlacement, "after_anchor");
  assert.strictEqual(result.continuation.anchorBlockIndex, "0");
  assert(result.entries[1].text.startsWith("Although the uncertainties"), "narrative continuation should not keep an incorrect leading figure label");
  assert.strictEqual(result.figureLabel, "", "narrative continuation should not be treated as a figure caption needing a label");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 19;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.riskByPage.clear();
      state.contentListItems = [
        {
          type: "discarded",
          page_idx: 18,
          page_size: [919, 1256],
          bbox: [190, 760, 850, 930],
          text: "Table 12.3 The first two companion candidates, the helium star and the white dwarf, fell out of favor because of orbital perturbations."
        }
      ];
      state.mineruInfo = {
        pdf_info: Array.from({ length: 19 }, (_unused, index) => index === 18
          ? {
              page_size: [919, 1256],
              para_blocks: [
                {
                  type: "table",
                  bbox: [190, 90, 850, 380],
                  lines: [{ spans: [{ html: "<table><tr><th>Parameter</th><th>Value</th></tr></table>" }] }]
                },
                {
                  type: "text",
                  bbox: [190, 500, 850, 690],
                  lines: [{ spans: [{ content: "companion that were considered early on were a helium main-sequence star, a white dwarf, a neutron star and a black hole." }] }]
                }
              ]
            }
          : { page_size: [919, 1256], para_blocks: [] })
      };
      const risks = detectRiskCandidatesForPage(19);
      const entries = buildReviewEntriesForPage(risks, reviewSegmentsForPage(19), 19);
      return JSON.stringify(entries.map((entry) => ({ key: entry.key, text: entry.segment.markdown })));
    })()`),
  );
  assert.strictEqual(result[0].key, "0", "page-top table should remain first");
  assert.strictEqual(result[1].key, "1", "real prose immediately below a table should not be jumped over by lower content_list supplements");
  assert.strictEqual(result[2].key, "content-list-discarded-19-0", "lower content_list continuation should follow prose above its bbox");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 20;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.riskByPage.clear();
      state.contentListItems = [];
      state.mineruInfo = {
        pdf_info: Array.from({ length: 20 }, (_unused, index) => index === 19
          ? {
              page_size: [919, 1256],
              para_blocks: [
                {
                  type: "text",
                  bbox: [190, 70, 850, 330],
                  lines: [{ spans: [{ content: "The text below Figure 12.2 was assigned an overly high bbox by OCR." }] }]
                },
                {
                  type: "image",
                  bbox: [190, 95, 850, 520],
                  lines: [{ spans: [{ image_path: "fig-12-2.jpg" }] }]
                }
              ]
            }
          : { page_size: [919, 1256], para_blocks: [] })
      };
      return JSON.stringify(reviewSegmentsForPage(20).map((entry) => ({ key: String(entry.blockIndex), text: entry.markdown, kind: entry.kind })));
    })()`),
  );
  assert.strictEqual(result[0].key, "1", "page-top figure/table blocks should stay before following prose even when OCR gives the prose a higher bbox");
  assert.strictEqual(result[1].key, "0", "following prose should remain after the top media block");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 21;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.riskByPage.clear();
      state.contentListItems = [
        {
          type: "discarded",
          page_idx: 20,
          page_size: [919, 1256],
          bbox: [190, 1040, 850, 1180],
          text: "Fig. 12.2 Although the uncertainties continue to decrease, the later paragraph belongs near its own bbox."
        }
      ];
      state.mineruInfo = {
        pdf_info: Array.from({ length: 21 }, (_unused, index) => index === 20
          ? {
              page_size: [919, 1256],
              para_blocks: [
                {
                  type: "image",
                  bbox: [190, 80, 850, 430],
                  lines: [{ spans: [{ image_path: "fig-12-2.jpg" }] }]
                },
                {
                  type: "text",
                  bbox: [190, 460, 850, 650],
                  lines: [{ spans: [{ content: "Using Figure 12.2, we obtain the corrected orbital decay value." }] }]
                }
              ]
            }
          : { page_size: [919, 1256], para_blocks: [] })
      };
      const risks = detectRiskCandidatesForPage(21);
      const entries = buildReviewEntriesForPage(risks, reviewSegmentsForPage(21), 21);
      const supplemental = risks.find((risk) => risk.blockIndex === "content-list-discarded-21-0");
      return JSON.stringify({
        supplemental,
        entries: entries.map((entry) => ({ key: entry.key, text: entry.segment.markdown }))
      });
    })()`),
  );
  assert.notStrictEqual(result.supplemental.syntheticPlacement, "after_anchor", "bbox-backed figure narrative supplements should keep visual order instead of forcing after_anchor placement");
  assert(result.supplemental.anchorBlockIndex == null);
  assert(result.supplemental.text.startsWith("Although the uncertainties"), "figure narrative prefix should still be removed");
  assert.strictEqual(result.entries[0].key, "0", "top figure should remain first");
  assert.strictEqual(result.entries[1].key, "1", "existing body text should remain before the lower supplement");
  assert.strictEqual(result.entries[2].key, "content-list-discarded-21-0", "lower supplement should follow by its own bbox");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 22;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.riskByPage.clear();
      state.contentListItems = [
        {
          type: "discarded",
          page_idx: 21,
          page_size: [919, 1256],
          bbox: [190, 760, 850, 930],
          text: "Fig. 12.2 Although the uncertainties continue to decrease, the binary pulsar provides improved data on the galactic rotation curve."
        }
      ];
      state.mineruInfo = {
        pdf_info: Array.from({ length: 22 }, (_unused, index) => index === 21
          ? {
              page_size: [919, 1256],
              para_blocks: [
                {
                  type: "image",
                  bbox: [190, 80, 850, 430],
                  lines: [{ spans: [{ image_path: "fig-12-2.jpg" }] }]
                },
                {
                  type: "text",
                  bbox: [190, 760, 850, 930],
                  lines: [{ spans: [{ content: "Although the uncertainties continue to decrease, the binary pulsar provides improved data on the galactic rotation curve." }] }]
                }
              ]
            }
          : { page_size: [919, 1256], para_blocks: [] })
      };
      const risks = detectRiskCandidatesForPage(22);
      const entries = buildReviewEntriesForPage(risks, reviewSegmentsForPage(22), 22);
      return JSON.stringify(entries.map((entry) => ({ key: entry.key, text: entry.segment.markdown })));
    })()`),
  );
  assert.strictEqual(result.filter((entry) => entry.text.includes("binary pulsar provides improved data")).length, 1, "content_list figure narrative should not duplicate an existing body paragraph after removing the leading figure label");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 23;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.riskByPage.clear();
      state.contentListItems = [];
      state.mineruInfo = {
        pdf_info: Array.from({ length: 23 }, (_unused, index) => index === 22
          ? {
              page_size: [919, 1256],
              para_blocks: [
                {
                  type: "image",
                  bbox: [190, 80, 850, 430],
                  lines: [{ spans: [{ image_path: "fig-12-2.jpg" }] }]
                },
                {
                  type: "text",
                  lines: [{ spans: [{ content: "two constraints, we obtain the values for the individual masses." }] }]
                },
                {
                  type: "text",
                  bbox: [190, 760, 850, 930],
                  lines: [{ bbox: [190, 760, 850, 930], spans: [{ content: "Although the uncertainties continue to decrease, later observations improve the test." }] }]
                }
              ]
            }
          : { page_size: [919, 1256], para_blocks: [] })
      };
      return JSON.stringify(reviewSegmentsForPage(23).map((entry) => ({ key: String(entry.blockIndex), text: entry.markdown })));
    })()`),
  );
  assert.strictEqual(result[0].key, "0", "top media should remain first");
  assert.strictEqual(result[1].key, "1", "a following body block without bbox should keep source order instead of falling to the bottom");
  assert.strictEqual(result[2].key, "2", "later positioned text should stay after the no-bbox continuation");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 24;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.riskByPage.clear();
      state.contentListItems = [];
      state.mineruInfo = {
        pdf_info: Array.from({ length: 24 }, (_unused, index) => index === 23
          ? {
              page_size: [919, 1256],
              para_blocks: [
                {
                  type: "text",
                  bbox: [190, 760, 850, 930],
                  lines: [{ bbox: [190, 760, 850, 930], spans: [{ content: "Fig. 12.2 Although the uncertainties continue to decrease, the binary pulsar provides improved data." }] }]
                }
              ]
            }
          : { page_size: [919, 1256], para_blocks: [] })
      };
      return JSON.stringify(reviewSegmentsForPage(24).map((entry) => ({ key: String(entry.blockIndex), text: entry.markdown })));
    })()`),
  );
  assert.strictEqual(result[0].key, "0");
  assert(result[0].text.startsWith("Although the uncertainties"), "MinerU text blocks should also drop false leading figure/table narrative labels");
  assert(!result[0].text.startsWith("Fig. 12.2"), "false figure labels should not remain in body prose");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 25;
      state.ocrPatches = [];
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.riskByPage.clear();
      state.contentListItems = [
        {
          type: "discarded",
          page_idx: 24,
          page_size: [919, 1500],
          bbox: [190, 1235, 850, 1360],
          text: "Fig. 12.2 Although the uncertainties continue to decrease, the binary pulsar provides improved data on the galactic rotation curve."
        }
      ];
      state.mineruInfo = {
        pdf_info: Array.from({ length: 25 }, (_unused, index) => index === 24
          ? {
              page_size: [919, 1500],
              para_blocks: [
                {
                  type: "image",
                  bbox: [190, 80, 850, 350],
                  lines: [{ spans: [{ image_path: "fig-12-2.jpg" }] }]
                },
                {
                  type: "text",
                  bbox: [190, 380, 850, 700],
                  lines: [{ spans: [{ content: "The first paragraph after the figure should remain before the lower content-list paragraph." }] }]
                },
                {
                  type: "text",
                  bbox: [190, 1390, 850, 1460],
                  lines: [{ spans: [{ content: "A later paragraph should remain after the content-list paragraph by bbox." }] }]
                }
              ]
            }
          : { page_size: [919, 1256], para_blocks: [] })
      };
      const risks = detectRiskCandidatesForPage(25);
      const entries = buildReviewEntriesForPage(risks, reviewSegmentsForPage(25), 25);
      return JSON.stringify(entries.map((entry) => ({ key: entry.key, text: entry.segment.markdown })));
    })()`),
  );
  assert.strictEqual(result[0].key, "0", "top media block should remain first");
  assert.strictEqual(result[1].key, "1", "prose above a page-bottom content_list candidate should remain before it");
  assert.strictEqual(result[2].key, "content-list-discarded-25-0", "page-bottom content_list with bbox should sort by bbox instead of always last");
  assert(result[2].text.startsWith("Although the uncertainties"), "right-column render should remove narrative Fig/Table prefixes from supplemental prose");
  assert.strictEqual(result[3].key, "2", "later prose below the supplemental bbox should remain after it");
}

{
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 12;
      state.mineruInfo = {
        pdf_info: Array.from({ length: 12 }, (_unused, index) => index === 11
          ? {
              page_size: [919, 1256],
              para_blocks: [
                {
                  type: "text",
                  bbox: [20, 35, 760, 70],
                  lines: [{ bbox: [20, 35, 760, 70], spans: [{ bbox: [20, 35, 760, 70], content: "275 12.1 Binary Pulsars" }] }]
                },
                {
                  type: "text",
                  bbox: [320, 38, 760, 62],
                  lines: [{ bbox: [320, 38, 760, 62], spans: [{ bbox: [320, 38, 760, 62], content: "Strong-Field and Dynamical Tests of Relativistic Gravity" }] }]
                },
                {
                  type: "title",
                  bbox: [380, 64, 540, 88],
                  lines: [{ bbox: [380, 64, 540, 88], spans: [{ bbox: [380, 64, 540, 88], content: "Gravitational Radiation" }] }]
                },
                {
                  type: "title",
                  bbox: [390, 68, 530, 92],
                  lines: [{ bbox: [390, 68, 530, 92], spans: [{ bbox: [390, 68, 530, 92], content: "References" }] }]
                },
                {
                  type: "text",
                  bbox: [110, 130, 820, 260],
                  lines: [{ bbox: [110, 130, 820, 260], spans: [{ bbox: [110, 130, 820, 260], content: "ever found for pulsed radiation from the companion, so it is either a pulsar whose signal does not intersect the Earth." }] }]
                }
              ]
            }
          : { page_size: [919, 1256], para_blocks: [] })
      };
      return JSON.stringify({
        original: originalBlockMarkdownsForPage(12).map((entry) => entry.markdown),
        review: reviewSegmentsForPage(12).map((entry) => entry.markdown)
      });
    })()`),
  );
  assert(!result.original.some((text) => text.includes("12.1 Binary Pulsars")), "running page headers should be hidden from base page markdown");
  assert(!result.review.some((text) => text.includes("12.1 Binary Pulsars")), "running page headers should be hidden from right-column review");
  assert(!result.review.some((text) => text.includes("Strong-Field and Dynamical Tests")), "title-only running headers should also be hidden");
  assert(!result.review.some((text) => text.includes("Gravitational Radiation")), "short title running headers should be hidden");
  assert(!result.review.some((text) => text.includes("References")), "reference running headers should be hidden");
  assert(result.review.some((text) => text.includes("ever found for pulsed radiation")), "body text below the header should remain visible");
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
  assert(navHtml.includes("review-font-nav-group"));
  assert(!navHtml.includes("data-review-fit-page"), "right-column fit-page button should not be rendered");
  assert(navHtml.includes('data-review-font-scale="out"'));
  assert(navHtml.includes('data-review-font-scale="in"'));
  assert(!navHtml.includes("review-page-nav-group"));
  assert(!navHtml.includes('data-page-nav="review-workbench"'));
  assert(navHtml.includes("块 1 / 1"));
  assert(!navHtml.includes("下一高风险页"));
  assert(!navHtml.includes("data-next-risk-page"));
}

{
  const result = JSON.parse(
    call(`(() => {
      state.reviewFontScale = 1;
      state.reviewFitToPage = true;
      state.currentPage = 7;
      state.pageCache.set(7, { width: 612, height: 792 });
      setReviewFontScale("in");
      const scaledHtml = renderPageReviewCanvas([
        { key: "0", displayIndex: 1, segment: { blockIndex: "0", markdown: "Scaled source", kind: "text" }, risk: { blockIndex: "0", reviewOnly: true } }
      ]);
      setReviewFontScale("out");
      const resetScale = currentReviewFontScale();
      return JSON.stringify({ scaledHtml, resetScale, fitAfterFontChange: state.reviewFitToPage });
    })()`),
  );
  assert(result.scaledHtml.includes("--review-font-scale: 1.1"), "review page canvas should carry the current font scale");
  assert(!result.scaledHtml.includes("--review-page-aspect-ratio"), "right-column fit mode should not tie reflowed Markdown to the PDF page aspect ratio");
  assert.strictEqual(result.resetScale, 1, "review font scale controls should step back down");
  assert.strictEqual(result.fitAfterFontChange, false, "manual font scaling should exit right-column fit-page mode");
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
      state.pdfPageCount = 6;
      state.riskByPage.clear();
      state.mineruInfo = null;
      state.pdfImageZoom = 1;
      state.pdfFitToPage = false;
      const normal = renderImageCard({ pageNumber: 6, image: "data:image/png;base64,abc", width: 919, height: 1256 });
      state.pdfImageZoom = 1.75;
      const zoomed = renderImageCard({ pageNumber: 6, image: "data:image/png;base64,abc", width: 919, height: 1256 });
      state.pdfFitToPage = true;
      const fitted = renderImageCard({ pageNumber: 6, image: "data:image/png;base64,abc", width: 919, height: 1256 });
      return JSON.stringify({
        normalClass: normal.className,
        zoomedClass: zoomed.className,
        fittedClass: fitted.className,
        normalHtml: normal.innerHTML,
        zoomedHtml: zoomed.innerHTML,
        fittedHtml: fitted.innerHTML,
        listeners
      });
    })()`),
  );
  assert(result.normalHtml.includes('data-image-zoom="in"'));
  assert(result.normalHtml.includes('data-image-zoom="out"'));
  assert(result.normalHtml.includes("data-image-fit-page"));
  assert(result.normalHtml.includes('data-page-nav="source-page"'));
  assert(result.normalHtml.includes('data-page-jump="prev"'));
  assert(result.normalHtml.includes('data-page-jump="next"'));
  assert(result.normalHtml.includes('data-source-page-thumbnail="6"'), "left source pane should include PDF-like page thumbnails");
  assert(result.normalHtml.includes("source-page-viewer"));
  assert(result.normalHtml.includes("image-zoom-glyph"));
  assert(result.normalHtml.includes("page-image-surface"));
  assert(result.normalHtml.includes("data-page-image-focus"));
  assert(!result.normalHtml.includes("source-page-title"));
  assert(!result.normalHtml.includes("原文单页"));
  assert(!result.normalHtml.includes("919 × 1256"));
  assert(!result.normalHtml.includes("image-zoom-label"));
  assert(!result.normalHtml.includes("125%"));
  assert(result.zoomedHtml.includes("--pdf-image-zoom: 1.75"));
  assert(!result.normalClass.includes("is-zoomed"));
  assert(result.zoomedClass.includes("is-zoomed"));
  assert(result.fittedClass.includes("is-fit-page"));
  assert(!result.fittedClass.includes("is-zoomed"));
  assert(result.fittedHtml.includes("--pdf-page-aspect-ratio: 919 / 1256"));
  assert(result.listeners.includes("click"));
  assert(!result.listeners.includes("wheel"), "left source pane should not bind wheel-driven page navigation");
  assert(!source.includes("handleSourcePageWheelNavigation"), "left source pane should not keep wheel-driven page navigation code");
  assert(!source.includes('addEventListener("wheel"'), "left source pane should not register wheel navigation listeners");
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
  const result = JSON.parse(
    call(`(() => {
      state.currentPage = 1;
      state.pdfPageCount = 2;
      state.reviewExpanded = new Set(["1:1"]);
      state.riskByPage.clear();
      state.mineruInfo = {
        pdf_info: [
          {
            page_size: [100, 100],
            para_blocks: [
              { type: "text", bbox: [0, 0, 10, 10], lines: [{ spans: [{ content: "Page one block A." }] }] },
              { type: "text", bbox: [0, 20, 10, 30], lines: [{ spans: [{ content: "Page one block B." }] }] }
            ]
          },
          {
            page_size: [100, 100],
            para_blocks: [
              { type: "text", bbox: [0, 0, 10, 10], lines: [{ spans: [{ content: "Page two block A." }] }] }
            ]
          }
        ]
      };
      const entries = reviewEntriesForCurrentPage();
      const target = reviewBlockStepTarget("next", entries, activeReviewEntryIndex(entries));
      const html = renderReviewNavigationBar(entries);
      return JSON.stringify({ target, html });
    })()`),
  );
  assert.deepStrictEqual(result.target, { pageNumber: 2, blockIndex: "0" }, "next block navigation should cross to the next page");
  assert(result.html.includes('data-review-block-step="next"'));
  assert(!/data-review-block-step="next" disabled/.test(result.html), "next block button should stay enabled when next page has blocks");
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
      const emptyNeedsNav = renderReviewNavigationBar(entries);
      const canvas = renderPageReviewCanvas(entries);
      state.reviewNeedsCorrection.clear();
      state.reviewNeedsCorrection.add("1:1");
      const needsNav = renderReviewNavigationBar(entries);
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
        emptyNeedsNav,
        needsNav,
        markedCanvas,
        actionsCanvas,
        correctionCanvas,
        hotspots,
        selected: Array.from(state.reviewExpanded)
      });
    })()`),
  );
  assert(canvasResult.canvas.includes('class="review-list review-page-canvas markdown-body"'), "v2 review should render a page canvas");
  assert(canvasResult.emptyNeedsNav.includes("待校正 0"), "needs-correction nav should show zero when no current-page blocks are marked");
  assert(canvasResult.needsNav.includes("待校正 1"), "needs-correction nav should count current-page marked blocks");
  assert(canvasResult.needsNav.includes('data-review-needs-correction-jump="1:1"'), "needs-correction nav should expose a jump button");
  assert(canvasResult.needsNav.includes(">2</button>"), "needs-correction nav should use the marked block display index");
  assert(canvasResult.canvas.includes('data-review-page-block="1:0"'), "plain paragraph block should be present in the full-page canvas");
  assert(canvasResult.canvas.includes('data-review-page-block="1:1"'), "formula block should be present in the full-page canvas");
  assert(canvasResult.canvas.includes('data-review-page-block="1:2"'), "image block without bbox should still be present in the full-page canvas");
  assert(canvasResult.canvas.includes('class="math-display'), "formula block should render as display math inside the page canvas");
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
  assert(!canvasResult.correctionCanvas.includes('aria-label="收起校正面板"'), "correction panel toolbar should not expose a separate collapse action");
  assert(!canvasResult.correctionCanvas.includes(">⌃⌃</button>"), "correction panel toolbar should not render the old double-arrow collapse action");
  assert(canvasResult.correctionCanvas.includes(">保存</button>"), "correction panel should expose an explicit save action");
  assert(canvasResult.correctionCanvas.includes(">撤销</button>"), "correction panel should expose an explicit revert action");
  assert(!canvasResult.correctionCanvas.includes(">取消</button>"), "correction panel toolbar should not use the old cancel wording");
  assert(!canvasResult.correctionCanvas.includes("selected-edit-state"), "correction panel toolbar should not show the old keep-edit state action");
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
  assert(sourceChoice.acceptedCanvas.includes("<summary>查看/编辑</summary>"), "accepted blocks should expose a concise corrected markdown editor summary");
  assert(!sourceChoice.acceptedCanvas.includes("查看/编辑 Mathpix draft / accepted Markdown"), "accepted editor summary should not include the old verbose English suffix");
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
  const visualFigureLabel = JSON.parse(
    call(`(() => {
      state.currentPage = 12;
      state.ocrPatches = [];
      state.reviewExpanded.clear();
      state.reviewCorrectionOpen.clear();
      state.reviewNeedsCorrection.clear();
      state.riskByPage.clear();
      state.mineruOverrides.clear();
      state.mineruBlockOverrides.clear();
      state.mathpixBlockDrafts.clear();
      state.contentListItems = [];
      state.pdfTextPageCache.clear();
      state.mineruInfo = {
        pdf_info: Array.from({ length: 12 }, (_unused, index) => index === 11
          ? {
              page_size: [919, 1256],
              para_blocks: [
                {
                  type: "text",
                  bbox: [185, 830, 820, 900],
                  lines: [{ spans: [{ content: "Bounds on scalar-tensor theories from solar-system and binary-pulsar tests. Image reproduced with permission from Freire et al. (2012), copyright by Oxford University Press." }] }]
                }
              ]
            }
          : { page_size: [919, 1256], para_blocks: [] })
      };
      state.pdfTextPageCache.set(12, {
        pageSize: [919, 1256],
        textBlocks: [
          { text: "Fig. 12.4", bbox: [70, 838, 170, 870] }
        ]
      });
      const source = reviewSegmentsForPage(12)[0].markdown;
      const label = inferMissingFigureLabelForBlock(12, "0", source);
      const corrected = autoCorrectFigureCaptionLabelMarkdown(12, "0", source);
      const changed = applyAutomaticLocalCorrectionsForPage(12);
      const patch = state.ocrPatches[0] || null;
      return JSON.stringify({ label, corrected, changed, patchText: patch?.newText || "", autoCorrection: patch?.metadata?.autoCorrection || "" });
    })()`),
  );
  assert.strictEqual(visualFigureLabel.label, "Fig. 12.4", "caption should infer a nearby standalone PDF figure label");
  assert(visualFigureLabel.corrected.startsWith("Fig. 12.4 Bounds on scalar-tensor theories"), "visual figure label should be prepended to caption text");
  assert.strictEqual(visualFigureLabel.changed, 1, "automatic local corrections should preserve missing figure caption numbers");
  assert(visualFigureLabel.patchText.startsWith("Fig. 12.4 Bounds on scalar-tensor theories"));
  assert.strictEqual(visualFigureLabel.autoCorrection, "figure_caption_label_preservation");
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
assert(mixedAlignedRenderHtml.includes('class="math-display'), "bare aligned environment inside a text block should render as display math");
assert(!mixedAlignedRenderHtml.includes("<p>For weak interactions, the result is<br>\\\\begin{aligned}"), "aligned source must not remain inside the prose paragraph");

const algorithmTaggedMathRenderHtml = call(`renderBlockContent(${JSON.stringify(
  "For weak interactions, while the parity nonconserving part is negligible\n\\begin{aligned}\n\\frac{E^{\\mathrm{W}}}{mc^2} &= 2.2 \\times 10^{-8} g(N,Z) \\\\\\\\\ng(N,Z) &= 0.295 \\left[ \\frac{(N-Z)^2}{2NZ} \\right]\n\\end{aligned}\nwhere N=A-Z.",
)}, { kind: "algorithm", blockIndex: "weak" })`);
assert(algorithmTaggedMathRenderHtml.includes('class="math-display'), "algorithm-tagged OCR blocks containing LaTeX environments should still render as math");
assert(!algorithmTaggedMathRenderHtml.includes("algorithm-block"), "algorithm-tagged math prose should not render as an algorithm code block");

const danglingDollarMathRenderHtml = call(`renderBlockContent(${JSON.stringify(
  "For weak interactions, the result is\n$\n\\begin{aligned}\nE &= mc^2\n\\end{aligned}\nwhere N=A-Z.",
)}, { kind: "text", blockIndex: "dangling-dollar" })`);
assert(danglingDollarMathRenderHtml.includes('class="math-display'), "formula blocks with a dangling single-dollar line should still render as math");
assert(!danglingDollarMathRenderHtml.includes("<p>$</p>"), "dangling single-dollar lines should not render before display math");
assert(!/>\\s*\\$\\s*</.test(danglingDollarMathRenderHtml), "dangling dollar delimiters should not remain as visible text nodes");

const escapedDanglingDollarMathRenderHtml = call(`renderBlockContent(${JSON.stringify(
  "For weak interactions, the result is\n\\$\n$$\n\\begin{aligned}\nE &= mc^2\n\\end{aligned}\n$$\nwhere N=A-Z.",
)}, { kind: "text", blockIndex: "escaped-dangling-dollar" })`);
assert(escapedDanglingDollarMathRenderHtml.includes('class="math-display'), "escaped dangling dollar lines before display math should still render as math");
assert(!/>\\s*\\$\\s*</.test(escapedDanglingDollarMathRenderHtml), "escaped dangling dollar delimiters should not remain as visible text nodes");

const compactedMathpixSource = call(`cleanMathpixEditableMarkdown(${JSON.stringify(
  "$$\n\\begin{array} { r l r } { { \\frac { d P _ { \\mathrm { T } } ^ { 0 } } { d t } = - \\operatorname* { l i m } _ { R \\to \\infty } \\int \\tilde { \\tau } ^ { 0 } d ^ { 2 } S _ { j } } } \\\\ & \\end{array}\n$$",
)})`);
assert(compactedMathpixSource.includes("\\begin{array}{rlr}"), "editable Mathpix source should compact spaced array column specs");
assert(/^\$\$\n\\begin\{array\}\{rlr\}\n/m.test(compactedMathpixSource), "editable Mathpix source should put array begin on its own line");
assert(/\\\\\n&\n\\end\{array\}\n\$\$$/m.test(compactedMathpixSource), "editable Mathpix source should line-break after LaTeX row separators and put array end on its own line");
assert(compactedMathpixSource.includes("\\frac{d P_{\\mathrm{T}}^{0}}{d t}"), "editable Mathpix source should compact command/braces/subscript spacing");
assert(compactedMathpixSource.includes("\\operatorname*{lim}_{R \\to \\infty}"), "editable Mathpix source should compact spaced operator names");
assert(!compactedMathpixSource.includes("\\frac {"), "editable Mathpix source should not keep spaced command braces");
assert(!compactedMathpixSource.includes("\\mathrm {"), "editable Mathpix source should not keep spaced roman command braces");
assert(!compactedMathpixSource.includes("{{\\frac"), "editable Mathpix source should remove redundant whole-expression double braces");

const hoistedStandaloneTagSource = call(`cleanMathpixEditableMarkdown(${JSON.stringify(
  "$$\n\\begin{array}{l}\nS_{-} \\equiv \\mathcal{G}^{-1 / 2} \\big( s_{2} - s_{1} \\big), \\\\\nS_{+} \\equiv \\mathcal{G}^{-1 / 2} \\big( 1 - s_{1} - s_{2} \\big).\n\\end{array}\n$$\n\\tag{11.118}\n$$\n$$",
)})`);
assert(hoistedStandaloneTagSource.includes("\\end{array}\\tag{11.118}"), "standalone equation tags after display math should be hoisted into the previous formula block");
assert(!/\$\$\s*\\tag\{11\.118\}/.test(hoistedStandaloneTagSource), "standalone equation tags should not remain outside display math");
assert(!/\$\$\s*\$\$/.test(hoistedStandaloneTagSource), "empty display math blocks after hoisted tags should be removed");

const hoistedStandaloneTagRender = call(`renderBlockContent(${JSON.stringify(
  "$$\n\\begin{array}{l}\nS_{-} \\equiv \\mathcal{G}^{-1 / 2} \\big( s_{2} - s_{1} \\big), \\\\\nS_{+} \\equiv \\mathcal{G}^{-1 / 2} \\big( 1 - s_{1} - s_{2} \\big).\n\\end{array}\n$$\n\\tag{11.118}\n$$\n$$",
)}, { kind: "text", blockIndex: "hoisted-standalone-tag" })`);
assert.strictEqual((hoistedStandaloneTagRender.match(/<div class="math-display(?:\s|")/g) || []).length, 1, "hoisted standalone tags should render as one display math block");
assert(hoistedStandaloneTagRender.includes("(11.118)"), "hoisted standalone tags should remain visible as equation labels");
assert(!hoistedStandaloneTagRender.includes("\\\\tag{11.118}"), "hoisted standalone tags should not leak raw LaTeX tag text");

const hoistedTagOnlyDisplaySource = call(`cleanMathpixEditableMarkdown(${JSON.stringify(
  "$$\nE &= mc^2\n$$\n\n$$\n\\tag{2.14}\n$$\n\n$$\n$$",
)})`);
assert(hoistedTagOnlyDisplaySource.includes("E &= mc^2\\tag{2.14}"), "tag-only display math blocks should be merged into the previous formula");
assert(!/\$\$\s*\\tag\{2\.14\}\s*\$\$/.test(hoistedTagOnlyDisplaySource), "tag-only display math blocks should not remain as standalone formulas");
assert(!/\$\$\s*\$\$/.test(hoistedTagOnlyDisplaySource), "empty display math blocks after tag-only formulas should be removed");

const hoistedSingleLineTagOnlyDisplaySource = call(`cleanMathpixEditableMarkdown(${JSON.stringify(
  "$$\nA=B\n$$\n$$\\tag{2.15}$$\n$$\n$$",
)})`);
assert(hoistedSingleLineTagOnlyDisplaySource.includes("A=B\\tag{2.15}"), "single-line tag-only display math blocks should be merged into the previous formula");
assert(!hoistedSingleLineTagOnlyDisplaySource.includes("$$\\tag{2.15}$$"), "single-line tag-only display math should not remain standalone");

const compactedMathpixProseSource = call(`cleanMathpixEditableMarkdown(${JSON.stringify(
  "Assuming the1 \\\\sigma$bound of $| \\\\eta | < 2 \\\\times 10 ^{- 13}$ from the latest summary of Eöt-Wash experiments, we show the various $\\\\eta^{A}$ parameters.",
)})`);
assert(/the 1 \$\\sigma\$ bound/.test(compactedMathpixProseSource), "editable Mathpix source should repair a broken textual sigma bound");
assert(/\$\|\\eta\| < 2 \\times 10\^{-13}\$/.test(compactedMathpixProseSource), "editable Mathpix source should compact harmless inline LaTeX spacing");
assert(!compactedMathpixProseSource.includes("10 ^{- 13}"), "editable Mathpix source should remove exponent sign spacing");
assert(compactedMathpixProseSource.includes("Eöt-Wash"), "Markdown prose should keep Unicode accents because the renderer escapes raw HTML and does not render LaTeX text accents outside math");

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
assert(!visibleNumberedAlignedPatch.includes("\n\\tag{2.12}"), "normalized visible equation number should not place the tag on its own line");

const numberedDollarDisplayPatch = call(`insertEquationNumberIntoDisplayMath("$$\\nE^S=-15.75A\\n$$", "(2.8)")`);
assert(numberedDollarDisplayPatch.includes("\\tag{2.8}"), "display math without an explicit environment should receive a LaTeX tag");
assert(!numberedDollarDisplayPatch.trimEnd().endsWith("(2.8)"), "display math numbers should not be appended as prose");
assert(numberedDollarDisplayPatch.includes("E^S=-15.75A\\tag{2.8}"), "display math tags should stay on the formula line instead of a new line");

const renderedNumberedDollarDisplay = call(`renderBlockContent("$$\\nE^S=-15.75A\\n\\\\tag{2.8}\\n$$", { kind: "interline_equation", blockIndex: "0" })`);
assert(renderedNumberedDollarDisplay.includes("math-display-equation-tag"), "rendered display math should expose a visible equation-number tag");
assert(renderedNumberedDollarDisplay.includes('class="math-display'), "numbered display math should keep the stable display-math class");
assert(renderedNumberedDollarDisplay.includes("is-singleline"), "single-line display math should get same-line equation label positioning");
assert(renderedNumberedDollarDisplay.includes('data-equation-tag="true"'), "numbered display math should expose an equation-tag layout marker");
assert(renderedNumberedDollarDisplay.includes("(2.8)"), "rendered display math should show the equation number");
assert(!renderedNumberedDollarDisplay.includes("\\\\tag{2.8}"), "rendered display math should not rely on raw LaTeX tag visibility");

const renderedNumberedAlignedDisplay = call(`renderBlockContent("\\\\begin{aligned}\\nE &= mc^2\\n\\\\tag{2.12}\\n\\\\end{aligned}", { kind: "text", blockIndex: "aligned-numbered" })`);
assert(renderedNumberedAlignedDisplay.includes("math-display-equation-tag"), "rendered aligned math should expose a visible equation-number tag");
assert(renderedNumberedAlignedDisplay.includes("(2.12)"), "rendered aligned math should show the equation number");
assert(renderedNumberedAlignedDisplay.includes("is-singleline"), "single-row aligned math should get same-line equation label positioning");

const renderedNumberedMultilineDisplay = call(`renderBlockContent("\\\\begin{aligned}\\na &= b \\\\\\\\\\nc &= d\\\\tag{2.13}\\n\\\\end{aligned}", { kind: "text", blockIndex: "aligned-multiline-numbered" })`);
assert(renderedNumberedMultilineDisplay.includes("is-multiline"), "multi-row aligned math should position the label near the final formula row");
assert(renderedNumberedMultilineDisplay.includes("(2.13)"), "multi-row aligned math should show the equation number");

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

const normalizedBrokenDiacritics = JSON.parse(
  call(`(() => {
    state.ocrPatches = [];
    const direct = normalizeMathpixBrokenDiacritics("laboratory Eotv¨os experiments, gravitational interactions are¨ totally irrelevant.");
    const spaced = normalizeMathpixBrokenDiacritics("The Eotv¨ os experiment.");
    const patch = createAndStoreDraftOcrPatch({
      pageNo: 43,
      blockIndex: "accented-name",
      oldText: "laboratory Eotvos experiments, gravitational interactions are totally irrelevant.",
      newText: "laboratory Eotv¨os experiments, gravitational interactions are¨ totally irrelevant.",
      source: "mathpix"
    });
    return JSON.stringify({ direct, spaced, patchText: patch.normalizedText });
  })()`),
);
assert(normalizedBrokenDiacritics.direct.includes("laboratory Eötvös experiments"), "Mathpix broken Eotv¨os should normalize to Eötvös");
assert(normalizedBrokenDiacritics.direct.includes("interactions are totally irrelevant"), "orphan diaeresis should not drift into the next word");
assert(normalizedBrokenDiacritics.spaced.includes("The Eötvös experiment."), "spaced broken diaeresis in Eötvös should normalize");
assert(normalizedBrokenDiacritics.patchText.includes("laboratory Eötvös experiments"), "stored Mathpix draft patch should normalize known broken diacritics");
assert(!normalizedBrokenDiacritics.patchText.includes("are¨ totally"), "stored Mathpix draft patch should drop orphan diaeresis marks");

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
