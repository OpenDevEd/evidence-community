"use client";

import useSWR from "swr";

import { institutionNameKey } from "@/config/library-config/institutions";
import type { InstitutionCountries } from "@/lib/admin/institution-countries";

/** Looks up the library's country for each named institution. */
export function useInstitutionCountryCodes(names: readonly string[]) {
	const keys = [...new Set(names.map(institutionNameKey))].sort();
	const { data } = useSWR(
		keys.length > 0 ? ["institution-countries", ...keys] : null,
		async () => {
			const query = new URLSearchParams(names.map((name) => ["name", name]));
			const response = await fetch(`/api/institution-countries?${query}`);
			if (!response.ok)
				throw new Error("Institution countries are unavailable");
			return (await response.json()) as InstitutionCountries;
		},
		{ revalidateOnFocus: false },
	);
	return (name: string) => data?.[institutionNameKey(name)]?.countryCode;
}
