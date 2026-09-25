export async function register() {
	// The build has no library config and serves no pages, so it clears nothing.
	if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
	const { consumeCacheInvalidations } = await import("@/lib/cache-clearing");
	void consumeCacheInvalidations();
}
