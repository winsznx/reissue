import { ApiError as ApiErrorSchema } from "@reissue/contracts";

export const API_PREFIX = "/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function signInPath(): string {
  if (typeof window === "undefined") return "/sign-in";
  const next = window.location.pathname + window.location.search;
  return `/sign-in?next=${encodeURIComponent(next)}`;
}

async function toApiError(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = ApiErrorSchema.safeParse(body);
  if (parsed.success) return new ApiError(response.status, parsed.data.error.code, parsed.data.error.message);
  return new ApiError(response.status, "http_error", `The Reissue API answered ${response.status} ${response.statusText}.`);
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, { credentials: "same-origin", ...init });
  } catch (error) {
    throw new ApiError(0, "network", `Could not reach the Reissue API (${error instanceof Error ? error.message : String(error)}).`);
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await request(path, { headers: { accept: "application/json" } });
  return (await response.json()) as T;
}

/** Fetches and validates against a contract schema so drift between API and Workbench surfaces loudly. */
export async function getParsed<T>(path: string, schema: { parse: (value: unknown) => T }): Promise<T> {
  const response = await request(path, { headers: { accept: "application/json" } });
  return schema.parse(await response.json());
}

export async function sendJson<T = void>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const response = await request(path, {
    method,
    headers: body === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function sendFiles<T>(path: string, files: File[], fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const file of files) form.append("files", file, file.name);
  const response = await request(path, { method: "POST", body: form });
  return (await response.json()) as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export const pageImageUrl = (versionId: string, page: number) => `${API_PREFIX}/v1/document-versions/${encodeURIComponent(versionId)}/pages/${page}`;
export const versionFileUrl = (versionId: string) => `${API_PREFIX}/v1/document-versions/${encodeURIComponent(versionId)}/file`;
export const artifactDownloadUrl = (artifactId: string) => `${API_PREFIX}/v1/artifacts/${encodeURIComponent(artifactId)}/download`;
export const evidenceExportUrl = (caseCode: string) => `${API_PREFIX}/v1/verification/export/${encodeURIComponent(caseCode)}`;
