import { createHash } from "node:crypto";

import yauzl from "yauzl";
import yazl from "yazl";

export interface PacketDocument {
  /** Position in the packet, e.g. 1 for the invoice. */
  order: number;
  docType: string;
  versionId: string;
  versionNo: number;
  originalFilename: string;
  mime: string;
  sha256: string;
  receivedAt: string;
  sourcePlatform: string;
  senderName: string | null;
  /** Unaltered bytes exactly as received. */
  bytes: Buffer;
}

export interface PacketEntry {
  name: string;
  sha256: string;
  sizeBytes: number;
}

export interface BuiltPacket {
  filename: string;
  bytes: Buffer;
  sha256: string;
  entries: PacketEntry[];
}

const FIXED_MTIME = new Date("2000-01-01T00:00:00Z");
const SAFE_NAME = /[^a-z0-9.-]+/g;

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function extensionFor(doc: PacketDocument): string {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(doc.originalFilename)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  if (doc.mime === "application/pdf") return "pdf";
  if (doc.mime === "image/png") return "png";
  if (doc.mime === "image/jpeg") return "jpg";
  return "bin";
}

/** Packet entry names are generated, never taken from senders, so no path traversal can enter the archive. */
export function packetEntryName(doc: PacketDocument): string {
  const type = doc.docType.toLowerCase().replace(/_/g, "-").replace(SAFE_NAME, "-");
  return `${String(doc.order).padStart(2, "0")}-${type}-v${doc.versionNo}.${extensionFor(doc)}`;
}

/**
 * Builds the broker packet: current supplier-issued files byte-for-byte, plus generated
 * summary and index. Entry order and timestamps are fixed so the same inputs give the same ZIP.
 */
export async function buildPacketZip(
  caseCode: string,
  documents: readonly PacketDocument[],
  generated: readonly { name: string; bytes: Buffer }[],
): Promise<BuiltPacket> {
  const zip = new yazl.ZipFile();
  const entries: PacketEntry[] = [];
  const seen = new Set<string>();
  for (const doc of [...documents].sort((a, b) => a.order - b.order)) {
    const actual = sha256(doc.bytes);
    if (actual !== doc.sha256) throw new Error(`Refusing to package ${doc.versionId}: stored hash ${doc.sha256} != bytes ${actual}`);
    const name = packetEntryName(doc);
    if (seen.has(name)) continue;
    seen.add(name);
    zip.addBuffer(doc.bytes, name, { mtime: FIXED_MTIME, compress: false });
    entries.push({ name, sha256: actual, sizeBytes: doc.bytes.length });
  }
  for (const file of generated) {
    zip.addBuffer(file.bytes, file.name, { mtime: FIXED_MTIME });
    entries.push({ name: file.name, sha256: sha256(file.bytes), sizeBytes: file.bytes.length });
  }
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);
  return { filename: `${caseCode}-current-documents.zip`, bytes, sha256: sha256(bytes), entries };
}

/** Re-opens a packet and hashes every entry, for post-generation and independent verification. */
export async function readZipEntries(bytes: Buffer): Promise<Map<string, string>> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (err, z) => (err ? reject(err) : resolve(z))),
  );
  const hashes = new Map<string, string>();
  await new Promise<void>((resolve, reject) => {
    zip.on("entry", (entry: yauzl.Entry) => {
      if (entry.fileName.includes("..") || entry.fileName.startsWith("/")) {
        reject(new Error(`Unsafe entry name ${entry.fileName}`));
        return;
      }
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          reject(err ?? new Error("no stream"));
          return;
        }
        const hash = createHash("sha256");
        stream.on("data", (c: Buffer) => hash.update(c));
        stream.on("end", () => {
          hashes.set(entry.fileName, hash.digest("hex"));
          zip.readEntry();
        });
        stream.on("error", reject);
      });
    });
    zip.on("end", () => resolve());
    zip.on("error", reject);
    zip.readEntry();
  });
  return hashes;
}

export async function verifyPacket(bytes: Buffer, expected: readonly PacketEntry[]): Promise<{ ok: boolean; problems: string[] }> {
  const actual = await readZipEntries(bytes);
  const problems: string[] = [];
  for (const entry of expected) {
    const hash = actual.get(entry.name);
    if (!hash) problems.push(`${entry.name} missing`);
    else if (hash !== entry.sha256) problems.push(`${entry.name} hash ${hash} != ${entry.sha256}`);
  }
  for (const name of actual.keys()) if (!expected.some((e) => e.name === name)) problems.push(`${name} unexpected`);
  return { ok: problems.length === 0, problems };
}
