import { Decimal } from "decimal.js";

import type { Unit } from "@reissue/contracts";

export { Decimal };

const WEIGHT_TO_KG: Partial<Record<Unit, Decimal>> = {
  kg: new Decimal(1),
  g: new Decimal("0.001"),
  lb: new Decimal("0.45359237"),
};

const COUNT_UNITS: ReadonlySet<Unit> = new Set<Unit>(["pcs", "set", "pair"]);
const PACKAGE_UNITS: ReadonlySet<Unit> = new Set<Unit>(["carton", "pallet"]);

export function isWeightUnit(unit: Unit): boolean {
  return unit in WEIGHT_TO_KG;
}

export function isPackageUnit(unit: Unit): boolean {
  return PACKAGE_UNITS.has(unit);
}

export function isCountUnit(unit: Unit): boolean {
  return COUNT_UNITS.has(unit);
}

export function toKg(value: string, unit: Unit): Decimal | null {
  const factor = WEIGHT_TO_KG[unit];
  return factor ? new Decimal(value).times(factor) : null;
}

/**
 * Parses human-entered decimals with either separator convention.
 * Returns null instead of guessing when the string is ambiguous ("1,234" could be 1.234 or 1234).
 */
export function parseLocaleDecimal(input: string): string | null {
  const cleaned = input.trim().replace(/[\s\u00a0\u202f']/g, "");
  if (!/^-?[\d.,]+$/.test(cleaned)) return null;
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSep = lastDot > lastComma ? "." : ",";
    const groupSep = decimalSep === "." ? "," : ".";
    normalized = cleaned.split(groupSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    const parts = cleaned.split(",");
    const tail = parts[parts.length - 1] ?? "";
    if (parts.length > 2) normalized = parts.join("");
    else if (tail.length === 3) return null;
    else normalized = cleaned.replace(",", ".");
  } else {
    const parts = cleaned.split(".");
    normalized = parts.length > 2 ? parts.join("") : cleaned;
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return new Decimal(normalized).toString();
}

export function decimalEquals(a: string, b: string): boolean {
  return new Decimal(a).equals(new Decimal(b));
}

export function sumDecimals(values: readonly string[]): Decimal {
  return values.reduce((acc, v) => acc.plus(v), new Decimal(0));
}

/** Money comparison at cent precision, rounding half-up as invoices do. */
export function moneyEquals(a: Decimal, b: Decimal): boolean {
  return a.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).equals(b.toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
}

/** Weights printed with different precision (12.5 vs 12.50 vs 12.504) compare at the coarser declared precision. */
export function weightEquals(aKg: Decimal, bKg: Decimal, aDeclared: string, bDeclared: string): boolean {
  const places = Math.min(new Decimal(aDeclared).decimalPlaces(), new Decimal(bDeclared).decimalPlaces(), 3);
  return aKg.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).equals(bKg.toDecimalPlaces(places, Decimal.ROUND_HALF_UP));
}
