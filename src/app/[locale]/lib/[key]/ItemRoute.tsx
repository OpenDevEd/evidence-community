"use client";

import { use, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import type { ItemGetResponse } from "@/app/api/item/types";
import { useLastFetchedData } from "@/context/Providers";
import ItemPage from "@/components/features/newlib/ItemPage";

const neverChanges = () => () => {};

/**
 * The item page, drawn by one set of components for the whole visit. After a click from a list it starts from the
 * list's copy of the record and takes the full record when it arrives, so an open menu or focus is kept and nothing
 * animates in twice. A direct visit, or a click without a copy, waits for the full record.
 */
export default function ItemRoute({ record }: { record: Promise<ItemGetResponse | null> }) {
	const { key } = useParams<{ key: string }>();
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

	const data = arrived !== undefined ? arrived : (copy ?? use(record));
	// A missing record is answered by the server's not-found page.
	if (!data?.item) return null;
	return <ItemPage data={data} loading={data === copy} />;
}
