"use client";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import {
	Tick01Icon,
	ArrowRight01Icon,
	File01Icon,
} from "@hugeicons/core-free-icons";
import type { AdminItemDetail } from "@/lib/admin/types";

export function PublicationArchiveFiles({
	attachments,
	readOnly,
}: Pick<AdminItemDetail, "attachments"> & { readOnly: boolean }) {
	const readyFiles = attachments.filter(
		(a) =>
			!a.fileRemovalPending &&
			(a.fileDraft?.readyAt || a.filePublication),
	);
	const files = readyFiles.length;
	const removalPending = attachments.some((file) => file.fileRemovalPending);
	const disabled = readOnly && files === 0;

	return (
		<button
			type="button"
			disabled={disabled}
			className="group flex w-full items-center gap-3 border-t border-black/[0.05] p-3 text-left transition-background-fill enabled:hover:bg-black/[0.03] dark:border-white/[0.06] dark:enabled:hover:bg-white/[0.04]"
			onClick={() =>
				document.getElementById("admin-attachments")?.scrollIntoView({
					behavior: "smooth",
					block: "start",
				})
			}
		>
			<span className="grid size-8 shrink-0 place-items-center self-start rounded-lg bg-card_light text-black/50 dark:bg-white/5 dark:text-white/55">
				<HugeiconsIcon icon={File01Icon} size={16} />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block text-xs font-medium">
					{files
						? `${files} ${files === 1 ? "PDF" : "PDFs"} attached`
						: removalPending
							? "PDF removal staged"
							: readOnly ? "No PDF attached" : "Add a PDF"}
				</span>
				<span className="mt-1 block truncate text-[10px] text-black/45 dark:text-white/45">
					{files
						? readyFiles
								.map(
									(file) =>
										file.fileDraft?.filename ??
										file.filePublication?.filename ??
										file.title,
								)
								.join(", ")
						: removalPending
							? "Published files stay unchanged until approval"
							: "Archive waits for an approved PDF"}
				</span>
			</span>
			{files > 0 && (
				<HugeiconsIcon
					icon={Tick01Icon}
					size={13}
					className="shrink-0 text-emerald-600 dark:text-emerald-400"
				/>
			)}
			{!disabled && (
				<HugeiconsIcon
					icon={ArrowRight01Icon}
					size={13}
					className="shrink-0 text-black/30 transition-transform group-hover:translate-x-0.5 dark:text-white/35"
				/>
			)}
		</button>
	);
}
