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
	["PATCH", "/api/admin/library/sources/zotero-main/issues"],
	["GET", "/api/admin/library/sources/zotero-main/issues/fields?offset=0&limit=10"],
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
	["DELETE", "/api/admin/public-cache"],
] as const;

test.skip(!runtimeE2e, "requires the disposable Evidence Library runtime");

test("rejects every protected admin request without a session", { tag: "@smoke" }, async ({
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
	await page.getByRole("textbox", { name: "Search records" }).fill(expectedTitle);
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
	const types = async () => (await (await page.request.get(issues)).json()).types;
	const badgeCount = async () => {
		const library = await (await page.request.get("/api/admin/library")).json();
		const { activity } = library.sources.find(
			(source: { key: string }) => source.key === "openalex-acceptance",
		);
		return Object.values(activity.issues as Record<string, number>).reduce((sum, count) => sum + count, 0);
	};

	// The seeded issue is a left-out field, points at the record it belongs to, and counts on the badge.
	expect(await types()).toMatchObject([{ count: 1, key: "fields" }]);
	const page1 = await (await page.request.get(`${issues}/fields?offset=0&limit=10`)).json();
	expect(page1).toMatchObject({
		count: 1,
		issues: [{ itemKey: expectedKey, sourceRecordKey: "W100000001", title: expectedTitle }],
	});
	expect(await badgeCount()).toBe(1);

	const dismissed = await page.request.patch(issues, { data: { action: "dismiss", record: "W100000001" } });
	expect(dismissed.ok()).toBe(true);
	const { batch, count } = await dismissed.json();
	try {
		// Dismissing hides it from the list and the badge, but keeps it for undo.
		expect(count).toBe(1);
		expect(await types()).toEqual([]);
		expect(await badgeCount()).toBe(0);
	} finally {
		// Restore even after a failed assertion, so a retry sees the seeded state.
		expect((await page.request.patch(issues, { data: { action: "restore", batch } })).ok()).toBe(true);
	}
	expect(await types()).toMatchObject([{ count: 1, key: "fields" }]);
	expect(await badgeCount()).toBe(1);

	// Malformed requests are validation errors, not crashes.
	expect((await page.request.get(`${issues}/nonsense?offset=0&limit=10`)).status()).toBe(400);
	expect((await page.request.get(`${issues}/fields?offset=-1&limit=10`)).status()).toBe(400);
	expect((await page.request.patch(issues, { data: { action: "restore", batch: "yesterday" } })).status()).toBe(400);
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
		// The second session may notice the newer save on its own before Apply.
		await expect(async () => {
			if (await apply.isEnabled()) await apply.click({ timeout: 1_000 });
			await expect(
				comparison.getByText("A newer first-session title", { exact: true }),
			).toBeVisible({ timeout: 1_000 });
		}).toPass({ timeout: 30_000 });
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

test("lets an Editor publish and update a record without stale client navigation", { tag: "@smoke" }, async ({
	page,
	browser,
}, testInfo) => {
	test.setTimeout(120_000);
	const title = `Runtime published book ${testInfo.workerIndex}-${testInfo.retry}-${Date.now()}`;
	await openAdmin(page);
  await page.getByRole("textbox", { name: "Search records" }).fill(expectedTitle);
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
		await expect(reader.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
		await expect(reader.getByRole("heading", { name: `${title} revised`, exact: true })).toHaveCount(0);
		await expect(reader.locator('meta[name="citation_title"]')).toHaveCount(0);
	} finally {
		await readerContext.close();
	}

});

test("keeps typing and field patches intact while an autosave is in flight", async ({ page }) => {
	test.setTimeout(90_000);
	await openAdmin(page);
	await page.getByRole("button", { name: "Create Item", exact: true }).click();
	await page.getByRole("dialog", { name: "Create Item", exact: true }).getByRole("button", { name: "Book", exact: true }).click();
	const inspector = page.locator("#admin-inspector-pane");
	const title = inspector.getByRole("textbox", { name: "Title", exact: true });
	await expect(title).toHaveValue("");
	await title.fill("Typing persistence check");
	const key = new URL(page.url()).searchParams.get("item");
	if (!key) throw new Error("Created draft has no key");
	const readDraft = async () => (await (await page.request.get(`/api/admin/items/${key}`)).json()).item.draft.payload;
	await expect.poll(async () => (await readDraft()).title).toBe("Typing persistence check");
	let release!: () => void;
	let requested!: () => void;
	const held = new Promise<void>(resolve => { release = resolve; });
	const saving = new Promise<void>(resolve => { requested = resolve; });
	let requests = 0;
	await page.route(`**/api/admin/items/${key}/draft`, async route => {
		if (route.request().method() === "PUT" && ++requests === 1) {
			requested();
			await held;
		}
		await route.continue();
	});
	const abstract = inspector.getByRole("textbox", { name: "Abstract Note", exact: true });
	try {
		await abstract.pressSequentially("Evidence from Kenya", { delay: 20 });
		await saving;
		await abstract.pressSequentially(" and Ghana.", { delay: 20 });
		await expect(abstract).toBeFocused();
		await expect(abstract).toHaveValue("Evidence from Kenya and Ghana.");
		await expect.poll(() => abstract.evaluate((node: HTMLTextAreaElement) => node.selectionStart)).toBe("Evidence from Kenya and Ghana.".length);
		await inspector.getByRole("textbox", { name: "Language", exact: true }).fill("English");
		release();
		await expect.poll(readDraft).toMatchObject({ title: "Typing persistence check", abstractNote: "Evidence from Kenya and Ghana.", language: "English" });
		await page.reload();
		await expect(abstract).toHaveValue("Evidence from Kenya and Ghana.");
		await expect(inspector.getByRole("textbox", { name: "Language", exact: true })).toHaveValue("English");
	} finally {
		release();
		await page.unrouteAll({ behavior: "wait" });
	}
});

test("updates the open draft preview in place after a save", async ({ page }) => {
	test.setTimeout(90_000);
	await openAdmin(page);
	await page.getByRole("button", { name: "Create Item", exact: true }).click();
	await page.getByRole("dialog", { name: "Create Item", exact: true }).getByRole("button", { name: "Book", exact: true }).click();
	const inspector = page.locator("#admin-inspector-pane");
	const title = inspector.getByRole("textbox", { name: "Title", exact: true });
	await expect(title).toHaveValue("");
	await title.fill("Preview in place check");
	await inspector.getByRole("textbox", { name: "Abstract Note", exact: true }).fill("Evidence from classroom observations. ".repeat(200));
	await inspector.getByRole("button", { name: "Preview", exact: true }).click();
	const preview = page.getByTitle("Preview of the working draft").contentFrame();
	await expect(preview.getByRole("heading", { level: 1, name: "Preview in place check" })).toBeVisible();
	const frame = page.frame({ url: /\/admin\/preview\// });
	if (!frame) throw new Error("Preview frame is missing");
	// A reload would drop this mark and reset the scroll.
	await frame.evaluate(() => {
		window.scrollTo(0, 300);
		Object.assign(window, { previewDocument: "first" });
	});
	await title.fill("Preview in place check, edited");
	await expect(preview.getByRole("heading", { level: 1, name: "Preview in place check, edited" })).toBeVisible();
	expect(await frame.evaluate(() => ({ document: (window as { previewDocument?: string }).previewDocument, scrollY: window.scrollY }))).toEqual({ document: "first", scrollY: 300 });
});

test("saves library display switches as tags and keeps the published preview unchanged until publication", async ({ page }) => {
	test.setTimeout(120_000);
	await openAdmin(page);
	await page.getByRole("button", { name: "Create Item", exact: true }).click();
	await page.getByRole("dialog", { name: "Create Item", exact: true }).getByRole("button", { name: "Book", exact: true }).click();
	const inspector = page.locator("#admin-inspector-pane");
	const title = inspector.getByRole("textbox", { name: "Title", exact: true });
	await expect(title).toHaveValue("");
	await title.fill("Display controls check");
	const key = await publishWorkingDraft(page);
	await inspector.getByRole("button", { name: "Edit", exact: true }).click();
	await expect(title).toBeEditable();
	const menu = inspector.getByRole("button", { name: "Record status and sources" });
	await menu.click();
	const display = page.getByRole("region", { name: "Library display", exact: true });
	const trigger = display.getByRole("button", { name: /^Library display/ });
	await expect(trigger).toHaveAttribute("aria-expanded", "false");
	await expect(page.getByRole("region", { name: "Connected sources" }).getByRole("button", { name: /^Sources/ })).toHaveAttribute("aria-expanded", "false");
	await trigger.click();
	for (const name of ["Hide from library", "Available on request", "Coming soon"]) {
		await display.getByRole("switch", { name, exact: true }).check();
	}
	await expect.poll(async () => (await (await page.request.get(`/api/admin/items/${key}`)).json()).item.draft.payload.tags).toEqual(expect.arrayContaining(["hidden-record", "internal-only", "coming-soon"]));
	await display.getByRole("button", { name: /^Preview published revision/ }).click();
	for (const name of ["Hide from library", "Available on request", "Coming soon"]) {
		await expect(display.getByRole("switch", { name, exact: true })).toBeChecked();
	}
	await expect(display.getByRole("region", { name: "Reader preview" }).getByText("Available on request", { exact: true })).toHaveCount(0);
	await expect(display.getByRole("region", { name: "Reader preview" }).getByText("Coming soon", { exact: true })).toHaveCount(0);
	const record = (await (await page.request.get(`/api/admin/items/${key}`)).json()).item;
	expect(record.publishedTags).not.toEqual(expect.arrayContaining(["hidden-record", "internal-only", "coming-soon"]));
	await page.keyboard.press("Escape");
	await page.reload();
	await menu.click();
	await trigger.click();
	for (const name of ["Hide from library", "Available on request", "Coming soon"]) {
		await expect(display.getByRole("switch", { name, exact: true })).toBeChecked();
		await display.getByRole("switch", { name, exact: true }).uncheck();
	}
	await expect.poll(async () => (await (await page.request.get(`/api/admin/items/${key}`)).json()).item.draft.payload.tags).toEqual(record.publishedTags);
});
