const RUNTIME_CONFIG = window.__UMA_RUNTIME_CONFIG__ || {};
const API_BASE =
  RUNTIME_CONFIG.apiBaseUrl ||
  RUNTIME_CONFIG.backendUrl ||
  (window.location.protocol === "file:" || window.location.port !== "8787"
    ? "http://127.0.0.1:8787"
    : "");

const DEFAULT_PDF_IMAGE_ZOOM = 1.25;
const DEFAULT_REVIEW_FONT_SCALE = 1;

const state = {
  pdfFile: null,
  pdfDataUrl: "",
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
  reviewFontScale: DEFAULT_REVIEW_FONT_SCALE,
  middleColumnCollapsed: false,
  busy: false,
};
state.ocrPatches = state.ocrPatches || [];

const els = {};
const COLUMN_WIDTHS_KEY = "uma-ocr-compare-column-ratios-v6";
const MIDDLE_COLUMN_COLLAPSED_KEY = "uma-ocr-compare-middle-collapsed-v1";
const OCR_WORKSPACE_STORAGE_PREFIX = "uma-ocr-compare-workspace-v1";
const PDF_IMAGE_ZOOM_LEVELS = [1, 1.25, 1.5, 1.75, 2, 2.5];
const REVIEW_FONT_SCALE_LEVELS = [0.9, 1, 1.1, 1.2, 1.35, 1.5];
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
let riskAnalysisTimer = null;
let riskAnalysisRunId = 0;
let renderCurrentPageRunId = 0;
let pagePrefetchTimer = null;
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
  return `${API_BASE}${path}`;
}

