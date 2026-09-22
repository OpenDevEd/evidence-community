"use client";

import useSWR from "swr";
import { CITATION_FORMATS, type CitationStyle } from "@/lib/citation-formats";
import { loadCitationStyles } from "@/lib/citation-styles";
import { useLocalStorage } from "usehooks-ts";

/** Store the ID only so saved preferences use the current catalog and asset hashes. */
export function useCitationStyle() {
	const [id, setId] = useLocalStorage("citation-style", "apa", {
		initializeWithValue: false,
	});
	const common = CITATION_FORMATS.find((style) => style.id === id);
	const { data, error, mutate } = useSWR(
		common ? null : "citation-styles",
		loadCitationStyles,
		{ revalidateOnFocus: false, revalidateIfStale: false },
	);
	const style: CitationStyle | undefined =
		common ??
		(data
			? (data.find((style) => style.id === id) ?? CITATION_FORMATS[0])
			: undefined);
	return {
		style,
		setStyle: (next: CitationStyle) => setId(next.id),
		error,
		retry: () => {
			void mutate();
		},
	};
}
