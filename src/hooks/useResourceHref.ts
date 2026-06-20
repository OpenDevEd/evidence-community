"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * Builds an href to a resource detail page (`/lib/<key>` or `/citation/<key>`)
 * that carries over the CURRENT search params — search / scope / sort /
 * collections / year / institution / country / author, etc.
 *
 * This is what makes the query context follow the user into the item page (and
 * its navbar search bar): wherever a resource is opened — the library grid, the
 * navbar autocomplete, related/cited resources — the same params come along.
 *
 * @param key   the item key
 * @param opts.base  the detail route base, defaults to `/lib`
 * @param opts.set   params to set/override on top of the current ones (pass a
 *                   falsy value to delete a param, e.g. `{ referrer: path }`)
 */
export function useResourceHref() {
	const searchParams = useSearchParams();

	return useCallback(
		(
			key: string,
			opts: { base?: string; set?: Record<string, string | null | undefined> } = {},
		) => {
			const base = opts.base ?? "/lib";
			const query = new URLSearchParams(searchParams.toString());
			for (const [name, value] of Object.entries(opts.set ?? {})) {
				if (value) query.set(name, value);
				else query.delete(name);
			}
			const qs = query.toString();
			return `${base}/${key}${qs ? `?${qs}` : ""}`;
		},
		[searchParams],
	);
}
