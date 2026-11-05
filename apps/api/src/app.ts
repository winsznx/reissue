import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { z } from "zod";

import * as contracts from "@reissue/contracts";
import { InvalidTransitionError } from "@reissue/core";

import { issueSession, readSession, safeEqual, SESSION_COOKIE } from "./auth.js";
import type { AppContext } from "./context.js";
import { HttpError, parse, sendError } from "./errors.js";
import { adminRoutes } from "./routes/admin.js";
import { caseRoutes } from "./routes/cases.js";
import { demoRoutes } from "./routes/demo.js";
import { mcpRoutes } from "./routes/mcp.js";

const PUBLIC_ROUTES = new Set(["/v1/health", "/v1/auth/session", "/v1/openapi.json", "/mcp"]);
const LoginBody = z.object({ accessCode: z.string().min(1).max(200), name: z.string().trim().min(1).max(60).default("Coordinator") });

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const { svc } = ctx;
  const app = Fastify({ loggerInstance: svc.log as FastifyBaseLogger, bodyLimit: 2 * 1024 * 1024, trustProxy: true });

  await app.register(cors, { origin: [svc.config.REISSUE_PUBLIC_URL], credentials: true });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: svc.config.MAX_UPLOAD_BYTES, files: 10, fields: 10 } });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute", allowList: (req) => req.url.startsWith("/v1/cases/") && req.url.endsWith("/stream") });

  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request, reply) => {
    request.session = readSession(svc.config.APP_SESSION_SECRET, request.cookies[SESSION_COOKIE]);
    const path = request.url.split("?")[0] ?? "";
    if (PUBLIC_ROUTES.has(path)) return;
    if (/^\/v1\/artifacts\/[^/]+\/download$/.test(path)) return;
    if (!request.session) {
      await reply.code(401).send({ error: { code: "unauthenticated", message: "Sign in to the Workbench first." } });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) return sendError(reply, error);
    if (error instanceof InvalidTransitionError) return sendError(reply, new HttpError(409, "invalid_transition", error.message));
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) return sendError(reply, new HttpError(status, (error as { code?: string }).code ?? "bad_request", (error as Error).message));
    request.log.error({ err: error }, "unhandled error");
    return sendError(reply, new HttpError(500, "internal", "Something went wrong; the event was logged."));
  });

  app.post("/v1/auth/session", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = parse(LoginBody, request.body);
    if (!safeEqual(body.accessCode, ctx.api.WORKBENCH_ACCESS_CODE)) throw new HttpError(401, "invalid_code", "That access code is not right.");
    const session = issueSession(svc.config.APP_SESSION_SECRET, body.name);
    void reply.setCookie(SESSION_COOKIE, session.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: svc.config.REISSUE_PUBLIC_URL.startsWith("https://"),
      path: "/",
      expires: new Date(session.expiresAt),
    });
    return { user: body.name, expiresAt: new Date(session.expiresAt).toISOString() };
  });
  app.get("/v1/auth/session", async (request) => (request.session ? { user: request.session.user, expiresAt: new Date(request.session.expiresAt).toISOString() } : { user: null }));
  app.delete("/v1/auth/session", async (_request, reply) => reply.clearCookie(SESSION_COOKIE, { path: "/" }).code(204).send());

  app.get("/v1/openapi.json", async () => openApiDocument());

  caseRoutes(app, ctx);
  adminRoutes(app, ctx);
  demoRoutes(app, ctx);
  mcpRoutes(app, ctx);
  return app;
}

function schemaRef(name: keyof typeof contracts): unknown {
  return z.toJSONSchema(contracts[name] as z.ZodType, { unrepresentable: "any" });
}

/** OpenAPI 3.1 contract generated from the same Zod schemas the handlers validate with. */
function openApiDocument(): Record<string, unknown> {
  const components = Object.fromEntries(
    (["CaseSummaryDto", "CaseDetailDto", "CaseListQuery", "DocumentDto", "IssueDto", "ArtifactDto", "ClarifyRequest", "ReassignRequest", "AssignCaseRequest", "RoomBindingsPatch", "RoomBindingDto", "HealthDto", "ScenarioDto", "VerificationRunDto", "CaseEvent", "ApiError", "ExtractionResult", "CheckResult", "DocumentReviewRequested", "DocumentReviewResult"] as const).map((n) => [n, schemaRef(n)]),
  );
  const op = (summary: string, response?: string, body?: string) => ({
    summary,
    ...(body ? { requestBody: { content: { "application/json": { schema: { $ref: `#/components/schemas/${body}` } } } } } : {}),
    responses: { "200": { description: "OK", ...(response ? { content: { "application/json": { schema: { $ref: `#/components/schemas/${response}` } } } } : {}) }, default: { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } } } },
  });
  return {
    openapi: "3.1.0",
    info: { title: "Reissue API", version: "0.1.0", description: "Shipment document correction: intake, evidence, issues, packets." },
    paths: {
      "/v1/cases/intake": { post: { ...op("Direct multipart intake when a chat attachment route cannot be used"), requestBody: { content: { "multipart/form-data": { schema: { type: "object", properties: { files: { type: "array", items: { type: "string", format: "binary" } }, caseCode: { type: "string" } } } } } } } },
      "/v1/cases": { get: op("List, search and filter cases") },
      "/v1/cases/{caseId}": { get: op("Case detail", "CaseDetailDto") },
      "/v1/cases/{caseId}/events": { get: op("Append-only case timeline") },
      "/v1/cases/{caseId}/recheck": { post: op("Reprocess current versions with an audit event") },
      "/v1/cases/{caseId}/assign": { post: op("Change assignee", undefined, "AssignCaseRequest") },
      "/v1/cases/{caseId}/stream": { get: { summary: "Server-sent events for live Workbench updates", responses: { "200": { description: "text/event-stream of CaseEvent frames" } } } },
      "/v1/cases/{caseId}/documents": { get: op("Logical documents with versions") },
      "/v1/document-versions/{id}": { get: op("Version metadata and provenance") },
      "/v1/document-versions/{id}/pages/{page}": { get: { summary: "Rendered page image", responses: { "200": { description: "image/png" } } } },
      "/v1/cases/{caseId}/checks": { get: op("Check results with source references") },
      "/v1/cases/{caseId}/issues": { get: op("Issue state and owner") },
      "/v1/issues/{id}/clarify": { post: op("Record a source-backed human clarification", undefined, "ClarifyRequest") },
      "/v1/issues/{id}/reassign": { post: op("Send an issue to a new responsible participant", undefined, "ReassignRequest") },
      "/v1/cases/{caseId}/documents/{docId}/replacements": { post: op("Authorized replacement ingest (multipart)") },
      "/v1/cases/{caseId}/package": { post: op("Build the current packet if eligible") },
      "/v1/cases/{caseId}/artifacts": { get: op("Existing packets and manifests") },
      "/v1/artifacts/{id}/download": { get: { summary: "Session or short-lived signed download", responses: { "200": { description: "File bytes" } } } },
      "/v1/settings/rooms": { get: op("Connected room bindings (redacted)"), patch: op("Configure room mappings", undefined, "RoomBindingsPatch") },
      "/v1/health": { get: op("App, database, queue, object store, worker and Switch reachability", "HealthDto") },
      "/v1/demo/scenarios/{scenarioId}/start": { post: op("Start a real processing run for a curated scenario") },
      "/v1/verification/runs": { get: op("Scenario run results and metrics") },
    },
    components: { schemas: components },
  };
}
