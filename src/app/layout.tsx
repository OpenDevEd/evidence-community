import { ReactNode } from "react";
import "@/styles/globals.css";
import { Metadata, Viewport } from "next";
import { parseCompanyName } from "@/lib/utils";

const { companyName, siteName } = parseCompanyName(process.env.NEXT_PUBLIC_COMPANY_NAME);

export const viewport: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "white" },
		{ media: "(prefers-color-scheme: dark)", color: "#1e1e1e" }
	]
}

export const metadata: Metadata = {
	title: `${companyName} - ${siteName}`,
	description: `${companyName} - ${siteName}`
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return children;
}
