"use client";

import { useRef, useState, useMemo, useCallback } from "react";
import { twMerge } from "tailwind-merge";
import { animate as animateFramer, AnimatePresence, AnimationProps, motion } from "framer-motion";
import { useDebounce } from "@/hooks/useDebounce";
import { BiErrorCircle } from "react-icons/bi";
import { useTranslations } from "next-intl";

interface UseModalErrorProps {
	animationDuration?: number;
	initial?: AnimationProps["initial"];
	animate?: AnimationProps["animate"];
	exit?: AnimationProps["exit"];
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
				aria-label={errorMessage || t("errorMessageAriaLabel")}
				initial={initial}
				animate={animate}
				exit={exit}
				className="bg-danger rounded-2xl overflow-hidden"
			>
				<div className="p-2 grid grid-cols-[auto_1fr] gap-2">
					<BiErrorCircle 
						className="size-8 p-1 aspect-square bg-black/50 rounded-full fill-white" 
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
		[errorMessage]
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
