"use client";

import {
	useEffect,
	useRef,
	type CSSProperties,
	type InputHTMLAttributes,
	type ReactNode,
} from "react";
import { twMerge } from "tailwind-merge";

type CheckboxSize = "sm" | "lg" | "xl";

type CheckboxClassNames = {
	base?: string;
	hiddenInput?: string;
	icon?: string;
	label?: string;
	wrapper?: string;
};

type CheckboxProps = Omit<
	InputHTMLAttributes<HTMLInputElement>,
	| "checked"
	| "className"
	| "color"
	| "defaultChecked"
	| "onChange"
	| "size"
	| "style"
> & {
	children?: ReactNode;
	className?: string;
	classNames?: CheckboxClassNames;
	isDisabled?: boolean;
	isIndeterminate?: boolean;
	isSelected?: boolean;
	onValueChange?: (selected: boolean) => void;
	size?: CheckboxSize;
	style?: CSSProperties;
};

const checkboxSizes: Record<
	CheckboxSize,
	{ icon: string; label: string; wrapper: string }
> = {
	sm: {
		icon: "h-2 w-3",
		label: "text-sm",
		wrapper: "me-2 size-4 rounded-[5px]",
	},
	lg: {
		icon: "h-4 w-5",
		label: "text-xl",
		wrapper: "mr-3 size-7 rounded-lg rtl:ml-2 rtl:mr-0",
	},
	xl: {
		icon: "h-3 w-4",
		label: "text-xl",
		wrapper: "mr-3 size-6 rounded-lg rtl:ml-2 rtl:mr-0",
	},
};

export function Checkbox({
	children,
	className,
	classNames,
	isDisabled = false,
	isIndeterminate = false,
	isSelected = false,
	onValueChange,
	size = "xl",
	style,
	...inputProps
}: CheckboxProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const selected = isSelected || isIndeterminate;
	const sizeClasses = checkboxSizes[size];

	useEffect(() => {
		if (inputRef.current) {
			inputRef.current.indeterminate = isIndeterminate;
		}
	}, [isIndeterminate]);

	return (
		<label
			className={twMerge(
				"group relative -m-2 inline-flex max-w-fit select-none items-center justify-start p-2",
				isDisabled ? "cursor-default opacity-45" : "cursor-pointer",
				classNames?.base,
				className,
			)}
			data-disabled={isDisabled || undefined}
			data-selected={selected || undefined}
			style={style}
		>
			<input
				{...inputProps}
				ref={inputRef}
				aria-checked={isIndeterminate ? "mixed" : undefined}
				checked={isSelected}
				className={twMerge(
					"peer absolute inset-0 z-10 size-full cursor-inherit appearance-none border-0 p-0 opacity-0 [-webkit-appearance:none]",
					classNames?.hiddenInput,
				)}
				disabled={isDisabled}
				onChange={(event) =>
					onValueChange?.(event.currentTarget.checked)
				}
				type="checkbox"
			/>
			<span
				aria-hidden="true"
				className={twMerge(
					"inline-flex shrink-0 items-center justify-center border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-focus peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
					sizeClasses.wrapper,
					selected
						? "border-accent bg-accent text-white"
						: "border-default bg-transparent text-transparent",
					classNames?.wrapper,
				)}
			>
				{selected ? (
					<svg
						aria-hidden="true"
						className={twMerge(sizeClasses.icon, classNames?.icon)}
						fill="none"
						role="presentation"
						stroke="currentColor"
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth="2.25"
						viewBox="0 0 18 12"
					>
						{isIndeterminate ? (
							<line x1="3" x2="15" y1="6" y2="6" />
						) : (
							<path d="m2.5 6 4 4 9-8" />
						)}
					</svg>
				) : null}
			</span>
			{children ? (
				<span
					className={twMerge(
						"relative select-none font-normal text-black/40 dark:text-white/40",
						sizeClasses.label,
						classNames?.label,
					)}
				>
					{children}
				</span>
			) : null}
		</label>
	);
}
