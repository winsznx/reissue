import { expect, test } from "@playwright/test";

import { listCases } from "./support";

test("lists real cases and filters by stage", async ({ page, request }) => {
  const all = await listCases(request);
  expect(all.length, "the local stack should have seeded cases").toBeGreaterThan(0);

  await page.goto("/shipments");
  const rows = page.getByTestId("case-row");
  await expect(rows.first()).toBeVisible();
  await expect(rows.filter({ hasText: all[0]!.caseCode })).toHaveCount(1);

  const ready = await listCases(request, "ready");
  await page.getByRole("tab", { name: "Ready", exact: true }).click();
  await expect(page).toHaveURL(/tab=ready/);
  if (ready.length) {
    await expect(rows).toHaveCount(ready.length);
    for (const state of await rows.getByTestId("case-state").allTextContents()) expect(state).toBe("Ready for broker review");
  } else {
    await expect(page.getByText("No shipments match this view.")).toBeVisible();
  }

  await page.getByRole("tab", { name: "Waiting on supplier" }).click();
  await expect(page).toHaveURL(/tab=waiting_on_supplier/);
  const waiting = await listCases(request, "waiting_on_supplier");
  if (waiting.length) {
    await expect(rows.first().getByTestId("case-state")).toHaveText("Waiting on supplier");
  }

  await page.getByRole("tab", { name: "All", exact: true }).click();
  await expect(page).not.toHaveURL(/tab=/);
  await page.getByLabel("Search by case, supplier, invoice or PO").fill(all[0]!.caseCode);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(all[0]!.caseCode);
});
