from __future__ import annotations

from collections.abc import Callable

import pymupdf

from reissue_worker.classify import filename_doc_type
from reissue_worker.config import Settings
from reissue_worker.extract import extract_document
from support import Result, make_pdf

Extract = Callable[..., Result]

UNRELATED = [
    (60, 80, "Quarterly team offsite agenda"),
    (60, 110, "09:00 Coffee and introductions in the main hall"),
    (60, 130, "10:30 Product roadmap review with the leadership group"),
    (60, 150, "12:00 Lunch at the harbour restaurant, vegetarian options available"),
    (60, 170, "15:00 Walking tour of the old town, meet at the north entrance"),
]


def test_content_beats_misleading_filename(extract_fixture: Extract) -> None:
    result = extract_fixture("commercial-invoice-final.pdf")
    (part,) = result["parts"]
    assert part["docType"] == "PACKING_LIST"
    assert part["classificationConfidence"] >= 0.9
    assert any("ignored, content disagrees" in s for s in part["classificationSignals"])
    assert any("title 'PACKING LIST'" in s for s in part["classificationSignals"])


def test_filename_hint_alone_never_classifies_unrelated_content() -> None:
    result = extract_document(make_pdf(UNRELATED), Settings(), "commercial-invoice.pdf").to_json()
    (part,) = result["parts"]
    assert part["docType"] == "UNKNOWN"
    assert part["fields"] == [] and part["lineItems"] == [] and part["missingFields"] == []


def test_unrelated_document_is_unknown_without_hint() -> None:
    (part,) = extract_document(make_pdf(UNRELATED), Settings()).to_json()["parts"]
    assert part["docType"] == "UNKNOWN"


def test_invoice_reference_on_packing_list_is_not_an_invoice_title(extract_fixture: Extract) -> None:
    (part,) = extract_fixture("packing-list-v1.pdf")["parts"]
    assert part["docType"] == "PACKING_LIST"
    assert not any("COMMERCIAL_INVOICE (+" in s and "title" in s for s in part["classificationSignals"])


def test_continuation_page_without_title_stays_in_the_part() -> None:
    first = [
        (240, 60, "PACKING LIST"),
        *[(60, 120 + 14 * i, f"line {i} of the document body") for i in range(4)],
    ]
    pdf = make_pdf(first)
    with pymupdf.open(stream=pdf, filetype="pdf") as document:
        page = document.new_page(width=595, height=842)
        page.insert_text(
            (60, 80), "Further remarks about cartons and shipping marks continue here.", fontsize=10
        )
        data = document.tobytes()
    parts = extract_document(data, Settings()).to_json()["parts"]
    assert [(p["docType"], p["pageStart"], p["pageEnd"]) for p in parts] == [("PACKING_LIST", 1, 2)]


def test_filename_hint_parsing_ignores_directories() -> None:
    assert filename_doc_type("../../etc/invoice.pdf") == "COMMERCIAL_INVOICE"
    assert filename_doc_type("C:\\scans\\PL_0417.pdf") == "PACKING_LIST"
    assert filename_doc_type("photo.jpg") is None
    assert filename_doc_type(None) is None
