import { createHmac, timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import type { ActorRef } from "@reissue/contracts";

export const SESSION_COOKIE = "reissue_session";
const SESSION_TTL_MS = 12 * 3600 * 1000;

export interface Session {
  user: string;
  expiresAt: number;
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function issueSession(secret: string, user: string): { value: string; expiresAt: number } {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ user, expiresAt })).toString("base64url");
  return { value: `${payload}.${sign(secret, payload)}`, expiresAt };
}

export function readSession(secret: string, value: string | undefined): Session | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !safeEqual(sign(secret, payload), signature)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    return session.expiresAt > Date.now() && typeof session.user === "string" ? session : null;
  } catch {
    return null;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    session: Session | null;
  }
}

export function actorFor(request: FastifyRequest): ActorRef {
  const user = request.session?.user ?? "anonymous";
  return { kind: "human", id: `workbench:${user}`, display: user, platform: "workbench" };
}

export function requireSession(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.session) return true;
  void reply.code(401).send({ error: { code: "unauthenticated", message: "Sign in to the Workbench first." } });
  return false;
}
