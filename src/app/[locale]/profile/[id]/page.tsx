import Profile from "@/components/pages/Profile";
import { getProfile } from "@/lib/actions";
import { getLikedPosts } from "@/lib/actions";
import { Session } from "next-auth";

export default async function ProfilePage({
	params,
}: {
	params: { id: string };
}) {
	const profile = await getProfile(params.id, null);
	const likedPosts = await getLikedPosts(profile.likes);

	return <Profile data={profile} likedPosts={likedPosts} />;
}
