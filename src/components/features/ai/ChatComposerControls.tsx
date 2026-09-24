"use client";

import { ButtonGroup } from "@nextui-org/react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import type { ReactNode, Ref } from "react";
import { ImSpinner8 } from "react-icons/im";
import {
	PiBinocularsBold,
	PiGearSixBold,
	PiPaperPlaneTiltFill,
	PiPlayFill,
} from "react-icons/pi";
import { twMerge } from "@/lib/tw-merge";

import { Button } from "@/components/nextui/Button";
import { Tooltip } from "@/components/nextui/Tooltip";
import { ShortcutHint } from "./chat-shared";
import { SHORTCUT_KEYS } from "@/constants/shortcuts";
import type { ChatMode } from "@/types/ai";

type ChatComposerControlsProps = {
	/** The chat beside the results has less room than the full window. */
	compact?: boolean;
	canScreen: boolean;
	isDeepResearchEnabled: boolean;
	isInputReady: boolean;
	isScreening: boolean;
	isWaiting: boolean;
	mode: ChatMode;
	onModeChange: (mode: ChatMode) => void;
	onScreen: () => void;
	onScreeningSettings: () => void;
	prefersReducedMotion: boolean | null;
	screeningTooltip: string;
};

function ResearchModeButton({
	compact,
	mode,
	onModeChange,
}: Pick<ChatComposerControlsProps, "compact" | "mode" | "onModeChange">) {
	const tUI = useTranslations("ui");
	const isResearch = mode === "research";

	return (
		<Tooltip content={tUI("researchModeTooltip")}>
			<Button
				type="button"
				size="sm"
				variant="transparent"
				aria-pressed={isResearch}
				aria-label={tUI("researchMode")}
				onPress={() => onModeChange(isResearch ? "quick" : "research")}
				className={twMerge(
					"h-8 min-w-8 gap-1.5 bg-black/[0.035] px-2 text-black/55 transition-colors hover:bg-black/[0.06] dark:bg-white/[0.05] dark:text-white/55 dark:hover:bg-white/[0.08]",
					compact ? "rounded-xl" : "rounded-2xl",
					isResearch &&
						"bg-accent/10 text-accent hover:bg-accent/15 dark:bg-accent/15 dark:text-accent",
				)}
			>
				<motion.span
					initial={false}
					animate={{
						scale: isResearch ? 1.12 : 1,
						rotate: isResearch ? 0 : -8,
					}}
					transition={{ type: "spring", stiffness: 420, damping: 22 }}
					className="grid place-items-center"
				>
					<PiBinocularsBold className="size-4 shrink-0" />
				</motion.span>
				<span
					className={twMerge(
						"hidden whitespace-nowrap",
						compact ? "xl:inline" : "sm:inline",
					)}
				>
					{tUI("researchMode")}
				</span>
			</Button>
		</Tooltip>
	);
}

function ScreeningButtons({
	compact,
	canScreen,
	isScreening,
	isWaiting,
	onScreen,
	onScreeningSettings,
	screeningTooltip,
}: Pick<
	ChatComposerControlsProps,
	| "compact"
	| "canScreen"
	| "isScreening"
	| "isWaiting"
	| "onScreen"
	| "onScreeningSettings"
	| "screeningTooltip"
>) {
	const tUI = useTranslations("ui");
	const settingsLabel = `${tUI("smartScreening")} ${tUI("settings")}`;

	return (
		<ButtonGroup
			className={twMerge(
				"shrink-0 overflow-hidden bg-black/[0.035] dark:bg-white/[0.05]",
				compact ? "rounded-xl" : "rounded-2xl",
			)}
		>
			<Tooltip content={settingsLabel}>
				<Button
					type="button"
					size="sm"
					variant="transparent"
					className="h-8 min-w-8 gap-1.5 rounded-none border-0 px-2 text-black/55 transition-colors hover:bg-black/[0.05] dark:text-white/55 dark:hover:bg-white/[0.06]"
					isDisabled={isScreening}
					aria-label={settingsLabel}
					onPress={onScreeningSettings}
				>
					<PiGearSixBold className="size-4 shrink-0 transition-transform duration-300 group-hover:rotate-45 motion-reduce:transition-none" />
					<span
						className={twMerge(
							"hidden whitespace-nowrap",
							compact ? "xl:inline" : "sm:inline",
						)}
					>
						{tUI("smartScreening")}
					</span>
				</Button>
			</Tooltip>
			<Tooltip content={screeningTooltip}>
				<Button
					isIconOnly
					type="button"
					size="sm"
					variant="transparent"
					className="!h-8 !w-8 !min-w-8 shrink-0 rounded-none border-0 border-l border-black/[0.06] bg-accent/10 text-accent transition-colors hover:bg-accent/15 dark:border-white/[0.08] dark:bg-accent/15 dark:text-accent dark:hover:bg-accent/20"
					isDisabled={isWaiting || isScreening || !canScreen}
					aria-label={tUI("smartScreening")}
					onPress={onScreen}
				>
					{isScreening ? (
						<ImSpinner8 className="size-3.5 animate-spin" />
					) : (
						<PiPlayFill className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
					)}
				</Button>
			</Tooltip>
		</ButtonGroup>
	);
}

