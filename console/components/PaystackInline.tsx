"use client";

/**
 * Paystack inline popup launcher.
 *
 * Paystack ships a one-file inline JS (no npm package needed); we
 * dynamically inject the <script> tag and call `PaystackPop.setup` on
 * click. The "verify after redirect" piece is unnecessary in inline
 * mode — the callback fires synchronously with the transaction ref,
 * and the webhook from Paystack reconciles the wallet credit.
 *
 * We keep this thin: parent passes amount + email + reference, gets a
 * callback with the reference on success.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

const SCRIPT_SRC = "https://js.paystack.co/v2/inline.js";

// Module-level promise so multiple components in one session share
// one <script> tag.
let _scriptPromise: Promise<void> | null = null;

function loadPaystack(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (_scriptPromise) return _scriptPromise;
  _scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      if ((window as unknown as { PaystackPop?: unknown }).PaystackPop) return resolve();
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("paystack script failed")), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("paystack script failed"));
    document.head.appendChild(s);
  });
  return _scriptPromise;
}

type PaystackPopHandle = {
  newTransaction: (opts: {
    key: string;
    email: string;
    amount: number;
    currency?: string;
    reference?: string;
    onSuccess?: (r: { reference: string; status: string }) => void;
    onCancel?: () => void;
  }) => void;
};

declare global {
  interface Window {
    PaystackPop?: PaystackPopHandle;
  }
}

export function PaystackInline({
  publicKey,
  amountCents,
  currency,
  email,
  reference,
  onSuccess,
  onCancel,
  label,
}: {
  publicKey: string;
  amountCents: number;
  currency: string;
  email: string;
  reference: string;
  onSuccess: (ref: string) => void;
  onCancel?: () => void;
  label?: string;
}) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const launched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadPaystack()
      .then(() => { if (!cancelled) setReady(true); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, []);

  const open = useCallback(() => {
    if (!window.PaystackPop) { setError("paystack not loaded"); return; }
    if (launched.current) return;
    launched.current = true;
    setBusy(true);
    setError(null);
    window.PaystackPop.newTransaction({
      key: publicKey,
      email,
      amount: amountCents,
      currency,
      reference,
      onSuccess: (r) => {
        launched.current = false;
        setBusy(false);
        onSuccess(r.reference);
      },
      onCancel: () => {
        launched.current = false;
        setBusy(false);
        onCancel?.();
      },
    });
  }, [publicKey, amountCents, currency, email, reference, onSuccess, onCancel]);

  return (
    <div className="space-y-2">
      <Button onClick={open} disabled={!ready || busy} className="w-full">
        {busy
          ? <><Loader2 className="size-4 animate-spin" /> Opening Paystack…</>
          : label ?? "Pay with Paystack"}
      </Button>
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
    </div>
  );
}
