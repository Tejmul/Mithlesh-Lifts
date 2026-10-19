import "server-only";
import type { z } from "zod";
import type { ActionState } from "@/app/admin/_components/types";
import { ApiException } from "../http";
import { reportError } from "../observability";

/** Maps zod issues to an ActionState with per-field messages. */
export function validationFailure(error: z.ZodError): ActionState {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return { error: "Some details need fixing.", fields };
}

/** Maps a thrown error to a user-facing ActionState (ApiException messages are safe to show). */
export function actionFailure(err: unknown, where: string): ActionState {
  if (err instanceof ApiException) return { error: err.message };
  reportError(err, { where });
  return { error: "Something went wrong. Please try again." };
}
