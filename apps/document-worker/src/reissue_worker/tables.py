"""Line-item table extraction from positioned words.

A header row is recognised by column-name synonyms; each header cell owns the x-range up to
the midpoint of its neighbours. Rows below the header are bucketed into those ranges.
Continuation lines extend the previous row's description, headers repeated on later pages
resume the same table, and totals rows end the table and are reported as total_* fields.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from itertools import pairwise
from typing import Literal

from reissue_worker.layout import Line, PageLayout, Word, split_segments, union_bbox
from reissue_worker.models import (
    ExtractedField,
    ExtractedLineItem,
    FieldPath,
    Measure,
    Packages,
    Parser,
    SourceSpan,
)
from reissue_worker.normalize import Quantity, Unit, compact_text, known_unit, parse_decimal, parse_quantity

ColumnKind = Literal[
    "line_no",
    "sku",
    "description",
    "quantity",
    "unit",
    "unit_price",
    "amount",
    "packages",
    "pieces_per_package",
    "net_weight",
    "gross_weight",
    "cbm",
]

_SYNONYMS: dict[ColumnKind, tuple[str, ...]] = {
    "pieces_per_package": (
        "pcs/ctn",
        "pcs per ctn",
        "qty/ctn",
        "qty per ctn",
        "pcs/carton",
        "units/ctn",
        "pcs/pkg",
        "pcs/cs",
        "inner qty",
        "packing",
    ),
    "net_weight": (
        "n.w.",
        "n. w.",
        "nw",
        "net wt",
        "net wt.",
        "net weight",
        "total n.w.",
        "total net weight",
    ),
    "gross_weight": (
        "g.w.",
        "g. w.",
        "gw",
        "gross wt",
        "gross wt.",
        "gross weight",
        "total g.w.",
        "total gross weight",
    ),
    "cbm": ("cbm", "measurement", "meas", "meas.", "volume", "m3", "m³", "total cbm"),
    "unit_price": ("unit price", "price", "rate", "unit cost", "price/unit", "u/price"),
    "amount": ("amount", "total", "value", "total amount", "line total", "total value", "ext. amount"),
    "packages": (
        "ctns",
        "ctn",
        "cartons",
        "carton",
        "packages",
        "pkgs",
        "pkg",
        "no. of ctns",
        "no. of cartons",
        "no. of packages",
        "no. of pkgs",
        "carton qty",
        "qty of ctns",
        "pallets",
    ),
    "quantity": ("qty", "q'ty", "quantity", "pcs", "pieces", "total qty", "total pcs", "qty pcs", "units"),
    "unit": ("unit", "uom", "u/m", "u.o.m."),
    "sku": (
        "sku",
        "item no",
        "item no.",
        "item #",
        "item code",
        "part no",
        "part no.",
        "part number",
        "part #",
        "art no",
        "art. no",
        "art. no.",
        "article no",
        "article no.",
        "model no",
        "model no.",
        "model",
        "code",
        "style no",
        "style no.",
        "product code",
        "ref",
        "ref.",
    ),
    "description": (
        "description",
        "description of goods",
        "goods",
        "goods description",
        "commodity",
        "product",
        "product description",
        "item description",
        "item name",
        "goods/description",
    ),
    "line_no": ("no", "no.", "#", "line", "s/n", "sn", "item", "seq"),
}

_UNIT_SUFFIX = r"(?:\s*[\(\[][^\)\]]{0,12}[\)\]]|\s+(?:kgs?|lbs?|pcs|usd|eur|cny|rmb|m3|cbm|ctns))?"


def _phrase_regex(phrase: str) -> str:
    parts = re.escape(phrase).replace(r"\ ", " ").split(" ")
    return r"\s*".join(part.replace(r"\.", r"\.?") for part in parts)


_KIND_PATTERNS: list[tuple[ColumnKind, re.Pattern[str]]] = [
    (kind, re.compile(rf"(?:{'|'.join(_phrase_regex(p) for p in phrases)}){_UNIT_SUFFIX}:?"))
    for kind, phrases in _SYNONYMS.items()
]

_ANCHOR_KINDS: frozenset[ColumnKind] = frozenset({"sku", "description"})
_VALUE_KINDS: frozenset[ColumnKind] = frozenset(
    {"quantity", "amount", "packages", "gross_weight", "net_weight"}
)
_ROW_START_KINDS: tuple[ColumnKind, ...] = ("quantity", "amount", "packages", "gross_weight", "net_weight")
_TOTAL_ROW = re.compile(r"^(grand\s+|sub-?\s*)?totals?\b|^say\b", re.IGNORECASE)
_SKU_SHAPE = re.compile(r"^(?=.*\d)[A-Za-z0-9][A-Za-z0-9\-_/.]{2,}$")
_HEADER_SUFFIX_WORD = re.compile(r"^[\(\[]?[A-Za-z$€/³0-9.]{1,6}[\)\]]?$")
_MAX_ROW_GAP_FACTOR = 2.6


@dataclass(slots=True)
class Column:
    kind: ColumnKind | None
    label: str
    x0: float
    x1: float
    left: float = float("-inf")
    right: float = float("inf")

    def unit_hint(self) -> Unit | None:
        """Unit stated in the header: "(KG)" wins, then trailing words; single letters like the
        G of "G.W." are abbreviations, not units."""
        bracketed = re.findall(r"[\(\[]([^\)\]]*)[\)\]]", self.label)
        outside = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", self.label)
        candidates = [t for group in bracketed for t in re.findall(r"[A-Za-z]+", group)]
        candidates += [t for t in reversed(re.findall(r"[A-Za-z]+", outside)) if len(t) > 1]
        for token in candidates:
            unit = known_unit(token)
            if unit is not None and token.lower() not in {"unit", "units"}:
                return unit
        return None


@dataclass(slots=True)
class _Row:
    page: int
    lines: list[Line]
    cells: dict[ColumnKind, list[Word]] = field(default_factory=dict)

    @property
    def words(self) -> list[Word]:
        return [w for line in self.lines for w in line.words]

    def text(self, kind: ColumnKind) -> str:
        return compact_text(" ".join(w.text for w in self.cells.get(kind, [])))


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
        open_columns = None if closed else columns
    return result


def find_header(lines: Sequence[Line]) -> tuple[list[Column], int] | None:
    for index, line in enumerate(lines):
        columns = header_columns(line)
        if columns is None:
            continue
        body_start = index + 1
        if body_start < len(lines) and _absorb_header_suffix(columns, line, lines[body_start]):
            body_start += 1
        _fit_boundaries_to_body(columns, _table_region(lines[body_start:]))
        return columns, body_start
    return None


def _table_region(lines: Sequence[Line]) -> list[Line]:
    region: list[Line] = []
    for line in lines:
        if region and line.y0 - region[-1].y1 > _MAX_ROW_GAP_FACTOR * region[-1].height:
            break
        region.append(line)
        if _TOTAL_ROW.match(line.text.strip()):
            break
    return region


def _fit_boundaries_to_body(columns: list[Column], body: Sequence[Line]) -> None:
    """Move each column boundary into the widest vertical whitespace channel of the body rows.

    Header labels are short and aligned differently from their values (left-aligned text,
    right-aligned numbers), so midpoints between labels misplace long descriptions. The body's
    own whitespace between neighbouring header centres is the reliable separator.
    """
    spans = [(w.x0, w.x1) for line in body for w in line.words]
    if not spans:
        return
    for left, right in pairwise(columns):
        lo, hi = (left.x0 + left.x1) / 2, (right.x0 + right.x1) / 2
        if hi - lo < 2:
            continue
        steps = int(hi - lo)
        coverage = [sum(1 for x0, x1 in spans if x0 <= lo + i <= x1) for i in range(steps + 1)]
        floor = min(coverage)
        best_run: tuple[int, int] | None = None
        run_start: int | None = None
        for i, count in enumerate([*coverage, floor + 1]):
            if count == floor and run_start is None:
                run_start = i
            elif count != floor and run_start is not None:
                if best_run is None or i - run_start > best_run[1] - best_run[0]:
                    best_run = (run_start, i)
                run_start = None
        if best_run is not None:
            boundary = lo + (best_run[0] + best_run[1] - 1) / 2
            left.right, right.left = boundary, boundary


def header_columns(line: Line) -> list[Column] | None:
    gap = max(3.5, line.height * 0.45)
    columns: list[Column] = []
    for chunk in split_segments(line, min_gap=gap):
        columns.extend(_segment_header_chunk(chunk.words))
    kinds = [c.kind for c in columns if c.kind is not None]
    recognised_words = sum(1 for c in columns if c.kind is not None)
    if (
        len(set(kinds)) < 3
        or len(kinds) != len(set(kinds))
        or recognised_words < 0.7 * len(columns)
        or not (_ANCHOR_KINDS & set(kinds))
        or not (_VALUE_KINDS & set(kinds))
    ):
        return None
    columns.sort(key=lambda c: c.x0)
    for left, right in pairwise(columns):
        boundary = (left.x1 + right.x0) / 2
        left.right, right.left = boundary, boundary
    return columns


def _segment_header_chunk(words: Sequence[Word]) -> list[Column]:
    columns: list[Column] = []
    start = 0
    while start < len(words):
        for end in range(len(words), start, -1):
            label = " ".join(w.text for w in words[start:end])
            kind = classify_header(label)
            if kind is not None and not _swallows_neighbour(kind, words[start:end]):
                columns.append(Column(kind, label, words[start].x0, words[end - 1].x1))
                start = end
                break
        else:
            word = words[start]
            columns.append(Column(None, word.text, word.x0, word.x1))
            start += 1
    return columns


def _swallows_neighbour(kind: ColumnKind, words: Sequence[Word]) -> bool:
    """True when a unit-style suffix is really the next column's own header ("Description CTNS")."""
    if len(words) < 2:
        return False
    tail_kind = classify_header(words[-1].text)
    return tail_kind is not None and tail_kind != kind


