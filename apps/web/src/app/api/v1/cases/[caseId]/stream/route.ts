import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:4210";

/**
 * The /api rewrite buffers proxied responses, which holds server-sent events until the
 * connection closes. This handler pipes the upstream stream through unbuffered instead.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }): Promise<Response> {
  const { caseId } = await params;
  const upstreamUrl = `${API_BASE}/v1/cases/${encodeURIComponent(caseId)}/stream${request.nextUrl.search}`;
  const headers = new Headers({ accept: "text/event-stream" });
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const lastEventId = request.headers.get("last-event-id");
  if (lastEventId) headers.set("last-event-id", lastEventId);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { headers, signal: request.signal, cache: "no-store" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: { code: "upstream_unreachable", message: `Could not reach the Reissue API: ${message}` } }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" } });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
