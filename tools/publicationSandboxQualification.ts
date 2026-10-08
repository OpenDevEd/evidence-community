import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { PDFDocument, StandardFonts } from "pdf-lib";
import { chromium } from "@playwright/test";

import type { AdminPublicationWorkerOverview, AdminPublicationRuntimeOverview } from "../src/lib/admin/publication-worker-contract";
import type {
	AdminSearchIndexReceipt,
	AdminSearchIndexReceiptStatus,
} from "../src/lib/admin/search-index-contract";
import type { AdminPublicationView } from "../src/lib/publication/admin-publication-view";
import type { AdminItemDetail } from "../src/lib/admin/types";
import { createAdminTestSession } from "./adminSession";

import type { SavedReview } from "../src/lib/admin/review-contract";

type QualificationMode = "crossref" | "zenodo" | "lifecycle";

type PublicationSandboxEvidence = {
	schemaVersion: 2;
	runId: string;
	baseUrl: string;
	libraryId: string;
	createdAt: string;
	updatedAt: string;
	parent?: {
		key: string;
		title: string;
		revision: number;
	};
	crossref?: {
		doi: string;
		jobId: number;
		verifiedAt: string;
		pendingSubmission: AdminPublicationView["providers"]["crossref"]["exact"]["pendingSubmission"];
		editedTitle: string;
		editedRevision: number;
		redepositSubmission: AdminPublicationView["providers"]["crossref"]["exact"]["pendingSubmission"];
	};
	crossrefProgress?: {
		doi: string;
		jobId: number;
		verifiedAt?: string;
		pendingSubmission?: AdminPublicationView["providers"]["crossref"]["exact"]["pendingSubmission"];
		editedTitle?: string;
		editedRevision?: number;
		redepositSubmission?: AdminPublicationView["providers"]["crossref"]["exact"]["pendingSubmission"];
	};
	attachment?: {
		key: string;
		filename: string;
		size: number;
		sha256: string;
		md5: string;
		approved?: boolean;
	};
	zenodo?: {
		recordId: string;
		recordUrl: string;
		verifiedAt: string;
	};
	completedAt?: string;
};

type AdminDraft = {
	itemKey: string;
	draftRevision: number;
	generation: string;
	payload: Record<string, unknown>;
};

type IndexingMutation = {
	indexingReceipts: AdminSearchIndexReceipt[];
	item?: { revision?: number };
};

const defaultTimeoutMs = 20 * 60 * 1000;

