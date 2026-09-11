import { expect, test } from "@playwright/test";

import { dismissConsent, expectsConsent } from "./consent";

test.skip(
	process.env.PLAYWRIGHT_RUNTIME_ACCEPTANCE !== "true",
	"Runtime acceptance only.",
);

/** What the cookie question calls itself, in the library's own language. */
const consentTitle =
	process.env.PLAYWRIGHT_EXPECTED_CONSENT_TITLE ??
	"Help Us Improve Your Experience";

test("a new reader is asked for consent only for configured analytics", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await page.goto("/en-GB/lib");

	if (!expectsConsent) {
		await expect(page.getByRole("main")).toBeVisible();
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect(page.locator("[data-consent-gate][inert]")).toHaveCount(0);
		return;
	}

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

	// A screen reader is told what the question is before answering it.
	await expect(page.getByRole("dialog", { name: consentTitle })).toBeVisible();

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

	// Nothing stands between the reader and the search field. The page is
	// still waking up in the browser, which can drop the first thing typed,
	// so this asks again until the words stay put.
	const searchField = page.getByPlaceholder("Search", { exact: true }).first();
	await expect(async () => {
		await searchField.fill("school meals");
		await expect(searchField).toHaveValue("school meals", {
			timeout: 1_000,
		});
	}).toPass({ timeout: 15_000 });
});

test("the page explaining the cookies is readable without answering", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await page.goto("/en-GB/privacy");

	// The question is not asked here, so nothing is held and nothing covers
	// the page the question itself points readers at.
	await expect(page.locator("[data-consent-gate][inert]")).toHaveCount(0);
	await expect(page.getByRole("dialog")).toHaveCount(0);
});


test("follows a configured cookie policy to terms without blocking the document", async ({ page }) => {
	const destination = process.env.PLAYWRIGHT_EXPECTED_COOKIE_LINK ?? "/cookie-policy";
	test.skip(!destination.startsWith("/terms"), "This profile uses its standard cookie page.");
	await page.goto("/en-GB/cookie-policy");
	await expect(page).toHaveURL(new RegExp(`${destination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
	await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
	await expect(page.getByRole("heading", { name: "Terms of Service", exact: true })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Cookie notice", exact: true })).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page.locator("[data-consent-gate][inert]")).toHaveCount(0);
});


test("opens an external terms destination through the library terms route", async ({ page }) => {
	const destination = process.env.PLAYWRIGHT_EXPECTED_TERMS_LINK ?? "";
	test.skip(!destination.startsWith("https://policies.example.org/"), "This profile uses local terms.");
	await page.route(destination, route => route.fulfill({ contentType: "text/html", body: "<main><h1>Configured policy destination</h1></main>" }));
	await page.goto("/en-GB/terms");
	await expect(page).toHaveURL(destination);
	await expect(page.getByRole("heading", { name: "Configured policy destination" })).toBeVisible();
});
