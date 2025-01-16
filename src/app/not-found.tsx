import { routing } from "@/i18n/routing";
import { redirect } from "@/i18n/routing";
import NotFound from "@/components/layout/NotFound";
import BaseLayout from "@/components/layout/Base";

export default function NotFoundPage() {
	return <BaseLayout locale={routing.defaultLocale}>
		<NotFound />
	</BaseLayout>
}
