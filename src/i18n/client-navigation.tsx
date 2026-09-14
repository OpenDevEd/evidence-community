"use client";

import type { ComponentProps } from "react";
import { createNavigation } from "next-intl/navigation";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { routing } from "./routing-config";

// Keep next-intl's components stable across renders while supporting every
// runtime default locale with the same built application.
const navigationByLocale = new Map(routing.locales.map((defaultLocale) => [
	defaultLocale,
	createNavigation({ ...routing, defaultLocale, localePrefix: "as-needed" }),
]));

function useRuntimeNavigation() {
	const { localization } = useLibraryConfig();
	return navigationByLocale.get(localization.defaultLocale)!;
}

export function Link(props: ComponentProps<ReturnType<typeof useRuntimeNavigation>["Link"]>) {
	const RuntimeLink = useRuntimeNavigation().Link;
	return <RuntimeLink {...props} />;
}

export function useRouter() {
	const navigation = useRuntimeNavigation();
	return navigation.useRouter();
}
