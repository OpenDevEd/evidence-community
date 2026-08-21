/**
 * Real-service check: a record that brought its own DOI is archived on
 * Zenodo Sandbox under that DOI. Nothing is registered or minted.
 *
 * Needs a running web app and publication worker with Zenodo Sandbox
 * enabled. Environment:
 *   ZENODO_REUSE_ORIGIN           e.g. http://127.0.0.1:3400
 *   EVIDENCE_LIBRARY_ADMIN_PASSWORD
 *   ZENODO_REUSE_DOI              a DOI that resolves at doi.org
 *                                 (default 10.1038/nature12373)
 *   ZENODO_REUSE_TIMEOUT_MS       default 10 minutes
 * The test record is unpublished at the end. The Zenodo Sandbox record stays.
 */
import { createHash } from "node:crypto";

import { PDFDocument, StandardFonts } from "pdf-lib";

import type {
	AdminSearchIndexReceipt,
	AdminSearchIndexReceiptStatus,
} from "../src/lib/admin/search-index-contract";
import type { AdminPublicationView } from "../src/lib/publication/admin-publication-view";
import { createAdminTestSession } from "./adminSession";

const origin = process.env.ZENODO_REUSE_ORIGIN?.trim();
if (!origin) throw new Error("ZENODO_REUSE_ORIGIN is required");
const externalDoi = process.env.ZENODO_REUSE_DOI?.trim() || "10.1038/nature12373";
const timeoutMs = Number(process.env.ZENODO_REUSE_TIMEOUT_MS ?? 10 * 60 * 1000);

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

class AdminClient {
	#cookie = "";
	async login() {
		this.#cookie = (await createAdminTestSession(origin!)).cookieHeader;
	}
	async request<T>(pathname: string, init: RequestInit = {}) {
		const headers = new Headers(init.headers);
		if (this.#cookie) headers.set("Cookie", this.#cookie);
		if (typeof init.body === "string") headers.set("Content-Type", "application/json");
		const response = await fetch(new URL(pathname, origin), { ...init, headers, cache: "no-store" });
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`${init.method ?? "GET"} ${pathname} returned ${response.status}: ${text}`);
		}
		return (text ? JSON.parse(text) : undefined) as T;
	}
}

async function waitFor<T>(input: {
	description: string;
	read: () => Promise<T>;
	accept: (value: T) => boolean;
	onRead?: (value: T) => void;
}) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await input.read();
		input.onRead?.(value);
		if (input.accept(value)) return value;
		await pause(2_000);
	}
	throw new Error(`Timed out waiting for ${input.description}`);
}

async function waitForReceipts(client: AdminClient, receipts: readonly AdminSearchIndexReceipt[]) {
	if (receipts.length === 0) return;
	await waitFor({
		description: "search receipts",
		read: async () =>
			(
				await client.request<{ receipts: AdminSearchIndexReceiptStatus[] }>(
					"/api/admin/search-index/receipts",
					{ method: "POST", body: JSON.stringify({ receipts }) },
				)
			).receipts,
		accept: (statuses) => statuses.every((status) => status.state === "indexed"),
	});
}

type Mutation = { indexingReceipts: AdminSearchIndexReceipt[]; item?: { revision?: number } };
type Draft = { draft: { itemKey: string } };

async function createPdf(stamp: string) {
	const document = await PDFDocument.create();
	const font = await document.embedFont(StandardFonts.Helvetica);
	document.addPage([612, 792]).drawText(`Zenodo reuse-external check ${stamp}`, { x: 72, y: 700, size: 20, font });
	return new Uint8Array(await document.save());
}

