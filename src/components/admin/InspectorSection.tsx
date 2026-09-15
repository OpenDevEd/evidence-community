import type { ReactNode } from "react";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import type { Add01Icon } from "@hugeicons/core-free-icons";

export function InspectorSection({
	actions,
	children,
	icon: Icon,
	id,
	title,
}: {
	actions?: ReactNode;
	children: ReactNode;
	icon: typeof Add01Icon;
	id?: string;
	title: string;
}) {
	return (
		<section className="scroll-mt-4 py-5 first:pt-0" id={id}>
			<div className="mb-3 flex min-h-6 items-center gap-2.5">
				<HugeiconsIcon
					icon={Icon}
					aria-hidden
					className="shrink-0 text-black/35 dark:text-white/35"
					size={15}
					strokeWidth={1.8}
				/>
				<h3 className="text-sm font-semibold text-black/80 dark:text-white/85">
					{title}
				</h3>
				<span
					aria-hidden
					className="h-px min-w-4 flex-1 bg-black/[0.06] dark:bg-white/[0.07]"
				/>
				{actions}
			</div>
			{children}
		</section>
	);
}
