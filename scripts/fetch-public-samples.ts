import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Downloads the public sample shipping documents listed in tests/fixtures/public-samples.json,
 * checks each against its recorded SHA-256 and, with --extract, runs it through the document
 * worker and prints what was classified and found. Files land in .data/public-samples/ and
 * are never committed.
 *
 *   pnpm samples:fetch [--extract]
 */

interface Sample {
  id: string;
  docType: string;
  title: string;
  url: string;
  sha256: string;
  sizeBytes: number;
}

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = `${ROOT}.data/public-samples/`;
const WORKER = process.env.WORKER_URL ?? "http://127.0.0.1:4220";
const extract = process.argv.includes("--extract");
const { samples } = JSON.parse(await readFile(`${ROOT}tests/fixtures/public-samples.json`, "utf8")) as { samples: Sample[] };

await mkdir(OUT, { recursive: true });
let failures = 0;
const results: Record<string, unknown>[] = [];

for (const sample of samples) {
  let bytes: Buffer;
  try {
    const response = await fetch(sample.url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${sample.id}: download failed (${error instanceof Error ? error.message : String(error)})`);
    results.push({ id: sample.id, downloaded: false });
    continue;
  }
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== sample.sha256) {
    failures += 1;
    console.log(`FAIL ${sample.id}: SHA-256 ${sha} does not match recorded ${sample.sha256}; the publisher changed the file`);
    results.push({ id: sample.id, downloaded: true, hashMatches: false });
    continue;
  }
  await writeFile(`${OUT}${sample.id}.pdf`, bytes);
  const row: Record<string, unknown> = { id: sample.id, expected: sample.docType, downloaded: true, hashMatches: true };
  if (extract) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), "sample.pdf");
    const response = await fetch(`${WORKER}/v1/extract`, { method: "POST", body: form });
    const body = (await response.json()) as {
      parts?: { docType: string; pageStart: number; pageEnd: number; fields: unknown[]; lineItems: unknown[]; missingFields: string[]; classificationConfidence: number }[];
      error?: string;
    };
    row.parts = (body.parts ?? []).map((p) => ({ docType: p.docType, pages: `${p.pageStart}-${p.pageEnd}`, confidence: p.classificationConfidence, fields: p.fields.length, lineItems: p.lineItems.length, missing: p.missingFields }));
    if (body.error) row.error = body.error;
  }
  results.push(row);
  console.log(`ok   ${sample.id} (${bytes.length} bytes)${extract ? ` → ${JSON.stringify(row.parts ?? row.error)}` : ""}`);
}

await writeFile(`${OUT}results.json`, JSON.stringify({ fetchedAt: new Date().toISOString(), results }, null, 2));
process.exit(failures ? 1 : 0);
