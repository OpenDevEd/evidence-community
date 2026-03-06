import Profile from "@/components/pages/Profile";
import { getProfile } from "@/lib/actions";
import { Metadata } from "next";
import { ResolvingMetadata } from "next/dist/lib/metadata/types/metadata-interface";
import { libraryMetadata } from "../../lib/page";
import { notFound } from "next/navigation";

export async function generateMetadata(
	props: {
		params: Promise<{ id: string; locale: string }>;
		searchParams: Promise<URLSearchParams>;
	},
	parent: ResolvingMetadata
): Promise<Metadata> {
	const params = await props.params;
	const pathname = "/profile/" + params.id;   

	return libraryMetadata(
		{
			...props,
			pathname: pathname,
		},
		parent
	);
}

export default async function ProfilePage(props: {
	params: Promise<{ id: string }>;
}) {
	const params = await props.params;
	const profile = await getProfile(params.id, null);

	if (!profile) {
		notFound();
	}
	
	return (
		<Profile
			data={profile}
		/>
	);
}
