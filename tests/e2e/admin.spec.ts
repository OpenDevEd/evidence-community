import { expect, test, type Locator, type Page } from "@playwright/test";

import type {
	AdminCollectionCatalogEntry,
	AdminSource,
} from "@/lib/admin/types";
import type { AdminItemBatchResult } from "@/lib/admin/item-batch-contract";

import {
	measureAdminSearchIndexTrigger,
	openAndMeasureAdminSearchIndexPopover,
	waitForAdminSearchIndexStatus,
} from "./admin-search-index-page";

const itemKey = "TESTBOOK";
const publishedItemKey = "LIVEB22K";
const timestamp = "2026-07-31T12:00:00.000Z";
const adminPassword =
	process.env.EVIDENCE_LIBRARY_ADMIN_PASSWORD ??
	"correct horse battery staple";
const longCollectionName =
	"A very long collection name that must stay inside the metadata inspector";

type IndexingReceipt = {
	entityKey: string;
	entityType: "collection" | "item";
	revision: number;
};

function indexingReceipt(
	entityKey: string,
	entityType: IndexingReceipt["entityType"],
	revision: number,
): IndexingReceipt {
	return { entityKey, entityType, revision };
}

async function mockCompletedIndexing(page: Page) {
	const statusRequests: IndexingReceipt[][] = [];
	await page.route("**/api/admin/search-index", async (route) => {
		await route.fulfill({
			json: {
				queue: {
					hasFailed: false,
					hasPending: false,
					nextAttemptAt: null,
				},
				worker: {
					active: true,
					batchProgress: null,
					batchUid: null,
					currentEventCount: 0,
					heartbeatAt: timestamp,
					lastCompletedAt: timestamp,
					lastError: null,
					stage: "idle",
					startedAt: timestamp,
					stoppedAt: null,
					taskUid: null,
					workerId: "search-indexer",
				},
			},
		});
	});
	await page.route("**/api/admin/search-index/receipts", async (route) => {
		const request = route.request().postDataJSON() as {
			receipts: IndexingReceipt[];
		};
		statusRequests.push(request.receipts);
		await route.fulfill({
			json: {
				receipts: request.receipts.map((receipt) => ({
					...receipt,
					attempts: 0,
					createdAt: timestamp,
					error: null,
					nextAttemptAt: timestamp,
					processedAt: timestamp,
					state: "indexed",
				})),
			},
		});
	});
	return {
		async expectTracked(receipt: IndexingReceipt) {
			await expect
				.poll(() =>
					statusRequests.some((request) =>
						request.some(
							(candidate) =>
								candidate.entityKey === receipt.entityKey &&
								candidate.entityType === receipt.entityType &&
								candidate.revision === receipt.revision,
						),
					),
				)
				.toBe(true);
		},
	};
}

async function mockPublicShell(page: Page) {
	await page.route("**/api/collections", async (route) => {
		await route.fulfill({ json: { collections: [] } });
	});
	await page.route("**/api/facets?*", async (route) => {
		await route.fulfill({ json: { facetDistribution: {} } });
	});
}