def classify_header(label: str) -> ColumnKind | None:
    normalized = re.sub(r"\s+", " ", label.strip().lower())
    for kind, pattern in _KIND_PATTERNS:
        if pattern.fullmatch(normalized):
            return kind
    return None


def _absorb_header_suffix(columns: list[Column], header: Line, candidate: Line) -> bool:
    """Fold a second header line holding only unit hints like "(KG)" or "(USD)" into the labels."""
    if candidate.y0 - header.y1 > header.height * 1.2:
        return False
    if not all(_HEADER_SUFFIX_WORD.match(w.text) and parse_decimal(w.text) is None for w in candidate.words):
        return False
    for word in candidate.words:
        column = _column_for(columns, word)
        column.label = f"{column.label} {word.text}"
    return True


def _column_for(columns: Sequence[Column], word: Word) -> Column:
    for column in columns:
        if column.left <= word.cx < column.right:
            return column
    return columns[-1]


def _bucket(columns: Sequence[Column], line: Line) -> dict[ColumnKind, list[Word]]:
    cells: dict[ColumnKind, list[Word]] = {}
    for word in line.words:
        column = _column_for(columns, word)
        if column.kind is not None:
            cells.setdefault(column.kind, []).append(word)
    return cells


def _is_row_start(cells: dict[ColumnKind, list[Word]]) -> bool:
    for kind in _ROW_START_KINDS:
        if kind in cells and parse_decimal(" ".join(w.text for w in cells[kind])) is not None:
            return True
    sku_words = cells.get("sku", [])
    return len(sku_words) == 1 and _SKU_SHAPE.match(sku_words[0].text) is not None


