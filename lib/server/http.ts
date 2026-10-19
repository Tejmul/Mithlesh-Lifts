import "server-only";
import type { z } from "zod";
import type { ApiErrorBody, ApiErrorCode } from "@/lib/shared/api";
import { reportError } from "./observability";

/** Standard error response: { error: { code, message, fields? } }. Never includes internals. */
export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  fields?: Record<string, string>,
  headers?: HeadersInit,
) {
  const body: ApiErrorBody = { error: { code, message, ...(fields ? { fields } : {}) } };
  return Response.json(body, { status, headers });
}

export function apiOk<T>(data: T, init?: ResponseInit) {
  return Response.json(data, init);
}

/** Thrown inside handlers to short-circuit with a typed API error. */
export class ApiException extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
    message: string,
    public fields?: Record<string, string>,
    public headers?: HeadersInit,
  ) {
    super(message);
  }
}

/** Wrap a route handler: maps ApiException to responses and hides unexpected errors. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ApiException) return apiError(err.status, err.code, err.message, err.fields, err.headers);
      reportError(err, { where: "route-handler" });
      return apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.");
    }
  };
}

/**
 * CSRF guard for cookie-authenticated mutations: the Origin (or Referer) must match our host.
 * Browsers always send Origin on cross-site POST/PUT/DELETE.
 */
export function assertSameOrigin(request: Request) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!host || !origin) throw new ApiException(403, "FORBIDDEN", "Request blocked.");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiException(403, "FORBIDDEN", "Request blocked.");
  }
  if (originHost !== host) throw new ApiException(403, "FORBIDDEN", "Request blocked.");
}

export function clientIp(request: Request) {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** Parse and validate a JSON body. Field errors map to { field: message }. */
export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  const raw = await request.json().catch(() => undefined);
  if (raw === undefined) throw new ApiException(400, "BAD_REQUEST", "Send the request body as JSON.");
  const result = schema.safeParse(raw);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message;
    }
    throw new ApiException(422, "VALIDATION", "Some details need fixing.", fields);
  }
  return result.data;
}
