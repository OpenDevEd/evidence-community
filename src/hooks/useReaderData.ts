"use client";

import useSWR from "swr";

import { useReaderSession } from "@/components/layout/navbar/ReaderSession";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import type { ReaderCollectionSummary } from "@/lib/readers/data";
import { fetcher } from "@/lib/utils";

type ReaderData = {
	bookmarks: Record<string, string>;
	collections: ReaderCollectionSummary[];
	itemCollections: Record<string, string[]>;
};

/** The signed-in reader's bookmarks and collections; nothing for anyone signed out. */
export function useReaderData() {
	const { reader } = useReaderSession();
	const readerAccounts = useLibraryFeature("readerAccounts");
	const { data, mutate } = useSWR<ReaderData>(reader && readerAccounts ? "/reader" : null, fetcher, {
		revalidateOnFocus: false,
	});
	return { reader: readerAccounts ? reader : null, data, mutate };
}
