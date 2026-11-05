import type { Metadata } from "next";

import { CaseView } from "@/components/case/case-view";

interface Props {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return { title: decodeURIComponent(code).toUpperCase() };
}

export default async function CasePage({ params }: Props) {
  const { code } = await params;
  const caseCode = decodeURIComponent(code).toUpperCase();
  return <CaseView key={caseCode} code={caseCode} />;
}
