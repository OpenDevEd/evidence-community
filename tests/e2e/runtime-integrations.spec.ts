import {
	expect,
	test,
	type APIRequestContext,
	type Page,
} from "@playwright/test";

test.skip(
	process.env.PLAYWRIGHT_RUNTIME_ACCEPTANCE !== "true",
	"requires the runtime acceptance services",
);

const expectedGapMap =
	process.env.PLAYWRIGHT_EXPECTED_GAP_MAP === "true";
const expectedExportRis =
	process.env.PLAYWRIGHT_EXPECTED_EXPORT_RIS === "true";
const expectedExportBibtex =
	process.env.PLAYWRIGHT_EXPECTED_EXPORT_BIBTEX === "true";
const expectedExportAtom =
	process.env.PLAYWRIGHT_EXPECTED_EXPORT_ATOM === "true";
const expectedAnalytics =
	process.env.PLAYWRIGHT_EXPECTED_ANALYTICS === "true";
const expectedAuthentication =
	process.env.PLAYWRIGHT_EXPECTED_AUTHENTICATION === "true";
const expectedEmail =
	process.env.PLAYWRIGHT_EXPECTED_EMAIL === "true";
const fixtureOrigin =
	process.env.PLAYWRIGHT_FIXTURE_ORIGIN ??
	"https://localhost:4443";
const mailpitOrigin =
	process.env.PLAYWRIGHT_MAILPIT_ORIGIN ??
	"http://127.0.0.1:38025";
const gapMapSlug =
	process.env.PLAYWRIGHT_GAP_MAP_SLUG ?? "amber-runtime-map";
const gapMapLabel =
	process.env.PLAYWRIGHT_GAP_MAP_LABEL ?? "Amber Runtime Gap Map";
const gapMapMarker =
	process.env.PLAYWRIGHT_GAP_MAP_MARKER ?? "AMBER_GAP_MAP_FIXTURE";
const disabledGapMapSlug =
	process.env.PLAYWRIGHT_DISABLED_GAP_MAP_SLUG ?? "";
const disabledGapMapLabel =
	process.env.PLAYWRIGHT_DISABLED_GAP_MAP_LABEL ?? "";
const contactRecipient =
	process.env.PLAYWRIGHT_CONTACT_RECIPIENT ??
	"contact-amber@example.org";
const emailSender =
	process.env.PLAYWRIGHT_EMAIL_SENDER ??
	"runtime-amber@example.org";
const identityShortName =
	process.env.PLAYWRIGHT_EXPECTED_IDENTITY_SHORT_NAME ??
	"Evidence Library";
const consentDecline =
	process.env.PLAYWRIGHT_EXPECTED_CONSENT_DECLINE ?? "Decline";
const analyticsDeliveryWindowMs = 3_500;

async function clearMailbox(request: APIRequestContext) {
	const response = await request.delete(`${mailpitOrigin}/api/v1/messages`, {
		data: {},
	});
	expect(response.ok()).toBe(true);
}

async function mailboxMessages(
	request: APIRequestContext,
) {
	const response = await request.get(`${mailpitOrigin}/api/v1/messages`);
	expect(response.ok()).toBe(true);
	return response.json() as Promise<{ messages?: unknown[] }>;
}

async function dismissConsent(page: Page) {
	await page
		.getByRole("button", { name: "Decline", exact: true })
		.click({ timeout: 3_000 })
		.catch(() => undefined);
}

test("proxies only configured gap maps", async ({ page, request }) => {
	await page.goto("/gapmaps");
	await dismissConsent(page);

	if (!expectedGapMap) {
		await expect(
			page
				.getByRole("main")
				.locator('a[href*="/gapmaps/"][href$=".html"]'),
		).toHaveCount(0);
		await expect(
			page.getByText("No gap maps available yet.", { exact: true }),
		).toBeVisible();
	} else {
		const gapMapLink = page.getByRole("link", {
			name: new RegExp(gapMapLabel, "u"),
		});
		const response = await request.get(
			`/gapmaps/${gapMapSlug}.html`,
		);
		await expect(gapMapLink).toHaveAttribute(
			"href",
			`/gapmaps/${gapMapSlug}.html`,
		);
		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain("text/html");
		expect(response.headers()["x-content-type-options"]).toBe("nosniff");
		expect(await response.text()).toContain(gapMapMarker);
	}

	if (disabledGapMapSlug) {
		await expect(
			page.getByRole("link", {
				name: new RegExp(disabledGapMapLabel, "u"),
			}),
		).toHaveCount(0);
		expect(
			(
				await request.get(
					`/gapmaps/${disabledGapMapSlug}.html`,
				)
			).status(),
		).toBe(404);
	}
});

