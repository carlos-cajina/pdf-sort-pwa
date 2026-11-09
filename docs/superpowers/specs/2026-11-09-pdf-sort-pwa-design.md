# PDF Sort PWA — Design

Date: 2026-11-09
Status: pending approval

## Intent

A local, installable web app (PWA) that renames Mexican bank-transfer PDF receipts with the same behavior as the existing `pdf-sort` CLI. The user downloads receipt PDFs from internet banking; the app scans a folder they chose (e.g. `~/Downloads`), shows each PDF with its proposed descriptive filename, and on confirmation writes renamed copies to an output folder they chose. Everything happens on the user's machine — no network use after install, nothing uploaded.

## Why

- The CLI works but requires a terminal and remembering flags. A dock-launchable app with a visual dry-run → confirm flow is simpler for routine use.
- The user mostly uses Chrome and Edge, so the browser can be granted direct folder access — no helper process needed.
- Receipts contain financial PII. The app must never send data anywhere.

## Goals

1. Install once from a locally served build; thereafter opens from the dock like a native app and works fully offline with nothing running.
2. Scan a user-selected input folder for PDFs; show `original → proposed name` per file (a visual dry run).
3. On confirmation, write renamed PDF copies to a user-selected output folder; optionally move originals to a "processed" subfolder (mirrors the CLI's `--processed-dir`).
4. Produce identical naming to the CLI: `transf<Source>_to_<Dest>_x<Amount>_MMMYYYY.pdf`, Mexico-style amounts (`52,713.61`), English month abbreviations (`May2026`), `_2`/`_3` dedup suffixes for same-name collisions within a run.
5. Let the user type a filename for PDFs whose fields couldn't be extracted (the CLI's "skipped" case) instead of dropping them.
6. Remember input/output folder selections across sessions (Chromium persistent permissions + IndexedDB handles).
7. Handle a folder with hundreds of PDFs without jank (parse with progress, not all-at-once).

## Non-goals

- No OCR / scanned PDFs (same limitation as the CLI).
- No folder watching/auto-refresh; a Refresh button rescans on demand.
- No multi-transaction statements, currency detection, or CLABE-registry lookup — those stay on the CLI's future-enhancements list.
- No hosting on the public internet; no auto-update story beyond "rebuild and reinstall".
- No Safari/Firefox support beyond a graceful "this app needs Chrome or Edge" message.

## Anti-goals

- Receipt contents or extracted data must never leave the machine (no analytics, no CDN at runtime).
- The app must not require any running process (server, daemon) for daily use.
- The Python CLI must not be rewritten or broken; it remains the reference implementation.

## Constraints

