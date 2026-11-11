#!/usr/bin/env python3
"""Generate the Python-side reference for the cross-engine parity gate.

Runs the real CLI (``python3 -m pdf_sort``) as a dry run over the local
receipt corpus and writes ``expected.json`` next to this script, mapping each
file's sanitized original name to the CLI-proposed filename (``null`` when
the extraction was incomplete).

The corpus defaults to ``~/Downloads``; override with ``--corpus DIR`` or the
``PDF_SORT_CORPUS`` environment variable.  ``expected.json`` is derived from
private receipt data and is gitignored — it must never be committed.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
EXPECTED_PATH = Path(__file__).resolve().parent / "expected.json"

# The reporter's own prints carry non-ASCII text (child stderr tails with
# ✓/✗/→ markers, em dashes, corpus paths); force UTF-8 so a C/POSIX locale
# cannot crash the script after the work is done.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def resolve_corpus(cli_value: str | None) -> Path:
    """--corpus arg > PDF_SORT_CORPUS env > ~/Downloads."""
    value = cli_value or os.environ.get("PDF_SORT_CORPUS") or "~/Downloads"
    return Path(value).expanduser().resolve()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--corpus",
        default=None,
        help="Corpus directory (default: $PDF_SORT_CORPUS or ~/Downloads)",
    )
    args = parser.parse_args()

    corpus = resolve_corpus(args.corpus)
    if not corpus.is_dir():
        print(f"error: corpus directory not found: {corpus}", file=sys.stderr)
        return 2

    # The CLI copies PDFs into --output-dir even in dry-run mode, so point it
    # at a throwaway directory instead of the repo root (its default).
    with tempfile.TemporaryDirectory(prefix="pdf-sort-parity-") as tmp:
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "pdf_sort",
                "--input-dir",
                str(corpus),
                "--output-dir",
                tmp,
                "--format",
                "json",
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            # The child's own stdout encoding follows the ambient locale; a
            # C/POSIX locale would make its ensure_ascii=False JSON raise
            # UnicodeEncodeError before the parent ever decodes it.
            env={
                **os.environ,
                "PYTHONIOENCODING": "utf-8",
            },
        )

    # Exit code 1 only means some files were skipped (incomplete info);
    # any other code, or unparseable output, is a real failure.
    if result.returncode not in (0, 1):
        tail = "\n".join(result.stderr.strip().splitlines()[-10:])
        print(
            f"error: pdf_sort exited {result.returncode}:\n{tail}",
            file=sys.stderr,
        )
        return 2

    try:
        payload = json.loads(result.stdout)
        files = payload["files"]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        print(f"error: unexpected CLI JSON output: {exc!r}", file=sys.stderr)
        return 2

    expected = {f["original"]: f["new_name"] for f in files}
    EXPECTED_PATH.write_text(
        json.dumps(expected, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    named = sum(1 for v in expected.values() if v is not None)
    print(
        f"Wrote {EXPECTED_PATH.relative_to(REPO_ROOT)}: "
        f"{len(expected)} file(s) — {named} named, {len(expected) - named} null"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
