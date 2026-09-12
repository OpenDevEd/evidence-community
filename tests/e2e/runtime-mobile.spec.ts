import { expect, test } from "@playwright/test";

import { dismissConsent } from "./consent";
import { verifySourceCitationMeasure } from "./citation-measure";

test.skip(
	process.env.PLAYWRIGHT_RUNTIME_ACCEPTANCE !== "true",
	"requires a materialized runtime acceptance profile",
);

const expectedNavigationLabel =
	process.env.PLAYWRIGHT_EXPECTED_NAVIGATION_LABEL ?? "Evidence";
const expectedLogin = process.env.PLAYWRIGHT_EXPECTED_LOGIN === "true";
const expectedThemeSwitcher =
	process.env.PLAYWRIGHT_EXPECTED_THEME_SWITCHER === "true";
const expectedLanguageSwitcher =
	process.env.PLAYWRIGHT_EXPECTED_LANGUAGE_SWITCHER === "true";
const expectedSourceCitationLabel =
	process.env.PLAYWRIGHT_EXPECTED_SOURCE_CITATION_LABEL ?? "";
const expectedSourceCitationCount =
	process.env.PLAYWRIGHT_EXPECTED_SOURCE_CITATION_COUNT ?? "";
const expectedLibraryCitationLabel =
	process.env.PLAYWRIGHT_EXPECTED_LIBRARY_CITATION_LABEL ??
	"Citations in this library";

test("switches citation statistics between library links and source metrics on mobile", async ({
	page,
}) => {
	test.skip(
		!expectedSourceCitationLabel,
		"profile has no source citation metric",
	);
	await verifySourceCitationMeasure(
		page,
		expectedLibraryCitationLabel,
		expectedSourceCitationLabel,
		expectedSourceCitationCount,
	);
});

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
		page.getByRole("button").filter({ hasText: "EN-GB" }),
	).toHaveCount(expectedLanguageSwitcher ? 1 : 0);
});

test("mobile navigation stays out of the focus order while closed and returns focus on Escape", async ({page}) => {
	await page.goto("/digests");
	await dismissConsent(page);
	const opener = page.getByRole("button", {name: "Open hamburger menu", exact: true});
	const destination = page.getByRole("link", {name: expectedNavigationLabel, exact: true});
	await expect(destination).toHaveCount(0);
	await opener.click();
	const closer = page.getByRole("button", {name: "Close", exact: true});
	await expect(closer).toHaveAttribute("aria-expanded", "true");
	await expect(closer).toBeFocused();
	await expect(destination).toBeVisible();
	await destination.focus();
	await page.keyboard.press("Escape");
	await expect(opener).toHaveAttribute("aria-expanded", "false");
	await expect(opener).toBeFocused();
	await expect(destination).toHaveCount(0);
	await opener.click();
	await destination.click();
	await expect(page).toHaveURL(/\/lib(?:\?|$)/u);
	await expect(opener).toHaveAttribute("aria-expanded", "false");
	await expect(destination).toHaveCount(0);
});

test("mobile navigation scrolls to its final control on a short screen", async ({page}) => {
	await page.setViewportSize({width: 500, height: 220});
	await page.goto("/digests");
	await dismissConsent(page);
	const opener = page.getByRole("button", {name: "Open hamburger menu", exact: true});
	const menuId = await opener.getAttribute("aria-controls");
	expect(menuId).toBeTruthy();
	const menu = page.locator(`[id="${menuId}"]`);
	await opener.click();
	await expect(page.getByRole("button", {name: "Close", exact: true})).toHaveAttribute("aria-expanded", "true");
	await menu.hover();
	await page.mouse.wheel(0, 600);
	await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
	await expect(menu.locator("a[href],button").last()).toBeInViewport();
});
