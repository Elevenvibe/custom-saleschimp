"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { api, type AdminInvite, type AdminInvitesRes } from "@/lib/api";
import { PageDescription, PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2 } from "lucide-react";

type StateFilter = "all" | "pending" | "accepted" | "expired";

export default function InvitesPage() {
  const [data, setData] = useState<AdminInvitesRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<StateFilter>("pending");

  function load() {
    api<AdminInvitesRes>(`/api/admin/invites?state=${state}&limit=200`)
      .then(setData)
      .catch((e) => setError(e.message));
  }
  useEffect(load, [state]);

  async function revoke(invite: AdminInvite) {
    if (!confirm(`Revoke invite for ${invite.email}?`)) return;
    try {
      await api(`/api/admin/invites/${invite.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader title="Invites" />
      <div className="p-8 space-y-4">
        <PageDescription>Every invite across every tenant. Revoke ones that look wrong.</PageDescription>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Filter:</span>
          <Select value={state} onValueChange={(v) => setState(v as StateFilter)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="accepted">Accepted</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
          {data && (
            <span className="text-xs text-muted-foreground">
              Showing {data.items.length} of {data.total}
            </span>
          )}
        </div>

        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Tenant</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">State</th>
                <th className="px-4 py-2">Expires</th>
                <th className="px-4 py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {!data && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {data?.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    No invites match this filter.
                  </td>
                </tr>
              )}
              {data?.items.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="px-4 py-2">
                    <Link href={`/tenants/${i.tenant_id}`} className="hover:underline">
                      {i.tenant_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{i.email}</td>
                  <td className="px-4 py-2">
                    <Badge variant="secondary">{i.role}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <Badge
                      variant={
                        i.state === "accepted"
                          ? "default"
                          : i.state === "expired"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {i.state}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(i.expires_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {i.state !== "accepted" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => revoke(i)}
                        title="Revoke"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
