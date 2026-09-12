import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getCachedItemSmall } from "../cache";
import { formatItemAsMODS } from "@/lib/formatAsMODS";
import { create } from "xmlbuilder2";
import { Item } from "../item/types";

// unAPI service discovery
export async function GET(request: NextRequest) {
	const { searchParams } = new URL(request.url);
	const id = searchParams.get("id");
	const format = searchParams.get("format");

	// No id: return service formats
    if (!id) {
        const doc = create({ version: "1.0", encoding: "UTF-8" });
        const root = doc.ele("formats");
        root.ele("format", { name: "mods", type: "application/mods+xml", docs: "https://www.loc.gov/standards/mods/" });
        const xml = doc.end({ prettyPrint: true });
        return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
    }

	// id but no format: return formats for this id
    if (id && !format) {
        const doc = create({ version: "1.0", encoding: "UTF-8" });
        const root = doc.ele("formats", { id });
        root.ele("format", { name: "mods", type: "application/mods+xml", docs: "https://www.loc.gov/standards/mods/" });
        const xml = doc.end({ prettyPrint: true });
        return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
    }

	// id and format: return representation
	if (id && format) {
		if (format.toLowerCase() !== "mods") {
			return NextResponse.json({ message: "Format not supported" }, { status: 406 });
		}

		const result = await getCachedItemSmall(id);
		if (!result || !result.item) {
			return NextResponse.json({ message: "Item not found" }, { status: 404 });
		}

		const xml = formatItemAsMODS(result.item as Item);
		return new Response(xml, {
			headers: {
				"Content-Type": "application/mods+xml; charset=utf-8",
				"Content-Disposition": `inline; filename=\"${id}.mods.xml\"`,
			},
		});
	}

	return NextResponse.json({ message: "Bad request" }, { status: 400 });
}




