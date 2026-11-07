import type { Metadata } from "next";
import type { ReactElement } from "react";

import { AgentsSection } from "@/components/landing/agents-section";
import { DesignRules } from "@/components/landing/design-rules";
import { FaqSection } from "@/components/landing/faq-section";
import { FinalCta } from "@/components/landing/final-cta";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { PacketSection } from "@/components/landing/packet-section";
import { ProofSection } from "@/components/landing/proof-section";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";

export const metadata: Metadata = {
  title: { absolute: "Reissue: corrected shipping papers through your team's chat" },
  description:
    "Reissue finds where a commercial invoice and packing list disagree, asks the supplier in their Telegram group, rechecks the revised PDF and posts the current, unaltered files for your customs broker in Slack.",
};

export default function LandingPage(): ReactElement {
  return (
    <div className="text-base">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <Hero />
        <HowItWorks />
        <AgentsSection />
        <PacketSection />
        <DesignRules />
        <ProofSection />
        <FaqSection />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
