# PDF Sort — Web App

Installable PWA for renaming Mexican bank-transfer PDF receipts.

## Commands

```bash
cd app
npm install        # one-time
npm run dev        # local dev server (port may vary)
npm run test       # vitest suite
npm run build      # type-check + vite build
npm run serve      # serve dist/ on fixed port 4173
```

## Install once (Chrome / Edge)

```bash
npm run build
npm run serve
```

Then open `http://localhost:4173`, click the browser's **Install** icon (or Chrome menu → **Cast, save, and share** → **Install page as app**).

### Fixed-port rule

Always serve the installed app from **port 4173**. A different port is treated by the browser as a different app, so any previously granted folder access is lost.

Folder access is remembered across visits; on your first folder pick the app requests persistent storage so those saved handles are less likely to be evicted.

## Offline behavior

The build produces a precached service worker (`dist/sw.js`). After installation, the app shell, pdf.js worker chunk, and standard fonts are available offline. The first visit after a new build will update the cache.

## Adding a new bank

Two engines share the same patterns:

1. Python backend: `pdf_sort/extract/patterns.py`
2. Web app: `app/src/engine/patterns.ts`

A new bank requires edits to **both** files. Both test suites must pass:

```bash
cd app && npm test
cd .. && python3 -m pytest tests/ -q
```

## Parity harness

Run the cross-engine parity check against a local corpus:

```bash
cd app
npx tsx scripts/parity/parity.mts
```

The harness defaults to `~/Downloads`. It compares Python and TypeScript extraction output file-by-file.

### Corpus privacy

Never commit receipt PDFs or generated `expected.json` files. Keep the corpus outside the repository.
