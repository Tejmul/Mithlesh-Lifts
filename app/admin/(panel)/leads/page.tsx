import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { requireAdmin } from "@/lib/server/admin/auth";
import { fmtDateTime, whatsappUrl } from "@/lib/server/admin/format";
import { summarizeQuotes } from "@/lib/server/admin/quote-summary";
import { db } from "@/lib/server/db";
import { getSettings } from "@/lib/server/settings";
import { ClientCode } from "../../_components/ClientCode";
import { StatusBadge } from "../../_components/StatusBadge";

export const metadata: Metadata = { title: "Leads" };

const PAGE_SIZE = 25;
const paramsSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});

export default async function LeadsPage({ searchParams }: PageProps<"/admin/leads">) {
  await requireAdmin();
  const raw = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const { q, page = 1 } = paramsSchema.parse({ q: first(raw.q) || undefined, page: first(raw.page) });
  const tz = (await getSettings()).coachTimeZone;

  let where: Prisma.LeadWhereInput = {};
  if (q) {
    const or: Prisma.LeadWhereInput[] = [
      { fullName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { clientCode: { contains: q, mode: "insensitive" } },
      { campaign: { contains: q, mode: "insensitive" } },
    ];
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 3) or.push({ phoneE164: { contains: digits } });
    where = { OR: or };
  }

  const [total, leads] = await Promise.all([
    db.lead.count({ where }),
    db.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        _count: { select: { bookings: true } },
        bookings: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, startsAt: true } },
        quotes: { select: { status: true, amountInr: true, createdAt: true } },
      },
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <>
      <div className="adm-page-head">
        <h1 className="adm-h1">Leads</h1>
      </div>
      <form className="adm-filters" method="get" role="search" aria-label="Search leads">
        <label className="adm-field adm-field-grow">
          <span>Search</span>
          <input name="q" type="search" defaultValue={q} placeholder="Name, phone, client ID, email or campaign" />
        </label>
        <div className="adm-filter-actions">
          <button type="submit" className="adm-btn adm-btn-primary">
            Search
          </button>
          <Link href="/admin/leads" className="adm-btn adm-btn-ghost">
            Reset
          </Link>
        </div>
      </form>
      <p className="adm-muted adm-small">
        {total} lead{total === 1 ? "" : "s"}
      </p>
      <div className="adm-table-wrap adm-panel-flush">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Phone / client ID</th>
              <th scope="col">Name</th>
              <th scope="col">Latest booking</th>
              <th scope="col">Quote</th>
              <th scope="col">Bookings</th>
              <th scope="col">Email</th>
              <th scope="col">Source / campaign</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && (
              <tr>
                <td colSpan={8} className="adm-empty">
                  No leads found.
                </td>
              </tr>
            )}
            {leads.map((l) => {
              const latest = l.bookings[0];
              const quote = summarizeQuotes(l.quotes);
              const detailHref = latest ? `/admin/bookings/${latest.id}` : `/admin/leads/${l.id}`;
              return (
                <tr key={l.id}>
                  <td className="adm-nowrap">
                    <a href={`tel:${l.phoneE164}`} className="adm-phone">
                      {l.phoneE164}
                    </a>{" "}
                    <a href={whatsappUrl(l.phoneE164)} target="_blank" rel="noopener noreferrer" className="adm-small">
                      WA
                    </a>{" "}
                    <ClientCode code={l.clientCode} />
                  </td>
                  <td>
                    <Link href={detailHref}>{l.fullName ?? "No name yet"}</Link>
                  </td>
                  <td className="adm-nowrap">
                    {latest ? (
                      <Link href={`/admin/bookings/${latest.id}`}>
                        <StatusBadge status={latest.status} /> {fmtDateTime(latest.startsAt, tz)}
                      </Link>
                    ) : (
                      <span className="adm-muted">No booking</span>
                    )}
                  </td>
                  <td className="adm-nowrap">
                    <Link href={detailHref} className={`adm-quote-status-${quote.tone}`}>
                      {quote.tone === "none" ? <span className="adm-muted">—</span> : quote.label}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/admin/bookings?q=${encodeURIComponent(l.phoneE164)}`}>{l._count.bookings}</Link>
                  </td>
                  <td>{l.email ? <a href={`mailto:${l.email}`}>{l.email}</a> : <span className="adm-muted">—</span>}</td>
                  <td>{[l.source, l.campaign].filter(Boolean).join(" / ") || "—"}</td>
                  <td className="adm-nowrap">{fmtDateTime(l.createdAt, tz)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="adm-pager" aria-label="Pagination">
          {page > 1 ? (
            <Link className="adm-btn adm-btn-secondary" href={pageHref(page - 1)}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="adm-muted">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link className="adm-btn adm-btn-secondary" href={pageHref(page + 1)}>
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
