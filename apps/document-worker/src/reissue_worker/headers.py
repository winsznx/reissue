"""Table header recognition: column-name synonyms, stacked multi-line headers and column x-ranges.

A header is one line of column names, optionally followed by a line of unit hints, or a block of
up to four stacked lines whose words are folded into the columns of the widest line. Columns we
recognise but do not report (HS code, origin, barcode, ordered quantity) are "aux": they claim
their x-range so stray text is not misread, and count towards recognising the header.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass, field
from itertools import pairwise
from typing import Literal

from reissue_worker.layout import Line, Word, split_segments
from reissue_worker.normalize import Unit, known_unit, parse_decimal

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
    "currency",
    "aux",
]

_SYNONYMS: dict[ColumnKind, tuple[str, ...]] = {
    "pieces_per_package": (
        "pcs/ctn",
        "pcs per ctn",
        "qty/ctn",
        "qty per ctn",
        "pcs/carton",
        "pcs per carton",
        "qty per carton",
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
        "net mass",
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
        "gross mass",
        "total g.w.",
        "total gross weight",
    ),
    "cbm": ("cbm", "measurement", "meas", "meas.", "volume", "m3", "m³", "total cbm"),
    "unit_price": (
        "unit price",
        "price",
        "rate",
        "unit cost",
        "price/unit",
        "price per unit",
        "u/price",
        "unit value",
        "net price",
        "net price/u",
        "price/u",
    ),
    "amount": (
        "amount",
        "total",
        "value",
        "total amount",
        "line total",
        "total value",
        "ext. amount",
        "extended value",
        "total price",
        "tot price",
        "tot. price",
        "tot. value",
    ),
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
        "number of packages",
        "number of cartons",
        "carton qty",
        "carton quantity",
        "qty of ctns",
        "pallets",
    ),
    "quantity": (
        "qty",
        "q'ty",
        "quantity",
        "pcs",
        "pieces",
        "total qty",
        "total pcs",
        "qty pcs",
        "units",
        "product quantity",
    ),
    "unit": ("unit", "uom", "u/m", "u.o.m."),
    "currency": ("currency", "curr", "curr.", "ccy"),
    "sku": (
        "sku",
        "sku / item id",
        "item id",
        "item ref",
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
    "aux": (
        "hs",
        "hs code",
        "h.s. code",
        "hs-code",
        "hts",
        "hts code",
        "tariff code",
        "commodity code",
        "origin",
        "country of origin",
        "coo",
        "barcode",
        "barcode (gtin)",
        "gtin",
        "ean",
        "upc",
        "lot",
        "batch",
        "lot / batch",
        "serial",
        "serial no",
        "serial number",
        "material",
        "material content",
        "composition",
        "dimensions",
        "remarks",
        "notes",
        "marks",
        "po",
        "po#",
        "po #",
        "po no",
    ),
}

_UNIT_SUFFIX = r"(?:\s*[\(\[][^\)\]]{0,12}[\)\]]|\s+(?:kgs?|lbs?|pcs|usd|eur|cny|rmb|m3|cbm|ctns))?"


def _phrase_regex(phrase: str) -> str:
    parts = re.escape(phrase).replace(r"\ ", " ").split(" ")
    return r"\s*".join(part.replace(r"\.", r"\.?") for part in parts)


_KIND_PATTERNS: list[tuple[ColumnKind, re.Pattern[str]]] = [
    (kind, re.compile(rf"(?:{'|'.join(_phrase_regex(p) for p in phrases)}){_UNIT_SUFFIX}:?"))
    for kind, phrases in _SYNONYMS.items()
]

_EXACT_PHRASE = re.compile(
    "|".join(_phrase_regex(p) for phrases in _SYNONYMS.values() for p in phrases if " " in p)
)

ANCHOR_KINDS: frozenset[ColumnKind] = frozenset({"sku", "description"})
VALUE_KINDS: frozenset[ColumnKind] = frozenset(
    {"quantity", "amount", "packages", "gross_weight", "net_weight"}
)
UNREPORTED_KINDS: frozenset[ColumnKind] = frozenset({"aux", "currency"})
TOTAL_ROW = re.compile(r"^(grand\s+|sub-?\s*)?totals?\b|^say\b", re.IGNORECASE)
_HEADER_SUFFIX_WORD = re.compile(r"^[\(\[]?[A-Za-z$€/³0-9.]{1,6}[\)\]]?$")
_NUMERIC_WORD = re.compile(r"^[-+$€£]?\d[\d.,]*%?$")
_WEIGHT_WORDS = frozenset({"weight", "wt", "kg", "kgs", "lb", "lbs", "mass"})
_QUANTITY_WORDS = frozenset({"qty", "quantity", "pcs", "pieces", "units"})
_PACKAGE_WORDS = frozenset({"carton", "cartons", "ctn", "ctns", "package", "packages", "pkg", "pkgs"})
_MAX_HEADER_LINES = 4
MAX_ROW_GAP_FACTOR = 2.6


@dataclass(slots=True)
class Column:
    kind: ColumnKind | None
    label: str
    x0: float
    x1: float
    left: float = float("-inf")
    right: float = float("inf")
    words: list[Word] = field(default_factory=list)

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


def find_header(lines: Sequence[Line]) -> tuple[list[Column], int] | None:
    for index, line in enumerate(lines):
        single = header_columns(line)
        body_start = index + 1
        if (
            single is not None
            and body_start < len(lines)
            and _absorb_header_suffix(single, line, lines[body_start])
        ):
            return _fitted(single, lines, body_start + 1)
        block = _header_block(lines, index)
        stacked = _stacked_columns(block) if len(block) > 1 else None
        if stacked is not None and (single is None or _real_kinds(stacked) >= _real_kinds(single)):
            return _fitted(stacked, lines, index + len(block))
        if single is not None:
            return _fitted(single, lines, body_start)
    return None


def header_columns(line: Line) -> list[Column] | None:
    columns: list[Column] = []
    for chunk in split_segments(line, min_gap=_header_gap(line)):
        columns.extend(_segment_header_chunk(chunk.words))
    return _validated(columns)


def classify_header(label: str) -> ColumnKind | None:
    normalized = _normalize_label(label)
    for kind, pattern in _KIND_PATTERNS:
        if pattern.fullmatch(normalized):
            return kind
    return None


def column_for(columns: Sequence[Column], word: Word) -> Column:
    for column in columns:
        if column.left <= word.cx < column.right:
            return column
    return columns[-1]


def _normalize_label(label: str) -> str:
    """Lowercase, collapse spaces and drop footnote markers such as ❺ or ¹ that forms print beside labels."""
    visible = "".join(ch for ch in label if unicodedata.category(ch) != "No")
    return re.sub(r"\s+", " ", visible.strip().lower())


def _keyword_kind(label: str) -> ColumnKind | None:
    """Classify multi-word labels assembled from stacked header lines ("QTY SHIPPED (TOTAL)", "Kg (net)")."""
    words = set(re.findall(r"[a-z]+", _normalize_label(label)))
    if not words:
        return None
    if words & {"backordered", "backorder"}:
        return "aux"
    if words & {"shipped", "delivered", "dispatched"}:
        return "quantity"
    if words & _WEIGHT_WORDS:
        if "net" in words:
            return "net_weight"
        if "gross" in words:
            return "gross_weight"
    if words & _QUANTITY_WORDS:
        if "ordered" in words:
            return "aux"
        if words & _PACKAGE_WORDS:
            return "aux" if words & {"in", "per", "this"} else "packages"
        return "quantity"
    if words & {"hs", "hts", "tariff", "gtin", "barcode", "serial", "lot", "batch", "dimensions", "origin"}:
        return "aux"
    if "sku" in words:
        return "sku"
    return None


def _validated(columns: list[Column]) -> list[Column] | None:
    kinds = [c.kind for c in columns if c.kind is not None and c.kind not in UNREPORTED_KINDS]
    recognised = sum(1 for c in columns if c.kind is not None)
    if (
        len(set(kinds)) < 3
        or len(kinds) != len(set(kinds))
        or recognised < 0.7 * len(columns)
        or not (ANCHOR_KINDS & set(kinds))
        or not (VALUE_KINDS & set(kinds))
    ):
        return None
    columns.sort(key=lambda c: c.x0)
    for left, right in pairwise(columns):
        boundary = (left.x1 + right.x0) / 2
        left.right, right.left = boundary, boundary
    return columns


def _real_kinds(columns: Sequence[Column]) -> int:
    return len({c.kind for c in columns if c.kind is not None and c.kind not in UNREPORTED_KINDS})


def _header_gap(line: Line) -> float:
    return max(3.5, line.height * 0.45)


def _segment_header_chunk(words: Sequence[Word]) -> list[Column]:
    columns: list[Column] = []
    start = 0
    while start < len(words):
        for end in range(len(words), start, -1):
            label = " ".join(w.text for w in words[start:end])
            kind = classify_header(label)
            if kind is not None and not _swallows_neighbour(kind, words[start:end]):
                columns.append(
                    Column(kind, label, words[start].x0, words[end - 1].x1, words=[*words[start:end]])
                )
                start = end
                break
        else:
            word = words[start]
            columns.append(Column(None, word.text, word.x0, word.x1, words=[word]))
            start += 1
    return columns


def _swallows_neighbour(kind: ColumnKind, words: Sequence[Word]) -> bool:
    """True when a unit-style suffix is really the next column's own header ("Description CTNS").
    A label that is itself a known phrase ("Unit value") is one column."""
    if len(words) < 2 or _EXACT_PHRASE.fullmatch(_normalize_label(" ".join(w.text for w in words))):
        return False
    tail_kind = classify_header(words[-1].text)
    return tail_kind is not None and tail_kind != kind


def _header_block(lines: Sequence[Line], start: int) -> list[Line]:
    block: list[Line] = []
    for line in lines[start : start + _MAX_HEADER_LINES]:
        if any(_NUMERIC_WORD.match(w.text) for w in line.words):
            break
        if block and line.y0 - block[-1].y1 > 0.8 * min(line.height, block[-1].height):
            break
        block.append(line)
    return block


def _stacked_columns(block: Sequence[Line]) -> list[Column] | None:
    """Fold the words of every header line into the column cells of the line with the most cells."""
    chunked = [split_segments(line, min_gap=_header_gap(line)) for line in block]
    base_index = max(range(len(block)), key=lambda i: (len(chunked[i]), i))
    cells: list[list[tuple[int, Word]]] = [[(base_index, w) for w in c.words] for c in chunked[base_index]]
    stray: list[Column] = []
    for line_index, chunks in enumerate(chunked):
        if line_index == base_index:
            continue
        for word in (w for chunk in chunks for w in chunk.words):
            target = _best_overlap(chunked[base_index], word)
            if target is None:
                stray.append(Column(classify_header(word.text), word.text, word.x0, word.x1, words=[word]))
            else:
                cells[target].append((line_index, word))

    columns: list[Column] = []
    for base_chunk, cell in zip(chunked[base_index], cells, strict=True):
        ordered = [w for _, w in sorted(cell, key=lambda item: (item[0], item[1].x0))]
        label = " ".join(w.text for w in ordered)
        kind = classify_header(label) or _keyword_kind(label)
        if kind is None:
            columns.extend(_segment_header_chunk(base_chunk.words))
            continue
        columns.append(
            Column(kind, label, min(w.x0 for w in ordered), max(w.x1 for w in ordered), words=ordered)
        )
    return _validated([*columns, *stray])


def _best_overlap(chunks: Sequence[Line], word: Word) -> int | None:
    best: int | None = None
    best_overlap = 0.0
    for index, chunk in enumerate(chunks):
        overlap = min(word.x1, chunk.words[-1].x1) - max(word.x0, chunk.words[0].x0)
        if overlap > best_overlap:
            best, best_overlap = index, overlap
    return best


def _absorb_header_suffix(columns: list[Column], header: Line, candidate: Line) -> bool:
    """Fold a second header line holding only unit hints like "(KG)" or "(USD)" into the labels."""
    if candidate.y0 - header.y1 > header.height * 1.2:
        return False
    if not all(_HEADER_SUFFIX_WORD.match(w.text) and parse_decimal(w.text) is None for w in candidate.words):
        return False
    for word in candidate.words:
        column = column_for(columns, word)
        column.label = f"{column.label} {word.text}"
        column.words.append(word)
    return True


def _fitted(columns: list[Column], lines: Sequence[Line], body_start: int) -> tuple[list[Column], int]:
    _fit_boundaries_to_body(columns, _table_region(lines[body_start:]))
    return columns, body_start


def is_total_line(line: Line) -> bool:
    return TOTAL_ROW.match(line.text.strip()) is not None


def _table_region(lines: Sequence[Line]) -> list[Line]:
    region: list[Line] = []
    for line in lines:
        if region and line.y0 - region[-1].y1 > MAX_ROW_GAP_FACTOR * region[-1].height:
            break
        region.append(line)
        if is_total_line(line):
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
