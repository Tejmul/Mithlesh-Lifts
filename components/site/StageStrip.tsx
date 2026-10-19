import Image from "next/image";
import { stages } from "@/lib/site";

/**
 * Signature element: his three stages on one "progress rail" (gold → ember).
 * The same rail drives the booking progress indicator.
 */
export function StageStrip({ headingId, compact = false }: { headingId?: string; compact?: boolean }) {
  return (
    <ol className={`stages${compact ? " stages-compact" : ""}`} aria-labelledby={headingId}>
      {stages.map((s, i) => (
        <li key={s.key} className={`stage stage-${s.key}`}>
          <figure>
            <div className="stage-photo">
              <Image
                src={s.image}
                alt={s.alt}
                width={s.width}
                height={s.height}
                sizes="(max-width: 640px) 33vw, (max-width: 1200px) 30vw, 380px"
              />
            </div>
            <figcaption>
              <span className="rail-node" aria-hidden="true" data-final={i === stages.length - 1 || undefined} />
              <span className="stage-step">Stage {s.step}</span>
              <span className="stage-label">{s.label}</span>
            </figcaption>
          </figure>
        </li>
      ))}
    </ol>
  );
}
