"use client";

import { Avatar, type AvatarProps } from "@nextui-org/react";
import { UserIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { twMerge } from "tailwind-merge";

/** Author portraits always fall back to a person, never generated initials. */
export function AuthorAvatar(props: AvatarProps) {
	return (
		<Avatar
			{...props}
			classNames={{
				...props.classNames,
				fallback: twMerge("h-full w-full", props.classNames?.fallback),
			}}
			showFallback
			fallback={<HugeiconsIcon icon={UserIcon} size="50%" aria-hidden />}
		/>
	);
}
