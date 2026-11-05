"""Extraction pipeline: sniff -> load pages -> classify/split -> fields + tables -> evidence."""

from __future__ import annotations

import hashlib
import time
from collections.abc import Iterator
from contextlib import contextmanager

from reissue_worker.classify import classify_pages
from reissue_worker.config import WORKER_VERSION, Settings
from reissue_worker.errors import EmptyDocument, PayloadTooLarge, UnsupportedMediaType
from reissue_worker.fields import extract_fields
from reissue_worker.layout import PageLayout
from reissue_worker.llm import FieldAssistant, assist_part
from reissue_worker.models import (
    REQUIRED_FIELDS,
    DocumentPart,
    ExtractedField,
    ExtractionResult,
    FieldPath,
    PageInfo,
)
from reissue_worker.pdf_text import check_page_limit, load_pages, open_document
from reissue_worker.proposals import DocumentAssistant
from reissue_worker.sniff import XLSX, sniff_mime
from reissue_worker.tables import extract_line_items
from reissue_worker.xlsx import load_sheets


class _Timer:
    def __init__(self) -> None:
        self.timings: dict[str, float] = {}

    @contextmanager
    def measure(self, name: str) -> Iterator[None]:
        started = time.perf_counter()
        try:
            yield
        finally:
            self.timings[name] = self.timings.get(name, 0.0) + (time.perf_counter() - started) * 1000


def detect_mime(data: bytes, settings: Settings) -> str:
    if len(data) > settings.max_upload_bytes:
        raise PayloadTooLarge(f"upload is {len(data)} bytes; limit is {settings.max_upload_bytes}")
    if not data:
        raise EmptyDocument("uploaded file is empty")
    mime = sniff_mime(data)
    if mime is None:
        raise UnsupportedMediaType("file content is not PDF, PNG, JPEG or XLSX")
    return mime


def extract_document(
    data: bytes,
    settings: Settings,
    filename_hint: str | None = None,
    assistant: FieldAssistant | None = None,
) -> ExtractionResult:
    timer = _Timer()
    warnings: list[str] = []
    started = time.perf_counter()
    mime = detect_mime(data, settings)

    with timer.measure("load"):
        pages = _load(data, mime, settings, warnings)

    with timer.measure("classify"):
        spans = classify_pages(pages, filename_hint)

    parts: list[DocumentPart] = []
    for span in spans:
        part_pages = [p for p in pages if span.page_start <= p.number <= span.page_end]
        part = DocumentPart(
            doc_type=span.doc_type,
            page_start=span.page_start,
            page_end=span.page_end,
            classification_confidence=span.confidence,
            classification_signals=span.signals,
        )
        if span.doc_type != "UNKNOWN":
            with timer.measure("fields"):
                fields = extract_fields(part_pages, warnings)
            with timer.measure("tables"):
                table = extract_line_items(part_pages)
            part.fields = _merge_fields(table.totals, fields)
            part.line_items = table.line_items
            part.missing_fields = _missing(part)
            if assistant is not None:
                with timer.measure("llm_assist"):
                    _assist(assistant, part, part_pages, warnings)
        parts.append(part)

    timer.timings["total"] = (time.perf_counter() - started) * 1000
    return ExtractionResult(
        worker_version=WORKER_VERSION,
        mime=mime,
        page_count=len(pages),
        pages=[_page_info(p) for p in pages],
        parts=parts,
        warnings=warnings,
        timings_ms=timer.timings,
    )


def _assist(
    assistant: FieldAssistant, part: DocumentPart, pages: list[PageLayout], warnings: list[str]
) -> None:
    """Ask the model only for gaps: missing required fields, or line items on a part whose
    document type carries them when the table parser found none."""
    want_line_items = part.doc_type in REQUIRED_FIELDS and not part.line_items
    wants_line_items = want_line_items and isinstance(assistant, DocumentAssistant)
    if not part.missing_fields and not wants_line_items:
        return
    fields, line_items = assist_part(
        assistant, part.doc_type, part.missing_fields, pages, warnings, want_line_items=want_line_items
    )
    part.fields.extend(fields)
    part.line_items.extend(line_items)
    part.missing_fields = _missing(part)


def _load(data: bytes, mime: str, settings: Settings, warnings: list[str]) -> list[PageLayout]:
    if mime == XLSX:
        return load_sheets(data, settings)
    with open_document(data, mime) as document:
        check_page_limit(document, settings)
        return load_pages(document, settings, warnings)


def _merge_fields(table_totals: list[ExtractedField], labelled: list[ExtractedField]) -> list[ExtractedField]:
    """Labelled values win; table totals fill paths the document never labels explicitly."""
    paths = {f.path for f in labelled}
    return [*labelled, *(f for f in table_totals if f.path not in paths)]


def _missing(part: DocumentPart) -> list[FieldPath]:
    present = {f.path for f in part.fields}
    return [path for path in REQUIRED_FIELDS.get(part.doc_type, ()) if path not in present]


def _page_info(page: PageLayout) -> PageInfo:
    text = page.text
    return PageInfo(
        page=page.number,
        width=page.width,
        height=page.height,
        text_chars=sum(1 for ch in text if not ch.isspace()),
        ocr=page.parser == "ocr",
        text_hash=f"sha256:{hashlib.sha256(text.encode()).hexdigest()}",
    )