function requiredEnvironment(name: string) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is required`);
	return value;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

export function applySandboxDraftChanges(
	payload: Record<string, unknown>,
	changes: Record<string, unknown>,
) {
	return { ...payload, ...changes };
}

function pause(milliseconds: number) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function settings() {
	const confirmation = requiredEnvironment("PUBLICATION_SANDBOX_CONFIRM");
	const baseUrl = new URL(
		requiredEnvironment("PUBLICATION_SANDBOX_BASE_URL"),
	);
	assert(baseUrl.protocol === "https:", "Sandbox checks require HTTPS");
	assert(
		baseUrl.pathname === "/" && !baseUrl.search && !baseUrl.hash && !baseUrl.username && !baseUrl.password && confirmation === baseUrl.origin,
		"PUBLICATION_SANDBOX_CONFIRM must match the exact HTTPS origin, without a path, query, or credentials",
	);
	const runId = requiredEnvironment("PUBLICATION_SANDBOX_RUN_ID");
	assert(
		/^[a-z0-9][a-z0-9-]{5,63}$/u.test(runId),
		"PUBLICATION_SANDBOX_RUN_ID must use 6 to 64 lowercase letters, numbers, or hyphens",
	);
	const prefix = requiredEnvironment("PUBLICATION_EXPECTED_CROSSREF_PREFIX");
	const namespace = requiredEnvironment(
		"PUBLICATION_EXPECTED_CROSSREF_NAMESPACE",
	);
	const evidencePath = resolve(
		process.env.PUBLICATION_SANDBOX_EVIDENCE_PATH?.trim() ||
			`/tmp/new-el-publication-${runId}.json`,
	);
	const timeoutMs = Number(
		process.env.PUBLICATION_SANDBOX_TIMEOUT_MS ?? defaultTimeoutMs,
	);
	assert(
		Number.isSafeInteger(timeoutMs) && timeoutMs >= 60_000,
		"PUBLICATION_SANDBOX_TIMEOUT_MS must be at least 60000",
	);
	return {
		baseUrl: baseUrl.origin,
		libraryId: requiredEnvironment("PUBLICATION_SANDBOX_LIBRARY_ID"),
		runId,
		prefix,
		namespace,
		evidencePath,
		timeoutMs,
	};
}

function loadEvidence(input: ReturnType<typeof settings>) {
	if (!existsSync(input.evidencePath)) {
		const now = new Date().toISOString();
		return {
			schemaVersion: 2,
			runId: input.runId,
			baseUrl: input.baseUrl,
			libraryId: input.libraryId,
			createdAt: now,
			updatedAt: now,
		} satisfies PublicationSandboxEvidence;
	}
	const evidence = JSON.parse(
		readFileSync(input.evidencePath, "utf8"),
	) as PublicationSandboxEvidence;
	assert(evidence.schemaVersion === 2, "Unsupported evidence file version");
	assert(
		evidence.runId === input.runId && evidence.baseUrl === input.baseUrl && evidence.libraryId === input.libraryId,
		"The saved evidence belongs to another run or website",
	);
	return evidence;
}

function saveEvidence(path: string, evidence: PublicationSandboxEvidence) {
	evidence.updatedAt = new Date().toISOString();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

class AdminClient {
	readonly #baseUrl: string;
	#cookieHeader = "";

	constructor(baseUrl: string) {
		this.#baseUrl = baseUrl;
	}

	async login() {
		this.#cookieHeader = (
			await createAdminTestSession(this.#baseUrl)
		).cookieHeader;
	}

	async request<T>(pathname: string, init: RequestInit = {}) {
		const headers = new Headers(init.headers);
		if (this.#cookieHeader) headers.set("Cookie", this.#cookieHeader);
		if (typeof init.body === "string") {
			headers.set("Content-Type", "application/json");
		}
		const response = await fetch(new URL(pathname, this.#baseUrl), {
			...init,
			headers,
			cache: "no-store",
			redirect: "error",
			signal: AbortSignal.timeout(60_000),
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(
				`${init.method ?? "GET"} ${pathname} returned ${response.status}: ${text}`,
			);
		}
		return (text ? JSON.parse(text) : undefined) as T;
	}
}

async function waitFor<T>(input: {
	description: string;
	timeoutMs: number;
	read: () => Promise<T>;
	accept: (value: T) => boolean;
	onRead?: (value: T) => void;
}) {
	const deadline = Date.now() + input.timeoutMs;
	while (Date.now() < deadline) {
		const value = await input.read();
		input.onRead?.(value);
		if (input.accept(value)) return value;
		await pause(2_000);
	}
	throw new Error(`Timed out waiting for ${input.description}`);
}

async function waitForReceipts(
	client: AdminClient,
	receipts: readonly AdminSearchIndexReceipt[],
	timeoutMs: number,
) {
	if (receipts.length === 0) return;
	await waitFor({
		description: "Meilisearch receipts",
		timeoutMs,
		read: async () =>
			(
				await client.request<{
					receipts: AdminSearchIndexReceiptStatus[];
				}>("/api/admin/search-index/receipts", {
					method: "POST",
					body: JSON.stringify({ receipts }),
				})
			).receipts,
		onRead(statuses) {
			const failed = statuses.find((status) => status.state === "failed");
			if (failed) {
				throw new Error(
					`Search indexing failed for ${failed.entityKey}: ${failed.error ?? "unknown error"}`,
				);
			}
		},
		accept: (statuses) =>
			statuses.length === receipts.length &&
			statuses.every((status) => status.state === "indexed"),
	});
}

async function publication(client: AdminClient, key: string) {
	return (
		await client.request<{ publication: AdminPublicationView }>(
			`/api/admin/items/${encodeURIComponent(key)}/publication`,
		)
	).publication;
}

function assertHealthyOverview(overview: AdminPublicationWorkerOverview) {
	assert(
		overview.providers.crossref && overview.providers.zenodo,
		"Crossref Test and Zenodo Sandbox must both be enabled",
	);
	assert(
		overview.worker?.active && overview.worker.ready,
		"The publication worker is not ready",
	);
	assert(!overview.queue.hasFailed, "The publication queue has failed work");
}

async function verifyRuntime(client: AdminClient, input: ReturnType<typeof settings>) {
	const health = await client.request<{ state?: string }>(
		"/api/library-config/health",
	);
	assert(
		health.state === "active",
		"The library configuration is not active",
	);
	const overview = await client.request<AdminPublicationRuntimeOverview>(
		"/api/admin/publication",
	);
	assertSandboxConfiguration(overview.configuration, input);
	assertHealthyOverview(overview);
	return overview;
}

export function assertSandboxConfiguration(
	configuration: AdminPublicationRuntimeOverview["configuration"],
	expected: {baseUrl: string; libraryId: string; prefix: string; namespace: string},
) {
	assert(
		configuration?.libraryId === expected.libraryId &&
			configuration.baseUrl.replace(/\/$/u, "") === expected.baseUrl,
		"The runtime does not match the confirmed sandbox library and URL",
	);
	assert(
		configuration.crossrefEnvironment === "test" && configuration.zenodoEnvironment === "sandbox",
		"Qualification requires Crossref Test and Zenodo Sandbox",
	);
	assert(
		configuration.prefix === expected.prefix && configuration.namespace === expected.namespace,
		"The runtime DOI prefix or namespace does not match the confirmed sandbox",
	);
}

async function publishReviewed(client: AdminClient, key: string, timeoutMs: number) {
	const {reviews} = await client.request<{reviews: SavedReview[]}>(`/api/admin/items/${key}/review`);
	const pending = reviews.find(review => review.state === "pending");
	const review = pending ?? (await client.request<{review: SavedReview}>(
		`/api/admin/items/${key}/review`, {method: "POST"},
	)).review;
	const approved = await client.request<IndexingMutation & {review: SavedReview}>(
		`/api/admin/reviews/${review.id}`,
		{method: "POST", body: JSON.stringify({action: "approve", expectedRevision: review.revision})},
	);
	assert(approved.review.state === "published", "The Editor did not publish the submitted snapshot");
	await waitForReceipts(client, approved.indexingReceipts, timeoutMs);
	return (await publication(client, key)).canonicalRevision;
}

async function createParent(
	client: AdminClient,
	input: ReturnType<typeof settings>,
	evidence: PublicationSandboxEvidence,
) {
	if (evidence.parent) return evidence.parent;
	const title = `Sandbox publication ${input.runId}`;
	const response = await client.request<{ draft: AdminDraft }>(
		"/api/admin/items/drafts",
		{
			method: "POST",
			body: JSON.stringify({
				itemType: "Report",
				title,
				date: new Date().toISOString().slice(0, 10),
				abstractNote:
					"A disposable publication used to verify the sandbox review workflow.",
				publisher: "OpenDevEd",
				creators: [
					{
						creatorType: "author",
						firstName: "OpenDevEd",
						lastName: "Verification",
					},
				],
			}),
		},
	);
	evidence.parent = { key: response.draft.itemKey, title, revision: 0 };
	saveEvidence(input.evidencePath, evidence);
	return evidence.parent;
}

async function runCrossref(
	client: AdminClient,
	input: ReturnType<typeof settings>,
	evidence: PublicationSandboxEvidence,
) {
	if (evidence.crossref) return evidence.crossref;
	const parent = await createParent(client, input, evidence);
	let progress = evidence.crossrefProgress;
	if (!progress) {
		await client.request(`/api/admin/items/${parent.key}/publishing-choice`, {method: "PUT", body: JSON.stringify({route: "crossref-zenodo", identifierPolicy: "reuse-crossref"})});
		const reservePath = `/api/admin/items/${parent.key}/publication/crossref/reserve`;
		const first = await client.request<{reservation: {doi: string}}>(reservePath, {method: "POST"});
		const second = await client.request<{reservation: {doi: string}}>(reservePath, {method: "POST"});
		assert(first.reservation.doi === second.reservation.doi, "Crossref reservation is not idempotent");
		assert(first.reservation.doi.startsWith(`${input.prefix}/${input.namespace}`), "Crossref reserved a DOI outside the confirmed sandbox namespace");
		parent.revision = await publishReviewed(client, parent.key, input.timeoutMs);
		const activated = await publication(client, parent.key);
		assert(activated.providers.crossref.exact.targetActive && activated.providers.zenodo.exact.targetActive, "Approval did not activate both providers");
		const jobId = activated.providers.crossref.exact.job?.id;
		assert(typeof jobId === "number", "Approval did not queue Crossref publication");
		progress = {doi: first.reservation.doi, jobId};
		evidence.crossrefProgress = progress;
		saveEvidence(input.evidencePath, evidence);
	}

	let pendingSubmission = progress.pendingSubmission ?? null;
	if (!progress.verifiedAt) {
		const settled = await waitFor({
			description: "Crossref Test verification",
			timeoutMs: input.timeoutMs,
			read: () => publication(client, parent.key),
			onRead(view) {
				const observed =
					view.providers.crossref.exact.pendingSubmission;
				if (!pendingSubmission && observed) {
					pendingSubmission = observed;
					progress.pendingSubmission = observed;
					saveEvidence(input.evidencePath, evidence);
				}
				const failure = view.providers.crossref.exact.failure;
				if (failure)
					throw new Error(`Crossref failed: ${failure.summary}`);
			},
			accept: (view) =>
				Boolean(pendingSubmission) &&
				view.providers.crossref.displayState === "synced" &&
				view.providers.crossref.exact.identifiers.some(
					(identifier) =>
						identifier.doi === progress.doi &&
						identifier.lifecycle === "verified" &&
						identifier.ownership === "managed",
				),
		});
		assert(
			settled.providers.crossref.exact.job?.deadLetteredAt === null,
			"Crossref job was dead-lettered",
		);
		progress.verifiedAt = new Date().toISOString();
		saveEvidence(input.evidencePath, evidence);
	}
	assert(pendingSubmission, "Crossref submission evidence is missing");
	const originalBatchId = pendingSubmission.batchId;

	const editedTitle =
		progress.editedTitle ?? `${parent.title}, metadata update`;
	let editedRevision = progress.editedRevision;
	if (!editedRevision) {
		const draft = (
			await client.request<{ draft: AdminDraft }>(
				`/api/admin/items/${parent.key}/draft`,
				{ method: "POST" },
			)
		).draft;
		await client.request<{ draft: AdminDraft }>(
			`/api/admin/items/${parent.key}/draft`,
			{
				method: "PUT",
				body: JSON.stringify({
					expectedDraftRevision: draft.draftRevision,
					expectedDraftGeneration: draft.generation,
					expectedPayload: draft.payload,
					payload: applySandboxDraftChanges(draft.payload, {
						title: editedTitle,
					}),
				}),
			},
		);
		editedRevision = await publishReviewed(client, parent.key, input.timeoutMs);
		progress.editedTitle = editedTitle;
		progress.editedRevision = editedRevision;
		evidence.parent = {
			...parent,
			title: editedTitle,
			revision: editedRevision,
		};
		saveEvidence(input.evidencePath, evidence);
	}

	let redepositSubmission = progress.redepositSubmission ?? null;
	await waitFor({
		description: "Crossref metadata redeposit",
		timeoutMs: input.timeoutMs,
		read: () => publication(client, parent.key),
		onRead(view) {
			const observed = view.providers.crossref.exact.pendingSubmission;
			if (!redepositSubmission && observed && observed.batchId !== originalBatchId) {
				redepositSubmission = observed;
				progress.redepositSubmission = observed;
				saveEvidence(input.evidencePath, evidence);
			}
			const failure = view.providers.crossref.exact.failure;
			if (failure)
				throw new Error(
					`Crossref redeposit failed: ${failure.summary}`,
				);
		},
		accept: (view) =>
			Boolean(redepositSubmission) &&
			view.canonicalRevision >= editedRevision &&
			view.providers.crossref.displayState === "synced" &&
			view.providers.crossref.exact.identifiers.some(
				(identifier) => identifier.doi === progress.doi,
			),
	});
	assert(redepositSubmission, "Crossref redeposit evidence is missing");
	evidence.parent = {
		...parent,
		title: editedTitle,
		revision: editedRevision,
	};
	evidence.crossref = {
		doi: progress.doi,
		jobId: progress.jobId,
		verifiedAt: progress.verifiedAt ?? new Date().toISOString(),
		pendingSubmission,
		editedTitle,
		editedRevision,
		redepositSubmission,
	};
	delete evidence.crossrefProgress;
	saveEvidence(input.evidencePath, evidence);
	return evidence.crossref;
}

async function createPdf(runId: string, createdAt: string) {
	const document = await PDFDocument.create({ updateMetadata: false });
	document.setCreationDate(new Date(createdAt));
	document.setModificationDate(new Date(createdAt));
	const font = await document.embedFont(StandardFonts.Helvetica);
	const page = document.addPage([612, 792]);
	page.drawText(`Sandbox publication ${runId}`, {
		x: 72,
		y: 700,
		size: 20,
		font,
	});
	return new Uint8Array(await document.save());
}

async function uploadSignedPdf(signedUrl: string, pdf: Uint8Array) {
	const body = new FormData();
	body.append("cacheControl", "3600");
	body.append("", new Blob([pdf], { type: "application/pdf" }));
	const response = await fetch(signedUrl, {
		method: "PUT",
		body,
		headers: { "x-upsert": "true" },
	});
	assert(response.ok, `Signed PDF upload returned ${response.status}`);
}

async function prepareAttachment(
	client: AdminClient,
	input: ReturnType<typeof settings>,
	evidence: PublicationSandboxEvidence,
) {
	const pdf = await createPdf(input.runId, evidence.createdAt);
	if (!evidence.attachment) {
		const attachment = await client.request<{ draft: AdminDraft }>(
			"/api/admin/items/drafts",
			{
				method: "POST",
				body: JSON.stringify({
					itemType: "Attachment",
					parentItem: evidence.parent!.key,
					title: `Sandbox PDF ${input.runId}`,
				}),
			},
		);
		evidence.attachment = {
			key: attachment.draft.itemKey,
			filename: `sandbox-${input.runId}.pdf`,
			size: pdf.byteLength,
			sha256: createHash("sha256").update(pdf).digest("hex"),
			md5: createHash("md5").update(pdf).digest("hex"),
		};
		saveEvidence(input.evidencePath, evidence);
	}
	const attachment = evidence.attachment;
	const { item: { fileDraft, filePublication } } = await client.request<{ item: AdminItemDetail }>(`/api/admin/items/${attachment.key}`);
	if (fileDraft?.readyAt || filePublication) {
		const ready = fileDraft?.readyAt
			? { filename: fileDraft.filename, sha256: fileDraft.actualSha256, size: fileDraft.actualSizeBytes }
			: { filename: filePublication!.filename, sha256: filePublication!.sha256, size: filePublication!.sizeBytes };
		assert(ready.filename === attachment.filename && ready.sha256 === attachment.sha256 && ready.size === attachment.size, "The saved attachment does not match the qualification PDF");
	} else {
		assert(createHash("sha256").update(pdf).digest("hex") === attachment.sha256, "The resumed qualification PDF changed");
		const staged = await client.request<{
			fileDraft: { uploadRevision: number };
			upload: { signedUrl: string };
		}>(`/api/admin/items/${attachment.key}/file`, {
			method: "POST",
			body: JSON.stringify({
				expectedSha256: attachment.sha256,
				expectedSizeBytes: attachment.size,
				filename: attachment.filename,
			}),
		});
		await uploadSignedPdf(staged.upload.signedUrl, pdf);
		await client.request(
			`/api/admin/items/${attachment.key}/file/complete`,
			{
				method: "POST",
				body: JSON.stringify({
					expectedUploadRevision: staged.fileDraft.uploadRevision,
				}),
			},
		);
	}
	return attachment;
}

async function runZenodo(
	client: AdminClient,
	input: ReturnType<typeof settings>,
	evidence: PublicationSandboxEvidence,
) {
	if (evidence.zenodo) return evidence.zenodo;
	const crossref = await runCrossref(client, input, evidence);
	const parent = evidence.parent!;
	const attachment = await prepareAttachment(client, input, evidence);
	if (!attachment.approved) {
		await publishReviewed(client, parent.key, input.timeoutMs);
		attachment.approved = true;
		saveEvidence(input.evidencePath, evidence);
	}

	const settled = await waitFor({
		description: "Zenodo Sandbox publication",
		timeoutMs: input.timeoutMs,
		read: () => publication(client, parent.key),
		onRead(view) {
			const failure = view.providers.zenodo.exact.failure;
			if (failure) throw new Error(`Zenodo failed: ${failure.summary}`);
		},
		accept: (view) =>
			view.providers.zenodo.displayState === "synced" &&
			!view.providers.zenodo.exact.journal &&
			view.providers.zenodo.links.some((link) => link.kind === "record"),
	});
	const recordLink = settled.providers.zenodo.links.find(
		(link) => link.kind === "record",
	);
	assert(recordLink, "Zenodo did not return a published record link");
	assert(
		settled.providers.crossref.exact.identifiers.some(
			(identifier) => identifier.doi === crossref.doi,
		),
		"Zenodo publication changed the managed Crossref DOI",
	);
	evidence.zenodo = {
		recordId: recordLink.value,
		recordUrl: recordLink.url,
		verifiedAt: new Date().toISOString(),
	};
	saveEvidence(input.evidencePath, evidence);
	return evidence.zenodo;
}

export function zenodoFile(
	record: Record<string, unknown>,
	filename: string,
) {
	const files = record.files;
	if (Array.isArray(files)) {
		return files.find(
			(file) =>
				file &&
				typeof file === "object" &&
				(file as Record<string, unknown>).key === filename,
		) as Record<string, unknown> | undefined;
	}
	if (files && typeof files === "object") {
		const entries = (files as Record<string, unknown>).entries;
		if (entries && typeof entries === "object") {
			const file = (entries as Record<string, unknown>)[filename];
			return file && typeof file === "object"
				? (file as Record<string, unknown>)
				: undefined;
		}
	}
	return undefined;
}

async function verifyFinishedLifecycle(
	client: AdminClient,
	input: ReturnType<typeof settings>,
	evidence: PublicationSandboxEvidence,
) {
	assert(
		evidence.parent &&
			evidence.crossref &&
			evidence.attachment &&
			evidence.zenodo,
		"Sandbox evidence is incomplete",
	);
	await client.login();
	await verifyRuntime(client, input);
	const view = await publication(client, evidence.parent.key);
	assert(
		view.providers.crossref.displayState === "synced" &&
			view.providers.zenodo.displayState === "synced",
		"Both providers must remain synced after rechecking admin access",
	);
	await waitFor({
		description: "the approved title and DOI in public search",
		timeoutMs: input.timeoutMs,
		read: () => client.request<{item?: Record<string, unknown>}>(`/api/item/${evidence.parent!.key}`),
		accept: result => result.item?.title === evidence.crossref!.editedTitle && result.item?.DOI === evidence.crossref!.doi,
	});

	await verifyPublicPage(input.baseUrl, evidence.parent.key, evidence.crossref.editedTitle);
	const zenodoResponse = await fetch(
		`https://sandbox.zenodo.org/api/records/${evidence.zenodo.recordId}`,
		{ cache: "no-store" },
	);
	assert(
		zenodoResponse.ok,
		`Zenodo record returned ${zenodoResponse.status}`,
	);
	const zenodoRecord = (await zenodoResponse.json()) as Record<
		string,
		unknown
	>;
	const file = zenodoFile(zenodoRecord, evidence.attachment.filename);
	assert(file, "Zenodo record is missing the published PDF");
	const checksum = String(file.checksum ?? "").replace(/^md5:/u, "");
	const size = Number(file.size ?? file.filesize);
	assert(
		checksum === evidence.attachment.md5,
		"Zenodo PDF MD5 does not match",
	);
	assert(size === evidence.attachment.size, "Zenodo PDF size does not match");
	evidence.completedAt = new Date().toISOString();
	saveEvidence(input.evidencePath, evidence);
}

async function verifyPublicPage(baseUrl: string, key: string, title: string) {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		await page.goto(new URL(`/lib/${key}`, baseUrl).toString());
		await page.getByRole("heading", {name: title, exact: true}).waitFor({timeout: 60_000});
	} finally {
		await browser.close();
	}
}

export async function runPublicationSandboxQualification(
	mode: QualificationMode,
) {
	const input = settings();
	const evidence = loadEvidence(input);
	const client = new AdminClient(input.baseUrl);
	await client.login();
	await verifyRuntime(client, input);
	if (mode === "crossref") {
		await runCrossref(client, input, evidence);
	} else if (mode === "zenodo") {
		await runZenodo(client, input, evidence);
	} else {
		await runZenodo(client, input, evidence);
		await verifyFinishedLifecycle(client, input, evidence);
	}
	console.log(
		JSON.stringify({
			mode,
			runId: input.runId,
			evidencePath: input.evidencePath,
			parentKey: evidence.parent?.key ?? null,
			doi: evidence.crossref?.doi ?? null,
			zenodoRecordId: evidence.zenodo?.recordId ?? null,
		}),
	);
}
