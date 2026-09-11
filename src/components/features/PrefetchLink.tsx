import { Link, useRouter } from "@/i18n/routing";

type LinkMouseEvent = React.MouseEvent<HTMLAnchorElement>;
type RouterPush = ReturnType<typeof useRouter>["push"];

function hasPlainPrimaryClick(event: LinkMouseEvent, href: string) {
	const hasModifier =
		event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
	return (
		Boolean(href) &&
		event.currentTarget.target !== "_blank" &&
		event.button === 0 &&
		!hasModifier
	);
}

function hasCurrentOrigin(href: string) {
	try {
		return (
			new URL(href, window.location.href).origin ===
			window.location.origin
		);
	} catch {
		return false;
	}
}

function navigateOnMouseDown(
	event: LinkMouseEvent,
	href: string,
	push: RouterPush,
) {
	if (!hasPlainPrimaryClick(event, href) || !hasCurrentOrigin(href)) return;
	event.preventDefault();
	push(href);
}

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
			onMouseDown={(event) =>
				navigateOnMouseDown(event, href, router.push)
			}
			prefetch={true}
			{...props}
		>
			{children}
		</Link>
	);
}
