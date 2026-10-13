"use client";

import { Drawer, DrawerContent, ModalContent } from "@nextui-org/react";
import { useState } from "react";

import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";

import { ImportDone } from "./ImportDone";
import { BibliographyInput, DoiInput, PdfInput } from "./ImportInputs";
import { ReviewBar, ReviewDetail, ReviewList } from "./ImportReview";
import { DesignChecks } from "./DesignChecks";
import { DesignDocument } from "./DesignDocument";
import { DesignDrawer } from "./DesignDrawer";
import { DesignQueue } from "./DesignQueue";
import { DesignSheet } from "./DesignSheet";
import { DesignHeader, InputNote, SourceTabs, StageFade } from "./import-design-parts";
import { action, CollectionsButton, useImportDesign, useImportFlow, type ImportDesign, type ImportFlowProps, type ImportFlowState } from "./import-flow";

/**
 * Import records from PDFs, a pasted DOI list or bibliography files. PDFs are
 * read by AI, which fills their metadata, judges their OpenAlex topics and
 * answers the library's checks. Every source ends in the same review, and the
 * chosen records become unpublished drafts in one call.
 */
export function AdminImportDialog({ isOpen, ...props }: ImportFlowProps & { isOpen: boolean }) {
	// Each opening starts fresh; closing keeps the contents while the dialog animates out.
	const [opening, setOpening] = useState(0);
	const [wasOpen, setWasOpen] = useState(isOpen);
	if (isOpen !== wasOpen) {
		setWasOpen(isOpen);
		if (isOpen) setOpening((value) => value + 1);
	}
	return <ImportHost isOpen={isOpen} key={opening} {...props} />;
}

// shortcut: the mock's five designs share one flow; the real build keeps the chosen one.
const FRAMES: Record<Exclude<ImportDesign, "drawer">, { base: string; size: "5xl" | "full" }> = {
	checks: { base: "my-4 h-[calc(100dvh-2rem)] max-w-[80rem] overflow-hidden sm:my-4", size: "5xl" },
	document: { base: "my-4 h-[calc(100dvh-2rem)] max-w-[90rem] overflow-hidden sm:my-4", size: "5xl" },
	now: { base: "my-4 h-[min(46rem,calc(100dvh-2rem))] max-w-[68rem] overflow-hidden sm:my-4", size: "5xl" },
	queue: { base: "my-4 h-[min(46rem,calc(100dvh-2rem))] max-w-[66rem] overflow-hidden sm:my-4", size: "5xl" },
	sheet: { base: "m-0 h-dvh max-h-dvh w-screen max-w-none overflow-hidden rounded-none border-0 sm:m-0", size: "full" },
};

function ImportHost({ isOpen, ...props }: ImportFlowProps & { isOpen: boolean }) {
	const flow = useImportFlow(props);
	const design = useImportDesign();
	const onOpenChange = (open: boolean) => {
		if (!open) props.onClose();
	};
	if (design === "drawer") {
		return (
			<Drawer classNames={{ base: "max-w-[36rem] border-s border-black/10 bg-background_light dark:border-white/10 dark:bg-card" }} hideCloseButton isOpen={isOpen} onOpenChange={onOpenChange} placement="right" size="2xl">
				<DrawerContent>{isOpen ? <DesignDrawer flow={flow} /> : null}</DrawerContent>
			</Drawer>
		);
	}
	const frame = FRAMES[design];
	return (
		<DialogModal classNames={{ base: frame.base }} isOpen={isOpen} onOpenChange={onOpenChange} size={frame.size}>
			<ModalContent>
				{isOpen ? (
					design === "document" ? (
						<DesignDocument flow={flow} />
					) : design === "sheet" ? (
						<DesignSheet flow={flow} />
					) : design === "queue" ? (
						<DesignQueue flow={flow} />
					) : design === "checks" ? (
						<DesignChecks flow={flow} />
					) : (
						<DesignNow flow={flow} />
					)
				) : null}
			</ModalContent>
		</DialogModal>
	);
}

