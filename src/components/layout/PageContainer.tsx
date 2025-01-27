import { twMerge } from "tailwind-merge";

export default function PageContainer({ children, className, ...props }: { children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
	return <main id="main-content" className={twMerge("w-full max-w-[96rem] p-4 xl:p-14 overflow-hidden", className)} {...props}>{children}</main>;
}
