"use client";

import { use } from "react";
import { redirect } from "@/i18n/routing";
import { useSession } from "next-auth/react";
import { notFound } from "next/navigation";

export default function ProfilePage(props: {
	params: Promise<{ locale: string }>;
}) {
	const params = use(props.params);

	const { locale } = params;

	const { data: session, status } = useSession();

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
