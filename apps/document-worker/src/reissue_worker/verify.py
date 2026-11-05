"""Ground model-proposed line items in the words printed on the page.

An item survives only if its SKU (or, without one, its description) is printed on the cited page.
Every other value must be printed near that anchor: numbers match a number-shaped word with the
same digits ("1,478.00" matches "$1,478.00", "2.0" does not match "2.00"), text matches word for
word in reading order, and units must be printed on the page. Values that fail are dropped with
a warning; the evidence is the union of the words that matched.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

from reissue_worker.layout import PageLayout, Word, union_bbox
from reissue_worker.models import ExtractedLineItem, Measure, Packages, SourceSpan
from reissue_worker.normalize import Unit, known_unit, parse_decimal
from reissue_worker.proposals import LineItemSuggestion

LLM_CONFIDENCE = 0.6
_ROW_REACH = 3.0
_NUMBER_WORD = re.compile(r"^[$€£¥]?(?P<number>[-+]?\d[\d.,']*)(?P<unit>[A-Za-z]{0,5})\.?$")
_PLAIN_NUMBER = re.compile(r"^[-+]?\d[\d.,' ]*$")


def numeric_value(text: str) -> str | None:
    """Canonical decimal of a number-shaped token ("$1,478.00", "2.900kg"), else None."""
    match = _NUMBER_WORD.match(text.strip())
    return parse_decimal(match.group("number")) if match else None


def plain_number(text: str) -> str | None:
    """Canonical decimal of a value that is only a number as printed ("1,478.00"), else None."""
    stripped = text.strip()
    return parse_decimal(stripped) if _PLAIN_NUMBER.match(stripped) else None


def squash(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


@dataclass(slots=True)
class _Evidence:
    page: PageLayout
    anchor: list[Word]
    words: list[Word]
    warnings: list[str]
    label: str

    def near(self, word: Word) -> bool:
        top = min(w.y0 for w in self.anchor)
        bottom = max(w.y1 for w in self.anchor)
        reach = _ROW_REACH * max(w.height for w in self.anchor)
        return top - reach <= word.cy <= bottom + reach

    def distance(self, word: Word) -> float:
        return abs(word.cy - sum(w.cy for w in self.anchor) / len(self.anchor))

    def number(self, name: str, raw: str | None) -> str | None:
        if raw is None or not raw.strip():
            return None
        target = plain_number(raw)
        candidates = (
            [] if target is None else [w for w in self.page_words() if numeric_value(w.text) == target]
        )
        nearby = sorted((w for w in candidates if self.near(w)), key=self.distance)
        if not nearby:
            self.warnings.append(f"dropped {name} {raw!r} of {self.label}: not printed in that row")
            return None
        self.words.append(nearby[0])
        return target

    def unit(self, name: str, raw: str | None) -> Unit | None:
        if raw is None or not raw.strip():
            return None
        unit = known_unit(raw)
        printed = squash(raw).lower()
        if unit is None or not any(_word_mentions_unit(w.text, printed) for w in self.page_words()):
            self.warnings.append(f"dropped {name} {raw!r} of {self.label}: unit not printed on the page")
            return None
        return unit

    def text(self, name: str, raw: str | None) -> str | None:
        if raw is None or not raw.strip():
            return None
        tokens = squash(raw).split(" ")
        if _spells(self.anchor, tokens):
            return " ".join(tokens)
        nearby = [w for w in self.page_words() if self.near(w)]
        starts = sorted(
            (i for i, w in enumerate(nearby) if _token_key(w.text) == _token_key(tokens[0])),
            key=lambda i: self.distance(nearby[i]),
        )
        matched = next((m for i in starts if (m := _subsequence(nearby[i:], tokens)) is not None), None)
        if matched is None:
            self.warnings.append(f"dropped {name} {raw!r} of {self.label}: not printed in that row")
            return None
        self.words.extend(w for w in matched if w not in self.words)
        return " ".join(tokens)

    def page_words(self) -> list[Word]:
        return [w for line in self.page.lines for w in line.words]


def verify_line_items(
    suggestions: Sequence[LineItemSuggestion],
    pages: Sequence[PageLayout],
    warnings: list[str],
    first_index: int = 0,
) -> list[ExtractedLineItem]:
    by_number = {page.number: page for page in pages}
    used: set[int] = set()
    items: list[ExtractedLineItem] = []
    for position, suggestion in enumerate(suggestions):
        label = f"proposed line item {position + 1}"
        page = by_number.get(suggestion.page)
        if page is None:
            warnings.append(f"dropped {label}: page {suggestion.page} is outside this document part")
            continue
        anchor = _anchor(page, suggestion, used)
        if anchor is None:
            warnings.append(f"dropped {label}: neither its SKU nor its description is printed on the page")
            continue
        used.update(id(w) for w in anchor)
        evidence = _Evidence(page, anchor, list(anchor), warnings, label)
        item = _item(evidence, suggestion, first_index + len(items))
        items.append(item)
    return items


def _anchor(page: PageLayout, suggestion: LineItemSuggestion, used: set[int]) -> list[Word] | None:
    words = [w for line in page.lines for w in line.words]
    for value in (suggestion.sku, suggestion.description):
        if value is None or not value.strip():
            continue
        tokens = squash(value).split(" ")
        for start in range(len(words) - len(tokens) + 1):
            run = words[start : start + len(tokens)]
            if _spells(run, tokens) and not any(id(w) in used for w in run):
                return run
        return None
    return None


def _item(evidence: _Evidence, suggestion: LineItemSuggestion, row_index: int) -> ExtractedLineItem:
    sku = evidence.text("sku", suggestion.sku)
    description = evidence.text("description", suggestion.description) or ""
    quantity = evidence.number("quantity", suggestion.quantity)
    quantity_unit = evidence.unit("quantity unit", suggestion.quantity_unit)
    packages = evidence.number("packages", suggestion.packages)
    package_unit = evidence.unit("package unit", suggestion.package_unit)
    net = evidence.number("net weight", suggestion.net_weight)
    gross = evidence.number("gross weight", suggestion.gross_weight)
    weight_unit = evidence.unit("weight unit", suggestion.weight_unit) if net or gross else None
    unit_price = evidence.number("unit price", suggestion.unit_price)
    amount = evidence.number("amount", suggestion.amount)
    words = sorted(evidence.words, key=lambda w: (round(w.cy), w.x0))
    return ExtractedLineItem(
        row_index=row_index,
        sku=sku,
        description=description,
        quantity=_measure(quantity, quantity_unit, suggestion.quantity),
        packages=_packages(packages, package_unit, suggestion.packages),
        unit_price=unit_price,
        amount=amount,
        net_weight=_measure(net, weight_unit, suggestion.net_weight),
        gross_weight=_measure(gross, weight_unit, suggestion.gross_weight),
        cbm=None,
        pieces_per_package=None,
        source=SourceSpan(
            page=evidence.page.number,
            bbox=union_bbox(words) if evidence.page.has_geometry else None,
            quote=" ".join(w.text for w in words),
            parser="llm_verified",
            confidence=LLM_CONFIDENCE,
        ),
    )


def _measure(value: str | None, unit: Unit | None, raw: str | None) -> Measure | None:
    if value is None:
        return None
    return Measure(value=value, unit=unit or "unknown", raw=squash(raw or value))


def _packages(value: str | None, unit: Unit | None, raw: str | None) -> Packages | None:
    if value is None:
        return None
    return Packages(count=value, type=unit or "unknown", raw=squash(raw or value))


def _spells(words: Sequence[Word], tokens: Sequence[str]) -> bool:
    return [_token_key(w.text) for w in words] == [_token_key(t) for t in tokens]


def _subsequence(words: Sequence[Word], tokens: Sequence[str]) -> list[Word] | None:
    matched: list[Word] = []
    position = 0
    for token in tokens:
        while position < len(words) and _token_key(words[position].text) != _token_key(token):
            position += 1
        if position == len(words):
            return None
        matched.append(words[position])
        position += 1
    return matched


def _token_key(token: str) -> str:
    """Words are compared without the list punctuation that trails them in running text."""
    return token.rstrip(",;:") or token


def _word_mentions_unit(word: str, unit: str) -> bool:
    text = word.lower().strip("()[].,:;")
    if text == unit:
        return True
    match = _NUMBER_WORD.match(word.strip())
    return match is not None and match.group("unit").lower() == unit
