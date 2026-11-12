"use client";

import { NextUIProvider } from "@nextui-org/react";
import { ThemeProvider } from "next-themes";
import { useLocale } from "next-intl";
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
import type { PublicLibraryStatus } from "@/lib/library-export-records";
import { toast as toastComponent } from "@/components/layout/Toast";
import { SIGNED_OUT_PARAM } from "@/lib/readers/session-follow";
import { UtmAttributionProvider } from "@/components/features/UtmProvider";
import { trackPageView } from "@/lib/analytics";
import { ReaderSessionProvider, type Reader } from "@/components/layout/navbar/ReaderSession";
import { SuggestPapersDialog } from "@/components/features/suggest/SuggestPapers";
import type { JoinStanding } from "@/lib/readers/join";
import { InlineChatLayoutProvider } from "@/context/InlineChatLayout";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

type RuntimeStatus = PublicLibraryStatus;
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
			!pathname ||
			// The admin's draft preview frame is nobody's visit, and it reloads with every save.
			pathname.includes("/admin/preview/") ||
			consentState === "pending" ||
			(consentState === "granted" && !analyticsReady)
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
			{} as ItemsGetResponse,
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
			{} as ItemsGetResponse,
		);

	const setLastFetchedDataAsResponse = useCallback(
		(data: ItemsGetResponse) => {
			setLastFetchedData((prev) => {
				const allItems = [...(prev?.items ?? []), ...data.items];

				const uniqueItems = allItems.reduce((acc, item) => {
					// A listed item moves to the end, so the list on screen is the last thing dropped past 100.
					acc.delete(item.key);
					acc.set(item.key, item);
					item.citation = "<div>Loading...</div>";
					return acc;
				}, new Map());

				return {
					items: Array.from(uniqueItems.values()).slice(-100),
				} as ItemsGetResponse;
			});
		},
		[setLastFetchedData],
	);

	return {
		lastFetchedData,
		setLastFetchedData: setLastFetchedDataAsResponse,
	};
}

function ToastAdapter({ children }: { children: ReactNode }) {
	return (
		<>
			{/*
			 * A top layer to react-aria: toasts stay readable, focusable and clickable while a dialog is open, and a click on
			 * one does not close it. Before the page, so the Toaster listens before anything on the page can raise a toast as
			 * it loads (`?signed-out`, `?error`): sonner drops a toast raised while no Toaster listens.
			 */}
			<div data-react-aria-top-layer="true">
				<Toaster />
			</div>
			{children}
		</>
	);
}

function PramNotificationProvider({ children }: { children: ReactNode }) {
	const [error, setError] = useQueryState("error");
	const [message, setMessage] = useQueryState("message");
	const [signedOut, setSignedOut] = useQueryState(SIGNED_OUT_PARAM);
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
		if (signedOut) {
			toastComponent({ title: t("signedOutHereAndOnOpenScholar") });
			setSignedOut(null);
		}
	}, [error, message, signedOut, setError, setMessage, setSignedOut, t]);

	return <>{children}</>;
}

export default function Providers({
	children,
	status,
	gapmaps,
	storedConsent,
	reader,
	readerAdmin,
	readerJoin,
}: {
	children: ReactNode;
	status: RuntimeStatus;
	gapmaps: GapMap[];
	/** The reader's stored answer to the cookie question, as the server read it. */
	storedConsent: string | null;
	/** Who is signed in, as the server read it with the page. */
	reader: Reader | null;
	/** Whether they have a role in this library above viewer, as the server read it. */
	readerAdmin: boolean;
	/** Where they stand with joining its team, as the server read it. */
	readerJoin: JoinStanding;
}) {
	const router = useRouter();
	// The component library's own labels (a combobox's "Show suggestions", a field's "Clear input", "Dismiss") in the
	// site's language; "cn" is this site's name for Chinese.
	const locale = useLocale();
	const uiLocale = locale === "cn" ? "zh-CN" : locale;
	const { analytics, theme } = useLibraryConfig();

	return (
		<ThemeProvider
			attribute={"class"}
			defaultTheme={theme.defaultMode}
			forcedTheme={theme.forcedMode ?? undefined}
			disableTransitionOnChange
		>
			<NuqsAdapter>
				<ToastAdapter>
					<ReaderSessionProvider reader={reader} admin={readerAdmin} join={readerJoin}>
						<AnalyticsConsentProvider
							storedConsentFromServer={storedConsent}
						>
							<CacheProvider status={status} gapmaps={gapmaps}>
								<NextUIProvider navigate={router.push} locale={uiLocale}>
									<Suspense>
										<PramNotificationProvider>
											<PageView />
										</PramNotificationProvider>
									</Suspense>
									<UtmAttributionProvider />
									<InlineChatLayoutProvider>
										{children}
									</InlineChatLayoutProvider>
									<SuggestPapersDialog />
									<AnalyticsVendors
										googleAnalyticsId={
											analytics.google.measurementId ?? ""
										}
									/>
								</NextUIProvider>
							</CacheProvider>
						</AnalyticsConsentProvider>
					</ReaderSessionProvider>
				</ToastAdapter>
			</NuqsAdapter>
		</ThemeProvider>
	);
}
