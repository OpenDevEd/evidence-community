"use client";

import { NextUIProvider } from "@nextui-org/react";
import { ThemeProvider } from "next-themes";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/routing";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	Suspense,
} from "react";
import type { InferSelectModel } from "drizzle-orm";
import { useLocalStorage } from "usehooks-ts";
import { useTranslations } from "next-intl";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "sonner";
import { useQueryState } from "nuqs";
import { ItemsGetResponse } from "@/app/api/items/types";
import type { GapMap } from "@/lib/gapmap-links";
import {
	AnalyticsConsentProvider,
	useAnalyticsConsent,
} from "@/components/features/analytics/AnalyticsConsentProvider";
import GoogleAnalyticsManager from "@/components/features/analytics/GoogleAnalyticsManager";
import { status as statusTable } from "@/db/schema/tables/status";
import { toast as toastComponent } from "@/components/layout/Toast";
import { UtmAttributionProvider } from "@/components/features/UtmProvider";
import { trackPageView } from "@/lib/analytics";
import { SessionProvider } from "next-auth/react";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";


type RuntimeStatus = InferSelectModel<typeof statusTable>;
export type CacheContextType = {
	status: RuntimeStatus;
	cache: any;
	setCache: (cache: any) => void;
	cacheItems: (pathname: string, data: ItemsGetResponse) => void;
	getCachedItems: (pathname: string) => ItemsGetResponse | undefined;
	globalExpanded: any;
	setGlobalExpanded: (globalExpanded: any) => void;
	lastFetchedData: ItemsGetResponse | null;
	setLastFetchedData: (lastFetchedData: ItemsGetResponse | null) => void;
};

export const CacheContext = createContext<any>({});

export function useStatus(): CacheContextType["status"] {
	const { status } = useContext(CacheContext);
	return status;
}

export function useGapMaps(): GapMap[] {
	const { gapmaps } = useContext(CacheContext);
	return gapmaps ?? [];
}

function PageView() {
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const { analyticsReady, consentState } = useAnalyticsConsent();

	useEffect(() => {
		if (
			consentState !== "granted" ||
			!analyticsReady ||
			!pathname
		) {
			return;
		}

		const query = searchParams.toString();
		trackPageView(query ? `${pathname}?${query}` : pathname);
	}, [analyticsReady, consentState, pathname, searchParams]);

	return null;
}

function AnalyticsVendors({
	googleAnalyticsId,
}: {
	googleAnalyticsId: string;
}) {
	return <GoogleAnalyticsManager gaId={googleAnalyticsId} />;
}

function CacheProvider({
	children,
	status,
	gapmaps,
}: {
	children: ReactNode;
	status: RuntimeStatus;
	gapmaps: GapMap[];
}) {
	const [cache, setCache] = useState({});
	const itemsCache = useRef<Record<string, ItemsGetResponse>>({});
	const cacheItems = useCallback(
		(pathname: string, data: ItemsGetResponse) => {
			itemsCache.current[pathname] = data;
		},
		[],
	);
	const getCachedItems = useCallback(
		(pathname: string) => itemsCache.current[pathname],
		[],
	);
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
				cacheItems,
				getCachedItems,
				globalExpanded,
				setGlobalExpanded,
				accordionGlobalExpanded,
				setAccordionGlobalExpanded,
				status,
				gapmaps,
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
					item.citation = "<div>Loading...</div>";
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

function ToastAdapter({
	children,
}: {
	children: ReactNode;
}) {
	return (
		<>
			{children}
			<Toaster />
		</>
	);
}

function PramNotificationProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [error, setError] = useQueryState("error");
	const [message, setMessage] = useQueryState("message");
	const t = useTranslations("ui");

	useEffect(() => {
		if (error) {
			toastComponent({
				title: t("error"),
				description: t(error),
				type: "error",
			});
			setError(null);
		}
		if (message) {
			toastComponent({
				title: t("alert"),
				description: t(message),
			});
			setMessage(null);
		}
	}, [error, message, setError, setMessage, t]);

	return <>{children}</>;
}

export default function Providers({
	children,
	status,
	gapmaps,
}: {
	children: ReactNode;
	status: RuntimeStatus;
	gapmaps: GapMap[];
}) {
	const router = useRouter();
	const { analytics, features, theme } = useLibraryConfig();
	const isLoginEnabled = features.login;

	return (
		<ThemeProvider
			attribute={"class"}
			defaultTheme={theme.defaultMode}
			forcedTheme={theme.forcedMode ?? undefined}
			disableTransitionOnChange
		>
			<NuqsAdapter>
				<ToastAdapter>
					<SessionProvider
						session={isLoginEnabled ? undefined : null}
						refetchOnWindowFocus={isLoginEnabled}
						refetchWhenOffline={
							isLoginEnabled ? undefined : false
						}
					>
						<AnalyticsConsentProvider>
							<CacheProvider status={status} gapmaps={gapmaps}>
								<NextUIProvider navigate={router.push}>
									<Suspense>
										<PramNotificationProvider>
											<PageView />
										</PramNotificationProvider>
									</Suspense>
									<UtmAttributionProvider />
									{children}
									<AnalyticsVendors
										googleAnalyticsId={
											analytics.google.measurementId ?? ""
										}
									/>
								</NextUIProvider>
							</CacheProvider>
						</AnalyticsConsentProvider>
					</SessionProvider>
				</ToastAdapter>
			</NuqsAdapter>
		</ThemeProvider>
	);
}
