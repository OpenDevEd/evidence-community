import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { getAuthenticatedDbUser } from "@/auth/server";
import { getProfile } from "@/lib/actions";
import type { AppSession } from "@/auth/types";

const NO_STORE_HEADERS = {
	"Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
	Pragma: "no-cache",
	Expires: "0",
};

export async function GET() {
	noStore();

	const dbUser = await getAuthenticatedDbUser();
	if (!dbUser) {
		return NextResponse.json(null, {
			status: 200,
			headers: NO_STORE_HEADERS,
		});
	}

	const userProfile = await getProfile(dbUser.id, null);
	if (!userProfile) {
		return NextResponse.json(null, {
			status: 200,
			headers: NO_STORE_HEADERS,
		});
	}

	const session: AppSession = {
		user: userProfile,
	};

	return NextResponse.json(session, {
		status: 200,
		headers: NO_STORE_HEADERS,
	});
}
