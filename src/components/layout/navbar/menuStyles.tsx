import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/Hugeicon";
import { twMerge } from "@/lib/tw-merge";

/**
 * One look for the header's menus (the condensed actions menu and the
 * reader's account menu): the same padding on every side, 40px rows, full
 * contrast labels and icons in one colour.
 */
export const navbarMenuDropdownClasses = { content: "p-1.5 min-w-[min(15rem,calc(100vw-1.5rem))]" };

export const navbarMenuClasses = {
	base: "p-0 gap-0",
	list: "gap-0",
};

export const navbarMenuItemClasses = {
	base: twMerge(
		"h-10 px-3 gap-3 rounded-xl",
		"text-foreground dark:text-white",
		"data-[hover=true]:bg-black/[0.05] dark:data-[hover=true]:bg-white/[0.07]",
		"data-[focus-visible=true]:outline-accent",
	),
	title: "text-medium font-medium",
};

/** Sections carry no margins of their own; the divider gives the only gap. */
export const navbarMenuSectionClasses = {
	base: "m-0",
	divider: "my-1.5 bg-black/[0.07] dark:bg-white/[0.08]",
};

export function NavbarMenuIcon({ icon, className }: { icon: IconSvgElement; className?: string }) {
	return <HugeiconsIcon icon={icon} aria-hidden className={twMerge("size-5 shrink-0 text-foreground/60 dark:text-white/60", className)} />;
}

/** The on and off state of a setting, drawn like a small switch. */
export function NavbarMenuSwitch({ on }: { on: boolean }) {
	return (
		<span
			aria-hidden
			className={twMerge(
				"relative h-5 w-9 shrink-0 rounded-full transition-colors motion-reduce:transition-none",
				on ? "bg-accent" : "bg-black/15 dark:bg-white/20",
			)}
		>
			<span
				className={twMerge(
					"absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-[inset-inline-start] motion-reduce:transition-none",
					on ? "start-[1.125rem]" : "start-0.5",
				)}
			/>
		</span>
	);
}

/** The row that starts signing in, filled like the header's Sign in button. */
export const navbarMenuSignInClasses = twMerge(
	"bg-accent text-white dark:text-white",
	"data-[hover=true]:bg-accent-600 dark:data-[hover=true]:bg-accent-600 data-[hover=true]:text-white",
);
