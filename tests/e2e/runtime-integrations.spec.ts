import { gunzipSync } from "node:zlib";
import {
	expect,
	test,
	type APIRequestContext,
	type Page,
} from "@playwright/test";

import { libraryCallbackUrl, readerSessionHeader, sendAuthRequestsFromLibraryOrigin } from "./admin-login";
import { dismissConsent, expectsConsent } from "./consent";

test.skip(
	process.env.PLAYWRIGHT_RUNTIME_ACCEPTANCE !== "true",
	"requires the runtime acceptance services",
);

test.use({
	userAgent:
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
});

const expectedGapMap =
	process.env.PLAYWRIGHT_EXPECTED_GAP_MAP === "true";
const expectedExportRis =
	process.env.PLAYWRIGHT_EXPECTED_EXPORT_RIS === "true";
const expectedExportBibtex =
	process.env.PLAYWRIGHT_EXPECTED_EXPORT_BIBTEX === "true";
const expectedExportAtom =
	process.env.PLAYWRIGHT_EXPECTED_EXPORT_ATOM === "true";
const exportIncludedTitles = (
	process.env.PLAYWRIGHT_EXPORT_INCLUDED_TITLES ?? ""
)
	.split("|")
	.filter(Boolean);
const exportExcludedTitles = (
	process.env.PLAYWRIGHT_EXPORT_EXCLUDED_TITLES ?? ""
)
	.split("|")
	.filter(Boolean);
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
	"amber@example.org";
const emailSenderName = process.env.PLAYWRIGHT_EXPECTED_IDENTITY_NAME ?? "Amber Evidence Library";
const identityShortName =
	process.env.PLAYWRIGHT_EXPECTED_IDENTITY_SHORT_NAME ??
	"Evidence Library";
const consentAccept =
	process.env.PLAYWRIGHT_EXPECTED_CONSENT_ACCEPT ?? "Accept All & Continue";
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

function decodeCaptureBody(body: Buffer | null) {
	if (!body) throw new Error("Missing capture body");
	const decoded = body[0] === 0x1f && body[1] === 0x8b
		? gunzipSync(body).toString("utf8")
		: body.toString("utf8");
	const payload = JSON.parse(decoded);
	return Array.isArray(payload) ? payload : payload.batch ?? [payload];
}

