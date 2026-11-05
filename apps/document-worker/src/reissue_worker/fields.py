"""Labelled key-value fields ("Invoice No.: X", "Seller:" above a name block)."""

from __future__ import annotations

import re
from collections.abc import Sequence

from reissue_worker.layout import Line, PageLayout, Word, split_segments, union_bbox
from reissue_worker.models import ExtractedField, FieldPath, SourceSpan
from reissue_worker.normalize import Unit, compact_text, parse_date, parse_quantity
from reissue_worker.tables import page_parser

_NO = r"(?:no\.?|nr\.?|number|#)"


def _alternatives(*names: str) -> str:
    one = "|".join(names)
    return rf"(?:{one})(?:\s*/\s*(?:{one}))*"


_LABELS: list[tuple[FieldPath, str]] = [
    ("packing_list_number", rf"(?:packing\s+list|p\s*/\s*l|pl)\s*{_NO}"),
    ("invoice_number", rf"(?:commercial\s+)?(?:invoice|inv\.?)\s*{_NO}"),
    ("purchase_order", rf"(?:purchase\s+order(?:\s*{_NO})?|p\.?\s?o\.?\s*{_NO}|order\s*{_NO}|po)"),
    ("bl_number", rf"(?:b\s*/\s*l|bill\s+of\s+lading)\s*{_NO}"),
    ("awb_number", rf"(?:awb|air\s*way\s*bill)\s*{_NO}"),
    ("total_amount", r"(?:grand\s+)?total\s+(?:amount|value|invoice\s+value)(?:\s*\([a-z]{3}\))?"),
    ("total_quantity", r"total\s+(?:quantity|qty|pcs|pieces)(?:\s*\([a-z]+\))?"),
    ("total_packages", r"total\s+(?:packages|pkgs|cartons|ctns|no\.?\s+of\s+(?:packages|cartons|ctns))"),
    ("total_net_weight", r"total\s+(?:net\s+weight|n\.?\s?w\.?|net\s+wt\.?)(?:\s*\([a-z]+\))?"),
    ("total_gross_weight", r"total\s+(?:gross\s+weight|g\.?\s?w\.?|gross\s+wt\.?)(?:\s*\([a-z]+\))?"),
    ("total_cbm", r"total\s+(?:cbm|measurement|volume)(?:\s*\([a-z0-9³]+\))?"),
    ("document_date", r"(?:invoice\s+|packing\s+list\s+|document\s+|issue\s+)?date(?:\s+of\s+issue)?"),
    ("revision", r"(?:revision|rev\.?)(?:\s*" + _NO + r")?"),
    ("seller", _alternatives("seller", "shipper", "exporter", "vendor", "supplier")),
    ("buyer", _alternatives("buyer", "importer", "sold\\s+to", "bill\\s+to", "customer")),
    ("consignee", _alternatives("consignee", "ship\\s+to", "deliver\\s+to")),
    ("currency", r"currency"),
    (
        "incoterms",
        r"(?:incoterms?(?:\s*\d{4})?|terms\s+of\s+delivery|delivery\s+terms|trade\s+terms|price\s+terms|terms\s+of\s+sale)",
    ),
]

_LABEL_PATTERNS = [
    (path, re.compile(rf"^\s*{pattern}\s*(?P<sep>[:：#])?\s*(?P<value>.*)$", re.IGNORECASE))
    for path, pattern in _LABELS
]

_BLOCK_PATHS: frozenset[FieldPath] = frozenset({"seller", "buyer", "consignee"})
_COLONLESS_PATHS: frozenset[FieldPath] = frozenset({"revision"})
_CURRENCY = re.compile(r"\b(USD|EUR|GBP|CNY|RMB|JPY|HKD|CAD|AUD|CHF|SGD|INR|KRW|TWD)\b", re.IGNORECASE)
_REVISION = re.compile(r"^(?:no\.?\s*)?([A-Za-z]?\d+[A-Za-z]?|[A-Z])\b")
_TEXT_VALUE = re.compile(r"[A-Za-z0-9]")


