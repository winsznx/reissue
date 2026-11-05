"""Layouts seen on real-world forms: stacked headers, cells beside labels, spaced rows, qualified titles."""

from __future__ import annotations

from collections.abc import Sequence

import pymupdf

from reissue_worker.config import Settings
from reissue_worker.extract import extract_document
from support import Result, fields_by_path

Placed = tuple[float, float, str]


def pdf(lines: Sequence[Placed], *, fontsize: float = 8) -> bytes:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    for x, y, text in lines:
        page.insert_text((x, y), text, fontsize=fontsize)
    data: bytes = document.tobytes()
    document.close()
    return data


def only_part(data: bytes) -> Result:
    (part,) = extract_document(data, Settings()).to_json()["parts"]
    result: Result = part
    return result


def values(part: Result) -> dict[str, tuple[str, str | None]]:
    return {path: (field["value"], field["unit"]) for path, field in fields_by_path(part).items()}


def measure(entry: Result | None) -> tuple[str, str] | None:
    return None if entry is None else (entry["value"], entry["unit"])


def row(y: float, cells: Sequence[tuple[float, str]]) -> list[Placed]:
    return [(x, y, text) for x, text in cells]


TWO_LINE_HEADER_INVOICE = [
    (250, 60, "INVOICE"),
    *row(
        200,
        [
            (45, "Item"),
            (100, "HS"),
            (150, "Description"),
            (280, "Quantity"),
            (340, "Kg"),
            (380, "Kg"),
            (420, "Unit price"),
            (480, "Amount"),
            (530, "Currency"),
        ],
    ),
    *row(209, [(100, "code¹"), (282, "(pcs)"), (336, "(net)"), (374, "(gross)")]),
    *row(
        225,
        [
            (45, "Ref 101"),
            (100, "42021299"),
            (150, "Trunk"),
            (290, "2"),
            (340, "2.000"),
            (380, "2.500"),
            (425, "10.00"),
            (485, "20.00"),
            (532, "GBP"),
        ],
    ),
    *row(
        236,
        [
            (45, "Ref 102"),
            (100, "42029291"),
            (150, "Backpack"),
            (290, "1"),
            (340, "0.500"),
            (380, "0.800"),
            (425, "6.00"),
            (485, "6.00"),
            (532, "GBP"),
        ],
    ),
    *row(300, [(45, "Total"), (290, "3"), (340, "2.500"), (380, "3.300"), (485, "26.00"), (532, "GBP")]),
]


def test_two_line_header_with_unit_row_and_footnote_markers() -> None:
    part = only_part(pdf(TWO_LINE_HEADER_INVOICE))
    items = part["lineItems"]
    assert [i["sku"] for i in items] == ["Ref 101", "Ref 102"]
    assert [i["description"] for i in items] == ["Trunk", "Backpack"]
    assert [measure(i["quantity"]) for i in items] == [("2", "pcs"), ("1", "pcs")]
    assert [measure(i["netWeight"]) for i in items] == [("2.000", "kg"), ("0.500", "kg")]
    assert [measure(i["grossWeight"]) for i in items] == [("2.500", "kg"), ("0.800", "kg")]
    assert [i["amount"] for i in items] == ["20.00", "6.00"]


def test_totals_row_after_blank_form_space_and_currency_column() -> None:
    part = only_part(pdf(TWO_LINE_HEADER_INVOICE))
    found = values(part)
    assert found["total_quantity"] == ("3", "pcs")
    assert found["total_net_weight"] == ("2.500", "kg")
    assert found["total_gross_weight"] == ("3.300", "kg")
    assert found["total_amount"] == ("26.00", None)
    assert found["currency"] == ("GBP", None)
    assert fields_by_path(part)["currency"]["source"]["parser"] == "pdf_table"


STACKED_RIGHT_ALIGNED_PACKING_LIST = [
    (250, 60, "PACKING LIST"),
    *row(200, [(410, "QTY IN"), (470, "QTY")]),
    *row(209, [(350, "QTY"), (412, "THIS"), (460, "SHIPPED")]),
    *row(
        218,
        [
            (40, "CARTON"),
            (90, "SKU"),
            (150, "DESCRIPTION"),
            (300, "UOM"),
            (340, "ORDERED"),
            (405, "CARTON"),
            (462, "(TOTAL)"),
            (520, "BACKORDERED"),
        ],
    ),
    *row(236, [(40, "1 of 2"), (90, "CH-128-MB"), (150, "Cabinet Handle")]),
    *row(241, [(150, "matt black"), (300, "pcs"), (355, "12"), (420, "12"), (480, "12"), (540, "0")]),
    *row(
        258,
        [
            (40, "2 of 2"),
            (90, "SB-200-GV"),
            (150, "Shelf Bracket"),
            (300, "pcs"),
            (355, "10"),
            (420, "8"),
            (480, "8"),
            (540, "2"),
        ],
    ),
    *row(268, [(150, "200 mm")]),
]


def test_three_line_stacked_header_picks_shipped_quantity() -> None:
    part = only_part(pdf(STACKED_RIGHT_ALIGNED_PACKING_LIST))
    items = part["lineItems"]
    assert [i["sku"] for i in items] == ["CH-128-MB", "SB-200-GV"]
    assert [measure(i["quantity"]) for i in items] == [("12", "pcs"), ("8", "pcs")]


