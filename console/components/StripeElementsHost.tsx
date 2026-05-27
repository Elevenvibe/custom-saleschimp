"use client";

/**
 * Thin wrapper around <Elements> + the PaymentElement / confirm flow.
 *
 * Two modes:
 *   - mode='setup'  → render a SetupIntent flow; on confirm, surface
 *                     the resulting payment_method id (no charge).
 *   - mode='payment'→ render a PaymentIntent flow; on confirm, surface
 *                     the PI id + status (the wallet credit happens
 *                     when Stripe fires the webhook, but we still want
 *                     to close the dialog optimistically).
 *
 * The publishable key + the matching client_secret are required props
 * — the parent dialog fetches them from the gateway, then renders this
 * component once both are known.
 */

import { useMemo, useState } from "react";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";

import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type Mode = "setup" | "payment";

/** Cache loadStripe per publishable key so we don't re-instantiate
 *  Stripe.js across dialog opens — Stripe explicitly recommends a
 *  single promise per publishable key.
 */
const _stripeCache = new Map<string, Promise<Stripe | null>>();

function getStripePromise(publishableKey: string): Promise<Stripe | null> {
  const cached = _stripeCache.get(publishableKey);
  if (cached) return cached;
  const p = loadStripe(publishableKey);
  _stripeCache.set(publishableKey, p);
  return p;
}

export function StripeElementsHost({
  publishableKey,
  clientSecret,
  mode,
  onSuccess,
  onCancel,
  busyLabel,
  submitLabel,
}: {
  publishableKey: string;
  clientSecret: string;
  mode: Mode;
  onSuccess: (result: { id: string; status?: string }) => void;
  onCancel?: () => void;
  busyLabel?: string;
  submitLabel?: string;
}) {
  const stripePromise = useMemo(() => getStripePromise(publishableKey), [publishableKey]);

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: { theme: "stripe" },
      }}
    >
      <ElementsInner
        mode={mode}
        onSuccess={onSuccess}
        onCancel={onCancel}
        busyLabel={busyLabel}
        submitLabel={submitLabel}
      />
    </Elements>
  );
}

function ElementsInner({
  mode,
  onSuccess,
  onCancel,
  busyLabel,
  submitLabel,
}: {
  mode: Mode;
  onSuccess: (result: { id: string; status?: string }) => void;
  onCancel?: () => void;
  busyLabel?: string;
  submitLabel?: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    try {
      // `redirect: "if_required"` keeps card-only flows on-page; only
      // 3DS / redirect-required methods route to the return_url. The
      // path includes /console/ explicitly because Stripe redirects the
      // browser directly — Next's basePath handling never sees this URL.
      const returnUrl = `${window.location.origin}/console/billing`;
      // Branch up front so TypeScript can narrow each result shape —
      // confirmSetup returns { setupIntent } and confirmPayment returns
      // { paymentIntent }; the discriminated union doesn't survive a
      // ternary.
      if (mode === "setup") {
        const r = await stripe.confirmSetup({
          elements,
          confirmParams: { return_url: returnUrl },
          redirect: "if_required",
        });
        if (r.error) {
          setError(r.error.message ?? "Stripe error");
          return;
        }
        const si = r.setupIntent;
        if (!si) {
          setError("Stripe did not return a setup confirmation");
          return;
        }
        const pm = si.payment_method;
        const id = typeof pm === "string" ? pm : pm?.id ?? si.id;
        onSuccess({ id, status: si.status });
      } else {
        const r = await stripe.confirmPayment({
          elements,
          confirmParams: { return_url: returnUrl },
          redirect: "if_required",
        });
        if (r.error) {
          setError(r.error.message ?? "Stripe error");
          return;
        }
        const pi = r.paymentIntent;
        if (!pi) {
          setError("Stripe did not return a payment confirmation");
          return;
        }
        onSuccess({ id: pi.id, status: pi.status });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <PaymentElement />
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        )}
        <Button onClick={submit} disabled={busy || !stripe || !elements}>
          {busy
            ? <><Loader2 className="size-4 animate-spin" /> {busyLabel ?? "Processing…"}</>
            : submitLabel ?? (mode === "setup" ? "Save card" : "Pay")}
        </Button>
      </div>
    </div>
  );
}
