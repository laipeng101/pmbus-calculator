"""Deterministic ZIP helper for release asset generation (M25).

Reads a JSON manifest of files from stdin, creates a ZIP with fixed
metadata so the same dist/ produces the same zip bytes on the same
Python/zlib toolchain.

Manifest format (one JSON object per line):
  {"entry": "index.html", "path": "/absolute/path/to/dist/index.html"}

ZIP properties:
  - Entries are written in the order they appear in the manifest.
  - POSIX `/` separators.
  - DOS epoch timestamp (1980-01-01 00:00:00).
  - create_system = 3 (Unix).
  - Regular-file external_attr = 0o644 << 16.
  - No extra fields, no comment, no UID/GID.
  - DEFLATED compression.

Usage:
  python3 scripts/_zip_helper.py <dist_dir> <output.zip>

The dist_dir is used for realpath/lstat safety checks on every file
before reading. Symlinks, absolute paths outside dist_dir, and path
traversal are rejected.
"""

from __future__ import annotations

import json
import os
import stat
import sys
import zipfile

# Fixed ZIP metadata for deterministic output
DOS_EPOCH = (1980, 1, 1, 0, 0, 0)
CREATE_SYSTEM = 3  # Unix
REGULAR_FILE_MODE = 0o644
EXTERNAL_ATTR = (REGULAR_FILE_MODE & 0xFFFF) << 16


def fail(message: str) -> None:
    print(f"zip_helper: {message}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    if len(sys.argv) != 3:
        fail("usage: _zip_helper.py <dist_dir> <output.zip>")

    dist_dir = os.path.realpath(sys.argv[1])
    output_path = sys.argv[2]

    if not os.path.isdir(dist_dir):
        fail(f"dist_dir is not a directory: {dist_dir}")

    # Read manifest from stdin
    manifest = []
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError as e:
            fail(f"invalid manifest JSON: {e}")
        manifest.append(entry)

    if not manifest:
        fail("manifest is empty")

    # Validate and build
    seen = set()
    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in manifest:
            entry = item.get("entry", "")
            file_path = item.get("path", "")

            if not entry:
                fail(f"manifest item missing 'entry': {item}")
            if not file_path:
                fail(f"manifest item missing 'path': {item}")

            # Safety: resolve and validate
            real_path = os.path.realpath(file_path)
            if not real_path.startswith(dist_dir + os.sep) and real_path != dist_dir:
                fail(f"path escapes dist_dir: {file_path} -> {real_path}")

            try:
                st = os.lstat(real_path)
            except OSError as e:
                fail(f"cannot stat {real_path}: {e}")

            if stat.S_ISLNK(st.st_mode):
                fail(f"refusing symlink: {real_path}")
            if not stat.S_ISREG(st.st_mode):
                fail(f"not a regular file: {real_path}")

            if entry in seen:
                fail(f"duplicate zip entry: {entry}")
            seen.add(entry)

            info = zipfile.ZipInfo(entry, date_time=DOS_EPOCH)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = CREATE_SYSTEM
            info.external_attr = EXTERNAL_ATTR

            with open(real_path, "rb") as src:
                zf.writestr(info, src.read())

    print(f"zip_helper: wrote {len(manifest)} entries to {output_path}")


if __name__ == "__main__":
    main()