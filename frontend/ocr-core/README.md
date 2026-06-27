# ocr-core

`ocr-core` is the future home for testable pure-function logic used by the third-column OCR correction workbench.

Current scope:

- Store regression fixtures.
- Define fixture and test conventions.
- Keep current behavior observable before extracting modules from `frontend/ocr-compare.js`.
- Provide isolated pure-function modules before they are wired into the OCR compare UI.

Planned modules:

- `blockParser`
- `mathDelimiterNormalizer`
- `mathpixToTargetMarkdownAdapter`
- `renderValidator`
- `patchGenerator`
- `patchMerger`

Rules:

- Pure-function modules must not call the Mathpix API.
- Pure-function modules must not access the DOM.
- Pure-function modules must not read or write the original Markdown file.
- Renderers must not modify source Markdown.
- UI code must not assemble final export Markdown.
- `mathpixToTargetMarkdownAdapter` only converts one Mathpix block into the third-column target Markdown dialect; it must not call Mathpix, patch files, or update UI state.
- `renderValidator` only reports static Markdown/LaTeX render risks for one block; it must not call MathJax, access the DOM, or repair Markdown.
- Pipeline tests compose adapter, delimiter normalization, and render validation on fixtures only; they must not call Mathpix, MathJax, the DOM, or OCR compare UI code.
- Patch modules define stable OCR correction patches and merge accepted patches by block hash only; they must not read/write Markdown files, call APIs, choose conflict winners, or touch UI state.
- `patch/ocrPatch.browser.js` exposes the patch pure-function contract as `globalThis.OcrCorePatch` for direct browser script loading; it must stay behavior-compatible with the CommonJS patch modules and must not become a separate source of truth.
- Block parser modules convert MinerU page blocks into stable OCR block records with `blockId` and `oldHash`; they must not normalize Markdown, call validators, generate patches, or touch UI state.
- When a MathJax display formula renders as raw `$$...$$`, inspect the exact persisted draft/editor Markdown, not only a cleaned manual copy. Known high-risk corruptions include `\begin{array}}{l}`, split array arguments such as `\begin{array}` followed by `}{l}`, and escaped displaystyle row closers such as `{\displaystyle ... \}`. These must be repaired in the OCR cleanup/normalization path before editor preview or accepted patch creation; the renderer must not silently create final manuscript text. Add a regression sample using the exact corrupted persisted text, not only the intended clean LaTeX.

Fixture convention:

- `*.input.md` is the raw OCR or adapter input.
- `*.expected.md` is the intended target Markdown after the relevant pure-function pipeline.
- Fixture names should describe the failure mode, not the implementation detail.