def test_value_line_beside_centred_description_completes_the_row() -> None:
    part = only_part(pdf(STACKED_RIGHT_ALIGNED_PACKING_LIST))
    assert [i["description"] for i in part["lineItems"]] == [
        "Cabinet Handle matt black",
        "Shelf Bracket 200 mm",
    ]


def test_carton_sequence_marks_are_not_package_counts() -> None:
    part = only_part(pdf(STACKED_RIGHT_ALIGNED_PACKING_LIST))
    assert [i["packages"] for i in part["lineItems"]] == [None, None]
    assert [i["piecesPerPackage"] for i in part["lineItems"]] == [None, None]


SPACED_ROWS_INVOICE = [
    (230, 60, "COMMERCIAL INVOICE"),
    *row(
        200, [(60, "SKU"), (130, "Description"), (300, "Quantity"), (380, "Unit value"), (470, "Total value")]
    ),
    *row(230, [(60, "AB1234"), (130, "Ankle socks"), (305, "250"), (385, "$2.00"), (475, "$500.00")]),
    *row(250, [(140, "4"), (310, "6"), (390, "7")]),
    *row(290, [(60, "BC2345"), (130, "Hangers"), (305, "300"), (385, "$2.15"), (475, "$645.00")]),
    *row(360, [(60, "Total"), (420, "USD"), (465, "$1,145.00")]),
]


def test_well_formed_rows_survive_wide_spacing_and_stray_callouts_are_skipped() -> None:
    part = only_part(pdf(SPACED_ROWS_INVOICE, fontsize=10))
    items = part["lineItems"]
    assert [(i["sku"], i["quantity"]["value"], i["unitPrice"], i["amount"]) for i in items] == [
        ("AB1234", "250", "2.00", "500.00"),
        ("BC2345", "300", "2.15", "645.00"),
    ]
    found = values(part)
    assert found["total_amount"] == ("1145.00", None)
    assert found["currency"] == ("USD", None)


LABEL_LAYOUTS = [
    (220, 60, "COMMERCIAL INVOICE"),
    (60, 100, "Invoice No. FP123456"),
    (330, 100, "Order no. / customer PO PH-55102"),
    (60, 115, "Invoice date 5/16/16"),
    (60, 140, "Ship from"),
    (200, 140, "Larkfield Supply"),
    (60, 160, "Total gross weight (kg) 11.8"),
    (60, 175, "Cartons in shipment"),
    (200, 175, "2"),
    (60, 200, "Invoice address: ²"),
    (60, 213, "Northfield Home Goods"),
    (60, 240, "Inco term:"),
    (200, 240, "DAP Felixstowe ³"),
    (60, 260, "Revenue Tons 12"),
]


def test_colonless_labels_with_inline_values() -> None:
    found = values(only_part(pdf(LABEL_LAYOUTS, fontsize=10)))
    assert found["invoice_number"] == ("FP123456", None)
    assert found["document_date"] == ("2016-05-16", None)
    assert found["purchase_order"] == ("PH-55102", None)
    assert found["total_gross_weight"] == ("11.8", "kg")


def test_values_in_the_cell_beside_or_below_a_label() -> None:
    part = only_part(pdf(LABEL_LAYOUTS, fontsize=10))
    found = values(part)
    assert found["seller"] == ("Larkfield Supply", None)
    assert found["total_packages"] == ("2", "carton")
    assert found["buyer"] == ("Northfield Home Goods", None)
    assert found["incoterms"] == ("DAP Felixstowe", None)
    assert fields_by_path(part)["seller"]["source"]["quote"] == "Ship from Larkfield Supply"


def test_label_words_must_end_at_a_word_boundary() -> None:
    assert "revision" not in values(only_part(pdf(LABEL_LAYOUTS, fontsize=10)))


def test_number_prefix_is_not_part_of_the_identifier() -> None:
    lines = [(250, 60, "INVOICE"), (60, 100, "Invoice nbr: N°12345"), (60, 115, "Unit price and amount")]
    assert values(only_part(pdf(lines, fontsize=10)))["invoice_number"] == ("12345", None)


def test_blank_form_labels_never_pair_with_each_other() -> None:
    lines = [
        (250, 60, "PACKING LIST"),
        (400, 100, "Packing List#:"),
        (400, 115, "Loading Date:"),
        (400, 130, "Customer PO#:"),
        (400, 145, "Shipping Mark:"),
        (100, 180, "Supplier"),
        (300, 180, "Consignee"),
        (60, 200, "Gross weight and net weight per carton, CBM"),
    ]
    part = only_part(pdf(lines, fontsize=10))
    assert part["docType"] == "PACKING_LIST"
    assert part["fields"] == []


def test_qualified_title_classifies_with_capped_confidence() -> None:
    lines = [
        (220, 40, "CANADA CUSTOMS INVOICE"),
        (60, 300, "14. Unit price"),
        (60, 320, "17. Invoice total amount"),
    ]
    part = only_part(pdf(lines, fontsize=10))
    assert part["docType"] == "COMMERCIAL_INVOICE"
    assert part["classificationConfidence"] <= 0.7
    assert any("qualified title 'CANADA CUSTOMS INVOICE'" in s for s in part["classificationSignals"])


def test_sentence_ending_in_a_title_word_is_not_a_title() -> None:
    lines = [
        (60, 40, "please see invoice"),
        (60, 300, "Lunch at the harbour restaurant, vegetarian options available"),
    ]
    assert only_part(pdf(lines, fontsize=10))["docType"] == "UNKNOWN"
