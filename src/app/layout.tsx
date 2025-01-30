import { ReactNode } from "react";
import "@/styles/globals.css";
import { Metadata, Viewport } from "next";
import { getCachedStatus } from "./api/cache";

export const viewport: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "white" },
		{ media: "(prefers-color-scheme: dark)", color: "#1e1e1e" } 
	]
}

export async function generateMetadata(): Promise<Metadata> {
	const status = await getCachedStatus();

	const companyName = status.companyName;

	return {
		title: `${companyName} - Evidence Library`,
		description: `${companyName} - Evidence Library`,
		viewport: {
			userScalable: false
		}
	};
}

export default function RootLayout({ children }: { children: ReactNode }) {
	return children;
}
