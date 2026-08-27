export function sanitizeAnalyticsPath(path: string | undefined | null) {
	if (!path) return "/";

	try {
		const url = new URL(path, "https://analytics.local");
		return url.pathname || "/";
	} catch {
		return path.split("?")[0]?.split("#")[0] || "/";
	}
}
