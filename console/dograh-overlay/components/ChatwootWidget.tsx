"use client";

// SALESCHIMP OVERLAY — replaces dograh/ui/src/components/ChatwootWidget.tsx
// at Docker build time (COPY console/dograh-overlay/ ./src/).
//
// Neutralizes Dograh's floating Chatwoot support bubble on the tenant UI
// (ports 8080/8081). The support widget is being relocated to super-admin
// behind a per-feature permission (see super-admin-permissions slice), so
// tenants no longer get the bottom-right floating widget.
//
// We keep the component as a no-op (rather than editing Dograh's root
// app/layout.tsx, which imports it) so the overlay surface stays tiny and
// low-drift: layout.tsx still imports + renders <ChatwootWidget/>, it just
// renders nothing now.
export default function ChatwootWidget() {
  return null;
}
