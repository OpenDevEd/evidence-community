import { getRuntimePageAvailability } from "@/config/library-config/pages";
import Map from "@/components/pages/Map";
import { getLibraryConfig } from "@/config/library-config/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { preload } from "react-dom";

// Waits for the library settings instead of showing a loading state, so the click lands on the finished page.
// Next.js reads this route export. Fallow does not recognize it yet.
// fallow-ignore-next-line unused-export
export const instant = false;

export default async function MapPage() {
	await connection();
	const config = await getLibraryConfig();
	if (!getRuntimePageAvailability(config)["/map"]) notFound();
	// The outlines start downloading with the page, not after the map hydrates and asks for them.
	preload("/features.json", { as: "fetch", crossOrigin: "anonymous" });
	return <Map />;
}
