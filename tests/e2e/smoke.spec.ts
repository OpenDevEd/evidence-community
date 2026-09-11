import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

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
	process.env.PLAYWRIGHT_EXPECTED_CURRENT_LOCALE_LABEL ?? "EN-GB";
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
	"Citations in this library";

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

test("redirects the root route to the evidence library", async ({
	request,
}) => {
	const response = await request.get("/", { maxRedirects: 0 });

	expect(response.status()).toBe(307);

	const location = response.headers().location;
	expect(location).toBeDefined();
	expect(new URL(location!, response.url()).pathname).toBe("/lib");
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

test("renders identity assets, logo CSS, colors, and fonts from runtime configuration", async ({
	page,
}) => {
	if (expectedLoadedLogo) {
		await page.route(
			(url) => expectedLogoUrls.includes(url.toString()),
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

	const visibleLogo = page.locator("img[data-library-logo]:visible").first();
	await expect(visibleLogo).toHaveAttribute("src", expectedLogoUrl);
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

	const fontStylesheet = page.locator(
		'link[rel="stylesheet"][href^="https://fonts.googleapis.com/css2"]',
	);
	await expect(fontStylesheet).toHaveCount(1);
	const fontHref = await fontStylesheet.getAttribute("href");
	expect(
		new URL(fontHref!).searchParams
			.getAll("family")
			.map((family) => family.split(":")[0]),
	).toEqual(expectedGoogleFontFamilies);

	if (expectedThemeClass) {
		await expect(page.locator("html")).toHaveClass(
			new RegExp(`(?:^|\\s)${expectedThemeClass}(?:\\s|$)`, "u"),
		);
	}
});

test("renders navigation, footer, contact, and legal data from runtime configuration", async ({
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
	if (expectedDetectedLocale) {
		expect(defaultResponse.headers()["cache-control"]).toBe(
			"private, no-store",
		);
	} else {
		expect(defaultResponse.headers()["cache-control"]).toContain(
			"public, s-maxage=",
		);
	}

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

	const secondaryNavigation = page.getByRole("navigation", {
		name: "Secondary navigation",
	});
	const languageTrigger = secondaryNavigation
		.getByRole("button")
		.filter({ hasText: expectedCurrentLocaleLabel })
		.filter({ visible: true });

	if (!expectedLanguageSwitcher) {
		await expect(languageTrigger).toHaveCount(0);
		return;
	}

	await expect(languageTrigger).toBeVisible();
	await expect(languageTrigger).toContainText(expectedCurrentLocaleLabel);
	await languageTrigger.click();
	const localeOptions = page.getByRole("menuitem");
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

	await page
		.getByRole("banner")
		.getByRole("button")
		.filter({
			hasText:
				expectedSwitchLocale === "en-GB"
					? "EN-GB"
					: expectedSwitchLocale.toUpperCase(),
		})
		.filter({ visible: true })
		.click();
	await page
		.getByRole("menuitem", {
			name: expectedSwitchBackLocaleLabel,
			exact: true,
		})
		.press("Enter");
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
	const themeSwitcher = page.getByRole("button", {
		name: /^(?:Toggle theme|Switch to (?:dark|light) mode)$/u,
	});
	const loginButton = page.getByRole("button", {
		name: "Login/Register button",
		exact: true,
	});

	await expect(navbarSearch).toHaveCount(expectedNavbarSearch ? 1 : 0);
	await expect(themeSwitcher).toHaveCount(expectedThemeSwitcher ? 1 : 0);
	await expect(loginButton).toHaveCount(expectedLogin ? 1 : 0);
});

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

test("reports a clipboard failure and retries copying clean citation text", async ({ page, context }) => {
	test.skip(!expectedSearchItemKey, "Requires a public record in this runtime.");
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.route(`**/item/${expectedSearchItemKey}/citation`, (route) => route.fulfill({ json: {
		citation: '<div class="csl-bib-body">\n  <div class="csl-entry">Mills, C. (2026). <i>Learning &amp; evidence.</i></div>\n</div>\n',
	} }));
	await page.goto(`/en-GB/lib/${expectedSearchItemKey}`);
	await dismissConsent(page);
	const heading = page.getByRole("heading", { name: "Citation", exact: true });
	if (!expectedCitationsEnabled) {
		await expect(heading).toHaveCount(0);
		return;
	}
	const citation = heading.locator("..");
	await page.evaluate(() => {
		Object.defineProperty(navigator.clipboard, "writeText", {
			configurable: true,
			value: () => {
				Reflect.deleteProperty(navigator.clipboard, "writeText");
				return Promise.reject(new DOMException("Clipboard permission denied", "NotAllowedError"));
			},
		});
	});
	await citation.getByRole("button").click();
	await expect(page.locator("[data-sonner-toast] [data-type=error]")).toBeVisible();
	await citation.getByRole("button").click();
	const suffix = expectedCitationUrl
		? ` Available at ${new URL(`/lib/${expectedSearchItemKey}`, expectedPublicBaseUrl)}.`
		: "";
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toBe(`Mills, C. (2026). Learning & evidence.${suffix}`);
});

test("keeps clipboard feedback tied to the latest attempt", async ({ page, context }) => {
	test.skip(!expectedSearchItemKey || !expectedCitationsEnabled, "Requires a public record with citations.");
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto(`/en-GB/lib/${expectedSearchItemKey}`);
	await dismissConsent(page);
	const citation = page.getByRole("heading", { name: "Citation", exact: true }).locator("..");
	const copy = citation.getByRole("button");
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
	await expect(copy).toHaveAccessibleName("Copy Citation");
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

test("filters institution suggestions by typed name", async ({ page }) => {
	test.skip(!expectedInstitutionFacet, "Institution filter is disabled for this library.");
	await page.route("**/api/facets**", (route) => route.fulfill({ json: {
		facetDistribution: { institution: { "North University": 2, "South Institute": 1 } },
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

test("enforces runtime search scopes, filters, embeddings, and citation URLs", async ({
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
		expect(Object.hasOwn(facetDistribution, "institution")).toBe(false);
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
			`/api/item/${expectedDatabaseItemKey}?source=db`,
		);
		expect(databaseItemResponse.status()).toBe(200);
		const databaseItem = (await databaseItemResponse.json()).item;
		expect(databaseItem?.key).toBe(expectedDatabaseItemKey);
		expect(databaseItem?.title).toBe(expectedDatabaseItemTitle);
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
		await expect(page.getByRole("main")).toBeFocused();
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
		await expect(page.getByRole("region", { name: "Results", exact: true })).toBeFocused();
		await country.focus();
		await expect(page.getByRole("region", { name: "Results", exact: true })).toBeFocused();
		const clearFilters = page.getByRole("button", { name: "Clear all filters", exact: true });
		await clearFilters.focus();
		await page.setViewportSize({ width: 1280, height: 900 });
		await expect(clearFilters).toBeFocused();
		await page.setViewportSize({ width: 390, height: 844 });
		await expect(clearFilters).toBeFocused();
		await clearFilters.press("Enter");
		await expect(page).toHaveURL(url => !url.searchParams.has("country"));
		await expect(country).toBeFocused();
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


test("keeps the whole-library export total independent of the search", async ({ page }) => {
	test.skip(!expectedSearchItemKey || process.env.PLAYWRIGHT_EXPECTED_EXPORT_RIS !== "true", "Requires a public record and RIS exports.");
	await page.goto(`/en-GB/lib?search=${encodeURIComponent(expectedSearchItemTitle)}&scope=title`);
	await dismissConsent(page);
	await expect(page.getByRole("heading", { name: expectedSearchItemTitle, exact: true }).first()).toBeVisible();
	const button = page.getByRole("button", { name: /^Download library/ });
	const count = Number((await button.innerText()).match(/([\d,]+)\s*$/)?.[1].replaceAll(",", ""));
	expect(count).toBeGreaterThan(0);
	await button.click();
	await page.route("**/lib/export/ris", route => route.fulfill({status: 503, body: "Unavailable"}));
	await page.getByRole("option", {name: /^RIS/}).click();
	await expect(page.getByText("Download failed", {exact: true})).toBeVisible();
	await page.unroute("**/lib/export/ris");

	const downloadStarted = page.waitForEvent("download");
	await page.getByRole("option", { name: /^RIS/ }).click();
	const download = await downloadStarted;
	const path = await download.path();
	expect(path).not.toBeNull();
	const records = await readFile(path!, "utf8");
	expect(records.match(/^TY\s+- /gm)).toHaveLength(count);
});

for (const width of [1200, 390]) {
	test(`keeps RTL pages within ${width}px and exposes keyboard skip links`, async ({ page }) => {
		test.skip(!expectedEnabledLocales.includes("ar"), "Requires an enabled RTL locale.");
		await page.goto("/en-GB/lib");
		await dismissConsent(page);
		await page.setViewportSize({ width, height: 844 });
		await page.goto("/ar/lib");
		await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
		const skip = page.locator('a[href="#main-content"]');
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
		await expect(page).toHaveURL(/#main-content$/);
	});
}
