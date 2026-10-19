import type { CSSProperties, ReactNode } from "react";

const d = (n: number) => ({ "--d": n }) as CSSProperties;

export function PageIntro({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-intro">
      <p className="eyebrow hero-in" style={d(0)}>
        {eyebrow}
      </p>
      <h1 className="hero-in" style={d(1)}>
        {title}
      </h1>
      {children && (
        <div className="page-intro-lede hero-in" style={d(2)}>
          {children}
        </div>
      )}
    </header>
  );
}
