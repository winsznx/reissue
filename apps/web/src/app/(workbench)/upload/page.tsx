import type { Metadata } from "next";
import { Suspense } from "react";

import { LoadingBlock } from "@/components/ui";

import { UploadView } from "./upload-view";

export const metadata: Metadata = { title: "Upload documents" };

export default function UploadPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Loading upload" />}>
      <UploadView />
    </Suspense>
  );
}
