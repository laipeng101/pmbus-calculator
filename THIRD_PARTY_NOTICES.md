# THIRD PARTY NOTICES

This file records the distribution boundary between this repository's source code
and third-party PMBus/SMBus specification documents. It does **not** provide legal
advice and does **not** create a legal conclusion about whether redistribution of
the specifications is permitted or prohibited.

## Project code

The project source code in this repository is released under the MIT License in
[`LICENSE`](LICENSE).

## Third-party specifications

- PMBus, AVSBus, SMBus and related specification names and documents belong to
  their respective rights holders, including the System Management Interface
  Forum, Inc. (SMIF) where applicable.
- Third-party specification documents are **not** licensed under this project's
  MIT License.
- The current source tree does **not** ship specification PDFs. Official source
  URLs, file metadata, and SHA-256 checksums are maintained in
  [`document/specifications.json`](document/specifications.json).
- Developers download specification PDFs on demand from the official sources
  listed in the manifest into the git-ignored `.cache/specifications/` directory.
- This project is not affiliated with, endorsed by, or certified by SMIF.
- This project does not claim PMBus compliance certification.
- The manifest uses the neutral `redistributionStatus` value
  `not-established-by-project` because no explicit, citable redistribution grant
  has been identified by this project. The project follows a conservative
  policy: metadata and checksums are tracked; PDFs are not redistributed from the
  active source tree.
