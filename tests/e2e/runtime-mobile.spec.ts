import { expect, test } from "@playwright/test";

import { dismissConsent } from "./consent";

test.skip(
	process.env.PLAYWRIGHT_RUNTIME_ACCEPTANCE !== "true",
	"requires a materialized runtime acceptance profile",
);

const expectedNavigationLabel =
	process.env.PLAYWRIGHT_EXPECTED_NAVIGATION_LABEL ?? "Evidence";
const expectedLogin =
	process.env.PLAYWRIGHT_EXPECTED_LOGIN === "true";
const expectedThemeSwitcher =
	process.env.PLAYWRIGHT_EXPECTED_THEME_SWITCHER === "true";
const expectedLanguageSwitcher =
	process.env.PLAYWRIGHT_EXPECTED_LANGUAGE_SWITCHER === "true";

test("renders the runtime navigation and feature controls on mobile", async ({
	page,
}) => {
	await page.goto("/lib");
	await dismissConsent(page);

	expect(page.viewportSize()?.width).toBeLessThanOrEqual(500);
	expect(
		await page.evaluate(
			() =>
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth,
		),
	).toBeLessThanOrEqual(1);

	await page
		.getByRole("button", {
			name: "Open hamburger menu",
			exact: true,
		})
		.click();
	await expect(
		page.getByRole("link", {
			name: expectedNavigationLabel,
			exact: true,
		}),
	).toBeVisible();

	await expect(
		page.getByRole("button", {
			name: "Login/Register button",
			exact: true,
		}),
	).toHaveCount(expectedLogin ? 1 : 0);
	await expect(
		page.getByRole("button", {
			name: /^(?:Toggle theme|Switch to (?:dark|light) mode)$/u,
		}),
	).toHaveCount(expectedThemeSwitcher ? 1 : 0);
	await expect(
		page
			.getByRole("button")
			.filter({ hasText: "EN-GB" }),
	).toHaveCount(expectedLanguageSwitcher ? 1 : 0);
});
