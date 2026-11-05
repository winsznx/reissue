import { expect, test } from "@playwright/test";

import type { CaseDetailDto } from "@reissue/contracts";

import { listCases } from "./support";

test("shows both documents, issues and highlights both sides of a selected issue", async ({ page, request }) => {
  const candidates = (await listCases(request, "waiting_on_supplier")).filter((c) => c.openIssueCount > 0);
  test.skip(candidates.length === 0, "needs a case with an open issue");

  let chosen: CaseDetailDto | null = null;
  for (const candidate of candidates) {
    const detail = (await (await request.get(`/api/v1/cases/${candidate.caseCode}`)).json()) as CaseDetailDto;
    const issue = detail.issues.find((i) => i.status !== "RESOLVED");
    const check = detail.checks.find((c) => c.key === issue?.checkKeys[0]);
    if (check?.lhs?.source?.bbox && check.rhs?.source?.bbox) {
      chosen = detail;
      break;
    }
  }
  test.skip(chosen === null, "needs an open issue with evidence on both documents");

  await page.goto(`/shipments/${chosen!.caseCode}`);
  await expect(page.getByRole("heading", { name: chosen!.caseCode, level: 1 })).toBeVisible();
  const invoice = page.getByTestId("viewer-COMMERCIAL_INVOICE");
  const packing = page.getByTestId("viewer-PACKING_LIST");
  await expect(invoice.getByTestId("page-image")).toBeVisible();
  await expect(packing.getByTestId("page-image")).toBeVisible();
  await expect(page.getByTestId("issue-row").first()).toBeVisible();

  const openIssue = page.getByTestId("issue-row").filter({ hasNot: page.getByText("Resolved", { exact: true }) }).first();
  await openIssue.click();
  await expect(openIssue).toHaveAttribute("aria-pressed", "true");
  await expect(invoice.locator("[data-testid=evidence-mark][data-selected=true]")).toHaveCount(1);
  await expect(packing.locator("[data-testid=evidence-mark][data-selected=true]")).toHaveCount(1);
  await expect(page.getByTestId("evidence-bar")).toContainText("Commercial invoice");
  await expect(page.getByTestId("evidence-bar")).toContainText("Packing list");
});
