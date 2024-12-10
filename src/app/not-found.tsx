"use client";

import { routing } from "@/i18n/routing";
import { redirect } from "@/i18n/routing";

export default function NotFoundPage() {
	if (typeof window !== "undefined") {
		const pathName = window?.location?.pathname || "/";

		redirect({
			href: pathName,
			locale: routing.defaultLocale,
		});
	}

	return null;
}
