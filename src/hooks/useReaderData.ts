"use client";

import useSWR, { useSWRConfig } from "swr";

import { useReaderSession } from "@/components/layout/navbar/ReaderSession";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import { isCollectionsKey } from "@/lib/readers/collection-pages";
import { fetcher } from "@/lib/utils";

type ReaderData = { bookmarks: Record<string, string> };

/**
 * The signed-in reader's bookmarks; nothing for anyone signed out. Their collections are read a page at a time where
 * they are listed. `refresh` reloads the bookmarks and every reader list already shown, such as a profile's list,
 * its collection covers and the pages of collections, after a bookmark or collection change.
 */
export function useReaderData() {
	const { reader } = useReaderSession();
	const readerAccounts = useLibraryFeature("readerAccounts");
	const { mutate } = useSWRConfig();
	const { data, mutate: mutateOwn } = useSWR<ReaderData>(reader && readerAccounts ? "/reader" : null, fetcher, {
		revalidateOnFocus: false,
	});
	const refresh = () =>
		Promise.all([mutateOwn(), mutate((key) => (typeof key === "string" && key.startsWith("/user/items/")) || isCollectionsKey(key))]);
	return { reader: readerAccounts ? reader : null, data, refresh };
}
