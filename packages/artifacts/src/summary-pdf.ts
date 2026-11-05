import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface SummaryDocumentRow {
  label: string;
  version: string;
  filename: string;
  status: "current" | "superseded";
  receivedAt: string;
  source: string;
  sha256: string;
}

export interface SummaryResolution {
  code: string;
  title: string;
  before: string;
  after: string;
  resolvedBy: string;
}

export interface CorrectionSummaryInput {
  caseCode: string;
  epoch: number;
  generatedAt: string;
  supplierName: string | null;
  invoiceReference: string | null;
  purchaseOrder: string | null;
  checkedFields: number;
  documents: SummaryDocumentRow[];
  resolutions: SummaryResolution[];
  replacements: { document: string; providedBy: string; via: string; receivedAt: string }[];
  remainingNotes: string[];
}

const INK = rgb(0.094, 0.125, 0.125);
const MUTED = rgb(0.4, 0.44, 0.42);
const RULE = rgb(0.82, 0.81, 0.78);
const MARGIN = 54;
const WIDTH = 595.28;
const HEIGHT = 841.89;

/** Standard PDF fonts only encode WinAnsi; map the few symbols we use and drop anything else. */
function winAnsi(text: string): string {
  return text
    .replace(/→/g, "->")
    .replace(/×/g, "x")
    .replace(/[^\x20-\x7e\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026]/g, "?");
}

class Writer {
  private page: PDFPage;
  private y = HEIGHT - MARGIN;

  constructor(
    private readonly doc: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
    private readonly footer: string,
  ) {
    this.page = this.addPage();
  }

  private addPage(): PDFPage {
    const page = this.doc.addPage([WIDTH, HEIGHT]);
    page.drawText(winAnsi(this.footer), { x: MARGIN, y: 30, size: 7.5, font: this.regular, color: MUTED });
    return page;
  }

  private ensure(height: number): void {
    if (this.y - height < 50) {
      this.page = this.addPage();
      this.y = HEIGHT - MARGIN;
    }
  }

  private wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    for (const paragraph of winAnsi(text).split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) > width && line) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}): void {
    const size = opts.size ?? 9.5;
    const font = opts.bold ? this.bold : this.regular;
    const indent = opts.indent ?? 0;
    for (const line of this.wrap(text, font, size, WIDTH - MARGIN * 2 - indent)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x: MARGIN + indent, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= size + 4;
    }
    this.y -= opts.gap ?? 0;
  }

  heading(text: string): void {
    this.ensure(40);
    this.y -= 10;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: WIDTH - MARGIN, y: this.y }, thickness: 0.6, color: RULE });
    this.y -= 6;
    this.text(text.toUpperCase(), { size: 8.5, bold: true, color: MUTED, gap: 4 });
  }
}

/**
 * Generates correction-summary.pdf deterministically from case data. It describes what the
 * case contains; it never signs, certifies or speaks for an issuer or customs authority.
 */
export async function buildCorrectionSummaryPdf(input: CorrectionSummaryInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const generated = new Date(input.generatedAt);
  doc.setTitle(`${input.caseCode} correction summary`);
  doc.setProducer("Reissue");
  doc.setCreator("Reissue");
  doc.setCreationDate(generated);
  doc.setModificationDate(generated);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(
    doc,
    regular,
    bold,
    `${input.caseCode} · epoch ${input.epoch} · generated ${input.generatedAt} · Internal consistency summary, not a customs determination.`,
  );

  w.text("Correction summary", { size: 20, bold: true, gap: 2 });
  w.text(`${input.caseCode} · Ready for broker review`, { size: 11, color: MUTED, gap: 6 });
  w.text(
    "Ready for broker review means the current commercial invoice and packing list passed every configured internal consistency check. It does not mean customs has reviewed or accepted the shipment.",
    { size: 8.5, color: MUTED, gap: 4 },
  );

  w.heading("Shipment");
  w.text(`Supplier: ${input.supplierName ?? "not stated"}`);
  w.text(`Invoice reference: ${input.invoiceReference ?? "not stated"}`);
  w.text(`Purchase order: ${input.purchaseOrder ?? "not stated"}`);
  w.text(`Checked fields in final pass: ${input.checkedFields}`);

  w.heading("Resolved discrepancies");
  if (input.resolutions.length === 0) w.text("None. The original documents were consistent.");
  for (const r of input.resolutions) {
    w.text(`${r.code} · ${r.title}`, { bold: true });
    w.text(`Before: ${r.before}`, { indent: 12 });
    w.text(`After: ${r.after}`, { indent: 12 });
    w.text(`Resolved by: ${r.resolvedBy}`, { indent: 12, color: MUTED, gap: 4 });
  }

  w.heading("Replacement provenance");
  if (input.replacements.length === 0) w.text("No replacement documents were needed.");
  for (const r of input.replacements) w.text(`${r.document} provided by ${r.providedBy} via ${r.via} at ${r.receivedAt}.`);

  w.heading("Document index");
  for (const d of input.documents) {
    w.text(`${d.label} ${d.version} · ${d.status}`, { bold: d.status === "current" });
    w.text(`${d.filename} · ${d.source} · ${d.receivedAt}`, { indent: 12, size: 8.5 });
    w.text(`SHA-256 ${d.sha256}`, { indent: 12, size: 7.5, color: MUTED, gap: 2 });
  }

  w.heading("Remaining notes");
  if (input.remainingNotes.length === 0) w.text("No open questions.");
  for (const note of input.remainingNotes) w.text(`• ${note}`);

  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
