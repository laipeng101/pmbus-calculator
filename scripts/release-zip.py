"""Create, verify, and extract the web ZIP used by Releases and GitHub Pages."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import shutil
import stat
import zipfile

CSP_MARKERS = (
    b'http-equiv="Content-Security-Policy"',
    b"http-equiv='Content-Security-Policy'",
)
CSP_REQUIRED = (b"default-src 'self'", b"script-src 'self'")
SCRIPT_SRC_RE = re.compile(rb"<script[^>]+src=[\"']([^\"']+)[\"']")
LINK_HREF_RE = re.compile(rb"<link[^>]+href=[\"']([^\"']+)[\"']")
PAGES_ONLY_MARKERS = (
    b"data-cf-beacon",
    b"cloudflareinsights.com",
    b"data-pages-only",
    b"pages-overlay.css",
)


def validate_name(name: str) -> None:
    if (
        re.search(r"[\x00-\x1f\x7f\\]", name)
        or re.match(r"^[A-Za-z]:", name)
        or any(part in ("", ".", "..", "node_modules", "src") for part in name.split("/"))
        or name.endswith(".map")
    ):
        raise ValueError(f"unsafe ZIP entry: {name!r}")


def read_input(file: Path, dist: Path) -> bytes:
    before = file.lstat()
    if not stat.S_ISREG(before.st_mode):
        raise ValueError(f"not a regular build file: {file}")
    if not file.resolve(strict=True).is_relative_to(dist):
        raise ValueError(f"build file is outside {dist}: {file}")
    # O_NOFOLLOW guards against a replacement between lstat and open. Keep
    # the file identity and metadata checks on platforms without the flag.
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    flags |= getattr(os, "O_BINARY", 0)
    with os.fdopen(os.open(file, flags), "rb") as source:
        opened = os.fstat(source.fileno())
        if not stat.S_ISREG(opened.st_mode) or not os.path.samestat(before, opened):
            raise ValueError(f"build file was replaced: {file}")
        content = source.read()
        after = os.fstat(source.fileno())
        if (
            len(content) != opened.st_size
            or after.st_mtime_ns != opened.st_mtime_ns
            or after.st_ctime_ns != opened.st_ctime_ns
        ):
            raise ValueError(f"build file changed while being read: {file}")
    return content


def fail_walk(error: OSError) -> None:
    raise error


def create_zip(dist: Path, destination: Path) -> None:
    if not stat.S_ISDIR(dist.lstat().st_mode):
        raise ValueError(f"build directory is not a directory: {dist}")
    dist = dist.resolve(strict=True)
    files = []
    for directory, dirs, names in os.walk(dist, onerror=fail_walk):
        root = Path(directory)
        for name in dirs:
            if not stat.S_ISDIR((root / name).lstat().st_mode):
                raise ValueError(f"not a regular build directory: {root / name}")
        for name in names:
            file = root / name
            files.append((file.relative_to(dist).as_posix(), file))

    # Preserve the entry order, compression and metadata of published ZIPs.
    output = destination.open("xb")
    try:
        with output, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, file in sorted(files):
                validate_name(name)
                entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                entry.create_system = 3
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = (stat.S_IFREG | 0o644) << 16
                archive.writestr(entry, read_input(file, dist))
        with zipfile.ZipFile(destination) as written:
            verify_zip(written)
    except BaseException:
        destination.unlink()
        raise


def verify_zip(archive: zipfile.ZipFile) -> None:
    names = set()
    for entry in archive.infolist():
        name = entry.filename
        validate_name(name)
        if entry.orig_filename != name or name in names:
            raise ValueError(f"ambiguous ZIP entry: {name!r}")
        mode = stat.S_IFMT(entry.external_attr >> 16)
        if mode not in (0, stat.S_IFREG):
            raise ValueError(f"not a regular ZIP file: {name!r}")
        names.add(name)
        content = archive.read(entry).lower()
        filename = name.lower().encode()
        if any(marker in content or marker in filename for marker in PAGES_ONLY_MARKERS):
            raise ValueError("release ZIP contains Pages-only content")

    if "index.html" not in names or not any(name.startswith("assets/") for name in names):
        raise ValueError("release ZIP must contain index.html and assets/")
    html = archive.read("index.html")
    if (
        not any(marker in html for marker in CSP_MARKERS)
        or not all(required in html for required in CSP_REQUIRED)
    ):
        raise ValueError("index.html is missing the production Content-Security-Policy")

    scripts = SCRIPT_SRC_RE.findall(html)
    links = LINK_HREF_RE.findall(html)
    if not scripts or not links:
        raise ValueError("index.html must reference scripts and stylesheets")
    for source in scripts + links:
        if source.lower().startswith((b"http://", b"https://", b"/", b"data:")):
            raise ValueError(f"index.html resource must be a relative path: {source!r}")


def extract_zip(archive: zipfile.ZipFile, destination: Path) -> None:
    destination.mkdir()
    try:
        archive.extractall(destination)
    except BaseException:
        shutil.rmtree(destination)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create")
    create.add_argument("dist", type=Path)
    create.add_argument("zip", type=Path)
    verify = commands.add_parser("verify")
    verify.add_argument("zip", type=Path)
    extract = commands.add_parser("extract")
    extract.add_argument("zip", type=Path)
    extract.add_argument("destination", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "create":
            create_zip(args.dist, args.zip)
        else:
            with zipfile.ZipFile(args.zip) as archive:
                verify_zip(archive)
                if args.command == "extract":
                    extract_zip(archive, args.destination)
    except (OSError, ValueError, RuntimeError, zipfile.BadZipFile) as error:
        parser.exit(1, f"release ZIP: {error}\n")


if __name__ == "__main__":
    main()
