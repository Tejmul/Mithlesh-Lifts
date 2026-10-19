import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/server/admin/auth";
import { fmtDateTime } from "@/lib/server/admin/format";
import { getRebookCandidates, getVerifiedUnbooked } from "@/lib/server/admin/follow-ups";
import { getSettings } from "@/lib/server/settings";
import { env } from "@/lib/server/env";
import { ClientCode } from "../../_components/ClientCode";
import { StatusBadge } from "../../_components/StatusBadge";

export const metadata: Metadata = { title: "Follow-ups" };

const RANGES = [7, 30, 90];

function waLink(phone: string, name: string | null, text: string) {
  const first = name?.trim().split(/\s+/)[0];
  const msg = `Hi${first ? ` ${first}` : ""}, ${text}`;
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`;
}

function ContactLinks({ phone, name, email, text }: { phone: string; name: string | null; email: string | null; text: string }) {
  return (
    <div className="adm-contact">
      <a className="adm-btn adm-btn-primary adm-btn-sm" href={waLink(phone, name, text)} target="_blank" rel="noopener noreferrer">
        WhatsApp
      </a>
      <a className="adm-btn adm-btn-secondary adm-btn-sm" href={`tel:${phone}`}>
        Call
      </a>
      {email && (
        <a className="adm-btn adm-btn-ghost adm-btn-sm" href={`mailto:${email}`}>
          Email
        </a>
      )}
    </div>
  );
}

export default async function FollowUpsPage({ searchParams }: PageProps<"/admin/follow-ups">) {
  await requireAdmin();
  const rawDays = Number((await searchParams).days);
  const days = RANGES.includes(rawDays) ? rawDays : 30;
  const tz = (await getSettings()).coachTimeZone;
  const bookUrl = `${env().APP_URL.replace(/\/$/, "")}/book`;
  const [unbooked, rebook] = await Promise.all([getVerifiedUnbooked(days), getRebookCandidates(14)]);

  return (
    <>
      <div className="adm-page-head">
        <h1 className="adm-h1">Follow-ups</h1>
        <p className="adm-muted">Times in {tz}</p>
      </div>

      <section className="adm-panel" aria-labelledby="unbooked-h">
        <div className="adm-panel-head">
          <h2 id="unbooked-h" className="adm-h2">
            Verified, didn&apos;t book <span className="adm-count">{unbooked.length}</span>
          </h2>
          <nav className="adm-tabs" aria-label="Period">
            {RANGES.map((d) => (
              <Link key={d} href={`?days=${d}`} aria-current={d === days ? "page" : undefined} className="adm-tab">
                {d} days
              </Link>
            ))}
          </nav>
        </div>
        {unbooked.length === 0 ? (
          <p className="adm-empty">Nobody to chase in this period.</p>
        ) : (
          <ul className="adm-cards">
            {unbooked.map((u) => (
              <li key={u.phoneE164} className="adm-card">
                <div className="adm-card-main">
                  <p className="adm-card-title">
                    <a href={`tel:${u.phoneE164}`} className="adm-phone">
                      {u.phoneE164}
                    </a>{" "}
                    <ClientCode code={u.clientCode} />
                  </p>
                  {(u.fullName || u.email) && (
                    <p className="adm-small">
                      {u.leadId ? <Link href={`/admin/leads/${u.leadId}`}>{u.fullName ?? "Open lead"}</Link> : u.fullName}
                      {u.fullName && u.email ? " · " : ""}
                      {u.email}
                    </p>
                  )}
                  {u.leadId && !u.fullName && !u.email && (
                    <p className="adm-small">
                      <Link href={`/admin/leads/${u.leadId}`}>Open lead</Link>
                    </p>
                  )}
                  <p className="adm-small adm-muted">
                    Verified {fmtDateTime(u.verifiedAt, tz)}
                    {u.attempts > 1 && ` · ${u.attempts} visits`}
                    {(u.source || u.campaign) && ` · ${[u.source, u.campaign].filter(Boolean).join(" / ")}`}
                  </p>
                </div>
                <ContactLinks
                  phone={u.phoneE164}
                  name={u.fullName}
                  email={u.email}
                  text={`this is Mithilesh's team. You started booking a free call with us — want help picking a time? ${bookUrl}`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="adm-panel" aria-labelledby="rebook-h">
        <h2 id="rebook-h" className="adm-h2">
          Re-book: no-shows &amp; cancellations, last 14 days <span className="adm-count">{rebook.length}</span>
        </h2>
        {rebook.length === 0 ? (
          <p className="adm-empty">No missed or cancelled calls to recover.</p>
        ) : (
          <ul className="adm-cards">
            {rebook.map((r) => (
              <li key={r.bookingId} className="adm-card">
                <div className="adm-card-main">
                  <p className="adm-card-title">
                    <a href={`tel:${r.lead.phoneE164}`} className="adm-phone">
                      {r.lead.phoneE164}
                    </a>{" "}
                    <ClientCode code={r.lead.clientCode} /> <StatusBadge status={r.status} />
                  </p>
                  <p className="adm-small">
                    <Link href={`/admin/bookings/${r.bookingId}`}>{r.lead.fullName ?? "No name yet"}</Link>
                    {r.lead.email && <> · {r.lead.email}</>}
                  </p>
                  <p className="adm-small adm-muted">
                    Call was {fmtDateTime(r.startsAt, tz)}
                    {r.cancelledAt && ` · cancelled ${fmtDateTime(r.cancelledAt, tz)}`}
                    {r.cancelReason && ` · “${r.cancelReason}”`}
                    {(r.source || r.campaign) && ` · ${[r.source, r.campaign].filter(Boolean).join(" / ")}`}
                  </p>
                </div>
                <ContactLinks
                  phone={r.lead.phoneE164}
                  name={r.lead.fullName}
                  email={r.lead.email}
                  text={
                    r.status === "NO_SHOW"
                      ? `this is Mithilesh's team — we missed you on the call. Want to grab a new time? ${bookUrl}`
                      : `this is Mithilesh's team — saw your call was cancelled. Want to pick a new time? ${bookUrl}`
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
