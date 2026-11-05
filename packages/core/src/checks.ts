import type {
  CheckResult,
  CheckRule,
  CheckSide,
  ConversionFactor,
  ExtractedField,
  ExtractedLineItem,
  FieldPath,
  Measure,
  Unit,
} from "@reissue/contracts";

import { field, type DocumentFacts } from "./facts.js";
import { DESCRIPTION_CONFIDENT, type AlignedPair } from "./matching.js";
import { Decimal, isPackageUnit, isWeightUnit, moneyEquals, sumDecimals, toKg, weightEquals } from "./numbers.js";
import { descriptionSimilarity, normalizePartyName, normalizeReference, normalizeSku } from "./text.js";

type LineRef = "quantity" | "packages" | "gross_weight" | "net_weight" | "description" | "amount" | "row";

function lineSide(doc: DocumentFacts, item: ExtractedLineItem, ref: LineRef, measure: Measure | null, raw?: string): CheckSide {
  return {
    versionId: doc.versionId,
    docType: doc.docType,
    ref: `line:${item.rowIndex}.${ref}`,
    raw: measure?.raw ?? raw ?? null,
    value: measure?.value ?? null,
    unit: measure?.unit ?? null,
    source: item.source,
  };
}

function fieldSide(doc: DocumentFacts, f: ExtractedField): CheckSide {
  return {
    versionId: doc.versionId,
    docType: doc.docType,
    ref: `field:${f.path}`,
    raw: f.raw,
    value: f.value,
    unit: f.unit,
    source: f.source,
  };
}

function check(
  key: string,
  rule: CheckRule,
  status: CheckResult["status"],
  label: string,
  detail: string,
  lhs: CheckSide | null,
  rhs: CheckSide | null,
  evidence: Record<string, unknown> = {},
  required = true,
): CheckResult {
  return { key, rule, status, required, label, lhs, rhs, detail, evidence };
}

function fmt(m: Measure): string {
  return `${new Decimal(m.value).toString()} ${m.unit}`;
}

function itemName(item: ExtractedLineItem): string {
  return item.sku ? `SKU ${item.sku}` : `“${item.description.slice(0, 40)}”`;
}

function findConversion(
  conversions: readonly ConversionFactor[],
  sku: string | null,
  from: Unit,
  to: Unit,
): ConversionFactor | null {
  const skuKey = sku ? normalizeSku(sku) : null;
  const candidates = conversions.filter((c) => c.fromUnit === from && c.toUnit === to);
  return (
    candidates.find((c) => skuKey !== null && normalizeSku(c.sku) === skuKey) ?? candidates.find((c) => c.sku === "*") ?? null
  );
}

/** Packing-list quantity: stated pieces if present, else the package count as a carton/pallet quantity. */
function packingQuantity(item: ExtractedLineItem): Measure | null {
  if (item.quantity) return item.quantity;
  if (item.packages) return { value: item.packages.count, unit: item.packages.type, raw: item.packages.raw };
  return null;
}

