import { expect, test, type Locator, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

import type {
	AdminCollectionCatalogEntry,
	AdminSource,
} from "@/lib/admin/types";
import type { AdminItemBatchResult } from "@/lib/admin/item-batch-contract";
import { adminCanonicalPayloadToItemFields } from "@/lib/admin/item-fields";

import {
	measureAdminSearchIndexTrigger,
	openAndMeasureAdminSearchIndexPopover,
	waitForAdminSearchIndexStatus,
} from "./admin-search-index-page";
import { libraryCallbackUrl, openAdmin, sendAuthRequestsFromLibraryOrigin, signInAdmin, signInAs } from "./admin-login";

async function assignSelectedRecords(page: Page) {
  await page.getByRole("toolbar", {name: "Bulk actions"}).getByRole("button", {name: "Add selected to collection"}).click();
  const dialog = page.getByRole("dialog", {name: /Add .*records? to collection/});
  await dialog.getByRole("button", {name: /Teacher development/u}).click();
  await expect(dialog).toBeHidden();
}

async function removeSelectedRecords(page: Page) {
  await page.getByRole("toolbar", {name: "Bulk actions"}).getByRole("button", {name: "Remove selected"}).click();
  await page.getByRole("dialog", {name: /Remove .*records?\?/}).getByRole("button", {name: /^Remove records?$/u}).click();
}

async function mockSubmittedReview(page: Page, onApprove: (body: Record<string, unknown>) => Promise<{status?: number; json: unknown}>) {
  const review = {id: "review-browser-test", revision: 1, state: "pending", submittedAt: timestamp, submittedBy: "editor"};
  await page.route(`**/api/admin/items/${publishedItemKey}/review`, route => route.fulfill({json: {reviews: [review]}}));
  await page.route("**/api/admin/reviews/review-browser-test", async route => {
    if (route.request().method() === "POST") {
      const result = await onApprove(route.request().postDataJSON());
      if (!result.status || result.status < 400) { review.state = "published"; review.revision += 1; }
      await route.fulfill(result);
      return;
    }
    await route.fulfill({json: {snapshot: {
      ...publishedDetail(true), reviewId: review.id, reviewRevision: review.revision,
      reviewState: review.state, submittedAt: timestamp, submittedBy: "editor",
      frozenAttachments: [], remainingConflicts: {}, note: null, publishing: null, unchangedKeys: [],
    }}});
  });
  return {resubmit: () => {review.state = "pending"; review.revision += 1;}};
}

async function openReviewApproval(page: Page) {
  const inspector = page.locator("#admin-inspector-pane");
  await inspector.getByRole("button", {name: "Submitted version", exact: true}).click();
  await inspector.getByRole("button", {name: "Publish version", exact: true}).click();
  return page.getByRole("dialog", {name: "Publish submitted version"});
}

const itemKey = "TESTBOOK";
const publishedItemKey = "LIVEB22K";
const timestamp = "2026-07-31T12:00:00.000Z";
const draftGeneration = "c8df1386-3420-4f12-8c20-7fb1c31ae0ad";
const expectedPublicBaseUrl =
	process.env.PLAYWRIGHT_EXPECTED_PUBLIC_BASE_URL ??
	"https://library.example.org";
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
	await signInAdmin(page);
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
	collectionCount: 1,
	key: "zotero-group",
	label: "Zotero group",
	provider: "zotero",
	readOnly: true,
	status: "active",
	activity: null,
	externalScopeKey: null,
	scopeKind: "group",
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
		kind: "created",
		importMethod: null,
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
		generation: draftGeneration,
		itemKey: publishedItemKey,
		payload,
		sourceConnectionKey: "native",
		updatedAt: timestamp,
	};
}

const emptyLinks = {
	fromSources: [],
	citedBy: [],
	keys: { cites: [], related: [] },
	publishedKeys: { cites: [], related: [] },
	targets: [],
};

