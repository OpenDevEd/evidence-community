"use client";

import { redirect } from "@/i18n/routing";
import { getProfile } from "@/lib/actions";
import { useSession } from "next-auth/react";
import { notFound } from "next/navigation";

export default function ProfilePage({ params: { locale } }: { params: { locale: string } }) {
	const { data: session, status } = useSession();

	console.log(session);

	if (status === "loading") {
		return <div>Loading...</div>;
	}

	if (!session) {
		return notFound();
	}

	return redirect({
		href: "/profile/" + session.user.id,
		locale,
	});
}
