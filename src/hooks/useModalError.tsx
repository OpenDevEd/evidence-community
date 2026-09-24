"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { useRef, useState, useMemo, useCallback } from "react";
import { twMerge } from "@/lib/tw-merge";
import { animate as animateFramer, AnimatePresence, motion, type MotionProps } from "framer-motion";
import { useDebounce } from "@/hooks/useDebounce";
import { useTranslations } from "next-intl";

interface UseModalErrorProps {
	animationDuration?: number;
	initial?: MotionProps["initial"];
	animate?: MotionProps["animate"];
	exit?: MotionProps["exit"];
}

export function useModalError({
	animationDuration = 0.5,
	initial,
	animate,
	exit,
}: UseModalErrorProps = {}) {
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [debouncedSetErrorMessage, _] = useDebounce(
		() => setErrorMessage(null),
		animationDuration * 5 * 1000
	);
	const containerRef = useRef<HTMLDivElement>(null);
	const t = useTranslations("ui");
	const errorClassName = useMemo(
		() =>
			twMerge(
				"transition-colors duration-500",
				errorMessage && "!bg-red-800/25"
			),
		[errorMessage]
	);

	const displayOnError = (error: string) => {
		if (error && containerRef.current?.parentElement?.parentElement) {
			setErrorMessage(error);
			debouncedSetErrorMessage();
			animateFramer(
				containerRef.current.parentElement.parentElement,
				{
					x: [-10, 10, -10, 10, -5, 5, -2, 2, 0],
				},
				{ duration: animationDuration }
			);
			return true;
		} else {
			return false;
		}
	};

	const ErrorField = useCallback(
		({ customMessage }: { customMessage?: string }) => (
			<motion.div
				role="alert"
				aria-label={customMessage || errorMessage || t("errorMessageAriaLabel")}
				initial={initial}
				animate={animate}
				exit={exit}
				className="bg-danger rounded-2xl overflow-hidden"
			>
				<div className="p-2 grid grid-cols-[auto_1fr] gap-2">
					<HugeiconsIcon icon={AlertCircleIcon}
						className="size-8 p-1 aspect-square bg-black/50 rounded-full text-white"
						aria-hidden="true"
					/>
					<span
						className="text-sm flex items-center whitespace-pre-wrap text-white"
						aria-hidden="true"
					>
						{customMessage || errorMessage}
					</span>
				</div>
			</motion.div>
		),
		[animate, errorMessage, exit, initial, t]
	);

	return {
		errorMessage,
		containerRef,
		setErrorMessage,
		debouncedSetErrorMessage,
		displayOnError,
		errorClassName,
		ErrorField,
	};
}
