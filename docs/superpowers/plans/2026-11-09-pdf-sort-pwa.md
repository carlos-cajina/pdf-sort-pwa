# PDF Sort PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure static PWA (Chrome/Edge, no server after install) that scans a user-picked folder of bank-transfer PDFs, proposes CLI-identical renamed filenames, and on confirmation writes renamed copies to a user-picked output folder.

**Architecture:** TypeScript port of the Python extraction engine (pure functions, guarded by ported tests) → pdf.js text reconstruction emulating pdfplumber clustering → File System Access API for folder scan/write → vanilla-DOM UI over a pure state model → PWA shell precached by a service worker.

**Tech Stack:** Vite + TypeScript (strict) + vitest; pdfjs-dist (exact pin); vite-plugin-pwa; `serve` for the fixed-port install origin. No UI framework, no runtime CDN.

**Spec:** `docs/superpowers/specs/2026-11-09-pdf-sort-pwa-design.md` — read it alongside this plan. All write semantics come from its "Write semantics" section; all parity rules from its "Parity bar" and "Corpus policy" bullets.

## Global Constraints

- Target browsers: Chrome/Edge. Elsewhere show a "needs Chrome or Edge" banner (`'showDirectoryPicker' in window` check). No other fallback.
- The Python package is untouched: `pdf_sort/` and `tests/` are never modified; `python3 -m pytest tests/ -q` must stay 171 passing at every commit.
- TypeScript strict mode. No UI framework. No network calls and no CDN fetches at runtime.
- Pin exact versions (`--save-exact`) of `pdfjs-dist`, `vite`, `vitest`, `serve`, `vite-plugin-pwa`, `@types/wicg-file-system-access`, `typescript` in `app/package.json`; commit the lockfile.
- Filenames: `transf{Source}_to_{Dest}_x{Amount}{_suffix}.pdf`; amounts formatted with Python `f"{x:,.2f}"` semantics (round-half-even on the exact binary double, thousands commas); month abbreviations hardcoded English `Jan`–`Dec`.
- No PII committed: the real receipt corpus stays local; `app/scripts/parity/expected.json` and `app/node_modules/`, `app/dist/` are gitignored.
- Install origin is a fixed port: `serve dist -l 4173`. Never a random port.
- All app tests run with `npm test` (vitest) from `app/`.

## Review Focus

Most likely things to bite a user that no ordinary happy-path test exercises; each is pinned to its owning task below:

1. **Encrypted/corrupt PDF** → row shows "unreadable", the rest of the run continues, nothing crashes. Test: Task 11 `parseAll` with an injected `parseFile` that rejects.
2. **PDF with no text layer (scanned)** → empty text → status `incomplete`, manual-name row, no crash. Test: Task 11 (injected `parseFile` → `""`) and Task 5 (`extractInfo("")` → incomplete).
3. **Re-run over the same output folder** (target name already exists) → suffix bump, never silent overwrite. Test: Task 10 `planRenames` collision case.
4. **Manual name containing `/ : * ?` etc.** → sanitized before write, never a write error. Test: Task 10 `executeRenames` manual-name case.
5. **Folder permission declined or revoked** → app falls back to the folder-picker state, no crash. Test: Task 9 `getPermission` paths; Task 12 render of picker state.

---

### Task 1: App scaffold and tooling

**Files:**
- Create: `app/package.json`, `app/tsconfig.json`, `app/vite.config.ts`, `app/index.html`, `app/src/main.ts` (placeholder `<h1>PDF Sort</h1>` mount), `app/src/smoke.test.ts`
- Modify: `.gitignore` (append `app/node_modules/`, `app/dist/`, `app/scripts/parity/expected.json`)

**Interfaces:**
- Consumes: nothing.
- Produces: npm scripts used by every later task — `npm run dev`, `npm run build` (`tsc --noEmit && vite build`), `npm test` (`vitest run`), `npm run serve` (`serve dist -l 4173`); the directory `app/src/` where all source lives.

- [ ] **Step 1: Create the files above.** `package.json` devDependencies installed with `--save-exact`: `typescript`, `vite`, `vitest`, `jsdom`, `tsx`, `pdfjs-dist`, `serve`, `vite-plugin-pwa`, `@types/wicg-file-system-access`. `tsconfig.json`: strict, `lib: ["ES2022", "DOM", "DOM.Iterable"]`, `moduleResolution: "bundler"`. `vite.config.ts`: base `./`, empty `plugins: []` (PWA plugin added in Task 13). Smoke test asserts `expect(1 + 1).toBe(2)`.
- [ ] **Step 2: Verify toolchain**

