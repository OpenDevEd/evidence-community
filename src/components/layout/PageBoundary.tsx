"use client";

import { createContext, Suspense, use, type ReactNode } from "react";

/** Whether this page is going to a crawler, which the layout knows from the request. */
const ForCrawler = createContext(false);

export function CrawlerProvider({ crawler, children }: { crawler: boolean; children: ReactNode }) {
	return <ForCrawler value={crawler}>{children}</ForCrawler>;
}

/**
 * A Suspense boundary for people, who see its stand-in while the content is on its way. A crawler gets the content in
 * place and no stand-in: React sends a finished boundary of more than about 12 KB as its stand-in first and the content
 * in a hidden block a script swaps in, which a crawler that runs no scripts reads as a page of placeholders.
 */
export function PageBoundary({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
	return use(ForCrawler) ? children : <Suspense fallback={fallback}>{children}</Suspense>;
}
