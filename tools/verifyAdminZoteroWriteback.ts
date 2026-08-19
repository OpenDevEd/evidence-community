/**
 * Browser-to-Zotero proof of per-record source writeback.
 *
 * Drives a deployed /admin in real Chromium: publish a native record through
 * the "Also update" dialog, watch Zotero receive it, add a PDF attachment and
 * see Zotero get a linked attachment, untick the source and prove later
 * publishes leave Zotero alone, then unpublish with the source ticked and
 * prove Zotero deletes the copy. Zotero is read through its Web API.
 *
 *   ADMIN_ZOTERO_ORIGIN=https://... \
 *   ADMIN_ZOTERO_PASSWORD=... \
 *   ADMIN_ZOTERO_GROUP=6641415 \
 *   ADMIN_ZOTERO_API_KEY=... \
 *   npm run test:admin-zotero-live -- --confirm-group 6641415
 */
import { setTimeout as delay } from "node:timers/promises";

import { chromium, type Page } from "@playwright/test";

import { createFixturePdf } from "./seedZoteroPlayground";

const origin = process.env.ADMIN_ZOTERO_ORIGIN;
const password = process.env.ADMIN_ZOTERO_PASSWORD;
const groupId = process.env.ADMIN_ZOTERO_GROUP;
const apiKey = process.env.ADMIN_ZOTERO_API_KEY;
const sourceLabelHint = process.env.ADMIN_ZOTERO_SOURCE_LABEL ?? null;
const confirmedGroup = (() => {
	const index = process.argv.indexOf("--confirm-group");
	return index >= 0 ? process.argv[index + 1] : undefined;
})();

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

assert(origin && password && groupId && apiKey, "Set ADMIN_ZOTERO_ORIGIN, ADMIN_ZOTERO_PASSWORD, ADMIN_ZOTERO_GROUP and ADMIN_ZOTERO_API_KEY");
assert(confirmedGroup === groupId, `Pass --confirm-group ${groupId} to confirm the Zotero group this tool writes to`);
assert(/^https:\/\//u.test(origin), "ADMIN_ZOTERO_ORIGIN must be an https origin");

const zoteroBase = `https://api.zotero.org/groups/${groupId}`;

async function zoteroItem(key: string) {
	const response = await fetch(`${zoteroBase}/items/${key}`, {
		headers: { "Zotero-API-Key": apiKey!, "Zotero-API-Version": "3" },
	});
	if (response.status === 404) return null;
	assert(response.ok, `Zotero read failed for ${key}: ${response.status}`);
	return (await response.json()) as { data: Record<string, unknown>; version: number };
}

async function zoteroChildren(parentKey: string) {
	const response = await fetch(`${zoteroBase}/items/${parentKey}/children`, {
		headers: { "Zotero-API-Key": apiKey!, "Zotero-API-Version": "3" },
	});
	if (response.status === 404) return [];
	assert(response.ok, `Zotero children read failed for ${parentKey}: ${response.status}`);
	return (await response.json()) as { key: string; data: Record<string, unknown> }[];
}

async function waitFor<T>(label: string, read: () => Promise<T | null>, timeoutMs = 240_000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const value = await read();
		if (value !== null) return value;
		await delay(5_000);
	}
	throw new Error(`${label} did not happen within ${timeoutMs / 1000}s`);
}

async function login(page: Page) {
	await page.goto(`${origin}/admin`);
	const passwordInput = page.getByRole("textbox", { name: "Admin password" });
	const newItem = page.getByRole("button", { name: "New item" });
	await passwordInput.or(newItem).first().waitFor({ state: "visible" });
	if (await passwordInput.isVisible()) {
		await passwordInput.fill(password!);
		await page.getByRole("button", { name: "Continue" }).click();
	}
	await newItem.waitFor({ state: "visible" });
}

/** Collects the keys of drafts the admin creates, from the API responses. */
function trackCreatedDrafts(page: Page) {
	const keys: string[] = [];
	page.on("response", (response) => {
		if (!response.url().endsWith("/api/admin/items/drafts")) return;
		if (response.request().method() !== "POST") return;
		void response
			.json()
			.then((body: { draft?: { itemKey?: string } }) => {
				if (body.draft?.itemKey) keys.push(body.draft.itemKey);
			})
			.catch(() => undefined);
	});
	return keys;
}

