"""Tesseract fallback for pages without a usable text layer.

Word boxes come back in pixel space of the rendered raster and are scaled to PDF points so
OCR pages share one coordinate system with text pages.
"""

from __future__ import annotations

import math
import re
import shutil
from functools import cache

import pymupdf
import pytesseract
from PIL import Image

from reissue_worker.layout import Word


class OcrUnavailable(RuntimeError):
    pass


@cache
def tesseract_available() -> bool:
    if shutil.which(pytesseract.pytesseract.tesseract_cmd) is None:
        return False
    try:
        pytesseract.get_tesseract_version()
    except (pytesseract.TesseractNotFoundError, OSError):
        return False
    return True


_EDGE_NOISE = '_~—–|‘’`"«»¦'
_HAS_CONTENT = re.compile(r"[A-Za-z0-9#%$€]")


def clean_token(raw: str) -> str:
    """Drop scan specks OCR reads as glyphs: punctuation-only tokens and underscores or rules
    glued to word edges ("_LL-WAL-207__—" -> "LL-WAL-207")."""
    token = raw.strip().strip(_EDGE_NOISE).strip()
    if token.startswith("-") and not token[1:2].isdigit():
        token = token.lstrip("-")
    token = token.rstrip("-").strip(_EDGE_NOISE)
    return token if _HAS_CONTENT.search(token) else ""


def effective_dpi(page: pymupdf.Page, dpi: int, max_pixels: int) -> float:
    width_in, height_in = page.rect.width / 72, page.rect.height / 72
    pixels_at_dpi = width_in * height_in * dpi * dpi
    if pixels_at_dpi <= max_pixels:
        return float(dpi)
    return math.sqrt(max_pixels / (width_in * height_in))


def ocr_page(page: pymupdf.Page, dpi: int, max_pixels: int) -> list[Word]:
    if not tesseract_available():
        raise OcrUnavailable("tesseract binary not found")
    render_dpi = effective_dpi(page, dpi, max_pixels)
    pixmap = page.get_pixmap(dpi=round(render_dpi), colorspace=pymupdf.csGRAY, alpha=False)
    image = Image.frombytes("L", (pixmap.width, pixmap.height), pixmap.samples)
    scale_x = page.rect.width / pixmap.width
    scale_y = page.rect.height / pixmap.height

    data = pytesseract.image_to_data(
        image,
        lang="eng",
        config="--psm 3",
        output_type=pytesseract.Output.DICT,
    )
    words: list[Word] = []
    for text, left, top, width, height, conf in zip(
        data["text"], data["left"], data["top"], data["width"], data["height"], data["conf"], strict=True
    ):
        token = clean_token(str(text))
        confidence = float(conf)
        if not token or confidence < 0:
            continue
        words.append(
            Word(
                text=token,
                x0=left * scale_x,
                y0=top * scale_y,
                x1=(left + width) * scale_x,
                y1=(top + height) * scale_y,
                confidence=confidence / 100,
            )
        )
    return words
