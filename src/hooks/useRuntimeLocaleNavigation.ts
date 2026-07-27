"use client";

import { useCallback } from "react";

import {
	buildExplicitLocalizedPathname,
	RUNTIME_LOCALE_COOKIE,
	type PlatformLocale,
} from "@/i18n/runtime";
import { usePathname } from "@/i18n/routing";

export function useRuntimeLocaleNavigation() {
	const pathname = usePathname();

	return useCallback(
		(locale: PlatformLocale) => {
			document.cookie = [
				`${RUNTIME_LOCALE_COOKIE.name}=${encodeURIComponent(locale)}`,
				"Path=/",
				`SameSite=${RUNTIME_LOCALE_COOKIE.sameSite}`,
			].join("; ");
			const localizedPathname = buildExplicitLocalizedPathname(
				pathname,
				locale,
			);
			window.location.assign(
				`${localizedPathname}${window.location.search}${window.location.hash}`,
			);
		},
		[pathname],
	);
}
