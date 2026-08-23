"""Deterministic ZIP helper for release asset generation (M25, hardened M26).

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
  - Regular-file external_attr = (stat.S_IFREG | 0o644) << 16.
  - No extra fields, no comment, no UID/GID.
  - DEFLATED compression.

Usage:
  python3 scripts/_zip_helper.py <dist_dir> <output.zip>

The dist_dir is used for realpath/lstat safety checks on every file
before reading. Symlinks, absolute paths outside dist_dir, and path
traversal are rejected.

M26 hardening: lstat the ORIGINAL path before realpath to detect
symlinks (TOCTOU fix). On POSIX, use os.open(..., O_RDONLY | O_NOFOLLOW)
followed by fstat to prevent check-vs-read replacement.
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
EXTERNAL_ATTR = (stat.S_IFREG | REGULAR_FILE_MODE) << 16

# Platform capability detection
_HAS_O_NOFOLLOW = hasattr(os, "O_NOFOLLOW")


def fail(message: str) -> None:
    print(f"zip_helper: {message}", file=sys.stderr)
    sys.exit(1)


def _remove_partial_output(output_path: str) -> None:
    """Delete a partially written zip so failures leave no artifact."""
    try:
        os.unlink(output_path)
    except OSError:
        pass


def read_all_from_fd(fd: int) -> bytes:
    """Read an opened fd until EOF, tolerating short reads (M27 WP-F).

    Regular files can legitimately return fewer bytes than requested
    (signals, resource limits); pipes always do. Loop until os.read
    returns b"" and concatenate.
    """
    chunks: list[bytes] = []
    while True:
        chunk = os.read(fd, 65536)
        if not chunk:
            break
        chunks.append(chunk)
    return b"".join(chunks)


def validate_and_open(file_path: str, dist_dir: str) -> tuple[int, str]:
    """Validate a file path and open it safely.

    M27 WP-F hardening:
    - On POSIX the ORIGINAL path is opened with O_NOFOLLOW, so the opened
      inode is exactly the non-symlink final component at that path.
    - fstat(dev+ino) of the opened fd must equal the initial lstat
      (identity check): a swap between lstat and open fails closed.
    - Containment is verified on the resolved path before opening.

    Returns (fd, real_path). Callers must re-check identity/size via
    verify_read_identity() after reading.
    """
    # Step 1: lstat the ORIGINAL path first (before realpath)
    # This catches symlinks at the original path level (M26 TOCTOU fix).
    try:
        st_original = os.lstat(file_path)
    except OSError as e:
        fail(f"cannot stat {file_path}: {e}")

    if stat.S_ISLNK(st_original.st_mode):
        fail(f"refusing symlink: {file_path}")

    if not stat.S_ISREG(st_original.st_mode):
        fail(f"not a regular file: {file_path}")

    # Step 2: Resolve realpath for containment check
    real_path = os.path.realpath(file_path)

    # Step 3: Verify containment within dist_dir
    if not real_path.startswith(dist_dir + os.sep) and real_path != dist_dir:
        fail(f"path escapes dist_dir: {file_path} -> {real_path}")

    # Step 4: Open atomically. On POSIX open the ORIGINAL path with
    # O_NOFOLLOW: combined with step 1's lstat this pins the final path
    # component to a regular file. Platforms without O_NOFOLLOW fall back
    # to lstat(real_path)+open (conservative, non-atomic).
    if _HAS_O_NOFOLLOW:
        try:
            fd = os.open(file_path, os.O_RDONLY | os.O_NOFOLLOW)
        except OSError as e:
            fail(f"cannot open {file_path}: {e}")
    else:
        try:
            st_final = os.lstat(real_path)
        except OSError as e:
            fail(f"cannot stat {real_path}: {e}")

        if stat.S_ISLNK(st_final.st_mode):
            fail(f"refusing symlink after realpath: {real_path}")
        if not stat.S_ISREG(st_final.st_mode):
            fail(f"not a regular file after realpath: {real_path}")

        try:
            fd = os.open(real_path, os.O_RDONLY)
        except OSError as e:
            fail(f"cannot open {real_path}: {e}")

    # Step 5: identity + type verification of the OPENED fd (M27).
    try:
        st_fd = os.fstat(fd)
    except OSError as e:
        os.close(fd)
        fail(f"cannot fstat opened fd for {file_path}: {e}")

    if not stat.S_ISREG(st_fd.st_mode):
        os.close(fd)
        fail(f"opened file descriptor is not a regular file: {file_path}")

    if (st_fd.st_dev, st_fd.st_ino) != (st_original.st_dev, st_original.st_ino):
        os.close(fd)
        fail(
            f"file replaced between lstat and open: {file_path} "
            f"(lstat dev={st_original.st_dev}/ino={st_original.st_ino}, "
            f"fd dev={st_fd.st_dev}/ino={st_fd.st_ino})"
        )

    return fd, real_path


def verify_read_identity(fd: int, st_initial: os.stat_result, total_read: int) -> None:
    """Post-read integrity gate (M27 WP-F).

    Fails when the file changed length or identity while being read --
    the produced bytes would otherwise silently mismatch the directory
    state the transaction believes it archived.
    """
    if total_read != st_initial.st_size:
        fail(
            f"file changed size during read: expected {st_initial.st_size} bytes, "
            f"read {total_read}"
        )
    st_after = os.fstat(fd)
    if (st_after.st_dev, st_after.st_ino) != (
        st_initial.st_dev,
        st_initial.st_ino,
    ):
        fail("file identity changed during read")


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

    # Validate and build. Any failure must leave NO output artifact behind --
    # a partial/empty zip must never look like a finished product.
    seen = set()
    try:
        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for item in manifest:
                entry = item.get("entry", "")
                file_path = item.get("path", "")

                if not entry:
                    fail(f"manifest item missing 'entry': {item}")
                if not file_path:
                    fail(f"manifest item missing 'path': {item}")

                if entry in seen:
                    fail(f"duplicate zip entry: {entry}")
                seen.add(entry)

                # Validate and open safely (identity pinned to lstat'd inode)
                fd, real_path = validate_and_open(file_path, dist_dir)
                st_initial = os.lstat(file_path)

                try:
                    info = zipfile.ZipInfo(entry, date_time=DOS_EPOCH)
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.create_system = CREATE_SYSTEM
                    info.external_attr = EXTERNAL_ATTR

                    # Read until EOF (short-read safe), then verify the bytes
                    # still describe exactly the file we checked in.
                    data = read_all_from_fd(fd)
                    verify_read_identity(fd, st_initial, len(data))
                    zf.writestr(info, data)
                finally:
                    os.close(fd)
    except SystemExit:
        _remove_partial_output(output_path)
        raise
    except BaseException:
        _remove_partial_output(output_path)
        raise

    print(f"zip_helper: wrote {len(manifest)} entries to {output_path}")


if __name__ == "__main__":
    main()