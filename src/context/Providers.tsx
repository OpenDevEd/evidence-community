"use client";

import { NextUIProvider } from "@nextui-org/react";
import { ThemeProvider } from "next-themes";
import { useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/routing";
import posthog from "posthog-js";
import { PostHogProvider, usePostHog } from "posthog-js/react";
import { Suspense, useEffect } from "react";
import { useRouter } from "@/i18n/routing";

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

export default function Providers({
	children,
}: {
	children: React.ReactNode;
}) {
	const router = useRouter();

	useEffect(() => {
		posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
			api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
			person_profiles: 'always',
			capture_pageview: false,
			capture_pageleave: true,
		});
	}, []);

	return (
		<ThemeProvider
			attribute={"class"}
			defaultTheme="dark"
			disableTransitionOnChange
		>
			<PostHogProvider client={posthog}>
				<NextUIProvider navigate={router.push}>
					<Suspense>
						<PageView />
					</Suspense>
					{children}
				</NextUIProvider>
			</PostHogProvider>
		</ThemeProvider>
	);
}
