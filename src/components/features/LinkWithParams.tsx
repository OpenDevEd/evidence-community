"use client";

import { ComponentProps } from "react";
import { Link } from "@/i18n/routing";
import { inferParserType } from "nuqs";
import { searchParamsLoader, serializeSearchParams } from "@/lib/searchParams";

type LinkWithParamsProps = Omit<ComponentProps<typeof Link>, "href"> & {
	href?: string;
	isDisabled?: boolean;
	params: Partial<inferParserType<typeof searchParamsLoader>>;
};

function LinkWithParams({
	href,
	params,
	children,
	isDisabled,
	className,
	...props
}: LinkWithParamsProps) {
	const isLinkDisabled =
		isDisabled || !href || Object.keys(params).length === 0;
	const targetHref = href ? href + serializeSearchParams(params) : undefined;
	const disabledHref = href ?? "/";

	if (isLinkDisabled || !targetHref) {
		return (
			<Link
				href={disabledHref}
				aria-disabled="true"
				className={className}
				onClick={(event) => {
					event.preventDefault();
				}}
				{...props}
			>
				{children}
			</Link>
		);
	}

	return (
		<Link href={targetHref} className={className} {...props}>
			{children}
		</Link>
	);
}

export default LinkWithParams;
