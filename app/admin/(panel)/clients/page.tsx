import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { requireAdmin } from "@/lib/server/admin/auth";
import { DateTime } from "luxon";
import { fmtInr, whatsappUrl } from "@/lib/server/admin/format";
import { db } from "@/lib/server/db";
import { EXPIRING_SOON_DAYS, membershipStatus } from "@/lib/server/memberships";
import { getSettings } from "@/lib/server/settings";
import { ClientCode } from "../../_components/ClientCode";
import { PlanBadge } from "../../_components/PlanBadge";

export const metadata: Metadata = { title: "Clients" };

const fmtDay = (d: Date, tz: string) => DateTime.fromJSDate(d, { zone: tz }).toFormat("d LLL yyyy");

const PAGE_SIZE = 50;
const FILTERS = [
  { key: "active", label: "Active" },
  { key: "expiring", label: `Ending in ${EXPIRING_SOON_DAYS} days` },
  { key: "expired", label: "Expired" },
  { key: "all", label: "All" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

const paramsSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  show: z.enum(["active", "expiring", "expired", "all"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});

/** Every paid plan: who paid, how much, and how long it's valid. */
export default async function ClientsPage({ searchParams }: PageProps<"/admin/clients">) {
  await requireAdmin();
  const raw = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const { q, show = "active", page = 1 } = paramsSchema.parse({
    q: first(raw.q) || undefined,
    show: first(raw.show),
    page: first(raw.page),
  });
  const tz = (await getSettings()).coachTimeZone;
  const now = new Date();
  const soon = new Date(now.getTime() + EXPIRING_SOON_DAYS * 86_400_000);

  const byStatus: Record<Filter, Prisma.MembershipWhereInput> = {
    active: { validUntil: { gt: now } },
    expiring: { validFrom: { lte: now }, validUntil: { gt: now, lte: soon } },
    expired: { validUntil: { lte: now } },
    all: {},
  };
  const and: Prisma.MembershipWhereInput[] = [byStatus[show]];
  if (q) {
    const or: Prisma.LeadWhereInput[] = [
      { fullName: { contains: q, mode: "insensitive" } },
      { clientCode: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 3) or.push({ phoneE164: { contains: digits } });
    and.push({ OR: [{ lead: { OR: or } }, { planName: { contains: q, mode: "insensitive" } }] });
  }
  if (show === "expiring" || show === "expired") {
    // Only each client's latest plan: someone who already renewed isn't "ending" or "expired".
    const latest = await db.membership.groupBy({ by: ["leadId"], _max: { validUntil: true } });
    const latestRows = await db.membership.findMany({
      where: {
        OR: latest
          .filter((l) => l._max.validUntil)
          .map((l) => ({ leadId: l.leadId, validUntil: l._max.validUntil! })),
      },
      select: { id: true },
    });
    and.push({ id: { in: latestRows.map((r) => r.id) } });
  }
  const where: Prisma.MembershipWhereInput = { AND: and };

  const [total, rows, totals] = await Promise.all([
    db.membership.count({ where }),
    db.membership.findMany({
      where,
      // Soonest to end first: who to renew next is at the top.
      orderBy: show === "expired" ? { validUntil: "desc" } : { validUntil: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { lead: { select: { id: true, fullName: true, clientCode: true, phoneE164: true } } },
    }),
    db.membership.aggregate({ where, _sum: { amountInr: true } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: { show?: Filter; page?: number }) =>
    `?${new URLSearchParams({ ...(q ? { q } : {}), show: p.show ?? show, ...(p.page && p.page > 1 ? { page: String(p.page) } : {}) })}`;

  return (
    <>
      <div className="adm-page-head">
        <h1 className="adm-h1">Clients</h1>
        <p className="adm-muted">Everyone who paid for a plan, how much, and until when it&apos;s valid.</p>
      </div>
      <form className="adm-filters" method="get" role="search" aria-label="Search clients">
        <input type="hidden" name="show" value={show} />
        <label className="adm-field adm-field-grow">
          <span>Search</span>
          <input name="q" type="search" defaultValue={q} placeholder="Name, phone, client ID or plan" />
        </label>
        <div className="adm-filter-actions">
          <button type="submit" className="adm-btn adm-btn-primary">
            Search
          </button>
          <Link href="/admin/clients" className="adm-btn adm-btn-ghost">
            Reset
          </Link>
        </div>
      </form>
      <nav className="adm-tabs" aria-label="Filter by plan status">
        {FILTERS.map((f) => (
          <Link key={f.key} className="adm-tab" href={href({ show: f.key })} aria-current={f.key === show ? "page" : undefined}>
            {f.label}
          </Link>
        ))}
      </nav>
      <p className="adm-muted adm-small">
        {total} plan{total === 1 ? "" : "s"} · {fmtInr(totals._sum.amountInr ?? 0)} paid
      </p>
      <div className="adm-table-wrap adm-panel-flush">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Client</th>
              <th scope="col">Phone</th>
              <th scope="col">Plan</th>
              <th scope="col">Paid</th>
              <th scope="col">Paid on</th>
              <th scope="col">Valid from</th>
              <th scope="col">Valid until</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="adm-empty">
                  {show === "all" && !q ? "No paid clients yet. Plans appear here once a quote is paid." : "No clients match."}
                </td>
              </tr>
            )}
            {rows.map((m) => (
              <tr key={m.id}>
                <td>
                  <Link href={`/admin/leads/${m.lead.id}#plan`}>{m.lead.fullName ?? "No name yet"}</Link>{" "}
                  <ClientCode code={m.lead.clientCode} />
                </td>
                <td className="adm-nowrap">
                  <a href={`tel:${m.lead.phoneE164}`} className="adm-phone">
                    {m.lead.phoneE164}
                  </a>{" "}
                  <a href={whatsappUrl(m.lead.phoneE164)} target="_blank" rel="noopener noreferrer" className="adm-small">
                    WA
                  </a>
                </td>
                <td>{m.planName}</td>
                <td className="adm-nowrap">{fmtInr(m.amountInr)}</td>
                <td className="adm-nowrap">{fmtDay(m.paidAt, tz)}</td>
                <td className="adm-nowrap">{fmtDay(m.validFrom, tz)}</td>
                <td className="adm-nowrap">
                  <strong>{fmtDay(m.validUntil, tz)}</strong>
                </td>
                <td>
                  <PlanBadge status={membershipStatus(m, now)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="adm-pager" aria-label="Pagination">
          {page > 1 ? (
            <Link className="adm-btn adm-btn-secondary" href={href({ page: page - 1 })}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="adm-muted">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link className="adm-btn adm-btn-secondary" href={href({ page: page + 1 })}>
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
