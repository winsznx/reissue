"""Line-item table extraction from positioned words.

Rows below a recognised header (see headers.py) are bucketed into the column x-ranges.
Continuation lines extend the previous row's description, a value line printed beside a
vertically centred multi-line description completes its row, headers repeated on later pages
resume the same table, and totals rows end the table and are reported as total_* fields.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field

from reissue_worker.headers import (
    MAX_ROW_GAP_FACTOR,
    TOTAL_ROW,
    UNREPORTED_KINDS,
    Column,
    ColumnKind,
    column_for,
    find_header,
    header_columns,
    is_total_line,
)
from reissue_worker.layout import Line, PageLayout, Word, union_bbox
from reissue_worker.models import (
    ExtractedField,
    ExtractedLineItem,
    FieldPath,
    Measure,
    Packages,
    Parser,
    SourceSpan,
)
from reissue_worker.normalize import (
    CURRENCY_CODE,
    Quantity,
    Unit,
    compact_text,
    known_unit,
    parse_decimal,
    parse_quantity,
)

_ROW_START_KINDS: tuple[ColumnKind, ...] = ("quantity", "amount", "packages", "gross_weight", "net_weight")
_SKU_SHAPE = re.compile(r"^(?=.*\d)[A-Za-z0-9][A-Za-z0-9\-_/.]{2,}$")
_LINE_NUMBER = re.compile(r"^\d{1,4}[.)]?$")
_SEQUENCE_MARK = re.compile(r"^\d+\s*(?:of|/)\s*\d+$", re.IGNORECASE)
_MAX_SPACED_ROW_GAP_FACTOR = 6.0
_MAX_TOTALS_GAP_FACTOR = 8.0

Cells = dict[ColumnKind, list[Word]]


@dataclass(slots=True)
class _Row:
    page: int
    lines: list[Line]
    cells: Cells = field(default_factory=dict)

    @property
    def words(self) -> list[Word]:
        return [w for line in self.lines for w in line.words]

    def text(self, kind: ColumnKind) -> str:
        return compact_text(" ".join(w.text for w in self.cells.get(kind, [])))

    def extend(self, line: Line, cells: Cells) -> None:
        self.lines.append(line)
        for kind, words in cells.items():
            self.cells.setdefault(kind, []).extend(words)


@dataclass(slots=True)
class TableResult:
    line_items: list[ExtractedLineItem] = field(default_factory=list)
    totals: list[ExtractedField] = field(default_factory=list)


def extract_line_items(pages: Sequence[PageLayout]) -> TableResult:
    result = TableResult()
    open_columns: list[Column] | None = None
    for page in pages:
        header = find_header(page.lines)
        if header is not None:
            columns, body_start = header
        elif open_columns is not None:
            columns, body_start = open_columns, 0
        else:
            continue
        closed = _parse_body(page, page.lines[body_start:], columns, result, require_start=header is None)
        if header is not None and not any(f.path == "currency" for f in result.totals):
            result.totals.extend(_header_currency(page, columns))
        open_columns = None if closed else columns
    return result


def _parse_body(
    page: PageLayout,
    lines: Sequence[Line],
    columns: list[Column],
    result: TableResult,
    *,
    require_start: bool,
) -> bool:
    """Parse rows until the table ends. Returns True when a totals row closed the table."""
    row: _Row | None = None
    previous: Line | None = None
    started = not require_start
    keyed_rows = False
    for line in lines:
        if header_columns(line) is not None:
            break
        total = is_total_line(line) or any(TOTAL_ROW.match(w.text) for w in line.words[:2])
        cells = _bucket(columns, line)
        if previous is not None and not _within_reach(line, previous, cells, total=total, started=started):
            break
        if total:
            _flush(row, columns, page, result)
            result.totals.extend(_totals(page, line, columns))
            return True

        if row is not None and _completes(row, cells, line):
            row.extend(line, cells)
        elif _is_row_start(cells):
            if keyed_rows and "sku" not in cells:
                continue
            _flush(row, columns, page, result)
            row = _Row(page=page.number, lines=[line], cells=cells)
            keyed_rows = keyed_rows or "sku" in cells
            started = True
        elif started and row is not None and _is_continuation(cells):
            row.extend(line, cells)
        elif started and row is not None and not cells and _has_unreported_text(columns, line):
            pass
        elif started:
            break
        else:
            continue
        previous = line
    _flush(row, columns, page, result)
    return False


def _within_reach(line: Line, previous: Line, cells: Cells, *, total: bool, started: bool) -> bool:
    """Rows sit close together; a well-formed row or a totals row may follow blank form space."""
    gap = line.y0 - previous.y1
    if gap <= MAX_ROW_GAP_FACTOR * previous.height:
        return True
    if total:
        return gap <= _MAX_TOTALS_GAP_FACTOR * previous.height
    return started and _is_strong_row(cells) and gap <= _MAX_SPACED_ROW_GAP_FACTOR * previous.height


def _bucket(columns: Sequence[Column], line: Line) -> Cells:
    cells: Cells = {}
    for word in line.words:
        column = column_for(columns, word)
        if column.kind is not None and column.kind not in UNREPORTED_KINDS:
            cells.setdefault(column.kind, []).append(word)
    return cells


def _has_unreported_text(columns: Sequence[Column], line: Line) -> bool:
    return any(column_for(columns, w).kind in UNREPORTED_KINDS for w in line.words)


def _numeric_kinds(cells: Cells) -> set[ColumnKind]:
    return {
        kind
        for kind in _ROW_START_KINDS
        if kind in cells and _cell_number(kind, compact_text(" ".join(w.text for w in cells[kind])))
    }


def _cell_number(kind: ColumnKind, text: str) -> bool:
    if kind == "packages" and _SEQUENCE_MARK.match(text):
        return False
    return parse_decimal(text) is not None


def _is_row_start(cells: Cells) -> bool:
    if _numeric_kinds(cells):
        return True
    return _has_sku_shape(cells)


def _has_sku_shape(cells: Cells) -> bool:
    sku_words = cells.get("sku", [])
    return len(sku_words) == 1 and _SKU_SHAPE.match(sku_words[0].text) is not None


def _is_strong_row(cells: Cells) -> bool:
    return bool(_numeric_kinds(cells)) and (_has_sku_shape(cells) or "description" in cells)


def _is_continuation(cells: Cells) -> bool:
    return bool(cells) and set(cells) <= {"description", "sku"} and "description" in cells


def _completes(row: _Row, cells: Cells, line: Line) -> bool:
    """A value line printed beside a vertically centred multi-line description belongs to that row:
    it touches the row's last line, carries no key of its own, and fills only empty value cells."""
    last = row.lines[-1]
    if line.y0 - last.y1 > 0.5 * last.height or "sku" in cells:
        return False
    values = _numeric_kinds(cells)
    return bool(values) and not (values & _numeric_kinds(row.cells))


