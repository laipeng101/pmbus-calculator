"""Pre-extraction checks for the immutable GitHub Release web.zip asset."""
from __future__ import annotations

import re
import stat
import sys
import zipfile

INDEX_NAME = "index.html"
CSP_MARKERS = (
    b'http-equiv="Content-Security-Policy"',
    b"http-equiv='Content-Security-Policy'",
)
CSP_REQUIRED = (
    b"default-src 'self'",
    b"script-src 'self'",
)

SCRIPT_SRC_RE = re.compile(rb"<script[^>]+src=[\"']([^\"']+)[\"']")
LINK_HREF_RE = re.compile(rb"<link[^>]+href=[\"']([^\"']+)[\"']")

FORBIDDEN_SEGMENTS = ("node_modules", "src")
CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
WINDOWS_DRIVE = re.compile(r"^[A-Za-z]:")


def fail(message: str) -> None:
    print(f"::error::{message}")
    sys.exit(1)


def is_absolute_path(name: str) -> bool:
    return name.startswith("/") or bool(re.match(r"^[A-Za-z]:[\\/]", name))


def has_parent_traversal(name: str) -> bool:
    return any(part == ".." for part in name.replace("\\", "/").split("/"))


def is_symlink(info: zipfile.ZipInfo) -> bool:
    mode = (info.external_attr >> 16) & 0o170000
    return stat.S_ISLNK(mode)


def validate_entry_name(name: str) -> None:
    """M29 WP-E: identical entry policy to scripts/release-artifact-contract.mjs
    validateZipEntry and scripts/_zip_helper.py validate_entry_name. Every
    layer must reject the same set, including Windows drive absolute /
    drive-relative and UNC paths.
    """
    if not name:
        fail("zip contains an empty entry name")
    if name.startswith("/"):
        fail(f"zip contains an absolute path: {name!r}")
    if WINDOWS_DRIVE.match(name):
        fail(f"zip contains a windows drive path: {name!r}")
    if "\\" in name:
        fail(f"zip contains a backslash: {name!r}")
    if CONTROL_CHARS.search(name):
        fail(f"zip contains control characters: {name!r}")
    for seg in name.split("/"):
        if seg == "..":
            fail(f"zip contains ../ path traversal: {name!r}")
        if seg == ".":
            fail(f"zip contains a dot segment: {name!r}")
        if not seg:
            fail(f"zip contains an empty segment: {name!r}")
        if seg in FORBIDDEN_SEGMENTS:
            fail(f"zip contains a forbidden segment {seg!r}: {name!r}")
    if name.endswith(".map"):
        fail(f"zip contains a source map entry: {name!r}")


def main(zip_path: str) -> None:
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        if not names:
            fail("zip is empty")

        for info in zf.infolist():
            name = info.filename
            validate_entry_name(name)
            if is_symlink(info):
                fail(f"zip contains a symbolic link: {name!r}")

        if INDEX_NAME not in names:
            fail(f"zip must contain {INDEX_NAME!r}")
        if not any(name == "assets/" or name.startswith("assets/") for name in names):
            fail("zip must contain the 'assets/' directory")

        html = zf.read(INDEX_NAME)

        if b"/src/main.tsx" in html:
            fail("index.html must not reference /src/main.tsx")

        if not any(marker in html for marker in CSP_MARKERS):
            fail("index.html is missing the production Content-Security-Policy meta tag")
        for required in CSP_REQUIRED:
            if required not in html:
                fail(f"index.html CSP must include {required!r}")

        script_srcs = SCRIPT_SRC_RE.findall(html)
        link_hrefs = LINK_HREF_RE.findall(html)
        if not script_srcs:
            fail("index.html must reference at least one script asset")
        if not link_hrefs:
            fail("index.html must reference at least one stylesheet asset")

        absolute_url_prefixes = (b"http://", b"https://", b"//", b"/", b"data:")
        for src in script_srcs + link_hrefs:
            if src.startswith(absolute_url_prefixes):
                fail(f"index.html resource must be a relative path: {src.decode()!r}")

    print("release zip verification passed")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        fail("usage: verify_release_zip.py <web.zip>")
    main(sys.argv[1])
