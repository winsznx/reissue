import { describe, expect, it } from "vitest";

import { checkFile, safeDisplayName, sniffMime } from "../src/files.js";

const pdf = (body: string) => Buffer.from(`%PDF-1.7\n${body}\n%%EOF`);

describe("sniffMime", () => {
  it("detects by magic bytes, not by name", () => {
    expect(sniffMime(pdf("x"))).toBe("application/pdf");
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(Buffer.from("MZ\x90\x00 executable"))).toBeNull();
  });
});

describe("checkFile", () => {
  it("accepts a clean PDF and returns its SHA-256", () => {
    const result = checkFile(pdf("invoice"), 1024);
    expect(result).toMatchObject({ ok: true, mime: "application/pdf" });
    expect(result.ok && result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("rejects empty, oversized and unsupported files with a reason", () => {
    expect(checkFile(Buffer.alloc(0), 10)).toMatchObject({ ok: false, reason: "empty" });
    expect(checkFile(pdf("x".repeat(100)), 10)).toMatchObject({ ok: false, reason: "too_large" });
    expect(checkFile(Buffer.from("hello"), 100)).toMatchObject({ ok: false, reason: "unsupported_type" });
  });
  it("holds PDFs with active content for review", () => {
    expect(checkFile(pdf("<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>"), 1024)).toMatchObject({ ok: false, reason: "suspicious" });
  });
});

describe("safeDisplayName", () => {
  it("strips directories and control characters", () => {
    expect(safeDisplayName("../../etc/passwd")).toBe("passwd");
    expect(safeDisplayName("C:\\docs\\inv\u0000oice.pdf")).toBe("invoice.pdf");
    expect(safeDisplayName("   ")).toBe("file");
  });
});
