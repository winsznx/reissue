"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { errorMessage, sendJson } from "@/lib/api";
import { useSession } from "@/lib/queries";

import { UploadIcon } from "../icons";
import { buttonClass, cx } from "../ui";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { href: "/shipments", label: "Shipments" },
  { href: "/activity", label: "Activity" },
  { href: "/verification", label: "Verification" },
  { href: "/settings", label: "Settings" },
];

export function Wordmark() {
  return (
    <span className="inline-flex items-baseline gap-1 font-serif text-[1.3rem] font-semibold leading-none tracking-[-0.01em] text-ink">
      Reissue
      <span aria-hidden className="inline-block size-[0.4rem] translate-y-[-0.1rem] rounded-full bg-accent" />
    </span>
  );
}

function SessionMenu() {
  const { data } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    try {
      await sendJson("DELETE", "/v1/auth/session");
      router.replace("/sign-in");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!data?.user) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-ink-2">
      <span className="hidden max-w-32 truncate sm:inline" title={`Signed in as ${data.user}`}>
        {data.user}
      </span>
      <button type="button" onClick={() => void signOut()} className="rounded px-1 font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline">
        Sign out
      </button>
      {error ? (
        <span role="alert" className="text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur-[2px]">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4 md:px-6">
          <Link href="/shipments" aria-label="Reissue Workbench, shipments" className="shrink-0 rounded">
            <Wordmark />
          </Link>
          <nav aria-label="Workbench" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {NAV.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "relative rounded-[6px] px-2.5 py-1.5 text-sm transition-colors duration-150",
                        active ? "font-medium text-ink after:absolute after:inset-x-2.5 after:-bottom-[13px] after:h-[2px] after:bg-accent" : "text-ink-2 hover:text-ink",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden sm:block">
              <Link href="/upload" className={buttonClass("secondary", "sm")}>
                <UploadIcon size={14} />
                Upload
              </Link>
            </span>
            <ThemeToggle />
            <SessionMenu />
          </div>
        </div>
        <nav aria-label="Workbench sections" className="border-t border-line md:hidden">
          <ul className="flex justify-between px-2">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href} className="flex-1">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cx("block py-2.5 text-center text-[0.8125rem]", active ? "font-medium text-ink shadow-[inset_0_-2px_0_var(--accent)]" : "text-ink-2")}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-16 pt-6 outline-none md:px-6">
        {children}
      </main>
    </div>
  );
}
