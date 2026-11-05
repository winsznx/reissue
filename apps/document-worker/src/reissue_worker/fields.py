"""Labelled key-value fields ("Invoice No.: X", "Seller:" above a name block, "Ship to" beside one)."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass

from reissue_worker.layout import Line, PageLayout, Word, split_segments, union_bbox
from reissue_worker.models import ExtractedField, FieldPath, SourceSpan
from reissue_worker.normalize import (
    CURRENCY_CODES,
    Unit,
    compact_text,
    known_unit,
    parse_date,
    parse_quantity,
)
from reissue_worker.tables import page_parser

_NO = r"(?:no\.?|nr\.?|nbr\.?|number|n[°º]\.?|#)"
_PACKAGE_NOUN = r"(?:packages|pkgs|cartons|ctns)"


def _alternatives(*names: str) -> str:
    one = "|".join(names)
    return rf"(?:{one})(?:\s*/\s*(?:{one}))*"


_LABELS: list[tuple[FieldPath, str]] = [
    ("packing_list_number", rf"(?:packing\s+list|p\s*/\s*l|pl)\s*{_NO}"),
    ("invoice_number", rf"(?:commercial\s+)?(?:invoice|inv\.?)\s*{_NO}"),
    (
        "purchase_order",
        _alternatives(
            rf"purchase\s+order(?:\s*{_NO})?",
            rf"p\.?\s?o\.?\s*{_NO}",
            rf"(?:customer\s+|your\s+)?order\s*{_NO}",
            r"customer\s+po",
            "po",
        ),
    ),
    ("bl_number", rf"(?:b\s*/\s*l|bill\s+of\s+lading)\s*{_NO}"),
    ("awb_number", rf"(?:awb|air\s*way\s*bill)\s*{_NO}"),
    (
        "total_amount",
        r"(?:(?:grand|overall|invoice)\s+total"
        r"|(?:grand\s+)?total\s+(?:amount|value|invoice\s+value)(?:\s+of\s+(?:all\s+)?goods)?)"
        r"(?:\s*\([a-z]{3}\))?",
    ),
    ("total_quantity", r"total\s+(?:quantity|qty|pcs|pieces)(?:\s*\([a-z]+\))?"),
    (
        "total_packages",
        rf"(?:total\s+(?:number\s+of\s+)?{_PACKAGE_NOUN}|(?:total\s+)?(?:no\.?|number)\s+of\s+{_PACKAGE_NOUN}"
        rf"|{_PACKAGE_NOUN}\s+in\s+(?:this\s+)?shipment)",
    ),
    ("total_net_weight", r"total\s+(?:net\s+weight|n\.?\s?w\.?|net\s+wt\.?)(?:\s*\([a-z]+\))?"),
    ("total_gross_weight", r"total\s+(?:gross\s+weight|g\.?\s?w\.?|gross\s+wt\.?)(?:\s*\([a-z]+\))?"),
    ("total_cbm", r"total\s+(?:cbm|measurement|volume)(?:\s*\([a-z0-9³]+\))?"),
    ("document_date", r"(?:invoice\s+|packing\s+list\s+|document\s+|issue\s+)?date(?:\s+of\s+issue)?"),
    ("revision", r"(?:revision|rev\.?)(?:\s*" + _NO + r")?"),
    (
        "seller",
        _alternatives("seller", "shipper", "exporter", "vendor", "supplier", "manufacturer", r"ship\s+from"),
    ),
    (
        "buyer",
        _alternatives(
            "buyer",
            r"importer\s+of\s+record",
            "importer",
            r"sold\s+to",
            r"bill\s+to",
            r"invoice\s+address",
            r"billing\s+address",
            "purchaser",
            "customer",
        ),
    ),
    ("consignee", _alternatives("consignee", r"ship\s+to", r"deliver\s+to", r"delivery\s+address")),
    ("currency", r"currency"),
    (
        "incoterms",
        r"(?:inco\s*-?\s*terms?(?:\s*\d{4})?|terms\s+of\s+delivery|delivery\s+terms|trade\s+terms"
        r"|price\s+terms|terms\s+of\s+sale)",
    ),
]

_LABEL_PATTERNS = [
    (path, re.compile(rf"^\s*{pattern}(?![a-z])\s*(?P<sep>[:：#])?\s*(?P<value>.*)$", re.IGNORECASE))
    for path, pattern in _LABELS
]

_BLOCK_PATHS: frozenset[FieldPath] = frozenset({"seller", "buyer", "consignee"})
_IDENTIFIER_PATHS: frozenset[FieldPath] = frozenset(
    {"invoice_number", "packing_list_number", "purchase_order", "bl_number", "awb_number"}
)
_NUMERIC_PATHS: frozenset[FieldPath] = frozenset(
    {
        "total_amount",
        "total_quantity",
        "total_packages",
        "total_net_weight",
        "total_gross_weight",
        "total_cbm",
    }
)
_UNITLESS_PATHS: frozenset[FieldPath] = frozenset({"total_amount", "total_cbm"})
_CURRENCY = re.compile(rf"\b({'|'.join(CURRENCY_CODES)})\b", re.IGNORECASE)
_REVISION = re.compile(r"^(?:no\.?\s*)?([A-Za-z]?\d+[A-Za-z]?|[A-Z])\b")
_TEXT_VALUE = re.compile(r"[A-Za-z0-9]")
_DIGIT = re.compile(r"\d")
_NUMBER_PREFIX = re.compile(r"^(?:n[°º]\.?|no\.|#)\s*", re.IGNORECASE)
_BRACKETED = re.compile(r"[\(\[]([^\)\]]*)[\)\]]")


@dataclass(frozen=True, slots=True)
class _LabelMatch:
    path: FieldPath
    label: list[Word]
    value: list[Word]
    has_separator: bool


def extract_fields(pages: Sequence[PageLayout], warnings: list[str]) -> list[ExtractedField]:
    found: dict[FieldPath, ExtractedField] = {}
    for page in pages:
        rows = [(n, segment) for n, line in enumerate(page.lines) for segment in split_segments(line)]
        segments = [segment for _, segment in rows]
        for index, (line_number, segment) in enumerate(rows):
            match = _match_label(segment)
            if match is None or match.path in found:
                continue
            value_words, paired = match.value, False
            if not value_words:
                value_words, paired = _value_beside(rows, index, line_number), True
            if not value_words and match.has_separator:
                value_words, paired = _value_below(segments, index, segment), False
            if not value_words:
                continue
            field = _build_field(page, match, value_words, warnings, quiet=paired and not match.has_separator)
            if field is not None and (not paired or _plausible_pairing(field)):
                found[match.path] = field
    return list(found.values())


def _match_label(segment: Line) -> _LabelMatch | None:
    text = segment.text
    for path, pattern in _LABEL_PATTERNS:
        match = pattern.match(text)
        if match is None:
            continue
        has_separator = match.group("sep") is not None
        value_text = match.group("value").strip()
        if not _strip_markers(value_text).strip():
            value_text = ""
        if not has_separator and value_text and not _inline_value_allowed(path, value_text):
            continue
        label_words, value_words = _split_words(
            segment.words, match.start("value") if value_text else len(text)
        )
        return _LabelMatch(path, label_words, value_words, has_separator)
    return None


def _inline_value_allowed(path: FieldPath, value: str) -> bool:
    """A label without a colon may still carry its value on the same run of words ("Invoice No. FP123",
    "Total gross weight (kg) 11.8") when the value has the unmistakable shape of that field."""
    if path == "revision":
        return True
    if path in _IDENTIFIER_PATHS:
        return len(value.split()) == 1 and _DIGIT.search(value) is not None
    if path in _NUMERIC_PATHS:
        return len(value.split()) <= 3 and parse_quantity(value) is not None
    if path == "document_date":
        return parse_date(value) is not None
    return False


def _plausible_pairing(field: ExtractedField) -> bool:
    """A value taken from the neighbouring cell must look like the field it is paired with."""
    if field.path in _IDENTIFIER_PATHS:
        return _DIGIT.search(field.raw) is not None
    return True


def _split_words(words: Sequence[Word], value_offset: int) -> tuple[list[Word], list[Word]]:
    label: list[Word] = []
    value: list[Word] = []
    cursor = 0
    for word in words:
        start = cursor
        cursor += len(word.text) + 1
        if start < value_offset:
            label.append(word)
        elif _strip_markers(word.text):
            value.append(word)
    return label, value


def _value_beside(rows: Sequence[tuple[int, Line]], index: int, line_number: int) -> list[Word]:
    if index + 1 >= len(rows):
        return []
    next_line, candidate = rows[index + 1]
    label = rows[index][1]
    if next_line != line_number or not _same_text_size(label, candidate) or _looks_like_label(candidate):
        return []
    return [w for w in candidate.words if _strip_markers(w.text)]


def _same_text_size(label: Line, candidate: Line) -> bool:
    ratio = candidate.height / label.height if label.height else 0.0
    return 0.6 <= ratio <= 1.6 and abs(candidate.y0 - label.y0) <= 0.6 * label.height


def _looks_like_label(candidate: Line) -> bool:
    return candidate.text.rstrip().endswith((":", "：")) or _match_label(candidate) is not None


def _value_below(segments: Sequence[Line], index: int, label: Line) -> list[Word]:
    label_x0 = label.words[0].x0
    for candidate in segments[index + 1 :]:
        if candidate.y0 <= label.y1 - label.height * 0.3:
            continue
        if candidate.y0 - label.y1 > label.height * 1.8:
            return []
        if abs(candidate.words[0].x0 - label_x0) <= max(24.0, label.height * 2):
            if _looks_like_label(candidate):
                return []
            return list(candidate.words)
    return []


def _build_field(
    page: PageLayout,
    match: _LabelMatch,
    value_words: list[Word],
    warnings: list[str],
    *,
    quiet: bool,
) -> ExtractedField | None:
    raw = compact_text(" ".join(w.text for w in value_words))
    normalized = normalize_field_value(match.path, raw)
    if normalized is None:
        if not quiet:
            warnings.append(f"page {page.number}: could not normalize {match.path} value {raw!r}")
        return None
    value, unit = normalized
    if unit is None and match.path in _NUMERIC_PATHS and match.path not in _UNITLESS_PATHS:
        unit = _label_unit(match.path, match.label)
    words = [*match.label, *value_words]
    quote = compact_text(" ".join(w.text for w in words))
    confidence = 0.95 if page.parser != "ocr" else 0.9 * min(w.confidence for w in words)
    return ExtractedField(
        path=match.path,
        raw=raw,
        value=value,
        unit=unit,
        source=SourceSpan(
            page=page.number,
            bbox=union_bbox(words) if page.has_geometry else None,
            quote=quote,
            parser=page_parser(page, table=False),
            confidence=confidence,
        ),
    )


def _label_unit(path: FieldPath, label: Sequence[Word]) -> Unit | None:
    """Unit printed in the label itself: "Total gross weight (kg)", or the noun of "Cartons in shipment"."""
    text = " ".join(w.text for w in label)
    candidates = _BRACKETED.findall(text)
    if path == "total_packages":
        candidates += re.findall(r"[A-Za-z]+", text)
    for candidate in candidates:
        unit = known_unit(candidate)
        if unit is not None:
            return unit
    return None


def _strip_markers(text: str) -> str:
    """Drop footnote markers such as ❹ or ² that forms print next to labels and values."""
    return "".join(ch for ch in text if unicodedata.category(ch) != "No")


def normalize_field_value(path: FieldPath, raw: str) -> tuple[str, Unit | None] | None:
    """Normalize a raw field string. Returns (value, unit) or None when the raw text is not a valid value."""
    raw = compact_text(_strip_markers(raw))
    if not _TEXT_VALUE.search(raw):
        return None
    if path == "document_date":
        iso = parse_date(raw)
        return (iso, None) if iso else None
    if path in _NUMERIC_PATHS:
        parsed = parse_quantity(raw)
        if parsed is None:
            return None
        unit = None if path in _UNITLESS_PATHS else parsed.unit
        return parsed.value, unit
    if path == "currency":
        match = _CURRENCY.search(raw)
        return (match.group(1).upper(), None) if match else None
    if path == "revision":
        match = _REVISION.match(raw.strip())
        return (match.group(1), None) if match else None
    if path in _BLOCK_PATHS or path == "incoterms":
        return raw.strip(" ,;"), None
    if path in _IDENTIFIER_PATHS:
        identifier = _NUMBER_PREFIX.sub("", raw).strip(" ,;:")
        return (identifier, None) if identifier else None
    return raw.strip(" ,;:"), None
