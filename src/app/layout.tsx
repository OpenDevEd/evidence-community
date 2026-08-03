import { ReactNode, Suspense } from "react";
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

async function RuntimeMetadataMarker() {
	await connection();
	return null;
}

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<>
			{children}
			{/* Next.js requires a Suspense-contained dynamic marker when
			    request-time metadata is used with Cache Components. */}
			<Suspense fallback={null}>
				<RuntimeMetadataMarker />
			</Suspense>
		</>
	);
}
