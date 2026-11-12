import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { ItemsGetResponse } from "../../src/app/api/items/types";
import type { ItemGetResponse } from "../../src/app/api/item/types";
import { creatorDisplayName } from "../../src/lib/creator-display-name";

import { requestsFile } from "./brand-logo-boxes";
import { dismissConsent } from "./consent";
import { verifySourceCitationMeasure } from "./citation-measure";

const expectedConfigRevision =
	process.env.PLAYWRIGHT_EXPECTED_CONFIG_REVISION ?? "example-1";
const expectedConfigUpdatedAt =
	process.env.PLAYWRIGHT_EXPECTED_CONFIG_UPDATED_AT ??
	"2026-07-27T12:30:00.000Z";
const expectedPublicBaseUrl = process.env.PLAYWRIGHT_EXPECTED_PUBLIC_BASE_URL ?? "https://example.org";
const expectedIdentityName =
	process.env.PLAYWRIGHT_EXPECTED_IDENTITY_NAME ?? "Example Evidence Library";
const expectedLogoUrl =
	process.env.PLAYWRIGHT_EXPECTED_LOGO_URL ??
	"https://assets.example.org/library/logo-light.webp";
const expectedLogoUrls = (
	process.env.PLAYWRIGHT_EXPECTED_LOGO_URLS ?? expectedLogoUrl
).split("|");
const expectedFaviconUrl =
	process.env.PLAYWRIGHT_EXPECTED_FAVICON_URL ??
	"https://assets.example.org/library/favicon.png";
const expectedLogoStyleToken =
	process.env.PLAYWRIGHT_EXPECTED_LOGO_STYLE_TOKEN ?? "max-width: 12rem";
const expectedAccentRgb =
	process.env.PLAYWRIGHT_EXPECTED_ACCENT_RGB ?? "230 129 36";
const expectedGoogleFontFamilies = (
	process.env.PLAYWRIGHT_EXPECTED_GOOGLE_FONT_FAMILIES ?? "Montserrat"
).split("|");
const expectedLoadedLogo =
	process.env.PLAYWRIGHT_EXPECTED_LOADED_LOGO === "true";
const expectedSearchItemKey =
	process.env.PLAYWRIGHT_EXPECTED_SEARCH_ITEM_KEY ?? "";
const expectedSearchItemTitle =
	process.env.PLAYWRIGHT_EXPECTED_SEARCH_ITEM_TITLE ?? "";
const expectedDatabaseItemKey =
	process.env.PLAYWRIGHT_EXPECTED_DATABASE_ITEM_KEY ?? "";
const expectedDatabaseItemTitle =
	process.env.PLAYWRIGHT_EXPECTED_DATABASE_ITEM_TITLE ?? "";
const expectedThemeClass = process.env.PLAYWRIGHT_EXPECTED_THEME_CLASS ?? "";
const expectedNavigationLabel =
	process.env.PLAYWRIGHT_EXPECTED_NAVIGATION_LABEL ?? "Evidence";
const expectedExternalNavigationLabel =
	process.env.PLAYWRIGHT_EXPECTED_EXTERNAL_NAVIGATION_LABEL ?? "Partner";
const expectedFooterSection =
	process.env.PLAYWRIGHT_EXPECTED_FOOTER_SECTION ?? "Resources";
const expectedContactEmail =
	process.env.PLAYWRIGHT_EXPECTED_CONTACT_EMAIL ?? "hello@example.org";
const expectedContactPhone =
	process.env.PLAYWRIGHT_EXPECTED_CONTACT_PHONE ?? "+10000000000";
const expectedContactAddress =
	process.env.PLAYWRIGHT_EXPECTED_CONTACT_ADDRESS ??
	"Evidence Library Office";
const expectedFunderName =
	process.env.PLAYWRIGHT_EXPECTED_FUNDER_NAME ?? "Funder One";
const expectedDisclaimer =
	process.env.PLAYWRIGHT_EXPECTED_DISCLAIMER ??
	"Research evidence is provided as-is.";
const expectedAttribution =
	process.env.PLAYWRIGHT_EXPECTED_ATTRIBUTION ?? "Built by OpenDevEd.";
const expectedDefaultLocale =
	process.env.PLAYWRIGHT_EXPECTED_DEFAULT_LOCALE ?? "en-GB";
const expectedEnabledLocales = (
	process.env.PLAYWRIGHT_EXPECTED_ENABLED_LOCALES ?? "en-GB"
).split(",");
const expectedDisabledLocale =
	process.env.PLAYWRIGHT_EXPECTED_DISABLED_LOCALE ?? "fr";
const expectedDetectedLocale =
	process.env.PLAYWRIGHT_EXPECTED_DETECTED_LOCALE ?? "";
const expectedLanguageSwitcher =
	process.env.PLAYWRIGHT_EXPECTED_LANGUAGE_SWITCHER === "true";
const expectedCurrentLocaleLabel =
	process.env.PLAYWRIGHT_EXPECTED_CURRENT_LOCALE_LABEL ?? "English (UK)";
const expectedLocaleOptions = (
	process.env.PLAYWRIGHT_EXPECTED_LOCALE_OPTIONS ?? ""
)
	.split("|")
	.filter(Boolean);
const expectedSwitchLocale =
	process.env.PLAYWRIGHT_EXPECTED_SWITCH_LOCALE ?? "";
const expectedSwitchLocaleLabel =
	process.env.PLAYWRIGHT_EXPECTED_SWITCH_LOCALE_LABEL ?? "";
const expectedSwitchBackLocaleLabel =
	process.env.PLAYWRIGHT_EXPECTED_SWITCH_BACK_LOCALE_LABEL ?? "";
const expectedSearchScopeCount = Number(
	process.env.PLAYWRIGHT_EXPECTED_SEARCH_SCOPE_COUNT ?? "3",
);
const expectedDefaultSearchScopeLabel =
	process.env.PLAYWRIGHT_EXPECTED_DEFAULT_SEARCH_SCOPE_LABEL ??
	"Title, abstract, authors and keywords";
const expectedYearFilter =
	process.env.PLAYWRIGHT_EXPECTED_YEAR_FILTER !== "false";
const expectedAuthorFilter =
	process.env.PLAYWRIGHT_EXPECTED_AUTHOR_FILTER !== "false";
const expectedCookieLink = process.env.PLAYWRIGHT_EXPECTED_COOKIE_LINK ?? "/cookie-policy";
const expectedTermsLink =
	process.env.PLAYWRIGHT_EXPECTED_TERMS_LINK ?? "/terms";
const expectedInstitutionFilterLabel =
	process.env.PLAYWRIGHT_EXPECTED_INSTITUTION_FILTER_LABEL ?? "Institutions";
