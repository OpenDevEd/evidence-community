"use client";

import useSWR, { useSWRConfig } from "swr";

import { useReaderSession } from "@/components/layout/navbar/ReaderSession";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import type { ReaderCollectionSummary } from "@/lib/readers/data";
import { fetcher } from "@/lib/utils";

type ReaderData = {
	bookmarks: Record<string, string>;
	collections: ReaderCollectionSummary[];
	itemCollections: Record<string, string[]>;
};

/**
 * The signed-in reader's bookmarks and collections; nothing for anyone signed
 * out. `refresh` reloads them and every reader list already shown, such as a
 * profile's list and its collection covers, after a bookmark or collection
 * change.
 */
export function useReaderData() {
	const { reader } = useReaderSession();
	const readerAccounts = useLibraryFeature("readerAccounts");
	const { mutate } = useSWRConfig();
	const { data, mutate: mutateOwn } = useSWR<ReaderData>(reader && readerAccounts ? "/reader" : null, fetcher, {
		revalidateOnFocus: false,
	});
	const refresh = () =>
		Promise.all([mutateOwn(), mutate((key) => typeof key === "string" && key.startsWith("/user/items/"))]);
	return { reader: readerAccounts ? reader : null, data, refresh };
}
