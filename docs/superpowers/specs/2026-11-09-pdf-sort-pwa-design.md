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
- **Semantics mirror the CLI**: table of proposed renames by default; Rename writes copies to the output folder; an optional toggle moves originals to a `processed/` subfolder of the input folder; incomplete extractions get a manual-name edit box and are never silently dropped; dedup suffixes `_2`, `_3` assigned within a run.
- **Folders**: first run asks for input and output folders via `showDirectoryPicker()`; handles stored in IndexedDB; `navigator.storage.persist()` requested; permission re-checked on launch (Chromium re-prompts with a one-click allow).
- **Privacy**: no redaction toggle needed — nothing is ever transmitted and nothing is logged outside the page.
- **PWA shell**: web manifest + service worker precaching all assets (cache-first), pdf.js worker included. App name: "PDF Sort".

## What's left to the builder

- **pdf.js text reconstruction (highest-risk item)**: assemble `getTextContent()` items into pdfplumber-like text — group items into lines by Y coordinate, join within line by X, `\n` between lines and between pages — then validate against the user's real receipt corpus. If a receipt's text differs enough to break a parser, tune the reconstruction, not the ported parsers.
- **Date/timezone port**: the CLI converts timestamps to `America/Mexico_City` via `zoneinfo`. In TS, replicate with `Intl.DateTimeFormat` (`timeZone: 'America/Mexico_City'`) or an equivalent table-free approach; port `parse_date` faithfully and cover it with the ported tests.
- **UI details**: table layout, per-file include/exclude toggles, manual-name edit box, unreadable-PDF error rows, empty states, progress indication while parsing a large folder, summary after rename.
- **Install instructions** in `app/README.md`: build, one-time localhost serve, Chrome "Install page as app", and the note that it keeps working offline after install.
- **Tooling**: how both test suites run (`pytest` and `npm test`); optional nice-to-have: a cross-engine parity script feeding identical text fixtures through both engines and diffing results.

## Success looks like

Install once → pick folders once → daily: open the app from the dock, see newly downloaded PDFs with proposed names, click Rename, and find correctly named files in the output folder — names identical to what the CLI would produce, with no terminal and nothing running in the background.
