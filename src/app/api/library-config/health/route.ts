import {
	getLibraryConfigHealth,
	loadLibraryConfig,
} from "@/config/library-config/source";

export async function GET() {
	try {
		await loadLibraryConfig();
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
