"""Content-based document classification and splitting of multi-document files into parts.

A printed title near the top of a page is the strongest signal; a title with an unrecognised
qualifier in front ("CANADA CUSTOMS INVOICE") counts for less and caps the confidence, and table
vocabulary is weaker supporting evidence. A filename hint is recorded but can only break an exact tie between
content candidates, so a misnamed file is still classified by what it contains.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import PurePosixPath

from reissue_worker.layout import PageLayout, split_segments
from reissue_worker.models import DocType

TITLE_WEIGHT = 10
BODY_TITLE_WEIGHT = 4
QUALIFIED_TITLE_WEIGHT = 4
QUALIFIED_TITLE_CONFIDENCE = 0.7
MIN_CONTENT_SCORE = 3
TITLE_ZONE = 0.3

_TITLES: dict[DocType, re.Pattern[str]] = {
    "COMMERCIAL_INVOICE": re.compile(r"(commercial|proforma|pro-forma|customs|tax)?\s*invoice"),
    "PACKING_LIST": re.compile(
        r"(packing|packaging)\s*(list|slip)|packing\s*(and|&|/)\s*weight\s*list|weight\s+list"
    ),
    "BILL_OF_LADING": re.compile(r"(ocean\s+|sea\s+|house\s+|master\s+)?bill\s+of\s+lading"),
    "AIR_WAYBILL": re.compile(r"(house\s+|master\s+)?air\s*way\s*bill"),
    "PURCHASE_ORDER": re.compile(r"purchase\s+order"),
    "CORRECTION_NOTE": re.compile(r"(correction|amendment)\s+(note|notice|letter)"),
}
_QUALIFIER = re.compile(r"^(?:[a-z]{2,}\s+){1,2}")
_TITLE_SUFFIX = re.compile(
    r"\s*(\(.*\)|-\s*(page|continued|copy|original|revis\w*).*|(page|rev\.?)\s*\d+.*)?$"
)

_BODY_SIGNALS: dict[DocType, tuple[str, ...]] = {
    "COMMERCIAL_INVOICE": (
        "unit price",
        "amount",
        "total amount",
        "total value",
        "say total",
        "bank",
        "swift",
    ),
    "PACKING_LIST": (
        "n.w.",
        "g.w.",
        "net weight",
        "gross weight",
        "net wt",
        "gross wt",
        "cbm",
        "pcs/ctn",
        "ctns",
    ),
    "BILL_OF_LADING": ("port of loading", "port of discharge", "vessel", "notify party", "container no"),
    "AIR_WAYBILL": ("airport of departure", "airport of destination", "chargeable weight", "flight"),
    "PURCHASE_ORDER": ("ship by", "requested delivery", "order date"),
    "CORRECTION_NOTE": ("corrected", "previously stated", "should read"),
}

_FILENAME_HINTS: dict[DocType, re.Pattern[str]] = {
    "COMMERCIAL_INVOICE": re.compile(r"invoice|\binv\b|\bci\b"),
    "PACKING_LIST": re.compile(r"packing|\bpl\b"),
    "BILL_OF_LADING": re.compile(r"lading|\bbl\b|\bbol\b"),
    "AIR_WAYBILL": re.compile(r"waybill|\bawb\b"),
    "PURCHASE_ORDER": re.compile(r"purchase|\bpo\b"),
}


@dataclass(slots=True)
class PageVerdict:
    page: int
    scores: Counter[DocType] = field(default_factory=Counter)
    title: DocType | None = None
    title_in_header: bool = False
    title_qualified: bool = False
    signals: list[str] = field(default_factory=list)


@dataclass(slots=True)
class PartSpan:
    doc_type: DocType
    page_start: int
    page_end: int
    confidence: float
    signals: list[str]


def classify_pages(pages: list[PageLayout], filename_hint: str | None) -> list[PartSpan]:
    hinted = filename_doc_type(filename_hint)
    verdicts = [_score_page(page) for page in pages]

    parts: list[PartSpan] = []
    for verdict in verdicts:
        doc_type, confidence = _resolve(verdict, hinted)
        current = parts[-1] if parts else None
        continues_current = current is not None and (
            doc_type == current.doc_type or (verdict.title is None and doc_type == "UNKNOWN")
        )
        if current is not None and continues_current:
            current.page_end = verdict.page
            current.signals.extend(f"p{verdict.page}: {s}" for s in verdict.signals)
            if verdict.title is None and doc_type == "UNKNOWN" and current.doc_type != "UNKNOWN":
                current.signals.append(f"p{verdict.page}: no title, treated as continuation")
            continue
        parts.append(
            PartSpan(
                doc_type=doc_type,
                page_start=verdict.page,
                page_end=verdict.page,
                confidence=confidence,
                signals=[f"p{verdict.page}: {s}" for s in verdict.signals],
            )
        )

    if hinted is not None and filename_hint is not None:
        name = PurePosixPath(filename_hint.replace("\\", "/")).name
        content_types = {part.doc_type for part in parts}
        relation = "agrees with content" if hinted in content_types else "ignored, content disagrees"
        for part in parts:
            part.signals.append(f"filename hint '{name}' suggests {hinted} ({relation})")
    return parts


def filename_doc_type(filename_hint: str | None) -> DocType | None:
    if not filename_hint:
        return None
    stem = PurePosixPath(filename_hint.replace("\\", "/")).stem.lower()
    stem = re.sub(r"[_\-.]+", " ", stem)
    for doc_type, pattern in _FILENAME_HINTS.items():
        if pattern.search(stem):
            return doc_type
    return None


def _score_page(page: PageLayout) -> PageVerdict:
    verdict = PageVerdict(page=page.number)
    header_limit = _header_limit(page)

    segments = [segment for line in page.lines for segment in split_segments(line)]
    for line in segments:
        normalized = _normalize(line.text)
        in_header = line.y0 <= header_limit
        for doc_type, pattern in _TITLES.items():
            if _is_title(pattern, normalized):
                weight, qualified = (TITLE_WEIGHT if in_header else BODY_TITLE_WEIGHT), False
            elif in_header and _is_qualified_title(pattern, line.text, normalized):
                weight, qualified = QUALIFIED_TITLE_WEIGHT, True
            else:
                continue
            if verdict.title is None or (in_header and not verdict.title_in_header):
                verdict.title, verdict.title_in_header = doc_type, in_header
                verdict.title_qualified = qualified
            verdict.scores[doc_type] += weight
            zone = "header" if in_header else "body"
            kind = "qualified title" if qualified else "title"
            verdict.signals.append(f"{kind} '{line.text.strip()}' in {zone} -> {doc_type} (+{weight})")

    text = _normalize(page.text)
    for doc_type, phrases in _BODY_SIGNALS.items():
        found = [phrase for phrase in phrases if _contains_phrase(text, phrase)]
        if found:
            verdict.scores[doc_type] += len(found)
            verdict.signals.append(f"vocabulary {found} -> {doc_type} (+{len(found)})")
    return verdict


def _resolve(verdict: PageVerdict, hinted: DocType | None) -> tuple[DocType, float]:
    ranked = verdict.scores.most_common()
    if not ranked or ranked[0][1] < MIN_CONTENT_SCORE:
        return "UNKNOWN", 0.5
    top_type, top_score = ranked[0]
    tied = [doc_type for doc_type, score in ranked if score == top_score]
    if len(tied) > 1:
        if hinted in tied:
            top_type = hinted
            verdict.signals.append(f"content tie {tied} broken by filename hint")
        else:
            return "UNKNOWN", 0.3
    runner_up = next((score for doc_type, score in ranked if doc_type != top_type), 0)
    if verdict.title == top_type and verdict.title_qualified:
        confidence = QUALIFIED_TITLE_CONFIDENCE
    elif verdict.title == top_type:
        confidence = 0.97 if verdict.title_in_header else 0.85
    else:
        confidence = min(0.75, 0.4 + 0.05 * top_score)
    margin_penalty = 0.1 if runner_up and top_score - runner_up < MIN_CONTENT_SCORE else 0.0
    return top_type, max(0.1, confidence - margin_penalty)


def _header_limit(page: PageLayout) -> float:
    if page.has_geometry:
        return page.height * TITLE_ZONE
    first_rows = sorted({line.y0 for line in page.lines})[:6]
    return first_rows[-1] if first_rows else 0.0


def _is_title(pattern: re.Pattern[str], normalized_line: str) -> bool:
    match = pattern.match(normalized_line)
    if match is None:
        return False
    return _TITLE_SUFFIX.fullmatch(normalized_line[match.end() :]) is not None


def _is_qualified_title(pattern: re.Pattern[str], text: str, normalized_line: str) -> bool:
    """A heading set in capitals or title case whose last words are a known title."""
    words = text.split()
    if not (text.isupper() or all(w[:1].isupper() for w in words if w[:1].isalpha())):
        return False
    qualifier = _QUALIFIER.match(normalized_line)
    return qualifier is not None and _is_title(pattern, normalized_line[qualifier.end() :])


def _normalize(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text.lower().replace(":", " ")).strip()


def _contains_phrase(text: str, phrase: str) -> bool:
    return re.search(rf"(?<![a-z]){re.escape(phrase)}(?![a-z])", text) is not None
