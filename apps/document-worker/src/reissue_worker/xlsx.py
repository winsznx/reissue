"""Spreadsheet loading. Each sheet becomes a page whose 'words' are cells on a fixed grid.

The grid lets the same line, table and field logic run over spreadsheets. Grid positions are
not PDF geometry, so spreadsheet evidence is reported with bbox=null.
"""

from __future__ import annotations

import io
import zipfile
from datetime import date, datetime
from decimal import Decimal

from openpyxl import load_workbook

from reissue_worker.config import Settings
from reissue_worker.errors import CorruptDocument, EmptyDocument, TooManyPages
from reissue_worker.layout import PageLayout, Word

CELL_WIDTH = 100.0
CELL_HEIGHT = 20.0
CELL_PADDING = 4.0
MAX_CELLS_PER_SHEET = 200_000


def load_sheets(data: bytes, settings: Settings) -> list[PageLayout]:
    _check_archive(data, settings)
    try:
        workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except (zipfile.BadZipFile, KeyError, ValueError, OSError) as exc:
        raise CorruptDocument(f"could not parse spreadsheet: {exc}") from exc

    try:
        sheets = workbook.worksheets
        if not sheets:
            raise EmptyDocument("workbook has no sheets")
        if len(sheets) > settings.max_pages:
            raise TooManyPages(f"workbook has {len(sheets)} sheets; limit is {settings.max_pages}")
        layouts = []
        for number, sheet in enumerate(sheets, start=1):
            words: list[Word] = []
            for row_index, row in enumerate(sheet.iter_rows(values_only=True)):
                for col_index, value in enumerate(row):
                    text = cell_text(value)
                    if not text:
                        continue
                    if len(words) >= MAX_CELLS_PER_SHEET:
                        raise CorruptDocument(f"sheet {number} exceeds {MAX_CELLS_PER_SHEET} cells")
                    x0, y0 = col_index * CELL_WIDTH, row_index * CELL_HEIGHT
                    words.append(
                        Word(text, x0, y0, x0 + CELL_WIDTH - CELL_PADDING, y0 + CELL_HEIGHT - CELL_PADDING)
                    )
            layouts.append(PageLayout(number, 0.0, 0.0, words, "spreadsheet"))
        return layouts
    finally:
        workbook.close()


def cell_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value).upper()
    if isinstance(value, datetime):
        return value.date().isoformat() if value.time() == datetime.min.time() else value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float):
        return format(Decimal(repr(value)).normalize(), "f")
    return " ".join(str(value).split())


def _check_archive(data: bytes, settings: Settings) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            total = sum(info.file_size for info in archive.infolist())
    except zipfile.BadZipFile as exc:
        raise CorruptDocument(f"could not parse spreadsheet: {exc}") from exc
    if total > settings.xlsx_max_uncompressed_bytes:
        raise CorruptDocument("spreadsheet expands beyond the allowed uncompressed size")