async function publishThroughDialog(page: Page, inspector: ReturnType<Page["locator"]>, tick: boolean) {
	await inspector.getByRole("button", { name: "Publish", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Publish this record" });
	await dialog.waitFor({ state: "visible", timeout: 15_000 });
	const box = dialog.getByRole("switch").first();
	if (tick) await box.check();
	else await box.uncheck();
	await dialog.getByRole("button", { name: "Publish", exact: true }).click();
	await page.getByText("Record published", { exact: true }).waitFor({ timeout: 60_000 });
}

async function main() {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	const marker = `${Date.now()}`;
	const title = `Admin Zotero writeback ${marker}`;
	let parentKey: string | null = null;
	let attachmentKey: string | null = null;
	const summary: Record<string, unknown> = { groupId, origin };
	const createdKeys = trackCreatedDrafts(page);
	try {
		await login(page);
		await page.getByRole("button", { name: "New item" }).click();
		await page.getByRole("dialog", { name: "New item" }).getByRole("button", { name: "Book", exact: true }).click();
		const inspector = page.locator("#admin-inspector-pane");
		await inspector.getByRole("textbox", { name: "Title", exact: true }).fill(title);
		await page.getByText("Saved", { exact: true }).waitFor({ timeout: 30_000 });
		await waitFor("draft key", async () => createdKeys[0] ?? null, 30_000);
		parentKey = createdKeys[0]!;
		summary.parentKey = parentKey;

		// 1. Publish and tick the Zotero source in the dialog.
		await publishThroughDialog(page, inspector, true);
		const remoteParent = await waitFor("Zotero parent creation", () => zoteroItem(parentKey!));
		assert(remoteParent.data.title === title, `Zotero parent title mismatch: ${String(remoteParent.data.title)}`);
		await page.locator('[data-admin-writeback-status="synced"]').first().waitFor({ timeout: 240_000 });
		summary.parentPublished = true;

		// 2. Add a PDF attachment, publish it and its file; Zotero gets a linked attachment.
		await inspector.getByRole("button", { name: "Add attachment" }).click();
		const attachmentInput = page.locator('input[type="file"][id^="pdf-"]').first();
		await attachmentInput.waitFor({ state: "attached", timeout: 30_000 });
		attachmentKey = (await attachmentInput.getAttribute("id"))!.replace(/^pdf-/u, "");
		summary.attachmentKey = attachmentKey;
		const pdfBytes = await createFixturePdf({ documentTitle: title, pageTokens: [`ADMIN-ZOTERO-${marker}`] });
		await attachmentInput.setInputFiles({ buffer: Buffer.from(pdfBytes), mimeType: "application/pdf", name: `${marker}.pdf` });
		await inspector.getByRole("button", { name: "Publish", exact: true }).click();
		await page.getByText("Record published", { exact: true }).waitFor({ timeout: 60_000 });
		const publishPdf = inspector.getByRole("button", { name: "Publish PDF", exact: true });
		await publishPdf.waitFor({ state: "visible", timeout: 240_000 });
		await publishPdf.click();
		const dialogs = page.getByRole("dialog");
		if (await dialogs.count()) {
			const confirm = dialogs.first().getByRole("button", { name: /Publish/u }).first();
			if (await confirm.isVisible()) await confirm.click();
		}
		const remoteChildren = await waitFor("Zotero attachment creation", async () => {
			const children = await zoteroChildren(parentKey!);
			return children.length > 0 ? children : null;
		});
		const remoteAttachment = remoteChildren.find((child) => child.key === attachmentKey) ?? remoteChildren[0]!;
		summary.zoteroAttachment = { key: remoteAttachment.key, linkMode: remoteAttachment.data.linkMode, url: remoteAttachment.data.url };
		assert(remoteAttachment.data.linkMode === "linked_url", `Zotero attachment is not a linked URL: ${String(remoteAttachment.data.linkMode)}`);

		// 3. Back to the parent: untick the source, edit, publish; Zotero must not change.
		await inspector.getByRole("button", { name: "Parent record", exact: true }).click();
		await inspector.getByRole("button", { name: "Sources", exact: true }).waitFor({ timeout: 30_000 });
		await inspector.getByRole("button", { name: "Sources", exact: true }).click();
		const sources = page.getByRole("dialog", { name: "Sources for this record" });
		await sources.waitFor({ state: "visible" });
		await sources.getByRole("switch").first().uncheck();
		await sources.getByRole("button", { name: "Save", exact: true }).click();
		await page.getByText("Sources saved", { exact: true }).waitFor({ timeout: 30_000 });
		const versionBeforeEdit = (await zoteroItem(parentKey))!.version;
		await inspector.getByRole("button", { name: "Edit", exact: true }).click();
		const titleBox = inspector.getByRole("textbox", { name: "Title", exact: true });
		await titleBox.fill(`${title} (local only)`);
		await page.getByText("Saved", { exact: true }).waitFor({ timeout: 30_000 });
		await publishThroughDialog(page, inspector, false);
		await delay(45_000);
		const remoteAfterLocalEdit = await zoteroItem(parentKey);
		assert(remoteAfterLocalEdit && remoteAfterLocalEdit.version === versionBeforeEdit && remoteAfterLocalEdit.data.title === title, "Zotero changed although the source was unticked");
		summary.pausedSourceUntouched = true;

		// 4. Unpublish with the source ticked; Zotero deletes the copy.
		await inspector.getByRole("button", { name: "Sources", exact: true }).click();
		await sources.waitFor({ state: "visible" });
		await sources.getByRole("switch").first().check();
		await sources.getByRole("button", { name: "Save", exact: true }).click();
		await page.getByText("Sources saved", { exact: true }).waitFor({ timeout: 30_000 });
		await waitFor("Zotero update after re-tick", async () => {
			const remote = await zoteroItem(parentKey!);
			return remote && remote.data.title === `${title} (local only)` ? remote : null;
		});
		// The chip must show the result by itself, without a page reload.
		await page.locator('[data-admin-writeback-status="synced"]').waitFor({ timeout: 240_000 });
		summary.chipSyncedWithoutReload = true;
		// The attachment must go first: unpublish it, then the parent.
		await inspector.getByRole("button", { name: /^Open (?!public item)/u }).first().click();
		const unpublishPdf = inspector.getByRole("button", { name: "Unpublish PDF", exact: true });
		await unpublishPdf.waitFor({ state: "visible", timeout: 60_000 });
		await unpublishPdf.click();
		const pdfDialog = page.getByRole("dialog", { name: "Unpublish PDF?" });
		await pdfDialog.waitFor({ state: "visible" });
		await pdfDialog.getByRole("button", { name: "Confirm", exact: true }).click();
		await page.getByText("PDF unpublished", { exact: true }).waitFor({ timeout: 60_000 });
		await inspector.getByRole("button", { name: "Unpublish", exact: true }).and(page.locator(":enabled")).waitFor({ timeout: 60_000 }).catch(() => undefined);
		await inspector.getByRole("button", { name: "Unpublish", exact: true }).click();
		const attachmentDialog = page.getByRole("dialog", { name: "Unpublish record?" });
		await attachmentDialog.waitFor({ state: "visible" });
		await attachmentDialog.getByRole("button", { name: "Confirm", exact: true }).click();
		await page.getByText("Record unpublished", { exact: true }).waitFor({ timeout: 60_000 });
		await inspector.getByRole("button", { name: "Parent record", exact: true }).click();
		await inspector.getByRole("button", { name: "Unpublish", exact: true }).click();
		const unpublish = page.getByRole("dialog", { name: "Unpublish this record" });
		await unpublish.waitFor({ state: "visible" });
		await unpublish.getByRole("switch").first().check();
		await unpublish.getByRole("button", { name: "Unpublish", exact: true }).click();
		await page.getByText("Record unpublished", { exact: true }).waitFor({ timeout: 60_000 });
		await waitFor("Zotero deletion", async () => ((await zoteroItem(parentKey!)) === null ? true : null));
		summary.zoteroDeletedOnUnpublish = true;
		summary.pageErrors = pageErrors;
		summary.status = "ok";
		console.log(JSON.stringify(summary, null, 2));
	} catch (error) {
		await page.screenshot({ path: `admin-zotero-writeback-failure-${marker}.png`, fullPage: true }).catch(() => undefined);
		console.error(JSON.stringify({ ...summary, pageErrors }, null, 2));
		throw error;
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
