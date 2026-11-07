import Link from "next/link";
import type { ReactElement } from "react";

import { ReissueLockup } from "./marks";
import { Container, ExternalLink } from "./primitives";
import { GITHUB_URL, SWITCH_DOCS_URL, WORKBENCH_HREF } from "./site";

type FooterLink = { kind: "anchor" | "route" | "external"; href: string; label: string };

const FOOTER_COLUMNS: readonly { title: string; links: readonly FooterLink[] }[] = [
  {
    title: "On this page",
    links: [
      { kind: "anchor", href: "#how-it-works", label: "How it works" },
      { kind: "anchor", href: "#agents", label: "Two rooms, three agents" },
      { kind: "anchor", href: "#packet", label: "Broker packet" },
      { kind: "anchor", href: "#rules", label: "Design rules" },
      { kind: "anchor", href: "#proof", label: "Testing" },
      { kind: "anchor", href: "#faq", label: "Questions" },
    ],
  },
  {
    title: "Product",
    links: [
      { kind: "route", href: WORKBENCH_HREF, label: "Open the Workbench" },
      { kind: "external", href: GITHUB_URL, label: "Source on GitHub" },
    ],
  },
  {
    title: "Built on",
    links: [{ kind: "external", href: SWITCH_DOCS_URL, label: "Switch docs" }],
  },
];

const LINK_CLASS = "text-ink-2 transition-colors duration-150 hover:text-ink";

function FooterLinkItem({ link }: { link: FooterLink }): ReactElement {
  switch (link.kind) {
    case "route":
      return (
        <Link href={link.href} prefetch={false} className={LINK_CLASS}>
          {link.label}
        </Link>
      );
    case "external":
      return (
        <ExternalLink href={link.href} className={LINK_CLASS}>
          {link.label}
        </ExternalLink>
      );
    case "anchor":
      return (
        <a href={link.href} className={LINK_CLASS}>
          {link.label}
        </a>
      );
  }
}

export function SiteFooter(): ReactElement {
  return (
    <footer className="border-t border-line">
      <Container className="py-14">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.4fr)_minmax(0,3fr)]">
          <div>
            <Link href="/" aria-label="Reissue home" className="inline-block rounded-mark">
              <ReissueLockup />
            </Link>
            <p className="mt-4 max-w-[30ch] font-serif text-lg leading-snug text-ink">Wrong shipping papers in. Corrected shipment package out.</p>
          </div>
          <nav aria-label="Footer" className="grid gap-8 sm:grid-cols-3">
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.title}>
                <h2 className="text-sm font-semibold text-ink">{column.title}</h2>
                <ul className="mt-3 space-y-2 text-sm">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <FooterLinkItem link={link} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <p className="mt-12 border-t border-line pt-6 text-sm text-ink-2">Built for the Flip the Switch hackathon, November 2026</p>
      </Container>
    </footer>
  );
}
