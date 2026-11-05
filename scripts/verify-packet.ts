import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { readZipEntries } from "@reissue/artifacts";
import yauzl from "yauzl";

/**
 * Independently verifies a downloaded Reissue packet:
 *   - every entry's SHA-256 matches document-index.csv inside the ZIP
 *   - with --source <file>..., each named original is byte-identical to a packet entry
 *
 *   pnpm verify:packet SHP-0241-current-documents.zip [--source invoice-v1.pdf packing-list-v2.pdf]
 */

const args = process.argv.slice(2);
const zipPath = args[0];
if (!zipPath) {
  console.error("usage: verify-packet <packet.zip> [--source <original file>...]");
  process.exit(2);
}
const sourceIndex = args.indexOf("--source");
const sources = sourceIndex >= 0 ? args.slice(sourceIndex + 1) : [];

async function readEntry(bytes: Buffer, name: string): Promise<string> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true }, (e, z) => (e ? reject(e) : resolve(z))));
  return new Promise((resolve, reject) => {
    zip.on("entry", (entry: yauzl.Entry) => {
      if (entry.fileName !== name) return zip.readEntry();
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return reject(err ?? new Error("no stream"));
        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      });
    });
    zip.on("end", () => reject(new Error(`${name} not found in packet`)));
    zip.readEntry();
  });
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  const [header, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i] ?? ""])));
}

const bytes = await readFile(zipPath);
const entries = await readZipEntries(bytes);
const index = parseCsv(await readEntry(bytes, "document-index.csv"));
const problems: string[] = [];

console.log(`Packet ${basename(zipPath)} (sha256 ${createHash("sha256").update(bytes).digest("hex")})`);
for (const row of index.filter((r) => r.status === "current")) {
  const actual = entries.get(row.packet_name!);
  const ok = actual === row.sha256;
  console.log(`${ok ? "ok  " : "FAIL"} ${row.packet_name} v${row.version} ${row.doc_type} from ${row.source}${row.sender ? ` (${row.sender})` : ""}`);
  if (!ok) problems.push(`${row.packet_name}: index ${row.sha256}, packet ${actual ?? "missing"}`);
}
for (const row of index.filter((r) => r.status === "superseded")) console.log(`hist ${row.original_filename} v${row.version} superseded, not in packet`);

for (const source of sources) {
  const sha = createHash("sha256").update(await readFile(source)).digest("hex");
  const hit = [...entries].find(([, h]) => h === sha);
  console.log(`${hit ? "ok  " : "FAIL"} source ${basename(source)} ${hit ? `is byte-identical to ${hit[0]}` : "is not in the packet"}`);
  if (!hit) problems.push(`${source} not found in packet`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("\nPacket verified.");
