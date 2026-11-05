"""PDF and image loading: text-layer words with coordinates, falling back to OCR per page."""

from __future__ import annotations

import logging

import pymupdf

from reissue_worker.config import Settings
from reissue_worker.errors import CorruptDocument, EmptyDocument, TooManyPages
from reissue_worker.layout import PageLayout, Word
from reissue_worker.ocr import OcrUnavailable, ocr_page
from reissue_worker.sniff import JPEG, PDF, PNG

logger = logging.getLogger(__name__)

_IMAGE_FILETYPES = {PNG: "png", JPEG: "jpeg"}
PARSE_ERRORS: tuple[type[Exception], ...] = (RuntimeError, ValueError, pymupdf.mupdf.FzErrorBase)
OCR_ERRORS: tuple[type[Exception], ...] = (*PARSE_ERRORS, OSError)


def open_document(data: bytes, mime: str) -> pymupdf.Document:
    """Open PDF bytes, or wrap a raster image as a one-page PDF so both share one pipeline."""
    try:
        if mime == PDF:
            document = pymupdf.open(stream=data, filetype="pdf")
        else:
            with pymupdf.open(stream=data, filetype=_IMAGE_FILETYPES[mime]) as image:
                document = pymupdf.open(stream=image.convert_to_pdf(), filetype="pdf")
    except PARSE_ERRORS as exc:
        raise CorruptDocument(f"could not parse {mime} document: {exc}") from exc
    if document.needs_pass:
        document.close()
        raise CorruptDocument("document is password protected")
    if document.page_count == 0:
        document.close()
        raise EmptyDocument("document has no pages")
    return document


def check_page_limit(document: pymupdf.Document, settings: Settings) -> None:
    if document.page_count > settings.max_pages:
        raise TooManyPages(f"document has {document.page_count} pages; limit is {settings.max_pages}")


def load_pages(document: pymupdf.Document, settings: Settings, warnings: list[str]) -> list[PageLayout]:
    layouts: list[PageLayout] = []
    for index in range(document.page_count):
        number = index + 1
        try:
            page = document.load_page(index)
        except PARSE_ERRORS as exc:
            raise CorruptDocument(f"page {number} could not be loaded: {exc}") from exc
        try:
            words = _text_words(page)
        except PARSE_ERRORS as exc:
            warnings.append(f"page {number}: text layer unreadable ({exc}); trying OCR")
            words = []

        if sum(len(w.text) for w in words) >= settings.ocr_min_chars:
            layouts.append(PageLayout(number, page.rect.width, page.rect.height, words, "pdf_text"))
            continue

        try:
            ocr_words = ocr_page(page, settings.ocr_dpi, settings.ocr_max_pixels)
        except OcrUnavailable:
            warnings.append(f"page {number}: no text layer and OCR is unavailable on this worker")
            layouts.append(PageLayout(number, page.rect.width, page.rect.height, words, "pdf_text"))
            continue
        except OCR_ERRORS as exc:
            logger.exception("OCR failed on page %d", number)
            warnings.append(f"page {number}: OCR failed ({type(exc).__name__})")
            layouts.append(PageLayout(number, page.rect.width, page.rect.height, words, "pdf_text"))
            continue
        layouts.append(PageLayout(number, page.rect.width, page.rect.height, ocr_words, "ocr"))
    return layouts


def _text_words(page: pymupdf.Page) -> list[Word]:
    to_display = page.rotation_matrix
    words: list[Word] = []
    for x0, y0, x1, y1, text, *_ in page.get_text("words", sort=True):
        token = str(text).strip()
        if not token:
            continue
        rect = pymupdf.Rect(x0, y0, x1, y1)
        if page.rotation:
            rect = rect * to_display
        words.append(Word(token, rect.x0, rect.y0, rect.x1, rect.y1))
    return words


def render_page_png(document: pymupdf.Document, page_number: int, scale: float = 2.0) -> bytes:
    page = document.load_page(page_number - 1)
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
    png: bytes = pixmap.tobytes("png")
    return png
