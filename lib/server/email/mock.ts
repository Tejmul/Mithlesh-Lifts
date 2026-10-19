import "server-only";
import { pushOutbox } from "../dev-outbox";
import type { EmailMessage, EmailResult } from "./index";

/** Development/test provider: writes to the in-memory dev outbox. Never used in production. */
export function sendViaMock(msg: EmailMessage): EmailResult {
  if (process.env.NODE_ENV === "production") throw new Error("Mock email provider is disabled in production");
  const entry = pushOutbox({
    channel: "email",
    to: Array.isArray(msg.to) ? msg.to.join(", ") : msg.to,
    subject: msg.subject,
    body: msg.text,
    html: msg.html,
  });
  return { ok: true, providerMessageId: `mock_${entry.id}` };
}