async function main() {
	const client = new AdminClient();
	await client.login();
	const stamp = new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
	const log = (step: string, detail: Record<string, unknown> = {}) =>
		console.log(JSON.stringify({ step, ...detail }));

	// 1. A published record that already has a DOI.
	const parent = await client.request<Draft>("/api/admin/items/drafts", {
		method: "POST",
		body: JSON.stringify({
			itemType: "Report",
			title: `Zenodo reuse-external check ${stamp}`,
			date: new Date().toISOString().slice(0, 10),
			abstractNote: "A disposable record used to prove that Zenodo archives under the DOI the record already has.",
			publisher: "OpenDevEd",
			DOI: externalDoi,
			creators: [{ creatorType: "author", firstName: "OpenDevEd", lastName: "Verification" }],
		}),
	});
	const key = parent.draft.itemKey;
	const published = await client.request<Mutation>(`/api/admin/items/${key}/publish`, { method: "POST", body: "{}" });
	await waitForReceipts(client, published.indexingReceipts);
	log("published", { key, doi: externalDoi });

	try {
		// 2. The card sees the record's own DOI, offers the archive, and no Crossref.
		const before = (await client.request<{ publication: AdminPublicationView }>(`/api/admin/items/${key}/publication`)).publication;
		assert(before.identifiers.doi?.value === externalDoi && before.identifiers.doi.origin === "record", "The record's own DOI is not shown as its own");
		assert(before.identifiers.actions.map((a) => a.id).join() === "archive-zenodo", `Unexpected actions: ${before.identifiers.actions.map((a) => a.id).join(", ")}`);
		assert(before.providers.zenodo.capabilities.allowedIdentifierPolicies.join() === "reuse-external", "reuse-external is not the offered policy");
		log("view-before", { actions: before.identifiers.actions.map((a) => a.id) });

		// 3. A published PDF.
		const attachment = await client.request<Draft>("/api/admin/items/drafts", {
			method: "POST",
			body: JSON.stringify({ itemType: "Attachment", parentItem: key, title: `PDF ${stamp}` }),
		});
		const pdf = await createPdf(stamp);
		const staged = await client.request<{ fileDraft: { uploadRevision: number }; upload: { signedUrl: string } }>(
			`/api/admin/items/${attachment.draft.itemKey}/file`,
			{
				method: "POST",
				body: JSON.stringify({
					expectedSha256: createHash("sha256").update(pdf).digest("hex"),
					expectedSizeBytes: pdf.byteLength,
					filename: `reuse-external-${stamp}.pdf`,
				}),
			},
		);
		const body = new FormData();
		body.append("cacheControl", "3600");
		body.append("", new Blob([pdf], { type: "application/pdf" }));
		const upload = await fetch(staged.upload.signedUrl, { method: "PUT", body, headers: { "x-upsert": "true" } });
		assert(upload.ok, `PDF upload returned ${upload.status}`);
		await client.request(`/api/admin/items/${attachment.draft.itemKey}/file/complete`, {
			method: "POST",
			body: JSON.stringify({ expectedUploadRevision: staged.fileDraft.uploadRevision }),
		});
		const attachmentPublished = await client.request<Mutation>(`/api/admin/items/${attachment.draft.itemKey}/publish`, { method: "POST", body: "{}" });
		await waitForReceipts(client, attachmentPublished.indexingReceipts);
		const filePublished = await client.request<Mutation>(`/api/admin/items/${attachment.draft.itemKey}/file/publish`, {
			method: "POST",
			body: JSON.stringify({ expectedUploadRevision: staged.fileDraft.uploadRevision }),
		});
		await waitForReceipts(client, filePublished.indexingReceipts);
		log("pdf-published", { attachment: attachment.draft.itemKey });

		// 4. Archive on Zenodo under the record's DOI.
		const activation = await client.request<{ activation: { identifierPolicy: string } }>(
			`/api/admin/items/${key}/publication/zenodo/activate`,
			{ method: "POST", body: JSON.stringify({ identifierPolicy: "reuse-external" }) },
		);
		assert(activation.activation.identifierPolicy === "reuse-external", "Activation did not keep reuse-external");
		log("activated", activation.activation);

		const settled = await waitFor({
			description: "Zenodo Sandbox publication",
			read: async () => (await client.request<{ publication: AdminPublicationView }>(`/api/admin/items/${key}/publication`)).publication,
			onRead(view) {
				const failure = view.providers.zenodo.exact.failure;
				if (failure) throw new Error(`Zenodo failed: ${failure.summary}`);
			},
			accept: (view) => view.providers.zenodo.displayState === "synced",
		});
		assert(settled.identifiers.doi?.value === externalDoi && settled.identifiers.doi.origin === "record", "After archiving the DOI is no longer shown as the record's own");
		assert(settled.identifiers.archive.state === "active" && settled.identifiers.archive.displayState === "synced", "Archive is not synced");
		const zenodoRows = settled.providers.zenodo.exact.identifiers;
		assert(zenodoRows.some((row) => row.doi === externalDoi && row.ownership === "external"), `Zenodo did not settle under ${externalDoi} as an external identifier: ${JSON.stringify(zenodoRows)}`);
		assert(!zenodoRows.some((row) => row.doi === externalDoi && row.ownership === "managed"), "The record's own DOI was stored as a managed identifier");
		const archiveLink = settled.providers.zenodo.links.find((link) => link.kind === "record" && link.label === "Zenodo archive");
		const recordId = archiveLink?.value;
		assert(recordId, "No Zenodo archive record link");

		// 5. Read the Zenodo Sandbox record back: it carries the record's DOI.
		const zenodoRecord = await fetch(`https://sandbox.zenodo.org/api/records/${recordId}`).then((r) => r.json() as Promise<{ doi?: string; pids?: { doi?: { identifier?: string; provider?: string } } }>);
		const remoteDoi = zenodoRecord.pids?.doi?.identifier ?? zenodoRecord.doi;
		assert(remoteDoi === externalDoi, `Zenodo record ${recordId} carries DOI ${remoteDoi}`);
		log("zenodo-record", { recordId, doi: remoteDoi, provider: zenodoRecord.pids?.doi?.provider ?? null });

		// 6. Changing the record DOI after archiving is blocked for Zenodo.
		const draft = await client.request<{ draft: { draftRevision: number; payload: Record<string, unknown> } }>(`/api/admin/items/${key}/draft`, { method: "POST" });
		const edited = { ...draft.draft.payload, DOI: "10.1038/nature12374" };
		await client.request(`/api/admin/items/${key}/draft`, {
			method: "PUT",
			body: JSON.stringify({ expectedDraftRevision: draft.draft.draftRevision, expectedPayload: draft.draft.payload, payload: edited }),
		});
		const republished = await client.request<Mutation>(`/api/admin/items/${key}/publish`, { method: "POST", body: "{}" });
		await waitForReceipts(client, republished.indexingReceipts);
		const after = (await client.request<{ publication: AdminPublicationView }>(`/api/admin/items/${key}/publication`)).publication;
		assert(after.providers.zenodo.blockers.some((b) => b.includes("no longer matches the DOI archived on Zenodo")), `No mismatch blocker: ${after.providers.zenodo.blockers.join(" | ")}`);
		// The worker must refuse the queued update for the same reason, and
		// Zenodo must still carry the original DOI.
		const refused = await waitFor({
			description: "the worker to refuse the changed DOI",
			read: async () => (await client.request<{ publication: AdminPublicationView }>(`/api/admin/items/${key}/publication`)).publication,
			accept: (view) => Boolean(view.providers.zenodo.exact.failure?.summary.includes("no longer matches the DOI archived on Zenodo")),
		});
		const zenodoAfter = await fetch(`https://sandbox.zenodo.org/api/records/${recordId}`).then((r) => r.json() as Promise<{ doi?: string; pids?: { doi?: { identifier?: string } } }>);
		const remoteAfter = zenodoAfter.pids?.doi?.identifier ?? zenodoAfter.doi;
		assert(remoteAfter === externalDoi, `Zenodo record ${recordId} DOI changed to ${remoteAfter}`);
		log("doi-change-blocked", { blocker: after.providers.zenodo.blockers[0], workerFailure: refused.providers.zenodo.exact.failure?.summary, zenodoDoi: remoteAfter });

		console.log(JSON.stringify({ ok: true, key, recordId, doi: externalDoi }));
	} finally {
		await client.request(`/api/admin/items/${key}/unpublish`, { method: "POST" }).catch(() => undefined);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
