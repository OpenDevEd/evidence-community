"use client";

import { popover } from "@nextui-org/react";
import {
	cloneElement,
	isValidElement,
	use,
	useCallback,
	useRef,
	type KeyboardEvent,
	type ReactNode,
	type Ref,
} from "react";
import { mergeProps, useFocusable } from "react-aria";
import {
	Tooltip as AriaTooltip,
	TooltipTrigger,
	TooltipTriggerStateContext,
} from "react-aria-components";

type Side = "top" | "bottom" | "left" | "right";
type Placement = Side | `${Side}-start` | `${Side}-end`;

const ARIA_PLACEMENT = {
	top: "top",
	bottom: "bottom",
	left: "left",
	right: "right",
	"top-start": "top start",
	"top-end": "top end",
	"bottom-start": "bottom start",
	"bottom-end": "bottom end",
	"left-start": "left top",
	"left-end": "left bottom",
	"right-start": "right top",
	"right-end": "right bottom",
} as const;

/**
 * OpenScholar's hover card timing, for a tooltip that holds links or buttons:
 * it waits a moment before opening and stays long enough for the pointer to
 * cross into the card. Plain tooltips open and close at once.
 */
export const HOVER_CARD_DELAY = 250;
export const HOVER_CARD_CLOSE_DELAY = 80;

/** The library's own tooltip colour, used unless another one is asked for. */
const CARD_CONTENT = "bg-card_light dark:bg-card border border-white/10";

/**
 * HeroUI's tooltip motion: grow out of the point of the trigger the tooltip
 * belongs to, sliding in from that side, and leave quickly without catching
 * the pointer on the way out.
 */
const MOTION = [
	"origin-[var(--trigger-anchor-point)] motion-reduce:animate-none",
	"data-[entering]:animate-in data-[entering]:fade-in data-[entering]:zoom-in-90 data-[entering]:duration-150 data-[entering]:ease-[ease]",
	"data-[placement=top]:data-[entering]:slide-in-from-bottom-1 data-[placement=bottom]:data-[entering]:slide-in-from-top-1",
	"data-[placement=left]:data-[entering]:slide-in-from-right-1 data-[placement=right]:data-[entering]:slide-in-from-left-1",
	"data-[exiting]:animate-out data-[exiting]:fade-out data-[exiting]:zoom-out-95 data-[exiting]:duration-150 data-[exiting]:ease-[ease] data-[exiting]:pointer-events-none",
].join(" ");

type TooltipProps = {
	content: ReactNode;
	children: ReactNode;
	placement?: Placement;
	color?: "card" | "default" | "foreground" | "primary" | "secondary" | "success" | "warning" | "danger";
	size?: "sm" | "md" | "lg";
	radius?: "none" | "sm" | "md" | "lg" | "full";
	shadow?: "sm" | "md" | "lg";
	delay?: number;
	closeDelay?: number;
	offset?: number;
	crossOffset?: number;
	shouldFlip?: boolean;
	containerPadding?: number;
	showArrow?: boolean;
	disableAnimation?: boolean;
	isOpen?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (isOpen: boolean) => void;
	isDisabled?: boolean;
	/** Classes for the tooltip's content. */
	className?: string;
	classNames?: { base?: string; content?: string };
};

/**
 * NextUI's tooltip styles on React Aria's tooltip behaviour. The classes come
 * from NextUI's popover theme exactly as NextUI's Tooltip built them; React
 * Aria positions it, opens and closes it, and animates it the way HeroUI does.
 */
export function Tooltip({
	children,
	delay = 0,
	closeDelay = 0,
	isOpen,
	defaultOpen,
	onOpenChange,
	isDisabled,
	...overlay
}: TooltipProps) {
	return (
		<TooltipTrigger
			delay={delay}
			closeDelay={closeDelay}
			isOpen={isOpen}
			defaultOpen={defaultOpen}
			onOpenChange={onOpenChange}
			isDisabled={isDisabled}
		>
			<TooltipTriggerSlot>{children}</TooltipTriggerSlot>
			<TooltipStateOverrides>
				<TooltipOverlay {...overlay} isDisabled={isDisabled} />
			</TooltipStateOverrides>
		</TooltipTrigger>
	);
}

type OverlayProps = Omit<
	TooltipProps,
	"children" | "delay" | "closeDelay" | "isOpen" | "defaultOpen" | "onOpenChange"
>;

function TooltipOverlay({
	placement = "top",
	offset = 7,
	crossOffset = 0,
	shouldFlip = true,
	containerPadding = 12,
	showArrow = false,
	disableAnimation = false,
	...surface
}: OverlayProps) {
	return (
		<AriaTooltip
			placement={ARIA_PLACEMENT[placement]}
			offset={showArrow ? offset + 3 : offset}
			crossOffset={crossOffset}
			shouldFlip={shouldFlip}
			containerPadding={containerPadding}
			className={disableAnimation ? undefined : MOTION}
		>
			{({ placement: side }) => (
				<TooltipSurface
					{...surface}
					showArrow={showArrow}
					disableAnimation={disableAnimation}
					arrowPlacement={arrowPlacementFor(side, placement)}
				/>
			)}
		</AriaTooltip>
	);
}

