"use client";

import PageContainer from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/nextui/Skeleton";

/**
 * The stand-in for a page that has none of its own: a heading and a few lines, and room down past the fold, so while
 * any page is on its way the footer is never drawn against the header.
 */
export default function PagePlaceholder() {
	return (
		<PageContainer className="mx-auto min-h-[75svh]">
			<Skeleton isLoaded={false} className="h-11 w-80 max-w-full rounded-xl" />
			<div className="mt-6 max-w-2xl space-y-3">
				<Skeleton isLoaded={false} className="h-4 w-full rounded-lg" />
				<Skeleton isLoaded={false} className="h-4 w-11/12 rounded-lg" />
				<Skeleton isLoaded={false} className="h-4 w-3/5 rounded-lg" />
			</div>
		</PageContainer>
	);
}
