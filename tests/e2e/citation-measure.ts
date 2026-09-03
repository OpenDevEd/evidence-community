import { expect, type Page } from "@playwright/test";

import { dismissConsent } from "./consent";

export async function verifySourceCitationMeasure(
	page: Page,
	libraryLabel: string,
	label: string,
	count: string,
) {
	await page.goto("/statistics");
	await dismissConsent(page);

	const selector = page.getByRole("navigation", {
		name: "Citation measure",
	});
	await expect(selector).toBeVisible();
	await expect(
		selector.getByRole("link", { name: libraryLabel, exact: true }),
	).toHaveAttribute("aria-current", "page");

	const sourceMeasure = selector.getByRole("link", {
		name: label,
		exact: true,
	});
	await sourceMeasure.click();
	await expect(page).toHaveURL(/\?citation=source%3Aopenalex-acceptance$/u);
	await expect(sourceMeasure).toHaveAttribute("aria-current", "page");

	const citationHeading = page.getByRole("heading", {
		level: 3,
		name: label,
		exact: true,
	});
	await expect(citationHeading).toBeVisible();
	await expect(
		citationHeading.locator("..").getByText(count, { exact: true }),
	).toBeVisible();
}
