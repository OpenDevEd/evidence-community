import { Link, useRouter } from "@/i18n/routing";

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
				if (!href) return;

				if (
					e.button !== 0 ||
					e.metaKey ||
					e.ctrlKey ||
					e.shiftKey ||
					e.altKey
				) {
					return;
				}

				try {
					const url = new URL(href, window.location.href);
					if (url.origin !== window.location.origin) return;
				} catch {
					return;
				}

				e.preventDefault();
				router.push(href);
			}}
			prefetch={true}
			{...props}
		>
			{children}
		</Link>
	);
}
