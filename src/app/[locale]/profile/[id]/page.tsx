import ReaderProfile from "@/components/pages/ReaderProfile";
import { Metadata } from "next";
import { libraryMetadata } from "../../lib/page";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDatabaseForConfig } from "@/db";
import { PROFILE_COLLECTIONS_PER_PAGE } from "@/lib/readers/collection-pages";
import { readReaderProfile } from "@/lib/readers/data";
import { getSignedInReader } from "@/lib/readers/session";
import { getConfigForEnabledFeature } from "@/lib/runtime-feature";

export async function generateMetadata(props: {
	params: Promise<{ id: string; locale: string }>;
	searchParams: Promise<URLSearchParams>;
}): Promise<Metadata> {
	const params = await props.params;
	return libraryMetadata({ ...props, pathname: "/profile/" + params.id });
}

// Waits for the reader's profile instead of showing a loading state, so the click lands on the finished page.
// Next.js reads this route export. Fallow does not recognize it yet.
// fallow-ignore-next-line unused-export
export const instant = false;

export default async function ProfilePage(props: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
	await connection();
	const config = await getConfigForEnabledFeature("readerAccounts");
	if (!config) notFound();

	const [{ id }, viewer, query] = await Promise.all([props.params, getSignedInReader(undefined, config), props.searchParams]);
	// The column opens on the page the chosen collection is on, so one opened from a link is in view.
	const chosenId = typeof query.collectionId === "string" ? query.collectionId : null;
	const profile = await readReaderProfile(await getDatabaseForConfig(config), id, viewer?.id ?? null, { chosenId, pageSize: PROFILE_COLLECTIONS_PER_PAGE });
	if (!profile) notFound();

	return <ReaderProfile data={profile} />;
}