Run: `cd app && npm ci && npm run build && npm test && npm run serve & sleep 2 && curl -sI http://localhost:4173 | head -1 && kill %1`
Expected: build exits 0; 1 test passed; `HTTP/1.1 200 OK`.

- [ ] **Step 3: Commit**

```bash
git add app .gitignore
git commit -m "Add app scaffold: Vite + TypeScript + vitest, fixed-port serve"
```

### Task 2: Port engine primitives — models and patterns

**Files:**
- Create: `app/src/engine/models.ts`, `app/src/engine/patterns.ts`
- Test: `app/src/engine/__tests__/models.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 3–5):
  - `cleanText(text: string): string` — strips `\uffff`, `\ufffd`, `\x00`
  - `cleanBankName(name: string): string` — BANK_ALIASES lookup → ACRONYMS upper → PascalCase
  - `class TransactionInfo { constructor(readonly date: Date | null, readonly sourceBank: string, readonly destBank: string, readonly amount: number | null) }` with `isComplete(): boolean` (date ≠ null, amount ≠ null, sourceBank ≠ `"UNKNOWN"`)
  - `patterns.ts`: `MONTH_MAP_ES`, `MONTH_MAP_EN`, `STRIP_CORRUPT_RE`, `DATE_DMY_PATTERNS: [RegExp, '%b' | '%y'][]`, `DATE_NUMERIC_PATTERNS: RegExp[]`, `AMOUNT_PATTERNS: RegExp[]`, `MULTILINE_AMOUNT_PATTERNS: RegExp[]`, `BBVA_DEST_RE`, `BANAMEX_DEP_RE`, `BANAMEX_CARD_RE`, `SANTANDER_TDC_RE`, `SANTANDER_CLABE_RE`, `SANTANDER_CONTACT_ACCT_RE`, `SANTANDER_CUENTA_RE`, `SANTANDER_DEBITO_RE`, `TRAILING_LETTER_RE`, `BANK_SIGNATURES`, `ACRONYMS`, `BANK_ALIASES` — all values translated verbatim from `pdf_sort/extract/patterns.py` (camelCase names as listed).

- [ ] **Step 1: Write the failing test** — port every case in `TestCleanText` and the `clean_bank_name` tests from `tests/test_extraction.py`. Example transcription:

```typescript
import { describe, it, expect } from 'vitest'
import { cleanText, cleanBankName } from '../models'

