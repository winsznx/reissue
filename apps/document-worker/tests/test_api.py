from __future__ import annotations

import io
import re
import zipfile
from typing import Any

from fastapi.testclient import TestClient
from PIL import Image

from reissue_worker.api import create_app
from reissue_worker.config import Settings
from support import fixture_bytes

DECIMAL = re.compile(r"^-?\d+(\.\d+)?$")
UNITS = {"pcs", "carton", "kg", "g", "lb", "pallet", "set", "pair", "m", "unknown"}
PARSERS = {"pdf_text", "pdf_table", "ocr", "spreadsheet", "llm_verified", "human"}


def post(client: TestClient, content: bytes, filename: str = "upload.bin", **form: Any) -> Any:
    return client.post("/v1/extract", files={"file": (filename, content)}, data=form)


def test_health(client: TestClient) -> None:
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["ocr"] is True
    assert body["modelProvider"] == "none"


def test_extract_matches_contract_shape(client: TestClient) -> None:
    response = post(client, fixture_bytes("combined-invoice-and-packing-list.pdf"), "combined.pdf")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"workerVersion", "mime", "pageCount", "pages", "parts", "warnings", "timingsMs"}
    assert body["mime"] == "application/pdf"
    for page in body["pages"]:
        assert set(page) == {"page", "width", "height", "textChars", "ocr", "textHash"}
        assert page["textHash"].startswith("sha256:")
    for part in body["parts"]:
        assert set(part) == {
            "docType",
            "pageStart",
            "pageEnd",
            "classificationConfidence",
            "classificationSignals",
            "fields",
            "lineItems",
            "missingFields",
        }
        for field in part["fields"]:
            assert set(field) == {"path", "raw", "value", "unit", "source"}
            assert field["unit"] is None or field["unit"] in UNITS
            _check_source(field["source"], body["pages"])
            if field["path"].startswith("total_"):
                assert DECIMAL.match(field["value"])
        for item in part["lineItems"]:
            assert set(item) == {
                "rowIndex",
                "sku",
                "description",
                "quantity",
                "packages",
                "unitPrice",
                "amount",
                "netWeight",
                "grossWeight",
                "cbm",
                "piecesPerPackage",
                "source",
            }
            for key in ("unitPrice", "amount", "cbm", "piecesPerPackage"):
                assert item[key] is None or DECIMAL.match(item[key])
            for key in ("quantity", "netWeight", "grossWeight"):
                if item[key] is not None:
                    assert DECIMAL.match(item[key]["value"]) and item[key]["unit"] in UNITS
            if item["packages"] is not None:
                assert DECIMAL.match(item["packages"]["count"]) and item["packages"]["type"] in UNITS
            _check_source(item["source"], body["pages"])


def _check_source(source: dict[str, Any], pages: list[dict[str, Any]]) -> None:
    assert set(source) == {"page", "bbox", "quote", "parser", "confidence"}
    assert source["parser"] in PARSERS
    assert 0 <= source["confidence"] <= 1
    page = pages[source["page"] - 1]
    x0, y0, x1, y1 = source["bbox"]
    assert 0 <= x0 < x1 <= page["width"] and 0 <= y0 < y1 <= page["height"]
    assert source["quote"]


def test_filename_hint_form_field_overrides_upload_name(client: TestClient) -> None:
    body = post(client, fixture_bytes("packing-list-v1.pdf"), "x.pdf", filename_hint="invoice.pdf").json()
    assert body["parts"][0]["docType"] == "PACKING_LIST"
    assert any("'invoice.pdf'" in s for s in body["parts"][0]["classificationSignals"])


def test_type_is_detected_from_magic_bytes_not_extension(client: TestClient) -> None:
    response = post(client, fixture_bytes("scanned-packing-list.png"), "scan.pdf")
    assert response.status_code == 200
    assert response.json()["mime"] == "image/png"


def test_jpeg_upload_goes_through_ocr(client: TestClient) -> None:
    image = Image.open(io.BytesIO(fixture_bytes("scanned-packing-list.png")))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=90, dpi=(200, 200))
    body = post(client, buffer.getvalue(), "scan.jpg").json()
    assert body["mime"] == "image/jpeg"
    assert body["pages"][0]["ocr"] is True
    assert body["parts"][0]["docType"] == "PACKING_LIST"


def test_disallowed_content_is_415(client: TestClient) -> None:
    for content, name in [
        (b"Invoice No.: 123\nTotal: 500", "invoice.pdf"),
        (b"GIF89a\x01\x00\x01\x00", "scan.png"),
        (_zip_without_workbook(), "packing.xlsx"),
    ]:
        response = post(client, content, name)
        assert response.status_code == 415, name
        assert response.json()["error"] == "unsupported_media_type"


def _zip_without_workbook() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("hello.txt", "not a spreadsheet")
    return buffer.getvalue()


def test_empty_file_is_422(client: TestClient) -> None:
    response = post(client, b"", "empty.pdf")
    assert response.status_code == 422
    assert response.json() == {"error": "empty_document", "message": "uploaded file is empty"}


def test_corrupt_pdf_is_422(client: TestClient) -> None:
    response = post(client, b"%PDF-1.7\n1 0 obj << /Type /Catalog >>\ngarbage" + bytes(range(256)), "bad.pdf")
    assert response.status_code == 422
    body = response.json()
    assert body["error"] in ("corrupt_document", "empty_document")
    assert body["message"]


def test_truncated_png_is_422(client: TestClient) -> None:
    response = post(client, fixture_bytes("scanned-packing-list.png")[:200], "scan.png")
    assert response.status_code == 422
    assert response.json()["error"] == "corrupt_document"


def test_corrupt_xlsx_is_422(client: TestClient) -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("xl/workbook.xml", "<not-xml")
    response = post(client, buffer.getvalue(), "broken.xlsx")
    assert response.status_code == 422
    assert response.json()["error"] == "corrupt_document"


def test_upload_size_limit_is_413() -> None:
    client = TestClient(create_app(Settings(max_upload_bytes=2048)))
    response = post(client, fixture_bytes("invoice-v1.pdf") + b"\0" * 4096, "big.pdf")
    assert response.status_code == 413
    assert response.json()["error"] == "payload_too_large"


def test_default_upload_limit_is_25_mb() -> None:
    assert Settings.from_env().max_upload_bytes == 25 * 1024 * 1024


def test_page_limit_is_422() -> None:
    client = TestClient(create_app(Settings(max_pages=1)))
    response = post(client, fixture_bytes("combined-invoice-and-packing-list.pdf"), "combined.pdf")
    assert response.status_code == 422
    assert response.json()["error"] == "too_many_pages"


def test_render_returns_page_png_at_2x(client: TestClient) -> None:
    response = client.post(
        "/v1/render",
        files={"file": ("combined.pdf", fixture_bytes("combined-invoice-and-packing-list.pdf"))},
        data={"page": "2"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    image = Image.open(io.BytesIO(response.content))
    assert image.size == (1191, 1684)


def test_render_rejects_out_of_range_page_and_spreadsheets(client: TestClient) -> None:
    out_of_range = client.post(
        "/v1/render", files={"file": ("a.pdf", fixture_bytes("invoice-v1.pdf"))}, data={"page": "3"}
    )
    assert out_of_range.status_code == 422
    sheet = client.post(
        "/v1/render", files={"file": ("a.xlsx", fixture_bytes("packing-list.xlsx"))}, data={"page": "1"}
    )
    assert sheet.status_code == 422
