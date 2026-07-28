import { ReactNode, Suspense } from "react";
import "@/styles/globals.css";
import { Metadata, Viewport } from "next";
import { connection } from "next/server";
import Script from "next/script";

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
			<Script id="ga-consent-default" strategy="beforeInteractive">
				{`
					window.dataLayer = window.dataLayer || [];
					window.gtag =
						window.gtag ||
						function gtag(){window.dataLayer.push(arguments);}
					window.gtag('consent', 'default', {
						analytics_storage: 'denied',
						ad_storage: 'denied',
						ad_user_data: 'denied',
						ad_personalization: 'denied',
						wait_for_update: 500
					});
				`}
			</Script>
			{children}
			{/* Next.js requires a Suspense-contained dynamic marker when
			    request-time metadata is used with Cache Components. */}
			<Suspense fallback={null}>
				<RuntimeMetadataMarker />
			</Suspense>
		</>
	);
}