def _flush(row: _Row | None, columns: Sequence[Column], page: PageLayout, result: TableResult) -> None:
    if row is None:
        return
    hints = {c.kind: c.unit_hint() for c in columns if c.kind is not None}
    quantity = _measure(row.text("quantity"), _explicit_unit(row.text("unit")) or hints.get("quantity"))
    packages = _packages(row.text("packages"), hints.get("packages"))
    sku = row.text("sku") or _identifier(row.text("line_no"))
    result.line_items.append(
        ExtractedLineItem(
            row_index=len(result.line_items),
            sku=sku,
            description=row.text("description"),
            quantity=quantity,
            packages=packages,
            unit_price=parse_decimal(row.text("unit_price")) if row.text("unit_price") else None,
            amount=parse_decimal(row.text("amount")) if row.text("amount") else None,
            net_weight=_measure(row.text("net_weight"), hints.get("net_weight")),
            gross_weight=_measure(row.text("gross_weight"), hints.get("gross_weight")),
            cbm=parse_decimal(row.text("cbm")) if row.text("cbm") else None,
            pieces_per_package=(
                parse_decimal(row.text("pieces_per_package")) if row.text("pieces_per_package") else None
            ),
            source=_span(page, row.words, "\n".join(line.text for line in row.lines), table=True),
        )
    )


