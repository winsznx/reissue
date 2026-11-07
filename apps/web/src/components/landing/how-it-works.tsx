import type { ReactElement } from "react";

import { LoopStepper } from "./loop-stepper";
import { Section, SectionIntro } from "./primitives";

export function HowItWorks(): ReactElement {
  return (
    <Section id="how-it-works">
      <SectionIntro
        sectionId="how-it-works"
        title="What happens after you mention @reissue"
        lead="Seven steps, from two PDFs in Slack to a packet for your customs broker. Pick a step to see what happened in case SHP-0287."
      />
      <LoopStepper />
    </Section>
  );
}
