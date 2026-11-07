import Link from "next/link";
import type { ReactElement } from "react";

import { ReissueLockup } from "./marks";
import { Container, GitHubLink, WorkbenchLink, actionClass } from "./primitives";

const SECTION_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#agents", label: "Agents" },
  { href: "#packet", label: "Broker packet" },
  { href: "#proof", label: "Testing" },
  { href: "#faq", label: "FAQ" },
] as const;

export function SiteHeader(): ReactElement {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-[6px]">
      <Container className="flex h-16 items-center gap-6">
        <Link href="/" aria-label="Reissue home" className="shrink-0 rounded-mark">
          <ReissueLockup />
        </Link>
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {SECTION_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="inline-flex h-9 items-center rounded-mark px-3 text-sm text-ink-2 transition-colors duration-150 hover:bg-sunken hover:text-ink">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden sm:block">
            <GitHubLink className={actionClass("secondary", "md")} />
          </div>
          <WorkbenchLink className={actionClass("primary", "md")} />
        </div>
      </Container>
    </header>
  );
}
