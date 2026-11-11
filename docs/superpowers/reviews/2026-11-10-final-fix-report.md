# Final-review fix wave report

Commit: `46fc284` — `Fix final-review findings: worker lifecycle, processed-copy probe, storage persist, UI minors`

Base: `4b106b9`

## Findings fixed

### 1. Critical: pdf.js worker initialization race and shared-worker teardown

- `app/src/pdf/text.ts:23-38` replaces the boolean `workerPortReady` latch with a nullable `Promise<void>` latch. `ensureWorker()` assigns the promise immediately with `??=`, so concurrent first callers all await the same initialization; no boolean is set before an `await`.
- `app/src/pdf/text.ts:30-38` keeps Node/vitest in `{ data }` mode and, only in the browser branch, dynamically imports `pdfjs-dist/legacy/build/pdf.worker.mjs?worker&url` and assigns the emitted URL to `pdfjs.GlobalWorkerOptions.workerSrc` before any `getDocument` call.
- `app/src/pdf/text.ts:128-140` awaits that latch before creating each loading task. `app/src/pdf/text.ts:161-163` retains per-document `loadingTask.destroy()`; this is now safe because pdf.js owns a separate worker per document rather than all documents sharing one `workerPort`.

**Worker approach and rationale:** `?worker&url` plus `GlobalWorkerOptions.workerSrc` was chosen instead of `?worker` plus a shared `GlobalWorkerOptions.workerPort`. The old shared port could be destroyed by one document while sibling documents still used it (mozilla/pdf.js#16777). URL mode lets pdf.js create an independently owned worker for each loading task while Vite still emits and the service worker still precaches the real worker asset. The browser-only dynamic import preserves the plain-Node extraction path used by parity.

### 2. Important: unguarded `processed/` copy could overwrite an archived original

- `app/src/fs/write.ts:133-145` probes the input folder's `processed/` directory and the row's original filename **before** `writeNewFile()` writes the output.
- `app/src/fs/write.ts:223-259` adds `ProcessedCollisionError`, `findProcessedDir()`, and `assertNotInProcessed()`. An existing archived original produces a loud per-row failure; no output is written for that row and its input original is not removed.
- `app/src/fs/write.ts:157-175` converts that error to a failed `RowOutcome` with `processedCollision: true` and continues the batch. `app/src/fs/write.ts:19-26` documents the new outcome marker.
- `app/src/main.ts:379-389` surfaces processed collisions in the composed user notice.

### 3. Important: persistent storage was never requested

- `app/src/fs/handles.ts:13-33` adds a module-latched, guarded `requestPersistentStorage()`. It calls `navigator.storage.persist()` at most once per session, ignores the advisory result/rejection, and safely skips unsupported environments.
- `app/src/main.ts:178-183` invokes it synchronously in the Choose Folder gesture, and `app/src/main.ts:222-229` invokes it synchronously in the Scan gesture. It is not called from module initialization or `restoreHandles()`.
- `app/README.md:29` explains that folder handles are remembered and persistent storage is requested on the first folder pick to reduce eviction risk.

### 4. Minor: folder picker did not request read/write access

- `app/src/fs/handles.ts:3-5` now calls `showDirectoryPicker({ mode: "readwrite" })`, avoiding an immediate second permission prompt after a successful pick.

### 5. Minor: manual names could be written without `.pdf`

- `app/src/state.ts:119-143` appends `.pdf` to sanitized manual names at plan time unless a case-insensitive `.pdf` suffix is already present. Existing deduplication and output-collision planning therefore operate on the actual final filename.

### 7. Minor: empty-state instruction appeared during parsing

- `app/src/ui/render.ts:124-143` suppresses the choose-folders instruction whenever parsing progress is present or the app is busy. The idle instruction still renders when appropriate.

### 8. Minor: collision notices overwrote one another

- `app/src/main.ts:340-390` tracks the Cancel path, computes remaining write collisions and processed collisions once, and joins all applicable messages into one notice instead of issuing competing state assignments.

### 12. Minor: empty arrow header was exposed to assistive technology

- `app/src/ui/render.ts:196-214` sets `aria-hidden="true"` on the empty arrow-column `<th>` while retaining its column scope and visual table structure.

## Tests added or updated

- `app/src/pdf/__tests__/worker.test.ts:50-103` (new, 2 tests): proves concurrent first extractions share one setup and that `workerSrc` is assigned before either `getDocument`; also pins the Node/vitest `{ data }` path with no worker configuration. During verification, the browser-branch test initially exposed its own missing DOM fixture (`document is not defined`); `worker.test.ts:54` now supplies `document.baseURI`, and the focused test then passed before the full suite was rerun.
- `app/src/fs/__tests__/write.test.ts:271-313` (new): proves a processed collision writes no output, preserves both the current and archived originals, returns `processedCollision`, and allows a later row to succeed.
- `app/src/state.test.ts:223-257` (new): covers `.pdf` append, in-run deduplication after append, and case-insensitive preservation of an existing suffix.
- `app/src/ui/__tests__/render.test.ts:226-254` (new, 2 tests): covers busy/progress empty-state suppression and the arrow header's `aria-hidden` attribute.
- `app/src/fs/__tests__/handles.test.ts:20-28` now asserts the picker's `readwrite` option.
- `app/src/pdf/__tests__/text.test.ts:11-13,168-204` updates the worker mock to `?worker&url` and explicitly checks teardown of sequential per-document loading tasks.
- Net suite growth: 191 baseline tests to 197 (6 new tests).

## Gate outputs

### 1. `cd app && npm test`

```text
> pdf-sort-app@0.1.0 test
> vitest run


 RUN  v5.1.0 /Users/carloscajina-cis/.local/share/opencode/worktree/a5ceeb/pdf-sort-pwa/app


 Test Files  14 passed (14)
      Tests  197 passed (197)
   Start at  14:18:24
   Duration  863ms (environment 64%, transform 12%, import 11%, tests 9%, worker 3%)
```

### 2. `cd app && npm run build`

```text
> pdf-sort-app@0.1.0 build
> tsc --noEmit && vite build

vite v8.3.7 building client environment for production...
transforming...
✓ 19 modules transformed.
rendering chunks...
computing gzip size...
dist/registerSW.js                      0.13 kB
dist/manifest.webmanifest               0.29 kB
dist/index.html                         0.44 kB │ gzip:   0.29 kB
dist/assets/pdf.worker-CKIwUZkK.js  1,251.26 kB
dist/assets/pdf.worker-C0kjzTon.js      0.08 kB │ gzip:   0.10 kB
dist/assets/index-CwuHqgO4.js          27.51 kB │ gzip:   9.22 kB
dist/assets/text-DM2R2v0B.js          500.24 kB │ gzip: 152.88 kB

✓ built in 278ms
[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.

PWA v2.0.0
mode      generateSW
precache  25 entries (2512.61 KiB)
files generated
  dist/sw.js
  dist/workbox-9c191d2f.js
```

Worker chunk and precache verification:

```text
$ find dist/assets -maxdepth 1 -type f -name '*worker*' -print | sort && grep -c "pdf.worker" dist/sw.js && grep -o 'assets/pdf.worker[^" ]*' dist/sw.js
dist/assets/pdf.worker-C0kjzTon.js
dist/assets/pdf.worker-CKIwUZkK.js
1
assets/pdf.worker-CKIwUZkK.js
assets/pdf.worker-C0kjzTon.js
```

`grep -c` reports one matching generated line, and that line contains both worker assets. The real pdf.js worker and its URL wrapper are both precached.

### 3. `cd app && npx tsx scripts/parity/parity.mts`

```text
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
BBVA matched via fuzzy markers (corrupted text): [ 'BBV', 'CUENT', 'DESTINO', 'TARJET', 'CRÉDITO' ]
BBVA own-TDC matched via fuzzy markers: [ 'BBV', 'CUENT', 'DESTINO', 'TARJET', 'CRÉDITO' ]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
BBVA matched via fuzzy markers (corrupted text): [ 'BBV', 'CUENT', 'DESTINO', 'TARJET', 'CRÉDITO' ]
BBVA own-TDC matched via fuzzy markers: [ 'BBV', 'CUENT', 'DESTINO', 'TARJET', 'CRÉDITO' ]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
BBVA matched via fuzzy markers (corrupted text): [ 'BBV', 'CUENT', 'DESTINO', 'TARJET', 'CRÉDITO' ]
BBVA own-TDC matched via fuzzy markers: [ 'BBV', 'CUENT', 'DESTINO', 'TARJET', 'CRÉDITO' ]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
BBVA matched via fuzzy markers (corrupted text): [ 'BBV', 'CUENT', 'DESTINO', 'TARJET', 'CRÉDITO' ]
BBVA own-TDC matched via fuzzy markers: [ 'BBV', 'CUENT', 'DESTINO', 'TARJET', 'CRÉDITO' ]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
[per-file parity line omitted — contains corpus-derived filenames and amounts]
62/62 matched
```

### 4. `python3 -m pytest tests/ -q` (worktree root)

```text
........................................................................ [ 40%]
........................................................................ [ 81%]
.................................                                        [100%]
177 passed in 0.26s
```

## Concerns and residual validation gaps

- No real-Chrome four-receipt cold-load smoke test was run. The browser initialization order now has a focused unit test, and the production build plus worker emission/precache checks pass, but an actual browser smoke test remains worthwhile.
- Main.ts integration tests remain parked as instructed. The storage persistence helper's user-gesture wiring was verified by inspection rather than a main.ts integration test; persistence itself remains browser-advisory.
- The production build retains the existing large-chunk warning for pdf.js/text extraction; it does not fail the build or affect precache completeness.
- Parked findings and frozen areas were not changed. No `expected.json`, receipt PDF, corpus file, parity harness, Python file, or `app/src/engine/` file was included in the commit.
