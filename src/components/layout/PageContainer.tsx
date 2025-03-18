"use client";

import { twMerge } from "tailwind-merge";

export default function PageContainer({ children, className, ...props }: { children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
	return <main className={twMerge("scroll-mt-0 w-full max-w-[96rem] p-4 lg:p-8 xl:p-14 overflow-hidden focus:outline-none min-h-screen", className)} {...props}>{children}</main>;
}
