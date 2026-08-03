import { expect, test, type Locator, type Page } from "@playwright/test";

const itemKey = "TESTBOOK";
const publishedItemKey = "LIVEBOOK";
const timestamp = "2026-07-31T12:00:00.000Z";
const longCollectionName =
	"A very long collection name that must stay inside the metadata inspector";

const teacherCollection = {
	deleted: false,
	key: "TEACHDEV",
	name: "Teacher development",
	parentCollection: null,
	revision: 1,
	sortOrder: 0,
	sourceConnectionKey: "native",
	updatedAt: timestamp,
};

const longCollection = {
	deleted: false,
	key: "LONGCOLL",
	name: longCollectionName,
	parentCollection: null,
	revision: 1,
	sortOrder: 1,
	sourceConnectionKey: "native",
	updatedAt: timestamp,
};

const publishedPayload = {
	abstractNote: "A published summary",
	collections: [],
	creators: [
		{
			creatorType: "author",
			firstName: "Ada",
			lastName: "Lovelace",
		},
	],
	itemType: "book",
	tags: [],
	title: "Published book",
};

function publishedListRow(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		collections: [],
		creatorNames: ["Ada Lovelace"],
		creators: publishedPayload.creators,
		date: null,
		dateAdded: timestamp,
		fileState: "none",
		itemType: "book",
		key: publishedItemKey,
		pageCount: null,
		revision: 1,
		sourceConnectionKey: "native",
		state: "published",
		tags: [],
		title: publishedPayload.title,
		updatedAt: timestamp,
		year: null,
		...overrides,
	};
}

function publishedDraft(
	payload: Record<string, unknown> = publishedPayload,
	draftRevision = 1,
) {
	return {
		baseRevision: 1,
		createdAt: timestamp,
		draftRevision,
		itemKey: publishedItemKey,
		payload,
		sourceConnectionKey: "native",
		updatedAt: timestamp,
	};
}

function publishedDetail(
	editing: boolean,
	draftPayload: Record<string, unknown> = publishedPayload,
	draftRevision = 1,
) {
	return {
		attachments: [],
		collectionKeys: [],
		creators: publishedPayload.creators,
		date: null,
		draft: editing ? publishedDraft(draftPayload, draftRevision) : null,
		fileDraft: null,
		filePublication: null,
		fileState: "none",
		itemType: "book",
		key: publishedItemKey,
		parentItem: null,
		parentState: null,
		published: publishedPayload,
		publishedCollectionKeys: [],
		publishedTags: [],
		revision: 1,
		sourceConnectionKey: "native",
		sourceFileUrl: null,
		state: editing ? "edited" : "published",
		tags: [],
		title: publishedPayload.title,
		updatedAt: timestamp,
	};
}

async function mockPublishedBook(
	page: Page,
	options: {
		itemCount?: number;
		listRowOverrides?: Partial<Record<string, unknown>>;
	} = {},
) {
	const itemCount = options.itemCount ?? 1;
	let editing = false;
	let draftPayload: Record<string, unknown> =
		structuredClone(publishedPayload);
	let draftRevision = 1;
	await page.route("**/api/admin/**", async (route) => {
		const request = route.request();
		const pathname = new URL(request.url()).pathname;

		if (pathname === "/api/admin/library") {
			await route.fulfill({
				json: {
					collections: [teacherCollection, longCollection],
					sources: [
						{
							key: "native",
							label: "Native",
							provider: "native",
							readOnly: false,
							status: "active",
						},
					],
				},
			});
			return;
		}
		if (pathname === "/api/admin/items" && request.method() === "GET") {
			await route.fulfill({
				json: {
					hasMore: false,
					items: Array.from({ length: itemCount }, (_, index) =>
						publishedListRow({
							...options.listRowOverrides,
							key:
								index === 0
									? publishedItemKey
									: `ROW${String(index).padStart(5, "0")}`,
							state: editing ? "edited" : "published",
							title:
								index === 0
									? publishedPayload.title
									: `Published book ${index + 1}`,
						}),
					),
					nextCursor: null,
				},
			});
			return;
		}
		if (
			pathname === `/api/admin/items/${publishedItemKey}/draft` &&
			request.method() === "POST"
		) {
			editing = true;
			await route.fulfill({
				json: { draft: publishedDraft(draftPayload, draftRevision) },
			});
			return;
		}
		if (
			pathname === `/api/admin/items/${publishedItemKey}/draft` &&
			request.method() === "PUT"
		) {
			const body = request.postDataJSON() as {
				payload: Record<string, unknown>;
			};
			draftPayload = body.payload;
			draftRevision += 1;
			await route.fulfill({
				json: { draft: publishedDraft(draftPayload, draftRevision) },
			});
			return;
		}
		if (pathname === `/api/admin/items/${publishedItemKey}`) {
			await route.fulfill({
				json: {
					item: publishedDetail(editing, draftPayload, draftRevision),
				},
			});
			return;
		}

		await route.fulfill({ status: 404 });
	});
}

