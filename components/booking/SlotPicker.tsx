"use client";

import { DateTime } from "luxon";
import { useId, useMemo, useState } from "react";
import { useEffect } from "react";
import type { AvailabilityResponse } from "@/lib/shared/api";
import { ApiError, apiFetch } from "./api-client";
import { fmtDate, fmtTime } from "./format";

export type Slot = { start: string; end: string };

type Props = {
  timeZone: string;
  onTimeZoneChange: (tz: string) => void;
  selected: Slot | null;
  onSelect: (slot: Slot | null) => void;
  /** Bump to refetch (e.g. after SLOT_TAKEN). */
  reloadKey?: number;
  /** Hide this start time (the booking's current slot when rescheduling). */
  excludeStart?: string;
  /** Heading id for the calendar group label. */
  labelledBy?: string;
};

type Loaded = { key: string; data?: AvailabilityResponse; error?: string };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function zoneOptions(current: string) {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  if (current && !zones.includes(current)) zones = [current, ...zones];
  const now = DateTime.now();
  return zones.map((z) => ({ value: z, label: `${z.replace(/_/g, " ")} (GMT${now.setZone(z).toFormat("ZZ")})` }));
}

export function SlotPicker({ timeZone, onTimeZoneChange, selected, onSelect, reloadKey = 0, excludeStart, labelledBy }: Props) {
  const tzId = useId();
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${reloadKey}:${attempt}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [month, setMonth] = useState<string | null>(null); // "yyyy-MM"
  const [pickedDate, setPickedDate] = useState<string | null>(null); // "yyyy-MM-dd"

  useEffect(() => {
    const ctrl = { cancelled: false };
    apiFetch<AvailabilityResponse>("/api/availability")
      .then((data) => {
        if (!ctrl.cancelled) setLoaded({ key: requestKey, data });
      })
      .catch((err: unknown) => {
        if (ctrl.cancelled) return;
        const msg =
          err instanceof ApiError && err.code === "NETWORK"
            ? err.message
            : "We couldn't load available times. Please try again.";
        setLoaded({ key: requestKey, error: msg });
      });
    return () => {
      ctrl.cancelled = true;
    };
  }, [requestKey]);

  const isLoading = loaded?.key !== requestKey;
  const data = !isLoading ? loaded?.data : undefined;
  const error = !isLoading ? loaded?.error : undefined;

  const options = useMemo(() => zoneOptions(timeZone), [timeZone]);

  const byDate = useMemo(() => {
    const map = new Map<string, Slot[]>();
    if (!data || !timeZone) return map;
    for (const s of data.slots) {
      if (excludeStart && Date.parse(s.start) === Date.parse(excludeStart)) continue;
      const key = DateTime.fromISO(s.start, { zone: timeZone }).toISODate();
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [data, timeZone, excludeStart]);

  const dates = useMemo(() => [...byDate.keys()].sort(), [byDate]);

  // Month bounds come from the booking window, shown in the selected zone.
  const bounds = useMemo(() => {
    if (!data || !timeZone) return null;
    const first = DateTime.fromISO(data.windowStart, { zone: timeZone }).startOf("month");
    const last = DateTime.fromISO(data.windowEnd, { zone: timeZone }).startOf("month");
    return { first, last };
  }, [data, timeZone]);

  const selectedDateKey = selected ? DateTime.fromISO(selected.start, { zone: timeZone }).toISODate() : null;
  const fallbackMonth = (selectedDateKey ?? dates[0])?.slice(0, 7) ?? bounds?.first.toFormat("yyyy-MM") ?? null;
  const visibleMonth = month ?? fallbackMonth;
  const monthStart = visibleMonth ? DateTime.fromFormat(visibleMonth, "yyyy-MM", { zone: timeZone }) : null;

  const datesInMonth = visibleMonth ? dates.filter((d) => d.startsWith(visibleMonth)) : [];
  const activeDate =
    pickedDate && byDate.has(pickedDate) && pickedDate.startsWith(visibleMonth ?? "-")
      ? pickedDate
      : selectedDateKey && selectedDateKey.startsWith(visibleMonth ?? "-") && byDate.has(selectedDateKey)
        ? selectedDateKey
        : (datesInMonth[0] ?? null);

  const canPrev = !!(monthStart && bounds && monthStart > bounds.first);
  const canNext = !!(monthStart && bounds && monthStart < bounds.last);

  function shiftMonth(delta: number) {
    if (!monthStart) return;
    setMonth(monthStart.plus({ months: delta }).toFormat("yyyy-MM"));
    setPickedDate(null);
  }

  const todayKey = timeZone ? DateTime.now().setZone(timeZone).toISODate() : null;

  const tzSelect = (
    <div className="field tz-field">
      <label htmlFor={tzId}>Time zone</label>
      <select id={tzId} value={timeZone} onChange={(e) => onTimeZoneChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );

  if (isLoading) {
    return (
      <div className="slot-picker" aria-busy="true">
        {tzSelect}
        <p className="sr-only" role="status">
          Loading available times…
        </p>
        <div className="slot-picker-body">
          <div className="cal skeleton-cal" aria-hidden="true">
            {Array.from({ length: 35 }, (_, i) => (
              <span key={i} className="skeleton" />
            ))}
          </div>
          <div className="slot-col" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className="skeleton skeleton-slot" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data || !monthStart) {
    return (
      <div className="slot-picker">
        {tzSelect}
        <div className="notice notice-error" role="alert">
          <p>{error ?? "We couldn't load available times. Please try again."}</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const lead = monthStart.weekday - 1; // Monday-first grid
  const daysInMonth = monthStart.daysInMonth ?? 30;
  const daySlots = activeDate ? (byDate.get(activeDate) ?? []) : [];

  return (
    <div className="slot-picker">
      {tzSelect}

      {dates.length === 0 ? (
        <div className="notice">
          <p>No open times right now. New times open up regularly, so please check back soon.</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttempt((a) => a + 1)}>
            Refresh
          </button>
        </div>
      ) : (
        <div className="slot-picker-body">
          <div className="cal" role="group" aria-labelledby={labelledBy}>
            <div className="cal-head">
              <button
                type="button"
                className="icon-btn"
                onClick={() => shiftMonth(-1)}
                disabled={!canPrev}
                aria-label="Previous month"
              >
                <span aria-hidden="true">‹</span>
              </button>
              <p className="cal-month" aria-live="polite">
                {monthStart.toFormat("LLLL yyyy")}
              </p>
              <button
                type="button"
                className="icon-btn"
                onClick={() => shiftMonth(1)}
                disabled={!canNext}
                aria-label="Next month"
              >
                <span aria-hidden="true">›</span>
              </button>
            </div>
            <div className="cal-grid">
              {WEEKDAYS.map((d) => (
                <span key={d} className="cal-dow" aria-hidden="true">
                  {d.slice(0, 2)}
                </span>
              ))}
              {Array.from({ length: lead }, (_, i) => (
                <span key={`b${i}`} aria-hidden="true" />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = monthStart.set({ day: i + 1 });
                const key = day.toISODate() ?? "";
                const count = byDate.get(key)?.length ?? 0;
                const label = `${day.toFormat("cccc d LLLL")}${count ? `, ${count} time${count > 1 ? "s" : ""} available` : ", no times"}`;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`cal-day${key === todayKey ? " is-today" : ""}${count ? " has-slots" : ""}`}
                    disabled={!count}
                    aria-pressed={key === activeDate}
                    aria-label={label}
                    onClick={() => setPickedDate(key)}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="slot-col">
            {activeDate ? (
              <>
                <p className="slot-col-date">{fmtDate(daySlots[0]?.start ?? activeDate, timeZone)}</p>
                <ul className="slot-list" aria-label={`Times on ${fmtDate(daySlots[0]?.start ?? activeDate, timeZone)}`}>
                  {daySlots.map((s) => {
                    const on = selected ? Date.parse(selected.start) === Date.parse(s.start) : false;
                    return (
                      <li key={s.start}>
                        <button
                          type="button"
                          className="slot"
                          aria-pressed={on}
                          onClick={() => onSelect(on ? null : s)}
                        >
                          {fmtTime(s.start, timeZone)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <div className="notice">
                <p>No open times in this range. Try the next month.</p>
                {canNext && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => shiftMonth(1)}>
                    Next month
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
