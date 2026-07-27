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

export default async function Statistics() {
	await connection();
	const config = await getLibraryConfig();
	const hasStatistics = hasRuntimeNavigationPath(
		config.navigation.links,
		"/statistics",
	) || config.footer.sections.some((section) =>
		hasRuntimeLinkPath(section.links, "/statistics"),
	);

	if (!hasStatistics) {
		return notFound();
	}

	const stats = await getComprehensiveStats();

	return <StatisticsPage stats={stats} />;
}
