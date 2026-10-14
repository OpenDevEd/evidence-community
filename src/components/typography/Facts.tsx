import type { ReactNode } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/Hugeicon";

export type Fact = { icon: IconSvgElement; lead: ReactNode; text?: ReactNode };

/** Facts as rows: an icon, the fact as a short bold sentence, and what it means after it, muted. A card reads by its first words. */
export function Facts({ rows }: { rows: (Fact | false)[] }) {
  return <ul className="flex flex-col gap-2.5">{rows.filter((row): row is Fact => Boolean(row)).map((row, index) => <li key={index} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2.5 text-sm leading-6">
    <span className="mt-1 text-accent"><HugeiconsIcon icon={row.icon} size={16} aria-hidden className="shrink-0" /></span>
    <span><span className="font-semibold text-black dark:text-white">{row.lead}</span>{row.text && <span className="text-black/65 dark:text-white/65"> {row.text}</span>}</span>
  </li>)}</ul>;
}
