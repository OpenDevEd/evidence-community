"use client";

import { Session } from "next-auth";
import { useState } from "react";
import { twMerge } from "tailwind-merge";
import { Tooltip } from "@nextui-org/react";
import { BsPlus } from "react-icons/bs";
import { Button } from "@/components/nextui/Button";

export default function UserCollection({
	collection,
	isHighlighted,
	onClick,
	isLoading,
}: {
	collection?: Session["user"]["collections"][number];
	isHighlighted?: boolean;
	onClick?: () => void;
	isLoading?: boolean;
}) {
	return (
		<Button
			color={isHighlighted ? "accent" : collection ? "secondary" : "card"}
			startContent={
				!collection &&
				!isLoading && <BsPlus className="size-6 invert dark:invert-0" />
			}
			className={twMerge(
				"flex items-center justify-center aspect-video min-h-0 max-h-auto h-full",
				!collection && "h-8 ml-auto"
			)}
			onClick={onClick}
			isDisabled={isLoading}
		>
			{!!collection && (
				<Tooltip
					isDisabled={!collection?.description}
					showArrow
					offset={32}
					delay={0}
					className="bg-white dark:bg-card"
					content={
						collection?.description ? (
							<div className="flex flex-col max-w-64">
								<span className="text-black/60 dark:text-white/60">
									Description
								</span>
								<span className="text-sm text-black/80 dark:text-white/80 break-all">
									{collection?.description}
								</span>
							</div>
						) : (
							""
						)
					}
				>
					<div className="flex flex-col items-center justify-center">
						<span className="text-sm text-black/60 dark:text-white/60">
							{collection?.name}
						</span>
						<span className="text-black/80 dark:text-white/80 font-medium text-2xl">
							{collection?.numItems}
						</span>
					</div>
				</Tooltip>
			)}
		</Button>
	);
}
