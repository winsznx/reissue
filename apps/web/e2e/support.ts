import { expect, type APIRequestContext, type Page } from "@playwright/test";

import type { CaseSummaryDto } from "@reissue/contracts";

export const ACCESS_CODE = process.env.WORKBENCH_ACCESS_CODE ?? "reissue-local";

export async function signIn(page: Page, name = "E2E coordinator"): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Access code").fill(ACCESS_CODE);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/shipments/);
}

export async function listCases(request: APIRequestContext, tab = "all"): Promise<CaseSummaryDto[]> {
  const response = await request.get(`/api/v1/cases?tab=${tab}`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { cases: CaseSummaryDto[] };
  return body.cases;
}

/** Starts a curated scenario from the Verification page and returns the case code it created. */
export async function startScenario(page: Page, scenarioId: string): Promise<string> {
  await page.goto("/verification");
  const row = page.getByTestId(`scenario-${scenarioId}`);
  await row.getByTestId("start-scenario").click();
  const link = row.getByTestId("started-case-link");
  await expect(link).toBeVisible();
  const text = (await link.textContent()) ?? "";
  const code = /[A-Z]+-\d+/.exec(text)?.[0];
  expect(code, "scenario start should return a case code").toBeTruthy();
  return code!;
}

/** Marks the window so a later assertion can prove the page was never reloaded. */
export async function markWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as Window & { __workbenchMarker?: boolean }).__workbenchMarker = true;
  });
}

export async function expectSameWindow(page: Page): Promise<void> {
  const marked = await page.evaluate(() => (window as Window & { __workbenchMarker?: boolean }).__workbenchMarker === true);
  expect(marked, "page should not have reloaded").toBe(true);
}
