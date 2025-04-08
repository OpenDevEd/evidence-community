"use client";

import { ComponentProps } from "react";
import { Link } from "@nextui-org/react";
import { inferParserType } from "nuqs";
import { searchParamsLoader, serializeSearchParams } from "@/lib/searchParams";

function LinkWithParams({ href, params, children, ...props}: { params: Partial<inferParserType<typeof searchParamsLoader>>} & ComponentProps<typeof Link>) {
	return <Link href={href + serializeSearchParams(params)} {...props}>
		{children}	
	</Link>
}

export default LinkWithParams;