def extract_fields(pages: Sequence[PageLayout], warnings: list[str]) -> list[ExtractedField]:
    found: dict[FieldPath, ExtractedField] = {}
    for page in pages:
        segments = [segment for line in page.lines for segment in split_segments(line)]
        for index, segment in enumerate(segments):
            match = _match_label(segment)
            if match is None:
                continue
            path, label_words, value_words, has_separator = match
            if not value_words:
                if not has_separator:
                    continue
                value_words = _value_below(segments, index, segment)
                if not value_words:
                    continue
            if path in found:
                continue
            field = _build_field(page, path, label_words, value_words, warnings)
            if field is not None:
                found[path] = field
    return list(found.values())


def _match_label(segment: Line) -> tuple[FieldPath, list[Word], list[Word], bool] | None:
    text = segment.text
    for path, pattern in _LABEL_PATTERNS:
        match = pattern.match(text)
        if match is None:
            continue
        has_separator = match.group("sep") is not None
        value_text = match.group("value").strip()
        if not has_separator and path not in _COLONLESS_PATHS and value_text:
            continue
        label_words, value_words = _split_words(
            segment.words, match.start("value") if value_text else len(text)
        )
        return path, label_words, value_words, has_separator
    return None


def _split_words(words: Sequence[Word], value_offset: int) -> tuple[list[Word], list[Word]]:
    label: list[Word] = []
    value: list[Word] = []
    cursor = 0
    for word in words:
        start = cursor
        cursor += len(word.text) + 1
        (value if start >= value_offset else label).append(word)
    return label, value


def _value_below(segments: Sequence[Line], index: int, label: Line) -> list[Word]:
    label_x0 = label.words[0].x0
    for candidate in segments[index + 1 :]:
        if candidate.y0 <= label.y1 - label.height * 0.3:
            continue
        if candidate.y0 - label.y1 > label.height * 1.8:
            return []
        if abs(candidate.words[0].x0 - label_x0) <= max(24.0, label.height * 2):
            if _match_label(candidate) is not None:
                return []
            return list(candidate.words)
    return []


def _build_field(
    page: PageLayout,
    path: FieldPath,
    label_words: list[Word],
    value_words: list[Word],
    warnings: list[str],
) -> ExtractedField | None:
    raw = compact_text(" ".join(w.text for w in value_words))
    normalized = normalize_field_value(path, raw)
    if normalized is None:
        warnings.append(f"page {page.number}: could not normalize {path} value {raw!r}")
        return None
    value, unit = normalized
    words = [*label_words, *value_words]
    quote = compact_text(" ".join(w.text for w in words))
    confidence = 0.95 if page.parser != "ocr" else 0.9 * min(w.confidence for w in words)
    return ExtractedField(
        path=path,
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


def normalize_field_value(path: FieldPath, raw: str) -> tuple[str, Unit | None] | None:
    """Normalize a raw field string. Returns (value, unit) or None when the raw text is not a valid value."""
    if not _TEXT_VALUE.search(raw):
        return None
    if path == "document_date":
        iso = parse_date(raw)
        return (iso, None) if iso else None
    if path in _NUMERIC_PATHS:
        parsed = parse_quantity(raw)
        if parsed is None:
            return None
        unit = None if path in ("total_amount", "total_cbm") else parsed.unit
        return parsed.value, unit
    if path == "currency":
        match = _CURRENCY.search(raw)
        return (match.group(1).upper(), None) if match else None
    if path == "revision":
        match = _REVISION.match(raw.strip())
        return (match.group(1), None) if match else None
    if path in _BLOCK_PATHS or path == "incoterms":
        return compact_text(raw).strip(" ,;"), None
    return compact_text(raw).strip(" ,;:"), None
