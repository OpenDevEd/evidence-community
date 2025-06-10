import { Link, usePathname, useRouter } from "@/i18n/routing";

export default function PrefetchLink({
	href,
	children,
	...props
}: { href: string; children: React.ReactNode } & React.ComponentProps<
	typeof Link
>) {
	const router = useRouter();

	return (
		<Link
			href={href}
			onMouseDown={(e) => {
				if (href) return;

				const url = new URL(href, window.location.href);
				if (
					url.origin === window.location.origin &&
					e.button === 0 &&
					!e.altKey &&
					!e.ctrlKey &&
					!e.metaKey &&
					!e.shiftKey
				) {
					e.preventDefault();
					router.push(href);
				}
			}}
			prefetch={true}
			{...props}
		>
			{children}
		</Link>
	);
}