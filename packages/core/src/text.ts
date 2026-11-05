const LEGAL_SUFFIXES = [
  "co ltd",
  "company limited",
  "co limited",
  "limited",
  "ltd",
  "llc",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "gmbh",
  "bv",
  "b v",
  "sa",
  "sarl",
  "srl",
  "spa",
  "plc",
  "pte ltd",
  "pty ltd",
  "co",
];

export function normalizeSku(sku: string): string {
  return sku.toUpperCase().replace(/[\s\-_./]/g, "");
}

export function normalizeText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Party names compare equal across punctuation, case and legal-form spelling ("Co., Ltd." vs "Co Ltd"). */
export function normalizePartyName(name: string): string {
  let text = normalizeText(name.split(/\n/)[0] ?? name);
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (text.endsWith(" " + suffix)) {
        text = text.slice(0, -suffix.length - 1).trim();
        changed = true;
      }
    }
  }
  return text;
}

export function normalizeReference(ref: string): string {
  return ref.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function bigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  const padded = ` ${text} `;
  for (let i = 0; i < padded.length - 1; i++) {
    const gram = padded.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Sørensen–Dice coefficient over character bigrams of normalized text. */
export function descriptionSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let overlap = 0;
  let total = 0;
  for (const count of ga.values()) total += count;
  for (const count of gb.values()) total += count;
  for (const [gram, count] of ga) overlap += Math.min(count, gb.get(gram) ?? 0);
  return (2 * overlap) / total;
}
