# Métré assisted entry

**Goal:** Deliver the approved next step: bulk entry, work templates and engineering coherence review in the current period editor.

**Architecture:** Local, typed helpers for clipboard parsing, templates and deterministic review. Dedicated client dialog and review panel use the existing editor mutations. All changes remain drafts until the existing save/decompte action. Preserve steel factors, signed deductions, prior periods, theme tokens and concurrent authentication changes.

**Approved design:** Native clipboard paste from Excel (tab or semicolon separated, with optional recognized headers), editable column mapping, explicit preview/errors and atomic append into the current direct/subsection table. Work templates offer relevant choices for volume/surface/length/steel/count units, explain fields and preview quantity. Multi-row selection supports bulk numeric fill, duplication and deletion. Undo preserves server persistence. Review detects missing/zero/implausible dimensions, unsupported diameters, duplicate repères, combined steel repetitions, counts normalized by the engine and contract overruns; each issue explains its rule and opens its source. Heuristics remain advisory. No language model, OCR, schema change or dependency installation in this step.

## Tasks

- [x] Write failing tests for clipboard locale/quotes/header mapping/malformed input/limits/unit mismatches, template quantities and review rules including valid deductions.
- [x] Implement helpers in `apps/web/src/lib/metre-entry.ts` and `metre-review.ts`.
- [x] Implement accessible bulk/template dialog, column mapping, preview and scoped append.
- [x] Add selection, bulk fill/duplicate/delete and undo; preserve invalid drafts and persistence flags.
- [x] Integrate review panel and row navigation into editor.
- [x] Run unit tests, TypeScript and isolated browser journeys; independently review code and fix defects.
- [x] Build and activate local web service once code is final; verify live page without changing real measurements and capture screenshots.

## Verification focus

Mixed-unit imports must be blocked, not converted silently. Excel headers and computed result columns must not become dimensions. Preview must match the selected steel subsection factor and KG/T conversion. Bulk operations must not overwrite unselected or hidden rows. Undo after save must retain persisted empty entries. Invalid text must survive hiding and prevent save. Review must distinguish plausible signed deductions from negative dimensions and describe heuristics as checks rather than diagnoses.

## Execution record

- Existing métré phase-one changes retained; unrelated dirty authentication files left untouched.

- Verification: 195 web tests passed; TypeScript passed; 21 isolated browser journeys passed. Clipboard limits, malformed/unknown columns, source units, overflow, signed deductions and steel subgroup factor are covered.
- Independent helper/UI reviews approved after regression fixes for unknown unit/count columns, negative signs, overflow, quoted delimiters, hidden import errors, modal focus and invalid-draft batch correction.
- Source changes remain scoped to the métré workspace; pre-existing authentication edits were not changed by this task.

- Final production build passed; local web container recreated and healthy on localhost:13001. Live workspace still has 18 prices, 56 measurements and 338,123.04 MAD HT.
- Live checks: paste preview 28.80 + 24.00 = 52.80 m³; repeated footing template 8 × 2 × 2 × 0.5 = 16 m³; both cancelled before insertion and save stayed disabled. Source review flags two existing negative-depth measures for human verification. Native modal fits 390px viewport and dark theme checked.
- Screenshots: artifacts/metre-assisted-review.png, metre-assisted-import.png, metre-assisted-template.png, metre-assisted-mobile.png, metre-assisted-dark.png.
