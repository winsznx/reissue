"""Shipping documents other than invoices and packing lists are recognised by content."""

from __future__ import annotations

import pymupdf
import pytest

from reissue_worker.config import Settings
from reissue_worker.extract import extract_document


def page_with(lines: list[str]) -> bytes:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for index, text in enumerate(lines):
        page.insert_text((40, 60 + index * 18), text, fontsize=10)
    data: bytes = document.tobytes()
    document.close()
    return data


@pytest.mark.parametrize(
    ("lines", "expected"),
    [
        (
            [
                "AIR WAYBILL",
                "Airport of Departure: PVG",
                "Airport of Destination: AMS",
                "Chargeable Weight: 412 kg",
                "Flight: KL896",
            ],
            "AIR_WAYBILL",
        ),
        (
            [
                "PURCHASE ORDER",
                "PO No.: NHG-PO-88213",
                "Order Date: 2026-09-30",
                "Requested Delivery: 2026-11-20",
                "Ship by: 2026-10-20",
            ],
            "PURCHASE_ORDER",
        ),
        (
            [
                "CORRECTION NOTE",
                "Invoice LUM-2026-0417",
                "Line 3 was previously stated as 480 pcs.",
                "It should read 500 pcs.",
                "All other items corrected as above.",
            ],
            "CORRECTION_NOTE",
        ),
    ],
)
def test_classifies_other_shipping_documents_by_content(lines: list[str], expected: str) -> None:
    # #given a single-page document titled and worded as one document type
    data = page_with(lines)
    # #when it is extracted with an unrelated filename hint
    (part,) = extract_document(data, Settings(), filename_hint="scan-0001.pdf").to_json()["parts"]
    # #then the content decides the type
    assert part["docType"] == expected
