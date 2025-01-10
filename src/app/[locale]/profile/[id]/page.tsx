import Profile from "@/components/pages/Profile";
import { getProfile } from "@/lib/actions";
import { getLikedPosts } from "@/lib/actions";

export default async function ProfilePage(
    props: {
        params: Promise<{ id: string }>;
        searchParams: Promise<{ [key: string]: any }>;
    }
) {
    const searchParams = await props.searchParams;
    const params = await props.params;
    const profile = await getProfile(params.id, null);
    const likedPosts = await getLikedPosts(profile.likes);

    return <Profile data={profile} likedPosts={likedPosts} searchParams={searchParams} />;
}
