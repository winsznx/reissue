import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import type { CheckResult } from "@reissue/contracts";
import { isIssueOpen } from "@reissue/core";
import { schema } from "@reissue/db";
import { supplierRequest } from "@reissue/workflows";

import { safeEqual } from "../auth.js";
import type { AppContext } from "../context.js";
import { findShipment, latestChecks } from "../read-model.js";

type ToolRole = "examiner" | "liaison";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

/**
 * Reissue's tool surface for the specialist agents. The token decides the tool set: the
 * Examiner sees internal evidence; the Liaison only sees supplier-safe briefs and cannot
 * reach documents, prices or other internal case data at all.
 */
function buildServer(ctx: AppContext, role: ToolRole): McpServer {
  const { svc } = ctx;
  const server = new McpServer({ name: `reissue-${role}-tools`, version: "0.1.0" });
  const caseOr = async (code: string) => findShipment(svc.db, svc.tenantId, code);

  if (role === "examiner") {
    server.registerTool(
      "get_case_overview",
      { description: "Case state, current document versions and open issues with their check keys.", inputSchema: { case_code: z.string() } },
      async ({ case_code }) => {
        const shipment = await caseOr(case_code);
        if (!shipment) return fail(`No case ${case_code}`);
        const docs = await svc.db.select().from(schema.documents).where(eq(schema.documents.shipmentId, shipment.id));
        const versions = await svc.db.select().from(schema.documentVersions).where(eq(schema.documentVersions.shipmentId, shipment.id));
        const issues = (await svc.db.select().from(schema.issues).where(eq(schema.issues.shipmentId, shipment.id))).filter((i) => isIssueOpen(i.status));
        return json({
          case: shipment.caseCode,
          state: shipment.state,
          epoch: shipment.currentEpoch,
          documents: docs.map((d) => ({
            docType: d.docType,
            currentVersionId: d.currentVersionId,
            versions: versions.filter((v) => v.documentId === d.id).map((v) => ({ id: v.id, versionNo: v.versionNo, state: v.state, filename: v.originalFilename, revision: v.revisionLabel, date: v.documentDate })),
          })),
          openIssues: issues.map((i) => ({ code: i.code, kind: i.kind, title: i.title, status: i.status, checkKeys: i.checkKeys })),
        });
      },
    );
    server.registerTool(
      "get_issue_evidence",
      {
        description: "Both sides of every check behind an issue: stated values, units, page numbers, bounding boxes and the exact quoted source text.",
        inputSchema: { case_code: z.string(), issue_code: z.string() },
      },
      async ({ case_code, issue_code }) => {
        const shipment = await caseOr(case_code);
        if (!shipment) return fail(`No case ${case_code}`);
        const [issue] = await svc.db.select().from(schema.issues).where(and(eq(schema.issues.shipmentId, shipment.id), eq(schema.issues.code, issue_code)));
        if (!issue) return fail(`No issue ${issue_code} on ${case_code}`);
        const checks = (await latestChecks(svc.db, shipment.id)).filter((c) => issue.checkKeys.includes(c.key));
        const side = (s: CheckResult["lhs"]) =>
          s && { versionId: s.versionId, docType: s.docType, ref: s.ref, value: s.value, unit: s.unit, raw: s.raw, page: s.source?.page, bbox: s.source?.bbox, quote: s.source?.quote, parser: s.source?.parser };
        return json({ issue: { code: issue.code, kind: issue.kind, title: issue.title }, checks: checks.map((c) => ({ key: c.key, rule: c.rule, status: c.status, detail: c.detail, invoice: side(c.lhs), packingList: side(c.rhs), evidence: c.evidence })) });
      },
    );
    server.registerTool(
      "get_line_items",
      { description: "Extracted line items of a document version, each with page, bounding box and source quote.", inputSchema: { version_id: z.string() } },
      async ({ version_id }) => {
        const [version] = await svc.db.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, version_id));
        const [owner] = version ? await svc.db.select({ tenantId: schema.shipments.tenantId }).from(schema.shipments).where(eq(schema.shipments.id, version.shipmentId)) : [];
        if (!version || owner?.tenantId !== svc.tenantId) return fail(`No version ${version_id}`);
        const lines = await svc.db.select().from(schema.lineItems).where(eq(schema.lineItems.versionId, version_id));
        return json(lines.sort((a, b) => a.rowIndex - b.rowIndex).map((l) => ({ row: l.rowIndex + 1, sku: l.sku, description: l.description, quantity: l.quantity, unit: l.unit, packages: l.packages, packageUnit: l.packageUnit, piecesPerPackage: l.piecesPerPackage, grossWeight: l.grossWeight, netWeight: l.netWeight, page: l.pageNo, bbox: l.source.bbox, quote: l.source.quote })));
      },
    );
  }

  if (role === "liaison") {
    server.registerTool(
      "list_supplier_cases",
      { description: "Case codes in this supplier room that are waiting on the supplier, with the supplier thread status. No document contents." },
      async () => {
        const rows = await svc.db
          .select({ code: schema.shipments.caseCode, state: schema.shipments.state, thread: schema.shipments.supplierThreadId, roomId: schema.shipments.supplierRoomId })
          .from(schema.shipments)
          .where(
            and(
              eq(schema.shipments.tenantId, svc.tenantId),
              inArray(schema.shipments.state, ["WAITING_ON_SUPPLIER", "NEEDS_CLARIFICATION", "RECHECKING"]),
              svc.config.SWITCH_SUPPLIER_ROOM_ID ? eq(schema.shipments.supplierRoomId, svc.config.SWITCH_SUPPLIER_ROOM_ID) : undefined,
            ),
          );
        return json(rows.map((r) => ({ case: r.code, state: r.state, requestPosted: Boolean(r.thread) })));
      },
    );
    server.registerTool(
      "get_supplier_brief",
      { description: "The supplier-safe correction request for a case: case code, references, disputed field values and page numbers only.", inputSchema: { case_code: z.string() } },
      async ({ case_code }) => {
        const shipment = await caseOr(case_code);
        if (!shipment) return fail(`No case ${case_code}`);
        const issues = (await svc.db.select().from(schema.issues).where(eq(schema.issues.shipmentId, shipment.id))).filter((i) => isIssueOpen(i.status) && i.responsibleRole === "SUPPLIER");
        const checks = new Map((await latestChecks(svc.db, shipment.id)).map((c) => [c.key, c]));
        return json({ case: shipment.caseCode, state: shipment.state, brief: issues.length ? supplierRequest(shipment, issues, checks, null) : "Nothing is currently requested from the supplier." });
      },
    );
  }
  return server;
}

export function mcpRoutes(app: FastifyInstance, ctx: AppContext): void {
  const roleFor = (authorization: string | undefined): ToolRole | null => {
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    if (!token) return null;
    if (ctx.api.REISSUE_EXAMINER_TOOL_TOKEN && safeEqual(token, ctx.api.REISSUE_EXAMINER_TOOL_TOKEN)) return "examiner";
    if (ctx.api.REISSUE_LIAISON_TOOL_TOKEN && safeEqual(token, ctx.api.REISSUE_LIAISON_TOOL_TOKEN)) return "liaison";
    return null;
  };

  app.post("/mcp", async (request, reply) => {
    const role = roleFor(request.headers.authorization);
    if (!role) return reply.code(401).send({ error: { code: "unauthenticated", message: "A Reissue tool token is required." } });
    const server = buildServer(ctx, role);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  for (const method of ["GET", "DELETE"] as const) {
    app.route({ method, url: "/mcp", handler: async (_request, reply) => reply.code(405).send({ error: { code: "method_not_allowed", message: "Stateless MCP endpoint: POST only." } }) });
  }
}
