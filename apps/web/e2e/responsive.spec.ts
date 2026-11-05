import { expect, test, type Page } from "@playwright/test";

import { listCases } from "./support";

async function expectNoHorizontalScroll(page: Page) {
  const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("renders every main view without horizontal scroll", async ({ page, request }) => {
    const [first] = await listCases(request);
    for (const path of ["/shipments", "/activity", "/verification", "/settings", "/upload", ...(first ? [`/shipments/${first.caseCode}`] : [])]) {
      await page.goto(path);
      await expect(page.locator("main h1").first()).toBeVisible();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await expectNoHorizontalScroll(page);
    }
    if (first) {
      await page.goto(`/shipments/${first.caseCode}`);
      await expect(page.getByTestId("next-action")).toBeVisible();
      await page.getByRole("tab", { name: "Packing list" }).click();
      await expect(page.getByRole("tab", { name: "Packing list" })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("viewer-PACKING_LIST")).toBeInViewport();
    }
  });
});

test.describe("dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("follows the system theme and the toggle", async ({ page }) => {
    await page.goto("/shipments");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(20, 25, 27)");
    await page.getByRole("radio", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(247, 246, 242)");
    await page.getByRole("radio", { name: "Match system" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});
