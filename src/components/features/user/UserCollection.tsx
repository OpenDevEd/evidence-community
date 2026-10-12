"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Add01Icon, BookBookmark01Icon } from "@hugeicons/core-free-icons";
import type { ReaderCollectionSummary, SharedCollectionSummary } from "@/lib/readers/data";
import { ReaderAvatar, readerDisplayName } from "@/components/layout/navbar/UserMenu";
import { twMerge } from "@/lib/tw-merge";
import { Tooltip } from "@nextui-org/react";
import { Button } from "@/components/nextui/Button";
import { useTranslations } from "next-intl";

export default function UserCollection({
	collection,
	isHighlighted,
	onPress,
	isLoading,
}: {
	collection?: ReaderCollectionSummary | SharedCollectionSummary;
	isHighlighted?: boolean;
	onPress?: () => void;
	isLoading?: boolean;
}) {
	const t = useTranslations("ui");

	return (
		<Button
			color={collection ? "secondary" : "card"}
			startContent={
				!collection &&
				!isLoading && <HugeiconsIcon icon={Add01Icon} className="size-6 invert dark:invert-0" />
			}
			className={twMerge(
				"flex items-center justify-center aspect-video min-h-0 max-h-auto h-full !p-3 whitespace-normal @container",
				!collection && "h-8 ml-auto",
				isHighlighted && "border-2 border-accent dark:border-accent"
			)}
			onPress={onPress}
			isDisabled={isLoading}
			aria-label={t("collectionButtonAriaLabel", {
				name: collection?.name || ""
			})}
		>
			{!!collection && (
				<div className="flex flex-col items-start justify-start w-full h-full gap-1">
					<span className="text-black/80 dark:text-white/80 font-medium text-base truncate max-w-full leading-none shrink-0">
						{collection?.name}
					</span>
					<div className="flex-1">
						<span className="text-sm text-black/60 dark:text-white/60 w-full text-start leading-4 break-all
							line-clamp-2
							@[150px]:line-clamp-3"
						>
							{collection?.description}
						</span>
					</div>
					<span className="flex w-full min-w-0 items-center gap-2">
						<span className="text-black/60 dark:text-white/60 font-medium text-xs truncate flex items-center gap-1 shrink-0">
							<HugeiconsIcon icon={BookBookmark01Icon} className="size-3" />{" "}
							{collection?.count}
						</span>
						{"owner" in collection ? (
							// Someone else's collection the reader edits: whose it is.
							<span className="ms-auto flex min-w-0 items-center gap-1.5 text-xs font-medium text-black/60 dark:text-white/60">
								<ReaderAvatar reader={collection.owner} size="sm" className="h-5 w-5 text-[9px]" aria-hidden />
								<span className="truncate">{readerDisplayName(collection.owner, t)}</span>
							</span>
						) : null}
					</span>
				</div>
			)}
		</Button>
	);
}