const expectedCitationsEnabled = process.env.PLAYWRIGHT_EXPECTED_CITATIONS_ENABLED !== "false";
const expectedCitationUrl =
	process.env.PLAYWRIGHT_EXPECTED_CITATION_URL !== "false";
const expectedEmbeddings =
	process.env.PLAYWRIGHT_EXPECTED_EMBEDDINGS !== "false";
const expectedCountryFacet =
	process.env.PLAYWRIGHT_EXPECTED_COUNTRY_FACET !== "false";
const expectedInstitutionFacet =
	process.env.PLAYWRIGHT_EXPECTED_INSTITUTION_FACET !== "false";
const expectedNavbarSearch =
	process.env.PLAYWRIGHT_EXPECTED_NAVBAR_SEARCH !== "false";
const expectedThemeSwitcher =
	process.env.PLAYWRIGHT_EXPECTED_THEME_SWITCHER !== "false";
const expectedLogin = process.env.PLAYWRIGHT_EXPECTED_LOGIN !== "false";
const expectedAi = process.env.PLAYWRIGHT_EXPECTED_AI !== "false";
const expectedAiSearch = process.env.PLAYWRIGHT_EXPECTED_AI_SEARCH !== "false";
const expectedDeepResearch =
	process.env.PLAYWRIGHT_EXPECTED_DEEP_RESEARCH !== "false";
const expectedContactForm = process.env.PLAYWRIGHT_EXPECTED_EMAIL !== "false";
const expectedContactPage = expectedContactForm || Boolean(expectedContactEmail || expectedContactPhone || expectedContactAddress);
const expectedSourceCitationLabel =
	process.env.PLAYWRIGHT_EXPECTED_SOURCE_CITATION_LABEL ?? "";
const expectedSourceCitationCount =
	process.env.PLAYWRIGHT_EXPECTED_SOURCE_CITATION_COUNT ?? "";
const expectedLibraryCitationLabel =
	process.env.PLAYWRIGHT_EXPECTED_LIBRARY_CITATION_LABEL ??
	"Citations in this community";

