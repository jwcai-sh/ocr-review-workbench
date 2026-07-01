# AGENTS.md

## Project Boundary

This repository is the standalone OCR Review Workbench.

Do not modify the old UnivModel MVP frontend at:

`/Users/Min369/Documents/同步空间/Manju/AIProjects/UnivModel/宇宙模型MVP`

unless the user explicitly asks for that path.

## Correction Data Flow

All OCR correction edits must keep using the existing patch flow:

- MinerU / content_list / PDF text layer produce candidates.
- Mathpix produces draft candidates.
- Human edits produce draft or accepted `OcrPatch`.
- Accepted preview/download reads accepted patches.

Do not let renderer-only code silently become the final corrected manuscript.
Do not change Mathpix API semantics.
Do not change formal export/download logic unless explicitly requested.

## Preflight Plan Before Code Edits

Before editing code, output a short Preflight Plan covering:

1. Task goal.
2. Files to change.
3. Files that will not be changed.
4. Whether the work touches `frontend/ocr-compare.js`, `state.ocrPatches`, DOM/UI buttons, browser wrapper, Mathpix API, or export/download logic.
5. Test commands.
6. Frontend smoke steps if the frontend is involved.

Unless the user explicitly says approval is required before execution, continue after the plan.

## GitHub / Zeabur Release Rule

For important functional changes, remember to complete the release path after local verification:

1. Commit and push to both GitHub remotes:
   - `origin/main`
   - `mwbel/main`
2. Redeploy or verify redeployment on Zeabur.
3. Confirm the Zeabur online app is healthy before reporting completion.

Small UI-only adjustments do not need to be committed, pushed, or redeployed every time unless the user explicitly asks.

## Top Figure/Table Ordering Debug Memo

A recurring failure mode in this workbench is that pages containing a figure or table near the top render with later paragraphs in the wrong order. Typical symptoms:

- A paragraph below a top figure/table appears before the figure/table in the right review column.
- The same paragraph appears twice, once from MinerU and once from `content_list`.
- A `Fig. 12.2 Although...` or `Table 2.2 In...` string appears as if it were a caption, but it is actually normal prose with a false leading figure/table label.
- A paragraph with a real bbox is still forced to the bottom because it was labeled `page_bottom`.
- Cross-page or content_list supplements are forced near an anchor even though their bbox places them much lower on the page.

The root cause is usually not Mathpix and not a single bad page. It is a review-entry ordering problem caused by mixing three concepts:

- **Caption recovery**: real figure/table captions should stay near the figure/table.
- **Narrative prose recovery**: discarded text that starts with `Fig.` or `Table` may still be body prose, not a caption.
- **Synthetic placement**: `page_top`, `page_bottom`, `after_anchor`, and content_list candidates must not override reliable bbox order.

Correct diagnostic sequence:

1. Inspect the actual right-column source for the affected block.
2. Check whether the block came from MinerU, `content_list`, PDF text, cross-page continuation, or accepted patch.
3. Check `bbox`, `pageSize`, `syntheticPlacement`, and `anchorBlockIndex`.
4. Verify whether `riskVisualOrder()` or accepted preview ordering is adding a huge fallback order to an entry that already has a bbox.
5. Check whether `Fig/Table + narrative prose` was misclassified as a caption or anchored continuation.

Correct repair strategy:

1. If an entry has a reliable bbox, visual order should primarily use the bbox. Do not add huge fallback offsets to bbox-backed synthetic entries.
2. `page_bottom` should only force an item to the bottom when there is no usable bbox. If bbox exists, sort by bbox.
3. `page_top` / cross-page continuation should not force top placement when bbox clearly places the text below a top figure/table.
4. `after_anchor` should be used only for true nearby continuations. If the candidate bbox is far below the anchor, preserve visual order.
5. Strip false narrative prefixes such as `Fig. 12.2 Although...` or `Table 2.2 In...` from body prose, but do not strip real captions such as `Fig. 12.2 Left: ... Right: ...`.
6. Apply the same ordering rules to accepted preview/download synthetic segments, not only to the live right-column view.
7. Add regression tests with real top-media patterns: top figure/table, prose immediately below, lower content_list supplement, and later prose below that supplement.

Do not fix this class of bug by changing Mathpix prompts, editing OCR source text manually, or adding page-specific hacks.