function bindElements() {
  [
    "pdfInput",
    "mineruInput",
    "contentListInput",
    "pickPdfButton",
    "pickMineruButton",
    "pickContentListButton",
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
  els.pickPdfButton.addEventListener("click", () => openFilePicker(els.pdfInput));
  els.pickMineruButton.addEventListener("click", () => openFilePicker(els.mineruInput));
  els.pickContentListButton.addEventListener("click", () => openFilePicker(els.contentListInput));
  els.previewAcceptedBookButton?.addEventListener("click", toggleAcceptedBookPreview);
  els.downloadAcceptedCorrectedButton?.addEventListener("click", downloadAcceptedCorrectedFromTop);
  els.pdfInput.addEventListener("change", handlePdfChange);
  els.mineruInput.addEventListener("change", handleMineruChange);
  els.contentListInput.addEventListener("change", handleContentListChange);
  document.addEventListener("pointerdown", handleColumnResizeStart);
  window.addEventListener("resize", schedulePdfFocusSync);
  window.addEventListener("mathjax-ready", () => typesetMath(els.pageList));
  updateAcceptedPatchTopControls();
}

function openFilePicker(input) {
  if (!input) {
    return false;
  }
  input.value = "";
  input.click();
  return true;
}

async function handlePdfChange() {
  const file = els.pdfInput.files?.[0] || null;
  if (!file) {
    return;
  }
  setStatus("读取 PDF", "busy", file.name);
  try {
    const pdfDataUrl = await readFileAsDataUrl(file);
    state.pdfFile = file;
    state.pdfDataUrl = pdfDataUrl;
    state.pageCache.clear();
    state.pdfTextPageCache.clear();
    state.mathpixCache.clear();
    state.mathpixBlockDrafts.clear();
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
    state.pdfPageCount = preview.pageCount || preview.pages?.length || 1;
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
  setStatus("读取 MinerU", "busy", file.name);
  try {
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
  } catch (error) {
    setStatus("Error", "error", error.message);
    state.mineruInfo = null;
    state.mineruOverrides.clear();
    state.mineruBlockOverrides.clear();
    state.mathpixBlockDrafts.clear();
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
  setStatus("读取 content_list", "busy", file.name);
  try {
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

function resetPage() {
  clearPersistedOcrWorkspaceState();
  state.pdfFile = null;
  state.pdfDataUrl = "";
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
  const total = state.pdfPageCount || getMineruPageCount() || 1;
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
  const total = state.pdfPageCount || getMineruPageCount() || 1;
  const targets = {
    first: 1,
    prev: state.currentPage - 1,
    next: state.currentPage + 1,
    last: total,
  };
  await goToPage(targets[target] || state.currentPage);
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
  if (!state.pdfDataUrl && !state.mineruInfo) {
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
    return state.pageCache.get(state.currentPage);
  }
  if (!state.pdfDataUrl) {
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
  updatePager();
  setStatus("Ready", "ok");
  return page;
}

async function loadPagePreview(pageNumber) {
  const requestedPage = Number(pageNumber) || 1;
  if (pendingPagePreviewRequests.has(requestedPage)) {
    return pendingPagePreviewRequests.get(requestedPage);
  }
  const request = postJson("/api/ocr/preview-pages", {
    name: state.pdfFile?.name || "book.pdf",
    mimeType: state.pdfFile?.type || "application/pdf",
    dataUrl: state.pdfDataUrl,
    pageNumber: requestedPage,
    maxPages: 1,
    zoom: 1.8,
    includeText: true,
  }).finally(() => {
    pendingPagePreviewRequests.delete(requestedPage);
  });
  pendingPagePreviewRequests.set(requestedPage, request);
  const response = await request;
  if (!response.ok) {
    throw new Error(response.error || "PDF 页面渲染失败");
  }
  return response;
}

function scheduleAdjacentPagePreviewPrefetch() {
  if (!state.pdfDataUrl) {
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
  if (!state.pdfDataUrl || !state.pdfFile) {
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
  const response = await postJson("/api/ocr/preview-pages", {
    name: state.pdfFile.name || "book.pdf",
    mimeType: state.pdfFile.type || "application/pdf",
    dataUrl: state.pdfDataUrl,
    maxPages: total,
    zoom: 1,
    includeText: true,
    renderImages: false,
  });
  if (!response.ok) {
    throw new Error(response.error || "PDF 文本层读取失败");
  }
  (response.pages || []).forEach(cachePdfTextPage);
  return true;
}

function renderImageCard(page) {
  const card = document.createElement("section");
  const zoom = currentPdfImageZoom();
  const zoomIndex = PDF_IMAGE_ZOOM_LEVELS.indexOf(zoom);
  const atMinZoom = zoomIndex <= 0;
  const atMaxZoom = zoomIndex >= PDF_IMAGE_ZOOM_LEVELS.length - 1;
  card.className = `preview-card image-card ${zoom > 1 ? "is-zoomed" : ""}`;
  const reviewEntries = reviewEntriesForCurrentPage();
  const hotspotsHtml = page.image ? renderPdfBlockHotspots(reviewEntries) : "";
  const imageHtml = page.image
    ? `<div class="page-image-surface"><img src="${page.image}" alt="第 ${page.pageNumber} 页 OCR 截图">${hotspotsHtml}<div class="page-image-focus" data-page-image-focus hidden></div></div>`
    : `<div class="empty-inline">尚未选择 PDF。</div>`;
  card.innerHTML = `
    <div class="card-head image-card-head">
      <strong>第 ${state.currentPage} 页</strong>
      <div class="card-actions">
        <button class="text-button image-zoom-button" type="button" data-image-zoom="out" ${page.image && !atMinZoom ? "" : "disabled"} aria-label="缩小原文页" title="缩小">
          <span class="image-zoom-glyph" aria-hidden="true"><span>A</span><span>⌄</span></span>
        </button>
        <button class="text-button image-zoom-button" type="button" data-image-zoom="in" ${page.image && !atMaxZoom ? "" : "disabled"} aria-label="放大原文页" title="放大">
          <span class="image-zoom-glyph" aria-hidden="true"><span>A</span><span>⌃</span></span>
        </button>
        <span>${page.width || "-"} × ${page.height || "-"}</span>
      </div>
    </div>
    <div class="page-image-wrap" style="--pdf-image-zoom: ${zoom};">${imageHtml}</div>
  `;
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
    state.pdfImageZoom = PDF_IMAGE_ZOOM_LEVELS[Math.min(PDF_IMAGE_ZOOM_LEVELS.length - 1, index + 1)];
    return;
  }
  if (direction === "out") {
    state.pdfImageZoom = PDF_IMAGE_ZOOM_LEVELS[Math.max(0, index - 1)];
    return;
  }
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
  card.className = "review-card";
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
  card.querySelectorAll(".selected-block-toolbar, .block-source-detail").forEach((container) => {
    ["click", "pointerdown", "dblclick"].forEach((eventName) => {
      container.addEventListener(eventName, (event) => event.stopPropagation());
    });
  });
  card.querySelectorAll("[data-mathpix-edit], [data-mineru-source-edit]").forEach((editor) => {
    ["click", "pointerdown", "keydown"].forEach((eventName) => {
      editor.addEventListener(eventName, (event) => event.stopPropagation());
    });
    editor.addEventListener("input", () => updateReviewEditorActionState(editor));
    updateReviewEditorActionState(editor);
  });
  if (typeof card.addEventListener === "function") {
    card.addEventListener("input", (event) => {
      const editor = event.target?.closest?.("[data-mathpix-edit], [data-mineru-source-edit]");
      if (editor && card.contains(editor)) {
        updateReviewEditorActionState(editor);
      }
    });
  }
  card.querySelectorAll("[data-review-block-step]").forEach((button) => {
    button.addEventListener("click", () => navigateReviewBlock(button.dataset.reviewBlockStep));
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
  const fontScale = currentReviewFontScale();
  const fontScaleIndex = REVIEW_FONT_SCALE_LEVELS.indexOf(fontScale);
  return `
    <div class="review-navigation-bar" data-review-block-navigator>
      <div class="review-nav-controls">
        <div class="review-font-nav-group">
          <button class="text-button image-zoom-button" type="button" data-review-font-scale="out" ${fontScaleIndex <= 0 ? "disabled" : ""} aria-label="缩小右栏字体" title="缩小右栏字体">
            <span class="image-zoom-glyph" aria-hidden="true"><span>A</span><span>⌄</span></span>
          </button>
          <button class="text-button image-zoom-button" type="button" data-review-font-scale="in" ${fontScaleIndex >= REVIEW_FONT_SCALE_LEVELS.length - 1 ? "disabled" : ""} aria-label="放大右栏字体" title="放大右栏字体">
            <span class="image-zoom-glyph" aria-hidden="true"><span>A</span><span>⌃</span></span>
          </button>
        </div>
        <div class="review-page-nav-group">
          <span class="review-nav-group-label">页面</span>
          <div class="review-workbench-pager">
            ${renderPageNavigator("review-workbench")}
          </div>
        </div>
        <div class="review-block-nav-group">
          <span class="review-nav-group-label">块 ${activeIndex >= 0 ? `${activeIndex + 1} / ${entries.length}` : "0 / 0"}</span>
          <div class="review-block-nav-controls">
            <button class="secondary-button block-step-button" type="button" data-review-block-step="prev" ${activeIndex <= 0 ? "disabled" : ""} aria-label="上一校对块" title="上一校对块">‹</button>
            <select data-review-block-select aria-label="选择校对块" ${entries.length ? "" : "disabled"}>
              ${
                entries.length
                  ? entries.map((entry) => `<option value="${escapeHtml(entry.key)}" ${entry.key === active.key ? "selected" : ""}>${escapeHtml(reviewEntryLabel(entry))}</option>`).join("")
                  : '<option value="">当前页没有可校对块</option>'
              }
            </select>
            <button class="secondary-button block-step-button" type="button" data-review-block-step="next" ${activeIndex < 0 || activeIndex >= entries.length - 1 ? "disabled" : ""} aria-label="下一校对块" title="下一校对块">›</button>
          </div>
        </div>
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
  const orderByKey = new Map(segments.map((segment, index) => [String(segment.blockIndex), index]));
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
  const orderByKey = new Map(segments.map((segment, index) => [String(segment.blockIndex), index]));
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
  if (risk?.syntheticPlacement === "page_top") {
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
  return orderByKey.get(String(risk?.blockIndex)) ?? Number.MAX_SAFE_INTEGER / 2;
}

function reviewPatchMarkdown(patch) {
  if (!patch || !["draft", "accepted"].includes(patch.status)) {
    return "";
  }
  return String(patch.newText || "").trim() ? String(patch.newText || "") : "";
}

function renderPageReviewCanvas(reviewEntries) {
  const entries = Array.isArray(reviewEntries) ? reviewEntries : [];
  if (!entries.length) {
    return `<div class="review-list review-page-canvas markdown-body" style="--review-font-scale: ${currentReviewFontScale()};"><div class="empty-inline">当前页未发现可校对文本块。</div></div>`;
  }
  return `
    <div class="review-list review-page-canvas markdown-body" data-review-page-canvas style="--review-font-scale: ${currentReviewFontScale()};">
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
  const blockOverrides = getBlockOverrides(state.currentPage, false);
  const mathpixDrafts = getMathpixBlockDrafts(state.currentPage, false);
  const ocrPatch = getLatestOcrPatchForBlock(state.currentPage, blockKey, segment.markdown);
  const patchMarkdown = reviewPatchMarkdown(ocrPatch);
  const draftMarkdown = mathpixDrafts.get(blockKey) || "";
  const correctedMarkdown = blockOverrides.get(blockKey) || "";
  const displayMarkdown = draftMarkdown || patchMarkdown || correctedMarkdown || segment.markdown || risk.text || "";
  const selected = isActiveReviewBlockKey(fullKey);
  const corrected = blockOverrides.has(blockKey) || Boolean(ocrPatch?.status === "accepted");
  const hasDraft = Boolean(draftMarkdown || ocrPatch?.status === "draft");
  const itemState = hasDraft ? "mathpix-draft" : corrected ? "corrected" : risk.reviewOnly ? "normal" : "candidate";
  const correctionOpen = state.reviewCorrectionOpen.has(fullKey);
  const actionsOpen = state.reviewActionsOpen.has(fullKey) || correctionOpen;
  const needsCorrection = state.reviewNeedsCorrection.has(fullKey);
  const missingFigureLabel = inferMissingFigureLabelForBlock(state.currentPage, blockKey, segment.markdown || "");
  return `
    <section class="review-page-block ${selected ? "is-selected" : ""} ${corrected ? "is-corrected" : ""} ${hasDraft ? "has-mathpix-draft" : ""} ${needsCorrection ? "needs-extra-correction" : ""}" tabindex="0" role="button" data-review-page-block="${escapeHtml(fullKey)}" data-source-block-id="${escapeHtml(blockKey)}" data-review-item-state="${escapeHtml(itemState)}">
      ${
        actionsOpen
          ? `<div class="review-page-block-actions">
              <button class="review-page-mark-button ${needsCorrection ? "is-active" : ""}" type="button" data-review-needs-correction-toggle="${escapeHtml(fullKey)}" aria-pressed="${needsCorrection ? "true" : "false"}">
                需要额外校正
              </button>
              ${
                missingFigureLabel
                  ? `<button class="review-page-local-button" type="button" data-auto-add-figure-label="${escapeHtml(blockKey)}">补图号</button>`
                  : ""
              }
              <button class="review-page-correct-button" type="button" data-review-correction-toggle="${escapeHtml(fullKey)}" aria-expanded="${correctionOpen ? "true" : "false"}">
                ${correctionOpen ? "收起校正" : "校正"}
              </button>
            </div>`
          : ""
      }
      <div class="review-page-block-render">
        ${renderBlockContent(displayMarkdown, segment)}
      </div>
      ${
        correctionOpen
          ? renderSelectedBlockToolbar(
              segment,
              risk,
              correctedMarkdown,
              blockOverrides.has(blockKey),
              draftMarkdown,
              ocrPatch,
              { displayIndex: entry.displayIndex },
            )
          : ""
      }
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
  const patchMarkdown = reviewPatchMarkdown(ocrPatch);
  const hasPatchDraft = Boolean(patchMarkdown && ocrPatch?.status === "draft");
  const hasAcceptedPatchMarkdown = Boolean(patchMarkdown && ocrPatch?.status === "accepted");
  const hasMathpixDraft = Boolean(String(mathpixDraftMarkdown || "").trim()) || hasPatchDraft;
  const isCorrected = Boolean(corrected || hasAcceptedPatchMarkdown);
  const editableMarkdown = cleanMathpixEditableMarkdown(prepareMathpixMarkdown(mathpixDraftMarkdown || patchMarkdown || correctedMarkdown || ""));
  const hasEditableMarkdown = Boolean(editableMarkdown.trim());
  const previewMarkdown = hasMathpixDraft || hasAcceptedPatchMarkdown ? editableMarkdown : correctedMarkdown;
  const mathpixEditorIsSaved = Boolean(hasAcceptedPatchMarkdown && !hasMathpixDraft && editableMarkdown === prepareMathpixMarkdown(patchMarkdown));
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
              <button class="text-button" type="button" data-apply-mineru-source-edit="${escapeHtml(String(segment.blockIndex))}" data-disable-when-clean="1" data-clean-label="未修改" data-dirty-label="保持修改" disabled>
                未修改
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
              <button class="text-button" type="button" data-apply-mathpix-block-edit="${escapeHtml(String(segment.blockIndex))}" data-clean-label="${hasMathpixDraft ? "保持修改" : "未修改"}" data-dirty-label="保持修改" ${hasMathpixDraft ? "" : 'data-disable-when-clean="1" disabled'}>
                ${hasMathpixDraft ? "保持修改" : "未修改"}
              </button>
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
      : `<button class="text-button risk-action" type="button" data-risk-mathpix="${segment.blockIndex}" ${disabled}>
          ${isCorrected ? "Mathpix 重校正" : risk.bbox ? "Mathpix 校正" : "缺少 bbox"}
        </button>`;
    const saveActionHtml = hasEditableMarkdown
      ? `<button class="text-button selected-save-action" type="button" data-toolbar-apply-mathpix-block-edit="${escapeHtml(String(segment.blockIndex))}" data-clean-label="${hasMathpixDraft ? "保持修改" : "未修改"}" data-dirty-label="保持修改" ${hasMathpixDraft ? "" : 'data-disable-when-clean="1" disabled'}>${hasMathpixDraft ? "保持修改" : "未修改"}</button>`
      : `<button class="text-button selected-save-action" type="button" data-toolbar-apply-mineru-source-edit="${escapeHtml(String(segment.blockIndex))}" data-disable-when-clean="1" data-clean-label="未修改" data-dirty-label="保持修改" disabled>未修改</button>`;
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
          </div>
        </div>
        <div class="selected-block-toolbar-body">
          ${renderCompactSelectedBlockEditor({
            segment,
            editableMarkdown,
            hasEditableMarkdown,
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
              : `<button class="text-button risk-action" type="button" data-risk-mathpix="${segment.blockIndex}" ${disabled}>
                  ${isCorrected ? "Mathpix 重校正" : risk.bbox ? "Mathpix 校正" : "缺少 bbox"}
                </button>`
          }
        </div>
      </div>
      <div class="review-item-body" ${expanded ? "" : "hidden"}>
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

function renderCompactSelectedBlockEditor({ segment, editableMarkdown, hasEditableMarkdown, mathpixEditorIsSaved }) {
  const blockIndex = escapeHtml(String(segment?.blockIndex ?? ""));
  const mineruMarkdown = escapeHtml(String(segment?.markdown || ""));
  const mathpixMarkdown = escapeHtml(String(editableMarkdown || ""));
  const sourceEditorHtml = hasEditableMarkdown
    ? `<details class="block-source-detail selected-source-detail">
        <summary>查看/编辑 Mathpix draft / accepted Markdown</summary>
        <textarea class="mathpix-source-editor" data-mathpix-edit="${blockIndex}" spellcheck="false">${mathpixMarkdown}</textarea>
        <div class="mathpix-edit-actions">
          <button class="text-button" type="button" data-apply-mathpix-block-edit="${blockIndex}" data-clean-label="${mathpixEditorIsSaved ? "未修改" : "保持修改"}" data-dirty-label="保持修改" ${mathpixEditorIsSaved ? 'data-disable-when-clean="1" disabled' : ""}>
            ${mathpixEditorIsSaved ? "未修改" : "保持修改"}
          </button>
        </div>
      </details>`
    : `<details class="block-source-detail selected-source-detail">
        <summary>查看/编辑 MinerU 源码</summary>
        <textarea class="mathpix-source-editor block-source-editor" data-mineru-source-edit="${blockIndex}" spellcheck="false">${mineruMarkdown}</textarea>
        <div class="mathpix-edit-actions">
          <button class="text-button" type="button" data-apply-mineru-source-edit="${blockIndex}" data-disable-when-clean="1" data-clean-label="未修改" data-dirty-label="保持修改" disabled>
            未修改
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
  const toolbarButton = toolbar?.querySelector?.("[data-toolbar-apply-mathpix-block-edit], [data-toolbar-apply-mineru-source-edit]");
  const currentValue = String(editor.value || "");
  const initialValue = String(editor.defaultValue ?? "");
  const isDirty = currentValue !== initialValue;
  const syncButton = (targetButton) => {
    if (!targetButton) {
      return;
    }
    if (targetButton.dataset?.disableWhenClean === "1") {
      targetButton.disabled = !isDirty;
      targetButton.textContent = isDirty ? targetButton.dataset.dirtyLabel || "保持修改" : targetButton.dataset.cleanLabel || "未修改";
      return;
    }
    if (targetButton.dataset?.dirtyLabel && isDirty) {
      targetButton.textContent = targetButton.dataset.dirtyLabel;
    }
  };
  syncButton(button);
  syncButton(toolbarButton);
  if (button?.dataset?.disableWhenClean === "1") {
    button.disabled = !isDirty;
    return isDirty;
  }
  return isDirty;
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
  if (!entries.length) {
    return;
  }
  const currentIndex = Math.max(0, activeReviewEntryIndex(entries));
  const delta = direction === "prev" ? -1 : 1;
  const nextIndex = clamp(currentIndex + delta, 0, entries.length - 1);
  await selectReviewBlock(entries[nextIndex].key);
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

function refreshRightWorkbenchOnly(options = {}) {
  if (typeof document === "undefined" || !els.pageList) {
    return false;
  }
  const current = els.pageList.querySelector(".right-workbench-card");
  if (!current) {
    return false;
  }
  const scrollState = options.preserveReviewScroll ? captureRightWorkbenchScrollState(current, options.preserveReviewAnchorKey) : null;
  const next = renderRightWorkbench(state.pageCache.get(state.currentPage) || null);
  current.replaceWith(next);
  typesetMath(next);
  restoreRightWorkbenchScrollState(next, scrollState);
  scheduleRightWorkbenchScrollRestore(next, scrollState);
  updateAcceptedPatchTopControls();
  return true;
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
  const risks = state.riskByPage.get(state.currentPage) || [];
  return buildReviewEntriesForPage(risks, reviewSegmentsForPage(state.currentPage), state.currentPage);
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
  const targetPage = Number(pageNumber);
  if (!Number.isFinite(targetPage) || targetPage < 1) {
    return;
  }
  state.currentPage = Math.max(1, Math.min(targetPage, state.pdfPageCount || getMineruPageCount() || 1));
  state.acceptedPatchPreview = null;
  state.reviewExpanded.clear();
  expandOnlyReviewBlock(state.currentPage, String(blockIndex || ""));
  updatePager();
  await renderCurrentPage();
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
  return trigger?.closest?.(".review-item, .selected-block-toolbar, .selected-block-compact-actions")?.querySelector?.(selector) || null;
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
    const activeMarkdown = mathpixDrafts.get(blockKey) || blockOverrides.get(blockKey) || reviewPatchMarkdown(existingPatch) || sourceMarkdown;
    const numberedMarkdown = autoCorrectMathEquationNumberMarkdown(pageNo, blockKey, activeMarkdown, segment);
    if (numberedMarkdown && numberedMarkdown !== activeMarkdown.replace(/\r\n?/g, "\n").trim()) {
      if (saveAutomaticAcceptedBlockPatch(pageNo, blockKey, sourceMarkdown, numberedMarkdown, "equation_number_preservation")) {
        changedCount += 1;
      }
      return;
    }
    if (mathpixDrafts.has(blockKey) || existingPatch?.status === "draft") {
      return;
    }
    const existingAutoCorrection = String(existingPatch?.metadata?.autoCorrection || "");
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
  const numberSourceSegments = segments.concat(
    contentListEquationNumberSegmentsForPage(pageNumber, pageSize),
    pdfTextEquationNumberSegmentsForPage(pageNumber, pageSize),
  );
  const nearbyByIndex = segments
    .filter((item) => {
      const index = Number(item.blockIndex);
      if (String(item.blockIndex) === blockKey) {
        return false;
      }
      return Number.isFinite(index) && Number.isFinite(currentIndex) && Math.abs(index - currentIndex) <= 4;
    })
    .map((item) => String(item.markdown || "").trim())
    .filter((text) => isEquationNumberOnlyText(text) || /^\\tag\{[^}]+\}$/.test(text));
  const bboxMatched = nearestEquationNumberSegmentsByBBox(
    numberSourceSegments,
    currentSegment?.bbox || risk?.bbox,
    currentSegment?.pageSize || risk?.pageSize,
    blockKey,
  ).map((item) => String(item.markdown || "").trim());
  return Array.from(new Set([...nearbyByIndex, ...bboxMatched])).join("\n");
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
  const lineAdjusted = source.includes("\n") ? autoUnwrapMineruLineBreaks(source) : source.trim();
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
  const lines = text.split("\n");
  return !lines.some((line) => isLikelyMarkdownTableLine(line) || /^#{1,6}\s+/.test(line.trim()) || /^\s*[-*+]\s+/.test(line));
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
  return output.replace(/[ \t]{2,}/g, " ");
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
  return Boolean(nextChar) && !/\s|[,.;:!?，。；：！？)\]\}]/.test(nextChar);
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
  const strongSignals = [
    /\b(?:showing|shows|shown|plotted|illustrates|selected)\b/i,
    /\b(?:figure|diagram|plot|curve|graph|panel)\b/i,
    /\b(?:grey|gray|light|dark|shaded)\s+(?:region|band|area)\b/i,
    /\b(?:bounds?|limits?)\s+on\b/i,
    /\b(?:x-axis|y-axis|axis|axes|horizontal|vertical)\b/i,
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
  const normalizedMarkdown = normalizeInlineMathSpacingForRender(normalizeDisplayMathForRender(markdown));
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
  return compactLatexSourceSpacing(normalizeInlineMathSpacingOutsideDisplayMath(String(markdown || ""))).trim();
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
      return inDisplayMath || isLatexDenseSourceLine(line) ? compactLatexSourceLine(line) : line;
    })
    .join("\n");
}

function isLatexDenseSourceLine(line) {
  const text = String(line || "");
  return /\\[A-Za-z]+|[_^]\s*\{|\\begin\s*\{|\\end\s*\{/.test(text);
}

function compactLatexSourceLine(line) {
  return String(line || "")
    .replace(/\\([A-Za-z]+)\s+\*/g, "\\$1*")
    .replace(/\\([A-Za-z]+\*)\s+\{/g, "\\$1{")
    .replace(/\\([A-Za-z]+)\s+\{/g, "\\$1{")
    .replace(/\\([A-Za-z]+)\s+([_^])/g, "\\$1$2")
    .replace(/([_^])\s+\{/g, "$1{")
    .replace(/\{\s+/g, "{")
    .replace(/\s+\}/g, "}")
    .replace(/\}\s+\{/g, "}{")
    .replace(/\s+([_^])/g, "$1")
    .replace(/\\begin\{array\}\s*\{([^}]*)\}/g, (_match, columns) => `\\begin{array}{${String(columns || "").replace(/\s+/g, "")}}`)
    .replace(/\\operatorname\*\{([^}]*)\}/g, (_match, name) => `\\operatorname*{${compactSpacedLetters(name)}}`)
    .replace(/\\operatorname\{([^}]*)\}/g, (_match, name) => `\\operatorname{${compactSpacedLetters(name)}}`)
    .replace(/\\mathrm\{([^}]*)\}/g, (_match, value) => `\\mathrm{${compactSpacedLetters(value)}}`)
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trimEnd();
}

function compactSpacedLetters(text) {
  const value = String(text || "").trim();
  return /^[A-Za-z](?:\s+[A-Za-z])+$/.test(value) ? value.replace(/\s+/g, "") : value;
}

function shouldRenderAsAlgorithmBlock(markdown, entry) {
  if (entry?.kind !== "algorithm") {
    return false;
  }
  return !hasLatexMathEnvironment(markdown);
}

function hasLatexMathEnvironment(markdown) {
  return /\\begin\s*\{(?:aligned|align|array|matrix|pmatrix|bmatrix|cases|split|gather|equation)\*?\}/.test(String(markdown || ""));
}

function normalizeDisplayMathForRender(markdown) {
  const normalized = removeDanglingSingleDollarLines(normalizeEscapedDisplayMathNewlines(markdown));
  const repaired = repairBrokenDisplayMathDelimiters(normalized);
  const mathNormalized = restoreDroppedDisplayMathDelimiters(repaired, normalizeMathMarkdown(repaired));
  const wrapped = wrapBareDisplayMathBlocks(mathNormalized);
  return removeDanglingSingleDollarLines(wrapped);
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
  if (state.busy || !state.pdfDataUrl) {
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
  if (!state.pdfDataUrl) {
    setStatus("先上传 PDF", "error");
    return;
  }
  const blockKey = String(blockIndex);
  const risk = reviewRiskForBlock(state.currentPage, blockKey);
  if (!risk?.bbox) {
    setStatus("No bbox", "error");
    return;
  }
  state.busy = true;
  updatePager();
  setStatus("Block OCR", "busy");
  try {
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
    const preparedMarkdown = prepareMathpixMarkdown(data.markdown || data.answer || "");
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
    saveOcrWorkspaceState();
    expandOnlyReviewBlock(state.currentPage, blockKey);
    updateCorrectionSummary();
    setStatus("Draft ready", "ok");
  } catch (error) {
    setStatus("Error", "error");
    state.mathpixCache.set(state.currentPage, { error: error.message });
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
  return blocks.map((block, blockIndex) => ({
    block,
    blockIndex,
    bbox: getBlockBBox(block),
    markdown: blockToMarkdown(block),
    pageSize: page.page_size,
  }));
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
  return blocks.map((block, blockIndex) => {
    const scopedBlock = filterBlockLines(block, (line) => !lineHasCrossPageContent(line));
    return {
      block,
      blockIndex,
      bbox: getBlockBBox(scopedBlock) || getBlockBBox(block),
      markdown: blockToMarkdown(scopedBlock),
      pageSize: page.page_size,
    };
  });
}

function reviewSegmentsForPage(pageNumber) {
  return segmentEntries(reviewBlockMarkdownsForPage(pageNumber));
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

function isAlgorithmStartEntry(entry) {
  return /^for\b/i.test(entryAlgorithmText(entry));
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
  const completeNewText = preserveMathpixPlainTextCompleteness(oldText, newText, source);
  const preservedNewText = preserveEquationNumbersFromOriginal(preservationSource, completeNewText);
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
  return output.replace(trailingNumberPattern, `$1\n\\tag{${number}}$2`);
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
    return `${output.slice(0, afterEnvironment)}\n\\tag{${number}}${output.slice(afterEnvironment)}`;
  }
  const displayClose = findLastDisplayMathClose(output);
  if (displayClose) {
    return `${output.slice(0, displayClose.index).trimEnd()}\n\\tag{${number}}\n${output.slice(displayClose.index)}`;
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
    const text = autoCorrectMathEquationNumberMarkdown(pageNumber, segment?.blockIndex, rawText, segment) || rawText;
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
    if (!patchedMarkdown) {
      return patch;
    }
    return {
      ...patch,
      newText: patchedMarkdown,
      metadata: {
        ...(patch.metadata || {}),
        previewEquationNumberFallback: true,
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
  if (!state.pdfDataUrl || !Array.isArray(refs) || !refs.length) {
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
    .concat(detectContentListRiskCandidatesForPage(pageNumber));
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
  return items
    .map((item, pageItemIndex) => contentListItemToRiskCandidate(item, pageNumber, pageItemIndex, pageSize, middleTexts))
    .filter(Boolean);
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

function contentListItemToRiskCandidate(item, pageNumber, pageItemIndex, pageSize, middleTexts) {
  if (!item || item.type !== "discarded") {
    return null;
  }
  const text = contentListItemText(item);
  const normalized = normalizeTextForComparison(text);
  if (
    !normalized ||
    normalized.length < 4 ||
    isPageNumberOnlyText(normalized) ||
    isTextRedundantWithNormalizedSet(normalized, middleTexts)
  ) {
    return null;
  }
  const bbox = normalizedBBox(item.bbox);
  const geometry = bbox ? bboxGeometryForPageSize(bbox, pageSize) : null;
  const scored = scoreRiskBlock(text);
  const reasons = scored.reasons.slice();
  let score = scored.score;
  const isTopCandidate = Boolean(geometry?.topRatio <= 0.2 && text.length >= 6);
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
    syntheticPlacement: isTopCandidate ? "page_top" : isBottomCandidate ? "page_bottom" : "content_list",
    syntheticLabel: isFootnoteCandidate ? "content_list 脚注候选" : isTopCandidate ? "content_list 标题候选" : "content_list 补充候选",
    supplementalSource: "content_list",
    contentListIndex: item.__contentListIndex,
  };
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
      return fencedCode(nested);
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
      return htmlTableToMarkdown(html);
    }
  }
  if (block.type === "image") {
    const imagePath = firstSpanValue(block, "image_path");
    return imagePath ? `![image](${imagePath})` : "";
  }
  if (block.type === "code") {
    return fencedCode(collectBlockText(block).trim());
  }
  const text = collectBlockText(block).trim();
  if (!text) {
    return "";
  }
  if (block.type === "title") {
    return `### ${text}`;
  }
  if (block.type === "list") {
    return text
      .split("\n")
      .map((line) => (line.trim() ? `- ${line.trim()}` : ""))
      .join("\n");
  }
  return text;
}

function collectBlockText(block, options = {}) {
  const chunks = [];
  if (Array.isArray(block.lines)) {
    block.lines.forEach((line) => {
      const lineText = (line.spans || []).map((span) => spanToMarkdown(span, options)).join("");
      if (lineText.trim()) {
        chunks.push(lineText.trim());
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
  return chunks.join("\n");
}

function spanToMarkdown(span, options = {}) {
  if (!span || typeof span !== "object") {
    return "";
  }
  if (span.html) {
    return htmlTableToMarkdown(span.html);
  }
  const content = String(span.content || "");
  if (!content && span.image_path) {
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
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  const rows = Array.from(doc.querySelectorAll("tr")).map((row) =>
    Array.from(row.querySelectorAll("th,td")).map((cell) => cell.textContent.trim().replace(/\s+/g, " "))
  );
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

function fencedCode(text) {
  return `\`\`\`\n${text}\n\`\`\``;
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
  const rawMarkdown = String(markdown || "");
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
    return typeof result?.targetMarkdown === "string" ? result.targetMarkdown : rawMarkdown;
  } catch (error) {
    warnOcrCoreMathpixAdapter("prepareMathpixMarkdown 调用 mathpixToTargetMarkdownAdapter 失败，已保守返回原始 Markdown。", error);
    return rawMarkdown;
  }
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
  const response = await fetch(apiUrl(path), {
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
  const labels = displayMathTagLabels(raw);
  const mathSource = stripDisplayMathTags(raw);
  const labelHtml = labels.length
    ? `<span class="math-display-equation-tag" aria-label="公式编号">${labels.map((label) => `(${escapeHtml(label)})`).join(" ")}</span>`
    : "";
  return `<div class="math-display"><div class="math-display-formula">$$\n${escapeHtml(mathSource)}\n$$</div>${labelHtml}</div>`;
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
    .map((cell) => `<th>${escapeHtml(cell)}</th>`)
    .join("");
  const bodyHtml = bodyRows
    .map((row) => `<tr>${normalizeRow(row).map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
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
    .map((cell) => `<th>${escapeHtml(cell)}</th>`)
    .join("");
  const bodyHtml = bodyRows
    .map((row) => `<tr>${normalizeRow(row).map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
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
  const text = lines.join("\n").trim();
  if (!text) {
    return "";
  }
  if (hasMarkdownImageReference(text)) {
    const imageHtml = extractMarkdownImageReferences(text)
      .map((image) => renderMarkdownImage(image.alt || "image", image.src))
      .join("");
    const textWithoutImages = stripMarkdownImageReferences(text).trim();
    return `${imageHtml}${textWithoutImages ? `<p>${escapeHtml(textWithoutImages).replace(/\n/g, "<br>")}</p>` : ""}`;
  }
  return `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
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
    .map((item) => `<li>${escapeHtml(item)}</li>`)
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
    window.MathJax.typesetPromise(roots).catch(() => {});
    return;
  }
  ensureMathJaxLoaded()
    .then(() => {
      if (window.MathJax?.typesetPromise) {
        return window.MathJax.typesetPromise(roots);
      }
      return null;
    })
    .catch(() => {});
}

function rootHasMathContent(root) {
  const text = String(root?.textContent || "");
  return /(\$\$?|\\\(|\\\[|\\begin\{|\^|_\{)/.test(text);
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
  mathJaxLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";
    script.async = true;
    script.dataset.ocrLazyMathjax = "1";
    script.addEventListener("load", () => resolve(window.MathJax));
    script.addEventListener("error", () => reject(new Error("MathJax failed to load.")));
    (document.head || document.body || document.documentElement).appendChild(script);
  });
  return mathJaxLoadPromise;
}

initialize();
