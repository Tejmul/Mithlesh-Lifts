import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/server/admin/auth";
import {
  BOOKINGS_PAGE_SIZE,
  BOOKING_STATUSES,
  bookingWhere,
  filtersToQuery,
  parseBookingFilters,
} from "@/lib/server/admin/bookings-query";
import { fmtDateTime, fmtInr, STATUS_LABEL, whatsappUrl } from "@/lib/server/admin/format";
import { db } from "@/lib/server/db";
import { getSettings } from "@/lib/server/settings";
import { StatusBadge } from "../../_components/StatusBadge";

export const metadata: Metadata = { title: "Bookings" };

export default async function BookingsPage({ searchParams }: PageProps<"/admin/bookings">) {
  await requireAdmin();
  const filters = parseBookingFilters(await searchParams);
  const settings = await getSettings();
  const tz = settings.coachTimeZone;
  const where = bookingWhere(filters, tz);

  const [total, bookings] = await Promise.all([
    db.booking.count({ where }),
    db.booking.findMany({
      where,
      orderBy: { startsAt: "desc" },
      skip: (filters.page - 1) * BOOKINGS_PAGE_SIZE,
      take: BOOKINGS_PAGE_SIZE,
      include: { lead: true },
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / BOOKINGS_PAGE_SIZE));
  const exportQuery = filtersToQuery({ ...filters, page: 1 });

  return (
    <>
      <div className="adm-page-head">
        <h1 className="adm-h1">Bookings</h1>
        <a className="adm-btn adm-btn-secondary" href={`/admin/bookings/export${exportQuery ? `?${exportQuery}` : ""}`}>
          Export CSV
        </a>
      </div>

      <form className="adm-filters" method="get" role="search" aria-label="Filter bookings">
        <label className="adm-field adm-field-grow">
          <span>Search</span>
          <input name="q" type="search" defaultValue={filters.q} placeholder="Name, phone, email or reference" />
        </label>
        <label className="adm-field">
          <span>Status</span>
          <select name="status" defaultValue={filters.status ?? ""}>
            <option value="">Any</option>
            {BOOKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-field">
          <span>From</span>
          <input name="from" type="date" defaultValue={filters.from} />
        </label>
        <label className="adm-field">
          <span>To</span>
          <input name="to" type="date" defaultValue={filters.to} />
        </label>
        <label className="adm-field">
          <span>Source</span>
          <input name="source" defaultValue={filters.source} placeholder="manychat" />
        </label>
        <label className="adm-field">
          <span>Campaign</span>
          <input name="campaign" defaultValue={filters.campaign} />
        </label>
        <div className="adm-filter-actions">
          <button type="submit" className="adm-btn adm-btn-primary">
            Apply
          </button>
          <Link href="/admin/bookings" className="adm-btn adm-btn-ghost">
            Reset
          </Link>
        </div>
      </form>

      <p className="adm-muted adm-small">
        {total} booking{total === 1 ? "" : "s"} · times in {tz}
      </p>

      <div className="adm-table-wrap adm-panel-flush">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Phone</th>
              <th scope="col">When</th>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Status</th>
              <th scope="col">Source / campaign</th>
              <th scope="col">Ref</th>
            </tr>
          </thead>
          <tbody>
            {bookings.length === 0 && (
              <tr>
                <td colSpan={7} className="adm-empty">
                  No bookings match these filters.
                </td>
              </tr>
            )}
            {bookings.map((b) => (
              <tr key={b.id}>
                <td className="adm-nowrap">
                  <Link href={`/admin/bookings/${b.id}`} className="adm-phone">
                    {b.lead.phoneE164}
                  </Link>{" "}
                  <a href={whatsappUrl(b.lead.phoneE164)} target="_blank" rel="noopener noreferrer" className="adm-small">
                    WA
                  </a>
                </td>
                <td className="adm-nowrap">
                  <Link href={`/admin/bookings/${b.id}`}>{fmtDateTime(b.startsAt, tz)}</Link>
                </td>
                <td>{b.lead.fullName ?? <span className="adm-muted">—</span>}</td>
                <td>{b.lead.email ?? <span className="adm-muted">—</span>}</td>
                <td>
                  <StatusBadge status={b.status} />
                  {b.convertedAt && <span className="adm-badge adm-badge-client">{fmtInr(b.dealValueInr ?? 0)}</span>}
                </td>
                <td>{[b.source, b.campaign].filter(Boolean).join(" / ") || "—"}</td>
                <td className="adm-mono">
                  <Link href={`/admin/bookings/${b.id}`}>{b.reference}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav className="adm-pager" aria-label="Pagination">
          {filters.page > 1 ? (
            <Link className="adm-btn adm-btn-secondary" href={`?${filtersToQuery(filters, { page: filters.page - 1 })}`}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="adm-muted">
            Page {filters.page} of {pages}
          </span>
          {filters.page < pages ? (
            <Link className="adm-btn adm-btn-secondary" href={`?${filtersToQuery(filters, { page: filters.page + 1 })}`}>
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
