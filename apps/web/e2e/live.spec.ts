import { expect, test } from "@playwright/test";

import { expectSameWindow, markWindow, startScenario } from "./support";

test("a reordered-lines run reaches ready on the open case page", async ({ page }) => {
  const code = await startScenario(page, "reordered-lines");
  await page.getByTestId("started-case-link").click();
  await expect(page).toHaveURL(new RegExp(`/shipments/${code}$`));
  await markWindow(page);
  await expect(page.getByTestId("stream-status").first()).toHaveAttribute("data-status", "live");
  await expect(page.getByTestId("case-state").first()).toHaveText("Ready for broker review", { timeout: 45_000 });
  await expect(page.getByTestId("checks-summary")).toContainText(/(\d+) \/ \1 required checks passing/);
  await expect(page.getByTestId("lifecycle").locator("[data-status=done]").last()).toContainText("Ready");
  await expectSameWindow(page);
});

test("a scripted supplier revision updates the already-open case without reload", async ({ page, context }) => {
  const code = await startScenario(page, "quantity-correction");
  await page.goto(`/shipments/${code}`);
  await markWindow(page);
  await expect(page.getByTestId("case-state").first()).toHaveText("Waiting on supplier", { timeout: 45_000 });
  await expect(page.getByTestId("viewer-PACKING_LIST").getByTestId("version-chip")).toHaveCount(1);

  const control = await context.newPage();
  await control.goto("/verification");
  const run = control.locator(`[data-testid=run-row][data-case="${code}"]`);
  const next = run.getByTestId("next-step");
  await expect(next).toBeEnabled({ timeout: 45_000 });
  await next.click();
  await expect(run.getByRole("status")).toContainText("Step 1");
  await control.close();

  await expect(page.getByTestId("case-state").first()).toHaveText("Ready for broker review", { timeout: 45_000 });
  const chips = page.getByTestId("viewer-PACKING_LIST").getByTestId("version-chip");
  await expect(chips).toHaveCount(2);
  await expect(chips.first()).toContainText("v2");
  await expect(chips.first()).toContainText("Current");
  await expect(chips.first()).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("timeline")).toContainText("Revised packing list v2 received");
  await expectSameWindow(page);
});