function compareQuantity(
  pair: AlignedPair,
  invoice: DocumentFacts,
  packing: DocumentFacts,
  conversions: readonly ConversionFactor[],
): CheckResult {
  const inv = pair.invoice!;
  const pl = pair.packing!;
  const rule: CheckRule = "quantity_equal_with_unit_normalization";
  const key = `${pair.key}.quantity`;
  const label = `Quantity · ${itemName(inv)}`;
  const invQ = inv.quantity;
  const plQ = packingQuantity(pl);
  const lhs = lineSide(invoice, inv, "quantity", invQ);
  const rhs = lineSide(packing, pl, "quantity", plQ);

  if (!invQ || !plQ) {
    const missingOn = !invQ ? "invoice" : "packing list";
    return check(key, rule, "MISSING", label, `No quantity found on the ${missingOn} for ${itemName(inv)}.`, lhs, rhs);
  }
  if (invQ.unit === plQ.unit) {
    const equal = new Decimal(invQ.value).equals(plQ.value);
    return check(
      key,
      rule,
      equal ? "MATCH" : "MISMATCH",
      label,
      equal ? `${fmt(invQ)} on both documents.` : `Invoice ${fmt(invQ)} vs packing list ${fmt(plQ)}.`,
      lhs,
      rhs,
      { lhs: invQ.value, rhs: plQ.value, unit: invQ.unit, difference: new Decimal(invQ.value).minus(plQ.value).toString() },
    );
  }

  const [countSide, packageSide] = isPackageUnit(plQ.unit) ? [invQ, plQ] : isPackageUnit(invQ.unit) ? [plQ, invQ] : [null, null];
  if (countSide && packageSide) {
    const human = findConversion(conversions, inv.sku, packageSide.unit, countSide.unit);
    const docFactor = !human && pl.piecesPerPackage ? pl.piecesPerPackage : null;
    const factor = human?.factor ?? docFactor;
    if (factor) {
      const converted = new Decimal(packageSide.value).times(factor);
      const equal = converted.equals(countSide.value);
      const conversion = human
        ? { factor, source: human.source, sourceReference: human.sourceReference }
        : { factor, source: "document", sourceReference: `packing list p.${pl.source.page} row ${pl.rowIndex + 1}` };
      return check(
        key,
        rule,
        equal ? "MATCH" : "MISMATCH",
        label,
        `${fmt(packageSide)} × ${factor} ${countSide.unit}/${packageSide.unit} = ${converted.toString()} ${countSide.unit}` +
          (equal ? `, equal to ${fmt(countSide)}.` : ` vs ${fmt(countSide)}.`),
        lhs,
        rhs,
        { lhs: invQ.value, rhs: plQ.value, converted: converted.toString(), conversion },
      );
    }
  }

  return check(
    key,
    rule,
    "NOT_COMPARABLE",
    label,
    `Invoice states ${fmt(invQ)}, packing list states ${fmt(plQ)}. No sourced conversion between ${invQ.unit} and ${plQ.unit}.`,
    lhs,
    rhs,
    { lhsUnit: invQ.unit, rhsUnit: plQ.unit },
  );
}

function compareWeight(
  key: string,
  rule: "gross_weight_equal_where_declared_on_both" | "net_weight_equal_where_declared_on_both",
  label: string,
  a: Measure,
  b: Measure,
  lhs: CheckSide,
  rhs: CheckSide,
): CheckResult {
  const aKg = isWeightUnit(a.unit) ? toKg(a.value, a.unit) : null;
  const bKg = isWeightUnit(b.unit) ? toKg(b.value, b.unit) : null;
  if (!aKg || !bKg) {
    return check(key, rule, "NOT_COMPARABLE", label, `Units ${a.unit} and ${b.unit} are not both weights.`, lhs, rhs);
  }
  const equal = weightEquals(aKg, bKg, a.value, b.value);
  return check(
    key,
    rule,
    equal ? "MATCH" : "MISMATCH",
    label,
    equal ? `${fmt(a)} on both documents.` : `Invoice ${fmt(a)} vs packing list ${fmt(b)}.`,
    lhs,
    rhs,
    { lhsKg: aKg.toString(), rhsKg: bKg.toString() },
  );
}

function fieldMeasure(f: ExtractedField): Measure {
  return { value: f.value, unit: f.unit ?? "unknown", raw: f.raw };
}

