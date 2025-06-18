"use client";

import { Session } from "next-auth";
import { useState } from "react";
import { twMerge } from "tailwind-merge";
import { Tooltip } from "@nextui-org/react";
import { BsPlus } from "react-icons/bs";
import { Button } from "@/components/nextui/Button";
import { BiSolidBookBookmark } from "react-icons/bi";
import { useTranslations } from "next-intl";

export default function UserCollection({
	collection,
	isHighlighted,
	onPress,
	isLoading,
}: {
	collection?: Session["user"]["collections"][number];
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
				!isLoading && <BsPlus className="size-6 invert dark:invert-0" />
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
					<span className="text-black/60 dark:text-white/60 font-medium text-xs truncate max-w-full flex items-center gap-1">
						<BiSolidBookBookmark className="size-3" />{" "}
						{collection?.numItems}
					</span>
				</div>
			)}
		</Button>
	);
}
