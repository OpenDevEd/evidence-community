"use client";

import { ComponentProps } from "react";
import { inferParserType } from "nuqs";
import { searchParamsLoader, serializeSearchParams } from "@/lib/searchParams";
import Link from "next/link";

function LinkWithParams({
	href,
	params,
	children,
	isDisabled: isDisabledProp,
	...props
}: {
	href?: string;
	params: Partial<inferParserType<typeof searchParamsLoader>>;
	isDisabled?: boolean;
} & Omit<ComponentProps<typeof Link>, "href">) {
	const isDisabled = isDisabledProp !== undefined ? isDisabledProp : !href || Object.keys(params).length === 0;
	const fixedProps = props as any;

	return isDisabled ? (
		<div {...fixedProps}>{children}</div>
	) : (
		<Link href={href + serializeSearchParams(params)} {...fixedProps}>
			{children}
		</Link>
	);
}

export default LinkWithParams;