export function lineChecks(
  pairs: readonly AlignedPair[],
  invoice: DocumentFacts,
  packing: DocumentFacts,
  conversions: readonly ConversionFactor[],
): CheckResult[] {
  const results: CheckResult[] = [];
  for (const pair of pairs) {
    const inv = pair.invoice;
    const pl = pair.packing;
    if (inv && !pl) {
      results.push(
        check(
          `${pair.key}.presence`,
          "part_no_and_description_mapping",
          "MISSING",
          `Line presence · ${itemName(inv)}`,
          `${itemName(inv)} is on the invoice but no packing-list row could be matched to it.`,
          lineSide(invoice, inv, "row", null, inv.description),
          null,
        ),
      );
      continue;
    }
    if (!inv && pl) {
      results.push(
        check(
          `${pair.key}.presence`,
          "part_no_and_description_mapping",
          "MISSING",
          `Line presence · ${itemName(pl)}`,
          `${itemName(pl)} is on the packing list but no invoice row could be matched to it.`,
          null,
          lineSide(packing, pl, "row", null, pl.description),
        ),
      );
      continue;
    }
    if (!inv || !pl) continue;

    const similarity = descriptionSimilarity(inv.description, pl.description);
    const byDescription = pair.match.method === "description_similarity";
    const weakDescription = byDescription ? pair.match.confidence < DESCRIPTION_CONFIDENT : similarity < 0.5;
    results.push(
      check(
        `${pair.key}.mapping`,
        "part_no_and_description_mapping",
        weakDescription ? "AMBIGUOUS" : "MATCH",
        `Line mapping · ${itemName(inv)}`,
        byDescription
          ? `Matched by description (similarity ${similarity.toFixed(2)}); no shared SKU.`
          : pair.match.method === "human_confirmed"
            ? "Mapping confirmed by a person."
            : weakDescription
              ? `Same SKU but descriptions differ (similarity ${similarity.toFixed(2)}).`
              : "Same SKU and consistent description.",
        lineSide(invoice, inv, "description", null, inv.description),
        lineSide(packing, pl, "description", null, pl.description),
        { method: pair.match.method, similarity },
        byDescription,
      ),
    );

    results.push(compareQuantity(pair, invoice, packing, conversions));

    if (inv.packages && pl.packages && inv.packages.type === pl.packages.type) {
      const equal = new Decimal(inv.packages.count).equals(pl.packages.count);
      results.push(
        check(
          `${pair.key}.packages`,
          "package_count_consistency",
          equal ? "MATCH" : "MISMATCH",
          `Packages · ${itemName(inv)}`,
          `Invoice ${inv.packages.count} ${inv.packages.type} vs packing list ${pl.packages.count} ${pl.packages.type}.`,
          lineSide(invoice, inv, "packages", { value: inv.packages.count, unit: inv.packages.type, raw: inv.packages.raw }),
          lineSide(packing, pl, "packages", { value: pl.packages.count, unit: pl.packages.type, raw: pl.packages.raw }),
        ),
      );
    }
    if (inv.grossWeight && pl.grossWeight) {
      results.push(
        compareWeight(
          `${pair.key}.gross_weight`,
          "gross_weight_equal_where_declared_on_both",
          `Gross weight · ${itemName(inv)}`,
          inv.grossWeight,
          pl.grossWeight,
          lineSide(invoice, inv, "gross_weight", inv.grossWeight),
          lineSide(packing, pl, "gross_weight", pl.grossWeight),
        ),
      );
    }
    if (inv.netWeight && pl.netWeight) {
      results.push(
        compareWeight(
          `${pair.key}.net_weight`,
          "net_weight_equal_where_declared_on_both",
          `Net weight · ${itemName(inv)}`,
          inv.netWeight,
          pl.netWeight,
          lineSide(invoice, inv, "net_weight", inv.netWeight),
          lineSide(packing, pl, "net_weight", pl.netWeight),
        ),
      );
    }
  }
  return results;
}

export function invoiceArithmeticChecks(invoice: DocumentFacts): CheckResult[] {
  const results: CheckResult[] = [];
  for (const item of invoice.lineItems) {
    if (!item.quantity || !item.unitPrice || !item.amount) continue;
    const expected = new Decimal(item.quantity.value).times(item.unitPrice);
    const equal = moneyEquals(expected, new Decimal(item.amount));
    results.push(
      check(
        `arith:line:${item.sku ? normalizeSku(item.sku) : item.rowIndex}`,
        "line_total_arithmetic",
        equal ? "MATCH" : "MISMATCH",
        `Line total · ${itemName(item)}`,
        `${item.quantity.value} × ${item.unitPrice} = ${expected.toFixed(2)}; invoice states ${item.amount}.`,
        lineSide(invoice, item, "amount", null, item.amount),
        null,
        { expected: expected.toFixed(2), stated: item.amount },
      ),
    );
  }
  const total = field(invoice, "total_amount");
  const amounts = invoice.lineItems.map((l) => l.amount).filter((a): a is string => a !== null);
  if (total && amounts.length > 0 && amounts.length === invoice.lineItems.length) {
    const sum = sumDecimals(amounts);
    const equal = moneyEquals(sum, new Decimal(total.value));
    results.push(
      check(
        "arith:grand_total",
        "invoice_grand_total_arithmetic",
        equal ? "MATCH" : "MISMATCH",
        "Invoice grand total",
        `Sum of ${amounts.length} line amounts = ${sum.toFixed(2)}; invoice total states ${total.value}.`,
        fieldSide(invoice, total),
        null,
        { sum: sum.toFixed(2), stated: total.value },
      ),
    );
  }
  return results;
}

