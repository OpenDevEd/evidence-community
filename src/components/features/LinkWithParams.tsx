"use client";

import { ComponentProps } from "react";
import { Link } from "@nextui-org/react";
import { inferParserType } from "nuqs";
import { searchParamsLoader, serializeSearchParams } from "@/lib/searchParams";
import { twMerge } from "@/lib/tw-merge";

/**
 * A link to the search with these filters. With nowhere to go (the filter is hidden) it does nothing when pressed, but
 * still takes the pointer: NextUI's disabled link turns pointer events off, and the hover card around it, such as an
 * author's affiliations, would then never open.
 */
function LinkWithParams({ href, params, children, className, ...props }: { params?: Partial<inferParserType<typeof searchParamsLoader>> } & ComponentProps<typeof Link>) {
	const isDisabled = !href || (params !== undefined && Object.keys(params).length === 0);
	return (
		<Link
			isDisabled={isDisabled}
			// No address while it goes nowhere, so a middle click or the context menu can't open one either.
			href={isDisabled ? undefined : href + (params ? serializeSearchParams(params) : "")}
			className={isDisabled ? twMerge(className, "pointer-events-auto") : className}
			{...props}
		>
			{children}
		</Link>
	);
}

export default LinkWithParams;
