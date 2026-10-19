import type { Metadata } from "next";
import { DateTime } from "luxon";
import { requireAdmin } from "@/lib/server/admin/auth";
import { minutesToHHMM } from "@/lib/server/admin/format";
import { getDaysOff, getSettings, getWeeklyHours } from "@/lib/server/settings";
import { ActionForm } from "../../_components/ActionForm";
import { addDayOffAction, removeDayOffAction, saveRulesAction, saveWeeklyHoursAction } from "./actions";
import { WeeklyHoursEditor } from "./WeeklyHoursEditor";

export const metadata: Metadata = { title: "Availability" };

function timeZones(current: string) {
  const list = Intl.supportedValuesOf("timeZone");
  return list.includes(current) ? list : [current, ...list];
}

export default async function AvailabilityPage() {
  await requireAdmin();
  const [settings, hours, daysOff] = await Promise.all([getSettings(), getWeeklyHours(), getDaysOff()]);
  const tz = settings.coachTimeZone;
  const today = DateTime.now().setZone(tz).toISODate()!;
  const initial = hours.map((h) => ({
    weekday: h.weekday,
    start: minutesToHHMM(h.startMinute),
    end: h.endMinute >= 1440 ? "00:00" : minutesToHHMM(h.endMinute),
  }));

  const numberField = (name: keyof typeof settings, label: string, hint: string) => (
    <label className="adm-field">
      <span>{label}</span>
      <input name={name} type="number" inputMode="numeric" min={0} required defaultValue={String(settings[name])} />
      <small className="adm-hint">{hint}</small>
    </label>
  );

  return (
    <>
      <div className="adm-page-head">
        <h1 className="adm-h1">Availability</h1>
        <p className="adm-muted">All times in {tz}</p>
      </div>

      <section className="adm-panel" aria-labelledby="hours-h">
        <h2 id="hours-h" className="adm-h2">
          Weekly hours
        </h2>
        <p className="adm-muted adm-small">
          Several windows per day are allowed (e.g. a lunch break). Use 00:00 as the end time for midnight.
        </p>
        <ActionForm action={saveWeeklyHoursAction} submitLabel="Save weekly hours">
          <WeeklyHoursEditor initial={initial} />
        </ActionForm>
      </section>

      <section className="adm-panel" aria-labelledby="rules-h">
        <h2 id="rules-h" className="adm-h2">
          Booking rules
        </h2>
        <ActionForm action={saveRulesAction} submitLabel="Save rules">
          <div className="adm-form-grid">
            {numberField("callMinutes", "Call length (minutes)", "How long each call lasts.")}
            {numberField("bufferMinutes", "Buffer (minutes)", "Gap kept free after each call.")}
            {numberField("slotIntervalMinutes", "Slot interval (minutes)", "Start times offered every N minutes.")}
            {numberField("minNoticeMinutes", "Minimum notice (minutes)", "e.g. 240 = no bookings within 4 hours.")}
            {numberField("maxAdvanceDays", "Max days ahead", "How far ahead people can book.")}
            {numberField(
              "manageCutoffMinutes",
              "Reschedule cutoff (minutes)",
              "Customers can change/cancel until this long before the call.",
            )}
            <label className="adm-field">
              <span>Coach time zone</span>
              <select name="coachTimeZone" defaultValue={tz}>
                {timeZones(tz).map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <small className="adm-hint">Weekly hours and days off are read in this zone.</small>
            </label>
          </div>
        </ActionForm>
      </section>

      <section className="adm-panel" aria-labelledby="off-h">
        <h2 id="off-h" className="adm-h2">
          Days off
        </h2>
        <ActionForm action={addDayOffAction} submitLabel="Add day off" className="adm-inline-form">
          <label className="adm-field">
            <span>Date</span>
            <input name="date" type="date" required min={today} />
          </label>
          <label className="adm-field adm-field-grow">
            <span>Reason (optional)</span>
            <input name="reason" maxLength={200} placeholder="Travel, holiday…" />
          </label>
        </ActionForm>
        {daysOff.length === 0 ? (
          <p className="adm-empty">No days off.</p>
        ) : (
          <ul className="adm-daysoff">
            {daysOff.map((d) => (
              <li key={d.id} className={d.date < today ? "adm-past" : undefined}>
                <span className="adm-mono">{d.date}</span>
                <span>{DateTime.fromISO(d.date).toFormat("cccc")}</span>
                <span className="adm-muted">{d.reason ?? ""}</span>
                <ActionForm action={removeDayOffAction} submitLabel="Remove" pendingLabel="Removing…" variant="secondary">
                  <input type="hidden" name="id" value={d.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