function publishedDetail(
	editing: boolean,
	draftPayload: Record<string, unknown> = publishedPayload,
	draftRevision = 1,
) {
	return {
		kind: "created",
		importMethod: null,
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
		links: emptyLinks,
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
		writeback: { available: [], originSourceKey: null, selected: [] },
		sourceFields: [],
		importedTopics: [],
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
		canonicalDraftResponses?: boolean;
		failDraftSave?: boolean;
		itemCount?: number;
		itemPageSize?: number;
		initialCollectionKeys?: string[];
		initialDraftPayload?: Record<string, unknown>;
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
		...(options.initialDraftPayload ?? {}),
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

        if (request.method() === "GET" && pathname.endsWith("/review")) {
            await route.fulfill({json: {reviews: []}});
            return;
        }
        if (request.method() === "GET" && pathname.endsWith("/publishing-choice")) {
            await route.fulfill({json: {choice: null}});
            return;
        }
        if (request.method() === "GET" && pathname.endsWith("/publication/crossref/reserve")) {
            await route.fulfill({json: {reservation: null}});
            return;
        }
        if (pathname === "/api/admin/reviews") {
            await route.fulfill({json: {count: 0}});
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
			const canonicalPayload = options.canonicalDraftResponses
				? Object.fromEntries(
						Object.entries(draftPayload).map(([field, value]) => [
							field === "language" ? "languageName" : field,
							value,
						]),
					)
				: draftPayload;
			const responsePayload = options.canonicalDraftResponses
				? adminCanonicalPayloadToItemFields(
						canonicalPayload,
						String(canonicalPayload.itemType ?? ""),
					)
				: canonicalPayload;
			await route.fulfill({
				json: { draft: publishedDraft(responsePayload, draftRevision) },
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

test.describe("overlay lifecycle", () => {
	test.beforeEach(async ({ page }) => {
		await mockPublishedBook(page);
		await page.goto("/admin");
		await expect(page.getByRole("textbox", { name: "Search records" })).toBeVisible();
		await expect(page.getByRole("heading", { name: "Published book", exact: true })).toBeVisible();
	});

	test("removes tooltips after rapid pointer movement and keyboard blur", async ({ page }) => {
		const logout = page.getByRole("button", { name: "Log out" });
		const create = page.getByRole("button", { name: "Create Item" });
		const search = page.getByRole("textbox", { name: "Search records" });
		await search.hover();
		for (let cycle = 0; cycle < 3; cycle++) {
			await logout.hover();
			await expect(page.getByRole("tooltip")).toHaveText("Log out");
			await create.hover();
			await logout.hover();
			await search.hover();
			await expect(page.getByRole("tooltip", { includeHidden: true })).toHaveCount(0);
		}
		await page.getByRole("button", { name: "Import Item", exact: true }).focus();
		await page.keyboard.press("Shift+Tab");
		await expect(logout).toBeFocused();
		await expect(page.getByRole("tooltip", { includeHidden: true })).toHaveCount(1);
		await expect(page.getByRole("tooltip")).toHaveText("Log out");
		await search.click();
		await expect(page.getByRole("tooltip", { includeHidden: true })).toHaveCount(0);
		await expect(search).toBeFocused();
	});

	test("switches adjacent popovers with one click and releases focus", async ({ page }) => {
		const columns = page.getByRole("button", { name: "Choose and arrange columns" });
		const density = page.getByRole("button", { name: "Change row density" });
		await columns.click();
		await expect(page.getByRole("checkbox", { name: "Show Tags", exact: true })).toBeVisible();
		await density.click();
		await expect(columns).toHaveAttribute("aria-expanded", "false");
		await expect(page.getByRole("button", { name: "compact", exact: true })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog", { includeHidden: true })).toHaveCount(0);
		const search = page.getByRole("textbox", { name: "Search records" });
		await search.click();
		await expect(search).toBeFocused();
	});

	test("dismisses only the nested select and keeps its parent usable", async ({ page }) => {
		await page.getByRole("button", { name: "Filters", exact: true }).click();
		const filters = page.getByRole("dialog", { name: "Filter records" });
		const add = filters.locator('button[aria-label="Add filter"]');
		await add.click();
		await expect(page.getByRole("listbox")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByRole("listbox", { includeHidden: true })).toHaveCount(0);
		await expect(filters).toBeVisible();
		await add.click();
		await page.getByRole("option", { name: "Title", exact: true }).click();
		const value = filters.getByRole("textbox", { name: "Title value" });
		await value.fill("evidence");
		await filters.locator('button[aria-label="Filter 1 field"]').click();
		await expect(page.getByRole("listbox", { includeHidden: true })).toHaveCount(1);
		await expect(page.getByRole("listbox", { name: "Filter 1 field" })).toBeVisible();
		await value.click();
		await expect(page.getByRole("listbox", { includeHidden: true })).toHaveCount(0);
		await expect(value).toBeFocused();
		await expect(value).toHaveValue("evidence");
		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog", { includeHidden: true })).toHaveCount(0);
	});

	test("closes a dialog opened from a dropdown without leaving an overlay", async ({ page }) => {
		await Promise.all([
			page.waitForResponse((response) => {
				const url = new URL(response.url());
				return url.pathname === "/api/admin/collections" &&
					url.searchParams.get("view") === "search" &&
					url.searchParams.get("query") === teacherCollection.name;
			}),
			page.getByRole("textbox", { name: "Search collections" }).fill(teacherCollection.name),
		]);
		await page.getByRole("button", { name: `Manage ${teacherCollection.name}`, exact: true }).click();
		await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Rename collection" });
		await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue(teacherCollection.name);
		await expect(page.getByRole("menu", { includeHidden: true })).toHaveCount(0);
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(page.getByRole("dialog", { includeHidden: true })).toHaveCount(0);
		const search = page.getByRole("textbox", { name: "Search records" });
		await search.click();
		await expect(search).toBeFocused();
	});

	test("closes and reopens a modal after switching tabs and resizing", async ({ page }) => {
		for (let cycle = 0; cycle < 3; cycle++) {
			await page.getByRole("button", { name: "Import Item", exact: true }).click();
			const dialog = page.getByRole("dialog");
			const files = dialog.getByRole("tab", { name: "Bibliography files" });
			await files.click();
			await expect(files).toHaveAttribute("aria-selected", "true");
			await page.setViewportSize({ width: cycle % 2 ? 1280 : 820, height: 900 });
			await dialog.getByRole("tab", { name: "DOIs", exact: true }).click();
			await expect(dialog.getByRole("textbox", { name: "DOIs", exact: true })).toBeVisible();
			await dialog.getByRole("button", { name: "Close", exact: true }).click();
			await expect(page.getByRole("dialog", { includeHidden: true })).toHaveCount(0);
			const search = page.getByRole("textbox", { name: "Search records" });
			await search.click();
			await expect(search).toBeFocused();
		}
	});

	test.describe("touch input", () => {
		test.use({ hasTouch: true });

		test("selects and reopens nested menus without dismissing the parent", async ({ page }) => {
			await page.getByRole("button", { name: "Filters", exact: true }).tap();
			const filters = page.getByRole("dialog", { name: "Filter records" });
			await filters.locator('button[aria-label="Add filter"]').tap();
			await page.getByRole("option", { name: "Title", exact: true }).tap();
			const value = filters.getByRole("textbox", { name: "Title value" });
			await expect(value).toBeVisible();
			await filters.locator('button[aria-label="Filter 1 field"]').tap();
			await expect(page.getByRole("listbox", { name: "Filter 1 field" })).toBeVisible();
			await value.tap();
			await expect(page.getByRole("listbox", { includeHidden: true })).toHaveCount(0);
			await expect(filters).toBeVisible();
			const search = page.getByRole("textbox", { name: "Search records" });
			await search.tap();
			await expect(page.getByRole("dialog", { includeHidden: true })).toHaveCount(0);
			await expect(search).toBeFocused();
		});
	});
});

test("starts OpenScholar sign-in from /admin, keeps the session, and signs out", { tag: "@smoke" }, async ({
	page,
}) => {
	test.setTimeout(90_000);
	const baseUrl = process.env.PLAYWRIGHT_BASE_URL!;
	await mockPublishedBook(page);
	await sendAuthRequestsFromLibraryOrigin(page);
	await page.context().clearCookies();
	await page.goto("/admin?scope=drafts");

	// Signed out, /admin starts the OAuth flow with OpenScholar's Clerk
	// instance and asks it to come back to the library's own callback.
	const authorize = new URL(page.url());
	expect(authorize.pathname).toBe("/oauth/authorize");
	expect(authorize.searchParams.get("response_type")).toBe("code");
	expect(authorize.searchParams.get("redirect_uri")).toBe(libraryCallbackUrl());
	expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
	expect(authorize.searchParams.get("state")).toBeTruthy();
	expect(authorize.searchParams.get("scope")?.split(" ")).toEqual(
		expect.arrayContaining(["openid", "email", "profile", "offline_access"]),
	);

	await signInAdmin(page);
	await page.goto("/admin?scope=drafts");
	await expect(page.getByRole("textbox", { name: "Search records" })).toBeVisible();
	await page.reload();
	await expect(page.getByRole("textbox", { name: "Search records" })).toBeVisible();

	const logout = page.getByRole("button", { name: "Log out" });
	const newItem = page.getByRole("button", { name: "Create Item" });
	await expect(logout).toBeVisible();
	await expect(logout).toHaveText("");
	await logout.focus();
	await expect(page.getByRole("tooltip")).toHaveText("Log out");
	const [logoutBox, newItemBox] = await Promise.all([
		logout.boundingBox(),
		newItem.boundingBox(),
	]);
	expect(logoutBox).not.toBeNull();
	expect(newItemBox).not.toBeNull();
	expect(logoutBox!.x + logoutBox!.width).toBeLessThanOrEqual(newItemBox!.x);
	expect(Math.abs(logoutBox!.y - newItemBox!.y)).toBeLessThanOrEqual(1);

	// Signing out ends the session and leaves /admin, so a later visit signs in again.
	await logout.click();
	// The home page may forward to the library listing, so wait only for leaving /admin.
	await page.waitForURL((url) => !url.pathname.startsWith("/admin"));
	const again = await page.request.get(new URL("/admin", baseUrl).toString(), { maxRedirects: 0 });
	expect(again.status()).toBe(307);
	expect(again.headers().location).toBe(new URL("/api/admin/sign-in?return=%2Fadmin", baseUrl).toString());
});

test("answers admin requests on the library's own rules", { tag: "@smoke" }, async ({ page }) => {
	const baseUrl = process.env.PLAYWRIGHT_BASE_URL!;
	const disabledLocale = process.env.PLAYWRIGHT_EXPECTED_DISABLED_LOCALE!;
	expect(disabledLocale).toBeTruthy();
	const adminUrl = (path: string) => new URL(path, baseUrl).toString();

	// The session from the shared setup is still in place here.
	const signedInPost = await page.request.post(adminUrl("/admin"), {
		data: "not a page request",
		maxRedirects: 0,
	});
	expect(signedInPost.status()).toBe(405);
	expect(signedInPost.headers().allow).toBe("GET, HEAD");

	await page.context().clearCookies();

	const signedOutPost = await page.request.post(adminUrl("/admin"), {
		data: "not a page request",
		maxRedirects: 0,
	});
	expect(signedOutPost.status()).toBe(405);
	expect(signedOutPost.headers().allow).toBe("GET, HEAD");

	// A legacy search key must not turn a refused method into a redirect.
	const legacyQueryPost = await page.request.post(
		adminUrl("/admin?sort=date_desc"),
		{ data: "not a page request", maxRedirects: 0 },
	);
	expect(legacyQueryPost.status()).toBe(405);

	const head = await page.request.head(adminUrl("/admin"), {
		maxRedirects: 0,
	});
	expect(head.status()).toBe(307);
	expect(head.headers().location).toBe(adminUrl("/api/admin/sign-in?return=%2Fadmin"));

	const switchedOffLocale = await page.request.get(
		adminUrl(`/${disabledLocale}/admin?sort=date_desc`),
		{ maxRedirects: 0 },
	);
	expect(switchedOffLocale.status()).toBe(307);
	expect(
		new URL(switchedOffLocale.headers().location, baseUrl).toString(),
	).toBe(adminUrl("/admin?sort=date_desc"));
});

test("tells someone without a role which organisation to ask", async ({ page }) => {
	await page.context().clearCookies();
	await signInAs(page.context(), "user_acceptance_outsider");
	await page.goto("/admin");
	await expect(page.getByRole("heading", { name: "You cannot open this admin area" })).toBeVisible();
	await expect(page.getByText("Ask an admin of Acceptance organisation to add you to the team that runs this community.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Create Item" })).toHaveCount(0);
});

test("edits an imported record and shows its writeback lifecycle", { tag: "@smoke" }, async ({
	page,
}) => {
	await mockCompletedIndexing(page);
	await mockPublishedBook(page, {
		additionalSources: [importedSource],
		listRowOverrides: { sourceConnectionKey: importedSource.key, kind: "imported" },
	});
	let editing = false;
	let draftRevision = 1;
	let revision = 7;
	let writebackStarted = false;
	let forceFailure = false;
	let retryRequests = 0;
	let statusRequests = 0;
 let writebackPhase = 0;
	let draftPayload = structuredClone(publishedPayload);
	const draft = () => ({
		baseRevision: revision,
		createdAt: timestamp,
		draftRevision,
		generation: draftGeneration,
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
			available: [
				{
					effective: true,
					isOrigin: true,
					itemEnabled: true,
					linkExists: true,
					provider: "zotero",
					reason: "ok",
					sourceEnabled: true,
					sourceKey: importedSource.key,
					sourceLabel: importedSource.label,
					sourceStatus: "active",
					supported: true,
				},
			],
			originSourceKey: importedSource.key,
			selected: [importedSource.key],
		},
	});

	await page.route(
		`**/api/admin/items/${publishedItemKey}/writeback/status?source=*`,
		async (route) => {
			const states = ["queued", "sending", "synced"] as const;
			const state = forceFailure
				? "failed"
				: writebackStarted
					? states[writebackPhase]
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
		`**/api/admin/items/${publishedItemKey}/writeback/retry?source=*`,
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
  await mockSubmittedReview(page, async () => {
    editing = false;
    revision += 1;
    writebackStarted = true;
    statusRequests = 0;
    return {json: {indexingReceipts: [], review: {}}};
  });
	await page.route(`**/api/admin/items/${publishedItemKey}`, async (route) =>
		route.fulfill({ json: { item: detail() } }),
	);

	await page.goto("/admin");
	await page.getByRole("button", { name: "Record status and sources" }).click();
	await expect(
		page.getByRole("button", { name: "Sources 1 synced" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	const title = page.getByRole("textbox", { name: "Title", exact: true });
	await expect(title).toBeEnabled();
	await title.fill("Imported edit for writeback");
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const publishDialog = await openReviewApproval(page);
  await publishDialog.getByRole("button", {name: "Publish version", exact: true}).click();
  await expect(publishDialog).toBeHidden();
  await page.locator("#admin-inspector-pane").getByRole("button", {name: "Working draft", exact: true}).click();
	await page.getByRole("button", { name: "Record status and sources" }).click();

	const status = page.locator("[data-admin-writeback-status]");
	await expect(status).toHaveAttribute(
		"data-admin-writeback-status",
		"queued",
	);
 writebackPhase = 1;
	await expect(status).toHaveAttribute(
		"data-admin-writeback-status",
		"sending",
		{ timeout: 5_000 },
	);
 writebackPhase = 2;
	await expect(status).toHaveAttribute(
		"data-admin-writeback-status",
		"synced",
		{ timeout: 5_000 },
	);

	await status.getByRole("button", { name: /^Sources/ }).click();
	await expect(page.getByRole("region", { name: "Connected sources" }).getByText(importedSource.label, { exact: true })).toBeVisible();

	forceFailure = true;
	writebackStarted = false;
	await page.reload();
	await page.getByRole("button", { name: "Record status and sources" }).click();
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

test("chooses writeback sources without publishing", async ({
	page,
}) => {
	await mockCompletedIndexing(page);
	const book = await mockPublishedBook(page, {
		additionalSources: [importedSource],
	});
	let selected: string[] = [];
	const writeback = () => ({
		available: [
			{
				effective: selected.includes(importedSource.key),
				isOrigin: false,
				itemEnabled: selected.includes(importedSource.key),
				linkExists: selected.includes(importedSource.key),
				provider: "zotero",
				reason: selected.includes(importedSource.key) ? "ok" : "not-linked",
				sourceEnabled: true,
				sourceKey: importedSource.key,
				sourceLabel: importedSource.label,
				sourceStatus: "active",
				supported: true,
			},
		],
		originSourceKey: null,
		selected,
	});
	let sourcesBody: unknown;
	// After the choice is saved the server reports the job as waiting for a
	// while, then synced. The chip must follow by polling, with no reload.
	let statusPolls = 0;
	await page.route(
		`**/api/admin/items/${publishedItemKey}/writeback/sources`,
		async (route) => {
			sourcesBody = route.request().postDataJSON();
			selected = (sourcesBody as { sourceKeys: string[] }).sourceKeys;
			statusPolls = 0;
			await route.fulfill({ json: { writeback: writeback() } });
		},
	);
	await page.route(
		`**/api/admin/items/${publishedItemKey}/writeback/status?source=*`,
		async (route) => {
			statusPolls += 1;
			const state = statusPolls <= 3 ? "queued" : "synced";
			await route.fulfill({
				json: {
					status: {
						attempts: 0,
						canonicalRevision: 1,
						error: null,
						jobId: 5,
						nextAttemptAt: timestamp,
						processedAt: state === "synced" ? timestamp : null,
						sourceKey: importedSource.key,
						state,
					},
				},
			});
		},
	);

	await page.route(`**/api/admin/items/${publishedItemKey}`, async (route) =>
		route.fulfill({
			json: { item: { ...publishedDetail(false), writeback: writeback() } },
		}),
	);
	book.setEditing(false);

	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");
	await expect(page.locator("[data-admin-writeback-status]")).toHaveCount(0);

	// The Sources button changes the choice without publishing.
	await inspector.getByRole("button", { name: "Record status and sources" }).click();
	await page.getByRole("button", { name: "Manage sources", exact: true }).click();
	const sourcesDialog = page.getByRole("dialog", {
		name: "Sources for this record",
	});
	await expect(sourcesDialog).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Record status and sources", includeHidden: true }),
	).toHaveAttribute("aria-expanded", "false");
	const box = sourcesDialog.getByRole("switch", {
		name: importedSource.label,
	});
	await expect(box).not.toBeChecked();
	await box.check();
	await sourcesDialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect.poll(() => sourcesBody).toEqual({
		sourceKeys: [importedSource.key],
	});
	await expect(sourcesDialog).toBeHidden();
	await inspector.getByRole("button", { name: "Record status and sources" }).click();
	await expect(page.locator("[data-admin-writeback-status]")).toHaveAttribute(
		"data-admin-writeback-status",
		"queued",
	);
	await expect(page.locator("[data-admin-writeback-status]")).toHaveAttribute(
		"data-admin-writeback-status",
		"synced",
		{ timeout: 15_000 },
	);
	expect(statusPolls).toBeGreaterThanOrEqual(4);

});

test("resolves a source conflict with a confirmed choice", async ({
	page,
}) => {
	await mockCompletedIndexing(page);
	await mockPublishedBook(page, { additionalSources: [importedSource] });
	let state: "conflict" | "queued" | "synced" = "conflict";
	let resolveBody: unknown;
	let resolveSource: string | null = null;
	const statusJson = () => ({
		status: {
			attempts: 0,
			canonicalRevision: 1,
			error: null,
			jobId: 5,
			nextAttemptAt: timestamp,
			processedAt: state === "synced" ? timestamp : null,
			sourceKey: importedSource.key,
			state,
		},
	});
	await page.route(
		`**/api/admin/items/${publishedItemKey}/writeback/status?source=*`,
		async (route) => route.fulfill({ json: statusJson() }),
	);
	await page.route(
		`**/api/admin/items/${publishedItemKey}/writeback/resolve?source=*`,
		async (route) => {
			resolveSource = new URL(route.request().url()).searchParams.get(
				"source",
			);
			resolveBody = route.request().postDataJSON();
			state = "queued";
			await route.fulfill({ json: { indexingReceipts: [], ...statusJson() } });
		},
	);
	await page.route(`**/api/admin/items/${publishedItemKey}`, async (route) =>
		route.fulfill({
			json: {
				item: {
					...publishedDetail(false),
					writeback: {
						available: [
							{
								effective: true,
								isOrigin: false,
								itemEnabled: true,
								linkExists: true,
								provider: "zotero",
								reason: "ok",
								sourceEnabled: true,
								sourceKey: importedSource.key,
								sourceLabel: importedSource.label,
								sourceStatus: "active",
								supported: true,
							},
						],
						originSourceKey: null,
						selected: [importedSource.key],
					},
				},
			},
		}),
	);

	await page.goto("/admin");
	await page.getByRole("button", { name: "Record status and sources" }).click();
	const badge = page.locator('[data-admin-writeback-status="conflict"]');
	await expect(badge).toBeVisible();
	await badge.getByRole("button", { name: /^Sources/ }).click();
	const popover = page.getByRole("region", { name: "Connected sources" });
	await expect(popover.locator("[data-admin-writeback-conflict]")).toBeVisible();
	const sendLocal = popover.locator('[data-admin-writeback-resolve="send-local"]');
	const loadRemote = popover.locator('[data-admin-writeback-resolve="load-remote"]');
	await expect(sendLocal).toHaveText(`Send this record to ${importedSource.label}`);
	await expect(loadRemote).toHaveText(`Load ${importedSource.label}’s version`);

	// The first click arms the choice; nothing is sent until it is confirmed.
	await loadRemote.click();
	await expect(loadRemote).toHaveText("Confirm");
	expect(resolveBody).toBeUndefined();
	await popover.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(loadRemote).toHaveText(`Load ${importedSource.label}’s version`);

	await sendLocal.click();
	await expect(sendLocal).toHaveText("Confirm");
	await sendLocal.click();
	await expect.poll(() => resolveBody).toEqual({ choice: "send-local" });
	expect(resolveSource).toBe(importedSource.key);
	await expect(page.locator("[data-admin-writeback-status]")).toHaveAttribute(
		"data-admin-writeback-status",
		"queued",
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
	await expect(content).toHaveCSS("opacity", "0.5");
	// The search box stays usable while a page loads: disabling it dropped the editor's focus.
	await expect(
		dialog.getByRole("textbox", { name: "Search collections" }),
	).toBeEnabled();
	// So do the breadcrumbs, and the old results stay in place, dimmed, with no spinner over them.
	await expect(
		dialog.getByRole("button", { name: "Native", exact: true }),
	).toBeEnabled();
	await expect(content.getByText(parent.name, { exact: true })).toBeVisible();
	await expect(
		results.getByRole("status", { name: "Loading collections" }),
	).toHaveCount(0);
	const loadingGeometry = await results.evaluate((element) => {
		const scroll = element.querySelector<HTMLElement>(
			"[data-admin-collection-picker-scroll]",
		)!;
		return {
			height: Number.parseFloat(getComputedStyle(element).height),
			scrollOverflowY: getComputedStyle(scroll).overflowY,
		};
	});
	expect(loadingGeometry).toEqual({
		height: heightBefore,
		scrollOverflowY: "auto",
	});

	// Every frame paints rows while the folder's page replaces the old one: the old rows fade under the new ones
	// rather than leave a frame empty.
	await content.evaluate((element) => {
		const sampled = window as unknown as { emptyFrames: number; sampling: boolean };
		sampled.emptyFrames = 0;
		sampled.sampling = true;
		const painted = (row: Element) => {
			let opacity = 1;
			for (let node: Element | null = row; node && node !== element.parentElement; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
			return opacity > 0.05;
		};
		const sample = () => {
			if (![...element.querySelectorAll("[data-admin-collection-result-row]")].some(painted)) sampled.emptyFrames += 1;
			if (sampled.sampling) requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	});
	releaseChildPage();
	await expect(
		dialog.getByRole("button", {
			name: `Select ${child.name}, Native › ${parent.name}`,
		}),
	).toBeVisible();
	await expect(results).toHaveAttribute("aria-busy", "false");
	await expect(content).not.toHaveAttribute("inert");
	await page.waitForTimeout(400);
	expect(
		await page.evaluate(() => {
			const sampled = window as unknown as { emptyFrames: number; sampling: boolean };
			sampled.sampling = false;
			return sampled.emptyFrames;
		}),
	).toBe(0);
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
			collectionCount: 1,
			key: `multi-source-${index}`,
			label: `Multi source ${index + 1}`,
			provider: "zotero",
			readOnly: true,
			status: "active",
			activity: null,
			externalScopeKey: null,
			scopeKind: "group",
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
	).toBeEnabled();
	// The sources stay where they were, out of reach until the chosen one loads, with no spinner over them.
	await expect(
		sources.locator("[data-admin-collection-picker-source-content]"),
	).toHaveAttribute("inert", "");
	await expect(
		sources.getByRole("status", { name: "Loading collections" }),
	).toHaveCount(0);
	const sourceLoadingGeometry = await sources.evaluate((element) => {
		const scroll = element.querySelector<HTMLElement>(
			"[data-admin-collection-picker-source-scroll]",
		)!;
		return {
			height: Number.parseFloat(getComputedStyle(element).height),
			scrollTop: scroll.scrollTop,
		};
	});
	expect(sourceLoadingGeometry).toEqual({
		height: sourceHeight,
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
	const newCollection = page.getByRole("button", {
		exact: true,
		name: "New",
	});
	await newCollection.focus();
	await newCollection.press("Enter");
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
	// The location row shares the name and source controls' 1px border.
	expect(locationGeometry).toEqual({
		borderWidth: "1px",
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

test("persists advanced typed filters in the URL", async ({ page }) => {
	test.setTimeout(45_000);
	const listRequests: URL[] = [];
	await mockPublishedBook(page, {
		onListRequest: (url) => listRequests.push(url),
	});
	await page.goto("/admin");
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

test("keeps the URL-selected record open when filters hide its row", async ({
	page,
}) => {
	await mockPublishedBook(page, { itemCount: 2 });
	await page.route("**/api/admin/items?**", async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const filters = url.searchParams.get("filters") ?? "";
		if (
			request.method() !== "GET" ||
			url.pathname !== "/api/admin/items" ||
			!filters.includes('"draft"')
		) {
			await route.fallback();
			return;
		}
		await route.fulfill({
			json: {
				hasMore: false,
				items: [
					publishedListRow({
						key: "OTHER001",
						state: "draft",
						title: "Another draft",
					}),
				],
				nextCursor: null,
			},
		});
	});

	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");
	await expect(
		inspector.getByRole("heading", { name: "Published book" }),
	).toBeVisible();
	await expect
		.poll(() => new URL(page.url()).searchParams.get("item"))
		.toBe(publishedItemKey);

	await page.getByRole("button", { name: "Drafts", exact: true }).click();
	await expect(
		page.locator(`tr[data-record-key="${publishedItemKey}"]`),
	).toHaveCount(0);
	await expect(
		inspector.getByRole("heading", { name: "Published book" }),
	).toBeVisible();
	expect(new URL(page.url()).searchParams.get("item")).toBe(publishedItemKey);

	await page.reload();
	await expect(
		inspector.getByRole("heading", { name: "Published book" }),
	).toBeVisible();
	expect(new URL(page.url()).searchParams.get("item")).toBe(publishedItemKey);
});

test("selects the first record when an initially empty list gains results", async ({
	page,
}) => {
	await mockPublishedBook(page);
	await page.route("**/api/admin/items?**", async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (request.method() !== "GET" || url.pathname !== "/api/admin/items") {
			await route.fallback();
			return;
		}
		const filters = url.searchParams.get("filters") ?? "";
		await route.fulfill({
			json: {
				hasMore: false,
				items: filters.includes('"draft"')
					? [
							publishedListRow({
								key: publishedItemKey,
								state: "draft",
							}),
						]
					: [],
				nextCursor: null,
			},
		});
	});

	await page.goto("/admin");
	await expect
		.poll(() => new URL(page.url()).searchParams.get("item"))
		.toBeNull();

	await page.getByRole("button", { name: "Drafts", exact: true }).click();
	await expect
		.poll(() => new URL(page.url()).searchParams.get("item"))
		.toBe(publishedItemKey);
	await expect(
		page
			.locator("#admin-inspector-pane")
			.getByRole("heading", { name: "Published book" }),
	).toBeVisible();
});

test("opens a linked record directly in a narrow window", async ({ page }) => {
	await mockPublishedBook(page);
	await page.setViewportSize({ height: 768, width: 1024 });
	await page.goto(`/admin?item=${publishedItemKey}`);
	const title = page.locator("#admin-inspector-pane").getByRole("textbox", { name: "Title", exact: true });
	await expect(title).toBeVisible();
	await expect(title).toHaveValue(publishedPayload.title);
	await page.reload();
	await expect(title).toBeVisible();
});

test("returns to the open draft after finishing link selection in a narrow window", async ({ page }) => {
	await mockPublishedBook(page);
	await page.setViewportSize({ height: 768, width: 1024 });
	await page.goto(`/admin?item=${publishedItemKey}`);
	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", { name: "Edit", exact: true }).click();
	const title = inspector.getByRole("textbox", { name: "Title", exact: true });
	await expect(title).toBeEnabled();

	await inspector.getByRole("button", { name: "Add to References" }).click();
	await expect(page.getByRole("grid", { name: "Community records" })).toBeVisible();
	await page.locator('[data-admin-link-pick-banner="cites"]').getByRole("button", { name: "Done" }).click();
	await expect(title).toBeVisible();
	await expect(title).toHaveValue(publishedPayload.title);

	await inspector.getByRole("button", { name: "Related", exact: true }).click();
	await inspector.getByRole("button", { name: "Add to Related" }).click();
	await expect(page.getByRole("grid", { name: "Community records" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(title).toBeVisible();
	await expect(title).toHaveValue(publishedPayload.title);
});

test("shows matching records after choosing a navigation filter in a narrow window", async ({ page }) => {
	await mockPublishedBook(page);
	await page.setViewportSize({ height: 768, width: 1024 });
	await page.goto("/admin");
	const navigation = page.getByRole("navigation", { name: "Admin filters and collections" });
	// The toolbar contains a separate filter-dialog trigger.
	const paneToggle = page.locator('button[aria-label="Filters"]:not([aria-haspopup])');
	await paneToggle.click();
	await navigation.getByRole("button", { name: /Review queue/ }).click();
	await expect(page.getByRole("grid", { name: "Community records" })).toBeVisible();
	await expect.poll(() => new URL(page.url()).searchParams.get("review")).toBe("pending");
	await paneToggle.click();
	await navigation.getByRole("button", { name: "Created", exact: true }).click();
	await expect(page.getByRole("grid", { name: "Community records" })).toBeVisible();
	await expect.poll(() => new URL(page.url()).searchParams.get("review")).toBeNull();
});

test("filters by searched native and imported collections without loading an option list", async ({
	page,
}) => {
	const collectionSearches: URL[] = [];
	const extraSources: AdminSource[] = Array.from(
		{ length: 12 },
		(_, index) => ({
			collectionCount: 1,
			key: `source-${index}`,
			label: `Source ${index + 1}`,
			provider: "zotero",
			readOnly: true,
			status: "active",
			activity: null,
			externalScopeKey: null,
			scopeKind: "group",
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
			resultsHeight: Number.parseFloat(getComputedStyle(results).height),
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
	expect(geometry.resultsHeight).toBeLessThanOrEqual(320);
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
	options: { attachmentState?: "draft" | "published"; imported?: boolean; editable?: boolean; sourcePdf?: boolean } = {},
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
		kind: "created",
		importMethod: null,
		editable: options.editable ?? true,
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
		sourceConnectionKey: options.imported ? "zotero:test" : "native",
		sourceFileUrl: options.imported ? "https://example.test/source.pdf" : null,
		state: attachmentState,
		title: "PDF attachment",
		updatedAt: timestamp,
		writeback: { available: [], originSourceKey: null, selected: [] },
		sourcePdf: null as null | { publishTags: string[] | null; choice: null; pending: "publish" | null; inReview: boolean; applied: boolean; pdfsOn: boolean },
		sourcePdfChangePending: false,
		...(options.sourcePdf
			? {
					// A Zotero PDF the library doesn't publish, on a record writeback can't change.
					draft: null,
					fileDraft: null,
					filePublication: null,
					fileState: "unpublished",
					sourceFileUrl: `/api/admin/items/${attachmentKey}/file/source`,
					sourcePdf: { publishTags: ["_publish"], choice: null, pending: null, inReview: false, applied: true, pdfsOn: true },
				}
			: {}),
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
		links: emptyLinks,
		tags: [],
		sourceFields: [],
		importedTopics: [],
	};

	await page.route("**/api/admin/**", async (route) => {
		const request = route.request();
		const pathname = new URL(request.url()).pathname;
		if (request.method() === "POST" && pathname === `/api/admin/items/${attachmentKey}/file/source`) {
			// Staging the Zotero PDF puts it in the working draft as an uploaded one would be.
			const staged = { ...fileDraft, filename: "report.pdf" };
			Object.assign(attachmentDetail, { fileDraft: staged, fileState: "staged", sourcePdf: { ...attachmentSummary.sourcePdf!, pending: "publish" }, sourcePdfChangePending: true });
			Object.assign(parentDetail, { sourcePdfChangePending: true, attachments: [{ ...attachmentSummary, fileDraft: staged, fileState: "staged" }] });
			await route.fulfill({ status: 204 });
			return;
		}
        if (request.method() === "GET" && pathname.endsWith("/review")) {
            await route.fulfill({json: {reviews: []}});
            return;
        }
        if (request.method() === "GET" && pathname.endsWith("/publishing-choice")) {
            await route.fulfill({json: {choice: null}});
            return;
        }
        if (request.method() === "GET" && pathname.endsWith("/publication/crossref/reserve")) {
            await route.fulfill({json: {reservation: null}});
            return;
        }
        if (pathname === "/api/admin/reviews") {
            await route.fulfill({json: {count: 0}});
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
	await page.route(`**/api/admin/items/${attachmentKey}/draft`, async (route) => {
        if (route.request().method() === "DELETE") {
            parentDetail.attachments = [];
            await route.fulfill({status: 204});
            return;
        }
        expect(route.request().method()).toBe("POST");
        attachmentDetail.draft = attachmentDraft;
        await route.fulfill({json: {draft: attachmentDraft}});
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
 await target.scrollIntoViewIfNeeded();
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

test("creates an item through a pointer click in the new-item popover", { tag: "@smoke" }, async ({
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
						generation: draftGeneration,
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
							generation: draftGeneration,
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
						links: emptyLinks,
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
						writeback: {
							available: [],
							originSourceKey: null,
							selected: [],
						},
					},
				},
			});
			return;
		}

		if (pathname === `/api/admin/items/${itemKey}/publication`) {
			await route.fulfill({ status: 404 });
			return;
		}

		await route.fulfill({ status: 404 });
	});

	await page.goto("/admin");
	await page.getByRole("button", { name: "Create Item" }).click();

	const popover = page.getByRole("dialog", { name: "Create Item" });
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

test("keeps add controls disabled until a working draft is opened", async ({ page }) => {
	await mockPublishedBook(page);
	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");
	const labels = ["Add creator", "Add to References", "Add to collection", "Add attachment", "Add PDF"];
	for (const name of labels) await expect(inspector.getByRole("button", { name, exact: true })).toBeDisabled();
	await inspector.getByRole("button", { name: "Edit", exact: true }).click();
	for (const name of labels) await expect(inspector.getByRole("button", { name, exact: true })).toBeEnabled();
});

test("focuses item search in a narrow keyboard-driven window", async ({
	page,
}) => {
	await mockPublishedBook(page);
	await page.setViewportSize({ height: 768, width: 1024 });
	await page.goto("/admin");
	await page.getByRole("button", { name: "Create Item" }).click();

	const search = page
		.getByRole("dialog", { name: "Create Item" })
		.getByRole("textbox", { name: "Find an item type" });
	await expect(search).toBeVisible();
	await expect(search).toBeFocused();
});

test("lets touch users browse item types without opening the keyboard", async ({
	browser,
}) => {
	const context = await browser.newContext({
		baseURL: process.env.PLAYWRIGHT_BASE_URL,
		hasTouch: true,
		ignoreHTTPSErrors: true,
		viewport: { height: 844, width: 390 },
	});
	const page = await context.newPage();
	await mockPublicShell(page);
	await mockPublishedBook(page);
	await openAdmin(page);
	await page.getByRole("button", { name: "Create Item" }).click();

	const search = page
		.getByRole("dialog", { name: "Create Item" })
		.getByRole("textbox", { name: "Find an item type" });
	await expect(search).toBeVisible();
	await expect(search).not.toBeFocused();
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

	await inspector.getByRole("button", { name: "Edit", exact: true }).click();
	await expect(title).toBeEnabled();
	const editableFieldCount = await fields.count();
	expect(editableFieldCount).toBeGreaterThanOrEqual(fieldCount);
	for (let index = 0; index < editableFieldCount; index += 1) {
		await expect(fields.nth(index)).toBeEnabled();
	}
	await expect(creatorRole).not.toHaveAttribute("data-disabled", "true");
});

test("keeps the form and the draft when Tab leaves an unchanged item type", async ({
	page,
}) => {
	const savedDrafts: Record<string, unknown>[] = [];
	// The API sends item types capitalized and the list of types keys them in camel case, as a real record does.
	await mockPublishedBook(page, {
		initialDraftPayload: { ...publishedPayload, itemType: "Book" },
		onDraftSave: (payload) => savedDrafts.push(structuredClone(payload)),
	});
	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", { name: "Edit", exact: true }).click();

	const itemType = inspector.getByRole("combobox", { name: "Item type" });
	await itemType.click();
	await expect(itemType).toHaveAttribute("aria-expanded", "true");
	await page.keyboard.press("Tab");
	await expect(itemType).not.toBeFocused();

	// A field filled straight after keeps its focus through the save that follows, and the type stays as it was.
	const next = page.locator("#admin-inspector-pane input:focus, #admin-inspector-pane textarea:focus");
	await expect(next).toBeVisible();
	await page.keyboard.type("x");
	await expect.poll(() => savedDrafts.length).toBeGreaterThan(0);
	await expect(inspector.getByText("Saved", { exact: true })).toBeVisible();
	await expect(next).toBeVisible();
	expect(savedDrafts.at(-1)?.itemType).toBe("Book");
});

test("uses controls that preserve every supported metadata value", async ({
	page,
}) => {
	const savedDrafts: Record<string, unknown>[] = [];
	await mockPublishedBook(page, {
		canonicalDraftResponses: true,
		onDraftSave: (payload) => savedDrafts.push(structuredClone(payload)),
	});
	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", { name: "Edit", exact: true }).click();

	const url = inspector.getByLabel("URL", { exact: true });
	const doi = inspector.getByLabel("DOI", { exact: true });
	const accessDate = inspector.getByLabel("Access Date", { exact: true });
	await expect(url).toHaveAttribute("type", "url");
	await expect(doi).toHaveAttribute("type", "text");
	await expect(doi).toHaveAttribute("data-field-kind", "text");
	await expect(accessDate).toHaveAttribute("type", "date");
	await accessDate.fill("2024-05-20");
	await expect
		.poll(() =>
			savedDrafts.some(
				(payload) => payload.accessDate === "2024-05-20",
			),
		)
		.toBe(true);
	// A language is chosen from the list and saved as its code, which the registrars take.
	const language = inspector.getByRole("combobox", { name: "Language", exact: true });
	await language.fill("Fren");
	await page.getByRole("option", { name: "French", exact: true }).click();
	await expect
		.poll(() =>
			savedDrafts.some((payload) => payload.language === "fr"),
		)
		.toBe(true);
	await expect(inspector.getByText("Saved", { exact: true })).toBeVisible();
	await expect(language).toHaveValue("French");

	const itemType = inspector.getByRole("combobox", { name: "Item type" });
	await itemType.evaluate((element) =>
		element.scrollIntoView({ block: "center" }),
	);
	await itemType.fill("Case");
	await page
		.getByRole("option", { name: "Case", exact: true })
		.click({ force: true });
	await expect(
		inspector.getByLabel("Case Name", { exact: true }),
	).toBeVisible();
	await expect(inspector.getByText("Saved", { exact: true })).toBeVisible();

	const precision = inspector.getByRole("combobox", {
		name: "Date Decided precision",
	});
	await expect(precision.locator("option")).toHaveText([
		"Exact date",
		"Month",
		"Year",
	]);
	await precision.selectOption("year");
	const decided = inspector.getByLabel("Date Decided", { exact: true });
	await expect(decided).toHaveAttribute("type", "number");
	await expect(decided).toHaveAttribute("inputmode", "numeric");
	await decided.pressSequentially("2024");
	await expect(decided).toHaveAttribute("type", "number");
	await expect
		.poll(() =>
			savedDrafts.some((payload) => payload.dateDecided === "2024"),
		)
		.toBe(true);
});

test("keeps an empty annotation colour empty", async ({ page }) => {
	await mockPublishedBook(page, {
		initialDraftPayload: {
			annotationColor: "",
			annotationPosition: '{"pageIndex":0,"rects":[]}',
			annotationType: "highlight",
			itemType: "Annotation",
			parentItem: "PARENT01",
		},
	});
	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", { name: "Edit", exact: true }).click();

	const annotationColor = inspector.getByLabel("Annotation Color", {
		exact: true,
	});
	await expect(annotationColor).toHaveAttribute("type", "text");
	await expect(annotationColor).toHaveValue("");
	await expect(
		inspector.getByLabel("Annotation Color picker", { exact: true }),
	).toHaveAttribute("type", "color");
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
	await inspector.getByRole("button", { name: "Edit", exact: true }).click();
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
	// The marker leaves with the change: focus stays beside its field, not on the page.
	await expect(inspector.locator(":focus")).toContainText("Title");
	await page.keyboard.press("Tab");
	await expect(title).toBeFocused();

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
	const collectionMarker = inspector.getByRole("button", {
		name: "Changed: show published collections",
	});
	await expect(collectionMarker).toBeVisible();
	await collectionMarker.click();
	await expect(page.getByText("Empty", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Revert to published" }).click();
	await expect(collectionsGroup.locator("[data-admin-collection-membership]")).toHaveCount(0);
	await expect.poll(() => savedDrafts.at(-1)?.collections).toEqual([]);
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
	await inspector.getByRole("button", { name: "Edit", exact: true }).click();
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
	await inspector.getByRole("button", { name: "Edit", exact: true }).click();
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
	await inspector.getByRole("button", { name: "Edit", exact: true }).click();
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

test("adds a library PDF beside an imported file and retries without creating a second native attachment", async ({ page }) => {
	await mockPublishedBook(page, { initialDraftPayload: publishedPayload });
	const attachmentKey = "COVER123";
	const created: Record<string, unknown>[] = [];
	let completed = false;
	let failUpload = true;
	const fileDraft = () => ({
		itemKey: attachmentKey, filename: "report.pdf", uploadRevision: 1,
		expectedSha256: "hash", expectedSizeBytes: 4, actualSha256: completed ? "hash" : null,
		actualSizeBytes: completed ? 4 : null, pageCount: completed ? 1 : null,
		coverWidth: completed ? 1 : null, coverHeight: completed ? 1 : null,
		updatedAt: timestamp, readyAt: completed ? timestamp : null,
	});
	await page.route(`**/api/admin/items/${publishedItemKey}`, async (route) => route.fulfill({ json: { item: {
		...publishedDetail(true),
		attachments: [{
			...publishedDetail(false), key: "SOURCE22", itemType: "Attachment", title: "Original source PDF",
			parentItem: publishedItemKey, sourceConnectionKey: "zotero:test", sourceFileUrl: "https://example.test/source.pdf",
		}, ...(created.length ? [{
			...publishedDetail(true), key: attachmentKey, itemType: "Attachment", title: "report.pdf",
			parentItem: publishedItemKey, published: null, fileState: completed ? "staged" : "processing",
			fileDraft: fileDraft(), state: "draft", fileRemovalPending: false,
		}] : [])],
	} } }));
	await page.route("**/api/admin/items/drafts", async (route) => {
		created.push(route.request().postDataJSON());
		await route.fulfill({ json: { draft: { ...publishedDraft(), itemKey: attachmentKey } } });
	});
	await page.route(`**/api/admin/items/${attachmentKey}/file`, async (route) => route.fulfill({
		json: { fileDraft: fileDraft(), upload: { signedUrl: new URL("/test-pdf-upload", page.url()).toString() } },
	}));
	await page.route("**/test-pdf-upload", async (route) => {
		await route.fulfill({ status: failUpload ? 503 : 200, json: {} });
	});
	await page.route(`**/api/admin/items/${attachmentKey}/file/complete`, async (route) => {
		completed = true;
		await route.fulfill({ json: { fileDraft: fileDraft() } });
	});
	await page.route(`**/api/admin/items/${attachmentKey}/file/cover?*`, async (route) => route.fulfill({
		contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=", "base64"),
	}));
	await page.goto(`/admin?item=${publishedItemKey}`);
	const choosePdf = async () => {
		const chooser = page.waitForEvent("filechooser");
		await page.getByRole("button", { name: /^(Add|Replace|Retry) PDF$/u }).click();
		await (await chooser).setFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") });
	};
	await expect(page.getByRole("button", {name: "Add PDF", exact: true})).toBeEnabled();
	await choosePdf();
	await expect(page.locator('[data-admin-region="inspector-scroll"] [role="alert"]')).toBeVisible();
	expect(completed).toBe(false);
	expect(created).toEqual([{ collections: [], itemType: "attachment", parentItem: publishedItemKey, tags: [], title: "report.pdf" }]);
	failUpload = false;
	await choosePdf();
	await expect(page.getByRole("button", { name: "Replace PDF", exact: true })).toBeEnabled();
	await expect(page.locator('[data-admin-document-header] img')).toBeVisible();
	expect(created).toHaveLength(1);
	expect(completed).toBe(true);
	expect(new URL(page.url()).searchParams.get("item")).toBe(publishedItemKey);
});

for (const editable of [true, false]) {
	test(`keeps imported attachment upload and duplication unavailable (editable: ${editable})`, async ({ page }) => {
		await mockBookWithAttachment(page, { imported: true, editable });
		await page.goto("/admin");
		const inspector = page.locator("#admin-inspector-pane");
		await expect(inspector.getByRole("button", { name: "Add PDF", exact: true })).toBeDisabled();
		await inspector.getByRole("button", { name: "Open PDF attachment", exact: true }).click();
		await expect(inspector.getByRole("button", { name: "Add PDF", exact: true })).toBeDisabled();
		if (editable) {
			await expect(inspector.getByRole("button", { name: "Edit", exact: true })).toBeEnabled();
		} else {
			// Duplicating belongs to the record; an attachment it can't change offers nothing.
			await expect(inspector.getByRole("button", { name: "Duplicate as native", exact: true })).toHaveCount(0);
		}
	});
}

test("submits an attachment's change with its record", async ({page}) => {
	await mockBookWithAttachment(page, {attachmentState: "draft"});
	const submitted: string[] = [];
	await page.route("**/api/admin/items/*/review", async (route) => {
		if (route.request().method() !== "POST") return route.fallback();
		submitted.push(new URL(route.request().url()).pathname);
		await route.fulfill({json: {review: {id: "review-1", itemKey: publishedItemKey, state: "pending", revision: 1, submittedBy: "editor", submittedAt: timestamp, resolvedAt: null, resolvedBy: null, note: null, corrections: [], remainingConflicts: {}, snapshot: {records: [], publishingChoice: null}}}});
	});
	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", {name: "Open PDF attachment"}).click();
	await inspector.getByRole("button", {name: "Send to queue", exact: true}).click();
	const dialog = page.getByRole("dialog", {name: "Send this version to the review queue?"});
	await dialog.getByRole("button", {name: "Send to queue", exact: true}).click();
	await expect(dialog).toBeHidden();
	// A review is always for the whole record, so the attachment's change goes with its parent.
	expect(submitted).toEqual([`/api/admin/items/${publishedItemKey}/review`]);
});

test("offers no review for a Zotero PDF staged while its record is in review", async ({page}) => {
	await mockBookWithAttachment(page, {imported: true, editable: false, sourcePdf: true});
	// The record's pending review was taken before this PDF was staged.
	await mockSubmittedReview(page, async () => ({json: {}}));
	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", {name: "Open PDF attachment"}).click();
	await inspector.locator('[data-admin-file-row="source"]').getByRole("button", {name: "Stage PDF", exact: true}).click();
	await expect(inspector.locator('[data-admin-file-row="staged"]')).toContainText("report.pdf");
	await expect(inspector.getByRole("button", {name: "Send to queue", exact: true})).toBeDisabled();
});

test("stages a Zotero PDF and submits its record for review while writeback is off", async ({page}) => {
	await mockBookWithAttachment(page, {imported: true, editable: false, sourcePdf: true});
	const submitted: string[] = [];
	await page.route("**/api/admin/items/*/review", async (route) => {
		if (route.request().method() !== "POST") return route.fallback();
		submitted.push(new URL(route.request().url()).pathname);
		await route.fulfill({json: {review: {id: "review-1", itemKey: publishedItemKey, state: "pending", revision: 1, submittedBy: "editor", submittedAt: timestamp, resolvedAt: null, resolvedBy: null, note: null, corrections: [], remainingConflicts: {}, snapshot: {records: [], publishingChoice: null}}}});
	});
	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", {name: "Open PDF attachment"}).click();
	const source = inspector.locator('[data-admin-file-row="source"]');
	await expect(source).toContainText("_publish");
	// A Zotero PDF is Zotero's file: nothing is uploaded over it here.
	await expect(inspector.getByRole("button", {name: "Upload PDF"})).toHaveCount(0);
	await source.getByRole("button", {name: "Stage PDF", exact: true}).click();
	await expect(inspector.locator('[data-admin-file-row="staged"]')).toContainText("report.pdf");
	await inspector.getByRole("button", {name: "Send to queue", exact: true}).click();
	const dialog = page.getByRole("dialog", {name: "Send this version to the review queue?"});
	await dialog.getByRole("button", {name: "Send to queue", exact: true}).click();
	await expect(dialog).toBeHidden();
	expect(submitted).toEqual([`/api/admin/items/${publishedItemKey}/review`]);
});

test("opens the record when a review sent from its attachment is refused", async ({page}) => {
	await mockBookWithAttachment(page, {attachmentState: "draft"});
	await page.route("**/api/admin/items/*/review", async (route) => {
		if (route.request().method() !== "POST") return route.fallback();
		await route.fulfill({status: 422, json: {error: {code: "validation_failed", fields: {title: "Add a title"}, message: "Fix the highlighted fields."}}});
	});
	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", {name: "Open PDF attachment"}).click();
	await inspector.getByRole("button", {name: "Send to queue", exact: true}).click();
	const dialog = page.getByRole("dialog", {name: "Send this version to the review queue?"});
	await dialog.getByRole("button", {name: "Send to queue", exact: true}).click();
	await expect(dialog.getByRole("alert")).toBeVisible();
	// The record's review requirements say what it still needs.
	await expect(page).toHaveURL(new RegExp(`item=${publishedItemKey}`, "u"));
	await dialog.getByRole("button", {name: "Cancel", exact: true}).click();
	await expect(inspector.getByRole("button", {name: "Parent record"})).toHaveCount(0);
});

test("stays on the attachment when its own save fails before the review is sent", async ({page}) => {
	await mockBookWithAttachment(page, {attachmentState: "draft"});
	await page.route("**/api/admin/items/PDFATT22/draft", async (route) => {
		if (route.request().method() === "GET") return route.fallback();
		await route.fulfill({status: 500, json: {error: {code: "internal", message: "The draft could not be saved."}}});
	});
	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", {name: "Open PDF attachment"}).click();
	// An edit the attachment has yet to save, so submitting saves it first.
	await inspector.getByRole("textbox", {name: "Title", exact: true}).fill("Renamed PDF");
	await inspector.getByRole("button", {name: "Send to queue", exact: true}).click();
	const dialog = page.getByRole("dialog", {name: "Send this version to the review queue?"});
	await dialog.getByRole("button", {name: "Send to queue", exact: true}).click();
	await expect(dialog.getByRole("alert")).toBeVisible();
	await dialog.getByRole("button", {name: "Cancel", exact: true}).click();
	// Still on the attachment, where the failed save can be retried.
	await expect(inspector.getByRole("button", {name: "Parent record"})).toBeVisible();
});

test("offers no review for an attachment added after its record was submitted", async ({page}) => {
	await mockBookWithAttachment(page, {attachmentState: "draft"});
	// The record's pending review was taken before the attachment existed.
	await mockSubmittedReview(page, async () => ({json: {}}));
	await page.goto("/admin");
	const inspector = page.locator("#admin-inspector-pane");
	await inspector.getByRole("button", {name: "Open PDF attachment"}).click();
	await expect(inspector.getByRole("button", {name: "Send to queue", exact: true})).toBeDisabled();
	// It isn't in that review, so it can still be deleted.
	await inspector.getByRole("button", {name: "Record status and sources"}).click();
	await expect(page.getByRole("button", {name: "Delete draft", exact: true})).toBeEnabled();
});

test("keeps an unpublished attachment private and stages it with the parent review", async ({page}) => {
    await mockBookWithAttachment(page, {attachmentState: "draft"});
    await page.goto("/admin");
    const inspector = page.locator("#admin-inspector-pane");
    await inspector.getByRole("button", {name: "Open PDF attachment"}).click();
    await expect(page.getByLabel("Open public item")).toHaveCount(0);
    await expect(page.getByLabel("Copy public item link")).toHaveCount(0);
    await expect(inspector.locator('[data-admin-file-row="staged"]')).toContainText("replacement.pdf");
    await expect(inspector.getByRole("button", {name: "Discard staged PDF"})).toBeVisible();
    await expect(inspector.getByRole("button", {name: "Publish PDF", exact: true})).toHaveCount(0);
    await inspector.getByRole("button", {name: "Parent record"}).click();
    await expect(inspector.getByRole("button", {name: "Open PDF attachment"})).toBeVisible();
    await inspector.getByRole("button", {name: "Open PDF attachment"}).click();
    await inspector.getByRole("button", {name: "Record status and sources"}).click();
    await page.getByRole("button", {name: "Delete draft", exact: true}).click();
    const dialog = page.getByRole("dialog", {name: "Delete draft?"});
    await dialog.getByRole("button", {name: "Cancel", exact: true}).click();
    await inspector.getByRole("button", {name: "Record status and sources"}).click();
    await page.getByRole("button", {name: "Delete draft", exact: true}).click();
    await dialog.getByRole("button", {name: "Delete permanently", exact: true}).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`item=${publishedItemKey}`, "u"));
    await expect(inspector.getByRole("button", {name: "Open PDF attachment"})).toHaveCount(0);
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
		collectionCount: 0,
		key: "empty-import",
		label: "Empty import",
		provider: "zotero",
		readOnly: true,
		status: "active",
		activity: null,
		externalScopeKey: null,
		scopeKind: "group",
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
	await expect(source).toBeFocused();
	// The load finished and nothing is listed under a source without
	// collections.
	await expect(source).not.toHaveAttribute("aria-busy");
	await expect(source).toBeFocused();
	await expect(tree.getByText("No collections here")).toHaveCount(0);
});

test("does not steal focus when a collection load finishes after the user leaves", async ({
	page,
}) => {
	const slowSource: AdminSource = {
		collectionCount: 1,
		key: "slow-import",
		label: "Slow import",
		provider: "zotero",
		readOnly: true,
		status: "active",
		activity: null,
		externalScopeKey: null,
		scopeKind: "group",
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
	const slowRow = tree.getByRole("treeitem", {
		name: slowSource.label,
		exact: true,
	});
	await slowRow.click();
	await expect(slowRow).toHaveAttribute("aria-busy", "true");
	await page.keyboard.press("ArrowRight");
	const nativeSource = tree.getByRole("treeitem", {
		name: "Native",
		exact: true,
	});
	await nativeSource.focus();
	releaseLoad();
	await expect(slowRow).not.toHaveAttribute("aria-busy");
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
	// The tree comes with the page and is read again once open: the group is busy while that read is held, and
	// the collections the page itself came with are already listed under it.
	await expect(nativeGroup).toHaveAttribute("aria-busy", "true");
	await expect(tree.locator('[role="treeitem"][aria-level="2"]').first()).toBeVisible();
	releaseRootPage();
	await expect(
		tree.getByText("Collection 001", { exact: true }),
	).toBeVisible();
	await page.keyboard.press("ArrowRight");
	await expect(
		tree.getByRole("treeitem", {
			name: teacherCollection.name,
			exact: true,
		}),
	).toBeFocused();
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
	// While it loads, the row keeps its name and is announced as busy.
	const loadingMore = tree.getByRole("treeitem", { name: "Load more", disabled: true });
	await expect(loadingMore).toBeFocused();
	await expect(loadingMore).toHaveAttribute("aria-busy", "true");
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

test("keeps sorting and collection management accessible", async ({ page }) => {
	await mockPublishedBook(page);
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/admin");
	await expect(
		page.getByRole("heading", { name: "Published book" }),
	).toBeVisible();

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
	const reloadedRecordRow = page.locator(
		`tr[data-record-key="${publishedItemKey}"]`,
	);
	await expect(reloadedRecordRow).toBeVisible();
	expect(
		await reloadedRecordRow.evaluate(
			(row) => row.getBoundingClientRect().height,
		),
	).toBe(44);
	expect(
		await page
			.locator('thead th[data-column-id="title"]')
			.evaluate((header) => header.getBoundingClientRect().width),
	).toBeGreaterThan(beforeWidth + 35);
});

test("lets Creators assign records but prevents library management actions", { tag: "@smoke" }, async ({
	page,
}) => {
	const batchRequests: unknown[] = [];
	await signInAdmin(page, "creator");
	await mockPublishedBook(page, {
		itemCount: 2,
		onBatchRequest: (body) => batchRequests.push(body),
	});
	await page.goto("/admin");
	await expect(page.getByRole("heading", { name: "Published book" })).toBeVisible();
	await page.getByRole("checkbox", { name: "Select all loaded records" }).check();
	const toolbar = page.getByRole("toolbar", { name: "Bulk actions" });
	await expect(toolbar.getByRole("button", { name: "Remove selected" })).toBeDisabled();
	await expect(page.getByRole("button", { name: "New", exact: true })).toBeDisabled();
	await expect(page.locator('[data-collection-key="TEACHDEV"]')).toBeVisible();
	await expect(page.getByRole("button", { name: /^Manage / })).toHaveCount(0);
	await expect(page.getByRole("button", { name: /^Drag Teacher/ })).toHaveCount(0);
	await expect(toolbar.getByRole("button", { name: "Add selected to collection" })).toBeEnabled();
	await assignSelectedRecords(page);
	expect(batchRequests).toEqual([
		{
			action: "assignCollection",
			collectionKey: "TEACHDEV",
			keys: ["LIVEB22K", "ROW00001"],
		},
	]);
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
	await assignSelectedRecords(page);
	await expect.poll(() => batchRequests.length).toBe(1);
	expect(batchRequests).toEqual([
		{
			action: "assignCollection",
			collectionKey: teacherCollection.key,
			keys: [publishedItemKey, "ROW00001"],
		},
	]);
	await expect(bulkToolbar.getByText("selected")).toHaveCount(0);
	for (const label of [
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
	const grid = page.getByRole("grid", { name: "Community records" });
	await expect(grid).toHaveAttribute("aria-rowcount", "501");
	await grid.focus();
	await grid.press("Meta+A");
	const bulkToolbar = page.getByRole("toolbar", { name: "Bulk actions" });
	await expect(bulkToolbar).toContainText("500 selected");
	await assignSelectedRecords(page);
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
	await inspector.getByRole("button", { name: "Edit", exact: true }).click();
	await inspector
		.getByRole("textbox", { name: "Title", exact: true })
		.fill("Invalid local draft");
	await page
		.getByRole("checkbox", { name: "Select all loaded records" })
		.check();
	const bulkToolbar = page.getByRole("toolbar", { name: "Bulk actions" });
	await assignSelectedRecords(page);

	await expect
		.poll(() => batchRequests)
		.toEqual([
			{
				action: "assignCollection",
				collectionKey: teacherCollection.key,
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
	await expect(page.getByText(/1 draft updated, 1 failed/)).toBeVisible();
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
	await inspector.getByRole("button", { name: "Edit", exact: true }).click();
	await page
		.getByRole("checkbox", {
			name: "Select Published book",
			exact: true,
		})
		.check();
	await assignSelectedRecords(page);

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
	const table = page.getByRole("grid", { name: "Community records" });
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
	const grid = page.getByRole("grid", { name: "Community records" });
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
	await expect(grid).toHaveAttribute(
		"aria-activedescendant",
		`admin-item-grid-cell-${publishedItemKey}-title`,
	);
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
	await assignSelectedRecords(page);
	await batchStarted;

	try {
		const grid = page.getByRole("grid", { name: "Community records" });
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
		page.getByRole("button", { name: "Add selected to collection" }),
	).toBeDisabled();
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
	const grid = page.getByRole("grid", { name: "Community records" });
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
	// Showing columns re-renders the row, which can replace the hovered chip.
	await expect(async () => {
		await page.mouse.move(0, 0);
		await tags.getByText("+1", { exact: true }).hover();
		await expect(page.getByRole("tooltip")).toHaveText("rural schools", {
			timeout: 1_000,
		});
	}).toPass();
	await expect(source).toContainText("Native");
	await expect(source.locator("svg")).toHaveCount(1);
	await expect(dateAdded).toContainText("Jul 31, 2026");
	await expect(dateAdded.locator("svg")).toHaveCount(1);
	await expect(year).toHaveText("2024");
	await expect(revision).toHaveText("27");
	await expect(pageCount).toHaveText("146");

	for (const cell of [year, revision, pageCount]) {
		await expect(cell.locator("span")).toHaveCSS(
			"font-variant-numeric",
			/tabular-nums/,
		);
	}
});

test("lets Creators request restoration without changing writeback sources", async ({ page }) => {
	await signInAdmin(page, "creator");
	await mockPublishedBook(page);
	const target = {
		effective: true, isOrigin: false, itemEnabled: true, linkExists: true,
		provider: "zotero", reason: "ok", sourceEnabled: true,
		sourceKey: "zotero:qa", sourceLabel: "Test source", sourceStatus: "active", supported: true,
	};
	let restorationDraft = false;
	await page.route(`**/api/admin/items/${publishedItemKey}/draft`, route => {
		restorationDraft = true;
		return route.fulfill({ json: { draft: publishedDraft(publishedPayload) } });
	});
	await page.route(`**/api/admin/items/${publishedItemKey}`, route => route.fulfill({
		json: { item: { ...publishedDetail(restorationDraft), state: "deleted", writeback: {
			available: [target], originSourceKey: null, selected: [target.sourceKey],
		} } },
	}));
	let sourceMutations = 0;
	await page.route(`**/api/admin/items/${publishedItemKey}/writeback/**`, route => {
		if (route.request().method() !== "GET") {
			sourceMutations += 1;
			return route.fulfill({ status: 403, json: { error: { code: "forbidden", message: "Publisher required" } } });
		}
		return route.fulfill({ json: { status: {
			attempts: 3, canonicalRevision: 1, error: "Source unavailable", jobId: 1,
			nextAttemptAt: null, processedAt: null, sourceKey: target.sourceKey, state: "failed",
		} } });
	});
	let submissions = 0;
	await page.route(`**/api/admin/items/${publishedItemKey}/review`, route => {
		if (route.request().method() === "POST") {
			submissions += 1;
			return route.fulfill({ json: { review: { id: "restore-creator", revision: 1, state: "pending" } } });
		}
		return route.fulfill({ json: { reviews: [] } });
	});
	await page.goto("/admin");
	await page.getByRole("button", { name: "Record status and sources", exact: true }).click();
	await expect(page.getByRole("button", { name: "Manage sources", exact: true })).toBeDisabled();
	await page.getByRole("button", { name: "Sources Sync failed", exact: true }).click();
	await expect(page.getByRole("button", { name: "Retry writeback", exact: true })).toBeDisabled();
	await page.reload();
	const inspector = page.locator("#admin-inspector-pane");
	await expect(inspector.getByRole("button", { name: "Add PDF", exact: true })).toHaveCount(0);
	await expect(inspector.getByRole("button", { name: "Add attachment", exact: true })).toBeDisabled();
	await page.getByRole("button", { name: "Restore", exact: true }).click();
	await expect(page.getByText("Restoration submitted for review", { exact: true })).toBeVisible();
	await expect(inspector.getByRole("textbox", { name: "Title", exact: true })).toBeEditable();
	await expect(inspector.getByRole("button", { name: "Add attachment", exact: true })).toBeEnabled();
	const picker = page.waitForEvent("filechooser");
	await inspector.getByRole("button", { name: "Add PDF", exact: true }).click();
	expect((await picker).isMultiple()).toBe(false);
	await page.reload();
	await expect(inspector.getByRole("button", { name: "Add PDF", exact: true })).toBeEnabled();
	expect(submissions).toBe(1);
	expect(sourceMutations).toBe(0);
});

test("unpublishes through the inspector and submits restoration for review", async ({page}) => {
  await mockPublishedBook(page);
  const indexing = await mockCompletedIndexing(page);
  const receipt = indexingReceipt(publishedItemKey, "item", 3);
  let unpublishRequests = 0;
  await page.route(`**/api/admin/items/${publishedItemKey}/unpublish`, route => {
    expect(route.request().method()).toBe("POST");
    unpublishRequests += 1;
    return route.fulfill({json: {item: {...publishedDetail(false), state: "deleted"}, indexingReceipts: [receipt]}});
  });
  await page.goto(`/admin?item=${publishedItemKey}`);
  const inspector = page.locator("#admin-inspector-pane");
  await inspector.getByRole("button", {name: "Record status and sources"}).click();
  await page.getByRole("button", {name: "Unpublish", exact: true}).click();
  const dialog = page.getByRole("dialog", {name: "Unpublish record?"});
  await dialog.getByRole("button", {name: "Cancel", exact: true}).click();
  // Reopening the menu while the dialog still closes lets its focus return shut the new menu.
  await expect(dialog).toBeHidden();
  expect(unpublishRequests).toBe(0);
  await inspector.getByRole("button", {name: "Record status and sources"}).click();
  await page.getByRole("button", {name: "Unpublish", exact: true}).click();
  await dialog.getByRole("button", {name: "Unpublish record", exact: true}).click();
  await indexing.expectTracked(receipt);
  await expect(dialog).toBeHidden();
  expect(unpublishRequests).toBe(1);
  let submissions = 0;
  await page.route("**/api/admin/items", route => route.fulfill({json: {hasMore: false, items: [publishedListRow({state: "deleted"})], nextCursor: null}}));
  await page.route(`**/api/admin/items/${publishedItemKey}`, route => route.fulfill({json: {item: {...publishedDetail(false), state: "deleted"}}}));
  await page.route(`**/api/admin/items/${publishedItemKey}/review`, async route => {
    if (route.request().method() === "POST") {
      submissions += 1;
      return route.fulfill({json: {review: {id: "restoration-review", revision: 1, state: "pending"}}});
    }
    return route.fulfill({json: {reviews: []}});
  });
  await page.reload();
  await inspector.getByRole("button", {name: "Restore", exact: true}).click();
  await expect.poll(() => submissions).toBe(1);
  await expect(page.getByText("Restoration submitted for review", {exact: true})).toBeVisible();
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
  await mockSubmittedReview(page, async () => {
    book.setEditing(false);
    return {json: {indexingReceipts: [receipt], review: {}}};
  });

	await page.goto("/admin");
  const dialog = await openReviewApproval(page);
  await dialog.getByRole("button", {name: "Publish version", exact: true}).click();

	await expect(
		page.getByText("Submitted version published", { exact: true }),
	).toHaveCount(0);
	receiptState = "indexed";
	await expect(
		page.getByText("Submitted version published", { exact: true }),
	).toBeVisible({ timeout: 4_000 });
});

test("requires explicit confirmation before publishing a Zenodo PDF correction", async ({page}) => {
  await mockPublishedBook(page);
  const indexing = await mockCompletedIndexing(page);
  const receipt = indexingReceipt(publishedItemKey, "item", 2);
  const approvals: Record<string, unknown>[] = [];
  await mockSubmittedReview(page, async body => {
    approvals.push(body);
    if (body.zenodoFileChange !== "minor_correction") return {status: 409, json: {error: {
      code: "confirmation_required", message: "This PDF correction updates the same Zenodo record and DOI."
    }}};
    return {json: {indexingReceipts: [receipt], review: {}}};
  });
  await page.goto("/admin");
  const dialog = await openReviewApproval(page);
  await dialog.getByRole("button", {name: "Publish version", exact: true}).click();
  await expect(dialog.getByRole("alert")).toContainText("same Zenodo record and DOI");
  expect(approvals).toEqual([{action: "approve", expectedRevision: 1}]);
  await dialog.getByRole("button", {name: "Publish correction", exact: true}).click();
  await expect(dialog).toBeHidden();
  expect(approvals[1]).toEqual({action: "approve", expectedRevision: 1, zenodoFileChange: "minor_correction"});
  await indexing.expectTracked(receipt);
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
	const batchRequests: unknown[] = [];
	const receipt = indexingReceipt(publishedItemKey, "item", 2);
	await mockPublishedBook(page, {
		itemCount: 2,
		onBatchRequest: (body) => batchRequests.push(body),
		batchResults: ({ keys }) =>
			keys.map((key) => ({
				indexingReceipts: [receipt],
				key,
				outcome: "changed",
			})),
	});
	const indexing = await mockCompletedIndexing(page);
	await page.goto("/admin");
	await page
		.getByRole("checkbox", { name: "Select all loaded records" })
		.check();
	await page
		.getByRole("toolbar", { name: "Bulk actions" })
		.getByRole("button", { name: "Remove selected" })
		.click();
	const dialog = page.getByRole("dialog", { name: /Remove 2 records/u });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Remove records", exact: true }).click();
	await expect.poll(() => batchRequests.length).toBe(1);
	expect(batchRequests).toEqual([
		{
			action: "remove",
			keys: [publishedItemKey, "ROW00001"],
		},
	]);
	await indexing.expectTracked(receipt);
});

test("keeps partial removal failures in the dialog and preserves failed selections for retry", async ({ page }) => {
	const batchRequests: unknown[] = [];
	let removalBlocked = true;
	const reason = "An attachment must be unpublished before this record can be removed.";
	await mockPublishedBook(page, {
		itemCount: 2,
		onBatchRequest: (body) => batchRequests.push(body),
		batchResults: ({ keys }) => keys.map((key) => ({
			key,
			indexingReceipts: [],
			...(removalBlocked && key === publishedItemKey
				? { outcome: "failed" as const, message: reason, code: "conflict" as const, retryable: true }
				: { outcome: "changed" as const }),
		})),
	});
	await mockCompletedIndexing(page);
	await page.goto("/admin");
	await page.getByRole("checkbox", { name: "Select all loaded records" }).check();
	await removeSelectedRecords(page);
	const dialog = page.getByRole("dialog", { name: /Remove .*records?\?/u });
	await expect(dialog.getByRole("alert")).toContainText(reason);
	await expect(dialog.getByRole("button", { name: /^Remove records?$/u })).toBeEnabled();
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(page.getByRole("checkbox", { name: "Select Published book", exact: true })).toBeChecked();
	await expect(page.getByRole("checkbox", { name: "Select Published book 2", exact: true })).not.toBeChecked();
	removalBlocked = false;
	await removeSelectedRecords(page);
	await expect(dialog).toBeHidden();
	expect(batchRequests[0]).toEqual({ action: "remove", keys: [publishedItemKey, "ROW00001"] });
	expect(batchRequests.at(-1)).toEqual({ action: "remove", keys: [publishedItemKey] });
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
	await page.goto("/admin", { waitUntil: "domcontentloaded" });
	const selectRecord = page.getByRole("checkbox", {
		name: "Select Published book",
	});


	await selectRecord.check();
	await removeSelectedRecords(page);
	await expect(page.getByText("1 record removed")).toBeVisible();

	await selectRecord.check();
	await removeSelectedRecords(page);
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

  await mockPublishedBook(page);
  const review = await mockSubmittedReview(page, async () => {
    batchRevision += 1;
    receiptState = batchRevision === 1 ? "processing" : "failed";
    hasFailed = receiptState === "failed";
    hasPending = receiptState === "processing";
    workerProgress = receiptState === "processing" ? 42 : null;
    workerStage = receiptState === "processing" ? "indexing" : "idle";
    return {json: {review: {}, indexingReceipts: [indexingReceipt(publishedItemKey, "item", batchRevision)]}};
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

  const approval = await openReviewApproval(page);
  await approval.getByRole("button", {name: "Publish version", exact: true}).click();
  await expect(approval).toBeHidden();

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

  review.resubmit();
  await page.reload();
  const secondApproval = await openReviewApproval(page);
  await secondApproval.getByRole("button", {name: "Publish version", exact: true}).click();
  await expect(secondApproval).toBeHidden();
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


test("shows search results from the narrow editor without interrupting typing", async ({ page }) => {
 await mockPublishedBook(page);
 await page.setViewportSize({ width: 390, height: 844 });
 await page.goto(`/admin?item=${publishedItemKey}`);
 await expect(page.locator("#admin-inspector-pane")).toBeVisible();
 const search = page.getByRole("textbox", { name: "Search records" });
 await search.pressSequentially("Published book", { delay: 30 });
 await expect(search).toBeFocused();
 await expect(search).toHaveValue("Published book");
 await expect(page.getByRole("region", { name: "Records", exact: true })).toBeVisible();
 await expect(page.locator(`[data-record-key="${publishedItemKey}"]`)).toBeVisible();
});

test("opens a source's status from the address and undoes a dismissed issue", async ({ page }) => {
	await mockCompletedIndexing(page);
	await mockPublishedBook(page, {
		additionalSources: [
			{
				...importedSource,
				externalScopeKey: "2129771",
				activity: {
					changed: 14,
					issues: { zotero_file_metadata_invalid: 2 },
					key: importedSource.key,
					lastSuccessAt: timestamp,
					pdfs: null,
					provider: "zotero",
					searchFailed: 0,
					searchable: 12_450,
					state: "succeeded",
				},
			},
		],
	});
	let open = ["FIRST111", "SECOND22"];
	const changes: unknown[] = [];
	await page.route(`**/api/admin/library/sources/${importedSource.key}/issues**`, async (route) => {
		const request = route.request();
		if (request.method() === "PATCH") {
			const body = request.postDataJSON() as { action: string; record?: string };
			changes.push(body);
			open = body.action === "dismiss" ? open.filter((key) => key !== body.record) : ["FIRST111", "SECOND22"];
			await route.fulfill({ json: body.action === "dismiss" ? { batch: timestamp, count: 1 } : { count: 1 } });
			return;
		}
		if (new URL(request.url()).pathname.endsWith("/issues")) {
			await route.fulfill({
				json: { types: [{ count: open.length, key: "pdf-not-uploaded", kind: "pdf", next: "Upload the files in Zotero.", title: "PDF not published" }] },
			});
			return;
		}
		await route.fulfill({
			json: {
				count: open.length,
				issues: open.map((key) => ({
					detail: null,
					itemKey: null,
					links: [{ href: `https://www.zotero.org/groups/2129771/items/${key}`, kind: "zotero-web" }],
					message: `Zotero attachment ${key}: a published PDF must have a valid filename and MD5`,
					meta: null,
					sourceRecordKey: key,
					title: `Report ${key}`,
				})),
			},
		});
	});

	await openAdmin(page, `/admin?source=${importedSource.key}`);
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByRole("heading", { name: importedSource.label })).toBeVisible();
	await expect(dialog.getByText("records searchable")).toBeVisible();
	await expect(dialog.getByRole("button", { name: /PDF not published/u })).toBeVisible();

	await dialog.getByText("Report FIRST111").hover();
	await dialog.getByRole("button", { name: "Dismiss issue: Report FIRST111" }).click();
	await expect(dialog.getByText("Report FIRST111")).toHaveCount(0);
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(dialog.getByText("Report FIRST111")).toBeVisible();
	expect(changes).toEqual([
		{ action: "dismiss", record: "FIRST111" },
		{ action: "restore", batch: timestamp },
	]);

	await dialog.getByRole("button", { name: "Close" }).click();
	await expect(page).not.toHaveURL(/[?&]source=/u);
});

test.describe("PDF import", () => {
	// The library's AI reads on the server's worker; here the import's API answers as it would once a PDF is read.
	test("reads a PDF into a draft with its suggested change and collection, and keeps DOIs reachable meanwhile", { tag: "@smoke" }, async ({ page }) => {
		await mockPublishedBook(page);
		const emptyProperties = { authors: [], date: "", doi: "", isbn: "", issn: "", issue: "", keywords: [], language: "", pages: "", publicationTitle: "", publisher: "", rights: "", seriesNumber: "", seriesTitle: "", subject: "", title: "", volume: "" };
		const title = "Girls' learning in Sierra Leone";
		const reading = {
			checks: [{ criterion: "The document credits FCDO as its funder.", page: 2, quote: "Funded by UK aid", recommendation: null, result: "met" }],
			cites: [],
			collections: [{ id: "THEMEGEN", name: "Gender Equality", path: ["Themes"], reason: "It is about girls' education." }],
			pdf: { properties: emptyProperties, standards: { pdfa: "", pdfua: "", tagged: true }, writable: true },
			record: {
				creators: ["Ada Lovelace"],
				id: "1",
				itemType: "Report",
				method: "pdf",
				payload: { collections: [], creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }], itemType: "Report", languageName: "English", title },
				source: "report.pdf",
				state: "ready",
				title,
				year: 2026,
			},
			suggestions: [{ apply: true, checks: [], field: "languageName", reason: "The library writes language codes.", value: "en" }],
			topics: [],
		};
		let pdfImport: Record<string, unknown> | null = null;
		let committed: { records: { payload: Record<string, unknown> }[] } | null = null;
		const file = (state: string, stored: boolean) => ({ filename: "report.pdf", id: "file-1", message: null, reading: state === "read" ? reading : null, rowId: "1", state, stored });
		await page.route("**/api/admin/items/import/pdf", async (route) => {
			if (route.request().method() === "GET") {
				const answer = { import: pdfImport, last: { checks: [], instructions: "" } };
				// The worker reads it a moment after it is stored, and its PDF attaches a moment after the draft is made:
				// the sheet has to come back and ask.
				if ((pdfImport?.files as { state: string }[] | undefined)?.[0]?.state === "waiting") pdfImport = { ...pdfImport, files: [file("read", true)] };
				else if (pdfImport?.results) pdfImport = { ...pdfImport, attach: { 1: "attached" } };
				return route.fulfill({ json: answer });
			}
			const body = route.request().postDataJSON();
			if (body.action === "start") {
				pdfImport = { attach: {}, checks: body.checks, collections: body.collections, createdAt: new Date().toISOString(), files: [file("uploading", false)], id: "import-1", instructions: body.instructions, needs: {}, results: null, reviews: {}, send: null, sending: {}, sent: {} };
				return route.fulfill({ json: { files: [{ filename: "report.pdf", id: "file-1", upload: { signedUrl: "http://127.0.0.1:9/storage/report.pdf" } }], id: "import-1" } });
			}
			if (body.action === "uploaded") {
				pdfImport = { ...pdfImport, files: [file("waiting", true)] };
				return route.fulfill({ json: { stored: "file-1" } });
			}
			if (body.action === "commit") {
				committed = body;
				const results = [{ id: "1", itemKey: "PDFIMP01", kind: "created", outcome: "created" }];
				// The report has no date: a DOI would need one, and the finish step publishes without a DOI unless it is switched on.
				pdfImport = { ...pdfImport, attach: {}, needs: { 1: { zenodo: { date: "Enter a valid publication date." } } }, results };
				return route.fulfill({ json: { attach: {}, results } });
			}
			pdfImport = null;
			return route.fulfill({ json: { closed: "import-1" } });
		});
		await page.route("http://127.0.0.1:9/storage/**", (route) => route.fulfill({ json: { Key: "report.pdf" } }));
		const pdf = await PDFDocument.create();
		pdf.addPage();
		const bytes = Buffer.from(await pdf.save());
		await page.route("**/api/admin/items/import/pdf/file-1", (route) => route.fulfill({ body: bytes, contentType: "application/pdf" }));

		await page.goto("/admin");
		await page.getByRole("button", { name: "Import Item", exact: true }).click();
		const sheet = page.getByRole("dialog");
		await sheet.locator('footer input[type="file"]').setInputFiles({ buffer: bytes, mimeType: "application/pdf", name: "report.pdf" });
		await sheet.getByRole("button", { name: /^Read\s1\sPDF$/u }).click();
		await expect(sheet.getByText(title)).toBeVisible();

		// While it waits for review, DOIs and bibliography files can still be imported.
		await sheet.getByRole("button", { name: "Back", exact: true }).click();
		await expect(sheet.getByText("1 PDF in the open import")).toBeVisible();
		await sheet.getByRole("tab", { name: "DOIs" }).click();
		await expect(sheet.getByRole("textbox", { name: "DOIs", exact: true })).toBeVisible();
		await sheet.getByRole("tab", { name: "PDFs" }).click();
		await sheet.getByRole("button", { name: /^Review\s1\sPDF$/u }).click();

		await sheet.locator("#import-review-panel li button").first().click();
		await expect(sheet.getByRole("button", { name: /Suggested changes/u })).toContainText("1 of 1 applied");
		await expect(sheet.getByRole("button", { name: /Collections/u }).last()).toContainText("1 of 1 chosen");
		// The preview writes the record into the PDF in the browser, as publishing will on the server; it opens only once that worked.
		const preview = page.waitForEvent("popup");
		await sheet.getByRole("button", { name: "Open with new properties" }).click();
		await (await preview).close();
		await sheet.getByRole("button", { name: /^Import\s1\srecord$/u }).click();
		await expect(sheet.getByText("Drafts created")).toBeVisible();
		// A draft goes on with its PDF, so its tick to publish shows only once the PDF is attached.
		const choose = sheet.getByRole("checkbox", { name: `Publish ${title}` });
		await expect(choose).toBeHidden();
		await expect(choose).toBeEnabled();
		expect(committed!.records[0]!.payload).toMatchObject({ collections: ["THEMEGEN"], languageName: "en", title });
	});
});