test("proxies only configured whole-library exports", async ({ request }) => {
	for (const expected of [
		{
			enabled: expectedExportRis,
			path: "/lib/export/ris",
			contentType: "application/x-research-info-systems",
			marker: "AMBER_RIS_FIXTURE",
			filename: "amber-evidence.ris",
		},
		{
			enabled: expectedExportBibtex,
			path: "/lib/export/bibtex",
			contentType: "application/x-bibtex",
			marker: "AMBER_BIBTEX_FIXTURE",
			filename: "amber-evidence.bib",
		},
		{
			enabled: expectedExportAtom,
			path: "/lib/atom.xml",
			contentType: "application/atom+xml",
			marker: "AMBER_ATOM_FIXTURE",
			filename: null,
		},
	]) {
		const response = await request.get(expected.path);
		if (!expected.enabled) {
			expect(response.status(), expected.path).toBe(404);
			continue;
		}

		expect(response.status(), expected.path).toBe(200);
		expect(response.headers()["content-type"]).toContain(
			expected.contentType,
		);
		expect(await response.text()).toContain(expected.marker);
		if (expected.filename) {
			expect(response.headers()["content-disposition"]).toContain(
				expected.filename,
			);
		} else {
			expect(response.headers()["content-disposition"]).toBeUndefined();
		}
	}
});

test("sends analytics only for the configured and consented profile", async ({
	page,
}) => {
	await page.addInitScript(() => {
		Object.defineProperties(Navigator.prototype, {
			userAgent: {
				get: () =>
					"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
			},
			userAgentData: {
				get: () => ({
					brands: [{ brand: "Chromium", version: "151" }],
					mobile: false,
					platform: "macOS",
				}),
			},
			webdriver: { get: () => false },
		});
	});

	const allPostRequests: string[] = [];
	const consoleMessages: string[] = [];
	const eventRequests: string[] = [];
	const eventResponses: string[] = [];
	const eventFailures: string[] = [];
	page.on("request", (request) => {
		if (request.method() === "POST") {
			allPostRequests.push(request.url());
		}
		if (
			request.method() === "POST" &&
			request.url().startsWith(fixtureOrigin)
		) {
			eventRequests.push(request.url());
		}
	});
	page.on("response", (response) => {
		if (
			response.request().method() === "POST" &&
			response.url().startsWith(fixtureOrigin)
		) {
			eventResponses.push(`${response.status()} ${response.url()}`);
		}
	});
	page.on("requestfailed", (request) => {
		if (request.url().startsWith(fixtureOrigin)) {
			eventFailures.push(
				`${request.failure()?.errorText ?? "unknown error"} ${request.url()}`,
			);
		}
	});
	page.on("console", (message) => {
		if (message.type() === "error" || message.type() === "warning") {
			consoleMessages.push(`${message.type()}: ${message.text()}`);
		}
	});

	await page.goto("/lib");
	await page
		.getByRole("button", {
			name: "Accept & Continue",
			exact: true,
		})
		.click();

	if (expectedAnalytics) {
		try {
			await expect
				.poll(
					() =>
						eventResponses.some((response) =>
							response.startsWith("200 "),
						),
					{ timeout: 10_000 },
				)
				.toBe(true);
		} catch (error) {
			const browserState = await page.evaluate(() => ({
				cookie: document.cookie,
				localStorageKeys: Object.keys(localStorage),
				resources: performance
					.getEntriesByType("resource")
					.map((entry) => entry.name)
					.filter((name) => name.includes("localhost")),
			}));
			throw new Error(
				`Expected a successful analytics response. All POSTs: ${allPostRequests.join(", ") || "none"}; collector requests: ${eventRequests.join(", ") || "none"}; responses: ${eventResponses.join(", ") || "none"}; failures: ${eventFailures.join(", ") || "none"}; console: ${consoleMessages.join(" | ") || "none"}; browser state: ${JSON.stringify(browserState)}`,
				{ cause: error },
			);
		}
		expect(eventRequests.length).toBeGreaterThan(0);
		await page
			.getByRole("button", {
				name: "Cookie Settings",
				exact: true,
			})
			.click();
		await page
			.getByRole("button", {
				name: consentDecline,
				exact: true,
			})
			.click();
		await expect
			.poll(() =>
				page.evaluate(() => ({
					cookies: document.cookie
						.split("; ")
						.map((cookie) => cookie.split("=")[0])
						.filter((key) => key.startsWith("ph_")),
					localStorage: Object.keys(localStorage).filter(
						(key) =>
							key.startsWith("ph_") &&
							!key.startsWith("__ph_opt_in_out_"),
					),
				})),
			)
			.toEqual({ cookies: [], localStorage: [] });
		const requestsAfterWithdrawal = eventRequests.length;
		await page.goto("/gapmaps");
		await expect(page.getByRole("main")).toBeVisible();
		await page.waitForTimeout(analyticsDeliveryWindowMs);
		expect(eventRequests).toHaveLength(requestsAfterWithdrawal);
		return;
	}

	await page.goto("/gapmaps");
	await expect(page.getByRole("main")).toBeVisible();
	await page.waitForTimeout(analyticsDeliveryWindowMs);
	expect(eventRequests).toEqual([]);
});

