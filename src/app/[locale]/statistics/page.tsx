import PageBoundary from "@/components/layout/PageBoundary";
import StatisticsLoading from "./loading";
import StatisticsPage from "@/components/layout/StatisticsPageNew";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getComprehensiveStats } from "./queries/get-comprehensive-stats";
import { getLibraryConfig } from "@/config/library-config/server";
import {
	hasRuntimeLinkPath,
	hasRuntimeNavigationPath,
} from "@/config/library-config/links";

export const maxDuration = 300;

async function StatisticsContent({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	await connection();
	const config = await getLibraryConfig();
	const hasStatistics =
		hasRuntimeNavigationPath(config.navigation.links, "/statistics") ||
		config.footer.sections.some((section) =>
		hasRuntimeLinkPath(section.links, "/statistics"),
	);

	if (!hasStatistics) {
		return notFound();
	}

	const requestedMeasure = (await searchParams).citation;
	const stats = await getComprehensiveStats(
		Array.isArray(requestedMeasure)
			? requestedMeasure[0]
			: requestedMeasure,
	);

	return <StatisticsPage stats={stats} />;
}

export default function Statistics(props: Parameters<typeof StatisticsContent>[0]) {
	return (
		<PageBoundary fallback={<StatisticsLoading />}>
			<StatisticsContent {...props} />
		</PageBoundary>
	);
}