function trackAnalyticsNetwork(page: Page) {
	const allPostRequests: string[] = [];
	const collectorRequests: string[] = [];
	const consoleMessages: string[] = [];
	const eventRequests: string[] = [];
	const eventResponses: string[] = [];
	const eventFailures: string[] = [];
	const capturedEvents: Array<{
		event?: string;
		properties?: Record<string, unknown>;
	}> = [];
	const payloadErrors: string[] = [];
	const isCapture = (url: string) =>
		url.startsWith(fixtureOrigin) && /\/(?:i\/v0\/)?[es]\/?$/u.test(new URL(url).pathname);

	page.on("request", (request) => {
		if (request.url().startsWith(fixtureOrigin)) {
			collectorRequests.push(`${request.method()} ${request.url()}`);
		}
		if (request.method() === "POST") {
			allPostRequests.push(request.url());
		}
		if (
			request.method() === "POST" &&
			isCapture(request.url())
		) {
			eventRequests.push(request.url());
		}
	});
	page.on("response", (response) => {
		if (
			response.request().method() === "POST" &&
			isCapture(response.url())
		) {
			eventResponses.push(`${response.status()} ${response.url()}`);
			if (response.ok()) {
				try {
					capturedEvents.push(...decodeCaptureBody(response.request().postDataBuffer()));
				} catch (error) {
					payloadErrors.push(String(error));
				}
			}
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

	return {
		capturedEvents,
		payloadErrors,
		allPostRequests,
		collectorRequests,
		consoleMessages,
		eventFailures,
		eventRequests,
		eventResponses,
	};
}

type AnalyticsNetwork = ReturnType<typeof trackAnalyticsNetwork>;

type ReplayNode = {
	tagName?: string;
	textContent?: string;
	attributes?: Record<string, string>;
	childNodes?: ReplayNode[];
};

function allReplayNodes(node: ReplayNode): ReplayNode[] {
	return [node, ...(node.childNodes ?? []).flatMap(allReplayNodes)];
}

function capturedReplaySnapshots(network: AnalyticsNetwork) {
	return network.capturedEvents
		.filter((event) => event.event === "$snapshot")
		.flatMap((event) => event.properties?.$snapshot_data as Array<{
			type: number;
			data: string | { node?: ReplayNode };
		}>)
		.map((snapshot) => ({
			...snapshot,
			data: typeof snapshot.data === "string"
				? JSON.parse(gunzipSync(Buffer.from(snapshot.data, "latin1")).toString("utf8"))
				: snapshot.data,
		}));
}

function expectPrivateStyledReplay(network: AnalyticsNetwork) {
	const snapshots = capturedReplaySnapshots(network);
	expect(JSON.stringify(snapshots)).not.toContain("analytics-privacy-canary");
	const fullSnapshot = snapshots.find((snapshot) => snapshot.type === 2);
	if (!fullSnapshot?.data.node) throw new Error("No full DOM snapshot was captured");
	const styles = allReplayNodes(fullSnapshot.data.node)
		.filter((node) => node.tagName === "style" || node.attributes?._cssText !== undefined)
		.map((node) => node.attributes?._cssText ??
			(node.childNodes ?? []).map((child) => child.textContent ?? "").join(""))
		.filter((css) => css.trim().length > 0);
	expect(styles.length).toBeGreaterThan(0);
	for (const css of styles) {
		// Masking stylesheet content destroys replay layout. This checks the
		// recorder protocol, without depending on application styles or classes.
		expect(/^[\s*]+$/u.test(css), "Replay stylesheet was masked").toBe(false);
	}
}

async function expectSuccessfulAnalytics(
	page: Page,
	network: AnalyticsNetwork,
) {
	try {
		await expect
			.poll(
				() =>
						network.capturedEvents.some((event) => event.event === "$pageview"),
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
			`Expected a successful analytics response. All POSTs: ${network.allPostRequests.join(", ") || "none"}; collector requests: ${network.eventRequests.join(", ") || "none"}; responses: ${network.eventResponses.join(", ") || "none"}; failures: ${network.eventFailures.join(", ") || "none"}; console: ${network.consoleMessages.join(" | ") || "none"}; browser state: ${JSON.stringify(browserState)}`,
			{ cause: error },
		);
	}
	expect(network.eventRequests.length).toBeGreaterThan(0);
	expect(network.payloadErrors).toEqual([]);
	const pageview = network.capturedEvents.find((event) => event.event === "$pageview");
	expect(pageview?.properties?.token).toEqual(expect.any(String));
	expect(pageview?.properties?.distinct_id).toEqual(expect.any(String));
	expect(JSON.stringify(network.capturedEvents)).not.toContain("analytics-privacy-canary");
}

async function expectFlushedSessionReplay(
	page: Page,
	network: AnalyticsNetwork,
) {
	try {
		await expect
			.poll(
				() => capturedReplaySnapshots(network).some(
					(snapshot) => snapshot.type === 2 && snapshot.data.node,
				),
				{ timeout: 10_000 },
			)
			.toBe(true);
	} catch (error) {
		const browserState = await page.evaluate(() => ({
			cookie: document.cookie,
			localStorage: Object.fromEntries(
				Object.entries(localStorage).filter(([key]) => key.startsWith("ph_")),
			),
		}));
		throw new Error(
			`Expected PostHog to capture and flush a full session replay snapshot. Collector requests: ${network.collectorRequests.join(", ") || "none"}; responses: ${network.eventResponses.join(", ") || "none"}; failures: ${network.eventFailures.join(", ") || "none"}; console: ${network.consoleMessages.join(" | ") || "none"}; browser state: ${JSON.stringify(browserState)}`,
			{ cause: error },
		);
	}
}

async function withdrawAnalyticsConsent(
	page: Page,
	network: AnalyticsNetwork,
) {
	await page
		.getByRole("button", { name: "Cookie Settings", exact: true })
		.click();
	await page
		.getByRole("button", { name: consentDecline, exact: true })
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
	const requestsAfterWithdrawal = network.eventRequests.length;
	await page.goto("/gapmaps");
	await expect(page.getByRole("main")).toBeVisible();
	await page.waitForTimeout(analyticsDeliveryWindowMs);
	expect(network.eventRequests).toHaveLength(requestsAfterWithdrawal);
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

test("builds only the whole-library exports that are switched on", async ({
	request,
}) => {
	for (const expected of [
		{
			enabled: expectedExportRis,
			path: "/lib/export/ris",
			contentType: "application/x-research-info-systems",
			marker: "TY  - ",
			filename: "amber-evidence.ris",
		},
		{
			enabled: expectedExportBibtex,
			path: "/lib/export/bibtex",
			contentType: "application/x-bibtex",
			marker: "@article{",
			filename: "amber-evidence.bib",
		},
		{
			enabled: expectedExportAtom,
			path: "/lib/atom.xml",
			contentType: "application/atom+xml",
			marker: '<feed xmlns="http://www.w3.org/2005/Atom">',
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

		const body = await response.text();
		expect(body, expected.path).toContain(expected.marker);

		// The file is built from the library's own records. A published
		// record and a record carrying the internal badge tag are both public,
		// so both belong in it.
		for (const title of exportIncludedTitles) {
			expect(body, `${expected.path} must list ${title}`).toContain(
				title,
			);
		}

		// A hidden, deleted, child or draft-only record must never reach it.
		for (const title of exportExcludedTitles) {
			expect(body, `${expected.path} must not list ${title}`).not.toContain(
				title,
			);
		}

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
			userAgentData: {
				get: () => ({
					brands: [
						{ brand: "Google Chrome", version: "151" },
						{ brand: "Chromium", version: "151" },
					],
					mobile: false,
					platform: "macOS",
				}),
			},
			webdriver: { get: () => false },
		});
	});

	const network = trackAnalyticsNetwork(page);

	await page.goto("/lib?qa_email=analytics-privacy-canary%40example.org");
	await page.getByRole("main").evaluate((element) => {
		element.id = "analytics-privacy-canary";
		element.setAttribute("data-private", "analytics-privacy-canary");
		element.style.setProperty("--privacy-probe", 'url("https://example.org/analytics-privacy-canary")');
	});
	if (expectsConsent) {
		await page
			.getByRole("button", {
				name: consentAccept,
				exact: true,
			})
			.click();
	}

	if (expectedAnalytics) {
		await page.getByRole("textbox", { name: "Search", exact: true })
			.fill("analytics-privacy-canary@example.org");
		await expectSuccessfulAnalytics(page, network);
		await page.mouse.click(4, 4);
		await expectFlushedSessionReplay(page, network);
		await withdrawAnalyticsConsent(page, network);
		expectPrivateStyledReplay(network);
		expect(network.payloadErrors).toEqual([]);
		expect(JSON.stringify(network.capturedEvents)).not.toContain("analytics-privacy-canary");
		return;
	}

	await page.goto("/gapmaps");
	await expect(page.getByRole("main")).toBeVisible();
	await page.waitForTimeout(analyticsDeliveryWindowMs);
	expect(network.eventRequests).toEqual([]);
});

test("offers OpenScholar sign-in only where reader accounts are on", { tag: "@smoke" }, async ({
	page,
	request,
}) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await page.goto("/lib");
	await dismissConsent(page);
	const signIn = page.getByRole("button", { name: "Sign in", exact: true });
	if (!expectedAuthentication) {
		await expect(signIn).toHaveCount(0);
		expect((await request.get("/api/reader")).status()).toBe(404);
		return;
	}
	expect((await request.get("/api/reader")).status()).toBe(401);

	// Only pressing the button goes to OpenScholar, and it comes back to the library.
	await sendAuthRequestsFromLibraryOrigin(page);
	await signIn.click();
	await page.waitForURL(/\/oauth\/authorize\?/u);
	expect(new URL(page.url()).searchParams.get("redirect_uri")).toBe(libraryCallbackUrl());

	// A signed-in reader keeps a private collection to themselves.
	const { readerId, cookie } = await readerSessionHeader(`user_acceptance_reader_${Date.now()}`);
	const created = await request.post("/api/reader/collections", {
		data: { name: "Reading group", private: true },
		headers: { cookie },
	});
	expect(created.status()).toBe(201);
	const { id } = (await created.json()) as { id: string };
	const listUrl = `/api/user/items/${readerId}?collectionId=${id}`;
	expect((await request.get(listUrl, { headers: { cookie } })).status()).toBe(200);
	expect((await request.get(listUrl)).status()).toBe(403);
});

test("shares a private collection by email: OpenScholar sends the invitation and the library keeps the member", { tag: "@smoke" }, async ({ request }) => {
	test.skip(!expectedAuthentication, "Reader accounts are off in this library.");
	// The fake OpenScholar verifies <name>@example.org on the account user_mock_<name>.
	const run = Date.now();
	const owner = await readerSessionHeader(`user_mock_owner${run}`);
	const invitee = await readerSessionHeader(`user_mock_invitee${run}`);
	const created = await request.post("/api/reader/collections", { data: { name: "Shared reading", private: true }, headers: { cookie: owner.cookie } });
	const { id } = (await created.json()) as { id: string };
	const listUrl = `/api/user/items/${owner.readerId}?collectionId=${id}`;
	expect((await request.get(listUrl, { headers: { cookie: invitee.cookie } })).status()).toBe(403);

	const invited = await request.post(`/api/reader/collections/${id}/invitations`, {
		data: { email: `invitee${run}@example.org`, role: "editor" },
		headers: { cookie: owner.cookie },
	});
	expect(invited.status()).toBe(201);
	const invitation = (await invited.json()) as { id: string; delivery: string };
	expect(invitation.delivery).toBe("sent");
	const sent = (await (await request.get("/api/reader/invitations", { headers: { cookie: owner.cookie } })).json()) as { invitations: { id: string }[] };
	expect(sent.invitations.map((one) => one.id)).toContain(invitation.id);

	// Only the account with the invited address accepts it, and it opens the owner's collection.
	expect((await request.post(`/api/reader/invitations/${invitation.id}/accept`, { headers: { cookie: owner.cookie } })).status()).toBe(403);
	const accepted = await request.post(`/api/reader/invitations/${invitation.id}/accept`, { headers: { cookie: invitee.cookie } });
	expect(await accepted.json()).toEqual({ collectionId: id, role: "editor", ownerId: owner.readerId });
	expect((await request.get(listUrl, { headers: { cookie: invitee.cookie } })).status()).toBe(200);

	// The owner sees them among the collection's people, and they see it among the collections shared with them.
	const ownerData = (await (await request.get("/api/reader", { headers: { cookie: owner.cookie } })).json()) as { collections: { id: string; members: { id: string; role: string }[] }[] };
	expect(ownerData.collections.find((collection) => collection.id === id)?.members).toEqual([expect.objectContaining({ id: invitee.readerId, role: "editor" })]);
	const inviteeData = (await (await request.get("/api/reader", { headers: { cookie: invitee.cookie } })).json()) as { shared: { id: string; access: string }[] };
	expect(inviteeData.shared).toEqual([expect.objectContaining({ id, access: "editor" })]);
});

test("delivers configured contact mail through SMTP only when enabled", async ({
	page,
	request,
}) => {
	await clearMailbox(request);

	if (!expectedEmail) {
		await page.goto("/contact");
		await dismissConsent(page);
		const contactEmail = process.env.PLAYWRIGHT_EXPECTED_CONTACT_EMAIL;
		if (contactEmail) {
			await expect(page.locator("main").getByRole("link", { name: contactEmail, exact: true })).toHaveAttribute("href", `mailto:${contactEmail}`);
		}
		await expect(page.locator("main form")).toHaveCount(0);
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
	const message = await latest.json();
  expect(message).toMatchObject({
    From: {Name: emailSenderName, Address: emailSender},
    To: [{Address: contactRecipient}],
    ReplyTo: [{Address: replyTo}],
    Subject: `${identityShortName} - Feedback`,
    Text: expect.stringContaining(description),
  });
});
