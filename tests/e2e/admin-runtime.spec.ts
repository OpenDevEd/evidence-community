import { expect, test } from "@playwright/test";

import { openAdmin } from "./admin-login";
import { dismissConsent } from "./consent";
import { publishWorkingDraft } from "./admin-review";

const runtimeE2e = process.env.PLAYWRIGHT_RUNTIME_E2E === "true";
const expectedTitle =
	process.env.PLAYWRIGHT_EXPECTED_ADMIN_ITEM_TITLE ??
	"Amber database evidence";
const expectedKey =
	process.env.PLAYWRIGHT_EXPECTED_DATABASE_ITEM_KEY ?? "AMBR2345";

const protectedAdminRequests = [
  ["GET", "/api/admin/reviews"],
  ["GET", "/api/admin/reviews/review-id"],
  ["POST", "/api/admin/reviews/review-id"],
  ["GET", "/api/admin/reviews/review-id/files/ABCDEFGH"],
  ["GET", "/api/admin/items/ABCDEFGH/review"],
  ["POST", "/api/admin/items/ABCDEFGH/review"],
  ["GET", "/api/admin/items/ABCDEFGH/publishing-choice"],
  ["PUT", "/api/admin/items/ABCDEFGH/publishing-choice"],
  ["GET", "/api/admin/items/ABCDEFGH/publication/crossref/reserve"],
  ["POST", "/api/admin/items/ABCDEFGH/publication/crossref/reserve"],
  ["POST", "/api/admin/items/ABCDEFGH/file/removal"],
  ["DELETE", "/api/admin/items/ABCDEFGH/file/removal"],
	["GET", "/api/admin/publication"],
	["POST", "/api/admin/search-index/retry"],
	["POST", "/api/admin/search-index/receipts"],
	["GET", "/api/admin/library"],
	["GET", "/api/admin/library/sources/zotero-main/issues"],
	["PATCH", "/api/admin/library/sources/zotero-main/issues/ABCDEFGH"],
	["GET", "/api/admin/collections"],
	["POST", "/api/admin/collections"],
	["GET", "/api/admin/search-index"],
	["POST", "/api/admin/collections/ABCDEFGH/restore"],
	["PATCH", "/api/admin/collections/ABCDEFGH"],
	["DELETE", "/api/admin/collections/ABCDEFGH"],
	["POST", "/api/admin/collections/ABCDEFGH/move"],
	["POST", "/api/admin/items/drafts"],
	["GET", "/api/admin/items/ABCDEFGH"],
	["POST", "/api/admin/items/batch"],
	["POST", "/api/admin/items/import"],
	["POST", "/api/admin/items/ABCDEFGH/unpublish"],
	["GET", "/api/admin/items/ABCDEFGH/draft"],
	["POST", "/api/admin/items/ABCDEFGH/draft"],
	["PUT", "/api/admin/items/ABCDEFGH/draft"],
	["DELETE", "/api/admin/items/ABCDEFGH/draft"],
	["POST", "/api/admin/items/ABCDEFGH/publication/zenodo/activate"],
	["GET", "/api/admin/items/ABCDEFGH/publication"],
	["POST", "/api/admin/items/ABCDEFGH/publication/crossref/activate"],
	["PUT", "/api/admin/items/ABCDEFGH/writeback/sources"],
	["GET", "/api/admin/items/ABCDEFGH/file"],
	["GET", "/api/admin/items/ABCDEFGH/file/cover?revision=1"],
	["GET", "/api/admin/items/ABCDEFGH/file/cover?revision=1&review=edd606b7-a61f-4c39-a8d6-f2a00381937c"],
	["POST", "/api/admin/items/ABCDEFGH/file"],
	["POST", "/api/admin/items/ABCDEFGH/writeback/resolve"],
	["POST", "/api/admin/items/ABCDEFGH/publication/crossref/retry"],
	["POST", "/api/admin/items/ABCDEFGH/publication/zenodo/retry"],
	["GET", "/api/admin/items/ABCDEFGH/writeback/status"],
	["POST", "/api/admin/items/ABCDEFGH/writeback/retry"],
	["POST", "/api/admin/items/ABCDEFGH/file/complete"],
	["DELETE", "/api/admin/items/ABCDEFGH/file/draft"],
	["GET", "/api/admin/items"],
] as const;

