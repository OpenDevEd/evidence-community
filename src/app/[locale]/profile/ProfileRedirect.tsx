"use client";

import { redirect } from "@/i18n/routing";
import { useSession } from "next-auth/react";
import { Spinner } from "@nextui-org/react";
import { notFound } from "next/navigation";

export default function ProfileRedirect({ locale }: { locale: string }) {
	const { data: session, status } = useSession();

	if (status === "loading") {
		return <div className="flex min-h-[60vh] items-center justify-center"><Spinner aria-label="Loading profile" /></div>;
	}

	if (!session) {
		return notFound();
	}

	return redirect({
		href: "/profile/" + session.user.id,
		locale,
	});
}
