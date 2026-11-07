import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";

import { ScenarioId, type ScenarioDto, type VerificationRunDto } from "@reissue/contracts";
import { isIssueOpen } from "@reissue/core";
import { newId, schema } from "@reissue/db";
import { ingest, markReplacementReceived, primaryRoom, recordClarification } from "@reissue/workflows";

import { actorFor } from "../auth.js";
import type { AppContext } from "../context.js";
import { HttpError, notFound, parse } from "../errors.js";
import { caseEvents } from "../read-model.js";

interface Expectation {
  state: string;
  openIssueKinds: string[];
  minEpoch?: number;
}

interface ScenarioDef extends ScenarioDto {
  expectAfterStart: Expectation;
  steps: { label: string; kind: "replacement"; file: string; expect: Expectation }[] | { label: string; kind: "clarification"; sku: string; factor: string; expect: Expectation }[];
}

const SCENARIOS: ScenarioDef[] = [
  {
    id: "quantity-correction",
    title: "Quantity correction",
    description: "Invoice says 500 pcs of LED string lights; the packing list says 480. Reissue routes the ask to the supplier room and rechecks the replacement.",
    controlledModification: "Packing list line 3 changed from 500 to 480 pcs.",
    inputs: ["invoice-v1.pdf", "packing-list-v1.pdf"],
    followUps: [{ label: "Upload supplier's revised packing list (scripted fixture)", file: "packing-list-v2.pdf" }],
    usesSwitch: true,
    expectAfterStart: { state: "WAITING_ON_SUPPLIER", openIssueKinds: ["QUANTITY_MISMATCH"] },
    steps: [{ label: "Revised packing list v2", kind: "replacement", file: "packing-list-v2.pdf", expect: { state: "READY_FOR_BROKER_REVIEW", openIssueKinds: [], minEpoch: 2 } }],
  },
  {
    id: "reordered-lines",
    title: "Reordered line items",
    description: "The packing list prints the same five SKUs in a different order. Alignment by SKU must not raise false mismatches.",
    controlledModification: "Packing-list rows printed in order 4, 1, 5, 3, 2 with the invoice's quantities.",
    inputs: ["invoice-v1.pdf", "reordered-packing-list.pdf"],
    followUps: [],
    usesSwitch: false,
    expectAfterStart: { state: "READY_FOR_BROKER_REVIEW", openIssueKinds: [] },
    steps: [],
  },
  {
    id: "scanned-packing-list",
    title: "Scanned packing list",
    description: "An image-only packing list is read with OCR; the 480 pcs line is found with page coordinates.",
    controlledModification: "Packing list v1 rasterized, rotated 0.6° with noise; no text layer.",
    inputs: ["invoice-v1.pdf", "scanned-packing-list.pdf"],
    followUps: [],
    usesSwitch: true,
    expectAfterStart: { state: "WAITING_ON_SUPPLIER", openIssueKinds: ["QUANTITY_MISMATCH"] },
    steps: [],
  },
  {
    id: "stale-replacement",
    title: "Stale document after a revision",
    description: "A correct revision 2 is on file; then an older packing list arrives. The newer version stays current and the old one becomes history.",
    controlledModification: "Revision 2 (21 Oct) received first; original (16 Oct, 480 pcs) received afterwards.",
    inputs: ["invoice-v1.pdf", "packing-list-v2.pdf"],
    followUps: [{ label: "Upload the older packing list (scripted fixture)", file: "packing-list-v1.pdf" }],
    usesSwitch: false,
    expectAfterStart: { state: "READY_FOR_BROKER_REVIEW", openIssueKinds: [] },
    steps: [{ label: "Older packing list arrives late", kind: "replacement", file: "packing-list-v1.pdf", expect: { state: "READY_FOR_BROKER_REVIEW", openIssueKinds: [] } }],
  },
  {
    id: "new-mismatch-in-replacement",
    title: "Replacement introduces a new mismatch",
    description: "Revision 3 fixes the quantity but changes the gross weight. The case must not be declared ready.",
    controlledModification: "Revision 3: line 3 = 500 pcs, gross weight 55.50 kg; total 378.50 kg vs invoice 373.50 kg.",
    inputs: ["invoice-v1.pdf", "packing-list-v1.pdf"],
    followUps: [{ label: "Upload revision 3 (scripted fixture)", file: "packing-list-v3-new-mismatch.pdf" }],
    usesSwitch: true,
    expectAfterStart: { state: "WAITING_ON_SUPPLIER", openIssueKinds: ["QUANTITY_MISMATCH"] },
    steps: [{ label: "Revision 3", kind: "replacement", file: "packing-list-v3-new-mismatch.pdf", expect: { state: "WAITING_ON_SUPPLIER", openIssueKinds: ["WEIGHT_MISMATCH"], minEpoch: 2 } }],
  },
  {
    id: "carton-conversion",
    title: "Cartons versus pieces",
    description: "One line is stated only in cartons. Reissue refuses to guess a pack size, then recomputes once a sourced factor is recorded.",
    controlledModification: "Line 5 (LL-SHD-090) states 5 CTNS with no pieces figure vs 100 pcs on the invoice.",
    inputs: ["invoice-v1.pdf", "cartons-packing-list.pdf"],
    followUps: [{ label: "Record 20 pcs per carton for LL-SHD-090 (scripted clarification)", file: "" }],
    usesSwitch: false,
    expectAfterStart: { state: "NEEDS_CLARIFICATION", openIssueKinds: ["UNIT_NOT_COMPARABLE"] },
    steps: [{ label: "Sourced pack size", kind: "clarification", sku: "LL-SHD-090", factor: "20", expect: { state: "READY_FOR_BROKER_REVIEW", openIssueKinds: [] } }],
  },
];

