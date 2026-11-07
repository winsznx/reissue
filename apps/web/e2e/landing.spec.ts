import { expect, test } from "@playwright/test";

test.describe("landing page", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("loads without a session and shows the tagline", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wrong shipping papers in. Corrected shipment package out.");
  });

  test("sends a signed-out visitor from Open the Workbench to sign-in", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: "Open the Workbench" }).first().click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fshipments$/);
    await expect(page.getByRole("heading", { name: "Open the Workbench", level: 1 })).toBeVisible();
  });

  test("swaps the stepper panel when a step is picked", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator("#loop-panel");
    const step = page.getByRole("button", { name: "Follows the supplier's natural replies" });
    const supplierReply = "Old packing list. We shipped 500, sending the updated document.";

    await expect(step).toHaveAttribute("aria-pressed", "false");
    await expect(panel).not.toContainText(supplierReply);

    await step.click();

    await expect(step).toHaveAttribute("aria-pressed", "true");
    await expect(panel).toContainText("Step 4 of 7");
    await expect(panel).toContainText(supplierReply);
  });

  test("fits a 360 px screen without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});
