"use client";

/**
 * NotificationBell — header bell for super-admins.
 *
 * Polls GET /api/admin/notifications every 30s for the unread count +
 * recent items, renders a badge, and a click-to-open popover listing the
 * latest notifications. Clicking an item marks it read and follows its
 * link (if any); "View all" goes to /notifications.
 *
 * Real-time push (Pusher / Beam) is a follow-up — polling keeps the bell
 * dependency-free for now.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, Check } from "lucide-react";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

type Note = {
  id: number;
  category: string | null;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
};
type NoteList = { unread_count: number; items: Note[] };

const POLL_MS = 30_000;

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationBell() {
  const router = useRouter();
  const [data, setData] = useState<NoteList | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api<NoteList>("/api/admin/notifications?limit=10")
      .then(setData)
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, POLL_MS);
    return () => clearInterval(iv);
  }, [load]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unread = data?.unread_count ?? 0;

  async function openItem(n: Note) {
    if (!n.read) {
      try {
        await api(`/api/admin/notifications/${n.id}/read`, { method: "POST" });
      } catch {
        /* non-fatal */
      }
      load();
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  async function markAll() {
    try {
      await api("/api/admin/notifications/read-all", { method: "POST" });
    } catch {
      /* non-fatal */
    }
    load();
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Notifications"
        onClick={() => setOpen((o) => !o)}
        className="relative"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-medium text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-medium">Notifications</span>
            {unread > 0 && (
              <button
                onClick={markAll}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Check className="size-3" /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {!data || data.items.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                You&apos;re all caught up.
              </div>
            ) : (
              <ul className="divide-y">
                {data.items.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => openItem(n)}
                      className={`flex w-full gap-2 px-3 py-2.5 text-left hover:bg-muted/50 ${
                        n.read ? "" : "bg-blue-50/60"
                      }`}
                    >
                      <span
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${
                          n.read ? "bg-transparent" : "bg-blue-500"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{n.title}</span>
                        {n.body && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {n.body}
                          </span>
                        )}
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          {relativeTime(n.created_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t px-3 py-2 text-center">
            <Link
              href="/notifications"
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => setOpen(false)}
            >
              View all
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
