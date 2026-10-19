import type { Metadata } from "next";
import Link from "next/link";
import { DateTime } from "luxon";
import { requireAdmin } from "@/lib/server/admin/auth";
import { fmtDateTime, fmtInr, pct } from "@/lib/server/admin/format";
import { FUNNEL_PERIODS, getFunnel, parsePeriod } from "@/lib/server/admin/funnel";
import { db } from "@/lib/server/db";
import { getSettings } from "@/lib/server/settings";
import { ClientCode } from "../_components/ClientCode";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/admin">) {
  await requireAdmin();
  const period = parsePeriod((await searchParams).period);
  const settings = await getSettings();
  const tz = settings.coachTimeZone;
  const now = new Date();
  const todayStart = DateTime.fromJSDate(now, { zone: tz }).startOf("day");
  const todayEnd = todayStart.plus({ days: 1 });

  const [totalLeads, upcoming, today, completed, cancelled, noShows, nextCalls, newestLeads] = await Promise.all([
    db.lead.count(),
    db.booking.count({ where: { status: "CONFIRMED", startsAt: { gte: now } } }),
    db.booking.count({
      where: {
        status: { not: "CANCELLED" },
        startsAt: { gte: todayStart.toJSDate(), lt: todayEnd.toJSDate() },
      },
    }),
    db.booking.count({ where: { status: "COMPLETED" } }),
    db.booking.count({ where: { status: "CANCELLED" } }),
    db.booking.count({ where: { status: "NO_SHOW" } }),
    db.booking.findMany({
      where: { status: "CONFIRMED", startsAt: { gte: now } },
      orderBy: { startsAt: "asc" },
      take: 10,
      include: { lead: true },
    }),
    db.lead.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const funnel = await getFunnel(period, tz, now);
  const steps = [
    { label: "Verified numbers", value: funnel.verified, prev: null as number | null },
    { label: "Calls booked", value: funnel.booked, prev: funnel.verified },
    { label: "Calls completed", value: funnel.completed, prev: funnel.booked },
    { label: "Clients", value: funnel.clients, prev: funnel.completed },
  ];

  const stats = [
    { label: "Total leads", value: totalLeads, href: "/admin/leads" },
    { label: "Upcoming calls", value: upcoming, href: "/admin/bookings?status=CONFIRMED" },
    {
      label: "Today's calls",
      value: today,
      href: `/admin/bookings?from=${todayStart.toISODate()}&to=${todayStart.toISODate()}`,
    },
    { label: "Completed", value: completed, href: "/admin/bookings?status=COMPLETED" },
    { label: "Cancelled", value: cancelled, href: "/admin/bookings?status=CANCELLED" },
    { label: "No-shows", value: noShows, href: "/admin/bookings?status=NO_SHOW" },
  ];

  return (
    <>
      <div className="adm-page-head">
        <h1 className="adm-h1">Dashboard</h1>
        <p className="adm-muted">Times in {tz}</p>
      </div>

      <ul className="adm-stats">
        {stats.map((s) => (
          <li key={s.label}>
            <Link href={s.href} className="adm-stat">
              <span className="adm-stat-value">{s.value}</span>
              <span className="adm-stat-label">{s.label}</span>
            </Link>
          </li>
        ))}
      </ul>

      <section className="adm-panel" aria-labelledby="funnel-h">
        <div className="adm-panel-head">
          <h2 id="funnel-h" className="adm-h2">
            Sales funnel
          </h2>
          <form method="get" className="adm-period">
            <label className="adm-field">
              <span className="adm-sr">Period</span>
              <select name="period" defaultValue={period}>
                {FUNNEL_PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="adm-btn adm-btn-secondary adm-btn-sm">
              Show
            </button>
          </form>
        </div>
        <p className="adm-muted adm-small">
          {fmtDateTime(funnel.from, tz)} – now. Booked, completed and clients count bookings made in this period.
          Quotes paid and revenue collected count payments received in this period; recorded deals are values entered
          under Sales outcome.
        </p>
        <ol className="adm-funnel">
          {steps.map((s) => (
            <li key={s.label}>
              <span className="adm-stat-value">{s.value}</span>
              <span className="adm-stat-label">{s.label}</span>
              {s.prev !== null && <span className="adm-funnel-rate">{pct(s.value, s.prev)} of previous</span>}
            </li>
          ))}
        </ol>
        <ul className="adm-kpis">
          <li>
            <span className="adm-kpi-label">Quotes sent</span>
            <span className="adm-kpi-value">{funnel.quotesSent}</span>
          </li>
          <li>
            <span className="adm-kpi-label">Quotes paid</span>
            <span className="adm-kpi-value">
              {funnel.quotesPaid}{" "}
              <span className="adm-small adm-muted">({pct(funnel.quotesPaid, funnel.quotesSent)})</span>
            </span>
          </li>
          <li>
            <span className="adm-kpi-label">Revenue collected (paid quotes)</span>
            <span className="adm-kpi-value adm-quote-status-paid">{fmtInr(funnel.quoteRevenue)}</span>
          </li>
          <li>
            <span className="adm-kpi-label">Recorded deals</span>
            <span className="adm-kpi-value">{fmtInr(funnel.revenue)}</span>
          </li>
          <li>
            <span className="adm-kpi-label">Average recorded deal</span>
            <span className="adm-kpi-value">
              {funnel.clients ? fmtInr(Math.round(funnel.revenue / funnel.clients)) : "—"}
            </span>
          </li>
          <li>
            <span className="adm-kpi-label">Show-up rate</span>
            <span className="adm-kpi-value">{pct(funnel.completed, funnel.completed + funnel.noShows)}</span>
          </li>
          <li>
            <span className="adm-kpi-label">Booked → client</span>
            <span className="adm-kpi-value">{pct(funnel.clients, funnel.booked)}</span>
          </li>
        </ul>

        <h3 className="adm-h3">By source / campaign</h3>
        {funnel.rows.length === 0 ? (
          <p className="adm-empty">No activity in this period.</p>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table adm-table-num">
              <thead>
                <tr>
                  <th scope="col">Source / campaign</th>
                  <th scope="col">Verified</th>
                  <th scope="col">Booked</th>
                  <th scope="col">Completed</th>
                  <th scope="col">Clients</th>
                  <th scope="col">Booked → client</th>
                  <th scope="col">Recorded deals</th>
                </tr>
              </thead>
              <tbody>
                {funnel.rows.map((r) => (
                  <tr key={`${r.source ?? ""}|${r.campaign ?? ""}`}>
                    <td>
                      {r.source || r.campaign ? (
                        <Link
                          href={`/admin/bookings?${new URLSearchParams({
                            ...(r.source ? { source: r.source } : {}),
                            ...(r.campaign ? { campaign: r.campaign } : {}),
                          })}`}
                        >
                          {[r.source, r.campaign].filter(Boolean).join(" / ")}
                        </Link>
                      ) : (
                        <span className="adm-muted">Direct / unknown</span>
                      )}
                    </td>
                    <td>{r.verified}</td>
                    <td>{r.booked}</td>
                    <td>{r.completed}</td>
                    <td>{r.clients}</td>
                    <td>{pct(r.clients, r.booked)}</td>
                    <td>{fmtInr(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="adm-grid-2">
        <section className="adm-panel" aria-labelledby="next-calls">
          <h2 id="next-calls" className="adm-h2">
            Next calls
          </h2>
          {nextCalls.length === 0 ? (
            <p className="adm-empty">No upcoming calls.</p>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Phone</th>
                    <th scope="col">Client ID</th>
                    <th scope="col">Name</th>
                  </tr>
                </thead>
                <tbody>
                  {nextCalls.map((b) => (
                    <tr key={b.id}>
                      <td className="adm-nowrap">{fmtDateTime(b.startsAt, tz)}</td>
                      <td className="adm-nowrap">
                        <Link href={`/admin/bookings/${b.id}`} className="adm-phone">
                          {b.lead.phoneE164}
                        </Link>
                      </td>
                      <td className="adm-nowrap">
                        <ClientCode code={b.lead.clientCode} />
                      </td>
                      <td>{b.lead.fullName ?? <span className="adm-muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="adm-panel" aria-labelledby="new-leads">
          <h2 id="new-leads" className="adm-h2">
            Newest leads
          </h2>
          {newestLeads.length === 0 ? (
            <p className="adm-empty">No leads yet.</p>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">Phone</th>
                    <th scope="col">Client ID</th>
                    <th scope="col">Name</th>
                    <th scope="col">Source</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {newestLeads.map((l) => (
                    <tr key={l.id}>
                      <td className="adm-nowrap">
                        <Link href={`/admin/leads/${l.id}`} className="adm-phone">
                          {l.phoneE164}
                        </Link>
                      </td>
                      <td className="adm-nowrap">
                        <ClientCode code={l.clientCode} />
                      </td>
                      <td>{l.fullName ?? <span className="adm-muted">—</span>}</td>
                      <td>{[l.source, l.campaign].filter(Boolean).join(" / ") || "—"}</td>
                      <td className="adm-nowrap">{fmtDateTime(l.createdAt, tz)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
