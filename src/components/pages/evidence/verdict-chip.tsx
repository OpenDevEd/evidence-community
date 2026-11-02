import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { twMerge } from "@/lib/tw-merge";
import { VERDICTS, type Verdict } from "./data";
import { VERDICT_TONE } from "./palette";
import { VERDICT } from "./verdicts";

const muted = "text-black/55 dark:text-white/55";

/** A verdict's colours as CSS variables; the page switches theme with its `dark` class. */
function tones(name: Verdict) {
	const tone = VERDICT_TONE[name];
	return { "--soft": tone.soft, "--ink": tone.ink, "--ring": tone.ring, "--soft-dark": tone.darkSoft, "--ink-dark": tone.darkInk, "--ring-dark": tone.darkRing } as CSSProperties;
}
const inked = "text-[color:var(--ink)] dark:text-[color:var(--ink-dark)]";

export function VerdictIcon({ verdict, size = 15 }: { verdict: number; size?: number }) {
	const name = VERDICTS[verdict];
	if (name === "notAssessed") return null;
	return <HugeiconsIcon icon={VERDICT[name].icon} size={size} aria-hidden style={tones(name)} className={twMerge("shrink-0", inked)} />;
}

export function VerdictChip({ verdict, className }: { verdict: number; className?: string }) {
	const t = useTranslations("evidenceMap");
	const name = VERDICTS[verdict];
	if (name === "notAssessed") return <span className={twMerge("text-xs", muted)}>{t("notCheckedYet")}</span>;
	return (
		<span style={tones(name)} className={twMerge("inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[color:var(--soft)] px-2 py-1 text-xs font-semibold ring-1 ring-inset ring-[color:var(--ring)] dark:bg-[color:var(--soft-dark)] dark:ring-[color:var(--ring-dark)]", inked, className)}>
			<HugeiconsIcon icon={VERDICT[name].icon} size={14} aria-hidden className="shrink-0" />
			{t(VERDICT[name].label)}
		</span>
	);
}
