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
			value={{ cache, setCache, itemsCache, previousExpansionStates, globalExpanded, setGlobalExpanded }}
		>
			{children}
		</CacheContext.Provider>
	);
}

function LoadingScreen({
	children,
	mounted,
	featureFlags,
}: {
	children: React.ReactNode;
	mounted: boolean;
	featureFlags: Set<string> | null;
}) {
	const { theme } = useTheme();

	return (
		<AnimatePresence mode="popLayout">
			{featureFlags ? (
				children
			) : (
				<motion.div
					key="loading"
					initial={{ opacity: 1 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					className="fixed inset-0 w-full bg-background flex justify-center items-center gap-4 z-[999]"
				>
					<AnimatePresence mode="popLayout">
						{mounted ? (
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
								<Image
									src={
										theme === "dark"
											? `/logos/${style}/logo.png`
											: `/logos/${style}/logo_light.png`
									}
									alt="logo"
									width={171}
									height={40}
								/>
							</motion.div>
						) : (
							<motion.div
								key="spinner"
								initial={{ opacity: 1, scale: 1 }}
								exit={{ opacity: 0, scale: 0 }}
							>
								<Spinner
									classNames={{
										circle1: "border-b-accent",
										circle2: "border-b-accent",
									}}
								/>
							</motion.div>
						)}
					</AnimatePresence>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

export default function Providers({ children }: { children: React.ReactNode }) {
	const router = useRouter();
	const [featureFlags, setFeatureFlags] = useState<Set<string> | null>(null);
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
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
			<PostHogProvider client={posthog}>
				<FeatureFlagsContext.Provider value={{ featureFlags }}>
					<CacheProvider>
						<NextUIProvider navigate={router.push}>
							<Suspense>
								<PageView />
							</Suspense>
							<LoadingScreen
								mounted={mounted}
								featureFlags={featureFlags}
							>
								{children}
							</LoadingScreen>
						</NextUIProvider>
					</CacheProvider>
				</FeatureFlagsContext.Provider>
			</PostHogProvider>
		</ThemeProvider>
	);
}
