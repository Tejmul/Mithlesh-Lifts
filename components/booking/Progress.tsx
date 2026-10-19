const LABELS = ["Verify number", "Pick a time", "Confirm"];

/** Booking progress: the same gold→ember rail as the stage strip. */
export function Progress({ step }: { step: number }) {
  return (
    <div className="progress">
      <p className="progress-count">
        Step {step} of {LABELS.length}
        <span className="progress-name"> · {LABELS[step - 1]}</span>
      </p>
      <div
        className="progress-bar"
        role="progressbar"
        aria-label="Booking progress"
        aria-valuemin={1}
        aria-valuemax={LABELS.length}
        aria-valuenow={step}
        aria-valuetext={`Step ${step} of ${LABELS.length}: ${LABELS[step - 1]}`}
      >
        <span style={{ width: `${(step / LABELS.length) * 100}%` }} />
      </div>
      <ol className="progress-steps" aria-hidden="true">
        {LABELS.map((l, i) => (
          <li key={l} className={i + 1 < step ? "is-done" : i + 1 === step ? "is-current" : undefined}>
            {l}
          </li>
        ))}
      </ol>
    </div>
  );
}
