"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "@/i18n/routing";
import { POLICY_PAGES } from "@/components/pages/policy-pages";

// Each page's own components, in the chunks its page loads anyway, so no page carries another page's code.
const ReaderProfile = dynamic(() => import("@/components/pages/ReaderProfile"));
const ItemLoading = dynamic(() => import("@/app/[locale]/lib/[key]/LoadingComponent"));
const CitationLoading = dynamic(() => import("@/app/[locale]/citation/[key]/LoadingComponent"));
const EvidenceLibrary = dynamic(() => import("@/components/pages/EvidenceLibrary"));
const StatisticsPage = dynamic(() => import("@/components/layout/StatisticsPageNew"));
const Map = dynamic(() => import("@/components/pages/Map"));
const PolicyLayoutPlaceholder = dynamic(() => import("@/components/pages/PolicyLayout").then((module) => module.PolicyLayoutPlaceholder));
const Takedown = dynamic(() => import("@/components/pages/Takedown"));
const GapMaps = dynamic(() => import("@/components/pages/GapMaps"));
const NotFound = dynamic(() => import("@/components/layout/NotFound"));
const DigestPages = dynamic(() => import("@/components/digests/DigestPages"));
const Contact = dynamic(() => import("@/components/pages/Contact"));
const CollectionInvitationPlaceholder = dynamic(() =>
	import("@/components/pages/CollectionInvitation").then((module) => module.CollectionInvitationPlaceholder),
);

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

function digestPage(slug: string | undefined) {
	if (!slug) return <DigestPages view="archive" latest={PENDING} editions={PENDING} chart={PENDING} nextEdition={PENDING} />;
	if (slug === "preferences") return <DigestPages view="preferences" token={PENDING} subscriber={PENDING} />;
	return UUID.test(slug) ? <DigestPages view="edition" slug={slug} earlier={PENDING} edition={PENDING} cards={PENDING} /> : null;
}

/** What only the server knows about this library and a page needs to draw itself. */
type ServerFlags = { contactForm: boolean };

/** What each page draws before its server data is in, by the first part of its address and the id after it. */
const FALLBACKS: Record<string, (id: string | undefined, server: ServerFlags) => ReactNode> = {
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
 * so the area is never empty between the header and the footer. Not listed: the home page, which would need its text and
 * world map read for every page, and the admin.
 */
export default function PageFallback(server: ServerFlags) {
	const [, section = "", id] = usePathname().split("/");
	const page = FALLBACKS[section]?.(id, server);
	// A stand-in until the page arrives: nothing in it takes focus, clicks or typing, which the page would then lose.
	return page ? (
		<div className="contents" inert>
			{page}
		</div>
	) : null;
}
