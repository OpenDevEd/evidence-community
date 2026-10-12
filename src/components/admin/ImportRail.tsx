"use client";

import { FileImportIcon, Link04Icon, Pdf01Icon, SparklesIcon, Tick02Icon } from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";

export type ImportKind = "dois" | "files" | "pdfs";
export type ImportStage = "done" | "input" | "review";

const KINDS: { kind: ImportKind; icon: typeof Pdf01Icon; label: string; hint: string }[] = [
	{ hint: "AI fills metadata, topics and checks", icon: Pdf01Icon, kind: "pdfs", label: "PDFs" },
	{ hint: "Paste one or hundreds", icon: Link04Icon, kind: "dois", label: "DOIs" },
	{ hint: "RIS, BibTeX, CSL JSON and more", icon: FileImportIcon, kind: "files", label: "Bibliography files" },
];

const STAGES: ImportStage[] = ["input", "review", "done"];

/** The source chooser and the three steps, with what each step holds so far. */
export function ImportRail({
	kind,
	locked,
	onKindChange,
	stage,
	stepNotes,
}: {
	kind: ImportKind;
	locked: boolean;
	onKindChange: (kind: ImportKind) => void;
	stage: ImportStage;
	stepNotes: Record<ImportStage, string>;
}) {
	const current = STAGES.indexOf(stage);
	return (
		<aside className="flex flex-col gap-6 border-black/[0.06] bg-black/[0.025] p-5 dark:border-white/[0.06] dark:bg-white/[0.02] md:border-e">
			<div>
				<h2 className="text-lg font-semibold tracking-tight text-black/90 dark:text-white/90">Import records</h2>
				<p className="mt-0.5 text-xs text-black/50 dark:text-white/50">Each one becomes an unpublished draft</p>
			</div>
			<div className="flex flex-col gap-1" role="radiogroup" aria-label="Import from">
				{KINDS.map((option) => {
					const selected = option.kind === kind;
					return (
						<button
							aria-checked={selected}
							className={`group flex items-center gap-3 rounded-xl p-2.5 text-start outline-none transition-[background-color,box-shadow,opacity] duration-200 focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default ${selected ? "bg-white shadow-card-lifted ring-1 ring-black/[0.06] dark:bg-white/[0.07] dark:ring-white/10" : "hover:bg-black/[0.035] disabled:opacity-45 dark:hover:bg-white/[0.04]"}`}
							disabled={locked && !selected}
							key={option.kind}
							onClick={() => onKindChange(option.kind)}
							role="radio"
							type="button"
						>
							<span className={`flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 ${selected ? "bg-accent text-white" : "bg-black/[0.05] text-black/55 dark:bg-white/[0.07] dark:text-white/60"}`}>
								<HugeiconsIcon aria-hidden icon={option.icon} size={18} />
							</span>
							<span className="min-w-0">
								<span className="flex items-center gap-1.5 text-sm font-medium text-black/85 dark:text-white/85">
									{option.label}
									{option.kind === "pdfs" ? <HugeiconsIcon aria-hidden className="text-accent" icon={SparklesIcon} size={13} /> : null}
								</span>
								<span className="block text-xs leading-4 text-black/50 dark:text-white/50">{option.hint}</span>
							</span>
						</button>
					);
				})}
			</div>
			<ol className="mt-auto hidden flex-col md:flex" aria-label="Steps">
				{(["Add", "Review", "Import"] as const).map((label, index) => {
					const done = index < current || stage === "done";
					const active = index === current && stage !== "done";
					return (
						<li className="relative flex gap-3 pb-5 last:pb-0" key={label}>
							{index < 2 ? (
								<span aria-hidden className="absolute start-[0.6875rem] top-6 h-[calc(100%-1.5rem)] w-px bg-black/10 dark:bg-white/10">
									<span className={`block w-full origin-top bg-accent transition-transform duration-500 ease-out motion-reduce:transition-none ${index < current ? "h-full scale-y-100" : "h-full scale-y-0"}`} />
								</span>
							) : null}
							<span
								aria-hidden
								className={`relative flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums transition-colors duration-300 ${done ? "bg-accent text-white" : active ? "bg-white text-accent ring-2 ring-accent dark:bg-card" : "bg-black/[0.06] text-black/45 dark:bg-white/[0.08] dark:text-white/45"}`}
							>
								{done ? <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2.4} /> : index + 1}
							</span>
							<span className="min-w-0 pt-0.5">
								<span className={`block text-sm font-medium ${active || done ? "text-black/85 dark:text-white/85" : "text-black/45 dark:text-white/45"}`} aria-current={active ? "step" : undefined}>
									{label}
								</span>
								<span className="block min-h-4 text-xs tabular-nums text-black/50 dark:text-white/50">{stepNotes[STAGES[index]!]}</span>
							</span>
						</li>
					);
				})}
			</ol>
		</aside>
	);
}
