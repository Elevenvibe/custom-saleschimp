# What's New — Wallet, Billing & Multi-Currency

> Release: **P2.A3** (and follow-ups f1–f5 + the live FX cron)
> Audience: SalesChimp customers and account owners

We've rebuilt how you pay for SalesChimp — a real wallet, real card on
file, and full visibility into every cent of provider cost.

## The headline change

You now have a **wallet** for each currency you transact in. Every
call your agents make charges it. Top it up once, set auto-reload
once, and stop thinking about billing.

## What you can do today

### A wallet that always tells you the truth

Open **Billing** in the sidebar and you'll see:

- **Balance cards per currency.** USD by default; if you serve
  customers in NGN, EUR, GBP, KES, GHS, ZAR, or INR you'll see a card
  per currency the moment you top up with that currency selected.
- **30-day usage chart.** Daily billed total, drawn live from your
  call records.
- **Full activity log.** Every charge, top-up, refund, coupon
  redemption, manual adjustment — with a "Balance after" column so
  you can audit any moment in time. Export to CSV with one click.

### Top up with Stripe or Paystack — your card never touches us

The Top up button opens **Stripe Elements** (the same iframe Stripe
uses on their own dashboard) or the **Paystack inline popup**. Your
card data goes directly to the provider; SalesChimp only ever sees
the resulting token.

- **Stripe** is the default. You'll see the standard card form, with
  Apple Pay / Google Pay / etc. wherever your browser supports them.
- **Paystack** is available for customers paying in NGN, GHS, KES,
  ZAR — the popup opens inline so you stay on the page.

Add a card once and we'll store a re-usable token (encrypted at rest,
never visible via the API). Future top-ups become a one-click
operation.

### Auto-reload: never run out mid-call

Set a threshold (e.g. "$10") and an amount (e.g. "$50"). When your
balance dips below the threshold, we charge your default card and
credit your wallet — no interruption to active calls.

You can:
- Enable/disable auto-reload per wallet
- Pick which card on file to charge
- Set different thresholds per currency

Every auto-reload lands in your activity log tagged
`reason: auto_reload` so it's easy to spot.

### Coupons

If you've been given a coupon code, paste it in the **Have a code?**
card on the Billing page. Percentage and fixed-amount codes are
supported. One redemption per tenant per code; the credit lands in
your wallet immediately.

### Plans that match how you actually use voice AI

Your plan now expresses billing intervals at the granularity that
matches your business:

- per second / per minute / per hour / per day / per week
- monthly / annual / pure usage-only

The Plans page shows the right unit labels — no more squinting at
"$2.30/mo" when you actually pay per call.

### Provider gating

Your plan declares which provider categories it grants access to
(LLM, TTS, STT, Embedding, Telephony, Phone Numbers). If your team
tries to enable a provider outside that set, we surface a clear
"Not included in your plan — upgrade or contact sales" message.

### Country scope (telephony)

Telephony pricing now respects the country list on your plan. Calls
to countries outside that list are blocked until your plan is
upgraded or the list is extended.

### Extended reports

The Recent Usage section now surfaces three columns per call:

- **Raw** — what the underlying provider (OpenAI, Twilio, etc.)
  charged us
- **Markup** — the SalesChimp markup applied per your plan's rule
- **Billed** — what was actually drawn from your wallet

If those three ever diverge surprisingly, you know exactly where to
look.

## For admins running multiple workspaces

(You'll only see these if you have a super-admin account.)

- **Per-tenant wallet drilldown** at `/tenants/{id}/wallet`. Full
  ledger, every payment intent, every usage record, with an Adjust
  Balance and a Credit Limit dialog (notes required — they land in
  audit_log automatically).
- **Cross-tenant Billing dashboard** at `/billing` — provider health,
  total balance roll-up, lowest balances (i.e. who's about to need a
  top-up), recent payment intents across the whole platform,
  coupons CRUD.
- **Settings → Payment gateways** — paste Stripe / Paystack keys
  without redeploying. Secrets are Fernet-encrypted; the GET API only
  ever returns the last 4 chars of the secret. Clearing a row falls
  back to env vars.
- **Settings → FX rates** — manage cross-currency conversion. Manual
  overrides always win over the live fetcher.

## Multi-currency + live FX

If your business spans multiple currencies, we now hold a separate
balance per currency. Charges land in the wallet that matches the
billed currency — no surprise conversions.

The **FX rate fetcher** pulls live rates from a free public source
(open.er-api.com) once an hour for the configured currency set
(NGN, EUR, GBP, KES, GHS, ZAR, INR by default — your admin can
extend). Manual overrides set by your admin always win, so a
negotiated enterprise rate stays put.

## What's still rough (and on the roadmap)

- **Stripe / Paystack subscription billing** — today's plans charge
  on a manual or auto-reload basis. Recurring monthly card charges
  for plan fees ship in the next iteration.
- **Per-tenant invoice PDFs** — wallet activity is available as CSV
  today; PDF invoices for accounting workflows are a follow-up.
- **SSO** — admin configuration is live; the end-to-end OIDC and
  SAML sign-in flows are in flight.
- **Plugin marketplace** — admin catalog and customer browse are
  live; recurring monthly plugin billing wires up alongside
  subscription billing above.

## Migrating from the old billing model

If you were on month-to-month flat billing before this release,
nothing changes for you on day one. Your wallet auto-provisions with
a 0 balance the first time you visit `/billing`; your existing plan
keeps applying minutes from its bundle. The wallet kicks in only when
you start topping up.

If you'd like a comp credit while transitioning, ping your account
owner — they can adjust your balance from the admin dashboard in
seconds, and the audit log will show exactly what they did and when.

## Need help?

- **Customer:** open Billing → Activity → CSV export and send it to
  support@mysaleschimp.com along with your question.
- **Account owner:** the per-tenant Wallet drilldown surfaces every
  charge, intent, refund, and adjustment — usually faster than
  emailing us.

— The SalesChimp team
