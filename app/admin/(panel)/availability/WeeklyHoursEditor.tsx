"use client";

import { useState } from "react";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export type EditorWindow = { key: string; weekday: number; start: string; end: string };

let counter = 0;
const newKey = () => `w${++counter}-${Date.now()}`;

export function WeeklyHoursEditor({ initial }: { initial: Omit<EditorWindow, "key">[] }) {
  const [windows, setWindows] = useState<EditorWindow[]>(() => initial.map((w, i) => ({ ...w, key: `i${i}` })));

  const update = (key: string, patch: Partial<EditorWindow>) =>
    setWindows((list) => list.map((w) => (w.key === key ? { ...w, ...patch } : w)));

  return (
    <div className="adm-hours">
      <input
        type="hidden"
        name="windows"
        value={JSON.stringify(windows.map(({ weekday, start, end }) => ({ weekday, start, end })))}
      />
      {DAYS.map((day, i) => {
        const weekday = i + 1;
        const rows = windows.filter((w) => w.weekday === weekday);
        return (
          <fieldset key={day} className="adm-hours-day">
            <legend>{day}</legend>
            {rows.length === 0 && <p className="adm-muted adm-small">Unavailable</p>}
            {rows.map((w) => (
              <div key={w.key} className="adm-hours-row">
                <label>
                  <span className="adm-sr">{day} start</span>
                  <input type="time" value={w.start} required onChange={(e) => update(w.key, { start: e.target.value })} />
                </label>
                <span aria-hidden="true">–</span>
                <label>
                  <span className="adm-sr">{day} end</span>
                  <input type="time" value={w.end} required onChange={(e) => update(w.key, { end: e.target.value })} />
                </label>
                <button
                  type="button"
                  className="adm-btn adm-btn-ghost adm-btn-sm"
                  onClick={() => setWindows((list) => list.filter((x) => x.key !== w.key))}
                  aria-label={`Remove ${day} ${w.start}–${w.end}`}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="adm-btn adm-btn-ghost adm-btn-sm"
              onClick={() => setWindows((list) => [...list, { key: newKey(), weekday, start: "10:00", end: "13:00" }])}
            >
              + Add hours
            </button>
          </fieldset>
        );
      })}
    </div>
  );
}
