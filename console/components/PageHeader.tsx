"use client";

/**
 * PageHeader — pages call <PageHeader title="…" parents={[…]} /> at mount
 * and the AppShell's top bar reads it via PageTitleContext.
 *
 * Why a context (not a top-bar prop): each page owns its title, but the
 * shell is rendered once around all of them. The context lets a page push
 * its title up without prop-drilling through layouts.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Crumb = { label: string; href?: string };

type Ctx = {
  title: string;
  parents: Crumb[];
  setTitle: (title: string, parents?: Crumb[]) => void;
};

const PageTitleContext = createContext<Ctx | null>(null);

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ title: string; parents: Crumb[] }>({ title: "", parents: [] });
  const value = useMemo<Ctx>(
    () => ({
      title: state.title,
      parents: state.parents,
      setTitle: (title, parents = []) => setState({ title, parents }),
    }),
    [state],
  );
  return <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>;
}

export function usePageTitle(): Ctx {
  const v = useContext(PageTitleContext);
  if (!v) throw new Error("usePageTitle must be used inside <PageTitleProvider>");
  return v;
}

/** Call from a page to set the top-bar title + crumbs. Safe to use even
 *  when there's no provider (e.g. the console embedded in Dograh's iframe,
 *  where our top bar isn't rendered) — it just updates document.title. */
export function PageHeader({ title, parents }: { title: string; parents?: Crumb[] }) {
  const ctx = useContext(PageTitleContext);
  useEffect(() => {
    ctx?.setTitle(title, parents ?? []);
    if (typeof document !== "undefined") document.title = title;
  }, [title, JSON.stringify(parents ?? [])]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
