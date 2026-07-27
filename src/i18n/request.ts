import { getRequestConfig } from "next-intl/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { isPlatformLocale } from "./runtime";
import { PLATFORM_DEFAULT_LOCALE } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
	const requestedLocale = await requestLocale;
	const locale =
		requestedLocale && isPlatformLocale(requestedLocale)
			? requestedLocale
			: process.env.NODE_ENV === "production" &&
				  !process.env.LIBRARY_CONFIG_PATH?.trim()
				? PLATFORM_DEFAULT_LOCALE
				: (await getLibraryConfig()).localization.defaultLocale;

	return {
		locale,
		messages: (await import(`@/messages/${locale}.json`)).default,
	};
});
