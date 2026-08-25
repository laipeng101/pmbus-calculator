# Specification documents

This directory tracks specification **provenance**, not the specification PDFs
themselves.

## Why PDFs are no longer tracked

The project previously tracked four PMBus/SMBus PDFs in `document/`. The current
repository policy is conservative: this source tree keeps official source URLs,
metadata, and SHA-256 checksums, but does not redistribute third-party
specification PDFs. The historical files remain in old commits/tags; this task
does not rewrite history.

## Product scope and revision baseline

The product is a **PMBus numeric-format calculator** (LINEAR11 / VOUT-LINEAR16 /
DIRECT / IEEE 754 binary16 bidirectional conversion), not a PMBus/SMBus
controller or a conformance implementation.

- `validatedReference`: PMBus 1.3 / 1.3.1 public archive and SMBus 3.0.
- `currentPublishedRevision`: PMBus 1.5 (per the official PMBus site), noted for
  awareness only.
- `productScope`: numeric-format subset only.
- `fullRevisionCompliance`: not claimed — bus transport, command execution,
  device profiles, PMBus 1.5 security extensions and Part IV are out of scope.

PMBus 1.5 is not evaluated as the domain baseline and the manifest is not
rewritten to a 1.5 baseline without a full revision-diff audit.

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
