import { ReactNode } from "react";
import "@/styles/globals.css";
import { Metadata, Viewport } from "next";
import { connection } from "next/server";

import { buildLibraryMetadata } from "@/config/library-config/identity";
import { getLibraryConfig } from "@/config/library-config/server";

export const viewport: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "white" },
		{ media: "(prefers-color-scheme: dark)", color: "#1e1e1e" }
	]
}

export async function generateMetadata(): Promise<Metadata> {
	await connection();
	const config = await getLibraryConfig();
	return buildLibraryMetadata(config.identity);
}

export default function RootLayout({ children }: { children: ReactNode }) {
	return children;
}
