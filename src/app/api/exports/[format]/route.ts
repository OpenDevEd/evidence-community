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
	streamCitationRecords,
	readLibraryCitationData,
} from "@/lib/library-exports";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { connection } from "next/server";
import { getRuntimeRequestLocale } from "@/i18n/server";
import {
	resolveCitationDownload,
	citationDownloadResponse,
} from "@/lib/citation-download";
import { libraryExportRequestSchema, LibraryExportError, type LibraryExportRequest } from "@/lib/library-export-request";
import { prepareLibraryExport } from "@/lib/library-export-selection";

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

function validateExportParameters(request: Request, format: string) {
	const query = new URL(request.url).searchParams;
	const allowed = format === "citation" ? ["style", "format"] : [];
	if (format !== "atom" && [...query.keys()].some(key => !allowed.includes(key) || query.getAll(key).length !== 1)) {
		throw new LibraryExportError("exportInvalid", "Unsupported or repeated export parameter.", 400);
	}
}

async function formattedExportResponse(request: Request, config: LibraryServerConfig, selection: LibraryExportRequest) {
	if (!config.features.downloads || !config.citations.enabled)
		return notFound();
	const citation = await resolveCitationDownload(request);
	if (!citation) return notFound();
	const prepared = await prepareLibraryExport(config, selection, request);
	const records = await readLibraryCitationData(prepared.readPage);
	request.signal.throwIfAborted();
	const response = citationDownloadResponse(records, citation, {
		locale: await getRuntimeRequestLocale(request),
		numbered: true,
		fileName: config.identity.shortName,
		libraryBaseUrl: config.citations.showUrl
			? config.identity.baseUrl
			: undefined,
	});
	response.headers.set("Cache-Control", "private, no-store");
	response.headers.set("X-Export-Count", String(prepared.count));
	response.headers.set("X-Export-Scope", selection.scope);
	return response;
}

async function exportResponse(
	request: Request,
	{ params }: { params: Promise<{ format: string }> },
	selection: LibraryExportRequest,
) {
	// Every export reads live records, so nothing here may be prerendered.
	await connection();
	const { format } = await params;
	const config = await getLibraryConfig();
	validateExportParameters(request, format);
	if (format === "citation") return formattedExportResponse(request, config, selection);
	if (!isLibraryExportFormat(format)) return notFound();
	if (!isFormatAvailable(config, format)) return notFound();

	const headers = new Headers({
		"Cache-Control": "no-store",
		"Content-Type": getLibraryExportContentType(format),
		"X-Content-Type-Options": "nosniff",
	});

	if (format === "atom") {
		if (request.method === "POST") throw new LibraryExportError("exportInvalid", "Atom is a whole-library feed.", 400);
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

	const prepared = await prepareLibraryExport(config, selection, request);
	headers.set("Cache-Control", "private, no-store");
	headers.set("X-Export-Count", String(prepared.count));
	headers.set("X-Export-Scope", selection.scope);
	return new Response(streamCitationRecords(prepared.readPage, format), { headers });
}

async function serveExport(request: Request, context: { params: Promise<{ format: string }> }) {
	try {
		const parsed = libraryExportRequestSchema.safeParse(request.method === "POST" ? await request.json().catch(() => null) : { scope: "library" });
		if (!parsed.success) throw new LibraryExportError("exportInvalid", "Choose a valid community or results export.", 400);
		return await exportResponse(request, context, parsed.data);
	} catch (error) {
		if (error instanceof LibraryExportError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
		if (request.signal.aborted) return new Response(null, { status: 499 });
		console.error("Community export failed", { path: new URL(request.url).pathname, error });
		return Response.json({ error: "Unable to export these records." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
	}
}

export const GET = serveExport;
export const POST = serveExport;
