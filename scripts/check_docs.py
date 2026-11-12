#!/usr/bin/env python3
"""Validate the bilingual READMEs and their screenshot assets.

Run from the repository root:  python scripts/check_docs.py
Uses only the Python standard library so it can run in any CI job.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMAGE_RE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
REQUIRED_SCREENS = (
    "dashboard",
    "monitors",
    "monitor-detail",
    "incidents",
    "settings",
    "create-monitor",
    "login",
)
errors: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


def local_images(text: str) -> list[str]:
    return [
        match
        for match in IMAGE_RE.findall(text)
        if not match.startswith(("http://", "https://", "data:"))
    ]


def main() -> int:
    en_path = ROOT / "README.md"
    zh_path = ROOT / "README.zh-CN.md"
    for path in (en_path, zh_path):
        check(path.is_file(), f"missing {path.name}")
    if not (en_path.is_file() and zh_path.is_file()):
        print("\n".join(f"ERROR: {e}" for e in errors))
        return 1

    en = en_path.read_text(encoding="utf-8")
    zh = zh_path.read_text(encoding="utf-8")

    # Every locally referenced image must exist.
    for name, text in (("README.md", en), ("README.zh-CN.md", zh)):
        for image in local_images(text):
            target = (ROOT / image.split("#", 1)[0]).resolve()
            check(target.is_file(), f"{name}: referenced image does not exist: {image}")

    # Language separation: the English README shows English screenshots and the
    # Chinese README shows Chinese screenshots (never the other way round).
    en_images = local_images(en)
    zh_images = local_images(zh)
    en_ui = [i for i in en_images if i.startswith("docs/screenshots/en/")]
    zh_ui = [i for i in zh_images if i.startswith("docs/screenshots/zh/")]
    check(len(en_ui) >= len(REQUIRED_SCREENS) - 1, "README.md: missing English UI screenshots")
    check(len(zh_ui) >= len(REQUIRED_SCREENS) - 1, "README.zh-CN.md: missing Chinese UI screenshots")
    check(
        not any("docs/screenshots/zh/" in i for i in en_images),
        "README.md must not embed Chinese UI screenshots",
    )
    check(
        not any("docs/screenshots/en/" in i for i in zh_images),
        "README.zh-CN.md must not embed English UI screenshots",
    )

    # Cross-links between the two READMEs.
    check("README.zh-CN.md" in en, "README.md: missing link to the Chinese README")
    check("README.md" in zh, "README.zh-CN.md: missing link to the English README")

    # Security and licence sections stay in English in BOTH documents.
    for name, text in (("README.md", en), ("README.zh-CN.md", zh)):
        for heading in ("## Security", "## License"):
            check(heading in text, f"{name}: missing English section {heading!r}")
        check("SSRF" in text, f"{name}: Security section should still document SSRF")
        check("MIT" in text, f"{name}: License section should reference MIT")

    # Screenshot manifest + file set.
    manifest_path = ROOT / "docs" / "screenshots" / "screenshots.json"
    check(manifest_path.is_file(), "missing docs/screenshots/screenshots.json")
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        check(set(manifest.get("locales", [])) == {"en", "zh"}, "manifest: locales must be en + zh")
        for locale in ("en", "zh"):
            for screen in REQUIRED_SCREENS:
                image = ROOT / "docs" / "screenshots" / locale / f"{screen}.png"
                check(image.is_file(), f"missing screenshot: docs/screenshots/{locale}/{screen}.png")
                if image.is_file():
                    check(image.stat().st_size > 10_000, f"suspiciously small screenshot: {image}")
                    with image.open("rb") as handle:
                        check(handle.read(8) == b"\x89PNG\r\n\x1a\n", f"not a PNG: {image}")

    if errors:
        print("\n".join(f"ERROR: {e}" for e in errors))
        return 1
    print(
        f"Docs OK: 2 READMEs, {len(en_ui)} English + {len(zh_ui)} Chinese UI screenshots, "
        f"{len(REQUIRED_SCREENS)} screens per locale."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
