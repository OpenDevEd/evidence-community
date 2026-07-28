import { getLibraryConfig } from "@/config/library-config/server";
import {
	getLibraryExportExtension,
	getLibraryExportSourceUrl,
	isApprovedLibraryExportContentType,
	isLibraryExportFormat,
} from "@/config/library-config/exports";

function exportFilename(shortName: string, extension: string) {
	const basename =
		shortName
			.normalize("NFKD")
			.replace(/[^\p{Letter}\p{Number}]+/gu, "-")
			.replace(/^-+|-+$/gu, "")
			.toLowerCase() || "evidence-library";

	return `${basename}.${extension}`;
}

function notFound() {
	return Response.json(
		{ error: "LIBRARY_EXPORT_NOT_AVAILABLE" },
		{
			status: 404,
			headers: { "Cache-Control": "no-store" },
		},
	);
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ format: string }> },
) {
	const { format } = await params;
	if (!isLibraryExportFormat(format)) return notFound();

	const config = await getLibraryConfig();
	const featureEnabled =
		format === "atom"
			? config.features.atomFeed
			: config.features.downloads;
	const sourceUrl = getLibraryExportSourceUrl(config.exports, format);

	if (!featureEnabled || !sourceUrl) return notFound();

	let upstream: Response;
	try {
		upstream = await fetch(sourceUrl, {
			cache: "no-store",
			redirect: "follow",
			signal: request.signal,
		});
	} catch {
		return Response.json(
			{ error: "LIBRARY_EXPORT_SOURCE_UNAVAILABLE" },
			{
				status: 502,
				headers: { "Cache-Control": "no-store" },
			},
		);
	}

	if (!upstream.ok || !upstream.body) {
		return Response.json(
			{ error: "LIBRARY_EXPORT_SOURCE_UNAVAILABLE" },
			{
				status: 502,
				headers: { "Cache-Control": "no-store" },
			},
		);
	}

	const contentType = upstream.headers.get("content-type");
	if (!isApprovedLibraryExportContentType(format, contentType)) {
		await upstream.body.cancel().catch(() => undefined);
		return Response.json(
			{ error: "LIBRARY_EXPORT_SOURCE_CONTENT_TYPE_INVALID" },
			{
				status: 502,
				headers: { "Cache-Control": "no-store" },
			},
		);
	}

	const filename = exportFilename(
		config.identity.shortName,
		getLibraryExportExtension(format),
	);
	const headers = new Headers({
		"Cache-Control": "no-store",
		"Content-Type": contentType!,
		"X-Content-Type-Options": "nosniff",
	});
	if (format !== "atom") {
		headers.set(
			"Content-Disposition",
			`attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
		);
	}
	return new Response(upstream.body, { headers });
}
