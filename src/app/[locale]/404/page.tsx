import { getTranslations } from "next-intl/server";
import RuntimeMetadata from "@/components/layout/RuntimeMetadata";
import NotFound from "@/components/layout/NotFound";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("ui");
	return { title: t("notFoundTitle"), description: t("notFoundTitle"), robots: { index: false, follow: false } };
}

export default function NotFoundRoutePage() {
	return (
		<>
			<NotFound />
			<RuntimeMetadata />
		</>
	);
}
