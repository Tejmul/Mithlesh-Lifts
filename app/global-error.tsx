"use client";

/** Last resort when even the root layout fails. Must render its own <html>. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#0a0a0b", color: "#f6f4ef", fontFamily: "system-ui, sans-serif", padding: 16 }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 24 }}>Something went wrong</h1>
          <p style={{ color: "#a8a49c" }}>It&apos;s on our side. Please try again in a moment.</p>
          <button type="button" onClick={() => reset()} style={{ marginTop: 12, padding: "12px 22px", borderRadius: 999, border: 0, background: "#f5b544", fontWeight: 700, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