def _identifier(text: str) -> str | None:
    """A "No."/"Item" column holding references rather than running numbers identifies the goods."""
    return text if text and not _LINE_NUMBER.match(text) else None


def _cell_text(cells: Cells, kind: ColumnKind) -> str:
    return compact_text(" ".join(w.text for w in cells.get(kind, [])))


def _explicit_unit(text: str) -> Unit | None:
    return known_unit(text) if text else None


def _measure(raw: str, hint: Unit | None) -> Measure | None:
    if not raw:
        return None
    parsed: Quantity | None = parse_quantity(raw)
    if parsed is None:
        return None
    return Measure(value=parsed.value, unit=parsed.unit or hint or "unknown", raw=raw)


def _packages(raw: str, hint: Unit | None) -> Packages | None:
    if _SEQUENCE_MARK.match(raw):
        return None
    measure = _measure(raw, hint)
    if measure is None:
        return None
    return Packages(count=measure.value, type=measure.unit, raw=raw)


_TOTAL_PATHS: dict[ColumnKind, FieldPath] = {
    "quantity": "total_quantity",
    "amount": "total_amount",
    "packages": "total_packages",
    "net_weight": "total_net_weight",
    "gross_weight": "total_gross_weight",
    "cbm": "total_cbm",
}


def _totals(page: PageLayout, line: Line, columns: Sequence[Column]) -> list[ExtractedField]:
    cells = _bucket(columns, line)
    hints = {c.kind: c.unit_hint() for c in columns if c.kind is not None}
    fields: list[ExtractedField] = []
    for kind, path in _TOTAL_PATHS.items():
        words = cells.get(kind)
        if not words:
            continue
        raw = compact_text(" ".join(w.text for w in words))
        parsed = parse_quantity(raw)
        if parsed is None:
            continue
        unit = parsed.unit or (_explicit_unit(_cell_text(cells, "unit")) if kind == "quantity" else None)
        unit = unit or hints.get(kind)
        if kind in ("amount", "cbm"):
            unit = None
        fields.append(
            ExtractedField(
                path=path,
                raw=raw,
                value=parsed.value,
                unit=unit,
                source=_span(page, words, raw, table=True),
            )
        )
    currency = next((w for w in line.words if CURRENCY_CODE.fullmatch(w.text)), None)
    if currency is not None:
        fields.append(_currency_field(page, currency, table=True))
    return fields


def _header_currency(page: PageLayout, columns: Sequence[Column]) -> list[ExtractedField]:
    for column in columns:
        if column.kind not in ("amount", "unit_price"):
            continue
        for word in column.words:
            if CURRENCY_CODE.fullmatch(word.text.strip("()[]")):
                return [_currency_field(page, word, table=True)]
    return []


def _currency_field(page: PageLayout, word: Word, *, table: bool) -> ExtractedField:
    code = word.text.strip("()[]")
    return ExtractedField(
        path="currency",
        raw=code,
        value=code.upper(),
        unit=None,
        source=_span(page, [word], word.text, table=table),
    )


def page_parser(page: PageLayout, *, table: bool) -> Parser:
    if page.parser == "ocr":
        return "ocr"
    if page.parser == "spreadsheet":
        return "spreadsheet"
    return "pdf_table" if table else "pdf_text"


def _span(page: PageLayout, words: Sequence[Word], quote: str, *, table: bool) -> SourceSpan:
    confidence = 0.95 if page.parser != "ocr" else 0.9 * min(w.confidence for w in words)
    return SourceSpan(
        page=page.number,
        bbox=union_bbox(words) if page.has_geometry else None,
        quote=quote,
        parser=page_parser(page, table=table),
        confidence=confidence,
    )
