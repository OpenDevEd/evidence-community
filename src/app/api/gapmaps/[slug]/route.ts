import {
	findEnabledGapMap,
	isApprovedGapMapContentType,
} from "@/config/library-config/gap-maps";
import { getLibraryConfig } from "@/config/library-config/server";

function notFound() {
	return Response.json(
		{ error: "GAP_MAP_NOT_FOUND" },
		{
			status: 404,
			headers: { "Cache-Control": "no-store" },
		},
	);
}

function sourceError(
	error:
		| "GAP_MAP_SOURCE_UNAVAILABLE"
		| "GAP_MAP_SOURCE_CONTENT_TYPE_INVALID",
) {
	return Response.json(
		{ error },
		{
			status: 502,
			headers: { "Cache-Control": "no-store" },
		},
	);
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ slug: string }> },
) {
	const { slug } = await params;
	const config = await getLibraryConfig();
	const gapMap = findEnabledGapMap(config.gapMaps, slug);

	if (!gapMap) return notFound();

	let upstream: Response;
	try {
		upstream = await fetch(gapMap.sourceUrl, {
			cache: "no-store",
			redirect: "follow",
			signal: request.signal,
		});
	} catch {
		return sourceError("GAP_MAP_SOURCE_UNAVAILABLE");
	}

	if (!upstream.ok || !upstream.body) {
		return sourceError("GAP_MAP_SOURCE_UNAVAILABLE");
	}

	const contentType = upstream.headers.get("content-type");
	if (!isApprovedGapMapContentType(contentType)) {
		await upstream.body.cancel().catch(() => undefined);
		return sourceError(
			"GAP_MAP_SOURCE_CONTENT_TYPE_INVALID",
		);
	}

	return new Response(upstream.body, {
		headers: {
			"Cache-Control": "no-store",
			"Content-Type": contentType!,
			"X-Content-Type-Options": "nosniff",
		},
	});
}
