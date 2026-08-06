import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { loadLibraryConfig } from "../src/config/library-config/source";

export const ZOTERO_PLAYGROUND = {
	groupId: "6632364",
	groupName: "OpenScholar Test",
	markerTag: "openscholar-test-fixture",
	ownerUserId: 7_635_957,
	ownerUsername: "opendeved",
} as const;

const API_BASE_URL = "https://api.zotero.org";
const PAGE_SIZE = 100;
const FIXED_PDF_DATE = new Date("2026-08-06T00:00:00.000Z");
const FIXED_PDF_MTIME = FIXED_PDF_DATE.getTime();

type Fetch = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;

type ZoteroRecord = {
	data: Record<string, unknown>;
	key: string;
	version: number;
};

type ZoteroWriteResponse = {
	failed?: Record<string, { code?: number; message?: string }>;
	success?: Record<string, string>;
	unchanged?: Record<string, string>;
};

type FixtureItem = {
	data: Record<string, unknown>;
	id: string;
};

type FixturePdf = {
	attachment: FixtureItem;
	bytes: Uint8Array;
	filename: string;
	parentFixtureId: string;
};

type SeederOptions = {
	apiKey: string;
	fetch?: Fetch;
	groupId: string;
	publishTag: string;
	sleep?: Sleep;
};

type SeedSummary = {
	collections: Record<string, string>;
	createdItems: string[];
	deduplicatedPdfs: string[];
	fixtureItems: Record<string, string>;
	publishTag: string;
	unchangedItems: string[];
	updatedItems: string[];
	uploadedPdfs: string[];
};

