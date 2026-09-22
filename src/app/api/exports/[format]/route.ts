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
	readLibraryCitationData,
} from "@/lib/library-exports";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { connection, NextRequest } from "next/server";
import { getRuntimeRequestLocale } from "@/i18n/server";
import {
	resolveCitationDownload,
	citationDownloadResponse,
} from "@/lib/citation-download";

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
	request: Request,
	{ params }: { params: Promise<{ format: string }> },
) {
	// Every export reads live records, so nothing here may be prerendered.
	await connection();

	const { format } = await params;
	const config = await getLibraryConfig();
	if (format === "citation") {
		if (!config.features.downloads || !config.citations.enabled)
			return notFound();
		const selection = await resolveCitationDownload(request);
		if (!selection) return notFound();
		const records = await readLibraryCitationData(config);
		return citationDownloadResponse(records, selection, {
			locale: await getRuntimeRequestLocale(new NextRequest(request)),
			numbered: true,
			fileName: config.identity.shortName,
			libraryBaseUrl: config.citations.showUrl
				? config.identity.baseUrl
				: undefined,
		});
	}
	if (!isLibraryExportFormat(format)) return notFound();
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

	return new Response(streamLibraryCitations(config, format), { headers });
}