def _is_continuation(cells: dict[ColumnKind, list[Word]]) -> bool:
    return bool(cells) and set(cells) <= {"description", "sku"} and "description" in cells


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
    for line in lines:
        if previous is not None and line.y0 - previous.y1 > _MAX_ROW_GAP_FACTOR * previous.height:
            break
        if header_columns(line) is not None:
            break
        if _TOTAL_ROW.match(line.text.strip()) or any(_TOTAL_ROW.match(w.text) for w in line.words[:2]):
            _flush(row, columns, page, result)
            result.totals.extend(_totals(page, line, columns))
            return True

        cells = _bucket(columns, line)
        if _is_row_start(cells):
            _flush(row, columns, page, result)
            row = _Row(page=page.number, lines=[line], cells=cells)
            started = True
        elif started and row is not None and _is_continuation(cells):
            row.lines.append(line)
            for kind, words in cells.items():
                row.cells.setdefault(kind, []).extend(words)
        elif started:
            break
        else:
            continue
        previous = line
    _flush(row, columns, page, result)
    return False


def _flush(row: _Row | None, columns: Sequence[Column], page: PageLayout, result: TableResult) -> None:
    if row is None:
        return
    hints = {c.kind: c.unit_hint() for c in columns if c.kind is not None}
    quantity = _measure(row.text("quantity"), _explicit_unit(row.text("unit")) or hints.get("quantity"))
    packages = _packages(row.text("packages"), hints.get("packages"))
    sku = row.text("sku") or None
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


def _cell_text(cells: dict[ColumnKind, list[Word]], kind: ColumnKind) -> str:
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
    return fields


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
