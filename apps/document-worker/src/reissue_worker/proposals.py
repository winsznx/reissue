"""What a model assistant may propose. Proposals are unverified until llm.py and verify.py accept them."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from reissue_worker.layout import PageLayout
from reissue_worker.models import DocType, FieldPath


class AssistError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class Suggestion:
    path: str
    value: str
    quote: str
    page: int


@dataclass(frozen=True, slots=True)
class LineItemSuggestion:
    page: int
    sku: str | None = None
    description: str | None = None
    quantity: str | None = None
    quantity_unit: str | None = None
    packages: str | None = None
    package_unit: str | None = None
    unit_price: str | None = None
    amount: str | None = None
    net_weight: str | None = None
    gross_weight: str | None = None
    weight_unit: str | None = None


@dataclass(slots=True)
class Proposal:
    fields: list[Suggestion] = field(default_factory=list)
    line_items: list[LineItemSuggestion] = field(default_factory=list)


class FieldAssistant(Protocol):
    def suggest(
        self, doc_type: DocType, missing: Sequence[FieldPath], pages: Sequence[PageLayout]
    ) -> list[Suggestion]: ...


@runtime_checkable
class DocumentAssistant(Protocol):
    """An assistant that can also propose line items when the table parser found none."""

    def suggest(
        self, doc_type: DocType, missing: Sequence[FieldPath], pages: Sequence[PageLayout]
    ) -> list[Suggestion]: ...

    def propose(
        self,
        doc_type: DocType,
        missing: Sequence[FieldPath],
        pages: Sequence[PageLayout],
        *,
        line_items: bool,
    ) -> Proposal: ...


def suggestions_from(items: Sequence[object]) -> list[Suggestion]:
    suggestions: list[Suggestion] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        path, value, quote, page = item.get("path"), item.get("value"), item.get("quote"), item.get("page")
        if (
            isinstance(path, str)
            and isinstance(value, str)
            and isinstance(quote, str)
            and isinstance(page, int)
        ):
            suggestions.append(Suggestion(path=path, value=value, quote=quote, page=page))
    return suggestions


def field_suggestions_schema(missing: Sequence[FieldPath]) -> dict[str, Any]:
    if not missing:
        return {"type": "array", "maxItems": 0}
    return {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "enum": list(missing)},
                "value": {"type": "string"},
                "quote": {"type": "string"},
                "page": {"type": "integer"},
            },
            "required": ["path", "value", "quote", "page"],
            "additionalProperties": False,
        },
    }
