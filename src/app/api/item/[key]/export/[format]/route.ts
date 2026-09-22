import {
	resolveCitationDownload,
	citationDownloadResponse,
} from "@/lib/citation-download";
import { getRuntimeRequestLocale } from "@/i18n/server";
import { itemToCitationData } from "@/lib/citation-data";
import { NextRequest, NextResponse } from "next/server";
import { getCachedItemSmall } from "../../../../cache";
import { convertItem } from "@/lib/actions";
import { getLibraryConfig } from "@/config/library-config/server";
import {
	getLibraryExportContentType,
	getLibraryExportExtension,
	isBibliographicExportFormat,
} from "@/config/library-config/exports";

export async function GET(
	request: NextRequest,
	props: { params: Promise<{ key: string; format: string }> },
) {
	const params = await props.params;
	const { key, format } = params;
	if (format !== "citation" && !isBibliographicExportFormat(format)) {
		return NextResponse.json(
			{ message: "Export format not found" },
			{ status: 404 },
		);
	}

	const config = await getLibraryConfig();
	// Downloads must be on and this format must be switched on. The same pair
	// decides what the download dialog offers.
	if (
		!config.features.downloads ||
		(format === "citation"
			? !config.citations.enabled
			: !config.exports[format])
	) {
		return NextResponse.json(
			{ message: "Export format not available" },
			{ status: 404 },
		);
	}

	const result = await getCachedItemSmall(key);

	if (!result || !result.item) {
		return NextResponse.json(
			{
				message: "Item not found",
			},
			{
				status: 404,
			},
		);
	}

	if (format === "citation") {
		const selection = await resolveCitationDownload(request);
		const data = itemToCitationData(result.item);
		if (!selection || !data)
			return NextResponse.json(
				{ message: "Citation not available" },
				{ status: 404 },
			);
		return citationDownloadResponse([data], selection, {
			locale: await getRuntimeRequestLocale(request),
			numbered: false,
			fileName: key,
			libraryBaseUrl: config.citations.showUrl
				? config.identity.baseUrl
				: undefined,
		});
	}
	const converted = await convertItem(result.item, format);

	return new Response(converted, {
		headers: {
			"Content-Type": getLibraryExportContentType(format),
			"Content-Disposition": `attachment; filename="${key}.${getLibraryExportExtension(format)}"`,
		},
	});
}
