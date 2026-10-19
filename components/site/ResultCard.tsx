import Image from "next/image";
import type { ClientResult } from "@/lib/site";

export function ResultCard({ r, sizes }: { r: ClientResult; sizes: string }) {
  return (
    <figure className="result-card">
      <div className="result-photo">
        <Image src={r.image} alt={r.alt} width={r.width} height={r.height} sizes={sizes} />
      </div>
      <figcaption>
        <span className={`result-delta${r.unit ? "" : " is-word"}`}>
          {r.delta}
          {r.unit && <small>{r.unit}</small>}
        </span>
        <span className="result-name">{r.name}</span>
        <span className="result-detail">{r.detail}</span>
      </figcaption>
    </figure>
  );
}
