"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { ClientResult } from "@/lib/site";

const AUTOPLAY_MS = 4500;
const SWIPE_PX = 40;

/**
 * Fanned 3D card stack of client check-ins. The front card shows a whole before/after photo
 * (never cropped: the BEFORE/AFTER labels are baked into the images); neighbours tilt away behind it.
 * Rotates by itself while on screen; arrows, dots, swipe/drag, keyboard and tapping a side card
 * all move it. Hover, focus and touch pause it. Reduced motion → no autoplay, no tilt.
 */
export function ResultsCarousel({ items }: { items: ClientResult[] }) {
  const n = items.length;
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);
  // Bumped on every manual move so the autoplay timer (and the dot's fill) restarts.
  const [tick, setTick] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const go = useCallback(
    (i: number) => {
      setActive(((i % n) + n) % n);
      setTick((t) => t + 1);
    },
    [n],
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    const el = rootRef.current;
    const io = el ? new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)), { threshold: 0.35 }) : null;
    if (el) io?.observe(el);
    return () => {
      mq.removeEventListener("change", sync);
      io?.disconnect();
    };
  }, []);

  const playing = visible && !paused && !reduced && n > 1;
  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(() => setActive((a) => (a + 1) % n), AUTOPLAY_MS);
    return () => window.clearTimeout(t);
  }, [playing, active, tick, n]);

  /** Shortest signed distance from the active card, so the stack wraps around. */
  const offsetOf = (i: number) => {
    let o = i - active;
    if (o > n / 2) o -= n;
    if (o < -n / 2) o += n;
    return o;
  };

  const current = items[active]!;

  return (
    <section
      ref={rootRef}
      className={`rc${playing ? " is-playing" : ""}`}
      aria-roledescription="carousel"
      aria-label="Client results"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(active - 1);
        if (e.key === "ArrowRight") go(active + 1);
      }}
    >
      <div
        className="rc-stage"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, moved: false };
        }}
        onPointerMove={(e) => {
          if (drag.current && Math.abs(e.clientX - drag.current.x) > 6) drag.current.moved = true;
        }}
        onPointerUp={(e) => {
          const start = drag.current;
          drag.current = null;
          if (!start) return;
          suppressClick.current = start.moved;
          const dx = e.clientX - start.x;
          if (Math.abs(dx) >= SWIPE_PX) go(active + (dx < 0 ? 1 : -1));
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onClickCapture={(e) => {
          // A drag that ended over a card is a swipe, not a tap.
          if (suppressClick.current) e.stopPropagation();
          suppressClick.current = false;
        }}
      >
        {items.map((r, i) => {
          const o = offsetOf(i);
          const isActive = o === 0;
          return (
            <figure
              key={r.name}
              className={`rc-card${isActive ? " is-active" : ""}`}
              style={{ "--o": o, "--abs": Math.abs(o) } as CSSProperties}
              data-far={Math.abs(o) > 2 ? "" : undefined}
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${n}: ${r.name}`}
              aria-hidden={!isActive}
              onClick={isActive ? undefined : () => go(i)}
            >
              <div className="rc-photo">
                <Image className="rc-backdrop" src={r.image} alt="" fill sizes="340px" aria-hidden="true" />
                <Image
                  className="rc-img"
                  src={r.image}
                  alt={r.alt}
                  fill
                  sizes="(max-width: 640px) 76vw, 340px"
                  preload={i === 0}
                  draggable={false}
                />
              </div>
              <span className="rc-badge">Client check-in</span>
              <figcaption className="rc-tags">
                <span className={`rc-delta${r.unit ? "" : " is-word"}`}>
                  {r.delta}
                  {r.unit && <small>{r.unit}</small>}
                </span>
                <span className="rc-tag">{r.name}</span>
              </figcaption>
            </figure>
          );
        })}
      </div>

      <div className="rc-info" aria-live={playing ? "off" : "polite"}>
        <p className="rc-name">{current.name}</p>
        <p className="rc-detail">{current.detail}</p>
      </div>

      <div className="rc-controls">
        <button type="button" className="rc-arrow" onClick={() => go(active - 1)} aria-label="Previous result">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="rc-dots">
          {items.map((r, i) => (
            <button
              key={`${r.name}-${i === active ? tick : "idle"}`}
              type="button"
              className={`rc-dot${i === active ? " is-active" : ""}`}
              style={{ "--ms": `${AUTOPLAY_MS}ms` } as CSSProperties}
              onClick={() => go(i)}
              aria-label={`Show ${r.name}`}
              aria-current={i === active ? "true" : undefined}
            />
          ))}
        </div>
        <button type="button" className="rc-arrow" onClick={() => go(active + 1)} aria-label="Next result">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </section>
  );
}