function assertObject(value: unknown, label: string) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} returned an invalid object`);
	}
	return value as Record<string, unknown>;
}

function stringArray(value: unknown) {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

function tagNames(value: unknown) {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) =>
			entry && typeof entry === "object" && "tag" in entry
				? String(entry.tag)
				: "",
		)
		.filter(Boolean)
		.sort();
}

function fixtureTag(id: string) {
	return `openscholar-fixture:${id}`;
}

export function fixtureIdFromItem(record: ZoteroRecord) {
	const prefix = "openscholar-fixture:";
	const identifiers = tagNames(record.data.tags).filter((tag) =>
		tag.startsWith(prefix),
	);
	if (identifiers.length > 1) {
		throw new Error(`Fixture item ${record.key} has multiple fixture IDs`);
	}
	return identifiers[0]?.slice(prefix.length) ?? null;
}

function fixtureTags(id: string, ...tags: string[]) {
	return [
		{ tag: ZOTERO_PLAYGROUND.markerTag },
		{ tag: fixtureTag(id) },
		...tags.filter(Boolean).map((tag) => ({ tag })),
	];
}

export function editableFieldsMatch(
	current: Record<string, unknown>,
	desired: Record<string, unknown>,
) {
	return Object.entries(desired).every(([key, value]) => {
		if (key === "tags") {
			return (
				JSON.stringify(tagNames(current.tags)) ===
				JSON.stringify(tagNames(value))
			);
		}
		if (key === "collections") {
			return (
				JSON.stringify(stringArray(current.collections).sort()) ===
				JSON.stringify(stringArray(value).sort())
			);
		}
		return JSON.stringify(current[key]) === JSON.stringify(value);
	});
}

export function indexFixtureItems(records: ZoteroRecord[]) {
	const byId = new Map<string, ZoteroRecord>();
	for (const item of records) {
		const id = fixtureIdFromItem(item);
		if (!id) continue;
		if (byId.has(id)) throw new Error(`Duplicate Zotero fixture ID: ${id}`);
		byId.set(id, item);
	}
	return byId;
}

export function fileUploadPrecondition(md5: unknown): Record<string, string> {
	return typeof md5 === "string" && md5.length > 0
		? { "If-Match": md5 }
		: { "If-None-Match": "*" };
}

export async function collectZoteroPages(
	fetchPage: (start: number, limit: number) => Promise<ZoteroRecord[]>,
) {
	const records: ZoteroRecord[] = [];
	for (let start = 0; ; start += PAGE_SIZE) {
		const page = await fetchPage(start, PAGE_SIZE);
		records.push(...page);
		if (page.length < PAGE_SIZE) return records;
	}
}

function concatBytes(...parts: Array<string | Uint8Array>) {
	const buffers = parts.map((part) =>
		typeof part === "string" ? new TextEncoder().encode(part) : part,
	);
	const output = new Uint8Array(
		buffers.reduce((total, buffer) => total + buffer.byteLength, 0),
	);
	let offset = 0;
	for (const buffer of buffers) {
		output.set(buffer, offset);
		offset += buffer.byteLength;
	}
	return output;
}

export async function createFixturePdf(options: {
	documentTitle: string;
	pageTokens: string[];
}) {
	const document = await PDFDocument.create();
	document.setTitle(options.documentTitle);
	document.setAuthor("OpenDevEd OpenScholar test fixture");
	document.setCreator("OpenScholar Zotero playground seeder");
	document.setProducer("OpenScholar Zotero playground seeder");
	document.setCreationDate(FIXED_PDF_DATE);
	document.setModificationDate(FIXED_PDF_DATE);
	const font = await document.embedFont(StandardFonts.Helvetica);
	const boldFont = await document.embedFont(StandardFonts.HelveticaBold);

	for (const [index, token] of options.pageTokens.entries()) {
		const page = document.addPage([612, 792]);
		page.drawText(options.documentTitle, {
			color: rgb(0.12, 0.12, 0.14),
			font: boldFont,
			size: 18,
			x: 54,
			y: 720,
		});
		page.drawText(`Page ${index + 1} deterministic token: ${token}`, {
			color: rgb(0.12, 0.12, 0.14),
			font,
			size: 12,
			x: 54,
			y: 680,
		});
		page.drawText(
			"This PDF exists only to verify attachment download, text extraction, storage, and search indexing.",
			{
				color: rgb(0.25, 0.25, 0.28),
				font,
				size: 10,
				x: 54,
				y: 650,
			},
		);
	}

	return document.save({ addDefaultPage: false, useObjectStreams: false });
}

function buildParentFixtures(collections: Record<string, string>) {
	const publishedId = "published-report";
	const unpublishedId = "unpublished-article";
	const metadataOnlyId = "metadata-only-webpage";
	return [
		{
			id: publishedId,
			data: {
				itemType: "report",
				title: "OpenScholar Sync Fixture — Published Report",
				creators: [
					{
						creatorType: "author",
						firstName: "Ada",
						lastName: "Lovelace",
					},
				],
				abstractNote:
					"Deterministic imported report for OpenScholar source-sync verification. Token: OPENSCHOLAR-METADATA-PUBLISHED-001.",
				date: "2026-08-06",
				institution: "OpenDevEd",
				language: "en",
				rights: "CC BY 4.0",
				extra: `OpenScholar fixture ID: ${publishedId}`,
				tags: fixtureTags(publishedId, "evidence", "sync-test"),
				collections: [collections.reports],
				relations: {},
			},
		},
		{
			id: unpublishedId,
			data: {
				itemType: "journalArticle",
				title: "OpenScholar Sync Fixture — Unpublished PDF Control",
				creators: [
					{
						creatorType: "author",
						firstName: "Grace",
						lastName: "Hopper",
					},
				],
				abstractNote:
					"The child PDF intentionally lacks the configured publication tag.",
				date: "2025",
				publicationTitle: "OpenScholar Test Journal",
				volume: "1",
				issue: "1",
				pages: "1-2",
				language: "en",
				extra: `OpenScholar fixture ID: ${unpublishedId}`,
				tags: fixtureTags(unpublishedId, "negative-control"),
				collections: [collections.controls],
				relations: {},
			},
		},
		{
			id: metadataOnlyId,
			data: {
				itemType: "webpage",
				title: "OpenScholar Sync Fixture — Metadata Only",
				creators: [
					{
						creatorType: "author",
						name: "OpenDevEd",
					},
				],
				abstractNote: "A fixture without any child attachment.",
				date: "2024-01-02",
				websiteTitle: "OpenScholar Test",
				url: "https://example.org/openscholar-fixture",
				accessDate: "2026-08-06T00:00:00Z",
				language: "en",
				extra: `OpenScholar fixture ID: ${metadataOnlyId}`,
				tags: fixtureTags(metadataOnlyId, "metadata-only"),
				collections: [collections.root],
				relations: {},
			},
		},
	] satisfies FixtureItem[];
}

async function buildPdfFixtures(
	parentKeys: Record<string, string>,
	publishTag: string,
) {
	const publishedId = "published-report-pdf";
	const controlId = "unpublished-control-pdf";
	return [
		{
			attachment: {
				id: publishedId,
				data: {
					itemType: "attachment",
					parentItem: parentKeys["published-report"],
					linkMode: "imported_file",
					title: "Published report fixture PDF",
					note: "This attachment must be published by Evidence Library sync.",
					tags: fixtureTags(publishedId, publishTag),
					relations: {},
					contentType: "application/pdf",
					charset: "",
					filename: "openscholar-published-report.pdf",
				},
			},
			bytes: await createFixturePdf({
				documentTitle: "OpenScholar Published Report Fixture",
				pageTokens: [
					"OPENSCHOLAR-PDF-PUBLISHED-PAGE-ONE-001",
					"OPENSCHOLAR-PDF-PUBLISHED-PAGE-TWO-002",
				],
			}),
			filename: "openscholar-published-report.pdf",
			parentFixtureId: "published-report",
		},
		{
			attachment: {
				id: controlId,
				data: {
					itemType: "attachment",
					parentItem: parentKeys["unpublished-article"],
					linkMode: "imported_file",
					title: "Unpublished control fixture PDF",
					note: "This attachment must remain private because it has no publication tag.",
					tags: fixtureTags(controlId, "negative-control"),
					relations: {},
					contentType: "application/pdf",
					charset: "",
					filename: "openscholar-unpublished-control.pdf",
				},
			},
			bytes: await createFixturePdf({
				documentTitle: "OpenScholar Unpublished Control Fixture",
				pageTokens: ["OPENSCHOLAR-PDF-PRIVATE-CONTROL-001"],
			}),
			filename: "openscholar-unpublished-control.pdf",
			parentFixtureId: "unpublished-article",
		},
	] satisfies FixturePdf[];
}

export class ZoteroPlaygroundSeeder {
	private readonly fetchImplementation: Fetch;
	private pendingBackoffMs = 0;
	private readonly prefix: string;
	private readonly sleep: Sleep;

	constructor(private readonly options: SeederOptions) {
		if (options.groupId !== ZOTERO_PLAYGROUND.groupId) {
			throw new Error(
				`Refusing to seed Zotero group ${options.groupId}; expected dedicated playground ${ZOTERO_PLAYGROUND.groupId}`,
			);
		}
		if (!options.apiKey.trim())
			throw new Error("Zotero API key is required");
		if (!options.publishTag.trim()) {
			throw new Error(
				"The active library configuration has no publication tag",
			);
		}
		this.fetchImplementation = options.fetch ?? fetch;
		this.prefix = `groups/${options.groupId}`;
		this.sleep =
			options.sleep ??
			((milliseconds) =>
				new Promise((resolve) => setTimeout(resolve, milliseconds)));
	}

	private async request(
		pathName: string,
		init: RequestInit = {},
		options: { apiHeaders?: boolean } = {},
	) {
		const apiHeaders = options.apiHeaders ?? true;
		const url = pathName.startsWith("http")
			? pathName
			: `${API_BASE_URL}/${pathName.replace(/^\/+/, "")}`;
		let attempt = 0;
		while (true) {
			if (this.pendingBackoffMs > 0) {
				const delay = this.pendingBackoffMs;
				this.pendingBackoffMs = 0;
				await this.sleep(delay);
			}
			const response = await this.fetchImplementation(url, {
				...init,
				headers: {
					...(apiHeaders
						? {
								"Zotero-API-Key": this.options.apiKey,
								"Zotero-API-Version": "3",
							}
						: {}),
					...init.headers,
				},
			});
			const backoffSeconds = Number(response.headers.get("backoff"));
			if (Number.isFinite(backoffSeconds) && backoffSeconds > 0) {
				this.pendingBackoffMs = Math.min(
					backoffSeconds * 1_000,
					30_000,
				);
			}
			if (
				(response.status === 429 || response.status >= 500) &&
				attempt < 4
			) {
				const retryAfter = response.headers.get("retry-after");
				const retryAfterSeconds = retryAfter
					? Number(retryAfter)
					: Number.NaN;
				const retryDelay =
					Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
						? Math.min(retryAfterSeconds * 1_000, 30_000)
						: Math.min(300 * 2 ** attempt, 5_000);
				const delay = Math.max(retryDelay, this.pendingBackoffMs);
				this.pendingBackoffMs = 0;
				await this.sleep(delay);
				attempt += 1;
				continue;
			}
			if (!response.ok) {
				const detail = (await response.text()).slice(0, 500);
				throw new Error(
					`Zotero request ${init.method ?? "GET"} ${url} failed (${response.status}): ${detail || response.statusText}`,
				);
			}
			return response;
		}
	}

	async verifyTarget() {
		const keyResponse = await this.request("keys/current");
		const key = assertObject(await keyResponse.json(), "Zotero key check");
		const access = assertObject(key.access, "Zotero key access");
		const groups = assertObject(access.groups, "Zotero group access");
		const groupAccess =
			(groups[this.options.groupId] as
				Record<string, unknown> | undefined) ??
			(groups.all as Record<string, unknown> | undefined);
		if (
			Number(key.userID) !== ZOTERO_PLAYGROUND.ownerUserId ||
			key.username !== ZOTERO_PLAYGROUND.ownerUsername ||
			groupAccess?.library !== true ||
			groupAccess?.write !== true
		) {
			throw new Error(
				`Zotero key must belong to ${ZOTERO_PLAYGROUND.ownerUsername} and grant library/write access to group ${this.options.groupId}`,
			);
		}

		const groupResponse = await this.request(
			`groups/${this.options.groupId}`,
		);
		const group = assertObject(
			await groupResponse.json(),
			"Zotero group check",
		);
		const data = assertObject(group.data, "Zotero group data");
		if (
			data.name !== ZOTERO_PLAYGROUND.groupName ||
			Number(data.owner) !== ZOTERO_PLAYGROUND.ownerUserId
		) {
			throw new Error(
				`Refusing unexpected Zotero group ${String(data.name)} owned by ${String(data.owner)}`,
			);
		}
	}

	private async list(pathName: string) {
		return collectZoteroPages(async (start, limit) => {
			const separator = pathName.includes("?") ? "&" : "?";
			const response = await this.request(
				`${pathName}${separator}limit=${limit}&start=${start}`,
			);
			const page = (await response.json()) as ZoteroRecord[];
			if (!Array.isArray(page))
				throw new Error(`${pathName} returned invalid data`);
			return page;
		});
	}

	private async create(pathName: "collections" | "items", data: unknown) {
		const response = await this.request(`${this.prefix}/${pathName}`, {
			body: JSON.stringify([data]),
			headers: {
				"Content-Type": "application/json",
				"Zotero-Write-Token": randomBytes(16).toString("hex"),
			},
			method: "POST",
		});
		const result = (await response.json()) as ZoteroWriteResponse;
		const key = result.success?.["0"] ?? result.unchanged?.["0"];
		if (!key) {
			throw new Error(
				`Zotero failed to create ${pathName.slice(0, -1)}: ${JSON.stringify(result.failed ?? result)}`,
			);
		}
		return key;
	}

	private async patchItem(
		record: ZoteroRecord,
		data: Record<string, unknown>,
	) {
		await this.request(`${this.prefix}/items/${record.key}`, {
			body: JSON.stringify(data),
			headers: {
				"Content-Type": "application/json",
				"If-Unmodified-Since-Version": String(record.version),
			},
			method: "PATCH",
		});
	}

	private async ensureCollections() {
		const existing = await this.list(`${this.prefix}/collections`);
		const exact = (name: string, parentCollection: string | false) => {
			const matches = existing.filter(
				(record) =>
					record.data.name === name &&
					record.data.parentCollection === parentCollection,
			);
			if (matches.length > 1) {
				throw new Error(
					`Multiple Zotero fixture collections match ${name}`,
				);
			}
			return matches[0]?.key;
		};
		const rootName = "[OpenScholar fixture] Evidence";
		const root =
			exact(rootName, false) ??
			(await this.create("collections", {
				name: rootName,
				parentCollection: false,
			}));
		const reportsName = "[OpenScholar fixture] Reports";
		const reports =
			exact(reportsName, root) ??
			(await this.create("collections", {
				name: reportsName,
				parentCollection: root,
			}));
		const controlsName = "[OpenScholar fixture] Controls";
		const controls =
			exact(controlsName, root) ??
			(await this.create("collections", {
				name: controlsName,
				parentCollection: root,
			}));
		return { controls, reports, root };
	}

	private async existingFixtureItems() {
		const query = new URLSearchParams({ tag: ZOTERO_PLAYGROUND.markerTag });
		const items = await this.list(`${this.prefix}/items?${query}`);
		return indexFixtureItems(items);
	}

	private async upsertFixtureItem(
		fixture: FixtureItem,
		existing: Map<string, ZoteroRecord>,
		summary: SeedSummary,
	) {
		const current = existing.get(fixture.id);
		if (!current) {
			const key = await this.create("items", fixture.data);
			summary.createdItems.push(fixture.id);
			summary.fixtureItems[fixture.id] = key;
			return { key, record: null };
		}
		summary.fixtureItems[fixture.id] = current.key;
		if (editableFieldsMatch(current.data, fixture.data)) {
			summary.unchangedItems.push(fixture.id);
			return { key: current.key, record: current };
		}
		await this.patchItem(current, fixture.data);
		summary.updatedItems.push(fixture.id);
		return { key: current.key, record: current };
	}

	private async uploadPdf(
		attachmentKey: string,
		current: ZoteroRecord | null,
		fixture: FixturePdf,
	) {
		const md5 = createHash("md5").update(fixture.bytes).digest("hex");
		if (current?.data.md5 === md5) return "unchanged" as const;
		const form = new URLSearchParams({
			filename: fixture.filename,
			filesize: String(fixture.bytes.byteLength),
			md5,
			mtime: String(FIXED_PDF_MTIME),
		});
		const precondition = fileUploadPrecondition(current?.data.md5);
		const authorizationResponse = await this.request(
			`${this.prefix}/items/${attachmentKey}/file`,
			{
				body: form,
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					...precondition,
				},
				method: "POST",
			},
		);
		const authorization = assertObject(
			await authorizationResponse.json(),
			"Zotero upload authorization",
		);
		if (authorization.exists === 1) return "deduplicated" as const;
		if (
			typeof authorization.url !== "string" ||
			typeof authorization.contentType !== "string" ||
			typeof authorization.prefix !== "string" ||
			typeof authorization.suffix !== "string" ||
			typeof authorization.uploadKey !== "string"
		) {
			throw new Error(
				"Zotero returned an incomplete upload authorization",
			);
		}
		await this.request(
			authorization.url,
			{
				body: concatBytes(
					authorization.prefix,
					fixture.bytes,
					authorization.suffix,
				),
				headers: { "Content-Type": authorization.contentType },
				method: "POST",
			},
			{ apiHeaders: false },
		);
		await this.request(`${this.prefix}/items/${attachmentKey}/file`, {
			body: new URLSearchParams({ upload: authorization.uploadKey }),
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				...precondition,
			},
			method: "POST",
		});
		return "uploaded" as const;
	}

	async seed(): Promise<SeedSummary> {
		await this.verifyTarget();
		const collections = await this.ensureCollections();
		const existing = await this.existingFixtureItems();
		const summary: SeedSummary = {
			collections,
			createdItems: [],
			deduplicatedPdfs: [],
			fixtureItems: {},
			publishTag: this.options.publishTag,
			unchangedItems: [],
			updatedItems: [],
			uploadedPdfs: [],
		};

		for (const parent of buildParentFixtures(collections)) {
			await this.upsertFixtureItem(parent, existing, summary);
		}
		for (const fixture of await buildPdfFixtures(
			summary.fixtureItems,
			this.options.publishTag,
		)) {
			const result = await this.upsertFixtureItem(
				fixture.attachment,
				existing,
				summary,
			);
			const uploadResult = await this.uploadPdf(
				result.key,
				result.record,
				fixture,
			);
			if (uploadResult === "uploaded") {
				summary.uploadedPdfs.push(fixture.attachment.id);
			} else if (uploadResult === "deduplicated") {
				summary.deduplicatedPdfs.push(fixture.attachment.id);
			}
		}
		return summary;
	}
}

const usage =
	"Usage: npm run test:zotero-playground:seed -- --group 6632364 [--api-key-env NAME]";

function parseCommand(args: string[]) {
	let apiKeyEnvironment = "ZOTERO_OPENSCHOLAR_TEST_API_KEY";
	let groupId: string | null = null;
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === "--group") {
			groupId = args[index + 1] ?? null;
			index += 1;
			continue;
		}
		if (args[index] === "--api-key-env") {
			apiKeyEnvironment = args[index + 1] ?? "";
			index += 1;
			continue;
		}
		throw new Error(usage);
	}
	if (!groupId || !apiKeyEnvironment) throw new Error(usage);
	return { apiKeyEnvironment, groupId };
}

async function main() {
	const command = parseCommand(process.argv.slice(2));
	const apiKey = process.env[command.apiKeyEnvironment];
	if (!apiKey) {
		throw new Error(
			`Environment variable ${command.apiKeyEnvironment} is required`,
		);
	}
	const config = await loadLibraryConfig();
	const publishTag = config.content.tags.publish[0];
	const seeder = new ZoteroPlaygroundSeeder({
		apiKey,
		groupId: command.groupId,
		publishTag,
	});
	console.log(JSON.stringify(await seeder.seed(), null, 2));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