test("switches citation statistics between library links and source metrics", async ({
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

test("redirects the root route to the evidence library", { tag: "@smoke" }, async ({
	request,
}) => {
	const response = await request.get("/", { maxRedirects: 0 });

	expect(response.status()).toBe(307);

	const location = response.headers().location;
	expect(location).toBeDefined();
	expect(new URL(location!, response.url()).pathname).toBe("/lib");
});

test("the header's links show one menu at a time", { tag: "@smoke" }, async ({ page }) => {
	await page.goto("/lib");
	await dismissConsent(page);
	const nav = page.getByRole("banner").getByRole("navigation").first();
	const triggers = nav.locator("button[aria-expanded]");
	test.skip((await triggers.count()) < 2, "This library has fewer than two links with menus.");
	// Every panel on the page, a closing one included: one fading out beside the next is the same defect.
	const panels = nav.locator("[aria-labelledby]").filter({ visible: true });
	const linkText = (index: number) =>
		nav.locator("li").filter({ has: page.locator("button[aria-expanded]") }).nth(index).getByRole("link").first();

	await linkText(0).hover();
	await expect(triggers.nth(0)).toHaveAttribute("aria-expanded", "true");
	await expect(panels.getByRole("link").first()).toBeVisible();

	// No retry on the count: a menu that lingers after the next one opens is the defect.
	await linkText(1).hover();
	await expect(triggers.nth(1)).toHaveAttribute("aria-expanded", "true");
	expect(await panels.count()).toBe(1);

	await page.keyboard.press("Escape");
	await expect(panels).toHaveCount(0);

	await page.mouse.move(0, 0);
	await triggers.nth(0).focus();
	await page.keyboard.press("Enter");
	await expect(panels).toHaveCount(1);
	await page.keyboard.press("ArrowDown");
	await expect(panels.getByRole("link").first()).toBeFocused();
});

test("reports the active runtime configuration revision only", async ({
	request,
}) => {
	const response = await request.get("/api/library-config/health");
	const body = await response.text();

	expect(response.status()).toBe(200);
	expect(response.headers()["cache-control"]).toContain("no-store");
	expect(JSON.parse(body)).toEqual({
		state: "active",
		active: {
			schemaVersion: 1,
			revision: expectedConfigRevision,
			updatedAt: expectedConfigUpdatedAt,
		},
		rejected: null,
	});
});

test("serves value-free machine-readable configuration contracts", async ({
	request,
}) => {
	const [schemaResponse, catalogResponse] = await Promise.all([
		request.get("/library-config.schema.json"),
		request.get("/library-config.catalogs.json"),
	]);
	expect(schemaResponse.status()).toBe(200);
	expect(catalogResponse.status()).toBe(200);
	expect(schemaResponse.headers()["content-type"]).toContain(
		"application/json",
	);
	expect(catalogResponse.headers()["content-type"]).toContain(
		"application/json",
	);

	const schemaText = await schemaResponse.text();
	const catalogText = await catalogResponse.text();
	const schema = JSON.parse(schemaText);
	const catalog = JSON.parse(catalogText);

	expect(schema).toMatchObject({
		$schema: "https://json-schema.org/draft/2020-12/schema",
		$id: "/library-config.schema.json",
		type: "object",
		additionalProperties: false,
	});
	expect(
		schema.properties.services.properties.database.properties.url,
	).toMatchObject({ writeOnly: true });
	expect(catalog).toMatchObject({
		catalogVersion: 1,
		schemaVersion: 1,
		schemaUrl: "/library-config.schema.json",
	});
	expect(catalog.fields.writeOnlyPaths).toContain("services.database.url");
	expect(schemaText).not.toContain(expectedConfigRevision);
	expect(catalogText).not.toContain(expectedConfigRevision);
	expect(schemaText).not.toContain(expectedContactEmail);
	expect(catalogText).not.toContain(expectedContactEmail);
});

test("gzips JSON from route handlers when the browser accepts it", async ({
	request,
}) => {
	// Next skips its own gzip for route handlers without patches/next+16.3.5.patch; an upgrade must keep this.
	const response = await request.get("/api/items", {
		headers: { "accept-encoding": "gzip" },
	});
	expect(response.status()).toBe(200);
	expect(response.headers()["content-encoding"]).toBe("gzip");
});

test("renders identity assets, logo CSS, colors, and fonts from runtime configuration", { tag: "@smoke" }, async ({
	page,
}) => {
	if (expectedLoadedLogo) {
		await page.route(
			(url) => expectedLogoUrls.some((configured) => requestsFile(url, configured)),
			(route) =>
				route.fulfill({
					body: Buffer.from(
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
						"base64",
					),
					contentType: "image/png",
				}),
		);
	}
	await page.goto("/lib");

	await expect(page).toHaveTitle(expectedIdentityName);

	// The configured logo, either at its own address or, for a PNG or WebP, through the image optimizer.
	const visibleLogo = page.locator("img[data-library-logo]:visible").first();
	await expect
		.poll(async () => requestsFile(new URL((await visibleLogo.getAttribute("src")) ?? "", page.url()), expectedLogoUrl))
		.toBe(true);
	if (expectedLoadedLogo) {
		await expect
			.poll(() =>
				visibleLogo.evaluate((image: HTMLImageElement) =>
					image.complete ? image.naturalWidth : 0,
				),
			)
			.toBeGreaterThan(0);
	}

	expect(await page.locator("#library-logo-styles").textContent()).toContain(
		expectedLogoStyleToken,
	);
	expect(
		await page.locator("style[data-library-theme]").textContent(),
	).toContain(`--color-accent-500:${expectedAccentRgb}`);

	const favicon = page
		.locator(
			`link[rel~="icon"][href="${expectedFaviconUrl}"], link[rel="shortcut icon"][href="${expectedFaviconUrl}"]`,
		)
		.first();
	await expect(favicon).toHaveAttribute("href", expectedFaviconUrl);

	// The theme's Google fonts are served by the library itself (next/font), never linked from Google.
	await expect(page.locator('link[href^="https://fonts.googleapis.com"]')).toHaveCount(0);
	await expect
		.poll(() =>
			page.evaluate(() =>
				[...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family.replace(/"/g, "")),
			),
		)
		.toEqual(expect.arrayContaining(expectedGoogleFontFamilies));

	if (expectedThemeClass) {
		await expect(page.locator("html")).toHaveClass(
			new RegExp(`(?:^|\\s)${expectedThemeClass}(?:\\s|$)`, "u"),
		);
	}
});

test("renders navigation, footer, contact, and legal data from runtime configuration", { tag: "@smoke" }, async ({
	page,
}) => {
	await page.goto("/lib");
	await dismissConsent(page);

	await expect(
		page.getByRole("link", { name: expectedNavigationLabel, exact: true }),
	).toBeVisible();

	const externalNavigationLink = page.getByRole("link", {
		name: expectedExternalNavigationLabel,
		exact: true,
	});
	await expect(externalNavigationLink).toBeVisible();
	await expect(externalNavigationLink).toHaveAttribute("target", "_blank");
	await expect(externalNavigationLink).toHaveAttribute(
		"rel",
		"noopener noreferrer",
	);

	await expect(
		page.getByRole("heading", { name: expectedFooterSection, exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: expectedContactEmail, exact: true }),
	).toHaveAttribute("href", `mailto:${expectedContactEmail}`);
	await expect(
		page.getByRole("img", { name: expectedFunderName, exact: true }),
	).toBeVisible();
	await expect(
		page.getByText(expectedDisclaimer, { exact: true }),
	).toBeVisible();
	await expect(
		page.getByText(expectedAttribution, { exact: true }),
	).toBeVisible();

	await expect(
		page
			.locator("#footer")
			.getByRole("link", { name: "Privacy Policy", exact: true }),
	).toHaveAttribute("href", /privacy$/u);
	await expect(
		page
			.locator("#footer")
			.getByRole("link", { name: "Cookie Policy", exact: true }),
	).toHaveAttribute("href", new RegExp(`${expectedCookieLink.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "u"));
	await expect(
		page
			.locator("#footer")
			.getByRole("link", { name: "Terms of Service", exact: true }),
	).toHaveAttribute(
		"href",
		expectedTermsLink.startsWith("/")
			? new RegExp(`${expectedTermsLink}$`, "u")
			: expectedTermsLink,
	);

	if (!expectedContactPage) {
		await page.goto("/contact");
		await expect(
			page.getByText("Page Not Found", { exact: true }),
		).toBeVisible();
		await expect(page.locator("form")).toHaveCount(0);
		return;
	}

	await page.goto("/contact");
	const contactDetails = page.getByRole("main");
	await expect(contactDetails.locator("form")).toHaveCount(expectedContactForm ? 1 : 0);
	for (const [prefix, value] of [["mailto:", expectedContactEmail], ["tel:", expectedContactPhone]]) {
		const links = contactDetails.locator(`a[href^="${prefix}"]`);
		await expect(links).toHaveCount(value ? 1 : 0);
		if (value) await expect(links).toHaveAttribute("href", `${prefix}${value}`);
	}
	if (expectedContactAddress) await expect(contactDetails.getByText(expectedContactAddress, { exact: false })).toBeVisible();
});

test("keeps server-component redirects out of page caches", async ({ request }) => {
	const response = await request.get("/lib?search=cache-protocol-check", {
		headers: {
			"Accept-Language": "zz-ZZ",
			RSC: "1",
			"Next-Router-Prefetch": "1",
			"Next-Router-Segment-Prefetch": "/_tree",
		},
		maxRedirects: 0,
	});

	// Next adds the RSC hash redirect after the proxy has set its headers.
	expect(response.status()).toBe(307);
	const destination = new URL(response.headers().location!, response.url());
	expect(destination.pathname).toBe("/lib");
	expect(destination.searchParams.get("search")).toBe("cache-protocol-check");
	expect(destination.searchParams.has("_rsc")).toBe(true);
	expect(response.headers()["cache-control"]).toBe("private, no-store");
});

test("enforces runtime locales, default, detection, order, and switcher visibility", async ({
	page,
	request,
}) => {
	const disabledResponse = await request.get(
		`/${expectedDisabledLocale}/lib`,
		{
			maxRedirects: 0,
		},
	);
	expect(disabledResponse.status()).toBe(307);
	expect(
		new URL(disabledResponse.headers().location!, disabledResponse.url())
			.pathname,
	).toBe("/lib");

	const defaultResponse = await request.get("/lib", {
		headers: { "Accept-Language": "zz-ZZ" },
		maxRedirects: 0,
	});
	expect(defaultResponse.status()).toBe(200);
	expect(await defaultResponse.text()).toContain(
		`<html lang="${expectedDefaultLocale}"`,
	);
	expect(defaultResponse.headers()["cache-control"]).toBe("private, no-store");

	if (expectedDetectedLocale) {
		const detectedResponse = await request.get("/lib", {
			headers: { "Accept-Language": expectedDetectedLocale },
			maxRedirects: 0,
		});
		expect(detectedResponse.status()).toBe(307);
		expect(
			new URL(
				detectedResponse.headers().location!,
				detectedResponse.url(),
			).pathname,
		).toBe(`/${expectedDetectedLocale}/lib`);
		expect(detectedResponse.headers()["cache-control"]).toBe(
			"private, no-store",
		);
	}

	if (expectedDatabaseItemKey) {
		const publication = await request.get(`/lib/${expectedDatabaseItemKey}`);
		expect(publication.status()).toBe(200);
		expect(publication.headers()["cache-control"]).toBe("private, no-store");
	}

	// Explicit locale URLs save a preference, so check browser detection first.
	for (const locale of expectedEnabledLocales) {
		if (locale === expectedDefaultLocale) continue;
		const enabledResponse = await request.get(`/${locale}/lib`, {
			maxRedirects: 0,
		});
		expect(enabledResponse.status()).toBe(200);
		expect(enabledResponse.headers().location).toBeUndefined();
	}

	await page.setViewportSize({ width: 1600, height: 900 });
	await page.goto(`/${expectedDefaultLocale}/lib`);
	await dismissConsent(page);
	await expect(page.getByRole("link", {
		name: expectedNavigationLabel,
		exact: true,
	})).toHaveAttribute("href", "/lib");

	const currentLanguage = await openLanguages(page);

	if (!expectedLanguageSwitcher) {
		expect(currentLanguage).toBeNull();
		return;
	}

	expect(currentLanguage).toContain(expectedCurrentLocaleLabel);
	const localeOptions = page.locator('[role="menuitem"][lang]');
	await expect(localeOptions).toHaveCount(expectedLocaleOptions.length);
	await expect(localeOptions).toHaveText(expectedLocaleOptions);

	if (!expectedSwitchLocale || !expectedSwitchLocaleLabel) return;

	await page
		.getByRole("menuitem", {
			name: expectedSwitchLocaleLabel,
			exact: true,
		})
		.press("Enter");
	await expect(page).toHaveURL(
		new RegExp(`/${expectedSwitchLocale}/lib(?:\\?.*)?$`, "u"),
	);
	await expect(page.locator("html")).toHaveAttribute(
		"lang",
		expectedSwitchLocale,
	);
	await expect(
		page.getByRole("link", {
			name: expectedNavigationLabel,
			exact: true,
		}),
	).toHaveAttribute(
		"href",
		new RegExp(`^/${expectedSwitchLocale}/lib(?:\\?.*)?$`, "u"),
	);
	await expect
		.poll(async () => {
			const cookie = await page
				.context()
				.cookies()
				.then((cookies) =>
					cookies.find(({ name }) => name === "NEXT_LOCALE"),
				);
			return cookie?.value;
		})
		.toBe(expectedSwitchLocale);

	if (!expectedSwitchBackLocaleLabel) return;

	const switchBack = page.getByRole("menuitem", {
		name: expectedSwitchBackLocaleLabel,
		exact: true,
	});
	// The header still re-renders for the new locale, which can swallow a click.
	await expect(async () => {
		if (!(await switchBack.isVisible())) await openLanguages(page);
		await expect(switchBack).toBeVisible({ timeout: 1_000 });
	}).toPass();
	await switchBack.press("Enter");
	await expect.poll(() => new URL(page.url()).pathname).toBe("/lib");
	await expect(page.locator("html")).toHaveAttribute(
		"lang",
		expectedDefaultLocale,
	);
	await expect
		.poll(async () => {
			const cookie = await page
				.context()
				.cookies()
				.then((cookies) =>
					cookies.find(({ name }) => name === "NEXT_LOCALE"),
				);
			return cookie?.value;
		})
		.toBe(expectedDefaultLocale);
});

test("renders navbar features from the runtime manifest", async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await page.goto("/en-GB/contact");
	await dismissConsent(page);

	const navbarSearch = page.getByPlaceholder("Search", { exact: true });
	// Its own button when there is room, otherwise a row in the header's menu.
	const inlineTheme = headerActions(page).getByRole("button", { name: /^Switch to (?:dark|light) mode$/u });
	const themeSwitcher = inlineTheme.or(page.locator('[role="menuitem"][data-key="theme"]'));
	const loginButton = page.getByRole("button", {
		name: "Sign in",
		exact: true,
	});

	await expect(navbarSearch).toHaveCount(expectedNavbarSearch ? 1 : 0);
	await expect(loginButton).toHaveCount(expectedLogin ? 1 : 0);
	if ((await inlineTheme.count()) === 0) await openHeaderMenu(page);
	await expect(themeSwitcher).toHaveCount(expectedThemeSwitcher ? 1 : 0);
});

// Enter pressed while the typed search still waits used to write it into the record page's address under the
// navigation, which kept the reader on the record.
test("opens the results for words typed in the navbar on a record page and entered at once", { tag: "@smoke" }, async ({
	page,
	request,
}) => {
	test.skip(!expectedNavbarSearch, "This library has no navbar search.");
	const key = (await (await request.get("/api/items")).json()).items?.[0]?.key;
	expect(key).toBeTruthy();
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto(`/en-GB/lib/${key}`);
	await dismissConsent(page);

	await page.getByPlaceholder("Search", { exact: true }).click();
	await page.keyboard.type("evidence");
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(
		(url) => url.pathname.endsWith("/lib") && url.searchParams.get("search") === "evidence",
	);
});

/**
 * The header's actions: the banner's second navigation, after the links.
 * Found by role, not label, so it works in every language. A library that
 * offers no settings and no Sign in has none, and the links' own menus must
 * not be mistaken for it.
 */
function headerActions(page: Page) {
	return page.getByRole("banner").getByRole("navigation").nth(1);
}

/** Opens the header's one menu button, if it has one: settings, or settings and Sign in. */
async function openHeaderMenu(page: Page) {
	if ((await page.getByRole("banner").getByRole("navigation").count()) < 2) return null;
	const trigger = headerActions(page).locator("button[aria-haspopup]").filter({ visible: true });
	if ((await trigger.count()) === 0) return null;
	await trigger.first().click();
	await expect(page.getByRole("menuitem").first()).toBeVisible();
	return trigger.first();
}

/**
 * Opens the list of languages wherever the header keeps them: behind their own
 * button when there is room, or one step into its menu. Answers the current
 * language as the header names it, or null when the library offers no choice.
 */
async function openLanguages(page: Page) {
	const trigger = await openHeaderMenu(page);
	if (!trigger) return null;
	const row = page.locator('[role="menuitem"][data-key="language"]');
	if (await row.isVisible()) {
		const current = await row.innerText();
		await row.click();
		return current;
	}
	if ((await page.locator('[role="menuitem"][lang]').count()) > 0) return trigger.innerText();
	await page.keyboard.press("Escape");
	return null;
}

test("enforces the runtime AI gate in both directions", async ({
	request,
}, testInfo) => {
	const headers = {
		"x-real-ip": `198.51.98.${100 + testInfo.retry}`,
	};
	const [itemAi, questions, quickSearch, deepResearch] = await Promise.all([
		request.post("/api/ai", { data: {}, headers }),
		request.post("/api/ai/questions", { data: {}, headers }),
		request.post("/api/ai/chat", {
			data: { messages: [], mode: "quick" },
			headers,
		}),
		request.post("/api/ai/chat", {
			data: { messages: [], mode: "research" },
			headers,
		}),
	]);

	if (!expectedAi) {
		expect(itemAi.status()).toBe(403);
		expect(questions.status()).toBe(403);
		expect(quickSearch.status()).toBe(403);
		expect(deepResearch.status()).toBe(403);
		return;
	}

	expect(itemAi.status()).not.toBe(403);
	expect(questions.status()).not.toBe(403);
	if (expectedAiSearch) {
		expect(quickSearch.status()).not.toBe(403);
	} else {
		expect(quickSearch.status()).toBe(403);
	}
	if (expectedDeepResearch) {
		expect(deepResearch.status()).not.toBe(403);
	} else {
		expect(deepResearch.status()).toBe(403);
	}
});

test("rate limits paid AI requests per browser when AI is enabled", async ({
	request,
}, testInfo) => {
	const sendRequest = () =>
		request.post("/api/ai?prompt=invalid", {
			data: {},
			headers: {
				"x-real-ip": `198.51.99.${100 + testInfo.retry}`,
			},
		});

	if (!expectedAi) {
		const response = await sendRequest();
		expect(response.status()).toBe(403);
		expect(response.headers()["x-ratelimit-limit"]).toBeUndefined();
		return;
	}

	for (let attempt = 1; attempt <= 10; attempt += 1) {
		const response = await sendRequest();
		expect(response.status()).toBe(400);
		expect(response.headers()["x-ratelimit-limit"]).toBe("10");
		expect(response.headers()["x-ratelimit-remaining"]).toBe(
			String(10 - attempt),
		);
	}

	const rejected = await sendRequest();
	expect(rejected.status()).toBe(429);
	expect(Number(rejected.headers()["retry-after"])).toBeGreaterThan(0);
	expect(Number(rejected.headers()["retry-after"])).toBeLessThanOrEqual(60);
	await expect(rejected.json()).resolves.toEqual({
		error: {
			code: "RATE_LIMITED",
			message: expect.stringContaining("Try again in"),
		},
	});
});

for (const profileAvailable of [true, false]) {
	test(`respects author filtering when a linked profile is ${profileAvailable ? "available" : "unavailable"}`, async ({ page, request, context }) => {
		test.skip(!expectedSearchItemKey, "Requires a public record in this runtime.");
		const response = await request.get(`/api/item/${expectedSearchItemKey}`);
		expect(response.ok()).toBe(true);
		const { item } = await response.json() as ItemGetResponse;
		const creator = item!.creators![0];
		expect(creator.authorProfileId).toBeTruthy();
		const name = creatorDisplayName(creator);
		const profileName = `${name} Updated`;
		const profileBaseUrl = "https://openscholar.example.org";
		const profileUrl = `${profileBaseUrl}/authors/${creator.authorProfileId}`;
		// The saved record and search are real. Only the external profile catalog
		// is controlled, so both profile availability states are repeatable.
		await page.route("**/api/author-profiles?*", route => route.fulfill({ json: {
			profileBaseUrl,
			profiles: profileAvailable ? [{
				id: creator.authorProfileId, revision: 1, name: profileName,
				headline: "Researcher", affiliation: "", bio: "", website: "",
				linkedin: "", orcid: "", openalex: "", photo: "/favicon.ico",
			}] : [],
		} }));
		try {
			await Promise.all([
				page.waitForResponse(response => new URL(response.url()).pathname === "/api/author-profiles"),
				page.goto(`/en-GB/lib/${expectedSearchItemKey}`),
			]);
			await dismissConsent(page);
			const authors = page.getByRole("heading", { name: "Authors", exact: true }).locator("../..");
			const author = authors.getByRole("link");
			await expect(author).toHaveCount(1);
			if (expectedAuthorFilter) await expect(author).toBeEnabled();
			else await expect(author).toBeDisabled();
			if (profileAvailable) {
				await expect(authors.getByText(profileName, { exact: true })).toBeVisible();
				await expect(author.locator("img")).toHaveAttribute("src", "/favicon.ico");
				await page.mouse.move(0, 0);
				await author.hover();
				await expect(page.getByRole("link", { name: "View Openscholar profile", exact: true })).toHaveAttribute("href", profileUrl);
			}
			if (expectedAuthorFilter) {
				await author.click();
				await expect(page).toHaveURL(url => url.pathname.endsWith("/lib") && url.searchParams.get("author") === name);
				await expect(page.getByRole("link", { name: expectedSearchItemTitle })).toBeVisible();
				// The filter's chip, by its accessible name: the top authors in the sidebar list the same name as a button.
				const authorChip = page.getByRole("button", { name: `Author ${name}`, exact: true });
				await authorChip.click();
				await expect(page).toHaveURL(url => !url.searchParams.has("author"));
				await expect(authorChip).toHaveCount(0);
				await page.getByRole("link", { name: expectedSearchItemTitle }).click();
				await expect(page).toHaveURL(url => url.pathname.endsWith(`/lib/${expectedSearchItemKey}`));
				await page.goBack();
				await expect(page).toHaveURL(url => url.pathname.endsWith("/lib") && !url.searchParams.has("author"));
				await expect(page.getByRole("heading", { name: expectedSearchItemTitle, exact: true })).toBeVisible();
				await expect(authorChip).toHaveCount(0);
				// A filter that ends while the list is hidden behind a record takes its chip with it.
				await page.getByRole("link", { name: expectedSearchItemTitle }).click();
				await author.click();
				await expect(authorChip).toBeVisible();
				await page.goBack();
				await expect(page).toHaveURL(url => url.pathname.endsWith(`/lib/${expectedSearchItemKey}`));
				await page.goBack();
				await expect(page).toHaveURL(url => url.pathname.endsWith("/lib") && !url.searchParams.has("author"));
				await expect(authorChip).toHaveCount(0);
			} else {
				await expect(author).not.toHaveAttribute("href", /[?&]author=/);
				const itemUrl = page.url();
				await author.click({ force: true });
				await expect(page).toHaveURL(itemUrl);
			}
			expect(context.pages()).toHaveLength(1);
		} finally {
			await page.unrouteAll({ behavior: "wait" });
		}
	});
}

test("copies the selected citation style from a result card without opening the item", { tag: "@smoke" }, async ({ page, context }) => {
	test.skip(!expectedSearchItemKey, "Requires a public record in this runtime.");
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto(`/en-GB/lib?search=${encodeURIComponent(expectedSearchItemTitle)}&scope=title`);
	await dismissConsent(page);
	const card = page.getByRole("listitem").filter({
		has: page.getByRole("heading", { name: expectedSearchItemTitle, exact: true }),
	}).first();
	await expect(card).toBeVisible();
	const cite = card.getByRole("button", { name: "Cite", exact: true });
	if (!expectedCitationsEnabled) {
		await expect(cite).toHaveCount(0);
		return;
	}
	const resultsUrl = page.url();
	await cite.click();
	const panel = page.getByRole("dialog");
	const text = panel.locator('[aria-live="polite"]');
	for (const style of ["APA 7", "BibTeX"]) {
		await panel.getByRole("button", { name: /^Citation style/ }).click();
		// Focusing the nested menu can scroll the page to keep it in view.
		await expect(page.getByRole("combobox", { name: /Search styles or journals/ })).toBeFocused();
		await page.evaluate(() => window.scrollBy({ top: 64, behavior: "instant" }));
		await page.getByRole("option", { name: style, exact: true }).click();
		const copy = panel.getByRole("button", { name: "Copy citation", exact: true });
		await expect(copy).toBeEnabled();
		const displayed = (await text.innerText()).trim();
		if (style === "BibTeX") {
			expect(displayed).toMatch(/^@\w+\{/);
			expect(displayed).toContain(expectedSearchItemKey);
		} else {
			expect(displayed).toContain(expectedSearchItemTitle);
			expect(displayed).not.toMatch(/^@\w+\{/);
		}
		await page.evaluate(() => navigator.clipboard.writeText(""));
		await copy.click();
		await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(displayed);
	}
	await expect(page).toHaveURL(resultsUrl);
	await panel.getByRole("button", { name: /^Citation style/ }).click();
	await expect(page.getByRole("listbox", { name: "Citation style" })).toBeVisible();
	await expect(page.getByRole("combobox", { name: /Search styles or journals/ })).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("listbox", { name: "Citation style" })).toHaveCount(0);
	await expect(panel.getByRole("button", { name: "Copy citation", exact: true })).toBeVisible();
	// At the field's start: its Clear button follows the typed words and can sit over the middle.
	await page.getByRole("textbox", { name: "Search", exact: true }).click({ position: { x: 8, y: 12 } });
	await expect(panel).toHaveCount(0);
});

test("reports a clipboard failure and retries copying clean citation text", async ({ page, context }) => {
	test.skip(!expectedSearchItemKey, "Requires a public record in this runtime.");
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);

	await page.goto(`/en-GB/lib/${expectedSearchItemKey}`);
	await dismissConsent(page);
	const heading = page.getByRole("heading", { name: "Citation", exact: true });
	if (!expectedCitationsEnabled) {
		await expect(heading).toHaveCount(0);
		return;
	}
	const citation = heading.locator("../..");
	const citationText = citation.locator('[aria-live="polite"]');
	await expect(citationText).toContainText(expectedSearchItemTitle);
	const displayed = (await citationText.textContent())?.trim();
	await page.evaluate(() => {
		Object.defineProperty(navigator.clipboard, "writeText", {
			configurable: true,
			value: () => {
				Reflect.deleteProperty(navigator.clipboard, "writeText");
				return Promise.reject(new DOMException("Clipboard permission denied", "NotAllowedError"));
			},
		});
	});
	await citation.getByRole("button", { name: "Copy citation", exact: true }).click();
	await expect(page.locator("[data-sonner-toast] [data-type=error]")).toBeVisible();
	await citation.getByRole("button", { name: "Copy citation", exact: true }).click();
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(displayed);
});

test("keeps clipboard feedback tied to the latest attempt", async ({ page, context }) => {
	test.skip(!expectedSearchItemKey || !expectedCitationsEnabled, "Requires a public record with citations.");
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto(`/en-GB/lib/${expectedSearchItemKey}`);
	await dismissConsent(page);
	const citation = page.getByRole("heading", { name: "Citation", exact: true }).locator("..");
	const copy = citation.getByRole("button", { name: /^(Copy citation|Copied!)$/i });
	await page.clock.pauseAt(new Date());
	const attempts = await page.evaluateHandle(() => {
		const pending: { resolve: () => void; reject: () => void }[] = [];
		Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: () => new Promise<void>((resolve, reject) => {
			pending.push({ resolve, reject: () => reject(new DOMException("Clipboard permission denied", "NotAllowedError")) });
		}) });
		return pending;
	});
	await copy.click();
	await copy.click();
	await attempts.evaluate(pending => pending[1].reject());
	await page.clock.runFor(100);
	await expect(page.locator("[data-sonner-toast] [data-type=error]")).toBeVisible();
	await attempts.evaluate(pending => pending[0].resolve());
	await page.clock.runFor(100);
	await expect(copy).toHaveAccessibleName("Copy citation");
	await copy.click();
	await attempts.evaluate(pending => pending[2].resolve());
	await page.clock.runFor(100);
	await expect(copy).toHaveAccessibleName("Copied!");
});

test("shows a search failure and lets the reader retry without losing the query", async ({ page }) => {
	test.skip(!expectedSearchItemKey, "This library has no search fixture.");
	let unavailable = true;
	await page.route("**/api/items?**", (route) => unavailable
		? route.fulfill({ status: 503, json: { error: "Search unavailable" } })
		: route.continue());
	await page.goto(`/en-GB/lib?search=${encodeURIComponent(expectedSearchItemTitle)}&scope=title`);
	await dismissConsent(page);
	const results = page.locator("#main-content");
	await expect(results.getByRole("alert")).toBeVisible();
	unavailable = false;
	await results.getByRole("alert").getByRole("button", { name: "Retry", exact: true }).click();
	await expect(results.getByRole("alert")).toHaveCount(0);
	await expect(page.getByRole("heading", { name: expectedSearchItemTitle, exact: true }).first()).toBeVisible();
	expect(new URL(page.url()).searchParams.get("search")).toBe(expectedSearchItemTitle);
});

for (const missingTitle of [false, true]) {
	test(`names ${missingTitle ? "titleless" : "titled"} publication card links and opens them with the keyboard`, async ({ page }) => {
		test.skip(!expectedSearchItemKey, "This library has no search fixture.");
		if (missingTitle) {
			await page.route("**/api/items?**", async route => {
				const response = await route.fetch();
				const data: ItemsGetResponse = await response.json();
				for (const item of data.items) if (item.key === expectedSearchItemKey) item.title = "";
				await route.fulfill({ response, json: data });
			});
		}
		await page.goto(`/en-GB/lib?search=${encodeURIComponent(expectedSearchItemTitle)}&scope=title`);
		await dismissConsent(page);
		const heading = page.getByRole("heading", { level: 3 }).filter({ hasText: missingTitle ? expectedSearchItemKey : expectedSearchItemTitle }).first();
		await expect(heading).toBeVisible();
		// The card's link is named by its heading, wherever the heading sits.
		const card = page.getByRole("link", { name: (await heading.innerText()).trim(), exact: true }).and(page.locator(`[href*="/lib/${expectedSearchItemKey}"]`));
		await expect(card).toHaveCount(1);
		await card.focus();
		await card.press("Enter");
		await expect(page).toHaveURL(url => url.pathname.endsWith(`/lib/${expectedSearchItemKey}`));
		await expect(page.getByRole("heading", { name: expectedSearchItemTitle, exact: true })).toBeVisible();
	});
}

test("filters institution suggestions by typed name", async ({ page }) => {
	test.skip(!expectedInstitutionFacet, "Institution filter is disabled for this library.");
	await page.route("**/api/facets**", (route) => route.fulfill({ json: {
		facetDistribution: { institutionsWithAuthors: { "North University": 2, "South Institute": 1 } },
	} }));
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto("/en-GB/lib");
	await dismissConsent(page);
	const picker = page.getByRole("combobox", { name: expectedInstitutionFilterLabel, exact: true }).first();
	await picker.fill("North");
	await expect(page.getByRole("option", { name: /North University/ })).toBeVisible();
	await expect(page.getByRole("option", { name: /South Institute/ })).toHaveCount(0);
	await picker.fill("No matching institution");
	await expect(page.getByRole("option")).toHaveCount(0);
	await picker.fill("South");
	await page.getByRole("option", { name: /South Institute/ }).click();
	await expect.poll(() => new URL(page.url()).searchParams.get("institution")).toContain("South Institute");
});

test("enforces runtime search scopes, filters, embeddings, and citation URLs", { tag: "@smoke" }, async ({
	page,
	request,
}) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto("/en-GB/lib");
	await dismissConsent(page);

	const scopeSelect = page.getByLabel("Search scope").first();
	await expect(scopeSelect).toContainText(expectedDefaultSearchScopeLabel);
	await expect(scopeSelect.locator("option")).toHaveCount(
		expectedSearchScopeCount + 1,
	);

	const yearFilter = page.getByText("Publication Year", {
		exact: true,
	});
	const institutionFilter = page.getByRole("combobox", {
		name: expectedInstitutionFilterLabel,
		exact: true,
	});
	if (expectedYearFilter) {
		await expect(yearFilter).toBeVisible();
	} else {
		await expect(yearFilter).toHaveCount(0);
	}
	if (expectedInstitutionFacet) {
		await expect(institutionFilter.first()).toBeVisible();
	} else {
		await expect(institutionFilter).toHaveCount(0);
	}

	const facetsResponse = await request.get("/api/facets");
	expect(facetsResponse.status()).toBe(200);
	const facetDistribution = (await facetsResponse.json()).facetDistribution;
	expect(Object.hasOwn(facetDistribution, "country_uncategorized")).toBe(
		expectedCountryFacet,
	);
	if (!expectedInstitutionFacet) {
		expect(Object.hasOwn(facetDistribution, "institutionsWithAuthors")).toBe(false);
	}

	const itemsResponse = await request.get(
		expectedSearchItemTitle
			? `/api/items?search=${encodeURIComponent(expectedSearchItemTitle)}`
			: "/api/items",
	);
	expect(itemsResponse.status()).toBe(200);
	const searchItems = (await itemsResponse.json()).items ?? [];
	const firstItem = expectedSearchItemKey
		? searchItems.find(
				(item: { key?: string }) => item.key === expectedSearchItemKey,
			)
		: searchItems[0];
	if (expectedSearchItemKey) {
		expect(firstItem?.key).toBe(expectedSearchItemKey);
		expect(firstItem?.title).toBe(expectedSearchItemTitle);
	} else {
		expect(firstItem?.key).toBeTruthy();
	}

	if (expectedDatabaseItemKey) {
		const databaseItemResponse = await request.get(
			`/api/item/${expectedDatabaseItemKey}`,
		);
		expect(databaseItemResponse.status()).toBe(200);
		const databaseItem = (await databaseItemResponse.json()).item;
		expect(databaseItem?.key).toBe(expectedDatabaseItemKey);
		expect(databaseItem?.title).toBe(expectedDatabaseItemTitle);
		await page.goto(`/en-GB/lib/${expectedDatabaseItemKey}`);
		await expect(page.getByRole("heading", { name: expectedDatabaseItemTitle, exact: true })).toBeVisible();
	}

	const similarResponse = await request.get(`/api/similar/${firstItem.key}`);
	expect(similarResponse.status()).toBe(200);
	const similar = await similarResponse.json();
	if (expectedEmbeddings) {
		expect(similar.hits.length).toBeGreaterThan(0);
	} else {
		expect(similar).toEqual({ hits: [], totalHits: 0 });
	}

	await page.goto(`/en-GB/lib/${firstItem.key}`);
	if (expectedSearchItemTitle) {
		await expect(
			page.getByRole("heading", {
				level: 1,
				name: expectedSearchItemTitle,
			}),
		).toBeVisible();
	}
	const itemUrl = new URL(`/lib/${firstItem.key}`, expectedPublicBaseUrl).toString();
	const citationUrlText = page.getByText(`Available at ${itemUrl}.`, {
		exact: false,
	});
	if (expectedCitationUrl) {
		await expect(citationUrlText).toBeVisible();
	} else {
		await expect(citationUrlText).toHaveCount(0);
	}
});


test("the country map answers the pointer after Back, resized while away", { tag: "@smoke" }, async ({ page }) => {
	test.skip(process.env.PLAYWRIGHT_EXPECTED_COUNTRY_MAP !== "true", "This library has no country map.");
	const reachable = () => page.evaluate(() => [...document.querySelectorAll("svg [role='button']")].some((shape) => {
		const box = shape.getBoundingClientRect();
		return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === shape;
	}));
	await page.goto("/en-GB/map", { waitUntil: "domcontentloaded" });
	await dismissConsent(page);
	// Far from the middle of the map, so choosing it slides the map.
	await page.getByRole("button", { name: "Fiji", exact: true }).press("Enter");
	await expect(page).toHaveURL(url => url.searchParams.has("country"));
	await expect.poll(reachable).toBe(true);
	await page.locator("a[href]:not([href^='#']):not([href*='/map'])").filter({ visible: true }).first().click();
	await expect(page).not.toHaveURL(/\/map/);
	// The map's slide can't run while the page is kept for Back, so no transition ends it.
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goBack();
	await expect(page).toHaveURL(/\/map/);
	await expect.poll(reachable).toBe(true);
});

test("only opens the country map when its page is enabled", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	const enabled = process.env.PLAYWRIGHT_EXPECTED_COUNTRY_MAP === "true";
	await page.goto(enabled ? "/en-GB/map?country=Asia+%3E+Southern+Asia+%3E+AF" : "/en-GB/map", { waitUntil: "domcontentloaded" });
	await dismissConsent(page);
	if (enabled) {
		const country = page.getByRole("button", { name: "Afghanistan", exact: true });
		await expect(country).toBeVisible();
		const skipLink = page.getByRole("link", { name: "Skip to content", exact: true });
		await expect(page.getByRole("region", { name: "Results", exact: true })).not.toBeFocused();
		await page.keyboard.press("Tab");
		await expect(skipLink).toBeFocused();
		await skipLink.press("Enter");
		await expect(page.locator("#page-content")).toBeFocused();
		// The panel reads from the top: what the colours count, then the search.
		await page.keyboard.press("Tab");
		await expect(page.getByRole("tab", { name: "Per million people", exact: true })).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(page.getByRole("textbox", { name: "Search", exact: true })).toBeFocused();
		await country.focus();
		await expect(country).toBeFocused();
		await expect(country).toHaveAccessibleDescription(/^\d/);
		await expect(page.getByRole("tooltip")).toContainText("Afghanistan");
		await country.press("Space");
		await expect(country).toHaveAttribute("aria-pressed", "false");
		await country.press("Enter");
		await expect(page).toHaveURL(url => url.searchParams.getAll("country").includes("Asia > Southern Asia > AF"));
		await expect(country).toHaveAttribute("aria-pressed", "true");
		await expect(page.locator("#main-content")).toHaveCount(1);
		await country.press("Space");
		await expect(page).toHaveURL(url => !url.searchParams.has("country"));
		await expect(country).toHaveAttribute("aria-pressed", "false");
		await country.press("Enter");
		await page.getByRole("button", { name: "Clear all filters", exact: true }).click();
		await expect(page).toHaveURL(url => !url.searchParams.has("country"));
		await page.setViewportSize({ width: 390, height: 844 });
		await country.focus();
		await country.press("Enter");
		// On a phone the results open as a sheet beside the map without taking the focus, so the reader keeps their place.
		await expect(page.getByRole("region", { name: "Results", exact: true })).toBeVisible();
		await expect(country).toBeFocused();
		const clearFilters = page.getByRole("button", { name: "Clear all filters", exact: true });
		await clearFilters.focus();
		await page.setViewportSize({ width: 1280, height: 900 });
		await expect(clearFilters).toBeFocused();
		await page.setViewportSize({ width: 390, height: 844 });
		await expect(clearFilters).toBeFocused();
		await clearFilters.press("Enter");
		await expect(page).toHaveURL(url => !url.searchParams.has("country"));
		await expect(country).toBeFocused();
		// Typing a search opens the results as choosing a country does, and the typing stays in the search.
		const search = page.getByRole("textbox", { name: "Search", exact: true });
		await search.fill("a");
		await search.press("Enter");
		await expect(page.getByRole("region", { name: "Results", exact: true })).toBeVisible();
		await expect(search).toBeFocused();
		expect(errors).toEqual([]);
	} else {
		// A streamed Next.js notFound() can report React's recoverable Suspense
		// bailout. Check the unavailable-page contract instead of treating that
		// deliberate response as a failed map render.
		await expect(page.getByText("404", { exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "Afghanistan", exact: true })).toHaveCount(0);
		await expect(page.locator('meta[name="robots"][content="noindex"]').first()).toHaveAttribute("content", "noindex");
	}
});


test("keeps the whole-library export total independent of the search", { tag: "@smoke" }, async ({ page }) => {
	test.skip(!expectedSearchItemKey || process.env.PLAYWRIGHT_EXPECTED_EXPORT_RIS !== "true", "Requires a public record and RIS exports.");
	await page.goto(`/en-GB/lib?search=${encodeURIComponent(expectedSearchItemTitle)}&scope=title`);
	await dismissConsent(page);
	await expect(page.getByRole("heading", { name: expectedSearchItemTitle, exact: true }).first()).toBeVisible();
	const button = page.getByRole("button", { name: "Download", exact: true });
	await button.click();
	const wholeLibrary = page.getByRole("radio", { name: /^Whole community/ });
	const count = Number((await wholeLibrary.ariaSnapshot()).match(/\(([\d,]+)\)/)?.[1].replaceAll(",", ""));
	expect(count).toBeGreaterThan(0);
	await wholeLibrary.check();
	await page.route("**/api/exports/ris", route => route.fulfill({status: 503, body: "Unavailable"}));
	await page.getByRole("option", {name: /^RIS/}).click();
	await expect(page.getByText("Download failed", {exact: true})).toBeVisible();
	await page.unroute("**/api/exports/ris");

	const downloadStarted = page.waitForEvent("download");
	await page.getByRole("option", { name: /^RIS/ }).click();
	const download = await downloadStarted;
	const path = await download.path();
	expect(path).not.toBeNull();
	const records = await readFile(path!, "utf8");
	expect(records.match(/^TY\s+- /gm)).toHaveLength(count);
	await expect(page.getByRole("dialog")).toBeHidden();
	await expect(button).toBeFocused();
});

for (const width of [1200, 390]) {
	test(`keeps RTL pages within ${width}px and exposes keyboard skip links`, async ({ page }) => {
		test.skip(!expectedEnabledLocales.includes("ar"), "Requires an enabled RTL locale.");
		await page.goto("/en-GB/lib");
		await dismissConsent(page);
		await page.setViewportSize({ width, height: 844 });
		await page.goto("/ar/lib");
		await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
		const skip = page.locator('a[href="#page-content"]');
		await skip.waitFor({ state: "visible" });
		expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
		await expect(page.locator("[data-consent-gate]")).not.toHaveAttribute("inert");
		// Start from a known document control, independent of browser chrome
		// or developer tools inserted before the page's tab order.
		await page.locator('a[href="#footer"]').focus();
		await page.keyboard.press("Shift+Tab");
		await expect(skip).toBeFocused();
		const bounds = await skip.boundingBox();
		expect(bounds).not.toBeNull();
		expect(bounds!.width).toBeGreaterThan(1);
		expect(bounds!.x).toBeGreaterThanOrEqual(0);
		expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
		await page.keyboard.press("Enter");
		await expect(page).toHaveURL(/#page-content$/);
		await expect(page.locator("#page-content")).toBeFocused();
	});
}
