"use client";

import { NextUIProvider, Spinner } from "@nextui-org/react";
import { ThemeProvider, useTheme } from "next-themes";
import { useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/routing";
import posthog from "posthog-js";
import { PostHogProvider, usePostHog } from "posthog-js/react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/routing";
import { createContext, useContext } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { style } from "../../tailwind.config";
import Image from "next/image";
import { twMerge } from "tailwind-merge";
import { SessionProvider, useSession } from "next-auth/react";
import { Session } from "next-auth";

export const CacheContext = createContext<any>({});
export const FeatureFlagsContext = createContext<any>({});

export function useFeatureFlagEnabled(flag: string) {
	const { featureFlags } = useContext(FeatureFlagsContext);
	return featureFlags?.has(flag);
}

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
	const previousExpansionStates = useRef({});
	const [globalExpanded, setGlobalExpanded] = useState({});

	return (
		<CacheContext.Provider
			value={{
				cache,
				setCache,
				itemsCache,
				previousExpansionStates,
				globalExpanded,
				setGlobalExpanded,
			}}
		>
			{children}
		</CacheContext.Provider>
	);
}

function LoadingScreen({
	children,
	isMounted,
	featureFlags,
}: {
	children: React.ReactNode;
	isMounted: boolean;
	featureFlags: Set<string> | null;
}) {
	const { theme } = useTheme();
	const { data: session, status } = useSession();

	return (
		<AnimatePresence mode="popLayout">
			{(featureFlags && status !== "loading") ? (
				children
			) : (
				<motion.div
					key="loading"
					initial={{ opacity: 1 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					className="fixed inset-0 w-full bg-background_light dark:bg-background flex justify-center items-center gap-4 z-[999]"
				>
					<AnimatePresence mode="popLayout">
						<motion.div
							key="logo"
							initial={{
								opacity: 0,
							}}
							animate={{
								opacity: 1,
							}}
							exit={{ opacity: 0, scale: 0 }}
							className="flex flex-col items-center justify-center"
						>
							{["dark", "light"].map((themeToMatch) => (
								<Image
									key={themeToMatch}
									src={
										themeToMatch === "dark"
											? `/logos/${style}/logo.png`
											: `/logos/${style}/logo_light.png`
									}
									className={twMerge(
										"pointer-events-none",
										themeToMatch === "light"
											? "dark:hidden"
											: "hidden dark:block"
									)}
									alt="logo"
									width={171}
									height={40}
								/>
							))}
						</motion.div>
					</AnimatePresence>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

export default function Providers({ children, session }: { children: React.ReactNode, session: Session | null }) {
	const router = useRouter();
	const [featureFlags, setFeatureFlags] = useState<Set<string> | null>(null);
	const [isMounted, setIsMounted] = useState(false);

	useEffect(() => {
		setIsMounted(true);
		posthog
			.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
				person_profiles: "always",
				capture_pageview: false,
				capture_pageleave: true,
				api_host: "/ingest",
				ui_host: "https://us.posthog.com",
			})
			?.onFeatureFlags((featureFlags) => {
				setFeatureFlags(new Set(featureFlags));
				console.log("featureFlags", featureFlags);
			});
	}, []);

	return (
		<ThemeProvider
			attribute={"class"}
			defaultTheme="dark"
			disableTransitionOnChange
		>
			<SessionProvider session={session}>
				<PostHogProvider client={posthog}>
					<FeatureFlagsContext.Provider value={{ featureFlags }}>
						<CacheProvider>
							<NextUIProvider navigate={router.push}>
								<Suspense>
									<PageView />
								</Suspense>
								<LoadingScreen
									isMounted={isMounted}
									featureFlags={featureFlags}
								>
									{children}
								</LoadingScreen>
							</NextUIProvider>
						</CacheProvider>
					</FeatureFlagsContext.Provider>
				</PostHogProvider>
			</SessionProvider>
		</ThemeProvider>
	);
}
