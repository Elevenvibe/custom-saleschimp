"use client";

/**
 * /notifications — full notification history for the super-admin.
 * The header bell links here via "View all". Same data source
 * (/api/admin/notifications) at a higher limit, with click-to-read +
 * mark-all-read.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check } from "lucide-react";

import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
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

export default function NotificationsPage() {
  const router = useRouter();
  const [data, setData] = useState<NoteList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<NoteList>("/api/admin/notifications?limit=100")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  async function openItem(n: Note) {
    if (!n.read) {
      try {
        await api(`/api/admin/notifications/${n.id}/read`, { method: "POST" });
      } catch {
        /* non-fatal */
      }
      load();
    }
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
    <>
      <PageHeader
        title="Notifications"
        action={
          data && data.unread_count > 0 ? (
            <Button variant="outline" size="sm" onClick={markAll}>
              <Check className="size-4" /> Mark all read
            </Button>
          ) : undefined
        }
      />
      <div className="p-8">
        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        {!data ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : data.items.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 p-12 text-center">
            <Bell className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">No notifications yet.</p>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-lg border bg-card">
            {data.items.map((n) => (
              <li key={n.id} className="border-b last:border-b-0">
                <button
                  onClick={() => openItem(n)}
                  className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-muted/50 ${
                    n.read ? "" : "bg-blue-50/60"
                  }`}
                >
                  <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${
                      n.read ? "bg-transparent" : "bg-blue-500"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{n.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {new Date(n.created_at).toLocaleString()}
                      </span>
                    </span>
                    {n.body && (
                      <span className="mt-0.5 block text-sm text-muted-foreground">{n.body}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
