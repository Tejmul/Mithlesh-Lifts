"use client";

/** Admin page failed to load (e.g. the database was briefly unreachable). */
export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="adm-panel" role="alert">
      <h1 className="adm-h1">This page didn&apos;t load</h1>
      <p className="adm-muted">Usually a short database hiccup. Your data is safe.</p>
      <div className="adm-form-actions">
        <button type="button" className="adm-btn adm-btn-primary" onClick={() => reset()}>
          Try again
        </button>
      </div>
    </div>
  );
}
