"use client";

import { createElement, isValidElement, use, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { usePathname } from "@/i18n/routing";
import { POLICY_PAGES } from "@/components/pages/policy-pages";

/**
 * A page's own component, from the chunk its page loads anyway, so no page carries another page's code. Once loaded it
 * draws without waiting, which a placeholder needs on Back: React cannot show one that is still loading, and shows the
 * previous page or an empty area instead. `start` loads it before then (see LoadPageFallback).
 */
function fromPage<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
	let loaded: ComponentType<P> | undefined;
	let loading: Promise<ComponentType<P>> | undefined;
	const start = () => (loading ??= load().then((module) => (loaded = module.default)));
	function FromPage(props: P) {
		return createElement(loaded ?? use(start()), props);
	}
	return Object.assign(FromPage, { start });
}

const ReaderProfile = fromPage(() => import("@/components/pages/ReaderProfile"));
const ItemLoading = fromPage(() => import("@/app/[locale]/lib/[key]/LoadingComponent"));
const CitationLoading = fromPage(() => import("@/app/[locale]/citation/[key]/LoadingComponent"));
const EvidenceLibrary = fromPage(() => import("@/components/pages/EvidenceLibrary"));
const StatisticsPage = fromPage(() => import("@/components/layout/StatisticsPageNew"));
const Map = fromPage(() => import("@/components/pages/Map"));
const PolicyLayoutPlaceholder = fromPage(async () => ({ default: (await import("@/components/pages/PolicyLayout")).PolicyLayoutPlaceholder }));
const Takedown = fromPage(() => import("@/components/pages/Takedown"));
const GapMaps = fromPage(() => import("@/components/pages/GapMaps"));
const NotFound = fromPage(() => import("@/components/layout/NotFound"));
const DigestPages = fromPage(() => import("@/components/digests/DigestPages"));
const Contact = fromPage(() => import("@/components/pages/Contact"));
const CollectionInvitationPlaceholder = fromPage(async () => ({ default: (await import("@/components/pages/CollectionInvitation")).CollectionInvitationPlaceholder }));
const HomePlaceholder = fromPage(async () => ({ default: (await import("@/components/pages/HomePage")).HomePlaceholder }));

// Data the page has not read yet: parts that wait on it keep their own placeholders until the page replaces them.
const PENDING = new Promise<never>(() => {});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const neverChanges = () => () => {};

/**
 * A digest page by what follows /digests: the list, an edition, or a reader's email preferences. Only in the browser,
 * on Back: the server never finishes a part that waits on PENDING, and a first load draws the page at once anyway.
 */
function DigestFallback({ slug }: { slug: string | undefined }) {
	const inBrowser = useSyncExternalStore(neverChanges, () => true, () => false);
	return inBrowser ? digestPage(slug) : null;
}
DigestFallback.start = DigestPages.start;

function digestPage(slug: string | undefined) {
	if (!slug) return <DigestPages view="archive" latest={PENDING} editions={PENDING} chart={PENDING} nextEdition={PENDING} />;
	if (slug === "preferences") return <DigestPages view="preferences" token={PENDING} subscriber={PENDING} />;
	return UUID.test(slug) ? <DigestPages view="edition" slug={slug} earlier={PENDING} edition={PENDING} cards={PENDING} /> : null;
}

/** What only the server knows about this library and a page needs to draw itself. */
type ServerFlags = { contactForm: boolean; home: { intro?: ReactNode } | null };

/** What each page draws before its server data is in, by the first part of its address and the id after it. */
const FALLBACKS: Record<string, (id: string | undefined, server: ServerFlags) => ReactNode> = {
	"": (_, server) => server.home && <HomePlaceholder intro={server.home.intro} />,
	profile: (id) => id && <ReaderProfile data={{ id, name: "", image: null, bookmarks: {}, collections: [] }} loading />,
	lib: (id) => (id ? <ItemLoading /> : <EvidenceLibrary />),
	newlib: (id) => id && <ItemLoading />,
	citation: (id) => id && <CitationLoading />,
	statistics: () => <StatisticsPage />,
	map: () => <Map places={{}} />,
	privacy: () => <PolicyLayoutPlaceholder {...POLICY_PAGES.privacy} />,
	terms: () => <PolicyLayoutPlaceholder {...POLICY_PAGES.terms} />,
	"cookie-policy": () => <PolicyLayoutPlaceholder {...POLICY_PAGES["cookie-policy"]} />,
	takedown: () => <Takedown />,
	gapmaps: () => <GapMaps />,
	"404": () => <NotFound />,
	digests: (slug) => <DigestFallback slug={slug} />,
	contact: (_, server) => <Contact formEnabled={server.contactForm} />,
	invitations: (id) => id && <CollectionInvitationPlaceholder invitationId={id} />,
};

/**
 * What the page area shows while a page is on its way from the server: on a first load before its content streams in,
 * and on Back when the page has to be read again. Each page is drawn from its own components in their loading state,
 * so the area is never empty between the header and the footer. Not listed: the admin.
 */
export default function PageFallback(server: ServerFlags) {
	const page = fallbackFor(usePathname(), server);
	// A stand-in until the page arrives: nothing in it takes focus, clicks or typing, which the page would then lose.
	return page ? (
		<div className="contents" inert>
			{page}
		</div>
	) : null;
}

function fallbackFor(pathname: string, server: ServerFlags) {
	const [, section = "", id] = pathname.split("/");
	return FALLBACKS[section]?.(id, server);
}

/**
 * Loads the placeholder of the page on screen, from the code that page already has, so that if the router drops the
 * page while the reader is elsewhere, Back draws the placeholder at once.
 */
export function LoadPageFallback(server: ServerFlags) {
	const page = fallbackFor(usePathname(), server);
	if (isValidElement(page)) (page.type as { start?: () => unknown }).start?.();
	return null;
}
