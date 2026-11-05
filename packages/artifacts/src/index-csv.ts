export interface IndexRow {
  packetName: string;
  docType: string;
  versionNo: number;
  versionId: string;
  originalFilename: string;
  sourcePlatform: string;
  sender: string;
  receivedAt: string;
  status: "current" | "superseded" | "generated";
  sha256: string;
}

const HEADER = ["packet_name", "doc_type", "version", "version_id", "original_filename", "source", "sender", "received_at", "status", "sha256"];

/** RFC 4180 quoting, plus a leading quote on values a spreadsheet would evaluate as formulas. */
function cell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildDocumentIndexCsv(rows: readonly IndexRow[]): Buffer {
  const lines = [HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [r.packetName, r.docType, r.versionNo, r.versionId, r.originalFilename, r.sourcePlatform, r.sender, r.receivedAt, r.status, r.sha256]
        .map(cell)
        .join(","),
    );
  }
  return Buffer.from(lines.join("\r\n") + "\r\n", "utf8");
}