test("enables credentials authentication only for the configured profile", async ({
	page,
	request,
}) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	const providers = await request.get("/api/auth/providers");
	if (!expectedAuthentication) {
		expect(providers.status()).toBe(404);
		await page.goto("/lib");
		await dismissConsent(page);
		await expect(
			page.getByRole("button", {
				name: /^(?:Login|Login\/Register button)$/u,
				exact: true,
			}),
		).toHaveCount(0);
		return;
	}

	expect(providers.status()).toBe(200);
	expect(await providers.json()).toMatchObject({
		credentials: { type: "credentials" },
	});

	const email = `acceptance-${Date.now()}@example.org`;
	await page.goto("/lib");
	await dismissConsent(page);
	await page
		.getByRole("button", {
			name: /^(?:Login|Login\/Register button)$/u,
			exact: true,
		})
		.click();
	await page.getByPlaceholder("Email", { exact: true }).fill(email);
	await page
		.getByPlaceholder("Password", { exact: true })
		.fill("acceptance-password");
	await page.getByRole("button", { name: "Register", exact: true }).click();

	await expect(
		page.getByPlaceholder("Email", { exact: true }),
	).toHaveCount(0, { timeout: 15_000 });
	await expect
		.poll(
			() =>
				page.evaluate(async () => {
					const response = await fetch("/api/auth/session", {
						credentials: "same-origin",
					});
					const session = await response.json();
					return session?.user?.email;
				}),
			{ timeout: 15_000 },
		)
		.toBe(email);
});

test("delivers configured contact mail through SMTP only when enabled", async ({
	page,
	request,
}) => {
	await clearMailbox(request);

	if (!expectedEmail) {
		await page.goto("/contact");
		await expect(
			page.getByText("Page Not Found", { exact: true }),
		).toBeVisible();
		await expect(page.locator("form")).toHaveCount(0);
		await page.waitForTimeout(500);
		expect((await mailboxMessages(request)).messages ?? []).toHaveLength(0);
		return;
	}

	const replyTo = `sender-${Date.now()}@example.org`;
	const description =
		"Acceptance SMTP delivery from the configured Evidence Library.";
	await page.goto("/contact");
	await dismissConsent(page);
	await page.getByLabel("Email", { exact: true }).fill(replyTo);
	await page
		.getByLabel(/^Description/u)
		.fill(description);
	await page.getByRole("button", { name: "Submit", exact: true }).click();

	await expect
		.poll(
			async () =>
				((await mailboxMessages(request)).messages ?? []).length,
			{ timeout: 15_000 },
		)
		.toBe(1);

	const latest = await request.get(
		`${mailpitOrigin}/api/v1/message/latest`,
	);
	expect(latest.ok()).toBe(true);
	const message = JSON.stringify(await latest.json());
	expect(message).toContain(contactRecipient);
	expect(message).toContain(emailSender);
	expect(message).toContain(replyTo);
	expect(message).toContain(`${identityShortName} - Feedback`);
	expect(message).toContain(description);
});
