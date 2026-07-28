import type { LibraryServerConfig } from "@/config/library-config/schema";
import { RevisionAwarePostHogFactory } from "./posthog-factory";

const globalPostHog = globalThis as typeof globalThis & {
	__evidenceLibraryPostHogFactory?: RevisionAwarePostHogFactory;
};

const posthogFactory =
	globalPostHog.__evidenceLibraryPostHogFactory ??
	new RevisionAwarePostHogFactory();

globalPostHog.__evidenceLibraryPostHogFactory = posthogFactory;

export function getPostHogForConfig(
	config: Pick<
		LibraryServerConfig,
		"analytics" | "revision" | "updatedAt"
	>,
) {
	return posthogFactory.get({
		configuration: config.analytics.posthog,
		revision: config.revision,
		updatedAt: config.updatedAt,
	});
}