test.skip(!runtimeE2e, "requires the disposable Evidence Library runtime");

test("rejects every protected admin request without a session", async ({
	request,
}) => {
	for (const [method, path] of protectedAdminRequests) {
		await test.step(`${method} ${path}`, async () => {
			const response = await request.fetch(path, {
				failOnStatusCode: false,
				method,
			});
			const message = `${method} ${path}`;

			expect.soft(response.status(), message).toBe(401);
			expect.soft(response.headers()["cache-control"], message).toBe(
				"private, no-store",
			);
			expect.soft(await response.json(), message).toMatchObject({
				error: {
					code: "unauthorized",
				},
			});
		});
	}
});

test("lets an Editor load a record from the real library database", async ({
	page,
}) => {
	await openAdmin(page);
	await page.locator(`[data-record-key="${expectedKey}"]`).click();

	await expect(
		page.getByRole("heading", { name: expectedTitle }),
	).toBeVisible();
	await expect(
		page.getByRole("textbox", { name: "Title", exact: true }),
	).toHaveValue(expectedTitle);
});

test("lets an Editor dismiss and restore a source import issue in the real library database", async ({
	page,
}) => {
	await openAdmin(page);
	const issues = "/api/admin/library/sources/openalex-acceptance/issues";
	const list = async (query = "") =>
		(await page.request.get(`${issues}${query}`)).json();
	const badgeCount = async () => {
		const library = await (await page.request.get("/api/admin/library")).json();
		return library.sources.find(
			(source: { key: string }) => source.key === "openalex-acceptance",
		).sync.issueCount;
	};

	const setDismissed = (dismissed: boolean) =>
		page.request.patch(`${issues}/W100000001`, { data: { dismissed } });

	// The seeded issue points at the record it belongs to and counts on the badge.
	const seeded = await list();
	expect(seeded).toMatchObject({ dismissedTotal: 0, hasMore: false, total: 1 });
	expect(seeded.issues[0]).toMatchObject({
		dismissedAt: null,
		itemKey: expectedKey,
		sourceRecordKey: "W100000001",
		title: expectedTitle,
	});
	expect(await badgeCount()).toBe(1);

	try {
		// Dismissing hides it from the open list and the badge, but keeps it.
		expect((await setDismissed(true)).ok()).toBe(true);
		expect(await list()).toMatchObject({ dismissedTotal: 1, issues: [], total: 0 });
		const dismissedView = await list("?dismissed=1");
		expect(dismissedView.issues[0]).toMatchObject({ sourceRecordKey: "W100000001" });
		expect(dismissedView.issues[0].dismissedAt).not.toBeNull();
		expect(await badgeCount()).toBe(0);
	} finally {
		// Restore even after a failed assertion, so a retry sees the seeded state.
		expect((await setDismissed(false)).ok()).toBe(true);
	}
	expect(await list()).toMatchObject({ dismissedTotal: 0, total: 1 });
	expect(await badgeCount()).toBe(1);

	// A malformed cursor is a validation error, not a crash. The second one is
	// a date JavaScript would silently normalise but PostgreSQL rejects.
	const badDateCursor = Buffer.from(
		JSON.stringify({ sourceRecordKey: "W100000001", updatedAt: "2026-02-30T00:00:00.000Z" }),
	).toString("base64url");
	expect((await page.request.get(`${issues}?cursor=nonsense`)).status()).toBe(400);
	expect((await page.request.get(`${issues}?cursor=${badDateCursor}`)).status()).toBe(400);
	expect(
		(await page.request.patch(`${issues}/NOPE0000`, { data: { dismissed: true } })).status(),
	).toBe(404);
});

