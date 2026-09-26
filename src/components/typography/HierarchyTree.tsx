import type { ReactNode } from "react";

type Level = { key: string; name: string };

/**
 * A path from the top level down to the current one, every level in full and
 * indented under its parent. The caller renders each level's link; the last
 * level is the current one.
 */
export function HierarchyTree<T extends Level>({
	label,
	levels,
	renderLink,
}: {
	label: string;
	levels: readonly T[];
	renderLink: (level: T, index: number, className: string) => ReactNode;
}) {
	return (
		<ol aria-label={label} className="space-y-1 text-xs">
			{levels.map((level, index) => {
				const isCurrent = index === levels.length - 1;
				return (
					<li
						key={level.key}
						aria-current={isCurrent || undefined}
						className="flex items-start gap-1.5"
						style={{ paddingLeft: `${Math.max(index - 1, 0) * 14}px` }}
					>
						{index > 0 && (
							<span
								aria-hidden
								className="mt-0.5 h-2 w-2.5 shrink-0 rounded-bl-sm border-b border-l border-black/25 dark:border-white/25"
							/>
						)}
						{renderLink(
							level,
							index,
							`text-xs hover:text-accent hover:underline ${isCurrent ? "font-semibold text-inherit" : "text-black/60 dark:text-white/60"}`,
						)}
					</li>
				);
			})}
		</ol>
	);
}
