"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import {
	AlertCircleIcon,
	CheckmarkBadge01Icon,
	CircleIcon,
	Loading03Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/nextui/Button";
import type { useAdminPublication } from "./useAdminPublication";

type PublicationHook = ReturnType<typeof useAdminPublication>;

function headerPresentation(
	attention: boolean,
	changing: boolean,
	hasDoi: boolean,
) {
	if (attention) {
		return {
			Icon: AlertCircleIcon,
			label: "DOI needs attention",
			color: "text-danger",
			spin: false,
		};
	}
	if (changing) {
		return {
			Icon: Loading03Icon,
			label: "DOI publishing",
			color: "text-accent",
			spin: true,
		};
	}
	if (hasDoi) {
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
	const presentation = headerPresentation(
		Boolean(publication?.identifiers.attention),
		Boolean(
					publication &&
					[
						publication.providers.crossref,
						publication.providers.zenodo,
					].some((provider) => provider.status.shouldPoll),
				),
		Boolean(publication?.identifiers.doi),
	);
	const { Icon, color, label, spin } = presentation;
	return (
		<Button
			size="xs"
			variant="transparent"
			className={`h-8 min-w-0 gap-2 rounded-lg px-0 text-xs ${color}`}
			onPress={onPress}
		>
			<span className="grid size-3 shrink-0 place-items-center overflow-hidden">
				<HugeiconsIcon
					icon={Icon}
					aria-hidden
					className={spin ? "animate-spin" : undefined}
					size={12}
				/>
			</span>
			{label}
		</Button>
	);
}
