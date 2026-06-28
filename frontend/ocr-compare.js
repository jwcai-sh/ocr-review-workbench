const RUNTIME_CONFIG = window.__UMA_RUNTIME_CONFIG__ || {};
const LOCAL_API_BASE_CANDIDATES = ["http://127.0.0.1:8790", "http://127.0.0.1:8787"];
let apiBase = resolveApiBase();

const DEFAULT_PDF_IMAGE_ZOOM = 1.25;
const DEFAULT_REVIEW_FONT_SCALE = 1;
const OCR_COMPARE_BUILD_ID = "20260628-science-inline-font";
document.documentElement?.setAttribute?.("data-ocr-compare-build-id", OCR_COMPARE_BUILD_ID);

const state = {
  pdfFile: null,
  pdfDataUrl: "",
  pdfDocumentId: "",
  pdfLocalDocument: null,
  pdfPageCount: 0,
  currentPage: 1,
  pageCache: new Map(),
  pdfTextPageCache: new Map(),
  mineruInfo: null,
  mineruFileName: "",
  contentListItems: [],
  contentListFileName: "",
  mineruOverrides: new Map(),
  mineruBlockOverrides: new Map(),
  mathpixBlockDrafts: new Map(),
  liveReviewDrafts: new Map(),
  mathpixBlockErrors: new Map(),
  ocrPatches: [],
  acceptedPatchPreview: null,
  acceptedPatchBookPreview: null,
  riskByPage: new Map(),
  mathpixCache: new Map(),
  reviewExpanded: new Set(),
  reviewCorrectionOpen: new Set(),
  reviewActionsOpen: new Set(),
  reviewNeedsCorrection: new Set(),
  reviewInitializedPages: new Set(),
  pdfImageZoom: DEFAULT_PDF_IMAGE_ZOOM,
  pdfFitToPage: false,
  reviewFontScale: DEFAULT_REVIEW_FONT_SCALE,
  reviewFitToPage: false,
  middleColumnCollapsed: false,
  mathpixConfigured: null,
  mathpixConfigError: "",
  busy: false,
};
state.ocrPatches = state.ocrPatches || [];

const els = {};
const COLUMN_WIDTHS_KEY = "uma-ocr-compare-column-ratios-v6";
const MIDDLE_COLUMN_COLLAPSED_KEY = "uma-ocr-compare-middle-collapsed-v1";
const OCR_WORKSPACE_STORAGE_PREFIX = "uma-ocr-compare-workspace-v1";
const PDF_IMAGE_ZOOM_LEVELS = [1, 1.25, 1.5, 1.75, 2, 2.5];
const REVIEW_FONT_SCALE_LEVELS = [0.9, 1, 1.1, 1.2, 1.35, 1.5];
const PDF_UPLOAD_CHUNK_SIZE = 1024 * 1024;
const PDFJS_SCRIPT_URLS = [
  "./vendor/pdfjs/pdf.mjs",
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs",
];
const PDFJS_WORKER_URL = "./vendor/pdfjs/pdf.worker.mjs";
const MATHJAX_SCRIPT_URLS = [
  "./vendor/mathjax/tex-chtml.js",
  "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js",
  "https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-chtml.min.js",
  "https://unpkg.com/mathjax@3/es5/tex-chtml.js",
];
const MATHJAX_LOAD_TIMEOUT_MS = 12000;
const BLOCK_MATHPIX_CROP_PADDING = { horizontal: 4, vertical: 1 };
const LEGACY_COLUMN_WIDTHS_KEYS = [
  "uma-ocr-compare-column-widths",
  "uma-ocr-compare-column-fractions-v2",
  "uma-ocr-compare-column-fractions-v3",
  "uma-ocr-compare-column-ratios-v4",
  "uma-ocr-compare-column-ratios-v5",
];

let ocrCoreNormalizeMathDelimiters = null;
let ocrCoreNormalizerLoadStarted = false;
let ocrCoreNormalizerWarningShown = false;
let ocrCoreAdaptMathpixToTargetMarkdown = null;
let ocrCoreMathpixAdapterLoadStarted = false;
let ocrCoreMathpixAdapterWarningShown = false;
let ocrCoreHashBlockText = null;
let ocrCoreCreateOcrPatch = null;
let ocrCoreMergeAcceptedPatches = null;
let ocrCoreValidateRenderability = null;
let ocrCorePatchLoadStarted = false;
let ocrCorePatchWarningShown = false;
let mathJaxLoadPromise = null;
let pdfJsLoadPromise = null;
let riskAnalysisTimer = null;
let riskAnalysisRunId = 0;
let renderCurrentPageRunId = 0;
let pagePrefetchTimer = null;
let liveReviewPreviewTimer = null;
let liveReviewPreviewRunId = 0;
const handledFileInputSignatures = new Map();
const pendingPagePreviewRequests = new Map();
const pendingMathTypesetRoots = new Set();
let mathTypesetTimer = null;

function getOcrCoreNormalizeMathDelimiters() {
  if (ocrCoreNormalizeMathDelimiters) {
    return ocrCoreNormalizeMathDelimiters;
  }
  if (typeof require === "function") {
    try {
      const module = require("./ocr-core/normalization/mathDelimiterNormalizer");
      if (typeof module?.normalizeMathDelimiters === "function") {
        ocrCoreNormalizeMathDelimiters = module.normalizeMathDelimiters;
        return ocrCoreNormalizeMathDelimiters;
      }
    } catch (error) {
      warnOcrCoreNormalizer("无法通过 require 加载 mathDelimiterNormalizer。", error);
    }
  }
  const browserModule = globalThis?.OcrCoreMathDelimiterNormalizer;
  if (typeof browserModule?.normalizeMathDelimiters === "function") {
    ocrCoreNormalizeMathDelimiters = browserModule.normalizeMathDelimiters;
    return ocrCoreNormalizeMathDelimiters;
  }
  loadOcrCoreNormalizerForBrowser();
  return null;
}

function loadOcrCoreNormalizerForBrowser() {
  if (ocrCoreNormalizerLoadStarted || typeof document === "undefined" || typeof document.createElement !== "function") {
    return;
  }
  ocrCoreNormalizerLoadStarted = true;
  const script = document.createElement("script");
  script.src = "./ocr-core/normalization/mathDelimiterNormalizer.browser.js";
  script.async = false;
  script.dataset.ocrCore = "math-delimiter-normalizer";
  script.addEventListener("error", () => {
    warnOcrCoreNormalizer("浏览器兼容入口 mathDelimiterNormalizer.browser.js 加载失败。");
  });
  (document.head || document.body || document.documentElement).appendChild(script);
}

function warnOcrCoreNormalizer(message, error) {
  if (ocrCoreNormalizerWarningShown || typeof console === "undefined" || typeof console.warn !== "function") {
    return;
  }
  ocrCoreNormalizerWarningShown = true;
  console.warn(`[OCR Core] ${message}`, error || "");
}

loadOcrCoreNormalizerForBrowser();

function getOcrCoreAdaptMathpixToTargetMarkdown() {
  if (ocrCoreAdaptMathpixToTargetMarkdown) {
    return ocrCoreAdaptMathpixToTargetMarkdown;
  }
  const browserModule = globalThis?.OcrCoreMathpixAdapter;
  if (typeof browserModule?.adaptMathpixToTargetMarkdown === "function") {
    ocrCoreAdaptMathpixToTargetMarkdown = browserModule.adaptMathpixToTargetMarkdown;
    return ocrCoreAdaptMathpixToTargetMarkdown;
  }
  if (typeof require === "function") {
    try {
      const module = require("./ocr-core/mathpix/mathpixToTargetMarkdownAdapter");
      if (typeof module?.adaptMathpixToTargetMarkdown === "function") {
        ocrCoreAdaptMathpixToTargetMarkdown = module.adaptMathpixToTargetMarkdown;
        return ocrCoreAdaptMathpixToTargetMarkdown;
      }
    } catch (error) {
      warnOcrCoreMathpixAdapter("无法通过 require 加载 mathpixToTargetMarkdownAdapter。", error);
    }
  }
  return null;
}

function loadOcrCoreMathpixAdapterForBrowser() {
  if (ocrCoreMathpixAdapterLoadStarted || typeof document === "undefined" || typeof document.createElement !== "function") {
    return;
  }
  ocrCoreMathpixAdapterLoadStarted = true;
  const script = document.createElement("script");
  script.src = "./ocr-core/mathpix/mathpixToTargetMarkdownAdapter.browser.js";
  script.async = false;
  script.dataset.ocrCore = "mathpix-adapter";
  script.addEventListener("error", () => {
    warnOcrCoreMathpixAdapter("浏览器兼容入口 mathpixToTargetMarkdownAdapter.browser.js 加载失败。");
  });
  (document.head || document.body || document.documentElement).appendChild(script);
}

function warnOcrCoreMathpixAdapter(message, error) {
  if (ocrCoreMathpixAdapterWarningShown || typeof console === "undefined" || typeof console.warn !== "function") {
    return;
  }
  ocrCoreMathpixAdapterWarningShown = true;
  console.warn(`[OCR Core] ${message}`, error || "");
}

loadOcrCoreMathpixAdapterForBrowser();

function getOcrCoreHashBlockText() {
  if (ocrCoreHashBlockText) {
    return ocrCoreHashBlockText;
  }
  const browserModule = globalThis?.OcrCorePatch;
  if (typeof browserModule?.hashBlockText === "function") {
    ocrCoreHashBlockText = browserModule.hashBlockText;
    return ocrCoreHashBlockText;
  }
  if (typeof require === "function") {
    try {
      const module = require("./ocr-core/patch/blockHasher");
      if (typeof module?.hashBlockText === "function") {
        ocrCoreHashBlockText = module.hashBlockText;
        return ocrCoreHashBlockText;
      }
    } catch (error) {
      warnOcrCorePatch("无法通过 require 加载 blockHasher。", error);
    }
  }
  loadOcrCorePatchForBrowser();
  return null;
}

function getOcrCoreCreateOcrPatch() {
  if (ocrCoreCreateOcrPatch) {
    return ocrCoreCreateOcrPatch;
  }
  const browserModule = globalThis?.OcrCorePatch;
  if (typeof browserModule?.createOcrPatch === "function") {
    ocrCoreCreateOcrPatch = browserModule.createOcrPatch;
    return ocrCoreCreateOcrPatch;
  }
  if (typeof require === "function") {
    try {
      const module = require("./ocr-core/patch/patchGenerator");
      if (typeof module?.createOcrPatch === "function") {
        ocrCoreCreateOcrPatch = module.createOcrPatch;
        return ocrCoreCreateOcrPatch;
      }
    } catch (error) {
      warnOcrCorePatch("无法通过 require 加载 patchGenerator。", error);
    }
  }
  loadOcrCorePatchForBrowser();
  return null;
}

function getOcrCoreMergeAcceptedPatches() {
  if (ocrCoreMergeAcceptedPatches) {
    return ocrCoreMergeAcceptedPatches;
  }
  const browserModule = globalThis?.OcrCorePatch;
  if (typeof browserModule?.mergeAcceptedPatches === "function") {
    ocrCoreMergeAcceptedPatches = browserModule.mergeAcceptedPatches;
    return ocrCoreMergeAcceptedPatches;
  }
  if (typeof require === "function") {
    try {
      const module = require("./ocr-core/patch/patchMerger");
      if (typeof module?.mergeAcceptedPatches === "function") {
        ocrCoreMergeAcceptedPatches = module.mergeAcceptedPatches;
        return ocrCoreMergeAcceptedPatches;
      }
    } catch (error) {
      warnOcrCorePatch("无法通过 require 加载 patchMerger。", error);
    }
  }
  loadOcrCorePatchForBrowser();
  return null;
}

function loadOcrCorePatchForBrowser() {
  if (ocrCorePatchLoadStarted || typeof document === "undefined" || typeof document.createElement !== "function") {
    return;
  }
  ocrCorePatchLoadStarted = true;
  const script = document.createElement("script");
  script.src = "./ocr-core/patch/ocrPatch.browser.js";
  script.async = false;
  script.dataset.ocrCore = "ocr-patch";
  script.addEventListener("error", () => {
    warnOcrCorePatch("浏览器兼容入口 ocrPatch.browser.js 加载失败。");
  });
  (document.head || document.body || document.documentElement).appendChild(script);
}

function getOcrCoreValidateRenderability() {
  if (ocrCoreValidateRenderability) {
    return ocrCoreValidateRenderability;
  }
  if (typeof require === "function") {
    try {
      const module = require("./ocr-core/validation/renderValidator");
      if (typeof module?.validateRenderability === "function") {
        ocrCoreValidateRenderability = module.validateRenderability;
        return ocrCoreValidateRenderability;
      }
    } catch (error) {
      warnOcrCorePatch("无法通过 require 加载 renderValidator。", error);
    }
  }
  const browserModule = globalThis?.OcrCoreRenderValidator;
  if (typeof browserModule?.validateRenderability === "function") {
    ocrCoreValidateRenderability = browserModule.validateRenderability;
    return ocrCoreValidateRenderability;
  }
  return null;
}

function warnOcrCorePatch(message, error) {
  if (ocrCorePatchWarningShown || typeof console === "undefined" || typeof console.warn !== "function") {
    return;
  }
  ocrCorePatchWarningShown = true;
  console.warn(`[OCR Core] ${message}`, error || "");
}

loadOcrCorePatchForBrowser();

function apiUrl(path) {
  return `${apiBase}${path}`;
}

function resolveApiBase() {
  const configured = configuredApiBase();
  if (configured) {
    return configured;
  }
  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    return "";
  }
  return LOCAL_API_BASE_CANDIDATES[0];
}

function normalizeApiBase(base) {
  const normalized = String(base || "").trim().replace(/\/+$/, "");
  if (!normalized || normalized === "null" || normalized === "file:" || normalized.startsWith("file://")) {
    return "";
  }
  return normalized;
}

function configuredApiBase() {
  return normalizeApiBase(RUNTIME_CONFIG.apiBaseUrl || RUNTIME_CONFIG.backendUrl || "");
}

function localApiBaseFallbacks() {
  if (configuredApiBase() || window.location.protocol !== "file:") {
    return [apiBase];
  }
  return Array.from(new Set([apiBase, ...LOCAL_API_BASE_CANDIDATES].map(normalizeApiBase)));
}

async function fetchApi(path, options = {}) {
  let lastError = null;
  for (const base of localApiBaseFallbacks()) {
    try {
      const response = await fetch(`${base}${path}`, options);
      apiBase = base;
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Failed to fetch ${path}`);
}

function bindElements() {
  [
    "pdfInput",
    "mineruInput",
    "contentListInput",
    "requiredFilesInput",
    "pickPdfButton",
    "pickMineruButton",
    "pickContentListButton",
    "pickRequiredFilesButton",
    "previewAcceptedBookButton",
    "downloadAcceptedCorrectedButton",
    "pageList",
    "statusBadge",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function initialize() {
  bindElements();
  restoreColumnWidths();
  restoreMiddleColumnCollapsed();
  applyMiddleColumnCollapsedState();
  bindNativeFilePickerLabel(els.pickPdfButton, els.pdfInput, "等待选择 PDF");
  bindNativeFilePickerLabel(els.pickMineruButton, els.mineruInput, "等待选择 middle.json");
  bindNativeFilePickerLabel(els.pickContentListButton, els.contentListInput, "等待选择 content_list");
  bindNativeFilePickerLabel(els.pickRequiredFilesButton, els.requiredFilesInput, "等待选择所需文件");
  els.previewAcceptedBookButton?.addEventListener("click", toggleAcceptedBookPreview);
  els.downloadAcceptedCorrectedButton?.addEventListener("click", downloadAcceptedCorrectedFromTop);
  bindFileInputEvents(els.pdfInput, handlePdfChange, "pdfInput");
  bindFileInputEvents(els.mineruInput, handleMineruChange, "mineruInput");
  bindFileInputEvents(els.contentListInput, handleContentListChange, "contentListInput");
  bindFileInputEvents(els.requiredFilesInput, handleRequiredFilesChange, "requiredFilesInput");
  document.addEventListener("pointerdown", handleColumnResizeStart);
  window.addEventListener("resize", schedulePdfFocusSync);
  window.addEventListener("mathjax-ready", () => typesetMath(els.pageList));
  updateAcceptedPatchTopControls();
  ensureMathJaxLoaded().catch((error) => reportMathJaxError(error));
  refreshRuntimeCapabilities();
}

async function refreshRuntimeCapabilities() {
  try {
    const response = await fetchApi("/api/health");
    const data = await response.json();
    state.mathpixConfigured = Boolean(data.mathpixConfigured);
    state.mathpixConfigError = String(data.mathpixConfigError || "");
    if (state.mineruInfo) {
      await renderCurrentPage();
    }
  } catch {
    state.mathpixConfigured = null;
    state.mathpixConfigError = "";
  }
}

function bindNativeFilePickerLabel(label, input, waitingLabel = "") {
  if (!label || !input) {
    return false;
  }
  const prepare = () => prepareFilePickerInput(input, waitingLabel);
  label.addEventListener("pointerdown", prepare);
  label.addEventListener("click", prepare);
  label.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    prepare();
    input.click();
  });
  return true;
}

function prepareFilePickerInput(input, waitingLabel = "") {
  if (!input) {
    return false;
  }
  if (waitingLabel) {
    setStatus(waitingLabel, "busy", "请选择文件");
  }
  const key = input.dataset?.fileInputKey || "";
  if (key) {
    handledFileInputSignatures.delete(key);
  }
  input.value = "";
  return true;
}

function bindFileInputEvents(input, handler, key) {
  if (!input || typeof handler !== "function") {
    return;
  }
  input.dataset.fileInputKey = key;
  const run = () => {
    if (shouldSkipDuplicateFileInputEvent(input, key)) {
      return;
    }
    handler();
  };
  input.addEventListener("change", run);
  input.addEventListener("input", run);
}

function shouldSkipDuplicateFileInputEvent(input, key) {
  const signature = Array.from(input?.files || [])
    .map((file) => [file.name, file.size, file.lastModified].join(":"))
    .join("|");
  if (!signature) {
    return false;
  }
  const previous = handledFileInputSignatures.get(key);
  if (previous === signature) {
    return true;
  }
  handledFileInputSignatures.set(key, signature);
  return false;
}

async function handlePdfChange() {
  const file = els.pdfInput.files?.[0] || null;
  if (!file) {
    return;
  }
  try {
    await loadPdfFile(file);
  } catch (error) {
    setStatus("Error", "error", error.message);
    els.pageList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

async function handleMineruChange() {
  const file = els.mineruInput.files?.[0] || null;
  if (!file) {
    return;
  }
  try {
    await loadMineruFile(file);
  } catch (error) {
    setStatus("Error", "error", error.message);
    state.mineruInfo = null;
    state.mineruOverrides.clear();
    state.mineruBlockOverrides.clear();
    state.mathpixBlockDrafts.clear();
    state.liveReviewDrafts.clear();
    state.ocrPatches = [];
    state.acceptedPatchPreview = null;
    state.acceptedPatchBookPreview = null;
    state.riskByPage.clear();
    cancelScheduledRiskAnalysis();
    state.reviewExpanded.clear();
    state.reviewInitializedPages.clear();
    renderCurrentPage();
  }
}

async function handleContentListChange() {
  const file = els.contentListInput.files?.[0] || null;
  if (!file) {
    return;
  }
  try {
    await loadContentListFile(file);
  } catch (error) {
    setStatus("Error", "error", error.message);
    state.contentListItems = [];
    state.contentListFileName = "";
    state.riskByPage.clear();
    cancelScheduledRiskAnalysis();
    analyzeCurrentMineruRiskPage();
    updatePager();
    updateCorrectionSummary();
    await renderCurrentPage();
    scheduleMineruRiskAnalysis();
  }
}

async function handleRequiredFilesChange() {
  const files = Array.from(els.requiredFilesInput?.files || []);
  if (!files.length) {
    return;
  }
  try {
    setStatus("已选择文件", "busy", files.map((file) => file.name).join(" / "));
    await waitForNextPaint();
    const picked = identifyRequiredUploadFiles(files);
    const missing = [];
    if (!picked.pdf) {
      missing.push("origin.pdf");
    }
    if (!picked.mineru) {
      missing.push("middle.json");
    }
    if (!picked.contentList) {
      missing.push("content_list");
    }
    if (missing.length) {
      throw new Error(`缺少文件：${missing.join("、")}`);
    }
    setStatus("一键上传", "busy", "正在读取 PDF / middle.json / content_list");
    await waitForNextPaint();
    await loadPdfFile(picked.pdf);
    await loadMineruFile(picked.mineru);
    await loadContentListFile(picked.contentList);
    setStatus("Ready", "ok", "所需文件已全部上传");
  } catch (error) {
    setStatus("一键上传失败", "error", error?.message || String(error || ""));
  } finally {
    if (els.requiredFilesInput) {
      els.requiredFilesInput.value = "";
    }
  }
}

function identifyRequiredUploadFiles(files) {
  const picked = { pdf: null, mineru: null, contentList: null };
  (Array.isArray(files) ? files : []).forEach((file) => {
    const name = String(file?.name || "").toLowerCase();
    if (!picked.pdf && (name.endsWith(".pdf") || file?.type === "application/pdf")) {
      picked.pdf = file;
      return;
    }
    if (!name.endsWith(".json")) {
      return;
    }
    if (!picked.contentList && /(?:^|[_\-\s])content[_\-\s]?list(?:[_\-\s.]|$)/.test(name)) {
      picked.contentList = file;
      return;
    }
    if (!picked.mineru && /(?:^|[_\-\s])middle(?:[_\-\s.]|$)/.test(name)) {
      picked.mineru = file;
    }
  });
  return picked;
}

async function loadPdfFile(file) {
  setStatus("读取 PDF", "busy", `${file.name} (${formatBytes(file.size || 0)})`);
  await waitForNextPaint();
  const localDocument = await loadLocalPdfDocument(file).catch((error) => {
    console.warn?.("[OCR Review] 浏览器本地 PDF 渲染不可用，回退到后端上传。", error);
    return null;
  });
  const upload = localDocument ? null : await uploadPreviewDocument(file);
  state.pdfFile = file;
  state.pdfDataUrl = "";
  state.pdfDocumentId = upload?.documentId || "";
  state.pdfLocalDocument = localDocument;
  state.pageCache.clear();
  state.pdfTextPageCache.clear();
  state.mathpixCache.clear();
  state.mathpixBlockDrafts.clear();
  state.liveReviewDrafts.clear();
  state.mineruOverrides.clear();
  state.mineruBlockOverrides.clear();
  state.ocrPatches = [];
  state.acceptedPatchPreview = null;
  state.acceptedPatchBookPreview = null;
  state.riskByPage.clear();
  cancelScheduledRiskAnalysis();
  state.reviewExpanded.clear();
  state.reviewInitializedPages.clear();
  state.pdfImageZoom = DEFAULT_PDF_IMAGE_ZOOM;
  state.currentPage = 1;
  setStatus("渲染 PDF", "busy", file.name);
  const preview = await loadPagePreview(1);
  state.pdfPageCount = preview.pageCount || upload?.pageCount || preview.pages?.length || 1;
  cachePreviewPage(1, preview);
  if (state.mineruInfo) {
    analyzeCurrentMineruRiskPage();
    restoreOcrWorkspaceState();
  }
  updatePager();
  await renderCurrentPage();
  if (state.mineruInfo) {
    scheduleMineruRiskAnalysis();
  }
  setStatus("Ready", "ok");
}

async function loadMineruFile(file) {
  setStatus("读取 MinerU", "busy", file.name);
  const text = await readFileAsText(file);
  const data = JSON.parse(text);
  const pdfInfo = Array.isArray(data.pdf_info) ? data.pdf_info : [];
  if (!pdfInfo.length) {
    throw new Error("这个 JSON 没有找到 pdf_info，可能不是 MinerU middle.json。");
  }
  state.mineruInfo = data;
  state.mineruFileName = file.name;
  state.mineruOverrides.clear();
  state.mineruBlockOverrides.clear();
  state.mathpixBlockDrafts.clear();
  state.liveReviewDrafts.clear();
  state.ocrPatches = [];
  state.acceptedPatchPreview = null;
  state.acceptedPatchBookPreview = null;
  state.riskByPage.clear();
  cancelScheduledRiskAnalysis();
  state.reviewExpanded.clear();
  state.reviewInitializedPages.clear();
  analyzeCurrentMineruRiskPage();
  if (!state.pdfPageCount) {
    state.pdfPageCount = pdfInfo.length;
  }
  restoreOcrWorkspaceState();
  updatePager();
  await renderCurrentPage();
  scheduleMineruRiskAnalysis();
  setStatus("Ready", "ok");
}

async function loadContentListFile(file) {
  setStatus("读取 content_list", "busy", file.name);
  const text = await readFileAsText(file);
  const data = JSON.parse(text);
  const items = normalizeContentListItems(data);
  if (!items.length) {
    throw new Error("这个 JSON 没有找到 content_list 条目。");
  }
  state.contentListItems = items;
  state.contentListFileName = file.name;
  state.riskByPage.clear();
  cancelScheduledRiskAnalysis();
  state.reviewExpanded.clear();
  state.reviewInitializedPages.clear();
  analyzeCurrentMineruRiskPage();
  updatePager();
  updateCorrectionSummary();
  await renderCurrentPage();
  scheduleMineruRiskAnalysis();
  setStatus("Ready", "ok");
}

function resetPage() {
  clearPersistedOcrWorkspaceState();
  state.pdfFile = null;
  state.pdfDataUrl = "";
  state.pdfDocumentId = "";
  state.pdfLocalDocument = null;
  state.pdfPageCount = 0;
  state.currentPage = 1;
  state.pageCache.clear();
  state.pdfTextPageCache.clear();
  state.mineruInfo = null;
  state.mineruFileName = "";
  state.contentListItems = [];
  state.contentListFileName = "";
  state.mineruOverrides.clear();
  state.mineruBlockOverrides.clear();
  state.mathpixBlockDrafts.clear();
  state.liveReviewDrafts.clear();
  state.ocrPatches = [];
  state.acceptedPatchPreview = null;
  state.acceptedPatchBookPreview = null;
  state.riskByPage.clear();
  cancelScheduledRiskAnalysis();
  state.mathpixCache.clear();
  state.reviewExpanded.clear();
  state.reviewInitializedPages.clear();
  state.pdfImageZoom = DEFAULT_PDF_IMAGE_ZOOM;
  state.busy = false;
  els.pdfInput.value = "";
  els.mineruInput.value = "";
  els.contentListInput.value = "";
  if (els.requiredFilesInput) {
    els.requiredFilesInput.value = "";
  }
  els.pageList.innerHTML = '<div class="empty-state">选择原书 PDF，再选择对应的 MinerU `_middle.json`。优先点击高风险块，只对该块调用 Mathpix。</div>';
  updatePager();
  setStatus("Ready", "ok");
}

function ocrWorkspaceStorageKey() {
  if (!state.mineruFileName) {
    return "";
  }
  const pageCount = getMineruPageCount() || state.pdfPageCount || 0;
  return `${OCR_WORKSPACE_STORAGE_PREFIX}:${state.mineruFileName}:${pageCount}`;
}

function getOcrWorkspaceStorage() {
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage) {
      return globalThis.localStorage;
    }
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function saveOcrWorkspaceState() {
  const storage = getOcrWorkspaceStorage();
  const key = ocrWorkspaceStorageKey();
  if (!storage || !key) {
    return false;
  }
  const payload = buildOcrWorkspacePayload();
  try {
    storage.setItem(key, JSON.stringify(payload));
    return true;
  } catch (error) {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn("[OCR Workspace] 无法保存 Mathpix 校正中间稿。", error);
    }
    return false;
  }
}

function restoreOcrWorkspaceState() {
  const storage = getOcrWorkspaceStorage();
  const key = ocrWorkspaceStorageKey();
  if (!storage || !key) {
    return false;
  }
  const raw = storage.getItem(key);
  if (!raw) {
    return false;
  }
  try {
    const payload = JSON.parse(raw);
    if (!payload || payload.version !== 1) {
      return false;
    }
    return applyOcrWorkspacePayload(payload);
  } catch (error) {
    storage.removeItem(key);
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn("[OCR Workspace] 已忽略损坏的 Mathpix 校正中间稿缓存。", error);
    }
    return false;
  }
}

function buildOcrWorkspacePayload() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    mineruFileName: state.mineruFileName,
    pageCount: getMineruPageCount() || 0,
    mineruOverrides: serializePageMap(state.mineruOverrides),
    mineruBlockOverrides: serializeNestedMap(state.mineruBlockOverrides),
    mathpixBlockDrafts: serializeNestedMap(state.mathpixBlockDrafts),
    mathpixCache: serializePageMap(state.mathpixCache),
    ocrPatches: Array.isArray(state.ocrPatches) ? state.ocrPatches : [],
    reviewNeedsCorrection: Array.from(state.reviewNeedsCorrection || []),
    reviewFontScale: state.reviewFontScale,
    reviewFitToPage: Boolean(state.reviewFitToPage),
    pdfFitToPage: Boolean(state.pdfFitToPage),
  };
}

function unwrapOcrWorkspacePayload(payload) {
  if (payload?.workspace?.version === 1) {
    return payload.workspace;
  }
  return payload?.version === 1 ? payload : null;
}

function applyOcrWorkspacePayload(payload) {
  const workspace = unwrapOcrWorkspacePayload(payload);
  if (!workspace) {
    return false;
  }
  state.mineruOverrides = restorePageMap(workspace.mineruOverrides);
  state.mineruBlockOverrides = restoreNestedMap(workspace.mineruBlockOverrides);
  state.mathpixBlockDrafts = restoreNestedMap(workspace.mathpixBlockDrafts);
  state.mathpixCache = restorePageMap(workspace.mathpixCache);
  state.ocrPatches = Array.isArray(workspace.ocrPatches) ? workspace.ocrPatches : [];
  state.reviewNeedsCorrection = new Set(Array.isArray(workspace.reviewNeedsCorrection) ? workspace.reviewNeedsCorrection.map(String) : []);
  state.reviewFontScale = clampReviewFontScale(workspace.reviewFontScale);
  state.reviewFitToPage = Boolean(workspace.reviewFitToPage);
  state.pdfFitToPage = Boolean(workspace.pdfFitToPage);
  state.acceptedPatchPreview = null;
  state.acceptedPatchBookPreview = null;
  return true;
}

function exportOcrWorkspaceSnapshot() {
  if (!state.mineruInfo || !state.mineruFileName) {
    setStatus("先上传 middle.json", "error");
    return;
  }
  saveOcrWorkspaceState();
  const payload = {
    kind: "ocr-review-workbench-workspace",
    version: 1,
    exportedAt: new Date().toISOString(),
    sourceUrl: typeof window !== "undefined" ? window.location.href : "",
    workspace: buildOcrWorkspacePayload(),
  };
  const filename = `${safeDownloadBaseName()}-ocr-workspace.json`;
  downloadJsonFile(filename, payload);
  setStatus("工作区已导出", "ok", filename);
}

async function handleWorkspaceImportChange() {
  const file = els.workspaceInput?.files?.[0] || null;
  if (!file) {
    return;
  }
  if (!state.mineruInfo || !state.mineruFileName) {
    setStatus("请先上传同一本 MinerU JSON，再导入工作区", "error");
    els.workspaceInput.value = "";
    return;
  }
  setStatus("导入工作区", "busy", file.name);
  try {
    const text = await readFileAsText(file);
    const payload = JSON.parse(text);
    const workspace = unwrapOcrWorkspacePayload(payload);
    if (!workspace) {
      throw new Error("不是有效的 OCR 工作区 JSON。");
    }
    const importedName = String(workspace.mineruFileName || "");
    if (importedName && importedName !== state.mineruFileName) {
      const accepted = typeof window === "undefined" || window.confirm(`工作区来自 ${importedName}，当前 MinerU 是 ${state.mineruFileName}。仍要导入吗？`);
      if (!accepted) {
        setStatus("已取消导入", "ok");
        return;
      }
    }
    if (!applyOcrWorkspacePayload(workspace)) {
      throw new Error("工作区状态恢复失败。");
    }
    saveOcrWorkspaceState();
    updateCorrectionSummary();
    updateAcceptedPatchTopControls();
    await renderCurrentPage();
    setStatus("工作区已导入", "ok", file.name);
  } catch (error) {
    setStatus("导入失败", "error", error.message);
  } finally {
    if (els.workspaceInput) {
      els.workspaceInput.value = "";
    }
  }
}

function clearPersistedOcrWorkspaceState() {
  const storage = getOcrWorkspaceStorage();
  const key = ocrWorkspaceStorageKey();
  if (!storage || !key) {
    return false;
  }
  storage.removeItem(key);
  return true;
}

function serializePageMap(map) {
  if (!(map instanceof Map)) {
    return [];
  }
  return Array.from(map.entries()).map(([pageNumber, value]) => [Number(pageNumber), value]);
}

function restorePageMap(entries) {
  const map = new Map();
  if (!Array.isArray(entries)) {
    return map;
  }
  entries.forEach((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) {
      return;
    }
    const pageNumber = Number(entry[0]);
    if (!Number.isFinite(pageNumber)) {
      return;
    }
    map.set(pageNumber, entry[1]);
  });
  return map;
}

function serializeNestedMap(map) {
  if (!(map instanceof Map)) {
    return [];
  }
  return Array.from(map.entries()).map(([pageNumber, blockMap]) => [
    Number(pageNumber),
    blockMap instanceof Map ? Array.from(blockMap.entries()) : [],
  ]);
}

function mathpixBlockErrorKey(pageNumber, blockIndex) {
  return `${Number(pageNumber) || 0}:${String(blockIndex || "")}`;
}

function setMathpixBlockError(pageNumber, blockIndex, message) {
  const key = mathpixBlockErrorKey(pageNumber, blockIndex);
  if (!key.endsWith(":")) {
    state.mathpixBlockErrors.set(key, String(message || ""));
  }
}

function clearMathpixBlockError(pageNumber, blockIndex) {
  state.mathpixBlockErrors.delete(mathpixBlockErrorKey(pageNumber, blockIndex));
}

function getMathpixBlockError(pageNumber, blockIndex) {
  return state.mathpixBlockErrors.get(mathpixBlockErrorKey(pageNumber, blockIndex)) || "";
}

function restoreNestedMap(entries) {
  const map = new Map();
  if (!Array.isArray(entries)) {
    return map;
  }
  entries.forEach((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) {
      return;
    }
    const pageNumber = Number(entry[0]);
    if (!Number.isFinite(pageNumber)) {
      return;
    }
    const blockEntries = Array.isArray(entry[1]) ? entry[1] : [];
    map.set(pageNumber, new Map(blockEntries.map(([blockIndex, text]) => [String(blockIndex), String(text || "")])));
  });
  return map;
}

async function goToPage(pageNumber) {
  const total = getReviewPageCount();
  const nextPage = Math.max(1, Math.min(pageNumber, total));
  if (nextPage === state.currentPage && state.pageCache.has(nextPage)) {
    return;
  }
  state.currentPage = nextPage;
  state.acceptedPatchPreview = null;
  state.reviewExpanded.clear();
  state.reviewActionsOpen.clear();
  state.reviewCorrectionOpen.clear();
  updatePager();
  await renderCurrentPage();
}

async function goToPagerTarget(target) {
  const total = getReviewPageCount();
  const targets = {
    first: 1,
    prev: state.currentPage - 1,
    next: state.currentPage + 1,
    last: total,
  };
  await goToPage(targets[target] || state.currentPage);
}

function getReviewPageCount() {
  return state.pdfPageCount || getMineruPageCount() || 1;
}

async function goToNextRiskPage() {
  const riskPages = Array.from(state.riskByPage.keys()).sort((a, b) => a - b);
  if (!riskPages.length) {
    return;
  }
  const next = riskPages.find((pageNumber) => pageNumber > state.currentPage) || riskPages[0];
  await goToPage(next);
}

async function renderCurrentPage() {
  if (!hasPdfSource() && !state.mineruInfo) {
    return;
  }
  const runId = ++renderCurrentPageRunId;
  applyMiddleColumnCollapsedState();
  els.pageList.innerHTML = "";
  const row = document.createElement("article");
  row.className = "page-row";
  const page = await ensureCurrentPagePreview();
  if (runId !== renderCurrentPageRunId) {
    return;
  }
  analyzeCurrentMineruRiskPage();
  if (state.middleColumnCollapsed) {
    row.append(renderImageCard(page), renderMiddleColumnRestoreRail(), renderRightWorkbench(page));
  } else {
    row.append(
      renderImageCard(page),
      createColumnResizer("left"),
      renderMineruCard(),
      createColumnResizer("right"),
      renderRightWorkbench(page),
    );
  }
  els.pageList.append(row);
  typesetMath(row);
  syncPdfFocusToExpandedReviewBlock();
  scheduleSourcePageThumbnailSync(row);
  scheduleReviewFitScale(row);
  updateAcceptedPatchTopControls();
  scheduleAdjacentPagePreviewPrefetch();
}

function createColumnResizer(side) {
  const button = document.createElement("button");
  button.className = "column-resizer";
  button.type = "button";
  button.dataset.resizer = side;
  const labels = {
    left: "调整原文和 MinerU 栏宽",
    right: "调整 MinerU 和校对栏宽",
  };
  button.setAttribute("aria-label", labels[side] || "调整栏宽");
  return button;
}

function renderMiddleColumnRestoreRail() {
  const button = document.createElement("button");
  button.className = "middle-column-restore";
  button.type = "button";
  button.dataset.middleColumnToggle = "expand";
  button.setAttribute("aria-label", "展开 MinerU 原始识别栏");
  button.innerHTML = "<span>MinerU</span><strong>展开</strong>";
  button.addEventListener("click", () => setMiddleColumnCollapsed(false));
  return button;
}

async function setMiddleColumnCollapsed(collapsed) {
  state.middleColumnCollapsed = Boolean(collapsed);
  persistMiddleColumnCollapsed();
  applyMiddleColumnCollapsedState();
  await renderCurrentPage();
}

function restoreMiddleColumnCollapsed() {
  try {
    state.middleColumnCollapsed = localStorage.getItem(MIDDLE_COLUMN_COLLAPSED_KEY) === "1";
  } catch {
    state.middleColumnCollapsed = false;
  }
}

function persistMiddleColumnCollapsed() {
  try {
    localStorage.setItem(MIDDLE_COLUMN_COLLAPSED_KEY, state.middleColumnCollapsed ? "1" : "0");
  } catch {
    // Layout preference is non-critical.
  }
}

function applyMiddleColumnCollapsedState() {
  const panel = document.querySelector(".preview-panel");
  panel?.classList.toggle("is-middle-collapsed", Boolean(state.middleColumnCollapsed));
}

function restoreColumnWidths() {
  const panel = document.querySelector(".preview-panel");
  if (!panel) {
    return;
  }
  LEGACY_COLUMN_WIDTHS_KEYS.forEach((key) => localStorage.removeItem(key));
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMN_WIDTHS_KEY) || "null");
    if (!saved) {
      return;
    }
    setColumnRatios(normalizeColumnRatios(saved));
  } catch {
    localStorage.removeItem(COLUMN_WIDTHS_KEY);
  }
}

function handleColumnResizeStart(event) {
  const handle = event.target.closest?.(".column-resizer[data-resizer]");
  if (!handle || window.matchMedia("(max-width: 980px)").matches) {
    return;
  }
  event.preventDefault();
  const side = handle.dataset.resizer;
  const panel = document.querySelector(".preview-panel");
  const columns = readCurrentColumnWidths();
  if (!panel || !columns) {
    return;
  }

  const startX = event.clientX;
  const start = { ...columns };
  const min = { left: 180, middle: 260, right: 320 };
  document.body.classList.add("is-resizing-columns");

  const onMove = (moveEvent) => {
    const dx = moveEvent.clientX - startX;
    if (side === "left") {
      const nextLeft = clamp(start.left + dx, min.left, start.left + start.middle - min.middle);
      const nextMiddle = start.middle - (nextLeft - start.left);
      setColumnWidths({ left: nextLeft, middle: nextMiddle, right: start.right });
      return;
    }
    const nextMiddle = clamp(start.middle + dx, min.middle, start.middle + start.right - min.right);
    const nextRight = start.right - (nextMiddle - start.middle);
    setColumnWidths({ left: start.left, middle: nextMiddle, right: nextRight });
  };

  const onUp = () => {
    document.body.classList.remove("is-resizing-columns");
    const latest = readCurrentColumnWidths();
    if (latest) {
      localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(widthsToRatios(latest)));
    }
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp, { once: true });
}

function readCurrentColumnWidths() {
  const row = document.querySelector(".page-row") || document.querySelector(".column-heads");
  if (!row) {
    return null;
  }
  const columns = getComputedStyle(row)
    .gridTemplateColumns.split(/\s+/)
    .map((item) => Number.parseFloat(item))
    .filter(Number.isFinite);
  if (columns.length < 5) {
    return null;
  }
  return {
    left: columns[0],
    middle: columns[2],
    right: columns[4],
  };
}

function setColumnWidths(widths) {
  setColumnRatios(widthsToRatios(widths));
}

function setColumnRatios(ratios) {
  const targets = document.querySelectorAll(".preview-panel, .control-band");
  if (!targets.length) {
    return;
  }
  targets.forEach((target) => {
    target.style.setProperty("--ocr-left-ratio", String(ratios.left));
    target.style.setProperty("--ocr-middle-ratio", String(ratios.middle));
    target.style.setProperty("--ocr-right-ratio", String(ratios.right));
  });
  schedulePdfFocusSync();
}

function widthsToRatios(widths) {
  const total = Math.max(1, widths.left + widths.middle + widths.right);
  return normalizeColumnRatios({
    left: widths.left / total,
    middle: widths.middle / total,
    right: widths.right / total,
  });
}

function normalizeColumnRatios(ratios) {
  const left = clamp(Number(ratios?.left) || 0.28, 0.12, 0.58);
  const middle = clamp(Number(ratios?.middle) || 0.42, 0.18, 0.65);
  const right = clamp(Number(ratios?.right) || 0.3, 0.18, 0.6);
  const total = Math.max(0.01, left + middle + right);
  return {
    left: roundFraction(left / total),
    middle: roundFraction(middle / total),
    right: roundFraction(right / total),
  };
}

function roundFraction(value) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

async function ensureCurrentPagePreview() {
  if (state.pageCache.has(state.currentPage)) {
    const cachedPage = state.pageCache.get(state.currentPage);
    cachePdfTextPage(cachedPage);
    return cachedPage;
  }
  if (!hasPdfSource()) {
    return {
      pageNumber: state.currentPage,
      width: "-",
      height: "-",
      image: "",
      mimeType: "image/png",
    };
  }
  setStatus("Page", "busy");
  const preview = await loadPagePreview(state.currentPage);
  const page = preview.pages?.[0];
  if (!page) {
    throw new Error(`没有渲染出第 ${state.currentPage} 页。`);
  }
  state.pdfPageCount = preview.pageCount || state.pdfPageCount || 1;
  state.pageCache.set(state.currentPage, page);
  cachePdfTextPage(page);
  updatePager();
  setStatus("Ready", "ok");
  return page;
}

async function loadPagePreview(pageNumber) {
  const requestedPage = Number(pageNumber) || 1;
  if (pendingPagePreviewRequests.has(requestedPage)) {
    return pendingPagePreviewRequests.get(requestedPage);
  }
  const request = (state.pdfLocalDocument
    ? renderLocalPdfPreviewPage(requestedPage, {
        zoom: 1.8,
        includeText: true,
        renderImages: true,
      })
    : postJson(
        "/api/ocr/preview-pages",
        pdfPreviewPayload({
          pageNumber: requestedPage,
          maxPages: 1,
          zoom: 1.8,
          includeText: true,
        }),
      )
  ).finally(() => {
    pendingPagePreviewRequests.delete(requestedPage);
  });
  pendingPagePreviewRequests.set(requestedPage, request);
  const response = await request;
  if (!response.ok) {
    throw new Error(response.error || "PDF 页面渲染失败");
  }
  rememberPdfDocumentId(response);
  return response;
}

async function loadLocalPdfDocument(file) {
  if (!file || String(file.type || "").startsWith("image/")) {
    return null;
  }
  const pdfjs = await ensurePdfJsLoaded();
  const data = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data });
  return loadingTask.promise;
}

async function renderLocalPdfPreviewPage(pageNumber, options = {}) {
  const document = state.pdfLocalDocument;
  if (!document) {
    return { ok: false, error: "Missing local PDF document" };
  }
  const total = Number(document.numPages) || 1;
  const requestedPage = Math.max(1, Math.min(Number(pageNumber) || 1, total));
  const page = await renderLocalPdfPage(requestedPage, options);
  return {
    ok: true,
    documentId: "",
    name: state.pdfFile?.name || "book.pdf",
    mimeType: state.pdfFile?.type || "application/pdf",
    pages: [page],
    pageCount: total,
    renderedCount: 1,
  };
}

async function renderLocalPdfPage(pageNumber, options = {}) {
  const pdfPage = await state.pdfLocalDocument.getPage(pageNumber);
  const baseViewport = pdfPage.getViewport({ scale: 1 });
  const renderImages = options.renderImages !== false;
  const includeText = Boolean(options.includeText);
  const zoom = Math.max(1, Math.min(Number(options.zoom) || 1.8, 3));
  const page = {
    pageNumber,
    name: `page-${pageNumber}.png`,
    mimeType: "image/png",
    width: Number(baseViewport.width) || 0,
    height: Number(baseViewport.height) || 0,
  };
  if (renderImages) {
    const viewport = pdfPage.getViewport({ scale: zoom });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("浏览器无法创建 PDF 渲染画布。");
    }
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    await pdfPage.render({ canvasContext: context, viewport }).promise;
    page.width = canvas.width;
    page.height = canvas.height;
    page.image = canvas.toDataURL("image/png");
  }
  if (includeText) {
    page.textBlocks = await localPdfTextBlocks(pdfPage, baseViewport);
    page.textPageSize = [Number(baseViewport.width) || page.width, Number(baseViewport.height) || page.height];
  }
  return page;
}

async function localPdfTextBlocks(pdfPage, viewport) {
  const height = Number(viewport?.height) || 0;
  const textContent = await pdfPage.getTextContent().catch(() => ({ items: [] }));
  return (Array.isArray(textContent?.items) ? textContent.items : [])
    .map((item) => {
      const text = String(item?.str || "").trim();
      const transform = Array.isArray(item?.transform) ? item.transform : [];
      const x = Number(transform[4]) || 0;
      const y = Number(transform[5]) || 0;
      const width = Math.max(Number(item?.width) || 0, text.length * 3);
      const itemHeight = Math.max(Number(item?.height) || Math.abs(Number(transform[3]) || 0) || 8, 1);
      if (!text) {
        return null;
      }
      return {
        text,
        bbox: [
          x,
          Math.max(0, height - y - itemHeight),
          x + width,
          Math.max(0, height - y),
        ],
      };
    })
    .filter(Boolean);
}

function scheduleAdjacentPagePreviewPrefetch() {
  if (!hasPdfSource()) {
    return;
  }
  if (pagePrefetchTimer) {
    clearTimeout(pagePrefetchTimer);
  }
  pagePrefetchTimer = setTimeout(() => {
    pagePrefetchTimer = null;
    prefetchAdjacentPagePreviews();
  }, 120);
}

function prefetchAdjacentPagePreviews() {
  const total = state.pdfPageCount || getMineruPageCount() || 1;
  const pages = [state.currentPage + 1, state.currentPage - 1].filter((pageNumber) => pageNumber >= 1 && pageNumber <= total);
  pages.forEach((pageNumber) => {
    if (state.pageCache.has(pageNumber) || pendingPagePreviewRequests.has(pageNumber)) {
      return;
    }
    loadPagePreview(pageNumber)
      .then((preview) => cachePreviewPage(pageNumber, preview))
      .catch(() => {});
  });
}

function cachePreviewPage(pageNumber, preview) {
  const page = preview?.pages?.[0];
  if (!page) {
    return false;
  }
  state.pageCache.set(Number(pageNumber) || 1, page);
  cachePdfTextPage(page);
  return true;
}

function cachePdfTextPage(page) {
  const pageNumber = Number(page?.pageNumber) || 0;
  if (!pageNumber || !Array.isArray(page?.textBlocks)) {
    return false;
  }
  state.pdfTextPageCache.set(pageNumber, {
    pageSize: Array.isArray(page.textPageSize) ? page.textPageSize : [page.width, page.height],
    textBlocks: page.textBlocks,
  });
  return true;
}

function pdfTextBlocksForPage(pageNumber) {
  return state.pdfTextPageCache.get(Number(pageNumber) || 0)?.textBlocks || [];
}

function pdfTextPageSizeForPage(pageNumber) {
  return state.pdfTextPageCache.get(Number(pageNumber) || 0)?.pageSize || null;
}

async function ensurePdfTextLayersForBook() {
  if (!hasPdfSource() || !state.pdfFile) {
    return false;
  }
  const total = getMineruPageCount() || state.pdfPageCount || 0;
  if (!total) {
    return false;
  }
  let missing = false;
  for (let pageNo = 1; pageNo <= total; pageNo += 1) {
    if (!state.pdfTextPageCache.has(pageNo)) {
      missing = true;
      break;
    }
  }
  if (!missing) {
    return true;
  }
  if (state.pdfLocalDocument) {
    for (let pageNo = 1; pageNo <= total; pageNo += 1) {
      if (state.pdfTextPageCache.has(pageNo)) {
        continue;
      }
      const page = await renderLocalPdfPage(pageNo, {
        includeText: true,
        renderImages: false,
      });
      cachePdfTextPage(page);
    }
    return true;
  }
  const response = await postJson(
    "/api/ocr/preview-pages",
    pdfPreviewPayload({
      maxPages: total,
      zoom: 1,
      includeText: true,
      renderImages: false,
    }),
  );
  if (!response.ok) {
    throw new Error(response.error || "PDF 文本层读取失败");
  }
  rememberPdfDocumentId(response);
  (response.pages || []).forEach(cachePdfTextPage);
  return true;
}

function pdfPreviewPayload(extra = {}) {
  const payload = {
    name: state.pdfFile?.name || "book.pdf",
    mimeType: state.pdfFile?.type || "application/pdf",
    ...extra,
  };
  if (state.pdfDocumentId) {
    payload.documentId = state.pdfDocumentId;
  } else {
    payload.dataUrl = state.pdfDataUrl;
  }
  return payload;
}

async function uploadPreviewDocument(file) {
  const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const chunkSize = PDF_UPLOAD_CHUNK_SIZE;
  const chunkCount = Math.max(1, Math.ceil((file.size || 0) / chunkSize));
  let latest = null;
  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * chunkSize;
    const end = Math.min(file.size || 0, start + chunkSize);
    const chunk = file.slice(start, end || file.size || chunkSize);
    setStatus("上传 PDF", "busy", `${file.name} ${index + 1}/${chunkCount}`);
    await waitForNextPaint();
    const response = await fetchApi("/api/ocr/upload-document-chunk", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Upload-Id": uploadId,
        "X-Chunk-Index": String(index),
        "X-Chunk-Count": String(chunkCount),
        "X-File-Name": encodeURIComponent(file.name || "upload"),
      },
      body: chunk,
    });
    latest = await response.json();
    if (!latest.ok) {
      throw new Error(latest.error || "PDF 上传失败");
    }
  }
  if (!latest?.documentId) {
    throw new Error("PDF 上传未返回 documentId");
  }
  return latest;
}

function hasPdfSource() {
  return Boolean(state.pdfLocalDocument || state.pdfDocumentId || state.pdfDataUrl);
}

function rememberPdfDocumentId(response) {
  const documentId = String(response?.documentId || "").trim();
  if (documentId) {
    state.pdfDocumentId = documentId;
  }
}

function waitForNextPaint() {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    return Promise.resolve();
  }
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function renderImageCard(page) {
  const card = document.createElement("section");
  const zoom = currentPdfImageZoom();
  const zoomIndex = PDF_IMAGE_ZOOM_LEVELS.indexOf(zoom);
  const atMinZoom = zoomIndex <= 0;
  const atMaxZoom = zoomIndex >= PDF_IMAGE_ZOOM_LEVELS.length - 1;
  const fitToPage = Boolean(state.pdfFitToPage);
  card.className = `preview-card image-card ${zoom > 1 && !fitToPage ? "is-zoomed" : ""} ${fitToPage ? "is-fit-page" : ""}`;
  const reviewEntries = reviewEntriesForCurrentPage();
  const hotspotsHtml = page.image ? renderPdfBlockHotspots(reviewEntries) : "";
  const pageAspectRatio = `${Number(page.width) || 1} / ${Number(page.height) || 1}`;
  const imageHtml = page.image
    ? `<div class="page-image-surface" style="--pdf-page-aspect-ratio: ${pageAspectRatio};"><img src="${page.image}" alt="第 ${page.pageNumber} 页 OCR 截图">${hotspotsHtml}<div class="page-image-focus" data-page-image-focus hidden></div></div>`
    : `<div class="empty-inline">尚未选择 PDF。</div>`;
  card.innerHTML = `
    <div class="card-head image-card-head">
      <div class="source-page-card-pager">
        ${renderPageNavigator("source-page")}
      </div>
      <div class="card-actions">
        <button class="text-button image-zoom-button image-fit-button ${fitToPage ? "is-active" : ""}" type="button" data-image-fit-page ${page.image ? "" : "disabled"} aria-label="原书整页适配窗口" title="整页适配">
          <span class="fit-page-glyph" aria-hidden="true">⛶</span>
        </button>
        <button class="text-button image-zoom-button" type="button" data-image-zoom="out" ${page.image && !atMinZoom ? "" : "disabled"} aria-label="缩小原文页" title="缩小">
          <span class="image-zoom-glyph" aria-hidden="true"><span>A</span><span>⌄</span></span>
        </button>
        <button class="text-button image-zoom-button" type="button" data-image-zoom="in" ${page.image && !atMaxZoom ? "" : "disabled"} aria-label="放大原文页" title="放大">
          <span class="image-zoom-glyph" aria-hidden="true"><span>A</span><span>⌃</span></span>
        </button>
      </div>
    </div>
    <div class="source-page-viewer">
      ${renderSourcePageThumbnailRail()}
      <div class="page-image-wrap" style="--pdf-image-zoom: ${zoom};">${imageHtml}</div>
    </div>
  `;
  card.querySelectorAll("[data-page-jump]").forEach((button) => {
    button.addEventListener("click", () => goToPagerTarget(button.dataset.pageJump));
  });
  card.querySelectorAll("[data-page-input]").forEach((input) => {
    input.addEventListener("change", () => goToPage(Number(input.value || state.currentPage)));
  });
  card.querySelectorAll("[data-source-page-thumbnail]").forEach((button) => {
    button.addEventListener("click", () => goToPage(Number(button.dataset.sourcePageThumbnail || state.currentPage)));
  });
  card.querySelectorAll("[data-image-fit-page]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.pdfFitToPage = !state.pdfFitToPage;
      saveOcrWorkspaceState();
      await renderCurrentPage();
    });
  });
  card.querySelectorAll("[data-image-zoom]").forEach((button) => {
    button.addEventListener("click", async () => {
      setPdfImageZoom(button.dataset.imageZoom);
      await renderCurrentPage();
    });
  });
  card.querySelectorAll("[data-review-left-hotspot]").forEach((button) => {
    button.addEventListener("click", () => selectReviewBlock(button.dataset.reviewLeftHotspot));
  });
  return card;
}

function renderSourcePageThumbnailRail() {
  const total = getReviewPageCount();
  const pages = Array.from({ length: total }, (_unused, index) => index + 1);
  return `
    <aside class="source-page-rail" aria-label="原文页缩略图">
      <div class="source-page-rail-title">页</div>
      <div class="source-page-thumbnail-list">
        ${pages.map(renderSourcePageThumbnail).join("")}
      </div>
    </aside>
  `;
}

function renderSourcePageThumbnail(pageNumber) {
  const page = state.pageCache.get(pageNumber);
  const active = Number(pageNumber) === Number(state.currentPage);
  const image = page?.image
    ? `<img src="${escapeHtml(page.image)}" alt="第 ${escapeHtml(String(pageNumber))} 页缩略图">`
    : `<span class="source-page-thumbnail-placeholder">${escapeHtml(String(pageNumber))}</span>`;
  return `
    <button class="source-page-thumbnail ${active ? "is-active" : ""}" type="button" data-source-page-thumbnail="${escapeHtml(String(pageNumber))}" ${active ? 'aria-current="page"' : ""} aria-label="跳转到第 ${escapeHtml(String(pageNumber))} 页">
      <span class="source-page-thumbnail-paper">${image}</span>
      <span class="source-page-thumbnail-number">${escapeHtml(String(pageNumber))}</span>
    </button>
  `;
}

function scheduleSourcePageThumbnailSync(root = document) {
  if (typeof setTimeout !== "function") {
    return false;
  }
  setTimeout(() => {
    const active = root?.querySelector?.(".source-page-thumbnail.is-active");
    active?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, 0);
  return true;
}

function renderPdfBlockHotspots(reviewEntries) {
  return (Array.isArray(reviewEntries) ? reviewEntries : [])
    .map((entry) => {
      const percent = pdfFocusPercentForRisk(entry.risk);
      if (!percent) {
        return "";
      }
      const fullKey = reviewBlockKey(state.currentPage, entry.key);
      const selected = isActiveReviewBlockKey(fullKey);
      return `<button class="page-block-hotspot ${selected ? "is-selected" : ""}" type="button" data-review-left-hotspot="${escapeHtml(fullKey)}" aria-label="选择 ${escapeHtml(reviewEntryLabel(entry))}" style="left: ${percent.left}%; top: ${percent.top}%; width: ${percent.width}%; height: ${percent.height}%;"></button>`;
    })
    .join("");
}

function currentPdfImageZoom() {
  const value = Number(state.pdfImageZoom) || DEFAULT_PDF_IMAGE_ZOOM;
  return PDF_IMAGE_ZOOM_LEVELS.includes(value) ? value : DEFAULT_PDF_IMAGE_ZOOM;
}

function setPdfImageZoom(direction) {
  const current = currentPdfImageZoom();
  const index = PDF_IMAGE_ZOOM_LEVELS.indexOf(current);
  if (direction === "in") {
    state.pdfFitToPage = false;
    state.pdfImageZoom = PDF_IMAGE_ZOOM_LEVELS[Math.min(PDF_IMAGE_ZOOM_LEVELS.length - 1, index + 1)];
    return;
  }
  if (direction === "out") {
    state.pdfFitToPage = false;
    state.pdfImageZoom = PDF_IMAGE_ZOOM_LEVELS[Math.max(0, index - 1)];
    return;
  }
  state.pdfFitToPage = false;
  state.pdfImageZoom = DEFAULT_PDF_IMAGE_ZOOM;
}

function currentReviewFontScale() {
  return clampReviewFontScale(state.reviewFontScale);
}

function clampReviewFontScale(value) {
  const numeric = Number(value);
  return REVIEW_FONT_SCALE_LEVELS.includes(numeric) ? numeric : DEFAULT_REVIEW_FONT_SCALE;
}

function setReviewFontScale(direction) {
  state.reviewFitToPage = false;
  const current = currentReviewFontScale();
  const index = REVIEW_FONT_SCALE_LEVELS.indexOf(current);
  if (direction === "in") {
    state.reviewFontScale = REVIEW_FONT_SCALE_LEVELS[Math.min(REVIEW_FONT_SCALE_LEVELS.length - 1, index + 1)];
    return;
  }
  if (direction === "out") {
    state.reviewFontScale = REVIEW_FONT_SCALE_LEVELS[Math.max(0, index - 1)];
    return;
  }
  state.reviewFontScale = DEFAULT_REVIEW_FONT_SCALE;
}

function syncPdfFocusToExpandedReviewBlock() {
  if (typeof document === "undefined" || typeof document.querySelector !== "function") {
    return false;
  }
  const wrap = document.querySelector(".page-image-wrap");
  const surface = wrap?.querySelector?.(".page-image-surface");
  const image = surface?.querySelector?.("img");
  const focus = surface?.querySelector?.("[data-page-image-focus]");
  if (!wrap || !image || !focus) {
    return false;
  }
  const risk = activeExpandedRiskForPage(state.currentPage);
  const applyFocus = () => applyPdfFocusBox(wrap, image, focus, risk);
  if (!image.complete) {
    image.addEventListener("load", applyFocus, { once: true });
    return false;
  }
  return applyFocus();
}

function schedulePdfFocusSync() {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => syncPdfFocusToExpandedReviewBlock());
    return;
  }
  syncPdfFocusToExpandedReviewBlock();
}

function activeExpandedRiskForPage(pageNumber) {
  const prefix = `${pageNumber}:`;
  const expandedKey = Array.from(state.reviewExpanded || []).find((key) => String(key).startsWith(prefix));
  if (!expandedKey) {
    return null;
  }
  const blockIndex = String(expandedKey).slice(prefix.length);
  return reviewRiskForBlock(pageNumber, blockIndex);
}

function reviewRiskForBlock(pageNumber, blockIndex) {
  const key = String(blockIndex || "");
  const risk = (state.riskByPage.get(pageNumber) || []).find((item) => String(item.blockIndex) === key);
  if (risk) {
    return risk;
  }
  const segment = reviewSegmentsForPage(pageNumber).find((item) => String(item.blockIndex) === key);
  return segment ? reviewRiskFromSegment(segment, pageNumber) : null;
}

function applyPdfFocusBox(wrap, image, focus, risk) {
  const metrics = pdfFocusMetricsForRisk(risk, image.clientWidth || image.naturalWidth || image.width, image.clientHeight || image.naturalHeight || image.height);
  if (!metrics) {
    focus.hidden = true;
    return false;
  }
  focus.hidden = false;
  focus.style.left = `${metrics.left}px`;
  focus.style.top = `${metrics.top}px`;
  focus.style.width = `${metrics.width}px`;
  focus.style.height = `${metrics.height}px`;
  const targetTop = clamp(metrics.top + metrics.height / 2 - wrap.clientHeight / 2, 0, Math.max(0, wrap.scrollHeight - wrap.clientHeight));
  const targetLeft = clamp(metrics.left + metrics.width / 2 - wrap.clientWidth / 2, 0, Math.max(0, wrap.scrollWidth - wrap.clientWidth));
  if (typeof wrap.scrollTo === "function") {
    wrap.scrollTo({ top: targetTop, left: targetLeft, behavior: "smooth" });
  } else {
    wrap.scrollTop = targetTop;
    wrap.scrollLeft = targetLeft;
  }
  return true;
}

function pdfFocusPercentForRisk(risk) {
  const bbox = normalizedBBox(risk?.bbox);
  const pageWidth = pageSizeWidth(risk?.pageSize);
  const pageHeight = pageSizeHeight(risk?.pageSize);
  if (!bbox || !pageWidth || !pageHeight) {
    return null;
  }
  const left = clamp((bbox[0] / pageWidth) * 100, 0, 100);
  const top = clamp((bbox[1] / pageHeight) * 100, 0, 100);
  const right = clamp((bbox[2] / pageWidth) * 100, left, 100);
  const bottom = clamp((bbox[3] / pageHeight) * 100, top, 100);
  return {
    left: roundFraction(left),
    top: roundFraction(top),
    width: roundFraction(Math.max(0.1, right - left)),
    height: roundFraction(Math.max(0.1, bottom - top)),
  };
}

function pdfFocusMetricsForRisk(risk, imageWidth, imageHeight) {
  const bbox = normalizedBBox(risk?.bbox);
  const pageWidth = pageSizeWidth(risk?.pageSize);
  const pageHeight = pageSizeHeight(risk?.pageSize);
  const width = Number(imageWidth) || 0;
  const height = Number(imageHeight) || 0;
  if (!bbox || !pageWidth || !pageHeight || !width || !height) {
    return null;
  }
  const scaleX = width / pageWidth;
  const scaleY = height / pageHeight;
  const left = clamp(bbox[0] * scaleX, 0, width);
  const top = clamp(bbox[1] * scaleY, 0, height);
  const right = clamp(bbox[2] * scaleX, left, width);
  const bottom = clamp(bbox[3] * scaleY, top, height);
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.max(10, Math.round(right - left)),
    height: Math.max(10, Math.round(bottom - top)),
  };
}

function renderMineruCard() {
  const card = document.createElement("section");
  card.className = "preview-card mineru-card";
  const markdown = mineruMarkdownForPage(state.currentPage);
  const source = state.mineruInfo ? "当前 MinerU 识别结果" : "未选择 middle.json";
  const hasOverride = state.mineruOverrides.has(state.currentPage) || getBlockOverrides(state.currentPage, false).size > 0;
  const risks = state.riskByPage.get(state.currentPage) || [];
  const previewHtml = renderMineruPagePreview(state.currentPage, risks);
  card.innerHTML = `
    <div class="card-head">
      <div>
        <strong>MinerU</strong>
        <span>${hasOverride ? "已应用 Mathpix 校正稿" : escapeHtml(source)}</span>
      </div>
      <div class="card-actions">
        <button class="text-button" type="button" data-middle-column-toggle="collapse">折叠中栏</button>
        <button class="text-button" type="button" data-copy-mineru ${markdown ? "" : "disabled"}>复制</button>
        <button class="text-button" type="button" data-reset-mineru ${hasOverride ? "" : "hidden"}>还原</button>
      </div>
    </div>
    <div class="render-body markdown-body typora-preview ${previewHtml ? "" : "is-loading"}">
      ${previewHtml || "选择 MinerU `_middle.json` 后显示当前页结果。"}
    </div>
  `;
  card.querySelector("[data-copy-mineru]").addEventListener("click", async () => {
    await copyButtonText(card.querySelector("[data-copy-mineru]"), markdown);
  });
  card.querySelector('[data-middle-column-toggle="collapse"]').addEventListener("click", () => setMiddleColumnCollapsed(true));
  card.querySelector("[data-reset-mineru]")?.addEventListener("click", async () => {
    state.mineruOverrides.delete(state.currentPage);
    state.mineruBlockOverrides.delete(state.currentPage);
    saveOcrWorkspaceState();
    updateCorrectionSummary();
    await renderCurrentPage();
  });
  return card;
}

function renderMineruPagePreview(pageNumber, risks) {
  if (state.mineruOverrides.has(pageNumber)) {
    return renderMarkdownHtml(normalizeMathMarkdown(state.mineruOverrides.get(pageNumber)));
  }
  const segments = pageSegmentsForPage(pageNumber);
  if (!segments.length) {
    return "";
  }
  const riskByBlock = new Map(risks.map((item) => [String(item.blockIndex), item]));
  const blockOverrides = getBlockOverrides(pageNumber, false);
  return `
    <div class="mineru-page-preview">
      ${segments
        .map((segment) => {
          const key = String(segment.blockIndex);
          const risk = riskByBlock.get(key);
          const markdown = blockOverrides.get(key) || segment.markdown;
          return renderMineruBlock(segment, markdown, risk, blockOverrides.has(key), { showControls: false, showSource: false });
        })
        .join("")}
    </div>
  `;
}

function renderMineruBlock(entry, markdown, risk, corrected, options = {}) {
  const showControls = options.showControls !== false;
  const showSource = options.showSource !== false;
  const isRisk = Boolean(risk);
  const labels = risk ? risk.reasons.map(riskReasonLabel).join(" · ") : "";
  const disabled = risk?.bbox ? "" : "disabled";
  const actionLabel = corrected ? "Mathpix 重校正" : risk?.bbox ? "Mathpix 校正" : "缺少 bbox";
  return `
    <section class="mineru-block ${isRisk ? "is-risk" : ""} ${corrected ? "is-corrected" : ""}" data-block-index="${entry.blockIndex}">
      ${
        isRisk
          ? `<div class="block-risk-head">
              <span>${corrected ? "已校正" : "高风险"} · ${escapeHtml(labels)}</span>
              ${showControls ? `<button class="text-button risk-action" type="button" data-risk-mathpix="${entry.blockIndex}" ${disabled}>${actionLabel}</button>` : ""}
            </div>`
          : ""
      }
      <div class="mineru-block-content">
        ${renderBlockContent(markdown, entry)}
      </div>
      ${
        isRisk && showSource
          ? `<details class="block-source-detail">
              <summary>查看当前块 Markdown 源码</summary>
              <pre><code>${escapeHtml(markdown)}</code></pre>
            </details>`
          : ""
      }
    </section>
  `;
}

function renderRightWorkbench(page) {
  const card = document.createElement("section");
  card.className = "preview-card right-workbench-card";
  card.innerHTML = `
    <div class="right-workbench-panel is-active" data-workbench-panel="review"></div>
  `;
  card.querySelector('[data-workbench-panel="review"]').append(renderReviewCard());
  return card;
}

function renderReviewCard() {
  const card = document.createElement("section");
  card.className = `review-card ${state.reviewFitToPage ? "is-fit-page" : ""}`;
  applyAutomaticLocalCorrectionsForPage(state.currentPage);
  const risks = state.riskByPage.get(state.currentPage) || [];
  const segments = reviewSegmentsForPage(state.currentPage);
  const reviewEntries = buildReviewEntriesForPage(risks, segments, state.currentPage);
  ensureDefaultReviewExpansion(reviewEntries.map((entry) => entry.risk));
  const showAcceptedPatchTools = hasAcceptedOcrPatches();
  card.innerHTML = `
    <div class="review-sticky-controls">
      ${renderReviewNavigationBar(reviewEntries)}
    </div>
    ${renderPageReviewCanvas(reviewEntries)}
    ${showAcceptedPatchTools ? renderAcceptedPatchBookPreviewPanel() : ""}
  `;
  card.querySelectorAll("[data-review-page-block]").forEach((block) => {
    block.addEventListener("click", (event) => {
      if (event.target?.closest?.("button, textarea, input, select, summary, details, a")) {
        return;
      }
      if (event.detail > 1) {
        return;
      }
      const key = block.dataset.reviewPageBlock;
      if (isActiveReviewBlockKey(key)) {
        toggleReviewBlockActions(key);
        return;
      }
      selectReviewBlock(key);
    });
    block.addEventListener("dblclick", (event) => {
      if (event.target?.closest?.("button, textarea, input, select, summary, details, a")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openReviewCorrectionPanel(block.dataset.reviewPageBlock);
    });
    block.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      const key = block.dataset.reviewPageBlock;
      if (isActiveReviewBlockKey(key)) {
        toggleReviewBlockActions(key);
        return;
      }
      selectReviewBlock(key);
    });
  });
  card.querySelectorAll("[data-risk-mathpix]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await runRiskBlockMathpixFromButton(button);
    });
  });
  card.querySelectorAll("[data-review-toggle]").forEach((button) => {
    button.addEventListener("click", () => toggleReviewBlock(button.dataset.reviewToggle));
  });
  card.querySelectorAll("[data-review-correction-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleReviewCorrectionPanel(button.dataset.reviewCorrectionToggle);
    });
  });
  card.querySelectorAll("[data-review-needs-correction-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleReviewNeedsCorrection(button.dataset.reviewNeedsCorrectionToggle);
    });
  });
  card.querySelectorAll("[data-apply-mathpix-block-edit]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      applyMathpixBlockEdit(button.dataset.applyMathpixBlockEdit, button);
    });
  });
  card.querySelectorAll("[data-apply-mineru-source-edit]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      applyMineruSourceEdit(button.dataset.applyMineruSourceEdit, button);
    });
  });
  card.querySelectorAll("[data-toolbar-apply-mathpix-block-edit]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      applyMathpixBlockEdit(button.dataset.toolbarApplyMathpixBlockEdit, button);
    });
  });
  card.querySelectorAll("[data-toolbar-apply-mineru-source-edit]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      applyMineruSourceEdit(button.dataset.toolbarApplyMineruSourceEdit, button);
    });
  });
  card.querySelectorAll("[data-auto-unwrap-linebreaks]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      autoUnwrapMineruLineBreaksForBlock(button.dataset.autoUnwrapLinebreaks);
    });
  });
  card.querySelectorAll("[data-auto-add-figure-label]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      autoAddFigureLabelForBlock(button.dataset.autoAddFigureLabel);
    });
  });
  card.querySelectorAll("[data-convert-code-block]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await convertCodeBlockToMarkdownForBlock(button.dataset.convertCodeBlock);
    });
  });
  card.querySelectorAll("[data-structure-formula-block]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await structureFormulaBlock(button.dataset.structureFormulaBlock);
    });
  });
  card.querySelectorAll("[data-revert-mathpix-block-edit]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await discardMathpixCorrectionForBlock(button.dataset.revertMathpixBlockEdit);
    });
  });
  card.querySelectorAll(".selected-block-toolbar, .block-source-detail").forEach((container) => {
    ["click", "pointerdown", "dblclick"].forEach((eventName) => {
      container.addEventListener(eventName, (event) => event.stopPropagation());
    });
  });
  card.querySelectorAll("[data-mathpix-edit], [data-mineru-source-edit]").forEach((editor) => {
    ["click", "pointerdown", "keydown"].forEach((eventName) => {
      editor.addEventListener(eventName, (event) => event.stopPropagation());
    });
    editor.addEventListener("input", () => handleReviewEditorInput(editor));
    updateReviewEditorActionState(editor);
  });
  if (typeof card.addEventListener === "function") {
    card.addEventListener("input", (event) => {
      const editor = event.target?.closest?.("[data-mathpix-edit], [data-mineru-source-edit]");
      if (editor && card.contains(editor)) {
        handleReviewEditorInput(editor);
      }
    });
  }
  card.querySelectorAll("[data-review-block-step]").forEach((button) => {
    button.addEventListener("click", () => navigateReviewBlock(button.dataset.reviewBlockStep));
  });
  card.querySelectorAll("[data-review-needs-correction-jump]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectReviewBlock(button.dataset.reviewNeedsCorrectionJump);
    });
  });
  card.querySelectorAll("[data-review-font-scale]").forEach((button) => {
    button.addEventListener("click", async () => {
      setReviewFontScale(button.dataset.reviewFontScale);
      saveOcrWorkspaceState();
      if (!refreshRightWorkbenchOnly()) {
        await renderCurrentPage();
      }
    });
  });
  card.querySelectorAll("[data-review-fit-page]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.reviewFitToPage = !state.reviewFitToPage;
      saveOcrWorkspaceState();
      if (!refreshRightWorkbenchOnly({ preserveReviewScroll: true })) {
        await renderCurrentPage();
      }
    });
  });
  card.querySelectorAll("[data-page-jump]").forEach((button) => {
    button.addEventListener("click", () => goToPagerTarget(button.dataset.pageJump));
  });
  card.querySelectorAll("[data-page-input]").forEach((input) => {
    input.addEventListener("change", () => goToPage(Number(input.value || state.currentPage)));
  });
  card.querySelector("[data-review-block-select]")?.addEventListener("change", (event) => {
    selectReviewBlock(event.target.value);
  });
  card.querySelectorAll("[data-cross-page-jump-page]").forEach((button) => {
    button.addEventListener("click", () => jumpToCrossPageBlock(button.dataset.crossPageJumpPage, button.dataset.crossPageJumpBlock));
  });
  card.querySelector("[data-next-risk-page]")?.addEventListener("click", () => goToNextRiskPage());
  card.querySelectorAll("[data-ocr-patch-status-action]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const result = updateOcrPatchStatus(button.dataset.ocrPatchId, button.dataset.ocrPatchStatusAction);
      state.acceptedPatchPreview = null;
      state.acceptedPatchBookPreview = null;
      setStatus(result.ok ? `Patch ${result.patch.status}` : "Patch unchanged", result.ok ? "ok" : "error");
      await renderCurrentPage();
    });
  });
  card.querySelector("[data-close-accepted-book-preview]")?.addEventListener("click", async () => {
    state.acceptedPatchBookPreview = null;
    setStatus("Book preview closed", "ok");
    await renderCurrentPage();
  });
  return card;
}

function hasAcceptedOcrPatches() {
  const patches = Array.isArray(state.ocrPatches) ? state.ocrPatches : [];
  return patches.some((patch) => patch?.status === "accepted");
}

function renderAcceptedPatchBookPreviewPanel() {
  return "";
}

function updateAcceptedPatchTopControls() {
  const hasAccepted = hasAcceptedOcrPatches();
  const canExportWorkspace = Boolean(state.mineruInfo && state.mineruFileName);
  if (els.exportWorkspaceButton) {
    els.exportWorkspaceButton.disabled = !canExportWorkspace;
    els.exportWorkspaceButton.title = canExportWorkspace ? "导出当前书的 OCR 校对工作区状态" : "先上传 middle.json";
  }
  if (els.previewAcceptedBookButton) {
    els.previewAcceptedBookButton.disabled = !hasAccepted;
    els.previewAcceptedBookButton.textContent = "预览整书 accepted 校正稿";
  }
  if (els.downloadAcceptedCorrectedButton) {
    els.downloadAcceptedCorrectedButton.disabled = !hasAccepted;
    els.downloadAcceptedCorrectedButton.title = hasAccepted ? "点击后执行 accepted dry-run 检查并下载" : "当前没有 accepted patch";
  }
}

async function toggleAcceptedBookPreview() {
  if (!hasAcceptedOcrPatches()) {
    setStatus("No accepted patch", "error");
    updateAcceptedPatchTopControls();
    return;
  }
  state.acceptedPatchPreview = null;
  state.acceptedPatchBookPreview = null;
  const button = els.previewAcceptedBookButton;
  if (button) {
    button.disabled = true;
    button.textContent = "预览生成中...";
  }
  setStatus("Book preview running...", "busy");
  await nextFrame();
  try {
    await ensurePdfTextLayersForBook();
    const preview = buildAcceptedPatchPreviewForBook();
    const warnings = Array.isArray(preview?.warnings) ? preview.warnings.length : 0;
    const errors = Array.isArray(preview?.errors) ? preview.errors.length : 0;
    setStatus(preview?.ok ? `Book preview ok · warnings: ${warnings}` : `Book preview warning · errors: ${errors}`, preview?.ok ? "ok" : "error");
  } catch (error) {
    setStatus("Book preview failed", "error", error?.message || String(error || ""));
  } finally {
    updateAcceptedPatchTopControls();
  }
}

async function downloadAcceptedCorrectedFromTop() {
  try {
    setStatus("Accepted download preparing...", "busy");
    await ensurePdfTextLayersForBook();
    const result = await downloadAcceptedCorrectedPackage();
    const statusText = result.status?.message || (result.ok ? "Downloaded accepted" : "Accepted download blocked");
    setStatus(statusText, result.ok ? "ok" : "error");
  } catch (error) {
    setStatus("Accepted download failed", "error", error?.message || String(error || ""));
  } finally {
    updateAcceptedPatchTopControls();
    await renderCurrentPage();
  }
}

function nextFrame() {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

function renderReviewNavigationBar(reviewEntries) {
  const entries = Array.isArray(reviewEntries) ? reviewEntries : [];
  const activeIndex = entries.length ? Math.max(0, activeReviewEntryIndex(entries)) : -1;
  const active = activeIndex >= 0 ? entries[activeIndex] : null;
  const previousBlockTarget = reviewBlockStepTarget("prev", entries, activeIndex);
  const nextBlockTarget = reviewBlockStepTarget("next", entries, activeIndex);
  const fontScale = currentReviewFontScale();
  const fontScaleIndex = REVIEW_FONT_SCALE_LEVELS.indexOf(fontScale);
  return `
    <div class="review-navigation-bar" data-review-block-navigator>
      <div class="review-nav-controls">
        <div class="review-font-nav-group">
          <button class="text-button image-zoom-button image-fit-button ${state.reviewFitToPage ? "is-active" : ""}" type="button" data-review-fit-page aria-label="校正稿整页适配窗口" title="整页适配">
            <span class="fit-page-glyph" aria-hidden="true">⛶</span>
          </button>
          <button class="text-button image-zoom-button" type="button" data-review-font-scale="out" ${fontScaleIndex <= 0 ? "disabled" : ""} aria-label="缩小右栏字体" title="缩小右栏字体">
            <span class="image-zoom-glyph" aria-hidden="true"><span>A</span><span>⌄</span></span>
          </button>
          <button class="text-button image-zoom-button" type="button" data-review-font-scale="in" ${fontScaleIndex >= REVIEW_FONT_SCALE_LEVELS.length - 1 ? "disabled" : ""} aria-label="放大右栏字体" title="放大右栏字体">
            <span class="image-zoom-glyph" aria-hidden="true"><span>A</span><span>⌃</span></span>
          </button>
        </div>
        <div class="review-block-nav-group">
          <span class="review-nav-group-label">块 ${activeIndex >= 0 ? `${activeIndex + 1} / ${entries.length}` : "0 / 0"}</span>
          <div class="review-block-nav-controls">
            <button class="secondary-button block-step-button" type="button" data-review-block-step="prev" ${previousBlockTarget ? "" : "disabled"} aria-label="上一校对块" title="上一校对块">‹</button>
            <select data-review-block-select aria-label="选择校对块" ${entries.length ? "" : "disabled"}>
              ${
                entries.length
                  ? entries.map((entry) => `<option value="${escapeHtml(entry.key)}" ${entry.key === active.key ? "selected" : ""}>${escapeHtml(reviewEntryLabel(entry))}</option>`).join("")
                  : '<option value="">当前页没有可校对块</option>'
              }
            </select>
            <button class="secondary-button block-step-button" type="button" data-review-block-step="next" ${nextBlockTarget ? "" : "disabled"} aria-label="下一校对块" title="下一校对块">›</button>
          </div>
        </div>
        ${renderNeedsCorrectionNav(entries)}
      </div>
    </div>
  `;
}

function currentPageNeedsCorrectionEntries(reviewEntries) {
  const entries = Array.isArray(reviewEntries) ? reviewEntries : [];
  return entries.filter((entry) => state.reviewNeedsCorrection.has(reviewBlockKey(state.currentPage, entry.key)));
}

function reviewBlockStepTarget(direction, entries = reviewEntriesForCurrentPage(), activeIndex = activeReviewEntryIndex(entries)) {
  const currentEntries = Array.isArray(entries) ? entries : [];
  const currentPage = Number(state.currentPage) || 1;
  if (currentEntries.length) {
    const numericActiveIndex = Number(activeIndex);
    const safeIndex = clamp(Number.isFinite(numericActiveIndex) ? numericActiveIndex : 0, 0, currentEntries.length - 1);
    const adjacentIndex = direction === "prev" ? safeIndex - 1 : safeIndex + 1;
    if (adjacentIndex >= 0 && adjacentIndex < currentEntries.length) {
      return { pageNumber: currentPage, blockIndex: currentEntries[adjacentIndex].key };
    }
  }
  const total = getReviewPageCount();
  const step = direction === "prev" ? -1 : 1;
  for (let pageNumber = currentPage + step; pageNumber >= 1 && pageNumber <= total; pageNumber += step) {
    const pageEntries = reviewEntriesForPage(pageNumber);
    if (!pageEntries.length) {
      continue;
    }
    const targetEntry = direction === "prev" ? pageEntries[pageEntries.length - 1] : pageEntries[0];
    return { pageNumber, blockIndex: targetEntry.key };
  }
  return null;
}

function renderNeedsCorrectionNav(reviewEntries) {
  const markedEntries = currentPageNeedsCorrectionEntries(reviewEntries);
  const count = markedEntries.length;
  return `
    <div class="review-needs-correction-nav-group ${count ? "has-items" : ""}" aria-label="当前页需要额外校正的块">
      <span class="review-nav-group-label">待校正 ${count}</span>
      <div class="review-needs-correction-links">
        ${
          count
            ? markedEntries
                .map((entry) => {
                  const fullKey = reviewBlockKey(state.currentPage, entry.key);
                  const label = Number(entry.displayIndex) > 0 ? entry.displayIndex : entry.key;
                  const selected = isActiveReviewBlockKey(fullKey);
                  return `<button class="review-needs-correction-link ${selected ? "is-selected" : ""}" type="button" data-review-needs-correction-jump="${escapeHtml(fullKey)}" aria-label="跳转到需要额外校正的 Block ${escapeHtml(String(label))}">${escapeHtml(String(label))}</button>`;
                })
                .join("")
            : '<span class="review-needs-correction-empty">无</span>'
        }
      </div>
    </div>
  `;
}

function activeReviewEntryIndex(reviewEntries) {
  const entries = Array.isArray(reviewEntries) ? reviewEntries : [];
  if (!entries.length) {
    return -1;
  }
  const prefix = `${state.currentPage}:`;
  const activeKey = Array.from(state.reviewExpanded || [])
    .map((key) => String(key))
    .find((key) => key.startsWith(prefix))
    ?.slice(prefix.length);
  const index = entries.findIndex((entry) => entry.key === activeKey);
  return index >= 0 ? index : 0;
}

function reviewEntryLabel(entry) {
  const blockLabel = `Block ${entry.displayIndex || ""}`.trim();
  const label = entry.risk?.syntheticLabel || (entry.risk?.crossPageSourcePage ? "跨页候选" : "");
  return label ? `${label} · ${blockLabel}` : blockLabel;
}

function renderPageNavigator(scope = "inline") {
  const total = state.pdfPageCount || getMineruPageCount() || 1;
  const hasPages = total > 0;
  const atFirst = !hasPages || state.currentPage <= 1;
  const atLast = !hasPages || state.currentPage >= total;
  return `
    <nav class="pager pager-compact" data-page-nav="${escapeHtml(scope)}" aria-label="页码导航">
      <button class="secondary-button pager-icon" type="button" data-page-jump="first" ${atFirst ? "disabled" : ""} aria-label="跳转到首页" title="首页">⏮</button>
      <button class="secondary-button pager-icon" type="button" data-page-jump="prev" ${atFirst ? "disabled" : ""} aria-label="上一页" title="上一页">‹</button>
      <label class="page-field">
        <span class="sr-only">页码</span>
        <input data-page-input type="number" min="1" max="${escapeHtml(String(total || ""))}" value="${escapeHtml(String(state.currentPage))}" ${hasPages ? "" : "disabled"} aria-label="页码">
      </label>
      <span class="page-count-label">/ ${hasPages ? escapeHtml(String(total)) : "-"}</span>
      <button class="secondary-button pager-icon" type="button" data-page-jump="next" ${atLast ? "disabled" : ""} aria-label="下一页" title="下一页">›</button>
      <button class="secondary-button pager-icon" type="button" data-page-jump="last" ${atLast ? "disabled" : ""} aria-label="跳转到尾页" title="尾页">⏭</button>
    </nav>
  `;
}

function ensureDefaultReviewExpansion(orderedRisks) {
  if (!orderedRisks.length) {
    return;
  }
  const entries = orderedRisks.filter(Boolean);
  const prefix = `${state.currentPage}:`;
  const activeKey = Array.from(state.reviewExpanded || []).find((key) => String(key).startsWith(prefix));
  if (activeKey && entries.some((entry) => String(activeKey) === reviewBlockKey(state.currentPage, entry.blockIndex))) {
    return;
  }
  Array.from(state.reviewExpanded || []).forEach((key) => {
    if (String(key).startsWith(prefix)) {
      state.reviewExpanded.delete(key);
    }
  });
  state.reviewExpanded.add(reviewBlockKey(state.currentPage, entries[0].blockIndex));
  state.reviewInitializedPages.add(state.currentPage);
}

function orderRisksBySegment(risks, segments) {
  const orderByKey = new Map(segments.map((segment, index) => [String(segment.blockIndex), visualOrderForPageEntry(segment, index)]));
  return risks
    .slice()
    .sort(
      (left, right) =>
        riskVisualOrder(left, orderByKey) - riskVisualOrder(right, orderByKey),
    );
}

function buildReviewEntriesForPage(risks, segments, pageNumber) {
  const riskByKey = new Map((Array.isArray(risks) ? risks : []).map((risk) => [String(risk.blockIndex), risk]));
  const seen = new Set();
  const entries = segments
    .map((segment) => {
      const key = String(segment.blockIndex);
      const risk = riskByKey.get(key);
      const hasReviewText = Boolean(String(segment.markdown || "").trim());
      if (!hasReviewText && !risk) {
        return null;
      }
      seen.add(key);
      return {
        key,
        segment,
        risk: risk || reviewRiskFromSegment(segment, pageNumber),
      };
    })
    .filter(Boolean);
  (Array.isArray(risks) ? risks : []).forEach((risk) => {
    const key = String(risk.blockIndex);
    if (seen.has(key)) {
      return;
    }
    entries.push({
      key,
      segment: {
        blockIndex: key,
        markdown: risk.text,
        kind: "block",
        bbox: risk.bbox,
        pageSize: risk.pageSize,
      },
      risk,
    });
  });
  const orderByKey = new Map(segments.map((segment, index) => [String(segment.blockIndex), visualOrderForPageEntry(segment, index)]));
  return entries
    .sort((left, right) => riskVisualOrder(left.risk, orderByKey) - riskVisualOrder(right.risk, orderByKey))
    .map((entry, index) => ({
      ...entry,
      displayIndex: index + 1,
    }));
}

function reviewRiskFromSegment(segment, pageNumber = state.currentPage) {
  return {
    pageNumber,
    blockIndex: String(segment?.blockIndex ?? ""),
    bbox: segment?.bbox || null,
    pageSize: segment?.pageSize || null,
    text: segment?.markdown || "",
    score: 0,
    reasons: [],
    reviewOnly: true,
  };
}

function riskVisualOrder(risk, orderByKey) {
  const bboxOrder = visualOrderForPageEntry(risk, Number.MAX_SAFE_INTEGER / 4);
  const hasVisualBBox = Boolean(normalizedBBox(risk?.bbox));
  if (risk?.syntheticPlacement === "after_anchor") {
    const anchorOrder = orderByKey.get(String(risk?.anchorBlockIndex));
    if (Number.isFinite(anchorOrder)) {
      return anchorOrder + 0.001;
    }
    return Number.isFinite(bboxOrder) ? bboxOrder : Number.MAX_SAFE_INTEGER / 2;
  }
  if (risk?.syntheticPlacement === "page_top") {
    if (risk?.supplementalSource === "content_list" && hasVisualBBox && Number.isFinite(bboxOrder)) {
      return bboxOrder;
    }
    if (risk?.reasons?.includes?.("cross_page_continuation") && hasVisualBBox && Number.isFinite(bboxOrder) && !isPageTopBBox(risk?.bbox, risk?.pageSize)) {
      return bboxOrder;
    }
    return -2000;
  }
  if (risk?.syntheticPlacement === "page_bottom") {
    return Number.MAX_SAFE_INTEGER - 500;
  }
  if (risk?.crossPageHint === "previous_tail") {
    return -1000 + (Number(risk.sourceBlockIndex) || 0) / 1000;
  }
  if (risk?.crossPageHint === "next_head") {
    return Number.MAX_SAFE_INTEGER - 1000 + (Number(risk.sourceBlockIndex) || 0) / 1000;
  }
  return orderByKey.get(String(risk?.blockIndex)) ?? bboxOrder ?? Number.MAX_SAFE_INTEGER / 2;
}

function visualOrderForPageEntry(entry, fallbackIndex = 0) {
  const bbox = normalizedBBox(entry?.bbox);
  const pageSize = entry?.pageSize || null;
  if (!bbox) {
    return Number.MAX_SAFE_INTEGER / 2 + (Number(fallbackIndex) || 0);
  }
  const width = pageSizeWidth(pageSize) || Math.max(bbox[2], 1);
  const height = pageSizeHeight(pageSize) || Math.max(bbox[3], 1);
  const top = Math.max(0, Number(bbox[1]) || 0) / Math.max(height, 1);
  const left = Math.max(0, Number(bbox[0]) || 0) / Math.max(width, 1);
  return top * 10000 + left * 100 + (Number(fallbackIndex) || 0) / 10000;
}

function isPageTopBBox(bbox, pageSize) {
  const geometry = bboxGeometryForPageSize(bbox, pageSize);
  return Boolean(geometry && geometry.topRatio <= 0.14);
}

function reviewPatchMarkdown(patch) {
  if (!patch || !["draft", "accepted"].includes(patch.status)) {
    return "";
  }
  return String(patch.newText || "").trim() ? String(patch.newText || "") : "";
}

function renderPageReviewCanvas(reviewEntries) {
  const entries = Array.isArray(reviewEntries) ? reviewEntries : [];
  const canvasStyle = `--review-font-scale: ${currentReviewFontScale()};`;
  if (!entries.length) {
    return `<div class="review-list review-page-canvas markdown-body" style="${canvasStyle}"><div class="empty-inline">当前页未发现可校对文本块。</div></div>`;
  }
  return `
    <div class="review-list review-page-canvas markdown-body" data-review-page-canvas style="${canvasStyle}">
      <div class="review-page-paper">
        ${entries.map((entry) => renderPageReviewBlock(entry)).join("")}
      </div>
    </div>
  `;
}

function renderPageReviewBlock(entry) {
  const blockKey = String(entry?.key || entry?.segment?.blockIndex || "");
  const fullKey = reviewBlockKey(state.currentPage, blockKey);
  const segment = entry.segment || {};
  const risk = entry.risk || reviewRiskFromSegment(segment, state.currentPage);
  const correctionState = reviewCorrectionStateForSegment(state.currentPage, blockKey, segment, risk.text || "");
  const {
    correctionView,
    correctedMarkdown,
    draftMarkdown,
    ocrPatch,
  } = correctionState;
  const displayMarkdown = correctionView.displayMarkdown;
  const selected = isActiveReviewBlockKey(fullKey);
  const corrected = correctionView.isCorrected;
  const hasDraft = correctionView.hasMathpixDraft;
  const itemState = hasDraft ? "mathpix-draft" : corrected ? "corrected" : risk.reviewOnly ? "normal" : "candidate";
  const correctionOpen = state.reviewCorrectionOpen.has(fullKey);
  const actionsOpen = state.reviewActionsOpen.has(fullKey) || correctionOpen;
  const needsCorrection = state.reviewNeedsCorrection.has(fullKey);
  const missingFigureLabel = inferMissingFigureLabelForBlock(state.currentPage, blockKey, segment.markdown || "");
  const codeConversionAvailable = canConvertCodeLikeMarkdownToPlainMarkdown(displayMarkdown, segment);
  const formulaStructureAvailable = canStructureFormulaMarkdown(displayMarkdown);
  const mathpixError = getMathpixBlockError(state.currentPage, blockKey);
  const actionsHtml = actionsOpen
    ? `<div class="review-page-block-actions">
        <button class="review-page-mark-button ${needsCorrection ? "is-active" : ""}" type="button" data-review-needs-correction-toggle="${escapeHtml(fullKey)}" aria-pressed="${needsCorrection ? "true" : "false"}">
          需要额外校正
        </button>
        ${
          missingFigureLabel
            ? `<button class="review-page-local-button" type="button" data-auto-add-figure-label="${escapeHtml(blockKey)}">补图号</button>`
            : ""
        }
        ${
          codeConversionAvailable
            ? `<button class="review-page-local-button" type="button" data-convert-code-block="${escapeHtml(blockKey)}">转普通文本</button>`
            : ""
        }
        ${
          formulaStructureAvailable
            ? `<button class="review-page-local-button" type="button" data-structure-formula-block="${escapeHtml(blockKey)}">结构化公式</button>`
            : ""
        }
        <button class="review-page-correct-button" type="button" data-review-correction-toggle="${escapeHtml(fullKey)}" aria-expanded="${correctionOpen ? "true" : "false"}">
          ${correctionOpen ? "收起校正" : "校正"}
        </button>
      </div>`
    : "";
  return `
    <section class="review-page-block ${selected ? "is-selected" : ""} ${corrected ? "is-corrected" : ""} ${hasDraft ? "has-mathpix-draft" : ""} ${needsCorrection ? "needs-extra-correction" : ""}" tabindex="0" role="button" data-review-page-block="${escapeHtml(fullKey)}" data-source-block-id="${escapeHtml(blockKey)}" data-review-item-state="${escapeHtml(itemState)}">
      <div class="review-page-block-render">
        ${renderBlockContent(displayMarkdown, segment)}
      </div>
      ${actionsHtml}
      ${
        correctionOpen
          ? renderSelectedBlockToolbar(
              segment,
              risk,
              correctedMarkdown,
              corrected,
              draftMarkdown,
              ocrPatch,
              { displayIndex: entry.displayIndex, mathpixError, correctionView },
            )
          : ""
      }
      ${mathpixError ? `<div class="review-block-error" role="status">${escapeHtml(mathpixError)}</div>` : ""}
    </section>
  `;
}

function isActiveReviewBlockKey(fullKey) {
  return state.reviewExpanded.has(String(fullKey || ""));
}

function renderReviewItem(segment, risk, correctedMarkdown, corrected, mathpixDraftMarkdown = "", ocrPatch = null, options = {}) {
  const isCrossPage = Boolean(risk?.crossPageSourcePage);
  const isReviewOnly = Boolean(risk?.reviewOnly);
  const displayIndex = Number(options.displayIndex) > 0 ? Number(options.displayIndex) : null;
  const displayBlockLabel = `Block ${escapeHtml(String(displayIndex || segment.blockIndex))}`;
  const disabled = !isCrossPage && risk.bbox ? "" : "disabled";
  const mathpixUnavailable = state.mathpixConfigured === false;
  const mathpixDisabled = !isCrossPage && (disabled || mathpixUnavailable) ? "disabled" : "";
  const mathpixUnavailableReason = state.mathpixConfigError || "未配置 MATHPIX_APP_ID/MATHPIX_APP_KEY";
  const mathpixTitle = mathpixUnavailable ? `title="${escapeHtml(mathpixUnavailableReason)}"` : "";
  const patchMarkdown = reviewPatchMarkdown(ocrPatch);
  const correctionView = options.correctionView || buildReviewCorrectionViewModel({
    liveDraft: getLiveReviewDrafts(state.currentPage, false).get(String(segment.blockIndex)) || null,
    mathpixDraftMarkdown,
    patchMarkdown,
    correctedMarkdown,
    corrected,
    ocrPatch,
    fallbackMarkdown: segment.markdown || risk.text || "",
  });
  const {
    hasAcceptedPatchMarkdown,
    hasMathpixDraft,
    isCorrected,
    editableMarkdown,
    hasEditableMarkdown,
    previewMarkdown,
    mathpixEditorIsSaved,
  } = correctionView;
  const reviewKey = reviewBlockKey(state.currentPage, segment.blockIndex);
  const expanded = state.reviewExpanded.has(reviewKey);
  const itemState = hasMathpixDraft ? "mathpix-draft" : isCorrected ? "corrected" : isReviewOnly ? "normal" : "candidate";
  const itemStateLabel = isCrossPage
    ? risk.crossPageLabel
    : hasMathpixDraft
      ? "Mathpix draft"
      : hasAcceptedPatchMarkdown
        ? "已接受 patch"
        : corrected
          ? "已应用"
          : isReviewOnly
            ? "普通段落"
            : "";
  const correctedPaneTitle = hasMathpixDraft ? "Mathpix 识别稿（未应用）" : hasAcceptedPatchMarkdown ? "已接受校正稿" : "校正稿渲染";
  const mathpixError = String(options.mathpixError || getMathpixBlockError(state.currentPage, segment.blockIndex) || "");
  const mathpixActionLabel = mathpixUnavailable ? (state.mathpixConfigError ? "Mathpix 配置无效" : "Mathpix 未配置") : isCorrected ? "Mathpix 重校正" : risk.bbox ? "Mathpix 校正" : "缺少 bbox";
  const shouldShowLatestOnly = hasMathpixDraft || isCorrected;
  const title = risk?.syntheticLabel
    ? `${escapeHtml(risk.syntheticLabel)} · ${displayBlockLabel}`
    : isCrossPage
      ? `跨页候选 · ${displayBlockLabel}`
      : displayBlockLabel;
  const mineruPaneHtml = `
        <section class="review-pane mineru-review-pane">
          <div class="review-pane-title">MinerU 渲染</div>
          <div class="review-render">
            ${renderBlockContent(segment.markdown, segment)}
          </div>
          <details class="block-source-detail">
            <summary>编辑当前块 MinerU Markdown 源码</summary>
            <textarea class="mathpix-source-editor block-source-editor" data-mineru-source-edit="${escapeHtml(String(segment.blockIndex))}" spellcheck="false">${escapeHtml(segment.markdown)}</textarea>
            <div class="mathpix-edit-actions">
              <button class="text-button" type="button" data-apply-mineru-source-edit="${escapeHtml(String(segment.blockIndex))}" data-disable-when-clean="1" data-clean-label="保存" data-dirty-label="保存" disabled>
                保存
              </button>
            </div>
          </details>
        </section>`;
  const correctedPaneHtml =
    isCorrected || hasEditableMarkdown
      ? `<section class="review-pane mathpix-pane">
          <div class="review-pane-title">${correctedPaneTitle}</div>
          <div class="review-render">
            ${renderBlockContent(previewMarkdown, segment)}
          </div>
          <details class="block-source-detail">
            <summary>编辑 Markdown 源码（保存后进入 accepted 校正稿）</summary>
            <textarea class="mathpix-source-editor" data-mathpix-edit="${escapeHtml(String(segment.blockIndex))}" spellcheck="false">${escapeHtml(editableMarkdown)}</textarea>
            <div class="mathpix-edit-actions">
              <button class="text-button" type="button" data-apply-mathpix-block-edit="${escapeHtml(String(segment.blockIndex))}" data-clean-label="保存" data-dirty-label="保存" ${hasMathpixDraft ? "" : 'data-disable-when-clean="1" disabled'}>
                保存
              </button>
              ${hasMathpixDraft ? `<button class="text-button" type="button" data-revert-mathpix-block-edit="${escapeHtml(String(segment.blockIndex))}">撤销修改</button>` : ""}
            </div>
          </details>
        </section>`
      : "";
  const originalMineruDetailHtml = `
        <details class="review-original-detail">
          <summary>查看原 MinerU 识别/源码</summary>
          ${mineruPaneHtml}
        </details>`;
  const bodyHtml = shouldShowLatestOnly
    ? `${correctedPaneHtml}${originalMineruDetailHtml}`
    : `${mineruPaneHtml}${correctedPaneHtml}`;
  if (options.toolbarOnly) {
    const mathpixActionHtml = isCrossPage
      ? `<button class="text-button risk-action" type="button" data-cross-page-jump-page="${escapeHtml(String(risk.crossPageSourcePage))}" data-cross-page-jump-block="${escapeHtml(String(risk.sourceBlockIndex))}">跳到第 ${escapeHtml(String(risk.crossPageSourcePage))} 页校对</button>`
      : `<button class="text-button risk-action" type="button" data-risk-mathpix="${segment.blockIndex}" ${mathpixDisabled} ${mathpixTitle}>
          ${mathpixActionLabel}
        </button>`;
    const saveActionHtml = hasEditableMarkdown
      ? `<button class="text-button selected-save-action" type="button" data-toolbar-apply-mathpix-block-edit="${escapeHtml(String(segment.blockIndex))}" data-clean-label="保存" data-dirty-label="保存" ${hasMathpixDraft ? "" : 'data-disable-when-clean="1" disabled'}>保存</button>`
      : `<button class="text-button selected-save-action" type="button" data-toolbar-apply-mineru-source-edit="${escapeHtml(String(segment.blockIndex))}" data-disable-when-clean="1" data-clean-label="保存" data-dirty-label="保存" disabled>保存</button>`;
    const cancelActionHtml = hasMathpixDraft
      ? `<button class="text-button selected-cancel-action" type="button" data-revert-mathpix-block-edit="${escapeHtml(String(segment.blockIndex))}">取消</button>`
      : `<button class="text-button selected-cancel-action" type="button" data-review-correction-toggle="${escapeHtml(reviewKey)}">取消</button>`;
    return `
      <div class="selected-block-toolbar review-item ${isReviewOnly ? "is-normal" : ""} ${isCorrected ? "is-corrected" : ""} ${hasMathpixDraft ? "has-mathpix-draft" : ""} ${isCrossPage ? "is-cross-page" : ""} is-expanded" data-review-item-state="${escapeHtml(itemState)}" data-source-block-id="${escapeHtml(String(segment.blockIndex))}">
        <div class="selected-block-toolbar-head">
          <div>
            <strong>${title}</strong>
          </div>
          <div class="review-item-actions">
            ${renderOcrPatchStatusControls(ocrPatch)}
            <button class="text-button review-toolbar-collapse" type="button" data-review-correction-toggle="${escapeHtml(reviewKey)}" aria-label="收起校正面板" title="收起">⌃</button>
            ${mathpixActionHtml}
            ${saveActionHtml}
            ${cancelActionHtml}
          </div>
        </div>
        <div class="selected-block-toolbar-body">
          ${mathpixError ? `<div class="review-block-error" role="status">${escapeHtml(mathpixError)}</div>` : ""}
          ${renderCompactSelectedBlockEditor({
            segment,
            editableMarkdown,
            hasEditableMarkdown,
            hasMathpixDraft,
            mathpixEditorIsSaved,
          })}
        </div>
      </div>
    `;
  }
  return `
    <article class="review-item ${isReviewOnly ? "is-normal" : ""} ${isCorrected ? "is-corrected" : ""} ${hasMathpixDraft ? "has-mathpix-draft" : ""} ${isCrossPage ? "is-cross-page" : ""} ${expanded ? "is-expanded" : "is-collapsed"}" data-review-item-state="${escapeHtml(itemState)}" data-source-block-id="${escapeHtml(String(segment.blockIndex))}">
      <div class="review-item-head">
        <div>
          <strong>${title}</strong>
        </div>
        <div class="review-item-actions">
          ${renderOcrPatchStatusControls(ocrPatch)}
          <button class="text-button review-toggle" type="button" data-review-toggle="${escapeHtml(reviewKey)}">
            ${expanded ? "收起" : "展开"}
          </button>
          ${
            isCrossPage
              ? `<button class="text-button risk-action" type="button" data-cross-page-jump-page="${escapeHtml(String(risk.crossPageSourcePage))}" data-cross-page-jump-block="${escapeHtml(String(risk.sourceBlockIndex))}">跳到第 ${escapeHtml(String(risk.crossPageSourcePage))} 页校对</button>`
              : `<button class="text-button risk-action" type="button" data-risk-mathpix="${segment.blockIndex}" ${mathpixDisabled} ${mathpixTitle}>
                  ${mathpixActionLabel}
                </button>`
          }
        </div>
      </div>
      <div class="review-item-body" ${expanded ? "" : "hidden"}>
        ${mathpixError ? `<div class="review-block-error" role="status">${escapeHtml(mathpixError)}</div>` : ""}
        ${bodyHtml}
      </div>
    </article>
  `;
}

function renderSelectedBlockToolbar(segment, risk, correctedMarkdown, corrected, mathpixDraftMarkdown = "", ocrPatch = null, options = {}) {
  return renderReviewItem(segment, risk, correctedMarkdown, corrected, mathpixDraftMarkdown, ocrPatch, {
    ...options,
    toolbarOnly: true,
  });
}

function buildReviewCorrectionViewModel({
  liveDraft = null,
  mathpixDraftMarkdown = "",
  patchMarkdown = "",
  correctedMarkdown = "",
  corrected = false,
  ocrPatch = null,
  fallbackMarkdown = "",
} = {}) {
  const liveDraftText = autoCorrectKnownEquationOcrMarkdown(String(liveDraft?.markdown || ""));
  const draftText = String(mathpixDraftMarkdown || "");
  const patchText = String(patchMarkdown || "");
  const correctedText = String(correctedMarkdown || "");
  const activeCorrectionMarkdown = liveDraftText || draftText || patchText || correctedText || "";
  const editableMarkdown = activeCorrectionMarkdown
    ? liveDraftText
      ? liveDraftText
      : normalizedReviewMarkdownForActiveCorrection(activeCorrectionMarkdown)
    : "";
  const hasEditableMarkdown = Boolean(editableMarkdown.trim());
  const hasPatchDraft = Boolean(patchText.trim() && ocrPatch?.status === "draft");
  const hasAcceptedPatchMarkdown = Boolean(patchText.trim() && ocrPatch?.status === "accepted");
  const hasMathpixDraft = Boolean(liveDraftText.trim() || draftText.trim()) || hasPatchDraft;
  const isCorrected = Boolean(corrected || hasAcceptedPatchMarkdown);
  const previewMarkdown = hasMathpixDraft || hasAcceptedPatchMarkdown ? editableMarkdown : correctedText;
  const mathpixEditorIsSaved = Boolean(
    hasAcceptedPatchMarkdown &&
      !hasMathpixDraft &&
      editableMarkdown === normalizedReviewMarkdownForActiveCorrection(patchText),
  );
  return {
    activeCorrectionMarkdown,
    displayMarkdown: hasEditableMarkdown ? editableMarkdown : String(fallbackMarkdown || ""),
    editableMarkdown,
    hasEditableMarkdown,
    hasPatchDraft,
    hasAcceptedPatchMarkdown,
    hasMathpixDraft,
    isCorrected,
    previewMarkdown,
    mathpixEditorIsSaved,
  };
}

function reviewCorrectionStateForSegment(pageNumber, blockKey, segment = {}, fallbackMarkdown = "") {
  const exact = reviewCorrectionStateForBlockKey(pageNumber, blockKey, segment?.markdown || fallbackMarkdown || "");
  const component = componentCorrectionStateForMergedSegment(pageNumber, segment);
  if (component?.hasCorrection && !exact.hasLiveDraft && !exact.hasMathpixDraft) {
    return component;
  }
  return exact;
}

function reviewCorrectionStateForBlockKey(pageNumber, blockKey, sourceMarkdown = "") {
  const key = String(blockKey || "");
  const blockOverrides = getBlockOverrides(pageNumber, false);
  const mathpixDrafts = getMathpixBlockDrafts(pageNumber, false);
  const liveDrafts = getLiveReviewDrafts(pageNumber, false);
  const ocrPatch = getLatestOcrPatchForBlock(pageNumber, key, sourceMarkdown);
  const patchMarkdown = reviewPatchMarkdown(ocrPatch);
  const draftMarkdown = mathpixDrafts.get(key) || "";
  const liveDraft = liveDrafts.get(key) || null;
  const correctedMarkdown = blockOverrides.get(key) || "";
  const corrected = blockOverrides.has(key);
  const correctionView = buildReviewCorrectionViewModel({
    liveDraft,
    mathpixDraftMarkdown: draftMarkdown,
    patchMarkdown,
    correctedMarkdown,
    corrected,
    ocrPatch,
    fallbackMarkdown: sourceMarkdown,
  });
  const hasCorrection = Boolean(
    liveDraft?.markdown ||
      draftMarkdown ||
      patchMarkdown ||
      correctedMarkdown ||
      correctionView.hasAcceptedPatchMarkdown ||
      correctionView.hasPatchDraft,
  );
  return {
    correctionView,
    liveDraft,
    draftMarkdown,
    correctedMarkdown,
    corrected,
    ocrPatch,
    hasCorrection,
    hasLiveDraft: Boolean(liveDraft?.markdown),
    hasMathpixDraft: Boolean(draftMarkdown || correctionView.hasPatchDraft),
  };
}

function componentCorrectionStateForMergedSegment(pageNumber, segment = {}) {
  const components = componentEntriesForReviewSegment(segment);
  if (components.length < 2) {
    return null;
  }
  const states = components.map((component) => {
    const key = String(component.blockIndex ?? "");
    const sourceMarkdown = String(component.markdown || "");
    const state = reviewCorrectionStateForBlockKey(pageNumber, key, sourceMarkdown);
    return {
      ...state,
      key,
      sourceMarkdown,
      displayMarkdown: state.correctionView.displayMarkdown || sourceMarkdown,
    };
  });
  if (!states.some((state) => state.hasCorrection)) {
    return null;
  }
  const joinedMarkdown = states.map((state) => state.displayMarkdown).filter(Boolean).join("\n");
  const hasDraft = states.some((state) => state.correctionView.hasMathpixDraft);
  const correctionView = buildReviewCorrectionViewModel({
    mathpixDraftMarkdown: hasDraft ? joinedMarkdown : "",
    correctedMarkdown: hasDraft ? "" : joinedMarkdown,
    corrected: !hasDraft,
    fallbackMarkdown: joinedMarkdown,
  });
  return {
    correctionView,
    liveDraft: null,
    draftMarkdown: hasDraft ? joinedMarkdown : "",
    correctedMarkdown: joinedMarkdown,
    corrected: !hasDraft,
    ocrPatch: null,
    hasCorrection: true,
    hasLiveDraft: false,
    hasMathpixDraft: hasDraft,
  };
}

function normalizedReviewMarkdownForActiveCorrection(markdown) {
  return autoCorrectKnownEquationOcrMarkdown(cleanMathpixEditableMarkdown(prepareMathpixMarkdown(markdown)));
}

function liveReviewMarkdownForEditor(editor) {
  const value = String(editor?.value || "");
  if (!editor?.dataset?.mathpixEdit) {
    return value;
  }
  return cleanMathpixEditableMarkdown(value);
}

function renderCompactSelectedBlockEditor({ segment, editableMarkdown, hasEditableMarkdown, hasMathpixDraft, mathpixEditorIsSaved }) {
  const blockIndex = escapeHtml(String(segment?.blockIndex ?? ""));
  const mineruMarkdown = escapeHtml(String(segment?.markdown || ""));
  const mathpixMarkdown = escapeHtml(String(editableMarkdown || ""));
  const sourceEditorHtml = hasEditableMarkdown
    ? `<details class="block-source-detail selected-source-detail">
        <summary>查看/编辑</summary>
        <textarea class="mathpix-source-editor" data-mathpix-edit="${blockIndex}" spellcheck="false">${mathpixMarkdown}</textarea>
        <div class="mathpix-edit-actions">
          <button class="text-button" type="button" data-apply-mathpix-block-edit="${blockIndex}" data-clean-label="保存" data-dirty-label="保存" ${mathpixEditorIsSaved ? 'data-disable-when-clean="1" disabled' : ""}>
            保存
          </button>
          ${hasMathpixDraft ? `<button class="text-button" type="button" data-revert-mathpix-block-edit="${blockIndex}">撤销修改</button>` : ""}
        </div>
      </details>`
    : `<details class="block-source-detail selected-source-detail">
        <summary>查看/编辑 MinerU 源码</summary>
        <textarea class="mathpix-source-editor block-source-editor" data-mineru-source-edit="${blockIndex}" spellcheck="false">${mineruMarkdown}</textarea>
        <div class="mathpix-edit-actions">
          <button class="text-button" type="button" data-apply-mineru-source-edit="${blockIndex}" data-disable-when-clean="1" data-clean-label="保存" data-dirty-label="保存" disabled>
            保存
          </button>
        </div>
      </details>`;
  return `
    <div class="selected-block-compact-actions">
      ${sourceEditorHtml}
    </div>
  `;
}

function updateReviewEditorActionState(editor) {
  const container = editor?.closest?.(".block-source-detail") || editor?.closest?.(".review-item");
  const button = container?.querySelector?.("[data-apply-mathpix-block-edit], [data-apply-mineru-source-edit]");
  const toolbar = editor?.closest?.(".selected-block-toolbar");
  const toolbarButtons = Array.from(toolbar?.querySelectorAll?.("[data-toolbar-apply-mathpix-block-edit], [data-toolbar-apply-mineru-source-edit]") || []);
  const toolbarStates = Array.from(toolbar?.querySelectorAll?.("[data-toolbar-edit-state]") || []);
  const currentValue = String(editor.value || "");
  const initialValue = String(editor.defaultValue ?? "");
  const isDirty = currentValue !== initialValue;
  const syncButton = (targetButton) => {
    if (!targetButton) {
      return;
    }
    if (targetButton.dataset?.disableWhenClean === "1") {
      targetButton.disabled = !isDirty;
      targetButton.textContent = isDirty ? targetButton.dataset.dirtyLabel || "保存" : targetButton.dataset.cleanLabel || "保存";
      return;
    }
    if (targetButton.dataset?.dirtyLabel && isDirty) {
      targetButton.textContent = targetButton.dataset.dirtyLabel;
    }
  };
  syncButton(button);
  toolbarButtons.forEach((toolbarButton) => syncButton(toolbarButton));
  toolbarStates.forEach((stateButton) => {
    stateButton.disabled = true;
    stateButton.textContent = isDirty ? stateButton.dataset.dirtyLabel || "保存" : stateButton.dataset.cleanLabel || "保存";
  });
  if (button?.dataset?.disableWhenClean === "1") {
    button.disabled = !isDirty;
    return isDirty;
  }
  return isDirty;
}

function handleReviewEditorInput(editor) {
  updateReviewEditorActionState(editor);
  storeLiveReviewDraftForEditor(editor);
  scheduleLiveReviewPreviewForEditor(editor);
}

function scheduleLiveReviewPreviewForEditor(editor) {
  liveReviewPreviewRunId += 1;
  const runId = liveReviewPreviewRunId;
  const scheduler = window.setTimeout || setTimeout;
  const clearer = window.clearTimeout || clearTimeout;
  if (liveReviewPreviewTimer) {
    clearer(liveReviewPreviewTimer);
  }
  liveReviewPreviewTimer = scheduler(() => {
    if (runId !== liveReviewPreviewRunId || editor?.isConnected === false) {
      return;
    }
    updateLiveReviewPreviewForEditor(editor);
  }, 180);
}

function storeLiveReviewDraftForEditor(editor) {
  const blockKey = String(editor?.dataset?.mathpixEdit || editor?.dataset?.mineruSourceEdit || "");
  if (!blockKey) {
    return false;
  }
  const isMathpixEditor = Boolean(editor.dataset?.mathpixEdit);
  const markdown = liveReviewMarkdownForEditor(editor);
  getLiveReviewDrafts(state.currentPage).set(blockKey, {
    markdown,
    source: isMathpixEditor ? "mathpix" : "mineru",
  });
  return true;
}

function updateLiveReviewPreviewForEditor(editor) {
  const blockKey = String(editor?.dataset?.mathpixEdit || editor?.dataset?.mineruSourceEdit || "");
  if (!blockKey) {
    return false;
  }
  storeLiveReviewDraftForEditor(editor);
  const block = editor.closest?.("[data-review-page-block]");
  const renderTarget = block?.querySelector?.(".review-page-block-render");
  if (!renderTarget) {
    return false;
  }
  const segment =
    reviewSegmentsForPage(state.currentPage).find((item) => String(item.blockIndex) === blockKey) ||
    { blockIndex: blockKey, kind: "text" };
  const isMathpixEditor = Boolean(editor.dataset?.mathpixEdit);
  const liveDraft = getLiveReviewDrafts(state.currentPage, false).get(blockKey) || null;
  const markdown = liveDraft?.markdown || (isMathpixEditor ? liveReviewMarkdownForEditor(editor) : String(editor.value || ""));
  if (renderTarget.__umaLivePreviewMarkdown === markdown) {
    return true;
  }
  renderTarget.__umaLivePreviewMarkdown = markdown;
  renderTarget.innerHTML = renderBlockContent(markdown, segment);
  if (rootHasMathContent(renderTarget)) {
    typesetMath(renderTarget);
  }
  return true;
}

function renderOcrPatchStatusControls(patch) {
  return "";
}

function reviewBlockKey(pageNumber, blockIndex) {
  return `${pageNumber}:${blockIndex}`;
}

async function toggleReviewBlock(key) {
  if (!key) {
    return;
  }
  if (state.reviewExpanded.has(key)) {
    state.reviewExpanded.delete(key);
    await renderCurrentPage();
    schedulePdfFocusSync();
    return;
  } else {
    state.reviewExpanded.clear();
    state.reviewExpanded.add(key);
  }
  await renderCurrentPage();
  scrollSelectedReviewBlockIntoView();
  schedulePdfFocusSync();
}

async function navigateReviewBlock(direction) {
  const entries = reviewEntriesForCurrentPage();
  const target = reviewBlockStepTarget(direction, entries, activeReviewEntryIndex(entries));
  if (!target) {
    return;
  }
  if (Number(target.pageNumber) === Number(state.currentPage)) {
    await selectReviewBlock(target.blockIndex);
    return;
  }
  await goToReviewBlockTarget(target.pageNumber, target.blockIndex);
}

async function selectReviewBlock(blockIndex) {
  const fullKey = normalizeReviewBlockKey(blockIndex);
  if (!fullKey) {
    return;
  }
  const samePage = Number(fullKey.split(":")[0]) === state.currentPage;
  const hadOpenReviewControls = state.reviewActionsOpen.size > 0 || state.reviewCorrectionOpen.size > 0;
  state.reviewExpanded.clear();
  state.reviewExpanded.add(fullKey);
  state.reviewActionsOpen.clear();
  if (!state.reviewCorrectionOpen.has(fullKey)) {
    state.reviewCorrectionOpen.clear();
  }
  state.reviewInitializedPages.add(Number(fullKey.split(":")[0]) || state.currentPage);
  if (samePage && !hadOpenReviewControls && refreshReviewSelectionInPlace(fullKey)) {
    scrollSelectedReviewBlockIntoView();
    schedulePdfFocusSync();
    return;
  }
  if (samePage && refreshRightWorkbenchOnly({ preserveReviewScroll: true })) {
    refreshReviewSelectionInPlace(fullKey);
    scrollSelectedReviewBlockIntoView();
    schedulePdfFocusSync();
    return;
  }
  await renderCurrentPage();
  scrollSelectedReviewBlockIntoView();
  schedulePdfFocusSync();
}

async function toggleReviewBlockActions(blockIndex) {
  const fullKey = normalizeReviewBlockKey(blockIndex);
  if (!fullKey) {
    return;
  }
  state.reviewExpanded.clear();
  state.reviewExpanded.add(fullKey);
  if (state.reviewActionsOpen.has(fullKey)) {
    state.reviewActionsOpen.clear();
    state.reviewCorrectionOpen.clear();
  } else {
    state.reviewActionsOpen.clear();
    state.reviewActionsOpen.add(fullKey);
  }
  if (refreshRightWorkbenchOnly({ preserveReviewScroll: true, preserveReviewAnchorKey: fullKey })) {
    refreshReviewSelectionInPlace(fullKey);
    schedulePdfFocusSync();
    return;
  }
  await renderCurrentPage();
}

async function openReviewCorrectionPanel(blockIndex) {
  const fullKey = normalizeReviewBlockKey(blockIndex);
  if (!fullKey) {
    return;
  }
  state.reviewExpanded.clear();
  state.reviewExpanded.add(fullKey);
  state.reviewActionsOpen.clear();
  state.reviewActionsOpen.add(fullKey);
  state.reviewCorrectionOpen.clear();
  state.reviewCorrectionOpen.add(fullKey);
  if (refreshRightWorkbenchOnly({ preserveReviewScroll: true, preserveReviewAnchorKey: fullKey })) {
    refreshReviewSelectionInPlace(fullKey);
    schedulePdfFocusSync();
    return;
  }
  await renderCurrentPage();
  schedulePdfFocusSync();
}

async function toggleReviewCorrectionPanel(blockIndex) {
  const fullKey = normalizeReviewBlockKey(blockIndex);
  if (!fullKey) {
    return;
  }
  state.reviewExpanded.clear();
  state.reviewExpanded.add(fullKey);
  state.reviewActionsOpen.clear();
  state.reviewActionsOpen.add(fullKey);
  if (state.reviewCorrectionOpen.has(fullKey)) {
    state.reviewCorrectionOpen.clear();
  } else {
    state.reviewCorrectionOpen.clear();
    state.reviewCorrectionOpen.add(fullKey);
  }
  if (refreshRightWorkbenchOnly({ preserveReviewScroll: true, preserveReviewAnchorKey: fullKey })) {
    refreshReviewSelectionInPlace(fullKey);
    schedulePdfFocusSync();
    return;
  }
  await renderCurrentPage();
  scrollSelectedReviewBlockIntoView();
  schedulePdfFocusSync();
}

async function toggleReviewNeedsCorrection(blockIndex) {
  const fullKey = normalizeReviewBlockKey(blockIndex);
  if (!fullKey) {
    return;
  }
  if (state.reviewNeedsCorrection.has(fullKey)) {
    state.reviewNeedsCorrection.delete(fullKey);
  } else {
    state.reviewNeedsCorrection.add(fullKey);
  }
  saveOcrWorkspaceState();
  if (refreshRightWorkbenchOnly({ preserveReviewScroll: true, preserveReviewAnchorKey: fullKey })) {
    refreshReviewSelectionInPlace(fullKey);
    schedulePdfFocusSync();
    return;
  }
  await renderCurrentPage();
}

function clearReviewNeedsCorrectionForBlock(pageNumber, blockIndex) {
  const fullKey = normalizeReviewBlockKey(blockIndex, pageNumber);
  if (!fullKey || !state.reviewNeedsCorrection.has(fullKey)) {
    return false;
  }
  state.reviewNeedsCorrection.delete(fullKey);
  return true;
}

function refreshRightWorkbenchOnly(options = {}) {
  if (typeof document === "undefined" || !els.pageList) {
    return false;
  }
  const current = els.pageList.querySelector(".right-workbench-card");
  if (!current) {
    return false;
  }
  const scrollState = options.preserveReviewScroll ? captureRightWorkbenchScrollState(current, options.preserveReviewAnchorKey) : null;
  syncLiveReviewDraftsFromEditors(current);
  const next = renderRightWorkbench(state.pageCache.get(state.currentPage) || null);
  current.replaceWith(next);
  typesetMath(next);
  restoreRightWorkbenchScrollState(next, scrollState);
  scheduleRightWorkbenchScrollRestore(next, scrollState);
  scheduleReviewFitScale(next);
  updateAcceptedPatchTopControls();
  return true;
}

function scheduleReviewFitScale(root = document) {
  if (!state.reviewFitToPage || typeof window === "undefined") {
    return false;
  }
  const run = () => applyReviewFitScale(root);
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(run);
  } else {
    setTimeout(run, 0);
  }
  setTimeout(run, 120);
  return true;
}

function applyReviewFitScale(root = document) {
  const scope = root?.querySelector?.(".review-card.is-fit-page") || (root?.matches?.(".review-card.is-fit-page") ? root : null);
  const canvas = scope?.querySelector?.(".review-page-canvas");
  const paper = scope?.querySelector?.(".review-page-paper");
  if (!canvas || !paper) {
    return false;
  }
  canvas.style.setProperty("--review-fit-scale", "1");
  const availableWidth = Math.max(1, canvas.clientWidth - 16);
  const paperWidth = Math.max(1, paper.scrollWidth);
  const scale = Math.max(0.35, Math.min(1, availableWidth / paperWidth));
  canvas.style.setProperty("--review-fit-scale", String(Math.round(scale * 1000) / 1000));
  return true;
}

function syncLiveReviewDraftsFromEditors(root) {
  if (!root?.querySelectorAll) {
    return 0;
  }
  let count = 0;
  root.querySelectorAll("[data-mathpix-edit], [data-mineru-source-edit]").forEach((editor) => {
    if (storeLiveReviewDraftForEditor(editor)) {
      count += 1;
    }
  });
  return count;
}

function captureRightWorkbenchScrollState(current, anchorKey = "") {
  const canvas = current?.querySelector?.(".review-page-canvas") || null;
  const anchor = anchorKey ? reviewBlockElementIn(current, anchorKey) : null;
  const canvasRect = canvas?.getBoundingClientRect?.();
  const anchorRect = anchor?.getBoundingClientRect?.();
  return {
    scrollTop: canvas ? canvas.scrollTop : null,
    scrollLeft: canvas ? canvas.scrollLeft : null,
    anchorKey: String(anchorKey || ""),
    anchorTop: canvasRect && anchorRect ? anchorRect.top - canvasRect.top : null,
    windowX: typeof window !== "undefined" ? window.scrollX : null,
    windowY: typeof window !== "undefined" ? window.scrollY : null,
  };
}

function restoreRightWorkbenchScrollState(next, scrollState) {
  if (!scrollState) {
    return false;
  }
  const canvas = next?.querySelector?.(".review-page-canvas") || null;
  if (canvas && scrollState.scrollTop !== null) {
    canvas.scrollTop = scrollState.scrollTop;
    if (scrollState.scrollLeft !== null) {
      canvas.scrollLeft = scrollState.scrollLeft;
    }
    const anchor = scrollState.anchorKey ? reviewBlockElementIn(next, scrollState.anchorKey) : null;
    const canvasRect = canvas.getBoundingClientRect?.();
    const anchorRect = anchor?.getBoundingClientRect?.();
    if (canvasRect && anchorRect && scrollState.anchorTop !== null) {
      canvas.scrollTop += anchorRect.top - canvasRect.top - scrollState.anchorTop;
    }
  }
  if (typeof window !== "undefined" && typeof window.scrollTo === "function" && scrollState.windowY !== null) {
    window.scrollTo(scrollState.windowX || 0, scrollState.windowY || 0);
  }
  return true;
}

function scheduleRightWorkbenchScrollRestore(next, scrollState) {
  if (!scrollState || typeof window === "undefined") {
    return;
  }
  const restore = () => restoreRightWorkbenchScrollState(next, scrollState);
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(restore);
  }
  if (typeof window.setTimeout === "function") {
    window.setTimeout(restore, 0);
    window.setTimeout(restore, 120);
  }
}

function reviewBlockElementIn(root, fullKey) {
  if (!root || typeof root.querySelectorAll !== "function") {
    return null;
  }
  return Array.from(root.querySelectorAll("[data-review-page-block]")).find((block) => block.dataset?.reviewPageBlock === String(fullKey || "")) || null;
}

function refreshReviewSelectionInPlace(fullKey) {
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") {
    return false;
  }
  const pageBlocks = Array.from(document.querySelectorAll("[data-review-page-block]"));
  if (!pageBlocks.length) {
    return false;
  }
  pageBlocks.forEach((block) => {
    block.classList.toggle("is-selected", block.dataset.reviewPageBlock === fullKey);
  });
  document.querySelectorAll("[data-review-left-hotspot]").forEach((hotspot) => {
    hotspot.classList.toggle("is-selected", hotspot.dataset.reviewLeftHotspot === fullKey);
  });
  const select = document.querySelector("[data-review-block-select]");
  if (select) {
    select.value = String(fullKey).includes(":") ? String(fullKey).split(":").slice(1).join(":") : String(fullKey);
  }
  return true;
}

function normalizeReviewBlockKey(blockIndex, pageNumber = state.currentPage) {
  const key = String(blockIndex || "");
  if (!key) {
    return "";
  }
  return key.includes(":") ? key : reviewBlockKey(pageNumber, key);
}

function reviewEntriesForCurrentPage() {
  return reviewEntriesForPage(state.currentPage);
}

function reviewEntriesForPage(pageNumber) {
  const pageNo = Number(pageNumber) || 1;
  const risks = state.mineruInfo ? analyzeMineruRiskPage(pageNo) : state.riskByPage.get(pageNo) || [];
  return buildReviewEntriesForPage(risks, reviewSegmentsForPage(pageNo), pageNo);
}

function scrollSelectedReviewBlockIntoView() {
  if (typeof document === "undefined" || typeof document.querySelector !== "function") {
    return false;
  }
  const item = document.querySelector(".review-page-block.is-selected, .review-item.is-expanded");
  if (!item) {
    return false;
  }
  const container = item.closest?.(".review-page-canvas, .right-workbench-card") || null;
  const itemRect = item.getBoundingClientRect?.();
  const containerRect = container?.getBoundingClientRect?.();
  if (itemRect && containerRect && itemRect.top >= containerRect.top + 24 && itemRect.bottom <= containerRect.bottom - 24) {
    return true;
  }
  item.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  return Boolean(item);
}

function scrollExpandedReviewItemIntoView() {
  scrollSelectedReviewBlockIntoView();
}

async function jumpToCrossPageBlock(pageNumber, blockIndex) {
  await goToReviewBlockTarget(pageNumber, blockIndex);
}

async function goToReviewBlockTarget(pageNumber, blockIndex) {
  const targetPage = Number(pageNumber);
  if (!Number.isFinite(targetPage) || targetPage < 1) {
    return;
  }
  state.currentPage = Math.max(1, Math.min(targetPage, getReviewPageCount()));
  state.acceptedPatchPreview = null;
  state.reviewActionsOpen.clear();
  state.reviewCorrectionOpen.clear();
  state.reviewExpanded.clear();
  expandOnlyReviewBlock(state.currentPage, String(blockIndex || ""));
  updatePager();
  await renderCurrentPage();
  scrollSelectedReviewBlockIntoView();
  schedulePdfFocusSync();
}

async function applyMathpixBlockEdit(blockIndex, trigger) {
  const blockKey = String(blockIndex || "");
  if (!blockKey) {
    return;
  }
  const editor = findReviewEditorForTrigger(trigger, "[data-mathpix-edit]");
  if (!editor) {
    return;
  }
  const preparedMarkdown = cleanMathpixEditableMarkdown(prepareMathpixMarkdown(editor.value || ""));
  await saveHumanAcceptedBlockEdit(blockKey, preparedMarkdown);
}

async function applyMineruSourceEdit(blockIndex, trigger) {
  const blockKey = String(blockIndex || "");
  if (!blockKey) {
    return;
  }
  const editor = findReviewEditorForTrigger(trigger, "[data-mineru-source-edit]");
  if (!editor) {
    return;
  }
  await saveHumanAcceptedBlockEdit(blockKey, editor.value || "");
}

function findReviewEditorForTrigger(trigger, selector) {
  const detail = trigger?.closest?.(".block-source-detail");
  const detailEditor = detail?.querySelector?.(selector);
  if (detailEditor) {
    return detailEditor;
  }
  return trigger?.closest?.(".review-page-block, .review-item, .selected-block-toolbar, .selected-block-compact-actions")?.querySelector?.(selector) || null;
}

async function autoUnwrapMineruLineBreaksForBlock(blockIndex) {
  const blockKey = String(blockIndex || "");
  if (!blockKey) {
    return;
  }
  const segment = reviewSegmentsForPage(state.currentPage).find((item) => String(item.blockIndex) === blockKey);
  const sourceMarkdown = segment?.markdown || "";
  if (!canAutoUnwrapMineruLineBreaks(sourceMarkdown)) {
    setStatus("该块不适合自动整理换行", "error");
    return;
  }
  const unwrapped = autoUnwrapMineruLineBreaks(sourceMarkdown);
  if (!unwrapped.trim() || unwrapped === String(sourceMarkdown || "").replace(/\r\n?/g, "\n").trim()) {
    setStatus("No linebreak changes", "ok");
    return;
  }
  await saveHumanAcceptedBlockEdit(blockKey, unwrapped);
}

async function autoAddFigureLabelForBlock(blockIndex) {
  const blockKey = String(blockIndex || "");
  if (!blockKey) {
    return;
  }
  const segment = reviewSegmentsForPage(state.currentPage).find((item) => String(item.blockIndex) === blockKey);
  const sourceMarkdown = segment?.markdown || "";
  const label = inferMissingFigureLabelForBlock(state.currentPage, blockKey, sourceMarkdown);
  if (!label) {
    setStatus("没有可推断的图号", "error");
    return;
  }
  await saveHumanAcceptedBlockEdit(blockKey, `${label} ${String(sourceMarkdown || "").trim()}`);
}

async function convertCodeBlockToMarkdownForBlock(blockIndex) {
  const blockKey = String(blockIndex || "");
  if (!blockKey) {
    return;
  }
  const segment = reviewSegmentsForPage(state.currentPage).find((item) => String(item.blockIndex) === blockKey);
  const sourceMarkdown = activeReviewMarkdownForBlock(state.currentPage, blockKey, segment);
  const converted = convertCodeLikeMarkdownToPlainMarkdown(sourceMarkdown);
  if (!converted.trim() || converted === String(sourceMarkdown || "").replace(/\r\n?/g, "\n").trim()) {
    setStatus("该块不适合转换为普通文本", "error");
    return;
  }
  await saveHumanAcceptedBlockEdit(blockKey, converted);
}

async function structureFormulaBlock(blockIndex) {
  const blockKey = String(blockIndex || "");
  if (!blockKey) {
    return;
  }
  const segment = reviewSegmentsForPage(state.currentPage).find((item) => String(item.blockIndex) === blockKey);
  const sourceMarkdown = activeReviewMarkdownForBlock(state.currentPage, blockKey, segment);
  const structured = cleanMathpixEditableMarkdown(sourceMarkdown);
  if (!structured.trim() || structured === String(sourceMarkdown || "").replace(/\r\n?/g, "\n").trim()) {
    setStatus("该公式块暂无可自动结构化的修改", "error");
    return;
  }
  await saveHumanAcceptedBlockEdit(blockKey, structured);
}

async function discardMathpixCorrectionForBlock(blockIndex) {
  const blockKey = String(blockIndex || "");
  if (!blockKey) {
    return;
  }
  const segment = reviewSegmentsForPage(state.currentPage).find((item) => String(item.blockIndex) === blockKey);
  const latestPatch = getLatestOcrPatchForBlock(state.currentPage, blockKey, segment?.markdown || "");
  if (latestPatch?.source === "mathpix" && latestPatch.status === "draft") {
    updateOcrPatchStatus(latestPatch.patchId, "rejected");
  }
  getMathpixBlockDrafts(state.currentPage, false).delete(blockKey);
  clearLiveReviewDraftForBlock(state.currentPage, blockKey);
  clearMathpixBlockError(state.currentPage, blockKey);
  state.acceptedPatchPreview = null;
  state.acceptedPatchBookPreview = null;
  saveOcrWorkspaceState();
  expandOnlyReviewBlock(state.currentPage, blockKey);
  updateCorrectionSummary();
  setStatus("Mathpix 修改已撤销", "ok");
  await renderCurrentPage();
}

function activeReviewMarkdownForBlock(pageNumber, blockKey, segment = null) {
  const pageNo = Number(pageNumber) || state.currentPage;
  const key = String(blockKey || "");
  const sourceSegment = segment || reviewSegmentsForPage(pageNo).find((item) => String(item.blockIndex) === key) || null;
  return reviewCorrectionStateForSegment(pageNo, key, sourceSegment, sourceSegment?.markdown || "").correctionView.displayMarkdown;
}

function applyAutomaticLocalCorrectionsForPage(pageNumber) {
  const pageNo = Number(pageNumber) || 0;
  if (!pageNo || !state.mineruInfo) {
    return 0;
  }
  const blockOverrides = getBlockOverrides(pageNo, false);
  const mathpixDrafts = getMathpixBlockDrafts(pageNo, false);
  let changedCount = 0;
  reviewSegmentsForPage(pageNo).forEach((segment) => {
    const blockKey = String(segment.blockIndex || "");
    const sourceMarkdown = String(segment.markdown || "");
    if (!blockKey) {
      return;
    }
    const existingPatch = getLatestOcrPatchForBlock(pageNo, blockKey, sourceMarkdown);
    const existingAutoCorrection = String(existingPatch?.metadata?.autoCorrection || "");
    if (existingPatch?.status === "draft") {
      return;
    }
    const activeMarkdown = mathpixDrafts.get(blockKey) || blockOverrides.get(blockKey) || reviewPatchMarkdown(existingPatch) || sourceMarkdown;
    if (isManualAcceptedOcrPatch(existingPatch)) {
      const knownManualEquationMarkdown = autoCorrectKnownEquationOcrMarkdown(activeMarkdown);
      if (knownManualEquationMarkdown && knownManualEquationMarkdown !== activeMarkdown.replace(/\r\n?/g, "\n").trim()) {
        if (saveAutomaticAcceptedBlockPatch(pageNo, blockKey, sourceMarkdown, knownManualEquationMarkdown, "known_equation_ocr_cleanup")) {
          changedCount += 1;
        }
      }
      return;
    }
    const numberedMarkdown = autoCorrectMathEquationNumberMarkdown(pageNo, blockKey, activeMarkdown, segment);
    if (numberedMarkdown && numberedMarkdown !== activeMarkdown.replace(/\r\n?/g, "\n").trim()) {
      const correctedNumberedMarkdown = autoCorrectKnownEquationOcrMarkdown(numberedMarkdown);
      if (saveAutomaticAcceptedBlockPatch(pageNo, blockKey, sourceMarkdown, correctedNumberedMarkdown, "equation_number_preservation")) {
        changedCount += 1;
      }
      return;
    }
    const knownEquationMarkdown = autoCorrectKnownEquationOcrMarkdown(activeMarkdown);
    if (knownEquationMarkdown && knownEquationMarkdown !== activeMarkdown.replace(/\r\n?/g, "\n").trim()) {
      if (saveAutomaticAcceptedBlockPatch(pageNo, blockKey, sourceMarkdown, knownEquationMarkdown, "known_equation_ocr_cleanup")) {
        changedCount += 1;
      }
      return;
    }
    const captionLabelMarkdown = autoCorrectFigureCaptionLabelMarkdown(pageNo, blockKey, activeMarkdown);
    if (captionLabelMarkdown && captionLabelMarkdown !== activeMarkdown.replace(/\r\n?/g, "\n").trim()) {
      if (saveAutomaticAcceptedBlockPatch(pageNo, blockKey, sourceMarkdown, captionLabelMarkdown, "figure_caption_label_preservation")) {
        changedCount += 1;
      }
      return;
    }
    const canRefreshPlainCleanup =
      !existingPatch ||
      existingPatch.status !== "accepted" ||
      existingAutoCorrection === "plain_text_cleanup";
    if (!canRefreshPlainCleanup) {
      return;
    }
    const plainSourceMarkdown = existingAutoCorrection === "plain_text_cleanup" ? activeMarkdown : sourceMarkdown;
    const correctedMarkdown = autoCorrectPlainMineruMarkdown(plainSourceMarkdown);
    if (!correctedMarkdown || correctedMarkdown === plainSourceMarkdown.replace(/\r\n?/g, "\n").trim()) {
      return;
    }
    if (saveAutomaticAcceptedBlockPatch(pageNo, blockKey, sourceMarkdown, correctedMarkdown, "plain_text_cleanup")) {
      changedCount += 1;
    }
  });
  if (changedCount) {
    state.acceptedPatchPreview = null;
    state.acceptedPatchBookPreview = null;
    updateCorrectionSummary();
  }
  return changedCount;
}

function isManualAcceptedOcrPatch(patch) {
  return Boolean(patch?.status === "accepted" && patch?.source === "human" && !String(patch?.metadata?.autoCorrection || ""));
}

function saveAutomaticAcceptedBlockPatch(pageNo, blockKey, oldMarkdown, newMarkdown, autoCorrection = "plain_text_cleanup") {
  const patchResult = createAndStoreDraftOcrPatch({
    pageNo,
    blockIndex: blockKey,
    oldText: oldMarkdown,
    newText: newMarkdown,
    source: "human",
  });
  const patch = patchResult.patch;
  if (!patch) {
    return false;
  }
  patch.metadata = {
    ...(patch.metadata || {}),
    autoCorrection,
  };
  if (patch.status === "draft") {
    rejectPriorOcrPatchesForBlock(patch.blockId, patch.patchId);
    updateOcrPatchStatus(patch.patchId, "accepted");
  }
  getMathpixBlockDrafts(pageNo).delete(String(blockKey));
  getBlockOverrides(pageNo).set(String(blockKey), patchResult.normalizedText);
  clearReviewNeedsCorrectionForBlock(pageNo, blockKey);
  saveOcrWorkspaceState();
  return true;
}

function autoCorrectMathEquationNumberMarkdown(pageNo, blockKey, sourceMarkdown, segment = null) {
  const source = String(sourceMarkdown || "").replace(/\r\n?/g, "\n").trim();
  if (!source) {
    return "";
  }
  if (!hasDisplayMathBlock(source) && !hasLatexMathEnvironment(source)) {
    return "";
  }
  const risk = reviewRiskForBlock(pageNo, blockKey) || reviewRiskFromSegment(segment, pageNo);
  const nearbyNumbers = nearbyEquationNumberTextForBlock(pageNo, blockKey, segment, risk);
  if (!nearbyNumbers.trim()) {
    return "";
  }
  const taggedSource = replaceGeneratedEquationTagsWithOriginal(source, nearbyNumbers);
  if (taggedSource !== source) {
    return taggedSource;
  }
  if (extractLatexTags(source).length) {
    return "";
  }
  const corrected = preserveEquationNumbersFromOriginal(nearbyNumbers, source);
  return corrected !== source ? corrected : "";
}

function autoCorrectKnownEquationOcrMarkdown(markdown) {
  const source = String(markdown || "").replace(/\r\n?/g, "\n").trim();
  if (!source) {
    return source;
  }
  let output = autoCorrectKnownScalarWaveBoxMarkdown(source);
  output = autoCorrectKnownScalarWaveNVectorMarkdown(output);
  return output.trim();
}

function autoCorrectKnownScalarWaveBoxMarkdown(markdown) {
  return String(markdown || "")
    .replace(
      /□\s*Ψ\s*=\s*[-−]\s*8\s*π\s*ζ\s*ρ\s*\*\s*\(\s*1\s*-\s*2\s*s\s*\)/g,
      "$\\Box\\Psi = -8\\pi\\zeta\\rho^{*}(1 - 2s)$",
    )
    .replace(
      /\\sqcup\s*\\Psi\s*=\s*[-−]\s*8\s*\\pi\s*\\zeta\s*\\rho\s*(?:\^\s*(?:\{\s*\*\s*\}|\*))?\s*\(\s*1\s*-\s*2\s*s\s*\)/g,
      "\\Box\\Psi = -8\\pi\\zeta\\rho^{*}(1 - 2s)",
    );
}

function autoCorrectKnownScalarWaveNVectorMarkdown(markdown) {
  const source = String(markdown || "");
  if (!hasKnownScalarWaveNVectorTarget(source) || !isKnownScalarWaveNVectorEquation(source)) {
    return source;
  }
  return source
    .replace(/\{\s*\\+(?:mathcal|mathscr|mathfrak|cal)\s*\{\s*(?:\\mathrm\s*\{\s*)?N\s*\}?\s*\}\s*\}/g, "N")
    .replace(/\{\s*\\+(?:mathcal|mathscr|mathfrak|cal)\s+N\s*\}/g, "N")
    .replace(/\{\s*\\+(?:mathcal|mathscr|mathfrak|cal)N\s*\}/g, "N")
    .replace(/\\+(?:mathcal|mathscr|mathfrak|cal)\s*\{\s*(?:\\mathrm\s*\{\s*)?N\s*\}?\s*\}/g, "N")
    .replace(/\\+(?:mathcal|mathscr|mathfrak|cal)\s+N\b/g, "N")
    .replace(/\\+(?:mathcal|mathscr|mathfrak|cal)N\b/g, "N")
    .replace(/[𝓝𝒩𝑁]/gu, "N");
}

function hasKnownScalarWaveNVectorTarget(markdown) {
  return /(?:\\+(?:mathcal|mathscr|mathfrak|cal)\s*\{\s*(?:\\mathrm\s*\{\s*)?N\s*\}?\s*\}|\\+(?:mathcal|mathscr|mathfrak|cal)\s+N\b|\\+(?:mathcal|mathscr|mathfrak|cal)N\b|[𝓝𝒩𝑁]|(^|[^\\A-Za-z])N\s*(?=(?:\\cdot|[·⋅])\s*(?:v|\\nu|ν)))/u.test(String(markdown || ""));
}

function isKnownScalarWaveNVectorEquation(markdown) {
  const source = String(markdown || "");
  if (/\\tag\{11\.11[34]\}|\(\s*11\.11[34]\s*\)/.test(source)) {
    return true;
  }
  const compact = source.replace(/\s+/g, "");
  if (!/(?:\\Psi|Ψ)=/.test(compact)) {
    return false;
  }
  if (/\\sum_?\{?a\}?/.test(compact) && /1-2s/.test(compact)) {
    return true;
  }
  return /(?:\\zeta|ζ)/.test(compact) &&
    /(?:\\eta|η)/.test(compact) &&
    /s_?\{?2\}?-s_?\{?1\}?/.test(compact) &&
    /(?:\\cdot|[·⋅])v/.test(compact);
}

function autoCorrectFigureCaptionLabelMarkdown(pageNo, blockKey, sourceMarkdown) {
  const source = String(sourceMarkdown || "").replace(/\r\n?/g, "\n").trim();
  if (!source || extractReferenceLabels(source).some((label) => /^fig(?:\.|ure)?/i.test(label))) {
    return "";
  }
  if (!looksLikeFigureCaptionText(source)) {
    return "";
  }
  const label = inferMissingFigureLabelForBlock(pageNo, blockKey, source);
  return label ? `${label} ${source}`.trim() : "";
}

function hasEquationNumberAutoCorrection(oldMarkdown, newMarkdown) {
  return !extractLatexTags(oldMarkdown).length && extractLatexTags(newMarkdown).length;
}

function preservationTextForBlock(pageNumber, blockIndex, segment = null, risk = null) {
  const pageNo = Number(pageNumber) || state.currentPage;
  const blockKey = String(blockIndex || "");
  const sourceSegment = segment || reviewSegmentsForPage(pageNo).find((item) => String(item.blockIndex) === blockKey) || null;
  const sourceRisk = risk || reviewRiskForBlock(pageNo, blockKey) || null;
  const latestPatch = getLatestOcrPatchForBlock(pageNo, blockKey, sourceSegment?.markdown || sourceRisk?.text || "");
  const blockOverrides = getBlockOverrides(pageNo, false);
  const parts = [
    sourceSegment?.markdown || "",
    sourceRisk?.text || "",
    blockOverrides.get(blockKey) || "",
    reviewPatchMarkdown(latestPatch),
    nearbyEquationNumberTextForBlock(pageNo, blockKey, sourceSegment, sourceRisk),
  ];
  return Array.from(new Set(parts.map((part) => String(part || "").trim()).filter(Boolean))).join("\n\n");
}

function nearbyEquationNumberTextForBlock(pageNumber, blockIndex, segment = null, risk = null) {
  const blockKey = String(blockIndex || "");
  const currentIndex = Number(blockKey);
  const currentSegment = segment || reviewSegmentsForPage(pageNumber).find((item) => String(item.blockIndex) === blockKey) || null;
  if (!Number.isFinite(currentIndex) && !currentSegment?.bbox) {
    return "";
  }
  const sourceText = `${segment?.markdown || ""}\n${risk?.text || ""}`;
  const looksFormulaLike =
    hasLatexMathEnvironment(sourceText) ||
    /(?:\$\$|\\\[|\\\])/.test(sourceText) ||
    (Array.isArray(risk?.reasons) && risk.reasons.some((reason) => /math|formula|equation/i.test(reason)));
  if (!looksFormulaLike) {
    return "";
  }
  const segments = reviewSegmentsForPage(pageNumber);
  const pageSize = currentSegment?.pageSize || risk?.pageSize;
  const nearbyByIndex = segments
    .map((item) => {
      const index = Number(item.blockIndex);
      if (String(item.blockIndex) === blockKey) {
        return null;
      }
      if (!Number.isFinite(index) || !Number.isFinite(currentIndex)) {
        return null;
      }
      const distance = Math.abs(index - currentIndex);
      if (distance > 4) {
        return null;
      }
      const text = String(item.markdown || "").trim();
      if (!isEquationNumberOnlyText(text) && !/^\\tag\{[^}]+\}$/.test(text)) {
        return null;
      }
      return { text, distance };
    })
    .filter(Boolean)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 1)
    .map((item) => item.text);
  const bboxMatchedFromReviewSegments = nearestEquationNumberSegmentsByBBox(
    segments,
    currentSegment?.bbox || risk?.bbox,
    currentSegment?.pageSize || risk?.pageSize,
    blockKey,
  ).map((item) => String(item.markdown || "").trim());
  if (bboxMatchedFromReviewSegments.length) {
    return Array.from(new Set(bboxMatchedFromReviewSegments)).join("\n");
  }
  const fallbackNumberSourceSegments = contentListEquationNumberSegmentsForPage(pageNumber, pageSize).concat(
    pdfTextEquationNumberSegmentsForPage(pageNumber, pageSize),
  );
  const bboxMatchedFromFallbackSources = nearestEquationNumberSegmentsByBBox(
    fallbackNumberSourceSegments,
    currentSegment?.bbox || risk?.bbox,
    currentSegment?.pageSize || risk?.pageSize,
    blockKey,
  ).map((item) => String(item.markdown || "").trim());
  if (bboxMatchedFromFallbackSources.length) {
    return Array.from(new Set(bboxMatchedFromFallbackSources)).join("\n");
  }
  return Array.from(new Set(nearbyByIndex)).join("\n");
}

function contentListEquationNumberSegmentsForPage(pageNumber, fallbackPageSize = null) {
  const items = contentListItemsForPage(pageNumber);
  if (!items.length) {
    return [];
  }
  const pageSize = inferContentListPageSize(pageNumber, items) || fallbackPageSize;
  return items
    .map((item) => {
      const text = contentListItemText(item);
      if (!isEquationNumberOnlyText(text) && !/^\\tag\{[^}]+\}$/.test(String(text || "").trim())) {
        return null;
      }
      const bbox = normalizedBBox(item.bbox);
      if (!bbox) {
        return null;
      }
      return {
        blockIndex: `content-list-equation-number-${item.__contentListIndex ?? ""}`,
        markdown: text,
        bbox,
        pageSize,
      };
    })
    .filter(Boolean);
}

function pdfTextEquationNumberSegmentsForPage(pageNumber, targetPageSize = null) {
  const textBlocks = pdfTextBlocksForPage(pageNumber);
  if (!textBlocks.length) {
    return [];
  }
  const sourcePageSize = pdfTextPageSizeForPage(pageNumber);
  const pageWidth = pageSizeWidth(targetPageSize) || pageSizeWidth(sourcePageSize) || 1;
  return textBlocks.flatMap((block, index) => {
    const numbers = extractEquationNumbers(block?.text);
    if (!numbers.length) {
      return [];
    }
    const sourceBBox = normalizedBBox(block?.bbox);
    if (!sourceBBox) {
      return [];
    }
    const scaledBBox = scaleBBoxBetweenPageSizes(sourceBBox, sourcePageSize, targetPageSize);
    const rightWidth = Math.max(34, Math.min(scaledBBox[2] - scaledBBox[0], pageWidth * 0.16));
    const numberBBox = [
      Math.max(scaledBBox[0], scaledBBox[2] - rightWidth),
      scaledBBox[1],
      scaledBBox[2],
      scaledBBox[3],
    ];
    return numbers.map((number, numberIndex) => ({
      blockIndex: `pdf-text-equation-number-${pageNumber}-${index}-${numberIndex}`,
      markdown: number,
      bbox: numberBBox,
      pageSize: targetPageSize || sourcePageSize,
      source: "pdf_text",
    }));
  });
}

function scaleBBoxBetweenPageSizes(bbox, sourcePageSize = null, targetPageSize = null) {
  const normalized = normalizedBBox(bbox);
  if (!normalized) {
    return null;
  }
  const sourceWidth = pageSizeWidth(sourcePageSize);
  const sourceHeight = pageSizeHeight(sourcePageSize);
  const targetWidth = pageSizeWidth(targetPageSize);
  const targetHeight = pageSizeHeight(targetPageSize);
  if (!sourceWidth || !sourceHeight || !targetWidth || !targetHeight) {
    return normalized;
  }
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;
  return [normalized[0] * scaleX, normalized[1] * scaleY, normalized[2] * scaleX, normalized[3] * scaleY];
}

function isEquationNumberOnlyText(text) {
  return /^\(?\s*\d+(?:\s*\.\s*\d+)+[a-zA-Z]?\s*\)?$/.test(String(text || "").trim());
}

function bboxesLikelyShareEquationRow(leftBBox, rightBBox, pageSize) {
  const left = normalizedBBox(leftBBox);
  const right = normalizedBBox(rightBBox);
  if (!left || !right) {
    return false;
  }
  const pageHeight = pageSizeHeight(pageSize) || Math.max(left[3], right[3], 1);
  const leftCenterY = (left[1] + left[3]) / 2;
  const rightCenterY = (right[1] + right[3]) / 2;
  const verticalDistance = Math.abs(leftCenterY - rightCenterY);
  const verticalTolerance = Math.max(18, pageHeight * 0.018, Math.min(left[3] - left[1], right[3] - right[1]) * 0.75);
  const isRightSideNumber = right[0] >= left[0] && right[2] >= left[2] - 8;
  return isRightSideNumber && verticalDistance <= verticalTolerance;
}

function nearestEquationNumberSegmentsByBBox(segments, formulaBBox, pageSize, blockKey = "") {
  const formula = normalizedBBox(formulaBBox);
  if (!formula) {
    return [];
  }
  const pageWidth = pageSizeWidth(pageSize) || Math.max(formula[2], 1);
  const pageHeight = pageSizeHeight(pageSize) || Math.max(formula[3], 1);
  const formulaCenterY = (formula[1] + formula[3]) / 2;
  const formulaHeight = Math.max(1, formula[3] - formula[1]);
  return segments
    .map((item) => {
      if (String(item.blockIndex) === String(blockKey)) {
        return null;
      }
      const text = String(item.markdown || "").trim();
      if (!isEquationNumberOnlyText(text) && !/^\\tag\{[^}]+\}$/.test(text)) {
        return null;
      }
      const bbox = normalizedBBox(item.bbox);
      if (!bbox) {
        return null;
      }
      const centerY = (bbox[1] + bbox[3]) / 2;
      const verticalDistance = Math.abs(centerY - formulaCenterY);
      const rightGap = bbox[0] - formula[2];
      const overlapsRightSide = bbox[0] >= formula[0] && bbox[2] >= formula[2] - Math.max(12, pageWidth * 0.015);
      const verticalTolerance = Math.max(28, pageHeight * 0.045, formulaHeight * 1.4);
      if (!overlapsRightSide || verticalDistance > verticalTolerance) {
        return null;
      }
      return {
        item,
        score: verticalDistance + Math.max(0, rightGap) * 0.15,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.score - right.score)
    .slice(0, 1)
    .map((entry) => entry.item);
}

function autoCorrectPlainMineruMarkdown(markdown) {
  if (!canAutoCorrectPlainMineruMarkdown(markdown)) {
    return String(markdown || "").replace(/\r\n?/g, "\n").trim();
  }
  const source = String(markdown || "").replace(/\r\n?/g, "\n");
  const lineAdjusted = source.includes("\n") ? normalizeEditableProseLineBreaksOutsideStructuredBlocks(source) : source.trim();
  return normalizeInlineMathSpacing(lineAdjusted).trim();
}

function canAutoCorrectPlainMineruMarkdown(markdown) {
  const text = String(markdown || "").replace(/\r\n?/g, "\n");
  if (!text.trim()) {
    return false;
  }
  if (
    hasMarkdownImageReference(text) ||
    hasLatexMathEnvironment(text) ||
    /(^|\n)\s*(?:\$\$|\\\[|\\\])\s*(?:\n|$)/.test(text) ||
    /(^|\n)\s*```/.test(text) ||
    /<\s*(?:table|tr|td|th)\b/i.test(text)
  ) {
    return false;
  }
  if (isLikelyBibliographyText(text)) {
    return false;
  }
  if (hasUnwrappedScientificMathSymbolRisk(text)) {
    return false;
  }
  const lines = text.split("\n");
  return !lines.some((line) => isLikelyMarkdownTableLine(line) || /^#{1,6}\s+/.test(line.trim()) || /^\s*[-*+]\s+/.test(line));
}

function hasUnwrappedScientificMathSymbolRisk(markdown) {
  const text = stripInlineMathSpans(String(markdown || ""))
    .replace(/\\[a-zA-Z]+(?:\s*\{[^}]*\})?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return false;
  }
  return /[□∂∑∫√∞≈≠≤≥±×÷]|[Α-Ωα-ωµμ]/.test(text) && /[A-Za-z]/.test(text);
}

function stripInlineMathSpans(markdown) {
  return String(markdown || "")
    .replace(/\$[^$\n]*\$/g, " ")
    .replace(/\\\([\s\S]*?\\\)/g, " ");
}

function normalizeInlineMathSpacing(markdown) {
  const text = repairUnclosedInlineMathBeforeReference(String(markdown || ""));
  let output = "";
  let inInlineMath = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1] || "";
    if (char !== "$" || isEscapedDollar(text, index)) {
      output += char;
      continue;
    }
    if (next === "$") {
      output += "$$";
      index += 1;
      continue;
    }
    if (!inInlineMath && output && !/\s/.test(output[output.length - 1])) {
      output += " ";
    }
    output += "$";
    inInlineMath = !inInlineMath;
    if (!inInlineMath && next && shouldAddSpaceAfterInlineMath(next)) {
      output += " ";
    }
  }
  return normalizeReferenceSpacing(output.replace(/[ \t]{2,}/g, " "));
}

function repairUnclosedInlineMathBeforeReference(line) {
  const text = String(line || "");
  if (!hasOddSingleDollarCount(text)) {
    return text;
  }
  const lastDollarIndex = lastSingleDollarIndex(text);
  if (lastDollarIndex < 0) {
    return text;
  }
  const tail = text.slice(lastDollarIndex + 1);
  const referenceMatch = tail.match(/\s*\[?\s*(?:see\s*)?(?:Eq\.?|Equation|Fig\.?|Figure|Table)\s*\.?\s*\(?\d+(?:\.\d+)*[a-zA-Z]?\)?/i);
  if (!referenceMatch || referenceMatch.index == null || referenceMatch.index <= 0) {
    return text;
  }
  const insertAt = lastDollarIndex + 1 + referenceMatch.index;
  const before = text.slice(0, insertAt).replace(/[ \t]+$/, "");
  const after = text.slice(insertAt).replace(/^[ \t]*/, "");
  return `${before}$ ${after}`;
}

function hasOddSingleDollarCount(text) {
  let count = 0;
  for (let index = 0; index < String(text || "").length; index += 1) {
    if (isSingleUnescapedDollar(text, index)) {
      count += 1;
    }
  }
  return count % 2 === 1;
}

function lastSingleDollarIndex(text) {
  for (let index = String(text || "").length - 1; index >= 0; index -= 1) {
    if (isSingleUnescapedDollar(text, index)) {
      return index;
    }
  }
  return -1;
}

function isSingleUnescapedDollar(text, index) {
  const value = String(text || "");
  return value[index] === "$" && value[index - 1] !== "$" && value[index + 1] !== "$" && !isEscapedDollar(value, index);
}

function isEscapedDollar(text, index) {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

function shouldAddSpaceAfterInlineMath(nextChar) {
  return Boolean(nextChar) && !/\s|[,.;:!?，。；：！？)\}]/.test(nextChar);
}

function normalizeReferenceSpacing(text) {
  return String(text || "")
    .replace(/\$\s*\[/g, "$ [")
    .replace(/\bsee\s*Eq\./gi, (match) => (match[0] === "S" ? "See Eq." : "see Eq."))
    .replace(/\bsee\s+Eq\.\s*\(/gi, (match) => (match[0] === "S" ? "See Eq. (" : "see Eq. ("))
    .replace(/\[\s*(see|See)\s+Eq\.\s*/g, "[$1 Eq. ")
    .replace(/\]\s*,\s*(?=[A-Za-z])/g, "], ");
}

function inferMissingFigureLabelForBlock(pageNumber, blockIndex, markdown) {
  const text = String(markdown || "").replace(/\s+/g, " ").trim();
  if (!text || extractReferenceLabels(text).some((label) => /^fig(?:\.|ure)?/i.test(label))) {
    return "";
  }
  const contentListLabel = inferMissingFigureLabelFromContentList(pageNumber, text);
  if (contentListLabel) {
    return contentListLabel;
  }
  const visualTextLabel = inferMissingFigureLabelFromVisualText(pageNumber, blockIndex);
  if (visualTextLabel) {
    return visualTextLabel;
  }
  if (!looksLikeFigureCaptionText(text)) {
    return "";
  }
  const nearbyText = nearbyBlockTextForReferenceInference(pageNumber, blockIndex);
  const labels = extractReferenceLabels(nearbyText).filter((label) => /^fig(?:\.|ure)?/i.test(label));
  const label = labels[0] || "";
  if (!label) {
    return "";
  }
  return label.replace(/^Figure\b/i, "Fig.").replace(/^Fig\b(?!\.)/i, "Fig.");
}

function looksLikeFigureCaptionText(text) {
  const value = String(text || "");
  if (value.length < 24 || value.length > 1200) {
    return false;
  }
  if (/^(the|this|these|those)\b/i.test(value)) {
    return false;
  }
  if (startsLikeNarrativeProse(value)) {
    return false;
  }
  const strongSignals = [
    /\b(?:showing|shows|shown|plotted|illustrates|selected)\b/i,
    /\b(?:figure|diagram|plot|curve|graph|panel)\b/i,
    /\b(?:grey|gray|light|dark|shaded)\s+(?:region|band|area)\b/i,
    /\b(?:bounds?|limits?)\s+on\b/i,
    /\b(?:x-axis|y-axis|axis|axes|horizontal|vertical)\b/i,
    /\b(?:image|reproduced|permission|copyright)\b/i,
  ];
  const signalCount = strongSignals.filter((pattern) => pattern.test(value)).length;
  if (signalCount >= 2) {
    return true;
  }
  return signalCount >= 1 && /\b(?:ratio|experiment|experiments|measurement|measurements|data)\b/i.test(value);
}

function inferMissingFigureLabelFromContentList(pageNumber, markdownText) {
  const target = stripReferenceLabelsFromText(markdownText);
  const targetCanon = canonicalTextForOverlap(target);
  if (!targetCanon || targetCanon.length < 24) {
    return "";
  }
  const candidates = contentListItemsForPage(pageNumber)
    .filter((item) => Array.isArray(item.img_caption) || String(item.type || "").toLowerCase().includes("image"))
    .map((item) => contentListItemText(item))
    .filter(Boolean);
  for (const caption of candidates) {
    const labels = extractReferenceLabels(caption).filter((label) => /^fig(?:\.|ure)?/i.test(label));
    if (!labels.length) {
      continue;
    }
    const captionCanon = canonicalTextForOverlap(stripReferenceLabelsFromText(caption));
    if (!captionCanon) {
      continue;
    }
    if (captionCanon.includes(targetCanon) || targetCanon.includes(captionCanon) || textOverlapRatio(targetCanon, captionCanon) >= 0.62) {
      return labels[0].replace(/^Figure\b/i, "Fig.").replace(/^Fig\b(?!\.)/i, "Fig.");
    }
  }
  return "";
}

function inferMissingFigureLabelFromVisualText(pageNumber, blockIndex) {
  const currentIndex = String(blockIndex);
  const segment = reviewSegmentsForPage(pageNumber).find((item) => String(item.blockIndex) === currentIndex);
  const targetBBox = normalizedBBox(segment?.bbox);
  if (!targetBBox) {
    return "";
  }
  const targetPageSize = segment?.pageSize || state.mineruInfo?.pdf_info?.[Number(pageNumber) - 1]?.page_size || null;
  const contentListCandidates = contentListItemsForPage(pageNumber).map((item) => ({
    text: contentListItemText(item),
    bbox: normalizedBBox(item.bbox),
    pageSize: targetPageSize,
    source: "content_list",
  }));
  const pdfPageSize = pdfTextPageSizeForPage(pageNumber);
  const pdfCandidates = pdfTextBlocksForPage(pageNumber).map((block) => ({
    text: String(block?.text || "").trim(),
    bbox: scaleBBoxBetweenPageSizes(block?.bbox, pdfPageSize, targetPageSize),
    pageSize: targetPageSize || pdfPageSize,
    source: "pdf_text",
  }));
  return contentListCandidates
    .concat(pdfCandidates)
    .map((candidate) => {
      const labels = extractReferenceLabels(candidate.text).filter((label) => /^fig(?:\.|ure)?/i.test(label));
      if (!labels.length || !candidate.bbox || !isFigureLabelOnlyText(candidate.text)) {
        return null;
      }
      const score = figureLabelProximityScore(targetBBox, candidate.bbox, candidate.pageSize);
      return score > 0 ? { label: labels[0].replace(/^Figure\b/i, "Fig.").replace(/^Fig\b(?!\.)/i, "Fig."), score } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)[0]?.label || "";
}

function isFigureLabelOnlyText(text) {
  const value = String(text || "").trim();
  if (!value) {
    return false;
  }
  const labels = extractReferenceLabels(value).filter((label) => /^fig(?:\.|ure)?/i.test(label));
  if (!labels.length) {
    return false;
  }
  return stripReferenceLabelsFromText(value).replace(/[^\p{L}\p{N}]+/gu, "").length === 0;
}

function figureLabelProximityScore(targetBBox, labelBBox, pageSize) {
  const target = normalizedBBox(targetBBox);
  const label = normalizedBBox(labelBBox);
  if (!target || !label) {
    return 0;
  }
  const pageWidth = pageSizeWidth(pageSize) || Math.max(target[2], label[2], 1);
  const pageHeight = pageSizeHeight(pageSize) || Math.max(target[3], label[3], 1);
  const targetHeight = Math.max(1, target[3] - target[1]);
  const labelHeight = Math.max(1, label[3] - label[1]);
  const targetCenterX = (target[0] + target[2]) / 2;
  const targetCenterY = (target[1] + target[3]) / 2;
  const labelCenterX = (label[0] + label[2]) / 2;
  const labelCenterY = (label[1] + label[3]) / 2;
  const verticalOverlap = Math.max(0, Math.min(target[3], label[3]) - Math.max(target[1], label[1]));
  const verticalDistance = Math.abs(targetCenterY - labelCenterY);
  const sameCaptionRow = verticalOverlap > 0 || verticalDistance <= Math.max(28, targetHeight * 0.45, labelHeight * 1.8);
  if (!sameCaptionRow) {
    return 0;
  }
  const labelLeadsCaption = labelCenterX <= targetCenterX - pageWidth * 0.08 || label[2] <= target[0] + pageWidth * 0.2;
  if (!labelLeadsCaption) {
    return 0;
  }
  const outsideGap = Math.max(0, target[0] - label[2]);
  if (outsideGap > pageWidth * 0.28) {
    return 0;
  }
  const verticalScore = 1 - Math.min(verticalDistance / Math.max(pageHeight * 0.08, 1), 1);
  const horizontalScore = 1 - Math.min(outsideGap / Math.max(pageWidth * 0.28, 1), 1);
  return verticalScore * 0.7 + horizontalScore * 0.3;
}

function stripReferenceLabelsFromText(text) {
  return String(text || "").replace(/\b(?:Fig\.?|Figure|Table|Eq\.?|Equation)\s*\(?\d+(?:\.\d+)*[a-zA-Z]?\)?/gi, " ");
}

function textOverlapRatio(left, right) {
  const leftWords = new Set(String(left || "").split(/\s+/).filter((word) => word.length >= 3));
  const rightWords = new Set(String(right || "").split(/\s+/).filter((word) => word.length >= 3));
  if (!leftWords.size || !rightWords.size) {
    return 0;
  }
  let overlap = 0;
  leftWords.forEach((word) => {
    if (rightWords.has(word)) {
      overlap += 1;
    }
  });
  return overlap / Math.min(leftWords.size, rightWords.size);
}

function nearbyBlockTextForReferenceInference(pageNumber, blockIndex) {
  const currentIndex = Number(blockIndex);
  if (!Number.isFinite(currentIndex)) {
    return "";
  }
  return reviewSegmentsForPage(pageNumber)
    .filter((segment) => {
      const index = Number(segment.blockIndex);
      return Number.isFinite(index) && index !== currentIndex && Math.abs(index - currentIndex) <= 3;
    })
    .map((segment) => segment.markdown || "")
    .join("\n\n");
}

function canAutoUnwrapMineruLineBreaks(markdown) {
  const text = String(markdown || "").replace(/\r\n?/g, "\n");
  if (!text.trim() || !text.includes("\n")) {
    return false;
  }
  if (!canAutoCorrectPlainMineruMarkdown(text)) {
    return false;
  }
  return autoUnwrapMineruLineBreaks(text) !== text.trim();
}

function autoUnwrapMineruLineBreaks(markdown) {
  return String(markdown || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => unwrapPlainTextParagraph(paragraph))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function unwrapPlainTextParagraph(paragraph) {
  const lines = String(paragraph || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return "";
  }
  return lines
    .reduce((output, line) => {
      if (!output) {
        return line;
      }
      if (/-$/.test(output) && /^[a-z]/.test(line)) {
        return `${output.slice(0, -1)}${line}`;
      }
      return `${output} ${line}`;
    }, "")
    .replace(/\s+([,.;:!?，。；：！？])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function saveHumanAcceptedBlockEdit(blockKey, newMarkdown) {
  const preparedMarkdown = cleanMathpixEditableMarkdown(String(newMarkdown || ""));
  if (!preparedMarkdown.trim()) {
    setStatus("Empty block", "error");
    return;
  }
  const segment = reviewSegmentsForPage(state.currentPage).find((item) => String(item.blockIndex) === blockKey);
  const risk = reviewRiskForBlock(state.currentPage, blockKey);
  const patchResult = createAndStoreDraftOcrPatch({
    pageNo: state.currentPage,
    blockIndex: blockKey,
    oldText: segment?.markdown || risk?.text || "",
    newText: preparedMarkdown,
    source: "human",
  });
  const markdown = patchResult.normalizedText;
  if (patchResult.patch?.status === "draft") {
    rejectPriorOcrPatchesForBlock(patchResult.patch.blockId, patchResult.patch.patchId);
    updateOcrPatchStatus(patchResult.patch.patchId, "accepted");
  }
  getMathpixBlockDrafts(state.currentPage).delete(blockKey);
  clearLiveReviewDraftForBlock(state.currentPage, blockKey);
  clearReviewNeedsCorrectionForBlock(state.currentPage, blockKey);
  // TODO: next step will switch display/export to accepted patches.
  getBlockOverrides(state.currentPage).set(blockKey, markdown);
  saveOcrWorkspaceState();
  expandOnlyReviewBlock(state.currentPage, blockKey);
  updateCorrectionSummary();
  state.acceptedPatchPreview = null;
  state.acceptedPatchBookPreview = null;
  setStatus(patchResult.patch?.status === "accepted" ? "Saved and accepted" : "Ready", "ok");
  await renderCurrentPage();
}

function rejectPriorOcrPatchesForBlock(blockId, currentPatchId) {
  const targetBlockId = String(blockId || "");
  const keepPatchId = String(currentPatchId || "");
  if (!targetBlockId || !Array.isArray(state.ocrPatches)) {
    return 0;
  }
  const targetPrefix = targetBlockId.match(/^(p\d+_b[^_]+)_/)?.[1] || targetBlockId.match(/^(p\d+_b[^_]+)$/)?.[1] || "";
  const updatedAt = new Date().toISOString();
  let count = 0;
  state.ocrPatches.forEach((patch) => {
    const patchBlockId = String(patch?.blockId || "");
    const sameBlock =
      patchBlockId === targetBlockId ||
      (targetPrefix && (patchBlockId.startsWith(`${targetPrefix}_`) || patchBlockId === targetPrefix));
    if (!sameBlock || patch?.patchId === keepPatchId) {
      return;
    }
    if (!["draft", "accepted"].includes(patch.status)) {
      return;
    }
    patch.status = "rejected";
    patch.updatedAt = updatedAt;
    patch.metadata = {
      ...(patch.metadata || {}),
      replacedByPatchId: keepPatchId,
    };
    count += 1;
  });
  return count;
}

function expandOnlyReviewBlock(pageNumber, blockIndex) {
  state.reviewExpanded.clear();
  state.reviewExpanded.add(reviewBlockKey(pageNumber, blockIndex));
  state.reviewInitializedPages.add(pageNumber);
}

function renderBlockContent(markdown, entry) {
  if (shouldRenderAsAlgorithmBlock(markdown, entry)) {
    return renderAlgorithmBlock(markdownToAlgorithmLines(markdown));
  }
  const displayMarkdown = autoCorrectKnownEquationOcrMarkdown(markdown);
  const normalizedMarkdown = normalizeReferenceSpacing(
    normalizeScientificUnicodeMathForRender(
      normalizeEditableProseLineBreaksOutsideStructuredBlocks(
        normalizeMathpixCollapsedProse(
          normalizeSingleLineDisplayMath(normalizeInlineMathSpacingForRender(normalizeDisplayMathForRender(displayMarkdown))),
        ),
      ),
    ),
  );
  const imagePreview = renderBlockImagePreview(normalizedMarkdown, entry);
  const markdownForHtml = imagePreview ? stripMarkdownImageReferences(normalizedMarkdown) : normalizedMarkdown;
  return `${imagePreview}${renderMarkdownHtml(markdownForHtml)}`;
}

function normalizeInlineMathSpacingForRender(markdown) {
  const text = String(markdown || "");
  if (!text) {
    return text;
  }
  if (canAutoCorrectPlainMineruMarkdown(text)) {
    return normalizeInlineMathSpacing(text);
  }
  return normalizeInlineMathSpacingOutsideDisplayMath(text);
}

function normalizeScientificUnicodeMathForRender(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  let inDisplayMath = false;
  let inCodeFence = false;
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (isCodeFenceStart(line)) {
        inCodeFence = !inCodeFence;
        return line;
      }
      if (inCodeFence) {
        return line;
      }
      if (trimmed === "$$" || trimmed === "\\[" || trimmed === "\\]") {
        inDisplayMath = trimmed === "\\]" ? false : trimmed === "\\[" ? true : !inDisplayMath;
        return line;
      }
      if (inDisplayMath || hasLatexMathEnvironment(line)) {
        return line;
      }
      return normalizeScientificUnicodeMathInTextLine(line);
    })
    .join("\n");
}

function normalizeScientificUnicodeMathInTextLine(line) {
  return replaceOutsideInlineMathSpans(String(line || ""), (segment) =>
    normalizeGreekMathTextTokens(normalizeScientificPowerTextTokens(segment)),
  );
}

function replaceOutsideInlineMathSpans(text, transform) {
  const source = String(text || "");
  let output = "";
  let cursor = 0;
  const pattern = /(\$[^$\n]*\$|\\\([\s\S]*?\\\))/g;
  let match;
  while ((match = pattern.exec(source))) {
    output += transform(source.slice(cursor, match.index));
    output += match[0];
    cursor = match.index + match[0].length;
  }
  output += transform(source.slice(cursor));
  return output;
}

function normalizeGreekMathTextTokens(text) {
  return String(text || "").replace(
    /(^|[^\p{L}\p{N}\\$])([Δδ])?([Α-Ωα-ωµμ])(?:\s*[_]?\s*\{?([A-Za-z]{1,4})\}?)?\s*\/\s*\3(?:\s*[_]?\s*\{?\4\}?)?(?![\p{L}\p{N}])/gu,
    (match, prefix, deltaSymbol, symbol, suffix) => {
      const latex = latexGreekSymbol(symbol);
      if (!latex) {
        return match;
      }
      const deltaLatex = deltaSymbol ? latexGreekSymbol(deltaSymbol) : "";
      const suffixText = String(suffix || "");
      const subscript = suffixText ? `_{${/^[A-Z]{1,4}$/.test(suffixText) ? `\\rm ${suffixText}` : suffixText}}` : "";
      return `${prefix}$${deltaLatex}${latex}${subscript}/${latex}${subscript}$`;
    },
  );
}

function normalizeScientificPowerTextTokens(text) {
  return String(text || "").replace(
    /(^|[^\p{L}\p{N}\\$])((?:[<>]\s*)?\d+(?:\.\d+)?\s*(?:[×x]\s*)?10\s*\^\s*\{?\s*[-+]?\d+\s*\}?(?:\s*yr\s*\^\s*\{?\s*[-+]?\d+\s*\}?)?)/gu,
    (match, prefix, token) => `${prefix}$${formatScientificPowerToken(token)}$`,
  );
}

function formatScientificPowerToken(token) {
  return String(token || "")
    .replace(/\s+/g, " ")
    .replace(/\s*×\s*/g, " \\times ")
    .replace(/\sx\s*/g, " \\times ")
    .replace(/10\s*\^\s*\{?\s*([-+]?\d+)\s*\}?/g, "10^{$1}")
    .replace(/\s*yr\s*\^\s*\{?\s*([-+]?\d+)\s*\}?/gi, "\\mathrm{yr}^{$1}")
    .trim();
}

function latexGreekSymbol(symbol) {
  const symbols = {
    Α: "A",
    α: "\\alpha",
    Β: "B",
    β: "\\beta",
    Γ: "\\Gamma",
    γ: "\\gamma",
    Δ: "\\Delta",
    δ: "\\delta",
    Ε: "E",
    ε: "\\epsilon",
    Ζ: "Z",
    ζ: "\\zeta",
    Η: "H",
    η: "\\eta",
    Θ: "\\Theta",
    θ: "\\theta",
    Ι: "I",
    ι: "\\iota",
    Κ: "K",
    κ: "\\kappa",
    Λ: "\\Lambda",
    λ: "\\lambda",
    Μ: "M",
    μ: "\\mu",
    µ: "\\mu",
    Ν: "N",
    ν: "\\nu",
    Ξ: "\\Xi",
    ξ: "\\xi",
    Ο: "O",
    ο: "o",
    Π: "\\Pi",
    π: "\\pi",
    Ρ: "P",
    ρ: "\\rho",
    Σ: "\\Sigma",
    σ: "\\sigma",
    Τ: "T",
    τ: "\\tau",
    Υ: "\\Upsilon",
    υ: "\\upsilon",
    Φ: "\\Phi",
    φ: "\\phi",
    Χ: "X",
    χ: "\\chi",
    Ψ: "\\Psi",
    ψ: "\\psi",
    Ω: "\\Omega",
    ω: "\\omega",
  };
  return symbols[symbol] || "";
}

function normalizeInlineMathSpacingOutsideDisplayMath(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  let inDisplayMath = false;
  let inCodeFence = false;
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (isCodeFenceStart(line)) {
        inCodeFence = !inCodeFence;
        return line;
      }
      if (inCodeFence || isLikelyMarkdownTableLine(line) || isStandaloneMarkdownImageLine(line)) {
        return line;
      }
      if (trimmed === "$$" || trimmed === "\\[" || trimmed === "\\]") {
        inDisplayMath = trimmed === "\\]" ? false : !inDisplayMath;
        return line;
      }
      if (inDisplayMath || hasLatexMathEnvironment(line)) {
        return line;
      }
      return normalizeInlineMathSpacing(line);
    })
    .join("\n")
    .replace(/[ \t]+\n/g, "\n");
}

function cleanMathpixEditableMarkdown(markdown) {
  const tableRepaired = normalizeMathpixTableMarkdownArtifacts(String(markdown || ""));
  const lineBreakRepaired = normalizeEditableProseLineBreaksOutsideStructuredBlocks(
    normalizeMathpixCollapsedProse(tableRepaired),
  );
  const proseRepaired = normalizeMathpixEditableSource(
    normalizeInlineMathSpacingOutsideDisplayMath(repairLatexDisplayMathStructure(lineBreakRepaired)),
  );
  const formatted = formatDisplayMathSourceForEditing(
    normalizeInlineMathSpacingOutsideDisplayMath(compactLatexSourceSpacing(proseRepaired)),
  );
  return repairKnownMathpixTextualBoundArtifacts(
    normalizeEditableProseLineBreaksOutsideStructuredBlocks(
      repairLatexDisplayMathStructure(normalizeMathpixTableMarkdownArtifacts(formatted)),
    ),
  ).trim();
}

function repairKnownMathpixTextualBoundArtifacts(markdown) {
  return String(markdown || "")
    .replace(/\bof\s*\|\\eta\|\s*</g, "of $|\\eta| <")
    .replace(/(\\times\s+10)\^([+-]?\d+)/g, "$1^{$2}");
}

function normalizeMathpixOcrArtifacts(markdown) {
  return normalizeMathpixCollapsedProse(normalizeMathpixBrokenDiacritics(markdown));
}

function normalizeMathpixCollapsedProse(markdown) {
  return String(markdown || "")
    .replace(/\bForacompactbinarysystem,\s*/gi, "For a compact binary system, ")
    .replace(/\bthewaveforms\b/gi, "the waveforms")
    .replace(/\baregivento\b/gi, "are given to")
    .replace(/\btherequiredorders\b/gi, "the required orders")
    .replace(/\brequiredorders\b/gi, "required orders")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
}

function normalizeMathpixTableMarkdownArtifacts(markdown) {
  return String(markdown || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(cleanMathpixTableArtifactLine)
    .filter((line) => line != null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function cleanMathpixTableArtifactLine(line) {
  const source = String(line || "");
  const trimmed = source.trim();
  if (!trimmed) {
    return source;
  }
  if (trimmed === "$" || /^\|{2,}\s*$/.test(trimmed)) {
    return null;
  }
  if (isCollapsedTableGarbageLine(trimmed)) {
    return null;
  }
  if (!trimmed.includes("|") && !/\\multirow\b/.test(trimmed)) {
    return source;
  }
  const withoutMultirow = stripLatexMultirow(source);
  if (!withoutMultirow.includes("|")) {
    return cleanMathpixTableCell(withoutMultirow);
  }
  const cells = withoutMultirow.split("|").map((cell) => cleanMathpixTableCell(cell));
  if (!cells.some((cell) => cell.trim())) {
    return null;
  }
  return cells.join("|").replace(/[ \t]+\|/g, " |").replace(/\|[ \t]+/g, "|").trimEnd();
}

function isCollapsedTableGarbageLine(line) {
  const trimmed = String(line || "").trim();
  if (/^\|{3,}/.test(trimmed)) {
    return true;
  }
  if (!trimmed.includes("|")) {
    return false;
  }
  const text = trimmed.replace(/[|$]/g, "").trim();
  return text.length > 40 && !/\s/.test(text) && /[A-Za-z]{12,}/.test(text);
}

function stripLatexMultirow(text) {
  return String(text || "").replace(/\\multirow(?:\[[^\]]*])?\{[^{}\n]*\}\{[^{}\n]*\}\{([^{}\n]*)\}/g, "$1");
}

function cleanMathpixTableCell(cell) {
  return normalizeScientificUnicodeMathInTextLine(
    String(cell || "")
      .replace(/\\hline\b/g, "")
      .replace(/\\cline\{[^}]*\}/g, "")
      .replace(/^\s*\$+\s*|\s*\$+\s*$/g, "")
      .replace(/\{([^{}\\]+)\}/g, "$1")
      .replace(/\s+([,.;:])/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );
}

function normalizeEditableProseLineBreaksOutsideStructuredBlocks(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let buffer = [];
  let inCodeFence = false;
  let inDisplayMath = false;

  const flushBuffer = () => {
    if (!buffer.length) {
      return;
    }
    const source = buffer.join("\n");
    output.push(canNormalizeEditableProseBuffer(source) ? autoUnwrapMineruLineBreaks(source) : source);
    buffer = [];
  };

  lines.forEach((line) => {
    const trimmed = String(line || "").trim();
    if (isCodeFenceStart(line)) {
      flushBuffer();
      inCodeFence = !inCodeFence;
      output.push(line);
      return;
    }
    if (inCodeFence) {
      output.push(line);
      return;
    }
    if (trimmed === "$$" || trimmed === "\\[" || trimmed === "\\]") {
      flushBuffer();
      output.push(line);
      inDisplayMath = trimmed === "\\]" ? false : trimmed === "\\[" ? true : !inDisplayMath;
      return;
    }
    if (inDisplayMath) {
      output.push(line);
      return;
    }
    if (!trimmed) {
      flushBuffer();
      if (output.length && output[output.length - 1] !== "") {
        output.push("");
      }
      return;
    }
    if (isStructuredMarkdownLine(line)) {
      flushBuffer();
      output.push(line);
      return;
    }
    buffer.push(line);
  });
  flushBuffer();
  return output.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function canNormalizeEditableProseBuffer(markdown) {
  const text = String(markdown || "").replace(/\r\n?/g, "\n");
  return (
    text.includes("\n") &&
    canAutoCorrectPlainMineruMarkdown(text) &&
    !hasStandaloneEquationLine(text) &&
    !isLikelyBibliographyText(text)
  );
}

function isStructuredMarkdownLine(line) {
  const trimmed = String(line || "").trim();
  return (
    isSingleLineDisplayMath(line) ||
    isBareDisplayMathStart(line) ||
    isLikelyStandaloneMathLine(trimmed) ||
    hasLatexMathEnvironment(trimmed) ||
    hasMarkdownImageReference(trimmed) ||
    isLikelyMarkdownTableLine(line) ||
    /^#{1,6}\s+/.test(trimmed) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /<\s*(?:table|tr|td|th)\b/i.test(trimmed)
  );
}

function normalizeMathpixEditableSource(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  let inCodeFence = false;
  return lines
    .map((line) => {
      if (isCodeFenceStart(line)) {
        inCodeFence = !inCodeFence;
        return line;
      }
      if (inCodeFence) {
        return line;
      }
      return line
        .replace(/\\{2,}(?=[A-Za-z])/g, "\\")
        .replace(/\b([Tt])he\s*([0-9]+)\s+\\+sigma\s*\$bound\b/g, (_match, prefix, number) => `${prefix}he ${number} $\\sigma$ bound`)
        .replace(/\\+sigma\s*\$bound\b/g, "$\\sigma$ bound")
        .replace(/\$?\|\s*\\+eta\s*\|\s*</g, "$|\\eta| <")
        .replace(/\s+([,.;:])/g, "$1")
        .replace(/[ \t]{2,}/g, " ");
    })
    .join("\n");
}

function compactLatexSourceSpacing(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  let inDisplayMath = false;
  let inCodeFence = false;
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (isCodeFenceStart(line)) {
        inCodeFence = !inCodeFence;
        return line;
      }
      if (inCodeFence) {
        return line;
      }
      if (trimmed === "$$" || trimmed === "\\[" || trimmed === "\\]") {
        inDisplayMath = trimmed === "\\]" ? false : !inDisplayMath;
        return line;
      }
      if (inDisplayMath) {
        return compactLatexSourceLine(line);
      }
      if (isSingleLineDisplayMath(line)) {
        return compactSingleLineDisplayMathSource(line);
      }
      if (hasInlineMathDelimiter(line)) {
        return compactInlineMathSource(line);
      }
      return isLatexDenseSourceLine(line) && isLikelyStandaloneMathLine(trimmed) ? compactLatexSourceLine(line) : line;
    })
    .join("\n");
}

function isSingleLineDisplayMath(line) {
  return /^\s*\$\$[\s\S]*\$\$\s*$/.test(String(line || "").trim());
}

function compactSingleLineDisplayMathSource(line) {
  return String(line || "").replace(/^(\s*)\$\$([\s\S]*?)\$\$(\s*)$/, (_match, leading, body, trailing) => {
    const formatted = formatLatexDisplayMathBody(body);
    return formatted.includes("\n") ? `${leading}$$\n${formatted}\n$$${trailing}` : `${leading}$$${formatted}$$${trailing}`;
  });
}

function hasInlineMathDelimiter(line) {
  return /(^|[^$])\$[^$\n]+?\$/.test(String(line || ""));
}

function compactInlineMathSource(line) {
  return String(line || "").replace(/\$([^$\n]+?)\$/g, (_match, body) => {
    return `$${compactLatexSourceLine(body)}$`;
  });
}

function isLatexDenseSourceLine(line) {
  const text = String(line || "");
  return /\\[A-Za-z]+|[_^]\s*\{|\\begin\s*\{|\\end\s*\{/.test(text);
}

function compactLatexSourceLine(line) {
  return unwrapRedundantWholeLatexDoubleBraces(collapseRedundantLatexDoubleBraces(String(line || "")))
    .replace(/\{\\([A-Za-z]+)\}/g, "\\$1")
    .replace(/\{([=+\-*/<>])\}/g, "$1")
    .replace(/\\pmb\s*(\\[A-Za-z]+)/g, (_match, command) => `\\boldsymbol{${command}}`)
    .replace(/\\pmb\s+([A-Za-z])\b/g, (_match, symbol) => `\\boldsymbol{${symbol}}`)
    .replace(/\\pmb\s*\{([^{}\n]+)\}/g, (_match, body) => `\\boldsymbol{${String(body || "").trim()}}`)
    .replace(/\\boldsymbol\s*(\\[A-Za-z]+)/g, (_match, command) => `\\boldsymbol{${command}}`)
    .replace(/\\boldsymbol\s+([A-Za-z])\b/g, (_match, symbol) => `\\boldsymbol{${symbol}}`)
    .replace(/\\([A-Za-z]+)\s+\*/g, "\\$1*")
    .replace(/\\([A-Za-z]+\*)\s+\{/g, "\\$1{")
    .replace(/\\([A-Za-z]+)\s+\{/g, "\\$1{")
    .replace(/\\([A-Za-z]+)\s+([_^])/g, "\\$1$2")
    .replace(/([_^])\s+\{/g, "$1{")
    .replace(/\{\s+/g, "{")
    .replace(/\s+\}/g, "}")
    .replace(/\}\s+\{/g, "}{")
    .replace(/\s*~\s*/g, " ")
    .replace(/\s+([_^])/g, "$1")
    .replace(/\\begin\{array\}\s*\{([^}]*)\}/g, (_match, columns) => `\\begin{array}{${String(columns || "").replace(/\s+/g, "")}}`)
    .replace(/\\operatorname\*\{([^}]*)\}/g, (_match, name) => `\\operatorname*{${compactSpacedLetters(name)}}`)
    .replace(/\\operatorname\{([^}]*)\}/g, (_match, name) => `\\operatorname{${compactSpacedLetters(name)}}`)
    .replace(/\\mathrm\{([^}]*)\}/g, (_match, value) => `\\mathrm{${compactSpacedLetters(value)}}`)
    .replace(/\\left\s+/g, "\\left")
    .replace(/\\right\s+/g, "\\right")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\[\s+/g, "[")
    .replace(/\s+\]/g, "]")
    .replace(/\s+\\tag\{/g, "\\tag{")
    .replace(/([+\-])\s+(?=\d)/g, "$1")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trimEnd();
}

function collapseRedundantLatexDoubleBraces(text) {
  let output = String(text || "");
  let previous = "";
  while (output !== previous) {
    previous = output;
    output = output.replace(/\{\{([^{}\n]+)\}\}/g, "{$1}");
  }
  return output;
}

function unwrapRedundantWholeLatexDoubleBraces(text) {
  const source = String(text || "");
  const rowBreakMatch = source.match(/(\\\\)\s*$/);
  const rowBreak = rowBreakMatch ? rowBreakMatch[1] : "";
  let body = rowBreak ? source.slice(0, source.length - rowBreakMatch[0].length).trim() : source.trim();
  while (body.startsWith("{{") && body.endsWith("}}") && latexGroupContentIsBalanced(body.slice(2, -2))) {
    body = body.slice(2, -2).trim();
  }
  return rowBreak ? `${body} ${rowBreak}` : body;
}

function latexGroupContentIsBalanced(text) {
  let depth = 0;
  for (const char of String(text || "")) {
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

function formatDisplayMathSourceForEditing(markdown) {
  const lines = hoistStandaloneDisplayMathTags(markdown).replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let inCodeFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (isCodeFenceStart(line)) {
      inCodeFence = !inCodeFence;
      output.push(line);
      continue;
    }
    if (inCodeFence) {
      output.push(line);
      continue;
    }
    const singleLine = trimmed.match(/^\$\$([\s\S]*?)\$\$$/);
    if (singleLine) {
      output.push("$$", ...formatLatexDisplayMathLines([singleLine[1]]), "$$");
      continue;
    }
    if (trimmed === "$$") {
      const body = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== "$$") {
        body.push(lines[index]);
        index += 1;
      }
      output.push("$$", ...formatLatexDisplayMathLines(body), "$$");
      continue;
    }
    output.push(line);
  }
  return removeEmptyDisplayMathBlocks(output.join("\n")).replace(/\n{3,}/g, "\n\n");
}

function hoistStandaloneDisplayMathTags(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let inCodeFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (isCodeFenceStart(line)) {
      inCodeFence = !inCodeFence;
      output.push(line);
      continue;
    }
    if (inCodeFence) {
      output.push(line);
      continue;
    }
    if (isStandaloneLatexTagLine(trimmed)) {
      if (!appendTagsToPreviousDisplayMathBlock(output, [trimmed])) {
        output.push(line);
      }
      continue;
    }
    const displayBlock = collectRawDisplayMathBlock(lines, index);
    if (!displayBlock) {
      output.push(line);
      continue;
    }
    const blockTags = displayMathBlockStandaloneTags(displayBlock.body);
    if (displayMathBlockIsEmpty(displayBlock.body)) {
      index = displayBlock.closeIndex;
      continue;
    }
    if (blockTags.length) {
      if (!appendTagsToPreviousDisplayMathBlock(output, blockTags)) {
        output.push("$$", ...displayBlock.body, "$$");
      }
      index = displayBlock.closeIndex;
      continue;
    }
    const { tags, nextIndex } = collectFollowingStandaloneDisplayMathTags(lines, displayBlock.closeIndex + 1);
    const body = appendTagsToDisplayMathBody(displayBlock.body, tags);
    output.push("$$", ...body, "$$");
    index = Math.max(displayBlock.closeIndex, nextIndex - 1);
  }
  return output.join("\n").replace(/\n{3,}/g, "\n\n");
}

function collectRawDisplayMathBlock(lines, startIndex) {
  const first = String(lines[startIndex] || "").trim();
  const singleLine = first.match(/^\$\$([\s\S]*?)\$\$$/);
  if (singleLine && first !== "$$") {
    return { body: [singleLine[1].trim()], closeIndex: startIndex };
  }
  if (first !== "$$") {
    return null;
  }
  const body = [];
  let index = startIndex + 1;
  while (index < lines.length && String(lines[index] || "").trim() !== "$$") {
    body.push(lines[index]);
    index += 1;
  }
  if (index >= lines.length) {
    return null;
  }
  return { body, closeIndex: index };
}

function collectFollowingStandaloneDisplayMathTags(lines, startIndex) {
  const tags = [];
  let index = startIndex;
  while (index < lines.length) {
    while (index < lines.length && !String(lines[index] || "").trim()) {
      index += 1;
    }
    const trimmed = String(lines[index] || "").trim();
    if (isStandaloneLatexTagLine(trimmed)) {
      tags.push(trimmed);
      index += 1;
      continue;
    }
    const displayBlock = collectRawDisplayMathBlock(lines, index);
    if (!displayBlock) {
      break;
    }
    if (displayMathBlockIsEmpty(displayBlock.body)) {
      index = displayBlock.closeIndex + 1;
      continue;
    }
    const blockTags = displayMathBlockStandaloneTags(displayBlock.body);
    if (!blockTags.length) {
      break;
    }
    tags.push(...blockTags);
    index = displayBlock.closeIndex + 1;
  }
  return { tags, nextIndex: index };
}

function displayMathBlockIsEmpty(lines) {
  return !lines.some((line) => String(line || "").trim());
}

function displayMathBlockStandaloneTags(lines) {
  const meaningful = lines.map((line) => String(line || "").trim()).filter(Boolean);
  return meaningful.length && meaningful.every(isStandaloneLatexTagLine) ? meaningful : [];
}

function isStandaloneLatexTagLine(line) {
  return /^\\tag\{[^}]+\}$/.test(String(line || "").trim());
}

function appendTagsToPreviousDisplayMathBlock(output, tags) {
  const closeIndex = findPreviousDisplayMathCloseIndex(output);
  if (closeIndex < 0) {
    return false;
  }
  const openIndex = findPreviousDisplayMathOpenIndex(output, closeIndex);
  if (openIndex < 0) {
    return false;
  }
  const body = output.slice(openIndex + 1, closeIndex);
  const nextBody = appendTagsToDisplayMathBody(body, tags);
  output.splice(openIndex + 1, closeIndex - openIndex - 1, ...nextBody);
  return true;
}

function appendTagsToDisplayMathBody(lines, tags) {
  const normalizedTags = Array.from(new Set((tags || []).map((tag) => String(tag || "").trim()).filter(isStandaloneLatexTagLine)));
  if (!normalizedTags.length) {
    return lines;
  }
  const body = lines.slice();
  const lastContentIndex = findLastNonEmptyLineIndex(body);
  if (lastContentIndex < 0) {
    return body;
  }
  const existing = new Set(displayMathTagLabels(body.join("\n")).map((label) => `\\tag{${label}}`));
  const missingTags = normalizedTags.filter((tag) => !existing.has(tag));
  if (!missingTags.length) {
    return body;
  }
  body[lastContentIndex] = `${String(body[lastContentIndex] || "").trimEnd()}${missingTags.join("")}`;
  return body;
}

function findLastNonEmptyLineIndex(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (String(lines[index] || "").trim()) {
      return index;
    }
  }
  return -1;
}

function findPreviousDisplayMathCloseIndex(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (String(lines[index] || "").trim() === "$$") {
      return index;
    }
  }
  return -1;
}

function findPreviousDisplayMathOpenIndex(lines, closeIndex) {
  for (let index = closeIndex - 1; index >= 0; index -= 1) {
    if (String(lines[index] || "").trim() === "$$") {
      return index;
    }
  }
  return -1;
}

function removeEmptyDisplayMathBlocks(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let inCodeFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (isCodeFenceStart(line)) {
      inCodeFence = !inCodeFence;
      output.push(line);
      continue;
    }
    if (!inCodeFence && trimmed === "$$") {
      let closeIndex = index + 1;
      while (closeIndex < lines.length && !String(lines[closeIndex] || "").trim()) {
        closeIndex += 1;
      }
      if (String(lines[closeIndex] || "").trim() === "$$") {
        index = closeIndex;
        continue;
      }
    }
    output.push(line);
  }
  return output.join("\n");
}

function formatLatexDisplayMathLines(lines) {
  return formatLatexDisplayMathBody(lines.join("\n"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatLatexDisplayMathBody(body) {
  const expanded = collapseRedundantLatexDoubleBraces(repairLatexDisplayMathStructure(String(body || "")))
    .replace(/\r\n?/g, "\n")
    .replace(/(\\right[\])}]|[\])}])\s*\\\s*\{\s*\\displaystyle/g, "$1 \\\\\n{\\displaystyle")
    .replace(/\}\s*\\\s*\{\s*\\displaystyle/g, "} \\\\\n{\\displaystyle")
    .replace(/\}\s*\{\s*\\displaystyle/g, "} \\\\\n{\\displaystyle")
    .replace(/(\\begin\{array\}\{[^}]*\})\s*\\\\\n\s*(\{\\displaystyle)/g, "$1\n$2")
    .replace(/(\\begin\{array\}(?:\{[^}\n]*\})?)/g, "\n$1\n")
    .replace(/(\\end\{array\})/g, "\n$1\n")
    .replace(/\\\\(?![A-Za-z])\s*/g, "\\\\\n")
    .replace(/\n[ \t]*(\\tag\{[^}]+\})/g, "$1")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return expanded
    .split("\n")
    .map((line) => compactLatexSourceLine(line.trim()))
    .filter(Boolean)
    .join("\n");
}

function repairLatexDisplayMathStructure(markdown) {
  return repairBrokenLatexDisplaystyleRowClosers(repairBrokenLatexEnvironmentArguments(markdown));
}

function repairBrokenLatexEnvironmentArguments(markdown) {
  const source = String(markdown || "");
  const normalizeBegin = (match, env, columns) => {
    const columnSpec = String(columns || "").replace(/\s+/g, "");
    return isSimpleLatexArrayColumnSpec(columnSpec) ? `\\begin{${env}}{${columnSpec}}` : match;
  };
  return source
    .replace(/\\begin\s*\{\s*(array|tabular)\s*\}\s*\n\s*\\?}\s*\{\s*([^}\n]+?)\s*\}\s*(?:\\\\)?/g, normalizeBegin)
    .replace(/\\begin\s*\{\s*(array|tabular)\s*\}\s*\n\s*\{\s*([^}\n]+?)\s*\}\s*(?:\\\\)?/g, normalizeBegin)
    .replace(/\\begin\s*\{\s*(array|tabular)\s*\}\s*\\?}\s*\{\s*([^}\n]+?)\s*\}/g, normalizeBegin)
    .replace(/\\begin\s*\{\s*(array|tabular)\s*\}\s*\{\s*([^}\n]+?)\s*\}/g, normalizeBegin);
}

function isSimpleLatexArrayColumnSpec(columnSpec) {
  return /^[lcr|]+$/i.test(String(columnSpec || ""));
}

function repairBrokenLatexDisplaystyleRowClosers(markdown) {
  return String(markdown || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const rowBreakMatch = String(line || "").match(/\s*\\\\\s*$/);
      const rowBreak = rowBreakMatch ? rowBreakMatch[0] : "";
      const body = rowBreak ? line.slice(0, line.length - rowBreak.length) : line;
      if (!/^\s*\{\\displaystyle\b/.test(body) || !/\\\}\s*$/.test(body)) {
        return line;
      }
      const repaired = body.replace(/\\\}\s*$/, "}");
      if (!latexUnescapedGroupContentIsBalanced(body) && latexUnescapedGroupContentIsBalanced(repaired)) {
        return `${repaired}${rowBreak}`;
      }
      return line;
    })
    .join("\n");
}

function latexUnescapedGroupContentIsBalanced(text) {
  let depth = 0;
  const value = String(text || "");
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char !== "{" && char !== "}") || isEscapedLatexChar(value, index)) {
      continue;
    }
    depth += char === "{" ? 1 : -1;
    if (depth < 0) {
      return false;
    }
  }
  return depth === 0;
}

function isEscapedLatexChar(text, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function compactSpacedLetters(text) {
  const value = String(text || "").trim();
  return /^[A-Za-z](?:\s+[A-Za-z])+$/.test(value) ? value.replace(/\s+/g, "") : value;
}

function shouldRenderAsAlgorithmBlock(markdown, entry) {
  if (entry?.kind !== "algorithm") {
    return false;
  }
  if (hasLatexMathEnvironment(markdown) || looksLikeNaturalLanguageCodeFence(markdown)) {
    return false;
  }
  return looksLikeAlgorithmLines(String(markdown || "").replace(/\r\n?/g, "\n").split("\n"));
}

function hasLatexMathEnvironment(markdown) {
  return /\\begin\s*\{(?:aligned|align|array|matrix|pmatrix|bmatrix|cases|split|gather|equation)\*?\}/.test(String(markdown || ""));
}

function normalizeDisplayMathForRender(markdown) {
  const normalized = removeDanglingSingleDollarLines(normalizeEscapedDisplayMathNewlines(hoistStandaloneDisplayMathTags(repairLatexDisplayMathStructure(markdown))));
  const repaired = repairBrokenDisplayMathDelimiters(normalized);
  const mathNormalized = restoreDroppedDisplayMathDelimiters(repaired, normalizeMathMarkdown(repaired));
  const wrapped = wrapBareDisplayMathBlocks(mathNormalized);
  return removeEmptyDisplayMathBlocks(removeDanglingSingleDollarLines(hoistStandaloneDisplayMathTags(repairLatexDisplayMathStructure(wrapped))));
}

function restoreDroppedDisplayMathDelimiters(originalMarkdown, normalizedMarkdown) {
  const original = String(originalMarkdown || "").trim();
  const normalized = String(normalizedMarkdown || "").trim();
  if (!normalized || hasDisplayMathBlock(normalized) || !hasDisplayMathBlock(original)) {
    return String(normalizedMarkdown || "");
  }
  if (!/^\$\$[\s\S]*\$\$$/.test(original)) {
    return String(normalizedMarkdown || "");
  }
  if (!hasStandaloneEquationLine(normalized) && !/\\tag\{[^}]+\}/.test(normalized)) {
    return String(normalizedMarkdown || "");
  }
  return `$$\n${normalized}\n$$`;
}

function normalizeEscapedDisplayMathNewlines(markdown) {
  return String(markdown || "")
    .replace(/\$\$\\+n/g, () => "$$\n")
    .replace(/\\+n\$\$/g, () => "\n$$")
    .replace(/\\+n(\\tag\{[^}]+\})/g, "\n$1")
    .replace(/(\\tag\{[^}]+\})\\+n/g, "$1\n");
}

function renderBlockImagePreview(markdown, entry) {
  if (!hasMarkdownImageReference(markdown)) {
    return "";
  }
  const page = state.pageCache.get(state.currentPage);
  const bbox = expandedBBoxWithPadding(entry?.bbox, cropPaddingForMarkdownBlock(markdown, entry?.pageSize), entry?.pageSize);
  const pageWidth = pageSizeWidth(entry?.pageSize);
  const pageHeight = pageSizeHeight(entry?.pageSize);
  if (!page?.image || !bbox || !pageWidth || !pageHeight) {
    const image = extractMarkdownImageReferences(markdown)[0];
    return image ? renderMarkdownImage(image.alt || "image", image.src) : "";
  }
  const bboxWidth = Math.max(1, bbox[2] - bbox[0]);
  const bboxHeight = Math.max(1, bbox[3] - bbox[1]);
  const bgWidth = roundFraction((pageWidth / bboxWidth) * 100);
  const bgX = roundFraction((bbox[0] / Math.max(1, pageWidth - bboxWidth)) * 100);
  const bgY = roundFraction((bbox[1] / Math.max(1, pageHeight - bboxHeight)) * 100);
  return `
    <figure class="review-image-preview" style="aspect-ratio: ${roundFraction(bboxWidth)} / ${roundFraction(bboxHeight)}; background-image: url('${escapeHtml(page.image)}'); background-size: ${bgWidth}% auto; background-position: ${bgX}% ${bgY}%;">
      <figcaption>图片块预览</figcaption>
    </figure>
  `;
}

function extractMarkdownImageReferences(markdown) {
  const images = [];
  const pattern = /!\[([^\]]*)\]\(([^)\n]+)\)/g;
  let match;
  while ((match = pattern.exec(String(markdown || "")))) {
    const rawTarget = String(match[2] || "").trim();
    const srcMatch = rawTarget.match(/^<([^>]+)>$/) || rawTarget.match(/^(\S+)/);
    images.push({
      raw: match[0],
      alt: String(match[1] || "").trim(),
      src: srcMatch ? srcMatch[1] : rawTarget,
    });
  }
  return images;
}

function hasMarkdownImageReference(markdown) {
  return extractMarkdownImageReferences(markdown).length > 0;
}

function isStandaloneMarkdownImageLine(line) {
  return /^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(String(line || ""));
}

function stripMarkdownImageReferences(markdown) {
  const imagePattern = /!\[[^\]]*\]\([^)]+\)/g;
  return String(markdown || "")
    .replace(/\r\n?/g, "\n")
    .replace(imagePattern, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "");
}

function renderMarkdownImage(alt, src) {
  const safeAlt = escapeHtml(alt || "image");
  const safeSrc = escapeHtml(src || "");
  if (!safeSrc) {
    return "";
  }
  return `
    <figure class="markdown-image-reference">
      <img src="${safeSrc}" alt="${safeAlt}" loading="lazy">
      <figcaption>${safeAlt}</figcaption>
    </figure>
  `;
}

function expandedBBoxWithPadding(bbox, padding, pageSize) {
  if (!Array.isArray(bbox) || bbox.length < 4) {
    return null;
  }
  const pageWidth = pageSizeWidth(pageSize);
  const pageHeight = pageSizeHeight(pageSize);
  if (!pageWidth || !pageHeight) {
    return null;
  }
  const pad = normalizeCropPadding(padding);
  const left = clamp(Number(bbox[0]) - pad.left, 0, pageWidth);
  const top = clamp(Number(bbox[1]) - pad.top, 0, pageHeight);
  const right = clamp(Number(bbox[2]) + pad.right, left + 1, pageWidth);
  const bottom = clamp(Number(bbox[3]) + pad.bottom, top + 1, pageHeight);
  return [left, top, right, bottom];
}

function cropPaddingForMarkdownBlock(markdown, pageSize) {
  if (hasMarkdownImageReference(markdown)) {
    return cropPaddingForImageLikeBlock(pageSize);
  }
  return BLOCK_MATHPIX_CROP_PADDING;
}

function cropPaddingForRiskBlock(risk) {
  const text = String(risk?.text || "");
  const reasons = Array.isArray(risk?.reasons) ? risk.reasons.map(String) : [];
  if (hasMarkdownImageReference(text)) {
    return cropPaddingForImageLikeBlock(risk?.pageSize);
  }
  if (reasons.some((reason) => /math|formula|equation/i.test(reason)) || extractEquationNumbers(text).length) {
    const pageWidth = pageSizeWidth(risk?.pageSize);
    return {
      left: BLOCK_MATHPIX_CROP_PADDING.horizontal,
      right: Math.max(140, pageWidth * 0.18, BLOCK_MATHPIX_CROP_PADDING.horizontal),
      top: BLOCK_MATHPIX_CROP_PADDING.vertical,
      bottom: BLOCK_MATHPIX_CROP_PADDING.vertical,
    };
  }
  return BLOCK_MATHPIX_CROP_PADDING;
}

function cropPaddingForImageLikeBlock(pageSize) {
  const pageWidth = pageSizeWidth(pageSize);
  const pageHeight = pageSizeHeight(pageSize);
  return {
    left: Math.max(120, pageWidth * 0.1, BLOCK_MATHPIX_CROP_PADDING.horizontal),
    right: Math.max(28, pageWidth * 0.035, BLOCK_MATHPIX_CROP_PADDING.horizontal),
    top: Math.max(8, pageHeight * 0.012, BLOCK_MATHPIX_CROP_PADDING.vertical),
    bottom: Math.max(40, pageHeight * 0.018, BLOCK_MATHPIX_CROP_PADDING.vertical),
  };
}

function markdownToAlgorithmLines(markdown) {
  return String(markdown || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== "$$" && !/^```/.test(line))
    .map(cleanAlgorithmLine)
    .filter(Boolean);
}

function renderRiskPanel(risks) {
  if (!state.mineruInfo) {
    return "";
  }
  if (!risks.length) {
    return `<div class="risk-panel is-low">当前页未发现高风险块，通常不需要 Mathpix。</div>`;
  }
  const score = Math.max(...risks.map((item) => item.score));
  return `
    <div class="risk-panel">
      <div class="risk-summary">
        <strong>高风险 ${risks.length} 块</strong>
        <span>最高风险 ${score.toFixed(2)}，建议仅对本页/这些块使用 Mathpix。</span>
      </div>
      <div class="risk-list">
        ${risks.map(renderRiskItem).join("")}
      </div>
    </div>
  `;
}

function renderRiskItem(item) {
  const corrected = getBlockOverrides(item.pageNumber, false).has(item.blockIndex);
  const disabled = item.bbox ? "" : "disabled";
  const normalizedText = item.text.replace(/\s+/g, " ");
  return `
    <article class="risk-item">
      <div>
        <strong>${riskReasonLabel(item.reasons[0] || "risk")}</strong>
        <span>${item.reasons.map(riskReasonLabel).join(" · ")}</span>
      </div>
      <p>${escapeHtml(truncateText(normalizedText, 180))}</p>
      <details class="risk-detail">
        <summary>查看完整 MinerU 块</summary>
        <pre><code>${escapeHtml(item.text)}</code></pre>
      </details>
      <button class="text-button risk-action" type="button" data-risk-mathpix="${item.blockIndex}" ${disabled}>
        ${corrected ? "Mathpix 重校正" : item.bbox ? "Mathpix 校正" : "缺少 bbox"}
      </button>
    </article>
  `;
}

function renderMathpixCard(page) {
  const card = document.createElement("section");
  card.className = "mathpix-page-card";
  const cached = state.mathpixCache.get(state.currentPage);
  const markdown = cached?.editText || cached?.markdown || "";
  const error = cached?.error || "";
  const previewId = `mathpix-preview-${state.currentPage}`;
  const editorId = `mathpix-editor-${state.currentPage}`;
  card.innerHTML = `
    <div class="card-head">
      <div>
        <strong>Mathpix</strong>
        <span>${cached?.latencyMs ? `${cached.latencyMs} ms` : cached ? "已缓存" : "未识别"}</span>
      </div>
      <button class="text-button" type="button" ${markdown ? "" : "disabled"}>复制</button>
    </div>
    ${renderMathpixBody({ markdown, error, editorId, previewId })}
  `;
  card.querySelector("button").addEventListener("click", async () => {
    const latest = state.mathpixCache.get(state.currentPage);
    await copyButtonText(card.querySelector("button"), latest?.editText || latest?.markdown || markdown);
  });
  const editor = card.querySelector(`#${editorId}`);
  const preview = card.querySelector(`#${previewId}`);
  if (editor && preview) {
    card.querySelectorAll("[data-mathpix-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.dataset.mathpixTab;
        card.querySelectorAll("[data-mathpix-tab]").forEach((tabButton) => {
          tabButton.classList.toggle("is-active", tabButton.dataset.mathpixTab === target);
        });
        card.querySelectorAll("[data-mathpix-panel]").forEach((panel) => {
          panel.classList.toggle("is-active", panel.dataset.mathpixPanel === target);
        });
        if (target === "preview") {
          typesetMath(preview);
        }
      });
    });
    editor.addEventListener("input", () => {
      const nextText = editor.value;
      const current = state.mathpixCache.get(state.currentPage) || {};
      state.mathpixCache.set(state.currentPage, { ...current, markdown: current.markdown || nextText, editText: nextText });
      saveOcrWorkspaceState();
      preview.innerHTML = renderMarkdownHtml(normalizeMathMarkdown(nextText));
      const diffPanel = card.querySelector('[data-mathpix-panel="diff"]');
      if (diffPanel) {
        diffPanel.innerHTML = renderCorrectionDiff(nextText);
        bindDiffApplyButton(card);
      }
      typesetMath(preview);
    });
    bindDiffApplyButton(card);
  }
  return card;
}

function bindDiffApplyButton(card) {
  const button = card.querySelector("[data-apply-mathpix]");
  if (!button) {
    return;
  }
  button.addEventListener("click", async () => {
    const latest = state.mathpixCache.get(state.currentPage);
    const corrected = prepareMathpixMarkdown(latest?.editText || latest?.markdown || "");
    if (!corrected.trim()) {
      return;
    }
    state.mineruOverrides.set(state.currentPage, corrected);
    state.mineruBlockOverrides.delete(state.currentPage);
    saveOcrWorkspaceState();
    updateCorrectionSummary();
    await renderCurrentPage();
  });
}

function renderMathpixBody({ markdown, error, editorId, previewId }) {
  if (error) {
    return `<div class="render-body markdown-body is-error">${escapeHtml(error)}</div>`;
  }
  if (!markdown) {
    return `<div class="render-body markdown-body is-loading">点击顶部“整页 Mathpix（备用）”后，这里会显示当前页的整页识别结果，可作为块级校对漏行时的参考。</div>`;
  }
  return `
    <div class="mathpix-workbench">
      <div class="mathpix-tabs" role="tablist" aria-label="Mathpix result view">
        <button class="mathpix-tab is-active" type="button" data-mathpix-tab="source">Markdown</button>
        <button class="mathpix-tab" type="button" data-mathpix-tab="preview">预览</button>
        <button class="mathpix-tab" type="button" data-mathpix-tab="diff">Diff</button>
      </div>
      <div class="mathpix-tab-panel is-active" data-mathpix-panel="source">
        <textarea id="${editorId}" class="markdown-editor" spellcheck="false">${escapeHtml(markdown)}</textarea>
      </div>
      <div class="mathpix-tab-panel" data-mathpix-panel="preview">
        <div id="${previewId}" class="render-body markdown-body live-preview">
          ${renderMarkdownHtml(normalizeMathMarkdown(markdown))}
        </div>
      </div>
      <div class="mathpix-tab-panel" data-mathpix-panel="diff">
        ${renderCorrectionDiff(markdown)}
      </div>
    </div>
  `;
}

function renderCorrectionDiff(mathpixMarkdown) {
  const mineruMarkdown = baseMineruMarkdownForPage(state.currentPage);
  if (!mineruMarkdown) {
    return `<div class="diff-empty">选择 MinerU middle.json 后可对照校正。</div>`;
  }
  const diff = buildLineDiff(mineruMarkdown, mathpixMarkdown);
  const changed = diff.some((item) => item.type !== "same");
  return `
    <div class="diff-toolbar">
      <span>${changed ? "检测到差异，可用 Mathpix 编辑稿替换当前页 MinerU 预览。" : "两边文本基本一致。"}</span>
      <button class="text-button" type="button" data-apply-mathpix ${mathpixMarkdown.trim() ? "" : "disabled"}>应用到 MinerU 预览</button>
    </div>
    <div class="diff-view">
      ${diff.map(renderDiffLine).join("")}
    </div>
  `;
}

async function recognizeCurrentPageWithMathpix() {
  if (state.busy || !hasPdfSource()) {
    return;
  }
  state.busy = true;
  if (els.mathpixButton) {
    els.mathpixButton.disabled = true;
  }
  setStatus("Mathpix", "busy");
  try {
    const page = await ensureCurrentPagePreview();
    const upload = await postJson("/api/model-tester/upload", {
      name: `page-${state.currentPage}.png`,
      kind: "image",
      mimeType: page.mimeType || "image/png",
      size: estimateDataUrlBytes(page.image),
      dataUrl: page.image,
    });
    if (!upload.ok) {
      throw new Error(upload.error || "图片上传失败");
    }
    const data = await postJson("/api/model-tester/image-to-markdown", {
      attachmentIds: [upload.id],
      prompt: "请将图片中的内容转为 markdown 格式",
      model: "mathpix:mathpix-text",
      models: ["mathpix:mathpix-text"],
      allowFallback: false,
      temperature: 0.3,
    });
    if (!data.ok) {
      throw new Error(data.error || "Mathpix 请求失败");
    }
    const markdown = prepareMathpixMarkdown(data.markdown || data.answer || "");
    if (!markdown) {
      throw new Error("Mathpix 响应为空");
    }
    state.mathpixCache.set(state.currentPage, { markdown, editText: markdown, latencyMs: data.latencyMs || null });
    saveOcrWorkspaceState();
    setStatus("Ready", "ok");
  } catch (error) {
    state.mathpixCache.set(state.currentPage, { error: error.message });
    saveOcrWorkspaceState();
    setStatus("Error", "error");
  } finally {
    state.busy = false;
    updatePager();
    await renderCurrentPage();
  }
}

async function recognizeRiskBlockWithMathpix(blockIndex) {
  if (state.busy) {
    setStatus("正在处理", "busy");
    return;
  }
  const blockKey = String(blockIndex);
  if (state.mathpixConfigured === false) {
    const message = state.mathpixConfigError || "Mathpix 未配置：请设置 MATHPIX_APP_ID/MATHPIX_APP_KEY 后重启服务。";
    setMathpixBlockError(state.currentPage, blockKey, message);
    setStatus(state.mathpixConfigError ? "Mathpix 配置无效" : "Mathpix 未配置", "error", message);
    await renderCurrentPage();
    return;
  }
  if (!hasPdfSource()) {
    setStatus("先上传 PDF", "error");
    return;
  }
  const risk = reviewRiskForBlock(state.currentPage, blockKey);
  if (!risk?.bbox) {
    setStatus("No bbox", "error");
    return;
  }
  state.busy = true;
  updatePager();
  setStatus("Block OCR", "busy");
  try {
    clearMathpixBlockError(state.currentPage, blockKey);
    const page = await ensureCurrentPagePreview();
    const cropDataUrl = await cropPageImage(page.image, risk.bbox, risk.pageSize, cropPaddingForRiskBlock(risk));
    const upload = await postJson("/api/model-tester/upload", {
      name: `page-${state.currentPage}-block-${blockKey.replace(/[^a-zA-Z0-9_-]+/g, "-")}.png`,
      kind: "image",
      mimeType: "image/png",
      size: estimateDataUrlBytes(cropDataUrl),
      dataUrl: cropDataUrl,
    });
    if (!upload.ok) {
      throw new Error(upload.error || "块图片上传失败");
    }
    const data = await postJson("/api/model-tester/image-to-markdown", {
      attachmentIds: [upload.id],
      prompt: "请只将这一个裁剪区域中的内容转为 markdown 格式。完整保留区域内可见的公式编号、图号和表号；公式右侧编号请写成 LaTeX \\tag{编号}。不要补充区域外内容。",
      model: "mathpix:mathpix-text",
      models: ["mathpix:mathpix-text"],
      allowFallback: false,
      temperature: 0.1,
    });
    if (!data.ok) {
      throw new Error(data.error || "Mathpix 块级请求失败");
    }
    const preparedMarkdown = normalizedReviewMarkdownForActiveCorrection(data.markdown || data.answer || "");
    if (!preparedMarkdown.trim()) {
      throw new Error("Mathpix 块级响应为空");
    }
    const segment = reviewSegmentsForPage(state.currentPage).find((item) => String(item.blockIndex) === blockKey);
    const patchResult = createAndStoreDraftOcrPatch({
      pageNo: state.currentPage,
      blockIndex: blockKey,
      oldText: segment?.markdown || risk.text || "",
      newText: preparedMarkdown,
      source: "mathpix",
      preserveText: preservationTextForBlock(state.currentPage, blockKey, segment, risk),
    });
    const markdown = patchResult.normalizedText;
    // TODO: next step will switch display/export to accepted patches.
    getMathpixBlockDrafts(state.currentPage).set(blockKey, markdown);
    clearLiveReviewDraftForBlock(state.currentPage, blockKey);
    clearMathpixBlockError(state.currentPage, blockKey);
    saveOcrWorkspaceState();
    expandOnlyReviewBlock(state.currentPage, blockKey);
    updateCorrectionSummary();
    setStatus("Draft ready", "ok");
  } catch (error) {
    const message = error?.message || String(error || "Mathpix 块级请求失败");
    setMathpixBlockError(state.currentPage, blockKey, message);
    setStatus("Block OCR failed", "error", message);
    state.mathpixCache.set(state.currentPage, { error: message });
  } finally {
    state.busy = false;
    updatePager();
    await renderCurrentPage();
  }
}

async function runRiskBlockMathpixFromButton(button) {
  if (!button) {
    return;
  }
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Mathpix 中...";
  try {
    await recognizeRiskBlockWithMathpix(button.dataset.riskMathpix);
  } catch (error) {
    setStatus("Block OCR failed", "error", error?.message || String(error || ""));
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function mineruMarkdownForPage(pageNumber) {
  if (state.mineruOverrides.has(pageNumber)) {
    return state.mineruOverrides.get(pageNumber);
  }
  const blockOverrides = getBlockOverrides(pageNumber, false);
  return pageSegmentsForPage(pageNumber)
    .map((segment) => blockOverrides.get(String(segment.blockIndex)) || segment.markdown)
    .filter(Boolean)
    .join("\n\n");
}

function baseMineruMarkdownForPage(pageNumber) {
  return originalBlockMarkdownsForPage(pageNumber)
    .map((entry) => entry.markdown)
    .filter(Boolean)
    .join("\n\n");
}

function originalBlockMarkdownsForPage(pageNumber) {
  const page = state.mineruInfo?.pdf_info?.[pageNumber - 1];
  if (!page) {
    return [];
  }
  const blocks = Array.isArray(page.para_blocks) ? page.para_blocks : [];
  return blocks
    .map((block, blockIndex) => ({
      block,
      blockIndex,
      bbox: getBlockBBox(block),
      markdown: blockToMarkdown(block),
      pageSize: page.page_size,
    }))
    .filter((entry) => !isLikelyPageHeaderEntry(entry));
}

function pageSegmentsForPage(pageNumber) {
  const entries = originalBlockMarkdownsForPage(pageNumber);
  return segmentEntries(entries);
}

function reviewBlockMarkdownsForPage(pageNumber) {
  const page = state.mineruInfo?.pdf_info?.[pageNumber - 1];
  if (!page) {
    return [];
  }
  const blocks = Array.isArray(page.para_blocks) ? page.para_blocks : [];
  const entries = blocks
    .map((block, blockIndex) => {
      const scopedBlock = filterBlockLines(block, (line) => !lineHasCrossPageContent(line));
      return {
        block,
        blockIndex,
        bbox: getBlockBBox(scopedBlock) || getBlockBBox(block),
        markdown: blockToMarkdown(scopedBlock),
        pageSize: page.page_size,
      };
    })
    .filter((entry) => !isLikelyPageHeaderEntry(entry));
  return sortEntriesByVisualReadingOrder(augmentTableCaptionsForEntries(entries, pageNumber));
}

function reviewSegmentsForPage(pageNumber) {
  return segmentEntries(mergeAdjacentPlainProseEntriesForReview(reviewBlockMarkdownsForPage(pageNumber), pageNumber));
}

function mergeAdjacentPlainProseEntriesForReview(entries, pageNumber = state.currentPage) {
  const output = [];
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const previous = output[output.length - 1];
    if (shouldMergeAdjacentPlainProseEntries(previous, entry, pageNumber)) {
      output[output.length - 1] = mergePlainProseEntries(previous, entry);
      return;
    }
    output.push(entry);
  });
  return output;
}

function shouldMergeAdjacentPlainProseEntries(previous, current, pageNumber = state.currentPage) {
  if (!previous || !current) {
    return false;
  }
  if (!isPlainProseReviewEntry(previous) || !isPlainProseReviewEntry(current)) {
    return false;
  }
  if (entryHasReviewPatchState(previous, pageNumber) || entryHasReviewPatchState(current, pageNumber)) {
    return false;
  }
  const geometry = adjacentProseGeometry(previous, current);
  if (!geometry?.sameColumn || geometry.verticalGap < -Math.max(4, geometry.minHeight * 0.25)) {
    return false;
  }
  if (geometry.verticalGap > geometry.maxGap) {
    return false;
  }
  if (geometry.currentIndented && previousEndsSentence(previous.markdown) && startsLikeNewSentence(current.markdown)) {
    return false;
  }
  return proseTextSuggestsContinuation(previous.markdown, current.markdown) || geometry.veryTight;
}

function isPlainProseReviewEntry(entry) {
  const markdown = String(entry?.markdown || "").replace(/\r\n?/g, "\n").trim();
  if (!markdown || markdown.includes("\n\n") || isLikelyBibliographyText(markdown)) {
    return false;
  }
  const blockType = String(entry?.block?.type || "").toLowerCase();
  if (["table", "image", "title", "list", "code", "algorithm", "interline_equation"].includes(blockType)) {
    return false;
  }
  if (
    hasMarkdownImageReference(markdown) ||
    hasDisplayMathBlock(markdown) ||
    hasLatexMathEnvironment(markdown) ||
    hasStandaloneEquationLine(markdown) ||
    hasUnwrappedScientificMathSymbolRisk(markdown) ||
    isLikelyMarkdownTableLine(markdown) ||
    /^#{1,6}\s+/.test(markdown) ||
    /^\s*[-*+]\s+/.test(markdown) ||
    /^\s*>\s?/.test(markdown) ||
    /<\s*(?:table|tr|td|th)\b/i.test(markdown)
  ) {
    return false;
  }
  return !isPageNumberOnlyText(markdown);
}

function entryHasReviewPatchState(entry, pageNumber = state.currentPage) {
  const blockIndexes = Array.isArray(entry?.blockIndexes) && entry.blockIndexes.length ? entry.blockIndexes : [entry?.blockIndex];
  return blockIndexes.some((blockIndex) => {
    const key = String(blockIndex ?? "");
    if (!key) {
      return false;
    }
    if (
      getBlockOverrides(pageNumber, false).has(key) ||
      getMathpixBlockDrafts(pageNumber, false).has(key) ||
      getLiveReviewDrafts(pageNumber, false).has(key) ||
      state.reviewNeedsCorrection.has(reviewBlockKey(pageNumber, key))
    ) {
      return true;
    }
    const latestPatch = getLatestOcrPatchForBlock(pageNumber, key, entry?.markdown || "");
    return Boolean(latestPatch && ["draft", "accepted"].includes(latestPatch.status));
  });
}

function adjacentProseGeometry(previous, current) {
  const left = bboxReadingGeometry(previous?.bbox, previous?.pageSize || current?.pageSize);
  const right = bboxReadingGeometry(current?.bbox, current?.pageSize || previous?.pageSize);
  if (!left || !right) {
    return null;
  }
  const horizontalOverlap = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const minWidth = Math.max(1, Math.min(left.width, right.width));
  const pageWidth = Math.max(left.pageWidth, right.pageWidth, 1);
  const pageHeight = Math.max(left.pageHeight, right.pageHeight, 1);
  const minHeight = Math.max(1, Math.min(left.height, right.height));
  const verticalGap = right.top - left.bottom;
  const maxGap = Math.max(6, pageHeight * 0.012, minHeight * 0.9);
  const indentThreshold = Math.max(14, pageWidth * 0.018);
  return {
    sameColumn: horizontalOverlap / minWidth >= 0.56,
    verticalGap,
    maxGap,
    minHeight,
    veryTight: verticalGap <= Math.max(4, minHeight * 0.35),
    currentIndented: right.left - left.left >= indentThreshold,
  };
}

function proseTextSuggestsContinuation(previousMarkdown, currentMarkdown) {
  const previous = lastNonEmptyLine(previousMarkdown);
  const current = firstNonEmptyLine(currentMarkdown);
  if (!previous || !current) {
    return false;
  }
  return (
    /[-‐‑‒–—]$/.test(previous) ||
    /[,;:，；：]$/.test(previous) ||
    !previousEndsSentence(previous) ||
    /^[a-zà-öø-ÿµμ]/.test(current) ||
    /^\(/.test(current) ||
    /^(?:and|or|but|because|which|that|where|with|by|of|to|in|on|for|as|from|than|then|while|under|assuming)\b/i.test(current)
  );
}

function previousEndsSentence(markdown) {
  return /[.!?。！？]["')\]}”’]*$/.test(lastNonEmptyLine(markdown));
}

function startsLikeNewSentence(markdown) {
  return /^[A-ZΑ-Ω"“‘]/.test(firstNonEmptyLine(markdown));
}

function firstNonEmptyLine(markdown) {
  return String(markdown || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function lastNonEmptyLine(markdown) {
  const lines = String(markdown || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

function mergePlainProseEntries(previous, current) {
  const componentEntries = componentEntriesForReviewSegment(previous).concat(componentEntriesForReviewSegment(current));
  const blockIndexes = componentEntries.map((entry) => entry.blockIndex);
  const firstIndex = blockIndexes[0];
  const lastIndex = blockIndexes[blockIndexes.length - 1];
  return {
    ...previous,
    block: { ...(previous?.block || {}), type: "text" },
    blockIndex: `merged-${firstIndex}-${lastIndex}`,
    blockIndexes,
    componentEntries,
    bbox: mergeBBoxes([previous?.bbox, current?.bbox]),
    markdown: [previous?.markdown, current?.markdown].map((text) => String(text || "").trim()).filter(Boolean).join("\n"),
    pageSize: previous?.pageSize || current?.pageSize,
    mergedPlainProse: true,
  };
}

function componentEntriesForReviewSegment(entry = {}) {
  if (Array.isArray(entry?.componentEntries) && entry.componentEntries.length) {
    return entry.componentEntries.map((component) => ({
      blockIndex: String(component.blockIndex ?? ""),
      markdown: String(component.markdown || ""),
      bbox: component.bbox || null,
      pageSize: component.pageSize || entry.pageSize || null,
    }));
  }
  const blockIndexes = Array.isArray(entry?.blockIndexes) && entry.blockIndexes.length ? entry.blockIndexes : [entry?.blockIndex];
  const firstBlockIndex = String(blockIndexes[0] ?? "");
  return blockIndexes
    .map((blockIndex) => ({
      blockIndex: String(blockIndex ?? ""),
      markdown: String(blockIndexes.length === 1 || String(blockIndex ?? "") === firstBlockIndex ? entry?.markdown || "" : ""),
      bbox: entry?.bbox || null,
      pageSize: entry?.pageSize || null,
    }))
    .filter((component) => component.blockIndex);
}

function augmentTableCaptionsForEntries(entries, pageNumber) {
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    if (entry?.block?.type !== "table") {
      return entry;
    }
    const currentMarkdown = String(entry.markdown || "");
    const label = tableLabelFromText(currentMarkdown);
    if (!label) {
      return entry;
    }
    const longerCaption = findLongerTableCaptionForEntry(pageNumber, label, currentMarkdown, entry);
    if (!longerCaption) {
      return entry;
    }
    const updatedMarkdown = replaceOrPrependTableCaption(currentMarkdown, label, longerCaption);
    return updatedMarkdown === currentMarkdown ? entry : { ...entry, markdown: updatedMarkdown };
  });
}

function findLongerTableCaptionForEntry(pageNumber, label, currentMarkdown, entry) {
  const currentCaption = leadingTableCaptionLine(currentMarkdown);
  const currentCanon = normalizeTextForComparison(currentCaption || label);
  const candidates = contentListItemsForPage(pageNumber)
    .map((item) => ({
      text: contentListTableCaptionText(item),
      bbox: normalizedBBox(item?.bbox),
    }))
    .filter((candidate) => tableLabelMatches(candidate.text, label));
  const entryBox = normalizedBBox(entry?.bbox);
  return candidates
    .map((candidate) => ({
      ...candidate,
      distance: bboxVerticalDistance(entryBox, candidate.bbox),
      canon: normalizeTextForComparison(candidate.text),
    }))
    .filter((candidate) => candidate.text.length > currentCaption.length + 8 && candidate.canon && !currentCanon.includes(candidate.canon))
    .sort((left, right) => left.distance - right.distance || right.text.length - left.text.length)[0]?.text || "";
}

function contentListTableCaptionText(item) {
  if (!item || typeof item !== "object") {
    return "";
  }
  const values = [];
  ["table_caption", "caption", "text"].forEach((key) => {
    const value = item[key];
    if (typeof value === "string") {
      values.push(value);
    } else if (Array.isArray(value)) {
      values.push(...value.map((entry) => (typeof entry === "string" ? entry : contentListItemText(entry))));
    }
  });
  return values.map((value) => String(value || "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" ").trim();
}

function tableLabelFromText(text) {
  const match = String(text || "").match(/\bTable\s*\.?\s*(\d+(?:\.\d+)*)\b/i);
  return match ? `Table ${match[1]}` : "";
}

function tableLabelMatches(text, label) {
  const normalizedLabel = tableLabelFromText(label);
  return Boolean(normalizedLabel && tableLabelFromText(text) === normalizedLabel);
}

function leadingTableCaptionLine(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => tableLabelFromText(line)) || "";
}

function replaceOrPrependTableCaption(markdown, label, caption) {
  const source = String(markdown || "").replace(/\r\n?/g, "\n").trim();
  const lines = source.split("\n");
  const captionIndex = lines.findIndex((line) => tableLabelFromText(line) === tableLabelFromText(label));
  if (captionIndex >= 0 && !isLikelyMarkdownTableLine(lines[captionIndex])) {
    lines[captionIndex] = caption;
    return lines.join("\n").trim();
  }
  return `${caption}\n\n${source}`.trim();
}

function bboxVerticalDistance(left, right) {
  const a = normalizedBBox(left);
  const b = normalizedBBox(right);
  if (!a || !b) {
    return Number.MAX_SAFE_INTEGER;
  }
  if (a[3] < b[1]) {
    return b[1] - a[3];
  }
  if (b[3] < a[1]) {
    return a[1] - b[3];
  }
  return 0;
}

function segmentEntries(entries) {
  const segments = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    if (!isAlgorithmStartEntry(entry)) {
      segments.push({
        ...entry,
        id: String(entry.blockIndex),
        blockIndex: String(entry.blockIndex),
        blockIndexes: [entry.blockIndex],
        kind: entry.block?.type || "block",
      });
      index += 1;
      continue;
    }

    const group = [];
    let depth = 0;
    let sawEnd = false;
    while (index < entries.length) {
      const current = entries[index];
      const cleaned = entryAlgorithmText(current);
      group.push(current);
      if (/^for\b/i.test(cleaned)) {
        depth += 1;
      }
      if (/^end\b/i.test(cleaned)) {
        depth = Math.max(0, depth - 1);
        sawEnd = true;
      }
      index += 1;
      if (sawEnd && depth === 0 && !isAlgorithmStartEntry(entries[index])) {
        break;
      }
    }

    const first = group[0].blockIndex;
    const last = group[group.length - 1].blockIndex;
    segments.push({
      id: `algo-${first}-${last}`,
      blockIndex: `algo-${first}-${last}`,
      blockIndexes: group.map((item) => item.blockIndex),
      bbox: mergeBBoxes(group.map((item) => item.bbox)),
      markdown: group.map((item) => item.markdown).filter(Boolean).join("\n"),
      pageSize: group[0].pageSize,
      kind: "algorithm",
    });
  }
  return segments;
}

function sortEntriesByVisualReadingOrder(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => ({ entry, index, geometry: bboxReadingGeometry(entry?.bbox, entry?.pageSize) }))
    .sort((left, right) => {
      if (!left.geometry || !right.geometry) {
        return left.geometry ? -1 : right.geometry ? 1 : left.index - right.index;
      }
      const rowGap = left.geometry.top - right.geometry.top;
      const rowTolerance = Math.max(left.geometry.height, right.geometry.height, left.geometry.pageHeight * 0.018, 18);
      if (Math.abs(rowGap) > rowTolerance) {
        return rowGap;
      }
      return left.geometry.left - right.geometry.left || left.index - right.index;
    })
    .map((item) => item.entry);
}

function bboxReadingGeometry(bbox, pageSize) {
  const normalized = normalizedBBox(bbox);
  if (!normalized) {
    return null;
  }
  return {
    left: normalized[0],
    top: normalized[1],
    right: normalized[2],
    bottom: normalized[3],
    width: Math.max(1, normalized[2] - normalized[0]),
    height: Math.max(1, normalized[3] - normalized[1]),
    pageWidth: pageSizeWidth(pageSize) || Math.max(1, normalized[2]),
    pageHeight: pageSizeHeight(pageSize) || Math.max(1, normalized[3]),
  };
}

function filterBlockLines(block, includeLine) {
  if (!block || typeof block !== "object") {
    return block;
  }
  const output = { ...block };
  delete output.bbox;
  delete output.bbox_fs;
  if (Array.isArray(block.lines)) {
    output.lines = block.lines
      .filter((line) => includeLine(line))
      .map((line) => ({ ...line, spans: Array.isArray(line.spans) ? line.spans.slice() : [] }));
  }
  if (Array.isArray(block.blocks)) {
    output.blocks = block.blocks.map((nested) => filterBlockLines(nested, includeLine));
  }
  return output;
}

function lineHasCrossPageContent(line) {
  if (!line || typeof line !== "object") {
    return false;
  }
  if (line.cross_page === true) {
    return true;
  }
  return (Array.isArray(line.spans) ? line.spans : []).some((span) => span?.cross_page === true);
}

function isLikelyPageHeaderEntry(entry) {
  const value = String(entry?.markdown || "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return isLikelyReferenceHeading(value) || isLikelyPageHeaderText(value, entry?.bbox, entry?.pageSize);
}

function isLikelyPageHeaderText(text, bbox, pageSize) {
  const value = String(text || "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value || value.length > 120) {
    return false;
  }
  const geometry = bboxGeometryForPageSize(bbox, pageSize);
  if (!geometry || geometry.bottomRatio > 0.13) {
    return false;
  }
  if (isPageNumberOnlyText(value)) {
    return true;
  }
  if (isLikelyReferenceHeading(value)) {
    return true;
  }
  if (/[\$\\]|[.!?。！？]$/.test(value)) {
    return false;
  }
  const explicitHeader = [
    /^\d{1,4}\s+\d+(?:\.\d+)+\s+\S/,
    /^\d+(?:\.\d+)+\s+[A-ZÀ-Þ][\p{L}\p{N}\s.,:;'"’()/-]{2,}$/u,
    /^[A-ZÀ-Þ][\p{L}\p{N}\s.,:;'"’()/-]{2,}\s+\d{1,4}$/u,
  ].some((pattern) => pattern.test(value));
  if (explicitHeader) {
    return true;
  }
  if (geometry.bottomRatio > 0.08) {
    return false;
  }
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 12) {
    return false;
  }
  const capitalized = words.filter((word) => /^[A-ZÀ-Þ0-9]/.test(word) || /^(and|of|the|in|for|to|with|on)$/i.test(word)).length;
  return capitalized / words.length >= 0.82;
}

function isAlgorithmStartEntry(entry) {
  const text = entryAlgorithmText(entry);
  if (!/^for\b/i.test(text) || looksLikeNaturalLanguageCodeFence(entry?.markdown)) {
    return false;
  }
  if (entry?.block?.type === "code" || entry?.block?.type === "algorithm") {
    return true;
  }
  return looksLikeAlgorithmForLine(text);
}

function entryAlgorithmText(entry) {
  return cleanAlgorithmLine(
    String(entry?.markdown || "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .filter((line) => line.trim() && line.trim() !== "$$")
      .join(" ")
  );
}

function looksLikeAlgorithmForLine(line) {
  const value = String(line || "").trim();
  if (!/^for\b/i.test(value)) {
    return false;
  }
  if (/^for\s+(?:the|a|an|these|those|this|example|recent|detailed|large|small|such)\b/i.test(value)) {
    return false;
  }
  return /[:;]|(?:^|\s)(?:in|from|to|do)\s+\S/i.test(value) && /[=<>_{}()[\]]|\\[A-Za-z]+|\bend\b/i.test(value);
}

function mergeBBoxes(boxes) {
  const valid = boxes.filter((box) => Array.isArray(box) && box.length >= 4);
  if (!valid.length) {
    return null;
  }
  return [
    Math.min(...valid.map((box) => box[0])),
    Math.min(...valid.map((box) => box[1])),
    Math.max(...valid.map((box) => box[2])),
    Math.max(...valid.map((box) => box[3])),
  ];
}

function getBlockOverrides(pageNumber, create = true) {
  if (!state.mineruBlockOverrides.has(pageNumber) && create) {
    state.mineruBlockOverrides.set(pageNumber, new Map());
  }
  return state.mineruBlockOverrides.get(pageNumber) || new Map();
}

function getMathpixBlockDrafts(pageNumber, create = true) {
  if (!state.mathpixBlockDrafts.has(pageNumber) && create) {
    state.mathpixBlockDrafts.set(pageNumber, new Map());
  }
  return state.mathpixBlockDrafts.get(pageNumber) || new Map();
}

function getLiveReviewDrafts(pageNumber, create = true) {
  if (!state.liveReviewDrafts.has(pageNumber) && create) {
    state.liveReviewDrafts.set(pageNumber, new Map());
  }
  return state.liveReviewDrafts.get(pageNumber) || new Map();
}

function clearLiveReviewDraftForBlock(pageNumber, blockIndex) {
  const drafts = getLiveReviewDrafts(pageNumber, false);
  return drafts.delete(String(blockIndex || ""));
}

function createLegacyBlockPatchContext(pageNo, blockIndex, oldText) {
  const hashBlockText = getOcrCoreHashBlockText();
  if (!hashBlockText) {
    warnOcrCorePatch("hashBlockText 不可用，无法生成 OCR draft patch。");
    return null;
  }
  const oldHash = hashBlockText(oldText);
  // TODO: migrate provisional UI blockId to blockParser.createStableBlockId() once OCR compare uses OcrBlock records.
  return {
    pageNo,
    blockIndex,
    blockId: `p${pageNo}_b${blockIndex}_${oldHash.slice(0, 8)}`,
    oldHash,
  };
}

function createAndStoreDraftOcrPatch({ pageNo, blockIndex, oldText, newText, source, preserveText = "" }) {
  const context = createLegacyBlockPatchContext(pageNo, blockIndex, oldText);
  const createOcrPatch = getOcrCoreCreateOcrPatch();
  const preservationSource = [oldText, preserveText].filter(Boolean).join("\n\n");
  const normalizedNewText = source === "mathpix" ? normalizeMathpixOcrArtifacts(newText) : String(newText || "");
  const completeNewText = preserveMathpixPlainTextCompleteness(oldText, normalizedNewText, source);
  const captionPreservedText = source === "mathpix"
    ? preserveTableCaptionFromOriginal(preservationSource, completeNewText)
    : completeNewText;
  const preservedNewText = source === "mathpix"
    ? normalizeMathpixOcrArtifacts(preserveEquationNumbersFromOriginal(preservationSource, captionPreservedText))
    : preserveEquationNumbersFromOriginal(preservationSource, completeNewText);
  if (!context || !createOcrPatch) {
    warnOcrCorePatch("createOcrPatch 不可用，已跳过 OCR draft patch 记录。");
    return {
      patch: null,
      normalizedText: preservedNewText,
      renderValidation: { severity: "warning" },
    };
  }

  const normalizedText = normalizeDraftPatchMarkdown(context.blockId, preservedNewText);
  const renderValidation = validateDraftPatchRenderability(context.blockId, normalizedText);
  const patch = createOcrPatch({
    blockId: context.blockId,
    oldText: String(oldText || ""),
    newText: normalizedText,
    source,
    status: "draft",
    metadata: {
      pageNo: Number(pageNo) || 0,
      renderStatusAfter: renderValidation.severity,
    },
  });
  state.ocrPatches = state.ocrPatches || [];
  state.ocrPatches.push(patch);
  saveOcrWorkspaceState();
  return { patch, normalizedText, renderValidation };
}

function preserveTableCaptionFromOriginal(oldText, newText) {
  const originalCaption = longestTableCaptionLine(oldText);
  if (!originalCaption) {
    return String(newText || "");
  }
  const output = String(newText || "").replace(/\r\n?/g, "\n").trim();
  if (!output) {
    return output;
  }
  const originalLabel = tableLabelFromText(originalCaption);
  const currentCaption = leadingTableCaptionLine(output);
  if (currentCaption && tableLabelFromText(currentCaption) === originalLabel) {
    if (currentCaption.length >= originalCaption.length - 8) {
      return output;
    }
    return output.replace(currentCaption, originalCaption);
  }
  if (hasMarkdownTable(output) || /<\s*table\b/i.test(output)) {
    return `${originalCaption}\n\n${output}`.trim();
  }
  return output;
}

function longestTableCaptionLine(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => tableLabelFromText(line))
    .sort((left, right) => right.length - left.length)[0] || "";
}

function hasMarkdownTable(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (isMarkdownTableStart(lines, index)) {
      return true;
    }
  }
  return false;
}

function preserveEquationNumbersFromOriginal(oldText, newText) {
  let output = normalizeVisibleEquationNumberAsLatexTag(newText);
  if (!output.trim()) {
    return output;
  }
  output = preserveMarkdownImageReferencesFromOriginal(oldText, output);
  output = preserveReferenceLabelsFromOriginal(oldText, output);
  output = preserveLatexTagsFromOriginal(oldText, output);
  const originalNumbers = extractEquationNumbers(oldText);
  if (!originalNumbers.length) {
    return output;
  }
  const existingNumbers = new Set(extractEquationNumbers(output));
  const missingNumbers = originalNumbers.filter((number) => !existingNumbers.has(number));
  if (!missingNumbers.length) {
    return output;
  }
  output = stripGeneratedSequentialEquationNumbers(output);
  return missingNumbers.reduce((current, number) => insertEquationNumberIntoDisplayMath(current, number), output);
}

function replaceGeneratedEquationTagsWithOriginal(markdown, originalText) {
  const originalNumbers = extractEquationNumbers(originalText);
  if (!originalNumbers.length) {
    return String(markdown || "");
  }
  let output = String(markdown || "");
  const generatedTagPattern = /\\tag\{\s*\d+\s*\}/g;
  if (generatedTagPattern.test(output)) {
    let index = 0;
    output = output.replace(generatedTagPattern, (match) => {
      const next = originalNumbers[index] || originalNumbers[originalNumbers.length - 1];
      index += 1;
      const number = String(next || "").replace(/[()\s]/g, "");
      return number ? `\\tag{${number}}` : match;
    });
  }
  const withoutGeneratedVisibleNumbers = stripGeneratedSequentialEquationNumbers(output);
  if (withoutGeneratedVisibleNumbers !== output) {
    output = withoutGeneratedVisibleNumbers;
  }
  return originalNumbers.reduce((current, number) => insertEquationNumberIntoDisplayMath(current, number), output);
}

function stripGeneratedSequentialEquationNumbers(markdown) {
  let output = String(markdown || "");
  output = output.replace(/(\\end\{(?:equation|align|aligned|array|cases|matrix|pmatrix|bmatrix|gather|split|multline)\*?\})(\s*(?:\$\$|\\\])?)\s*\(\s*\d+\s*\)(?=\s|$)/g, "$1$2");
  output = output.replace(/(\$\$|\\\])\s*\(\s*\d+\s*\)(?=\s|$)/g, "$1");
  return output;
}

function normalizeVisibleEquationNumberAsLatexTag(markdown) {
  let output = String(markdown || "");
  if (!hasLatexMathEnvironment(output) || extractLatexTags(output).length) {
    return output;
  }
  const trailingNumberPattern = /(\\end\{(?:equation|align|aligned|array|cases|matrix|pmatrix|bmatrix|gather|split|multline)\*?\})(\s*(?:\$\$|\\\])?)\s*(\(\s*\d+(?:\s*\.\s*\d+)+[a-zA-Z]?\s*\))(?=\s|$)/;
  const match = output.match(trailingNumberPattern);
  if (!match) {
    return output;
  }
  const number = match[3].replace(/[()\s]/g, "");
  return output.replace(trailingNumberPattern, `$1\\tag{${number}}$2`);
}

function insertEquationNumberIntoDisplayMath(markdown, equationNumber) {
  const output = String(markdown || "");
  const number = String(equationNumber || "").replace(/[()\s]/g, "");
  if (!number || output.includes(`\\tag{${number}}`)) {
    return output;
  }
  const endEnvironmentPattern = /\\end\{(?:equation|align|aligned|array|cases|matrix|pmatrix|bmatrix|gather|split|multline)\*?\}/g;
  const matches = Array.from(output.matchAll(endEnvironmentPattern));
  const last = matches[matches.length - 1];
  if (last && typeof last.index === "number") {
    const environmentEnd = last[0];
    const afterEnvironment = last.index + environmentEnd.length;
    return `${output.slice(0, afterEnvironment)}\\tag{${number}}${output.slice(afterEnvironment)}`;
  }
  const displayClose = findLastDisplayMathClose(output);
  if (displayClose) {
    return `${output.slice(0, displayClose.index).trimEnd()}\\tag{${number}}\n${output.slice(displayClose.index)}`;
  }
  return `${output.trimEnd()} (${number})`;
}

function findLastDisplayMathClose(markdown) {
  const text = String(markdown || "");
  const dollarIndex = text.lastIndexOf("$$");
  const bracketIndex = text.lastIndexOf("\\]");
  if (dollarIndex < 0 && bracketIndex < 0) {
    return null;
  }
  if (dollarIndex > bracketIndex) {
    return { index: dollarIndex, token: "$$" };
  }
  return { index: bracketIndex, token: "\\]" };
}

function preserveMathpixPlainTextCompleteness(oldText, newText, source) {
  if (source !== "mathpix") {
    return String(newText || "");
  }
  const oldValue = String(oldText || "").replace(/\r\n?/g, "\n").trim();
  const newValue = String(newText || "").replace(/\r\n?/g, "\n").trim();
  if (!oldValue || !newValue || !isPlainProseForCompletenessGuard(oldValue) || !isPlainProseForCompletenessGuard(newValue)) {
    return String(newText || "");
  }
  const oldWords = proseWordsForCompleteness(oldValue);
  const newWords = proseWordsForCompleteness(newValue);
  if (oldWords.length < 10 || newWords.length >= Math.floor(oldWords.length * 0.78)) {
    return String(newText || "");
  }
  const appended = appendMissingPlainTextTail(oldValue, newValue, oldWords, newWords);
  return appended || oldValue;
}

function isPlainProseForCompletenessGuard(markdown) {
  const text = String(markdown || "");
  return (
    !hasMarkdownImageReference(text) &&
    !hasLatexMathEnvironment(text) &&
    !hasDisplayMathBlock(text) &&
    !/(^|\n)\s*```/.test(text) &&
    !/<\s*(?:table|tr|td|th)\b/i.test(text)
  );
}

function proseWordsForCompleteness(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function appendMissingPlainTextTail(oldText, newText, oldWords, newWords) {
  if (!oldWords.length || !newWords.length) {
    return "";
  }
  let bestEnd = -1;
  const maxStart = Math.min(oldWords.length - 1, newWords.length + 3);
  for (let oldIndex = 0; oldIndex <= maxStart; oldIndex += 1) {
    let matched = 0;
    while (oldWords[oldIndex + matched] && newWords[matched] && oldWords[oldIndex + matched] === newWords[matched]) {
      matched += 1;
    }
    if (matched >= Math.min(5, newWords.length)) {
      bestEnd = oldIndex + newWords.length;
      break;
    }
  }
  if (bestEnd <= 0 || bestEnd >= oldWords.length) {
    return "";
  }
  const oldTokens = String(oldText || "").replace(/\s+/g, " ").trim().split(/\s+/);
  const missingTail = oldTokens.slice(bestEnd).join(" ").trim();
  if (!missingTail) {
    return "";
  }
  return `${String(newText || "").trim()} ${missingTail}`.trim();
}

function preserveMarkdownImageReferencesFromOriginal(oldText, newText) {
  const originalImages = extractMarkdownImageReferences(oldText);
  if (!originalImages.length) {
    return String(newText || "");
  }
  const output = String(newText || "");
  const existingSrcs = new Set(extractMarkdownImageReferences(output).map((image) => image.src));
  const missingImages = originalImages.filter((image) => !existingSrcs.has(image.src));
  if (!missingImages.length) {
    return output;
  }
  return `${missingImages.map((image) => image.raw).join("\n")}\n\n${output.trimStart()}`;
}

function preserveReferenceLabelsFromOriginal(oldText, newText) {
  const originalLabels = extractReferenceLabels(oldText);
  if (!originalLabels.length) {
    return String(newText || "");
  }
  const output = String(newText || "");
  const existingLabels = new Set(extractReferenceLabels(output).map(normalizeReferenceLabel));
  const missingLabels = originalLabels.filter((label) => !existingLabels.has(normalizeReferenceLabel(label)));
  if (!missingLabels.length) {
    return output;
  }
  return insertAfterLeadingMarkdownImages(output, missingLabels.join(" "));
}

function extractReferenceLabels(text) {
  const pattern = /\b(?:Fig\.?|Figure|Table|Eq\.?|Equation)\s*\(?\d+(?:\.\d+)*[a-zA-Z]?\)?/gi;
  return Array.from(new Set((String(text || "").match(pattern) || []).map((label) => label.replace(/\s+/g, " ").trim())));
}

function normalizeReferenceLabel(label) {
  return String(label || "").replace(/\s+/g, "").replace(/\.$/, "").toLowerCase();
}

function preserveLatexTagsFromOriginal(oldText, newText) {
  const originalTags = extractLatexTags(oldText);
  if (!originalTags.length) {
    return String(newText || "");
  }
  const output = String(newText || "");
  const existingTags = new Set(extractLatexTags(output));
  const missingTags = originalTags.filter((tag) => !existingTags.has(tag));
  if (!missingTags.length) {
    return output;
  }
  return `${output.trimEnd()} ${missingTags.join(" ")}`;
}

function extractLatexTags(text) {
  return Array.from(new Set(String(text || "").match(/\\tag\{[^}]+\}/g) || []));
}

function insertAfterLeadingMarkdownImages(markdown, insertedText) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length && (!lines[index].trim() || isStandaloneMarkdownImageLine(lines[index]))) {
    index += 1;
  }
  const before = lines.slice(0, index).join("\n").trimEnd();
  const after = lines.slice(index).join("\n").trimStart();
  return `${before ? `${before}\n\n` : ""}${insertedText}${after ? `\n\n${after}` : ""}`;
}

function extractEquationNumbers(text) {
  const matches = String(text || "").match(/\(\s*\d+(?:\s*\.\s*\d+)+[a-zA-Z]?\s*\)/g) || [];
  return Array.from(new Set(matches.map((number) => number.replace(/\s+/g, ""))));
}

function getLatestOcrPatchForBlock(pageNo, blockIndex, oldText) {
  const context = createLegacyBlockPatchContext(pageNo, blockIndex, oldText);
  if (!context) {
    return null;
  }
  const patches = Array.isArray(state.ocrPatches) ? state.ocrPatches : [];
  for (let index = patches.length - 1; index >= 0; index -= 1) {
    const patch = patches[index];
    if (patch?.blockId === context.blockId) {
      return patch;
    }
  }
  const blockIdPrefix = `p${pageNo}_b${blockIndex}_`;
  for (let index = patches.length - 1; index >= 0; index -= 1) {
    const patch = patches[index];
    if (Number(patch?.metadata?.pageNo) === Number(pageNo) && String(patch?.blockId || "").startsWith(blockIdPrefix)) {
      return patch;
    }
  }
  return null;
}

function updateOcrPatchStatus(patchId, nextStatus) {
  const targetStatus = String(nextStatus || "");
  if (!["accepted", "rejected"].includes(targetStatus)) {
    warnOcrPatchStatus(`不支持的 OCR patch 状态切换：${targetStatus || "(empty)"}`);
    return { ok: false, reason: "unsupported_status", patch: null };
  }

  const patches = Array.isArray(state.ocrPatches) ? state.ocrPatches : [];
  const patch = patches.find((item) => item?.patchId === patchId);
  if (!patch) {
    warnOcrPatchStatus(`找不到 OCR patch：${patchId || "(empty)"}`);
    return { ok: false, reason: "not_found", patch: null };
  }

  if (patch.status !== "draft") {
    const reason = patch.status === "noop" ? "noop_not_transitionable" : "status_not_transitionable";
    warnOcrPatchStatus(`OCR patch 当前状态为 ${patch.status || "(empty)"}，不能切换为 ${targetStatus}。`);
    return { ok: false, reason, patch };
  }

  patch.status = targetStatus;
  patch.updatedAt = new Date().toISOString();
  saveOcrWorkspaceState();
  return { ok: true, reason: "", patch };
}

function warnOcrPatchStatus(message) {
  if (typeof console === "undefined" || typeof console.warn !== "function") {
    return;
  }
  console.warn(`[OCR Patch] ${message}`);
}

function buildAcceptedPatchPreviewForPage(pageNo) {
  const pageNumber = Number(pageNo) || 0;
  const mergeAcceptedPatches = getOcrCoreMergeAcceptedPatches();
  const hashBlockText = getOcrCoreHashBlockText();
  const acceptedPatches = acceptedOcrPatchesForPage(pageNumber);
  const sourceSegments = reviewSegmentsForPage(pageNumber);
  const previewPatches = acceptedPatchesWithEquationNumberFallback(pageNumber, acceptedPatches, sourceSegments);
  const fallbackMarkdown = sourceSegments.map((segment) => String(segment.markdown || "").replace(/\r\n?/g, "\n")).filter(Boolean).join("\n\n");

  if (!mergeAcceptedPatches || !hashBlockText) {
    return {
      ok: false,
      pageNo: pageNumber,
      markdown: fallbackMarkdown,
      appliedPatchCount: 0,
      errors: [],
      warnings: [
        {
          type: "patch_tool_unavailable",
          message: "OCR patch merge tool is not available for dry-run preview.",
        },
      ],
    };
  }

  const orderByKey = new Map(sourceSegments.map((segment, index) => [String(segment.blockIndex), index]));
  const previewSegments = syntheticSegmentsForAcceptedPatches(pageNumber, acceptedPatches, hashBlockText)
    .concat(sourceSegments)
    .sort((left, right) => acceptedPreviewSegmentOrder(left, orderByKey) - acceptedPreviewSegmentOrder(right, orderByKey));
  const blocks = previewSegments.map((segment) => {
    const rawText = String(segment.markdown || "").replace(/\r\n?/g, "\n");
    const oldHash = hashBlockText(rawText);
    return {
      blockId: `p${pageNumber}_b${segment.blockIndex}_${oldHash.slice(0, 8)}`,
      text: rawText,
      segment,
    };
  });
  const result = mergeAcceptedPatches({
    blocks,
    patches: previewPatches,
  });
  const errors = Array.isArray(result?.errors) ? result.errors : [];
  const warnings = Array.isArray(result?.warnings) ? result.warnings.slice() : [];
  if (!acceptedPatches.length) {
    warnings.unshift({
      type: "no_accepted_patch",
      message: "当前页没有 accepted patch。",
    });
  }
  const segmentByBlockId = new Map(blocks.map((block) => [block.blockId, block.segment]));
  const mergedBlocks = (Array.isArray(result?.mergedBlocks) ? result.mergedBlocks : blocks).map((block) => {
    const rawText = String(block?.text || "");
    const segment = segmentByBlockId.get(String(block?.blockId || ""));
    const numberedText = autoCorrectMathEquationNumberMarkdown(pageNumber, segment?.blockIndex, rawText, segment) || rawText;
    const text = autoCorrectKnownEquationOcrMarkdown(numberedText);
    return {
      ...block,
      text,
    };
  });
  return {
    ok: errors.length === 0,
    pageNo: pageNumber,
    markdown: mergedBlocks.map((block) => String(block?.text || "")).filter(Boolean).join("\n\n"),
    appliedPatchCount: countAppliedAcceptedPatches(previewPatches, blocks, errors, warnings),
    errors,
    warnings,
  };
}

function acceptedPatchesWithEquationNumberFallback(pageNo, acceptedPatches, sourceSegments) {
  const segmentByBlock = new Map((Array.isArray(sourceSegments) ? sourceSegments : []).map((segment) => [String(segment.blockIndex), segment]));
  return (Array.isArray(acceptedPatches) ? acceptedPatches : []).map((patch) => {
    const blockIndex = ocrPatchBlockIndex(patch);
    const segment = segmentByBlock.get(blockIndex) || null;
    const patchedMarkdown = autoCorrectMathEquationNumberMarkdown(pageNo, blockIndex, patch?.newText || "", segment);
    const sourceMarkdown = patchedMarkdown || String(patch?.newText || "");
    const knownMarkdown = autoCorrectKnownEquationOcrMarkdown(sourceMarkdown);
    if (!patchedMarkdown && knownMarkdown === sourceMarkdown.replace(/\r\n?/g, "\n").trim()) {
      return patch;
    }
    return {
      ...patch,
      newText: knownMarkdown,
      metadata: {
        ...(patch.metadata || {}),
        ...(patchedMarkdown ? { previewEquationNumberFallback: true } : {}),
        ...(knownMarkdown !== sourceMarkdown.replace(/\r\n?/g, "\n").trim() ? { previewKnownEquationFallback: true } : {}),
      },
    };
  });
}

function ocrPatchBlockIndex(patch) {
  const blockId = String(patch?.blockId || "");
  const match = blockId.match(/^p\d+_b([^_]+)_/);
  return match ? match[1] : "";
}

function acceptedPreviewSegmentOrder(segment, orderByKey) {
  if (segment?.syntheticPlacement === "page_top") {
    return -2000;
  }
  if (segment?.syntheticPlacement === "page_bottom") {
    return Number.MAX_SAFE_INTEGER - 500;
  }
  return orderByKey.get(String(segment?.blockIndex)) ?? Number.MAX_SAFE_INTEGER / 2;
}

function syntheticSegmentsForAcceptedPatches(pageNumber, acceptedPatches, hashBlockText) {
  if (!acceptedPatches.length || typeof hashBlockText !== "function") {
    return [];
  }
  const acceptedBlockIds = new Set(acceptedPatches.map((patch) => patch?.blockId).filter(Boolean));
  return detectSupplementalRiskCandidatesForPage(pageNumber)
    .map((risk) => {
      const markdown = String(risk.text || "").replace(/\r\n?/g, "\n");
      const oldHash = hashBlockText(markdown);
      return {
        blockIndex: risk.blockIndex,
        markdown,
        kind: "synthetic",
        syntheticPlacement: risk.syntheticPlacement,
        blockId: `p${pageNumber}_b${risk.blockIndex}_${oldHash.slice(0, 8)}`,
      };
    })
    .filter((segment) => acceptedBlockIds.has(segment.blockId));
}

function buildAcceptedPatchPreviewForBook() {
  const total = getMineruPageCount();
  const acceptedPatchCount = (Array.isArray(state.ocrPatches) ? state.ocrPatches : []).filter((patch) => patch?.status === "accepted").length;
  const pageSummaries = [];
  const errors = [];
  const warnings = [];
  const pages = [];
  let appliedPatchCount = 0;
  let allPagesOk = true;

  for (let pageNo = 1; pageNo <= total; pageNo += 1) {
    const pagePreview = buildAcceptedPatchPreviewForPage(pageNo);
    allPagesOk = allPagesOk && Boolean(pagePreview.ok);
    const pageErrors = withIssuePageNo(pagePreview.errors, pageNo);
    const pageWarnings = withIssuePageNo(
      (pagePreview.warnings || []).filter((warning) => warning?.type !== "no_accepted_patch"),
      pageNo,
    );
    errors.push(...pageErrors);
    warnings.push(...pageWarnings);
    appliedPatchCount += Number(pagePreview.appliedPatchCount) || 0;
    pageSummaries.push({
      pageNo,
      appliedPatchCount: Number(pagePreview.appliedPatchCount) || 0,
      warningCount: pageWarnings.length,
      errorCount: pageErrors.length,
    });
    pages.push(`<!-- page: ${pageNo} -->\n\n${pagePreview.markdown || ""}`.trim());
  }

  if (!total) {
    warnings.push({
      type: "no_mineru_pages",
      message: "没有可预览的 MinerU 页面。",
    });
  }
  if (!acceptedPatchCount) {
    warnings.unshift({
      type: "no_accepted_patch",
      message: "整书没有 accepted patch。",
    });
  }

  return {
    ok: allPagesOk && errors.length === 0,
    markdown: `${pages.join("\n\n---\n\n")}${pages.length ? "\n" : ""}`,
    pageSummaries,
    appliedPatchCount,
    acceptedPatchCount,
    skippedPatchCount: Math.max(0, acceptedPatchCount - appliedPatchCount),
    errors,
    warnings,
  };
}

function getAcceptedCorrectedDownloadStatus() {
  const preview = buildAcceptedPatchPreviewForBook();
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
  const errors = Array.isArray(preview?.errors) ? preview.errors : [];
  const acceptedPatchCount = Number(preview?.acceptedPatchCount) || 0;
  const appliedPatchCount = Number(preview?.appliedPatchCount) || 0;
  const warningCount = warnings.length;
  const errorCount = errors.length;
  const firstErrorType = errors[0]?.type || "";
  const firstWarningType = warnings[0]?.type || "";
  let status = "ready";
  let canDownload = true;
  let message = "accepted 校正稿可下载";

  if (!acceptedPatchCount) {
    status = "empty";
    canDownload = false;
    message = "当前没有 accepted patch，无法生成 accepted 校正稿";
  } else if (!preview?.ok || errorCount) {
    status = "blocked";
    canDownload = false;
    message = firstErrorType ? `存在阻塞问题，不能下载：${firstErrorType}` : "存在阻塞问题，不能下载";
  } else if (warningCount) {
    status = "warning-only";
    canDownload = true;
    message = `可下载，但存在 ${warningCount} 个 warning`;
  }

  return {
    status,
    canDownload,
    message,
    acceptedPatchCount,
    appliedPatchCount,
    warningCount,
    errorCount,
    firstErrorType,
    firstWarningType,
    preview,
  };
}

function downloadAcceptedCorrectedMarkdown() {
  const status = getAcceptedCorrectedDownloadStatus();
  const preview = status.preview;
  state.acceptedPatchBookPreview = null;
  if (!status.canDownload) {
    return {
      ok: false,
      reason: status.status === "empty" ? "no_accepted_patch" : "preview_not_ok",
      status,
      preview,
    };
  }

  const markdown = `${acceptedPatchDownloadHeader()}\n\n${preview.markdown || ""}`;
  return downloadAcceptedCorrectedPayload(markdown, status, preview);
}

async function downloadAcceptedCorrectedPackage() {
  const status = getAcceptedCorrectedDownloadStatus();
  const preview = status.preview;
  state.acceptedPatchBookPreview = null;
  if (!status.canDownload) {
    return {
      ok: false,
      reason: status.status === "empty" ? "no_accepted_patch" : "preview_not_ok",
      status,
      preview,
    };
  }

  const markdown = `${acceptedPatchDownloadHeader()}\n\n${preview.markdown || ""}`;
  const imageAssets = await collectAcceptedCorrectedImageAssetsAsync(markdown);
  return downloadAcceptedCorrectedPayload(markdown, status, preview, { imageAssets });
}

function downloadAcceptedCorrectedPayload(markdown, status, preview, options = {}) {
  const imageAssets = collectAcceptedCorrectedImageAssets(markdown, options);
  if (imageAssets.length) {
    const packagedMarkdown = rewriteAcceptedCorrectedImageReferences(markdown, imageAssets);
    const markdownFilename = `${baseExportName()}-accepted-corrected.md`;
    const zipFilename = `${baseExportName()}-accepted-corrected.zip`;
    const zipBytes = buildStoredZip([
      { path: markdownFilename, bytes: stringToUtf8Bytes(packagedMarkdown) },
      ...imageAssets.map((asset) => ({ path: asset.path, bytes: asset.bytes })),
    ]);
    downloadBinaryFile(zipFilename, zipBytes, "application/zip");
    return {
      ok: true,
      reason: "",
      filename: zipFilename,
      format: "zip",
      markdown: packagedMarkdown,
      originalMarkdown: markdown,
      imageCount: imageAssets.length,
      images: imageAssets.map((asset) => ({ src: asset.src, path: asset.path })),
      status,
      preview,
    };
  }

  const filename = `${baseExportName()}-accepted-corrected.md`;
  downloadTextFile(filename, markdown);
  return {
    ok: true,
    reason: "",
    filename,
    format: "markdown",
    markdown,
    imageCount: 0,
    images: [],
    status,
    preview,
  };
}

async function collectAcceptedCorrectedImageAssetsAsync(markdown) {
  const directAssets = collectAcceptedCorrectedImageAssets(markdown);
  const covered = new Set(directAssets.map((asset) => asset.src));
  const missingRefs = uniqueMarkdownImageReferences(markdown).filter((image) => !covered.has(normalizeImageSource(image.src)));
  if (!missingRefs.length) {
    return directAssets;
  }
  const croppedAssets = await collectPdfCroppedImageAssetsForReferences(missingRefs);
  return directAssets.concat(croppedAssets);
}

function collectAcceptedCorrectedImageAssets(markdown, options = {}) {
  const providedAssets = normalizeProvidedImageAssets(options.imageAssets);
  const refs = uniqueMarkdownImageReferences(markdown);
  const usedPaths = new Set();
  const assets = [];
  refs.forEach((image, index) => {
    const src = normalizeImageSource(image.src);
    if (!src) {
      return;
    }
    const provided = providedAssets.get(src);
    const readable = provided || readImageReferenceAsset(src);
    if (!readable?.bytes?.length) {
      return;
    }
    const mime = readable.mime || imageMimeFromSource(src) || "application/octet-stream";
    assets.push({
      src,
      path: allocateAcceptedImagePath(readable.path || src, mime, usedPaths),
      bytes: toUint8Array(readable.bytes),
      mime,
    });
  });
  return assets;
}

function normalizeProvidedImageAssets(imageAssets) {
  const bySource = new Map();
  (Array.isArray(imageAssets) ? imageAssets : []).forEach((asset) => {
    const src = normalizeImageSource(asset?.src);
    const bytes = toUint8Array(asset?.bytes);
    if (!src || !bytes.length) {
      return;
    }
    bySource.set(src, {
      src,
      path: asset.path || "",
      bytes,
      mime: asset.mime || imageMimeFromSource(asset.path || src),
    });
  });
  return bySource;
}

function uniqueMarkdownImageReferences(markdown) {
  const seen = new Set();
  return extractMarkdownImageReferences(markdown).filter((image) => {
    const src = normalizeImageSource(image.src);
    if (!src || seen.has(src)) {
      return false;
    }
    seen.add(src);
    return true;
  });
}

function rewriteAcceptedCorrectedImageReferences(markdown, imageAssets) {
  const bySource = new Map((Array.isArray(imageAssets) ? imageAssets : []).map((asset) => [normalizeImageSource(asset.src), asset.path]));
  return String(markdown || "").replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (full, alt, rawTarget) => {
    const src = normalizeImageSource(extractMarkdownImageTarget(rawTarget));
    const path = bySource.get(src);
    return path ? `![${alt}](${path})` : full;
  });
}

async function collectPdfCroppedImageAssetsForReferences(refs) {
  if (!hasPdfSource() || !Array.isArray(refs) || !refs.length) {
    return [];
  }
  const matches = imageSourceSegmentsForAcceptedDownload(refs.map((item) => item.src));
  const assets = [];
  for (const match of matches) {
    try {
      const page = await ensurePageImageForAcceptedDownload(match.pageNo);
      if (!page?.image || !match.segment?.bbox) {
        continue;
      }
      const cropDataUrl = await cropPageImage(
        page.image,
        match.segment.bbox,
        match.segment.pageSize,
        cropPaddingForMarkdownBlock(match.markdown, match.segment.pageSize),
      );
      const parsed = parseDataUrlBytes(cropDataUrl);
      if (!parsed?.bytes?.length) {
        continue;
      }
      assets.push({
        src: normalizeImageSource(match.src),
        bytes: parsed.bytes,
        mime: parsed.mime || "image/png",
      });
    } catch (error) {
      warnAcceptedImagePackaging(`图片 ${match.src || ""} 无法从 PDF 页面裁剪，已跳过。`, error);
    }
  }
  return assets;
}

function imageSourceSegmentsForAcceptedDownload(sources) {
  const wanted = new Set((Array.isArray(sources) ? sources : []).map(normalizeImageSource).filter(Boolean));
  if (!wanted.size) {
    return [];
  }
  const matches = [];
  const matchedSources = new Set();
  const total = getMineruPageCount();
  for (let pageNo = 1; pageNo <= total; pageNo += 1) {
    const acceptedByBlock = new Map(
      acceptedOcrPatchesForPage(pageNo).map((patch) => [ocrPatchBlockIndex(patch), String(patch?.newText || "")]),
    );
    reviewSegmentsForPage(pageNo).forEach((segment) => {
      if (!segment?.bbox) {
        return;
      }
      const text = [segment.markdown || "", acceptedByBlock.get(String(segment.blockIndex)) || ""].join("\n");
      extractMarkdownImageReferences(text).forEach((image) => {
        const src = normalizeImageSource(image.src);
        if (!wanted.has(src) || matchedSources.has(src)) {
          return;
        }
        matchedSources.add(src);
        matches.push({
          src,
          pageNo,
          segment,
          markdown: text,
        });
      });
    });
  }
  return matches;
}

async function ensurePageImageForAcceptedDownload(pageNo) {
  const pageNumber = Number(pageNo) || 0;
  const cached = state.pageCache.get(pageNumber);
  if (cached?.image) {
    return cached;
  }
  const preview = await loadPagePreview(pageNumber);
  cachePreviewPage(pageNumber, preview);
  return state.pageCache.get(pageNumber) || preview?.pages?.[0] || null;
}

function readImageReferenceAsset(src) {
  const source = normalizeImageSource(src);
  if (!source) {
    return null;
  }
  if (/^data:/i.test(source)) {
    return parseDataUrlBytes(source);
  }
  return readSameOriginImageAsset(source);
}

function readSameOriginImageAsset(src) {
  if (typeof XMLHttpRequest !== "function") {
    return null;
  }
  let url = src;
  try {
    if (typeof document !== "undefined" && document?.baseURI && !/^(?:https?:|file:|blob:|data:|\/)/i.test(src)) {
      url = new URL(src, document.baseURI).href;
    }
  } catch (error) {
    url = src;
  }
  try {
    const request = new XMLHttpRequest();
    request.open("GET", url, false);
    request.responseType = "arraybuffer";
    request.send(null);
    if (!(request.status === 0 || (request.status >= 200 && request.status < 300)) || !request.response) {
      return null;
    }
    const mime = request.getResponseHeader?.("Content-Type") || imageMimeFromSource(src);
    return {
      bytes: new Uint8Array(request.response),
      mime,
    };
  } catch (error) {
    warnAcceptedImagePackaging(`无法读取图片引用 ${src}，将尝试 PDF 裁剪 fallback。`, error);
    return null;
  }
}

function normalizeImageSource(source) {
  const raw = String(source || "").trim();
  const match = raw.match(/^<([^>]+)>$/);
  return match ? match[1].trim() : raw;
}

function extractMarkdownImageTarget(rawTarget) {
  const target = String(rawTarget || "").trim();
  const wrapped = target.match(/^<([^>]+)>$/);
  if (wrapped) {
    return wrapped[1].trim();
  }
  const unquoted = target.match(/^(\S+)/);
  return unquoted ? unquoted[1] : target;
}

function parseDataUrlBytes(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) {
    return null;
  }
  const binary = decodeBase64(match[2]);
  if (!binary) {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return {
    bytes,
    mime: match[1],
  };
}

function decodeBase64(value) {
  try {
    if (typeof atob === "function") {
      return atob(String(value || ""));
    }
    if (typeof Buffer !== "undefined") {
      return Buffer.from(String(value || ""), "base64").toString("binary");
    }
    if (typeof require === "function") {
      return require("buffer").Buffer.from(String(value || ""), "base64").toString("binary");
    }
  } catch (error) {
    warnAcceptedImagePackaging("base64 图片解析失败。", error);
  }
  return "";
}

function allocateAcceptedImagePath(source, mime, usedPaths) {
  const basename = imageBasename(source) || `image-${(usedPaths?.size || 0) + 1}`;
  const extension = imageExtensionFromMime(mime) || imageExtensionFromSource(source) || ".bin";
  const stem = sanitizeZipPathSegment(basename.replace(/\.[a-z0-9]{1,8}$/i, "")) || `image-${(usedPaths?.size || 0) + 1}`;
  let candidate = `images/${stem}${extension}`;
  let suffix = 1;
  while (usedPaths.has(candidate)) {
    candidate = `images/${stem}-${suffix}${extension}`;
    suffix += 1;
  }
  usedPaths.add(candidate);
  return candidate;
}

function imageBasename(source) {
  const normalized = normalizeImageSource(source).split("#")[0].split("?")[0];
  if (/^data:/i.test(normalized)) {
    return "";
  }
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "";
}

function imageMimeFromSource(source) {
  const extension = imageExtensionFromSource(source).toLowerCase();
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
  };
  return map[extension] || "";
}

function imageExtensionFromSource(source) {
  const match = normalizeImageSource(source).split("#")[0].split("?")[0].match(/\.([a-z0-9]{1,8})$/i);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function imageExtensionFromMime(mime) {
  const map = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
  };
  return map[String(mime || "").toLowerCase().split(";")[0].trim()] || "";
}

function buildStoredZip(entries) {
  const normalizedEntries = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      path: sanitizeZipPath(entry.path),
      bytes: toUint8Array(entry.bytes),
    }))
    .filter((entry) => entry.path && entry.bytes);
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const [dosTime, dosDate] = zipDosDateTime(new Date());
  normalizedEntries.forEach((entry) => {
    const nameBytes = stringToUtf8Bytes(entry.path);
    const bytes = entry.bytes;
    const crc = crc32(bytes);
    const local = new Uint8Array(30 + nameBytes.length + bytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, bytes.length, true);
    localView.setUint32(22, bytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(bytes, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, bytes.length, true);
    centralView.setUint32(24, bytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length;
  });
  const localBytes = concatBytes(localParts);
  const centralBytes = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, normalizedEntries.length, true);
  endView.setUint16(10, normalizedEntries.length, true);
  endView.setUint32(12, centralBytes.length, true);
  endView.setUint32(16, localBytes.length, true);
  return concatBytes([localBytes, centralBytes, end]);
}

function sanitizeZipPath(path) {
  return String(path || "")
    .split("/")
    .map(sanitizeZipPathSegment)
    .filter(Boolean)
    .join("/");
}

function sanitizeZipPathSegment(segment) {
  return String(segment || "")
    .replace(/[\\:*?"<>|]/g, "-")
    .replace(/^\.+$/, "")
    .replace(/\s+/g, "-")
    .trim();
}

function zipDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return [dosTime, dosDate];
}

function stringToUtf8Bytes(text) {
  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(String(text || ""));
  }
  const encoded = encodeURIComponent(String(text || ""));
  const bytes = [];
  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === "%") {
      bytes.push(parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(encoded.charCodeAt(index));
    }
  }
  return new Uint8Array(bytes);
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return new Uint8Array(value);
  }
  return stringToUtf8Bytes(value || "");
}

function concatBytes(chunks) {
  const total = (Array.isArray(chunks) ? chunks : []).reduce((sum, chunk) => sum + (chunk?.length || 0), 0);
  const output = new Uint8Array(total);
  let offset = 0;
  (Array.isArray(chunks) ? chunks : []).forEach((chunk) => {
    if (!chunk?.length) {
      return;
    }
    output.set(chunk, offset);
    offset += chunk.length;
  });
  return output;
}

const ZIP_CRC32_TABLE = buildCrc32Table();

function buildCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  const data = toUint8Array(bytes);
  for (let index = 0; index < data.length; index += 1) {
    crc = ZIP_CRC32_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function warnAcceptedImagePackaging(message, error) {
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(`[Accepted Download] ${message}`, error || "");
  }
}

function acceptedPatchDownloadHeader() {
  return `<!--
Generated by OCR accepted patch dry-run export.
Only accepted OcrPatch entries are applied.
Original export button is unchanged.
-->`;
}

function withIssuePageNo(issues, pageNo) {
  return (Array.isArray(issues) ? issues : []).map((issue) => ({
    pageNo,
    ...issue,
  }));
}

function acceptedOcrPatchesForPage(pageNo) {
  const patches = Array.isArray(state.ocrPatches) ? state.ocrPatches : [];
  const latestByBlock = new Map();
  patches.forEach((patch) => {
    if (patch?.status !== "accepted" || !ocrPatchBelongsToPage(patch, pageNo)) {
      return;
    }
    const key = ocrPatchStableBlockKey(patch);
    latestByBlock.set(key, patch);
  });
  return Array.from(latestByBlock.values());
}

function ocrPatchStableBlockKey(patch) {
  const blockId = String(patch?.blockId || "");
  const match = blockId.match(/^(p\d+_b[^_]+)_/);
  return match ? match[1] : blockId;
}

function ocrPatchBelongsToPage(patch, pageNo) {
  const metadataPageNo = Number(patch?.metadata?.pageNo);
  if (Number.isFinite(metadataPageNo) && metadataPageNo > 0) {
    return metadataPageNo === Number(pageNo);
  }
  return String(patch?.blockId || "").startsWith(`p${pageNo}_`);
}

function countAppliedAcceptedPatches(acceptedPatches, blocks, errors, warnings) {
  const existingBlockIds = new Set(blocks.map((block) => block.blockId));
  const failedBlockIds = new Set(
    []
      .concat(errors || [])
      .concat((warnings || []).filter((warning) => warning?.type === "patch_block_not_found"))
      .map((issue) => issue?.blockId)
      .filter(Boolean),
  );
  return acceptedPatches.filter((patch) => existingBlockIds.has(patch.blockId) && !failedBlockIds.has(patch.blockId)).length;
}

function normalizeDraftPatchMarkdown(blockId, markdown) {
  const rawMarkdown = String(markdown || "");
  const normalizeMathDelimiters = getOcrCoreNormalizeMathDelimiters();
  if (!normalizeMathDelimiters) {
    warnOcrCorePatch("mathDelimiterNormalizer 不可用，draft patch 将保留未规范化 Markdown。");
    return rawMarkdown;
  }
  try {
    const result = normalizeMathDelimiters({
      blockId,
      blockText: rawMarkdown,
      blockType: "unknown",
    });
    return typeof result?.normalizedText === "string" ? result.normalizedText : rawMarkdown;
  } catch (error) {
    warnOcrCorePatch("draft patch 公式分隔符规范化失败，已保守使用原文。", error);
    return rawMarkdown;
  }
}

function validateDraftPatchRenderability(blockId, markdown) {
  const validateRenderability = getOcrCoreValidateRenderability();
  if (!validateRenderability) {
    warnOcrCorePatch("renderValidator 不可用，draft patch renderStatusAfter 标记为 warning。");
    return { severity: "warning" };
  }
  try {
    return validateRenderability({
      blockId,
      markdown,
      blockType: "unknown",
      source: "unknown",
    });
  } catch (error) {
    warnOcrCorePatch("draft patch 渲染静态校验失败，renderStatusAfter 标记为 error。", error);
    return { severity: "error" };
  }
}

function analyzeMineruRiskPages() {
  cancelScheduledRiskAnalysis();
  state.riskByPage.clear();
  const total = getMineruPageCount();
  for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
    analyzeMineruRiskPage(pageNumber);
  }
}

function analyzeMineruRiskPage(pageNumber) {
  const risks = detectRiskCandidatesForPage(pageNumber);
  if (risks.length) {
    state.riskByPage.set(pageNumber, risks);
  } else {
    state.riskByPage.delete(pageNumber);
  }
  return risks;
}

function analyzeCurrentMineruRiskPage() {
  if (!state.mineruInfo) {
    return [];
  }
  return analyzeMineruRiskPage(state.currentPage);
}

function scheduleMineruRiskAnalysis() {
  cancelScheduledRiskAnalysis();
  const total = getMineruPageCount();
  if (!total) {
    return;
  }
  const runId = ++riskAnalysisRunId;
  const currentPage = state.currentPage;
  let pageNumber = 1;
  const processChunk = () => {
    if (runId !== riskAnalysisRunId || !state.mineruInfo) {
      return;
    }
    const startedAt = Date.now();
    let processed = 0;
    while (pageNumber <= total && processed < 12 && Date.now() - startedAt < 24) {
      if (pageNumber !== currentPage) {
        analyzeMineruRiskPage(pageNumber);
      }
      pageNumber += 1;
      processed += 1;
    }
    updatePager();
    updateCorrectionSummary();
    if (pageNumber <= total) {
      riskAnalysisTimer = setTimeout(processChunk, 0);
    } else {
      riskAnalysisTimer = null;
    }
  };
  riskAnalysisTimer = setTimeout(processChunk, 0);
}

function cancelScheduledRiskAnalysis() {
  riskAnalysisRunId += 1;
  if (riskAnalysisTimer) {
    clearTimeout(riskAnalysisTimer);
    riskAnalysisTimer = null;
  }
}

function detectRiskCandidatesForPage(pageNumber) {
  return detectLocalRiskCandidatesForPage(pageNumber);
}

function detectLocalRiskCandidatesForPage(pageNumber) {
  const segmentRisks = reviewSegmentsForPage(pageNumber)
    .map((segment) => {
      const { score: baseScore, reasons: baseReasons } = scoreRiskBlock(segment.markdown);
      const reasons = baseReasons.slice();
      let score = baseScore;
      if (isPageBottomReviewCandidate(segment)) {
        score = Math.max(score, 0.26);
        reasons.push("page_bottom_boundary");
      }
      return {
        pageNumber,
        blockIndex: String(segment.blockIndex),
        bbox: segment.bbox,
        pageSize: segment.pageSize,
        text: segment.markdown,
        score,
        reasons,
      };
    })
    .filter((item) => item.text && item.score >= 0.25);
  return segmentRisks.concat(detectSupplementalRiskCandidatesForPage(pageNumber)).sort((a, b) => b.score - a.score);
}

function detectSupplementalRiskCandidatesForPage(pageNumber) {
  return detectCrossPageContinuationCandidatesForPage(pageNumber)
    .concat(detectSyntheticRiskCandidatesForPage(pageNumber))
    .concat(detectContentListRiskCandidatesForPage(pageNumber))
    .concat(detectPdfReferenceTextCandidatesForPage(pageNumber));
}

function detectSyntheticRiskCandidatesForPage(pageNumber) {
  return detectMissingBackgroundTitleCandidatesForPage(pageNumber).concat(detectMissingPageTopTextCandidatesForPage(pageNumber));
}

function detectContentListRiskCandidatesForPage(pageNumber) {
  const items = contentListItemsForPage(pageNumber);
  if (!items.length) {
    return [];
  }
  const middleTexts = new Set(
    originalBlockMarkdownsForPage(pageNumber)
      .map((entry) => normalizeTextForComparison(entry.markdown))
      .filter(Boolean),
  );
  const pageSize = inferContentListPageSize(pageNumber, items);
  const sourceSegments = reviewSegmentsForPage(pageNumber);
  return items
    .map((item, pageItemIndex) => contentListItemToRiskCandidate(item, pageNumber, pageItemIndex, pageSize, middleTexts, sourceSegments))
    .filter(Boolean);
}

function detectPdfReferenceTextCandidatesForPage(pageNumber) {
  if (pageHasBibliographyBodyCandidate(pageNumber)) {
    return [];
  }
  const textBlocks = pdfTextBlocksForPage(pageNumber)
    .map((block) => ({
      text: String(block?.text || "").trim(),
      bbox: normalizedBBox(block?.bbox),
    }))
    .filter((block) => block.text && block.bbox)
    .sort((left, right) => {
      const yDiff = left.bbox[1] - right.bbox[1];
      return Math.abs(yDiff) > 2 ? yDiff : left.bbox[0] - right.bbox[0];
    });
  if (!textBlocks.length) {
    return [];
  }
  const hasHeading =
    textBlocks.some((block) => isLikelyReferenceHeading(block.text)) ||
    contentListItemsForPage(pageNumber).some((item) => isLikelyReferenceHeading(contentListItemText(item))) ||
    originalBlockMarkdownsForPage(pageNumber).some((entry) => isLikelyReferenceHeading(String(entry.markdown || "").replace(/^#{1,6}\s+/, "")));
  const bodyBlocks = textBlocks.filter((block) => !isLikelyReferenceHeading(block.text) && !isPageNumberOnlyText(block.text));
  if (!bodyBlocks.length) {
    return [];
  }
  const rawReferenceText = bodyBlocks.map((block) => block.text).join("\n");
  if (!hasHeading && !isLikelyBibliographyText(rawReferenceText)) {
    return [];
  }
  if (hasHeading && !hasBibliographyBodySignal(rawReferenceText)) {
    return [];
  }
  const referenceText = formatBibliographyText(rawReferenceText);
  if (!referenceText || referenceText.length < 40) {
    return [];
  }
  const existingTexts = new Set(
    reviewBlockMarkdownsForPage(pageNumber)
      .map((entry) => normalizeTextForComparison(entry.markdown))
      .concat(contentListItemsForPage(pageNumber).map((item) => normalizeTextForComparison(contentListItemText(item))))
      .filter(Boolean),
  );
  if (isTextRedundantWithNormalizedSet(referenceText, existingTexts)) {
    return [];
  }
  return [
    {
      pageNumber,
      blockIndex: `pdf-reference-text-${pageNumber}`,
      bbox: mergeBBoxes(bodyBlocks.map((block) => block.bbox)),
      pageSize: pdfTextPageSizeForPage(pageNumber),
      text: referenceText,
      score: 0.36,
      reasons: ["pdf_text_reference_supplemental"],
      syntheticPlacement: "content_list",
      syntheticLabel: "PDF 参考文献候选",
      supplementalSource: "pdf_text_reference",
    },
  ];
}

function hasBibliographyBodySignal(text) {
  const { starts, yearHits, referenceSignals } = bibliographySignalStats(text);
  return starts >= 1 && yearHits >= 1 && (starts >= 2 || referenceSignals >= 1 || yearHits >= 3);
}

function detectCrossPageContinuationCandidatesForPage(pageNumber) {
  const page = state.mineruInfo?.pdf_info?.[pageNumber - 1];
  const previousPage = state.mineruInfo?.pdf_info?.[pageNumber - 2];
  if (!page || !previousPage) {
    return [];
  }
  const pageSize = page.page_size || previousPage.page_size || null;
  const blocks = Array.isArray(previousPage.para_blocks) ? previousPage.para_blocks : [];
  const currentTexts = new Set(
    reviewBlockMarkdownsForPage(pageNumber)
      .map((entry) => normalizeTextForComparison(entry.markdown))
      .filter(Boolean),
  );
  return blocks
    .map((block, sourceBlockIndex) => {
      const continuationBlock = filterBlockLines(block, lineHasCrossPageContent);
      const markdown = blockToMarkdown(continuationBlock).trim();
      if (!markdown || isTextRedundantWithNormalizedSet(markdown, currentTexts)) {
        return null;
      }
      const bbox = getBlockBBox(continuationBlock);
      const scored = scoreRiskBlock(markdown);
      return {
        pageNumber,
        blockIndex: `cross-page-continuation-${pageNumber}-${sourceBlockIndex}`,
        sourceBlockIndex: String(sourceBlockIndex),
        sourcePageNumber: pageNumber - 1,
        bbox,
        pageSize,
        text: markdown,
        score: Math.max(scored.score, 0.34),
        reasons: Array.from(new Set(["cross_page_continuation"].concat(scored.reasons))),
        syntheticPlacement: "page_top",
        syntheticLabel: "跨页续段候选",
        supplementalSource: "cross_page_continuation",
      };
    })
    .filter(Boolean);
}

function hasCrossPageContinuationForPage(pageNumber) {
  return detectCrossPageContinuationCandidatesForPage(pageNumber).length > 0;
}

function contentListItemToRiskCandidate(item, pageNumber, pageItemIndex, pageSize, middleTexts, sourceSegments = []) {
  if (!item || item.type !== "discarded") {
    return null;
  }
  const rawText = contentListItemText(item);
  const continuation = figureOrTableNarrativeContinuation(rawText, sourceSegments);
  const text = continuation?.text || rawText;
  const normalized = normalizeTextForComparison(text);
  if (
    !normalized ||
    normalized.length < 4 ||
    isLikelyReferenceHeading(text) ||
    isPageNumberOnlyText(normalized) ||
    isTextRedundantWithNormalizedSet(normalized, middleTexts) ||
    isTextRedundantWithLooseSourceText(normalized, middleTexts) ||
    isTextRedundantWithLooseSourceText(
      normalized,
      (Array.isArray(sourceSegments) ? sourceSegments : []).map((segment) => segment?.markdown),
    )
  ) {
    return null;
  }
  if (isLikelyBibliographyText(text) && pageHasBibliographyBodyCandidate(pageNumber, { excludeContentListIndex: item.__contentListIndex })) {
    return null;
  }
  const bbox = normalizedBBox(item.bbox);
  const geometry = bbox ? bboxGeometryForPageSize(bbox, pageSize) : null;
  if (isLikelyPageHeaderText(text, bbox, pageSize)) {
    return null;
  }
  const scored = scoreRiskBlock(text);
  const reasons = scored.reasons.slice();
  let score = scored.score;
  const isAnchoredContinuation = Boolean(continuation?.anchorBlockIndex != null);
  const isTopCandidate = Boolean(!isAnchoredContinuation && geometry?.topRatio <= 0.2 && text.length >= 6);
  if (isTopCandidate && hasCrossPageContinuationForPage(pageNumber)) {
    return null;
  }
  const isBottomCandidate = Boolean(geometry?.topRatio >= 0.82 || geometry?.bottomRatio >= 0.9);
  const isFootnoteCandidate = hasFootnoteSignal(text) && !isTopCandidate;
  if (!isFootnoteCandidate) {
    const footnoteReasonIndex = reasons.indexOf("footnote_marker_or_note");
    if (footnoteReasonIndex >= 0) {
      reasons.splice(footnoteReasonIndex, 1);
    }
  }
  if (!reasons.includes("content_list_discarded")) {
    reasons.unshift("content_list_discarded");
  }
  if (isFootnoteCandidate) {
    score = Math.max(score, 0.38);
    if (!reasons.includes("footnote_marker_or_note")) {
      reasons.push("footnote_marker_or_note");
    }
  }
  if (isTopCandidate) {
    score = Math.max(score, 0.33);
    if (!reasons.includes("background_heading_missing")) {
      reasons.push("background_heading_missing");
    }
  }
  if (isAnchoredContinuation) {
    score = Math.max(score, 0.33);
    if (!reasons.includes("content_list_anchored_continuation")) {
      reasons.push("content_list_anchored_continuation");
    }
  }
  if (isBottomCandidate) {
    score = Math.max(score, 0.31);
    if (!reasons.includes("page_bottom_boundary")) {
      reasons.push("page_bottom_boundary");
    }
  }
  if (score < 0.25) {
    return null;
  }
  return {
    pageNumber,
    blockIndex: `content-list-discarded-${pageNumber}-${pageItemIndex}`,
    bbox,
    pageSize,
    text,
    score: Math.min(score, 1),
    reasons: Array.from(new Set(reasons)),
    syntheticPlacement: isAnchoredContinuation ? "after_anchor" : isTopCandidate ? "page_top" : isBottomCandidate ? "page_bottom" : "content_list",
    syntheticLabel: isFootnoteCandidate ? "content_list 脚注候选" : isTopCandidate ? "content_list 标题候选" : isAnchoredContinuation ? "content_list 续段候选" : "content_list 补充候选",
    supplementalSource: "content_list",
    contentListIndex: item.__contentListIndex,
    anchorBlockIndex: continuation?.anchorBlockIndex,
  };
}

function figureOrTableNarrativeContinuation(text, sourceSegments = []) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const leading = leadingFigureOrTableReferenceLabel(raw);
  if (!leading) {
    return null;
  }
  const body = raw.slice(leading.raw.length).replace(/^[:.．、\s-]+/, "").trim();
  if (!startsLikeNarrativeProse(body) || looksLikeFigureCaptionText(body)) {
    return null;
  }
  const anchor = (Array.isArray(sourceSegments) ? sourceSegments : []).find((segment) =>
    markdownMentionsReferenceLabel(segment?.markdown, leading),
  );
  return anchor ? { text: body, anchorBlockIndex: String(anchor.blockIndex) } : null;
}

function leadingFigureOrTableReferenceLabel(text) {
  const match = String(text || "").trim().match(/^(Fig(?:ure)?\.?|Table)\s*(\d+(?:\.\d+)*[A-Za-z]?)/i);
  if (!match) {
    return null;
  }
  const type = /^tab/i.test(match[1]) ? "table" : "figure";
  return {
    raw: match[0],
    type,
    number: match[2],
  };
}

function startsLikeNarrativeProse(text) {
  return /^(Although|Because|However|Therefore|Thus|If|In\s+fact|In\s+this|From|Using|We|It|This|These|The|For|As|Where|When|Once)\b/i.test(
    String(text || "").trim(),
  );
}

function markdownMentionsReferenceLabel(markdown, label) {
  if (!label?.number) {
    return false;
  }
  const escapedNumber = label.number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const typePattern = label.type === "table" ? "Table" : "(?:Fig(?:ure)?\\.?)";
  return new RegExp(`\\b${typePattern}\\s*${escapedNumber}\\b`, "i").test(String(markdown || ""));
}

function detectCrossPageRiskCandidatesForPage(pageNumber) {
  const candidates = [];
  return candidates;
}

function appendCrossPageBoundaryCandidates(candidates, pageNumber, sourcePageNumber, hint) {
  if (sourcePageNumber < 1 || sourcePageNumber > getMineruPageCount()) {
    return;
  }
  const segments = pageSegmentsForPage(sourcePageNumber);
  const boundarySegments = hint === "previous_tail" ? segments.slice(-2) : segments.slice(0, 2);
  boundarySegments.forEach((segment) => {
    const { score, reasons } = scoreRiskBlock(segment.markdown);
    if (!segment.markdown || score < 0.25) {
      return;
    }
    const sourceBlockIndex = String(segment.blockIndex);
    const directionReason = hint === "previous_tail" ? "cross_page_previous_tail" : "cross_page_next_head";
    candidates.push({
      pageNumber,
      blockIndex: `cross-${hint}-${sourcePageNumber}-${sourceBlockIndex}`,
      sourceBlockIndex,
      crossPageSourcePage: sourcePageNumber,
      crossPageHint: hint,
      crossPageLabel: hint === "previous_tail" ? `上一页候选 · 第 ${sourcePageNumber} 页` : `下一页候选 · 第 ${sourcePageNumber} 页`,
      bbox: null,
      pageSize: segment.pageSize,
      text: segment.markdown,
      score: Math.min(score + 0.02, 1),
      reasons: Array.from(new Set([directionReason].concat(reasons))),
    });
  });
}

function isPageBottomReviewCandidate(segment) {
  const markdown = String(segment?.markdown || "").trim();
  if (markdown.length < 8 || /^[\s\dIVXLCDMivxlcdm.()-]+$/.test(markdown)) {
    return false;
  }
  const geometry = segmentPageGeometry(segment);
  if (!geometry) {
    return false;
  }
  return geometry.topRatio >= 0.68 || geometry.bottomRatio >= 0.78;
}

function detectMissingBackgroundTitleCandidatesForPage(pageNumber) {
  const page = state.mineruInfo?.pdf_info?.[pageNumber - 1];
  if (!page) {
    return [];
  }
  if (hasCrossPageContinuationForPage(pageNumber)) {
    return [];
  }
  const entries = originalBlockMarkdownsForPage(pageNumber);
  const pageSize = page.page_size || entries.find((entry) => entry.pageSize)?.pageSize;
  const height = pageSizeHeight(pageSize);
  const width = pageSizeWidth(pageSize);
  if (!height || !width || hasTopTitleEntry(entries)) {
    return [];
  }
  const firstContent = entries
    .filter((entry) => String(entry.markdown || "").trim().length >= 12)
    .find((entry) => segmentPageGeometry(entry));
  const geometry = segmentPageGeometry(firstContent);
  if (!firstContent || !geometry || geometry.topRatio < 0.16 || geometry.topRatio > 0.42) {
    return [];
  }
  const cropBottom = Math.max(height * 0.12, Math.min(Number(firstContent.bbox?.[1]) - 4, height * 0.3));
  if (!Number.isFinite(cropBottom) || cropBottom <= height * 0.08) {
    return [];
  }
  return [
    {
      pageNumber,
      blockIndex: `missing-heading-${pageNumber}`,
      bbox: [0, 0, width, cropBottom],
      pageSize,
      text: "疑似遗漏页首带背景标题区域。请用 Mathpix 校正此块后人工确认。",
      score: 0.31,
      reasons: ["background_heading_missing"],
      syntheticPlacement: "page_top",
      syntheticLabel: "页首标题候选",
    },
  ];
}

function detectMissingPageTopTextCandidatesForPage(pageNumber) {
  const page = state.mineruInfo?.pdf_info?.[pageNumber - 1];
  if (!page) {
    return [];
  }
  if (hasCrossPageContinuationForPage(pageNumber)) {
    return [];
  }
  const entries = originalBlockMarkdownsForPage(pageNumber);
  const pageSize = page.page_size || entries.find((entry) => entry.pageSize)?.pageSize;
  const height = pageSizeHeight(pageSize);
  const width = pageSizeWidth(pageSize);
  if (!height || !width || hasTopTitleEntry(entries)) {
    return [];
  }
  const firstContent = entries
    .filter((entry) => String(entry.markdown || "").trim().length >= 20)
    .find((entry) => segmentPageGeometry(entry));
  const geometry = segmentPageGeometry(firstContent);
  if (!firstContent || !geometry || geometry.topRatio < 0.22 || geometry.topRatio > 0.62) {
    return [];
  }
  const cropTop = height * 0.07;
  const cropBottom = Math.min(Number(firstContent.bbox?.[1]) - 4, height * 0.5);
  if (!Number.isFinite(cropBottom) || cropBottom - cropTop < height * 0.08) {
    return [];
  }
  return [
    {
      pageNumber,
      blockIndex: `missing-page-top-text-${pageNumber}`,
      bbox: [0, cropTop, width, cropBottom],
      pageSize,
      text: "疑似遗漏页首正文段落。请用 Mathpix 校正此块后人工确认。",
      score: 0.32,
      reasons: ["page_top_text_missing"],
      syntheticPlacement: "page_top",
      syntheticLabel: "页首正文候选",
    },
  ];
}

function hasTopTitleEntry(entries) {
  return entries.some((entry) => {
    const geometry = segmentPageGeometry(entry);
    if (!geometry || geometry.topRatio > 0.28) {
      return false;
    }
    const markdown = String(entry.markdown || "").trim();
    return entry.block?.type === "title" || /^#{1,6}\s+/.test(markdown);
  });
}

function segmentPageGeometry(segment) {
  const bbox = segment?.bbox;
  const pageSize = segment?.pageSize;
  if (!Array.isArray(bbox) || bbox.length < 4) {
    return null;
  }
  const height = pageSizeHeight(pageSize);
  if (!height) {
    return null;
  }
  const top = Number(bbox[1]);
  const bottom = Number(bbox[3]);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
    return null;
  }
  return {
    topRatio: top / height,
    bottomRatio: bottom / height,
  };
}

function bboxGeometryForPageSize(bbox, pageSize) {
  if (!Array.isArray(bbox) || bbox.length < 4) {
    return null;
  }
  const height = pageSizeHeight(pageSize);
  if (!height) {
    return null;
  }
  const top = Number(bbox[1]);
  const bottom = Number(bbox[3]);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
    return null;
  }
  return {
    topRatio: top / height,
    bottomRatio: bottom / height,
  };
}

function pageSizeHeight(pageSize) {
  if (Array.isArray(pageSize)) {
    return Number(pageSize[1]) || 0;
  }
  if (pageSize && typeof pageSize === "object") {
    return Number(pageSize.height || pageSize.h || pageSize[1]) || 0;
  }
  return 0;
}

function pageSizeWidth(pageSize) {
  if (Array.isArray(pageSize)) {
    return Number(pageSize[0]) || 0;
  }
  if (pageSize && typeof pageSize === "object") {
    return Number(pageSize.width || pageSize.w || pageSize[0]) || 0;
  }
  return 0;
}

function normalizeContentListItems(data) {
  const rawItems = Array.isArray(data)
    ? data
    : Array.isArray(data?.content_list)
      ? data.content_list
      : Array.isArray(data?.items)
        ? data.items
        : [];
  return rawItems
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({ ...item, __contentListIndex: index }));
}

function contentListItemsForPage(pageNumber) {
  const targetIndex = Number(pageNumber) - 1;
  if (!Number.isFinite(targetIndex) || targetIndex < 0) {
    return [];
  }
  return (Array.isArray(state.contentListItems) ? state.contentListItems : []).filter((item) => Number(item.page_idx) === targetIndex);
}

function contentListItemText(item) {
  if (!item || typeof item !== "object") {
    return "";
  }
  if (typeof item.text === "string") {
    return item.text.trim();
  }
  if (Array.isArray(item.img_caption)) {
    return item.img_caption.join("\n").trim();
  }
  if (typeof item.table_body === "string") {
    return item.table_body.trim();
  }
  if (typeof item.latex === "string") {
    return item.latex.trim();
  }
  return "";
}

function normalizedBBox(bbox) {
  if (!Array.isArray(bbox) || bbox.length < 4) {
    return null;
  }
  const normalized = bbox.slice(0, 4).map(Number);
  return normalized.every(Number.isFinite) ? normalized : null;
}

function inferContentListPageSize(pageNumber, items = contentListItemsForPage(pageNumber)) {
  const explicit = items.find((item) => Array.isArray(item.page_size) || item.pageSize)?.page_size || items.find((item) => item.pageSize)?.pageSize;
  if (explicit) {
    return explicit;
  }
  const boxes = items.map((item) => normalizedBBox(item.bbox)).filter(Boolean);
  if (!boxes.length) {
    const page = state.mineruInfo?.pdf_info?.[pageNumber - 1];
    return page?.page_size || null;
  }
  const maxX = Math.max(...boxes.map((box) => box[2]));
  const maxY = Math.max(...boxes.map((box) => box[3]));
  return [Math.ceil(Math.max(maxX + 20, maxX * 1.1)), Math.ceil(Math.max(maxY + 20, maxY * 1.08))];
}

function normalizeTextForComparison(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function canonicalTextForOverlap(text) {
  return normalizeTextForComparison(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTextRedundantWithNormalizedSet(text, normalizedTexts) {
  const normalized = normalizeTextForComparison(text);
  if (!normalized) {
    return false;
  }
  const canon = canonicalTextForOverlap(normalized);
  if (!canon) {
    return false;
  }
  const sourceItems = normalizedTexts instanceof Set ? Array.from(normalizedTexts) : Array.isArray(normalizedTexts) ? normalizedTexts : [];
  return sourceItems.some((candidate) => {
    const candidateNormalized = normalizeTextForComparison(candidate);
    if (!candidateNormalized) {
      return false;
    }
    if (candidateNormalized === normalized) {
      return true;
    }
    const other = canonicalTextForOverlap(candidateNormalized);
    if (!other) {
      return false;
    }
    const shorter = canon.length <= other.length ? canon : other;
    const longer = canon.length > other.length ? canon : other;
    if (shorter.length >= 24 && longer.includes(shorter) && shorter.length / longer.length >= 0.55) {
      return true;
    }
    const shortTokens = new Set(shorter.split(/\s+/).filter((token) => token.length > 1));
    const longTokens = new Set(longer.split(/\s+/).filter((token) => token.length > 1));
    if (shortTokens.size < 6) {
      return false;
    }
    const shared = Array.from(shortTokens).filter((token) => longTokens.has(token)).length;
    return shared / shortTokens.size >= 0.88;
  });
}

function isTextRedundantWithLooseSourceText(text, sourceTexts) {
  const normalized = normalizeTextForComparison(text);
  if (!normalized) {
    return false;
  }
  const sourceItems = sourceTexts instanceof Set ? Array.from(sourceTexts) : Array.isArray(sourceTexts) ? sourceTexts : [];
  return sourceItems.some((candidate) => {
    const candidateNormalized = normalizeTextForComparison(candidate);
    if (!candidateNormalized) {
      return false;
    }
    if (isTextRedundantWithNormalizedSet(normalized, [candidateNormalized])) {
      return true;
    }
    return textTokenOverlapRatio(normalized, candidateNormalized) >= 0.72;
  });
}

function textTokenOverlapRatio(left, right) {
  const leftTokens = comparableTokenSet(left);
  const rightTokens = comparableTokenSet(right);
  const smaller = leftTokens.size <= rightTokens.size ? leftTokens : rightTokens;
  const larger = leftTokens.size > rightTokens.size ? leftTokens : rightTokens;
  if (smaller.size < 12) {
    return 0;
  }
  const shared = Array.from(smaller).filter((token) => larger.has(token)).length;
  return shared / smaller.size;
}

function comparableTokenSet(text) {
  return new Set(
    canonicalTextForOverlap(text)
      .split(/\s+/)
      .filter((token) => token.length > 2 && !COMMON_OVERLAP_STOPWORDS.has(token)),
  );
}

const COMMON_OVERLAP_STOPWORDS = new Set([
  "the",
  "and",
  "that",
  "for",
  "with",
  "this",
  "from",
  "are",
  "were",
  "been",
  "have",
  "has",
  "can",
  "any",
  "but",
  "not",
  "all",
  "one",
  "two",
  "its",
  "into",
  "onto",
  "our",
  "their",
]);

function isPageNumberOnlyText(text) {
  return /^[\s\dIVXLCDMivxlcdm.()-]+$/.test(String(text || "").trim());
}

function detectRiskCandidates(markdown, pageNumber) {
  return splitMarkdownBlocks(markdown)
    .map((block, blockIndex) => {
      const { score, reasons } = scoreRiskBlock(block);
      return {
        pageNumber,
        blockIndex,
        text: block,
        score,
        reasons,
      };
    })
    .filter((item) => item.score >= 0.25)
    .sort((a, b) => b.score - a.score);
}

function splitMarkdownBlocks(markdown) {
  return String(markdown || "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function scoreRiskBlock(text) {
  const reasons = [];
  let score = 0;
  if (hasHeadingSpecialSymbolRisk(text)) {
    score += 0.35;
    reasons.push("heading_special_symbol");
  }
  if (hasScientificSpecialSymbolRisk(text)) {
    score += 0.28;
    reasons.push("scientific_special_symbol");
  }
  if (hasFootnoteSignal(text)) {
    score += 0.26;
    reasons.push("footnote_marker_or_note");
  }
  if (hasOcrGarbledTextRisk(text)) {
    score += 0.29;
    reasons.push("ocr_garbled_text");
  }
  if (hasDisplayMathBlock(text)) {
    score += 0.42;
    reasons.push("display_math_block");
  }
  if (hasLatexMathEnvironment(text)) {
    score += 0.4;
    reasons.push("latex_math_environment");
  }
  if (hasStandaloneEquationLine(text)) {
    score += 0.34;
    reasons.push("standalone_equation_line");
  }
  if (hasMathDenseTextRisk(text)) {
    score += 0.3;
    reasons.push("math_dense_text");
  }
  if (hasTable(text) && hasMathSignal(text)) {
    score += 0.38;
    reasons.push("table_with_math");
  }
  if (hasCompactFormulaLoss(text)) {
    score += 0.36;
    reasons.push("compact_formula_maybe_missing_superscript");
  }
  if (hasSplitFormulaTokens(text)) {
    score += 0.32;
    reasons.push("split_formula_tokens");
  }
  if (hasMatrixSignal(text)) {
    score += 0.34;
    reasons.push("matrix_like_layout");
  }
  if (hasPseudocodeSignal(text)) {
    score += 0.28;
    reasons.push("pseudocode_like_layout");
  }
  if ((text.match(/\$/g) || []).length % 2 === 1) {
    score += 0.2;
    reasons.push("unbalanced_math_delimiter");
  }
  if (/\\[a-zA-Z]+\s+[a-zA-Z0-9]/.test(text)) {
    score += 0.12;
    reasons.push("latex_command_spacing");
  }
  return { score: Math.min(score, 1), reasons };
}

function hasTable(text) {
  return /<\s*\/?\s*(table|thead|tbody|tr|td|th)\b/i.test(text) || text.split("\n").filter((line) => line.includes("|")).length >= 2;
}

function hasMathSignal(text) {
  const plain = text.replace(/<[^>]+>/g, " ");
  return /\\\(|\\\[|\$|\\frac|\\sum|\\int|\\sqrt|\\begin\{|[_^=<>≤≥±×÷∑∫∂αβγδλμπΩ∞≈≠]/.test(plain);
}

function hasHeadingSpecialSymbolRisk(text) {
  return String(text || "")
    .split("\n")
    .some((line) => {
      const match = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
      if (!match) {
        return false;
      }
      const heading = match[1].trim();
      if (!heading) {
        return false;
      }
      return /[�#]|[Α-Ωα-ωµμ∑∫∂∞±×÷≈≠≤≥]/.test(heading) || /\\[a-zA-Z]+/.test(heading);
    });
}

function hasScientificSpecialSymbolRisk(text) {
  const value = String(text || "").replace(/<[^>]+>/g, " ");
  if (!value.trim()) {
    return false;
  }
  if (/[A-Za-zÀ-ÖØ-öø-ÿ][¨´`^~][A-Za-zÀ-ÖØ-öø-ÿ]/.test(value) || /[A-Za-zÀ-ÖØ-öø-ÿ]+[¨´`^~]\s*[A-Za-zÀ-ÖØ-öø-ÿ]+/.test(value)) {
    return true;
  }
  if (/[�ℰℱℋℒℓℏℜℑ]|[\u{1D400}-\u{1D7FF}]/u.test(value)) {
    return true;
  }
  if (/[Α-Ωα-ωµμ]/.test(value) && /[A-Za-z]/.test(value)) {
    return true;
  }
  const diacriticWords = value.match(/\b[A-Za-zÀ-ÖØ-öø-ÿ]*[À-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ]*\b/g) || [];
  if (!diacriticWords.length) {
    return false;
  }
  return /(?:experiment|principle|theory|field|tensor|scalar|vector|metric|spacetime|relativ|gravitation|equivalence|EEP|Einstein|Dicke|Schiff)/i.test(value);
}

function hasFootnoteSignal(text) {
  const value = String(text || "").replace(/<[^>]+>/g, " ");
  if (!value.trim()) {
    return false;
  }
  return (
    /[A-Za-zÀ-ÖØ-öø-ÿ)”"')\]]\s*(?:[¹²³⁴⁵⁶⁷⁸⁹⁰]|\^[0-9]{1,2})(?=[\s.,;:)]|$)/.test(value) ||
    /[A-Za-zÀ-ÖØ-öø-ÿ)”"')\]],\s*[0-9]{1,2}(?=\s|$)/.test(value) ||
    /^\s*(?:[¹²³⁴⁵⁶⁷⁸⁹⁰]|\d{1,2})\s+(?:Although|Where|Here|This|In|For|See|Newton|Einstein|Dicke|Schiff|[A-Z][a-z])/m.test(value)
  );
}

function hasOcrGarbledTextRisk(text) {
  const value = String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\\$/g, "$");
  if (!value.trim()) {
    return false;
  }
  return (
    /\b1[&$)(][0-9&$)(]{1,3}[a-z]?(?=\s|[.,;:)\]]|$)/i.test(value) ||
    /(?:^|\s)\+[a-z]{2,}\b/i.test(value) ||
    /\b[a-z]{2,}\+[a-z]{2,}\b/i.test(value) ||
    /(?:^|\s),[a-z]{3,}\b/i.test(value) ||
    /\b(?:e-ect|e-ects|di-erent|con-rmed)\b/i.test(value)
  );
}

function hasMathDenseTextRisk(text) {
  const value = String(text || "").replace(/<[^>]+>/g, " ");
  if (!value.trim() || hasDisplayMathBlock(value) || hasLatexMathEnvironment(value)) {
    return false;
  }
  const inlineMathCount = (value.match(/\$[^$\n]{1,160}\$|\\\([\s\S]{1,160}?\\\)/g) || []).length;
  if (inlineMathCount >= 2) {
    return true;
  }

  const latexCommandCount = (value.match(/\\(?:frac|sqrt|sum|int|mathrm|mathit|mathbf|mu|nu|alpha|beta|gamma|delta|theta|lambda|rho|sigma|omega|Omega|Delta|Phi)\b/g) || []).length;
  const scriptCount = (value.match(/[A-Za-zΑ-Ωα-ω]\s*[_^]\s*(?:\{[^}]{1,40}\}|[A-Za-z0-9])/g) || []).length;
  const greekSymbolCount = (value.match(/[Α-Ωα-ωµμ∑∫∂∞±×÷≈≠≤≥]/g) || []).length;
  const equationLikeCount = (value.match(/[A-Za-zΑ-Ωα-ω](?:[_^]\{?[\wΑ-Ωα-ω]+\}?){0,2}\s*[=≈≃≅≠≤≥]\s*[A-Za-z0-9\\{(]/g) || []).length;
  const mathTokenScore = latexCommandCount + scriptCount + greekSymbolCount + equationLikeCount * 2;

  return mathTokenScore >= 3;
}

function hasDisplayMathBlock(text) {
  return /\$\$[\s\S]*?\$\$/.test(text) || /\\\[[\s\S]*?\\\]/.test(text);
}

function hasLatexMathEnvironment(text) {
  return /\\begin\{(?:equation|align|aligned|array|cases|matrix|pmatrix|bmatrix|gather|split|multline)\*?\}/i.test(text);
}

function hasStandaloneEquationLine(text) {
  return String(text || "")
    .split("\n")
    .some((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length > 220 || !/[=≈≃≅≠≤≥<>]/.test(trimmed)) {
        return false;
      }
      return /(?:\\[a-zA-Z]+|[_^{}]|[A-Za-zΑ-Ωα-ω]\s*[=≈≃≅≠≤≥<>]|[=≈≃≅≠≤≥<>]\s*[A-Za-zΑ-Ωα-ω]|[∑∫∂∞±×÷√])/.test(trimmed);
    });
}

function hasSplitFormulaTokens(text) {
  return [
    /\b[A-Za-z]\s+\d\b/,
    /\b\d\s+\d\b/,
    /\^\s+\d/,
    /_\s+\d/,
    /\\\(\s*[^)]*\s{2,}[^)]*\\\)/,
    /\$\s*[^$]*\s{2,}[^$]*\$/,
  ].some((pattern) => pattern.test(text));
}

function hasCompactFormulaLoss(text) {
  if (!hasTable(text)) {
    return false;
  }
  const compact = text.replace(/\s+/g, "");
  return [
    /(?:^|[<>|,;，；])(?:w|x|y|z|n|m|k|p|q|r|t)={0,1}2\d{1,3}(?:[<>|,;，；]|$)/i,
    /(?:^|[<>|,;，；])(?:w|x|y|z|n|m|k|p|q|r|t)\d{2,4}(?:[<>|,;，；]|$)/i,
    /(?:^|[<>|,;，；])2\d{1,3}\$(?:[<>|,;，；]|$)/i,
  ].some((pattern) => pattern.test(compact));
}

function hasMatrixSignal(text) {
  const lowered = text.toLowerCase();
  return (
    /\\begin\{(align|cases|array|matrix|pmatrix|bmatrix|tabular)\*?\}/.test(lowered) ||
    /[\[(]\s*(?:[-+0-9a-zA-Z_.]+\s+){2,}[-+0-9a-zA-Z_.]+/.test(text) ||
    (text.includes("矩阵") && (text.includes("\n") || text.includes("|")))
  );
}

function hasPseudocodeSignal(text) {
  const lowered = text.replace(/<[^>]+>/g, " ").toLowerCase();
  return (
    /\b(input|output|procedure|return|for|while|if|else)\b/.test(lowered) ||
    /(?:^|\n)\s*algorithm\s+\d+/.test(lowered) ||
    ["伪代码", "输入", "输出", "算法", "步骤"].some((marker) => text.includes(marker))
  );
}

function buildLineDiff(original, revised) {
  const left = String(original || "").replace(/\r\n?/g, "\n").split("\n");
  const right = String(revised || "").replace(/\r\n?/g, "\n").split("\n");
  const rows = left.length;
  const cols = right.length;
  const dp = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0));
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      dp[row][col] =
        left[row] === right[col] ? dp[row + 1][col + 1] + 1 : Math.max(dp[row + 1][col], dp[row][col + 1]);
    }
  }
  const diff = [];
  let row = 0;
  let col = 0;
  while (row < rows && col < cols) {
    if (left[row] === right[col]) {
      diff.push({ type: "same", text: left[row] });
      row += 1;
      col += 1;
    } else if (dp[row + 1][col] >= dp[row][col + 1]) {
      diff.push({ type: "remove", text: left[row] });
      row += 1;
    } else {
      diff.push({ type: "add", text: right[col] });
      col += 1;
    }
  }
  while (row < rows) {
    diff.push({ type: "remove", text: left[row] });
    row += 1;
  }
  while (col < cols) {
    diff.push({ type: "add", text: right[col] });
    col += 1;
  }
  return diff;
}

function renderDiffLine(item) {
  const marker = item.type === "add" ? "+" : item.type === "remove" ? "-" : " ";
  return `<div class="diff-line is-${item.type}"><span>${marker}</span><code>${escapeHtml(item.text || " ")}</code></div>`;
}

function blockToMarkdown(block) {
  if (!block || typeof block !== "object") {
    return "";
  }
  if (Array.isArray(block.blocks) && !block.lines) {
    const nested = block.blocks.map(blockToMarkdown).filter(Boolean).join("\n\n");
    if (block.type === "code" && nested) {
      return shouldTreatCodeBlockAsMarkdown(nested) ? wrapLikelyDisplayMathLines(nested) : fencedCode(nested);
    }
    return nested;
  }
  if (block.type === "interline_equation") {
    const content = collectBlockText(block, { displayMath: true }).trim();
    return content ? `$$\n${content.replace(/^\$\$|\$\$$/g, "").trim()}\n$$` : "";
  }
  if (block.type === "table") {
    const html = firstSpanValue(block, "html");
    if (html) {
      const tableMarkdown = htmlTableToMarkdown(html);
      const extraText = tableBlockExtraMarkdown(block, html, tableMarkdown);
      return [extraText, tableMarkdown].filter(Boolean).join("\n\n");
    }
  }
  if (block.type === "image") {
    const imagePath = firstSpanValue(block, "image_path");
    const caption = collectBlockText(block, { skipImagePath: true }).trim();
    return [imagePath ? `![image](${imagePath})` : "", caption].filter(Boolean).join("\n\n");
  }
  if (block.type === "code") {
    const text = collectBlockText(block, { preserveVisualParagraphs: true }).trim();
    return shouldTreatCodeBlockAsMarkdown(text) ? wrapLikelyDisplayMathLines(text) : fencedCode(text);
  }
  const text = collectBlockText(block, { preserveVisualParagraphs: block.type === "text" || !block.type }).trim();
  if (!text) {
    return "";
  }
  if (block.type === "title") {
    return `### ${text}`;
  }
  if (block.type === "list") {
    if (isLikelyBibliographyText(text)) {
      return formatBibliographyText(text);
    }
    return text
      .split("\n")
      .map((line) => (line.trim() ? `- ${line.trim()}` : ""))
      .join("\n");
  }
  return text;
}

function formatBibliographyText(text) {
  const entries = splitBibliographyTextByEntryStarts(text);
  return entries.length ? entries.join("\n\n") : normalizeBibliographyBodyText(text);
}

function isLikelyBibliographyText(text) {
  const { bodyText, starts, yearHits, referenceSignals } = bibliographySignalStats(text);
  if (!bodyText || bodyText.length < 40) {
    return false;
  }
  return starts >= 2 || (starts >= 1 && yearHits >= 2) || (yearHits >= 3 && referenceSignals >= 2);
}

function pageHasBibliographyBodyCandidate(pageNumber, options = {}) {
  const excludeContentListIndex = options?.excludeContentListIndex;
  const mineruHasBody = reviewBlockMarkdownsForPage(pageNumber).some((entry) => {
    const text = String(entry?.markdown || "")
      .replace(/^#{1,6}\s+/, "")
      .trim();
    return text && !isLikelyReferenceHeading(text) && isLikelyBibliographyText(text);
  });
  if (mineruHasBody) {
    return true;
  }
  return contentListItemsForPage(pageNumber).some((item) => {
    if (excludeContentListIndex != null && item?.__contentListIndex === excludeContentListIndex) {
      return false;
    }
    const text = contentListItemText(item);
    return text && !isLikelyReferenceHeading(text) && isLikelyBibliographyText(text);
  });
}

function isLikelyReferenceHeading(text) {
  return /^references?$/i.test(String(text || "").trim());
}

function isLikelyReferenceEntryStart(text) {
  const line = String(text || "").trim();
  if (!line || isLikelyReferenceHeading(line)) {
    return false;
  }
  return /^[A-ZÀ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’-]+(?:[- ][A-ZÀ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’-]+)*,\s+(?:[A-Z]\.|[A-ZÀ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+|[A-Z]\s)/.test(line) && /\b(?:18|19|20)\d{2}[a-z]?\b/.test(line.slice(0, 220));
}

function bibliographySignalStats(text) {
  const bodyText = normalizeBibliographyBodyText(text);
  const pieces = splitBibliographyTextByEntryStarts(bodyText);
  return {
    bodyText,
    starts: pieces.filter(isLikelyReferenceEntryStart).length || referenceEntryStartIndexes(bodyText).length,
    yearHits: (bodyText.match(/\b(?:18|19|20)\d{2}[a-z]?\b/g) || []).length,
    referenceSignals: (bodyText.match(/\b(?:ArXiv|Phys\.|Rev\.|Astrophys\.|Astron\.|Science|Class\.|Quantum|Lett\.|J\.)/gi) || []).length,
  };
}

function splitBibliographyLineByEntryStarts(line) {
  const value = normalizeBibliographyLine(line);
  if (!value) {
    return [];
  }
  return splitBibliographyTextByEntryStarts(value);
}

function splitBibliographyTextByEntryStarts(text) {
  const value = normalizeBibliographyBodyText(text);
  if (!value) {
    return [];
  }
  const starts = referenceEntryStartIndexes(value);
  if (!starts.length) {
    return [value];
  }
  const pieces = [];
  if (starts[0] > 0) {
    pieces.push(value.slice(0, starts[0]).trim());
  }
  starts.forEach((start, index) => {
    const end = starts[index + 1] || value.length;
    pieces.push(value.slice(start, end).trim());
  });
  return pieces.filter(Boolean);
}

function normalizeBibliographyBodyText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(normalizeBibliographyLine)
    .filter((line) => line && !isLikelyReferenceHeading(line) && !isPageNumberOnlyText(line))
    .join(" ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeBibliographyLine(line) {
  return String(line || "")
    .trim()
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^(?:\d+\s+)?References?\b[:.]?\s*/i, "")
    .trim();
}

function referenceEntryStartIndexes(text) {
  const value = String(text || "");
  const pattern = /[A-ZÀ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’-]+(?:[- ][A-ZÀ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’-]+)*,\s+(?:[A-Z]\.|[A-ZÀ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+|[A-Z]\s)[\s\S]{0,220}?\b(?:18|19|20)\d{2}[a-z]?\b/g;
  const starts = [];
  let match;
  while ((match = pattern.exec(value))) {
    const start = match.index;
    if (start === 0 || /[.!?]\s+$/.test(value.slice(0, start))) {
      starts.push(start);
    }
    pattern.lastIndex = Math.max(pattern.lastIndex, start + 1);
  }
  return starts;
}

function collectBlockText(block, options = {}) {
  const chunks = [];
  if (Array.isArray(block.lines)) {
    let previousLine = null;
    let previousText = "";
    block.lines.forEach((line) => {
      const lineText = (line.spans || []).map((span) => spanToMarkdown(span, options)).join("");
      const text = lineText.trim();
      if (text) {
        if (options.preserveVisualParagraphs && chunks.length && isLikelyVisualParagraphBreak(previousLine, line, previousText, text, block, lineText)) {
          chunks.push("");
        }
        chunks.push(text);
        previousLine = line;
        previousText = text;
      }
    });
  }
  if (Array.isArray(block.blocks)) {
    block.blocks.forEach((nested) => {
      const text = collectBlockText(nested, options);
      if (text.trim()) {
        chunks.push(text.trim());
      }
    });
  }
  return chunks.join("\n").replace(/\n{3,}/g, "\n\n");
}

function isLikelyVisualParagraphBreak(previousLine, currentLine, previousText, currentText, block, rawCurrentText = "") {
  const previous = String(previousText || "").trim();
  const current = String(currentText || "").trim();
  if (!previous || !current) {
    return false;
  }
  if (!/[.!?。！？]["')\]}”’]*$/.test(previous)) {
    return false;
  }
  if (!/^[A-ZΑ-Ω"'“‘(]/.test(current) || /^(?:and|or|but|where|which|that|because|since)\b/i.test(current)) {
    return false;
  }
  if (hasInlineMathDelimiter(previous) || hasInlineMathDelimiter(current) || isLikelyStandaloneMathLine(previous) || isLikelyStandaloneMathLine(current)) {
    return false;
  }
  if (/^\s{3,}\S/.test(String(rawCurrentText || ""))) {
    return true;
  }
  const previousStart = lineStartX(previousLine);
  const currentStart = lineStartX(currentLine);
  const blockBox = getBlockBBox(block);
  if (!Number.isFinite(previousStart) || !Number.isFinite(currentStart) || !blockBox) {
    return false;
  }
  const blockLeft = Number(blockBox[0]) || 0;
  const blockWidth = Math.max(1, (Number(blockBox[2]) || 0) - blockLeft);
  const indentThreshold = Math.max(14, Math.min(28, blockWidth * 0.035));
  const indentFromBlock = currentStart - blockLeft;
  const indentFromPrevious = currentStart - previousStart;
  return indentFromBlock >= indentThreshold && indentFromPrevious >= Math.max(8, indentThreshold * 0.55);
}

function lineStartX(line) {
  const direct = normalizedBBox(line?.bbox);
  if (direct) {
    return direct[0];
  }
  const spanStarts = (Array.isArray(line?.spans) ? line.spans : [])
    .map((span) => normalizedBBox(span?.bbox)?.[0])
    .filter(Number.isFinite);
  return spanStarts.length ? Math.min(...spanStarts) : NaN;
}

function spanToMarkdown(span, options = {}) {
  if (!span || typeof span !== "object") {
    return "";
  }
  if (span.html) {
    if (options.skipHtml) {
      return "";
    }
    return htmlTableToMarkdown(span.html);
  }
  const content = String(span.content || "");
  if (!content && span.image_path) {
    if (options.skipImagePath) {
      return "";
    }
    return `![image](${span.image_path})`;
  }
  if (span.type === "inline_equation") {
    return `$${content}$`;
  }
  if (span.type === "interline_equation") {
    return options.displayMath ? content : `$$\n${content}\n$$`;
  }
  return content;
}

function firstSpanValue(block, key) {
  if (Array.isArray(block.lines)) {
    for (const line of block.lines) {
      for (const span of line.spans || []) {
        if (span?.[key]) {
          return span[key];
        }
      }
    }
  }
  if (Array.isArray(block.blocks)) {
    for (const nested of block.blocks) {
      const value = firstSpanValue(nested, key);
      if (value) {
        return value;
      }
    }
  }
  return "";
}

function tableBlockExtraMarkdown(block, html = "", tableMarkdown = "") {
  const candidates = [
    htmlTableContextText(html),
    collectTableMetadataText(block),
    collectBlockText(block, { skipHtml: true }).trim(),
  ];
  const tableCanon = normalizeTextForComparison(tableMarkdown);
  const seen = new Set();
  return candidates
    .flatMap((value) => String(value || "").replace(/\r\n?/g, "\n").split(/\n{2,}/))
    .map((value) => value.replace(/[ \t]+/g, " ").trim())
    .filter((value) => {
      if (!value) {
        return false;
      }
      const canon = normalizeTextForComparison(value);
      if (!canon || seen.has(canon) || (tableCanon && tableCanon.includes(canon))) {
        return false;
      }
      seen.add(canon);
      return true;
    })
    .join("\n\n");
}

function collectTableMetadataText(node, values = []) {
  if (!node || typeof node !== "object") {
    return "";
  }
  ["table_caption", "table_footnote", "caption", "text"].forEach((key) => {
    const value = node[key];
    if (typeof value === "string" && value.trim()) {
      values.push(value.trim());
    } else if (Array.isArray(value)) {
      const text = value.map((entry) => (typeof entry === "string" ? entry : contentListItemText(entry))).filter(Boolean).join("\n");
      if (text.trim()) {
        values.push(text.trim());
      }
    }
  });
  if (Array.isArray(node.lines)) {
    node.lines.forEach((line) => collectTableMetadataText(line, values));
  }
  if (Array.isArray(node.spans)) {
    node.spans.forEach((span) => collectTableMetadataText(span, values));
  }
  if (Array.isArray(node.blocks)) {
    node.blocks.forEach((child) => collectTableMetadataText(child, values));
  }
  return values.join("\n\n");
}

function getBlockBBox(block) {
  const boxes = [];
  collectBBoxes(block, boxes);
  if (!boxes.length) {
    return null;
  }
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ];
}

function collectBBoxes(node, boxes) {
  if (!node || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node.bbox) && node.bbox.length >= 4) {
    boxes.push(node.bbox.slice(0, 4).map(Number));
  }
  if (Array.isArray(node.lines)) {
    node.lines.forEach((line) => collectBBoxes(line, boxes));
  }
  if (Array.isArray(node.spans)) {
    node.spans.forEach((span) => collectBBoxes(span, boxes));
  }
  if (Array.isArray(node.blocks)) {
    node.blocks.forEach((block) => collectBBoxes(block, boxes));
  }
}

function htmlTableToMarkdown(html) {
  const source = String(html || "");
  const rows =
    typeof DOMParser !== "undefined"
      ? Array.from(new DOMParser().parseFromString(source, "text/html").querySelectorAll("tr")).map((row) =>
          Array.from(row.querySelectorAll("th,td")).map(htmlTableCellText)
        )
      : fallbackHtmlTableRows(source);
  if (!rows.length) {
    return "";
  }
  const width = Math.max(...rows.map((row) => row.length), 1);
  const normalized = rows.map((row) => row.concat(Array(Math.max(0, width - row.length)).fill("")));
  return [
    `| ${normalized[0].join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function htmlTableContextText(html) {
  const source = String(html || "");
  if (!source.trim()) {
    return "";
  }
  const captions = Array.from(source.matchAll(/<caption\b[^>]*>([\s\S]*?)<\/caption>/gi)).map((match) =>
    htmlTableCellTextFromHtml(match[1])
  );
  const outsideTable = source
    .replace(/<table\b[\s\S]*?<\/table>/gi, "\n")
    .replace(/<caption\b[\s\S]*?<\/caption>/gi, "\n");
  const outsideText = htmlTableCellTextFromHtml(outsideTable);
  return [...captions, outsideText].filter(Boolean).join("\n\n");
}

function fallbackHtmlTableRows(html) {
  return Array.from(String(html || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
    .map((rowMatch) =>
      Array.from(rowMatch[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)).map((cellMatch) =>
        htmlTableCellTextFromHtml(cellMatch[1])
      )
    )
    .filter((row) => row.length);
}

function htmlTableCellText(cell) {
  const directText = decodeHtmlEntities(String(cell?.textContent || "").replace(/\s+/g, " ").trim());
  if (directText) {
    return directText;
  }
  const attrTexts = [];
  cell?.querySelectorAll?.("[alt], [title], [aria-label], [data-content]").forEach((node) => {
    ["alt", "title", "aria-label", "data-content"].forEach((name) => {
      const value = node.getAttribute?.(name);
      if (value) {
        attrTexts.push(value);
      }
    });
  });
  return decodeHtmlEntities(attrTexts.join(" ").replace(/\s+/g, " ").trim());
}

function htmlTableCellTextFromHtml(html) {
  const source = String(html || "");
  const attrTexts = Array.from(source.matchAll(/\b(?:alt|title|aria-label|data-content)=["']([^"']+)["']/gi)).map((match) => match[1]);
  const visibleText = source
    .replace(/<\s*br\s*\/?\s*>/gi, " ")
    .replace(/<\s*(?:script|style)\b[\s\S]*?<\/\s*(?:script|style)\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return decodeHtmlEntities([visibleText, ...attrTexts].filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, value) => String.fromCharCode(Number(value) || 0));
}

function fencedCode(text) {
  return `\`\`\`\n${text}\n\`\`\``;
}

function fencedCodeBody(markdown) {
  const match = String(markdown || "").trim().match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  return match ? match[1].trim() : "";
}

function convertCodeLikeMarkdownToPlainMarkdown(markdown) {
  const body = fencedCodeBody(markdown);
  const source = body || String(markdown || "").replace(/\r\n?/g, "\n").trim();
  if (!source || hasExecutableCodeSignal(source) || !looksLikeNaturalLanguageCodeFence(source)) {
    return "";
  }
  return cleanMathpixEditableMarkdown(source);
}

function canConvertCodeLikeMarkdownToPlainMarkdown(markdown, segment = null) {
  const body = fencedCodeBody(markdown);
  const source = body || String(markdown || "").replace(/\r\n?/g, "\n").trim();
  if (!source || hasExecutableCodeSignal(source)) {
    return false;
  }
  if ((segment?.kind === "code" || segment?.kind === "algorithm") && shouldTreatCodeBlockAsMarkdown(source)) {
    return true;
  }
  return (body || segment?.kind === "algorithm") && looksLikeNaturalLanguageCodeFence(source);
}

function canStructureFormulaMarkdown(markdown) {
  const source = String(markdown || "").replace(/\r\n?/g, "\n").trim();
  if (!source || (!hasDisplayMathBlock(source) && !hasLatexMathEnvironment(source))) {
    return false;
  }
  const structured = cleanMathpixEditableMarkdown(source);
  if (!structured || structured === source) {
    return false;
  }
  return /\n\\begin\{array\}|\n\{\\displaystyle|\\\\\n|\\boldsymbol\{/.test(structured);
}

function shouldTreatCodeBlockAsMarkdown(text) {
  const value = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!value) {
    return false;
  }
  if (hasExecutableCodeSignal(value)) {
    return false;
  }
  const wordCount = (value.match(/[A-Za-zÀ-ÖØ-öø-ÿ]{3,}/g) || []).length;
  if (wordCount < 12) {
    return false;
  }
  const hasScientificProseSignal =
    /\b(?:For example|However|Thus|Therefore|Among|where|respectively|corresponds?|measurement|observable|observations?|general relativity|pericenter|redshift|precession|stars?)\b/i.test(value);
  const hasMathSignal = /\\[A-Za-z]+|[$]|[A-Za-z]_\{|[A-Za-z]\^\{|(?:^|\s)\(\d+(?:\.\d+)+\)/.test(value);
  const hasSentenceFlow = /[.!?]\s+[A-Z]/.test(value.replace(/\n+/g, " "));
  return hasScientificProseSignal && hasMathSignal && hasSentenceFlow;
}

function hasExecutableCodeSignal(text) {
  return /(?:^|\n)\s*(?:function|class|const|let|var|import|export|def|if\s*\(|for\s*\(|while\s*\(|return\b|#include|public\s+class|SELECT\b|CREATE\b|BEGIN\b|END\b)/.test(String(text || ""));
}

function looksLikeNaturalLanguageCodeFence(text) {
  const value = String(text || "").replace(/\r\n?/g, "\n").trim();
  const compact = value.replace(/\n+/g, " ");
  const wordCount = (compact.match(/[A-Za-zÀ-ÖØ-öø-ÿ]{3,}/g) || []).length;
  if (wordCount < 24) {
    return false;
  }
  const sentenceCount = (compact.match(/[.!?]\s+(?:[A-ZÀ-Ö]|###|\d)/g) || []).length;
  const headingSignal = /^#{1,6}\s+\d+(?:\.\d+)*\s+\S+/m.test(value);
  const proseSignal = /\b(?:the|that|this|these|those|from|until|present|model|universe|observations?|theor(?:y|ies)|gravity|relativity|neutron|black hole|cosmological|physics)\b/i.test(compact);
  const codePunctuationRatio = ((value.match(/[{};=<>]/g) || []).length / Math.max(value.length, 1));
  return proseSignal && (sentenceCount >= 1 || headingSignal) && codePunctuationRatio < 0.08;
}

function getMineruPageCount() {
  return state.mineruInfo?.pdf_info?.length || 0;
}

function updatePager() {
  const total = state.pdfPageCount || getMineruPageCount();
  if (total && state.currentPage > total) {
    state.currentPage = total;
  }
  updateCorrectionSummary();
}

function updateCorrectionSummary() {
  return Boolean(state.mineruInfo);
}

async function copyButtonText(button, text) {
  if (!text) {
    return;
  }
  await navigator.clipboard.writeText(text);
  button.textContent = "已复制";
  window.setTimeout(() => {
    button.textContent = "复制";
  }, 1200);
}

function exportMineruMarkdown(useCorrections) {
  if (!state.mineruInfo) {
    return;
  }
  const markdown = buildBookMarkdown(useCorrections);
  const suffix = useCorrections ? "corrected" : "mineru-original";
  const filename = `${baseExportName()}-${suffix}.md`;
  downloadTextFile(filename, markdown);
  setStatus("Exported", "ok");
}

function buildBookMarkdown(useCorrections) {
  const total = getMineruPageCount();
  const pages = [];
  for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
    const markdown = prepareMarkdownForExport(useCorrections ? mineruMarkdownForPage(pageNumber) : baseMineruMarkdownForPage(pageNumber));
    pages.push(`<!-- page: ${pageNumber} -->\n\n${markdown || ""}`.trim());
  }
  const correctionNote = useCorrections
    ? `<!-- corrected_pages: ${correctedPageNumbers().join(", ") || "none"} -->\n\n`
    : "";
  return `${correctionNote}${pages.join("\n\n---\n\n")}\n`;
}

function prepareMarkdownForExport(markdown) {
  return normalizeSingleLineDisplayMath(
    wrapBareDisplayMathBlocks(normalizeMathMarkdown(markdown)),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function prepareMathpixMarkdown(markdown) {
  const rawMarkdown = normalizeMathpixOcrArtifacts(String(markdown || ""));
  const adaptMathpixToTargetMarkdown = getOcrCoreAdaptMathpixToTargetMarkdown();
  if (!adaptMathpixToTargetMarkdown) {
    warnOcrCoreMathpixAdapter("mathpixToTargetMarkdownAdapter 不可用，已保守返回原始 Markdown。");
    return rawMarkdown;
  }
  try {
    const result = adaptMathpixToTargetMarkdown({
      blockId: "legacy-prepareMathpixMarkdown",
      rawText: rawMarkdown,
      source: "mathpix",
      blockType: "unknown",
    });
    return normalizeMathpixOcrArtifacts(typeof result?.targetMarkdown === "string" ? result.targetMarkdown : rawMarkdown);
  } catch (error) {
    warnOcrCoreMathpixAdapter("prepareMathpixMarkdown 调用 mathpixToTargetMarkdownAdapter 失败，已保守返回原始 Markdown。", error);
    return rawMarkdown;
  }
}

function normalizeMathpixBrokenDiacritics(markdown) {
  let text = String(markdown || "").normalize("NFC");
  const diaeresisMap = {
    A: "Ä",
    E: "Ë",
    I: "Ï",
    O: "Ö",
    U: "Ü",
    Y: "Ÿ",
    a: "ä",
    e: "ë",
    i: "ï",
    o: "ö",
    u: "ü",
    y: "ÿ",
  };
  text = text.replace(/([AEIOUYaeiouy])[\u00a8\u0308](?=[A-Za-z])/g, (_match, letter) => diaeresisMap[letter] || letter);
  text = text.replace(/\b[Ee]\s*(?:ö|o[\u00a8\u0308]?|o)\s*t\s*v\s*(?:ö|o[\u00a8\u0308]?|[\u00a8\u0308]\s*o|o)\s*s\b/g, "Eötvös");
  text = text.replace(/([A-Za-z])\s*[\u00a8\u0308]\s+(?=[A-Za-z])/g, "$1 ");
  text = text.replace(/(^|[\s([{])[\u00a8\u0308]\s*(?=[A-Za-z])/g, "$1");
  return text.normalize("NFC");
}

// Legacy Mathpix cleanup helpers are kept for now so older paths can be audited
// before a later cleanup removes unused OCR compare normalization code.
function removeDanglingSingleDollarLines(markdown) {
  return String(markdown || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !/^\\?\$\s*,?\s*$/.test(String(line || "").trim()))
    .join("\n");
}

function normalizeSingleLineDisplayMath(markdown) {
  return String(markdown || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line) => {
      const trimmed = String(line || "").trim();
      const match = trimmed.match(/^\$\$(.+)\$\$$/);
      if (!match) {
        return [line];
      }
      const body = match[1].trim();
      return body ? ["$$", body, "$$"] : ["$$"];
    })
    .join("\n");
}

function repairBrokenDisplayMathDelimiters(markdown) {
  const normalized = String(markdown || "")
    .replace(/\$\$\s*(\\begin\s*\{(?:aligned|align|array|tabular|table|matrix|pmatrix|bmatrix|cases)\*?\})/g, "$$\n$1")
    .replace(/(\\end\s*\{(?:aligned|align|array|tabular|table|matrix|pmatrix|bmatrix|cases)\*?\})\s*\$\$/g, "$1\n$$");
  const lines = normalized.replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let mathEnvDepth = 0;
  for (const line of lines) {
    const trimmed = String(line || "").trim();
    if (trimmed === "$$" && mathEnvDepth > 0) {
      continue;
    }
    const begins = countMathEnvironmentTokens(trimmed, "begin");
    const ends = countMathEnvironmentTokens(trimmed, "end");
    output.push(line);
    mathEnvDepth = Math.max(0, mathEnvDepth + begins - ends);
  }
  return output.join("\n");
}

function countMathEnvironmentTokens(text, kind) {
  const pattern = new RegExp(`\\\\${kind}\\s*\\{(?:aligned|align|array|tabular|table|matrix|pmatrix|bmatrix|cases)\\*?\\}`, "g");
  return (String(text || "").match(pattern) || []).length;
}

function wrapBareDisplayMathBlocks(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let index = 0;
  let inDisplayMath = false;
  while (index < lines.length) {
    const trimmed = String(lines[index] || "").trim();
    if (trimmed === "$$") {
      inDisplayMath = !inDisplayMath;
      output.push(lines[index]);
      index += 1;
      continue;
    }
    if (String(lines[index] || "").trim() === "|") {
      const nextIndex = nextNonEmptyLineIndex(lines, index + 1);
      if (nextIndex >= 0 && isBareDisplayMathStart(lines[nextIndex])) {
        index += 1;
        continue;
      }
    }
    if (!inDisplayMath && isBareDisplayMathStart(lines[index])) {
      const { blockLines, nextIndex } = collectBareDisplayMathBlock(lines, index);
      output.push("$$", ...blockLines, "$$");
      index = nextIndex;
      continue;
    }
    output.push(lines[index]);
    index += 1;
  }
  return output.join("\n");
}

function wrapLikelyDisplayMathLines(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let inFence = false;
  let inDisplayMath = false;
  for (const line of lines) {
    const trimmed = String(line || "").trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      output.push(line);
      continue;
    }
    if (trimmed === "$$") {
      inDisplayMath = !inDisplayMath;
      output.push(line);
      continue;
    }
    if (inFence || inDisplayMath || !isLikelyStandaloneMathLine(trimmed)) {
      output.push(line);
      continue;
    }
    output.push("$$", trimmed, "$$");
  }
  return output.join("\n");
}

function isLikelyStandaloneMathLine(trimmed) {
  if (!trimmed || trimmed.includes("$") || trimmed.includes("|") || /^#{1,6}\s+/.test(trimmed) || /^[-*+]\s+/.test(trimmed)) {
    return false;
  }
  if (!/[=<>^_]/.test(trimmed)) {
    return false;
  }
  if (/\\(?:frac|sin|cos|tan|quad|widehat|hat|sqrt|left|right|epsilon|varepsilon|leq|geq|times|begin|end|sum|int|infty|kappa|ldots)/.test(trimmed)) {
    return true;
  }
  const plainMathLike = /^[A-Za-z0-9\\{}()[\]\s+\-*/^_=,.;:<>]+$/.test(trimmed);
  return plainMathLike && trimmed.length <= 180;
}

function isBareDisplayMathStart(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed === "$$" || trimmed.startsWith("```")) {
    return false;
  }
  return /^\\begin\s*\{(?:array|tabular|table|aligned|align|matrix|pmatrix|bmatrix|cases)\*?\}/.test(trimmed);
}

function collectBareDisplayMathBlock(lines, startIndex) {
  const firstLine = String(lines[startIndex] || "");
  const match = firstLine.match(/\\begin\s*\{([a-zA-Z*]+)\}/);
  const env = match ? match[1].replace(/\*$/, "") : "";
  const endPattern = env ? new RegExp(`\\\\end\\s*\\{${escapeRegExp(env)}\\*?\\}`) : /\\end\s*\{[a-zA-Z*]+\}/;
  const blockLines = [];
  let index = startIndex;
  while (index < lines.length) {
    blockLines.push(lines[index]);
    if (endPattern.test(lines[index])) {
      index += 1;
      break;
    }
    index += 1;
  }
  return { blockLines, nextIndex: index };
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function correctedPageNumbers() {
  const blockPages = Array.from(state.mineruBlockOverrides.entries())
    .filter(([, blocks]) => blocks.size > 0)
    .map(([pageNumber]) => pageNumber);
  return Array.from(new Set([...state.mineruOverrides.keys(), ...blockPages])).sort((a, b) => a - b);
}

function baseExportName() {
  const raw = state.mineruFileName || state.pdfFile?.name || "ocr-document";
  return raw
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 120);
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadBinaryFile(filename, bytes, mimeType) {
  const blob = new Blob([bytes], { type: mimeType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function postJson(path, body) {
  const response = await fetchApi(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsText(file);
  });
}

function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function truncateText(text, maxLength) {
  const value = String(text || "");
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function riskReasonLabel(reason) {
  return (
    {
      display_math_block: "独立公式",
      latex_math_environment: "LaTeX 公式环境",
      standalone_equation_line: "独立方程行",
      heading_special_symbol: "标题特殊符号",
      scientific_special_symbol: "科学特殊符号",
      footnote_marker_or_note: "脚注/注释",
      ocr_garbled_text: "疑似 OCR 字符乱码",
      content_list_discarded: "content_list 补充",
      pdf_text_reference_supplemental: "PDF 参考文献候选",
      background_heading_missing: "疑似漏识别标题",
      page_top_text_missing: "疑似漏识别页首正文",
      cross_page_continuation: "跨页续段",
      cross_page_previous_tail: "上一页边界候选",
      cross_page_next_head: "下一页边界候选",
      page_bottom_boundary: "页底待核查",
      math_dense_text: "公式密集段落",
      table_with_math: "表格含公式",
      compact_formula_maybe_missing_superscript: "疑似上标丢失",
      split_formula_tokens: "公式被拆散",
      matrix_like_layout: "矩阵/二维排版",
      pseudocode_like_layout: "伪代码/代码块",
      unbalanced_math_delimiter: "数学定界符不平衡",
      latex_command_spacing: "LaTeX 命令异常空格",
      risk: "高风险",
    }[reason] || reason
  );
}

function estimateDataUrlBytes(dataUrl) {
  const base64 = String(dataUrl || "").split(",", 2)[1] || "";
  return Math.round((base64.length * 3) / 4);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("加载页面截图失败"));
    image.src = dataUrl;
  });
}

async function cropPageImage(pageDataUrl, bbox, pageSize, padding = 8) {
  const image = await loadImage(pageDataUrl);
  const sourceWidth = Number(pageSize?.[0]) || image.naturalWidth || image.width;
  const sourceHeight = Number(pageSize?.[1]) || image.naturalHeight || image.height;
  const scaleX = (image.naturalWidth || image.width) / sourceWidth;
  const scaleY = (image.naturalHeight || image.height) / sourceHeight;
  const pad = normalizeCropPadding(padding);
  const x = Math.max(0, Math.floor((bbox[0] - pad.left) * scaleX));
  const y = Math.max(0, Math.floor((bbox[1] - pad.top) * scaleY));
  const right = Math.min(image.naturalWidth || image.width, Math.ceil((bbox[2] + pad.right) * scaleX));
  const bottom = Math.min(image.naturalHeight || image.height, Math.ceil((bbox[3] + pad.bottom) * scaleY));
  const width = Math.max(1, right - x);
  const height = Math.max(1, bottom - y);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, x, y, width, height, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

function normalizeCropPadding(padding = 8) {
  if (typeof padding === "number") {
    const value = Math.max(0, Number(padding) || 0);
    return { left: value, right: value, top: value, bottom: value };
  }
  const horizontal = Math.max(0, Number(padding?.horizontal ?? padding?.x ?? 0) || 0);
  const vertical = Math.max(0, Number(padding?.vertical ?? padding?.y ?? 0) || 0);
  return {
    left: Math.max(0, Number(padding?.left ?? horizontal) || 0),
    right: Math.max(0, Number(padding?.right ?? horizontal) || 0),
    top: Math.max(0, Number(padding?.top ?? vertical) || 0),
    bottom: Math.max(0, Number(padding?.bottom ?? vertical) || 0),
  };
}

function setStatus(text, tone, detail = "") {
  els.statusBadge.textContent = text;
  els.statusBadge.className = `status-badge ${tone === "busy" ? "is-busy" : tone === "error" ? "is-error" : ""}`;
  els.statusBadge.title = String(detail || "");
}

function stripMarkdownFence(text) {
  const stripped = String(text || "").trim();
  const match = stripped.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : stripped;
}

function normalizeMathMarkdown(text) {
  const markdown = String(text || "");
  const normalizeMathDelimiters = getOcrCoreNormalizeMathDelimiters();
  if (!normalizeMathDelimiters) {
    warnOcrCoreNormalizer("mathDelimiterNormalizer 不可用，已保守返回原始 Markdown。");
    return markdown;
  }
  try {
    const result = normalizeMathDelimiters({
      blockId: "legacy-normalizeMathMarkdown",
      blockText: markdown,
      blockType: "unknown",
    });
    return typeof result?.normalizedText === "string" ? result.normalizedText : markdown;
  } catch (error) {
    warnOcrCoreNormalizer("normalizeMathMarkdown 调用 mathDelimiterNormalizer 失败，已保守返回原始 Markdown。", error);
    return markdown;
  }
}

function isLikelyMarkdownTableLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed.includes("|")) {
    return false;
  }
  if (/\\(?:left|right)?\|/.test(trimmed)) {
    return false;
  }
  return trimmed.startsWith("|") || trimmed.endsWith("|") || /\s\|\s/.test(trimmed);
}

function wrapInlineMathOutsideMathSpans(text, inlineMathPattern) {
  const mathSpanPattern = /(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/g;
  return text
    .split(mathSpanPattern)
    .map((part) => {
      if (!part || /^(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)$/.test(part)) {
        return part;
      }
      return part.replace(inlineMathPattern, (match) => `$${match}$`);
    })
    .join("");
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function splitMarkdownTableRow(line) {
  const trimmed = line.trim();
  const body = trimOuterTablePipes(trimmed);
  const cells = [];
  let cell = "";
  let mathDelimiter = "";

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const previous = body[index - 1] || "";
    if (char === "$" && previous !== "\\") {
      const delimiter = body[index + 1] === "$" ? "$$" : "$";
      if (!mathDelimiter) {
        mathDelimiter = delimiter;
      } else if (mathDelimiter === delimiter) {
        mathDelimiter = "";
      }
      cell += delimiter;
      if (delimiter === "$$") {
        index += 1;
      }
      continue;
    }
    if (char === "|" && !mathDelimiter) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function trimOuterTablePipes(line) {
  let start = 0;
  let end = line.length;
  if (line[start] === "|") {
    start += 1;
  }
  if (line[end - 1] === "|" && line[end - 2] !== "\\") {
    end -= 1;
  }
  return line.slice(start, end);
}

function isMarkdownTableSeparator(line) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownTableStart(lines, index) {
  return (
    typeof lines[index] === "string" &&
    typeof lines[index + 1] === "string" &&
    lines[index].trim().startsWith("|") &&
    lines[index + 1].trim().startsWith("|") &&
    isMarkdownTableSeparator(lines[index + 1])
  );
}

function isCodeFenceStart(line) {
  return /^```/.test(String(line || "").trim());
}

function isDisplayMathStart(line) {
  const trimmed = String(line || "").trim();
  return trimmed === "$$" || /^\$\$.+\$\$$/.test(trimmed);
}

function collectDisplayMathBlock(lines, startIndex) {
  const first = String(lines[startIndex] || "").trim();
  const singleLine = first.match(/^\$\$(.+)\$\$$/);
  if (singleLine) {
    return { blockLines: [singleLine[1].trim()], nextIndex: startIndex + 1 };
  }
  const blockLines = [];
  let index = startIndex + 1;
  while (index < lines.length && String(lines[index] || "").trim() !== "$$") {
    blockLines.push(lines[index]);
    index += 1;
  }
  if (index < lines.length) {
    index += 1;
  }
  return { blockLines, nextIndex: index };
}

function renderDisplayMathBlock(lines) {
  const raw = lines.join("\n").trim();
  const formattedSource = formatLatexDisplayMathBody(raw);
  const labels = displayMathTagLabels(formattedSource);
  const mathSource = stripDisplayMathTags(formattedSource);
  const tagAttribute = labels.length ? ' data-equation-tag="true"' : "";
  const layoutClass = displayMathVisualLineCount(mathSource) > 1 ? " is-multiline" : " is-singleline";
  const labelHtml = labels.length
    ? `<span class="math-display-equation-tag" aria-label="公式编号">${labels.map((label) => `(${escapeHtml(label)})`).join(" ")}</span>`
    : "";
  return `<div class="math-display${layoutClass}"${tagAttribute}><div class="math-display-formula">$$\n${escapeHtml(mathSource)}\n$$</div>${labelHtml}</div>`;
}

function displayMathVisualLineCount(mathSource) {
  const source = String(mathSource || "")
    .replace(/\\begin\{[^}]+\}(?:\{[^}]*\})?/g, "")
    .replace(/\\end\{[^}]+\}/g, "")
    .trim();
  const rowBreaks = (source.match(/\\\\(?![A-Za-z])/g) || []).length;
  const explicitLines = source.split("\n").map((line) => line.trim()).filter(Boolean).length;
  return Math.max(rowBreaks + 1, explicitLines || 1);
}

function displayMathTagLabels(markdown) {
  return Array.from(String(markdown || "").matchAll(/\\tag\{([^}]+)\}/g))
    .map((match) => String(match[1] || "").trim())
    .filter(Boolean);
}

function stripDisplayMathTags(markdown) {
  return String(markdown || "")
    .replace(/^[ \t]*\\tag\{[^}]+\}[ \t]*$/gm, "")
    .replace(/[ \t]*\\tag\{[^}]+\}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderCodeBlock(lines) {
  const opener = lines[0].trim();
  const language = opener.replace(/^```/, "").trim();
  const body = lines.slice(1, -1).join("\n");
  if (looksLikeAlgorithmLines(lines.slice(1, -1))) {
    return renderAlgorithmBlock(lines.slice(1, -1));
  }
  const languageClass = language ? ` class="language-${escapeHtml(language)}"` : "";
  return `<pre><code${languageClass}>${escapeHtml(body)}</code></pre>`;
}

function looksLikeAlgorithmLines(lines) {
  const meaningful = lines.map((line) => String(line || "").trim()).filter(Boolean);
  if (meaningful.length < 2) {
    return false;
  }
  const hasLoop = meaningful.some((line) => /^for\b/i.test(cleanAlgorithmLine(line)));
  const hasEnd = meaningful.some((line) => /^end\b/i.test(cleanAlgorithmLine(line)));
  const hasAssignment = meaningful.some((line) => /^[A-Za-z]\s*=/.test(cleanAlgorithmLine(line)));
  return hasLoop && (hasEnd || hasAssignment);
}

function renderAlgorithmBlock(lines) {
  let indent = 0;
  const formatted = lines
    .map(cleanAlgorithmLine)
    .filter((line, index, arr) => line || (arr[index - 1] && arr[index + 1]))
    .map((line) => {
      if (!line) {
        return "";
      }
      if (/^end\b/i.test(line)) {
        indent = Math.max(0, indent - 1);
      }
      const rendered = `${"  ".repeat(indent)}${line}`;
      if (/^for\b/i.test(line)) {
        indent += 1;
      }
      return rendered;
    })
    .join("\n")
    .trim();
  return `<pre class="algorithm-block"><code>${escapeHtml(formatted)}</code></pre>`;
}

function renderMarkdownTable(lines) {
  const header = splitMarkdownTableRow(lines[0]);
  const bodyRows = lines.slice(2).map(splitMarkdownTableRow);
  const width = Math.max(header.length, ...bodyRows.map((row) => row.length), 1);
  const normalizeRow = (row) => row.concat(Array(Math.max(0, width - row.length)).fill(""));
  const headHtml = normalizeRow(header)
    .map((cell) => `<th>${renderInlineTextHtml(cell)}</th>`)
    .join("");
  const bodyHtml = bodyRows
    .map((row) => `<tr>${normalizeRow(row).map((cell) => `<td>${renderInlineTextHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="markdown-table-wrap"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

function isLatexTableAt(lines, index) {
  const current = String(lines[index] || "").trim();
  const next = String(lines[index + 1] || "").trim();
  return isLatexTableStart(current) || (current === "$$" && isLatexTableStart(next));
}

function isLatexTableStart(line) {
  return /^\\begin\s*\{(?:tabular|table)\*?\}/.test(String(line || "").trim());
}

function collectLatexTableBlock(lines, startIndex) {
  const blockLines = [];
  let index = startIndex;
  let openedDisplayMath = false;
  if (String(lines[index] || "").trim() === "$$") {
    openedDisplayMath = true;
    index += 1;
  }
  while (index < lines.length) {
    blockLines.push(lines[index]);
    if (/\\end\s*\{(?:tabular|table)\*?\}/.test(lines[index])) {
      index += 1;
      break;
    }
    index += 1;
  }
  if (openedDisplayMath && String(lines[index] || "").trim() === "$$") {
    index += 1;
  }
  return { blockLines, nextIndex: index };
}

function renderLatexTableBlock(lines) {
  const raw = lines.join("\n").replace(/^\s*\|\s*\n+/, "");
  const captionMatch = raw.match(/\\caption\{([^}]*)\}/);
  const caption = captionMatch ? captionMatch[1].trim() : "";
  const tableMatch = raw.match(
    /\\begin\s*\{(?:tabular)\*?\}\s*(?:\{[^}\n]*\})?([\s\S]*?)\\end\s*\{(?:tabular)\*?\}/,
  );
  const tableSource = tableMatch ? tableMatch[1] : raw;
  const body = tableSource
    .replace(/\\begin\s*\{table\*?\}/g, "")
    .replace(/\\end\s*\{table\*?\}/g, "")
    .replace(/\\captionsetup\{[^}]*\}/g, "")
    .replace(/\\caption\{[^}]*\}/g, "")
    .replace(/\\begin\s*\{(?:tabular)\*?\}\s*(?:\{[^}\n]*\})?/, "")
    .replace(/\\end\s*\{(?:tabular)\*?\}/, "")
    .trim();
  const rows = body
    .split(/\\\\/)
    .map((row) => row.replace(/\\hline/g, "").trim())
    .filter(Boolean)
    .map((row) => row.split("&").map((cell) => formatLatexTableCell(cell)));
  if (!rows.length) {
    return `<div class="math-display">$$\n${escapeHtml(raw)}\n$$</div>`;
  }
  const width = Math.max(...rows.map((row) => row.length), 1);
  const normalizeRow = (row) => row.concat(Array(Math.max(0, width - row.length)).fill(""));
  const [header, ...bodyRows] = rows;
  const headHtml = normalizeRow(header)
    .map((cell) => `<th>${renderInlineTextHtml(cell)}</th>`)
    .join("");
  const bodyHtml = bodyRows
    .map((row) => `<tr>${normalizeRow(row).map((cell) => `<td>${renderInlineTextHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<figure class="latex-table-figure">
    ${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}
    <div class="markdown-table-wrap latex-table-wrap"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>
  </figure>`;
}

function formatLatexTableCell(cell) {
  const text = String(cell || "")
    .trim()
    .replace(/^\$+|\$+$/g, "")
    .replace(/\s+/g, " ");
  if (!text) {
    return "";
  }
  if (/[\\_^{}]|(?:^|\s)[a-zA-Z]\s*=|\\times|\\widehat|\\left|\\right/.test(text)) {
    return `$${text}$`;
  }
  return text;
}

function renderParagraph(lines) {
  const text = normalizeRenderedParagraphText(lines.join("\n"));
  if (!text) {
    return "";
  }
  if (hasMarkdownImageReference(text)) {
    const imageHtml = extractMarkdownImageReferences(text)
      .map((image) => renderMarkdownImage(image.alt || "image", image.src))
      .join("");
    const textWithoutImages = normalizeRenderedParagraphText(stripMarkdownImageReferences(text));
    return `${imageHtml}${textWithoutImages ? `<p>${renderInlineTextHtml(textWithoutImages).replace(/\n/g, "<br>")}</p>` : ""}`;
  }
  return `<p>${renderInlineTextHtml(text).replace(/\n/g, "<br>")}</p>`;
}

function renderInlineTextHtml(text) {
  return String(text || "")
    .split(/(\$[^$\n]*\$|\\\([\s\S]*?\\\))/g)
    .map((part) => {
      if (!part) {
        return "";
      }
      if (/^(\$[^$\n]*\$|\\\([\s\S]*?\\\))$/.test(part)) {
        return escapeHtml(part);
      }
      return renderSimpleScienceTextHtml(part);
    })
    .join("");
}

function renderSimpleScienceTextHtml(text) {
  const replacements = [];
  const markerFor = (html) => {
    const marker = `\uE000${replacements.length}\uE001`;
    replacements.push(html);
    return marker;
  };
  const withMarkers = String(text || "")
    .replace(/\b([A-Za-z])_([A-Za-z]{1,3})\/([A-Za-z])_([A-Za-z]{1,3})\b/g, (_match, leftBase, leftSub, rightBase, rightSub) =>
      markerFor(`${scienceInlineSymbolHtml(leftBase, leftSub)}/${scienceInlineSymbolHtml(rightBase, rightSub)}`),
    )
    .replace(
      /(^|[^\p{L}\p{N}\\$])([Α-Ωα-ωµμ])\s*_\s*\{?([A-Za-z]{1,4})\}?(?![\p{L}\p{N}])/gu,
      (_match, prefix, symbol, suffix) => `${prefix}${markerFor(scienceInlineSymbolHtml(symbol, suffix))}`,
    )
    .replace(/\b([A-Za-z])_([A-Za-z]{1,3})\b/g, (_match, base, suffix) =>
      markerFor(scienceInlineSymbolHtml(base, suffix)),
    );
  return escapeHtml(withMarkers).replace(/\uE000(\d+)\uE001/g, (_match, index) => replacements[Number(index)] || "");
}

function scienceInlineSymbolHtml(base, suffix = "") {
  const safeBase = escapeHtml(base);
  const safeSuffix = escapeHtml(suffix);
  return `<span class="science-inline-symbol">${safeBase}${safeSuffix ? `<sub>${safeSuffix}</sub>` : ""}</span>`;
}

function normalizeRenderedParagraphText(text) {
  const source = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!source || !source.includes("\n") || shouldPreserveRenderedParagraphBreaks(source)) {
    return source;
  }
  return unwrapPlainTextParagraph(source);
}

function shouldPreserveRenderedParagraphBreaks(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  return lines.some((line) => /(?: {2,}|\\)$/.test(line) || /<br\s*\/?>/i.test(line));
}

function renderHeading(line) {
  const match = String(line || "").match(/^(#{1,6})\s+(.+)$/);
  if (!match) {
    return "";
  }
  const level = Math.min(match[1].length, 4);
  return `<h${level}>${escapeHtml(match[2].trim())}</h${level}>`;
}

function renderList(lines) {
  const items = lines
    .map((line) => line.replace(/^\s*[-*+]\s+/, "").trim())
    .filter(Boolean)
    .map((item) => `<li>${renderInlineTextHtml(item)}</li>`)
    .join("");
  return items ? `<ul>${items}</ul>` : "";
}

function renderBlockquote(lines) {
  const text = lines.map((line) => line.replace(/^\s*>\s?/, "")).join("\n");
  return `<blockquote>${renderMarkdownHtml(text)}</blockquote>`;
}

function isAlgorithmLine(line) {
  const trimmed = String(line || "").trim();
  return (
    /^for\b/i.test(trimmed) ||
    /^end\b/i.test(trimmed) ||
    /^\$[^$].*?\$$/.test(trimmed) ||
    /^\$[^$\n]+?\$\s*\S+/.test(trimmed) ||
    /^[A-Za-z]\s*=/.test(trimmed)
  );
}

function cleanAlgorithmLine(line) {
  let text = String(line || "")
    .trim()
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/^\$\$?\s*/, "")
    .replace(/\s*\$\$?$/, "")
    .replace(/\\sqrt\{\}\s*\(([^)]+)\)/g, "\\sqrt{$1}")
    .replace(/\\sqrt\{\}\{([^}]+)\}/g, "\\sqrt{$1}")
    .replace(/\\sqrt\{\s*\}\s*([A-Za-z0-9]+)/g, "\\sqrt{$1}")
    .replace(/\bfor\s+([^:]+?)\s*:\s*(\d+)/i, (_match, left, right) => `for ${left.replace(/\s+/g, " ").trim()}:${right}`)
    .replace(/\b([A-Za-z])\s*=\s*\1\s+2\b/g, "$1 = $1^2")
    .replace(/\b([A-Za-z])\s*=\s*\1\s*\^\s*2\b/g, "$1 = $1^2")
    .replace(/\b([A-Za-z])=([A-Za-z])\^2\b/g, "$1 = $2^2")
    .replace(/\s+/g, " ");
  text = text.replace(/\s*=\s*/g, " = ");
  return text;
}

function collectAlgorithmBlock(lines, startIndex) {
  const blockLines = [];
  let index = startIndex;
  let sawEnd = false;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = String(line || "").trim();
    if (!trimmed) {
      const nextLine = nextNonEmptyLine(lines, index + 1);
      if (sawEnd && nextLine && !/^for\b/i.test(nextLine.trim())) {
        break;
      }
      blockLines.push("");
      index += 1;
      continue;
    }
    if (blockLines.length && sawEnd && !isAlgorithmLine(line)) {
      break;
    }
    if (!isAlgorithmLine(line)) {
      break;
    }
    blockLines.push(line);
    if (/^end\b/i.test(trimmed)) {
      sawEnd = true;
    }
    index += 1;
  }

  return { blockLines, nextIndex: index };
}

function nextNonEmptyLine(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (String(lines[index] || "").trim()) {
      return lines[index];
    }
  }
  return "";
}

function nextNonEmptyLineIndex(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (String(lines[index] || "").trim()) {
      return index;
    }
  }
  return -1;
}

function renderMarkdownHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const parts = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }
    if (lines[index].trim() === "$") {
      index += 1;
      continue;
    }

    if (lines[index].trim() === "|") {
      const nextIndex = nextNonEmptyLineIndex(lines, index + 1);
      if (nextIndex >= 0 && isLatexTableAt(lines, nextIndex)) {
        index += 1;
        continue;
      }
    }

    if (/^(#{1,6})\s+/.test(lines[index].trim())) {
      parts.push(renderHeading(lines[index].trim()));
      index += 1;
      continue;
    }

    if (isStandaloneMarkdownImageLine(lines[index])) {
      const image = extractMarkdownImageReferences(lines[index])[0];
      if (image) {
        parts.push(renderMarkdownImage(image.alt || "image", image.src));
      }
      index += 1;
      continue;
    }

    if (isCodeFenceStart(lines[index])) {
      const codeLines = [lines[index]];
      index += 1;
      while (index < lines.length && !isCodeFenceStart(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        codeLines.push(lines[index]);
        index += 1;
      } else {
        codeLines.push("```");
      }
      parts.push(renderCodeBlock(codeLines));
      continue;
    }

    if (isBareDisplayMathStart(lines[index]) && !isLatexTableAt(lines, index)) {
      const { blockLines, nextIndex } = collectBareDisplayMathBlock(lines, index);
      parts.push(renderDisplayMathBlock(blockLines));
      index = nextIndex;
      continue;
    }

    if (/^for\b/i.test(lines[index].trim())) {
      const { blockLines, nextIndex } = collectAlgorithmBlock(lines, index);
      if (blockLines.some((line) => /^end\b/i.test(String(line || "").trim()))) {
        parts.push(renderAlgorithmBlock(blockLines));
        index = nextIndex;
        continue;
      }
    }

    if (isOrphanDisplayMathBodyStart(lines, index)) {
      const { blockLines, nextIndex } = collectOrphanDisplayMathBlock(lines, index);
      parts.push(renderDisplayMathBlock(blockLines));
      index = nextIndex;
      continue;
    }

    if (isDisplayMathStart(lines[index]) && !isLatexTableAt(lines, index)) {
      const { blockLines, nextIndex } = collectDisplayMathBlock(lines, index);
      parts.push(renderDisplayMathBlock(blockLines));
      index = nextIndex;
      continue;
    }

    if (isLatexTableAt(lines, index)) {
      const { blockLines, nextIndex } = collectLatexTableBlock(lines, index);
      parts.push(renderLatexTableBlock(blockLines));
      index = nextIndex;
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      const tableLines = [lines[index], lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }
      parts.push(renderMarkdownTable(tableLines));
      continue;
    }

    if (/^\s*[-*+]\s+/.test(lines[index])) {
      const listLines = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        listLines.push(lines[index]);
        index += 1;
      }
      parts.push(renderList(listLines));
      continue;
    }

    if (/^\s*>\s?/.test(lines[index])) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index]);
        index += 1;
      }
      parts.push(renderBlockquote(quoteLines));
      continue;
    }

    const paragraphLines = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index].trim()) &&
      !/^\s*[-*+]\s+/.test(lines[index]) &&
      !/^\s*>\s?/.test(lines[index]) &&
      !isDisplayMathStart(lines[index]) &&
      !isBareDisplayMathStart(lines[index]) &&
      !isLatexTableAt(lines, index) &&
      !isMarkdownTableStart(lines, index) &&
      !isCodeFenceStart(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    parts.push(renderParagraph(paragraphLines));
  }

  return parts.join("");
}

function isOrphanDisplayMathBodyStart(lines, startIndex) {
  const first = String(lines[startIndex] || "").trim();
  if (!first || isDisplayMathStart(first) || isCodeFenceStart(first)) {
    return false;
  }
  const closeIndex = findNextStandaloneDisplayMathDelimiter(lines, startIndex + 1);
  if (closeIndex < 0) {
    return false;
  }
  const blockText = lines.slice(startIndex, closeIndex).join("\n");
  if (hasInlineMathDelimiter(blockText)) {
    return false;
  }
  return /\\tag\{[^}]+\}/.test(blockText) || hasLatexMathEnvironment(blockText) || hasStandaloneEquationLine(blockText);
}

function findNextStandaloneDisplayMathDelimiter(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const trimmed = String(lines[index] || "").trim();
    if (!trimmed) {
      return -1;
    }
    if (trimmed === "$$") {
      return index;
    }
    if (isCodeFenceStart(trimmed) || /^(#{1,6})\s+/.test(trimmed) || /^\s*[-*+]\s+/.test(lines[index])) {
      return -1;
    }
  }
  return -1;
}

function collectOrphanDisplayMathBlock(lines, startIndex) {
  const closeIndex = findNextStandaloneDisplayMathDelimiter(lines, startIndex + 1);
  if (closeIndex < 0) {
    return { blockLines: [lines[startIndex]], nextIndex: startIndex + 1 };
  }
  return {
    blockLines: lines.slice(startIndex, closeIndex),
    nextIndex: closeIndex + 1,
  };
}

function typesetMath(root) {
  if (!root || !rootHasMathContent(root)) {
    return;
  }
  pendingMathTypesetRoots.add(root);
  if (mathTypesetTimer) {
    clearTimeout(mathTypesetTimer);
  }
  mathTypesetTimer = setTimeout(flushPendingMathTypeset, 80);
}

function flushPendingMathTypeset() {
  mathTypesetTimer = null;
  const roots = Array.from(pendingMathTypesetRoots).filter((root) => root?.isConnected !== false);
  pendingMathTypesetRoots.clear();
  if (!roots.length) {
    return;
  }
  if (window.MathJax?.typesetPromise) {
    typesetMathRoots(roots).catch((error) => reportMathJaxError(error));
    return;
  }
  ensureMathJaxLoaded()
    .then(() => {
      if (window.MathJax?.typesetPromise) {
        return typesetMathRoots(roots);
      }
      return null;
    })
    .catch((error) => reportMathJaxError(error));
}

async function typesetMathRoots(roots) {
  const targets = mathTypesetTargetsForRoots(roots);
  if (!targets.length || !window.MathJax?.typesetPromise) {
    return;
  }
  const failures = [];
  for (const target of targets) {
    try {
      window.MathJax.typesetClear?.([target]);
      await window.MathJax.typesetPromise([target]);
      target.removeAttribute?.("data-mathjax-render-error");
    } catch (error) {
      target.setAttribute?.("data-mathjax-render-error", "1");
      failures.push(error);
    }
  }
  if (failures.length) {
    throw failures[0];
  }
}

function mathTypesetTargetsForRoots(roots) {
  const seen = new Set();
  const targets = [];
  (Array.isArray(roots) ? roots : [roots]).forEach((root) => {
    mathTypesetTargetsForRoot(root).forEach((target) => {
      if (!target || seen.has(target)) {
        return;
      }
      seen.add(target);
      targets.push(target);
    });
  });
  return targets;
}

function mathTypesetTargetsForRoot(root) {
  if (!root || !rootHasMathContent(root)) {
    return [];
  }
  if (typeof root.querySelectorAll !== "function") {
    return [root];
  }
  const candidates = Array.from(
    root.querySelectorAll(".math-display-formula, p, li, td, th, figcaption"),
  ).filter((node) => rootHasMathContent(node));
  return candidates.length ? candidates : [root];
}

function reportMathJaxError(error) {
  const message = error?.message || String(error || "MathJax 渲染失败");
  setStatus("MathJax 渲染失败", "error", message);
  console.warn?.("[OCR Review] MathJax 渲染失败", error);
}

function rootHasMathContent(root) {
  const text = String(root?.textContent || "");
  return /(\$\$?|\\\(|\\\[|\\begin\{|\^|_\{)/.test(text);
}

async function ensurePdfJsLoaded() {
  if (pdfJsLoadPromise) {
    return pdfJsLoadPromise;
  }
  pdfJsLoadPromise = loadPdfJsFromFallbacks();
  return pdfJsLoadPromise;
}

async function loadPdfJsFromFallbacks() {
  const errors = [];
  for (const url of PDFJS_SCRIPT_URLS) {
    try {
      const pdfjs = await import(url);
      if (pdfjs?.GlobalWorkerOptions) {
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      }
      if (typeof pdfjs?.getDocument !== "function") {
        throw new Error(`PDF.js getDocument missing: ${url}`);
      }
      return pdfjs;
    } catch (error) {
      errors.push(error?.message || String(error || url));
    }
  }
  throw new Error(`PDF.js 加载失败：${errors.join("; ")}`);
}

function ensureMathJaxLoaded() {
  if (window.MathJax?.typesetPromise) {
    return Promise.resolve(window.MathJax);
  }
  if (mathJaxLoadPromise) {
    return mathJaxLoadPromise;
  }
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return Promise.reject(new Error("MathJax loader requires document.createElement."));
  }
  configureMathJax();
  mathJaxLoadPromise = loadMathJaxScriptFromFallbacks();
  return mathJaxLoadPromise;
}

function configureMathJax() {
  const existing = window.MathJax && typeof window.MathJax === "object" ? window.MathJax : {};
  window.MathJax = {
    ...existing,
    loader: {
      ...(existing.loader || {}),
      paths: {
        ...((existing.loader && existing.loader.paths) || {}),
        mathjax: "./vendor/mathjax",
      },
      load: Array.from(new Set([...(existing.loader?.load || []), "[tex]/boldsymbol"])),
    },
    tex: {
      ...(existing.tex || {}),
      packages: {
        ...((existing.tex && existing.tex.packages) || {}),
        "[+]": Array.from(new Set([...(existing.tex?.packages?.["[+]"] || []), "boldsymbol"])),
      },
      inlineMath: existing.tex?.inlineMath || [["$", "$"], ["\\(", "\\)"]],
      displayMath: existing.tex?.displayMath || [["$$", "$$"], ["\\[", "\\]"]],
      processEscapes: true,
    },
    options: {
      ...(existing.options || {}),
      skipHtmlTags: existing.options?.skipHtmlTags || ["script", "noscript", "style", "textarea", "pre", "code"],
    },
    startup: {
      ...(existing.startup || {}),
      typeset: false,
      pageReady:
        existing.startup?.pageReady ||
        (() =>
          window.MathJax.startup.defaultPageReady().then(() => {
            window.dispatchEvent(new Event("mathjax-ready"));
          })),
    },
  };
}

async function loadMathJaxScriptFromFallbacks() {
  const errors = [];
  for (const url of MATHJAX_SCRIPT_URLS) {
    try {
      return await loadMathJaxScript(url);
    } catch (error) {
      errors.push(error?.message || String(error || url));
    }
  }
  throw new Error(`MathJax failed to load: ${errors.join("; ")}`);
}

function loadMathJaxScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      script.remove?.();
      finish(reject, new Error(`MathJax load timed out: ${url}`));
    }, MATHJAX_LOAD_TIMEOUT_MS);
    script.src = url;
    script.async = true;
    script.dataset.ocrLazyMathjax = "1";
    script.addEventListener("load", () => {
      const startup = window.MathJax?.startup?.promise;
      if (startup?.then) {
        startup
          .then(() => {
            if (window.MathJax?.typesetPromise) {
              finish(resolve, window.MathJax);
            } else {
              finish(reject, new Error(`MathJax loaded without typesetPromise: ${url}`));
            }
          })
          .catch((error) => finish(reject, error));
      } else {
        finish(reject, new Error(`MathJax startup promise missing: ${url}`));
      }
    });
    script.addEventListener("error", () => finish(reject, new Error(`MathJax failed to load: ${url}`)));
    (document.head || document.body || document.documentElement).appendChild(script);
  });
}

initialize();