function SendButton({
	compact,
	isInputReady,
	isWaiting,
	prefersReducedMotion,
}: Pick<
	ChatComposerControlsProps,
	"compact" | "isInputReady" | "isWaiting" | "prefersReducedMotion"
>) {
	const tUI = useTranslations("ui");
	const still = prefersReducedMotion || isWaiting;

	return (
		<motion.div
			whileHover={still ? undefined : { scale: 1.07 }}
			whileTap={still ? undefined : { scale: 0.9 }}
			className="shrink-0"
		>
			<Tooltip
				content={
					<span className="flex flex-col gap-1">
						<ShortcutHint
							label={tUI("sendMessageAriaLabel")}
							keys={[SHORTCUT_KEYS.enter]}
						/>
						<ShortcutHint
							label={tUI("newLine")}
							keys={[
								`${SHORTCUT_KEYS.shift} ${SHORTCUT_KEYS.enter}`,
							]}
						/>
					</span>
				}
			>
				<Button
					isDisabled={isWaiting}
					type="submit"
					isIconOnly
					color="accent"
					size="sm"
					className={twMerge(
						"group/send !h-8 !w-8 !min-w-8 shrink-0 border-0",
						compact ? "rounded-xl" : "rounded-2xl",
					)}
					aria-label={tUI("sendMessageAriaLabel")}
					aria-keyshortcuts="Enter"
				>
					<AnimatePresence mode="wait" initial={false}>
						<motion.span
							key={
								isWaiting
									? "waiting"
									: isInputReady
										? "ready"
										: "idle"
							}
							initial={
								prefersReducedMotion
									? false
									: { opacity: 0, scale: 0.72, x: -2, y: 2 }
							}
							animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
							exit={{ opacity: 0, scale: 0.72 }}
							transition={{
								type: "spring",
								stiffness: 520,
								damping: 30,
							}}
							className="grid place-items-center"
						>
							{isWaiting ? (
								<ImSpinner8 className="size-4 animate-spin" />
							) : (
								<PiPaperPlaneTiltFill className="size-4 transition-transform duration-200 group-hover/send:translate-x-0.5 group-hover/send:-translate-y-0.5 motion-reduce:transition-none" />
							)}
						</motion.span>
					</AnimatePresence>
				</Button>
			</Tooltip>
		</motion.div>
	);
}

/** The box around the message field: it lifts and glows while focused. */
export function ChatComposerShell({
	children,
	className,
	ref,
	isComposerFocused,
	isWaiting,
	prefersReducedMotion,
	setComposerFocused,
}: {
	children: ReactNode;
	className?: string;
	ref?: Ref<HTMLDivElement>;
	isComposerFocused: boolean;
	isWaiting: boolean;
	prefersReducedMotion: boolean | null;
	setComposerFocused: (focused: boolean) => void;
}) {
	const lifted = isComposerFocused && !prefersReducedMotion;

	return (
		<motion.div
			ref={ref}
			initial={false}
			animate={{ y: lifted ? -2 : 0, scale: lifted ? 1.004 : 1 }}
			whileHover={
				prefersReducedMotion || isWaiting ? undefined : { y: -1 }
			}
			transition={{ type: "spring", stiffness: 360, damping: 28 }}
			onFocusCapture={() => setComposerFocused(true)}
			onBlurCapture={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) {
					setComposerFocused(false);
				}
			}}
			className={twMerge(
				"group/composer relative z-10 w-full min-w-0 overflow-hidden border border-black/[0.08] bg-white shadow-composer transition-composer duration-200 focus-within:border-accent/45 focus-within:shadow-composer-focus-dark dark:border-white/10 dark:shadow-none dark:focus-within:shadow-composer-focus",
				className,
			)}
		>
			{children}
		</motion.div>
	);
}

/**
 * The row under the message box: research mode, smart screening, and send.
 * Shared by the chat window and the chat beside the results.
 */
export function ChatComposerControls({
	compact = false,
	canScreen,
	isDeepResearchEnabled,
	isInputReady,
	isScreening,
	isWaiting,
	mode,
	onModeChange,
	onScreen,
	onScreeningSettings,
	prefersReducedMotion,
	screeningTooltip,
}: ChatComposerControlsProps) {
	return (
		<div
			className={twMerge(
				"mt-1 flex min-w-0 items-center justify-between gap-2 border-t border-black/[0.06] px-1 dark:border-white/[0.08]",
				compact ? "pt-1.5" : "pt-2",
			)}
		>
			<div className="flex min-w-0 items-center gap-1">
				{isDeepResearchEnabled && (
					<ResearchModeButton
						compact={compact}
						mode={mode}
						onModeChange={onModeChange}
					/>
				)}
				<ScreeningButtons
					compact={compact}
					canScreen={canScreen}
					isScreening={isScreening}
					isWaiting={isWaiting}
					onScreen={onScreen}
					onScreeningSettings={onScreeningSettings}
					screeningTooltip={screeningTooltip}
				/>
			</div>
			<SendButton
				compact={compact}
				isInputReady={isInputReady}
				isWaiting={isWaiting}
				prefersReducedMotion={prefersReducedMotion}
			/>
		</div>
	);
}
