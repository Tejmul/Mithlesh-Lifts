import { z } from "zod";
import type { AvailabilityResponse } from "@/lib/shared/api";
import { isoDateTimeSchema } from "@/lib/shared/validation";
import { ApiException, apiOk, handler } from "@/lib/server/http";
import { getAvailableSlots } from "@/lib/server/scheduling/availability";
import { getSettings } from "@/lib/server/settings";

const querySchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});

/** GET /api/availability?from=ISO&to=ISO — bookable slots (range capped to the booking window). */
export const GET = handler(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
  });
  if (!parsed.success) {
    throw new ApiException(422, "VALIDATION", "Choose a valid date range.");
  }
  const from = parsed.data.from ? new Date(parsed.data.from) : undefined;
  const to = parsed.data.to ? new Date(parsed.data.to) : undefined;

  const [settings, result] = await Promise.all([getSettings(), getAvailableSlots({ from, to })]);
  const body: AvailabilityResponse = {
    coachTimeZone: settings.coachTimeZone,
    callMinutes: settings.callMinutes,
    windowStart: result.windowStart.toISOString(),
    windowEnd: result.windowEnd.toISOString(),
    slots: result.slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
  };
  return apiOk(body, { headers: { "Cache-Control": "no-store" } });
});
