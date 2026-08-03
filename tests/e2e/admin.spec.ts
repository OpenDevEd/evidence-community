import { expect, test, type Locator, type Page } from "@playwright/test";

import type {
	AdminCollectionCatalogEntry,
	AdminSource,
} from "@/lib/admin/types";

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

const collectionCatalogEntries = [teacherCollection, longCollection].map(
	(collection) => ({
		...collection,
		ancestors: [],
		hasChildren: false,
	}),
);

const importedCollection: AdminCollectionCatalogEntry = {
	ancestors: [],
	deleted: false,
	hasChildren: false,
	key: "IMPORT01",
	name: "Imported research",
	parentCollection: null,
	revision: 1,
	sortOrder: null,
	sourceConnectionKey: "zotero-group",
	updatedAt: timestamp,
};

const deletedCollection: AdminCollectionCatalogEntry = {
	ancestors: [],
	deleted: true,
	hasChildren: false,
	key: "DELETED1",
	name: "Deleted archive",
	parentCollection: null,
	revision: 2,
	sortOrder: 2,
	sourceConnectionKey: "native",
	updatedAt: timestamp,
};

const importedSource: AdminSource = {
	key: "zotero-group",
	label: "Zotero group",
	provider: "zotero",
	readOnly: true,
	status: "active",
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
		additionalCollectionEntries?: AdminCollectionCatalogEntry[];
		additionalSources?: AdminSource[];
		batchResults?: (body: {
			action: string;
			collectionKey?: string;
			keys: string[];
		}) => unknown[];
		beforeBatchResponse?: () => Promise<void>;
		failDraftSave?: boolean;
		itemCount?: number;
		initialCollectionKeys?: string[];
		listFailure?: boolean;
		listFailureCount?: number;
		listRowOverrides?: Partial<Record<string, unknown>>;
		onBatchRequest?: (body: {
			action: string;
			collectionKey?: string;
			keys: string[];
		}) => void;
		onDraftSave?: (payload: Record<string, unknown>) => void;
		onListRequest?: (url: URL) => void;
	} = {},
) {
	const catalogEntries = [
		...collectionCatalogEntries,
		...(options.additionalCollectionEntries ?? []),
	];
	const itemCount = options.itemCount ?? 1;
	let remainingListFailures = options.listFailure
		? Number.POSITIVE_INFINITY
		: (options.listFailureCount ?? 0);
	let editing = false;
	let draftPayload: Record<string, unknown> = {
		...structuredClone(publishedPayload),
		collections: [...(options.initialCollectionKeys ?? [])],
	};
	let draftRevision = 1;
	await page.route("**/api/admin/**", async (route) => {
		const request = route.request();
		const requestUrl = new URL(request.url());
		const pathname = requestUrl.pathname;

		if (
			pathname === "/api/admin/collections" &&
			request.method() === "GET"
		) {
			const view = requestUrl.searchParams.get("view") ?? "children";
			if (view === "resolve") {
				const keys = requestUrl.searchParams.getAll("key");
				await route.fulfill({
					json: {
						items: keys.flatMap((key) => {
							const entry = catalogEntries.find(
								(collection) => collection.key === key,
							);
							return entry ? [entry] : [];
						}),
					},
				});
				return;
			}
			const query = (requestUrl.searchParams.get("query") ?? "")
				.trim()
				.toLowerCase();
			const parent = requestUrl.searchParams.get("parent");
			const source = requestUrl.searchParams.get("source");
			await route.fulfill({
				json: {
					hasMore: false,
					items: catalogEntries.filter(
						(entry) =>
							!entry.deleted &&
							(view === "search"
								? entry.name.toLowerCase().includes(query)
								: entry.parentCollection ===
									(!parent || parent === "root"
										? null
										: parent)) &&
							(!source || entry.sourceConnectionKey === source),
					),
					nextCursor: null,
				},
			});
			return;
		}

		if (pathname === "/api/admin/library") {
			const collections = catalogEntries.map(
				({
					ancestors: _ancestors,
					hasChildren: _hasChildren,
					...entry
				}) => entry,
			);
			await route.fulfill({
				json: {
					collections,
					sources: [
						{
							key: "native",
							label: "Native",
							provider: "native",
							readOnly: false,
							status: "active",
						},
						...(options.additionalSources ?? []),
					],
				},
			});
			return;
		}
		if (
			pathname === "/api/admin/items/batch" &&
			request.method() === "POST"
		) {
			const body = request.postDataJSON() as {
				action: string;
				collectionKey?: string;
				keys: string[];
			};
			options.onBatchRequest?.(body);
			if (
				body.action === "assignCollection" &&
				body.collectionKey &&
				body.keys.includes(publishedItemKey)
			) {
				const collections = Array.isArray(draftPayload.collections)
					? draftPayload.collections.map(String)
					: [];
				draftPayload = {
					...draftPayload,
					collections: [
						...new Set([...collections, body.collectionKey]),
					],
				};
				draftRevision += 1;
				editing = true;
			}
			await options.beforeBatchResponse?.();
			await route.fulfill({
				json: {
					results:
						options.batchResults?.(body) ??
						body.keys.map((key) => ({
							key,
							outcome: "changed",
						})),
				},
			});
			return;
		}
		if (pathname === "/api/admin/items" && request.method() === "GET") {
			options.onListRequest?.(new URL(request.url()));
			if (remainingListFailures > 0) {
				remainingListFailures -= 1;
				await route.fulfill({
					json: {
						error: {
							code: "internal_error",
							message: "Records could not be loaded.",
						},
					},
					status: 500,
				});
				return;
			}
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
			if (options.failDraftSave) {
				await route.fulfill({
					json: {
						error: {
							code: "validation_failed",
							fields: { title: "Enter a valid title." },
							message: "Fix the highlighted fields.",
						},
					},
					status: 422,
				});
				return;
			}
			const body = request.postDataJSON() as {
				payload: Record<string, unknown>;
			};
			options.onDraftSave?.(body.payload);
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

test("searches and assigns records with the collection picker", async ({
	page,
}) => {
	let batchRequest:
		{ action: string; collectionKey?: string; keys: string[] } | undefined;
	await mockPublishedBook(page, {
		onBatchRequest: (request) => {
			batchRequest = request;
		},
	});
	await page.goto("/admin");
	const assignmentButton = page.getByRole("button", {
		name: "Drag or assign Published book",
		exact: true,
	});
	await assignmentButton.focus();
	await assignmentButton.press("Enter");
	const dialog = page.getByRole("dialog", {
		name: "Add record to collection",
	});
	await expect(dialog).toBeVisible();
	await expect
		.poll(() =>
			dialog.evaluate((element) => getComputedStyle(element).opacity),
		)
		.toBe("1");
	const pickerGeometry = await dialog.evaluate((element) => {
		const dialogRect = element.getBoundingClientRect();
		const picker = element.querySelector<HTMLElement>(
			"[data-admin-collection-picker]",
		)!;
		const results = element.querySelector<HTMLElement>(
			"[data-admin-collection-picker-results]",
		)!;
		const resultsStyle = getComputedStyle(results);
		return {
			dialogMaxWidth: getComputedStyle(element).maxWidth,
			dialogWidth: dialogRect.width,
			pickerInsideDialog:
				picker.getBoundingClientRect().right <= dialogRect.right &&
				picker.getBoundingClientRect().left >= dialogRect.left,
			resultsComputedHeight: Number.parseFloat(resultsStyle.height),
			resultsMaxHeight: resultsStyle.maxHeight,
			resultsOverflowY: resultsStyle.overflowY,
		};
	});
	expect(pickerGeometry).toMatchObject({
		dialogMaxWidth: "448px",
		pickerInsideDialog: true,
		resultsOverflowY: "auto",
	});
	expect(pickerGeometry.dialogWidth).toBeLessThanOrEqual(480);
	expect(pickerGeometry.resultsComputedHeight).toBeLessThanOrEqual(320);
	const collectionSearch = dialog.getByRole("textbox", {
		name: "Search collections",
	});
	await expect(collectionSearch).toBeFocused();
	await collectionSearch.fill("teacher");
	await dialog.getByRole("button", { name: /Teacher development/u }).click();
	await expect
		.poll(() => batchRequest)
		.toEqual({
			action: "assignCollection",
			collectionKey: teacherCollection.key,
			keys: [publishedItemKey],
		});
});

test("creates a collection in a searched location without a full-list select", async ({
	page,
}) => {
	let createRequest: Record<string, unknown> | undefined;
	await mockPublishedBook(page);
	await page.route("**/api/admin/collections", async (route) => {
		if (route.request().method() !== "POST") {
			await route.fallback();
			return;
		}
		createRequest = route.request().postDataJSON() as Record<
			string,
			unknown
		>;
		await route.fulfill({
			json: {
				collection: {
					...longCollection,
					key: "NEWCOLL1",
					name: "Nested collection",
					parentCollection: longCollection.key,
				},
			},
		});
	});

	await page.goto("/admin");
	await page.getByRole("button", { exact: true, name: "New" }).click();
	let dialog = page.getByRole("dialog", { name: "New collection" });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
	const locationGeometry = await dialog
		.locator("[data-admin-collection-location]")
		.evaluate((element) => {
			const style = getComputedStyle(element);
			return {
				borderWidth: style.borderWidth,
				paddingLeft: style.paddingLeft,
				paddingRight: style.paddingRight,
			};
		});
	expect(locationGeometry).toEqual({
		borderWidth: "0px",
		paddingLeft: "12px",
		paddingRight: "12px",
	});
	await dialog.getByRole("button", { name: "Change location" }).click();
	dialog = page.getByRole("dialog", { name: "Choose location" });
	const search = dialog.getByRole("textbox", { name: "Search collections" });
	await expect(search).toBeFocused();
	await search.fill("very long");
	await dialog
		.getByRole("button", {
			name: /A very long collection name/u,
		})
		.click();
	dialog = page.getByRole("dialog", { name: "New collection" });
	await expect(
		dialog.getByRole("button", { name: "Change location" }),
	).toContainText(longCollection.name);
	await dialog
		.getByRole("textbox", { name: "Name" })
		.fill("Nested collection");
	await dialog.getByRole("button", { name: "Create" }).click();
	await expect
		.poll(() => createRequest)
		.toEqual({
			name: "Nested collection",
			parentCollection: longCollection.key,
		});
});

test("moves a collection to a searched destination at the end", async ({
	page,
}) => {
	let moveRequest: Record<string, unknown> | undefined;
	await mockPublishedBook(page);
	await page.route(
		"**/api/admin/collections/TEACHDEV/move",
		async (route) => {
			moveRequest = route.request().postDataJSON() as Record<
				string,
				unknown
			>;
			await route.fulfill({
				json: {
					collection: {
						...teacherCollection,
						parentCollection: longCollection.key,
						revision: 2,
					},
					collections: [],
				},
			});
		},
	);

	await page.goto("/admin");
	await page.locator('[data-collection-key="TEACHDEV"]').hover();
	await page
		.getByRole("button", { name: "Manage Teacher development" })
		.click();
	await page.getByRole("menuitem", { name: "Move" }).click();
	let dialog = page.getByRole("dialog", {
		name: "Move Teacher development",
	});
	await expect(dialog).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "Change destination" }),
	).toContainText("Top level");
	await expect(
		dialog.getByRole("button", { name: "Move", exact: true }),
	).toBeDisabled();
	await dialog.getByRole("button", { name: "Change destination" }).click();
	dialog = page.getByRole("dialog", { name: "Choose destination" });
	await dialog
		.getByRole("textbox", { name: "Search collections" })
		.fill("very long");
	await dialog
		.getByRole("button", { name: /A very long collection name/u })
		.click();
	dialog = page.getByRole("dialog", {
		name: "Move Teacher development",
	});
	await expect(
		dialog.getByRole("button", { name: "Change destination" }),
	).toBeFocused();
	await dialog.getByRole("button", { name: "Move", exact: true }).click();
	await expect
		.poll(() => moveRequest)
		.toEqual({
			beforeCollection: null,
			expectedRevision: teacherCollection.revision,
			parentCollection: longCollection.key,
		});
});

test("persists advanced typed filters in the URL", async ({ page }) => {
	test.setTimeout(45_000);
	const listRequests: URL[] = [];
	await mockPublishedBook(page, {
		onListRequest: (url) => listRequests.push(url),
	});
	const initialFilters = encodeURIComponent(
		JSON.stringify([
			{ column: "state", operator: "anyOf", value: ["draft"] },
		]),
	);
	await page.goto(`/admin?search=teacher&filters=${initialFilters}`);

	await expect(
		page.getByRole("textbox", { name: "Search records" }),
	).toHaveValue("teacher");
	await expect(
		page.getByRole("button", { name: "Drafts", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(
		page.getByRole("button", { name: "Filters, 1 active", exact: true }),
	).toBeVisible();
	await expect
		.poll(() => listRequests.at(-1)?.searchParams.get("search"))
		.toBe("teacher");

	await page
		.getByRole("button", { name: "Filters, 1 active", exact: true })
		.click();
	const dialog = page.getByRole("dialog", { name: "Filter records" });
	const filterGeometry = await dialog.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		return {
			boxSizing: style.boxSizing,
			left: rect.left,
			right: rect.right,
			width: rect.width,
		};
	});
	expect(filterGeometry.boxSizing).toBe("border-box");
	expect(filterGeometry.width).toBeLessThanOrEqual(560);
	expect(filterGeometry.left).toBeGreaterThanOrEqual(12);
	expect(filterGeometry.right).toBeLessThanOrEqual(
		await page.evaluate(() => window.innerWidth - 12),
	);
	await dialog.getByRole("button", { name: "Clear", exact: true }).click();
	await dialog.locator('button[aria-label="Add filter"]').click();
	await page.getByRole("option", { name: "Title", exact: true }).click();
	await dialog.getByRole("textbox", { name: "Title value" }).fill("evidence");
	await dialog.getByRole("button", { name: "Apply", exact: true }).click();

	await expect
		.poll(() => {
			const filters = new URL(page.url()).searchParams.get("filters");
			return filters ? JSON.parse(filters) : null;
		})
		.toEqual([
			{ column: "title", operator: "contains", value: "evidence" },
		]);
	expect(new URL(page.url()).searchParams.get("search")).toBe("teacher");
	await expect
		.poll(() => {
			const filters = listRequests.at(-1)?.searchParams.get("filters");
			return filters ? JSON.parse(filters) : null;
		})
		.toEqual([
			{ column: "title", operator: "contains", value: "evidence" },
		]);

	await page.reload();
	await expect(
		page.getByRole("textbox", { name: "Search records" }),
	).toHaveValue("teacher");
	await expect(
		page.getByRole("button", { name: "Filters, 1 active", exact: true }),
	).toBeVisible();

	await page.evaluate(() => {
		const url = new URL(window.location.href);
		url.searchParams.set(
			"filters",
			JSON.stringify([
				{
					column: "state",
					operator: "anyOf",
					value: ["draft", "published"],
				},
			]),
		);
		window.history.pushState({}, "", url);
		window.dispatchEvent(new PopStateEvent("popstate"));
	});
	await expect(
		page.getByRole("button", { name: "All records", exact: true }),
	).toHaveAttribute("aria-pressed", "false");
	await expect(
		page.getByRole("button", { name: "Drafts", exact: true }),
	).toHaveAttribute("aria-pressed", "false");
	await expect(
		page.getByRole("button", { name: "Published", exact: true }),
	).toHaveAttribute("aria-pressed", "false");

	await page.evaluate(() => {
		const url = new URL(window.location.href);
		url.searchParams.delete("filters");
		url.searchParams.set("search", "restored");
		window.history.pushState({}, "", url);
		window.dispatchEvent(new PopStateEvent("popstate"));
	});
	await expect(
		page.getByRole("textbox", { name: "Search records" }),
	).toHaveValue("restored");
	await expect(
		page.getByRole("button", { name: "All records", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(
		page.getByRole("button", { name: "Filters", exact: true }),
	).toBeVisible();
	await expect
		.poll(() => listRequests.at(-1)?.searchParams.get("search"))
		.toBe("restored");
});

test("keeps the filter editor inside a narrow viewport", async ({ page }) => {
	await mockPublishedBook(page);
	await page.setViewportSize({ height: 844, width: 390 });
	await page.goto("/admin");
	await page
		.locator('button[aria-haspopup="dialog"][aria-label="Filters"]')
		.click();
	const dialog = page.getByRole("dialog", { name: "Filter records" });
	await dialog.locator('button[aria-label="Add filter"]').click();
	await page.getByRole("option", { name: "Year", exact: true }).click();
	await dialog.locator('button[aria-label="Year operator"]').click();
	await page.getByRole("option", { name: "Between", exact: true }).click();

	const readGeometry = () =>
		dialog.evaluate((element) => {
			const rect = element.getBoundingClientRect();
			const interactiveElements = [
				...element.querySelectorAll<HTMLElement>(
					'button, input, textarea, [role="checkbox"]',
				),
			].filter((control) => {
				const controlRect = control.getBoundingClientRect();
				return controlRect.width > 0 && controlRect.height > 0;
			});
			return {
				interactiveControlsInside: interactiveElements.every(
					(control) => {
						const controlRect = control.getBoundingClientRect();
						return (
							controlRect.left >= rect.left &&
							controlRect.right <= rect.right
						);
					},
				),
				documentOverflow:
					document.documentElement.scrollWidth - window.innerWidth,
				left: rect.left,
				right: rect.right,
				width: rect.width,
			};
		});
	expect(await readGeometry()).toEqual({
		interactiveControlsInside: true,
		documentOverflow: 0,
		left: 12,
		right: 378,
		width: 366,
	});

	await dialog.locator('button[aria-label="Filter 1 field"]').click();
	await page.getByRole("option", { name: "State", exact: true }).click();
	await dialog
		.getByRole("button", { name: "State values", exact: true })
		.click();
	await expect(
		dialog.getByRole("checkbox", { name: "Draft", exact: true }),
	).toBeVisible();
	expect(await readGeometry()).toEqual({
		interactiveControlsInside: true,
		documentOverflow: 0,
		left: 12,
		right: 378,
		width: 366,
	});
});

test("filters by searched native and imported collections without loading an option list", async ({
	page,
}) => {
	const collectionSearches: URL[] = [];
	const extraSources: AdminSource[] = Array.from({ length: 12 }, (_, index) => ({
		key: `source-${index}`,
		label: `Source ${index + 1}`,
		provider: "zotero",
		readOnly: true,
		status: "active",
	}));
	await page.setViewportSize({ height: 420, width: 1280 });
	await mockPublishedBook(page, {
		additionalCollectionEntries: [importedCollection, deletedCollection],
		additionalSources: [importedSource, ...extraSources],
	});
	await page.route("**/api/admin/collections?*", async (route) => {
		const url = new URL(route.request().url());
		if (url.searchParams.get("view") === "search") {
			collectionSearches.push(url);
		}
		await route.fallback();
	});
	const initialFilters = JSON.stringify([
		{
			column: "collections",
			operator: "anyOf",
			value: [deletedCollection.key],
		},
	]);
	await page.goto(`/admin?filters=${encodeURIComponent(initialFilters)}`);
	await page.getByRole("button", { name: /^Filters/u }).click();
	const dialog = page.getByRole("dialog", { name: "Filter records" });
	await dialog.getByRole("button", { name: "Collection values" }).click();
	const picker = dialog.locator("[data-admin-collection-filter-picker]");
	const search = picker.getByRole("textbox", { name: "Search collections" });
	await expect(search).toBeFocused();
	const deletedRemove = picker.getByRole("button", {
		name: /Remove Deleted archive/u,
	});
	await expect(deletedRemove).toBeVisible();
	const sourceList = picker.locator(
		"[data-admin-collection-picker-sources]",
	);
	const sourceGeometry = await sourceList.evaluate((element) => ({
		clientHeight: element.clientHeight,
		maxHeight: Number.parseFloat(getComputedStyle(element).maxHeight),
		scrollHeight: element.scrollHeight,
	}));
	expect(sourceGeometry.maxHeight).toBeLessThanOrEqual(420 * 0.44);
	expect(sourceGeometry.clientHeight).toBeLessThanOrEqual(
		Math.ceil(sourceGeometry.maxHeight),
	);
	expect(sourceGeometry.scrollHeight).toBeGreaterThan(
		sourceGeometry.clientHeight,
	);
	await deletedRemove.click();

	await search.fill("teacher");
	const native = picker.getByRole("checkbox", {
		name: /Teacher development/u,
	});
	await native.check();
	const removeNative = picker.getByRole("button", {
		name: /Remove Teacher development/u,
	});
	await expect(removeNative).toBeVisible();
	await removeNative.click();
	await expect(native).not.toBeChecked();
	await native.check();

	await search.fill("imported");
	await expect
		.poll(() => collectionSearches.at(-1)?.searchParams.get("query"))
		.toBe("imported");
	const imported = picker.getByRole("checkbox", {
		name: /Imported research/u,
	});
	await imported.check();
	const removeImported = picker.getByRole("button", {
		name: /Remove Imported research/u,
	});
	await expect(removeImported).toBeVisible();
	await removeImported.click();
	await expect(imported).not.toBeChecked();
	await imported.check();
	await expect(removeImported).toBeVisible();

	const geometry = await dialog.evaluate((element) => {
		const filterPicker = element.querySelector<HTMLElement>(
			"[data-admin-collection-filter-picker]",
		)!;
		const results = element.querySelector<HTMLElement>(
			"[data-admin-collection-picker-results]",
		)!;
		const rect = element.getBoundingClientRect();
		const pickerRect = filterPicker.getBoundingClientRect();
		return {
			dialogWidth: rect.width,
			documentOverflow:
				document.documentElement.scrollWidth - window.innerWidth,
			pickerInside:
				pickerRect.left >= rect.left && pickerRect.right <= rect.right,
			resultsMaxHeight: Number.parseFloat(
				getComputedStyle(results).maxHeight,
			),
		};
	});
	expect(geometry).toMatchObject({
		documentOverflow: 0,
		pickerInside: true,
	});
	expect(geometry.dialogWidth).toBeLessThanOrEqual(560);
	expect(geometry.resultsMaxHeight).toBeLessThanOrEqual(320);
	const apply = dialog.getByRole("button", { name: "Apply", exact: true });
	await apply.focus();
	await page.keyboard.press("Enter");
	await expect(dialog).toBeHidden();
	await expect
		.poll(() => {
			const filters = new URL(page.url()).searchParams.get("filters");
			return filters ? JSON.parse(filters) : null;
		})
		.toEqual([
			{
				column: "collections",
				operator: "anyOf",
				value: [teacherCollection.key, importedCollection.key],
			},
		]);
});

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
	await expect(
		dialog.getByRole("textbox", { name: "Find an item type" }),
	).toBeFocused();
	await expect
		.poll(() =>
			dialog.evaluate((element) => element.getBoundingClientRect().width),
		)
		.toBeLessThanOrEqual(513);
	await expect
		.poll(() =>
			dialog.evaluate((element) => element.getBoundingClientRect().width),
		)
		.toBeGreaterThanOrEqual(511);
	const modalGeometry = await dialog.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		return {
			boxSizing: style.boxSizing,
			left: rect.left,
			right: rect.right,
			width: rect.width,
		};
	});
	expect(modalGeometry.boxSizing).toBe("border-box");
	expect(modalGeometry.width).toBeLessThanOrEqual(513);
	expect(modalGeometry.left).toBeGreaterThanOrEqual(16);
	expect(modalGeometry.right).toBeLessThanOrEqual(
		await page.evaluate(() => window.innerWidth - 16),
	);
	await dialog.getByRole("button", { name: "Book", exact: true }).click();

	await expect(dialog).toBeHidden();
	expect(submittedPayload).toEqual({
		collections: [],
		creators: [],
		itemType: "book",
		tags: [],
	});
});

test("focuses item search in a narrow keyboard-driven window", async ({
	page,
}) => {
	await mockPublishedBook(page);
	await page.setViewportSize({ height: 768, width: 1024 });
	await page.goto("/admin");
	await page.getByRole("button", { name: "New item" }).click();

	const search = page
		.getByRole("dialog", { name: "New item" })
		.getByRole("textbox", { name: "Find an item type" });
	await expect(search).toBeVisible();
	await expect(search).toBeFocused();
});

test("lets touch users browse item types without opening the keyboard", async ({
	browser,
}) => {
	const context = await browser.newContext({
		hasTouch: true,
		viewport: { height: 844, width: 390 },
	});
	const page = await context.newPage();
	try {
		await mockPublishedBook(page);
		await page.goto("/admin");
		await page.getByRole("button", { name: "New item" }).click();

		const search = page
			.getByRole("dialog", { name: "New item" })
			.getByRole("textbox", { name: "Find an item type" });
		await expect(search).toBeVisible();
		await expect(search).not.toBeFocused();
	} finally {
		await context.close();
	}
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

	const collectionsGroup = inspector.getByRole("group", {
		name: "Collections",
	});
	await collectionsGroup
		.getByRole("button", { name: "Add to collection" })
		.click();
	const collectionsDialog = page.getByRole("dialog", {
		name: "Edit collections",
	});
	const longCollectionResult = collectionsDialog.getByText(
		longCollectionName,
		{
			exact: true,
		},
	);
	const collectionGeometry = await longCollectionResult.evaluate(
		(element) => {
			const picker = element.closest("[data-admin-collection-picker]")!;
			const style = getComputedStyle(element);
			return {
				pickerClientWidth: picker.clientWidth,
				pickerScrollWidth: picker.scrollWidth,
				overflow: style.overflow,
				rightInsidePicker:
					element.getBoundingClientRect().right <=
					picker.getBoundingClientRect().right,
				textOverflow: style.textOverflow,
			};
		},
	);
	expect(collectionGeometry.pickerScrollWidth).toBe(
		collectionGeometry.pickerClientWidth,
	);
	expect(collectionGeometry).toMatchObject({
		overflow: "hidden",
		rightInsidePicker: true,
		textOverflow: "ellipsis",
	});
	await collectionsDialog
		.getByRole("checkbox", { name: /Teacher development/ })
		.check();
	await collectionsDialog.getByRole("button", { name: "Done" }).click();
	await expect(collectionsGroup).toContainText("Teacher development");
	const membershipGeometry = await collectionsGroup
		.locator('[data-admin-collection-membership="TEACHDEV"]')
		.evaluate((row) => ({
			height: row.getBoundingClientRect().height,
			removeSize: (() => {
				const button = row.querySelector("button")!;
				return [button.offsetWidth, button.offsetHeight];
			})(),
			rightInsideGroup:
				row.getBoundingClientRect().right <=
				row.parentElement!.getBoundingClientRect().right,
		}));
	expect(membershipGeometry).toEqual({
		height: 44,
		removeSize: [28, 28],
		rightInsideGroup: true,
	});
	await expect(
		collectionsGroup.getByLabel("Added in this draft"),
	).toHaveCount(1);
	const collectionMarker = inspector.getByRole("button", {
		name: "Changed: show published collections",
	});
	await expect(collectionMarker).toBeVisible();
	await collectionMarker.click();
	await expect(page.getByText("Empty", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Revert to published" }).click();
	await expect(collectionsGroup).toContainText("No collections");
	await expect(collectionMarker).toHaveCount(0);
});

test("removes native memberships while imported and deleted memberships stay locked", async ({
	page,
}) => {
	const savedPayloads: Record<string, unknown>[] = [];
	await mockPublishedBook(page, {
		additionalCollectionEntries: [importedCollection, deletedCollection],
		additionalSources: [importedSource],
		initialCollectionKeys: [
			teacherCollection.key,
			importedCollection.key,
			deletedCollection.key,
		],
		onDraftSave: (payload) => savedPayloads.push(payload),
	});
	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", { name: "Edit" }).click();
	const collectionsGroup = inspector.getByRole("group", {
		name: "Collections",
	});
	await expect(
		collectionsGroup.locator("[data-admin-collection-membership]"),
	).toHaveCount(3);
	await expect(collectionsGroup.getByLabel("Read only")).toHaveCount(2);
	await expect(
		collectionsGroup.getByRole("button", {
			name: /Remove Teacher development/u,
		}),
	).toHaveCount(1);
	await expect(
		collectionsGroup.getByRole("button", {
			name: /Remove Imported research|Remove Deleted archive/u,
		}),
	).toHaveCount(0);

	await collectionsGroup
		.getByRole("button", { name: /Remove Teacher development/u })
		.click();
	await expect(
		collectionsGroup.locator(
			'[data-admin-collection-membership="TEACHDEV"]',
		),
	).toHaveCount(0);
	await expect
		.poll(() => savedPayloads.at(-1)?.collections)
		.toEqual([importedCollection.key, deletedCollection.key]);

	await collectionsGroup
		.getByRole("button", { name: "Add to collection" })
		.click();
	const dialog = page.getByRole("dialog", { name: "Edit collections" });
	await expect(
		dialog.getByText("Imported research", { exact: true }),
	).toBeVisible();
	await expect(
		dialog.getByText("Deleted archive", { exact: true }),
	).toBeVisible();
	await expect(
		dialog.getByRole("button", {
			name: /Remove Imported research|Remove Deleted archive/u,
		}),
	).toHaveCount(0);
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
	let batchRequest: unknown;
	await mockPublishedBook(page, {
		itemCount: 2,
		onBatchRequest: (body) => {
			batchRequest = body;
		},
	});
	await page.goto("/admin");
	await expect(
		page.getByRole("heading", { name: "Published book" }),
	).toBeVisible();
	await page
		.getByRole("checkbox", { name: "Select Published book 2" })
		.check();

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
		.poll(() => batchRequest)
		.toEqual({
			action: "assignCollection",
			collectionKey: longCollection.key,
			keys: [publishedItemKey],
		});
	await expect(
		page.getByRole("button", {
			name: "Changed: show published collections",
		}),
	).toBeVisible();
	await expect(handle).toBeFocused();
	await expect(
		page.getByRole("checkbox", { name: "Select Published book 2" }),
	).toBeChecked();
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

test("runs selected-record actions through one compact batch request", async ({
	page,
}) => {
	const batchRequests: unknown[] = [];
	await mockPublishedBook(page, {
		itemCount: 2,
		onBatchRequest: (body) => batchRequests.push(body),
	});
	await page.goto("/admin");
	await expect(
		page.getByRole("heading", { name: "Published book" }),
	).toBeVisible();

	await page
		.getByRole("checkbox", { name: "Select all loaded records" })
		.check();
	const bulkToolbar = page.getByRole("toolbar", { name: "Bulk actions" });
	await expect(bulkToolbar).toBeVisible();
	await expect(bulkToolbar).toContainText("2 selected");

	const toolbarGeometry = await page.evaluate(() => {
		const bulk = document.querySelector<HTMLElement>(
			'[role="toolbar"][aria-label="Bulk actions"]',
		)!;
		const controls = document.querySelector<HTMLElement>(
			'[aria-label="Table view controls"]',
		)!;
		const bulkRect = bulk.getBoundingClientRect();
		const controlsRect = controls.getBoundingClientRect();
		return {
			bulkBottom: bulkRect.bottom,
			bulkTop: bulkRect.top,
			controlsBottom: controlsRect.bottom,
			controlsHeight: controlsRect.height,
			controlsTop: controlsRect.top,
			documentOverflow:
				document.documentElement.scrollWidth - window.innerWidth,
		};
	});
	expect(toolbarGeometry.controlsHeight).toBe(40);
	expect(
		Math.abs(
			(toolbarGeometry.bulkTop + toolbarGeometry.bulkBottom) / 2 -
				(toolbarGeometry.controlsTop + toolbarGeometry.controlsBottom) /
					2,
		),
	).toBeLessThanOrEqual(1);
	expect(toolbarGeometry.bulkBottom).toBeLessThanOrEqual(
		toolbarGeometry.controlsBottom,
	);
	expect(toolbarGeometry.documentOverflow).toBe(0);
	await bulkToolbar.getByRole("button", { name: "Publish selected" }).click();
	await expect.poll(() => batchRequests.length).toBe(1);
	expect(batchRequests).toEqual([
		{
			action: "publish",
			keys: [publishedItemKey, "ROW00001"],
		},
	]);
	await expect(bulkToolbar).toBeHidden();
});

test("assigns selected records through the searchable collection picker", async ({
	page,
}) => {
	const batchRequests: unknown[] = [];
	await mockPublishedBook(page, {
		itemCount: 2,
		onBatchRequest: (body) => batchRequests.push(body),
	});
	await page.goto("/admin");
	await page
		.getByRole("checkbox", { name: "Select all loaded records" })
		.check();
	const bulkToolbar = page.getByRole("toolbar", { name: "Bulk actions" });
	const assign = bulkToolbar.getByRole("button", {
		name: "Add selected to collection",
	});
	const toolbarStyles = await bulkToolbar.evaluate((toolbar) => ({
		buttonSizes: [...toolbar.querySelectorAll("button")].map((button) => [
			button.offsetWidth,
			button.offsetHeight,
		]),
		gap: getComputedStyle(toolbar).gap,
	}));
	expect(toolbarStyles.gap).toBe("4px");
	expect(new Set(toolbarStyles.buttonSizes.map(String))).toEqual(
		new Set(["32,32"]),
	);
	await assign.focus();
	await assign.press("Enter");
	let dialog = page.getByRole("dialog", {
		name: "Add 2 records to collection",
	});
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(assign).toBeFocused();

	await assign.click();
	dialog = page.getByRole("dialog", {
		name: "Add 2 records to collection",
	});
	await dialog
		.getByRole("textbox", { name: "Search collections" })
		.fill("teacher");
	await dialog.getByRole("button", { name: /Teacher development/u }).click();
	await expect
		.poll(() => batchRequests)
		.toEqual([
			{
				action: "assignCollection",
				collectionKey: teacherCollection.key,
				keys: [publishedItemKey, "ROW00001"],
			},
		]);
	await expect(dialog).toBeHidden();
	await expect(bulkToolbar).toBeHidden();
});

test("chunks a 500-record keyboard selection through the batch contract", async ({
	page,
}) => {
	const batchRequests: { action: string; keys: string[] }[] = [];
	await mockPublishedBook(page, {
		itemCount: 500,
		onBatchRequest: (body) => batchRequests.push(body),
	});
	await page.goto("/admin");
	const grid = page.getByRole("grid", { name: "Library records" });
	await expect(grid).toHaveAttribute("aria-rowcount", "501");
	await grid.focus();
	await grid.press("Meta+A");
	const bulkToolbar = page.getByRole("toolbar", { name: "Bulk actions" });
	await expect(bulkToolbar).toContainText("500 selected");
	await bulkToolbar.getByRole("button", { name: "Publish selected" }).click();
	await expect.poll(() => batchRequests.length).toBe(10);
	const submittedKeys = batchRequests.flatMap(({ keys }) => keys);
	expect(batchRequests.every(({ keys }) => keys.length <= 50)).toBe(true);
	expect(submittedKeys).toHaveLength(500);
	expect(new Set(submittedKeys).size).toBe(500);
	await expect(bulkToolbar).toBeHidden();
});

test("continues a bulk action when one local draft cannot be saved", async ({
	page,
}) => {
	const batchRequests: unknown[] = [];
	await mockPublishedBook(page, {
		failDraftSave: true,
		itemCount: 2,
		onBatchRequest: (body) => batchRequests.push(body),
	});
	await page.goto("/admin");

	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", { name: "Edit" }).click();
	await inspector
		.getByRole("textbox", { name: "Title", exact: true })
		.fill("Invalid local draft");
	await page
		.getByRole("checkbox", { name: "Select all loaded records" })
		.check();
	const bulkToolbar = page.getByRole("toolbar", { name: "Bulk actions" });
	await bulkToolbar.getByRole("button", { name: "Publish selected" }).click();

	await expect
		.poll(() => batchRequests)
		.toEqual([
			{
				action: "publish",
				keys: ["ROW00001"],
			},
		]);
	await expect(
		page.getByRole("checkbox", {
			name: "Select Published book",
			exact: true,
		}),
	).toBeChecked();
	await expect(
		page.getByRole("checkbox", { name: "Select Published book 2" }),
	).not.toBeChecked();
	await expect(page.getByText(/1 record published, 1 failed/)).toBeVisible();
});

test("shows server batch validation on the selected metadata field", async ({
	page,
}) => {
	await mockPublishedBook(page, {
		batchResults: ({ keys }) =>
			keys.map((key) => ({
				code: "validation_failed",
				fields: { title: "Enter a publishable title." },
				key,
				message: "Check the highlighted fields and try again.",
				outcome: "failed",
			})),
	});
	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", { name: "Edit" }).click();
	await page
		.getByRole("checkbox", {
			name: "Select Published book",
			exact: true,
		})
		.check();
	await page
		.getByRole("toolbar", { name: "Bulk actions" })
		.getByRole("button", { name: "Publish selected" })
		.click();

	await expect(
		inspector
			.locator('[data-slot="error-message"]')
			.filter({ hasText: "Enter a publishable title." }),
	).toBeVisible();
	await expect(
		inspector.getByRole("textbox", { name: "Title", exact: true }),
	).toHaveAttribute("aria-invalid", "true");
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
	expect(await initialRows.count()).toBeLessThanOrEqual(26);
	const activeRowIsOutsideViewport = await page
		.locator('tr[data-record-key="LIVEBOOK"]')
		.evaluate((row) => {
			const scrollElement = row.closest<HTMLElement>(
				"[data-admin-item-table-scroll]",
			)!;
			const rowRect = row.getBoundingClientRect();
			const scrollRect = scrollElement.getBoundingClientRect();
			return (
				rowRect.bottom <= scrollRect.top + 40 ||
				rowRect.top >= scrollRect.bottom
			);
		});
	expect(activeRowIsOutsideViewport).toBe(true);

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

test("navigates one stable grid tab stop through virtualized cells", async ({
	page,
}) => {
	const listRequests: URL[] = [];
	await mockPublishedBook(page, {
		itemCount: 500,
		onListRequest: (url) => listRequests.push(url),
	});
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/admin");
	const grid = page.getByRole("grid", { name: "Library records" });
	const firstTitleCell = page.locator(
		`#admin-item-grid-cell-${publishedItemKey}-title`,
	);
	await grid.focus();
	await expect(grid).toBeFocused();
	await expect(grid).toHaveAttribute(
		"aria-activedescendant",
		`admin-item-grid-cell-${publishedItemKey}-title`,
	);
	await expect(grid.locator('[tabindex="0"]')).toHaveCount(0);
	const descendantTabIndices = await grid.evaluate((table) =>
		Array.from(
			table.querySelectorAll<HTMLElement>(
				"a[href], button, input, select, textarea, [tabindex]",
			),
		).map((element) => element.tabIndex),
	);
	expect(descendantTabIndices.length).toBeGreaterThan(0);
	expect(descendantTabIndices.every((tabIndex) => tabIndex === -1)).toBe(
		true,
	);
	await grid.press("Shift+Tab");
	expect(
		await grid.evaluate(
			(table) =>
				document.activeElement !== table &&
				!table.contains(document.activeElement),
		),
	).toBe(true);
	await page.keyboard.press("Tab");
	await expect(grid).toBeFocused();
	const focusStyle = await firstTitleCell.evaluate((cell) => {
		const style = getComputedStyle(cell);
		return {
			boxShadow: style.boxShadow,
			outlineStyle: style.outlineStyle,
			outlineWidth: style.outlineWidth,
		};
	});
	expect(
		focusStyle.boxShadow !== "none" ||
			(focusStyle.outlineStyle !== "none" &&
				Number.parseFloat(focusStyle.outlineWidth) > 0),
	).toBe(true);

	await grid.press("ArrowRight");
	await expect(grid).toHaveAttribute(
		"aria-activedescendant",
		`admin-item-grid-cell-${publishedItemKey}-creators`,
	);
	await grid.press("ArrowUp");
	await expect(grid).toHaveAttribute(
		"aria-activedescendant",
		"admin-item-grid-header-creators",
	);
	await grid.press("Home");
	await expect(grid).toHaveAttribute(
		"aria-activedescendant",
		"admin-item-grid-header-select",
	);
	await grid.press("End");
	await expect(grid).toHaveAttribute(
		"aria-activedescendant",
		"admin-item-grid-header-updated",
	);
	await grid.press("Control+Home");
	await grid.press("F2");
	const selectAllCheckbox = page.getByRole("checkbox", {
		name: "Select all loaded records",
	});
	await expect(selectAllCheckbox).toBeFocused();
	await selectAllCheckbox.press("Shift+Tab");
	expect(
		await grid.evaluate(
			(table) =>
				document.activeElement !== table &&
				!table.contains(document.activeElement),
		),
	).toBe(true);
	await grid.focus();
	await grid.press("ArrowRight");
	await grid.press("F2");
	const titleHeader = page.locator("#admin-item-grid-header-title");
	const sortButton = titleHeader.getByRole("button", {
		name: "Title",
		exact: true,
	});
	const resizeButton = titleHeader.getByRole("button", {
		name: "Resize Title column",
	});
	await expect(sortButton).toBeFocused();
	await sortButton.press("Enter");
	await expect(titleHeader).toHaveAttribute("aria-sort", "ascending");
	await expect
		.poll(() => {
			const sorting = listRequests.at(-1)?.searchParams.get("sorting");
			return sorting ? JSON.parse(sorting) : null;
		})
		.toEqual([{ column: "title", direction: "asc" }]);
	await sortButton.press("Escape");
	await expect(grid).toBeFocused();
	await grid.press("F2");
	await expect(sortButton).toBeFocused();
	await sortButton.press("Tab");
	await expect(resizeButton).toBeFocused();
	const titleWidthBeforeResize = await titleHeader.evaluate(
		(header) => header.getBoundingClientRect().width,
	);
	await resizeButton.press("ArrowRight");
	await expect
		.poll(() =>
			titleHeader.evaluate(
				(header) => header.getBoundingClientRect().width,
			),
		)
		.toBe(titleWidthBeforeResize + 16);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const saved = localStorage.getItem(
					"openscholar.admin.item-table.preferences.v1",
				);
				if (!saved) return null;
				return JSON.parse(saved).columnSizing?.title ?? null;
			}),
		)
		.toBe(titleWidthBeforeResize + 16);
	await resizeButton.press("Tab");
	await expect(grid).toBeFocused();
	await expect(grid).toHaveAttribute(
		"aria-activedescendant",
		"admin-item-grid-header-creators",
	);

	await grid.press("Control+Home");
	await grid.press("ArrowDown");
	await grid.press("ArrowRight");
	await expect(grid).toHaveAttribute(
		"aria-activedescendant",
		`admin-item-grid-cell-${publishedItemKey}-title`,
	);
	await grid.press("ArrowDown");
	await grid.press("Enter");
	await expect(
		page.locator('tr[data-record-key="ROW00001"]'),
	).toHaveAttribute("aria-current", "true");
	await expect(
		page.locator(`tr[data-record-key="${publishedItemKey}"]`),
	).not.toHaveAttribute("aria-current", "true");
	await grid.press("ArrowUp");
	await grid.press("Enter");
	await expect(
		page.locator(`tr[data-record-key="${publishedItemKey}"]`),
	).toHaveAttribute("aria-current", "true");
	await expect(
		page.getByRole("dialog", { name: "Add record to collection" }),
	).toHaveCount(0);
	await expect(grid).toBeFocused();
	await grid.press("F2");
	const assignmentButton = page.getByRole("button", {
		name: "Drag or assign Published book",
		exact: true,
	});
	await expect(assignmentButton).toBeFocused();
	await assignmentButton.press("Escape");
	await expect(grid).toBeFocused();
	await grid.press("Shift+Space");
	await expect(
		page.getByRole("checkbox", {
			name: "Select Published book",
			exact: true,
		}),
	).toBeChecked();

	await page.keyboard.press("PageDown");
	await expect
		.poll(async () => {
			const id = await grid.getAttribute("aria-activedescendant");
			return id?.includes("ROW000") ?? false;
		})
		.toBe(true);
	await grid.press("PageUp");
	await expect(grid).toHaveAttribute(
		"aria-activedescendant",
		`admin-item-grid-cell-${publishedItemKey}-title`,
	);

	await grid.press("Control+Home");
	await grid.press("ArrowDown");
	await grid.press("ArrowRight");
	const scroll = page.locator("[data-admin-item-table-scroll]");
	await scroll.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
		element.dispatchEvent(new Event("scroll"));
	});
	await expect(grid).toBeFocused();
	await expect(firstTitleCell).toBeAttached();
	await expect(grid).toHaveAttribute(
		"aria-activedescendant",
		`admin-item-grid-cell-${publishedItemKey}-title`,
	);

	await grid.press("Control+End");
	await expect(grid).toHaveAttribute(
		"aria-activedescendant",
		"admin-item-grid-cell-ROW00499-updated",
	);
	await expect(
		page.locator("#admin-item-grid-cell-ROW00499-updated"),
	).toBeAttached();
	await grid.press("ArrowDown");
	await expect(grid).toHaveAttribute(
		"aria-activedescendant",
		"admin-item-grid-cell-ROW00499-updated",
	);
	await expect
		.poll(async () => page.locator("tbody tr[data-record-key]").count())
		.toBeLessThan(40);
});

test("keeps unavailable drag controls out of keyboard widget mode", async ({
	page,
}) => {
	let markBatchStarted: (() => void) | undefined;
	let releaseBatch: (() => void) | undefined;
	const batchStarted = new Promise<void>((resolve) => {
		markBatchStarted = resolve;
	});
	const batchRelease = new Promise<void>((resolve) => {
		releaseBatch = resolve;
	});
	await mockPublishedBook(page, {
		beforeBatchResponse: async () => {
			markBatchStarted?.();
			await batchRelease;
		},
	});
	await page.goto("/admin");
	await page
		.getByRole("checkbox", { name: "Select Published book", exact: true })
		.check();
	await page.getByRole("button", { name: "Publish selected" }).click();
	await batchStarted;

	try {
		const grid = page.getByRole("grid", { name: "Library records" });
		await grid.focus();
		await expect(
			page.getByRole("button", {
				name: "Drag or assign Published book",
				exact: true,
			}),
		).toHaveAttribute("aria-disabled", "true");
		await grid.press("ArrowRight");
		await expect(grid).toHaveAttribute(
			"aria-activedescendant",
			`admin-item-grid-cell-${publishedItemKey}-title`,
		);
		await grid.press("F2");
		await expect(grid).toBeFocused();
		await grid.press("Enter");
		await expect(
			page.getByRole("dialog", { name: "Add record to collection" }),
		).toHaveCount(0);
	} finally {
		releaseBatch?.();
	}
	await expect(
		page.getByRole("button", { name: "Publish selected" }),
	).toBeHidden();
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
	const grid = page.getByRole("grid", { name: "Library records" });
	await expect(grid).toHaveAttribute("aria-rowcount", "2");
	await grid.focus();
	await grid.press("ArrowDown");
	await expect(grid).toHaveAttribute(
		"aria-activedescendant",
		"admin-item-grid-status",
	);
	const activeStyle = await emptyState.evaluate(
		(cell) => getComputedStyle(cell).boxShadow,
	);
	expect(activeStyle).not.toBe("none");
	await grid.press("ArrowUp");
	await expect(grid).toHaveAttribute(
		"aria-activedescendant",
		"admin-item-grid-header-title",
	);

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

test("announces an initial record-list failure from the grid status row", async ({
	page,
}) => {
	await mockPublishedBook(page, { itemCount: 0, listFailureCount: 1 });
	await page.goto("/admin");
	const errorState = page.getByRole("gridcell", {
		name: /Records could not be loaded\./,
	});
	await expect(errorState).toBeVisible();
	await expect(errorState).toHaveAttribute("aria-live", "assertive");
	await expect(errorState).toHaveAttribute("aria-atomic", "true");
	await expect(
		errorState.getByRole("button", { name: "Try again" }),
	).toHaveAttribute("tabindex", "-1");
	const grid = page.getByRole("grid", { name: "Library records" });
	await grid.focus();
	await grid.press("ArrowDown");
	await grid.press("F2");
	const retry = errorState.getByRole("button", { name: "Try again" });
	await expect(retry).toBeFocused();
	await retry.press("Escape");
	await expect(grid).toBeFocused();
	await grid.press("Enter");
	await expect(
		page.getByRole("gridcell", {
			name: "No records match these filters.",
		}),
	).toBeVisible();
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
	await expect
		.poll(() =>
			dialog.evaluate((element) => element.getBoundingClientRect().width),
		)
		.toBeLessThanOrEqual(449);
	await expect
		.poll(() =>
			dialog.evaluate((element) => element.getBoundingClientRect().width),
		)
		.toBeGreaterThanOrEqual(447);
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
