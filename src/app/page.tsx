import Base from "@/components/layout/Base";
import { redirect, routing } from "@/i18n/routing";

export default function RootPage() {
	redirect({
		href: "/lib",
		locale: routing.defaultLocale,
	});
}
