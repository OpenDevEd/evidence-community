import NotFound from "@/components/layout/NotFound";
import BaseLayout from "@/components/layout/Base";
import { getLibraryConfig } from "@/config/library-config/server";
import { connection } from "next/server";

export default async function NotFoundPage() {
	await connection();
	const { localization } = await getLibraryConfig();

	return (
		<BaseLayout locale={localization.defaultLocale}>
			<NotFound />
		</BaseLayout>
	);
}
