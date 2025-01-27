export default function PageContainer({ children, ...props }: { children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
	return <main className="w-full max-w-[96rem] px-4 xl:px-14" {...props}>{children}</main>;
}
