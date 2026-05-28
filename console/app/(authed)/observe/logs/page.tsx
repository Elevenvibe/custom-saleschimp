"use client";

/**
 * /console/observe/logs — tenant-side audit feed.
 *
 * Reads /api/tenant/logs which scopes results to the caller's tenant
 * (matched server-side from the JWT). The tenant gets a read-only view —
 * filtering is just action prefix + pagination. No way to forge another
 * tenant's id; the endpoint ignores any client-supplied tenant filter.
 */

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";

type LogEntry = {
  id: number;
  actor_kind: string;
  actor_user_id: number | null;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  ip: string | null;
  created_at: string;
};

type LogsRes = { total: number; items: LogEntry[] };

export default function LogsPage() {
  const [rows, setRows] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setError(null);
    const qs = action ? `?action=${encodeURIComponent(action)}&limit=100` : "?limit=100";
    api<LogsRes>(`/api/tenant/logs${qs}`)
      .then((r) => {
        setRows(r.items);
        setTotal(r.total);
      })
      .catch((e) => setError((e as Error).message));
  }, [action]);
  useEffect(reload, [reload]);

  return (
    <div className="p-8 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Logs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Audit trail for everything that touched your organization.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">
          Filter by action (prefix)
        </label>
        <input
          className="mt-0.5 w-full max-w-sm rounded-md border px-3 py-2 text-sm"
          placeholder="e.g. tenant.ticket"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
        <div className="mt-2 text-xs text-muted-foreground">
          {total} {total === 1 ? "entry" : "entries"} total
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">Actor</th>
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">Target</th>
              <th className="px-4 py-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No log entries yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-xs">
                  <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5">
                    {r.actor_kind}
                  </span>
                  {r.actor_user_id != null && (
                    <span className="ml-2 text-muted-foreground">#{r.actor_user_id}</span>
                  )}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {r.target_kind ? `${r.target_kind}#${r.target_id}` : "—"}
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{r.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
