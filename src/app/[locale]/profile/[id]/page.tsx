import ReaderProfile from "@/components/pages/ReaderProfile";
import { Metadata } from "next";
import { libraryMetadata } from "../../lib/page";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDatabaseForConfig } from "@/db";
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

export default async function ProfilePage(props: { params: Promise<{ id: string }> }) {
	await connection();
	const config = await getConfigForEnabledFeature("readerAccounts");
	if (!config) notFound();

	const [{ id }, viewer] = await Promise.all([props.params, getSignedInReader(undefined, config)]);
	const profile = await readReaderProfile(await getDatabaseForConfig(config), id, viewer?.id ?? null);
	if (!profile) notFound();

	return <ReaderProfile data={profile} />;
}
