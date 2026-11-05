from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pymupdf

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "tests" / "fixtures" / "documents"

Result = dict[str, Any]


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def make_pdf(lines: Sequence[tuple[float, float, str]], *, fontsize: float = 10) -> bytes:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for x, y, text in lines:
        page.insert_text((x, y), text, fontsize=fontsize)
    data: bytes = document.tobytes()
    document.close()
    return data


def fields_by_path(part: Result) -> dict[str, Result]:
    return {field["path"]: field for field in part["fields"]}
