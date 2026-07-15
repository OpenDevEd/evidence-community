import Profile from "@/components/pages/Profile";
import { getProfile } from "@/lib/actions";
import { getLikedPosts } from "@/lib/actions";
import { Metadata } from "next";
import { libraryMetadata } from "../../lib/page";

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
	const params = await props.params;
	const profile = await getProfile(params.id, null);
	
	return (
		<Profile
			data={profile}
		/>
	);
}