/** The bubble itself: NextUI's base and content slots with their data attributes. */
function TooltipSurface({
	content,
	color = "card",
	size = "md",
	radius = "md",
	shadow = "sm",
	showArrow,
	disableAnimation,
	isDisabled,
	className,
	classNames,
	arrowPlacement,
}: Omit<OverlayProps, "placement" | "offset" | "crossOffset" | "shouldFlip" | "containerPadding"> & {
	arrowPlacement: string;
}) {
	const slots = popover({
		color: color === "card" ? "default" : color,
		size,
		radius,
		shadow,
		disableAnimation,
	});
	const state = {
		"data-open": "true",
		"data-arrow": showArrow || undefined,
		"data-disabled": isDisabled || undefined,
		"data-placement": arrowPlacement,
	};
	const contentClasses = [color === "card" && CARD_CONTENT, classNames?.content, className];
	return (
		<div data-slot="base" {...state} className={slots.base({ class: classNames?.base })}>
			<div
				data-slot="content"
				{...state}
				className={slots.content({ class: contentClasses.filter(Boolean).join(" ") })}
			>
				{content}
			</div>
		</div>
	);
}

/** The side the tooltip opened on, keeping a start or end alignment for the arrow. */
function arrowPlacementFor(side: string | null, placement: Placement) {
	const actual = side === "top" || side === "bottom" || side === "left" || side === "right" ? side : placement.split("-")[0];
	const alignment = placement.split("-")[1];
	return alignment ? `${actual}-${alignment}` : actual;
}

/**
 * Gives the child the trigger's hover and focus handlers without wrapping it,
 * so every tooltip keeps the element it had. Text alone becomes a paragraph,
 * as it did with NextUI.
 */
function TooltipTriggerSlot({ children }: { children: ReactNode }) {
	const ref = useRef<HTMLElement | null>(null);
	// useFocusable always adds tabIndex 0; the child keeps its own, as it did
	// with NextUI, so a tooltip never turns an icon or text into a Tab stop.
	const { focusableProps: { tabIndex: _tabIndex, ...focusable } } =
		useFocusable({}, ref);
	// A press anywhere in the trigger closes the tooltip. Capture, because a
	// wrapped button (a popover trigger in a span) stops its press events, and
	// an open tooltip would then take the Escape meant for that popover.
	const state = use(TooltipTriggerStateContext);
	const focusableProps = {
		...focusable,
		onPointerDownCapture: () => state?.close(true),
		onKeyDownCapture: (event: KeyboardEvent) => {
			if (event.key === "Enter" || event.key === " ") state?.close(true);
		},
	};
	const childRef = isValidElement<{ ref?: Ref<HTMLElement> }>(children)
		? children.props.ref
		: undefined;
	const setRef = useCallback(
		(node: HTMLElement | null) => {
			ref.current = node;
			assignRef(childRef, node);
		},
		[childRef],
	);
	if (!isValidElement<{ ref?: Ref<HTMLElement> }>(children)) {
		return (
			<p {...focusableProps} ref={setRef}>
				{children}
			</p>
		);
	}
	// Chain the child's own handlers with the trigger's for the props both set.
	const childProps = children.props as Record<string, unknown>;
	const shared = Object.fromEntries(
		Object.keys(focusableProps).map((key) => [key, childProps[key]]),
	);
	// The handlers come from a hook that was given the ref; nothing reads the
	// ref during render, the callback only writes it.
	// eslint-disable-next-line react-hooks/refs
	return cloneElement(children, {
		...mergeProps(shared, focusableProps),
		ref: setRef,
	});
}

function assignRef(target: Ref<HTMLElement> | undefined, node: HTMLElement | null) {
	if (typeof target === "function") target(node);
	else if (target) target.current = node;
}

/**
 * Two changes to React Aria's tooltip, through the state it reads:
 * - It skips the animation when one tooltip replaces another; HeroUI keeps
 *   it so the swap still fades.
 * - It closes the tooltip when the page scrolls, which makes a tall card
 *   impossible to scroll through. Its positioning asks for that close with
 *   `close(true)`; moving the pointer away calls `close()`. Ignoring the
 *   first keeps the tooltip open, moving with the page, as NextUI's did.
 */
function TooltipStateOverrides({ children }: { children: ReactNode }) {
	const state = use(TooltipTriggerStateContext);
	if (!state) return children;
	return (
		<TooltipTriggerStateContext
			value={{
				...state,
				shouldSkipAnimation: false,
				close: (immediate) => {
					if (!immediate) state.close();
				},
			}}
		>
			{children}
		</TooltipTriggerStateContext>
	);
}
