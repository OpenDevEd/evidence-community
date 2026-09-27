import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { z } from "zod";

import { getCachedCollections } from "@/app/api/cache";
import { withCollectionsData, withoutFullText } from "@/app/api/item/[key]/route";
import ItemPage from "@/components/features/newlib/ItemPage";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { ADMIN_CONTENT_PERMISSION, adminSessionCookieName, authorizeAdminSession } from "@/lib/admin/access";
import { adminErrorDetails } from "@/lib/admin/http";
import { previewItem } from "@/lib/admin/item-preview";

import { LookOnly } from "./LookOnly";

type Props = {
	params: Promise<{ key: string }>;
	searchParams: Promise<{ review?: string | string[] }>;
};

const previewRequest = z.object({
	key: z.string().refine(isCanonicalRecordKey),
	review: z.uuid().optional(),
});

function PreviewMessage({ children }: { children: ReactNode }) {
	return <div className="mx-auto max-w-xl px-6 py-16 text-sm text-black/65 dark:text-white/65">{children}</div>;
}

/** Whether this admin may preview. An access check outage is an error to retry, not a missing page. */
async function canPreview() {
	const authorization = await authorizeAdminSession((await cookies()).get(adminSessionCookieName())?.value, ADMIN_CONTENT_PERMISSION);
	if (authorization.status === "unavailable") throw new Error("OpenScholar access verification is temporarily unavailable");
	return authorization.status === "authorized";
}

/** The record key and review an admin asked for, or not found for anyone else and for malformed requests. */
async function readPreviewRequest({ params, searchParams }: Props) {
	const [{ key }, { review }, allowed] = await Promise.all([params, searchParams, canPreview()]);
	const request = previewRequest.safeParse({ key, review });
	if (!allowed || !request.success) notFound();
	return request.data;
}

/** What stops this version from publishing, or the error itself when it isn't about the record. */
function publishBlockers(error: unknown) {
	const details = adminErrorDetails(error);
	if (details.status >= 500) throw error;
	return Object.values(details.fields ?? { _form: details.message });
}

async function loadPreview(key: string, review?: string) {
	const config = await getLibraryConfig();
	try {
		const [preview, collections] = await Promise.all([
			getDatabaseForConfig(config).then((db) => previewItem(db, key, config, review)),
			getCachedCollections(config),
		]);
		return { item: preview && withCollectionsData(preview, collections), blockers: [] };
	} catch (error) {
		return { item: null, blockers: publishBlockers(error) };
	}
}

/** The public item page as publishing the working draft, or the given review, would leave it. Admins only; never cached. */
async function DraftPreview(props: Props) {
	await connection();
	const { key, review } = await readPreviewRequest(props);
	const { item, blockers } = await loadPreview(key, review);
	if (blockers.length) {
		return (
			<PreviewMessage>
				<p className="font-medium text-black/85 dark:text-white/85">This version can&apos;t be published yet, so there&apos;s nothing to preview.</p>
				<ul className="mt-2 flex flex-col gap-1">
					{blockers.map((message) => (
						<li key={message}>{message}</li>
					))}
				</ul>
			</PreviewMessage>
		);
	}
	if (!item) return <PreviewMessage>After publishing, this record would be hidden from the public library.</PreviewMessage>;
	return (
		<LookOnly>
			<ItemPage data={withoutFullText({ item })} loading={false} />
		</LookOnly>
	);
}

export default function DraftPreviewPage(props: Props) {
	return (
		<Suspense>
			<DraftPreview {...props} />
		</Suspense>
	);
}
