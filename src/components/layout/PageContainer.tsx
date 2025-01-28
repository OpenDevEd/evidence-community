"use client";

import { twMerge } from "tailwind-merge";

export default function PageContainer({ children, className, ...props }: { children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
	return <main id="main-content" className={twMerge("scroll-mt-0 w-full max-w-[96rem] p-4 xl:p-14 overflow-hidden focus:outline-none", className)} {...props}>{children}</main>;
}
