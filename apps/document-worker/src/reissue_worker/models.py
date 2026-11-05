"""Wire types mirroring packages/contracts/src/extraction.ts. Serialization emits camelCase JSON."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from reissue_worker.layout import BBox
from reissue_worker.normalize import Unit

DocType = Literal[
    "COMMERCIAL_INVOICE",
    "PACKING_LIST",
    "BILL_OF_LADING",
    "AIR_WAYBILL",
    "PURCHASE_ORDER",
    "CORRECTION_NOTE",
    "UNKNOWN",
]
Parser = Literal["pdf_text", "pdf_table", "ocr", "spreadsheet", "llm_verified"]
FieldPath = Literal[
    "invoice_number",
    "packing_list_number",
    "purchase_order",
    "document_date",
    "revision",
    "seller",
    "buyer",
    "consignee",
    "currency",
    "incoterms",
    "total_amount",
    "total_quantity",
    "total_packages",
    "total_net_weight",
    "total_gross_weight",
    "total_cbm",
    "bl_number",
    "awb_number",
]

REQUIRED_FIELDS: dict[DocType, tuple[FieldPath, ...]] = {
    "COMMERCIAL_INVOICE": (
        "invoice_number",
        "document_date",
        "seller",
        "buyer",
        "currency",
        "total_amount",
    ),
    "PACKING_LIST": ("total_packages", "total_gross_weight"),
}


@dataclass(frozen=True, slots=True)
class SourceSpan:
    page: int
    bbox: BBox | None
    quote: str
    parser: Parser
    confidence: float

    def to_json(self) -> dict[str, Any]:
        return {
            "page": self.page,
            "bbox": list(self.bbox) if self.bbox is not None else None,
            "quote": self.quote,
            "parser": self.parser,
            "confidence": round(self.confidence, 3),
        }


@dataclass(frozen=True, slots=True)
class ExtractedField:
    path: FieldPath
    raw: str
    value: str
    unit: Unit | None
    source: SourceSpan

    def to_json(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "raw": self.raw,
            "value": self.value,
            "unit": self.unit,
            "source": self.source.to_json(),
        }


@dataclass(frozen=True, slots=True)
class Measure:
    value: str
    unit: Unit
    raw: str

    def to_json(self) -> dict[str, Any]:
        return {"value": self.value, "unit": self.unit, "raw": self.raw}


@dataclass(frozen=True, slots=True)
class Packages:
    count: str
    type: Unit
    raw: str

    def to_json(self) -> dict[str, Any]:
        return {"count": self.count, "type": self.type, "raw": self.raw}


@dataclass(slots=True)
class ExtractedLineItem:
    row_index: int
    sku: str | None
    description: str
    quantity: Measure | None
    packages: Packages | None
    unit_price: str | None
    amount: str | None
    net_weight: Measure | None
    gross_weight: Measure | None
    cbm: str | None
    pieces_per_package: str | None
    source: SourceSpan

    def to_json(self) -> dict[str, Any]:
        return {
            "rowIndex": self.row_index,
            "sku": self.sku,
            "description": self.description,
            "quantity": _opt(self.quantity),
            "packages": _opt(self.packages),
            "unitPrice": self.unit_price,
            "amount": self.amount,
            "netWeight": _opt(self.net_weight),
            "grossWeight": _opt(self.gross_weight),
            "cbm": self.cbm,
            "piecesPerPackage": self.pieces_per_package,
            "source": self.source.to_json(),
        }


@dataclass(slots=True)
class DocumentPart:
    doc_type: DocType
    page_start: int
    page_end: int
    classification_confidence: float
    classification_signals: list[str]
    fields: list[ExtractedField] = field(default_factory=list)
    line_items: list[ExtractedLineItem] = field(default_factory=list)
    missing_fields: list[FieldPath] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return {
            "docType": self.doc_type,
            "pageStart": self.page_start,
            "pageEnd": self.page_end,
            "classificationConfidence": round(self.classification_confidence, 3),
            "classificationSignals": self.classification_signals,
            "fields": [f.to_json() for f in self.fields],
            "lineItems": [item.to_json() for item in self.line_items],
            "missingFields": self.missing_fields,
        }


@dataclass(frozen=True, slots=True)
class PageInfo:
    page: int
    width: float
    height: float
    text_chars: int
    ocr: bool
    text_hash: str

    def to_json(self) -> dict[str, Any]:
        return {
            "page": self.page,
            "width": round(self.width, 2),
            "height": round(self.height, 2),
            "textChars": self.text_chars,
            "ocr": self.ocr,
            "textHash": self.text_hash,
        }


@dataclass(slots=True)
class ExtractionResult:
    worker_version: str
    mime: str
    page_count: int
    pages: list[PageInfo]
    parts: list[DocumentPart]
    warnings: list[str]
    timings_ms: dict[str, float]

    def to_json(self) -> dict[str, Any]:
        return {
            "workerVersion": self.worker_version,
            "mime": self.mime,
            "pageCount": self.page_count,
            "pages": [p.to_json() for p in self.pages],
            "parts": [p.to_json() for p in self.parts],
            "warnings": self.warnings,
            "timingsMs": {k: round(v, 1) for k, v in self.timings_ms.items()},
        }


def _opt(value: Measure | Packages | None) -> dict[str, Any] | None:
    return value.to_json() if value is not None else None
