import { describe, expect, it } from "vitest";

import { buildCorrectionSummaryPdf, buildDocumentIndexCsv, buildPacketZip, readZipEntries, sha256, verifyPacket, type PacketDocument } from "../src/index.js";

function doc(order: number, docType: string, versionNo: number, content: string, filename = "x.pdf"): PacketDocument {
  const bytes = Buffer.from(`%PDF-1.4 ${content}`);
  return {
    order,
    docType,
    versionId: `ver_${order}`,
    versionNo,
    originalFilename: filename,
    mime: "application/pdf",
    sha256: sha256(bytes),
    receivedAt: "2026-11-05T10:00:00Z",
    sourcePlatform: "telegram",
    senderName: "Supplier",
    bytes,
  };
}

describe("buildPacketZip", () => {
  it("stores current source files byte-identical to what was received", async () => {
    // #given
    const invoice = doc(1, "COMMERCIAL_INVOICE", 1, "invoice");
    const packing = doc(2, "PACKING_LIST", 2, "packing v2");
    // #when
    const packet = await buildPacketZip("SHP-0241", [packing, invoice], [{ name: "document-index.csv", bytes: Buffer.from("a,b\r\n") }]);
    const entries = await readZipEntries(packet.bytes);
    // #then
    expect(entries.get("01-commercial-invoice-v1.pdf")).toBe(invoice.sha256);
    expect(entries.get("02-packing-list-v2.pdf")).toBe(packing.sha256);
    expect(packet.filename).toBe("SHP-0241-current-documents.zip");
  });

  it("is deterministic for identical inputs", async () => {
    const docs = [doc(1, "COMMERCIAL_INVOICE", 1, "i")];
    const a = await buildPacketZip("SHP-1", docs, []);
    const b = await buildPacketZip("SHP-1", docs, []);
    expect(a.sha256).toBe(b.sha256);
  });

  it("refuses bytes that do not match the stored hash", async () => {
    const tampered = { ...doc(1, "COMMERCIAL_INVOICE", 1, "i"), bytes: Buffer.from("other") };
    await expect(buildPacketZip("SHP-1", [tampered], [])).rejects.toThrow(/Refusing to package/);
  });

  it("never uses sender filenames as entry paths", async () => {
    const hostile = doc(1, "PACKING_LIST", 1, "p", "../../etc/passwd.pdf");
    const packet = await buildPacketZip("SHP-1", [hostile], []);
    expect([...(await readZipEntries(packet.bytes)).keys()]).toEqual(["01-packing-list-v1.pdf"]);
  });

  it("verifies a packet against its manifest and reports drift", async () => {
    const packet = await buildPacketZip("SHP-1", [doc(1, "COMMERCIAL_INVOICE", 1, "i")], []);
    expect(await verifyPacket(packet.bytes, packet.entries)).toEqual({ ok: true, problems: [] });
    const drift = await verifyPacket(packet.bytes, [{ name: "01-commercial-invoice-v1.pdf", sha256: "0", sizeBytes: 1 }]);
    expect(drift.ok).toBe(false);
  });
});

describe("buildDocumentIndexCsv", () => {
  it("quotes separators and neutralizes formula-like cells", () => {
    const csv = buildDocumentIndexCsv([
      {
        packetName: "01-commercial-invoice-v1.pdf",
        docType: "COMMERCIAL_INVOICE",
        versionNo: 1,
        versionId: "ver_1",
        originalFilename: '=HYPERLINK("x"),inv.pdf',
        sourcePlatform: "slack",
        sender: "Ops, Team",
        receivedAt: "2026-11-05T10:00:00Z",
        status: "current",
        sha256: "abc",
      },
    ]).toString("utf8");
    expect(csv).toContain(`"'=HYPERLINK(""x""),inv.pdf"`);
    expect(csv).toContain(`"Ops, Team"`);
  });
});

describe("buildCorrectionSummaryPdf", () => {
  it("renders a valid PDF including non-WinAnsi symbols", async () => {
    const pdf = await buildCorrectionSummaryPdf({
      caseCode: "SHP-0241",
      epoch: 2,
      generatedAt: "2026-11-05T10:00:00.000Z",
      supplierName: "Hangzhou Lumen Lighting Co., Ltd.",
      invoiceReference: "HLL-2026-0417",
      purchaseOrder: "PO-88213",
      checkedFields: 12,
      documents: [
        { label: "Packing list", version: "v2", filename: "packing-list-v2.pdf", status: "current", receivedAt: "t", source: "telegram", sha256: "a".repeat(64) },
      ],
      resolutions: [{ code: "D-001", title: "Quantity mismatch", before: "500 pcs → 480 pcs", after: "500 pcs × 1", resolvedBy: "Supplier v2" }],
      replacements: [{ document: "Packing list v2", providedBy: "Li Wei", via: "Telegram", receivedAt: "t" }],
      remainingNotes: [],
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
