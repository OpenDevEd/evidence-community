"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useSession } from "@/auth/client";
import type { AppSession } from "@/auth/types";

const PENDING_NAVBAR_SESSION = {
	user: {} as AppSession["user"],
} as AppSession;

function createSessionStub(user: ReturnType<typeof useUser>["user"]): AppSession {
	return {
		user: {
			id: user?.id ?? "",
			name: user?.fullName ?? null,
			email: user?.primaryEmailAddress?.emailAddress ?? null,
			image: user?.imageUrl ?? null,
			likes: {},
			following: {},
			followers: {},
			collections: [],
			itemsCollections: {},
		},
	};
}

export function useNavbarAuthState() {
	const { data: session, status } = useSession();
	const { isLoaded, isSignedIn } = useAuth();
	const { user } = useUser();

	const hasResolvedIdentity = Boolean(user || session?.user);
	const isAuthPending = !isLoaded || (isSignedIn && status === "loading");
	const signedInSession =
		status === "authenticated"
			? session
			: isSignedIn && user
				? createSessionStub(user)
				: null;

	return {
		hasResolvedIdentity,
		isAuthPending,
		isLoaded,
		isSignedIn,
		navbarSession: isAuthPending ? PENDING_NAVBAR_SESSION : signedInSession,
		profileHref: session?.user?.id ? `/profile/${session.user.id}` : "/profile",
		session,
		user,
	};
}
