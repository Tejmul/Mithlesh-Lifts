"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { CheckoutResponse, QuoteResponse, QuoteView } from "@/lib/shared/api";
import { ApiError, apiFetch } from "@/components/booking/api-client";
import { inr } from "./AccountHome";

type RazorpayResult = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type RazorpayInstance = { open: () => void; on: (event: string, cb: () => void) => void };
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load the payment window."));
    document.body.appendChild(s);
  });
}

export function QuoteDetail({ id }: { id: string }) {
  const router = useRouter();
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "opening" | "confirming">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<QuoteResponse>(`/api/account/quotes/${encodeURIComponent(id)}`)
      .then((r) => !cancelled && setQuote(r.quote))
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) return router.replace(`/book?next=/account/quotes/${id}`);
        setLoadError(err instanceof ApiError && err.status === 404 ? "We couldn't find this quote." : "We couldn't load this quote. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  async function pay() {
    if (!quote) return;
    setError(null);
    setStatus("opening");
    try {
      const checkout = await apiFetch<CheckoutResponse>(`/api/account/quotes/${quote.id}/checkout`, { method: "POST" });
      await loadCheckout();
      const rzp = new window.Razorpay!({
        key: checkout.keyId,
        order_id: checkout.orderId,
        amount: checkout.amountPaise,
        currency: checkout.currency,
        name: checkout.name,
        description: checkout.description,
        prefill: checkout.prefill,
        theme: { color: "#f5b544" },
        modal: { ondismiss: () => setStatus("idle") },
        handler: async (r: RazorpayResult) => {
          setStatus("confirming");
          try {
            const res = await apiFetch<QuoteResponse>("/api/payments/razorpay/verify", { method: "POST", body: { quoteId: quote.id, ...r } });
            setQuote(res.quote);
            setStatus("idle");
          } catch {
            setStatus("idle");
            setError(`We couldn't confirm your payment yet. If money left your account, it's safe. Send us this payment ID on Instagram: ${r.razorpay_payment_id}`);
          }
        },
      });
      rzp.on("payment.failed", () => {
        setStatus("idle");
        setError("The payment didn't go through and no money was taken. Try again or use another method.");
      });
      rzp.open();
    } catch (err) {
      setStatus("idle");
      setError(err instanceof ApiError ? err.message : "We couldn't open the payment window. Try again.");
    }
  }

  if (loadError) {
    return (
      <div className="wizard-card state-block">
        <h1 className="h3">{loadError}</h1>
        <Link className="btn btn-ghost" href="/account">
          Back to my account
        </Link>
      </div>
    );
  }
  if (!quote) return <div className="wizard-card"><span className="skeleton" style={{ height: 260 }} /></div>;

  return (
    <div className="wizard-card quote-card">
      <Link className="text-link back-link" href="/account">
        ← My account
      </Link>
      <p className="eyebrow">Quote {quote.reference}</p>
      <h1 className="quote-plan">{quote.planName}</h1>
      <p className="quote-amount">{inr(quote.amountInr)}</p>
      {quote.duration && <p className="muted">Plan length: {quote.duration}</p>}
      {quote.note && <p className="quote-note">{quote.note}</p>}

      {quote.status === "PAID" ? (
        <div className="notice notice-success" role="status">
          <p>
            <strong>Paid. Welcome aboard!</strong> Your plan dates are on{" "}
            <Link href="/account">your account</Link>. Our team will contact you with the next steps.
          </p>
        </div>
      ) : quote.status === "CANCELLED" ? (
        <div className="notice">
          <p>This quote was withdrawn. DM us on Instagram if you have questions.</p>
        </div>
      ) : quote.canPay ? (
        <>
          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            onClick={() => void pay()}
            disabled={status !== "idle"}
            aria-busy={status !== "idle"}
          >
            {status === "opening" ? "Opening payment…" : status === "confirming" ? "Confirming payment…" : `Pay ${inr(quote.amountInr)}`}
          </button>
          <p className="field-hint">Secure payment by Razorpay: UPI, cards, netbanking and wallets.</p>
        </>
      ) : (
        <div className="notice">
          <p>Online payment opens soon. Our team will share how to pay on WhatsApp.</p>
        </div>
      )}
    </div>
  );
}
