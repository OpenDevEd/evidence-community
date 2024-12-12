"use client";

import { NextUIProvider } from "@nextui-org/react";
import { ThemeProvider } from "next-themes";
import { useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/routing";
import posthog from "posthog-js";
import { PostHogProvider, usePostHog } from "posthog-js/react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/routing";
import { createContext } from "react";

export const CacheContext = createContext<any>({});

function PageView() {
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const posthog = usePostHog();

	useEffect(() => {
		if (pathname && posthog) {
			let url = window.origin + pathname;
			if (searchParams.toString()) {
				url = url + `?${searchParams.toString()}`;
			}
			posthog.capture("$pageview", {
				$current_url: url,
			});
		}
	}, [pathname, searchParams, posthog]);

	return null;
}

function CacheProvider({ children }: { children: React.ReactNode }) {
	const [cache, setCache] = useState({});
	const itemsCache = useRef(undefined);

	return (
		<CacheContext.Provider value={{ cache, setCache, itemsCache }}>
			{children}
		</CacheContext.Provider>
	);
}

export default function Providers({ children }: { children: React.ReactNode }) {
	const router = useRouter();

	useEffect(() => {
		posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
			person_profiles: "always",
			capture_pageview: false,
			capture_pageleave: true,
			api_host: "/ingest",
			ui_host: "https://us.posthog.com",
		});
	}, []);

	return (
		<ThemeProvider
			attribute={"class"}
			defaultTheme="dark"
			disableTransitionOnChange
		>
			<PostHogProvider client={posthog}>
				<CacheProvider>
					<NextUIProvider navigate={router.push}>
						<Suspense>
							<PageView />
						</Suspense>
						{children}
					</NextUIProvider>
				</CacheProvider>
			</PostHogProvider>
		</ThemeProvider>
	);
}