function fixturesDir(): string {
  return resolve(process.env.FIXTURES_DIR ?? join(process.cwd(), "../../tests/fixtures/documents"));
}

function publicScenario(s: ScenarioDef): ScenarioDto {
  return { id: s.id, title: s.title, description: s.description, controlledModification: s.controlledModification, inputs: s.inputs, followUps: s.followUps, usesSwitch: s.usesSwitch };
}

export function demoRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { svc } = ctx;

  app.get("/v1/demo/scenarios", async () => ({ scenarios: SCENARIOS.map(publicScenario), fixtureLabel: "Controlled test document — Reissue fixture" }));

  app.post<{ Params: { scenarioId: string } }>("/v1/demo/scenarios/:scenarioId/start", async (request, reply) => {
    const id = parse(ScenarioId, request.params.scenarioId);
    const scenario = SCENARIOS.find((s) => s.id === id)!;
    const files = await Promise.all(scenario.inputs.map(async (name) => ({ filename: name, bytes: await readFile(join(fixturesDir(), name)) })));
    const ops = await primaryRoom(svc.db, svc.config, svc.tenantId, "OPERATIONS");
    const actor = actorFor(request);
    const started = Date.now();
    const result = await ingest(svc, {
      tenantId: svc.tenantId,
      files,
      source: { platform: "scenario", roomId: null, messageId: null, threadId: null, senderRef: actor.id, senderName: `${actor.display} (scenario: ${scenario.title})`, receivedAt: new Date() },
      actor,
      replyTo: scenario.usesSwitch && ops ? { roomId: ops.switchRoomId, threadId: null } : null,
      correlationId: `scenario:${id}:${request.id}`,
    });
    const runId = newId("vrun");
    await svc.db.insert(schema.scenarioRuns).values({
      id: runId,
      scenarioId: id,
      shipmentId: result.shipment.id,
      status: "RUNNING",
      expected: { afterStart: scenario.expectAfterStart, steps: scenario.steps.map((s) => s.expect), step: 0 },
      timings: { startedAtMs: started },
    });
    return reply.code(201).send({ runId, caseCode: result.shipment.caseCode, accepted: result.accepted.length });
  });

  app.post<{ Params: { runId: string } }>("/v1/demo/runs/:runId/next", async (request, reply) => {
    const [run] = await svc.db.select().from(schema.scenarioRuns).where(eq(schema.scenarioRuns.id, request.params.runId));
    if (!run || !run.shipmentId) throw notFound("Scenario run");
    const scenario = SCENARIOS.find((s) => s.id === run.scenarioId)!;
    const stepIndex = Number((run.expected as { step?: number }).step ?? 0);
    const step = scenario.steps[stepIndex];
    if (!step) throw new HttpError(409, "no_more_steps", "This scenario has no further scripted steps.");
    const actor = actorFor(request);
    if (step.kind === "replacement") {
      const [shipment] = await svc.db.select().from(schema.shipments).where(eq(schema.shipments.id, run.shipmentId));
      await markReplacementReceived(svc, run.shipmentId);
      await ingest(svc, {
        tenantId: svc.tenantId,
        shipmentId: run.shipmentId,
        files: [{ filename: step.file, bytes: await readFile(join(fixturesDir(), step.file)) }],
        source: { platform: "scenario", roomId: null, messageId: null, threadId: null, senderRef: actor.id, senderName: "Scripted supplier fixture", receivedAt: new Date() },
        actor,
        replyTo: shipment?.opsRoomId ? { roomId: shipment.opsRoomId, threadId: shipment.opsThreadId } : null,
        correlationId: `scenario-step:${run.id}:${stepIndex}`,
      });
    } else {
      await recordClarification(
        svc,
        run.shipmentId,
        { kind: "conversion_factor", sku: step.sku, fromUnit: "carton", toUnit: "pcs", factor: step.factor, sourceReference: "Scripted scenario clarification (controlled test)" },
        actor,
        null,
      );
    }
    await svc.db
      .update(schema.scenarioRuns)
      .set({ expected: { ...(run.expected as Record<string, unknown>), step: stepIndex + 1 }, status: "RUNNING", finishedAt: null })
      .where(eq(schema.scenarioRuns.id, run.id));
    return reply.code(202).send({ step: stepIndex + 1, label: step.label });
  });

  app.get("/v1/verification/runs", async () => {
    const runs = await svc.db.select().from(schema.scenarioRuns).orderBy(desc(schema.scenarioRuns.startedAt)).limit(100);
    const out: VerificationRunDto[] = [];
    for (const run of runs) out.push(await evaluateRun(ctx, run));
    const finished = out.filter((r) => r.status !== "RUNNING");
    return {
      runs: out,
      metrics: {
        total: out.length,
        passed: finished.filter((r) => r.status === "PASSED").length,
        failed: finished.filter((r) => r.status === "FAILED").length,
        running: out.length - finished.length,
        medianSettleMs: median(finished.map((r) => r.timingsMs.settleMs).filter((n): n is number => typeof n === "number")),
      },
    };
  });

  app.get<{ Params: { caseId: string } }>("/v1/verification/export/:caseId", async (request, reply) => {
    const [shipment] = await svc.db.select().from(schema.shipments).where(eq(schema.shipments.caseCode, request.params.caseId.toUpperCase()));
    if (!shipment || shipment.tenantId !== svc.tenantId) throw notFound("Case");
    const events = await caseEvents(svc.db, shipment.id);
    const versions = await svc.db.select().from(schema.documentVersions).where(eq(schema.documentVersions.shipmentId, shipment.id));
    const artifacts = await svc.db.select().from(schema.artifacts).where(eq(schema.artifacts.shipmentId, shipment.id));
    const switchEvents = await svc.db
      .select({ id: schema.switchEvents.id, messageId: schema.switchEvents.messageId, roomId: schema.switchEvents.roomId, status: schema.switchEvents.status, receivedAt: schema.switchEvents.receivedAt, processedAt: schema.switchEvents.processedAt })
      .from(schema.switchEvents)
      .where(eq(schema.switchEvents.status, "PROCESSED"));
    const people = new Map<string, string>();
    const alias = (name: string | null | undefined): string | null => {
      if (!name) return null;
      if (!people.has(name)) people.set(name, `participant-${people.size + 1}`);
      return people.get(name)!;
    };
    const correlated = new Set(events.map((e) => e.correlationId).filter(Boolean));
    return reply.header("content-disposition", `attachment; filename="${shipment.caseCode}-evidence.json"`).send({
      caseCode: shipment.caseCode,
      exportedAt: new Date().toISOString(),
      note: "Participant names are replaced with stable aliases; message text and document values are omitted.",
      documents: versions.map((v) => ({ versionId: v.id, versionNo: v.versionNo, state: v.state, sha256: v.sha256, platform: v.sourcePlatform, sourceMessageId: v.sourceMessageId, sender: alias(v.senderName), receivedAt: v.receivedAt, supersedes: v.supersedesVersionId })),
      artifacts: artifacts.map((a) => ({ id: a.id, epoch: a.caseEpoch, type: a.type, sha256: a.sha256, manifest: a.manifest, superseded: a.superseded })),
      switchEvents: switchEvents.filter((s) => s.messageId && correlated.has(s.messageId)),
      timeline: events.map((e) => ({ sequence: e.sequence, type: e.type, at: e.createdAt, actor: { kind: e.actor.kind, name: alias(e.actor.display) }, correlationId: e.correlationId, ids: pickIds(e.payload) })),
    });
  });
}

