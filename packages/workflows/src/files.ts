import { createHash } from "node:crypto";

export type AcceptedMime =
  | "application/pdf"
  | "image/png"
  | "image/jpeg"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type FileCheck =
  | { ok: true; mime: AcceptedMime; sha256: string }
  | { ok: false; reason: "empty" | "too_large" | "unsupported_type" | "suspicious"; detail: string };

/** Detects type from content, never from the name the sender chose. */
export function sniffMime(bytes: Buffer): AcceptedMime | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    const head = bytes.subarray(0, Math.min(bytes.length, 64 * 1024)).toString("latin1");
    if (head.includes("xl/") || head.includes("[Content_Types].xml")) {
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }
  }
  return null;
}

/**
 * Static screening applied before any parser sees the file. PDFs that embed JavaScript,
 * launch actions or embedded executables are held for review rather than parsed.
 */
export function checkFile(bytes: Buffer, maxBytes: number): FileCheck {
  if (bytes.length === 0) return { ok: false, reason: "empty", detail: "The file is empty." };
  if (bytes.length > maxBytes) {
    return { ok: false, reason: "too_large", detail: `The file is ${(bytes.length / 1048576).toFixed(1)} MB; the limit is ${(maxBytes / 1048576).toFixed(0)} MB.` };
  }
  const mime = sniffMime(bytes);
  if (!mime) return { ok: false, reason: "unsupported_type", detail: "Only PDF, PNG, JPEG and XLSX files are accepted." };
  if (mime === "application/pdf") {
    const text = bytes.toString("latin1");
    const markers = ["/JavaScript", "/JS ", "/JS(", "/Launch", "/EmbeddedFile", "/RichMedia"].filter((m) => text.includes(m));
    if (markers.length) return { ok: false, reason: "suspicious", detail: `PDF contains active content (${markers.join(", ")}).` };
  }
  if (mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" && bytes.toString("latin1").includes("vbaProject.bin")) {
    return { ok: false, reason: "suspicious", detail: "Spreadsheet contains macros." };
  }
  return { ok: true, mime, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** Display-only filename: strips paths and control characters; never used to build a filesystem path. */
export function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = [...base]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .trim()
    .slice(0, 160);
  return cleaned || "file";
}
