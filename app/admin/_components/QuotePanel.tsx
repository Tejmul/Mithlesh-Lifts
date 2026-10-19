import type { Quote } from "@/generated/prisma/client";
import { fmtDateTime } from "@/lib/server/admin/format";
import { formatInr, latestQuote, leadDisplayName, QUOTE_STATUS_LABEL } from "@/lib/server/admin/quote-summary";
import { reportError } from "@/lib/server/observability";
import { listQuotesForLead } from "@/lib/server/quotes";
import { cancelQuoteAction, sendQuoteAction } from "../(panel)/quote-actions";
import { ActionForm } from "./ActionForm";

const BADGE_CLASS: Record<Quote["status"], string> = {
  SENT: "adm-badge adm-badge-confirmed",
  PAID: "adm-badge adm-badge-paid",
  CANCELLED: "adm-badge adm-badge-cancelled",
};

export function QuoteBadge({ status }: { status: Quote["status"] }) {
  return <span className={BADGE_CLASS[status]}>{QUOTE_STATUS_LABEL[status]}</span>;
}

type Props = {
  lead: { id: string; fullName: string | null; clientCode: string | null; phoneE164: string };
  /** Booking the quote follows from (booking detail page). Omitted on the lead page. */
  booking?: { id: string; convertedAt: Date | null; status: string };
  tz: string;
};

/** Send a quote (plan + ₹ amount) to the lead and track its status. */
export async function QuotePanel({ lead, booking, tz }: Props) {
  let quotes: Quote[] | null = null;
  try {
    quotes = [...(await listQuotesForLead(lead.id))].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } catch (err) {
    reportError(err, { where: "admin.quote_panel.list" });
  }
  const paid = latestQuote(quotes?.filter((q) => q.status === "PAID") ?? []);
  const showClientHint = booking && paid && !booking.convertedAt && booking.status !== "CANCELLED";

  return (
    <section className="adm-panel" aria-labelledby="quote-h">
      <h2 id="quote-h" className="adm-h2">
        Quote
      </h2>
      {showClientHint && (
        <p className="adm-callout" role="note">
          <strong>Paid {formatInr(paid.amountInr)}</strong> — this is the client conversion. Record it under{" "}
          <a href="#outcome-h">Sales outcome → Mark as client</a> to count it in recorded deals.
        </p>
      )}

      <p className="adm-muted adm-small">
        Sends to {leadDisplayName(lead)}. It appears in their in-app notifications and they pay online.
      </p>
      <ActionForm action={sendQuoteAction} submitLabel="Send quote" pendingLabel="Sending…" className="adm-quote-form">
        <input type="hidden" name="leadId" value={lead.id} />
        {booking && <input type="hidden" name="bookingId" value={booking.id} />}
        <label className="adm-field">
          <span>Plan name</span>
          <input name="planName" required minLength={2} maxLength={80} autoComplete="off" placeholder="12-week coaching" />
        </label>
        <label className="adm-field">
          <span>Amount (₹, whole rupees)</span>
          <input
            name="amountInr"
            type="number"
            inputMode="numeric"
            min={1}
            max={10_000_000}
            step={1}
            required
            placeholder="12000"
          />
        </label>
        <label className="adm-field adm-field-wide">
          <span>Note for the client (optional)</span>
          <textarea name="note" rows={2} maxLength={1000} placeholder="Includes weekly check-ins and a custom meal plan." />
        </label>
      </ActionForm>

      <h3 className="adm-h3">Quotes for this client</h3>
      {quotes === null ? (
        <p className="adm-msg adm-msg-error">Couldn&apos;t load quotes. Try again shortly.</p>
      ) : quotes.length === 0 ? (
        <p className="adm-empty">No quotes sent yet.</p>
      ) : (
        <ul className="adm-quotes">
          {quotes.map((q) => (
            <li key={q.id} className={`adm-quote adm-quote-${q.status.toLowerCase()}`}>
              <div className="adm-quote-main">
                <p className="adm-quote-amount">
                  {formatInr(q.amountInr)} <QuoteBadge status={q.status} />
                </p>
                <p className="adm-small">
                  {q.planName} · <span className="adm-mono">{q.reference}</span>
                </p>
                {q.note && <p className="adm-small adm-muted">{q.note}</p>}
                <p className="adm-small adm-muted">
                  Sent {fmtDateTime(q.createdAt, tz)}
                  {q.paidAt && <span className="adm-quote-status-paid"> · Paid {fmtDateTime(q.paidAt, tz)}</span>}
                  {q.cancelledAt && ` · Cancelled ${fmtDateTime(q.cancelledAt, tz)}`}
                </p>
              </div>
              {q.status === "SENT" && (
                <ActionForm action={cancelQuoteAction} submitLabel="Cancel quote" pendingLabel="Cancelling…" variant="danger">
                  <input type="hidden" name="quoteId" value={q.id} />
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
