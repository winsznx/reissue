import { createHash } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt, inArray } from "drizzle-orm";

import { RoomBindingsPatch, type HealthDto, type RoomBindingDto } from "@reissue/contracts";
import { newId, schema } from "@reissue/db";
import { switchHealth } from "@reissue/switch-adapter";
import { issueDownloadToken, listBindings } from "@reissue/workflows";

import type { AppContext } from "../context.js";
import { HttpError, notFound, parse } from "../errors.js";
import { findShipment } from "../read-model.js";

const VERSION = "0.1.0";

function redactRoomId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function adminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { svc } = ctx;

  app.post<{ Params: { caseId: string } }>("/v1/cases/:caseId/package", async (request, reply) => {
    const shipment = await findShipment(svc.db, svc.tenantId, request.params.caseId);
    if (!shipment) throw notFound("Case");
    if (shipment.state !== "READY_FOR_BROKER_REVIEW") {
      throw new HttpError(409, "not_ready", `${shipment.caseCode} is ${shipment.state}; a packet is only built when every required check passes.`);
    }
    const existing = await svc.db
      .select({ id: schema.artifacts.id })
      .from(schema.artifacts)
      .where(and(eq(schema.artifacts.shipmentId, shipment.id), eq(schema.artifacts.caseEpoch, shipment.currentEpoch)));
    if (existing.length >= 3) return reply.code(200).send({ queued: false, epoch: shipment.currentEpoch, reason: "packet already built for this epoch" });
    const result = await svc.queue.enqueue(
      "generate_packet",
      { shipmentId: shipment.id, epoch: shipment.currentEpoch },
      `packet:${shipment.id}:e${shipment.currentEpoch}:request${request.id}:${Date.now()}`,
    );
    return reply.code(202).send({ queued: result.queued, epoch: shipment.currentEpoch });
  });

  app.get<{ Params: { caseId: string } }>("/v1/cases/:caseId/artifacts", async (request) => {
    const shipment = await findShipment(svc.db, svc.tenantId, request.params.caseId);
    if (!shipment) throw notFound("Case");
    const rows = await svc.db.select().from(schema.artifacts).where(eq(schema.artifacts.shipmentId, shipment.id)).orderBy(desc(schema.artifacts.generatedAt));
    return {
      artifacts: rows.map((a) => ({
        id: a.id,
        epoch: a.caseEpoch,
        type: a.type,
        filename: a.filename,
        sha256: a.sha256,
        sizeBytes: a.sizeBytes,
        superseded: a.superseded,
        generatedAt: a.generatedAt.toISOString(),
        manifest: a.manifest,
      })),
    };
  });

  app.post<{ Params: { artifactId: string } }>("/v1/artifacts/:artifactId/link", async (request) => {
    const artifact = await artifactForTenant(ctx, request.params.artifactId);
    const { token, expiresAt } = await issueDownloadToken(svc.db, artifact.id, `workbench:${request.session?.user ?? "unknown"}`, 15 * 60_000);
    return { url: `${svc.config.API_BASE_URL}/v1/artifacts/${artifact.id}/download?token=${token}`, expiresAt: expiresAt.toISOString() };
  });

  app.get<{ Params: { artifactId: string }; Querystring: { token?: string } }>("/v1/artifacts/:artifactId/download", async (request, reply) => {
    const artifact = await artifactForTenant(ctx, request.params.artifactId);
    if (!request.session) {
      const token = request.query.token;
      if (!token) throw new HttpError(401, "unauthenticated", "A signed link or Workbench session is required.");
      const [grant] = await svc.db
        .select()
        .from(schema.downloadTokens)
        .where(
          and(
            eq(schema.downloadTokens.tokenHash, createHash("sha256").update(token).digest("hex")),
            eq(schema.downloadTokens.artifactId, artifact.id),
            gt(schema.downloadTokens.expiresAt, new Date()),
          ),
        );
      if (!grant) throw new HttpError(403, "link_expired", "This download link has expired or does not match the file.");
    }
    const bytes = await svc.store.get(artifact.objectKey);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== artifact.sha256) throw new HttpError(500, "integrity", "Stored artifact failed its integrity check.");
    const mime = artifact.type === "PACKET_ZIP" ? "application/zip" : artifact.type === "CORRECTION_SUMMARY_PDF" ? "application/pdf" : "text/csv";
    return reply
      .header("content-type", mime)
      .header("content-disposition", `attachment; filename="${artifact.filename}"`)
      .header("x-reissue-sha256", artifact.sha256)
      .header("x-reissue-superseded", String(artifact.superseded))
      .send(bytes);
  });

  app.get("/v1/settings/rooms", async () => {
    const rows = await listBindings(svc.db, svc.tenantId);
    return {
      bindings: rows.map(
        (r): RoomBindingDto => ({
          id: r.id,
          switchRoomId: redactRoomId(r.switchRoomId),
          platform: r.platform,
          intent: r.intent,
          label: r.label,
          supplierId: r.supplierId,
          canReceiveSensitive: r.canReceiveSensitive,
        }),
      ),
    };
  });

  app.patch("/v1/settings/rooms", async (request) => {
    const body = parse(RoomBindingsPatch, request.body);
    for (const b of body.bindings) {
      if (b.intent === "SUPPLIER" && b.canReceiveSensitive) {
        throw new HttpError(400, "unsafe_binding", "A supplier room cannot be marked as allowed to receive internal case details.");
      }
    }
    await svc.db.transaction(async (tx) => {
      for (const b of body.bindings) {
        await tx
          .insert(schema.roomBindings)
          .values({ id: newId("room"), tenantId: svc.tenantId, switchRoomId: b.switchRoomId, platform: b.platform, intent: b.intent, label: b.label, supplierId: b.supplierId, canReceiveSensitive: b.canReceiveSensitive })
          .onConflictDoUpdate({
            target: schema.roomBindings.switchRoomId,
            set: { platform: b.platform, intent: b.intent, label: b.label, supplierId: b.supplierId, canReceiveSensitive: b.canReceiveSensitive },
          });
      }
    });
    return { updated: body.bindings.length };
  });

  app.get("/v1/settings", async () => {
    const [tenant] = await svc.db.select().from(schema.tenants).where(eq(schema.tenants.id, svc.tenantId));
    const suppliers = await svc.db.select().from(schema.suppliers).where(eq(schema.suppliers.tenantId, svc.tenantId));
    return {
      workspace: tenant?.name,
      caseReferenceRule: tenant?.settings.caseReferenceRule ?? "invoice_then_po",
      reminderPolicy: svc.config.reminderPolicy,
      demoTimingProfile: svc.config.DEMO_TIMING_PROFILE,
      unitConversions: { builtIn: ["kg ↔ g ↔ lb (exact factors)", "pcs/pieces/units/ea", "carton ↔ pcs only with a sourced pack size"], defaults: tenant?.settings.defaultConversions ?? [] },
      suppliers: suppliers.map((s) => ({ id: s.id, name: s.name })),
      agents: {
        coordinator: svc.config.SWITCH_COORDINATOR_NAME,
        examiner: svc.config.SWITCH_EXAMINER_NAME,
        liaison: svc.config.SWITCH_LIAISON_NAME,
      },
      extraction: { provider: svc.config.EXTRACTION_MODEL_PROVIDER ?? "deterministic (no model)", model: svc.config.EXTRACTION_MODEL },
      replyClassifier: svc.replyModel ? svc.replyModel.id : "rules",
      fileRetentionDays: tenant?.settings.fileRetentionDays ?? 365,
      limits: { maxUploadBytes: svc.config.MAX_UPLOAD_BYTES, chatMediaMaxBytes: svc.config.SWITCH_MEDIA_MAX_BYTES },
    };
  });

  app.get("/v1/health", async () => {
    const timed = async (fn: () => Promise<number>) => {
      try {
        const latency = await fn();
        return { ok: true, detail: "ok", latencyMs: Math.round(latency) };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error), latencyMs: null };
      }
    };
    const [database, queue, objectStore, worker] = await Promise.all([
      timed(() => ctx.dbHandle.ping()),
      timed(() => svc.queue.ping()),
      timed(() => svc.store.ping()),
      svc.worker.health(),
    ]);
    const sw = svc.config.SWITCH_BASE_URL ? await switchHealth(svc.config.SWITCH_BASE_URL) : { ok: false, detail: "SWITCH_BASE_URL not configured", latencyMs: 0 };
    const cursors = await svc.db.select().from(schema.switchCursors);
    const live = cursors.filter((c) => c.state === "live" && c.updatedAt.getTime() > Date.now() - 120_000);
    const coordinator = svc.config.switchEnabled
      ? {
          ok: cursors.length > 0 && live.length === cursors.length,
          detail: cursors.length ? `${live.length}/${cursors.length} room connections live` : "coordinator has not connected yet",
          latencyMs: null,
        }
      : { ok: false, detail: "Switch coordinator credentials not configured", latencyMs: null };
    const health: HealthDto = {
      ok: database.ok && queue.ok && objectStore.ok && worker.ok,
      version: VERSION,
      components: {
        database,
        queue,
        objectStore,
        documentWorker: { ok: worker.ok, detail: worker.detail, latencyMs: Math.round(worker.latencyMs) },
        switch: { ok: sw.ok, detail: sw.detail, latencyMs: Math.round(sw.latencyMs) },
        coordinator,
      },
    };
    return health;
  });

  app.get<{ Querystring: { status?: string } }>("/v1/jobs", async (request) => {
    const statuses = (request.query.status ?? "DEAD,FAILED").split(",") as ("DEAD" | "FAILED" | "QUEUED" | "RUNNING" | "COMPLETED")[];
    const rows = await svc.db.select().from(schema.jobs).where(inArray(schema.jobs.status, statuses)).orderBy(desc(schema.jobs.updatedAt)).limit(100);
    const outbox = await svc.db.select().from(schema.outboxMessages).where(eq(schema.outboxMessages.state, "FAILED")).limit(50);
    return {
      jobs: rows.map((j) => ({ id: j.id, type: j.jobType, shipmentId: j.shipmentId, status: j.status, attempts: j.attempts, lastError: j.lastError, updatedAt: j.updatedAt.toISOString() })),
      failedMessages: outbox.map((o) => ({ id: o.id, purpose: o.purpose, shipmentId: o.shipmentId, lastError: o.lastError, attempts: o.attempts })),
      queues: await svc.queue.counts(),
    };
  });

  app.post<{ Params: { jobId: string } }>("/v1/jobs/:jobId/retry", async (request, reply) => {
    const [job] = await svc.db.select().from(schema.jobs).where(eq(schema.jobs.id, request.params.jobId));
    if (!job || !job.queueJobId) throw notFound("Job");
    if (job.status !== "DEAD" && job.status !== "FAILED") throw new HttpError(409, "not_failed", "Only failed jobs can be retried.");
    const existing = await svc.queue.work.getJob(job.queueJobId);
    if (existing) await existing.retry().catch(async () => existing.remove().then(() => svc.queue.work.add(job.jobType, job.payload, { jobId: job.queueJobId! })));
    else await svc.queue.work.add(job.jobType, job.payload, { jobId: job.queueJobId });
    await svc.db.update(schema.jobs).set({ status: "QUEUED", lastError: null }).where(eq(schema.jobs.id, job.id));
    return reply.code(202).send({ retried: job.id });
  });

  app.post<{ Params: { outboxId: string } }>("/v1/messages/:outboxId/retry", async (request, reply) => {
    const [row] = await svc.db.select().from(schema.outboxMessages).where(eq(schema.outboxMessages.id, request.params.outboxId));
    if (!row) throw notFound("Message");
    await svc.db.update(schema.outboxMessages).set({ state: "PENDING", lastError: null }).where(eq(schema.outboxMessages.id, row.id));
    const existing = await svc.queue.outbox.getJob(`outbox_${row.id}`);
    if (existing) {
      await existing.remove().catch((error: unknown) => svc.log.warn({ err: String(error), outboxId: row.id }, "could not remove previous delivery job"));
    }
    await svc.queue.enqueueOutbox(row.id);
    return reply.code(202).send({ retried: row.id });
  });
}

async function artifactForTenant(ctx: AppContext, artifactId: string) {
  const [artifact] = await ctx.svc.db.select().from(schema.artifacts).where(eq(schema.artifacts.id, artifactId));
  if (!artifact) throw notFound("Artifact");
  const [shipment] = await ctx.svc.db.select({ tenantId: schema.shipments.tenantId }).from(schema.shipments).where(eq(schema.shipments.id, artifact.shipmentId));
  if (shipment?.tenantId !== ctx.svc.tenantId) throw notFound("Artifact");
  return artifact;
}