function pickIds(payload: Record<string, unknown>): Record<string, unknown> {
  const keep = ["versionId", "taskId", "eventId", "messageId", "runId", "epoch", "intakeId", "issueId", "code", "intent", "outcome", "summary", "timingsMs", "artifacts", "purpose", "roomId", "from", "to"];
  return Object.fromEntries(Object.entries(payload).filter(([k]) => keep.includes(k)));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Compares the live case against the scenario's expectation for the current step. */
async function evaluateRun(ctx: AppContext, run: typeof schema.scenarioRuns.$inferSelect): Promise<VerificationRunDto> {
  const expected = run.expected as { afterStart: Expectation; steps: Expectation[]; step: number };
  const target = expected.step === 0 ? expected.afterStart : expected.steps[expected.step - 1]!;
  const [shipment] = run.shipmentId ? await ctx.svc.db.select().from(schema.shipments).where(eq(schema.shipments.id, run.shipmentId)) : [];
  const issues = shipment ? await ctx.svc.db.select().from(schema.issues).where(eq(schema.issues.shipmentId, shipment.id)) : [];
  const openKinds = issues.filter((i) => isIssueOpen(i.status)).map((i) => i.kind).sort();
  const settled = shipment && !["RECEIVED", "PARSING", "RECONCILING", "RECHECKING"].includes(shipment.state);
  const matches =
    shipment?.state === target.state &&
    JSON.stringify(openKinds) === JSON.stringify([...target.openIssueKinds].sort()) &&
    (target.minEpoch === undefined || shipment.currentEpoch >= target.minEpoch);
  const status: VerificationRunDto["status"] = !settled ? "RUNNING" : matches ? "PASSED" : "FAILED";
  const startedAtMs = run.timings.startedAtMs ?? run.startedAt.getTime();
  const timings = { ...run.timings };
  if (settled && shipment && timings.settleMs === undefined && expected.step === 0) {
    timings.settleMs = shipment.updatedAt.getTime() - startedAtMs;
  }
  if (status !== run.status || timings.settleMs !== run.timings.settleMs) {
    await ctx.svc.db
      .update(schema.scenarioRuns)
      .set({ status, observed: { state: shipment?.state, openIssueKinds: openKinds, epoch: shipment?.currentEpoch }, timings, finishedAt: status === "RUNNING" ? null : new Date() })
      .where(eq(schema.scenarioRuns.id, run.id));
  }
  return {
    id: run.id,
    scenarioId: run.scenarioId,
    caseId: shipment?.caseCode ?? null,
    status,
    expected: { ...target, step: expected.step },
    observed: { state: shipment?.state ?? null, openIssueKinds: openKinds, epoch: shipment?.currentEpoch ?? null },
    timingsMs: timings,
    startedAt: run.startedAt.toISOString(),
    finishedAt: status === "RUNNING" ? null : (run.finishedAt ?? new Date()).toISOString(),
  };
}
