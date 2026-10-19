"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { LOGIN_FAILED_MESSAGE, login } from "@/lib/server/admin/auth";
import { ApiException } from "@/lib/server/http";
import { reportError } from "@/lib/server/observability";
import type { ActionState } from "../_components/types";

const schema = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(500),
});

async function requestIp() {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "unknown";
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: LOGIN_FAILED_MESSAGE };
  try {
    await login(parsed.data.email, parsed.data.password, await requestIp());
  } catch (err) {
    if (err instanceof ApiException) return { error: err.message };
    reportError(err, { where: "admin.login" });
    return { error: "Something went wrong. Please try again." };
  }
  redirect("/admin");
}