- Browser: Chrome or Edge — reading folders and writing files uses the File System Access API.
- Platform: macOS (user's machine), but nothing platform-specific in the app.
- Secure context required for PWA install and service workers → install happens from `http://localhost` (one-time static serve, e.g. `npx serve app/dist`).
- Extraction parity: the CLI extracts text with pdfplumber's `page.extract_text()`, joining pages with newlines. The ported parsers expect comparable text; the app must reconstruct it from pdf.js.

## Approaches considered

1. **Pure static PWA + TypeScript port of the extraction engine on pdf.js (chosen).**
   No server ever after install. Port ~635 lines of pure logic (`extract/models.py`, `patterns.py`, `parsers.py`, `orchestrator.py`, `rename.py`); behavior locked by porting the text-in/text-out pytest suites to vitest. Trade-offs: the extraction rules then exist in two places (CLI + app) that can drift, and only Chrome/Edge can write files. Drift is mitigated by keeping both engines in one repo with parallel tests.

2. **Tiny local Python helper (FastAPI) wrapping the existing engine, serving the UI.**
   Zero porting, one engine, any browser, real filesystem access. Trade-offs: a process must be started for every use, and the "PWA" is cosmetic since the app is dead without the helper. Rejected: daily-use simplicity was the point, and the user is on Chromium browsers.

3. **Static PWA running the actual Python engine via Pyodide (WASM).**
   No port, no server. Rejected: ~10–15 MB payload and slow startup, and still Chrome-only for folder writes — strictly worse than (1) here.

## Decided in conversation

- Renamed files stay local, in a folder the user selects (not "download out").
- Input is a folder the user selects (e.g. `~/Downloads`), remembered by the app.
- Nothing is written until the user confirms the proposed names.
- Approach (1): pure static PWA, TypeScript port.

## My calls (proposals, correctible)

- **Stack**: Vite + TypeScript, no UI framework (vanilla DOM). pdf.js via npm, bundled; no runtime CDN fetches.
- **Location**: new `app/` directory in this repo alongside the Python package, so both engines live together and both test suites run from one checkout.
- **Parity method**: port the five pure modules to `app/src/engine/` as pure functions; port the extraction/rename pytest cases (they are text-string → expected-value) to vitest as the parity guard. `app/README.md` notes that new banks must be added to both engines.
- **Parity bar**: identical extraction *results* (therefore filenames) on the real receipt corpus — not byte-identical extracted text. Where the Python code and its tests disagree with docs, the code + tests are the contract (e.g. CHANGELOG's two-digit-year rule is stale; `parsers.py`'s `y < 50 → 20xx` wins). Amount formatting replicates Python's `f"{x:,.2f}"` exactly (round-half-even on the binary double), with half-cent edge cases in the ported tests; month abbreviations are hardcoded English `Jan`–`Dec` per the README's documented format.
- **Corpus policy (PII)**: the real receipt corpus (RFCs, CLABEs, account numbers) is never committed to this repo. The parity harness reads it from a local, gitignored path (default `~/Downloads`, overridable); committed fixtures are synthetic or scrubbed text only.
- **Semantics mirror the CLI**: table of proposed renames by default; incomplete extractions get a manual-name edit box and are never silently dropped. Full write semantics settled below.
- **Folders**: first run asks for input and output folders via `showDirectoryPicker()`; handles stored in IndexedDB; `navigator.storage.persist()` requested. On launch the app checks stored permission with `queryPermission()`; since `requestPermission()` requires a user gesture, re-grant happens via the first button press (e.g. Scan), not automatically on load. If access is declined or absent, the app falls back to the folder-picker state.
- **Privacy**: no redaction toggle needed — nothing is ever transmitted and nothing is logged outside the page.
- **PWA shell**: web manifest + service worker precaching all assets (cache-first), pdf.js worker included. App name: "PDF Sort". The one-time install serve uses a **fixed port** (pinned in an `npm run serve` script, e.g. 4173) — an installed PWA is bound to its origin including the port, so a random port would orphan the install, its service worker, and the remembered folder handles. `app/README.md` documents that reinstalls/updates use the same port.

## Write semantics (settled in design review)

These differ from the CLI in deliberate, safe ways; all are my calls:

1. **Single write, final name only.** Each confirmed file is written once, directly under its final name (auto-generated or user-typed). The output folder never holds intermediate or sanitized-original copies. (The CLI leaves sanitized copies of failed extractions in its output folder; the app doesn't — failures get a manual name instead.)
2. **No silent overwrite.** Names are deduped within a run (`_2`, `_3`, …) as in the CLI; additionally, if a final name already exists in the output folder, the row is flagged as a collision and defaults to a suffix bump, with a per-row choice of bump or skip. (The CLI's `--overwrite` silent overwrite on re-runs is deliberately not reproduced.)
3. **Manual names** join the same dedup/collision logic as auto names and are sanitized (port of `io.sanitize_filename`) before writing, since typed names may contain `/`, `:`, etc. Auto-generated names contain only safe characters.
4. **Excluded or left-blank rows** are never written to output and never moved to `processed/`; the original stays in the input folder untouched.
5. **"Move originals to processed" (optional toggle)** applies only to files successfully written to output; originals keep their original filename (as the CLI does). Destination is pinned to `input/processed/` for simplicity.
6. **Scanning is non-recursive, top-level only** (matching the CLI's `iterdir()`), so `processed/` is never re-scanned. Only `.pdf` files are considered.

## What's left to the builder

- **pdf.js text reconstruction (highest-risk item)**: assemble `getTextContent()` items into pdfplumber-like text — emulating pdfplumber's character clustering (`x_tolerance`/`y_tolerance` ≈ 3, not naive Y-bucketing; several parsers depend on exact line boundaries, e.g. multiline amount patterns and `TDC *2663 - <bank>` on one line) — then validate against the user's real receipt corpus. Measured on the current corpus, naive Y-bucket + X-sort diverged on 1 of 56 receipts; the bar is identical extraction *results*, and the fix belongs in the reconstruction, never the ported parsers.
- **Date/timezone port**: `parse_date` produces midnight datetimes with no time component, so only month/year reach filenames and the `zoneinfo` conversion is effectively a no-op for output; port it faithfully anyway and keep the ported tests.
- **pdf.js version**: pin an exact version in `package.json` and verify the worker bundling strategy under Vite for that version (v4 vs v5 differ).
- **UI details**: table layout, per-file include/exclude toggles, manual-name edit box, collision and unreadable-PDF rows, empty states, summary after rename.
- **Performance**: parse with bounded concurrency (≈4 files at a time), one PDF document open per slot, progress indication; a Web Worker only if main-thread chunking proves insufficient.
- **Install instructions** in `app/README.md`: build, one-time localhost serve on the fixed port, Chrome "Install page as app", and the note that it keeps working offline after install and that updates re-serve on the same port.
- **Tooling**: how both test suites run (`pytest` and `npm test`); optional nice-to-have: a cross-engine parity script feeding identical text fixtures through both engines and diffing results.

## Success looks like

Install once → pick folders once → daily: open the app from the dock, see newly downloaded PDFs with proposed names, click Rename, and find correctly named files in the output folder — names identical to what the CLI would produce, with no terminal and nothing running in the background.
