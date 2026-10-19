"use client";

import { DateTime } from "luxon";
import { useEffect, useId, useMemo, useState } from "react";
import type { AvailabilityResponse } from "@/lib/shared/api";
import { ApiError, apiFetch } from "./api-client";

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
 * The simplest possible picker: tap a day, tap a time. Only days with free times are shown.
 * Times are shown in the visitor's time zone (auto-detected, changeable).
 */
export function SlotPicker({ timeZone, onTimeZoneChange, selected, onSelect, reloadKey = 0, excludeStart, labelledBy }: Props) {
  const tzId = useId();
  const [attempt, setAttempt] = useState(0);
  const [showTz, setShowTz] = useState(false);
  const requestKey = `${reloadKey}:${attempt}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);

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
  const options = useMemo(() => (showTz ? zoneOptions(timeZone) : []), [showTz, timeZone]);
  const zoneShort = DateTime.now().setZone(timeZone || "local").toFormat("ZZZZ");

  if (isLoading) {
    return (
      <div className="picker" aria-busy="true">
        <p className="sr-only" role="status">
          Loading free times…
        </p>
        <div className="day-strip" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className="skeleton day-skel" />
          ))}
        </div>
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

  return (
    <div className="picker" role="group" aria-labelledby={labelledBy}>
      <p className="picker-label">1. Pick a day</p>
      <div className="day-strip" role="listbox" aria-label="Days with free times">
        {days.map((d) => {
          const on = d.key === activeKey;
          return (
            <button
              key={d.key}
              type="button"
              role="option"
              aria-selected={on}
              className={`day${on ? " is-on" : ""}`}
              onClick={() => {
                setPickedDay(d.key);
                if (selected && DateTime.fromISO(selected.start, { zone: timeZone }).toISODate() !== d.key) onSelect(null);
              }}
            >
              <span className="day-name">{dayLabel(d.date, today)}</span>
              <span className="day-num">{d.date.toFormat("d")}</span>
              <span className="day-month">{d.date.toFormat("LLL")}</span>
            </button>
          );
        })}
      </div>

      <p className="picker-label">2. Pick a time</p>
      {active &&
        PARTS.map((part) => {
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
                        {DateTime.fromISO(s.start, { zone: timeZone }).toFormat("h:mm a")}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

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
