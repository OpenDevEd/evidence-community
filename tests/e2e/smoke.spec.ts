import { expect, test } from "@playwright/test";

const expectedConfigRevision =
	process.env.PLAYWRIGHT_EXPECTED_CONFIG_REVISION ?? "example-1";
const expectedConfigUpdatedAt =
	process.env.PLAYWRIGHT_EXPECTED_CONFIG_UPDATED_AT ??
	"2026-07-27T12:30:00.000Z";
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
	process.env.PLAYWRIGHT_EXPECTED_CONTACT_ADDRESS ?? "Evidence Library Office";
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
const expectedConsentDecline =
	process.env.PLAYWRIGHT_EXPECTED_CONSENT_DECLINE ?? "Decline";
const expectedSearchScopeCount = Number(
	process.env.PLAYWRIGHT_EXPECTED_SEARCH_SCOPE_COUNT ?? "3",
);
const expectedDefaultSearchScopeLabel =
	process.env.PLAYWRIGHT_EXPECTED_DEFAULT_SEARCH_SCOPE_LABEL ??
	"Title, abstract, authors and keywords";
const expectedYearFilter =
	process.env.PLAYWRIGHT_EXPECTED_YEAR_FILTER !== "false";
const expectedInstitutionFilterLabel =
	process.env.PLAYWRIGHT_EXPECTED_INSTITUTION_FILTER_LABEL ??
	"Institutions";
const expectedCitationUrl =
	process.env.PLAYWRIGHT_EXPECTED_CITATION_URL !== "false";
const expectedEmbeddings =
	process.env.PLAYWRIGHT_EXPECTED_EMBEDDINGS !== "false";
const expectedCountryFacet =
	process.env.PLAYWRIGHT_EXPECTED_COUNTRY_FACET !== "false";
const expectedAuthorCountryFacet =
	process.env.PLAYWRIGHT_EXPECTED_AUTHOR_COUNTRY_FACET !== "false";
const expectedInstitutionFacet =
	process.env.PLAYWRIGHT_EXPECTED_INSTITUTION_FACET !== "false";
const expectedNavbarSearch =
	process.env.PLAYWRIGHT_EXPECTED_NAVBAR_SEARCH !== "false";
const expectedThemeSwitcher =
	process.env.PLAYWRIGHT_EXPECTED_THEME_SWITCHER !== "false";
const expectedLogin =
	process.env.PLAYWRIGHT_EXPECTED_LOGIN !== "false";
const expectedAi =
	process.env.PLAYWRIGHT_EXPECTED_AI !== "false";

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
	expect(body).not.toContain("example-search-key");
});

