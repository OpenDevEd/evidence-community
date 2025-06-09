import StatisticsPage from "@/components/layout/StatisticsPageNew";
import { getCachedStatus } from "@/app/api/cache";
import { notFound } from "next/navigation";
import { getComprehensiveStats } from "./queries/get-comprehensive-stats";

export const maxDuration = 300;

export default async function Statistics() {
	const status = await getCachedStatus();

	const links = status.links || [];
	const hasStatistics = links.some(link => link.href.includes("statistics"));

	if (!hasStatistics) {
		return notFound();
	}

	const stats = await getComprehensiveStats(false);
	
	return <StatisticsPage stats={stats} />;
}
