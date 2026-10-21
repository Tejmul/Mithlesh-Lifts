import { DateTime } from "luxon";
import { fmtDateTime, fmtInr } from "@/lib/server/admin/format";
import { db } from "@/lib/server/db";
import { membershipStatus } from "@/lib/server/memberships";
import { updateMembershipAction } from "../(panel)/quote-actions";
import { ActionForm } from "./ActionForm";
import { PlanBadge } from "./PlanBadge";

const isoDay = (d: Date, tz: string) => DateTime.fromJSDate(d, { zone: tz }).toISODate() ?? "";

/** Paid plans for one client, with editable dates (late start, extension). */
export async function PlanPanel({ leadId, tz }: { leadId: string; tz: string }) {
  const plans = await db.membership.findMany({ where: { leadId }, orderBy: { validFrom: "desc" } });
  if (plans.length === 0) return null;
  const now = new Date();

  return (
    <section className="adm-panel" aria-labelledby="plan-h" id="plan">
      <h2 id="plan-h" className="adm-h2">
        Plan
      </h2>
      <ul className="adm-plans">
        {plans.map((m) => (
          <li key={m.id} className="adm-plan">
            <div className="adm-plan-head">
              <div>
                <p className="adm-quote-amount">
                  {m.planName} <PlanBadge status={membershipStatus(m, now)} />
                </p>
                <p className="adm-small adm-muted">
                  Paid {fmtInr(m.amountInr)} on {fmtDateTime(m.paidAt, tz)} · {m.paidVia === "manual" ? "recorded by admin" : "online"}
                </p>
              </div>
            </div>
            <ActionForm action={updateMembershipAction} submitLabel="Save dates" pendingLabel="Saving…" variant="secondary" className="adm-plan-form">
              <input type="hidden" name="membershipId" value={m.id} />
              <label className="adm-field">
                <span>Valid from</span>
                <input name="validFrom" type="date" required defaultValue={isoDay(m.validFrom, tz)} />
              </label>
              <label className="adm-field">
                <span>Valid until</span>
                <input name="validUntil" type="date" required defaultValue={isoDay(m.validUntil, tz)} />
              </label>
              <label className="adm-field adm-field-wide">
                <span>Notes (only the team sees these)</span>
                <textarea name="notes" rows={2} maxLength={1000} defaultValue={m.notes ?? ""} placeholder="Extended 1 week: travel." />
              </label>
            </ActionForm>
          </li>
        ))}
      </ul>
    </section>
  );
}
