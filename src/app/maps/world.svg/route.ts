import { getWorldMap } from "@/components/pages/home-map-shapes";

/** The world's outlines for the home page's maps. Next compresses the response, so it goes out as plain SVG. */
export async function GET() {
	return new Response((await getWorldMap()).svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
}
