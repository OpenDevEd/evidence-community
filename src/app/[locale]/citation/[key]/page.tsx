import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Metadata } from "next";
import { getCachedItemSmall } from "@/app/api/cache";
import { Item } from "@/app/api/item/types";
import { getLibraryConfig } from "@/config/library-config/server";
import CitationPageClient from "./CitationPageClient";
import { notFound } from "next/navigation";
import LoadingComponent from "./LoadingComponent";

export async function generateMetadata(props: {
	params: Promise<{ key: string }>;
}): Promise<Metadata> {
	const params = await props.params;
	const t = await getTranslations("ui");
	const [data, libraryConfig] = await Promise.all([
		getCachedItemSmall(params.key),
		getLibraryConfig(),
	]);

	if (!data || !data.item) {
		return {
			title: t("notFoundTitle"),
			description: t("notFoundTitle"),
		};
	}
	
	const item: Item = data.item;
	
	const title = item.title ?? "";
	return {
		title: t("citationsTitle", { title }),
		description: t("citationsDescription", { title }),
		openGraph: {
			title: t("citationsTitle", { title }),
			description: t("citationsDescription", { title }),
			siteName: libraryConfig.identity.name,
		},
	};
}

async function ServerComponent(props: { params: Promise<{ key: string }> }) {
	const params = await props.params;
	const data = await getCachedItemSmall(params.key);
	
	if (!data || !data.item) {
		return notFound();
	}

	return <CitationPageClient sourceItem={data.item} itemKey={params.key} />;
}

export default async function CitationPage(props: {
	params: Promise<{ key: string }>;
}) {
	return (
		<Suspense fallback={<LoadingComponent />}>
			<ServerComponent params={props.params} />
		</Suspense>
	);
}
