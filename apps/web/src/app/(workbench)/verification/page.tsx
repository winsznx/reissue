import type { Metadata } from "next";

import { VerificationView } from "./verification-view";

export const metadata: Metadata = { title: "Verification" };

export default function VerificationPage() {
  return <VerificationView />;
}
