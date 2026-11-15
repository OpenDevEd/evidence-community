"use client";

import { useTranslations } from "next-intl";
import { HOVER_CARD_CLOSE_DELAY, HOVER_CARD_DELAY, Tooltip } from "@/components/nextui/Tooltip";
import { useReducedMotion } from "framer-motion";
import { AuthorAvatar } from "@/components/authors/AuthorAvatar";
import { useState, type ReactElement, type ReactNode } from "react";
import { ArrowUpRight01Icon, Building03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";

import type { AuthorProfile } from "@/lib/authors/profiles";

export function AuthorProfileHover({
	profile,
	details,
	children,
}: {
	profile: AuthorProfile;
	/** Anything the page knows about this author that the profile does not. */
	details?: ReactNode;
	children: ReactElement;
}) {
	const t = useTranslations("topics");
	const [open, setOpen] = useState(false);
	const reducedMotion = useReducedMotion();
	return (
		<Tooltip
			color="default"
			isOpen={open}
			onOpenChange={setOpen}
			delay={HOVER_CARD_DELAY}
			closeDelay={HOVER_CARD_CLOSE_DELAY}
			placement="left"
			offset={12}
			disableAnimation={Boolean(reducedMotion)}
			className="w-[352px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-black/10 bg-card_light p-0 shadow-xl dark:border-white/10 dark:bg-card"
			content={
				<div>
					<div className="p-5">
						<div className="flex items-center gap-3.5">
							<AuthorAvatar
								src={profile.photo ?? undefined}
								name={profile.name}
								className="size-14 shrink-0 self-start"
							/>
							<div className="min-w-0">
								<h3 className="text-lg font-semibold leading-tight">
									{profile.name}
								</h3>
								{profile.headline && (
									<p className="mt-1 text-xs leading-relaxed text-black/55 dark:text-white/55">
										{profile.headline}
									</p>
								)}
							</div>
						</div>
						{profile.affiliation && (
							<p className="mt-4 flex items-center gap-2 text-xs font-medium text-black/70 dark:text-white/70">
								<HugeiconsIcon
									icon={Building03Icon}
									size={16}
									className="shrink-0 text-accent"
								/>
								{profile.affiliation}
							</p>
						)}
						{profile.bio && (
							<p className="mt-3 text-sm leading-relaxed text-black/60 dark:text-white/60">
								{profile.bio}
							</p>
						)}
						{details && <div className="mt-4">{details}</div>}
					</div>
					<div className="border-t border-black/[0.07] bg-black/[0.025] p-3 dark:border-white/[0.07] dark:bg-white/[0.025]">
						<Button
							as="a"
							role="link"
							href={profile.url}
							target="_blank"
							rel="noopener noreferrer"
							size="md"
							variant="transparent"
							className="w-full justify-between px-2 text-sm font-medium"
							endContent={
								<HugeiconsIcon
									icon={ArrowUpRight01Icon}
									size={18}
								/>
							}
						>
							{t("viewOpenscholarProfile")}
						</Button>
					</div>
				</div>
			}
		>
			{children}
		</Tooltip>
	);
}
