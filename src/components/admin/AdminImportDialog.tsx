"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { Drawer, DrawerContent } from "@nextui-org/react";
import { useState } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";

import { useAdminSession } from "./AdminSessionProvider";
import { publishView } from "./ImportDone";
import { ImportDoneStep } from "./ImportDoneStep";
import { ImportReviewStep, ReviewTabs } from "./ImportReviewStep";
import { ImportSteps } from "./ImportSteps";
import { InputNote, StageFade } from "./import-parts";
import { DropHint, ImportAdd, SheetDrop, SourceTabs, UploadButton } from "./ImportAdd";
import { action, useImportFlow, type ImportFlowProps, type ImportFlowState } from "./import-flow";

/**
 * Import records from PDFs, a pasted DOI list or bibliography files, in a
 * sheet that slides in over the record table, which stays in view. PDFs are
 * read by AI, which fills their metadata, judges their OpenAlex topics and
 * answers the library's checks, following the library's guidance. Every
 * source ends in the same review, and the chosen records become unpublished
 * drafts in one call.
 */
export function AdminImportDialog({ isOpen, ...props }: ImportFlowProps & { isOpen: boolean }) {
	// Each opening starts fresh; closing keeps the contents while the sheet slides out.
	const [opening, setOpening] = useState(0);
	const [wasOpen, setWasOpen] = useState(isOpen);
	if (isOpen !== wasOpen) {
		setWasOpen(isOpen);
		if (isOpen) setOpening((value) => value + 1);
	}
	return <ImportHost isOpen={isOpen} key={opening} {...props} />;
}

function ImportHost({ isOpen, ...props }: ImportFlowProps & { isOpen: boolean }) {
	const flow = useImportFlow(props);
	return (
		<Drawer
			classNames={{ base: "max-w-[36rem] border-s border-black/10 bg-background_light dark:border-white/10 dark:bg-background" }}
			hideCloseButton
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) props.onClose();
			}}
			placement="right"
			size="2xl"
		>
			<DrawerContent>{isOpen ? <ImportSheet flow={flow} /> : null}</DrawerContent>
		</Drawer>
	);
}

/**
 * The sheet: the header on the sheet's background, then one lighter panel
 * for every step. On the Add step the source tabs sit on top of the panel,
 * the chosen one joined to it, as in the record inspector.
 */
function ImportSheet({ flow }: { flow: ImportFlowState }) {
	const { batch, stage } = flow;
	const { canPublish } = useAdminSession();
	const view = stage === "done" && batch ? publishView(batch, flow.choosePublish, canPublish) : null;
	return (
		<SheetDrop flow={flow}>
			<header className="flex h-14 shrink-0 items-center gap-3 px-5">
				<h2 className="whitespace-nowrap text-base font-semibold text-black/90 dark:text-white/90">Import records</h2>
				<span className="flex-1" />
				{/* The steps make way for Close on a phone. */}
				<span className="hidden sm:block">
					<ImportSteps stage={stage} />
				</span>
				<Button aria-label="Close" className="-me-1.5 size-8 !min-w-8 shrink-0" isIconOnly onPress={flow.onClose} size="xs" variant="transparent">
					<HugeiconsIcon aria-hidden icon={Cancel01Icon} size={16} />
				</Button>
			</header>
			{stage === "input" ? <SourceTabs flow={flow} /> : stage === "review" && batch ? <ReviewTabs flow={flow} /> : null}
			<div className={`flex min-h-0 flex-1 flex-col bg-card_light dark:bg-card ${stage === "done" ? "border-t border-black/[0.06] dark:border-white/[0.06]" : ""}`}>
				<StageFade stage={stage}>
					{stage === "input" ? <ImportAdd flow={flow} /> : null}
					{stage === "review" && batch ? <ImportReviewStep flow={flow} /> : null}
					{view ? <ImportDoneStep flow={flow} /> : null}
				</StageFade>
				{/* On a phone the actions wrap under the collections rather than clip them. */}
				<footer className="flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-t border-black/[0.06] px-5 py-3 dark:border-white/[0.06]">
					{flow.error || flow.footerProblem ? (
						<InputNote flow={flow} />
					) : stage === "review" ? (
						<p className="min-w-0 flex-1 text-xs leading-5 text-black/50 dark:text-white/50">{flow.reading ? "Reading carries on if you close this" : "The chosen records become drafts"}</p>
					) : stage === "done" ? null : (
						<DropHint flow={flow} />
					)}
					<span className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
						{stage === "input" ? (
							<>
								<UploadButton flow={flow} />
								<Button className="min-w-28" color="accent" isDisabled={flow.problem !== null} isLoading={flow.busy} onPress={flow.start} size="sm" variant="solid">
									{flow.primaryLabel}
								</Button>
							</>
						) : null}
						{stage === "review" ? (
							<>
								<Button isDisabled={flow.locked} onPress={flow.restart} size="sm" variant="transparent">
									{flow.batch?.kind === "pdfs" ? "Discard" : "Back"}
								</Button>
								<Button className="min-w-32" color="accent" isDisabled={flow.reading || flow.selected.size === 0} isLoading={flow.locked} onPress={flow.commit} size="sm" variant="solid">
									{action("Import", flow.selected.size, "record", "records")}
								</Button>
							</>
						) : null}
						{view ? (
							<>
								<Button onPress={flow.restart} size="sm" variant="transparent">
									Import more
								</Button>
								{view.offered ? (
									<Button className="min-w-32" color="accent" isDisabled={view.started || !view.chosen.size} onPress={() => flow.send(view.toSend(), canPublish)} size="sm" variant="solid">
										{view.label}
									</Button>
								) : null}
								<Button className="min-w-20" onPress={flow.finish} size="sm" variant="muted">
									Done
								</Button>
							</>
						) : null}
					</span>
				</footer>
			</div>
		</SheetDrop>
	);
}
