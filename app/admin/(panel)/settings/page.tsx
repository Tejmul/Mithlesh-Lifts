import type { Metadata } from "next";
import { requireAdmin } from "@/lib/server/admin/auth";
import { env } from "@/lib/server/env";
import { getSettings } from "@/lib/server/settings";
import { ActionForm } from "../../_components/ActionForm";
import { CopyButton } from "../../_components/CopyButton";
import { saveSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Settings" };

function Flag({ on }: { on: boolean }) {
  return <span className={on ? "adm-badge adm-badge-sent" : "adm-badge adm-badge-failed"}>{on ? "Set" : "Missing"}</span>;
}

export default async function SettingsPage() {
  await requireAdmin();
  const settings = await getSettings();
  const e = env();
  // Booleans only — secret values never reach the page.
  const has = (v: string | undefined) => Boolean(v && v.length > 0);
  const integrations = [
    { label: "Phone verification provider", value: e.PHONE_VERIFY_PROVIDER },
    { label: "Email provider", value: e.EMAIL_PROVIDER },
  ];
  const secrets = [
    { label: "RESEND_API_KEY", on: has(e.RESEND_API_KEY) },
    { label: "TWILIO_ACCOUNT_SID", on: has(e.TWILIO_ACCOUNT_SID) },
    { label: "TWILIO_AUTH_TOKEN", on: has(e.TWILIO_AUTH_TOKEN) },
    { label: "TWILIO_VERIFY_SERVICE_SID", on: has(e.TWILIO_VERIFY_SERVICE_SID) },
    { label: "MSG91_AUTH_KEY", on: has(e.MSG91_AUTH_KEY) },
    { label: "MSG91_OTP_TEMPLATE_ID", on: has(e.MSG91_OTP_TEMPLATE_ID) },
    { label: "CRON_SECRET", on: has(e.CRON_SECRET) },
  ];
  const manychatLink = `${e.APP_URL.replace(/\/$/, "")}/book?source=manychat&campaign=<name>&mc={{subscriber id}}`;

  return (
    <>
      <div className="adm-page-head">
        <h1 className="adm-h1">Settings</h1>
      </div>

      <section className="adm-panel" aria-labelledby="general-h">
        <h2 id="general-h" className="adm-h2">
          Calls &amp; notifications
        </h2>
        <ActionForm action={saveSettingsAction} submitLabel="Save settings">
          <label className="adm-field">
            <span>Meeting link</span>
            <input
              name="meetingUrl"
              type="url"
              inputMode="url"
              placeholder="https://meet.google.com/…"
              defaultValue={settings.meetingUrl ?? ""}
            />
            <small className="adm-hint">Included in confirmation emails for new bookings.</small>
          </label>
          <label className="adm-field">
            <span>Team notification emails</span>
            <textarea
              name="teamNotificationEmails"
              rows={3}
              placeholder="coach@example.com, sales@example.com"
              defaultValue={settings.teamNotificationEmails.join(", ")}
            />
            <small className="adm-hint">Comma-separated. Each gets a &ldquo;new call booked&rdquo; email.</small>
          </label>
        </ActionForm>
      </section>

      <section className="adm-panel" aria-labelledby="manychat-h">
        <h2 id="manychat-h" className="adm-h2">
          ManyChat link
        </h2>
        <p className="adm-muted adm-small">
          Use this as the button URL in ManyChat. Replace <code>&lt;name&gt;</code> with a campaign label (letters,
          numbers, <code>_ . -</code>) and insert the Subscriber ID field for <code>{"{{subscriber id}}"}</code>.
        </p>
        <div className="adm-copy-row">
          <code className="adm-code">{manychatLink}</code>
          <CopyButton text={manychatLink} />
        </div>
      </section>

      <section className="adm-panel" aria-labelledby="int-h">
        <h2 id="int-h" className="adm-h2">
          Integrations
        </h2>
        <p className="adm-muted adm-small">Read-only. Configured through environment variables on the server.</p>
        <dl className="adm-dl">
          {integrations.map((i) => (
            <div key={i.label} className="adm-dl-row">
              <dt>{i.label}</dt>
              <dd>
                <span className={i.value === "mock" ? "adm-badge adm-badge-pending" : "adm-badge adm-badge-sent"}>
                  {i.value}
                </span>
              </dd>
            </div>
          ))}
          {secrets.map((s) => (
            <div key={s.label} className="adm-dl-row">
              <dt className="adm-mono">{s.label}</dt>
              <dd>
                <Flag on={s.on} />
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
