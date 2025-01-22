import Profile from "@/components/pages/Profile";
import { getProfile } from "@/lib/actions";
import { getLikedPosts } from "@/lib/actions";
import { Metadata } from "next";
import { ResolvingMetadata } from "next/dist/lib/metadata/types/metadata-interface";
import { libraryMetadata } from "../../lib/page";

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
	searchParams: Promise<{ [key: string]: any }>;
}) {
	const searchParams = await props.searchParams;
	const params = await props.params;
	const profile = await getProfile(params.id, null);
	const likedPosts = await getLikedPosts(profile.likes);

	return (
		<Profile
			data={profile}
			likedPosts={likedPosts}
			searchParams={searchParams}
		/>
	);
}
