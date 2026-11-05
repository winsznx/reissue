import { ExtractionResult } from "@reissue/contracts";

export class WorkerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WorkerError";
  }

  /** 4xx means the file itself was rejected; retrying will not change the outcome. */
  get permanent(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

/** HTTP client for the document worker. Its output is validated against the shared contract. */
export class WorkerClient {
  constructor(private readonly baseUrl: string) {}

  async extract(bytes: Buffer, mime: string, filenameHint: string): Promise<ExtractionResult> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), "upload");
    form.append("filename_hint", filenameHint);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/extract`, { method: "POST", body: form, signal: AbortSignal.timeout(180_000) });
    } catch (error) {
      throw new WorkerError(0, `Document worker unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    if (!response.ok) throw new WorkerError(response.status, `Document worker returned ${response.status}: ${text.slice(0, 300)}`);
    const parsed = ExtractionResult.safeParse(JSON.parse(text));
    if (!parsed.success) throw new WorkerError(502, `Document worker output failed contract validation: ${parsed.error.message.slice(0, 500)}`);
    return parsed.data;
  }

  async renderPage(bytes: Buffer, mime: string, page: number): Promise<Buffer> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), "upload");
    form.append("page", String(page));
    const response = await fetch(`${this.baseUrl}/v1/render`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new WorkerError(response.status, `Render failed with ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async health(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    const started = performance.now();
    try {
      const response = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3_000) });
      return { ok: response.ok, latencyMs: performance.now() - started, detail: response.ok ? "ok" : `status ${response.status}` };
    } catch (error) {
      return { ok: false, latencyMs: performance.now() - started, detail: error instanceof Error ? error.message : String(error) };
    }
  }
}
