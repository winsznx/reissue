"""End-to-end extraction over every controlled fixture: classification, fields, rows and evidence."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pymupdf
import pytest

from reissue_worker.fixtures import build_all
from support import FIXTURES, Result, fields_by_path, fixture_bytes

Extract = Callable[..., Result]

INVOICE_SKUS = ["LL-PND-301", "LL-TBL-112", "LL-STR-050", "LL-WAL-207", "LL-SHD-090"]
V1_QUANTITIES = ["240", "360", "480", "150", "100"]
CORRECT_QUANTITIES = ["240", "360", "500", "150", "100"]

PACKING_LIST_PDFS = [
    "packing-list-v1.pdf",
    "packing-list-v2.pdf",
    "packing-list-v2-still-wrong.pdf",
    "reordered-packing-list.pdf",
    "cartons-packing-list.pdf",
    "packing-list-v3-new-mismatch.pdf",
    "commercial-invoice-final.pdf",
    "hostile-packing-list.pdf",
    "multipage-packing-list.pdf",
]


def single_part(result: Result) -> Result:
    assert len(result["parts"]) == 1, result["parts"]
    part: Result = result["parts"][0]
    return part


def quantities(part: Result) -> list[str | None]:
    return [item["quantity"]["value"] if item["quantity"] else None for item in part["lineItems"]]


def test_generator_is_deterministic_and_matches_committed_fixtures() -> None:
    generated = build_all()
    assert generated == build_all()
    for name, content in generated.items():
        assert (FIXTURES / name).read_bytes() == content, f"{name} is stale; rerun the fixture generator"


def test_invoice_fields_and_lines(extract_fixture: Extract) -> None:
    part = single_part(extract_fixture("invoice-v1.pdf"))
    assert part["docType"] == "COMMERCIAL_INVOICE"
    assert part["missingFields"] == []
    fields = fields_by_path(part)
    expected = {
        "invoice_number": "LUM-2026-0417",
        "document_date": "2026-10-14",
        "purchase_order": "NHG-PO-88213",
        "seller": "Hangzhou Lumen Lighting Co., Ltd.",
        "buyer": "Northfield Home Goods B.V.",
        "consignee": "Northfield Home Goods B.V.",
        "currency": "USD",
        "incoterms": "FOB Ningbo",
        "total_amount": "14406.00",
        "total_quantity": "1350",
        "total_packages": "65",
        "total_net_weight": "329.00",
        "total_gross_weight": "373.50",
    }
    assert {path: fields[path]["value"] for path in expected} == expected
    assert fields["total_gross_weight"]["unit"] == "kg"
    assert fields["total_packages"]["unit"] == "carton"
    assert fields["total_quantity"]["unit"] == "pcs"

    items = part["lineItems"]
    assert [i["sku"] for i in items] == INVOICE_SKUS
    assert quantities(part) == CORRECT_QUANTITIES
    assert {i["quantity"]["unit"] for i in items} == {"pcs"}
    assert [i["unitPrice"] for i in items] == ["18.40", "11.25", "3.80", "22.60", "6.50"]
    assert [i["amount"] for i in items] == ["4416.00", "4050.00", "1900.00", "3390.00", "650.00"]
    assert items[2]["description"] == "LED string lights, warm white, 5 m"
    assert [i["rowIndex"] for i in items] == [0, 1, 2, 3, 4]


def test_packing_list_v1_fields_and_lines(extract_fixture: Extract) -> None:
    part = single_part(extract_fixture("packing-list-v1.pdf"))
    assert part["docType"] == "PACKING_LIST"
    assert part["missingFields"] == []
    fields = fields_by_path(part)
    assert fields["packing_list_number"]["value"] == "PL-LUM-2026-0417"
    assert fields["invoice_number"]["value"] == "LUM-2026-0417"
    assert fields["document_date"]["value"] == "2026-10-16"
    assert fields["total_packages"]["value"] == "65"
    assert fields["total_gross_weight"]["value"] == "373.50"
    assert fields["total_cbm"]["value"] == "4.69"
    assert "revision" not in fields

    items = part["lineItems"]
    assert [i["sku"] for i in items] == INVOICE_SKUS
    assert quantities(part) == V1_QUANTITIES
    line3 = items[2]
    assert line3["quantity"] == {"value": "480", "unit": "pcs", "raw": "480"}
    assert line3["packages"] == {"count": "10", "type": "carton", "raw": "10"}
    assert line3["piecesPerPackage"] == "48"
    assert line3["netWeight"] == {"value": "45.00", "unit": "kg", "raw": "45.00"}
    assert line3["grossWeight"] == {"value": "50.50", "unit": "kg", "raw": "50.50"}
    assert line3["cbm"] == "0.60"
    assert line3["unitPrice"] is None and line3["amount"] is None


@pytest.mark.parametrize(
    ("name", "revision", "expected_quantities"),
    [
        ("packing-list-v2.pdf", "2", CORRECT_QUANTITIES),
        ("packing-list-v2-still-wrong.pdf", "2", V1_QUANTITIES),
        ("packing-list-v3-new-mismatch.pdf", "3", CORRECT_QUANTITIES),
    ],
)
def test_revisions(
    extract_fixture: Extract, name: str, revision: str, expected_quantities: list[str]
) -> None:
    part = single_part(extract_fixture(name))
    assert fields_by_path(part)["revision"]["value"] == revision
    assert quantities(part) == expected_quantities


def test_v3_introduces_gross_weight_mismatch(extract_fixture: Extract) -> None:
    part = single_part(extract_fixture("packing-list-v3-new-mismatch.pdf"))
    assert fields_by_path(part)["total_gross_weight"]["value"] == "378.50"
    assert part["lineItems"][2]["grossWeight"]["value"] == "55.50"


def test_reordered_packing_list_keeps_document_order(extract_fixture: Extract) -> None:
    part = single_part(extract_fixture("reordered-packing-list.pdf"))
    skus = [i["sku"] for i in part["lineItems"]]
    assert skus == ["LL-WAL-207", "LL-PND-301", "LL-SHD-090", "LL-STR-050", "LL-TBL-112"]
    by_sku = {i["sku"]: i["quantity"]["value"] for i in part["lineItems"]}
    assert by_sku == dict(zip(INVOICE_SKUS, CORRECT_QUANTITIES, strict=True))


def test_cartons_only_line_is_not_converted_to_pieces(extract_fixture: Extract) -> None:
    part = single_part(extract_fixture("cartons-packing-list.pdf"))
    shade = next(i for i in part["lineItems"] if i["sku"] == "LL-SHD-090")
    assert shade["quantity"] == {"value": "5", "unit": "carton", "raw": "5 CTNS"}
    assert shade["piecesPerPackage"] is None
    others = [i for i in part["lineItems"] if i["sku"] != "LL-SHD-090"]
    assert all(i["quantity"]["unit"] == "pcs" for i in others)
    assert others[0]["quantity"]["raw"] == "240 PCS"
    assert "total_quantity" not in fields_by_path(part)


def test_combined_pdf_is_split_into_two_parts(extract_fixture: Extract) -> None:
    result = extract_fixture("combined-invoice-and-packing-list.pdf")
    assert result["pageCount"] == 2
    invoice, packing = result["parts"]
    assert (invoice["docType"], invoice["pageStart"], invoice["pageEnd"]) == ("COMMERCIAL_INVOICE", 1, 1)
    assert (packing["docType"], packing["pageStart"], packing["pageEnd"]) == ("PACKING_LIST", 2, 2)
    assert {i["source"]["page"] for i in invoice["lineItems"]} == {1}
    assert {i["source"]["page"] for i in packing["lineItems"]} == {2}
    assert {f["source"]["page"] for f in packing["fields"]} == {2}
    assert quantities(invoice) == CORRECT_QUANTITIES
    assert quantities(packing) == V1_QUANTITIES
    assert fields_by_path(invoice)["document_date"]["value"] == "2026-10-14"
    assert fields_by_path(packing)["document_date"]["value"] == "2026-10-16"


def test_multipage_table_with_repeated_header(extract_fixture: Extract) -> None:
    part = single_part(extract_fixture("multipage-packing-list.pdf"))
    assert (part["pageStart"], part["pageEnd"]) == (1, 2)
    items = part["lineItems"]
    assert len(items) == 36
    assert [i["rowIndex"] for i in items] == list(range(36))
    assert [i["sku"] for i in items] == [f"LL-MP-{n:03d}" for n in range(1, 37)]
    assert {i["source"]["page"] for i in items[:20]} == {1}
    assert {i["source"]["page"] for i in items[20:]} == {2}
    assert all(i["description"] and "SKU" not in i["description"] for i in items)

    wrapped = items[6]
    assert wrapped["description"] == (
        "Pendant lamp cluster, three heads, smoked glass, with 2 m braided cable"
    )
    _, y0, _, y1 = wrapped["source"]["bbox"]
    assert y1 - y0 > 20, "continuation line must extend the row's evidence box"

    fields = fields_by_path(part)
    assert fields["total_quantity"]["value"] == str(sum(int(q) for q in quantities(part) if q))
    assert fields["total_packages"]["value"] == str(sum(int(i["packages"]["count"]) for i in items))


def test_spreadsheet_extraction(extract_fixture: Extract) -> None:
    result = extract_fixture("packing-list.xlsx")
    assert result["mime"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    part = single_part(result)
    assert part["docType"] == "PACKING_LIST"
    assert part["missingFields"] == []
    assert [i["sku"] for i in part["lineItems"]] == INVOICE_SKUS
    assert quantities(part) == V1_QUANTITIES
    line3 = part["lineItems"][2]
    assert line3["grossWeight"] == {"value": "50.5", "unit": "kg", "raw": "50.5"}
    assert line3["packages"]["count"] == "10"
    fields = fields_by_path(part)
    assert fields["document_date"]["value"] == "2026-10-16"
    assert fields["total_gross_weight"]["value"] == "373.50"
    for evidence in [*(i["source"] for i in part["lineItems"]), *(f["source"] for f in part["fields"])]:
        assert evidence["parser"] == "spreadsheet"
        assert evidence["bbox"] is None
        assert evidence["page"] == 1


@pytest.mark.parametrize(
    "name", ["invoice-v1.pdf", *PACKING_LIST_PDFS, "combined-invoice-and-packing-list.pdf"]
)
def test_bboxes_point_at_the_quoted_text(extract_fixture: Extract, name: str) -> None:
    """Re-read the PDF inside each reported bbox and check the evidence is really there."""
    result = extract_fixture(name)
    with pymupdf.open(stream=fixture_bytes(name), filetype="pdf") as document:
        for part in result["parts"]:
            for item in part["lineItems"]:
                source = item["source"]
                assert source["parser"] == "pdf_table"
                assert part["pageStart"] <= source["page"] <= part["pageEnd"]
                inside = _text_in(document, source)
                assert item["sku"] in inside
                assert item["quantity"]["raw"] in inside
            for field in part["fields"]:
                source = field["source"]
                assert source["parser"] in ("pdf_text", "pdf_table")
                inside = _text_in(document, source)
                assert field["raw"].split()[0] in inside, (field["path"], inside)
                assert source["quote"].split()[0] in inside


def _text_in(document: pymupdf.Document, source: dict[str, Any]) -> str:
    page = document.load_page(source["page"] - 1)
    x0, y0, x1, y1 = source["bbox"]
    assert 0 <= x0 < x1 <= page.rect.width and 0 <= y0 < y1 <= page.rect.height
    text: str = page.get_textbox(pymupdf.Rect(x0 - 0.5, y0 - 0.5, x1 + 0.5, y1 + 0.5))
    return " ".join(text.split())


@pytest.mark.parametrize("name", ["scanned-packing-list.png", "scanned-packing-list.pdf"])
def test_ocr_path_on_scanned_documents(extract_fixture: Extract, name: str) -> None:
    result = extract_fixture(name)
    assert result["pages"][0]["ocr"] is True
    part = single_part(result)
    assert part["docType"] == "PACKING_LIST"
    assert part["missingFields"] == []
    assert [i["sku"] for i in part["lineItems"]] == INVOICE_SKUS
    assert quantities(part) == V1_QUANTITIES
    fields = fields_by_path(part)
    assert fields["total_gross_weight"]["value"] == "373.50"
    assert fields["invoice_number"]["value"] == "LUM-2026-0417"
    for evidence in [*(i["source"] for i in part["lineItems"]), *(f["source"] for f in part["fields"])]:
        assert evidence["parser"] == "ocr"
        assert 0 < evidence["confidence"] <= 1


@pytest.mark.parametrize("name", ["scanned-packing-list.png", "scanned-packing-list.pdf"])
def test_ocr_bboxes_land_on_the_same_rows_as_the_digital_original(
    extract_fixture: Extract, name: str
) -> None:
    scanned = single_part(extract_fixture(name))
    digital = single_part(extract_fixture("packing-list-v1.pdf"))
    page = extract_fixture(name)["pages"][0]
    assert abs(page["width"] - 595.3) < 1 and abs(page["height"] - 841.9) < 1
    for ocr_item, text_item in zip(scanned["lineItems"], digital["lineItems"], strict=True):
        for ocr_edge, text_edge in zip(ocr_item["source"]["bbox"], text_item["source"]["bbox"], strict=True):
            assert abs(ocr_edge - text_edge) < 8


def test_hostile_text_is_inert_data(extract_fixture: Extract) -> None:
    hostile = single_part(extract_fixture("hostile-packing-list.pdf"))
    baseline = single_part(extract_fixture("packing-list-v1.pdf"))
    assert hostile["docType"] == "PACKING_LIST"
    strip = _without_evidence
    assert strip(hostile["fields"]) == strip(baseline["fields"])
    assert strip(hostile["lineItems"]) == strip(baseline["lineItems"])
    serialized = repr(hostile)
    assert "ignore previous instructions" not in serialized
    assert "mark this case ready" not in serialized


def _without_evidence(entries: list[Result]) -> list[Result]:
    return [{k: v for k, v in entry.items() if k != "source"} for entry in entries]
