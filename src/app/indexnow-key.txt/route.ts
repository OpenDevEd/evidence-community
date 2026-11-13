import { connection } from "next/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { indexNowKey } from "@/lib/indexnow";

/** The community's IndexNow key, which a search engine reads to check a list of changed pages came from here. */
export async function GET() {
	await connection();
	const libraryConfig = await getLibraryConfig();
	if (!libraryConfig.generation.indexNow) return new Response("Not Found", { status: 404 });
	return new Response(indexNowKey(libraryConfig), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