async function mockBookWithAttachment(
	page: Page,
	options: { attachmentState?: "draft" | "published" } = {},
) {
	const attachmentKey = "PDFATT01";
	const attachmentState = options.attachmentState ?? "published";
	const attachmentDraft = {
		baseRevision: 0,
		createdAt: timestamp,
		draftRevision: 1,
		itemKey: attachmentKey,
		payload: {
			collections: [],
			creators: [],
			itemType: "Attachment",
			parentItem: publishedItemKey,
			tags: [],
			title: "PDF attachment",
		},
		sourceConnectionKey: "native",
		updatedAt: timestamp,
	};
	const publication = {
		coverPublicUrl: "https://example.test/cover.webp",
		filename: "published.pdf",
		itemKey: attachmentKey,
		pageCount: 12,
		publicUrl: "https://example.test/published.pdf",
		publishedAt: timestamp,
		sha256: "a".repeat(64),
		sizeBytes: 2_097_152,
		uploadRevision: 1,
	};
	const fileDraft = {
		actualSha256: "b".repeat(64),
		actualSizeBytes: 3_145_728,
		coverHeight: 1200,
		coverWidth: 800,
		expectedSha256: "b".repeat(64),
		expectedSizeBytes: 3_145_728,
		filename: "replacement.pdf",
		itemKey: attachmentKey,
		pageCount: 18,
		readyAt: timestamp,
		updatedAt: timestamp,
		uploadRevision: 2,
	};
	const attachmentSummary = {
		creators: [],
		date: null,
		draft: attachmentState === "draft" ? attachmentDraft : null,
		fileDraft,
		filePublication: attachmentState === "draft" ? null : publication,
		fileState: "staged",
		itemType: "Attachment",
		key: attachmentKey,
		parentItem: publishedItemKey,
		revision: 1,
		sourceConnectionKey: "native",
		sourceFileUrl: null,
		state: attachmentState,
		title: "PDF attachment",
		updatedAt: timestamp,
	};
	const parentDetail = {
		...publishedDetail(false),
		attachments: [attachmentSummary],
		fileState: "staged",
	};
	const attachmentDetail = {
		...attachmentSummary,
		attachments: [],
		collectionKeys: [],
		parentState: "published",
		published:
			attachmentState === "draft"
				? null
				: {
						itemType: "Attachment",
						parentItem: publishedItemKey,
						title: "PDF attachment",
					},
		publishedCollectionKeys: [],
		publishedTags: [],
		tags: [],
	};

	await page.route("**/api/admin/**", async (route) => {
		const request = route.request();
		const pathname = new URL(request.url()).pathname;
		if (pathname === "/api/admin/library") {
			await route.fulfill({
				json: {
					collections: [],
					sources: [
						{
							key: "native",
							label: "Native",
							provider: "native",
							readOnly: false,
							status: "active",
						},
					],
				},
			});
			return;
		}
		if (pathname === "/api/admin/items" && request.method() === "GET") {
			await route.fulfill({
				json: {
					hasMore: false,
					items: [publishedListRow({ fileState: "staged" })],
					nextCursor: null,
				},
			});
			return;
		}
		if (pathname === `/api/admin/items/${publishedItemKey}`) {
			await route.fulfill({ json: { item: parentDetail } });
			return;
		}
		if (pathname === `/api/admin/items/${attachmentKey}`) {
			await route.fulfill({ json: { item: attachmentDetail } });
			return;
		}
		await route.fulfill({ status: 404 });
	});
}

async function activatePointerDrag(page: Page, source: Locator) {
	await source.scrollIntoViewIfNeeded();
	const box = await source.boundingBox();
	if (!box) throw new Error("Drag source has no rendered box");
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 10, y + 10, { steps: 5 });
}

async function movePointerTo(page: Page, target: Locator) {
	const box = await target.boundingBox();
	if (!box) throw new Error("Drop target has no rendered box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
		steps: 12,
	});
}

test.skip(
	Boolean(process.env.PLAYWRIGHT_BASE_URL) &&
		process.env.PLAYWRIGHT_ADMIN_UI !== "true",
	"External targets must explicitly confirm that the admin UI is enabled.",
);