test.beforeEach(async ({ page }) => {
	await mockPublicShell(page);
	const response = await page.request.post("/api/admin/session", {
		form: { password: adminPassword },
		maxRedirects: 0,
	});
	expect(response.status()).toBe(303);
});

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
	writeback: { enabled: true, supported: true },
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
		editable: true,
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
		writeback: {
			effective: false,
			itemEnabled: false,
			reason: "not-linked",
			sourceEnabled: false,
			sourceKey: null,
			sourceLabel: null,
			sourceStatus: null,
			supported: false,
		},
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
		}) => AdminItemBatchResult[];
		beforeBatchResponse?: () => Promise<void>;
		beforeCollectionPageResponse?: (request: URL) => Promise<void>;
		beforeDraftSaveResponse?: (body: {
			expectedPayload: Record<string, unknown>;
			payload: Record<string, unknown>;
		}) => Promise<Record<string, unknown> | void>;
		failDraftSave?: boolean;
		itemCount?: number;
		itemPageSize?: number;
		initialCollectionKeys?: string[];
		listFailure?: boolean;
		listFailureCount?: number;
		listRowOverrides?: Partial<Record<string, unknown>>;
		listRowOverridesForIndex?: (
			index: number,
		) => Partial<Record<string, unknown>>;
		onBatchRequest?: (body: {
			action: string;
			collectionKey?: string;
			keys: string[];
		}) => void;
		onCollectionPage?: (
			request: URL,
			items: AdminCollectionCatalogEntry[],
		) => void;
		onCollectionResolve?: (
			keys: string[],
			items: AdminCollectionCatalogEntry[],
		) => void;
		onDraftSave?: (
			payload: Record<string, unknown>,
			expectedPayload: Record<string, unknown>,
		) => void;
		onListRequest?: (url: URL) => void;
	} = {},
) {
	const catalogEntries = [
		...collectionCatalogEntries,
		...(options.additionalCollectionEntries ?? []),
	];
	const itemCount = options.itemCount ?? 1;
	const itemPageSize = options.itemPageSize ?? itemCount;
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
		if (pathname.startsWith("/api/admin/session")) {
			await route.continue();
			return;
		}

		if (
			pathname === "/api/admin/collections" &&
			request.method() === "GET"
		) {
			const view = requestUrl.searchParams.get("view") ?? "children";
			if (view === "resolve") {
				const keys = requestUrl.searchParams.getAll("key");
				const items = keys.flatMap((key) => {
					const entry = catalogEntries.find(
						(collection) => collection.key === key,
					);
					return entry ? [entry] : [];
				});
				options.onCollectionResolve?.(keys, items);
				await route.fulfill({
					json: { items },
				});
				return;
			}
			const query = (requestUrl.searchParams.get("query") ?? "")
				.trim()
				.toLowerCase();
			const parent = requestUrl.searchParams.get("parent");
			const source = requestUrl.searchParams.get("source");
			const state = requestUrl.searchParams.get("state") ?? "active";
			const pageSize = Number(
				requestUrl.searchParams.get("pageSize") ?? 50,
			);
			const offset = Number(requestUrl.searchParams.get("cursor") ?? 0);
			const matches = catalogEntries
				.filter(
					(entry) =>
						(state === "deleted"
							? entry.deleted
							: !entry.deleted) &&
						(view === "search"
							? entry.name.toLowerCase().includes(query)
							: entry.parentCollection ===
								(!parent || parent === "root"
									? null
									: parent)) &&
						(!source || entry.sourceConnectionKey === source),
				)
				.sort(
					(left, right) =>
						(left.sortOrder ?? Number.MAX_SAFE_INTEGER) -
							(right.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
						left.name
							.toLocaleLowerCase()
							.localeCompare(right.name.toLocaleLowerCase()) ||
						left.key.localeCompare(right.key),
				);
			const items = matches.slice(offset, offset + pageSize);
			const nextOffset = offset + items.length;
			await options.beforeCollectionPageResponse?.(
				new URL(request.url()),
			);
			options.onCollectionPage?.(new URL(request.url()), items);
			await route.fulfill({
				json: {
					hasMore: nextOffset < matches.length,
					items,
					nextCursor:
						nextOffset < matches.length ? String(nextOffset) : null,
				},
			});
			return;
		}

		if (pathname === "/api/admin/library") {
			await route.fulfill({
				json: {
					sources: [
						{
							key: "native",
							label: "Native",
							provider: "native",
							readOnly: false,
							status: "active",
							writeback: { enabled: false, supported: false },
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
							indexingReceipts: [],
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
			const offset = Number(requestUrl.searchParams.get("cursor") ?? 0);
			const nextOffset = Math.min(itemCount, offset + itemPageSize);
			await route.fulfill({
				json: {
					hasMore: nextOffset < itemCount,
					items: Array.from(
						{ length: nextOffset - offset },
						(_, pageIndex) => {
							const index = offset + pageIndex;
							return publishedListRow({
								...options.listRowOverrides,
								...options.listRowOverridesForIndex?.(index),
								key:
									index === 0
										? publishedItemKey
										: `ROW${String(index).padStart(5, "0")}`,
								state: editing ? "edited" : "published",
								title:
									index === 0
										? publishedPayload.title
										: `Published book ${index + 1}`,
							});
						},
					),
					nextCursor:
						nextOffset < itemCount ? String(nextOffset) : null,
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
				expectedPayload: Record<string, unknown>;
				payload: Record<string, unknown>;
			};
			options.onDraftSave?.(body.payload, body.expectedPayload);
			draftPayload =
				(await options.beforeDraftSaveResponse?.(body)) ?? body.payload;
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
	return {
		replaceCollection(entry: AdminCollectionCatalogEntry) {
			const index = catalogEntries.findIndex(
				({ key }) => key === entry.key,
			);
			if (index === -1) catalogEntries.push(entry);
			else catalogEntries[index] = entry;
			for (const candidate of catalogEntries) {
				candidate.hasChildren = catalogEntries.some(
					(child) =>
						!child.deleted &&
						child.sourceConnectionKey ===
							candidate.sourceConnectionKey &&
						child.parentCollection === candidate.key,
				);
			}
		},
		setEditing(value: boolean) {
			editing = value;
		},
	};
}

test("logs in with Enter, keeps the session, and logs out", async ({
	page,
}) => {
	test.setTimeout(90_000);
	await mockPublishedBook(page);
	await page.context().clearCookies();
	await page.goto("/admin");

	const password = page.getByLabel("Admin password");
	await expect(password).toBeVisible();
	await password.fill("wrong password");
	await password.press("Enter");
	await expect(page.getByRole("alert")).toHaveText(
		"That password is not correct.",
	);

	await password.fill(adminPassword);
	await password.press("Enter");
	await expect(
		page.getByRole("textbox", { name: "Search records" }),
	).toBeVisible();
	await page.reload();
	await expect(
		page.getByRole("textbox", { name: "Search records" }),
	).toBeVisible();

	await page.getByRole("button", { name: "Log out" }).click();
	await expect(page.getByLabel("Admin password")).toBeVisible();
});

test("edits an imported record and shows its writeback lifecycle", async ({
	page,
}) => {
	await mockCompletedIndexing(page);
	await mockPublishedBook(page, {
		additionalSources: [importedSource],
		listRowOverrides: { sourceConnectionKey: importedSource.key },
	});
	let editing = false;
	let draftRevision = 1;
	let revision = 7;
	let writebackStarted = false;
	let forceFailure = false;
	let retryRequests = 0;
	let statusRequests = 0;
	let draftPayload = structuredClone(publishedPayload);
	const draft = () => ({
		baseRevision: revision,
		createdAt: timestamp,
		draftRevision,
		itemKey: publishedItemKey,
		patch: {},
		payload: draftPayload,
		sourceConnectionKey: importedSource.key,
		updatedAt: timestamp,
	});
	const detail = () => ({
		...publishedDetail(editing, draftPayload, draftRevision),
		draft: editing ? draft() : null,
		editable: true,
		revision,
		sourceConnectionKey: importedSource.key,
		state: editing ? "edited" : "published",
		title: String(draftPayload.title),
		writeback: {
			effective: true,
			itemEnabled: true,
			reason: "ok",
			sourceEnabled: true,
			sourceKey: importedSource.key,
			sourceLabel: importedSource.label,
			sourceStatus: "active",
			supported: true,
		},
	});

	await page.route(
		`**/api/admin/items/${publishedItemKey}/writeback/status`,
		async (route) => {
			const states = ["queued", "sending", "synced"] as const;
			const state = forceFailure
				? "failed"
				: writebackStarted
					? states[Math.min(statusRequests++, states.length - 1)]
					: "synced";
			await route.fulfill({
				json: {
					status: {
						attempts: 0,
						canonicalRevision: revision,
						error: forceFailure
							? "Zotero rejected the update."
							: null,
						jobId: 91,
						nextAttemptAt: timestamp,
						processedAt: state === "synced" ? timestamp : null,
						sourceKey: importedSource.key,
						state,
					},
				},
			});
		},
	);
	await page.route(
		`**/api/admin/items/${publishedItemKey}/writeback/retry`,
		async (route) => {
			retryRequests += 1;
			forceFailure = false;
			writebackStarted = true;
			statusRequests = 1;
			await route.fulfill({
				json: {
					status: {
						attempts: 0,
						canonicalRevision: revision,
						error: null,
						jobId: 91,
						nextAttemptAt: timestamp,
						processedAt: null,
						sourceKey: importedSource.key,
						state: "queued",
					},
				},
			});
		},
	);
	await page.route(
		`**/api/admin/items/${publishedItemKey}/draft`,
		async (route) => {
			if (route.request().method() === "POST") {
				editing = true;
				await route.fulfill({ json: { draft: draft() } });
				return;
			}
			if (route.request().method() === "PUT") {
				draftPayload = route.request().postDataJSON().payload;
				draftRevision += 1;
				await route.fulfill({ json: { draft: draft() } });
				return;
			}
			await route.fulfill({ status: 405 });
		},
	);
	await page.route(
		`**/api/admin/items/${publishedItemKey}/publish`,
		async (route) => {
			editing = false;
			revision += 1;
			writebackStarted = true;
			statusRequests = 0;
			await route.fulfill({
				json: { indexingReceipts: [], item: draftPayload },
			});
		},
	);
	await page.route(`**/api/admin/items/${publishedItemKey}`, async (route) =>
		route.fulfill({ json: { item: detail() } }),
	);

	await page.goto("/admin");
	await expect(
		page.getByRole("button", { name: `${importedSource.label}: Synced` }),
	).toBeVisible();
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	const title = page.getByRole("textbox", { name: "Title", exact: true });
	await expect(title).toBeEnabled();
	await title.fill("Imported edit for writeback");
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Publish", exact: true }).click();

	const status = page.locator("[data-admin-writeback-status]");
	await expect(status).toHaveAttribute(
		"data-admin-writeback-status",
		"queued",
	);
	await expect(status).toHaveAttribute(
		"data-admin-writeback-status",
		"sending",
		{ timeout: 5_000 },
	);
	await expect(status).toHaveAttribute(
		"data-admin-writeback-status",
		"synced",
		{ timeout: 5_000 },
	);

	await status.click();
	const popover = page.locator("[data-admin-writeback-popover]");
	await expect(popover).toBeVisible();
	const geometry = await popover.evaluate((element) => {
		const content = element.firstElementChild as HTMLElement;
		const inner = content.firstElementChild as HTMLElement;
		const chip = document.querySelector<HTMLElement>(
			"[data-admin-writeback-status]",
		)!;
		const icon = chip.querySelector("svg")!;
		return {
			chipHeight: getComputedStyle(chip).height,
			iconHeight: getComputedStyle(icon).height,
			innerPadding: [
				getComputedStyle(inner).paddingTop,
				getComputedStyle(inner).paddingRight,
				getComputedStyle(inner).paddingBottom,
				getComputedStyle(inner).paddingLeft,
			],
			width: getComputedStyle(content).width,
		};
	});
	expect(geometry).toEqual({
		chipHeight: "24px",
		iconHeight: "12px",
		innerPadding: ["12px", "12px", "12px", "12px"],
		width: "256px",
	});

	forceFailure = true;
	writebackStarted = false;
	await page.reload();
	const failedStatus = page.locator('[data-admin-writeback-status="failed"]');
	await expect(failedStatus).toBeVisible();
	await failedStatus.click();
	await expect(page.getByText("Zotero rejected the update.")).toBeVisible();
	await page
		.getByRole("button", { name: "Retry writeback", exact: true })
		.click();
	await expect.poll(() => retryRequests).toBe(1);
	await expect(page.locator("[data-admin-writeback-status]")).toHaveAttribute(
		"data-admin-writeback-status",
		"synced",
		{ timeout: 5_000 },
	);
});

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
		const resultsScroll = element.querySelector<HTMLElement>(
			"[data-admin-collection-picker-scroll]",
		)!;
		const resultsStyle = getComputedStyle(resultsScroll);
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

test("assigns writable Zotero records to native or own-source collections", async ({
	page,
}) => {
	let batchRequest:
		{ action: string; collectionKey?: string; keys: string[] } | undefined;
	const writableSource: AdminSource = {
		...importedSource,
		readOnly: false,
	};
	const unrelatedSource: AdminSource = {
		...writableSource,
		key: "zotero-unrelated",
		label: "Unrelated Zotero",
	};
	const unrelatedCollection: AdminCollectionCatalogEntry = {
		...importedCollection,
		key: "OTHER234",
		name: "Unrelated collection",
		sourceConnectionKey: unrelatedSource.key,
	};
	await mockPublishedBook(page, {
		additionalCollectionEntries: [importedCollection, unrelatedCollection],
		additionalSources: [writableSource, unrelatedSource],
		listRowOverrides: {
			sourceConnectionKey: writableSource.key,
		},
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
	await expect(
		dialog.getByRole("button", {
			name: `Select ${importedCollection.name}, ${writableSource.label}`,
		}),
	).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "Choose source" }),
	).toBeVisible();
	await dialog.getByRole("button", { name: "Choose source" }).click();
	await expect(
		dialog.getByRole("button", { name: "Native", exact: true }),
	).toBeVisible();
	await expect(
		dialog.getByRole("button", {
			name: writableSource.label,
			exact: true,
		}),
	).toBeVisible();
	await expect(
		dialog.getByRole("button", {
			name: unrelatedSource.label,
			exact: true,
		}),
	).toHaveCount(0);
	await dialog.getByRole("button", { name: "Native", exact: true }).click();
	await expect(
		dialog.getByRole("button", {
			name: `Select ${teacherCollection.name}, Native`,
		}),
	).toBeVisible();
	await dialog
		.getByRole("button", {
			name: `Select ${teacherCollection.name}, Native`,
		})
		.click();

	await expect
		.poll(() => batchRequest)
		.toEqual({
			action: "assignCollection",
			collectionKey: teacherCollection.key,
			keys: [publishedItemKey],
		});
});

test("keeps collection results stable and inactive while browsing", async ({
	page,
}) => {
	const parent: AdminCollectionCatalogEntry = {
		ancestors: [],
		deleted: false,
		hasChildren: true,
		key: "PARENT01",
		name: "Browse parent",
		parentCollection: null,
		revision: 1,
		sortOrder: 2,
		sourceConnectionKey: "native",
		updatedAt: timestamp,
	};
	const child: AdminCollectionCatalogEntry = {
		ancestors: [{ key: parent.key, name: parent.name }],
		deleted: false,
		hasChildren: false,
		key: "CHILD001",
		name: "Loaded child",
		parentCollection: parent.key,
		revision: 1,
		sortOrder: 0,
		sourceConnectionKey: "native",
		updatedAt: timestamp,
	};
	let releaseChildPage: () => void = () => {};
	const childPageRelease = new Promise<void>((resolve) => {
		releaseChildPage = resolve;
	});
	let markChildRequestStarted: () => void = () => {};
	const childRequestStarted = new Promise<void>((resolve) => {
		markChildRequestStarted = resolve;
	});
	await mockPublishedBook(page, {
		additionalCollectionEntries: [parent, child],
		beforeCollectionPageResponse: async (request) => {
			if (request.searchParams.get("parent") !== parent.key) return;
			markChildRequestStarted();
			await childPageRelease;
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
	const results = dialog.locator("[data-admin-collection-picker-results]");
	const content = results.locator("[data-admin-collection-picker-content]");
	await expect(content.getByText(parent.name, { exact: true })).toBeVisible();
	await expect(results).toHaveAttribute("aria-busy", "false");
	await expect(content).toHaveCSS("opacity", "1");
	await expect(
		content.getByRole("button", {
			name: `Select ${parent.name}, Native`,
		}),
	).toBeVisible();
	const heightBefore = await results.evaluate((element) =>
		Number.parseFloat(getComputedStyle(element).height),
	);

	await dialog
		.getByRole("button", {
			name: `Open ${parent.name}, Native`,
		})
		.click();
	await childRequestStarted;

	await expect(results).toHaveAttribute("aria-busy", "true");
	await expect(content).toHaveAttribute("inert", "");
	await expect(content).toHaveCSS("opacity", "0.4");
	await expect(
		dialog.getByRole("textbox", { name: "Search collections" }),
	).toBeDisabled();
	await expect(
		dialog.getByRole("button", { name: "Native", exact: true }),
	).toBeDisabled();
	await expect(content.getByText(parent.name, { exact: true })).toBeVisible();
	await expect(
		results.getByRole("status", { name: "Loading collections" }),
	).toBeVisible();
	const loadingGeometry = await results.evaluate((element) => {
		const contentElement = element.querySelector<HTMLElement>(
			"[data-admin-collection-picker-content]",
		)!;
		const indicator = element.querySelector<HTMLElement>(
			'[role="status"][aria-label="Loading collections"]',
		)!;
		const spinner = indicator.querySelector("svg")!;
		const scroll = element.querySelector<HTMLElement>(
			"[data-admin-collection-picker-scroll]",
		)!;
		const contentStyle = getComputedStyle(contentElement);
		const spinnerStyle = getComputedStyle(spinner);
		return {
			height: Number.parseFloat(getComputedStyle(element).height),
			indicatorAnchoredToWrapper:
				indicator.parentElement?.parentElement === element,
			indicatorVisible: indicator.getBoundingClientRect().height > 0,
			opacity: contentStyle.opacity,
			pointerEvents: contentStyle.pointerEvents,
			scrollOverflowY: getComputedStyle(scroll).overflowY,
			spinnerHeight: Number.parseFloat(spinnerStyle.height),
			spinnerWidth: Number.parseFloat(spinnerStyle.width),
		};
	});
	expect(loadingGeometry).toEqual({
		height: heightBefore,
		indicatorAnchoredToWrapper: true,
		indicatorVisible: true,
		opacity: "0.4",
		pointerEvents: "none",
		scrollOverflowY: "auto",
		spinnerHeight: 14,
		spinnerWidth: 14,
	});

	releaseChildPage();
	await expect(
		dialog.getByRole("button", {
			name: `Select ${child.name}, Native › ${parent.name}`,
		}),
	).toBeVisible();
	await expect(results).toHaveAttribute("aria-busy", "false");
	await expect(content).not.toHaveAttribute("inert");
	const currentBreadcrumb = dialog
		.locator('[aria-current="page"]')
		.filter({ hasText: parent.name });
	await expect(currentBreadcrumb).toHaveCount(1);
	expect(await currentBreadcrumb.evaluate((element) => element.tagName)).toBe(
		"SPAN",
	);
	await expect(
		dialog.getByRole("button", { name: parent.name, exact: true }),
	).toHaveCount(0);
});

test("uses the same collection traversal model for multi-select", async ({
	page,
}) => {
	const parent: AdminCollectionCatalogEntry = {
		ancestors: [],
		deleted: false,
		hasChildren: true,
		key: "MULTIP01",
		name: "Multi parent",
		parentCollection: null,
		revision: 1,
		sortOrder: 2,
		sourceConnectionKey: "native",
		updatedAt: timestamp,
	};
	const child: AdminCollectionCatalogEntry = {
		ancestors: [{ key: parent.key, name: parent.name }],
		deleted: false,
		hasChildren: false,
		key: "MULTIC01",
		name: "Multi child",
		parentCollection: parent.key,
		revision: 1,
		sortOrder: 0,
		sourceConnectionKey: "native",
		updatedAt: timestamp,
	};
	const extraSources: AdminSource[] = Array.from(
		{ length: 12 },
		(_, index) => ({
			key: `multi-source-${index}`,
			label: `Multi source ${index + 1}`,
			provider: "zotero",
			readOnly: true,
			status: "active",
			writeback: { enabled: true, supported: true },
		}),
	);
	let delayPickerRoot = false;
	let releaseSourcePage: () => void = () => {};
	const sourcePageRelease = new Promise<void>((resolve) => {
		releaseSourcePage = resolve;
	});
	let markSourceRequestStarted: () => void = () => {};
	const sourceRequestStarted = new Promise<void>((resolve) => {
		markSourceRequestStarted = resolve;
	});
	await mockPublishedBook(page, {
		additionalCollectionEntries: [parent, child],
		additionalSources: extraSources,
		beforeCollectionPageResponse: async (request) => {
			if (
				!delayPickerRoot ||
				request.searchParams.get("parent") !== "root" ||
				request.searchParams.get("pageSize") !== "50"
			)
				return;
			markSourceRequestStarted();
			await sourcePageRelease;
		},
	});

	await page.goto("/admin");
	await page.getByRole("button", { name: "Filters", exact: true }).click();
	const filters = page.getByRole("dialog", { name: "Filter records" });
	const noFilters = filters.getByText("No filters yet", { exact: true });
	await expect(noFilters).toBeVisible();
	await expect(noFilters.locator("..").locator("svg")).toHaveCount(0);
	await filters.locator('button[aria-label="Add filter"]').click();
	await page
		.getByRole("option", { name: "Collections", exact: true })
		.click();
	await filters.getByRole("button", { name: "Collection values" }).click();
	const picker = filters.locator("[data-admin-collection-filter-picker]");
	const sources = picker.locator("[data-admin-collection-picker-sources]");
	const sourceScroll = sources.locator(
		"[data-admin-collection-picker-source-scroll]",
	);
	const sourceHeight = await sources.evaluate((element) =>
		Number.parseFloat(getComputedStyle(element).height),
	);
	const sourceScrollTop = await sourceScroll.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
		return element.scrollTop;
	});
	expect(sourceScrollTop).toBeGreaterThan(0);
	delayPickerRoot = true;
	await picker
		.getByRole("button", { name: "Native", exact: true })
		.evaluate((element) => (element as HTMLButtonElement).click());
	await sourceRequestStarted;
	await expect(sources).toHaveAttribute("aria-busy", "true");
	await expect(
		picker.getByRole("textbox", { name: "Search collections" }),
	).toBeDisabled();
	await expect(
		sources.locator("[data-admin-collection-picker-source-content]"),
	).toHaveAttribute("inert", "");
	await expect(
		sources.getByRole("status", { name: "Loading collections" }),
	).toBeVisible();
	const sourceLoadingGeometry = await sources.evaluate((element) => {
		const indicator = element.querySelector<HTMLElement>(
			'[role="status"][aria-label="Loading collections"]',
		)!;
		const scroll = element.querySelector<HTMLElement>(
			"[data-admin-collection-picker-source-scroll]",
		)!;
		const indicatorRect = indicator.getBoundingClientRect();
		const wrapperRect = element.getBoundingClientRect();
		return {
			height: Number.parseFloat(getComputedStyle(element).height),
			indicatorInsideViewport:
				indicatorRect.top >= wrapperRect.top &&
				indicatorRect.bottom <= wrapperRect.bottom,
			scrollTop: scroll.scrollTop,
		};
	});
	expect(sourceLoadingGeometry).toEqual({
		height: sourceHeight,
		indicatorInsideViewport: true,
		scrollTop: sourceScrollTop,
	});
	await expect(
		picker.locator("[data-admin-collection-picker-results]"),
	).toHaveCount(0);
	releaseSourcePage();

	await expect(
		picker.getByRole("button", {
			name: `Select ${parent.name}, Native`,
		}),
	).toBeVisible();
	await picker
		.getByRole("button", { name: `Open ${parent.name}, Native` })
		.click();
	const childSelection = picker.getByRole("button", {
		name: new RegExp(
			`^(Select|Deselect) ${child.name}, Native › ${parent.name}$`,
			"u",
		),
	});
	await expect(childSelection).toBeVisible();
	await childSelection.click();
	await expect(childSelection).toHaveAttribute("aria-pressed", "true");
	await expect(
		picker.getByRole("button", {
			name: new RegExp(`Remove ${child.name}`, "u"),
		}),
	).toBeVisible();
});

test("creates a collection in a searched location without a full-list select", async ({
	page,
}) => {
	let createRequest: Record<string, unknown> | undefined;
	const receipt = indexingReceipt("NEWCALL2", "collection", 1);
	await mockPublishedBook(page);
	const indexing = await mockCompletedIndexing(page);
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
					key: "NEWCALL2",
					name: "Nested collection",
					parentCollection: longCollection.key,
				},
				indexingReceipts: [receipt],
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
	await dialog.getByRole("textbox", { name: "Name" }).press("Enter");
	await expect
		.poll(() => createRequest)
		.toEqual({
			name: "Nested collection",
			parentCollection: longCollection.key,
			sourceConnectionKey: "native",
		});
	await indexing.expectTracked(receipt);
});

test("creates and renames collections in an editable Zotero source", async ({
	page,
}) => {
	const editableImportedSource = { ...importedSource, readOnly: false };
	let createRequest: Record<string, unknown> | undefined;
	let renameRequest: Record<string, unknown> | undefined;
	const catalog = await mockPublishedBook(page, {
		additionalCollectionEntries: [importedCollection],
		additionalSources: [editableImportedSource],
	});
	await mockCompletedIndexing(page);
	await page.route("**/api/admin/collections", async (route) => {
		if (route.request().method() !== "POST") {
			await route.fallback();
			return;
		}
		createRequest = route.request().postDataJSON() as Record<
			string,
			unknown
		>;
		const created = {
			...importedCollection,
			ancestors: [
				{ key: importedCollection.key, name: importedCollection.name },
			],
			key: "REMOTE02",
			name: "Remote child",
			parentCollection: importedCollection.key,
			revision: 1,
		};
		catalog.replaceCollection(created);
		await route.fulfill({
			json: { collection: created, indexingReceipts: [] },
			status: 201,
		});
	});
	await page.route("**/api/admin/collections/IMPORT01", async (route) => {
		if (route.request().method() !== "PATCH") {
			await route.fallback();
			return;
		}
		renameRequest = route.request().postDataJSON() as Record<
			string,
			unknown
		>;
		const renamed = {
			...importedCollection,
			name: "Renamed remote collection",
			revision: 2,
		};
		catalog.replaceCollection(renamed);
		await route.fulfill({
			json: { collection: renamed, indexingReceipts: [] },
		});
	});

	const sourceFilters = JSON.stringify([
		{
			column: "source",
			operator: "anyOf",
			value: [editableImportedSource.key],
		},
	]);
	await page.goto(`/admin?filters=${encodeURIComponent(sourceFilters)}`);
	await expect(
		page.getByRole("button", {
			name: editableImportedSource.label,
		}),
	).toHaveAttribute("aria-pressed", "true");
	await page.getByRole("button", { name: "New", exact: true }).click();
	let dialog = page.getByRole("dialog", { name: "New collection" });
	await expect(
		dialog.getByRole("button", {
			name: `Change location, current Top level, ${editableImportedSource.label}`,
		}),
	).toBeVisible();
	await dialog.getByRole("button", { name: "Cancel" }).click();

	await page
		.getByRole("treeitem", { name: editableImportedSource.label })
		.click();
	const remoteRow = page.locator(
		`[data-collection-key="${importedCollection.key}"]`,
	);
	await expect(remoteRow).toBeVisible();
	await remoteRow.hover();
	await remoteRow
		.getByRole("button", { name: `Manage ${importedCollection.name}` })
		.click();
	await page.getByRole("menuitem", { name: "New inside" }).click();
	dialog = page.getByRole("dialog", { name: "New collection" });
	await dialog.getByRole("textbox", { name: "Name" }).fill("Remote child");
	await dialog.getByRole("textbox", { name: "Name" }).press("Enter");
	await expect
		.poll(() => createRequest)
		.toEqual({
			name: "Remote child",
			parentCollection: importedCollection.key,
			sourceConnectionKey: editableImportedSource.key,
		});

	await expect(remoteRow).toBeVisible();
	await remoteRow.hover();
	await remoteRow
		.getByRole("button", { name: `Manage ${importedCollection.name}` })
		.click();
	await page.getByRole("menuitem", { name: "Rename" }).click();
	dialog = page.getByRole("dialog", { name: "Rename collection" });
	await dialog
		.getByRole("textbox", { name: "Name" })
		.fill("Renamed remote collection");
	await dialog.getByRole("textbox", { name: "Name" }).press("Enter");
	await expect
		.poll(() => renameRequest)
		.toEqual({
			expectedRevision: importedCollection.revision,
			name: "Renamed remote collection",
		});
});

test("moves a collection to a searched destination at the end", async ({
	page,
}) => {
	let moveRequest: Record<string, unknown> | undefined;
	const receipt = indexingReceipt("TEACHDEV", "collection", 2);
	await mockPublishedBook(page);
	const indexing = await mockCompletedIndexing(page);
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
					indexingReceipts: [receipt],
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
			expectedRevision: teacherCollection.revision,
			position: "inside",
			targetCollection: longCollection.key,
		});
	await indexing.expectTracked(receipt);
});

test("switches the admin workbench between light and dark themes", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await mockPublishedBook(page);
	await page.goto("/admin");

	await expect
		.poll(() =>
			page.evaluate(() =>
				document.documentElement.classList.contains("dark"),
			),
		)
		.toBe(true);
	const switcher = page.getByRole("button", {
		name: /Switch to light(?: mode)?/u,
	});
	await expect(switcher).toBeVisible();
	await switcher.click();
	await expect
		.poll(() =>
			page.evaluate(() =>
				document.documentElement.classList.contains("dark"),
			),
		)
		.toBe(false);
	await expect(
		page.getByRole("button", { name: /Switch to dark(?: mode)?/u }),
	).toBeVisible();
});

test("persists advanced typed filters in the URL", async ({ page }) => {
	test.setTimeout(45_000);
	const listRequests: URL[] = [];
	await mockPublishedBook(page, {
		onListRequest: (url) => listRequests.push(url),
	});
	const measureFilterTrigger = () =>
		page.locator("[data-admin-filter-trigger]").evaluate((trigger) => {
			const colorChannels = (value: string) =>
				(value.match(/[\d.]+/gu) ?? []).slice(0, 3).map(Number);
			const sameChannels = (left: string, right: string) =>
				colorChannels(left).every(
					(channel, index) => channel === colorChannels(right)[index],
				);
			const icon = trigger.querySelector<HTMLElement>(
				"[data-admin-filter-trigger-icon]",
			)!;
			const count = trigger.querySelector<HTMLElement>(
				"[data-admin-filter-trigger-count]",
			);
			const glyph = trigger.querySelector<SVGElement>(
				"[data-admin-filter-trigger-glyph]",
			)!;
			const rootStyle = getComputedStyle(document.documentElement);
			const accent = `rgb(${rootStyle.getPropertyValue("--color-accent-500").trim().replaceAll(" ", ", ")})`;
			const triggerStyle = getComputedStyle(trigger);
			const iconRect = icon.getBoundingClientRect();
			return {
				active: trigger.getAttribute("data-active"),
				backgroundIsTransparent:
					triggerStyle.backgroundColor === "rgba(0, 0, 0, 0)",
				backgroundUsesAccent: sameChannels(
					triggerStyle.backgroundColor,
					accent,
				),
				borderUsesAccent: sameChannels(
					triggerStyle.borderColor,
					accent,
				),
				borderWidth: triggerStyle.borderWidth,
				countFontWeight: count
					? Number(getComputedStyle(count).fontWeight)
					: null,
				glyph: glyph.getAttribute("data-admin-filter-trigger-glyph"),
				height: trigger.getBoundingClientRect().height,
				iconSize: [iconRect.width, iconRect.height],
				padding: triggerStyle.padding,
				width: trigger.getBoundingClientRect().width,
			};
		});

	await page.goto("/admin");
	expect(await measureFilterTrigger()).toEqual({
		active: "false",
		backgroundIsTransparent: false,
		backgroundUsesAccent: false,
		borderUsesAccent: false,
		borderWidth: "1px",
		countFontWeight: null,
		glyph: "list-filter",
		height: 40,
		iconSize: [17, 17],
		padding: "0px",
		width: 40,
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
	expect(await measureFilterTrigger()).toEqual({
		active: "true",
		backgroundIsTransparent: false,
		backgroundUsesAccent: true,
		borderUsesAccent: true,
		borderWidth: "1px",
		countFontWeight: 700,
		glyph: "list-filter",
		height: 40,
		iconSize: [17, 17],
		padding: "0px",
		width: 40,
	});
	await expect
		.poll(() => listRequests.at(-1)?.searchParams.get("search"))
		.toBe("teacher");

	await page
		.getByRole("button", { name: "Filters, 1 active", exact: true })
		.click();
	await expect(page.locator("[data-admin-filter-trigger]")).toHaveAttribute(
		"aria-expanded",
		"true",
	);
	const dialog = page.getByRole("dialog", { name: "Filter records" });
	const filterGeometry = await dialog.evaluate((element) => {
		const surface = element.querySelector<HTMLElement>(
			"[data-slot=content]",
		)!;
		const scroll = element.querySelector<HTMLElement>(
			"[data-admin-filter-scroll]",
		)!;
		const list = element.querySelector<HTMLElement>(
			"[data-admin-filter-list]",
		)!;
		const row = element.querySelector<HTMLElement>(
			"[data-admin-filter-row]",
		)!;
		const rect = surface.getBoundingClientRect();
		const scrollRect = scroll.getBoundingClientRect();
		const listRect = list.getBoundingClientRect();
		const rowRect = row.getBoundingClientRect();
		const style = getComputedStyle(surface);
		const listStyle = getComputedStyle(list);
		return {
			boxSizing: style.boxSizing,
			contentGaps: [
				rowRect.top - listRect.top,
				rowRect.left - listRect.left,
				listRect.bottom - rowRect.bottom,
				listRect.right - rowRect.right,
			],
			left: rect.left,
			listPadding: [
				listStyle.paddingTop,
				listStyle.paddingRight,
				listStyle.paddingBottom,
				listStyle.paddingLeft,
			],
			right: rect.right,
			scrollInsets: [
				scrollRect.left - rect.left,
				rect.right - scrollRect.right,
			],
			width: rect.width,
		};
	});
	expect(filterGeometry).toMatchObject({
		boxSizing: "border-box",
		contentGaps: [8, 8, 8, 8],
		listPadding: ["8px", "8px", "8px", "8px"],
		scrollInsets: [1, 1],
		width: 420,
	});
	expect(filterGeometry.left).toBeGreaterThanOrEqual(12);
	expect(filterGeometry.right).toBeLessThanOrEqual(
		await page.evaluate(() => window.innerWidth - 12),
	);
	await dialog.getByRole("button", { name: "Clear", exact: true }).click();
	await expect
		.poll(() =>
			dialog
				.locator("[data-slot=content]")
				.evaluate((element) => element.getBoundingClientRect().width),
		)
		.toBe(420);
	await dialog.locator('button[aria-label="Add filter"]').click();
	await page
		.getByRole("option", { name: "Title", exact: true })
		.press("Enter");
	await expect(
		dialog.locator('button[aria-label="Filter 1 field"]'),
	).toContainText("Title");
	await expect
		.poll(() =>
			dialog
				.locator("[data-slot=content]")
				.evaluate((element) => element.getBoundingClientRect().width),
		)
		.toBe(420);
	await dialog.getByRole("textbox", { name: "Title value" }).fill("evidence");
	await dialog.getByRole("textbox", { name: "Title value" }).press("Enter");

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
	const extraSources: AdminSource[] = Array.from(
		{ length: 12 },
		(_, index) => ({
			key: `source-${index}`,
			label: `Source ${index + 1}`,
			provider: "zotero",
			readOnly: true,
			status: "active",
			writeback: { enabled: true, supported: true },
		}),
	);
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
	const sourceList = picker.locator("[data-admin-collection-picker-sources]");
	const sourceGeometry = await sourceList
		.locator("[data-admin-collection-picker-source-scroll]")
		.evaluate((element) => ({
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
	const native = picker.getByRole("button", {
		name: /^(Select|Deselect) Teacher development/u,
	});
	await native.click();
	const removeNative = picker.getByRole("button", {
		name: /Remove Teacher development/u,
	});
	await expect(removeNative).toBeVisible();
	await removeNative.click();
	await expect(native).toHaveAttribute("aria-pressed", "false");
	await native.click();

	await search.fill("imported");
	await expect
		.poll(() => collectionSearches.at(-1)?.searchParams.get("query"))
		.toBe("imported");
	const imported = picker.getByRole("button", {
		name: /^(Select|Deselect) Imported research/u,
	});
	await imported.click();
	const removeImported = picker.getByRole("button", {
		name: /Remove Imported research/u,
	});
	await expect(removeImported).toBeVisible();
	await removeImported.click();
	await expect(imported).toHaveAttribute("aria-pressed", "false");
	await imported.click();
	await expect(removeImported).toBeVisible();

	const geometry = await dialog.evaluate((element) => {
		const filterPicker = element.querySelector<HTMLElement>(
			"[data-admin-collection-filter-picker]",
		)!;
		const results = element.querySelector<HTMLElement>(
			"[data-admin-collection-picker-scroll]",
		)!;
		const rect = element.getBoundingClientRect();
		const pickerRect = filterPicker.getBoundingClientRect();
		const footer = element.lastElementChild!.getBoundingClientRect();
		return {
			dialogBottom: rect.bottom,
			dialogHeight: rect.height,
			dialogWidth: rect.width,
			documentOverflow:
				document.documentElement.scrollWidth - window.innerWidth,
			pickerInside:
				pickerRect.left >= rect.left && pickerRect.right <= rect.right,
			footerInsideViewport:
				footer.top >= 0 && footer.bottom <= window.innerHeight,
			resultsMaxHeight: Number.parseFloat(
				getComputedStyle(results).maxHeight,
			),
		};
	});
	expect(geometry).toMatchObject({
		documentOverflow: 0,
		footerInsideViewport: true,
		pickerInside: true,
	});
	expect(geometry.dialogBottom).toBeLessThanOrEqual(420);
	expect(geometry.dialogHeight).toBeLessThanOrEqual(348);
	expect(geometry.dialogWidth).toBeLessThanOrEqual(560);
	expect(geometry.resultsMaxHeight).toBeLessThanOrEqual(320);
	const apply = dialog.getByRole("button", { name: "Apply", exact: true });
	await apply.click();
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

test("toggles collection filters directly from the catalogue", async ({
	page,
}) => {
	const listRequests: URL[] = [];
	await mockPublishedBook(page, {
		onListRequest: (url) => listRequests.push(url),
	});
	await page.goto("/admin");

	await expect(
		page.getByRole("button", { name: "All collections", exact: true }),
	).toHaveCount(0);
	const collection = page
		.locator('[data-collection-key="TEACHDEV"]')
		.getByRole("treeitem");
	await expect(collection).toHaveAttribute("aria-selected", "false");
	await collection.click();
	await expect(collection).toHaveAttribute("aria-selected", "true");
	await expect(
		page.getByRole("button", { name: "Filters, 1 active", exact: true }),
	).toBeVisible();
	await expect
		.poll(() => {
			const filters = new URL(page.url()).searchParams.get("filters");
			return filters ? JSON.parse(filters) : null;
		})
		.toEqual([
			{
				column: "collections",
				operator: "anyOf",
				value: [teacherCollection.key],
			},
		]);

	await collection.click();
	await expect(collection).toHaveAttribute("aria-selected", "false");
	await expect(
		page.getByRole("button", { name: "Filters", exact: true }),
	).toBeVisible();
	await expect
		.poll(() => new URL(page.url()).searchParams.get("filters"))
		.toBeNull();
	await expect
		.poll(() => {
			const filters = listRequests.at(-1)?.searchParams.get("filters");
			return filters ? JSON.parse(filters) : null;
		})
		.toEqual([]);
});

async function mockBookWithAttachment(
	page: Page,
	options: { attachmentState?: "draft" | "published" } = {},
) {
	const attachmentKey = "PDFATT22";
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

async function expectFullCollectionDropHighlight(
	page: Page,
	target: Locator,
	collectionKey: string,
) {
	const highlightedRow = page.locator(
		`[data-collection-drop-highlight="${collectionKey}"]`,
	);
	await expect(highlightedRow).toBeVisible();
	await expect(highlightedRow).toHaveAttribute(
		"data-collection-key",
		collectionKey,
	);
	const [dropTargetBox, highlightedRowBox, computedStyle] = await Promise.all(
		[
			target.boundingBox(),
			highlightedRow.boundingBox(),
			highlightedRow.evaluate((element) => {
				const style = window.getComputedStyle(element);
				return {
					backgroundColor: style.backgroundColor,
					borderRadius: style.borderRadius,
					boxShadow: style.boxShadow,
				};
			}),
		],
	);
	expect(dropTargetBox?.height).toBeLessThan(highlightedRowBox?.height ?? 0);
	expect(computedStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
	expect(computedStyle.borderRadius).toBe("8px");
	expect(computedStyle.boxShadow).not.toBe("none");
}

test.skip(
	Boolean(process.env.PLAYWRIGHT_BASE_URL) &&
		process.env.PLAYWRIGHT_ADMIN_UI !== "true",
	"External targets must explicitly confirm that the admin UI is enabled.",
);

test("creates an item through a pointer click in the new-item popover", async ({
	page,
}) => {
	let submittedPayload: unknown;

	await page.route("**/api/admin/**", async (route) => {
		const request = route.request();
		const pathname = new URL(request.url()).pathname;

		if (pathname === "/api/admin/library") {
			await route.fulfill({
				json: { sources: [] },
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

	const popover = page.getByRole("dialog", { name: "New item" });
	await expect(popover).toBeVisible();
	await expect(
		popover.getByRole("textbox", { name: "Find an item type" }),
	).toBeFocused();
	await expect
		.poll(() =>
			popover.evaluate(
				(element) => element.getBoundingClientRect().width,
			),
		)
		.toBeLessThanOrEqual(321);
	await expect
		.poll(() =>
			popover.evaluate(
				(element) => element.getBoundingClientRect().width,
			),
		)
		.toBeGreaterThanOrEqual(319);
	const popoverGeometry = await popover.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		return {
			boxSizing: style.boxSizing,
			left: rect.left,
			right: rect.right,
			width: rect.width,
		};
	});
	expect(popoverGeometry.boxSizing).toBe("border-box");
	expect(popoverGeometry.width).toBeLessThanOrEqual(321);
	expect(popoverGeometry.left).toBeGreaterThanOrEqual(12);
	expect(popoverGeometry.right).toBeLessThanOrEqual(
		await page.evaluate(() => window.innerWidth - 12),
	);
	await popover.getByRole("button", { name: "Book", exact: true }).click();

	await expect(popover).toBeHidden();
	expect(submittedPayload).toEqual({
		collections: [],
		creators: [],
		itemType: "book",
		tags: [],
	});
});

test("shows inspector empty values as text without decorative icons", async ({
	page,
}) => {
	await mockPublishedBook(page);
	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");

	for (const label of ["No tags", "No collections", "No attachments"]) {
		const emptyValue = inspector.getByText(label, { exact: true });
		await expect(emptyValue).toBeVisible();
		await expect(emptyValue.locator("..").locator("svg")).toHaveCount(0);
	}
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
		await mockPublicShell(page);
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

test("uses date, URL, and identifier controls that match the metadata", async ({
	page,
}) => {
	const savedDrafts: Record<string, unknown>[] = [];
	await mockPublishedBook(page, {
		onDraftSave: (payload) => savedDrafts.push(structuredClone(payload)),
	});
	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", { name: "Edit" }).click();

	const url = inspector.getByLabel("URL", { exact: true });
	const doi = inspector.getByLabel("DOI", { exact: true });
	await expect(url).toHaveAttribute("type", "url");
	await expect(doi).toHaveAttribute("data-field-kind", "doi");

	const itemType = inspector.getByRole("combobox", { name: "Item type" });
	await itemType.fill("Case");
	await page.getByRole("option", { name: "Case", exact: true }).click();
	await expect(
		inspector.getByLabel("Case Name", { exact: true }),
	).toBeVisible();
	await expect(inspector.getByRole("status")).toHaveText("Saved");

	const precision = inspector.getByRole("combobox", {
		name: "Date Decided precision",
	});
	await expect(precision.locator("option")).toHaveText([
		"Exact date",
		"Year",
	]);
	await precision.selectOption("year");
	const decided = inspector.getByLabel("Date Decided", { exact: true });
	await expect(decided).toHaveAttribute("type", "number");
	await expect(decided).toHaveAttribute("inputmode", "numeric");
	await decided.fill("2024");
	await expect
		.poll(() =>
			savedDrafts.some((payload) => payload.dateDecided === "2024"),
		)
		.toBe(true);
});

test("shows draft differences with the published value and a revert action", async ({
	page,
}) => {
	const savedDrafts: Record<string, unknown>[] = [];
	await mockPublishedBook(page, {
		onDraftSave: (payload) => savedDrafts.push(structuredClone(payload)),
	});
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
		.getByRole("button", { name: /^Select Teacher development/u })
		.click();
	await collectionsDialog.getByRole("button", { name: "Done" }).click();
	await expect(collectionsGroup).toContainText("Teacher development");
	await expect
		.poll(() => savedDrafts.at(-1)?.collections)
		.toEqual([teacherCollection.key]);
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

test("autosaves against the exact draft payload the editor saw", async ({
	page,
}) => {
	const saves: Array<{
		expected: Record<string, unknown>;
		next: Record<string, unknown>;
	}> = [];
	await mockPublishedBook(page, {
		onDraftSave: (next, expected) =>
			saves.push({
				expected: structuredClone(expected),
				next: structuredClone(next),
			}),
	});
	await page.goto("/admin");

	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", { name: "Edit" }).click();
	await inspector
		.getByRole("textbox", { name: "Title", exact: true })
		.fill("Locally edited title");

	await expect.poll(() => saves.length).toBe(1);
	expect(saves[0]?.expected.title).toBe("Published book");
	expect(saves[0]?.next.title).toBe("Locally edited title");
});

test("rebases an autosave queued behind an in-flight save", async ({
	page,
}) => {
	let releaseFirstSave: (() => void) | undefined;
	const firstSaveStarted = new Promise<void>((resolve) => {
		releaseFirstSave = resolve;
	});
	let unblockFirstResponse: (() => void) | undefined;
	const firstResponseBlocked = new Promise<void>((resolve) => {
		unblockFirstResponse = resolve;
	});
	const saves: Array<{
		expected: Record<string, unknown>;
		next: Record<string, unknown>;
	}> = [];
	await mockPublishedBook(page, {
		beforeDraftSaveResponse: async ({ payload }) => {
			if (saves.length !== 1) return;
			releaseFirstSave?.();
			await firstResponseBlocked;
			return { ...payload, date: "2026" };
		},
		onDraftSave: (next, expected) =>
			saves.push({
				expected: structuredClone(expected),
				next: structuredClone(next),
			}),
	});
	await page.goto("/admin");

	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", { name: "Edit" }).click();
	await inspector
		.getByRole("textbox", { name: "Title", exact: true })
		.fill("First local edit");
	await firstSaveStarted;
	await inspector
		.getByRole("textbox", { name: "Abstract Note", exact: true })
		.fill("Second local edit");
	await page.waitForTimeout(800);
	unblockFirstResponse?.();

	await expect.poll(() => saves.length).toBe(2);
	expect(saves[1]?.expected.date).toBe("2026");
	expect(saves[1]?.next.date).toBe("2026");
	expect(saves[1]?.next.title).toBe("First local edit");
	expect(saves[1]?.next.abstractNote).toBe("Second local edit");
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

test("searches active collections and browses deleted collections as flat trees", async ({
	page,
}) => {
	const nestedChild: AdminCollectionCatalogEntry = {
		ancestors: [{ key: longCollection.key, name: longCollection.name }],
		deleted: false,
		hasChildren: false,
		key: "NESTED01",
		name: "Nested child",
		parentCollection: longCollection.key,
		revision: 1,
		sortOrder: 0,
		sourceConnectionKey: "native",
		updatedAt: timestamp,
	};
	const catalog = await mockPublishedBook(page, {
		additionalCollectionEntries: [deletedCollection, nestedChild],
	});
	catalog.replaceCollection(nestedChild);
	const searches: URL[] = [];
	await page.route("**/api/admin/collections?*", async (route) => {
		const url = new URL(route.request().url());
		if (url.searchParams.get("view") === "search") searches.push(url);
		await route.fallback();
	});

	await page.goto("/admin");
	const catalogue = page.getByRole("region", {
		name: "Collection catalogue",
	});
	const search = catalogue.getByRole("textbox", {
		name: "Search collections",
	});
	await expect(
		catalogue.getByRole("treeitem", {
			name: longCollectionName,
			exact: true,
		}),
	).toBeVisible();
	await search.fill("very long");
	await expect.poll(() => searches.length).toBeGreaterThan(0);
	const result = catalogue.getByRole("treeitem", {
		name: new RegExp(longCollectionName, "u"),
	});
	await expect(result).toBeVisible();
	await expect(result).toHaveAttribute("aria-level", "1");
	await expect(result).toHaveAttribute("aria-posinset", "1");
	await expect(result).toHaveAttribute("aria-setsize", "1");
	await expect(
		catalogue.getByRole("button", {
			name: `Expand ${longCollectionName}`,
		}),
	).toHaveCount(0);
	await expect(
		catalogue.locator(
			`[data-collection-drag-handle="${longCollection.key}"]`,
		),
	).toHaveCount(0);

	await catalogue
		.getByRole("button", { name: "Clear collection search" })
		.click();
	await catalogue
		.getByRole("button", { name: "Show deleted collections" })
		.click();
	const deleted = catalogue.getByRole("treeitem", {
		name: deletedCollection.name,
	});
	await expect(deleted).toBeVisible();
	await expect(deleted).toHaveAttribute("aria-level", "1");
	await expect(
		catalogue.locator('[role="treeitem"][tabindex="0"]'),
	).toHaveCount(1);
	await expect
		.poll(() =>
			searches.some(
				(url) =>
					url.searchParams.get("state") === "deleted" &&
					url.searchParams.get("source") === null,
			),
		)
		.toBe(true);
});

test("restores branch focus when a collection retry finishes empty", async ({
	page,
}) => {
	const emptySource: AdminSource = {
		key: "empty-import",
		label: "Empty import",
		provider: "zotero",
		readOnly: true,
		status: "active",
		writeback: { enabled: true, supported: true },
	};
	await mockPublishedBook(page, { additionalSources: [emptySource] });
	let attempts = 0;
	await page.route("**/api/admin/collections?*", async (route) => {
		const request = new URL(route.request().url());
		if (
			request.searchParams.get("view") === "children" &&
			request.searchParams.get("source") === emptySource.key
		) {
			attempts += 1;
			if (attempts === 1) {
				await route.fulfill({
					json: {
						error: {
							code: "internal_error",
							message: "Collections could not be loaded.",
						},
					},
					status: 500,
				});
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 150));
			await route.fulfill({
				json: { hasMore: false, items: [], nextCursor: null },
			});
			return;
		}
		await route.fallback();
	});

	await page.goto("/admin");
	const tree = page.getByRole("tree", { name: "Collections" });
	const source = tree.getByRole("treeitem", {
		name: emptySource.label,
		exact: true,
	});
	await source.click();
	const retry = tree.getByRole("treeitem", { name: "Try again" });
	await expect(retry).toBeVisible();
	await retry.focus();
	await page.keyboard.press("Enter");
	await expect(tree.getByRole("treeitem", { name: "Loading" })).toBeFocused();
	await expect(source).toBeFocused();
	await expect(
		tree.getByText("No collections here", { exact: true }),
	).toBeVisible();
});

test("does not steal focus when a collection load finishes after the user leaves", async ({
	page,
}) => {
	const slowSource: AdminSource = {
		key: "slow-import",
		label: "Slow import",
		provider: "zotero",
		readOnly: true,
		status: "active",
		writeback: { enabled: true, supported: true },
	};
	await mockPublishedBook(page, { additionalSources: [slowSource] });
	let releaseLoad!: () => void;
	const loadGate = new Promise<void>((resolve) => {
		releaseLoad = resolve;
	});
	await page.route("**/api/admin/collections?*", async (route) => {
		const request = new URL(route.request().url());
		if (
			request.searchParams.get("view") === "children" &&
			request.searchParams.get("source") === slowSource.key
		) {
			await loadGate;
			await route.fulfill({
				json: { hasMore: false, items: [], nextCursor: null },
			});
			return;
		}
		await route.fallback();
	});

	await page.goto("/admin");
	const tree = page.getByRole("tree", { name: "Collections" });
	await tree
		.getByRole("treeitem", { name: slowSource.label, exact: true })
		.click();
	const loading = tree.getByRole("treeitem", { name: "Loading" });
	await loading.focus();
	await expect(loading).toBeFocused();
	const nativeSource = tree.getByRole("treeitem", {
		name: "Native",
		exact: true,
	});
	await nativeSource.focus();
	releaseLoad();
	await expect(
		tree.getByText("No collections here", { exact: true }),
	).toBeVisible();
	await expect(nativeSource).toBeFocused();
});

test("reveals and scrolls to a selected collection outside the first page", async ({
	page,
}) => {
	const collections: AdminCollectionCatalogEntry[] = Array.from(
		{ length: 120 },
		(_, index) => ({
			ancestors: [],
			deleted: false,
			hasChildren: false,
			key: `D${String(index).padStart(7, "0")}`,
			name: `Deep collection ${index + 1}`,
			parentCollection: null,
			revision: 1,
			sortOrder: index + 10,
			sourceConnectionKey: "native",
			updatedAt: timestamp,
		}),
	);
	await mockPublishedBook(page, { additionalCollectionEntries: collections });
	const childrenRequests: URL[] = [];
	await page.route("**/api/admin/collections?*", async (route) => {
		const url = new URL(route.request().url());
		if (url.searchParams.get("view") === "children") {
			childrenRequests.push(url);
		}
		await route.fallback();
	});
	const selected = collections.at(-1)!;
	const initialFilters = JSON.stringify([
		{
			column: "collections",
			operator: "anyOf",
			value: [selected.key],
		},
	]);

	await page.goto(`/admin?filters=${encodeURIComponent(initialFilters)}`);
	const tree = page.getByRole("tree", { name: "Collections" });
	const selectedRow = tree.getByRole("treeitem", {
		name: selected.name,
		exact: true,
	});
	await expect(selectedRow).toBeVisible();
	await expect(selectedRow).toHaveAttribute("aria-selected", "true");
	await expect(selectedRow).not.toHaveAttribute("aria-posinset");
	expect(await tree.locator("[data-index]").count()).toBeLessThanOrEqual(32);
	expect(childrenRequests.some((url) => url.searchParams.has("cursor"))).toBe(
		false,
	);
});

test("refreshes an off-page ancestor after catalogue invalidation", async ({
	page,
}) => {
	const roots: AdminCollectionCatalogEntry[] = Array.from(
		{ length: 60 },
		(_, index) => ({
			ancestors: [],
			deleted: false,
			hasChildren: false,
			key: `A${String(index).padStart(7, "0")}`,
			name: `Earlier root ${index + 1}`,
			parentCollection: null,
			revision: 1,
			sortOrder: index,
			sourceConnectionKey: "native",
			updatedAt: timestamp,
		}),
	);
	const child: AdminCollectionCatalogEntry = {
		ancestors: [{ key: longCollection.key, name: longCollection.name }],
		deleted: false,
		hasChildren: false,
		key: "DEEPCHLD",
		name: "Deep selected child",
		parentCollection: longCollection.key,
		revision: 1,
		sortOrder: 0,
		sourceConnectionKey: "native",
		updatedAt: timestamp,
	};
	const offPageParent = { ...longCollection, sortOrder: 1000 };
	const firstRootPages: string[][] = [];
	const resolvedNames: string[][] = [];
	const catalog = await mockPublishedBook(page, {
		additionalCollectionEntries: [...roots, child],
		onCollectionPage: (request, items) => {
			const parent = request.searchParams.get("parent");
			if (
				(request.searchParams.get("view") ?? "children") ===
					"children" &&
				(!parent || parent === "root") &&
				!request.searchParams.get("cursor") &&
				request.searchParams.get("source") === "native"
			) {
				firstRootPages.push(items.map(({ key }) => key));
			}
		},
		onCollectionResolve: (_keys, items) => {
			resolvedNames.push(items.map(({ name }) => name));
		},
	});
	catalog.replaceCollection({
		...offPageParent,
		ancestors: [],
		hasChildren: true,
	});
	const renamedParent = {
		...offPageParent,
		name: "Renamed off-page parent",
		revision: 2,
	};
	await page.route("**/api/admin/collections/LONGCOLL", async (route) => {
		catalog.replaceCollection({
			...renamedParent,
			ancestors: [],
			hasChildren: true,
		});
		catalog.replaceCollection({
			...child,
			ancestors: [{ key: renamedParent.key, name: renamedParent.name }],
		});
		await route.fulfill({
			json: { collection: renamedParent, indexingReceipts: [] },
		});
	});
	const initialFilters = JSON.stringify([
		{
			column: "collections",
			operator: "anyOf",
			value: [child.key],
		},
	]);

	await page.goto(`/admin?filters=${encodeURIComponent(initialFilters)}`);
	await expect.poll(() => firstRootPages.length).toBeGreaterThan(0);
	expect(firstRootPages[0]).not.toContain(offPageParent.key);
	const catalogue = page.getByRole("region", {
		name: "Collection catalogue",
	});
	await expect(
		catalogue.getByRole("treeitem", {
			name: longCollection.name,
			exact: true,
		}),
	).toBeVisible();
	await catalogue
		.getByRole("button", { name: `Manage ${longCollection.name}` })
		.click();
	const menu = page.getByRole("menu");
	await expect(menu).toBeVisible();
	const navigation = page.locator("#admin-navigation-pane nav");
	const scrollPosition = await navigation.evaluate((element) => {
		const previous = element.scrollTop;
		element.scrollTop = Math.max(0, previous - 1);
		return { current: element.scrollTop, previous };
	});
	expect(scrollPosition.current).not.toBe(scrollPosition.previous);
	await expect(menu).toBeVisible();
	await page.getByRole("menuitem", { name: "Rename" }).click();
	const dialog = page.getByRole("dialog", { name: "Rename collection" });
	await dialog
		.getByRole("textbox", { name: "Name" })
		.fill(renamedParent.name);
	const resolutionsBeforeRename = resolvedNames.length;
	await dialog.getByRole("button", { name: "Rename", exact: true }).click();
	await expect
		.poll(() =>
			resolvedNames
				.slice(resolutionsBeforeRename)
				.some((names) => names.includes(renamedParent.name)),
		)
		.toBe(true);
	await expect(
		catalogue.getByRole("treeitem", {
			name: renamedParent.name,
			exact: true,
		}),
	).toBeVisible();
});

test("refreshes loaded record collection labels after a rename", async ({
	page,
}) => {
	let collectionSearches = 0;
	const catalog = await mockPublishedBook(page, {
		listRowOverrides: { collections: [teacherCollection.key] },
		onCollectionPage: (request) => {
			if (
				request.searchParams.get("view") === "search" &&
				request.searchParams.get("query") === "teacher"
			) {
				collectionSearches += 1;
			}
		},
	});
	const renamed = {
		...collectionCatalogEntries[0]!,
		name: "Learning library",
		revision: 2,
	};
	const receipt = indexingReceipt(teacherCollection.key, "collection", 2);
	const indexing = await mockCompletedIndexing(page);
	await page.route(
		`**/api/admin/collections/${teacherCollection.key}`,
		async (route) => {
			catalog.replaceCollection(renamed);
			await route.fulfill({
				json: { collection: renamed, indexingReceipts: [receipt] },
			});
		},
	);

	await page.goto("/admin");
	await page
		.getByRole("button", { name: "Choose and arrange columns" })
		.click();
	await page
		.getByRole("checkbox", { name: "Show Collections", exact: true })
		.click();
	await page.keyboard.press("Escape");
	const collectionCell = page.locator(
		`[data-record-key="${publishedItemKey}"] [data-column-id="collections"]`,
	);
	await expect(collectionCell).toContainText(teacherCollection.name);
	await page
		.getByRole("textbox", { name: "Search collections" })
		.fill("teacher");
	await expect.poll(() => collectionSearches).toBeGreaterThan(0);
	await expect(
		page.getByRole("treeitem", {
			name: new RegExp(teacherCollection.name, "u"),
		}),
	).toBeVisible();

	await page
		.getByRole("button", {
			name: `Manage ${teacherCollection.name}`,
			exact: true,
		})
		.click();
	await page.getByRole("menuitem", { name: "Rename" }).click();
	const dialog = page.getByRole("dialog", { name: "Rename collection" });
	await dialog.getByRole("textbox", { name: "Name" }).fill(renamed.name);
	await dialog.getByRole("button", { name: "Rename", exact: true }).click();

	await expect(collectionCell).toContainText(renamed.name);
	await expect(collectionCell).not.toContainText(teacherCollection.name);
	await expect(
		page.getByRole("textbox", { name: "Search collections" }),
	).toBeFocused();
	await expect(
		page.getByRole("treeitem", { name: new RegExp(renamed.name, "u") }),
	).toHaveCount(0);
	await indexing.expectTracked(receipt);
});

test("restores search focus when a mutation refresh cannot reload results", async ({
	page,
}) => {
	let failSearch = false;
	let searchRequests = 0;
	const catalog = await mockPublishedBook(page);
	await page.route("**/api/admin/collections?*", async (route) => {
		const request = new URL(route.request().url());
		if (request.searchParams.get("view") === "search") {
			searchRequests += 1;
		}
		if (failSearch && request.searchParams.get("view") === "search") {
			await route.fulfill({
				json: {
					error: {
						code: "internal_error",
						message: "Collections could not be reloaded.",
					},
				},
				status: 503,
			});
			return;
		}
		await route.fallback();
	});
	const renamed = {
		...collectionCatalogEntries[0]!,
		name: "Teacher learning",
		revision: 2,
	};
	await page.route(
		`**/api/admin/collections/${teacherCollection.key}`,
		async (route) => {
			catalog.replaceCollection(renamed);
			failSearch = true;
			await route.fulfill({
				json: { collection: renamed, indexingReceipts: [] },
			});
		},
	);

	await page.goto("/admin");
	const search = page.getByRole("textbox", { name: "Search collections" });
	await expect(
		page.getByRole("treeitem", {
			name: teacherCollection.name,
			exact: true,
		}),
	).toBeVisible();
	await search.fill("teacher");
	await expect.poll(() => searchRequests).toBeGreaterThan(0);
	await expect(
		page.getByRole("treeitem", {
			name: `${teacherCollection.name} Native`,
			exact: true,
		}),
	).toBeVisible();
	await page
		.getByRole("button", {
			name: `Manage ${teacherCollection.name}`,
			exact: true,
		})
		.click();
	await page.getByRole("menuitem", { name: "Rename" }).click();
	const dialog = page.getByRole("dialog", { name: "Rename collection" });
	await dialog.getByRole("textbox", { name: "Name" }).fill(renamed.name);
	await dialog.getByRole("button", { name: "Rename", exact: true }).click();

	await expect(
		page.getByRole("treeitem", { name: "Try again", exact: true }),
	).toBeVisible();
	await expect(search).toBeFocused();
});

test("pages and virtualizes large collection catalogues while loading sources lazily", async ({
	page,
}) => {
	const nestedChild: AdminCollectionCatalogEntry = {
		ancestors: [{ key: longCollection.key, name: longCollection.name }],
		deleted: false,
		hasChildren: false,
		key: "NESTED01",
		name: "Nested child",
		parentCollection: longCollection.key,
		revision: 1,
		sortOrder: 0,
		sourceConnectionKey: "native",
		updatedAt: timestamp,
	};
	const nativeCollections: AdminCollectionCatalogEntry[] = Array.from(
		{ length: 300 },
		(_, index) => ({
			ancestors: [],
			deleted: false,
			hasChildren: false,
			key: `C${String(index).padStart(7, "0")}`,
			name: `Collection ${String(index + 1).padStart(3, "0")}`,
			parentCollection: null,
			revision: 1,
			sortOrder: index + 10,
			sourceConnectionKey: "native",
			updatedAt: timestamp,
		}),
	);
	const importedEntries: AdminCollectionCatalogEntry[] = Array.from(
		{ length: 3 },
		(_, index) => ({
			ancestors: [],
			deleted: false,
			hasChildren: false,
			key: `I${String(index).padStart(7, "0")}`,
			name: `Imported ${index + 1}`,
			parentCollection: null,
			revision: 1,
			sortOrder: index,
			sourceConnectionKey: importedSource.key,
			updatedAt: timestamp,
		}),
	);
	const catalog = await mockPublishedBook(page, {
		additionalCollectionEntries: [
			nestedChild,
			...nativeCollections,
			...importedEntries,
		],
		additionalSources: [importedSource],
	});
	catalog.replaceCollection(nestedChild);
	const catalogueRequests: URL[] = [];
	let releaseRootPage!: () => void;
	const rootPageGate = new Promise<void>((resolve) => {
		releaseRootPage = resolve;
	});
	let releasePaginationFailure!: () => void;
	const paginationFailureGate = new Promise<void>((resolve) => {
		releasePaginationFailure = resolve;
	});
	let releasePaginationRetry!: () => void;
	const paginationRetryGate = new Promise<void>((resolve) => {
		releasePaginationRetry = resolve;
	});
	let paginationAttempts = 0;
	await page.route("**/api/admin/collections?*", async (route) => {
		const url = new URL(route.request().url());
		if (url.searchParams.get("view") === "children") {
			catalogueRequests.push(url);
			const parent = url.searchParams.get("parent");
			if (
				url.searchParams.get("source") === "native" &&
				(!parent || parent === "root") &&
				!url.searchParams.get("cursor")
			) {
				await rootPageGate;
			}
			if (url.searchParams.get("parent") === longCollection.key) {
				await new Promise((resolve) => setTimeout(resolve, 150));
			}
			if (
				url.searchParams.get("source") === "native" &&
				url.searchParams.get("cursor") === "50"
			) {
				paginationAttempts += 1;
				if (paginationAttempts === 1) {
					await paginationFailureGate;
					await route.fulfill({
						json: {
							error: {
								code: "internal_error",
								message:
									"More collections could not be loaded.",
							},
						},
						status: 500,
					});
					return;
				}
				await paginationRetryGate;
			}
		}
		await route.fallback();
	});

	await page.setViewportSize({ height: 720, width: 1280 });
	await page.goto("/admin");
	const tree = page.getByRole("tree", { name: "Collections" });
	const nativeGroup = tree.getByRole("treeitem", {
		name: "Native",
		exact: true,
	});
	await nativeGroup.focus();
	await page.keyboard.press("ArrowDown");
	await expect(tree.getByRole("treeitem", { name: "Loading" })).toBeFocused();
	releaseRootPage();
	await expect(
		tree.getByRole("treeitem", {
			name: teacherCollection.name,
			exact: true,
		}),
	).toBeFocused();
	await expect(
		tree.getByText("Collection 001", { exact: true }),
	).toBeVisible();
	await expect
		.poll(
			() =>
				catalogueRequests.filter(
					(url) =>
						url.searchParams.get("source") === importedSource.key,
				).length,
		)
		.toBe(0);

	const navigation = page.getByRole("navigation", {
		name: "Admin filters and collections",
	});
	const [initialGeometry, navigationGeometry] = await Promise.all([
		tree.evaluate((element) => ({
			overflowY: getComputedStyle(element).overflowY,
			renderedRows: element.querySelectorAll("[data-index]").length,
		})),
		navigation.evaluate((element) => ({
			clientHeight: element.clientHeight,
			overflowY: getComputedStyle(element).overflowY,
			scrollHeight: element.scrollHeight,
		})),
	]);
	expect(initialGeometry.overflowY).toBe("visible");
	expect(navigationGeometry.overflowY).toBe("auto");
	expect(navigationGeometry.scrollHeight).toBeGreaterThan(
		navigationGeometry.clientHeight,
	);
	expect(initialGeometry.renderedRows).toBeLessThan(40);
	const parentRow = tree.getByRole("treeitem", {
		name: longCollection.name,
		exact: true,
	});
	await expect(
		page.locator(`[data-collection-drag-handle="${longCollection.key}"]`),
	).toBeAttached();
	await parentRow.focus();
	await page.keyboard.press("ArrowRight");
	await expect(parentRow).toHaveAttribute("aria-expanded", "true");
	await page.keyboard.press("ArrowRight");
	await expect(parentRow).toBeFocused();
	await expect(
		tree.getByRole("treeitem", { name: nestedChild.name, exact: true }),
	).toBeVisible();
	await page.keyboard.press("ArrowRight");
	await expect(
		tree.getByRole("treeitem", { name: nestedChild.name, exact: true }),
	).toBeFocused();
	await page.keyboard.press("ArrowLeft");
	await expect(parentRow).toBeFocused();

	const firstGenerated = tree.getByRole("treeitem", {
		name: "Collection 001",
		exact: true,
	});
	await firstGenerated.focus();
	await expect(firstGenerated).toBeFocused();
	for (let index = 0; index < 30; index += 1) {
		await page.keyboard.press("ArrowDown");
		await expect(
			tree.getByRole("treeitem", {
				name: `Collection ${String(index + 2).padStart(3, "0")}`,
				exact: true,
			}),
		).toBeFocused();
	}
	await expect(
		tree.getByRole("treeitem", {
			name: "Collection 031",
			exact: true,
		}),
	).toBeFocused();
	await page.keyboard.press("Home");
	await expect(
		tree.getByRole("treeitem", { name: "Native", exact: true }),
	).toBeFocused();
	await firstGenerated.focus();
	await expect(firstGenerated).toBeFocused();
	await navigation.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await expect(tree.locator('[role="treeitem"]:focus')).toHaveCount(1);
	await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(
		1,
	);
	const itemSearch = page.getByPlaceholder(
		"Search title, creator, date or tag",
	);
	await itemSearch.focus();
	await page.waitForTimeout(50);
	await expect(itemSearch).toBeFocused();

	await navigation.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	const importedGroup = tree.getByRole("treeitem", {
		name: importedSource.label,
	});
	await expect(importedGroup).toBeVisible();
	await importedGroup.focus();
	await page.keyboard.press("Enter");
	await expect(tree.getByText("Imported 1", { exact: true })).toBeVisible();
	await expect
		.poll(
			() =>
				catalogueRequests.filter(
					(url) =>
						url.searchParams.get("source") === importedSource.key,
				).length,
		)
		.toBe(1);

	await navigation.evaluate((element) => {
		element.scrollTop = 36 * 50;
	});
	const loadMore = tree.getByRole("treeitem", { name: "Load more" });
	await expect(loadMore).toBeVisible();
	await loadMore.focus();
	await page.keyboard.press("Enter");
	const loadingMore = tree.getByRole("treeitem", { name: "Loading" });
	await expect(loadingMore).toBeFocused();
	await expect(loadingMore).toHaveAttribute("aria-disabled", "true");
	releasePaginationFailure();
	const retryMore = tree.getByRole("treeitem", { name: "Try again" });
	await expect(retryMore).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(loadingMore).toBeFocused();
	releasePaginationRetry();
	await expect
		.poll(() =>
			catalogueRequests.some(
				(url) =>
					url.searchParams.get("source") === "native" &&
					url.searchParams.get("cursor") === "50",
			),
		)
		.toBe(true);
	expect(paginationAttempts).toBe(2);
	await expect(
		tree.getByRole("treeitem", { name: "Load more" }),
	).toBeFocused();
	await navigation.evaluate((element) => {
		element.scrollTop = 36 * 50;
	});
	await expect(
		tree.getByText("Collection 049", { exact: true }),
	).toBeVisible();
	// The focused row stays mounted outside the visible range so scrolling
	// cannot strand keyboard focus; the rest of the 300-row catalogue remains
	// virtualized.
	expect(await tree.locator("[data-index]").count()).toBeLessThan(48);
});

test("moves and then deletes a native collection without reviving its focus overlay", async ({
	page,
}) => {
	const destinationChildren: AdminCollectionCatalogEntry[] = Array.from(
		{ length: 60 },
		(_, index) => ({
			ancestors: [{ key: longCollection.key, name: longCollection.name }],
			deleted: false,
			hasChildren: false,
			key: `M${String(index).padStart(7, "0")}`,
			name: `Move destination child ${index + 1}`,
			parentCollection: longCollection.key,
			revision: 1,
			sortOrder: index,
			sourceConnectionKey: "native",
			updatedAt: timestamp,
		}),
	);
	const destinationFirstPages: string[][] = [];
	const catalog = await mockPublishedBook(page, {
		additionalCollectionEntries: destinationChildren,
		onCollectionPage: (request, items) => {
			if (
				request.searchParams.get("parent") === longCollection.key &&
				!request.searchParams.get("cursor")
			) {
				destinationFirstPages.push(items.map(({ key }) => key));
			}
		},
	});
	const receipt = indexingReceipt(teacherCollection.key, "collection", 2);
	const deleteReceipt = indexingReceipt(
		teacherCollection.key,
		"collection",
		3,
	);
	const indexing = await mockCompletedIndexing(page);
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
			catalog.replaceCollection({
				...moved,
				ancestors: [
					{ key: longCollection.key, name: longCollection.name },
				],
				hasChildren: false,
			});
			await route.fulfill({
				json: {
					collection: moved,
					collections: [moved],
					indexingReceipts: [receipt],
				},
			});
		},
	);
	await page.route("**/api/admin/collections/TEACHDEV", async (route) => {
		if (route.request().method() !== "DELETE") {
			await route.fallback();
			return;
		}
		const deleted = {
			...teacherCollection,
			deleted: true,
			parentCollection: longCollection.key,
			revision: 3,
		};
		catalog.replaceCollection({
			...deleted,
			ancestors: [{ key: longCollection.key, name: longCollection.name }],
			hasChildren: false,
		});
		await route.fulfill({
			json: {
				collections: [deleted],
				indexingReceipts: [deleteReceipt],
			},
		});
	});
	await page.goto("/admin");

	const handle = page.locator('[data-collection-drag-handle="TEACHDEV"]');
	await activatePointerDrag(page, handle);
	await expect(page.locator('[data-collection-drop="root"]')).toBeVisible();
	const insideTarget = page.locator(
		'[data-collection-drop="inside:LONGCOLL"]',
	);
	await movePointerTo(page, insideTarget);
	await expectFullCollectionDropHighlight(page, insideTarget, "LONGCOLL");
	await page.mouse.up();

	await expect
		.poll(() => moveRequest)
		.toEqual({
			expectedRevision: 1,
			position: "inside",
			targetCollection: "LONGCOLL",
		});
	await expect.poll(() => destinationFirstPages.length).toBeGreaterThan(0);
	expect(destinationFirstPages.at(-1)).not.toContain(teacherCollection.key);
	const movedRow = page.locator('[data-collection-key="TEACHDEV"]');
	await expect(movedRow).toBeVisible();
	await expect(movedRow.getByRole("treeitem")).toHaveAttribute(
		"aria-level",
		"3",
	);
	await expect(
		page.locator('[data-collection-drag-handle="TEACHDEV"]'),
	).toBeFocused();
	await indexing.expectTracked(receipt);

	await movedRow.hover();
	await movedRow
		.getByRole("button", { name: "Manage Teacher development" })
		.click();
	await page.getByRole("menuitem", { name: "Delete" }).click();
	await page
		.getByRole("dialog", { name: "Delete Teacher development?" })
		.getByRole("button", { name: "Delete", exact: true })
		.click();
	await expect(movedRow).toHaveCount(0);
	await indexing.expectTracked(deleteReceipt);
});

test("restores collection focus after a failed pointer move reloads the catalogue", async ({
	page,
}) => {
	let moveAttempts = 0;
	let rootPageLoads = 0;
	await mockPublishedBook(page, {
		onCollectionPage: (request) => {
			if (
				(request.searchParams.get("view") ?? "children") ===
					"children" &&
				(request.searchParams.get("parent") ?? "root") === "root" &&
				request.searchParams.get("source") === "native"
			) {
				rootPageLoads += 1;
			}
		},
	});
	await page.route(
		"**/api/admin/collections/TEACHDEV/move",
		async (route) => {
			moveAttempts += 1;
			await route.fulfill({
				json: {
					error: {
						code: "revision_conflict",
						message: "The collection changed. Try the move again.",
					},
				},
				status: 409,
			});
		},
	);
	await page.goto("/admin");
	await expect.poll(() => rootPageLoads).toBeGreaterThan(0);

	const handle = page.locator('[data-collection-drag-handle="TEACHDEV"]');
	await activatePointerDrag(page, handle);
	await movePointerTo(
		page,
		page.locator('[data-collection-drop="inside:LONGCOLL"]'),
	);
	await page.mouse.up();

	await expect.poll(() => moveAttempts).toBe(1);
	await expect.poll(() => rootPageLoads).toBeGreaterThan(1);
	await expect(handle).toBeFocused();
});

test("adds a writable Zotero record to a native collection with pointer drag", async ({
	page,
}) => {
	let batchRequest: unknown;
	const writableSource: AdminSource = {
		...importedSource,
		readOnly: false,
	};
	await mockPublishedBook(page, {
		additionalSources: [writableSource],
		itemCount: 2,
		listRowOverrides: {
			sourceConnectionKey: writableSource.key,
		},
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
	await expectFullCollectionDropHighlight(page, target, longCollection.key);
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
		const navbarControls = [
			document.querySelector<HTMLElement>('[data-slot="input-wrapper"]')!,
			document.querySelector<HTMLElement>("[data-admin-filter-trigger]")!,
			document.querySelector<HTMLElement>(
				"[data-admin-search-index-status]",
			)!,
			...[...toolbar.querySelectorAll<HTMLElement>("button")].filter(
				(button) =>
					button.offsetParent !== null &&
					[
						"Refresh",
						"Switch to dark mode",
						"Switch to light mode",
					].includes(button.getAttribute("aria-label") ?? ""),
			),
			newItem,
		];
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
			contentGap: Number.parseFloat(getComputedStyle(content).gap),
			contentPaddingBottom: Number.parseFloat(
				getComputedStyle(content).paddingBottom,
			),
			contentPaddingLeft: Number.parseFloat(
				getComputedStyle(content).paddingLeft,
			),
			lightSelectedBackground,
			navbarControlBottoms: navbarControls.map(
				(element) => element.getBoundingClientRect().bottom,
			),
			navbarControlHeights: navbarControls.map(
				(element) => element.getBoundingClientRect().height,
			),
			navbarControlTops: navbarControls.map(
				(element) => element.getBoundingClientRect().top,
			),
			recordGap: Number.parseFloat(getComputedStyle(recordTitle).gap),
			recordHeight: recordRow.getBoundingClientRect().height,
			recordRowDisplay: getComputedStyle(recordRow).display,
			paneBottom: document
				.querySelector<HTMLElement>("#admin-navigation-pane")!
				.getBoundingClientRect().bottom,
			paneLeft: document
				.querySelector<HTMLElement>("#admin-navigation-pane")!
				.getBoundingClientRect().left,
			tableControlsHeight: tableControls.getBoundingClientRect().height,
			tableDisplay: getComputedStyle(tableHeader).display,
			tableHeaderHeight: tableHeader.getBoundingClientRect().height,
			toolbarHeight: toolbar.getBoundingClientRect().height,
			validationBackground,
		};
	});

	expect(measurements.toolbarHeight).toBe(64);
	expect(measurements.contentTop).toBe(64);
	expect(measurements.contentGap).toBe(12);
	expect(measurements.contentPaddingBottom).toBe(12);
	expect(measurements.contentPaddingLeft).toBe(12);
	expect(measurements.paneBottom).toBe(788);
	expect(measurements.paneLeft).toBe(12);
	expect(measurements.navbarControlHeights).toEqual(
		measurements.navbarControlHeights.map(() => 40),
	);
	expect(measurements.navbarControlTops).toEqual(
		measurements.navbarControlTops.map(() => 12),
	);
	expect(measurements.navbarControlBottoms).toEqual(
		measurements.navbarControlBottoms.map(() => 52),
	);
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
	await expect(
		page.getByRole("button", { name: /Sort by last updated/u }),
	).toHaveCount(0);
	const updatedHeader = page.locator('thead th[data-column-id="updated"]');
	await expect(updatedHeader).toHaveAttribute("aria-sort", "descending");
	await expect(
		updatedHeader.getByRole("button", { name: "Updated", exact: true }),
	).toBeVisible();

	const collection = page.locator('[data-collection-key="TEACHDEV"]');
	await collection.hover();
	await collection
		.getByRole("button", { name: "Manage Teacher development" })
		.click();
	await expect(page.getByRole("menu")).toBeVisible();
	await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
});

test("fills the remaining navigation height with the collections surface", async ({
	page,
}) => {
	await mockPublishedBook(page);
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/admin");
	await expect(
		page.getByRole("heading", { name: "Published book" }),
	).toBeVisible();

	const navigation = page.getByRole("navigation", {
		name: "Admin filters and collections",
	});
	const collectionSurface = page
		.getByRole("region", { name: "Collection catalogue" })
		.locator("..");
	const [navigationBox, collectionSurfaceBox] = await Promise.all([
		navigation.boundingBox(),
		collectionSurface.boundingBox(),
	]);

	expect(navigationBox).not.toBeNull();
	expect(collectionSurfaceBox).not.toBeNull();
	expect(
		Math.abs(
			collectionSurfaceBox!.y +
				collectionSurfaceBox!.height -
				(navigationBox!.y + navigationBox!.height),
		),
	).toBeLessThanOrEqual(1);
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
	const columnPopoverGeometry = await page
		.locator("[data-admin-column-popover]")
		.evaluate((base) => {
			const surface = base.querySelector<HTMLElement>(
				'[data-slot="content"]',
			);
			const scroll = base.querySelector<HTMLElement>(
				"[data-admin-column-scroll]",
			);
			const list = base.querySelector<HTMLElement>(
				"[data-admin-column-list]",
			);
			if (!surface || !scroll || !list)
				throw new Error("Column popover geometry is incomplete");
			scroll.scrollTop = scroll.scrollHeight;
			const surfaceRect = surface.getBoundingClientRect();
			const scrollRect = scroll.getBoundingClientRect();
			const listRect = list.getBoundingClientRect();
			const firstRow = list.firstElementChild?.getBoundingClientRect();
			const lastRow = list.lastElementChild?.getBoundingClientRect();
			const listStyle = getComputedStyle(list);
			return {
				contentGaps: [
					firstRow ? firstRow.top - listRect.top : null,
					firstRow ? firstRow.left - listRect.left : null,
					lastRow ? listRect.bottom - lastRow.bottom : null,
					lastRow ? listRect.right - lastRow.right : null,
				],
				listPadding: [
					listStyle.paddingTop,
					listStyle.paddingRight,
					listStyle.paddingBottom,
					listStyle.paddingLeft,
				],
				scrollInsets: [
					scrollRect.left - surfaceRect.left,
					surfaceRect.right - scrollRect.right,
				],
				width: surfaceRect.width,
			};
		});
	expect(columnPopoverGeometry).toEqual({
		contentGaps: [8, 8, 8, 8],
		listPadding: ["8px", "8px", "8px", "8px"],
		scrollInsets: [1, 1],
		width: 224,
	});
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

	const bulkToolbar = page.getByRole("toolbar", { name: "Bulk actions" });
	await expect(bulkToolbar).toBeVisible();
	await expect(bulkToolbar.getByText("selected")).toHaveCount(0);
	for (const label of [
		"Publish selected",
		"Add selected to collection",
		"Remove selected",
		"Clear selection",
	]) {
		await expect(
			bulkToolbar.getByRole("button", { name: label }),
		).toBeDisabled();
	}

	await page
		.getByRole("checkbox", { name: "Select all loaded records" })
		.check();
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
		const buttons = bulk.querySelectorAll("button");
		const actionsRect =
			buttons[buttons.length - 1]!.getBoundingClientRect();
		const countRect = bulk.lastElementChild!.getBoundingClientRect();
		return {
			actionsRight: actionsRect.right,
			bulkBottom: bulkRect.bottom,
			bulkTop: bulkRect.top,
			countLeft: countRect.left,
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
	expect(toolbarGeometry.countLeft).toBeGreaterThan(
		toolbarGeometry.actionsRight,
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
	await expect(bulkToolbar.getByText("selected")).toHaveCount(0);
	for (const label of [
		"Publish selected",
		"Add selected to collection",
		"Remove selected",
		"Clear selection",
	]) {
		await expect(
			bulkToolbar.getByRole("button", { name: label }),
		).toBeDisabled();
	}
});

test("assigns mixed-source records to their shared native collection", async ({
	page,
}) => {
	const batchRequests: unknown[] = [];
	const writableSource: AdminSource = {
		...importedSource,
		readOnly: false,
	};
	await mockPublishedBook(page, {
		additionalSources: [writableSource],
		itemCount: 2,
		listRowOverridesForIndex: (index) =>
			index === 1
				? { sourceConnectionKey: writableSource.key }
				: { sourceConnectionKey: "native" },
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
	await expect(
		dialog.getByRole("button", { name: "Choose source" }),
	).toHaveCount(0);
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
	await expect(bulkToolbar.getByText("selected")).toHaveCount(0);
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
	await expect(bulkToolbar.getByText("selected")).toHaveCount(0);
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
				indexingReceipts: [],
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
		.locator(`tr[data-record-key="${publishedItemKey}"]`)
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

test("places record pagination at the actual end of the scrollable list", async ({
	page,
}) => {
	const listRequests: URL[] = [];
	await mockPublishedBook(page, {
		itemCount: 120,
		itemPageSize: 60,
		onListRequest: (url) => listRequests.push(url),
	});
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/admin");
	await expect(
		page.getByRole("heading", { name: "Published book" }),
	).toBeVisible();

	const scroll = page.locator("[data-admin-item-table-scroll]");
	const loadMoreRegion = page.locator("[data-admin-item-table-load-more]");
	const loadMore = loadMoreRegion.getByRole("button", {
		name: "Load more",
	});
	await expect(loadMore).toBeAttached();
	await expect(loadMore).not.toBeInViewport();
	expect(
		await loadMoreRegion.evaluate(
			(element) =>
				element.parentElement?.hasAttribute(
					"data-admin-item-table-scroll",
				) ?? false,
		),
	).toBe(true);

	await scroll.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
		element.scrollLeft = 260;
		element.dispatchEvent(new Event("scroll"));
	});
	await expect(loadMore).toBeInViewport();
	const endGeometry = await page.evaluate(() => {
		const scrollElement = document.querySelector<HTMLElement>(
			"[data-admin-item-table-scroll]",
		)!;
		const region = document.querySelector<HTMLElement>(
			"[data-admin-item-table-load-more]",
		)!;
		const lastRow = document.querySelector<HTMLElement>(
			'tr[data-record-key="ROW00059"]',
		)!;
		const scrollRect = scrollElement.getBoundingClientRect();
		const regionRect = region.getBoundingClientRect();
		return {
			lastRowBottom: lastRow.getBoundingClientRect().bottom,
			position: getComputedStyle(region).position,
			regionLeft: regionRect.left,
			regionTop: regionRect.top,
			regionWidth: regionRect.width,
			scrollLeft: scrollRect.left,
			scrollWidth: scrollRect.width,
		};
	});
	expect(endGeometry.position).toBe("sticky");
	expect(endGeometry.regionTop).toBeCloseTo(endGeometry.lastRowBottom, 0);
	expect(endGeometry.regionLeft).toBeCloseTo(endGeometry.scrollLeft, 0);
	expect(endGeometry.regionWidth).toBe(endGeometry.scrollWidth);
	await loadMore.click();
	await expect(loadMoreRegion).toHaveCount(0);
	await expect(
		page.getByRole("grid", { name: "Library records" }),
	).toHaveAttribute("aria-rowcount", "121");
	await expect
		.poll(() => listRequests.at(-1)?.searchParams.get("cursor"))
		.toBe("60");
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
	).toBeDisabled();
});

test("keeps the record grid usable in the narrow list pane", async ({
	page,
}) => {
	await mockPublishedBook(page);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/admin");
	await expect(
		page.locator(`tr[data-record-key="${publishedItemKey}"]`),
	).toBeVisible();
	const scroll = page.locator("[data-admin-item-table-scroll]");
	await scroll.evaluate((element) => {
		element.scrollLeft = 300;
		element.dispatchEvent(new Event("scroll"));
	});
	const geometry = await page.evaluate((recordKey) => {
		const scrollElement = document.querySelector<HTMLElement>(
			"[data-admin-item-table-scroll]",
		)!;
		const row = document.querySelector<HTMLElement>(
			`tr[data-record-key="${recordKey}"]`,
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
	}, publishedItemKey);

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
	await expect(emptyState.locator("svg")).toHaveCount(0);
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

	const row = page.locator(`tr[data-record-key="${publishedItemKey}"]`);
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
		.locator(`tr[data-record-key="${publishedItemKey}"]`)
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
					key: "NEWCALL3",
					name: "New collection",
					parentCollection: null,
					revision: 1,
					sortOrder: 1,
					sourceConnectionKey: "native",
					updatedAt: timestamp,
				},
				indexingReceipts: [],
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

test("tracks direct publish, unpublish, and restore mutations", async ({
	page,
}) => {
	const book = await mockPublishedBook(page);
	const indexing = await mockCompletedIndexing(page);
	const publishReceipt = indexingReceipt(publishedItemKey, "item", 2);
	const unpublishReceipt = indexingReceipt(publishedItemKey, "item", 3);
	await page.route(
		`**/api/admin/items/${publishedItemKey}/publish`,
		async (route) => {
			book.setEditing(false);
			await route.fulfill({
				json: { indexingReceipts: [publishReceipt], item: {} },
			});
		},
	);
	await page.route(
		`**/api/admin/items/${publishedItemKey}/unpublish`,
		async (route) => {
			await route.fulfill({
				json: { indexingReceipts: [unpublishReceipt], item: {} },
			});
		},
	);

	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", { name: "Edit" }).click();
	await inspector
		.getByRole("button", { name: "Publish", exact: true })
		.click();
	await indexing.expectTracked(publishReceipt);

	await inspector.getByRole("button", { name: "Unpublish" }).click();
	const unpublishDialog = page.getByRole("dialog", {
		name: "Unpublish record?",
	});
	await unpublishDialog
		.getByRole("button", { name: "Confirm", exact: true })
		.click();
	await indexing.expectTracked(unpublishReceipt);

	const restoreReceipt = indexingReceipt(publishedItemKey, "item", 4);
	await page.route("**/api/admin/items", async (route) => {
		if (route.request().method() !== "GET") {
			await route.fallback();
			return;
		}
		await route.fulfill({
			json: {
				hasMore: false,
				items: [publishedListRow({ state: "deleted" })],
				nextCursor: null,
			},
		});
	});
	await page.route(
		`**/api/admin/items/${publishedItemKey}`,
		async (route) => {
			await route.fulfill({
				json: {
					item: { ...publishedDetail(false), state: "deleted" },
				},
			});
		},
	);
	await page.unroute(`**/api/admin/items/${publishedItemKey}/publish`);
	await page.route(
		`**/api/admin/items/${publishedItemKey}/publish`,
		async (route) => {
			await route.fulfill({
				json: { indexingReceipts: [restoreReceipt], item: {} },
			});
		},
	);
	await page.reload();
	await inspector
		.getByRole("button", { name: "Restore", exact: true })
		.click();
	await indexing.expectTracked(restoreReceipt);
});

test("shows publish success only after Meilisearch finishes", async ({
	page,
}) => {
	const book = await mockPublishedBook(page);
	const receipt = indexingReceipt(publishedItemKey, "item", 2);
	let receiptState: "indexed" | "queued" = "queued";
	await page.route("**/api/admin/search-index", async (route) => {
		await route.fulfill({
			json: {
				queue: {
					hasFailed: false,
					hasPending: receiptState === "queued",
					nextAttemptAt: receiptState === "queued" ? timestamp : null,
				},
				worker: {
					active: true,
					batchProgress: null,
					batchUid: null,
					currentEventCount: receiptState === "queued" ? 1 : 0,
					heartbeatAt: timestamp,
					lastCompletedAt:
						receiptState === "indexed" ? timestamp : null,
					lastError: null,
					stage: receiptState === "queued" ? "waiting" : "idle",
					startedAt: timestamp,
					stoppedAt: null,
					taskUid: null,
					workerId: "search-indexer",
				},
			},
		});
	});
	await page.route("**/api/admin/search-index/receipts", async (route) => {
		await route.fulfill({
			json: {
				receipts: [
					{
						...receipt,
						attempts: 0,
						createdAt: timestamp,
						error: null,
						nextAttemptAt: timestamp,
						processedAt:
							receiptState === "indexed" ? timestamp : null,
						state: receiptState,
					},
				],
			},
		});
	});
	await page.route(
		`**/api/admin/items/${publishedItemKey}/publish`,
		async (route) => {
			book.setEditing(false);
			await route.fulfill({
				json: { indexingReceipts: [receipt], item: {} },
			});
		},
	);

	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", { name: "Edit" }).click();
	await inspector
		.getByRole("button", { name: "Publish", exact: true })
		.click();

	await expect(
		page.getByText("Record published", { exact: true }),
	).toHaveCount(0);
	receiptState = "indexed";
	await expect(
		page.getByText("Record published", { exact: true }),
	).toBeVisible({ timeout: 4_000 });
});

test("tracks PDF publish and unpublish mutations", async ({ page }) => {
	await mockBookWithAttachment(page);
	const indexing = await mockCompletedIndexing(page);
	const publishReceipt = indexingReceipt("PDFATT22", "item", 2);
	const unpublishReceipt = indexingReceipt("PDFATT22", "item", 3);
	await page.route(
		"**/api/admin/items/PDFATT22/file/publish",
		async (route) => {
			await route.fulfill({
				json: { indexingReceipts: [publishReceipt], item: {} },
			});
		},
	);
	await page.route("**/api/admin/items/PDFATT22/file", async (route) => {
		if (route.request().method() !== "DELETE") {
			await route.fallback();
			return;
		}
		await route.fulfill({
			json: { indexingReceipts: [unpublishReceipt], item: {} },
		});
	});

	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");
	await inspector
		.getByRole("button", { name: "Open PDF attachment" })
		.click();
	await inspector
		.getByRole("button", { name: "Publish PDF", exact: true })
		.click();
	await indexing.expectTracked(publishReceipt);
	await inspector.getByRole("button", { name: "Unpublish PDF" }).click();
	await page
		.getByRole("dialog", { name: "Unpublish PDF?" })
		.getByRole("button", { name: "Confirm", exact: true })
		.click();
	await indexing.expectTracked(unpublishReceipt);
});

test("tracks collection delete and restore mutations", async ({ page }) => {
	const catalog = await mockPublishedBook(page, {
		additionalCollectionEntries: [deletedCollection],
	});
	const indexing = await mockCompletedIndexing(page);
	const deleteReceipt = indexingReceipt(
		teacherCollection.key,
		"collection",
		2,
	);
	const restoreReceipt = indexingReceipt(
		teacherCollection.key,
		"collection",
		3,
	);
	await page.route(
		`**/api/admin/collections/${teacherCollection.key}`,
		async (route) => {
			if (route.request().method() !== "DELETE") {
				await route.fallback();
				return;
			}
			const deleted = {
				...teacherCollection,
				deleted: true,
				revision: 2,
			};
			catalog.replaceCollection({
				...deleted,
				ancestors: [],
				hasChildren: false,
			});
			await route.fulfill({
				json: {
					collections: [deleted],
					indexingReceipts: [deleteReceipt],
				},
			});
		},
	);
	await page.route(
		`**/api/admin/collections/${teacherCollection.key}/restore`,
		async (route) => {
			const restored = { ...teacherCollection, revision: 3 };
			catalog.replaceCollection({
				...restored,
				ancestors: [],
				hasChildren: false,
			});
			await route.fulfill({
				json: {
					collection: restored,
					collections: [restored],
					indexingReceipts: [restoreReceipt],
				},
			});
		},
	);

	await page.goto("/admin");
	const catalogue = page.getByRole("region", {
		name: "Collection catalogue",
	});
	await page.locator('[data-collection-key="TEACHDEV"]').hover();
	await page
		.getByRole("button", { name: "Manage Teacher development" })
		.click();
	await page.getByRole("menuitem", { name: "Delete" }).click();
	await page
		.getByRole("dialog", { name: "Delete Teacher development?" })
		.getByRole("button", { name: "Delete", exact: true })
		.click();
	await indexing.expectTracked(deleteReceipt);

	await catalogue
		.getByRole("button", { name: "Show deleted collections" })
		.click();
	await catalogue
		.getByRole("button", { name: "Restore Teacher development" })
		.click();
	await page
		.getByRole("dialog", { name: "Restore Teacher development?" })
		.getByRole("button", { name: "Restore", exact: true })
		.click();
	await indexing.expectTracked(restoreReceipt);
});

test("tracks bulk remove mutations", async ({ page }) => {
	const receipt = indexingReceipt(publishedItemKey, "item", 2);
	await mockPublishedBook(page, {
		batchResults: ({ keys }) =>
			keys.map((key) => ({
				indexingReceipts: [receipt],
				key,
				outcome: "changed",
			})),
	});
	const indexing = await mockCompletedIndexing(page);
	await page.goto("/admin");
	await page.getByRole("checkbox", { name: "Select Published book" }).check();
	await page
		.getByRole("toolbar", { name: "Bulk actions" })
		.getByRole("button", { name: "Remove selected" })
		.click();
	await page
		.getByRole("dialog", { name: "Remove selected records?" })
		.getByRole("button", { name: "Confirm", exact: true })
		.click();
	await indexing.expectTracked(receipt);
});

test("keeps an immediately rejected batch indexing wait handled", async ({
	page,
}) => {
	await page.addInitScript(() => {
		const trackedWindow = window as typeof window & {
			__adminUnhandledRejections?: string[];
		};
		trackedWindow.__adminUnhandledRejections = [];
		window.addEventListener("unhandledrejection", (event) => {
			trackedWindow.__adminUnhandledRejections?.push(
				event.reason instanceof Error
					? event.reason.message
					: String(event.reason),
			);
		});
	});
	let batchRequest = 0;
	await mockPublishedBook(page, {
		batchResults: ({ keys }) => {
			batchRequest += 1;
			return keys.map((key) => ({
				indexingReceipts: [
					indexingReceipt(key, "item", batchRequest === 1 ? 2 : 1),
				],
				key,
				outcome: "changed",
			}));
		},
	});
	await mockCompletedIndexing(page);
	await page.goto("/admin");
	const selectRecord = page.getByRole("checkbox", {
		name: "Select Published book",
	});
	const publishSelected = page.getByRole("button", {
		name: "Publish selected",
	});

	await selectRecord.check();
	await publishSelected.click();
	await expect(page.getByText("1 record published")).toBeVisible();

	await selectRecord.check();
	await publishSelected.click();
	await expect(
		page
			.getByLabel("Notifications alt+T")
			.getByText(
				"A newer public search update replaced this one. Refresh and try again.",
			),
	).toBeVisible();

	const unhandled = await page.evaluate(
		() =>
			(
				window as typeof window & {
					__adminUnhandledRejections?: string[];
				}
			).__adminUnhandledRejections ?? [],
	);
	expect(unhandled).toEqual([]);
});

test("tracks publishing through Meilisearch progress, failure, and retry", async ({
	page,
}) => {
	let batchRevision = 0;
	let hasFailed = false;
	let hasPending = false;
	let receiptState: "failed" | "indexed" | "processing" | "queued" =
		"processing";
	let retryRequest: unknown;
	let workerProgress: number | null = 42;
	let workerStage: "idle" | "indexing" | "waiting" = "indexing";

	await mockPublishedBook(page, {
		batchResults: ({ keys }) => {
			batchRevision += 1;
			receiptState = batchRevision === 1 ? "processing" : "failed";
			hasFailed = receiptState === "failed";
			hasPending = receiptState === "processing";
			workerProgress = receiptState === "processing" ? 42 : null;
			workerStage = receiptState === "processing" ? "indexing" : "idle";
			return keys.map((key) => ({
				indexingReceipts: [
					{
						entityKey: key,
						entityType: "item",
						revision: batchRevision,
					},
				],
				key,
				outcome: "changed",
			}));
		},
	});

	await page.route("**/api/admin/search-index", async (route) => {
		await route.fulfill({
			json: {
				queue: {
					hasFailed,
					hasPending,
					nextAttemptAt: hasPending ? timestamp : null,
				},
				worker: {
					active: true,
					batchProgress: workerProgress,
					batchUid: workerProgress === null ? null : 8,
					currentEventCount: hasPending ? 1 : 0,
					heartbeatAt: timestamp,
					lastCompletedAt: hasPending ? null : timestamp,
					lastError: hasFailed
						? "Meilisearch rejected the update"
						: null,
					stage: workerStage,
					startedAt: timestamp,
					stoppedAt: null,
					taskUid: workerProgress === null ? null : 9,
					workerId: "search-indexer",
				},
			},
		});
	});
	await page.route("**/api/admin/search-index/receipts", async (route) => {
		const body = route.request().postDataJSON() as {
			receipts: Array<{
				entityKey: string;
				entityType: "collection" | "item";
				revision: number;
			}>;
		};
		await route.fulfill({
			json: {
				receipts: body.receipts.map((receipt) => ({
					...receipt,
					attempts: receiptState === "failed" ? 3 : 0,
					createdAt: timestamp,
					error:
						receiptState === "failed"
							? "Meilisearch rejected the update"
							: null,
					nextAttemptAt: timestamp,
					processedAt: receiptState === "indexed" ? timestamp : null,
					state: receiptState,
				})),
			},
		});
	});
	await page.route("**/api/admin/search-index/retry", async (route) => {
		retryRequest = route.request().postDataJSON();
		receiptState = "queued";
		hasFailed = false;
		hasPending = true;
		workerStage = "waiting";
		workerProgress = null;
		await route.fulfill({
			json: {
				receipts: [
					{
						entityKey: publishedItemKey,
						entityType: "item",
						revision: batchRevision,
					},
				],
				requeued: 1,
			},
		});
	});
	await page.goto("/admin");
	await expect(
		page.getByRole("button", { name: "Search indexing: Search ready" }),
	).toBeVisible();

	const selectRecord = page.getByRole("checkbox", {
		name: "Select Published book",
	});
	await selectRecord.check();
	await page
		.getByRole("toolbar", { name: "Bulk actions" })
		.getByRole("button", { name: "Publish selected" })
		.click();

	const indexingStatus = await waitForAdminSearchIndexStatus(
		page,
		"Indexing 42%",
		4_000,
	);
	const triggerGeometry =
		await measureAdminSearchIndexTrigger(indexingStatus);
	expect(triggerGeometry).toEqual({
		display: "flex",
		flexDirection: "row",
		height: 40,
		iconHeight: 14,
		paddingLeft: "8px",
		paddingRight: "8px",
		width: 40,
	});

	const { geometry: popoverGeometry, popover } =
		await openAndMeasureAdminSearchIndexPopover(
			page,
			indexingStatus,
			4_000,
		);
	await expect(
		popover.getByText("Indexing 42%", { exact: true }),
	).toBeVisible();
	expect(popoverGeometry).toMatchObject({
		documentOverflow: 0,
		innerPadding: "12px",
		progressHeight: 4,
		rightInsideViewport: true,
		surfaceBorderRadius: "12px",
		surfaceBorderWidth: "1px",
		width: 256,
	});
	await page.keyboard.press("Escape");

	receiptState = "indexed";
	hasPending = false;
	workerProgress = null;
	workerStage = "idle";
	await expect(
		page.getByRole("button", { name: "Search indexing: Search updated" }),
	).toBeVisible({ timeout: 4_000 });

	await selectRecord.check();
	await page
		.getByRole("toolbar", { name: "Bulk actions" })
		.getByRole("button", { name: "Publish selected" })
		.click();
	const failedStatus = page.getByRole("button", {
		name: "Search indexing: Indexing failed",
	});
	await expect(failedStatus).toBeVisible();
	await failedStatus.click();
	await page.getByRole("button", { name: "Retry indexing" }).click();
	await expect
		.poll(() => retryRequest)
		.toEqual({
			receipts: [
				{
					entityKey: publishedItemKey,
					entityType: "item",
					revision: 2,
				},
			],
			scope: "receipts",
		});
	await expect(
		page.locator('[data-admin-search-index-status="queued"]'),
	).toHaveAttribute("aria-label", "Search indexing: Search queued");
	await page.keyboard.press("Escape");

	receiptState = "indexed";
	hasPending = false;
	workerStage = "idle";
	await expect(
		page.getByRole("button", { name: "Search indexing: Search updated" }),
	).toBeVisible({ timeout: 4_000 });
});
