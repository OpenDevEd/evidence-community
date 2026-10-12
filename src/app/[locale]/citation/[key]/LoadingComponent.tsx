import { Skeleton } from "@/components/nextui/Skeleton";
import PageContainer from "@/components/layout/PageContainer";

/** Placeholders for a record's citation page while it loads. */
export default function LoadingComponent() {
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
