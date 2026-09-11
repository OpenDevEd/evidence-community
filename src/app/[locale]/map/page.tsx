import Map from "@/components/pages/Map";
import { getLibraryConfig } from "@/config/library-config/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";

export default async function MapPage() {
	await connection();
	const config = await getLibraryConfig();
	if (!config.features.countryFocus) notFound();
	return <Map />;
}