test("resolves concurrent draft fields without losing either session's other changes", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await openAdmin(page);
	await expect(page.locator("[data-record-key]").first()).toBeVisible();
	await page.getByRole("button", { name: "Create Item", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Create Item", exact: true })
		.getByRole("button", { name: "Book", exact: true })
		.click();
	const inspector = page.locator("#admin-inspector-pane");
	const title = inspector.getByRole("textbox", { name: "Title", exact: true });
	await expect(title).toHaveValue("", { timeout: 30_000 });
	await title.fill("Shared draft");
	const key = new URL(page.url()).searchParams.get("item");
	if (!key) throw new Error("Created draft has no key");
	const readDraft = async () => {
		const response = await page.request.get(`/api/admin/items/${key}`);
		return (await response.json()).item.draft.payload;
	};
	await expect
		.poll(async () => (await readDraft()).title, { timeout: 30_000 })
		.toBe("Shared draft");
	const second = await page.context().newPage();
	try {
		await second.goto(`/admin?item=${key}`);
		const other = second.locator("#admin-inspector-pane");
		await expect(
			other.getByRole("textbox", { name: "Title", exact: true }),
		).toHaveValue("Shared draft");
		await title.fill("First session title");
		await inspector
			.getByRole("textbox", { name: "Language", exact: true })
			.fill("English");
		await inspector
			.getByRole("textbox", { name: "Publisher", exact: true })
			.fill("First session publisher");
		await expect
			.poll(async () => (await readDraft()).publisher)
			.toBe("First session publisher");
		await other
			.getByRole("textbox", { name: "Title", exact: true })
			.fill("Second session title");
		await other
			.getByRole("textbox", { name: "Language", exact: true })
			.fill("French");
		await other
			.getByRole("textbox", { name: "Place", exact: true })
			.fill("Second session place");
		const comparison = other.getByRole("region", {
			name: "Resolve draft conflicts",
		});
		await expect(comparison).toBeVisible();
		const apply = comparison.getByRole("button", {
			name: "Apply to draft",
			exact: true,
		});
		await expect(apply).toBeDisabled();
		await comparison
			.getByRole("group", { name: "Title", exact: true })
			.getByRole("radio", { name: /Your changes/ })
			.check();
		await expect(apply).toBeDisabled();
		await comparison
			.getByRole("group", { name: "Language", exact: true })
			.getByRole("radio", { name: /Saved in another session/ })
			.check();
		await expect(apply).toBeEnabled();
		// Editing a different field must not discard already-selected choices.
		await other.getByRole("textbox", { name: "Place", exact: true }).fill("Updated second session place");
		await expect(comparison.getByRole("group", { name: "Title", exact: true }).getByRole("radio", { name: /Your changes/ })).toBeChecked();
		await expect(comparison.getByRole("group", { name: "Language", exact: true }).getByRole("radio", { name: /Saved in another session/ })).toBeChecked();
		await expect(apply).toBeEnabled();
		await title.fill("A newer first-session title");
		await expect
			.poll(async () => (await readDraft()).title)
			.toBe("A newer first-session title");
		await apply.click();
		await expect(
			comparison.getByText("A newer first-session title", { exact: true }),
		).toBeVisible();
		await expect(apply).toBeDisabled();
		await comparison
			.getByRole("group", { name: "Title", exact: true })
			.getByRole("radio", { name: /Your changes/ })
			.check();
		await apply.click();
		await expect(comparison).toHaveCount(0);
		await expect(
			other.getByRole("textbox", { name: "Title", exact: true }),
		).not.toHaveAttribute("aria-invalid", "true");
		await expect
			.poll(readDraft)
			.toMatchObject({
				title: "Second session title",
				language: "English",
				publisher: "First session publisher",
				place: "Updated second session place",
			});
		expect((await page.request.get(`/api/item/${key}`)).status()).toBe(404);
	} finally {
		await second.close();
	}
});

test("lets an Editor publish and update a record without stale client navigation", async ({
	page,
	browser,
}, testInfo) => {
	test.setTimeout(120_000);
	const title = `Runtime published book ${testInfo.workerIndex}-${testInfo.retry}-${Date.now()}`;
	await openAdmin(page);
  await page.locator(`[data-record-key="${expectedKey}"]`).click();
  const previousTitle = page.locator("#admin-inspector-pane").getByRole("textbox", {name: "Title", exact: true});
  await expect(previousTitle).toHaveValue(expectedTitle);
  let releaseDetail!: () => void;
  let detailRequested!: () => void;
  const heldDetail = new Promise<void>(resolve => {releaseDetail = resolve;});
  const requestedDetail = new Promise<void>(resolve => {detailRequested = resolve;});
  const detailPath = /\/api\/admin\/items\/[A-Z0-9]{8}$/;
  await page.route(detailPath, async route => {
    if (route.request().url().endsWith(`/${expectedKey}`)) return route.continue();
    detailRequested();
    await heldDetail;
    await route.continue();
  });

	await page.getByRole("button", { name: "Create Item" }).click();
	const newItem = page.getByRole("dialog", { name: "Create Item" });
	await newItem.getByRole("button", { name: "Book", exact: true }).click();
  await requestedDetail;
  try {
    await expect(previousTitle).toHaveCount(0);
  } finally {
    releaseDetail();
    await page.unrouteAll({behavior: "wait"});
  }

	const inspector = page.locator("#admin-inspector-pane");
	const titleInput = inspector.getByRole("textbox", {
		name: "Title",
		exact: true,
	});
	await expect(titleInput).toHaveValue("");
	await titleInput.fill(title);
	const key = await publishWorkingDraft(page);
	await expect(titleInput).toHaveValue(title);
	await expect(
		inspector.getByText("Published", { exact: true }).first(),
	).toBeVisible();

	const published = await page.request.get(`/api/admin/items/${key}`);
	const revision = (await published.json()).item.revision;
	await expect.poll(async () => {
		const response = await page.request.post("/api/admin/search-index/receipts", {
			data: { receipts: [{ entityType: "item", entityKey: key, revision }] },
		});
		return (await response.json()).receipts[0].state;
	}, { timeout: 30_000 }).toBe("indexed");

	const readerContext = await browser.newContext({
		baseURL: testInfo.project.use.baseURL,
		ignoreHTTPSErrors: true,
	});
	try {
		const reader = await readerContext.newPage();
		await reader.goto(`/en-GB/lib?search=${encodeURIComponent(title)}&scope=title`);
		await dismissConsent(reader);
		const recordLink = reader.locator(`a[href*="/lib/${key}"]`).first();
		await expect(recordLink).toBeVisible({ timeout: 30_000 });
		await recordLink.click();
		await expect(reader.getByRole("heading", { name: title, exact: true })).toBeVisible();
		await expect(reader.locator('[data-citation-state="ready"]')).toContainText(title);
		await reader.goBack();
		await expect(recordLink).toBeVisible();

		await inspector.getByRole("button", { name: "Edit", exact: true }).click();
		await titleInput.fill(`${title} revised`);
		await publishWorkingDraft(page);
		await recordLink.click();
		await expect(reader.getByRole("heading", { name: `${title} revised`, exact: true })).toBeVisible();
		await expect(reader.locator('[data-citation-state="ready"]')).toContainText(`${title} revised`);

		await reader.goBack();
		await expect(recordLink).toBeVisible();
		const removed = await page.request.post(`/api/admin/items/${key}/unpublish`, { data: {} });
		expect(removed.ok()).toBe(true);
		await recordLink.click();
		await expect(reader).toHaveURL((url) => url.pathname.endsWith(`/lib/${key}`));
		await expect(reader.getByText("Page Not Found", { exact: true })).toBeVisible();
		await expect(reader.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
		await expect(reader.getByRole("heading", { name: `${title} revised`, exact: true })).toHaveCount(0);
		await expect(reader.locator('meta[name="citation_title"]')).toHaveCount(0);
	} finally {
		await readerContext.close();
	}

});