/** The dialog as it was before the five designs: tabs, then a list beside the detail. */
function DesignNow({ flow }: { flow: ImportFlowState }) {
	const { activeRow, batch, stage } = flow;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<DesignHeader stage={stage} />
			<StageFade stage={stage}>
				{stage === "input" ? (
					<div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
						<SourceTabs
							dois={<DoiInput busy={flow.busy} onChange={flow.setDoiText} text={flow.doiText} />}
							files={<BibliographyInput busy={flow.busy} files={flow.files} onFilesChange={flow.setFiles} />}
							flow={flow}
							pdfs={<PdfInput busy={flow.busy} criteria={flow.checks} files={flow.pdfs} onCriteriaChange={flow.setChecks} onFilesChange={flow.setPdfs} />}
						/>
					</div>
				) : null}
				{stage === "review" && batch ? (
					<div className="flex min-h-0 flex-1 flex-col">
						<div className="shrink-0 px-6 py-3">
							<ReviewBar costUsd={flow.costUsd} counts={flow.counts} filter={flow.filter} kind={batch.kind} onFilter={flow.setFilter} />
						</div>
						<div className="grid min-h-0 flex-1 grid-cols-[22rem_minmax(0,1fr)] border-t border-black/[0.06] dark:border-white/[0.06]">
							<div className="min-h-0 overflow-y-auto border-e border-black/[0.06] px-3 py-2 dark:border-white/[0.06]">
								<ReviewList
									activeId={activeRow?.id ?? null}
									attach={batch.attach}
									checksOf={flow.checksOf}
									criteriaCount={flow.checkCount}
									filter={flow.filter}
									locked={flow.locked}
									onActivate={flow.setActiveId}
									onSelectedChange={flow.setSelected}
									readyIds={flow.readyIds}
									results={batch.results}
									rows={flow.shown}
									selected={flow.selected}
								/>
							</div>
							<div className="min-h-0 overflow-y-auto px-7 py-6">
								{activeRow ? (
									<ReviewDetail
										attach={batch.attach.get(activeRow.id)}
										checks={flow.checksOf(activeRow)}
										chosenTopics={flow.topicsOf(activeRow)}
										criteriaCount={flow.checkCount}
										key={activeRow.id}
										locked={flow.locked}
										onOpenRecord={flow.onOpenRecord}
										onToggleFix={() => flow.toggleFix(activeRow.id)}
										onToggleTopic={(topicId) => flow.toggleTopic(activeRow.id, topicId)}
										properties={flow.propertiesOf(activeRow)}
										result={flow.resultById.get(activeRow.id)}
										row={activeRow}
									/>
								) : null}
							</div>
						</div>
					</div>
				) : null}
				{stage === "done" && batch?.results ? (
					<div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
						<ImportDone batch={batch} onChoose={flow.choosePublish} onOpenRecord={flow.onOpenRecord} onPublish={flow.publish} />
					</div>
				) : null}
			</StageFade>
			<footer className="flex h-16 shrink-0 items-center gap-3 border-t border-black/[0.06] px-6 dark:border-white/[0.06]">
				{flow.error || flow.footerProblem || stage === "input" ? (
					<InputNote flow={flow} />
				) : stage === "review" ? (
					<>
						<CollectionsButton collections={batch?.collections ?? []} locked={flow.locked} onChange={flow.setCollections} sources={flow.sources} />
						{flow.reading ? <p className="text-xs text-black/50 dark:text-white/50">Reading carries on if you close this</p> : null}
					</>
				) : null}
				<span className="ms-auto flex items-center gap-2">
					{stage === "review" ? (
						<Button isDisabled={flow.locked} onPress={flow.restart} size="sm" variant="transparent">
							Back
						</Button>
					) : null}
					{stage === "done" ? (
						<Button onPress={flow.restart} size="sm" variant="transparent">
							Import more
						</Button>
					) : (
						<Button isDisabled={flow.busy && stage === "input"} onPress={flow.onClose} size="sm" variant="transparent">
							{stage === "review" ? "Close" : "Cancel"}
						</Button>
					)}
					{stage === "input" ? (
						<Button className="min-w-28" color="accent" isDisabled={flow.problem !== null} isLoading={flow.busy} onPress={flow.start} size="sm" variant="solid">
							{flow.primaryLabel}
						</Button>
					) : null}
					{stage === "review" ? (
						<Button className="min-w-32" color="accent" isDisabled={flow.reading || flow.selected.size === 0} isLoading={flow.locked} onPress={flow.commit} size="sm" variant="solid">
							{action("Import", flow.selected.size, "record", "records")}
						</Button>
					) : null}
					{stage === "done" ? (
						<Button className="min-w-24" color="accent" onPress={flow.finish} size="sm" variant="solid">
							Done
						</Button>
					) : null}
				</span>
			</footer>
		</div>
	);
}
