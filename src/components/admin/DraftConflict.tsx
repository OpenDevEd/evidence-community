"use client";

import { adminFieldLabel } from "@/lib/admin/errors";
import { useState } from "react";
import {
	PencilIcon,
	Tick01Icon,
	AlertCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";

const sourceLabels = {
	draft: { icon: PencilIcon, label: "Your draft" },
	published: { icon: Tick01Icon, label: "Editor's published version" },
};

export function DraftConflict({
	payload,
	published,
	conflictFields,
	disabled,
	onResolve,
}: {
	payload: Record<string, unknown>;
	published: Record<string, unknown>;
	conflictFields: string[];
	disabled: boolean;
	onResolve: (choices: Record<string, "draft" | "published">) => void;
}) {
	const [choices, setChoices] = useState<
		Record<string, "draft" | "published">
	>({});
	const fields = conflictFields.map((key) => ({
		key,
		label: adminFieldLabel(key),
	}));
	const count = Object.keys(choices).length;
	return (
		<section
			aria-label="Resolve draft conflicts"
			className="overflow-hidden rounded-xl border border-amber-500/20"
		>
			<div className="flex items-start gap-2.5 bg-amber-500/[0.06] p-3">
				<HugeiconsIcon
					icon={AlertCircleIcon}
					size={17}
					className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300"
				/>
				<div>
					<h3 className="text-xs font-semibold">
						{fields.length === 1
							? "One edit needs your choice"
							: `${fields.length} edits need your choice`}
					</h3>
					<p className="mt-1 text-[11px] leading-relaxed text-black/55 dark:text-white/55">
						An Editor published corrections while you edited this
						draft. Choose which values to keep before submitting
						again. The published item stays unchanged.
					</p>
				</div>
			</div>
			<div className="divide-y divide-black/[0.06] dark:divide-white/[0.07]">
				{fields.map(({ key, label }) => (
					<fieldset key={key} className="min-w-0 p-3">
						<legend className="float-left mb-2 w-full text-xs font-medium">
							{label}
						</legend>
						<div className="clear-both grid gap-2">
							{(["draft", "published"] as const).map((source) => (
								<label
									key={source}
									className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors ${choices[key] === source ? "border-accent/40 bg-accent/[0.06]" : "border-black/[0.08] hover:bg-black/[0.025] dark:border-white/[0.09] dark:hover:bg-white/[0.025]"}`}
								>
									<input
										type="radio"
										name={`conflict-${key}`}
										checked={choices[key] === source}
										onChange={() =>
											setChoices({
												...choices,
												[key]: source,
											})
										}
										className="mt-0.5 size-3.5 shrink-0 accent-accent"
									/>
									<span className="min-w-0">
										<span className="flex items-center gap-1.5 text-[10px] font-medium text-black/50 dark:text-white/50">
											<HugeiconsIcon
												icon={sourceLabels[source].icon}
												size={12}
											/>
											{sourceLabels[source].label}
										</span>
										<span className="mt-1.5 block break-words text-xs leading-relaxed">
											{String(
												source === "draft"
													? (payload[key] ?? "")
													: published[key],
											)}
										</span>
									</span>
								</label>
							))}
						</div>
					</fieldset>
				))}
			</div>
			<div className="flex items-center justify-between gap-3 border-t border-black/[0.06] p-3 dark:border-white/[0.07]">
				<span className="text-[11px] text-black/45 dark:text-white/45">
					{count} of {fields.length} chosen
				</span>
				<Button
					size="sm"
					isDisabled={disabled || count !== fields.length}
					isLoading={disabled}
					startContent={<HugeiconsIcon icon={Tick01Icon} size={14} />}
					onPress={() => onResolve(choices)}
				>
					Apply to draft
				</Button>
			</div>
		</section>
	);
}
