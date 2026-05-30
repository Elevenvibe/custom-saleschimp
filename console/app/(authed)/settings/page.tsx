"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SettingsIndex() {
  const router = useRouter();
  useEffect(() => { router.replace("/settings/organization"); }, [router]);
  return <div className="p-8 text-sm text-muted-foreground">Redirecting…</div>;
}
