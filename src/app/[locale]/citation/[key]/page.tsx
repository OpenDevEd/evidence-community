import { Suspense } from "react";
import { Metadata } from "next";
import { cacheLife } from "next/cache";
import { getCachedItemSmall } from "@/app/api/cache";
import { Item } from "@/app/api/item/types";
import { parseCompanyName } from "@/lib/utils";
import CitationPageClient from "./CitationPageClient";
import { notFound } from "next/navigation";
import { Skeleton } from "@/components/heroui/Skeleton";
import PageContainer from "@/components/layout/PageContainer";

async function getSourceItem(key: string) {
	const data = await getCachedItemSmall(key).catch(() => ({
		item: undefined,
	}));
	return data;
}

export async function generateMetadata(props: {
	params: Promise<{ key: string }>;
}): Promise<Metadata> {
	"use cache";
	cacheLife({ revalidate: 60 });
	const params = await props.params;
	const data = await getSourceItem(params.key);

	const { companyName, siteName } = parseCompanyName(process.env.NEXT_PUBLIC_COMPANY_NAME);

	if (!data || !data.item) {
		return {
			title: "404 - Not Found",
			description: "404 - Not Found",
		};
	}
	
	const item: Item = data.item;
	
	return {
		title: `Citations - ${item.title}`,
		description: `View citation statistics and citing resources for "${item.title}"`,
		openGraph: {
			title: `Citations - ${item.title}`,
			description: `View citation statistics and citing resources for "${item.title}"`,
			siteName: `${companyName} - ${siteName}`,
		},
	};
}

function LoadingComponent() {
	return (
		<PageContainer>
			<div className="flex flex-col gap-8">
				<Skeleton className="h-32 w-full rounded-2xl" />
				<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
					<Skeleton className="h-24 rounded-2xl" />
					<Skeleton className="h-24 rounded-2xl" />
					<Skeleton className="h-24 rounded-2xl" />
				</div>
				<Skeleton className="h-96 w-full rounded-2xl" />
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					{Array.from({ length: 4 }).map((_, i) => (
						<Skeleton key={i} className="h-32 rounded-2xl" />
					))}
				</div>
			</div>
		</PageContainer>
	);
}

async function ServerComponent(props: { params: Promise<{ key: string }> }) {
	const params = await props.params;
	const data = await getSourceItem(params.key);
	
	if (!data || !data.item || data.item.groupExternalId === 1) {
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



