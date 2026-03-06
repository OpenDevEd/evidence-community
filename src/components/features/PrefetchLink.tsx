import { Link } from "@/i18n/routing";

export default function PrefetchLink({
	href,
	children,
	...props
}: { href: string; children: React.ReactNode } & React.ComponentProps<
	typeof Link
>) {
	return (
		<Link href={href} prefetch={true} {...props}>
			{children}
		</Link>
	);
}