"use client";

import { DateTime } from "luxon";
import { useEffect, useId, useMemo, useState } from "react";
import type { AvailabilityResponse } from "@/lib/shared/api";
import { ApiError, apiFetch } from "./api-client";
import { parseWhen } from "./parse-when";

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
  /** Heading id for the group label. */
  labelledBy?: string;
};

type Loaded = { key: string; data?: AvailabilityResponse; error?: string };

const PARTS = [
  { key: "morning", label: "Morning", test: (h: number) => h < 12 },
  { key: "afternoon", label: "Afternoon", test: (h: number) => h >= 12 && h < 17 },
  { key: "evening", label: "Evening", test: (h: number) => h >= 17 },
] as const;

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

function dayLabel(date: DateTime, today: DateTime) {
  const diff = Math.round(date.startOf("day").diff(today.startOf("day"), "days").days);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return date.toFormat("ccc");
}

/**
 * Month calendar (like Google Calendar) + the chosen day's free times, plus a "type a day and time"
 * box ("tomorrow 6:30 pm") that selects the slot or offers the closest free ones.
 * Times are shown in the visitor's time zone (auto-detected, changeable).
 */
export function SlotPicker({ timeZone, onTimeZoneChange, selected, onSelect, reloadKey = 0, excludeStart, labelledBy }: Props) {
  const tzId = useId();
  const [attempt, setAttempt] = useState(0);
  const [showTz, setShowTz] = useState(false);
  const requestKey = `${reloadKey}:${attempt}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  /** Month shown in the grid, "yyyy-MM"; null = the month of the first free day. */
  const [monthPick, setMonth] = useState<string | null>(null);
  const typeId = useId();
  const [typed, setTyped] = useState("");
  const [typedResult, setTypedResult] = useState<{ message: string; options: Slot[] } | null>(null);

  useEffect(() => {
    const ctrl = { cancelled: false };
    apiFetch<AvailabilityResponse>("/api/availability")
      .then((data) => !ctrl.cancelled && setLoaded({ key: requestKey, data }))
      .catch((err: unknown) => {
        if (ctrl.cancelled) return;
        const msg =
          err instanceof ApiError && err.code === "NETWORK" ? err.message : "We couldn't load the free times. Try again.";
        setLoaded({ key: requestKey, error: msg });
      });
    return () => {
      ctrl.cancelled = true;
    };
  }, [requestKey]);

  const isLoading = loaded?.key !== requestKey;
  const data = !isLoading ? loaded?.data : undefined;
  const error = !isLoading ? loaded?.error : undefined;

  const days = useMemo(() => {
    const map = new Map<string, Slot[]>();
    if (!data || !timeZone) return [] as { key: string; date: DateTime; slots: Slot[] }[];
    for (const s of data.slots) {
      if (excludeStart && Date.parse(s.start) === Date.parse(excludeStart)) continue;
      const key = DateTime.fromISO(s.start, { zone: timeZone }).toISODate();
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, slots]) => ({ key, date: DateTime.fromISO(key, { zone: timeZone }), slots }));
  }, [data, timeZone, excludeStart]);

  const activeKey = pickedDay && days.some((d) => d.key === pickedDay) ? pickedDay : (days[0]?.key ?? null);
  const active = days.find((d) => d.key === activeKey);
  const today = DateTime.now().setZone(timeZone || "local");
  const month = monthPick ?? activeKey?.slice(0, 7) ?? today.toFormat("yyyy-LL");
  const options = useMemo(() => (showTz ? zoneOptions(timeZone) : []), [showTz, timeZone]);
  const zoneShort = DateTime.now().setZone(timeZone || "local").toFormat("ZZZZ");

  if (isLoading) {
    return (
      <div className="picker" aria-busy="true">
        <p className="sr-only" role="status">
          Loading free times…
        </p>
        <span className="skeleton" style={{ height: 52, borderRadius: 14 }} aria-hidden="true" />
        <span className="skeleton" style={{ height: 260, borderRadius: 18 }} aria-hidden="true" />
        <div className="time-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="skeleton time-skel" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="notice notice-error" role="alert">
        <p>{error}</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttempt((a) => a + 1)}>
          Try again
        </button>
      </div>
    );
  }

  if (!days.length) {
    return (
      <div className="notice">
        <p>No free times right now. New times open every day, so check back soon or DM us on Instagram.</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttempt((a) => a + 1)}>
          Refresh
        </button>
      </div>
    );
  }

  const fmtSlot = (s: Slot) => DateTime.fromISO(s.start, { zone: timeZone }).toFormat("h:mm a");

  function pickDay(key: string) {
    setPickedDay(key);
    setMonth(key.slice(0, 7));
    if (selected && DateTime.fromISO(selected.start, { zone: timeZone }).toISODate() !== key) onSelect(null);
  }

  /** "tomorrow 6:30 pm" → select that slot, or show the closest free ones. */
  function findTyped() {
    const parsed = parseWhen(typed, today);
    if (!parsed) {
      setTypedResult({ message: "Try something like “tomorrow 6:30 pm” or “sat 11am”.", options: [] });
      return;
    }
    const dayKey = parsed.date ?? activeKey;
    let day = days.find((d) => d.key === dayKey);
    let note = "";
    if (!day) {
      // Nothing free that day: jump to the next day that has times.
      day = days.find((d) => dayKey && d.key > dayKey) ?? days[days.length - 1];
      if (!day) return;
      const asked = dayKey ? DateTime.fromISO(dayKey, { zone: timeZone }).toFormat("ccc d LLL") : "that day";
      note = `No free times on ${asked}. `;
    }
    pickDay(day.key);
    if (parsed.minutes === undefined) {
      setTypedResult({ message: `${note}Showing ${day.date.toFormat("cccc d LLLL")}. Pick a time below.`, options: [] });
      return;
    }
    const mins = (s: Slot) => {
      const t = DateTime.fromISO(s.start, { zone: timeZone });
      return t.hour * 60 + t.minute;
    };
    const exact = !note ? day.slots.find((s) => mins(s) === parsed.minutes) : undefined;
    if (exact) {
      onSelect(exact);
      setTypedResult({ message: `${day.date.toFormat("ccc d LLL")} at ${fmtSlot(exact)} is free. Selected.`, options: [] });
      return;
    }
    const closest = [...day.slots].sort((a, b) => Math.abs(mins(a) - parsed.minutes!) - Math.abs(mins(b) - parsed.minutes!)).slice(0, 3);
    closest.sort((a, b) => a.start.localeCompare(b.start));
    const wanted = DateTime.fromObject({ hour: Math.floor(parsed.minutes / 60), minute: parsed.minutes % 60 }).toFormat("h:mm a");
    setTypedResult({
      message: `${note}${note ? "" : `${wanted} isn't available. `}Closest free times on ${day.date.toFormat("ccc d LLL")}:`,
      options: closest,
    });
  }

  // ---- month grid (Monday first, like most calendars in India)
  const monthStart = DateTime.fromISO(`${month}-01`, { zone: timeZone || "local" });
  const firstMonth = days[0]!.key.slice(0, 7);
  const lastMonth = days[days.length - 1]!.key.slice(0, 7);
  const byKey = new Map(days.map((d) => [d.key, d]));
  const cells: (DateTime | null)[] = [
    ...Array.from({ length: monthStart.weekday - 1 }, () => null),
    ...Array.from({ length: monthStart.daysInMonth ?? 30 }, (_, i) => monthStart.plus({ days: i })),
  ];
  const todayKey = today.toISODate();

  return (
    <div className="picker cal" role="group" aria-labelledby={labelledBy}>
      <form
        className="cal-type"
        onSubmit={(e) => {
          e.preventDefault();
          findTyped();
        }}
      >
        <label htmlFor={typeId}>Type a day and time</label>
        <div className="cal-type-row">
          <input
            id={typeId}
            type="text"
            inputMode="text"
            autoComplete="off"
            placeholder="e.g. tomorrow 6:30 pm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-describedby={typedResult ? `${typeId}-result` : undefined}
          />
          <button type="submit" className="btn btn-ghost">
            Find
          </button>
        </div>
        {typedResult && (
          <div id={`${typeId}-result`} className="cal-type-result" role="status">
            <p>{typedResult.message}</p>
            {typedResult.options.length > 0 && (
              <div className="cal-type-options">
                {typedResult.options.map((s) => (
                  <button
                    key={s.start}
                    type="button"
                    className={`time${selected?.start === s.start ? " is-on" : ""}`}
                    aria-pressed={selected?.start === s.start}
                    onClick={() => onSelect(s)}
                  >
                    {fmtSlot(s)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </form>

      <p className="cal-or" aria-hidden="true">
        <span>or pick on the calendar</span>
      </p>

      <div className="cal-body">
        <div className="cal-month">
          <div className="cal-head">
            <button
              type="button"
              className="cal-nav"
              onClick={() => setMonth(monthStart.minus({ months: 1 }).toFormat("yyyy-LL"))}
              disabled={month <= firstMonth}
              aria-label="Previous month"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <p className="cal-title" aria-live="polite">
              {monthStart.toFormat("LLLL yyyy")}
            </p>
            <button
              type="button"
              className="cal-nav"
              onClick={() => setMonth(monthStart.plus({ months: 1 }).toFormat("yyyy-LL"))}
              disabled={month >= lastMonth}
              aria-label="Next month"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <div className="cal-grid">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => (
              <span key={w} className="cal-wd" aria-hidden="true">
                {w.slice(0, 1)}
                <span className="cal-wd-rest">{w.slice(1)}</span>
              </span>
            ))}
            {cells.map((c, i) => {
              if (!c) return <span key={`b${i}`} aria-hidden="true" />;
              const key = c.toISODate()!;
              const day = byKey.get(key);
              const on = key === activeKey;
              return (
                <button
                  key={key}
                  type="button"
                  className={`cal-day${on ? " is-on" : ""}${day ? " has-slots" : ""}${key === todayKey ? " is-today" : ""}`}
                  disabled={!day}
                  aria-pressed={on}
                  aria-label={`${c.toFormat("cccc d LLLL")}${day ? `, ${day.slots.length} free time${day.slots.length === 1 ? "" : "s"}` : ", no free times"}`}
                  onClick={() => pickDay(key)}
                >
                  {c.day}
                </button>
              );
            })}
          </div>
        </div>

        <div className="cal-times">
          {active && (
            <>
              <p className="cal-times-title">
                {dayLabel(active.date, today) === active.date.toFormat("ccc")
                  ? active.date.toFormat("cccc d LLLL")
                  : `${dayLabel(active.date, today)} · ${active.date.toFormat("ccc d LLL")}`}
                <span>
                  {active.slots.length} free time{active.slots.length === 1 ? "" : "s"}
                </span>
              </p>
              {PARTS.map((part) => {
                const slots = active.slots.filter((s) => part.test(DateTime.fromISO(s.start, { zone: timeZone }).hour));
                if (!slots.length) return null;
                return (
                  <div key={part.key} className="time-group">
                    <p className="time-group-label">{part.label}</p>
                    <ul className="time-grid">
                      {slots.map((s) => {
                        const on = selected?.start === s.start;
                        return (
                          <li key={s.start}>
                            <button
                              type="button"
                              className={`time${on ? " is-on" : ""}`}
                              aria-pressed={on}
                              onClick={() => onSelect(on ? null : s)}
                            >
                              {fmtSlot(s)}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      <div className="tz-line">
        <span>
          Times in your time zone ({zoneShort}).{" "}
          <button type="button" className="link-btn" onClick={() => setShowTz((v) => !v)} aria-expanded={showTz}>
            {showTz ? "Done" : "Change"}
          </button>
        </span>
        {showTz && (
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
        )}
      </div>
    </div>
  );
}
