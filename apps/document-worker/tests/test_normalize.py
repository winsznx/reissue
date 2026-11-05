from __future__ import annotations

import pytest

from reissue_worker.normalize import normalize_unit, parse_date, parse_decimal, parse_quantity


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1,234.50", "1234.50"),
        ("1.234,50", "1234.50"),
        ("1 234,5", "1234.5"),
        ("1 234,5", "1234.5"),
        ("500 PCS", "500"),
        ("12.5 KG", "12.5"),
        ("5 CTNS", "5"),
        ("USD 14,406.00", "14406.00"),
        ("1,330", "1330"),
        ("12,5", "12.5"),
        ("0.60", "0.60"),
        ("1.234.567", "1234567"),
        ("-3.20", "-3.20"),
        ("007", "7"),
    ],
)
def test_parse_decimal_handles_locales(raw: str, expected: str) -> None:
    assert parse_decimal(raw) == expected


@pytest.mark.parametrize("raw", ["", "PCS", "n/a", "--"])
def test_parse_decimal_rejects_non_numbers(raw: str) -> None:
    assert parse_decimal(raw) is None


@pytest.mark.parametrize(
    ("raw", "value", "unit"),
    [
        ("500 PCS", "500", "pcs"),
        ("12.5 KG", "12.5", "kg"),
        ("5 CTNS", "5", "carton"),
        ("3 PLT", "3", "pallet"),
        ("20 lbs", "20", "lb"),
        ("1,234.50", "1234.50", None),
    ],
)
def test_parse_quantity_splits_value_and_unit(raw: str, value: str, unit: str | None) -> None:
    quantity = parse_quantity(raw)
    assert quantity is not None
    assert (quantity.value, quantity.unit, quantity.raw) == (value, unit, raw)


@pytest.mark.parametrize(
    ("token", "unit"),
    [
        ("pc", "pcs"),
        ("PCS", "pcs"),
        ("pieces", "pcs"),
        ("units", "pcs"),
        ("EA", "pcs"),
        ("ctn", "carton"),
        ("CTNS", "carton"),
        ("cartons", "carton"),
        ("cs", "carton"),
        ("KGS", "kg"),
        ("g", "g"),
        ("lbs", "lb"),
        ("plt", "pallet"),
        ("sets", "set"),
        ("pairs", "pair"),
        ("m", "m"),
        ("bundle", "unknown"),
    ],
)
def test_unit_aliases(token: str, unit: str) -> None:
    assert normalize_unit(token) == unit


@pytest.mark.parametrize(
    ("raw", "iso"),
    [
        ("14 Oct 2026", "2026-10-14"),
        ("Oct 14, 2026", "2026-10-14"),
        ("2026-10-14", "2026-10-14"),
        ("14/10/2026", "2026-10-14"),
        ("14.10.2026", "2026-10-14"),
        ("14th October 2026", "2026-10-14"),
    ],
)
def test_parse_date_to_iso(raw: str, iso: str) -> None:
    assert parse_date(raw) == iso


def test_parse_date_rejects_garbage() -> None:
    assert parse_date("next Tuesday") is None
