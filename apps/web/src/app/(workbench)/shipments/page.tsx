import type { Metadata } from "next";
import { Suspense } from "react";

import { LoadingBlock } from "@/components/ui";

import { ShipmentsView } from "./shipments-view";

export const metadata: Metadata = { title: "Shipments" };

export default function ShipmentsPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Loading shipments" rows={6} />}>
      <ShipmentsView />
    </Suspense>
  );
}
