import type { FastifyReply } from "fastify";
import type { ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string): HttpError => new HttpError(404, "not_found", `${what} not found`);

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, "invalid_request", "Request failed validation", result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return result.data;
}

export function sendError(reply: FastifyReply, error: HttpError): FastifyReply {
  return reply.code(error.status).send({ error: { code: error.code, message: error.message, details: error.details } });
}
