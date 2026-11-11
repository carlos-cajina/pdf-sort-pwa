# Parity harness — engine acceptance gate

Proves that the TypeScript pipeline (pdf.js text reconstruction → `extractInfo` → `buildFilename`) proposes **exactly the same filenames** as the Python CLI (`python3 -m pdf_sort`) on the local receipt corpus. From `app/`, first generate the reference (a dry run — nothing is renamed; the CLI does copy PDFs to a temp dir internally), then run the gate, which prints one `PASS|FAIL` line per file plus an `N/M matched` summary and exits 1 on any mismatch:

```bash
python3 scripts/parity/python_reference.py   # writes expected.json (gitignored)
npx tsx scripts/parity/parity.mts            # the gate; --corpus DIR overrides
```

Both scripts resolve the corpus as `--corpus` arg > `PDF_SORT_CORPUS` env > `~/Downloads`. **Privacy:** the corpus is real Mexican bank receipts containing RFCs, CLABEs and account numbers — `expected.json` and anything else derived from the corpus are local-only and gitignored; never commit them, and never paste extracted receipt text into issues, logs, or reports.