export function packingInternalChecks(packing: DocumentFacts): CheckResult[] {
  const total = field(packing, "total_packages");
  const counts = packing.lineItems.map((l) => l.packages?.count).filter((c): c is string => c !== undefined);
  if (!total || counts.length === 0 || counts.length !== packing.lineItems.length) return [];
  const sum = sumDecimals(counts);
  const equal = sum.equals(total.value);
  return [
    check(
      "packages:packing_list_sum",
      "package_count_consistency",
      equal ? "MATCH" : "MISMATCH",
      "Packing-list carton total",
      `Rows add up to ${sum.toString()} packages; total line states ${total.value}.`,
      fieldSide(packing, total),
      null,
      { sum: sum.toString(), stated: total.value },
    ),
  ];
}

const TOTAL_WEIGHT_RULES: ReadonlyArray<
  [FieldPath, "gross_weight_equal_where_declared_on_both" | "net_weight_equal_where_declared_on_both", string]
> = [
  ["total_gross_weight", "gross_weight_equal_where_declared_on_both", "Total gross weight"],
  ["total_net_weight", "net_weight_equal_where_declared_on_both", "Total net weight"],
];

export function documentChecks(invoice: DocumentFacts, packing: DocumentFacts): CheckResult[] {
  const results: CheckResult[] = [];

  for (const [path, rule, label] of TOTAL_WEIGHT_RULES) {
    const a = field(invoice, path);
    const b = field(packing, path);
    if (a && b) {
      results.push(compareWeight(`total:${path}`, rule, label, fieldMeasure(a), fieldMeasure(b), fieldSide(invoice, a), fieldSide(packing, b)));
    }
  }

  const invPackages = field(invoice, "total_packages");
  const plPackages = field(packing, "total_packages");
  if (invPackages && plPackages) {
    const equal = new Decimal(invPackages.value).equals(plPackages.value) && invPackages.unit === plPackages.unit;
    results.push(
      check(
        "total:total_packages",
        "package_count_consistency",
        equal ? "MATCH" : "MISMATCH",
        "Total packages",
        `Invoice ${invPackages.raw} vs packing list ${plPackages.raw}.`,
        fieldSide(invoice, invPackages),
        fieldSide(packing, plPackages),
      ),
    );
  }

  for (const path of ["purchase_order", "invoice_number"] as const) {
    const a = field(invoice, path);
    const b = field(packing, path);
    if (!a || !b) continue;
    const equal = normalizeReference(a.value) === normalizeReference(b.value);
    results.push(
      check(
        `ref:${path}`,
        "po_and_invoice_reference_consistency",
        equal ? "MATCH" : "MISMATCH",
        path === "purchase_order" ? "Purchase order reference" : "Invoice reference",
        equal ? `${a.value} on both documents.` : `Invoice ${a.value} vs packing list ${b.value}.`,
        fieldSide(invoice, a),
        fieldSide(packing, b),
      ),
    );
  }

  for (const path of ["seller", "buyer", "consignee"] as const) {
    const a = field(invoice, path);
    const b = field(packing, path);
    if (!a || !b) continue;
    const equal = normalizePartyName(a.value) === normalizePartyName(b.value);
    results.push(
      check(
        `party:${path}`,
        "party_name_consistency",
        equal ? "MATCH" : "MISMATCH",
        `${path[0]!.toUpperCase()}${path.slice(1)} name`,
        equal ? `${a.value.split("\n")[0]} on both documents.` : `Invoice “${a.value}” vs packing list “${b.value}”.`,
        fieldSide(invoice, a),
        fieldSide(packing, b),
      ),
    );
  }

  return results;
}

export function missingFieldChecks(doc: DocumentFacts): CheckResult[] {
  return doc.missingFields.map((path) =>
    check(
      `missing:${doc.docType}:${path}`,
      "missing_required_document_field",
      "MISSING",
      `Missing ${path.replace(/_/g, " ")}`,
      `Required field ${path.replace(/_/g, " ")} was not found on the ${doc.docType === "COMMERCIAL_INVOICE" ? "invoice" : "packing list"}.`,
      { versionId: doc.versionId, docType: doc.docType, ref: `field:${path}`, raw: null, value: null, unit: null, source: null },
      null,
    ),
  );
}
