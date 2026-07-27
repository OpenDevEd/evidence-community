import "server-only";

import { getLibraryConfig } from "@/config/library-config/server";
import { resolveRuntimeRequestLocale } from "@/i18n/runtime";

export async function getRuntimeRequestLocale(request: Request) {
	const { localization } = await getLibraryConfig();
	return resolveRuntimeRequestLocale(
		request.headers.get("Accept-Language"),
		localization,
	);
}