describe('cleanText', () => {
  it('strips U+FFFF', () => expect(cleanText('BBV\uffffM\u00e9xico')).toBe('BBVM\u00e9xico'))
})
describe('cleanBankName', () => {
  it('resolves aliases', () => expect(cleanBankName('MERCADO PAGO')).toBe('MercadoPago'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test`
Expected: FAIL — `Cannot find module '../models'`.

- [ ] **Step 3: Implement both modules.** `patterns.ts` is a verbatim data translation of `pdf_sort/extract/patterns.py` (lines 13–151): each `re.compile(r"...", re.IGNORECASE)` becomes `/.../i`; `MONTH_MAP_EN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }` replaces `strptime`'s `%b` (hardcoded English per spec). `MX_TZ` is not ported — dates are UTC-midnight `Date`s (Task 3). Regex translation note: `^`/`$` anchors keep Python semantics because every anchored pattern is applied either to a single line or to a stripped string at its call site — do not add the `m` flag.
- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/engine
git commit -m "Port engine primitives: TransactionInfo, cleanText, cleanBankName, pattern tables"
```

### Task 3: Port `parse_date`

**Files:**
- Create: `app/src/engine/parsers.ts`
- Test: `app/src/engine/__tests__/parse-date.test.ts`

**Interfaces:**
- Consumes: `MONTH_MAP_ES`, `MONTH_MAP_EN`, `DATE_DMY_PATTERNS`, `DATE_NUMERIC_PATTERNS` (Task 2).
- Produces: `parseDate(text: string): Date | null` — a UTC-midnight Date (`Date.UTC(y, mon, d)`); `null` when nothing parses. Internally `parseDateDmy(dayS: string, monS: string, yearS: string, fmt: '%b' | '%y'): Date | null` (the `y < 50 → 20xx, else 19xx` rule, MONTH_MAP_ES first, then MONTH_MAP_EN, invalid → null).

- [ ] **Step 1: Write the failing test** — port every case in `TestParseDate` from `tests/test_extraction.py`, asserting `getUTCFullYear()` / `getUTCMonth()` / `getUTCDate()`. Two example transcriptions:

```typescript
it('dd mon yyyy english', () => {
  const d = parseDate('30 Apr 2026 04:31:50')
  expect(d?.getUTCDate()).toBe(30)
  expect(d?.getUTCMonth()).toBe(3)   // April
  expect(d?.getUTCFullYear()).toBe(2026)
})
it('two-digit year maps 00-49 to 2000s', () => {
  const d = parseDate('Fecha y hora de operación 27/abr/26')
  expect(d?.getUTCFullYear()).toBe(2026)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test`
Expected: FAIL — `parseDate` not defined.

- [ ] **Step 3: Implement `parseDate` in `app/src/engine/parsers.ts`** — a faithful port of `pdf_sort/extract/parsers.py:46-85` including the numeric `d/m/y` fallback loop and continue-on-invalid-date behavior. Loop with `pattern.exec(text)` instead of `pattern.search`.
- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/engine/parsers.ts app/src/engine/__tests__/parse-date.test.ts
git commit -m "Port parseDate with UTC-midnight dates and both month maps"
```

### Task 4: Port `extract_amount`

**Files:**
- Modify: `app/src/engine/parsers.ts`
- Test: `app/src/engine/__tests__/extract-amount.test.ts`

**Interfaces:**
- Consumes: `MULTILINE_AMOUNT_PATTERNS`, `AMOUNT_PATTERNS` (Task 2).
- Produces: `extractAmount(text: string): number | null` — port of `pdf_sort/extract/parsers.py:91-128`: fee keywords `['COMISIÓN','COMISION','IVA','COSTO','IMPUESTO','FEE']`, label keywords `['IMPORTE','MONTO']`, multiline pass first, then per-line pass with fee-line skip and next-line-fee skip, `Number(amountStr.replace(/,/g, ''))`, `>= 0` guard, invalid → continue.

- [ ] **Step 1: Write the failing test** — port every case in the `extract_amount` test class(es) of `tests/test_extraction.py`, covering: multiline label/value pairs, fee-line exclusion, next-line-fee exclusion, unlabeled `$`-prefixed lines, comma thousands, negative → skip, unparsable → next pattern.
- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test`
Expected: FAIL — `extractAmount` not defined.

- [ ] **Step 3: Implement `extractAmount`** — faithful port, using `text.split('\n')` for `splitlines()`.
- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/engine
git commit -m "Port extractAmount with fee-exclusion and multiline passes"
```

### Task 5: Port bank parsers, `identify_banks`, `extract_info`

**Files:**
- Create: `app/src/engine/orchestrator.ts`
- Modify: `app/src/engine/parsers.ts`
- Test: `app/src/engine/__tests__/banks.test.ts`

**Interfaces:**
- Consumes: Task 2 patterns + `cleanBankName`; Task 3 `parseDate`; Task 4 `extractAmount`.
- Produces:
  - `type BankParser = (text: string, textUpper: string) => [string, string] | null` — `parseAmex`, `parseBbva`, `parseBanamex`, `parseSantander`, `parseGeneric`, exported `PARSERS: BankParser[]` in that order
  - `identifyBanks(text: string): [string, string]` (`['UNKNOWN','UNKNOWN']` fallback)
  - `extractInfo(text: string): TransactionInfo` — `cleanText` → `parseDate` + `identifyBanks` + `extractAmount`

- [ ] **Step 1: Write the failing test** — port every case in the `identify_banks` / bank-parser / `extract_info` classes of `tests/test_extraction.py`, including the Santander destination helpers (CLABE, TDC, contact-account, cuenta, débito, NULL/NONE → `OTHER`), BBVA alt/own-TDC/debit/fuzzy marker sets, Banamex deposit-line bank list and `-` split fallback, and `extractInfo('')` → incomplete (Review Focus #2).
- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test`
Expected: FAIL — `identifyBanks` not defined.

- [ ] **Step 3: Implement the five parsers and orchestrator** — faithful ports of `pdf_sort/extract/parsers.py:134-339` (`_extractSantanderDest` becomes `extractSantanderDest`), `PARSERS` order fixed as listed; `orchestrator.ts` ports `pdf_sort/extract/orchestrator.py`.
- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/engine
git commit -m "Port bank parsers, identifyBanks, extractInfo"
```

### Task 6: Port rename engine — `buildFilename`, `deduplicate`, Python-exact `fmtAmount`, `sanitizeFilename`

**Files:**
- Create: `app/src/engine/rename.ts`
- Test: `app/src/engine/__tests__/rename.test.ts`

**Interfaces:**
- Consumes: `TransactionInfo` (Task 2).
- Produces:
  - `fmtAmount(x: number): string` — Python `f"{x:,.2f}"` exactly
  - `fmtMonthYear(d: Date): string` — `['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()] + d.getUTCFullYear()`
  - `buildFilename(info: TransactionInfo, suffix?: string): string | null`
  - `type EnginePlanItem = { original: string; info: TransactionInfo; newName?: string | null }`
  - `deduplicate(plan: EnginePlanItem[]): EnginePlanItem[]` — Counter port; collisions get `_{n}.pdf`
  - `sanitizeFilename(name: string): string` — `/[<>:"/\\|?*\s]/g` → `'_'` (port of `io.sanitize_filename`)

- [ ] **Step 1: Write the failing test** — port every case in `tests/test_rename.py` plus these Python-verified rounding pins (Review Focus adjacent — half-cent parity):

```typescript
it('matches Python format(x, ",.2f") on binary midpoints', () => {
  expect(fmtAmount(0.125)).toBe('0.12')   // exact binary midpoint → half-even down; toFixed would give 0.13
  expect(fmtAmount(1.005)).toBe('1.00')   // binary value is 1.00499…
  expect(fmtAmount(2.675)).toBe('2.67')   // binary value is 2.67499…
  expect(fmtAmount(52713.61)).toBe('52,713.61')
  expect(fmtAmount(128)).toBe('128.00')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `rename.ts`.** `fmtAmount` algorithm (signature and tests don't determine it, so it is fixed here): get the exact decimal expansion of the double via `x.toExponential(100)`, parse it into a digit string, round half-even at 2 decimals by string arithmetic, then insert thousands commas — never `toFixed`/`toLocaleString`. Others are faithful ports of `pdf_sort/rename.py` (`suffix` default `''`, `.pdf` appended when missing).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/engine/rename.ts app/src/engine/__tests__/rename.test.ts
git commit -m "Port rename engine with Python-exact amount formatting"
```

### Task 7: pdf.js text reconstruction

**Files:**
- Create: `app/src/pdf/text.ts`
- Test: `app/src/pdf/__tests__/text.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `type TextItem = { str: string; x: number; y: number; width: number }` (normalized from pdf.js `TextItem`: `x = transform[4]`, `y = transform[5]`)
  - `itemsToText(items: TextItem[]): string` — pdfplumber-like clustering with `x_tolerance = 3`, `y_tolerance = 3`
  - `extractPdfText(data: ArrayBuffer): Promise<string>` — pdf.js `getDocument({ data })`, every page's `getTextContent()` → `itemsToText`, pages joined with `"\n"`

- [ ] **Step 1: Write the failing test** — synthetic item arrays (no pdf.js needed), covering: same-y items joined into one line sorted by x with a space inserted when gap > 3; y-clusters within tolerance 3 merged to one line; clusters ordered top-to-bottom; empty input → `''`. Example:

```typescript
it('inserts a space when the x-gap exceeds tolerance', () => {
  const items = [
    { str: 'Importe', x: 0, y: 100, width: 40 },
    { str: 'total', x: 50, y: 100, width: 30 },   // gap 10 > 3 → space
    { str: '(MXN)', x: 83, y: 100, width: 30 },   // gap 3 → no space
  ]
  expect(itemsToText(items)).toBe('Importe total(MXN)')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `text.ts`.** Clustering algorithm (fixed here): sort items by `-y` then `x`; walk items, starting a new line whenever `prevY - item.y > 3` (y grows downward in PDF space); within a line, append `' '` when `item.x - (prev.x + prev.width) > 3`, else concatenate; join lines with `'\n'`. Skip pdf.js items with empty `str`. `extractPdfText` uses the legacy build (`pdfjs-dist/legacy/build/pdf.mjs`) so the same code runs in the parity script (Task 8); wire the worker via a Vite `?worker` import guarded so vitest can stub it.
- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pdf
git commit -m "Add pdfplumber-like pdf.js text reconstruction"
```

### Task 8: Parity harness — engine acceptance gate

**Files:**
- Create: `app/scripts/parity/python_reference.py`, `app/scripts/parity/parity.mts`, `app/scripts/parity/README.md` (one paragraph: how to run, corpus privacy)
- Modify: `.gitignore` (verify `app/scripts/parity/expected.json` entry from Task 1)

**Interfaces:**
- Consumes: `extractPdfText` (Task 7), `extractInfo` + `buildFilename` (Tasks 5–6).
- Produces: the acceptance gate every later task must not break; `expected.json` (local-only, gitignored) mapping original filename → CLI-proposed name.

- [ ] **Step 1: Write `python_reference.py`** — from the repo root, runs `python3 -m pdf_sort --input-dir <corpus> --format json` (dry run, no writes), reads the JSON (`files[].{original, new_name}` — see `pdf_sort/output.py:format_json`), writes `app/scripts/parity/expected.json` as `{original: new_name}`. Corpus dir from `--corpus` arg, default `~/Downloads`, env override `PDF_SORT_CORPUS`.
- [ ] **Step 2: Write `parity.mts`** — for each top-level `*.pdf` in the corpus: `extractPdfText` → `extractInfo` → `buildFilename`; diff against `expected.json`; print one line per file `PASS|FAIL <original> → <ours> (expected <theirs>)` plus a summary `N/M matched`; exit 1 on any mismatch. Run with `npx tsx` (devDep from Task 1) since it imports the app's TypeScript modules.
- [ ] **Step 3: Run the gate on the real corpus**

Run: `cd app && python3 scripts/parity/python_reference.py && npx tsx scripts/parity/parity.mts`
Expected: every file matches. The spec's "highest-risk item": a dense multi-page BBVA statement previously diverged under naive Y-bucketing — if it fails, tune `itemsToText` clustering only, never the ported parsers (spec: "the fix belongs in the reconstruction").

- [ ] **Step 4: Commit**

```bash
git add app/scripts/parity .gitignore
git commit -m "Add cross-engine parity harness (local corpus, gitignored reference)"
```

### Task 9: FS layer — handles, permissions, scan

**Files:**
- Create: `app/src/fs/handles.ts`, `app/src/fs/scan.ts`, `app/src/fs/__tests__/fakes.ts`
- Test: `app/src/fs/__tests__/handles.test.ts`, `app/src/fs/__tests__/scan.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pickFolder(): Promise<FileSystemDirectoryHandle>` (`window.showDirectoryPicker()`)
  - `saveHandle(id: 'input' | 'output', handle: FileSystemDirectoryHandle): Promise<void>` / `loadHandle(id): Promise<FileSystemDirectoryHandle | null>` — vanilla IndexedDB, db `pdf-sort`, store `handles`, no library
  - `getPermission(handle): Promise<'granted' | 'prompt' | 'denied'>` (`queryPermission({ mode: 'readwrite' })`)
  - `requestPermission(handle): Promise<boolean>` — only ever called from a user gesture (Review Focus #5)
  - `type ScanEntry = { name: string; file: File }`
  - `scanInputFolder(dir: FileSystemDirectoryHandle): Promise<ScanEntry[]>` — non-recursive, top-level files with name ending `.pdf` (case-insensitive); `processed/` and every other directory are skipped by construction (spec write-semantics #6)
  - `fakes.ts`: `fakeDir(entries)` — in-memory `FileSystemDirectoryHandle` double with async-iterator `values()`, `getFileHandle`, `createWritable`-capable file handles, and `removeEntry`

- [ ] **Step 1: Write the failing tests** — with fakes: scan returns only top-level `.pdf` files (skips a `.txt`, a `.PDF` uppercase included, a nested directory named `processed`); `getPermission` surfaces `'prompt'`/`'granted'` from the fake; `saveHandle`/`loadHandle` round-trip (fake IndexedDB or injection of the storage seam).
- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npm test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `handles.ts` and `scan.ts`** — no logic beyond the interfaces above; IndexedDB wrapped in ~30 lines (`openDB` → `get`/`put` on object store).
- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/fs
git commit -m "Add FS Access layer: folder handles, permissions, non-recursive PDF scan"
```

### Task 10: Write pipeline — plan and execute renames

**Files:**
- Create: `app/src/fs/write.ts`
- Test: `app/src/fs/__tests__/write.test.ts`

**Interfaces:**
- Consumes: `sanitizeFilename` (Task 6); `fakeDir` fakes (Task 9).
- Produces:
  - `type RenameRow = { original: string; bytes: () => Promise<ArrayBuffer>; finalName: string | null; kind: 'auto' | 'manual'; collision: boolean }` — the UI wiring (Task 12) builds these from Task 11's `Row`s plus the scanned `File`s
  - `planRenames(rows: {original: string; proposed: string | null}[], existingNames: Set<string>): RenameRow[]` — pure: in-run dedup suffixes `_2`, `_3`… (port of `deduplicate` semantics), then bump again when the name exists in `existingNames`; marks `collision: true` on any bumped row (Review Focus #3)
  - `executeRenames(inputDir: FileSystemDirectoryHandle, outputDir: FileSystemDirectoryHandle, rows: RenameRow[], opts: { moveProcessed: boolean }): Promise<RowOutcome[]>` — for each row with a `finalName`: sanitize (manual names only — Review Focus #4), write bytes to `outputDir` under `finalName` via `createWritable`, and only after a successful write, if `moveProcessed`: ensure `inputDir/processed/`, write the original bytes there under the **original** name, then `inputDir.removeEntry(original)`. Returns `{ original, status: 'written' | 'moved' | 'failed', error? }[]`. Rows with `finalName: null` (excluded/blank) are never touched (spec write-semantics #4).

- [ ] **Step 1: Write the failing tests** (all on fakes): collision with existing output name bumps to `_2` and sets `collision`; two in-run collisions produce `_2` then `_3`; manual name `my/receipt:1.pdf` is written as `my_receipt_1.pdf`; excluded row leaves input untouched and writes nothing; `moveProcessed` moves the original **after** the output write succeeds, keeping the original name; a forced write failure marks the row `failed` and does **not** move the original (data safety).
- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `write.ts`** — read the output folder's existing names once up front (`for await` over `outputDir.values()`); `processed/` created via `getDirectoryHandle('processed', { create: true })` only when first needed.
- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/fs/write.ts app/src/fs/__tests__/write.test.ts
git commit -m "Add rename write pipeline: collisions, sanitize, processed-move after write"
```

### Task 11: App state model

**Files:**
- Create: `app/src/state.ts`
- Test: `app/src/state.test.ts`

**Interfaces:**
- Consumes: `extractPdfText` (Task 7), `extractInfo`/`buildFilename` (Tasks 5–6), `planRenames`/`executeRenames` (Task 10), `ScanEntry` (Task 9).
- Produces:
  - `type RowStatus = 'parsing' | 'ready' | 'incomplete' | 'error' | 'excluded'`
  - `type Row = { original: string; status: RowStatus; proposed: string | null; manualName: string; finalName: string | null; collision: boolean; error?: string }`
  - `parseAll(entries: ScanEntry[], parseFile: (e: ScanEntry) => Promise<{ info: TransactionInfo; proposed: string | null }>, onProgress: (done: number, total: number) => void): Promise<Row[]>` — bounded concurrency 4; a rejected `parseFile` → row `status: 'error'`, run continues (Review Focus #1); empty text → `incomplete` (Review Focus #2)
  - `setManualName(rows: Row[], original: string, name: string): Row[]` and `toggleRow(rows: Row[], original: string): Row[]` (pure updates)
  - `computePlan(rows: Row[], existingNames: Set<string>): Row[]` — wires manual/auto names through `planRenames`, sets `finalName`/`collision`
  - `summary(rows: Row[], outcomes: RowOutcome[]): string` — "N renamed, M skipped, K failed" counts

- [ ] **Step 1: Write the failing tests** — with an injected fake `parseFile`: success → `ready` with proposed name; rejection → `error` row while a second file still parses (Review Focus #1); empty-text → `incomplete` (Review Focus #2); progress callback reaches `total`; concurrency never exceeds 4 (track in-flight counter in the fake); manual name participates in dedup via `computePlan`; excluded row gets `finalName: null`.
- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `state.ts`** — pure functions except `parseAll`'s loop; the real `parseFile` (pdf.js → engine) is a thin wrapper defined here too (`defaultParseFile`), kept separate for injection.
- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/state.ts app/src/state.test.ts
git commit -m "Add pure app state model: parse with bounded concurrency, plan, summary"
```

### Task 12: UI

**Files:**
- Create: `app/src/ui/render.ts`, `app/src/ui/__tests__/render.test.ts`
- Modify: `app/src/main.ts` (replace placeholder)
- Test: environment `jsdom` for render tests (set per-file with `// @vitest-environment jsdom`)

**Interfaces:**
- Consumes: everything above via `state.ts` + `fs/`.
- Produces:
  - `renderApp(state, handlers): HTMLElement` — header (input/output folder names + change buttons, Scan, Rename button labeled `Rename N files`, disabled when N = 0, optional "move originals to processed" checkbox), table (status glyph `✓`/`⚠`/`✕`, original name, `→`, editable name input for `incomplete` rows / static text for `ready` rows, include checkbox), progress bar while `parsing`, post-run summary, empty states ("No PDFs found in input folder"), and the non-Chromium banner when `'showDirectoryPicker'` is absent
  - `main.ts` wiring: load saved handles → `getPermission` → render picker state when un-granted (Review Focus #5); Scan button (user gesture) → `requestPermission` if needed → `scanInputFolder` → `parseAll` with `defaultParseFile` → `computePlan` with existing output names → render; Rename → `executeRenames` → `summary`

- [ ] **Step 1: Write the failing render tests** (jsdom): a `ready` row renders `✓`, original, proposed name text; an `incomplete` row renders an editable input and `⚠`; Rename button disabled when zero included rows; banner element present when `showDirectoryPicker` is absent (stub `window`); collision row shows the bumped name with a collision marker.
- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `render.ts` and `main.ts`** — vanilla DOM, no framework; keep all logic in `state.ts`/`fs/` so the UI is dumb rendering + event wiring.
- [ ] **Step 4: Run tests and verify manually**

Run: `cd app && npm test && npm run dev`
Expected: tests PASS; manually (documented for the executor as a checklist in the PR description, not automated): create `~/tmp/pdf-sort-e2e/in` with two real receipts, dev app open → pick folders → scan → rows show proposed names → rename → `out/` holds renamed files, originals untouched (then with the checkbox: originals in `in/processed/`).

- [ ] **Step 5: Commit**

```bash
git add app/src/ui app/src/main.ts
git commit -m "Add vanilla-DOM UI: table, toggles, manual names, progress, summary"
```

### Task 13: PWA shell, fixed-port install, docs

**Files:**
- Create: `app/public/icon-192.png`, `app/public/icon-512.png` (simple receipt glyph; artwork is the builder's choice, sizes and filenames fixed), `app/README.md`
- Modify: `app/vite.config.ts` (add `VitePWA` plugin), root `README.md` (short "Web app" section pointing to `app/README.md`)

**Interfaces:**
- Consumes: built `dist/`.
- Produces: an installable, offline-capable app.

- [ ] **Step 1: Add the PWA plugin** — `VitePWA({ manifest: { name: 'PDF Sort', short_name: 'PDF Sort', start_url: '/', display: 'standalone', icons: [192, 512 entries] }, workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] } })` — precache must include the pdf.js worker chunk; verify it appears in the generated `dist/sw.js` precache list.
- [ ] **Step 2: Build and verify the shell**

Run: `cd app && npm run build && grep -c "precache" dist/sw.js && npm run serve & sleep 2 && curl -s http://localhost:4173/manifest.webmanifest | head -3 && kill %1`
Expected: precache entries > 0; manifest JSON served.

- [ ] **Step 3: Write `app/README.md`** — dev/build/test commands; install-once instructions: `npm run build && npm run serve` then Chrome → "Install page as app"; the fixed-port rule (updates must re-serve on 4173 — a different port is a different app with different remembered folders); offline behavior; the both-engines note (a new bank means editing `pdf_sort/extract/patterns.py` **and** `app/src/engine/patterns.ts`, both suites must pass); parity harness usage and the corpus-privacy rule (never commit `expected.json` or receipts).
- [ ] **Step 4: Commit**

```bash
git add app README.md
git commit -m "Add PWA shell: manifest, precached service worker, fixed-port install docs"
```

---

## Post-plan acceptance

After Task 13, before handover to the human partner, run the full gates in one pass:

```bash
cd app && npm test && npm run build && npx tsx scripts/parity/parity.mts && cd .. && python3 -m pytest tests/ -q
```

Expected: all vitest suites pass; build exits 0; parity `N/N matched` on the real corpus; Python suite still `171 passed`. Then one manual install-and-offline check on 4173 per `app/README.md`.
