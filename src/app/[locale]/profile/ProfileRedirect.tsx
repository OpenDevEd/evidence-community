"use client";

import { redirect } from "@/i18n/routing";
import { useSession } from "next-auth/react";
import { notFound } from "next/navigation";

export default function ProfileRedirect({ locale }: { locale: string }) {
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
