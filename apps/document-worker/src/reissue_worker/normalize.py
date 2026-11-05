"""Locale-tolerant number, unit and date normalization. Values stay decimal strings."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Literal

Unit = Literal["pcs", "carton", "kg", "g", "lb", "pallet", "set", "pair", "m", "unknown"]

_UNIT_ALIASES: dict[str, Unit] = {
    "pc": "pcs",
    "pcs": "pcs",
    "piece": "pcs",
    "pieces": "pcs",
    "unit": "pcs",
    "units": "pcs",
    "ea": "pcs",
    "each": "pcs",
    "ctn": "carton",
    "ctns": "carton",
    "carton": "carton",
    "cartons": "carton",
    "cs": "carton",
    "case": "carton",
    "cases": "carton",
    "kg": "kg",
    "kgs": "kg",
    "kilogram": "kg",
    "kilograms": "kg",
    "g": "g",
    "gr": "g",
    "gram": "g",
    "grams": "g",
    "lb": "lb",
    "lbs": "lb",
    "pound": "lb",
    "pounds": "lb",
    "pallet": "pallet",
    "pallets": "pallet",
    "plt": "pallet",
    "plts": "pallet",
    "set": "set",
    "sets": "set",
    "pair": "pair",
    "pairs": "pair",
    "pr": "pair",
    "prs": "pair",
    "m": "m",
    "meter": "m",
    "meters": "m",
    "metre": "m",
    "metres": "m",
}

_NUMBER = re.compile(r"[-+]?\d{1,3}(?:[' \u00a0\u202f]\d{3})+(?:[.,]\d+)?|[-+]?\d[\d.,]*")
_UNIT_WORD = re.compile(r"[A-Za-z]+\.?")


@dataclass(frozen=True, slots=True)
class Quantity:
    value: str
    unit: Unit | None
    raw: str


def normalize_unit(token: str) -> Unit:
    key = token.strip().lower().rstrip(".").replace(" ", "")
    return _UNIT_ALIASES.get(key, "unknown")


def known_unit(token: str) -> Unit | None:
    unit = normalize_unit(token)
    return None if unit == "unknown" else unit


def parse_decimal(raw: str) -> str | None:
    """Normalize a single number written in any common locale to a canonical decimal string.

    "1,234.50" -> "1234.50", "1.234,50" -> "1234.50", "1 234,5" -> "1234.5", "500 PCS" -> "500".
    Fraction digits are kept as written; a lone comma followed by exactly three digits is a
    thousands separator, while a lone dot is always a decimal point.
    """
    match = _NUMBER.search(raw)
    if match is None:
        return None
    token = re.sub(r"[\s\u00a0\u202f']", "", match.group(0)).rstrip(".,")
    if not token or token in {"-", "+"}:
        return None
    sign = "-" if token.startswith("-") else ""
    token = token.lstrip("+-")

    last_dot, last_comma = token.rfind("."), token.rfind(",")
    if last_dot >= 0 and last_comma >= 0:
        decimal_sep = "." if last_dot > last_comma else ","
        thousands_sep = "," if decimal_sep == "." else "."
        integer, _, fraction = token.rpartition(decimal_sep)
        integer = integer.replace(thousands_sep, "")
    elif last_comma >= 0:
        parts = token.split(",")
        if len(parts) > 2 or len(parts[-1]) == 3:
            integer, fraction = token.replace(",", ""), ""
        else:
            integer, fraction = parts[0], parts[1]
    elif token.count(".") > 1:
        integer, fraction = token.replace(".", ""), ""
    else:
        integer, _, fraction = token.partition(".")

    if not integer.isdigit() or (fraction and not fraction.isdigit()):
        return None
    canonical = f"{sign}{int(integer)}" + (f".{fraction}" if fraction else "")
    try:
        Decimal(canonical)
    except InvalidOperation:
        return None
    return canonical


def parse_quantity(raw: str) -> Quantity | None:
    """Split "500 PCS", "12.5 KG", "5 CTNS", "USD 1,234.50" into a decimal value and a unit."""
    value = parse_decimal(raw)
    if value is None:
        return None
    unit: Unit | None = None
    for token in _UNIT_WORD.findall(raw):
        unit = known_unit(token)
        if unit is not None:
            break
    return Quantity(value=value, unit=unit, raw=raw.strip())


_DATE_FORMATS = (
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%Y.%m.%d",
    "%d %b %Y",
    "%d %B %Y",
    "%d-%b-%Y",
    "%d-%b-%y",
    "%b %d %Y",
    "%B %d %Y",
    "%d/%m/%Y",
    "%d.%m.%Y",
    "%d-%m-%Y",
    "%m/%d/%Y",
)


def parse_date(raw: str) -> str | None:
    """Return ISO yyyy-mm-dd. Numeric dates are read day-first, the trade-document convention."""
    cleaned = re.sub(r"\s+", " ", raw.replace(",", " ")).strip().rstrip(".")
    cleaned = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", cleaned)
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def compact_text(raw: str) -> str:
    return re.sub(r"\s+", " ", raw).strip()
