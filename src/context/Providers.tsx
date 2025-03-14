"use client";

import { NextUIProvider, Spinner } from "@nextui-org/react";
import { ThemeProvider, useTheme } from "next-themes";
import { useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/routing";
import posthog from "posthog-js";
import { PostHogProvider, usePostHog } from "posthog-js/react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/routing";
import { createContext, useContext } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { style } from "../../tailwind.config";
import Image from "next/image";
import { twMerge } from "tailwind-merge";
import { SessionProvider, useSession } from "next-auth/react";
import { Session } from "next-auth";
import { InferSelectModel } from "drizzle-orm";
import { status as statusTable } from "@/db/schema/tables/status";
import { ItemsGetResponse } from "@/app/api/items/types";
import { useLocalStorage } from "usehooks-ts";
import { useTranslations } from "next-intl";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "sonner";

export type CacheContextType = {
	status: InferSelectModel<typeof statusTable>;
	cache: any;
	setCache: (cache: any) => void;
	itemsCache: any;
	previousExpansionStates: any;
	globalExpanded: any;
	setGlobalExpanded: (globalExpanded: any) => void;
	lastFetchedData: ItemsGetResponse | null;
	setLastFetchedData: (lastFetchedData: ItemsGetResponse | null) => void;
};

export const CacheContext = createContext<any>({});
export const FeatureFlagsContext = createContext<any>({});

export function useFeatureFlagEnabled(flag: string) {
	const { featureFlags } = useContext(FeatureFlagsContext);
	return featureFlags?.has(flag);
}

export function useStatus(): CacheContextType["status"] {
	const { status } = useContext(CacheContext);
	return status;
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

function CacheProvider({
	children,
	status,
}: {
	children: React.ReactNode;
	status: InferSelectModel<typeof statusTable>;
}) {
	const [cache, setCache] = useState({});
	const itemsCache = useRef({});
	const previousExpansionStates = useRef({});
	const [globalExpanded, setGlobalExpanded] = useState({});
	const [accordionGlobalExpanded, setAccordionGlobalExpanded] =
		useState(null);
	const [lastFetchedData, setLastFetchedData] =
		useLocalStorage<ItemsGetResponse | null>(
			"lastFetchedData",
			{} as ItemsGetResponse
		);

	return (
		<CacheContext.Provider
			value={{
				cache,
				setCache,
				itemsCache,
				previousExpansionStates,
				globalExpanded,
				setGlobalExpanded,
				accordionGlobalExpanded,
				setAccordionGlobalExpanded,
				status,
				lastFetchedData,
				setLastFetchedData,
			}}
		>
			{children}
		</CacheContext.Provider>
	);
}

export function useLastFetchedData() {
	const [lastFetchedData, setLastFetchedData] =
		useLocalStorage<ItemsGetResponse | null>(
			"lastFetchedData",
			{} as ItemsGetResponse
		);

	const setLastFetchedDataAsResponse = useCallback(
		(data: ItemsGetResponse) => {
			setLastFetchedData((prev) => {
				const allItems = [...(prev?.items ?? []), ...data.items];

				const uniqueItems = allItems.reduce((acc, item) => {
					acc.set(item.id, item);
					return acc;
				}, new Map());

				return {
					items: Array.from(uniqueItems.values()).slice(-100),
				} as ItemsGetResponse;
			});
		},
		[setLastFetchedData]
	);

	return {
		lastFetchedData,
		setLastFetchedData: setLastFetchedDataAsResponse,
	};
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
	const statusTable = useStatus();
	const t = useTranslations("ui");

	return (
		<AnimatePresence mode="popLayout">
			{featureFlags && (status !== "loading" || !!session) ? (
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
									suppressHydrationWarning
									aria-hidden={themeToMatch !== theme}
									key={themeToMatch}
									src={
										themeToMatch === "dark"
											? `/logos/${statusTable?.companyName?.toLowerCase()}/logo.png`
											: `/logos/${statusTable?.companyName?.toLowerCase()}/logo_light.png`
									}
									className={twMerge(
										"pointer-events-none",
										themeToMatch === "light"
											? "dark:hidden"
											: "hidden dark:block"
									)}
									alt={t("logoAlt", {
										company: statusTable?.companyName,
										theme: themeToMatch,
									})}
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


function ToastAdapter({
	children,
}: {
	children: React.ReactNode;
}) {
	return <>
		{children}
		<Toaster />
	</>
}


export default function Providers({
	children,
	session,
	status,
}: {
	children: React.ReactNode;
	session: Session | null;
	status: InferSelectModel<typeof statusTable>;
}) {
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
			});
	}, []);

	return (
		<ThemeProvider
			attribute={"class"}
			defaultTheme={process.env.NEXT_PUBLIC_DEFAULT_THEME || "dark"}
			disableTransitionOnChange
		>
			<NuqsAdapter>
				<ToastAdapter>
					<SessionProvider session={session}>
						<PostHogProvider client={posthog}>
							<FeatureFlagsContext.Provider value={{ featureFlags }}>
							<CacheProvider status={status}>
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
			</ToastAdapter>
			</NuqsAdapter>
		</ThemeProvider>
	);
}