test("renders navigation, footer, contact, and legal data from runtime configuration", async ({
	page,
}) => {
	await page.goto("/lib");
	await page.getByRole("button", { name: "Decline", exact: true }).click();

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
	await expect(page.getByText(expectedDisclaimer, { exact: true })).toBeVisible();
	await expect(page.getByText(expectedAttribution, { exact: true })).toBeVisible();

	await expect(
		page
			.locator("#footer")
			.getByRole("link", { name: "Privacy Policy", exact: true }),
	).toHaveAttribute("href", /privacy$/u);
	await expect(
		page
			.locator("#footer")
			.getByRole("link", { name: "Cookie Policy", exact: true }),
	).toHaveAttribute("href", /cookie-policy$/u);
	await expect(
		page
			.locator("#footer")
			.getByRole("link", { name: "Terms of Service", exact: true }),
	).toHaveAttribute("href", /^https:\/\//u);

	await page.goto("/contact");
	await expect(
		page.getByRole("link", { name: expectedContactEmail, exact: true }),
	).toHaveAttribute("href", `mailto:${expectedContactEmail}`);
	await expect(
		page.getByRole("link", { name: expectedContactPhone, exact: true }),
	).toHaveAttribute("href", `tel:${expectedContactPhone}`);
	await expect(
		page.getByText(expectedContactAddress, { exact: false }),
	).toBeVisible();
});

test("enforces runtime locales, default, detection, order, and switcher visibility", async ({
	page,
	request,
}) => {
	const disabledResponse = await request.get(
		`/${expectedDisabledLocale}/lib`,
		{ maxRedirects: 0 },
	);
	expect(disabledResponse.status()).toBe(307);
	expect(
		new URL(
			disabledResponse.headers().location!,
			disabledResponse.url(),
	).pathname,
	).toBe("/lib");

	const defaultResponse = await request.get("/lib", {
		headers: { "Accept-Language": "zz-ZZ" },
		maxRedirects: 0,
	});
	expect(defaultResponse.status()).toBe(200);
	expect(await defaultResponse.text()).toContain(
		`<html lang="${expectedDefaultLocale}"`,
	);
	expect(defaultResponse.headers()["cache-control"]).toBe(
		"private, no-store",
	);

	for (const locale of expectedEnabledLocales) {
		if (locale === expectedDefaultLocale) continue;
		const enabledResponse = await request.get(`/${locale}/lib`, {
			maxRedirects: 0,
		});
		expect(enabledResponse.status()).toBeLessThan(400);
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

	await page.setViewportSize({ width: 1600, height: 900 });
	await page.goto(`/${expectedDefaultLocale}/lib`);
	const consentDecline = page.getByRole("button", {
		name: expectedConsentDecline,
		exact: true,
	});
	await consentDecline
		.click({ timeout: 3_000 })
		.catch(() => undefined);

	const languageTrigger = page
		.getByText(expectedCurrentLocaleLabel, { exact: true })
		.locator("..")
		.filter({ visible: true });

	if (!expectedLanguageSwitcher) {
		await expect(languageTrigger).toHaveCount(0);
		return;
	}

	await expect(languageTrigger).toBeVisible();
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
		.getByText(
			expectedSwitchLocale === "en-GB"
				? "EN-GB"
				: expectedSwitchLocale.toUpperCase(),
			{ exact: true },
		)
		.locator("..")
		.filter({ visible: true })
		.click();
	await page
		.getByRole("menuitem", {
			name: expectedSwitchBackLocaleLabel,
			exact: true,
		})
		.press("Enter");
	await expect
		.poll(() => new URL(page.url()).pathname)
		.toBe("/lib");
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
	await page
		.getByRole("button", { name: "Decline", exact: true })
		.click({ timeout: 3_000 })
		.catch(() => undefined);

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

test("rejects AI endpoints when runtime AI features are disabled", async ({
	request,
}) => {
	test.skip(expectedAi, "Runtime AI features are enabled");

	const [itemAi, questions, quickSearch, deepResearch] =
		await Promise.all([
			request.post("/api/ai", { data: {} }),
			request.post("/api/ai/questions", { data: {} }),
			request.post("/api/ai/chat", {
				data: { messages: [], mode: "quick" },
			}),
			request.post("/api/ai/chat", {
				data: { messages: [], mode: "full" },
			}),
		]);

	expect(itemAi.status()).toBe(403);
	expect(questions.status()).toBe(403);
	expect(quickSearch.status()).toBe(403);
	expect(deepResearch.status()).toBe(403);
});

test("enforces runtime search scopes, filters, embeddings, and citation URLs", async ({
	page,
	request,
}) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto("/en-GB/lib");
	await page
		.getByRole("button", { name: expectedConsentDecline, exact: true })
		.click({ timeout: 3_000 })
		.catch(() => undefined);

	const scopeSelect = page.getByLabel("Search scope").first();
	await expect(scopeSelect).toContainText(expectedDefaultSearchScopeLabel);
	await expect(scopeSelect.locator("option")).toHaveCount(
		expectedSearchScopeCount + 1,
	);

	const yearFilter = page.getByText("Publication Year", {
		exact: true,
	});
	const institutionFilter = page.getByText(
		expectedInstitutionFilterLabel,
		{ exact: true },
	);
	if (expectedYearFilter) {
		await expect(yearFilter).toBeVisible();
	} else {
		await expect(yearFilter).toHaveCount(0);
	}
	if (expectedInstitutionFacet) {
		await expect(institutionFilter).toBeVisible();
	} else {
		await expect(institutionFilter).toHaveCount(0);
	}

	const facetsResponse = await request.get("/api/facets");
	expect(facetsResponse.status()).toBe(200);
	const facetDistribution = (await facetsResponse.json())
		.facetDistribution;
	expect(Object.hasOwn(facetDistribution, "country_uncategorized")).toBe(
		expectedCountryFacet,
	);
	expect(
		Object.hasOwn(
			facetDistribution,
			"creators.institutions.country_code_uncategorized",
		),
	).toBe(expectedAuthorCountryFacet);
	if (!expectedInstitutionFacet) {
		expect(Object.hasOwn(facetDistribution, "institution")).toBe(false);
	}

	const itemsResponse = await request.get("/api/items");
	expect(itemsResponse.status()).toBe(200);
	const firstItem = (await itemsResponse.json()).items?.[0];
	expect(firstItem?.key).toBeTruthy();

	const embeddingsResponse = await request.get(
		`/api/ai/embeddings/${firstItem.key}`,
	);
	expect(embeddingsResponse.status()).toBe(200);
	const embeddings = await embeddingsResponse.json();
	if (expectedEmbeddings) {
		expect(embeddings.hits.length).toBeGreaterThan(0);
	} else {
		expect(embeddings).toEqual({ hits: [], totalHits: 0 });
	}

	await page.goto(`/en-GB/lib/${firstItem.key}`);
	const itemUrl = new URL(`/lib/${firstItem.key}`, page.url()).toString();
	const citationUrlText = page.getByText(
		`Available at ${itemUrl}.`,
		{ exact: false },
	);
	if (expectedCitationUrl) {
		await expect(citationUrlText).toBeVisible();
	} else {
		await expect(citationUrlText).toHaveCount(0);
	}
});
