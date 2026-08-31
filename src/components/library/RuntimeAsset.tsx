import { hugeiconSpriteUrl } from "@/config/library-config/icon-assets";

const HUGEICON_ID = /^[A-Za-z][A-Za-z0-9]*Icon$/u;

export function RuntimeAsset({
	reference,
	alt,
	className,
	width = 24,
	height = 24,
}: {
	reference: string;
	alt: string;
	className?: string;
	width?: number;
	height?: number;
}) {
	if (HUGEICON_ID.test(reference)) {
		return (
			<svg
				viewBox="0 0 24 24"
				fill="none"
				width={width}
				height={height}
				aria-hidden={alt ? undefined : true}
				aria-label={alt || undefined}
				role={alt ? "img" : undefined}
				className={className}
				data-runtime-asset="platform"
				data-platform-icon={reference}
			>
				<use href={hugeiconSpriteUrl(reference)} />
			</svg>
		);
	}

	if (!reference.startsWith("https://")) return null;

	return (
		// Runtime uploads cannot depend on a build-time Next.js image allowlist.
		// eslint-disable-next-line @next/next/no-img-element
		<img
			src={reference}
			alt={alt}
			width={width}
			height={height}
			className={className}
			data-runtime-asset="remote"
			draggable={false}
		/>
	);
}
