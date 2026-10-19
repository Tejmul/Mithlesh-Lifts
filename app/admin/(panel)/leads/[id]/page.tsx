import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/server/admin/auth";
import { fmtDateTime, whatsappUrl } from "@/lib/server/admin/format";
import { db } from "@/lib/server/db";
import { getSettings } from "@/lib/server/settings";
import { ClientCode } from "../../../_components/ClientCode";
import { QuotePanel } from "../../../_components/QuotePanel";
import { StatusBadge } from "../../../_components/StatusBadge";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadDetailPage({ params }: PageProps<"/admin/leads/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const lead = await db.lead.findUnique({
    where: { id },
    include: { bookings: { orderBy: { startsAt: "desc" }, take: 50 } },
  });
  if (!lead) notFound();
  const tz = (await getSettings()).coachTimeZone;

  return (
    <>
      <p className="adm-crumbs">
        <Link href="/admin/leads">← Leads</Link>
      </p>
      <div className="adm-page-head">
        <h1 className="adm-h1">
          <a href={`tel:${lead.phoneE164}`} className="adm-phone-lg">
            {lead.phoneE164}
          </a>{" "}
          <ClientCode code={lead.clientCode} large />{" "}
          <span className="adm-muted adm-h1-sub">{lead.fullName ?? "No name yet"}</span>
        </h1>
      </div>

      <div className="adm-grid-2">
        <section className="adm-panel" aria-labelledby="lead-h">
          <h2 id="lead-h" className="adm-h2">
            Lead
          </h2>
          <dl className="adm-dl">
            <dt>Phone</dt>
            <dd className="adm-links">
              <a href={`tel:${lead.phoneE164}`} className="adm-phone">
                {lead.phoneE164}
              </a>
              <a href={whatsappUrl(lead.phoneE164)} target="_blank" rel="noopener noreferrer">
                WhatsApp
              </a>
            </dd>
            <dt>Client ID</dt>
            <dd>
              {lead.clientCode ? <ClientCode code={lead.clientCode} /> : <span className="adm-muted">No account yet</span>}
            </dd>
            <dt>Name</dt>
            <dd>{lead.fullName ?? <span className="adm-muted">No name yet</span>}</dd>
            <dt>Email</dt>
            <dd>{lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : <span className="adm-muted">—</span>}</dd>
            <dt>Phone verified</dt>
            <dd>{fmtDateTime(lead.phoneVerifiedAt, tz)}</dd>
            <dt>Last login</dt>
            <dd>{fmtDateTime(lead.lastLoginAt, tz)}</dd>
            <dt>Lead source</dt>
            <dd>{[lead.source, lead.campaign].filter(Boolean).join(" / ") || "—"}</dd>
            <dt>Created</dt>
            <dd>{fmtDateTime(lead.createdAt, tz)}</dd>
          </dl>
        </section>

        <section className="adm-panel" aria-labelledby="bookings-h">
          <h2 id="bookings-h" className="adm-h2">
            Bookings
          </h2>
          {lead.bookings.length === 0 ? (
            <p className="adm-empty">No calls booked yet.</p>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">When ({tz})</th>
                    <th scope="col">Status</th>
                    <th scope="col">Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {lead.bookings.map((b) => (
                    <tr key={b.id}>
                      <td className="adm-nowrap">
                        <Link href={`/admin/bookings/${b.id}`}>{fmtDateTime(b.startsAt, tz)}</Link>
                      </td>
                      <td>
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="adm-mono">{b.reference}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <QuotePanel lead={lead} tz={tz} />
    </>
  );
}
