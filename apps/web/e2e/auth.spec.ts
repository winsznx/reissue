import { expect, test } from "@playwright/test";

import { ACCESS_CODE } from "./support";

test.describe("sign-in", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("redirects to sign-in without a session and rejects a wrong code", async ({ page }) => {
    await page.goto("/shipments");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fshipments/);
    await page.getByLabel("Access code").fill("not-the-code");
    await page.getByLabel("Your name").fill("E2E");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("That access code is not right.")).toBeVisible();
  });

  test("signs in and returns to the requested page", async ({ page }) => {
    await page.goto("/verification");
    await page.getByLabel("Access code").fill(ACCESS_CODE);
    await page.getByLabel("Your name").fill("E2E");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/verification$/);
    await expect(page.getByRole("heading", { name: "Verification", level: 1 })).toBeVisible();
  });
});
