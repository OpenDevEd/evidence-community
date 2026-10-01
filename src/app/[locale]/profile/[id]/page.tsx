import ReaderProfile from "@/components/pages/ReaderProfile";
import { Metadata } from "next";
import { libraryMetadata } from "../../lib/page";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getProfileForConfig } from "@/lib/auth-service";
import { getConfigForEnabledFeature } from "@/lib/runtime-feature";

export async function generateMetadata(props: {
	params: Promise<{ id: string; locale: string }>;
	searchParams: Promise<URLSearchParams>;
}): Promise<Metadata> {
	const params = await props.params;
	const pathname = "/profile/" + params.id;

	return libraryMetadata({
		...props,
		pathname: pathname,
	});
}

export default async function ProfilePage(props: {
	params: Promise<{ id: string }>;
}) {
	await connection();
	const config = await getConfigForEnabledFeature("login");
	if (!config) notFound();

	const params = await props.params;
	const profile = await getProfileForConfig(
		params.id,
		null,
		config,
	);

	return <ReaderProfile data={profile} />;
}
