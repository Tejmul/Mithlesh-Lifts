"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/app/admin/_components/types";
import { actionFailure, validationFailure } from "@/lib/server/admin/action-utils";
import { requireAdmin } from "@/lib/server/admin/auth";
import { db } from "@/lib/server/db";
import { logEvent } from "@/lib/server/observability";
import { emailSchema } from "@/lib/shared/validation";

const schema = z.object({
  meetingUrl: z
    .string()
    .trim()
    .max(500, "Keep the link under 500 characters.")
    .refine((v) => {
      if (!v) return true;
      try {
        return new URL(v).protocol === "https:";
      } catch {
        return false;
      }
    }, "Enter a full https:// link, or leave it empty."),
  teamNotificationEmails: z
    .string()
    .max(2000)
    .transform((v) =>
      v
        .split(/[,\n;]/)
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(emailSchema).max(20, "Up to 20 team emails.")),
});

export async function saveSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = schema.safeParse({
    meetingUrl: formData.get("meetingUrl") ?? "",
    teamNotificationEmails: formData.get("teamNotificationEmails") ?? "",
  });
  if (!parsed.success) {
    const failure = validationFailure(parsed.error);
    // Array item errors arrive as "teamNotificationEmails.N" — collapse them.
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(failure?.fields ?? {})) {
      const key = k.split(".")[0]!;
      fields[key] ??= key === "teamNotificationEmails" ? `Team emails: ${v}` : v;
    }
    return { error: "Some details need fixing.", fields };
  }
  const data = {
    meetingUrl: parsed.data.meetingUrl || null,
    teamNotificationEmails: [...new Set(parsed.data.teamNotificationEmails)],
  };
  try {
    await db.settings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
    logEvent("admin.settings_saved", { adminUserId: admin.id });
  } catch (err) {
    return actionFailure(err, "admin.settings");
  }
  refresh();
  return { ok: "Settings saved." };
}
