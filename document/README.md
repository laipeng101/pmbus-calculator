# Specification documents

This directory tracks specification **provenance**, not the specification PDFs
themselves.

## Why PDFs are no longer tracked

The project previously tracked four PMBus/SMBus PDFs in `document/`. The current
repository policy is conservative: this source tree keeps official source URLs,
metadata, and SHA-256 checksums, but does not redistribute third-party
specification PDFs. The historical files remain in old commits/tags; this task
does not rewrite history.

## Current domain baseline

The project baseline remains **PMBus 1.3 / SMBus 3.0**. This is not a
specification upgrade. PMBus 1.5 and other versions are not evaluated or claimed
as compatible.

## Official landing pages

- PMBus Specification Archives: https://pmbus.org/specification-archives/
- PMBus Current Specifications: https://pmbus.org/current-specifications/
- SMBus Specifications: https://www.smbus.org/specs/

## Manifest

[`document/specifications.json`](specifications.json) is the single
machine-readable source of truth for official URLs, byte counts, and SHA-256
checksums. Do not duplicate or override those values in other files.

## Usage

```bash
npm run specs:list          # list manifest entries without downloading
npm run specs:fetch -- --all
npm run specs:fetch -- --id pmbus-1.3-part-ii
npm run specs:verify-cache  # offline verification of cached files
```

- `fetch` writes to `.cache/specifications/` after verifying byte count and
  SHA-256 against the manifest.
- The cache directory is git-ignored and must **never** be committed.
- `npm run clean` removes the cache. Re-fetch only when needed.

## Working with specifications

- Fetch only the document you actually need for the task; prefer `--id` over
  `--all`.
- When citing the specification, record the revision, part, and section/page
  used.
- If an official URL or download stops working, fail the task and update
  `document/specifications.json` after re-confirming the official landing page.
  Do not silently substitute third-party mirrors.