test("creates an item through a pointer click in the new-item dialog", async ({
	page,
}) => {
	let submittedPayload: unknown;

	await page.route("**/api/admin/**", async (route) => {
		const request = route.request();
		const pathname = new URL(request.url()).pathname;

		if (pathname === "/api/admin/library") {
			await route.fulfill({
				json: { collections: [], sources: [] },
			});
			return;
		}

		if (pathname === "/api/admin/items" && request.method() === "GET") {
			await route.fulfill({
				json: { hasMore: false, items: [], nextCursor: null },
			});
			return;
		}

		if (
			pathname === "/api/admin/items/drafts" &&
			request.method() === "POST"
		) {
			submittedPayload = request.postDataJSON();
			await route.fulfill({
				json: {
					draft: {
						baseRevision: 0,
						createdAt: timestamp,
						draftRevision: 1,
						itemKey,
						payload: submittedPayload,
						sourceConnectionKey: "native",
						updatedAt: timestamp,
					},
				},
			});
			return;
		}

		if (pathname === `/api/admin/items/${itemKey}`) {
			await route.fulfill({
				json: {
					item: {
						attachments: [],
						collectionKeys: [],
						creators: [],
						date: null,
						draft: {
							baseRevision: 0,
							createdAt: timestamp,
							draftRevision: 1,
							itemKey,
							payload: submittedPayload,
							sourceConnectionKey: "native",
							updatedAt: timestamp,
						},
						fileDraft: null,
						filePublication: null,
						fileState: "none",
						itemType: "book",
						key: itemKey,
						parentItem: null,
						parentState: null,
						published: null,
						publishedCollectionKeys: [],
						publishedTags: [],
						revision: 0,
						sourceConnectionKey: "native",
						sourceFileUrl: null,
						state: "draft",
						tags: [],
						title: "Untitled",
						updatedAt: timestamp,
					},
				},
			});
			return;
		}

		await route.fulfill({ status: 404 });
	});

	await page.goto("/admin");
	await page.getByRole("button", { name: "New item" }).click();

	const dialog = page.getByRole("dialog", { name: "New item" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Book", exact: true }).click();

	await expect(dialog).toBeHidden();
	expect(submittedPayload).toEqual({
		collections: [],
		creators: [],
		itemType: "book",
		tags: [],
	});
});

test("disables every metadata field until editing starts", async ({ page }) => {
	await mockPublishedBook(page);
	await page.goto("/admin");

	const inspector = page.locator("#admin-inspector-pane");
	const title = inspector.getByRole("textbox", {
		name: "Title",
		exact: true,
	});
	const creatorRole = inspector.getByRole("button", {
		name: /Creator 1 role$/,
	});
	const fields = inspector.locator("input:not([type=file]), textarea");

	await expect(title).toHaveValue(publishedPayload.title);
	const fieldCount = await fields.count();
	expect(fieldCount).toBeGreaterThan(20);
	for (let index = 0; index < fieldCount; index += 1) {
		await expect(fields.nth(index)).toBeDisabled();
	}
	await expect(creatorRole).toHaveAttribute("data-disabled", "true");

	await inspector.getByRole("button", { name: "Edit" }).click();
	await expect(title).toBeEnabled();
	const editableFieldCount = await fields.count();
	expect(editableFieldCount).toBeGreaterThanOrEqual(fieldCount);
	for (let index = 0; index < editableFieldCount; index += 1) {
		await expect(fields.nth(index)).toBeEnabled();
	}
	await expect(creatorRole).not.toHaveAttribute("data-disabled", "true");
});

test("shows draft differences with the published value and a revert action", async ({
	page,
}) => {
	await mockPublishedBook(page);
	await page.goto("/admin");

	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", { name: "Edit" }).click();
	const title = inspector.getByRole("textbox", {
		name: "Title",
		exact: true,
	});
	await title.fill("A changed draft title");

	const titleMarker = inspector.getByRole("button", {
		name: "Changed: show published title",
	});
	await expect(titleMarker).toBeVisible();
	const markerGeometry = await titleMarker.evaluate((element) => {
		const fieldRow = element.parentElement!;
		return {
			fieldRowHeight: fieldRow.getBoundingClientRect().height,
			height: element.getBoundingClientRect().height,
			width: element.getBoundingClientRect().width,
		};
	});
	expect(markerGeometry).toEqual({
		fieldRowHeight: 24,
		height: 24,
		width: 24,
	});

	await titleMarker.click();
	await expect(
		page.getByText("Published value", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByText("Published book", { exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(titleMarker).toBeFocused();

	await titleMarker.click();
	await page.getByRole("button", { name: "Revert to published" }).click();
	await expect(title).toHaveValue("Published book");
	await expect(titleMarker).toHaveCount(0);

	const collection = inspector.getByRole("checkbox", {
		name: /Teacher development/,
	});
	const collectionsGroup = inspector.getByRole("group", {
		name: "Collections",
	});
	const longCollection = collectionsGroup.getByText(longCollectionName, {
		exact: true,
	});
	const collectionGeometry = await longCollection.evaluate((element) => {
		const group = element.closest('[role="group"]')!;
		const style = getComputedStyle(element);
		return {
			groupClientWidth: group.clientWidth,
			groupScrollWidth: group.scrollWidth,
			overflow: style.overflow,
			rightInsideGroup:
				element.getBoundingClientRect().right <=
				group.getBoundingClientRect().right,
			textOverflow: style.textOverflow,
		};
	});
	expect(collectionGeometry.groupScrollWidth).toBe(
		collectionGeometry.groupClientWidth,
	);
	expect(collectionGeometry).toMatchObject({
		overflow: "hidden",
		rightInsideGroup: true,
		textOverflow: "ellipsis",
	});
	await collection.click();
	await expect(
		collectionsGroup.getByText(
			"Membership differs from the published value",
			{ exact: true },
		),
	).toHaveCount(1);
	const collectionMarker = inspector.getByRole("button", {
		name: "Changed: show published collections",
	});
	await expect(collectionMarker).toBeVisible();
	await collectionMarker.click();
	await expect(page.getByText("Empty", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Revert to published" }).click();
	await expect(collection).not.toBeChecked();
	await expect(collectionMarker).toHaveCount(0);
});

test("keeps parent attachments compact and moves file controls to the attachment", async ({
	page,
}) => {
	await mockBookWithAttachment(page);
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/admin");

	const inspector = page.locator("#admin-inspector-pane");
	const attachmentRow = inspector.getByRole("button", {
		name: "Open PDF attachment",
	});
	await expect(attachmentRow).toBeVisible();
	await expect(
		inspector.getByText("Upload PDF", { exact: true }),
	).toHaveCount(0);
	await expect(
		inspector.getByRole("button", { name: "Publish PDF", exact: true }),
	).toHaveCount(0);
	await expect(
		inspector.getByRole("button", { name: "Discard staged PDF" }),
	).toHaveCount(0);

	const rowGeometry = await attachmentRow.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			columnGap: Number.parseFloat(style.columnGap),
			height: element.getBoundingClientRect().height,
			paddingLeft: Number.parseFloat(style.paddingLeft),
			paddingRight: Number.parseFloat(style.paddingRight),
		};
	});
	expect(rowGeometry).toEqual({
		columnGap: 10,
		height: 44,
		paddingLeft: 10,
		paddingRight: 10,
	});

	await attachmentRow.click();
	await expect(
		inspector.getByRole("heading", { name: "PDF attachment" }),
	).toBeVisible();
	await expect(
		inspector.getByRole("button", { name: "Parent record" }),
	).toBeVisible();
	await expect(
		inspector.locator('[data-admin-file-row="published"]'),
	).toContainText("published.pdf");
	await expect(
		inspector.locator('[data-admin-file-row="staged"]'),
	).toContainText("replacement.pdf");
	await expect(
		inspector.getByRole("button", { name: "Open PDF" }),
	).toBeVisible();
	await expect(
		inspector.getByRole("button", { name: "Unpublish PDF" }),
	).toBeVisible();
	await expect(
		inspector.getByRole("button", { name: "Publish PDF", exact: true }),
	).toBeVisible();
	await expect(
		inspector.getByRole("button", { name: "Discard staged PDF" }),
	).toBeVisible();
	await expect(
		inspector.getByText("Stage replacement", { exact: true }),
	).toBeVisible();

	const fileRows = inspector.locator("[data-admin-file-row]");
	await expect(fileRows).toHaveCount(2);
	for (let index = 0; index < 2; index += 1) {
		const padding = await fileRows.nth(index).evaluate((element) => {
			const style = getComputedStyle(element);
			return [
				Number.parseFloat(style.paddingTop),
				Number.parseFloat(style.paddingRight),
				Number.parseFloat(style.paddingBottom),
				Number.parseFloat(style.paddingLeft),
			];
		});
		expect(padding).toEqual([12, 12, 12, 12]);
	}
});

test("explains why a staged PDF cannot publish before its metadata", async ({
	page,
}) => {
	await mockBookWithAttachment(page, { attachmentState: "draft" });
	await page.goto("/admin");

	const inspector = page.locator("#admin-inspector-pane");
	await inspector
		.getByRole("button", { name: "Open PDF attachment" })
		.click();
	const publishPdf = inspector.getByRole("button", {
		name: "Publish PDF",
		exact: true,
	});
	await expect(publishPdf).toBeDisabled();
	await publishPdf.locator("..").hover();
	await expect(
		page.getByText("Publish the attachment metadata first", {
			exact: true,
		}),
	).toBeVisible();
});

test("moves a native collection into another collection with pointer drag", async ({
	page,
}) => {
	await mockPublishedBook(page);
	let moveRequest: Record<string, unknown> | null = null;
	await page.route(
		"**/api/admin/collections/TEACHDEV/move",
		async (route) => {
			moveRequest = route.request().postDataJSON() as Record<
				string,
				unknown
			>;
			const moved = {
				...teacherCollection,
				parentCollection: longCollection.key,
				revision: 2,
				sortOrder: 1024,
			};
			await route.fulfill({
				json: { collection: moved, collections: [moved] },
			});
		},
	);
	await page.goto("/admin");

	const handle = page.locator('[data-collection-drag-handle="TEACHDEV"]');
	await activatePointerDrag(page, handle);
	await expect(page.locator('[data-collection-drop="root"]')).toBeVisible();
	const insideTarget = page.locator(
		'[data-collection-drop="inside:LONGCOLL"]',
	);
	await movePointerTo(page, insideTarget);
	await expect(insideTarget).toHaveClass(/bg-accent\/15/u);
	await page.mouse.up();

	await expect
		.poll(() => moveRequest)
		.toEqual({
			beforeCollection: null,
			expectedRevision: 1,
			parentCollection: "LONGCOLL",
		});
	await expect(
		page.locator(
			'#admin-collection-children-LONGCOLL [data-collection-key="TEACHDEV"]',
		),
	).toBeVisible();
	await expect(
		page.locator('[data-collection-drag-handle="TEACHDEV"]'),
	).toBeFocused();
});

test("adds a native record to a collection with pointer drag", async ({
	page,
}) => {
	await mockPublishedBook(page);
	let savedPayload: Record<string, unknown> | null = null;
	page.on("request", (request) => {
		if (
			request.method() === "PUT" &&
			new URL(request.url()).pathname ===
				`/api/admin/items/${publishedItemKey}/draft`
		) {
			savedPayload = (
				request.postDataJSON() as { payload: Record<string, unknown> }
			).payload;
		}
	});
	await page.goto("/admin");
	await expect(
		page.getByRole("heading", { name: "Published book" }),
	).toBeVisible();

	const handle = page.locator(
		`[data-record-drag-handle="${publishedItemKey}"]`,
	);
	await activatePointerDrag(page, handle);
	const target = page.locator(
		`[data-record-collection-drop="${longCollection.key}"]`,
	);
	await expect(target).toBeVisible();
	await movePointerTo(page, target);
	await expect(target).toHaveClass(/bg-accent\/15/u);
	await page.mouse.up();

	await expect
		.poll(() => savedPayload?.collections)
		.toEqual([longCollection.key]);
	await expect(
		page.getByRole("button", {
			name: "Changed: show published collections",
		}),
	).toBeVisible();
	await expect(handle).toBeFocused();
});

test("keeps admin chrome on one computed spacing system", async ({ page }) => {
	await mockPublishedBook(page);
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/admin");
	await expect(
		page.getByRole("heading", { name: "Published book" }),
	).toBeVisible();

	const measurements = await page.evaluate(() => {
		const padding = (element: Element) => {
			const style = getComputedStyle(element);
			return {
				left: Number.parseFloat(style.paddingLeft),
				right: Number.parseFloat(style.paddingRight),
			};
		};
		const toolbar = document.querySelector<HTMLElement>(
			'[data-admin-region="toolbar"]',
		)!;
		const content = document.querySelector<HTMLElement>(
			"#admin-navigation-pane",
		)!.parentElement!;
		const recordRow = document.querySelector<HTMLElement>("tbody tr")!;
		const recordTitle = recordRow.children[1]!.firstElementChild!;
		const tableControls = document.querySelector<HTMLElement>(
			'[aria-label="Table view controls"]',
		)!;
		const tableHeader = document.querySelector<HTMLElement>("thead tr")!;
		const collection = document.querySelector<HTMLElement>(
			'[data-collection-key="TEACHDEV"]',
		)!;
		const newItem = [...document.querySelectorAll("button")].find(
			(button) => button.textContent?.trim() === "New item",
		)!;
		const edit = [...document.querySelectorAll("button")].find(
			(button) => button.textContent?.trim() === "Edit",
		)!;
		const selectedState = [...document.querySelectorAll("button")].find(
			(button) => button.textContent?.trim() === "All records",
		)!;
		const validationProbe = document.createElement("div");
		validationProbe.className = "bg-danger/[0.08]";
		document.body.append(validationProbe);
		const wasDark = document.documentElement.classList.contains("dark");
		document.documentElement.classList.remove("dark");
		const lightSelectedBackground =
			getComputedStyle(selectedState).backgroundColor;
		const validationBackground =
			getComputedStyle(validationProbe).backgroundColor;
		if (wasDark) document.documentElement.classList.add("dark");
		validationProbe.remove();

		return {
			buttonPadding: [padding(newItem), padding(edit)],
			cellDisplay: getComputedStyle(recordRow.children[0]!).display,
			collectionActionCount: collection.querySelectorAll(
				'button[data-collection-drag-handle="TEACHDEV"]',
			).length,
			collectionManageButtonCount: collection.querySelectorAll(
				'button[aria-label="Manage Teacher development"]',
			).length,
			contentTop: content.getBoundingClientRect().top,
			lightSelectedBackground,
			recordGap: Number.parseFloat(getComputedStyle(recordTitle).gap),
			recordHeight: recordRow.getBoundingClientRect().height,
			recordRowDisplay: getComputedStyle(recordRow).display,
			tableControlsHeight: tableControls.getBoundingClientRect().height,
			tableDisplay: getComputedStyle(tableHeader).display,
			tableHeaderHeight: tableHeader.getBoundingClientRect().height,
			toolbarHeight: toolbar.getBoundingClientRect().height,
			validationBackground,
		};
	});

	expect(measurements.toolbarHeight).toBe(56);
	expect(measurements.contentTop).toBe(56);
	expect(measurements.recordHeight).toBe(56);
	expect(measurements.recordGap).toBe(8);
	expect(measurements.tableControlsHeight).toBe(40);
	expect(measurements.tableDisplay).toBe("flex");
	expect(measurements.recordRowDisplay).toBe("flex");
	expect(measurements.cellDisplay).toBe("flex");
	expect(measurements.tableHeaderHeight).toBe(40);
	expect(measurements.buttonPadding).toEqual([
		{ left: 12, right: 12 },
		{ left: 12, right: 12 },
	]);
	expect(measurements.collectionActionCount).toBe(1);
	expect(measurements.collectionManageButtonCount).toBe(1);
	expect(measurements.lightSelectedBackground).not.toBe("rgba(0, 0, 0, 0)");
	expect(measurements.validationBackground).not.toBe("rgba(0, 0, 0, 0)");

	const collection = page.locator('[data-collection-key="TEACHDEV"]');
	await collection.hover();
	await collection
		.getByRole("button", { name: "Manage Teacher development" })
		.click();
	await expect(page.getByRole("menu")).toBeVisible();
	await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
});

test("configures columns, density, sizing, and persists computed table geometry", async ({
	page,
}) => {
	test.setTimeout(60_000);
	await mockPublishedBook(page);
	let listRequestCount = 0;
	let requestedColumns: string[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (url.pathname !== "/api/admin/items") return;
		listRequestCount += 1;
		const encoded = url.searchParams.get("requestedColumns");
		if (encoded) requestedColumns = JSON.parse(encoded) as string[];
	});
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/admin");
	await expect(
		page.getByRole("heading", { name: "Published book" }),
	).toBeVisible();

	await page
		.getByRole("button", { name: "Choose and arrange columns" })
		.click();
	await page
		.getByRole("checkbox", { name: "Show Tags", exact: true })
		.click();
	await expect(page.locator('thead th[data-column-id="tags"]')).toHaveCount(
		1,
	);
	await expect.poll(() => requestedColumns).toContain("tags");
	const requestsAfterVisibilityChange = listRequestCount;

	await page.getByRole("button", { name: "Move Year left" }).click();
	const orderedColumns = await page
		.locator("thead th")
		.evaluateAll((headers) =>
			headers.map((header) => header.getAttribute("data-column-id")),
		);
	expect(orderedColumns.slice(0, 4)).toEqual([
		"select",
		"title",
		"year",
		"creators",
	]);

	await page.mouse.click(280, 72);
	await expect(
		page.getByRole("checkbox", { name: "Show Tags", exact: true }),
	).toBeHidden();
	const titleHeader = page.locator('thead th[data-column-id="title"]');
	const resizeTitle = page.locator(
		'thead button[aria-label="Resize Title column"]',
	);
	const beforeWidth = await titleHeader.evaluate(
		(header) => header.getBoundingClientRect().width,
	);
	const resizeBox = await resizeTitle.boundingBox();
	if (!resizeBox) throw new Error("Title resize handle has no box");
	await page.mouse.move(
		resizeBox.x + resizeBox.width - 2,
		resizeBox.y + resizeBox.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(
		resizeBox.x + 50,
		resizeBox.y + resizeBox.height / 2,
		{
			steps: 5,
		},
	);
	await expect(resizeTitle).toHaveAttribute("data-resizing", "true");
	const resizeGuide = await resizeTitle.evaluate((handle) => {
		const style = getComputedStyle(handle, "::after");
		return {
			background: style.backgroundColor,
			opacity: Number.parseFloat(style.opacity),
		};
	});
	expect(resizeGuide.background).not.toBe("rgba(0, 0, 0, 0)");
	expect(resizeGuide.opacity).toBe(1);
	await page.mouse.up();
	const resizedWidth = await titleHeader.evaluate(
		(header) => header.getBoundingClientRect().width,
	);
	const storedAfterResize = await page.evaluate(() =>
		window.localStorage.getItem(
			"openscholar.admin.item-table.preferences.v1",
		),
	);
	expect(
		resizedWidth,
		`Persisted table preferences: ${storedAfterResize}`,
	).toBeGreaterThan(beforeWidth + 35);

	await page.getByRole("button", { name: "Change row density" }).click();
	await page.getByRole("button", { name: "compact" }).click();
	const compactGeometry = await page.evaluate(() => {
		const scroll = document.querySelector<HTMLElement>(
			"[data-admin-item-table-scroll]",
		)!;
		const row = document.querySelector<HTMLElement>("tbody tr")!;
		const cells = [...row.children] as HTMLElement[];
		return {
			cellHeights: cells.map(
				(cell) => cell.getBoundingClientRect().height,
			),
			documentOverflow:
				document.documentElement.scrollWidth - window.innerWidth,
			rowHeight: row.getBoundingClientRect().height,
			scrollHasHorizontalOverflow:
				scroll.scrollWidth > scroll.clientWidth,
		};
	});
	expect(compactGeometry.rowHeight).toBe(44);
	expect(new Set(compactGeometry.cellHeights)).toEqual(new Set([44]));
	expect(compactGeometry.documentOverflow).toBe(0);
	expect(compactGeometry.scrollHasHorizontalOverflow).toBe(true);
	await page.waitForTimeout(350);
	expect(listRequestCount).toBe(requestsAfterVisibilityChange);

	await page.reload();
	await expect(
		page.getByRole("heading", { name: "Published book" }),
	).toBeVisible();
	await expect(page.locator('thead th[data-column-id="tags"]')).toHaveCount(
		1,
	);
	expect(
		await page
			.locator("tbody tr")
			.first()
			.evaluate((row) => row.getBoundingClientRect().height),
	).toBe(44);
	expect(
		await page
			.locator('thead th[data-column-id="title"]')
			.evaluate((header) => header.getBoundingClientRect().width),
	).toBeGreaterThan(beforeWidth + 35);
});

test("virtualizes large record sets while keeping rows horizontal and key columns pinned", async ({
	page,
}) => {
	await mockPublishedBook(page, { itemCount: 500 });
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/admin");
	await expect(
		page.getByRole("heading", { name: "Published book" }),
	).toBeVisible();

	const scroll = page.locator("[data-admin-item-table-scroll]");
	const table = page.getByRole("grid", { name: "Library records" });
	await expect(table).toHaveAttribute("aria-multiselectable", "true");
	await expect(table).toHaveAttribute("aria-rowcount", "501");
	await expect(table.getByRole("rowgroup")).toHaveCount(2);
	await expect(table.getByRole("columnheader").first()).toHaveAttribute(
		"aria-colindex",
		"1",
	);
	const initialRows = page.locator("tbody tr[data-record-key]");
	await expect.poll(() => initialRows.count()).toBeGreaterThan(0);
	expect(await initialRows.count()).toBeLessThanOrEqual(30);
	expect(await page.locator('tr[data-record-key="ROW00499"]').count()).toBe(
		0,
	);

	await scroll.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
		element.dispatchEvent(new Event("scroll"));
	});
	await expect(page.locator('tr[data-record-key="ROW00499"]')).toBeVisible();
	expect(await initialRows.count()).toBeLessThanOrEqual(25);
	expect(await page.locator('tr[data-record-key="LIVEBOOK"]').count()).toBe(
		0,
	);

	await scroll.evaluate((element) => {
		element.scrollLeft = 260;
		element.dispatchEvent(new Event("scroll"));
	});
	const geometry = await page.evaluate(() => {
		const scrollElement = document.querySelector<HTMLElement>(
			"[data-admin-item-table-scroll]",
		)!;
		const header = document.querySelector<HTMLElement>("thead")!;
		const row = document.querySelector<HTMLElement>(
			"tbody tr[data-record-key]",
		)!;
		const selectCell = row.querySelector<HTMLElement>(
			'td[data-column-id="select"]',
		)!;
		const titleCell = row.querySelector<HTMLElement>(
			'td[data-column-id="title"]',
		)!;
		const scrollRect = scrollElement.getBoundingClientRect();
		return {
			bodyHeight: document.querySelector("tbody")!.getBoundingClientRect()
				.height,
			cellDisplay: getComputedStyle(selectCell).display,
			documentOverflow: document.documentElement.scrollWidth - innerWidth,
			headerDisplay: getComputedStyle(header).display,
			headerTop: header.getBoundingClientRect().top,
			rowDisplay: getComputedStyle(row).display,
			rowHeight: row.getBoundingClientRect().height,
			scrollLeft: scrollElement.scrollLeft,
			scrollLeftEdge: scrollRect.left,
			scrollTop: scrollElement.scrollTop,
			scrollTopEdge: scrollRect.top,
			selectLeft: selectCell.getBoundingClientRect().left,
			titleBackground: getComputedStyle(titleCell).backgroundColor,
			titleLeft: titleCell.getBoundingClientRect().left,
		};
	});

	expect(geometry.bodyHeight).toBe(28_000);
	expect(geometry.rowHeight).toBe(56);
	expect(geometry.headerDisplay).toBe("grid");
	expect(geometry.rowDisplay).toBe("flex");
	expect(geometry.cellDisplay).toBe("flex");
	expect(geometry.scrollTop).toBeGreaterThan(20_000);
	expect(geometry.scrollLeft).toBeGreaterThan(0);
	expect(geometry.headerTop).toBeCloseTo(geometry.scrollTopEdge, 0);
	expect(geometry.selectLeft).toBeCloseTo(geometry.scrollLeftEdge, 0);
	expect(geometry.titleLeft).toBeCloseTo(geometry.scrollLeftEdge + 44, 0);
	expect(geometry.titleBackground).not.toBe("rgba(0, 0, 0, 0)");
	expect(geometry.documentOverflow).toBe(0);
});

test("keeps the record grid usable in the narrow list pane", async ({
	page,
}) => {
	await mockPublishedBook(page);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/admin");
	await expect(page.locator('tr[data-record-key="LIVEBOOK"]')).toBeVisible();
	const scroll = page.locator("[data-admin-item-table-scroll]");
	await scroll.evaluate((element) => {
		element.scrollLeft = 300;
		element.dispatchEvent(new Event("scroll"));
	});
	const geometry = await page.evaluate(() => {
		const scrollElement = document.querySelector<HTMLElement>(
			"[data-admin-item-table-scroll]",
		)!;
		const row = document.querySelector<HTMLElement>(
			'tr[data-record-key="LIVEBOOK"]',
		)!;
		const selectCell = row.querySelector<HTMLElement>(
			'td[data-column-id="select"]',
		)!;
		const titleCell = row.querySelector<HTMLElement>(
			'td[data-column-id="title"]',
		)!;
		const scrollRect = scrollElement.getBoundingClientRect();
		return {
			documentOverflow: document.documentElement.scrollWidth - innerWidth,
			rowDisplay: getComputedStyle(row).display,
			scrollClientWidth: scrollElement.clientWidth,
			scrollLeft: scrollElement.scrollLeft,
			scrollWidth: scrollElement.scrollWidth,
			selectLeft: selectCell.getBoundingClientRect().left,
			titleBackground: getComputedStyle(titleCell).backgroundColor,
			titleLeft: titleCell.getBoundingClientRect().left,
			titleOverlay: getComputedStyle(titleCell, "::before")
				.backgroundColor,
			viewportLeft: scrollRect.left,
		};
	});

	expect(geometry.documentOverflow).toBe(0);
	expect(geometry.rowDisplay).toBe("flex");
	expect(geometry.scrollClientWidth).toBeLessThan(390);
	expect(geometry.scrollWidth).toBeGreaterThan(geometry.scrollClientWidth);
	expect(geometry.scrollLeft).toBeGreaterThan(0);
	expect(geometry.selectLeft).toBeCloseTo(geometry.viewportLeft, 0);
	expect(geometry.titleLeft).toBeCloseTo(geometry.viewportLeft + 44, 0);
	expect(geometry.titleBackground).not.toBe("rgba(0, 0, 0, 0)");
	expect(geometry.titleOverlay).not.toBe("rgba(0, 0, 0, 0)");
});

test("keeps the empty state visible in a narrow scrolled grid", async ({
	page,
}) => {
	await mockPublishedBook(page, { itemCount: 0 });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/admin");
	const emptyState = page.getByRole("gridcell", {
		name: "No records match these filters.",
	});
	await expect(emptyState).toBeVisible();

	const scroll = page.locator("[data-admin-item-table-scroll]");
	await scroll.evaluate((element) => {
		element.scrollLeft = 300;
		element.dispatchEvent(new Event("scroll"));
	});
	const geometry = await emptyState.evaluate((cell) => {
		const scrollElement = cell.closest<HTMLElement>(
			"[data-admin-item-table-scroll]",
		)!;
		const cellRect = cell.getBoundingClientRect();
		const scrollRect = scrollElement.getBoundingClientRect();
		return {
			cellLeft: cellRect.left,
			cellRight: cellRect.right,
			cellWidth: cellRect.width,
			containerType: getComputedStyle(scrollElement).containerType,
			scrollClientWidth: scrollElement.clientWidth,
			scrollLeft: scrollElement.scrollLeft,
			scrollLeftEdge: scrollRect.left,
			scrollRightEdge: scrollRect.right,
		};
	});

	expect(geometry.containerType).toBe("inline-size");
	expect(geometry.scrollLeft).toBeGreaterThan(0);
	expect(geometry.cellLeft).toBeCloseTo(geometry.scrollLeftEdge, 0);
	expect(geometry.cellRight).toBeLessThanOrEqual(
		geometry.scrollRightEdge + 1,
	);
	expect(geometry.cellWidth).toBeCloseTo(geometry.scrollClientWidth, 0);
});

test("renders field types with semantic cells instead of plain text", async ({
	page,
}) => {
	await mockPublishedBook(page, {
		listRowOverrides: {
			collections: [teacherCollection.key, longCollection.key],
			dateAdded: timestamp,
			pageCount: 146,
			revision: 27,
			tags: ["equity", "teacher training", "rural schools"],
			year: 2024,
		},
	});
	await page.goto("/admin");
	await expect(
		page.getByRole("heading", { name: "Published book" }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Choose and arrange columns" })
		.click();
	for (const label of [
		"Source",
		"Collections",
		"Tags",
		"Date added",
		"Revision",
		"PDF pages",
	]) {
		await page
			.getByRole("checkbox", { name: `Show ${label}`, exact: true })
			.click();
	}
	await page.mouse.click(280, 72);

	const row = page.locator('tr[data-record-key="LIVEBOOK"]');
	const creators = row.locator('td[data-column-id="creators"]');
	const collections = row.locator('td[data-column-id="collections"]');
	const tags = row.locator('td[data-column-id="tags"]');
	const source = row.locator('td[data-column-id="source"]');
	const dateAdded = row.locator('td[data-column-id="dateAdded"]');
	const year = row.locator('td[data-column-id="year"]');
	const revision = row.locator('td[data-column-id="revision"]');
	const pageCount = row.locator('td[data-column-id="pageCount"]');

	await expect(creators).toContainText("Ada Lovelace");
	await expect(creators.locator("svg")).toHaveCount(1);
	await expect(collections).toContainText("Teacher development");
	await expect(collections).toContainText(longCollectionName);
	await expect(collections).not.toContainText(teacherCollection.key);
	await expect(tags).toContainText("equity");
	await expect(tags).toContainText("teacher training");
	await expect(tags).toContainText("+1");
	await expect(tags.locator("div")).toHaveAttribute(
		"title",
		"equity, teacher training, rural schools",
	);
	await expect(source).toContainText("Native");
	await expect(source.locator("svg")).toHaveCount(1);
	await expect(dateAdded).toContainText("Jul 31, 2026");
	await expect(dateAdded.locator("svg")).toHaveCount(1);
	await expect(year).toHaveText("2024");
	await expect(revision).toHaveText("27");
	await expect(pageCount).toHaveText("146");

	for (const cell of [year, revision, pageCount]) {
		expect(
			await cell
				.locator("span")
				.evaluate(
					(element) => getComputedStyle(element).fontVariantNumeric,
				),
		).toContain("tabular-nums");
	}
});

test("renders selected checkboxes with an accent fill and visible checkmark", async ({
	page,
}) => {
	await mockPublishedBook(page);
	await page.goto("/admin");
	await expect(
		page.getByRole("heading", { name: "Published book" }),
	).toBeVisible();
	const checkbox = page.getByRole("checkbox", {
		name: "Select Published book",
	});
	await checkbox.click();
	await expect(checkbox).toBeChecked();

	const computed = await checkbox.evaluate((input) => {
		const base = input.closest("label")!;
		const wrapper = base.querySelector<HTMLElement>("span")!;
		const icon = wrapper.querySelector<SVGElement>("svg")!;
		const check = icon.querySelector<SVGElement>("path, polyline, line")!;
		const inputBounds = input.getBoundingClientRect();
		const inputStyle = getComputedStyle(input);
		const wrapperStyle = getComputedStyle(wrapper);
		const animatedFill = getComputedStyle(wrapper, "::after");
		const iconStyle = getComputedStyle(icon);
		const checkStyle = getComputedStyle(check);
		const checkBounds = check.getBoundingClientRect();
		return {
			animatedFill: animatedFill.backgroundColor,
			background: wrapperStyle.backgroundColor,
			checkStroke: checkStyle.stroke,
			checkHeight: checkBounds.height,
			checkWidth: checkBounds.width,
			height: wrapper.getBoundingClientRect().height,
			iconColor: iconStyle.color,
			iconOpacity: Number.parseFloat(iconStyle.opacity),
			inputAppearance: inputStyle.appearance,
			inputHeight: inputBounds.height,
			inputOpacity: inputStyle.opacity,
			inputWidth: inputBounds.width,
			selected: base.getAttribute("data-selected"),
			width: wrapper.getBoundingClientRect().width,
			wrapperColor: wrapperStyle.color,
		};
	});

	expect(computed.selected).toBe("true");
	expect(computed.background).not.toBe("rgba(0, 0, 0, 0)");
	expect(computed.background).not.toBe("rgb(255, 255, 255)");
	expect(computed.animatedFill).toBe("rgba(0, 0, 0, 0)");
	expect(computed.iconOpacity).toBe(1);
	expect(computed.iconColor).toBe("rgb(255, 255, 255)");
	expect(computed.checkStroke).toBe("rgb(255, 255, 255)");
	expect(computed.checkWidth).toBeGreaterThanOrEqual(7);
	expect(computed.checkHeight).toBeGreaterThanOrEqual(4);
	expect(computed.inputWidth).toBeGreaterThanOrEqual(16);
	expect(computed.inputHeight).toBeGreaterThanOrEqual(16);
	expect(computed.inputOpacity).toBe("0");
	expect(computed.inputAppearance).toBe("none");
	expect(computed.wrapperColor).toBe("rgb(255, 255, 255)");
	expect(computed.width).toBe(16);
	expect(computed.height).toBe(16);
});

test("renders one dark row separator instead of cell borders", async ({
	page,
}) => {
	await mockPublishedBook(page);
	await page.goto("/admin");
	await expect(
		page.getByRole("heading", { name: "Published book" }),
	).toBeVisible();

	const computed = await page
		.locator('tr[data-record-key="LIVEBOOK"]')
		.evaluate((row) => {
			const cell = row.querySelector("td")!;
			const cellStyle = getComputedStyle(cell);
			const separatorStyle = getComputedStyle(row, "::after");
			return {
				cellBorderBottomWidth: cellStyle.borderBottomWidth,
				separatorBackground: separatorStyle.backgroundColor,
				separatorContent: separatorStyle.content,
				separatorHeight: separatorStyle.height,
			};
		});

	expect(computed.cellBorderBottomWidth).toBe("0px");
	expect(computed.separatorContent).toBe('""');
	expect(computed.separatorHeight).toBe("1px");
	expect(computed.separatorBackground).not.toBe("rgba(0, 0, 0, 0)");
	expect(computed.separatorBackground).not.toBe("rgb(255, 255, 255)");
});

test("keeps button loading spinners on the icon geometry", async ({ page }) => {
	await mockPublishedBook(page);
	let finishRequest: (() => void) | undefined;
	await page.route("**/api/admin/collections", async (route) => {
		if (route.request().method() !== "POST") {
			await route.fallback();
			return;
		}
		await new Promise<void>((resolve) => {
			finishRequest = resolve;
		});
		await route.fulfill({
			json: {
				collection: {
					deleted: false,
					key: "NEWCOLL",
					name: "New collection",
					parentCollection: null,
					revision: 1,
					sortOrder: 1,
					sourceConnectionKey: "native",
					updatedAt: timestamp,
				},
			},
		});
	});

	await page.goto("/admin");
	await page.getByRole("button", { name: "New", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "New collection" });
	await dialog.getByRole("textbox", { name: "Name" }).fill("New collection");
	const create = dialog.getByRole("button", { name: "Create" });
	const before = await create.evaluate((button) => {
		const htmlButton = button as HTMLButtonElement;
		const icon = button.querySelector<SVGSVGElement>(":scope > svg")!;
		return {
			iconHeight: icon.height.baseVal.value,
			iconWidth: icon.width.baseVal.value,
			width: htmlButton.offsetWidth,
		};
	});

	await create.click();
	await expect(create).toHaveAttribute("data-loading", "true");
	const loading = await create.evaluate((button) => {
		const htmlButton = button as HTMLButtonElement;
		const icon = button.querySelector<SVGElement>(":scope > svg")!;
		const spinner =
			button.querySelector<HTMLElement>(":scope > div > div")!;
		return {
			iconDisplay: getComputedStyle(icon).display,
			spinnerHeight: spinner.offsetHeight,
			spinnerWidth: spinner.offsetWidth,
			width: htmlButton.offsetWidth,
		};
	});

	expect(loading.spinnerWidth).toBeCloseTo(before.iconWidth, 0);
	expect(loading.spinnerHeight).toBeCloseTo(before.iconHeight, 0);
	expect(loading.iconDisplay).toBe("none");
	expect(loading.width).toBe(before.width);

	if (!finishRequest) throw new Error("Collection request did not start");
	finishRequest();
	await expect(dialog).toBeHidden();
});
