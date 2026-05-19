import NotFound from "@/components/layout/NotFound";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "404 - Not Found",
	description: "404 - Not Found",
	robots: {
		index: false,
		follow: false,
	},
};

export default function NotFoundRoutePage() {
	return <NotFound />;
}
