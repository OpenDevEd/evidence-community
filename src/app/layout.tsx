import { ReactNode } from "react";
import "@/styles/globals.css";
import { Metadata, Viewport } from "next";
import { getCachedStatus } from "./api/cache";
import { parseCompanyName } from "@/lib/utils";

export const viewport: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "white" },
		{ media: "(prefers-color-scheme: dark)", color: "#1e1e1e" }
	]
}

export async function generateMetadata(): Promise<Metadata> {
	const status = await getCachedStatus();

	const { companyName, siteName } = parseCompanyName(status.companyName);

	return {
		title: `${companyName} - ${siteName}`,
		description: `${companyName} - ${siteName}`
	};
}

export default function RootLayout({ children }: { children: ReactNode }) {
	return children;
}
