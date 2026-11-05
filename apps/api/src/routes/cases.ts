import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { AssignCaseRequest, CaseListQuery, ClarifyRequest, ReassignRequest } from "@reissue/contracts";
import { schema } from "@reissue/db";
import {
  assignCase,
  blobKey,
  CASE_EVENTS_CHANNEL,
  ingest,
  markReplacementReceived,
  reassignIssue,
  recordClarification,
  requestRecheck,
  type IncomingFile,
} from "@reissue/workflows";

import { actorFor } from "../auth.js";
import type { AppContext } from "../context.js";
import { HttpError, notFound, parse } from "../errors.js";
import { caseDetail, caseEvents, documentsFor, findShipment, latestChecks, listCases, roomLabelMap } from "../read-model.js";

async function readFiles(request: FastifyRequest): Promise<{ files: IncomingFile[]; fields: Record<string, string> }> {
  const files: IncomingFile[] = [];
  const fields: Record<string, string> = {};
  for await (const part of request.parts()) {
    if (part.type === "file") {
      files.push({ filename: part.filename, bytes: await part.toBuffer() });
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  return { files, fields };
}

export function caseRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { svc } = ctx;
  const shipmentOr404 = async (id: string) => {
    const shipment = await findShipment(svc.db, svc.tenantId, id);
    if (!shipment) throw notFound("Case");
    return shipment;
  };

  app.post("/v1/cases/intake", async (request, reply) => {
    const { files, fields } = await readFiles(request);
    if (!files.length) throw new HttpError(400, "no_files", "Attach at least one file.");
    const existing = fields.caseCode ? await shipmentOr404(fields.caseCode) : null;
    const actor = actorFor(request);
    const result = await ingest(svc, {
      tenantId: svc.tenantId,
      shipmentId: existing?.id,
      files,
      source: { platform: "workbench", roomId: null, messageId: null, threadId: null, senderRef: actor.id, senderName: actor.display, receivedAt: new Date() },
      actor,
      replyTo: null,
      correlationId: `api:${request.id}`,
    });
    return reply.code(201).send({
      caseCode: result.shipment.caseCode,
      caseId: result.shipment.id,
      accepted: result.accepted,
      duplicates: result.duplicates,
      quarantined: result.quarantined,
      rejected: result.rejected,
    });
  });

  app.get("/v1/cases", async (request) => {
    const query = parse(CaseListQuery, request.query);
    return { cases: await listCases(svc.db, svc.tenantId, query) };
  });

  app.get<{ Params: { caseId: string } }>("/v1/cases/:caseId", async (request) => {
    const shipment = await shipmentOr404(request.params.caseId);
    return caseDetail(svc.db, shipment, await roomLabelMap(svc.db, svc.tenantId));
  });

  app.get<{ Params: { caseId: string }; Querystring: { after?: string } }>("/v1/cases/:caseId/events", async (request) => {
    const shipment = await shipmentOr404(request.params.caseId);
    return { events: await caseEvents(svc.db, shipment.id, Number(request.query.after ?? 0)) };
  });

  app.post<{ Params: { caseId: string } }>("/v1/cases/:caseId/recheck", async (request, reply) => {
    const shipment = await shipmentOr404(request.params.caseId);
    const result = await requestRecheck(svc, shipment.id, actorFor(request));
    return reply.code(202).send(result);
  });

  app.post<{ Params: { caseId: string } }>("/v1/cases/:caseId/assign", async (request, reply) => {
    const shipment = await shipmentOr404(request.params.caseId);
    const body = parse(AssignCaseRequest, request.body);
    await assignCase(svc, shipment.id, body.assignee, actorFor(request));
    return reply.code(204).send();
  });

  app.get<{ Params: { caseId: string }; Querystring: { after?: string } }>("/v1/cases/:caseId/stream", async (request, reply) => {
    const shipment = await shipmentOr404(request.params.caseId);
    let last = Number(request.query.after ?? request.headers["last-event-id"] ?? 0) || 0;
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "access-control-allow-origin": (request.headers.origin as string | undefined) ?? "*",
      "access-control-allow-credentials": "true",
    });
    let flushing = Promise.resolve();
    const flush = () => {
      flushing = flushing.then(async () => {
        for (const event of await caseEvents(svc.db, shipment.id, last)) {
          raw.write(`id: ${event.sequence}\nevent: case_event\ndata: ${JSON.stringify({ kind: "event", event })}\n\n`);
          last = event.sequence;
        }
      }).catch((error: unknown) => svc.log.warn({ err: String(error) }, "stream flush failed"));
    };
    const unlisten = await ctx.dbHandle.listen(CASE_EVENTS_CHANNEL, (payload) => {
      if (payload.startsWith(`${shipment.id}:`)) flush();
    });
    flush();
    const heartbeat = setInterval(() => raw.write(`event: heartbeat\ndata: ${JSON.stringify({ kind: "heartbeat", at: new Date().toISOString() })}\n\n`), 15_000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      void unlisten();
    });
  });

  app.get<{ Params: { caseId: string } }>("/v1/cases/:caseId/documents", async (request) => {
    const shipment = await shipmentOr404(request.params.caseId);
    return { documents: await documentsFor(svc.db, shipment.id) };
  });

  app.get<{ Params: { caseId: string } }>("/v1/cases/:caseId/checks", async (request) => {
    const shipment = await shipmentOr404(request.params.caseId);
    return { checks: await latestChecks(svc.db, shipment.id) };
  });

  app.get<{ Params: { caseId: string } }>("/v1/cases/:caseId/issues", async (request) => {
    const shipment = await shipmentOr404(request.params.caseId);
    const detail = await caseDetail(svc.db, shipment, new Map());
    return { issues: detail.issues };
  });

  app.post<{ Params: { caseId: string; docId: string } }>("/v1/cases/:caseId/documents/:docId/replacements", async (request, reply) => {
    const shipment = await shipmentOr404(request.params.caseId);
    const [doc] = await svc.db
      .select()
      .from(schema.documents)
      .where(and(eq(schema.documents.id, request.params.docId), eq(schema.documents.shipmentId, shipment.id)));
    if (!doc) throw notFound("Document");
    const { files } = await readFiles(request);
    if (files.length !== 1) throw new HttpError(400, "one_file", "Attach exactly one replacement file.");
    const actor = actorFor(request);
    await markReplacementReceived(svc, shipment.id);
    const result = await ingest(svc, {
      tenantId: svc.tenantId,
      shipmentId: shipment.id,
      files,
      source: { platform: "workbench", roomId: null, messageId: null, threadId: null, senderRef: actor.id, senderName: actor.display, receivedAt: new Date() },
      actor,
      replyTo: shipment.opsRoomId ? { roomId: shipment.opsRoomId, threadId: shipment.opsThreadId } : null,
      correlationId: `api:${request.id}`,
    });
    return reply.code(201).send({ accepted: result.accepted, duplicates: result.duplicates, quarantined: result.quarantined, rejected: result.rejected });
  });

  app.post<{ Params: { issueId: string } }>("/v1/issues/:issueId/clarify", async (request, reply) => {
    const [issue] = await svc.db.select().from(schema.issues).where(eq(schema.issues.id, request.params.issueId));
    if (!issue) throw notFound("Issue");
    const [shipment] = await svc.db.select().from(schema.shipments).where(eq(schema.shipments.id, issue.shipmentId));
    if (!shipment || shipment.tenantId !== svc.tenantId) throw notFound("Issue");
    const body = parse(ClarifyRequest, request.body);
    const result = await recordClarification(svc, issue.shipmentId, body, actorFor(request), issue.id);
    return reply.code(202).send(result);
  });

  app.post<{ Params: { issueId: string } }>("/v1/issues/:issueId/reassign", async (request, reply) => {
    const [issue] = await svc.db.select().from(schema.issues).where(eq(schema.issues.id, request.params.issueId));
    if (!issue) throw notFound("Issue");
    const [shipment] = await svc.db.select().from(schema.shipments).where(eq(schema.shipments.id, issue.shipmentId));
    if (!shipment || shipment.tenantId !== svc.tenantId) throw notFound("Issue");
    try {
      await reassignIssue(svc, issue.id, parse(ReassignRequest, request.body), actorFor(request));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(409, "conflict", error instanceof Error ? error.message : String(error));
    }
    return reply.code(204).send();
  });

  app.get<{ Params: { versionId: string } }>("/v1/document-versions/:versionId", async (request) => {
    const version = await versionOr404(ctx, request.params.versionId);
    const fields = await svc.db.select().from(schema.extractedFields).where(eq(schema.extractedFields.versionId, version.id));
    const pages = await svc.db.select().from(schema.documentPages).where(eq(schema.documentPages.versionId, version.id));
    return {
      id: version.id,
      versionNo: version.versionNo,
      state: version.state,
      originalFilename: version.originalFilename,
      sha256: version.sha256,
      mime: version.mime,
      sizeBytes: version.sizeBytes,
      provenance: {
        platform: version.sourcePlatform,
        roomId: version.sourceRoomId,
        messageId: version.sourceMessageId,
        sender: version.senderName,
        receivedAt: version.receivedAt.toISOString(),
      },
      classification: { confidence: version.classificationConfidence, signals: version.classificationSignals },
      pageRange: [version.pageStart, version.pageEnd],
      revisionLabel: version.revisionLabel,
      documentDate: version.documentDate,
      quarantineReason: version.quarantineReason,
      failureReason: version.failureReason,
      missingFields: version.missingFields,
      pages: pages.map((p) => p.info).sort((a, b) => a.page - b.page),
      fields: fields.map((f) => ({ path: f.fieldPath, value: f.normalizedValue, unit: f.unit, raw: f.rawText, source: f.source })),
    };
  });

  app.get<{ Params: { versionId: string; page: string } }>("/v1/document-versions/:versionId/pages/:page", async (request, reply) => {
    const version = await versionOr404(ctx, request.params.versionId);
    const page = z.coerce.number().int().positive().max(500).parse(request.params.page);
    const cacheKey = `renders/${version.sha256}/p${page}.png`;
    let png: Buffer;
    if (await svc.store.exists(cacheKey)) {
      png = await svc.store.get(cacheKey);
    } else {
      png = await svc.worker.renderPage(await svc.store.get(blobKey(version.sha256)), version.mime, page);
      await svc.store.putImmutable(cacheKey, png, "image/png", "render");
    }
    return reply.header("content-type", "image/png").header("cache-control", "private, max-age=86400, immutable").send(png);
  });

  app.get<{ Params: { versionId: string } }>("/v1/document-versions/:versionId/file", async (request, reply) => {
    const version = await versionOr404(ctx, request.params.versionId);
    const bytes = await svc.store.get(blobKey(version.sha256));
    const ascii = version.originalFilename.replace(/[^\x20-\x7e]|["\\]/g, "_");
    return reply
      .header("content-type", version.state === "QUARANTINED" ? "application/octet-stream" : version.mime)
      .header("content-disposition", `${version.state === "QUARANTINED" ? "attachment" : "inline"}; filename="${ascii}"`)
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "sandbox")
      .send(bytes);
  });
}

async function versionOr404(ctx: AppContext, versionId: string) {
  const [version] = await ctx.svc.db.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, versionId));
  if (!version) throw notFound("Document version");
  const [shipment] = await ctx.svc.db.select({ tenantId: schema.shipments.tenantId }).from(schema.shipments).where(eq(schema.shipments.id, version.shipmentId));
  if (shipment?.tenantId !== ctx.svc.tenantId) throw notFound("Document version");
  return version;
}
