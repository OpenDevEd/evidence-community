import { expect, test } from "@playwright/test";

import { dismissConsent } from "./consent";

test.skip(
	process.env.PLAYWRIGHT_RUNTIME_ACCEPTANCE !== "true",
	"Runtime acceptance only.",
);

test("a reader who has not answered cannot use the page yet", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await page.goto("/en-GB/lib");

	// The question is still open, so the library is visible but held still.
	const searchField = page.getByPlaceholder("Search", { exact: true }).first();
	await expect(searchField).toBeVisible();
	await expect(page.locator("[data-consent-gate][inert]")).toHaveCount(1);

	await searchField.focus().catch(() => undefined);
	expect(
		await page.evaluate(
			() => (document.activeElement as HTMLElement | null)?.tagName,
		),
	).not.toBe("INPUT");

	// Answering releases the page.
	await dismissConsent(page);
	await expect(page.locator("[data-consent-gate][inert]")).toHaveCount(0);

	await searchField.fill("school meals");
	await expect(searchField).toHaveValue("school meals");
});

test("a reader who has answered is never held still", async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await page.goto("/en-GB/lib");
	await dismissConsent(page);

	// Coming back, the answer is known before anything is drawn.
	await page.goto("/en-GB/lib");
	await expect(page.locator("[data-consent-gate][inert]")).toHaveCount(0);
	await expect(page.getByRole("dialog")).toHaveCount(0);

	const searchField = page.getByPlaceholder("Search", { exact: true }).first();
	await searchField.fill("school meals");
	await expect(searchField).toHaveValue("school meals");
});
