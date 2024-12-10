import Base from "@/components/layout/Base";
import { redirect } from "@/i18n/routing";

export default function RootPage() {
	redirect({
		href: "/lib",
		locale: "en",
	});
}
