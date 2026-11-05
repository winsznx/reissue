import { expect, test as setup } from "@playwright/test";

import { signIn } from "./support";

setup("sign in once and keep the session", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Shipments", level: 1 })).toBeVisible();
  await page.context().storageState({ path: "e2e/.auth/session.json" });
});
