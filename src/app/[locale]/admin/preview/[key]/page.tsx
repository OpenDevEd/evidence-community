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

type Props = {
	params: Promise<{ key: string }>;
	searchParams: Promise<{ review?: string | string[] }>;
};

const reviewId = z.uuid().optional();

function PreviewMessage({ children }: { children: ReactNode }) {
	return <div className="mx-auto max-w-xl px-6 py-16 text-sm text-black/65 dark:text-white/65">{children}</div>;
}

/** The public item page as publishing the working draft, or the given review, would leave it. Admins only; never cached. */
async function DraftPreview({ params, searchParams }: Props) {
	await connection();
	const authorization = await authorizeAdminSession((await cookies()).get(adminSessionCookieName())?.value, ADMIN_CONTENT_PERMISSION);
	if (authorization.status !== "authorized") notFound();
	const [{ key }, query] = await Promise.all([params, searchParams]);
	const review = reviewId.safeParse(query.review);
	if (!isCanonicalRecordKey(key) || !review.success) notFound();
	const config = await getLibraryConfig();
	let item;
	try {
		const [preview, collections] = await Promise.all([
			getDatabaseForConfig(config).then((db) => previewItem(db, key, config, review.data)),
			getCachedCollections(config),
		]);
		item = preview && withCollectionsData(preview, collections);
	} catch (error) {
		const details = adminErrorDetails(error);
		if (details.status >= 500) throw error;
		return (
			<PreviewMessage>
				<p className="font-medium text-black/85 dark:text-white/85">This version can&apos;t be published yet, so there&apos;s nothing to preview.</p>
				<ul className="mt-2 flex flex-col gap-1">
					{Object.entries(details.fields ?? { _form: details.message }).map(([field, message]) => (
						<li key={field}>{message}</li>
					))}
				</ul>
			</PreviewMessage>
		);
	}
	if (!item) return <PreviewMessage>After publishing, this record would be hidden from the public library.</PreviewMessage>;
	// Look only: the page's links and buttons would lead this frame away from the preview.
	return (
		<div inert>
			<ItemPage data={withoutFullText({ item })} loading={false} />
		</div>
	);
}

export default function DraftPreviewPage(props: Props) {
	return (
		<Suspense>
			<DraftPreview {...props} />
		</Suspense>
	);
}
