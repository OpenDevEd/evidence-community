"use client";

import { use, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import type { ItemGetResponse } from "@/app/api/item/types";
import { useLastFetchedData } from "@/context/Providers";
import ItemPage from "@/components/features/newlib/ItemPage";
import { usePrefetchedClicks } from "@/hooks/useItemLink";
import { fetcher } from "@/lib/utils";

const neverChanges = () => () => {};

/**
 * A page a result card loaded ahead may be minutes old, so each click from such a card has it read its record again.
 * Reading only the record keeps the pages the browser holds for Back, which a router refresh would drop. When the read
 * fails, as for a record unpublished since, the server draws the page again and answers a missing record with the
 * not-found page; its record then wins over an earlier read.
 */
function useFreshRecord(key: string) {
	const router = useRouter();
	const clicks = usePrefetchedClicks(key);
	const { data, error } = useSWR<ItemGetResponse>(clicks ? [`/item/${key}?view=page`, clicks] : null, ([url]: [string]) => fetcher(url), {
		revalidateOnFocus: false,
		shouldRetryOnError: false,
		onError: () => router.refresh(),
	});
	return error ? undefined : data;
}

/**
 * The item page, drawn by one set of components for the whole visit. After a click from a list it starts from the
 * list's copy of the record and takes the full record when it arrives, so an open menu or focus is kept and nothing
 * animates in twice. A direct visit, or a click without a copy, waits for the full record.
 */
export default function ItemRoute({ record }: { record: Promise<ItemGetResponse | null> }) {
	const { key } = useParams<{ key: string }>();
	const fresh = useFreshRecord(key);
	// The server's HTML is drawn without a list copy, so the browser's first draw of it must not use one either.
	const afterHydration = useSyncExternalStore(neverChanges, () => true, () => false);
	const { lastFetchedData } = useLastFetchedData();
	const [copy] = useState(() => {
		const item = afterHydration ? lastFetchedData?.items?.find((listed) => listed.key === key) : undefined;
		return item ? ({ item: { ...item, citation: item.citation ?? "<div>Loading...</div>" } } as ItemGetResponse) : undefined;
	});
	const [arrived, setArrived] = useState<ItemGetResponse | null>();
	useEffect(() => {
		let current = true;
		record.then(
			(value) => current && setArrived(value),
			() => {},
		);
		return () => {
			current = false;
		};
	}, [record]);
	useLayoutEffect(() => {
		window.scrollTo(0, 0);
	}, []);

	const data = fresh ?? (arrived !== undefined ? arrived : (copy ?? use(record)));
	// A missing record is answered by the server's not-found page.
	if (!data?.item) return null;
	return <ItemPage data={data} loading={data === copy} />;
}
