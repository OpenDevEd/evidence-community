import { getLibraryConfig } from "@/config/library-config/server";
import {
	getLibraryExportContentType,
	getLibraryExportExtension,
	isLibraryExportFormat,
	type LibraryExportFormat,
} from "@/config/library-config/exports";
import {
	buildAtomFeed,
	buildLibraryExportFilename,
	readAtomFeedRecords,
	streamLibraryCitations,
} from "@/lib/library-exports";
import type { LibraryServerConfig } from "@/config/library-config/schema";

export const dynamic = "force-dynamic";

function notFound() {
	return Response.json(
		{ error: "LIBRARY_EXPORT_NOT_AVAILABLE" },
		{
			status: 404,
			headers: { "Cache-Control": "no-store" },
		},
	);
}

function isFormatAvailable(
	config: LibraryServerConfig,
	format: LibraryExportFormat,
) {
	if (format === "atom") {
		return config.features.atomFeed && config.exports.atom;
	}

	return config.features.downloads && config.exports[format];
}

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ format: string }> },
) {
	const { format } = await params;
	if (!isLibraryExportFormat(format)) return notFound();

	const config = await getLibraryConfig();
	if (!isFormatAvailable(config, format)) return notFound();

	const headers = new Headers({
		"Cache-Control": "no-store",
		"Content-Type": getLibraryExportContentType(format),
		"X-Content-Type-Options": "nosniff",
	});

	if (format === "atom") {
		const records = await readAtomFeedRecords(config);
		return new Response(buildAtomFeed(config, records), { headers });
	}

	const filename = buildLibraryExportFilename(
		config.identity.shortName,
		getLibraryExportExtension(format),
	);
	headers.set(
		"Content-Disposition",
		`attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
	);

	return new Response(await streamLibraryCitations(config, format), {
		headers,
	});
}
