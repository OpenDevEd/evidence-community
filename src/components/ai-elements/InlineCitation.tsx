"use client";

import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import type { ComponentProps } from "react";
import { twMerge } from "tailwind-merge";

// Adapted from Vercel AI Elements' Inline Citation component. The project uses
// its own design tokens rather than shadcn's Badge/HoverCard wrappers, while
// retaining the same composable citation/card structure.
export type InlineCitationProps = ComponentProps<"span">;

export function InlineCitation({
	className,
	...props
}: InlineCitationProps) {
	return (
		<span
			className={twMerge("group/citation inline-flex align-middle", className)}
			{...props}
		/>
	);
}

export type InlineCitationCardProps = ComponentProps<
	typeof HoverCardPrimitive.Root
>;

export function InlineCitationCard({
	openDelay = 250,
	closeDelay = 80,
	children,
	...props
}: InlineCitationCardProps) {
	return (
		<HoverCardPrimitive.Root
			openDelay={openDelay}
			closeDelay={closeDelay}
			{...props}
		>
			{children}
		</HoverCardPrimitive.Root>
	);
}

export type InlineCitationCardTriggerProps = ComponentProps<
	typeof HoverCardPrimitive.Trigger
>;

export function InlineCitationCardTrigger(
	{ children, ...props }: InlineCitationCardTriggerProps,
) {
	return (
		<HoverCardPrimitive.Trigger asChild {...props}>
			{children}
		</HoverCardPrimitive.Trigger>
	);
}

export type InlineCitationCardBodyProps = ComponentProps<
	typeof HoverCardPrimitive.Content
>;

export function InlineCitationCardBody({
	className,
	sideOffset = 8,
	align = "start",
	children,
	...props
}: InlineCitationCardBodyProps) {
	return (
		<HoverCardPrimitive.Portal>
			{/* React Aria modals otherwise treat clicks in this portal as outside clicks. */}
			<HoverCardPrimitive.Content
				align={align}
				collisionPadding={12}
				sideOffset={sideOffset}
				className={twMerge(
					"z-[10000] w-80 origin-[var(--radix-hover-card-content-transform-origin)] rounded-2xl border border-black/[0.08] bg-white p-0 text-black shadow-xl outline-none duration-150 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none dark:border-white/10 dark:bg-card dark:text-white",
					className,
				)}
				{...props}
				data-react-aria-top-layer=""
			>
				{children}
			</HoverCardPrimitive.Content>
		</HoverCardPrimitive.Portal>
	);
}

export type InlineCitationSourceProps = ComponentProps<"div">;

export function InlineCitationSource({
	className,
	...props
}: InlineCitationSourceProps) {
	return <div className={twMerge("space-y-1", className)} {...props} />;
}
