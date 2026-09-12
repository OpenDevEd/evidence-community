"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { AlertCircleIcon, CheckmarkBadge01Icon, CircleIcon, Loading03Icon } from "@hugeicons/core-free-icons";
import type { useAdminPublication } from "./useAdminPublication";

type PublicationHook = ReturnType<typeof useAdminPublication>;
type Publication = NonNullable<PublicationHook["publication"]>;

function headerPresentation(
	publication: Publication,
	changing: boolean,
) {
	if (publication.identifiers.attention) {
		return { Icon: AlertCircleIcon, label: "DOI needs attention", color: "text-danger", spin: false };
	}
	if (changing) {
		return { Icon: Loading03Icon, label: "DOI publishing", color: "text-accent", spin: true };
	}
	if (publication.identifiers.doi) {
		return {
			Icon: CheckmarkBadge01Icon,
			label: "DOI",
			color: "text-emerald-600 dark:text-emerald-300",
			spin: false,
		};
	}
	return {
		Icon: CircleIcon,
		label: "No DOI",
		color: "text-black/40 dark:text-white/40",
		spin: false,
	};
}

export function AdminPublicationHeaderStatus({
	onPress,
	state,
}: {
	onPress: () => void;
	state: PublicationHook;
}) {
	const publication = state.publication;
	if (!publication) return null;
	const { providers } = publication;
	const changing = [providers.crossref, providers.zenodo].some(
		(provider) => provider.status.shouldPoll,
	);
	const { Icon, color, label, spin } = headerPresentation(publication, changing);
	return (
		<button
			className={`inline-flex h-6 items-center gap-1 whitespace-nowrap text-[11px] font-medium transition-opacity hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${color}`}
			onClick={onPress}
			type="button"
		>
			<span className="grid size-3 shrink-0 place-items-center overflow-hidden">
				<HugeiconsIcon icon={Icon} aria-hidden className={spin ? "animate-spin" : undefined} size={12} />
			</span>
			{label}
		</button>
	);
}
