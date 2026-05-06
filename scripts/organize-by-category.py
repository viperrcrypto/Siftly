#!/usr/bin/env python3
"""
organize-by-category.py
=======================
Organises a flat Siftly Obsidian export into per-category subdirectories.

Usage:
    python scripts/organize-by-category.py /path/to/export/dir
    python scripts/organize-by-category.py /path/to/export/dir --copy   # keep originals
    python scripts/organize-by-category.py /path/to/export/dir --dry-run

For bookmarks that belong to multiple categories the note is copied into each
one. When moving (default) only one copy is kept and symlinks are used for the
rest so the file exists in every relevant folder without duplication.
"""

import argparse
import os
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path


# ── Frontmatter parsing ───────────────────────────────────────────────────────

FRONT_DELIM = re.compile(r"^---\s*$", re.MULTILINE)


def parse_frontmatter(text: str) -> dict:
    """Return a dict with frontmatter values. Returns {} on any parse error."""
    parts = FRONT_DELIM.split(text, maxsplit=2)
    if len(parts) < 3:
        return {}
    fm_block = parts[1]
    result: dict = {}
    # Minimal YAML parser — handles scalars and YAML flow/block sequences
    # We only need: categories, tweet_id, author, date
    list_key: str | None = None
    list_items: list[str] = []
    for line in fm_block.splitlines():
        if not line.strip():
            continue
        # Item in a block sequence  (-  value  or  - "value")
        item_m = re.match(r"^\s+-\s+(.*)", line)
        if item_m and list_key:
            val = item_m.group(1).strip().strip('"').strip("'")
            list_items.append(val)
            continue
        # A new key — flush pending list
        if list_key and list_items:
            result[list_key] = list_items
            list_key = None
            list_items = []
        kv_m = re.match(r'^(\w[\w_-]*):\s*(.*)', line)
        if not kv_m:
            continue
        key, val = kv_m.group(1), kv_m.group(2).strip()
        # Inline flow sequence: categories: ["A", "B"]
        if val.startswith("["):
            inner = val.strip("[]")
            items = [v.strip().strip('"').strip("'") for v in inner.split(",") if v.strip()]
            result[key] = items
        elif val == "":
            # Start of a block sequence
            list_key = key
            list_items = []
        else:
            result[key] = val.strip('"').strip("'")
    if list_key and list_items:
        result[list_key] = list_items
    return result


# ── Filename sanitisation ─────────────────────────────────────────────────────

def safe_dirname(name: str) -> str:
    """Turn a category name into a safe directory name."""
    name = name.strip()
    name = re.sub(r'[<>:"/\\|?*\n\r]', '', name)
    name = re.sub(r'\s+', ' ', name)
    return name or "General"


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Organise Siftly Obsidian export by category.",
    )
    parser.add_argument("directory", help="Path to the export directory (contains .md files)")
    parser.add_argument("--copy", action="store_true", help="Copy files instead of moving them")
    parser.add_argument("--dry-run", action="store_true", help="Print what would happen, don't touch files")
    parser.add_argument("--no-symlinks", action="store_true", help="Copy into every category folder instead of symlinking")
    args = parser.parse_args()

    export_dir = Path(args.directory).resolve()
    if not export_dir.is_dir():
        sys.exit(f"Error: '{export_dir}' is not a directory.")

    # Collect .md files (non-recursive so we don't re-process already organised files)
    md_files = sorted(export_dir.glob("*.md"))
    if not md_files:
        sys.exit(f"No .md files found directly inside '{export_dir}'.")

    print(f"Found {len(md_files)} notes in {export_dir}\n")

    # Map: category_name → [file_path, ...]
    by_category: dict[str, list[Path]] = defaultdict(list)
    uncategorized: list[Path] = []

    for md_path in md_files:
        text = md_path.read_text(encoding="utf-8", errors="replace")
        fm = parse_frontmatter(text)
        categories: list[str] = []
        raw = fm.get("categories", [])
        if isinstance(raw, list):
            categories = [c for c in raw if c]
        elif isinstance(raw, str) and raw:
            categories = [raw]

        if categories:
            for cat in categories:
                by_category[cat].append(md_path)
        else:
            uncategorized.append(md_path)

    if uncategorized:
        by_category["General"] += uncategorized

    # Summary
    print("Categories detected:")
    for cat, files in sorted(by_category.items()):
        print(f"  {cat!r:40s} → {len(files)} notes")
    print()

    if args.dry_run:
        print("[dry-run] No files were modified.")
        return

    moved: int = 0
    copied: int = 0
    linked: int = 0
    errors: int = 0

    # Process each category
    for cat, files in by_category.items():
        cat_dir = export_dir / safe_dirname(cat)
        cat_dir.mkdir(exist_ok=True)

        # The first occurrence → move (or copy) the real file
        # Additional occurrences (multi-category) → symlink or copy
        for i, src in enumerate(files):
            dest = cat_dir / src.name
            if dest.exists():
                # Skip — already placed (e.g. previous run)
                continue

            is_primary = i == 0 or args.copy or args.no_symlinks

            if is_primary:
                if args.copy:
                    shutil.copy2(src, dest)
                    copied += 1
                    print(f"  copy  {src.name} → {cat}/")
                else:
                    # Move on first category, symlink for subsequent
                    if src.exists():
                        shutil.move(str(src), dest)
                        moved += 1
                        print(f"  move  {src.name} → {cat}/")
                    else:
                        # File already moved to another category — symlink back
                        _create_symlink(dest, src, cat)
                        linked += 1
            else:
                # Multi-category: create symlink pointing to whichever dir now owns the real file
                real_location = _find_real_location(export_dir, src.name, by_category)
                if real_location and not args.no_symlinks:
                    try:
                        dest.symlink_to(os.path.relpath(real_location, cat_dir))
                        linked += 1
                        print(f"  link  {src.name} → {cat}/ (→ {real_location.parent.name}/)")
                    except OSError as e:
                        print(f"  [warn] Could not create symlink for {src.name}: {e}")
                        errors += 1
                else:
                    # Fall back to copy
                    if real_location and real_location.exists():
                        shutil.copy2(real_location, dest)
                        copied += 1
                        print(f"  copy  {src.name} → {cat}/ (multi-category)")

    print(f"\nDone. Moved: {moved}  Copied: {copied}  Symlinked: {linked}  Errors: {errors}")


def _find_real_location(export_dir: Path, filename: str, by_category: dict) -> Path | None:
    """Find where a file ended up after being moved (first category that has it as a real file)."""
    for cat, files in by_category.items():
        for f in files:
            candidate = export_dir / safe_dirname(cat) / filename
            if candidate.exists() and not candidate.is_symlink():
                return candidate
    return None


def _create_symlink(dest: Path, src: Path, cat: str) -> None:
    try:
        dest.symlink_to(src.resolve())
    except OSError as e:
        print(f"  [warn] Could not symlink {src.name} in {cat}/: {e}")


if __name__ == "__main__":
    main()
