import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import { linksToStatistics } from "@/config/library-config/pages";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import {
	getLibraryConfigHealth,
	loadLibraryConfig,
} from "@/config/library-config/source";
import { peekComprehensiveStats } from "@/app/[locale]/statistics/queries/get-comprehensive-stats";
import { headers } from "next/headers";

/** How often the health check looks at the statistics, which takes a query: it runs every 30 seconds. */
const STATISTICS_CHECK_MS = 5 * 60_000;
let statisticsCheckedAt = 0;

/**
 * The health check runs from a container's start, so a library's statistics are counted without waiting for a visitor:
 * after a deployment, after a revision that changes what they count, and once they are a day old. Only a page that
 * shows them needs them; an index-only library has neither, and an empty database to count.
 */
function keepStatisticsCounted(config: LibraryServerConfig) {
	if (!isLibraryFeatureEnabled(config.features, "homePage") && !linksToStatistics(config)) return;
	if (Date.now() - statisticsCheckedAt < STATISTICS_CHECK_MS) return;
	statisticsCheckedAt = Date.now();
	peekComprehensiveStats().catch((error: unknown) => {
		console.error("Health check: the statistics could not be read", error);
	});
}

export async function GET() {
	await headers();
	try {
		keepStatisticsCounted(await loadLibraryConfig());
	} catch {
		// Health exposes revision state only. Detailed validation errors remain
		// available to development callers and the validation command.
	}

	const health = getLibraryConfigHealth();
	return Response.json(health, {
		headers: {
			"Cache-Control": "no-store",
		},
		status: health.active ? 200 : 503,
	});
}
