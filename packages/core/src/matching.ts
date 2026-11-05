import type { ExtractedLineItem, LineMappingOverride, LineMatch } from "@reissue/contracts";

import { solveAssignment } from "./assignment.js";
import { decimalEquals } from "./numbers.js";
import { descriptionSimilarity, normalizeSku, normalizeText } from "./text.js";

/** Below this description similarity, rows without a shared SKU are never paired. */
export const DESCRIPTION_MATCH_FLOOR = 0.6;
/** Description-only pairs under this similarity are kept but flagged for review. */
export const DESCRIPTION_CONFIDENT = 0.8;

export interface AlignedPair {
  key: string;
  invoice: ExtractedLineItem | null;
  packing: ExtractedLineItem | null;
  match: LineMatch;
}

function lineKey(item: ExtractedLineItem, occurrence: number, side: "inv" | "pl"): string {
  const base = item.sku ? normalizeSku(item.sku) : `desc:${normalizeText(item.description).slice(0, 48)}`;
  const suffix = occurrence > 0 ? `#${occurrence + 1}` : "";
  return side === "inv" ? `line:${base}${suffix}` : `line-extra:${base}${suffix}`;
}

function pairCost(inv: ExtractedLineItem, pl: ExtractedLineItem): number {
  const similarity = descriptionSimilarity(inv.description, pl.description);
  if (inv.sku && pl.sku) {
    if (normalizeSku(inv.sku) !== normalizeSku(pl.sku)) return Number.POSITIVE_INFINITY;
    const sameQty =
      inv.quantity && pl.quantity && inv.quantity.unit === pl.quantity.unit && decimalEquals(inv.quantity.value, pl.quantity.value);
    return (sameQty ? 0 : 0.05) + (1 - similarity) * 0.1;
  }
  if (similarity < DESCRIPTION_MATCH_FLOOR) return Number.POSITIVE_INFINITY;
  return 1 + (1 - similarity);
}

/**
 * Aligns invoice rows to packing-list rows: human-confirmed overrides first, then a global
 * assignment over SKU equality and description similarity. Weak candidates stay unmatched.
 */
export function alignLineItems(
  invoiceLines: readonly ExtractedLineItem[],
  packingLines: readonly ExtractedLineItem[],
  overrides: readonly LineMappingOverride[] = [],
): AlignedPair[] {
  const fixed = new Map<number, number>();
  const usedPacking = new Set<number>();
  for (const o of overrides) {
    const invIdx = invoiceLines.findIndex((l) => l.rowIndex === o.invoiceRow);
    const plIdx = packingLines.findIndex((l) => l.rowIndex === o.packingRow);
    if (invIdx >= 0 && plIdx >= 0 && !fixed.has(invIdx) && !usedPacking.has(plIdx)) {
      fixed.set(invIdx, plIdx);
      usedPacking.add(plIdx);
    }
  }

  const freeInv = invoiceLines.map((_, i) => i).filter((i) => !fixed.has(i));
  const freePl = packingLines.map((_, j) => j).filter((j) => !usedPacking.has(j));
  const cost = freeInv.map((i) => freePl.map((j) => pairCost(invoiceLines[i]!, packingLines[j]!)));
  const solved = solveAssignment(cost);

  const assignment = new Map<number, { pl: number; method: LineMatch["method"]; confidence: number }>();
  for (const [invIdx, plIdx] of fixed) assignment.set(invIdx, { pl: plIdx, method: "human_confirmed", confidence: 1 });
  solved.forEach((col, r) => {
    if (col < 0) return;
    const i = freeInv[r]!;
    const j = freePl[col]!;
    const inv = invoiceLines[i]!;
    const pl = packingLines[j]!;
    const bySku = Boolean(inv.sku && pl.sku);
    assignment.set(i, {
      pl: j,
      method: bySku ? "sku_exact" : "description_similarity",
      confidence: bySku ? 1 : Number(descriptionSimilarity(inv.description, pl.description).toFixed(3)),
    });
    usedPacking.add(j);
  });

  const seen = new Map<string, number>();
  const occurrence = (base: string): number => {
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n;
  };

  const pairs: AlignedPair[] = invoiceLines.map((inv, i) => {
    const key = lineKey(inv, occurrence(lineKey(inv, 0, "inv")), "inv");
    const hit = assignment.get(i);
    const packing = hit ? packingLines[hit.pl]! : null;
    return {
      key,
      invoice: inv,
      packing,
      match: {
        key,
        invoiceRow: inv.rowIndex,
        packingRow: packing?.rowIndex ?? null,
        method: hit?.method ?? "unmatched",
        confidence: hit?.confidence ?? 0,
      },
    };
  });

  packingLines.forEach((pl, j) => {
    if (usedPacking.has(j)) return;
    const key = lineKey(pl, occurrence(lineKey(pl, 0, "pl")), "pl");
    pairs.push({
      key,
      invoice: null,
      packing: pl,
      match: { key, invoiceRow: null, packingRow: pl.rowIndex, method: "unmatched", confidence: 0 },
    });
  });

  return pairs;
}
