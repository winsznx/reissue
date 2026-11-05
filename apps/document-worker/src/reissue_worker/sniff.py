"""Content-type detection from magic bytes. Client-supplied names and MIME headers are never trusted."""

from __future__ import annotations

import io
import zipfile

PDF = "application/pdf"
PNG = "image/png"
JPEG = "image/jpeg"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

ALLOWED_MIME = (PDF, PNG, JPEG, XLSX)


def sniff_mime(data: bytes) -> str | None:
    if data.startswith(b"%PDF-") or b"%PDF-" in data[:1024]:
        return PDF
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return PNG
    if data.startswith(b"\xff\xd8\xff"):
        return JPEG
    if data.startswith(b"PK\x03\x04") and _is_xlsx(data):
        return XLSX
    return None


def _is_xlsx(data: bytes) -> bool:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            return "xl/workbook.xml" in archive.namelist()
    except zipfile.BadZipFile:
        return False
