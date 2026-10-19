// Thin fetch wrapper for the booking API (lib/shared/api.ts). Browser only.
import type { ApiErrorBody, ApiErrorCode } from "@/lib/shared/api";

export type ClientErrorCode = ApiErrorCode | "NETWORK";

export class ApiError extends Error {
  constructor(
    public code: ClientErrorCode,
    message: string,
    public status: number,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError("NETWORK", "We couldn't reach the server. Check your connection and try again.", 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON response
  }
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(
      err?.code ?? "INTERNAL",
      err?.message ?? "Something went wrong on our side. Please try again.",
      res.status,
      err?.fields,
    );
  }
  return data as T;
}
